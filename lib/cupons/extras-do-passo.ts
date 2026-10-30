/**
 * FORK MIA (.98) · O QUE O PASSO "PAGAMENTO" MOSTRA DO CUPOM E DO SETUP
 * (protótipo "Cupons e parceiros", tela 1; docs/fork/cupons-e-parceiros.md).
 *
 * Só lê, e nunca lança: o passo do pagamento não pode cair por causa do cupom.
 * Na falha, o bloco some e o preço fica o do plano. Mora fora de
 * `lib/pagamento-inicial/servico.ts` para aquele arquivo ganhar uma linha só.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { setupParaOPasso, type SetupDoPasso } from "@/lib/setup-de-implantacao/servico";

import { lerCupomDaEmpresa } from "./banco";
import { valorDaMensalidade, type Beneficio, type TipoDoDescontoNoSetup } from "./regras";

export interface CupomDoPasso {
  codigo: string;
  beneficio: Beneficio;
  valor: number;
  meses: number | null;
  setup_tipo: TipoDoDescontoNoSetup;
  setup_valor: number;
  /** O nome de quem indicou (o selo). */
  parceiro: string | null;
  /** O plano atual está entre os do cupom. */
  vale_no_plano: boolean;
  preco_cheio_cents: number | null;
  /** A primeira mensalidade, já com o desconto. */
  primeira_mensalidade_cents: number | null;
  dias_aplicados: number | null;
}

/**
 * Os dias grátis do cupom da empresa, se ele cobre este plano. Trocar de plano antes
 * de pagar para um plano sem teste, mas coberto pelo cupom, mantém o teste. Nunca lança.
 */
export async function diasDoCupomNoPlano(admin: SupabaseClient, orgId: string, planoId: string): Promise<number> {
  try {
    const uso = await lerCupomDaEmpresa(admin, orgId);
    return uso?.beneficio === "dias" && uso.planos.includes(planoId) ? uso.valor : 0;
  } catch {
    return 0;
  }
}

export interface ExtrasDoPasso {
  cupom: CupomDoPasso | null;
  setup: SetupDoPasso | null;
  /** O valor da primeira mensalidade com o cupom (`null` = sem cupom: vale o do plano). */
  primeiraMensalidadeCents: number | null;
}

export async function extrasDoPasso(
  admin: SupabaseClient,
  orgId: string,
  plano: { id: string; preco_cents: number } | null,
): Promise<ExtrasDoPasso> {
  try {
    const uso = await lerCupomDaEmpresa(admin, orgId).catch(() => null);
    const setup = await setupParaOPasso(admin, orgId, plano?.id ?? null, uso);
    if (!uso) return { cupom: null, setup, primeiraMensalidadeCents: null };
    let parceiro: string | null = null;
    if (uso.parceiro_id) {
      const { data } = await admin.from("mia_parceiros").select("nome, anonimizado_em").eq("id", uso.parceiro_id).maybeSingle();
      const p = data as { nome: string; anonimizado_em: string | null } | null;
      parceiro = p && !p.anonimizado_em ? p.nome : null;
    }
    const vale = plano !== null && uso.planos.includes(plano.id);
    const primeira = plano && vale ? valorDaMensalidade(plano.preco_cents, uso, 1) : (plano?.preco_cents ?? null);
    return {
      cupom: {
        codigo: uso.codigo,
        beneficio: uso.beneficio,
        valor: uso.valor,
        meses: uso.meses,
        setup_tipo: uso.setup_tipo,
        setup_valor: uso.setup_valor,
        parceiro,
        vale_no_plano: vale,
        preco_cheio_cents: plano?.preco_cents ?? null,
        primeira_mensalidade_cents: primeira,
        dias_aplicados: uso.dias_aplicados,
      },
      setup,
      primeiraMensalidadeCents: vale ? primeira : null,
    };
  } catch {
    return { cupom: null, setup: null, primeiraMensalidadeCents: null };
  }
}
