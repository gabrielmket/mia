/**
 * FORK MIA (.96) · O PASSO DO PAGAMENTO VISTO PELA TIME (MCP de plataforma).
 *
 * `plataforma_listar_clientes` filtra quem espera o primeiro pagamento, com a
 * forma escolhida e desde quando; `plataforma_ver_cliente` mostra o passo
 * inteiro: o modo (entrada paga ou teste), a situação (Pix gerado, boleto em
 * compensação, cartão recusado, pago...), a cobrança no Asaas, as datas e os
 * dados fiscais RESUMIDOS (o documento mascarado). Só lê; nada do cartão além
 * do final e da bandeira.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { documentoMascarado } from "@/lib/dados-fiscais/regras";

import { lerPassoDoPagamento, lerLinha } from "./servico";

export interface EsperandoOPagamento {
  organization_id: string;
  forma: string | null;
  situacao: string;
  modo: string;
  /** Desde quando: a cobrança gerada, ou o cadastro. */
  desde: string | null;
  /** O teste acabou sem a primeira mensalidade paga (9122). */
  fim_do_teste: boolean;
}

/** As empresas que esperam o primeiro pagamento, com a linha do passo. LANÇA na falha. */
export async function empresasEsperandoOPrimeiroPagamento(admin: SupabaseClient): Promise<Map<string, EsperandoOPagamento>> {
  const { data, error } = await admin
    .from("cobranca_assinaturas")
    .select("organization_id, created_at")
    .eq("pagamento_inicial_pendente", true)
    .limit(1000);
  if (error) throw new Error(`não consegui ler as assinaturas: ${error.message}`);
  const linhas = (data ?? []) as Array<{ organization_id: string; created_at: string }>;
  const ids = linhas.map((l) => l.organization_id);
  const passos = ids.length
    ? await admin
        .from("mia_pagamento_inicial")
        .select("organization_id, forma, situacao, modo, gerada_em")
        .in("organization_id", ids)
    : { data: [], error: null };
  if (passos.error) throw new Error(`não consegui ler o passo do pagamento: ${passos.error.message}`);
  const porOrg = new Map(
    ((passos.data ?? []) as Array<{ organization_id: string; forma: string | null; situacao: string; modo: string; gerada_em: string | null }>).map(
      (p) => [p.organization_id, p],
    ),
  );
  return new Map(
    linhas.map((l) => {
      const p = porOrg.get(l.organization_id);
      return [
        l.organization_id,
        {
          organization_id: l.organization_id,
          forma: p?.forma ?? null,
          situacao: p?.situacao ?? "sem_cobranca",
          modo: p?.modo ?? "entrada_paga",
          desde: p?.gerada_em ?? l.created_at,
          fim_do_teste: p?.modo === "teste",
        },
      ];
    }),
  );
}

/** O passo do pagamento de UMA empresa, para a Time. `null` = a empresa não tem o passo. Nunca lança. */
export async function passoDoPagamentoParaATime(admin: SupabaseClient, orgId: string): Promise<Record<string, unknown> | null | "nao_lido"> {
  try {
    const [passo, linha, fiscais] = await Promise.all([
      lerPassoDoPagamento(admin, orgId, { podePagar: false, comFiscais: false }),
      lerLinha(admin, orgId),
      admin.from("mia_dados_fiscais").select("tipo, documento, razao_social, cidade, uf, asaas_sincronizado_em").eq("organization_id", orgId).maybeSingle(),
    ]);
    if (passo.modo === null && !linha) return null;
    const f = fiscais.data as { tipo: string; documento: string; razao_social: string; cidade: string; uf: string; asaas_sincronizado_em: string | null } | null;
    return {
      modo: passo.modo,
      espera_o_primeiro_pagamento: passo.espera,
      fim_do_teste: passo.fim_do_teste,
      situacao: passo.situacao,
      forma_escolhida: passo.forma,
      plano: passo.plano?.nome ?? null,
      valor_cents: passo.valor_cents,
      cobranca_no_asaas: linha?.pagamento_ref ?? null,
      vence_em: passo.vence_em,
      gerada_em: linha?.gerada_em ?? null,
      cobrancas_refeitas: linha?.cobrancas_refeitas ?? 0,
      cartao: passo.cartao,
      cartao_nas_proximas: linha?.cartao_recorrente ?? null,
      teste_ate: passo.teste_ate,
      primeira_cobranca_em: passo.primeira_cobranca_em,
      pago_em: passo.pago_em,
      forma_paga: passo.forma_paga,
      lembrete_enviado_em: linha?.lembrete_enviado_em ?? null,
      dados_fiscais: f
        ? {
            tipo: f.tipo,
            documento: documentoMascarado(f.documento),
            razao_social: f.razao_social,
            cidade: `${f.cidade}/${f.uf}`,
            no_asaas: f.asaas_sincronizado_em !== null,
          }
        : null,
    };
  } catch {
    return "nao_lido";
  }
}
