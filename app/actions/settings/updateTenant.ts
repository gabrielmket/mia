"use server";

import { supportWriteError } from "@/lib/impersonate/support";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { tenantSchema, type TenantInput } from "@/lib/schemas/settings";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import { paisesOferecidos } from "@/lib/legal/perfil-do-pais";
import { lerModoDeVenda } from "@/lib/empresas/modo-de-venda";

export type UpdateTenantResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

export async function updateTenant(input: TenantInput): Promise<UpdateTenantResult> {
  const parsed = tenantSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation_failed", details: parsed.error.flatten() };
  }

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(authUser.support)) return { ok: false, error: "forbidden" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "forbidden_tenant" };
  if (!podeAdministrarEmpresa(authUser, activeOrg)) {
    return { ok: false, error: "forbidden_role" };
  }

/**
 * A ESCRITA EM `organizations` VAI PELO ADMIN CLIENT — e não é preguiça.
 *
 * A única policy de escrita da tabela é `orgs_write_platform_admin`, com
 * `USING (fn_is_platform_admin())`. Pelo client de sessão, o UPDATE de quem não
 * é super-admin de plataforma casa ZERO linhas — e o PostgREST devolve sucesso,
 * porque "nenhuma linha casou o filtro" não é erro. Resultado: a tela dizia
 * "salvo", nada era gravado, e recarregar mostrava o estado antigo.
 *
 * Medido em Postgres com o baseline aplicado (issue #144): sob `authenticated`
 * com o JWT de um manager, `update organizations` devolve 0 linhas; sob
 * postgres, 1. Ninguém tinha notado porque o dono do repo e o owner criado pelo
 * `bootstrap-owner.ts` SÃO platform_admin — quem tropeça é o segundo admin
 * convidado e qualquer manager.
 *
 * O gate continua sendo o de cima (papel resolvido de fonte confiável), e o
 * filtro por `organization_id` é explícito, como a doutrina exige de todo
 * handler que usa service role.
 */
  const supabase = createAdminClient();
  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  // O país só entra se tiver PERFIL REVISADO (issue #1033): `paisesOferecidos()`
  // é a lista que o seletor mostra, e é ela que a gravação confere. Sem esta
  // guarda, um PATCH à mão gravaria um país cujo documento legal ninguém
  // revisou, e o PDF de acesso passaria a não citar lei nenhuma — ou, pior,
  // citaria a brasileira para um titular de outro país.
  const pais = parsed.data.country ?? null;
  if (pais !== null && !paisesOferecidos().some((p) => p.codigo === pais)) {
    return { ok: false, error: `País sem perfil revisado: ${pais}` };
  }

  /**
   * A ESCRITA EM `settings` SÓ ACONTECE QUANDO O MODO DE VENDA MUDA — e o
   * "só" é a peça toda.
   *
   * Esta action gravava o jsonb inteiro a cada Salvar: lia `settings`,
   * espalhava em memória e regravava o objeto. O upstream apagou esse escritor
   * ao aposentar `lost_reasons_extra`, e com razão medida: entre a leitura e a
   * gravação, outro dono do jsonb (`llm`, `agenda`, `branding`,
   * `visibility_mode`) escreve a chave dele e o nosso UPDATE a devolve ao valor
   * antigo, sem erro em lugar nenhum. `visibility_mode` JÁ voltou de `own` para
   * `all` assim — e quem lê essa chave é a RLS que decide qual conversa cada
   * atendente enxerga. Um salvamento de RAZÃO SOCIAL abrindo a caixa de entrada
   * inteira é exatamente o tipo de defeito que não dá sintoma.
   * `tests/unit/moeda-da-organizacao-se-escolhe-na-tela.test.ts` guarda isto:
   * exige que o UPDATE comum NÃO leve a chave `settings`.
   *
   * O item C2 (B2B/B2C) mora nesse mesmo jsonb e não tem, ainda, escritor
   * atômico próprio. Tirá-lo junto deixaria o seletor decorativo: a tela diria
   * "Organização atualizada" e o modo voltaria para b2b no reload. A saída é
   * gravar SÓ QUANDO O VALOR MUDA — o caminho de todo dia (salvar dados da
   * empresa) deixa o jsonb intocado, como o upstream quer, e a corrida fica
   * restrita às pouquíssimas vezes em que alguém de fato vira a chave.
   *
   * ⚠️ PENDÊNCIA: a cura definitiva é uma função com `jsonb_set` sobre
   * `{modo_de_venda}`, no molde de `fn_definir_marca_da_organizacao`
   * (migration 0157). Enquanto ela não existe, é este o menor risco possível.
   */
  const { data: orgRow, error: readErr } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", activeOrg.orgId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };

  const settingsAtuais = (orgRow?.settings as Record<string, unknown> | null) ?? {};
  // Item C2. Decide se a entidade empresa aparece — aba, campo no cadastro e a
  // capacidade que faz a IA perguntar de qual empresa o cliente e.
  const modoEscolhido = parsed.data.modo_de_venda;
  const modoMudou = modoEscolhido !== lerModoDeVenda(settingsAtuais);

  const { error } = await supabase
    .from("organizations")
    .update({
      display_name: parsed.data.display_name,
      legal_name: parsed.data.legal_name,
      cnpj: parsed.data.cnpj ?? null,
      country: pais,
      timezone: parsed.data.timezone,
      locale: parsed.data.locale,
      currency: parsed.data.currency,
      media_retention_days: parsed.data.media_retention_days,
      dpo_email: parsed.data.dpo_email ?? null,
      privacy_policy_url: parsed.data.privacy_policy_url ?? null,
      // A chave só existe no payload quando o modo mudou — ver o bloco acima.
      ...(modoMudou ? { settings: { ...settingsAtuais, modo_de_venda: modoEscolhido } } : {}),
    })
    .eq("id", activeOrg.orgId);
  if (error) return { ok: false, error: error.message };

  await audit({
    action: "org.updated",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "organization",
    resourceId: activeOrg.orgId,
    requestId,
    ip,
    userAgent,
    metadata: {
      fields_changed: Object.keys(parsed.data),
    },
  });

  await supabase
    .rpc("emit_event", {
      p_event_type: "org.updated",
      p_entity_kind: "organization",
      p_entity_id: activeOrg.orgId,
      p_payload: { organization_id: activeOrg.orgId },
      p_metadata: { request_id: requestId },
      p_organization_id: activeOrg.orgId,
    })
    .then(({ error: e }) => {
      if (e) console.error("[updateTenant] emit_event failed", e.message);
    });

  revalidatePath("/app/settings/tenant");
  return { ok: true };
}
