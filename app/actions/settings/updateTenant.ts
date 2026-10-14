"use server";

import { supportWriteError } from "@/lib/impersonate/support";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { tenantSchema, type TenantInput } from "@/lib/schemas/settings";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import { gravarDadosCadastrais } from "@/lib/tenants/dados-cadastrais";
// FORK MIA: o modo de venda (B2B/B2C) é nosso e continua gravado aqui.
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

  // País revisado, CNPJ único e a lista de colunas: a gravação mora em
  // `lib/tenants/dados-cadastrais.ts`, compartilhada com a gestão de tenants do
  // admin da plataforma.
  const gravado = await gravarDadosCadastrais(supabase, activeOrg.orgId, parsed.data);
  if (!gravado.ok) {
    if (gravado.erro === "cnpj_em_uso") {
      return { ok: false, error: "Este CNPJ já pertence a outra organização." };
    }
    return { ok: false, error: gravado.erro };
  }

  /**
   * FORK MIA — A ESCRITA EM `settings` SÓ ACONTECE QUANDO O MODO DE VENDA MUDA — e o
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

  // FORK MIA: os dados cadastrais já foram gravados por `gravarDadosCadastrais`
  // (upstream); aqui só vai `settings`, e só quando o modo de venda mudou.
  if (modoMudou) {
    const { error } = await supabase
      .from("organizations")
      .update({ settings: { ...settingsAtuais, modo_de_venda: modoEscolhido } })
      .eq("id", activeOrg.orgId);
    if (error) return { ok: false, error: error.message };
  }

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
