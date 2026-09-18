/**
 * GET|PUT /api/v1/admin/custo-da-meta — quanto cada cliente gastou em mensagem.
 *
 * GET  → a contagem por categoria, por cliente, no período + a tabela de preços.
 * PUT  → atualiza a tabela de preços.
 *
 * A Meta manda a CATEGORIA em todo status de entrega e o valor em lugar nenhum:
 * ela cobra por tabela, que varia por país e por reajuste. Então dinheiro aqui é
 * contagem × preço vigente, e o preço é nosso (`platform_precos_meta`).
 *
 * Fica no painel da plataforma, como o custo de IA: é o preço de CUSTO daquilo
 * que o cliente comprou, e mostrá-lo a ele seria mostrar a margem
 * (`lib/ai/custo-e-da-plataforma.ts`).
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { calcularCusto, type ContagemPorCategoria } from "@/lib/channels/meta/custo-da-conversa";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Teto da varredura. Uma instalação com mais que isso num mês pede agregação no banco. */
const LIMITE = 50_000;

const precosSchema = z.object({
  precos: z
    .array(
      z.object({
        categoria: z.string().trim().min(1).max(60),
        centavos_brl: z.coerce.number().int().min(0).max(100_000),
      }),
    )
    .max(20),
});

async function exigirPlataforma() {
  try {
    return await requirePlatformAdmin();
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const ctx = await exigirPlataforma();
  if (!ctx) return fail("forbidden", "Platform admin required", 403, { requestId });

  /**
   * O período é o MÊS, e o padrão é o mês corrente.
   *
   * A fatura da Meta fecha por mês; qualquer outra janela produziria um número
   * que não dá para conferir contra nada. `?mes=2026-09` para olhar para trás.
   */
  const mes = req.nextUrl.searchParams.get("mes");
  const agora = new Date();
  const [ano, m] = mes?.match(/^\d{4}-\d{2}$/)
    ? mes.split("-").map(Number)
    : [agora.getUTCFullYear(), agora.getUTCMonth() + 1];
  const inicio = new Date(Date.UTC(ano!, m! - 1, 1)).toISOString();
  const fim = new Date(Date.UTC(ano!, m!, 1)).toISOString();

  const admin = createAdminClient();

  const [{ data: linhas, error }, { data: precos }, { data: orgs }] = await Promise.all([
    admin
      .from("messages")
      .select("organization_id, meta_pricing_category")
      .eq("meta_billable", true)
      .gte("created_at", inicio)
      .lt("created_at", fim)
      .limit(LIMITE),
    admin.from("platform_precos_meta").select("categoria, centavos_brl"),
    admin.from("organizations").select("id, display_name").is("redacted_at", null),
  ]);
  if (error) return fail("db_error", error.message, 500, { requestId });

  const tabela = (precos ?? []) as Array<{ categoria: string; centavos_brl: number }>;
  const nome = new Map(
    (orgs ?? []).map((o) => [
      (o as { id: string }).id,
      (o as { display_name: string }).display_name,
    ]),
  );

  // Contagem em memória: a alternativa seria um `group by` via RPC, e criar uma
  // função no banco para uma tela de painel que lê um mês é mais peça para
  // manter do que a pergunta merece. O teto acima é o que mantém isso honesto.
  const porOrg = new Map<string, Map<string, number>>();
  for (const l of (linhas ?? []) as Array<{
    organization_id: string;
    meta_pricing_category: string | null;
  }>) {
    // Cobrada sem categoria é a Meta mudando o formato outra vez. Vira uma
    // linha com nome próprio em vez de sumir na contagem.
    const categoria = l.meta_pricing_category ?? "sem_categoria";
    const mapa = porOrg.get(l.organization_id) ?? new Map<string, number>();
    mapa.set(categoria, (mapa.get(categoria) ?? 0) + 1);
    porOrg.set(l.organization_id, mapa);
  }

  const clientes = [...porOrg.entries()]
    .map(([orgId, mapa]) => {
      const contagens: ContagemPorCategoria[] = [...mapa.entries()].map(([categoria, cobradas]) => ({
        categoria,
        cobradas,
      }));
      const custo = calcularCusto(contagens, tabela);
      return {
        organization_id: orgId,
        organizacao: nome.get(orgId) ?? orgId,
        ...custo,
      };
    })
    .sort((a, b) => b.totalCentavos - a.totalCentavos);

  return ok(
    {
      mes: `${ano}-${String(m).padStart(2, "0")}`,
      truncado: (linhas ?? []).length >= LIMITE,
      precos: tabela,
      clientes,
    },
    { requestId },
  );
}

export async function PUT(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const ctx = await exigirPlataforma();
  if (!ctx) return fail("forbidden", "Platform admin required", 403, { requestId });

  const parsed = precosSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Preços inválidos.", 422, { requestId });

  const admin = createAdminClient();
  const agora = new Date().toISOString();
  const { error } = await admin.from("platform_precos_meta").upsert(
    parsed.data.precos.map((p) => ({
      categoria: p.categoria,
      centavos_brl: p.centavos_brl,
      atualizado_em: agora,
      atualizado_por: ctx.user.id,
    })),
    { onConflict: "categoria" },
  );
  if (error) return fail("db_error", error.message, 500, { requestId });

  void audit({
    action: "platform.precos_da_meta_alterados",
    actorUserId: ctx.user.id,
    organizationId: null,
    requestId,
    metadata: { categorias: parsed.data.precos.map((p) => p.categoria) },
  });

  return ok({ precos: parsed.data.precos }, { requestId });
}
