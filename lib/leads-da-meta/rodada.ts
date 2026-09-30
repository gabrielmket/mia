/**
 * FORK MIA — UMA RODADA da importação dos leads da Meta, para todas as empresas
 * com a chave ligada (a rotina de 5 em 5 minutos) ou para uma só ("Ler agora").
 *
 * ─── O que cada rodada faz, por empresa ────────────────────────────────────
 *
 *   1. confere a chave (e o módulo, se ele virar venda: `modulo.ts`);
 *   2. confere que a Página de cada formulário é DESTA empresa (9004, `paginas.ts`);
 *      o que não é vira erro no histórico, sem chamar a Meta;
 *   3. acha o token de cada Página dela: pelo token da própria empresa (o de
 *      Configurações › Meta Ads) ou, sem ele, pela conexão da plataforma. Página
 *      que o token alcança e não é da empresa não entra;
 *   4. para cada formulário ativo, lê as janelas que faltam até o presente, grava
 *      do lead mais antigo para o mais novo e só então avança a marca de leitura;
 *   5. registra a leitura no histórico — sucesso, sem novos ou erro com motivo;
 *   6. se entrou lead, drena o `event_log` na hora (automações de "lead criado"),
 *      como a rota do webhook faz.
 *
 * E, da .62 em diante:
 *
 *   7. conta as falhas seguidas de cada formulário e, na terceira, avisa os
 *      administradores na Central e no celular, UMA vez por problema; a
 *      primeira leitura boa fecha o aviso (`aviso-de-falha.ts`);
 *   8. confere a assinatura da Página no app para o aviso em tempo real
 *      (`assinatura.ts`): tenta no formulário que nunca tentou, revê a recusa
 *      depois de algumas horas e a assinatura uma vez por dia.
 *
 * O aviso em tempo real (`tempo-real.ts`) grava pela mesma `gravarLeadDaMeta`,
 * e esta rodada continua lendo tudo: é a rede de segurança do que o webhook
 * perder, e a deduplicação pelo id do lead faz os dois caminhos convivirem.
 *
 * ─── A marca de leitura só anda para a frente, e só quando tudo deu certo ───
 *
 * Qualquer falha (Meta recusou, banco caiu no meio) deixa `lido_ate` onde estava.
 * A leitura seguinte relê a mesma janela e a deduplicação pelo id do lead faz a
 * repetição ser segura. É isto que transforma "o servidor ficou fora do ar um
 * dia" em "a próxima leitura busca o que faltou" — até os 90 dias da Meta.
 *
 * ─── Nenhuma empresa derruba a outra ──────────────────────────────────────
 *
 * Cada formulário tem o seu try; o erro vira linha no histórico dele e a rodada
 * segue. Uma empresa com token vencido não pode atrasar os leads das outras.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { kickLocalPipeline } from "@/lib/dev/kick-local-pipeline";
import { logger } from "@/lib/logger";
import { lerLeadsDoFormulario, type PaginaDoToken } from "@/lib/plataformas-de-anuncio/meta/leads";

import { gravarTempoReal, ligarTempoReal, precisaConferirTempoReal } from "./assinatura";
import {
  abrirAviso,
  avisarAdministradores,
  decidirAviso,
  fecharAvisos,
  fecharAvisosSemLeitura,
  type AvisoNovo,
} from "./aviso-de-falha";
import { COLUNAS_DO_FORMULARIO, paraGravar, type LinhaDoFormulario } from "./formulario";
import { gravarLeadDaMeta } from "./gravar";
import { leadsDaMetaLiberados } from "./liberacao";
import { janelaDeLeitura, lerLeadCru, type JanelaDeLeitura, type LeadDaMeta } from "./mapear";
import type { MotivoDaLeitura, StatusDaLeitura } from "./motivos";
import {
  acessoAsPaginas,
  existeAcessoDeLeitura,
  paginasDaEmpresa,
  type OrigemDoAcesso,
  type PaginaAtribuida,
} from "./paginas";

export type { LinhaDoFormulario } from "./formulario";

/** Janelas por formulário numa rodada: 13 × 7 dias alcança os 90 da Meta. */
const JANELAS_POR_RODADA = 13;
/** Quantas vezes a janela se divide ao meio quando vem cheia demais. */
const DIVISOES_DA_JANELA = 4;
const DIAS_DO_HISTORICO = 30;
const DIAS_DOS_RECEBIDOS = 120;
const DIA = 24 * 60 * 60 * 1000;

export interface ResultadoDoFormulario {
  formularioId: string;
  organizationId: string;
  status: StatusDaLeitura;
  motivo: MotivoDaLeitura | null;
  novos: number;
  repetidos: number;
  recusados: number;
}

export interface ResumoDaRodada {
  empresas: number;
  formularios: number;
  novos: number;
  repetidos: number;
  recusados: number;
  erros: number;
  porFormulario: ResultadoDoFormulario[];
}

interface Contagem {
  novos: number;
  repetidos: number;
  recusados: number;
}

interface Leitura extends Contagem {
  status: StatusDaLeitura;
  motivo: MotivoDaLeitura | null;
  detalhe: string | null;
  janela: { de: Date; ate: Date } | null;
  /** A nova marca de leitura, quando ela avança. */
  lidoAte: Date | null;
}

// ─── o histórico ────────────────────────────────────────────────────────────

/** De onde vem o token da empresa, perguntado só quando um aviso vai abrir. */
type OrigemPreguicosa = () => Promise<OrigemDoAcesso | null>;

/**
 * FORK MIA (.62) — o aviso aos administradores depois desta leitura.
 *
 * Devolve as colunas do aviso a gravar no formulário, junto com a última
 * leitura, e o aviso NOVO (para o push, que sai um por empresa por rodada).
 */
async function sincronizarAviso(
  admin: SupabaseClient,
  formulario: LinhaDoFormulario,
  leitura: Leitura,
  origem: OrigemPreguicosa,
  agora: string,
): Promise<{ colunas: Record<string, unknown>; novo: AvisoNovo | null }> {
  const falhas = leitura.status === "erro" ? (formulario.falhas_seguidas ?? 0) + 1 : 0;
  const jaAvisado = formulario.aviso_de_falha_motivo ?? null;
  const acao = decidirAviso({
    status: leitura.status,
    motivo: leitura.motivo,
    falhasSeguidas: falhas,
    motivoJaAvisado: jaAvisado,
  });

  if (acao === "limpar") {
    await fecharAvisos(admin, formulario.organization_id, [formulario.id]);
    return {
      colunas: { falhas_seguidas: 0, aviso_de_falha_motivo: null, aviso_de_falha_em: null },
      novo: null,
    };
  }
  if (acao === "avisar" || acao === "trocar") {
    if (acao === "trocar") await fecharAvisos(admin, formulario.organization_id, [formulario.id]);
    const abriu = await abrirAviso(admin, formulario, leitura.motivo, await origem());
    const motivo = leitura.motivo ?? "desconhecido";
    return {
      // Gravado mesmo quando outra rodada abriu primeiro (`abriu` falso): o
      // problema está avisado, e é isso que a coluna diz.
      colunas: { falhas_seguidas: falhas, aviso_de_falha_motivo: motivo, aviso_de_falha_em: agora },
      novo: abriu
        ? { formName: formulario.form_name ?? formulario.form_id, motivo: leitura.motivo }
        : null,
    };
  }
  return { colunas: { falhas_seguidas: falhas }, novo: null };
}

/**
 * Grava o desfecho no formulário (a "última leitura" da tela) e no histórico.
 *
 * Leituras seguidas com o mesmo desfecho que NÃO é sucesso (sem novos; o mesmo
 * erro) viram uma linha só, com `repeticoes`: 288 linhas de "sem novos" por dia
 * esconderiam o erro que importa no meio do ruído.
 *
 * .62: e conta as falhas seguidas, abrindo ou fechando o aviso aos
 * administradores (`sincronizarAviso`). Devolve o aviso novo, se abriu um.
 */
async function registrarLeitura(
  admin: SupabaseClient,
  formulario: LinhaDoFormulario,
  leitura: Leitura,
  iniciadaEm: Date,
  // O relógio da rodada, não o do sistema: com o do sistema, duas leituras no
  // mesmo milésimo empatavam em terminada_em e a "última" podia ser a errada.
  relogio: Date,
  origem: OrigemPreguicosa,
): Promise<AvisoNovo | null> {
  const agora = relogio.toISOString();

  const aviso = await sincronizarAviso(admin, formulario, leitura, origem, agora);

  const { error: erroForm } = await admin
    .from("mia_leads_da_meta_formularios")
    .update({
      ultima_leitura_em: agora,
      ultimo_status: leitura.status,
      ultimo_motivo: leitura.motivo,
      ultimo_detalhe: leitura.detalhe,
      importados_total: (formulario.importados_total ?? 0) + leitura.novos,
      ...(leitura.lidoAte ? { lido_ate: leitura.lidoAte.toISOString() } : {}),
      ...aviso.colunas,
    })
    .eq("id", formulario.id)
    .eq("organization_id", formulario.organization_id);
  if (erroForm) {
    logger.error("[leads-da-meta] última leitura não gravada", {
      formulario_id: formulario.id,
      detalhe: erroForm.message,
    });
  }

  if (leitura.status !== "sucesso") {
    const { data: ultima } = await admin
      .from("mia_leads_da_meta_leituras")
      .select("id, status, motivo, repeticoes")
      .eq("organization_id", formulario.organization_id)
      .eq("formulario_id", formulario.id)
      .order("terminada_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    const anterior = ultima as {
      id: string;
      status: string;
      motivo: string | null;
      repeticoes: number;
    } | null;
    if (
      anterior &&
      anterior.status === leitura.status &&
      (anterior.motivo ?? null) === leitura.motivo
    ) {
      await admin
        .from("mia_leads_da_meta_leituras")
        .update({
          terminada_em: agora,
          repeticoes: (anterior.repeticoes ?? 1) + 1,
          detalhe: leitura.detalhe,
          janela_ate: leitura.janela?.ate.toISOString() ?? null,
        })
        .eq("id", anterior.id)
        .eq("organization_id", formulario.organization_id);
      return aviso.novo;
    }
  }

  const { error } = await admin.from("mia_leads_da_meta_leituras").insert({
    organization_id: formulario.organization_id,
    formulario_id: formulario.id,
    iniciada_em: iniciadaEm.toISOString(),
    terminada_em: agora,
    status: leitura.status,
    novos: leitura.novos,
    repetidos: leitura.repetidos,
    recusados: leitura.recusados,
    motivo: leitura.motivo,
    detalhe: leitura.detalhe,
    janela_de: leitura.janela?.de.toISOString() ?? null,
    janela_ate: leitura.janela?.ate.toISOString() ?? null,
  });
  if (error) {
    logger.error("[leads-da-meta] histórico da leitura não gravado", {
      formulario_id: formulario.id,
      detalhe: error.message,
    });
  }
  return aviso.novo;
}

function erro(
  motivo: MotivoDaLeitura,
  detalhe: string | null = null,
  janela: Leitura["janela"] = null,
): Leitura {
  return {
    status: "erro",
    motivo,
    detalhe,
    janela,
    lidoAte: null,
    novos: 0,
    repetidos: 0,
    recusados: 0,
  };
}

// ─── um formulário ──────────────────────────────────────────────────────────

/**
 * Lê UMA janela, dividindo-a ao meio quando vem cheia demais (mais que o teto de
 * páginas). Devolve a janela efetivamente lida — que pode ser menor que a pedida.
 */
async function lerJanela(
  tokenDaPagina: string,
  formId: string,
  pedida: JanelaDeLeitura,
): Promise<
  | { ok: true; leads: LeadDaMeta[]; janela: { de: Date; ate: Date }; aviso?: string }
  | { ok: false; leitura: Leitura }
> {
  let ate = pedida.ate;
  for (let divisao = 0; divisao <= DIVISOES_DA_JANELA; divisao += 1) {
    const janela = { de: pedida.de, ate };
    const r = await lerLeadsDoFormulario(tokenDaPagina, formId, janela);
    if (!r.ok) return { ok: false, leitura: erro(r.falha, r.detalhe, janela) };
    if (!r.dados.truncado) {
      const leads = r.dados.leads
        .map(lerLeadCru)
        .filter((l): l is LeadDaMeta => l !== null)
        .sort((a, b) => (a.criadoEm?.getTime() ?? 0) - (b.criadoEm?.getTime() ?? 0));
      return { ok: true, leads, janela, aviso: r.aviso };
    }
    ate = new Date(pedida.de.getTime() + (ate.getTime() - pedida.de.getTime()) / 2);
  }
  return {
    ok: false,
    leitura: erro(
      "volume_acima_do_limite",
      "Mesmo dividindo o período, a Meta devolveu mais leads do que uma leitura comporta.",
      { de: pedida.de, ate },
    ),
  };
}

async function lerFormulario(
  admin: SupabaseClient,
  formulario: LinhaDoFormulario,
  diasDeRecuperacao: number,
  paginas: Map<string, PaginaDoToken>,
  agora: Date,
  requestId: string,
): Promise<Leitura> {
  if (!formulario.pipeline_id || !formulario.stage_id) return erro("sem_funil");
  const pagina = paginas.get(formulario.page_id);
  if (!pagina) return erro("pagina_nao_atribuida");
  if (!pagina.tokenDaPagina) return erro("sem_token_da_pagina");

  // .62: a mesma tradução do aviso em tempo real, com a escolha do telefone.
  const destino = paraGravar({
    ...formulario,
    pipeline_id: formulario.pipeline_id,
    stage_id: formulario.stage_id,
  });

  const total: Contagem = { novos: 0, repetidos: 0, recusados: 0 };
  let lidoAte = formulario.lido_ate ? new Date(formulario.lido_ate) : null;
  let primeira: Date | null = null;
  let ultima: Date | null = null;
  let aviso: string | undefined;
  let cortada = false;

  for (let i = 0; i < JANELAS_POR_RODADA; i += 1) {
    const pedida = janelaDeLeitura({ lidoAte, diasDeRecuperacao, agora });
    cortada ||= pedida.recuperacaoCortada;
    const lida = await lerJanela(pagina.tokenDaPagina, formulario.form_id, pedida);
    if (!lida.ok) {
      // O que já foi lido nesta rodada fica: a marca avançou até a última janela boa.
      return { ...lida.leitura, ...total, lidoAte, janela: lida.leitura.janela };
    }
    aviso ??= lida.aviso;
    primeira ??= lida.janela.de;
    ultima = lida.janela.ate;

    for (const lead of lida.leads) {
      try {
        const r = await gravarLeadDaMeta(admin, destino, lead, { requestId, via: "consulta" });
        if (r.desfecho === "criado") total.novos += 1;
        else if (r.desfecho === "repetido") total.repetidos += 1;
        else if (r.desfecho === "recusado") total.recusados += 1;
      } catch (e) {
        const detalhe = e instanceof Error ? e.message.slice(0, 300) : "erro desconhecido";
        logger.error("[leads-da-meta] gravação interrompida", {
          formulario_id: formulario.id,
          organization_id: formulario.organization_id,
          detalhe,
        });
        return {
          ...erro("erro_ao_gravar", detalhe, {
            de: primeira ?? lida.janela.de,
            ate: lida.janela.ate,
          }),
          ...total,
          lidoAte,
        };
      }
    }

    lidoAte = lida.janela.ate;
    // Janela dividida por volume: a próxima volta da marca nova, na mesma rodada.
    if (lida.janela.ate.getTime() >= agora.getTime()) break;
  }

  const houveLead = total.novos + total.repetidos + total.recusados > 0;
  const motivo: MotivoDaLeitura | null = aviso
    ? "sem_origem_do_anuncio"
    : cortada
      ? "recuperacao_cortada"
      : null;
  return {
    status: houveLead ? "sucesso" : "sem_novos",
    motivo,
    detalhe: aviso ?? null,
    janela: primeira && ultima ? { de: primeira, ate: ultima } : null,
    lidoAte,
    ...total,
  };
}

// ─── uma empresa ────────────────────────────────────────────────────────────

interface Empresa {
  org: string;
  diasDeRecuperacao: number;
  agora: Date;
  requestId: string;
  resumo: ResumoDaRodada;
  /** .62: os avisos de falha abertos nesta rodada, para UM push no fim. */
  avisos: AvisoNovo[];
}

async function rodarEmpresa(admin: SupabaseClient, e: Empresa): Promise<void> {
  const { org, agora, resumo } = e;

  const { data: linhas, error: erroForms } = await admin
    .from("mia_leads_da_meta_formularios")
    .select(COLUNAS_DO_FORMULARIO)
    .eq("organization_id", org)
    .eq("ativo", true);
  if (erroForms) {
    logger.error("[leads-da-meta] formulários não lidos", {
      organization_id: org,
      detalhe: erroForms.message,
    });
    return;
  }
  const formularios = (linhas ?? []) as unknown as LinhaDoFormulario[];

  // .62: aviso de formulário que já não é lido (desligado pela empresa, ou pelo
  // banco quando a Página mudou de dono) não tem leitura que o feche. Fecha aqui.
  await fecharAvisosSemLeitura(
    admin,
    org,
    formularios.map((f) => f.id),
  );
  if (formularios.length === 0) return;
  resumo.empresas += 1;

  // A origem do token só é perguntada quando um aviso vai abrir, e uma vez.
  let origemLida: Promise<OrigemDoAcesso | null> | null = null;
  const origem: OrigemPreguicosa = () =>
    (origemLida ??= existeAcessoDeLeitura(admin, org)
      .then((r) => r.origem)
      .catch(() => null));

  const registrar = async (f: LinhaDoFormulario, leitura: Leitura, iniciada: Date) => {
    const novo = await registrarLeitura(admin, f, leitura, iniciada, agora, origem);
    if (novo) e.avisos.push(novo);
  };

  const registrarTodos = async (alvo: LinhaDoFormulario[], leitura: Leitura) => {
    for (const f of alvo) {
      await registrar(f, leitura, new Date());
      resumo.formularios += 1;
      resumo.erros += 1;
      resumo.porFormulario.push({
        formularioId: f.id,
        organizationId: org,
        status: leitura.status,
        motivo: leitura.motivo,
        novos: 0,
        repetidos: 0,
        recusados: 0,
      });
    }
  };

  // FORK MIA (.61) — a Página tem de ser DESTA empresa (9004). O banco já não
  // deixa gravar formulário ativo de Página alheia; a conferência de novo aqui
  // é a que decide, antes de qualquer chamada à Meta, e o formulário que não
  // passa fica no histórico com o motivo, em vez de sumir calado.
  let atribuidas: PaginaAtribuida[];
  try {
    atribuidas = await paginasDaEmpresa(admin, org);
  } catch (erroDasPaginas) {
    logger.error("[leads-da-meta] Páginas da empresa não lidas", {
      organization_id: org,
      detalhe: erroDasPaginas instanceof Error ? erroDasPaginas.message : String(erroDasPaginas),
    });
    return;
  }
  const daEmpresa = new Set(atribuidas.map((p) => p.page_id));
  const alheios = formularios.filter((f) => !daEmpresa.has(f.page_id));
  const proprios = formularios.filter((f) => daEmpresa.has(f.page_id));
  await registrarTodos(alheios, erro("pagina_nao_e_da_empresa"));
  if (proprios.length === 0) return;

  // O token da própria empresa, senão o da plataforma, e SÓ para as Páginas dela.
  const acesso = await acessoAsPaginas(admin, org, atribuidas);
  if (!acesso.ok) {
    await registrarTodos(proprios, erro(acesso.motivo, acesso.detalhe));
    return;
  }
  const porId = acesso.paginas;
  // .62: a assinatura é da PÁGINA; cada uma é conferida uma vez por rodada.
  const paginasConferidas = new Set<string>();

  let novosNaEmpresa = 0;
  for (const formulario of proprios) {
    const iniciada = new Date();
    let leitura: Leitura;
    try {
      leitura = await lerFormulario(
        admin,
        formulario,
        e.diasDeRecuperacao,
        porId,
        agora,
        e.requestId,
      );
    } catch (falha) {
      leitura = erro("erro_ao_gravar", falha instanceof Error ? falha.message.slice(0, 300) : null);
    }
    await registrar(formulario, leitura, iniciada);
    resumo.formularios += 1;
    resumo.novos += leitura.novos;
    resumo.repetidos += leitura.repetidos;
    resumo.recusados += leitura.recusados;
    if (leitura.status === "erro") resumo.erros += 1;
    novosNaEmpresa += leitura.novos;
    resumo.porFormulario.push({
      formularioId: formulario.id,
      organizationId: org,
      status: leitura.status,
      motivo: leitura.motivo,
      novos: leitura.novos,
      repetidos: leitura.repetidos,
      recusados: leitura.recusados,
    });

    // .62: a Página assinada no app para o aviso em tempo real. Tenta no
    // formulário que nunca tentou (ligado antes da .62), revê a recusa depois de
    // algumas horas e a assinatura uma vez por dia (`assinatura.ts`).
    const pagina = porId.get(formulario.page_id);
    if (
      pagina?.tokenDaPagina &&
      !paginasConferidas.has(formulario.page_id) &&
      precisaConferirTempoReal(formulario, agora)
    ) {
      paginasConferidas.add(formulario.page_id);
      const colunas = await ligarTempoReal(pagina.tokenDaPagina, formulario.page_id, agora);
      await gravarTempoReal(admin, org, formulario.page_id, colunas);
    }
  }

  // Os `lead.created` saem da fila agora, e não no próximo minuto: é o que faz
  // a automação de primeiro contato disparar junto com a chegada do lead.
  if (novosNaEmpresa > 0) await kickLocalPipeline(admin);
}

// ─── a rodada ───────────────────────────────────────────────────────────────

export interface OpcoesDaRodada {
  requestId: string;
  agora?: Date;
  /** Só esta empresa ("Ler agora"). Sem ela, todas com a chave ligada. */
  organizationId?: string;
}

export async function rodarLeadsDaMeta(
  admin: SupabaseClient,
  opcoes: OpcoesDaRodada,
): Promise<ResumoDaRodada> {
  const agora = opcoes.agora ?? new Date();
  const resumo: ResumoDaRodada = {
    empresas: 0,
    formularios: 0,
    novos: 0,
    repetidos: 0,
    recusados: 0,
    erros: 0,
    porFormulario: [],
  };

  let consulta = admin
    .from("mia_leads_da_meta_config")
    .select("organization_id, dias_de_recuperacao")
    .eq("ativo", true);
  if (opcoes.organizationId) consulta = consulta.eq("organization_id", opcoes.organizationId);
  const { data: configs, error } = await consulta;
  if (error) throw new Error(`leitura da configuração falhou: ${error.message}`);

  for (const config of (configs ?? []) as Array<{
    organization_id: string;
    dias_de_recuperacao: number;
  }>) {
    const org = config.organization_id;
    if (!(await leadsDaMetaLiberados(admin, org))) continue;

    const avisos: AvisoNovo[] = [];
    await rodarEmpresa(admin, {
      org,
      diasDeRecuperacao: config.dias_de_recuperacao ?? 7,
      agora,
      requestId: opcoes.requestId,
      resumo,
      avisos,
    });
    // .62: UM push por empresa por rodada, com todos os formulários que pararam.
    await avisarAdministradores(admin, org, avisos);
  }

  // A poda vai só na rodada geral (a do relógio), nunca no "Ler agora".
  if (!opcoes.organizationId) {
    await admin
      .from("mia_leads_da_meta_leituras")
      .delete()
      .lt("terminada_em", new Date(agora.getTime() - DIAS_DO_HISTORICO * DIA).toISOString());
    await admin
      .from("mia_leads_da_meta_recebidos")
      .delete()
      .lt("recebido_em", new Date(agora.getTime() - DIAS_DOS_RECEBIDOS * DIA).toISOString());
  }

  return resumo;
}
