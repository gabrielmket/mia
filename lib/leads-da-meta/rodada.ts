/**
 * FORK MIA — UMA RODADA da importação dos leads da Meta, para todas as empresas
 * com a chave ligada (a rotina de 5 em 5 minutos) ou para uma só ("Ler agora").
 *
 * ─── O que cada rodada faz, por empresa ────────────────────────────────────
 *
 *   1. confere a chave (e o módulo, se ele virar venda: `modulo.ts`);
 *   2. decifra o token de leitura da empresa (o de Configurações › Meta Ads);
 *   3. lista as Páginas do token, cada uma com o token da Página;
 *   4. para cada formulário ativo, lê as janelas que faltam até o presente, grava
 *      do lead mais antigo para o mais novo e só então avança a marca de leitura;
 *   5. registra a leitura no histórico — sucesso, sem novos ou erro com motivo;
 *   6. se entrou lead, drena o `event_log` na hora (automações de "lead criado"),
 *      como a rota do webhook faz.
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
import { lerCredencialDeLeitura } from "@/lib/plataformas-de-anuncio/credenciais-de-leitura";
import {
  listarPaginas,
  lerLeadsDoFormulario,
  type PaginaDoToken,
} from "@/lib/plataformas-de-anuncio/meta/leads";

import { gravarLeadDaMeta, type FormularioParaGravar } from "./gravar";
import { leadsDaMetaLiberados } from "./liberacao";
import { janelaDeLeitura, lerLeadCru, type JanelaDeLeitura, type LeadDaMeta } from "./mapear";
import type { MotivoDaLeitura, StatusDaLeitura } from "./motivos";

/** Janelas por formulário numa rodada: 13 × 7 dias alcança os 90 da Meta. */
const JANELAS_POR_RODADA = 13;
/** Quantas vezes a janela se divide ao meio quando vem cheia demais. */
const DIVISOES_DA_JANELA = 4;
const DIAS_DO_HISTORICO = 30;
const DIAS_DOS_RECEBIDOS = 120;
const DIA = 24 * 60 * 60 * 1000;

export interface LinhaDoFormulario {
  id: string;
  organization_id: string;
  page_id: string;
  page_name: string | null;
  form_id: string;
  form_name: string | null;
  perguntas: Record<string, string> | null;
  pipeline_id: string | null;
  stage_id: string | null;
  lido_ate: string | null;
  importados_total: number | null;
}

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

/**
 * Grava o desfecho no formulário (a "última leitura" da tela) e no histórico.
 *
 * Leituras seguidas com o mesmo desfecho que NÃO é sucesso (sem novos; o mesmo
 * erro) viram uma linha só, com `repeticoes`: 288 linhas de "sem novos" por dia
 * esconderiam o erro que importa no meio do ruído.
 */
async function registrarLeitura(
  admin: SupabaseClient,
  formulario: LinhaDoFormulario,
  leitura: Leitura,
  iniciadaEm: Date,
): Promise<void> {
  const agora = new Date().toISOString();

  const { error: erroForm } = await admin
    .from("mia_leads_da_meta_formularios")
    .update({
      ultima_leitura_em: agora,
      ultimo_status: leitura.status,
      ultimo_motivo: leitura.motivo,
      ultimo_detalhe: leitura.detalhe,
      importados_total: (formulario.importados_total ?? 0) + leitura.novos,
      ...(leitura.lidoAte ? { lido_ate: leitura.lidoAte.toISOString() } : {}),
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
      return;
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

  const paraGravar: FormularioParaGravar = {
    id: formulario.id,
    organizationId: formulario.organization_id,
    formId: formulario.form_id,
    formName: formulario.form_name,
    pageId: formulario.page_id,
    pageName: formulario.page_name,
    pipelineId: formulario.pipeline_id,
    stageId: formulario.stage_id,
    perguntas: formulario.perguntas ?? {},
  };

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
        const r = await gravarLeadDaMeta(admin, paraGravar, lead, { requestId });
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

    const { data: linhas, error: erroForms } = await admin
      .from("mia_leads_da_meta_formularios")
      .select(
        "id, organization_id, page_id, page_name, form_id, form_name, perguntas, pipeline_id, stage_id, lido_ate, importados_total",
      )
      .eq("organization_id", org)
      .eq("ativo", true);
    if (erroForms) {
      logger.error("[leads-da-meta] formulários não lidos", {
        organization_id: org,
        detalhe: erroForms.message,
      });
      continue;
    }
    const formularios = (linhas ?? []) as LinhaDoFormulario[];
    if (formularios.length === 0) continue;
    resumo.empresas += 1;

    const registrarTodos = async (leitura: Leitura) => {
      for (const f of formularios) {
        const iniciada = new Date();
        await registrarLeitura(admin, f, leitura, iniciada);
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

    const credencial = await lerCredencialDeLeitura(admin, org, "meta_ads");
    if (!credencial.ok) {
      await registrarTodos(erro(credencial.motivo));
      continue;
    }
    const paginas = await listarPaginas(credencial.credencial.accessToken);
    if (!paginas.ok) {
      await registrarTodos(erro(paginas.falha, paginas.detalhe));
      continue;
    }
    const porId = new Map(paginas.dados.map((p) => [p.id, p]));

    let novosNaEmpresa = 0;
    for (const formulario of formularios) {
      const iniciada = new Date();
      let leitura: Leitura;
      try {
        leitura = await lerFormulario(
          admin,
          formulario,
          config.dias_de_recuperacao ?? 7,
          porId,
          agora,
          opcoes.requestId,
        );
      } catch (e) {
        leitura = erro("erro_ao_gravar", e instanceof Error ? e.message.slice(0, 300) : null);
      }
      await registrarLeitura(admin, formulario, leitura, iniciada);
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
    }

    // Os `lead.created` saem da fila agora, e não no próximo minuto: é o que faz
    // a automação de primeiro contato disparar junto com a chegada do lead.
    if (novosNaEmpresa > 0) await kickLocalPipeline(admin);
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
