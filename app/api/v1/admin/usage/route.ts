import { type NextRequest } from "next/server";
import { z } from "zod";
import {
  falhaDaEscritaDePlatformAdmin,
  requirePlatformAdmin,
} from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { SEM_DEMONSTRACAO } from "@/lib/demonstracao/fora-das-metricas";
import { separarGasto, type GastoSeparado } from "@/lib/ai/custo/natureza";
import { taxaEfetiva, totalEmReais, type CotacaoDoDia } from "@/lib/ai/custo/cotacao";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { randomUUID } from "node:crypto";
import { lerPaginasDeUso } from "@/lib/admin/usage-pages";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const querySchema = z.object({
  range: z.enum(["7d", "30d", "90d"]).default("30d"),
  tenant_id: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageTenantRow {
  organization_id: string;
  tenant_name: string;
  tenant_slug: string;
  messages_count: number;
  ai_invocations_count: number;
  ai_tokens_total: number;
  ai_cost_cents: number;
  /** Chamadas cujo preço ainda não foi registrado; não equivalem a custo zero. */
  ai_unpriced_count?: number;
  conversations_count: number;
  /**
   * Nome do agente publicado nesta organização — o de maior prioridade, quando
   * há mais de um. `null` significa nenhum agente publicado, e é o sinal que o
   * operador procura na carteira: cliente cujo agente não está no ar.
   */
  agent_name: string | null;
  /**
   * Quantos agentes publicados a organização tem. A linha soma o uso de TODOS
   * eles (o filtro é a organização), mas mostra um nome só; sem a contagem, um
   * cliente com duas Sofias parecia ter o custo de uma (Gabriel, 17/11/2026).
   */
  agents_published_count: number;
}

export interface DailyPoint {
  date: string;
  count: number;
}

export interface DailyCostPoint {
  date: string;
  cents: number;
}

export interface DailyTokensPoint {
  date: string;
  tokens: number;
}

export interface UsageSeries {
  messages: DailyPoint[];
  ai_cost: DailyCostPoint[];
  ai_tokens: DailyTokensPoint[];
}

export interface UsageData {
  range: "7d" | "30d" | "90d";
  tenants: UsageTenantRow[];
  series: UsageSeries;
  /**
   * As duas naturezas de gasto, separadas — somá-las esconde a decisão de preço:
   * atendimento varia com a conversa (e cabe num plano por conversa), operação
   * do sistema não. Ver `lib/ai/custo/natureza.ts`.
   */
  natureza: GastoSeparado;
  /**
   * O que a OpenAI COBROU no período, dias fechados (`platform_openai_spend`,
   * preenchida pelo cron `gasto-openai`). Nulo quando não há chave de
   * administração ou nenhum dia capturado — e aí a tela não finge ter a fatura.
   *
   * A diferença entre isto e `natureza.totalCents` é a margem de erro da nossa
   * medição: é ela que diz se dá para confiar no custo por conversa na hora de
   * fechar preço.
   */
  fatura: { total_usd: number; dias: number; ate: string | null } | null;
  /** Cotação de mercado mais recente — a tela diz de quando ela é. */
  cotacao: { usd_brl: number; cotado_em: string | null } | null;
  /**
   * O custo do período em REAIS, convertido DIA A DIA pela cotação daquele dia.
   * Converter tudo pela cotação de hoje faria o custo de um mês fechado mudar
   * sozinho quando o câmbio mexesse. `dias_sem_cotacao` > 0 = total parcial.
   */
  reais: {
    total: number;
    dias_sem_cotacao: number;
    /**
     * O dólar que a operação PAGOU de fato (recargas com valor em real
     * informado): já traz IOF e spread do banco, medidos e não estimados. Nulo
     * enquanto nenhuma recarga tiver os dois valores.
     */
    taxa_efetiva: number | null;
    /** O mesmo custo pela taxa efetiva — é este que decide margem. */
    total_pela_taxa_efetiva: number | null;
  };
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/usage
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const requestId = randomUUID();

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return fail("validation_error", "Invalid query params", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const { range, tenant_id } = parsed.data;
  const rangeMap: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
  const days = rangeMap[range] ?? 30;

  const admin = createAdminClient();

  // -------------------------------------------------------------------------
  // Per-tenant aggregates
  // -------------------------------------------------------------------------

  // Fetch organizations first (need name/slug)
  let orgsQuery = admin.from("organizations").select("id, display_name, slug");
  if (tenant_id) {
    orgsQuery = orgsQuery.eq("id", tenant_id);
  } else {
    // FORK MIA (cliente modelo, 9010): a empresa de demonstração não entra no
    // uso da plataforma. Todo o resto desta rota filtra por `orgIds`, então o
    // corte aqui vale para mensagens, conversas, IA e custo.
    orgsQuery = orgsQuery.not(...SEM_DEMONSTRACAO);
  }
  const { data: orgs, error: orgsError } = await orgsQuery;
  if (orgsError) {
    return fail("db_error", "Failed to fetch organizations", 500, { requestId });
  }

  const orgMap = new Map(
    (orgs ?? []).map((o: { id: string; display_name: string; slug: string }) => [
      o.id,
      { display_name: o.display_name, slug: o.slug },
    ]),
  );

  const orgIds = (orgs ?? []).map((o: { id: string }) => o.id);

  // Pessoal não soma (spec 21, caminho 10): a mensagem do pessoal entra no
  // banco, mas o uso da plataforma conta operação — e pessoal saiu dela.
  // Marcados um a um, à mão: a lista é curta por construção.
  let pessoais: string[] = [];
  if (orgIds.length > 0) {
    const { data: marcados } = await admin
      .from("contacts")
      .select("id")
      .in("organization_id", orgIds)
      .eq("is_personal", true)
      .limit(2000);
    pessoais = ((marcados ?? []) as Array<{ id: string }>).map((c) => c.id);
  }

  // Dias de calendário UTC, incluindo hoje: tabela e gráficos medem [from,to).
  const endDate = new Date();
  endDate.setUTCHours(0, 0, 0, 0);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - days);
  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();
  interface UsoLinha {
    id: string;
    organization_id: string;
    created_at: string;
    input_tokens?: number | null;
    output_tokens?: number | null;
    cost_cents?: number | null;
    // FORK MIA: a natureza do gasto (lib/ai/custo/natureza.ts) lê estas duas.
    purpose?: string | null;
    contact_id?: string | null;
  }
  const lerUso = (tabela: "messages" | "conversations" | "llm_calls", colunas: string) =>
    lerPaginasDeUso<UsoLinha>((depois, tamanho) => {
      let query = admin
        .from(tabela)
        .select(colunas)
        .in("organization_id", orgIds)
        .gte("created_at", startIso)
        .lt("created_at", endIso);
      if (tabela === "messages" && pessoais.length > 0) {
        query = query.not("contact_id", "in", `(${pessoais.join(",")})`);
      }
      if (depois !== null) query = query.gt("id", depois);
      return query.order("id", { ascending: true }).limit(tamanho) as unknown as PromiseLike<{
        data: UsoLinha[] | null;
        error: unknown;
      }>;
    });
  let mensagens: UsoLinha[] = [],
    conversas: UsoLinha[] = [],
    chamadas: UsoLinha[] = [];
  if (orgIds.length > 0) {
    try {
      [mensagens, conversas, chamadas] = await Promise.all([
        lerUso("messages", "id, organization_id, created_at"),
        lerUso("conversations", "id, organization_id, created_at"),
        lerUso(
          "llm_calls",
          // FORK MIA: `purpose` e `contact_id` para separar o gasto por natureza.
          "id, organization_id, created_at, input_tokens, output_tokens, cost_cents, purpose, contact_id",
        ),
      ]);
    } catch {
      return fail("db_error", "Não foi possível ler o período completo de uso.", 500, {
        requestId,
      });
    }
  }
  const messagesCountMap = new Map<string, number>();
  const convsCountMap = new Map<string, number>();
  const aiInvCountMap = new Map<string, number>();
  const aiTokensMap = new Map<string, number>();
  const aiCostMap = new Map<string, number>();
  const aiUnpricedMap = new Map<string, number>();
  const msgDayMap = new Map<string, number>();
  const aiCostDayMap = new Map<string, number>();
  const aiTokensDayMap = new Map<string, number>();
  // FORK MIA: as mesmas linhas servem à separação por natureza, uma leitura só.
  const linhasDeGasto: { purpose: string; cost_cents: number | string | null; contact_id: string | null }[] = [];
  const somar = (mapa: Map<string, number>, chave: string, valor = 1) =>
    mapa.set(chave, (mapa.get(chave) ?? 0) + valor);
  for (const row of mensagens) {
    somar(messagesCountMap, row.organization_id);
    somar(msgDayMap, row.created_at.slice(0, 10));
  }
  for (const row of conversas) somar(convsCountMap, row.organization_id);
  for (const row of chamadas) {
    const tokens = (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
    const dia = row.created_at.slice(0, 10);
    somar(aiInvCountMap, row.organization_id);
    somar(aiTokensMap, row.organization_id, tokens);
    somar(aiTokensDayMap, dia, tokens);
    somar(aiCostMap, row.organization_id, row.cost_cents ?? 0);
    if (row.cost_cents == null) somar(aiUnpricedMap, row.organization_id);
    somar(aiCostDayMap, dia, row.cost_cents ?? 0);
    linhasDeGasto.push({
      purpose: row.purpose ?? "",
      cost_cents: row.cost_cents ?? null,
      contact_id: row.contact_id ?? null,
    });
  }

  // ---- agente publicado por organização ----
  //
  // Uma linha por organização basta para a carteira: o agente de MAIOR
  // prioridade entre os publicados. A lista completa vive na aba Agente do
  // cliente — aqui a pergunta é só "este cliente está atendendo?".
  const agentNamePorOrg: Record<string, string> = {};
  const agentesPorOrg: Record<string, number> = {};
  if (orgIds.length > 0) {
    const { data: agentRows, error: agentErr } = await admin
      .from("ai_agents")
      .select("organization_id, name, priority")
      .in("organization_id", orgIds)
      .is("archived_at", null)
      .not("published_version_id", "is", null)
      .order("priority", { ascending: false });
    if (!agentErr && agentRows) {
      for (const row of agentRows) {
        const oid = row.organization_id as string;
        if (!agentNamePorOrg[oid]) agentNamePorOrg[oid] = row.name as string;
        agentesPorOrg[oid] = (agentesPorOrg[oid] ?? 0) + 1;
      }
    }
  }

  // Build tenant rows
  const tenants: UsageTenantRow[] = (orgs ?? [])
    .map((org: { id: string }) => {
      const meta = orgMap.get(org.id) ?? { display_name: org.id, slug: "" };
      return {
        organization_id: org.id,
        tenant_name: meta.display_name,
        tenant_slug: meta.slug,
        messages_count: messagesCountMap.get(org.id) ?? 0,
        ai_invocations_count: aiInvCountMap.get(org.id) ?? 0,
        ai_tokens_total: aiTokensMap.get(org.id) ?? 0,
        ai_cost_cents: aiCostMap.get(org.id) ?? 0,
        ai_unpriced_count: aiUnpricedMap.get(org.id) ?? 0,
        conversations_count: convsCountMap.get(org.id) ?? 0,
        agent_name: agentNamePorOrg[org.id] ?? null,
        agents_published_count: agentesPorOrg[org.id] ?? 0,
      };
    })
    .sort(
      (a: UsageTenantRow, b: UsageTenantRow) =>
        b.ai_cost_cents - a.ai_cost_cents || b.messages_count - a.messages_count,
    );

  // -------------------------------------------------------------------------
  // Daily series
  // -------------------------------------------------------------------------

  const dateLabels: string[] = [];
  for (let i = 0; i < days; i++) {
    const dia = new Date(startDate);
    dia.setUTCDate(dia.getUTCDate() + i);
    dateLabels.push(dia.toISOString().slice(0, 10));
  }

  const series: UsageSeries = {
    messages: dateLabels.map((date) => ({
      date,
      count: msgDayMap.get(date) ?? 0,
    })),
    ai_cost: dateLabels.map((date) => ({
      date,
      cents: aiCostDayMap.get(date) ?? 0,
    })),
    ai_tokens: dateLabels.map((date) => ({
      date,
      tokens: aiTokensDayMap.get(date) ?? 0,
    })),
  };

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  void audit({
    action: "platform_admin.usage_viewed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    metadata: { range, tenant_id: tenant_id ?? null },
    requestId,
  });

  const natureza = separarGasto(linhasDeGasto);

  const { data: cotacaoRow } = await admin
    .from("platform_ai_custo")
    .select("usd_brl, cotado_em")
    .eq("id", 1)
    .maybeSingle();
  const cotacao = cotacaoRow?.usd_brl
    ? { usd_brl: Number(cotacaoRow.usd_brl), cotado_em: (cotacaoRow.cotado_em as string | null) ?? null }
    : null;

  // ---- o custo em REAIS, cada dia pela cotação DAQUELE dia ------------------
  const { data: fxRows } = await admin
    .from("platform_fx_rates")
    .select("dia, usd_brl")
    .gte("dia", startIso.slice(0, 10))
    .order("dia", { ascending: false })
    .limit(400);
  // A cotação anterior ao início da janela também importa: um dia sem captura
  // cai na mais recente ANTES dele, e sem esta segunda leitura o primeiro dia
  // do período ficaria sem conversão sempre que o cron tivesse falhado nele.
  const { data: fxAnterior } = await admin
    .from("platform_fx_rates")
    .select("dia, usd_brl")
    .lt("dia", startIso.slice(0, 10))
    .order("dia", { ascending: false })
    .limit(1);
  const historico: CotacaoDoDia[] = [...(fxRows ?? []), ...(fxAnterior ?? [])].map((r) => ({
    dia: r.dia as string,
    usd_brl: Number(r.usd_brl),
  }));

  // A fatura só tem dias FECHADOS: o período pedido pode incluir hoje, e o
  // total abaixo declara quantos dias ele cobre em vez de fingir cobrir tudo.
  const { data: faturaRows } = await admin
    .from("platform_openai_spend")
    .select("dia, usd")
    .gte("dia", startIso.slice(0, 10))
    .order("dia", { ascending: false })
    .limit(400);
  const fatura =
    faturaRows && faturaRows.length > 0
      ? {
          total_usd: Number(
            faturaRows.reduce((acc, f) => acc + Number(f.usd ?? 0), 0).toFixed(4),
          ),
          dias: faturaRows.length,
          ate: (faturaRows[0]?.dia as string | undefined) ?? null,
        }
      : null;

  const custosPorDia = dateLabels.map((date) => ({ dia: date, cents: aiCostDayMap.get(date) ?? 0 }));
  const { reais: totalReais, semCotacao } = totalEmReais(custosPorDia, historico);

  const { data: recargas } = await admin
    .from("platform_ai_ledger")
    .select("amount_usd, amount_brl")
    .eq("tipo", "recarga");
  const efetiva = taxaEfetiva(
    (recargas ?? []).map((r) => ({
      amount_usd: Number(r.amount_usd),
      amount_brl: r.amount_brl === null || r.amount_brl === undefined ? null : Number(r.amount_brl),
    })),
  );

  return ok<UsageData>(
    {
      range,
      tenants,
      series,
      natureza,
      fatura,
      cotacao,
      reais: {
        total: totalReais,
        dias_sem_cotacao: semCotacao,
        taxa_efetiva: efetiva,
        total_pela_taxa_efetiva: efetiva === null ? null : (natureza.totalCents / 100) * efetiva,
      },
    },
    { requestId },
  );
}
