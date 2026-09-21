/**
 * GET|PUT|POST /api/v1/admin/cadastro-incorporado
 *
 * GET  → o link do cadastro + as contas que chegaram e ainda não são de ninguém.
 * PUT  → grava o link gerado no painel da Meta.
 * POST → AMARRA uma conta que chegou a um cliente, criando o canal oficial.
 *
 * A amarração é ato humano por um motivo só: o aviso da Meta não diz de qual
 * cliente NOSSO ele é. O link é da instalação, não do tenant, então dois
 * clientes que entrem na mesma tarde chegam indistinguíveis para o webhook.
 * Adivinhar faria a conversa de um cliente sair pelo número de outro.
 *
 * ⚠️ O canal criado aqui NÃO recebe token próprio, e é de propósito: no modelo
 * de Provedor de Tecnologia quem endereça a WABA do cliente é o token de
 * sistema DA PLATAFORMA. `resolveMetaCreds` já cai nele quando a sessão não tem
 * um — a mesma escada que o canal manual usa. Pedir um token ao cliente aqui
 * anularia a única vantagem do cadastro incorporado: ele não digita nada.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";

const linkSchema = z.object({
  /** `null` desliga a porta do login e deixa só a manual. */
  embedded_signup_url: z.string().url().max(2000).nullable(),
});

const amarrarSchema = z.object({
  waba_id: z.string().min(1).max(200),
  organization_id: z.string().uuid(),
  /** Qual número daquela conta vira o canal. */
  phone_number_id: z.string().min(1).max(200),
});

async function exigirPlataforma() {
  try {
    return await requirePlatformAdmin();
  } catch {
    return null;
  }
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const ctx = await exigirPlataforma();
  if (!ctx) return fail("forbidden", "Platform admin required", 403, { requestId });

  const admin = createAdminClient();
  const [{ data: config }, { data: chegadas }, { data: orgs }] = await Promise.all([
    admin.from("platform_meta").select("embedded_signup_url, updated_at").eq("id", 1).maybeSingle(),
    admin
      .from("meta_onboardings")
      .select(
        "id, waba_id, business_name, phone_number_id, phone_number, organization_id, bound_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("organizations")
      .select("id, display_name")
      .is("redacted_at", null)
      .order("display_name", { ascending: true }),
  ]);

  const nomeDaOrg = new Map(
    (orgs ?? []).map((o) => [(o as { id: string }).id, (o as { display_name: string }).display_name]),
  );

  return ok(
    {
      embedded_signup_url: (config as { embedded_signup_url?: string | null } | null)
        ?.embedded_signup_url ?? null,
      chegadas: (chegadas ?? []).map((c) => {
        const linha = c as Record<string, unknown>;
        return {
          ...linha,
          organizacao: linha.organization_id
            ? (nomeDaOrg.get(linha.organization_id as string) ?? null)
            : null,
        };
      }),
      empresas: orgs ?? [],
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

  const parsed = linkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Link inválido.", 422, { requestId });

  const admin = createAdminClient();
  const { error } = await admin.from("platform_meta").upsert(
    {
      id: 1,
      embedded_signup_url: parsed.data.embedded_signup_url,
      updated_at: new Date().toISOString(),
      updated_by: ctx.user.id,
    },
    { onConflict: "id" },
  );
  if (error) return fail("db_error", error.message, 500, { requestId });

  void audit({
    action: "platform.cadastro_incorporado_alterado",
    actorUserId: ctx.user.id,
    organizationId: null,
    requestId,
    metadata: { definido: parsed.data.embedded_signup_url !== null },
  });

  return ok({ embedded_signup_url: parsed.data.embedded_signup_url }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const ctx = await exigirPlataforma();
  if (!ctx) return fail("forbidden", "Platform admin required", 403, { requestId });

  const parsed = amarrarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Dados inválidos.", 422, { requestId });
  const { waba_id, organization_id, phone_number_id } = parsed.data;

  const admin = createAdminClient();

  const { data: chegada } = await admin
    .from("meta_onboardings")
    .select("id, waba_id, business_name, phone_number, organization_id")
    .eq("waba_id", waba_id)
    .maybeSingle();
  if (!chegada) return fail("not_found", "Essa conta não chegou por aqui.", 404, { requestId });
  if ((chegada as { organization_id?: string | null }).organization_id) {
    // Re-amarrar mudaria o dono de um número que já pode estar conversando. Se
    // for engano de verdade, o caminho é desconectar o canal — que tem tela,
    // aviso e rastro — e não um POST que troca o dono em silêncio.
    return fail("conflict", "Essa conta já está amarrada a um cliente.", 409, { requestId });
  }

  /**
   * O SEGREDO DE WEBHOOK DO CANAL — a coluna que fazia este botão nunca funcionar.
   *
   * `channel_sessions.webhook_secret_encrypted` é `bytea NOT NULL` e não tem
   * default. Este insert não a preenchia, então TODO clique em "Amarrar"
   * estourava no Postgres e voltava como a mensagem crua da constraint. Não era
   * um caso de borda: era sempre, desde que a tela existe — e ninguém percebeu
   * porque a conta só chega aqui quando um cliente real completa o cadastro, e
   * isso só aconteceu pela primeira vez em 21/09/2026.
   *
   * O valor é um segredo NOVO e aleatório, não o token da Meta. O canal criado
   * por aqui não tem token próprio de propósito (é o token de sistema da
   * plataforma que endereça a WABA do cliente — está no cabeçalho deste
   * arquivo), mas o segredo de webhook é outra coisa: ele pertence ao CANAL,
   * não ao provedor, e é o que o resto do repo espera encontrar cifrado aqui.
   *
   * Falha de cifra recusa ANTES de criar o canal, e a mensagem diz o que falta.
   * Criar o canal sem segredo seria repetir o defeito num degrau acima: um
   * canal que existe na tela e quebra na primeira entrega.
   */
  const segredoDoCanal = randomBytes(32).toString("hex");
  const segredoCifrado = await encryptWebhookSecret(admin, segredoDoCanal);
  if (!segredoCifrado) {
    return fail(
      "invalid_request",
      "Cifra indisponível nesta instalação (GUC app.nuvemshop_oauth_key ausente) — o canal não foi criado.",
      422,
      { requestId },
    );
  }

  const agora = new Date().toISOString();
  const { data: sessao, error: erroSessao } = await admin
    .from("channel_sessions")
    .insert({
      organization_id,
      provider: CHANNEL_PROVIDER_META,
      meta_waba_id: waba_id,
      meta_phone_number_id: phone_number_id,
      webhook_secret_encrypted: segredoCifrado,
      display_name:
        (chegada as { business_name?: string | null }).business_name ?? "WhatsApp Oficial",
      phone_number: (chegada as { phone_number?: string | null }).phone_number ?? null,
      // WORKING e não STARTING: o número JÁ está de pé do lado da Meta — foi ela
      // que nos avisou. Nascer STARTING faria o vigia de saúde tratar como
      // conexão em boot e a tela pedir um QR que não existe neste canal.
      status: "WORKING",
      // `webhook_path_token` NÃO é preenchido aqui: a coluna tem default no
      // banco, no formato que o resto do repo espera. Gerar um aqui seria uma
      // segunda regra para a mesma coisa, e a que diverge é sempre esta.
    })
    .select("id")
    .single();
  if (erroSessao) return fail("db_error", erroSessao.message, 500, { requestId });

  await admin
    .from("meta_onboardings")
    .update({
      organization_id,
      channel_session_id: (sessao as { id: string }).id,
      bound_at: agora,
      bound_by: ctx.user.id,
      updated_at: agora,
    })
    .eq("waba_id", waba_id);

  void audit({
    action: "platform.cadastro_incorporado_amarrado",
    actorUserId: ctx.user.id,
    // Aqui a organização É o alvo: o canal passou a existir DENTRO dela.
    organizationId: organization_id,
    requestId,
    metadata: { waba_id, phone_number_id, channel_session_id: (sessao as { id: string }).id },
  });

  return ok({ channel_session_id: (sessao as { id: string }).id }, { requestId });
}
