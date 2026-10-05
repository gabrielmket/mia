/**
 * SALDO DO PROVEDOR DE IA — quanto ainda tem, e até quando dura.
 *
 * O painel de plataforma respondia "quanto foi consumido" e deixava sem resposta
 * a pergunta que para a operação: quando o crédito acaba, a chave continua
 * válida e a chamada volta recusada — o sintoma chega como "a IA parou de
 * responder", sem dizer por quê.
 *
 * O saldo nunca é gravado. Ele é DERIVADO, e por isso não envelhece:
 *
 *   saldo = última LEITURA + RECARGAS depois dela − consumo de `llm_calls` desde a leitura
 *
 * `leitura` é "fui na conta do provedor e o saldo era este". Ela reancora tudo e
 * absorve a diferença acumulada (uso fora do CRM, a aproximação da tarifa de
 * cache, arredondamento). A diferença entre o que o painel calculava e o que a
 * leitura encontrou é, ela mesma, a medida de quanto a nossa medição erra.
 *
 * Sem nenhuma leitura registrada não há saldo — e a resposta diz isso em vez de
 * chutar zero, que se leria como "acabou".
 *
 * Auth: admin de plataforma. Dinheiro do provedor é da instalação, nunca do
 * tenant (ver `lib/ai/custo-e-da-plataforma.ts`).
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita, requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { derivarSaldo } from "@/lib/ai/custo/saldo";

export const dynamic = "force-dynamic";

const DIAS_DA_MEDIA = 30;

const lancamentoSchema = z.object({
  tipo: z.enum(["recarga", "leitura"]),
  // Em DÓLAR, que é a moeda em que o provedor cobra. O real aparece na tela
  // pela cotação declarada, e nunca é gravado aqui.
  amount_usd: z.number().finite().min(0).max(1_000_000),
  // Quanto saiu em REAIS: com o valor em dólar, dá a taxa efetiva paga — IOF e
  // spread do banco dentro, medidos em vez de estimados. Só faz sentido em recarga.
  amount_brl: z.number().finite().min(0).max(10_000_000).optional(),
  occurred_at: z.string().datetime().optional(),
  note: z.string().trim().max(200).optional(),
});

const cotacaoSchema = z.object({
  usd_brl: z.number().finite().gt(0).lt(1000),
  cotado_em: z.string().datetime().optional(),
});

interface Lancamento {
  id: string;
  tipo: "recarga" | "leitura";
  amount_usd: number;
  /** Só em recarga, e só quando informado: é o que revela IOF e spread. */
  amount_brl: number | null;
  occurred_at: string;
  note: string | null;
}

async function exigirPlataforma() {
  try {
    return await requirePlatformAdmin();
  } catch {
    return null;
  }
}

/**
 * FORK MIA — a ESCRITA desta rota exige scope `full` e MFA em dia (upstream
 * 1.70, `requirePlatformAdminEscrita`): o acesso só de leitura ao painel de
 * plataforma (`support_readonly`) lê e não muda nada.
 */
async function exigirPlataformaParaEscrever(requestId: string) {
  try {
    return { ok: true as const, ctx: await requirePlatformAdminEscrita() };
  } catch (err) {
    return { ok: false as const, resposta: falhaDaEscritaDePlatformAdmin(err, requestId) };
  }
}

export async function GET(_req: NextRequest) {
  const requestId = randomUUID();
  const ctx = await exigirPlataforma();
  if (!ctx) return fail("forbidden", "Platform admin required", 403, { requestId });

  const admin = createAdminClient();

  const { data: linhas, error } = await admin
    .from("platform_ai_ledger")
    .select("id, tipo, amount_usd, amount_brl, occurred_at, note")
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (error) return fail("db_error", "Falha ao ler os lançamentos.", 500, { requestId });

  const lancamentos: Lancamento[] = (linhas ?? []).map((l) => ({
    id: l.id as string,
    tipo: l.tipo as "recarga" | "leitura",
    amount_usd: Number(l.amount_usd),
    amount_brl: l.amount_brl === null || l.amount_brl === undefined ? null : Number(l.amount_brl),
    occurred_at: l.occurred_at as string,
    note: (l.note as string | null) ?? null,
  }));

  // A leitura mais recente é a âncora; só o intervalo dela precisa de consulta.
  const leituraMaisNova = lancamentos.find((l) => l.tipo === "leitura") ?? null;

  // Consumo desde a leitura: a mesma fonte das telas (`llm_calls`), em centavos
  // de dólar. Sem leitura não há intervalo — e não há saldo.
  let consumoDesdeLeituraUsd = 0;
  if (leituraMaisNova) {
    const { data: gastos } = await admin
      .from("llm_calls")
      .select("cost_cents")
      .gte("created_at", leituraMaisNova.occurred_at)
      .limit(100_000);
    consumoDesdeLeituraUsd =
      (gastos ?? []).reduce((acc, g) => acc + Number(g.cost_cents ?? 0), 0) / 100;
  }

  // Ritmo dos últimos 30 dias, para dizer "dura até". Média sobre o período
  // inteiro, e não sobre os dias COM uso: o crédito acaba por calendário.
  const desde = new Date(Date.now() - DIAS_DA_MEDIA * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentes } = await admin
    .from("llm_calls")
    .select("cost_cents")
    .gte("created_at", desde)
    .limit(100_000);
  const consumo30dUsd = (recentes ?? []).reduce((acc, g) => acc + Number(g.cost_cents ?? 0), 0) / 100;
  const mediaDiariaUsd = consumo30dUsd / DIAS_DA_MEDIA;

  const derivado = derivarSaldo({ lancamentos, consumoDesdeLeituraUsd, mediaDiariaUsd });

  const { data: cotacaoRow } = await admin
    .from("platform_ai_custo")
    .select("usd_brl, cotado_em")
    .eq("id", 1)
    .maybeSingle();

  // Quantas linhas do período ainda estão sem preço: é o que diz se este número
  // pode ser lido como a conta inteira ou só como um piso dela.
  const { count: semPreco } = await admin
    .from("llm_calls")
    .select("id", { count: "exact", head: true })
    .is("cost_cents", null)
    .gte("created_at", desde);

  return ok(
    {
      saldo_usd: derivado.saldoUsd,
      leitura: derivado.leitura,
      recargas_desde_leitura_usd: derivado.recargasDesdeLeituraUsd,
      consumo_desde_leitura_usd: consumoDesdeLeituraUsd,
      media_diaria_usd: mediaDiariaUsd,
      consumo_30d_usd: consumo30dUsd,
      dias_restantes: derivado.diasRestantes,
      dura_ate: derivado.duraAte,
      lancamentos,
      cotacao: cotacaoRow?.usd_brl
        ? { usd_brl: Number(cotacaoRow.usd_brl), cotado_em: (cotacaoRow.cotado_em as string) ?? null }
        : null,
      chamadas_sem_preco: semPreco ?? 0,
    },
    { requestId },
  );
}

export async function POST(req: NextRequest) {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  const escrita = await exigirPlataformaParaEscrever(requestId);
  if (!escrita.ok) return escrita.resposta;
  const ctx = escrita.ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_failed", "Corpo inválido.", 422, { requestId });
  }
  const parsed = lancamentoSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Lançamento inválido.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_ai_ledger")
    .insert({
      tipo: parsed.data.tipo,
      amount_usd: parsed.data.amount_usd,
      amount_brl: parsed.data.tipo === "recarga" ? (parsed.data.amount_brl ?? null) : null,
      occurred_at: parsed.data.occurred_at ?? new Date().toISOString(),
      note: parsed.data.note ?? null,
      created_by: ctx.user.id,
    })
    .select("id, tipo, amount_usd, amount_brl, occurred_at, note")
    .single();
  if (error || !data) return fail("db_error", "Falha ao registrar o lançamento.", 500, { requestId });

  void audit({
    action: "platform_admin.ai_saldo_lancado",
    actorUserId: ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    requestId,
    // Valor entra no audit de propósito: é dinheiro, e quem confere a conta
    // depois precisa saber o que foi lançado, por quem e quando.
    metadata: { tipo: parsed.data.tipo, amount_usd: parsed.data.amount_usd, id: data.id },
  });

  return ok(data, { requestId });
}

export async function PATCH(req: NextRequest) {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  const escrita = await exigirPlataformaParaEscrever(requestId);
  if (!escrita.ok) return escrita.resposta;
  const ctx = escrita.ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_failed", "Corpo inválido.", 422, { requestId });
  }
  const parsed = cotacaoSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Cotação inválida.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("platform_ai_custo").upsert(
    {
      id: 1,
      usd_brl: parsed.data.usd_brl,
      cotado_em: parsed.data.cotado_em ?? new Date().toISOString(),
      updated_by: ctx.user.id,
    },
    { onConflict: "id" },
  );
  if (error) return fail("db_error", "Falha ao gravar a cotação.", 500, { requestId });

  void audit({
    action: "platform_admin.ai_cotacao_definida",
    actorUserId: ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    requestId,
    metadata: { usd_brl: parsed.data.usd_brl },
  });

  return ok({ usd_brl: parsed.data.usd_brl }, { requestId });
}
