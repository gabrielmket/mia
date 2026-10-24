/**
 * FORK MIA (.89) — O MOTOR DO DISPARO DE E-MAIL: uma rodada do cron.
 *
 * A cada minuto (`app/api/v1/cron/email-marketing`), para cada campanha que
 * está para sair:
 *
 *   1. COMEÇA a agendada cuja hora chegou, conferindo o saldo de novo;
 *   2. PARA se a empresa é de demonstração, se a Amazon foi desligada, se o
 *      domínio deixou de estar verificado ou se a TRAVA DE SAÚDE disparou
 *      (rejeição a partir de 4% ou reclamação a partir de 0,08%, contadas a
 *      partir de 300 entregues);
 *   3. calcula quantos podem sair AGORA: o ritmo da campanha, a janela e os dias
 *      úteis da empresa, o teto do dia do AQUECIMENTO do domínio (todas as
 *      campanhas somadas), o saldo e o teto da rodada;
 *   4. reivindica o lote (`fn_mia_email_reivindicar`, `skip locked`), REAVALIA
 *      cada pessoa (quem se descadastrou depois do agendamento não recebe),
 *      monta e manda, e marca a linha com o id da Amazon e o preço;
 *   5. COBRA o lote (`fn_mia_email_cobrar`): só o que a Amazon aceitou.
 *
 * O estado mora todo no banco (uma linha por destinatário): a rodada seguinte
 * continua de onde esta parou, e um processo que morre no meio não manda em
 * dobro — envio preso vira falha, nunca reenvio (envio em dobro é pior que
 * não-envio, a regra do `recover-stuck-messages` do upstream).
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { lerSaldoDaCarteira } from "@/lib/carteira/ler-saldo";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { travaDaDemonstracao } from "@/lib/demonstracao/trava";
import {
  configuracaoDaAmazon,
  enviarPelaAmazon,
  lerConta,
  type DependenciasDaAmazon,
} from "@/lib/email/ses";
import { logger } from "@/lib/logger";
import { ehOperante, STATUS_OPERANTE, statusDaOrgEmbutida } from "@/lib/organizacao/operante";

import { lerSupressoesDeEmail, type DominioDoEmail } from "./banco";
import { lerCampanha, nomesDasEmpresas, type CampanhaDeEmail } from "./campanhas";
import { aceitouMedicao, consentimentoVigente, recusouMarketing } from "./consentimento";
import { motivoDeExclusao } from "./elegibilidade";
import { emailComForma, hashDoEmail, normalizarEmail } from "./endereco";
import { contextoDeEnvio, montarParaUmaPessoa } from "./envio";
import { diaNoFuso, instanteNoFuso, partesNoFuso } from "./fuso";
import { clientesRecentes, lerContatosDoEmail } from "./publico";
import { MINUTOS_ATE_ENVIO_PRESO, TETO_DA_RODADA } from "./regras";
import {
  proximoDegrau,
  quantosPodemSair,
  tetoDoDegrau,
  travaDeSaude,
  type NumerosDoDia,
} from "./ritmo";
import { trocarVariaveis, variaveisUsadas } from "./variaveis";
import { variaveisSemReserva } from "./blocos";

/** Os estados que contam como "a Amazon aceitou". */
const ACEITOS = ["enviado", "entregue", "rejeitado", "reclamacao"] as const;

export interface DependenciasDoMotor {
  amazon?: DependenciasDaAmazon;
  agora?: () => Date;
  /** Espaço entre dois envios, em ms (a cota por segundo da conta). */
  espacar?: (ms: number) => Promise<void>;
  /** Teto de tempo da rodada inteira. */
  prazoMs?: number;
}

export interface ResultadoDaCampanhaNaRodada {
  campanha_id: string;
  enviados: number;
  pulados: number;
  falhas: number;
  cobrado_cents: number;
  parou: string | null;
  espera: string | null;
  concluiu: boolean;
}

export interface ResultadoDaRodadaDeEmail {
  campanhas: ResultadoDaCampanhaNaRodada[];
  presos: number;
}

function inicioDoDia(agora: Date, fuso: string): Date {
  const p = partesNoFuso(agora, fuso);
  return instanteNoFuso(p.ano, p.mes, p.dia, 0, fuso);
}

/** Quantas linhas, contadas no banco. */
async function quantas(
  consulta: PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const { count, error } = await consulta;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Os números de saúde de uma campanha (todas as rodadas somadas). */
export async function numerosDaCampanha(
  db: SupabaseClient,
  orgId: string,
  campanhaId: string,
): Promise<NumerosDoDia> {
  const base = () =>
    db
      .from("mia_email_destinatarios")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("campanha_id", campanhaId);
  const [enviados, entregues, rejeicoes, reclamacoes] = await Promise.all([
    quantas(base().in("status", [...ACEITOS])),
    quantas(base().in("status", ["entregue", "reclamacao"])),
    quantas(base().eq("status", "rejeitado")),
    quantas(base().eq("status", "reclamacao")),
  ]);
  return { enviados, entregues, rejeicoes, reclamacoes };
}

/** Os números do DOMÍNIO (todas as campanhas da empresa) num intervalo de envio. */
async function numerosDoDominioNoDia(
  db: SupabaseClient,
  orgId: string,
  de: Date,
  ate: Date,
): Promise<NumerosDoDia> {
  const base = () =>
    db
      .from("mia_email_destinatarios")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("enviado_em", de.toISOString())
      .lt("enviado_em", ate.toISOString());
  const [enviados, entregues, rejeicoes, reclamacoes] = await Promise.all([
    quantas(base().in("status", [...ACEITOS])),
    quantas(base().in("status", ["entregue", "reclamacao"])),
    quantas(base().eq("status", "rejeitado")),
    quantas(base().eq("status", "reclamacao")),
  ]);
  return { enviados, entregues, rejeicoes, reclamacoes };
}

async function pausar(
  db: SupabaseClient,
  c: CampanhaDeEmail,
  motivo: string,
  agora: Date,
): Promise<void> {
  await db
    .from("mia_email_campanhas")
    .update({ status: "pausada", motivo_da_pausa: motivo, pausada_em: agora.toISOString() })
    .eq("organization_id", c.organization_id)
    .eq("id", c.id)
    .in("status", ["enviando", "agendada"]);
}

/**
 * O degrau do aquecimento para HOJE. Na virada para um novo dia de envio, o
 * degrau sobe se o último dia com envio foi saudável (e se repete se não foi).
 */
async function degrauDeHoje(
  db: SupabaseClient,
  orgId: string,
  dominio: DominioDoEmail,
  agora: Date,
  fuso: string,
): Promise<number> {
  const hoje = diaNoFuso(agora, fuso);
  if (!dominio.ultimoDiaDeEnvio || dominio.ultimoDiaDeEnvio === hoje) return dominio.degrau;
  const [a, m, d] = dominio.ultimoDiaDeEnvio.split("-").map(Number) as [number, number, number];
  const de = instanteNoFuso(a, m, d, 0, fuso);
  const ate = instanteNoFuso(a, m, d, 24, fuso);
  const numeros = await numerosDoDominioNoDia(db, orgId, de, ate);
  return proximoDegrau(dominio.degrau, numeros);
}

export async function rodarUmaCampanha(
  db: SupabaseClient,
  campanhaId: string,
  orgId: string,
  deps: DependenciasDoMotor & { cotaDaConta: number; porSegundo: number; fimDoPrazo: number },
): Promise<ResultadoDaCampanhaNaRodada> {
  const agora = (deps.agora ?? (() => new Date()))();
  const r: ResultadoDaCampanhaNaRodada = {
    campanha_id: campanhaId,
    enviados: 0,
    pulados: 0,
    falhas: 0,
    cobrado_cents: 0,
    parou: null,
    espera: null,
    concluiu: false,
  };
  let c = await lerCampanha(db, orgId, campanhaId);
  if (!c || (c.status !== "enviando" && c.status !== "agendada")) return r;

  // ── 2. as paradas ──
  const trava = await travaDaDemonstracao(db, orgId);
  if (trava.travado) {
    await pausar(db, c, "organizacao_de_demonstracao", agora);
    return { ...r, parou: "organizacao_de_demonstracao" };
  }
  if (!configuracaoDaAmazon(deps.amazon?.ambiente).configurado) {
    await pausar(db, c, "amazon_desligada", agora);
    return { ...r, parou: "amazon_desligada" };
  }
  const ctx = await contextoDeEnvio(db, orgId);
  if (!ctx.dominio?.verificado) {
    await pausar(db, c, "dominio_nao_verificado", agora);
    return { ...r, parou: "dominio_nao_verificado" };
  }
  const saude = travaDeSaude(await numerosDaCampanha(db, orgId, c.id));
  if (saude) {
    const texto = `trava_de_saude:${saude.motivo}: ${saude.taxaPct.toFixed(2).replace(".", ",")}% de ${saude.motivo === "reclamacao" ? "reclamação" : "rejeição"}, acima da trava de ${String(saude.limitePct).replace(".", ",")}%. Só volta quando o gestor decidir.`;
    await pausar(db, c, texto, agora);
    return { ...r, parou: `trava_de_saude:${saude.motivo}` };
  }

  // ── 1. começa a agendada, com o saldo conferido de novo ──
  const preco = c.preco_cents ?? 0;
  let saldo = (await lerSaldoDaCarteira(db, orgId)).saldo_cents;
  if (c.status === "agendada") {
    if (preco > 0 && saldo < preco) {
      await pausar(db, c, "saldo_insuficiente", agora);
      return { ...r, parou: "saldo_insuficiente" };
    }
    await db
      .from("mia_email_campanhas")
      .update({ status: "enviando", iniciada_em: agora.toISOString() })
      .eq("organization_id", orgId)
      .eq("id", c.id)
      .eq("status", "agendada");
    c = { ...c, status: "enviando", iniciada_em: agora.toISOString() };
  }

  // ── 3. quantos podem sair agora ──
  const fuso = ctx.empresa.fuso;
  const comecoDoDia = inicioDoDia(agora, fuso);
  const degrau = await degrauDeHoje(db, orgId, ctx.dominio, agora, fuso);
  const tetoHoje = tetoDoDegrau(degrau, deps.cotaDaConta);
  const [enviadosHojeNoDominio, enviadosHojePelaCampanha, pendentes] = await Promise.all([
    quantas(
      db
        .from("mia_email_destinatarios")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .gte("enviado_em", comecoDoDia.toISOString()),
    ),
    quantas(
      db
        .from("mia_email_destinatarios")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("campanha_id", c.id)
        .gte("enviado_em", comecoDoDia.toISOString()),
    ),
    quantas(
      db
        .from("mia_email_destinatarios")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("campanha_id", c.id)
        .eq("status", "pendente"),
    ),
  ]);
  if (pendentes === 0) {
    return await talvezConcluir(db, c, r, agora);
  }
  const pode = quantosPodemSair({
    agora,
    fuso,
    ritmoPorHora: c.ritmo_por_hora ?? ctx.config.ritmoPorHora,
    janelaInicio: ctx.config.janelaInicio,
    janelaFim: ctx.config.janelaFim,
    soDiasUteis: c.so_dias_uteis ?? ctx.config.soDiasUteis,
    enviadosHojePelaCampanha,
    comecaEm: c.agendada_para ? new Date(c.agendada_para) : null,
    restaNoTetoDoDominio: tetoHoje - enviadosHojeNoDominio,
    tetoDaRodada: TETO_DA_RODADA,
  });
  let quantos = pode.quantos;
  if (preco > 0) quantos = Math.min(quantos, Math.floor(saldo / preco));
  if (quantos <= 0) {
    if (preco > 0 && saldo < preco) {
      await pausar(db, c, "saldo_insuficiente", agora);
      return { ...r, parou: "saldo_insuficiente" };
    }
    return { ...r, espera: pode.espera };
  }

  // ── 4. o lote ──
  const lote = randomUUID();
  const { data: reivindicados, error: erroLote } = await db.rpc("fn_mia_email_reivindicar", {
    p_campanha: c.id,
    p_lote: lote,
    p_limite: quantos,
  });
  if (erroLote) throw new Error(`reivindicar: ${erroLote.message}`);
  const linhas = (reivindicados ?? []) as Array<{
    id: string;
    contact_id: string | null;
    email: string | null;
    email_hash: string;
    medir_abertura: boolean;
  }>;
  if (linhas.length === 0) return { ...r, espera: "no_ritmo" };

  const usaCampos = variaveisUsadas(
    [
      c.assunto,
      c.pre_cabecalho,
      ...c.blocos.map((b) => ("texto" in b ? b.texto : "alt" in b ? b.alt : "")),
    ].join("\n"),
  ).some((k) => k.startsWith("contato."));
  const ids = linhas.flatMap((l) => (l.contact_id ? [l.contact_id] : []));
  const [contatos, suprimidos, linksCongelados] = await Promise.all([
    lerContatosDoEmail(db, orgId, ids, { campos: usaCampos }),
    lerSupressoesDeEmail(db, orgId),
    db
      .from("mia_email_links")
      .select("id, ordem")
      .eq("organization_id", orgId)
      .eq("campanha_id", c.id),
  ]);
  const linksPorOrdem = new Map(
    ((linksCongelados.data ?? []) as Array<{ id: string; ordem: number }>).map((l) => [
      l.ordem,
      l.id,
    ]),
  );
  const clientes =
    c.base_legal === "legitimate_interest"
      ? await clientesRecentes(db, orgId, ids, agora)
      : new Set<string>();
  const empresas = await nomesDasEmpresas(
    db,
    orgId,
    [...contatos.values()].flatMap((x) => (x.empresa_id ? [x.empresa_id] : [])),
  );
  const semReserva = variaveisSemReserva({
    assunto: c.assunto,
    preCabecalho: c.pre_cabecalho,
    blocos: c.blocos,
    reservas: c.reservas,
  });
  const espacar = deps.espacar ?? ((ms: number) => new Promise((ok) => setTimeout(ok, ms)));
  const intervalo = Math.ceil(1000 / Math.max(1, deps.porSegundo));

  const pular = async (id: string, motivo: string) => {
    r.pulados += 1;
    await db
      .from("mia_email_destinatarios")
      .update({ status: "pulado", motivo, email: null })
      .eq("organization_id", orgId)
      .eq("id", id);
  };

  let interrompido: string | null = null;
  for (const linha of linhas) {
    if (interrompido || Date.now() > deps.fimDoPrazo) {
      // Sem tempo ou com a Amazon recusando: o resto volta para a fila.
      await db
        .from("mia_email_destinatarios")
        .update({ status: "pendente", lote_id: null })
        .eq("organization_id", orgId)
        .eq("id", linha.id)
        .eq("status", "enviando");
      continue;
    }
    // ── a reavaliação ──
    const contato = linha.contact_id ? contatos.get(linha.contact_id) : undefined;
    if (!contato) {
      await pular(linha.id, "outros");
      continue;
    }
    const emailAtual = contato.email ? normalizarEmail(contato.email) : null;
    if (!emailAtual) {
      await pular(linha.id, "sem_email");
      continue;
    }
    if (hashDoEmail(emailAtual) !== linha.email_hash) {
      // O endereço do cadastro mudou depois da confirmação: o consentimento
      // registrado era de outro endereço. Fica de fora, com o motivo.
      await pular(linha.id, "email_mudou");
      continue;
    }
    const motivo = motivoDeExclusao(
      {
        contactId: contato.id,
        email: emailAtual,
        bloqueado: contato.is_blocked === true,
        pessoal: contato.is_personal === true,
        anonimizado: contato.is_anonymized === true,
        recusouMarketing: recusouMarketing(contato.consent),
        consentiuEmail: consentimentoVigente(contato.consent),
        clienteRecente: clientes.has(contato.id),
      },
      {
        base: c.base_legal,
        suprimidos,
        hashDoEmail,
        temForma: emailComForma,
        dominioRecebe: () => true,
      },
    );
    if (motivo) {
      await pular(linha.id, motivo);
      continue;
    }
    const valores = {
      nome: nomeDoContato(contato),
      empresa: contato.empresa_id ? (empresas.get(contato.empresa_id) ?? null) : null,
      responsavel: contato.carteira_user_id
        ? (ctx.nomesDaEquipe.get(contato.carteira_user_id) ?? null)
        : null,
      campos: (contato.custom_fields as Record<string, unknown> | null) ?? null,
    };
    if (semReserva.length > 0) {
      const t = trocarVariaveis(semReserva.map((k) => `{{${k}}}`).join(" "), valores, c.reservas, {
        agora,
        fuso,
      });
      if (t.faltando.length > 0) {
        await pular(linha.id, "variavel_sem_dado");
        continue;
      }
    }
    // A medição: só quem consentiu com o aviso, e nunca no interesse legítimo.
    const medir =
      c.base_legal === "consent" && linha.medir_abertura && aceitouMedicao(contato.consent);
    const msg = montarParaUmaPessoa(
      ctx,
      c,
      { para: emailAtual, destinatarioId: linha.id, valores, medirAbertura: medir, linksPorOrdem },
      agora,
    );
    if ("erro" in msg) {
      interrompido = msg.erro;
      continue;
    }
    const envio = await enviarPelaAmazon(
      {
        de: msg.de,
        para: msg.para,
        mensagemMime: msg.mime,
        etiquetas: { campanha: c.id, destinatario: linha.id, empresa: orgId },
      },
      deps.amazon,
    );
    if (envio.ok) {
      r.enviados += 1;
      saldo -= preco;
      await db
        .from("mia_email_destinatarios")
        .update({
          status: "enviado",
          ses_message_id: envio.dados.messageId,
          enviado_em: new Date().toISOString(),
          cobrado_cents: preco,
          medir_abertura: medir,
        })
        .eq("organization_id", orgId)
        .eq("id", linha.id);
    } else if (envio.erro === "limite_de_envio") {
      // A Amazon pediu calma: este volta para a fila, e a rodada para aqui.
      await db
        .from("mia_email_destinatarios")
        .update({ status: "pendente", lote_id: null })
        .eq("organization_id", orgId)
        .eq("id", linha.id);
      interrompido = "limite_de_envio";
    } else if (
      envio.erro === "conta_pausada" ||
      envio.erro === "dominio_nao_verificado" ||
      envio.erro === "nao_configurado"
    ) {
      await db
        .from("mia_email_destinatarios")
        .update({ status: "pendente", lote_id: null })
        .eq("organization_id", orgId)
        .eq("id", linha.id);
      interrompido = envio.erro;
      await pausar(
        db,
        c,
        envio.erro === "conta_pausada" ? "amazon_pausou_a_conta" : envio.erro,
        agora,
      );
      r.parou = envio.erro;
    } else {
      // Recusa da mensagem, falha de rede, sem resposta: FALHA, nunca reenvio.
      // Uma falta de resposta pode ter sido aceita do outro lado.
      r.falhas += 1;
      await db
        .from("mia_email_destinatarios")
        .update({
          status: "falhou",
          motivo: `${envio.erro}: ${envio.detalhe}`.slice(0, 300),
          email: null,
        })
        .eq("organization_id", orgId)
        .eq("id", linha.id);
    }
    await espacar(intervalo);
  }

  // ── 5. a cobrança do lote, e o dia do aquecimento ──
  const { data: cobrado, error: erroCobranca } = await db.rpc("fn_mia_email_cobrar", {
    p_campanha: c.id,
  });
  if (erroCobranca)
    logger.error("[email-marketing] cobrança do lote falhou", {
      campanha_id: c.id,
      error: erroCobranca.message,
    });
  r.cobrado_cents = Number(cobrado ?? 0);
  if (r.enviados > 0) {
    await db
      .from("mia_email_dominios")
      .update({ aquecimento_degrau: degrau, aquecimento_ultimo_dia: diaNoFuso(agora, fuso) })
      .eq("organization_id", orgId)
      .eq("id", ctx.dominio.id);
  }
  if (interrompido && !r.parou) r.espera = interrompido;
  return await talvezConcluir(db, c, r, agora);
}

async function talvezConcluir(
  db: SupabaseClient,
  c: CampanhaDeEmail,
  r: ResultadoDaCampanhaNaRodada,
  agora: Date,
): Promise<ResultadoDaCampanhaNaRodada> {
  if (r.parou) return r;
  const restam = await quantas(
    db
      .from("mia_email_destinatarios")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", c.organization_id)
      .eq("campanha_id", c.id)
      .in("status", ["pendente", "enviando"]),
  );
  if (restam === 0) {
    await db
      .from("mia_email_campanhas")
      .update({ status: "concluida", concluida_em: agora.toISOString() })
      .eq("organization_id", c.organization_id)
      .eq("id", c.id)
      .eq("status", "enviando");
    return { ...r, concluiu: true };
  }
  return r;
}

/** Envio preso em "enviando" vira falha (nunca reenvio). */
export async function soltarPresos(db: SupabaseClient, agora: Date): Promise<number> {
  const limite = new Date(agora.getTime() - MINUTOS_ATE_ENVIO_PRESO * 60_000).toISOString();
  const { data, error } = await db
    .from("mia_email_destinatarios")
    .update({ status: "falhou", motivo: "envio_interrompido", email: null })
    .eq("status", "enviando")
    .is("ses_message_id", null)
    .lt("updated_at", limite)
    .select("id");
  if (error) throw new Error(`presos: ${error.message}`);
  return (data ?? []).length;
}

/** A rodada inteira: as campanhas para sair, de empresas operantes. */
export async function rodadaDoEmailMarketing(
  db: SupabaseClient,
  deps: DependenciasDoMotor = {},
): Promise<ResultadoDaRodadaDeEmail> {
  const agora = (deps.agora ?? (() => new Date()))();
  const fimDoPrazo = Date.now() + (deps.prazoMs ?? 45_000);
  const presos = await soltarPresos(db, agora);
  if (!configuracaoDaAmazon(deps.amazon?.ambiente).configurado) return { campanhas: [], presos };

  // Organização parada (suspensa, redigida, arquivada) não dispara: a régua é a
  // do upstream (`lib/organizacao/operante.ts`), pelo status embutido, e
  // `ehOperante` linha a linha como cinto — o mesmo do `broadcast-worker`.
  const { data, error } = await db
    .from("mia_email_campanhas")
    .select(
      "id, organization_id, status, agendada_para, organizations:organization_id!inner(status)",
    )
    .in("status", ["enviando", "agendada"])
    .eq("organizations.status", STATUS_OPERANTE)
    .lte("agendada_para", agora.toISOString())
    .order("status", { ascending: false })
    .order("agendada_para", { ascending: true })
    .limit(20);
  if (error) throw new Error(`campanhas para sair: ${error.message}`);
  const alvos = (
    (data ?? []) as Array<{ id: string; organization_id: string; organizations?: unknown }>
  ).filter((c) =>
    ehOperante(statusDaOrgEmbutida(c.organizations as Parameters<typeof statusDaOrgEmbutida>[0])),
  );
  if (alvos.length === 0) return { campanhas: [], presos };

  const conta = await lerConta(deps.amazon);
  const cotaDaConta = conta.ok ? conta.dados.maximoEm24h : 0;
  const porSegundo = conta.ok ? conta.dados.maximoPorSegundo : 1;
  if (
    conta.ok &&
    (!conta.dados.envioLigado ||
      (conta.dados.maximoEm24h > 0 && conta.dados.enviadosNasUltimas24h >= conta.dados.maximoEm24h))
  ) {
    // A cota da conta é de TODAS as empresas: acabou, todo mundo espera.
    return {
      campanhas: alvos.map((a) => ({
        campanha_id: a.id,
        enviados: 0,
        pulados: 0,
        falhas: 0,
        cobrado_cents: 0,
        parou: null,
        espera: "cota_da_conta",
        concluiu: false,
      })),
      presos,
    };
  }

  const campanhas: ResultadoDaCampanhaNaRodada[] = [];
  for (const alvo of alvos) {
    if (Date.now() > fimDoPrazo) break;
    try {
      campanhas.push(
        await rodarUmaCampanha(db, alvo.id, alvo.organization_id, {
          ...deps,
          cotaDaConta,
          porSegundo,
          fimDoPrazo,
        }),
      );
    } catch (err) {
      logger.error("[email-marketing] a rodada de uma campanha falhou", {
        campanha_id: alvo.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { campanhas, presos };
}
