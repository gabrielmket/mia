/**
 * FORK MIA — a linha de `mia_leads_da_meta_formularios` como os dois caminhos
 * a leem: a rodada de 5 em 5 minutos (`rodada.ts`) e o aviso em tempo real
 * (`tempo-real.ts`, .62). Um lugar só para as colunas e para a tradução em
 * `FormularioParaGravar`: com duas cópias, a escolha manual do telefone valeria
 * num caminho e não no outro, e o mesmo lead entraria com contato diferente
 * dependendo de quem chegou primeiro.
 */
import type { FormularioParaGravar } from "./gravar";

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
  /** .62: a pergunta escolhida para cada papel. Nulo = automático. */
  campo_telefone?: string | null;
  campo_nome?: string | null;
  campo_email?: string | null;
  /** .62: leituras com erro seguidas, e o motivo já avisado aos administradores. */
  falhas_seguidas?: number | null;
  aviso_de_falha_motivo?: string | null;
  /** .62: a Página assinada no app para o aviso em tempo real. */
  tempo_real?: string | null;
  tempo_real_em?: string | null;
}

/** As colunas que os dois caminhos leem. */
export const COLUNAS_DO_FORMULARIO =
  "id, organization_id, page_id, page_name, form_id, form_name, perguntas, pipeline_id, stage_id, lido_ate, importados_total, campo_telefone, campo_nome, campo_email, falhas_seguidas, aviso_de_falha_motivo, tempo_real, tempo_real_em";

/** A linha → o que `gravarLeadDaMeta` precisa. Só com funil e etapa: sem eles não há onde gravar. */
export function paraGravar(
  linha: LinhaDoFormulario & { pipeline_id: string; stage_id: string },
): FormularioParaGravar {
  return {
    id: linha.id,
    organizationId: linha.organization_id,
    formId: linha.form_id,
    formName: linha.form_name,
    pageId: linha.page_id,
    pageName: linha.page_name,
    pipelineId: linha.pipeline_id,
    stageId: linha.stage_id,
    perguntas: linha.perguntas ?? {},
    campos: {
      telefone: linha.campo_telefone ?? null,
      nome: linha.campo_nome ?? null,
      email: linha.campo_email ?? null,
    },
  };
}
