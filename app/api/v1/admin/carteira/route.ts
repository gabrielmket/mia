/**
 * A CARTEIRA DO CLIENTE, PELO LADO DE QUEM VENDE.
 *
 * Recarregar crédito e acordar preço por mensagem são decisões de NEGÓCIO, e
 * por isso moram no painel administrativo — a mesma régua que já separa a
 * credencial do provedor (nossa) da credencial do cliente (dele). O tenant lê a
 * própria carteira em `/api/v1/carteira` e não escreve nela por caminho nenhum.
 *
 * GET  → saldo e extrato de UMA organização (`?organization_id=`).
 * POST → lança crédito ou estorno.
 * PATCH→ define o preço por mensagem e o piso de aviso.
 *
 * Não há DELETE, e não é esquecimento: extrato que se apaga não é extrato. Um
 * crédito lançado errado se corrige com um lançamento de sinal contrário, que é
 * o que um contador faria e o que deixa a correção visível para o cliente. O
 * banco recusa o mesmo (a 0244 não concede `delete` nem a service_role).
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita, requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { creditoAcabando, derivarSaldo, type LancamentoDaCarteira } from "@/lib/carteira/saldo";
import { pisoDoPreco } from "@/lib/broadcast/margem";

export const dynamic = "force-dynamic";

const lancamentoSchema = z.object({
  organization_id: z.string().uuid(),
  /**
   * `debito` NÃO entra aqui de propósito: débito é consequência de um envio, e
   * quem o escreve é o motor, com a referência da mensagem que o justifica. Um
   * débito digitado à mão seria uma cobrança sem fato por trás.
   */
  tipo: z.enum(["credito", "estorno"]),
  /** Em centavos da moeda do cliente. Sempre positivo — o sinal vem do tipo. */
  amount_cents: z.number().int().positive().max(1_000_000_00),
  occurred_at: z.string().datetime().optional(),
  note: z.string().trim().max(200).optional(),
});

const precoSchema = z.object({
  organization_id: z.string().uuid(),
  /**
   * `null` devolve a organização ao estado "sem preço acordado", em que o
   * disparador recusa. É um estado legítimo — fim de contrato, por exemplo — e
   * precisa ser alcançável, senão a única saída seria deixar um preço velho
   * valendo.
   */
  preco_por_mensagem_cents: z.number().int().min(0).max(100_000).nullable(),
  alerta_saldo_cents: z.number().int().min(0).max(1_000_000_00).nullable().optional(),
});

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

export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  const ctx = await exigirPlataforma();
  if (!ctx) return fail("forbidden", "Platform admin required", 403, { requestId });

  const orgId = req.nextUrl.searchParams.get("organization_id");
  if (!orgId) return fail("validation_failed", "organization_id é obrigatório.", 422, { requestId });

  const admin = createAdminClient();
  const [todosRes, extratoRes, precoRes] = await Promise.all([
    admin
      .from("tenant_wallet_ledger")
      .select("tipo, amount_cents, occurred_at")
      .eq("organization_id", orgId)
      .limit(100_000),
    admin
      .from("tenant_wallet_ledger")
      .select("id, tipo, amount_cents, currency, occurred_at, ref_kind, ref_id, note")
      .eq("organization_id", orgId)
      .order("occurred_at", { ascending: false })
      .limit(200),
    admin
      .from("tenant_broadcast_pricing")
      .select("preco_por_mensagem_cents, alerta_saldo_cents, updated_at")
      .eq("organization_id", orgId)
      .maybeSingle(),
  ]);

  if (todosRes.error) return fail("db_error", "Falha ao ler a carteira.", 500, { requestId });

  const lancamentos: LancamentoDaCarteira[] = (todosRes.data ?? []).map((l) => ({
    tipo: l.tipo as LancamentoDaCarteira["tipo"],
    amount_cents: Number(l.amount_cents),
    occurred_at: l.occurred_at as string,
  }));
  const saldo = derivarSaldo(lancamentos);
  const alerta =
    precoRes.data?.alerta_saldo_cents === null || precoRes.data?.alerta_saldo_cents === undefined
      ? null
      : Number(precoRes.data.alerta_saldo_cents);

  /**
   * O que a META cobra por uma mensagem de marketing hoje — o PISO do preço.
   *
   * Vai junto na resposta para a tela avisar ANTES de alguém digitar um valor
   * abaixo do custo. Descobrir isso na conferência da fatura, um mês depois, é
   * tarde: as mensagens já saíram e o prejuízo já é por mensagem.
   *
   * ⚠️ É custo de PLATAFORMA e só aparece nesta rota (painel administrativo).
   * A rota do cliente (/api/v1/carteira) não o devolve — o cliente vê o que
   * paga, nunca o que pagamos.
   */
  const { data: tarifa } = await admin
    .from("platform_meta_pricing")
    .select("preco_cents, gratuitas_por_mes, vigente_desde, moeda")
    .eq("categoria", "marketing")
    .eq("pais", "BR")
    .order("vigente_desde", { ascending: false })
    .limit(1)
    .maybeSingle();

  const piso = pisoDoPreco(
    tarifa
      ? {
          categoria: "marketing",
          precoCents: Number(tarifa.preco_cents),
          gratuitasPorMes: Number(tarifa.gratuitas_por_mes),
        }
      : null,
  );

  return ok(
    {
      organization_id: orgId,
      custo_da_meta_cents: piso,
      custo_vigente_desde: (tarifa?.vigente_desde as string | null) ?? null,
      saldo_cents: saldo.saldo_cents,
      creditado_cents: saldo.creditado_cents,
      debitado_cents: saldo.debitado_cents,
      estornado_cents: saldo.estornado_cents,
      preco_por_mensagem_cents:
        precoRes.data?.preco_por_mensagem_cents === null ||
        precoRes.data?.preco_por_mensagem_cents === undefined
          ? null
          : Number(precoRes.data.preco_por_mensagem_cents),
      alerta_saldo_cents: alerta,
      credito_acabando: creditoAcabando(saldo.saldo_cents, alerta),
      extrato: extratoRes.data ?? [],
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
    .from("tenant_wallet_ledger")
    .insert({
      organization_id: parsed.data.organization_id,
      tipo: parsed.data.tipo,
      amount_cents: parsed.data.amount_cents,
      occurred_at: parsed.data.occurred_at ?? new Date().toISOString(),
      // `ref_kind` sem `ref_id` fica fora do índice único: dois créditos
      // manuais do mesmo valor no mesmo dia são legítimos e não podem colidir.
      ref_kind: "recarga_manual",
      note: parsed.data.note ?? null,
      created_by: ctx.user.id,
    })
    .select("id, tipo, amount_cents, occurred_at, note")
    .single();
  if (error || !data) return fail("db_error", "Falha ao lançar o crédito.", 500, { requestId });

  void audit({
    action: "platform_admin.carteira_lancada",
    actorUserId: ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: parsed.data.organization_id,
    requestId,
    // O valor entra no audit porque é dinheiro: quem confere a conta depois
    // precisa saber o que foi lançado, por quem e quando.
    metadata: { tipo: parsed.data.tipo, amount_cents: parsed.data.amount_cents, id: data.id },
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
  const parsed = precoSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Preço inválido.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("tenant_broadcast_pricing").upsert(
    {
      organization_id: parsed.data.organization_id,
      preco_por_mensagem_cents: parsed.data.preco_por_mensagem_cents,
      alerta_saldo_cents: parsed.data.alerta_saldo_cents ?? null,
      updated_at: new Date().toISOString(),
      updated_by: ctx.user.id,
    },
    { onConflict: "organization_id" },
  );
  if (error) return fail("db_error", "Falha ao gravar o preço.", 500, { requestId });

  void audit({
    action: "platform_admin.carteira_preco_definido",
    actorUserId: ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: parsed.data.organization_id,
    requestId,
    metadata: {
      preco_por_mensagem_cents: parsed.data.preco_por_mensagem_cents,
      alerta_saldo_cents: parsed.data.alerta_saldo_cents ?? null,
    },
  });

  return ok({ organization_id: parsed.data.organization_id }, { requestId });
}
