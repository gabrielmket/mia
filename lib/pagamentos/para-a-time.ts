/**
 * FORK MIA (MIA-19) · O LINK DE PAGAMENTO NA CONVERSA VISTO PELA TIME (MCP de
 * plataforma). Só leitura.
 *
 * O recebimento do cliente final (upstream #3509, migration 9312) liga e
 * desliga só pela INSTALAÇÃO (`MODULO_LINK_DE_PAGAMENTO`, /admin/sistema), para
 * todas as empresas de uma vez. Não há chave por empresa nem "conta que
 * recebe": a atendente cria o link no aplicativo do provedor e cola nele o
 * endereço de aviso. A escrita por empresa espera o gateway por organização do
 * upstream (#4093) entrar pela fusão.
 *
 * O que sai: se o módulo da instalação está ligado, os provedores que este
 * degrau conhece, quantos recebimentos a empresa tem em cada situação e quando
 * foi o último pago. O que NÃO sai: o endereço de aviso, o hash do segredo
 * (`aviso_token_hash`), o id do pagamento no provedor e o valor de cada
 * recebimento, que é dinheiro do cliente da empresa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { moduloLigado } from "@/lib/instalacao/modulos";

import { NOME_DO_PROVEDOR, PROVEDORES_DE_RECEBIMENTO, SITUACOES_DO_RECEBIMENTO, type SituacaoDoRecebimento } from "./vocabulario";

export interface LinkDePagamentoParaATime {
  /** O módulo da INSTALAÇÃO (/admin/sistema). Vale para todas as empresas. */
  modulo_da_instalacao_ligado: boolean;
  /** Quem liga e desliga: a instalação, não a empresa. */
  quem_liga: "instalacao";
  provedores: Array<{ chave: string; nome: string }>;
  /** Quantos recebimentos a empresa tem em cada situação. `"nao_lido"` = a leitura falhou. */
  recebimentos_por_situacao: Record<SituacaoDoRecebimento, number> | "nao_lido";
  /** Quando foi o último recebimento pago. `null` = nenhum; `"nao_lido"` = a leitura falhou. */
  ultimo_pago_em: string | null | "nao_lido";
}

/**
 * Conta por situação com `head: true`: a soma é do banco, e não de uma lista
 * que o teto de linhas do PostgREST cortaria em 1000.
 */
async function contarPorSituacao(admin: SupabaseClient, orgId: string): Promise<Record<SituacaoDoRecebimento, number> | "nao_lido"> {
  const contagens = await Promise.all(
    SITUACOES_DO_RECEBIMENTO.map(async (situacao) => {
      const { count, error } = await admin
        .from("pagamento_recebimentos")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("status", situacao);
      return error || typeof count !== "number" ? null : ([situacao, count] as const);
    }),
  );
  if (contagens.some((c) => c === null)) return "nao_lido";
  return Object.fromEntries(contagens as Array<readonly [SituacaoDoRecebimento, number]>) as Record<SituacaoDoRecebimento, number>;
}

async function ultimoPagoEm(admin: SupabaseClient, orgId: string): Promise<string | null | "nao_lido"> {
  const { data, error } = await admin
    .from("pagamento_recebimentos")
    .select("pago_em")
    .eq("organization_id", orgId)
    .eq("status", "paga")
    // No Postgres o `desc` põe o nulo primeiro: um pago sem data esconderia o último pago de verdade.
    .not("pago_em", "is", null)
    .order("pago_em", { ascending: false })
    .limit(1);
  if (error) return "nao_lido";
  const linha = ((data ?? []) as Array<{ pago_em: string | null }>)[0];
  return linha?.pago_em ?? null;
}

/** O link de pagamento da empresa para o retrato do cliente. Leitura que falha diz "nao_lido"; não lança. */
export async function linkDePagamentoParaATime(admin: SupabaseClient, orgId: string): Promise<LinkDePagamentoParaATime> {
  const [ligado, recebimentos, ultimo] = await Promise.all([
    moduloLigado(admin, "link_de_pagamento"),
    contarPorSituacao(admin, orgId).catch(() => "nao_lido" as const),
    ultimoPagoEm(admin, orgId).catch(() => "nao_lido" as const),
  ]);
  return {
    modulo_da_instalacao_ligado: ligado,
    quem_liga: "instalacao",
    provedores: PROVEDORES_DE_RECEBIMENTO.map((chave) => ({ chave, nome: NOME_DO_PROVEDOR[chave] })),
    recebimentos_por_situacao: recebimentos,
    ultimo_pago_em: ultimo,
  };
}
