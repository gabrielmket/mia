/**
 * GET /api/v1/admin/tenants/[id]/usage — o que ESTE cliente consumiu.
 *
 * A aba existia marcada `disabled`, como a de Equipe. A diferença entre esta e
 * o `/admin/usage` geral não é o dado, é a PERGUNTA: lá se compara clientes
 * ("quem gasta mais"); aqui se responde sobre um ("este está crescendo? o custo
 * dele acompanha?") — que é a conversa de renovação e de reajuste.
 *
 * Os dois lados do custo juntos, e é o ponto: IA (`llm_calls`) e MENSAGEM da
 * Meta (`messages` cobradas) vêm da mesma tela. Separados, cada número parece
 * pequeno; somados, dizem quanto este cliente custa para servir — que é o
 * número que decide preço.
 *
 * ⚠️ Dinheiro só aparece aqui, no painel da PLATAFORMA: é o preço de custo do
 * que o cliente comprou, e mostrá-lo a ele seria mostrar a margem
 * (`lib/ai/custo-e-da-plataforma.ts`).
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { calcularCusto, type ContagemPorCategoria } from "@/lib/channels/meta/custo-da-conversa";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Teto por consulta. Um mês de tenant grande cabe; um ano não, e não precisa. */
const LIMITE = 50_000;

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }
  const { id } = await ctx.params;

  /**
   * Janela em dias, 30 por padrão.
   *
   * Dias e não "mês corrente" de propósito: a pergunta aqui é de TENDÊNCIA
   * ("está crescendo?"), e no dia 2 do mês a janela do mês corrente responde
   * quase nada. A fatura fechada por mês tem tela própria (`/admin/custo-da-meta`).
   */
  const dias = Math.min(Math.max(Number(req.nextUrl.searchParams.get("dias") ?? 30) || 30, 1), 180);
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

  const admin = createAdminClient();

  const [conversas, mensagens, chamadas, cobradas, precos] = await Promise.all([
    admin
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", id)
      .gte("created_at", desde),
    admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", id)
      .gte("created_at", desde),
    admin
      .from("llm_calls")
      .select("cost_cents, total_tokens")
      .eq("organization_id", id)
      .gte("created_at", desde)
      .limit(LIMITE),
    admin
      .from("messages")
      .select("meta_pricing_category")
      .eq("organization_id", id)
      .eq("meta_billable", true)
      .gte("created_at", desde)
      .limit(LIMITE),
    admin.from("platform_precos_meta").select("categoria, centavos_brl"),
  ]);

  const linhasDeIa = (chamadas.data ?? []) as Array<{
    cost_cents: number | null;
    total_tokens: number | null;
  }>;

  // Centavos de DÓLAR, como o resto do custo de IA neste repositório.
  const custoDeIaCents = linhasDeIa.reduce((s, l) => s + Number(l.cost_cents ?? 0), 0);
  const tokens = linhasDeIa.reduce((s, l) => s + Number(l.total_tokens ?? 0), 0);

  const porCategoria = new Map<string, number>();
  for (const m of (cobradas.data ?? []) as Array<{ meta_pricing_category: string | null }>) {
    // Cobrada sem categoria é a Meta mudando o formato: vira linha com nome
    // próprio em vez de sumir da contagem.
    const c = m.meta_pricing_category ?? "sem_categoria";
    porCategoria.set(c, (porCategoria.get(c) ?? 0) + 1);
  }
  const contagens: ContagemPorCategoria[] = [...porCategoria.entries()].map(
    ([categoria, cobradas]) => ({ categoria, cobradas }),
  );
  const custoDeMensagem = calcularCusto(
    contagens,
    (precos.data ?? []) as Array<{ categoria: string; centavos_brl: number }>,
  );

  return ok(
    {
      dias,
      conversas: conversas.count ?? 0,
      mensagens: mensagens.count ?? 0,
      ia: {
        chamadas: linhasDeIa.length,
        tokens,
        custo_usd_cents: custoDeIaCents,
        // A leitura foi cortada? A tela precisa dizer, senão o número se lê
        // como total e a conta fecha menor que a realidade.
        truncado: linhasDeIa.length >= LIMITE,
      },
      mensagens_cobradas: {
        total: (cobradas.data ?? []).length,
        ...custoDeMensagem,
      },
    },
    { requestId },
  );
}
