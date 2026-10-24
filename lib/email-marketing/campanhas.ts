/**
 * FORK MIA (.89) — AS CAMPANHAS DE E-MAIL: o rascunho, a conferência, o teste,
 * a confirmação e os controles (pausar, retomar, cancelar).
 *
 * As rotas da tela e as ferramentas do MCP de plataforma passam por aqui: o que
 * a tela recusa, a ferramenta recusa. A diferença entre as duas é UMA, e é de
 * produto: o MCP cria rascunho e manda teste, e NUNCA confirma (o disparo de
 * verdade é do gestor do cliente, na tela). `confirmarCampanha` não é importada
 * por nada em `lib/mcp-plataforma/` — e um teste confere.
 *
 * ── A ordem da confirmação ───────────────────────────────────────────────────
 *
 *   1. confere TUDO de novo no servidor (o que a tela mostrou pode ter mudado);
 *   2. monta o público e grava os destinatários (os que recebem e os que ficam
 *      de fora, cada um com o motivo) e congela os links;
 *   3. só então muda o estado, com o plano, o preço congelado e a declaração da
 *      base legal em nome de quem confirmou.
 *
 * Se o passo 3 falhar, os destinatários de rascunho são refeitos na próxima
 * tentativa: nada sai de uma campanha que não está agendada nem enviando.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { lerSaldoDaCarteira } from "@/lib/carteira/ler-saldo";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { configuracaoDaAmazon, lerConta, type DependenciasDaAmazon } from "@/lib/email/ses";
import { moduloLiberado } from "@/lib/modulos/liberacao";

import { estadoDoModulo, lerPrecoPorEmail, rodapeDaConfiguracaoCompleto } from "./banco";
import {
  blocosSchema,
  botaoValido,
  conferirConteudo,
  linksDosBlocos,
  reservasSchema,
  tamanhoEmKb,
  variaveisSemReserva,
  type BlocoDoEmail,
  type ItemDaConferencia,
} from "./blocos";
import { rotulosDoQueFalta } from "./dominio";
import { emailComForma, hashDoEmail } from "./endereco";
import {
  contextoDeEnvio,
  mandar,
  montarParaUmaPessoa,
  type CampanhaParaEnvio,
  type ContextoDeEnvio,
} from "./envio";
import { montarPublico, type ContatoDoPublico, type PublicoMontado } from "./publico";
import { lerRecorte, recorteSchema, temCriterio, type RecorteDoEmail } from "./recorte";
import {
  MARCA_DO_TESTE,
  MAXIMO_DE_ENDERECOS_NO_TESTE,
  MODULO_EMAIL_MARKETING,
  type BaseLegal,
  type StatusDaCampanhaDeEmail,
} from "./regras";
import { planejarEnvio, ritmoEfetivo, type DiaDoPlano } from "./ritmo";
import { trocarVariaveis, variaveisUsadas, type ValoresDoContato } from "./variaveis";
import { RecusaDaCampanha } from "./recusa";

export { RecusaDaCampanha };

export { MARCA_DO_TESTE };

export interface CampanhaDeEmail extends CampanhaParaEnvio {
  organization_id: string;
  status: StatusDaCampanhaDeEmail;
  versao: number;
  teste_versao: number | null;
  recorte: RecorteDoEmail;
  segmento_id: string | null;
  lia_ref: string | null;
  ritmo_por_hora: number | null;
  so_dias_uteis: boolean | null;
  agendada_para: string | null;
  plano: DiaDoPlano[] | null;
  total_previsto: number | null;
  preco_cents: number | null;
  custo_previsto_cents: number | null;
  confirmada_por: string | null;
  confirmada_em: string | null;
  declaracao_base_legal: string | null;
  motivo_da_pausa: string | null;
  pausada_em: string | null;
  iniciada_em: string | null;
  concluida_em: string | null;
  cancelada_em: string | null;
  origem: "tela" | "mcp";
  criada_por: string | null;
  created_at: string;
  updated_at: string;
}

const COLUNAS =
  "id, organization_id, nome, status, remetente_id, assunto, pre_cabecalho, blocos, reservas, versao, teste_versao, recorte, segmento_id, base_legal, lia_ref, ritmo_por_hora, so_dias_uteis, agendada_para, plano, total_previsto, preco_cents, custo_previsto_cents, confirmada_por, confirmada_em, declaracao_base_legal, motivo_da_pausa, pausada_em, iniciada_em, concluida_em, cancelada_em, origem, criada_por, created_at, updated_at";

function daLinha(l: Record<string, unknown>): CampanhaDeEmail {
  const blocos = blocosSchema.safeParse(l.blocos);
  const reservas = reservasSchema.safeParse(l.reservas);
  return {
    ...(l as unknown as CampanhaDeEmail),
    blocos: blocos.success ? blocos.data : [],
    reservas: reservas.success ? reservas.data : {},
    recorte: lerRecorte(l.recorte),
    plano: Array.isArray(l.plano) ? (l.plano as DiaDoPlano[]) : null,
  };
}

export async function lerCampanha(
  db: SupabaseClient,
  orgId: string,
  id: string,
): Promise<CampanhaDeEmail | null> {
  const { data, error } = await db
    .from("mia_email_campanhas")
    .select(COLUNAS)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`não consegui ler a campanha: ${error.message}`);
  return data ? daLinha(data as Record<string, unknown>) : null;
}

export async function listarCampanhas(
  db: SupabaseClient,
  orgId: string,
  limite = 100,
): Promise<CampanhaDeEmail[]> {
  const { data, error } = await db
    .from("mia_email_campanhas")
    .select(COLUNAS)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`não consegui ler as campanhas: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(daLinha);
}

/** O andamento de cada campanha, contado no banco (sem trazer linha). */
export async function andamentoDaCampanha(
  db: SupabaseClient,
  orgId: string,
  id: string,
): Promise<Record<string, number>> {
  const estados = [
    "pendente",
    "enviando",
    "enviado",
    "entregue",
    "rejeitado",
    "reclamacao",
    "pulado",
    "falhou",
  ] as const;
  const saida: Record<string, number> = {};
  await Promise.all(
    estados.map(async (s) => {
      const { count, error } = await db
        .from("mia_email_destinatarios")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("campanha_id", id)
        .eq("status", s);
      if (error) throw new Error(`andamento: ${error.message}`);
      saida[s] = count ?? 0;
    }),
  );
  return saida;
}

// ─── o rascunho ─────────────────────────────────────────────────────────────

export interface DadosDoRascunho {
  nome?: string;
  remetente_id?: string | null;
  assunto?: string;
  pre_cabecalho?: string;
  blocos?: BlocoDoEmail[];
  reservas?: Record<string, string>;
  recorte?: RecorteDoEmail;
  segmento_id?: string | null;
  base_legal?: BaseLegal;
  lia_ref?: string | null;
  ritmo_por_hora?: number | null;
  so_dias_uteis?: boolean | null;
}

/** Os campos que mudam o CONTEÚDO: mudar qualquer um pede um teste novo. */
const CAMPOS_DE_CONTEUDO = [
  "remetente_id",
  "assunto",
  "pre_cabecalho",
  "blocos",
  "reservas",
] as const;

export async function criarRascunho(
  db: SupabaseClient,
  entrada: {
    organizationId: string;
    autorId: string | null;
    origem: "tela" | "mcp";
    dados: DadosDoRascunho & { nome: string };
  },
): Promise<CampanhaDeEmail> {
  const d = entrada.dados;
  const linha = {
    organization_id: entrada.organizationId,
    nome: d.nome.trim().slice(0, 120),
    // Explícitos, e não só o padrão da coluna: criar NUNCA nasce em outro estado.
    status: "rascunho",
    versao: 1,
    remetente_id: d.remetente_id ?? null,
    assunto: d.assunto ?? "",
    pre_cabecalho: d.pre_cabecalho ?? "",
    blocos: blocosSchema.parse(d.blocos ?? []),
    reservas: reservasSchema.parse(d.reservas ?? {}),
    recorte: recorteSchema.parse(d.recorte ?? {}),
    segmento_id: d.segmento_id ?? null,
    base_legal: d.base_legal ?? "consent",
    lia_ref: d.lia_ref ?? null,
    ritmo_por_hora: d.ritmo_por_hora ?? null,
    so_dias_uteis: d.so_dias_uteis ?? null,
    origem: entrada.origem,
    criada_por: entrada.autorId,
  };
  const { data, error } = await db
    .from("mia_email_campanhas")
    .insert(linha)
    .select(COLUNAS)
    .single();
  if (error || !data)
    throw new Error(`não consegui criar a campanha: ${error?.message ?? "sem linha"}`);
  return daLinha(data as Record<string, unknown>);
}

export async function editarRascunho(
  db: SupabaseClient,
  orgId: string,
  id: string,
  dados: DadosDoRascunho,
): Promise<CampanhaDeEmail> {
  const atual = await lerCampanha(db, orgId, id);
  if (!atual) throw new RecusaDaCampanha("nao_encontrada", "Campanha não encontrada.", 404);
  if (atual.status !== "rascunho") {
    throw new RecusaDaCampanha(
      "conteudo_congelado",
      atual.status === "agendada"
        ? "A campanha está agendada e o conteúdo fica congelado. Para mudar, cancele o agendamento."
        : "A campanha já saiu: o que foi enviado não muda.",
      409,
    );
  }
  const patch: Record<string, unknown> = {};
  if (dados.nome !== undefined) patch.nome = dados.nome.trim().slice(0, 120);
  if (dados.remetente_id !== undefined) patch.remetente_id = dados.remetente_id;
  if (dados.assunto !== undefined) patch.assunto = dados.assunto;
  if (dados.pre_cabecalho !== undefined) patch.pre_cabecalho = dados.pre_cabecalho;
  if (dados.blocos !== undefined) patch.blocos = blocosSchema.parse(dados.blocos);
  if (dados.reservas !== undefined) patch.reservas = reservasSchema.parse(dados.reservas);
  if (dados.recorte !== undefined) patch.recorte = recorteSchema.parse(dados.recorte);
  if (dados.segmento_id !== undefined) patch.segmento_id = dados.segmento_id;
  if (dados.base_legal !== undefined) patch.base_legal = dados.base_legal;
  if (dados.lia_ref !== undefined) patch.lia_ref = dados.lia_ref;
  if (dados.ritmo_por_hora !== undefined) patch.ritmo_por_hora = dados.ritmo_por_hora;
  if (dados.so_dias_uteis !== undefined) patch.so_dias_uteis = dados.so_dias_uteis;
  const mudouConteudo = CAMPOS_DE_CONTEUDO.some(
    (c) => dados[c] !== undefined && JSON.stringify(dados[c]) !== JSON.stringify(atual[c]),
  );
  if (mudouConteudo) patch.versao = atual.versao + 1;
  if (Object.keys(patch).length === 0) return atual;
  const { data, error } = await db
    .from("mia_email_campanhas")
    .update(patch)
    .eq("organization_id", orgId)
    .eq("id", id)
    .eq("status", "rascunho")
    .select(COLUNAS)
    .maybeSingle();
  if (error) throw new Error(`não consegui salvar a campanha: ${error.message}`);
  if (!data)
    throw new RecusaDaCampanha(
      "conteudo_congelado",
      "A campanha mudou de estado enquanto você editava.",
      409,
    );
  return daLinha(data as Record<string, unknown>);
}

// ─── a conferência ─────────────────────────────────────────────────────────

export interface TravaDoEnvio {
  codigo: string;
  texto: string;
  /** Para onde a tela leva quem quer resolver. */
  ir: "config" | "publico" | "mensagem" | "envio" | null;
}

export interface Conferencia {
  publico: Pick<PublicoMontado, "contagem" | "truncado" | "semCriterio">;
  /** Recebem e têm o dado de toda variável sem reserva. */
  total: number;
  semDado: number;
  conteudo: ItemDaConferencia[];
  travas: TravaDoEnvio[];
  precoCents: number;
  precoPadrao: boolean;
  custoCents: number;
  saldoCents: number;
  plano: DiaDoPlano[];
  ritmoPorHora: number;
  soDiasUteis: boolean;
  janela: [number, number];
  degrau: number;
  cotaDaConta: number;
  medicao: "cliques_e_aberturas" | "so_cliques";
}

/** Valores de quem tem o dado? `null` = faltou variável sem reserva. */
function valoresDaPessoa(
  c: ContatoDoPublico,
  ctx: ContextoDeEnvio,
  nomesDasEmpresas: Map<string, string>,
): ValoresDoContato {
  return {
    nome: c.nome,
    empresa: c.empresaId ? (nomesDasEmpresas.get(c.empresaId) ?? null) : null,
    responsavel: c.donoId ? (ctx.nomesDaEquipe.get(c.donoId) ?? null) : null,
    campos: c.campos,
  };
}

export async function nomesDasEmpresas(
  db: SupabaseClient,
  orgId: string,
  ids: Iterable<string>,
): Promise<Map<string, string>> {
  const lista = [...new Set(ids)];
  const mapa = new Map<string, string>();
  for (let i = 0; i < lista.length; i += 150) {
    const { data, error } = await db
      .from("companies")
      .select("id, trade_name")
      .eq("organization_id", orgId)
      .in("id", lista.slice(i, i + 150));
    if (error) throw new Error(`empresas: ${error.message}`);
    for (const e of (data ?? []) as Array<{ id: string; trade_name: string | null }>) {
      if (e.trade_name) mapa.set(e.id, e.trade_name);
    }
  }
  return mapa;
}

/** A pessoa falta algum dado sem reserva? */
function faltaDado(
  campanha: CampanhaDeEmail,
  valores: ValoresDoContato,
  agora: Date,
  fuso: string,
): boolean {
  const usadas = variaveisSemReserva({
    assunto: campanha.assunto,
    preCabecalho: campanha.pre_cabecalho,
    blocos: campanha.blocos,
    reservas: campanha.reservas,
  });
  if (usadas.length === 0) return false;
  const modelo = usadas.map((k) => `{{${k}}}`).join(" ");
  return trocarVariaveis(modelo, valores, campanha.reservas, { agora, fuso }).faltando.length > 0;
}

export async function conferirCampanha(
  db: SupabaseClient,
  orgId: string,
  campanha: CampanhaDeEmail,
  opcoes: {
    agora?: Date;
    quando?: "agora" | string;
    ritmoPorHora?: number | null;
    soDiasUteis?: boolean | null;
    semDns?: boolean;
    amazon?: DependenciasDaAmazon;
  } = {},
): Promise<
  Conferencia & {
    publicoMontado: PublicoMontado;
    ctx: ContextoDeEnvio;
    elegiveis: ContatoDoPublico[];
    empresas: Map<string, string>;
  }
> {
  const agora = opcoes.agora ?? new Date();
  const ctx = await contextoDeEnvio(db, orgId);
  const usaCampos = variaveisUsadas(
    [
      campanha.assunto,
      campanha.pre_cabecalho,
      ...campanha.blocos.map((b) => ("texto" in b ? b.texto : "alt" in b ? b.alt : "")),
    ].join("\n"),
  ).some((k) => k.startsWith("contato."));
  const publicoMontado = await montarPublico(
    db,
    {
      organizationId: orgId,
      recorte: campanha.recorte,
      base: campanha.base_legal,
      agora,
      lerCampos: usaCampos,
    },
    { semDns: opcoes.semDns },
  );
  const recebem = publicoMontado.linhas.filter((l) => !l.motivo).map((l) => l.contato);
  const empresas = await nomesDasEmpresas(
    db,
    orgId,
    recebem.flatMap((c) => (c.empresaId ? [c.empresaId] : [])),
  );
  const elegiveis = recebem.filter(
    (c) => !faltaDado(campanha, valoresDaPessoa(c, ctx, empresas), agora, ctx.empresa.fuso),
  );
  const semDado = recebem.length - elegiveis.length;

  const [estado, preco, saldo, testes] = await Promise.all([
    estadoDoModulo(db, orgId),
    lerPrecoPorEmail(db, orgId),
    lerSaldoDaCarteira(db, orgId),
    db
      .from("mia_email_testes")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("campanha_id", campanha.id),
  ]);
  const algumTeste = (testes.count ?? 0) > 0;
  const testeDaVersaoAtual = campanha.teste_versao === campanha.versao;

  // O tamanho do e-mail de uma pessoa qualquer (a primeira que recebe).
  const exemplo = elegiveis[0];
  const amostra = montarParaUmaPessoa(
    ctx,
    campanha,
    {
      para: exemplo?.email ?? "exemplo@exemplo.invalid",
      destinatarioId: null,
      valores: exemplo
        ? valoresDaPessoa(exemplo, ctx, empresas)
        : { nome: null, empresa: null, responsavel: null, campos: null },
      medirAbertura: false,
    },
    agora,
  );
  const conteudo = conferirConteudo({
    campanha: {
      assunto: campanha.assunto,
      preCabecalho: campanha.pre_cabecalho,
      blocos: campanha.blocos,
      reservas: campanha.reservas,
    },
    rodapeCompleto: rodapeDaConfiguracaoCompleto(ctx.config),
    testeDaVersaoAtual,
    algumTeste,
    semDado,
    tamanhoKb: "montado" in amostra ? tamanhoEmKb(amostra.montado.html) : 0,
  });

  // O plano: ritmo (nunca mais rápido que a configuração), janela, dias úteis,
  // e o degrau do aquecimento do domínio.
  const ritmo = ritmoEfetivo(
    ctx.config.ritmoPorHora,
    opcoes.ritmoPorHora ?? campanha.ritmo_por_hora,
  );
  const soUteis = opcoes.soDiasUteis ?? campanha.so_dias_uteis ?? ctx.config.soDiasUteis;
  let cota = 0;
  if (estado.amazon.configurado) {
    const conta = await lerConta(opcoes.amazon);
    if (conta.ok) cota = conta.dados.maximoEm24h;
  }
  const inicio = opcoes.quando && opcoes.quando !== "agora" ? new Date(opcoes.quando) : agora;
  const plano = planejarEnvio({
    total: elegiveis.length,
    inicio,
    fuso: ctx.empresa.fuso,
    ritmoPorHora: ritmo,
    janelaInicio: ctx.config.janelaInicio,
    janelaFim: ctx.config.janelaFim,
    soDiasUteis: soUteis,
    degrau: ctx.dominio?.degrau ?? 0,
    cotaDaConta: cota,
  });
  const custoCents = elegiveis.length * preco.cents;

  const travas: TravaDoEnvio[] = [];
  if (!estado.contratado)
    travas.push({
      codigo: "modulo",
      texto: "O módulo de e-mail marketing não está contratado.",
      ir: null,
    });
  if (!configuracaoDaAmazon().configurado) {
    travas.push({
      codigo: "amazon",
      texto: "O envio pela Amazon ainda não foi ligado no servidor.",
      ir: "config",
    });
  }
  if (!ctx.dominio)
    travas.push({
      codigo: "dominio",
      texto: "Falta cadastrar e verificar o domínio do remetente.",
      ir: "config",
    });
  else if (!ctx.dominio.verificado) {
    travas.push({
      codigo: "dominio",
      texto: `O domínio ainda não está verificado: falta ${rotulosDoQueFalta(ctx.dominio.faltam).join(", ")}.`,
      ir: "config",
    });
  }
  if (!rodapeDaConfiguracaoCompleto(ctx.config))
    travas.push({ codigo: "rodape", texto: "O rodapé está incompleto.", ir: "config" });
  if (!estado.remetentePadrao)
    travas.push({ codigo: "remetente", texto: "Falta cadastrar um remetente.", ir: "config" });
  if (!temCriterio(campanha.recorte) || elegiveis.length <= 0)
    travas.push({ codigo: "publico", texto: "Ninguém entra na lista.", ir: "publico" });
  if (campanha.base_legal === "legitimate_interest" && !(campanha.lia_ref ?? "").trim()) {
    travas.push({
      codigo: "lia",
      texto: "Interesse legítimo pede a referência da avaliação (LIA).",
      ir: "publico",
    });
  }
  if (!campanha.assunto.trim())
    travas.push({ codigo: "assunto", texto: "Falta o assunto.", ir: "mensagem" });
  if (campanha.blocos.some((b) => b.tipo === "botao" && !botaoValido(b.url))) {
    travas.push({ codigo: "botao", texto: "Há botão sem endereço válido.", ir: "mensagem" });
  }
  if (conteudo.some((i) => i.nivel === "trava" && i.titulo === "imagemFalta")) {
    travas.push({ codigo: "imagem", texto: "Há bloco de imagem sem imagem.", ir: "mensagem" });
  }
  if (!testeDaVersaoAtual) {
    travas.push({
      codigo: "teste",
      texto: algumTeste
        ? "O conteúdo mudou depois do último teste: envie outro."
        : "Envie um teste antes.",
      ir: "mensagem",
    });
  }
  if (
    opcoes.quando &&
    opcoes.quando !== "agora" &&
    Date.parse(opcoes.quando) < agora.getTime() - 60_000
  ) {
    travas.push({ codigo: "agendamento", texto: "A data do agendamento já passou.", ir: "envio" });
  }
  if (elegiveis.length > 0 && custoCents > saldo.saldo_cents) {
    const cabem = preco.cents > 0 ? Math.floor(saldo.saldo_cents / preco.cents) : 0;
    travas.push({
      codigo: "saldo",
      texto: `O crédito não cobre a lista: faltam ${((custoCents - saldo.saldo_cents) / 100).toFixed(2).replace(".", ",")} reais. Dá para enviar até ${cabem} e-mails.`,
      ir: null,
    });
  }
  if (ctx.empresa.demonstracao) {
    travas.push({
      codigo: "demonstracao",
      texto: "Esta é a empresa de demonstração: nenhuma mensagem, e-mail ou aviso sai daqui.",
      ir: null,
    });
  }

  return {
    publico: {
      contagem: publicoMontado.contagem,
      truncado: publicoMontado.truncado,
      semCriterio: publicoMontado.semCriterio,
    },
    total: elegiveis.length,
    semDado,
    conteudo,
    travas,
    precoCents: preco.cents,
    precoPadrao: preco.padrao,
    custoCents,
    saldoCents: saldo.saldo_cents,
    plano,
    ritmoPorHora: ritmo,
    soDiasUteis: soUteis,
    janela: [ctx.config.janelaInicio, ctx.config.janelaFim],
    degrau: ctx.dominio?.degrau ?? 0,
    cotaDaConta: cota,
    medicao: campanha.base_legal === "consent" ? "cliques_e_aberturas" : "so_cliques",
    publicoMontado,
    ctx,
    elegiveis,
    empresas,
  };
}

// ─── o teste ────────────────────────────────────────────────────────────────

export interface ResultadoDoTeste {
  versao: number;
  enviados: string[];
  recusados: Array<{ para: string; erro: string }>;
}

/** Os endereços do teste: até 5, todos com forma de e-mail. A recusa diz qual. */
export function conferirEnderecosDoTeste(para: readonly string[]): string[] {
  const lista = [...new Set(para.map((p) => p.trim().toLowerCase()).filter(Boolean))];
  if (lista.length === 0)
    throw new RecusaDaCampanha("teste_sem_endereco", "Escreva pelo menos um endereço.");
  if (lista.length > MAXIMO_DE_ENDERECOS_NO_TESTE) {
    throw new RecusaDaCampanha(
      "teste_demais",
      `O teste vai para no máximo ${MAXIMO_DE_ENDERECOS_NO_TESTE} endereços.`,
    );
  }
  const ruim = lista.find((e) => !emailComForma(e));
  if (ruim)
    throw new RecusaDaCampanha(
      "teste_endereco_invalido",
      `"${ruim}" não parece um endereço de e-mail.`,
    );
  return lista;
}

/**
 * Manda o TESTE da versão atual: [TESTE] no assunto, links diretos, descadastro
 * inerte, sem pixel e SEM cobrar. Libera o envio da versão (teste_versao).
 */
export async function enviarTeste(
  db: SupabaseClient,
  entrada: {
    organizationId: string;
    campanhaId: string;
    para: readonly string[];
    autorId: string | null;
    /** De quem são os dados da prévia ("ver como"). Ausente = sem dados de pessoa. */
    verComoContatoId?: string | null;
    agora?: Date;
  },
  deps: DependenciasDaAmazon = {},
): Promise<ResultadoDoTeste> {
  const para = conferirEnderecosDoTeste(entrada.para);
  const campanha = await lerCampanha(db, entrada.organizationId, entrada.campanhaId);
  if (!campanha) throw new RecusaDaCampanha("nao_encontrada", "Campanha não encontrada.", 404);
  if (campanha.status !== "rascunho")
    throw new RecusaDaCampanha("conteudo_congelado", "O teste é da campanha em rascunho.", 409);
  if (!(await moduloLiberado(db, entrada.organizationId, MODULO_EMAIL_MARKETING))) {
    throw new RecusaDaCampanha("modulo", "O módulo de e-mail marketing não está contratado.", 403);
  }
  const amazon = configuracaoDaAmazon(deps.ambiente);
  if (!amazon.configurado) {
    throw new RecusaDaCampanha(
      "amazon",
      `O envio pela Amazon ainda não foi ligado no servidor (falta ${amazon.falta.join(", ")}).`,
      409,
    );
  }
  const ctx = await contextoDeEnvio(db, entrada.organizationId);
  if (ctx.empresa.demonstracao) {
    throw new RecusaDaCampanha(
      "organizacao_de_demonstracao",
      "Esta é a empresa de demonstração: nenhuma mensagem, e-mail ou aviso sai daqui.",
      403,
    );
  }
  if (!ctx.dominio?.verificado)
    throw new RecusaDaCampanha("dominio", "O domínio do remetente ainda não está verificado.", 409);
  const agora = entrada.agora ?? new Date();

  let valores: ValoresDoContato = { nome: null, empresa: null, responsavel: null, campos: null };
  if (entrada.verComoContatoId) {
    const { data } = await db
      .from("contacts")
      .select("id, name, display_name, empresa_id, carteira_user_id, custom_fields")
      .eq("organization_id", entrada.organizationId)
      .eq("id", entrada.verComoContatoId)
      .maybeSingle();
    if (data) {
      const c = data as Record<string, unknown>;
      const empresas = c.empresa_id
        ? await nomesDasEmpresas(db, entrada.organizationId, [String(c.empresa_id)])
        : new Map();
      valores = {
        nome: nomeDoContato({
          name: c.name as string | null,
          display_name: c.display_name as string | null,
        }),
        empresa: c.empresa_id ? (empresas.get(String(c.empresa_id)) ?? null) : null,
        responsavel: c.carteira_user_id
          ? (ctx.nomesDaEquipe.get(String(c.carteira_user_id)) ?? null)
          : null,
        campos: (c.custom_fields as Record<string, unknown> | null) ?? null,
      };
    }
  }

  // O registro nasce ANTES: na demonstração o banco o recusa (9064), e nada sai.
  const { data: teste, error: erroTeste } = await db
    .from("mia_email_testes")
    .insert({
      organization_id: entrada.organizationId,
      campanha_id: campanha.id,
      versao: campanha.versao,
      para,
      enviado_por: entrada.autorId,
    })
    .select("id")
    .single();
  if (erroTeste || !teste)
    throw new Error(`não consegui registrar o teste: ${erroTeste?.message ?? "sem linha"}`);

  const enviados: string[] = [];
  const recusados: Array<{ para: string; erro: string }> = [];
  for (const endereco of para) {
    const msg = montarParaUmaPessoa(
      ctx,
      campanha,
      { para: endereco, destinatarioId: null, valores, medirAbertura: false },
      agora,
    );
    if ("erro" in msg) {
      recusados.push({ para: endereco, erro: msg.erro });
      continue;
    }
    const r = await mandar(
      db,
      entrada.organizationId,
      msg,
      { campanha: campanha.id, tipo: "teste" },
      deps,
    );
    if (r.ok) enviados.push(endereco);
    else recusados.push({ para: endereco, erro: r.erro });
  }
  await db
    .from("mia_email_testes")
    .update({ resultado: { enviados, recusados } })
    .eq("organization_id", entrada.organizationId)
    .eq("id", (teste as { id: string }).id);
  if (enviados.length > 0) {
    await db
      .from("mia_email_campanhas")
      .update({ teste_versao: campanha.versao })
      .eq("organization_id", entrada.organizationId)
      .eq("id", campanha.id)
      .eq("versao", campanha.versao);
  }
  return { versao: campanha.versao, enviados, recusados };
}

// ─── a confirmação (SÓ pela tela) ──────────────────────────────────────────

export interface PedidoDeConfirmacao {
  organizationId: string;
  campanhaId: string;
  autorId: string;
  autorNome: string;
  /** "agora" ou um instante ISO no futuro. */
  quando: "agora" | string;
  ritmoPorHora?: number | null;
  soDiasUteis?: boolean | null;
  /** A pessoa marcou "Confirmo a base legal". Sem isso, não sai. */
  confirmaBaseLegal: boolean;
  agora?: Date;
}

export function textoDaDeclaracao(
  campanha: Pick<CampanhaDeEmail, "base_legal" | "lia_ref">,
  autorNome: string,
  quando: Date,
): string {
  const base =
    campanha.base_legal === "legitimate_interest"
      ? `Estas pessoas são clientes com compra nos últimos 24 meses, conforme a avaliação de interesse legítimo ${campanha.lia_ref ?? ""}.`.trim()
      : "Estas pessoas têm o aceite de e-mail marketing registrado.";
  return `${base} Declarado por ${autorNome} em ${quando.toISOString()}.`;
}

export async function confirmarCampanha(
  db: SupabaseClient,
  pedido: PedidoDeConfirmacao,
  deps: { amazon?: DependenciasDaAmazon } = {},
): Promise<{ campanha: CampanhaDeEmail; conferencia: Conferencia }> {
  if (!pedido.confirmaBaseLegal) {
    throw new RecusaDaCampanha("base_legal_nao_confirmada", "Marque a confirmação da base legal.");
  }
  const agora = pedido.agora ?? new Date();
  const campanha = await lerCampanha(db, pedido.organizationId, pedido.campanhaId);
  if (!campanha) throw new RecusaDaCampanha("nao_encontrada", "Campanha não encontrada.", 404);
  if (campanha.status !== "rascunho")
    throw new RecusaDaCampanha("ja_confirmada", "Esta campanha já foi confirmada.", 409);

  const conf = await conferirCampanha(db, pedido.organizationId, campanha, {
    agora,
    quando: pedido.quando,
    ritmoPorHora: pedido.ritmoPorHora,
    soDiasUteis: pedido.soDiasUteis,
    amazon: deps.amazon,
  });
  if (conf.travas.length > 0) {
    throw new RecusaDaCampanha("travada", conf.travas.map((t) => t.texto).join(" "), 422, {
      travas: conf.travas,
    });
  }

  // ── os destinatários (refeitos se uma tentativa anterior parou no meio) ──
  await db
    .from("mia_email_destinatarios")
    .delete()
    .eq("organization_id", pedido.organizationId)
    .eq("campanha_id", campanha.id)
    .in("status", ["pendente", "pulado"]);
  const elegiveis = new Set(conf.elegiveis.map((c) => c.contactId));
  const vistos = new Set<string>();
  const linhas: Array<Record<string, unknown>> = [];
  for (const l of conf.publicoMontado.linhas) {
    const c = l.contato;
    if (!c.email) continue;
    const hash = hashDoEmail(c.email);
    if (vistos.has(hash)) continue;
    vistos.add(hash);
    const recebe = !l.motivo && elegiveis.has(c.contactId);
    linhas.push({
      organization_id: pedido.organizationId,
      campanha_id: campanha.id,
      contact_id: c.contactId,
      email: recebe ? c.email : null,
      email_hash: hash,
      status: recebe ? "pendente" : "pulado",
      motivo: recebe ? null : (l.motivo ?? "variavel_sem_dado"),
      medir_abertura: recebe && campanha.base_legal === "consent" && c.medirAbertura,
    });
  }
  for (let i = 0; i < linhas.length; i += 1000) {
    const { error } = await db.from("mia_email_destinatarios").insert(linhas.slice(i, i + 1000));
    if (error) throw new Error(`não consegui gravar os destinatários: ${error.message}`);
  }

  // ── os links congelados ──
  await db
    .from("mia_email_links")
    .delete()
    .eq("organization_id", pedido.organizationId)
    .eq("campanha_id", campanha.id);
  const links = linksDosBlocos(campanha.blocos);
  if (links.length > 0) {
    const { error } = await db
      .from("mia_email_links")
      .insert(
        links.map((l) => ({
          organization_id: pedido.organizationId,
          campanha_id: campanha.id,
          ordem: l.ordem,
          url: l.url,
          rotulo: l.rotulo,
        })),
      );
    if (error) throw new Error(`não consegui congelar os links: ${error.message}`);
  }

  // ── o estado ──
  const agoraMesmo = pedido.quando === "agora";
  const { data, error } = await db
    .from("mia_email_campanhas")
    .update({
      status: agoraMesmo ? "enviando" : "agendada",
      agendada_para: agoraMesmo ? agora.toISOString() : new Date(pedido.quando).toISOString(),
      iniciada_em: agoraMesmo ? agora.toISOString() : null,
      plano: conf.plano,
      total_previsto: conf.total,
      preco_cents: conf.precoCents,
      custo_previsto_cents: conf.custoCents,
      ritmo_por_hora: conf.ritmoPorHora,
      so_dias_uteis: conf.soDiasUteis,
      confirmada_por: pedido.autorId,
      confirmada_em: agora.toISOString(),
      declaracao_base_legal: textoDaDeclaracao(campanha, pedido.autorNome, agora),
      motivo_da_pausa: null,
    })
    .eq("organization_id", pedido.organizationId)
    .eq("id", campanha.id)
    .eq("status", "rascunho")
    .select(COLUNAS)
    .maybeSingle();
  if (error) throw new Error(`não consegui confirmar a campanha: ${error.message}`);
  if (!data)
    throw new RecusaDaCampanha(
      "ja_confirmada",
      "A campanha mudou de estado enquanto você confirmava.",
      409,
    );
  const { publicoMontado: _p, ctx: _c, elegiveis: _e, empresas: _m, ...conferencia } = conf;
  return { campanha: daLinha(data as Record<string, unknown>), conferencia };
}

// ─── os controles ───────────────────────────────────────────────────────────

export async function pausarCampanha(
  db: SupabaseClient,
  orgId: string,
  id: string,
  quem: string,
  agora = new Date(),
): Promise<CampanhaDeEmail> {
  const { data, error } = await db
    .from("mia_email_campanhas")
    .update({
      status: "pausada",
      motivo_da_pausa: `Pausada por ${quem}.`,
      pausada_em: agora.toISOString(),
    })
    .eq("organization_id", orgId)
    .eq("id", id)
    .in("status", ["enviando", "agendada"])
    .select(COLUNAS)
    .maybeSingle();
  if (error) throw new Error(`não consegui pausar: ${error.message}`);
  if (!data) throw new RecusaDaCampanha("estado", "Só campanha agendada ou enviando pausa.", 409);
  return daLinha(data as Record<string, unknown>);
}

/**
 * Retoma a campanha pausada. A pausa pela TRAVA DE SAÚDE só volta com
 * `mesmoAssim`: retomar arrisca a conta da Amazon, que é uma só para todas as
 * empresas, e a tela diz isso antes. O saldo é conferido de novo.
 */
export async function retomarCampanha(
  db: SupabaseClient,
  orgId: string,
  id: string,
  opcoes: { mesmoAssim?: boolean; agora?: Date } = {},
): Promise<CampanhaDeEmail> {
  const c = await lerCampanha(db, orgId, id);
  if (!c) throw new RecusaDaCampanha("nao_encontrada", "Campanha não encontrada.", 404);
  if (c.status !== "pausada")
    throw new RecusaDaCampanha("estado", "Só campanha pausada retoma.", 409);
  if ((c.motivo_da_pausa ?? "").startsWith("trava_de_saude") && !opcoes.mesmoAssim) {
    throw new RecusaDaCampanha(
      "trava_de_saude",
      "A trava parou o envio pela rejeição ou pela reclamação. Retomar arrisca a conta da Amazon: confirme que quer retomar mesmo assim.",
      409,
    );
  }
  const [preco, saldo, pendentes] = await Promise.all([
    lerPrecoPorEmail(db, orgId),
    lerSaldoDaCarteira(db, orgId),
    db
      .from("mia_email_destinatarios")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("campanha_id", id)
      .eq("status", "pendente"),
  ]);
  const precoDaCampanha = c.preco_cents ?? preco.cents;
  if ((pendentes.count ?? 0) > 0 && saldo.saldo_cents < precoDaCampanha) {
    throw new RecusaDaCampanha("saldo", "O crédito acabou: recarregue antes de retomar.", 409);
  }
  const agora = opcoes.agora ?? new Date();
  const voltaPara =
    c.iniciada_em || (c.agendada_para && Date.parse(c.agendada_para) <= agora.getTime())
      ? "enviando"
      : "agendada";
  const { data, error } = await db
    .from("mia_email_campanhas")
    .update({
      status: voltaPara,
      motivo_da_pausa: null,
      pausada_em: null,
      ...(voltaPara === "enviando" && !c.iniciada_em ? { iniciada_em: agora.toISOString() } : {}),
    })
    .eq("organization_id", orgId)
    .eq("id", id)
    .eq("status", "pausada")
    .select(COLUNAS)
    .maybeSingle();
  if (error) throw new Error(`não consegui retomar: ${error.message}`);
  if (!data) throw new RecusaDaCampanha("estado", "A campanha mudou de estado.", 409);
  return daLinha(data as Record<string, unknown>);
}

/**
 * Cancelar o AGENDAMENTO devolve a campanha a rascunho (nada saiu, nada foi
 * cobrado). Cancelar uma campanha PAUSADA a encerra: quem não recebeu fica de
 * fora, com o motivo.
 */
export async function cancelarCampanha(
  db: SupabaseClient,
  orgId: string,
  id: string,
  agora = new Date(),
): Promise<CampanhaDeEmail> {
  const c = await lerCampanha(db, orgId, id);
  if (!c) throw new RecusaDaCampanha("nao_encontrada", "Campanha não encontrada.", 404);
  if (c.status === "agendada" && !c.iniciada_em) {
    await db
      .from("mia_email_destinatarios")
      .delete()
      .eq("organization_id", orgId)
      .eq("campanha_id", id)
      .in("status", ["pendente", "pulado"]);
    await db.from("mia_email_links").delete().eq("organization_id", orgId).eq("campanha_id", id);
    const { data, error } = await db
      .from("mia_email_campanhas")
      .update({
        status: "rascunho",
        plano: null,
        agendada_para: null,
        total_previsto: null,
        custo_previsto_cents: null,
        preco_cents: null,
        confirmada_por: null,
        confirmada_em: null,
        declaracao_base_legal: null,
      })
      .eq("organization_id", orgId)
      .eq("id", id)
      .eq("status", "agendada")
      .select(COLUNAS)
      .maybeSingle();
    if (error) throw new Error(`não consegui cancelar: ${error.message}`);
    if (!data) throw new RecusaDaCampanha("estado", "A campanha mudou de estado.", 409);
    return daLinha(data as Record<string, unknown>);
  }
  if (c.status !== "pausada" && c.status !== "rascunho") {
    throw new RecusaDaCampanha("estado", "Pause a campanha antes de encerrar.", 409);
  }
  await db
    .from("mia_email_destinatarios")
    .update({ status: "pulado", motivo: "campanha_cancelada", email: null })
    .eq("organization_id", orgId)
    .eq("campanha_id", id)
    .eq("status", "pendente");
  const { data, error } = await db
    .from("mia_email_campanhas")
    .update({ status: "cancelada", cancelada_em: agora.toISOString() })
    .eq("organization_id", orgId)
    .eq("id", id)
    .in("status", ["pausada", "rascunho"])
    .select(COLUNAS)
    .maybeSingle();
  if (error) throw new Error(`não consegui cancelar: ${error.message}`);
  if (!data) throw new RecusaDaCampanha("estado", "A campanha mudou de estado.", 409);
  return daLinha(data as Record<string, unknown>);
}

/** Uma campanha nova a partir de um modelo da empresa (o MCP e a tela usam). */
export async function blocosDoModelo(
  db: SupabaseClient,
  orgId: string,
  chave: string,
): Promise<{ assunto: string; pre_cabecalho: string; blocos: BlocoDoEmail[] } | null> {
  const { data, error } = await db
    .from("mia_email_modelos")
    .select("assunto, pre_cabecalho, blocos")
    .eq("organization_id", orgId)
    .eq("chave", chave)
    .maybeSingle();
  if (error) throw new Error(`modelo: ${error.message}`);
  if (!data) return null;
  const d = data as Record<string, unknown>;
  const blocos = blocosSchema.safeParse(d.blocos);
  return {
    assunto: String(d.assunto ?? ""),
    pre_cabecalho: String(d.pre_cabecalho ?? ""),
    blocos: blocos.success ? blocos.data : [],
  };
}

/** Um id de bloco novo, curto. */
export function idDeBloco(): string {
  return `b${randomUUID().slice(0, 8)}`;
}
