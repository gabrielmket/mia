import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PATCH/DELETE /api/v1/pipelines/[id] — renomear, descrever, reordenar, eleger
 * padrão, arquivar e (só no caso limpo) excluir um funil.
 *
 * ⚠️ DELETE ARQUIVA POR PADRÃO. Três dependências cobram isso, e só uma delas o
 * banco defende sozinho: `crm_leads_pipeline_id_fkey` é `ON DELETE RESTRICT` (o
 * Postgres recusa funil com negócio), mas `webhook_sources.default_pipeline_id` é
 * `ON DELETE CASCADE` — apagar o funil apagaria a fonte de webhook do cliente EM
 * SILÊNCIO — e `automation_rules.actions` cita `pipeline_id` dentro de jsonb, sem
 * FK nenhuma. `?definitivo=1` só passa pelo caso honesto do "criei sem querer":
 * funil sem negócio, sem formulário e sem automação apontando para ele.
 *
 * Auth: sessão por cookie, papel manager+. `organization_id` sai do JWT — nunca
 * do body nem da URL. As regras vivem em `lib/pipelines/pipeline-editing.ts`
 * (puras, testadas); aqui só há transporte e a ORDEM das escritas, que é o que o
 * índice único de padrão cobra.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { ApiError } from "@/lib/api/types";
import {
  podeExcluirDeVez,
  validarArquivamento,
  type FunilEditavel,
} from "@/lib/pipelines/pipeline-editing";
import { atualizarFunil } from "@/lib/pipelines/pipeline-operations";
import { createClient } from "@/lib/supabase/server";

import { conflitoDoBanco, corpo, lerDependencias, lerFunis } from "../_funis";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * `depois_de` é o vizinho DE CIMA (`null` = primeiro da lista), não um número de
 * posição: quem clica na seta sabe onde o funil vai parar, não qual fração de
 * `position` isso vira. Mandar o número da tela duplicaria a conta que
 * `posicaoEntre` já faz — e as duas divergiriam no primeiro ajuste.
 */
const bodySchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(280).nullable().optional(),
    is_default: z.boolean().optional(),
    /**
     * ⚠️ `false` É ACEITO AQUI, ao contrário de `is_default: false` — e a
     * assimetria é deliberada, não descuido. Toda organização PRECISA de um
     * funil padrão (sem ele, lead criado sem funil escolhido fica sem destino);
     * nenhuma precisa de um funil de clientes, e não ter é o estado de fábrica.
     * Recusar o desligamento prenderia o operador numa escolha que ele fez para
     * experimentar. Quem "consertar" esta assimetria quebra o desfazer.
     */
    is_client_pipeline: z.boolean().optional(),
    /**
     * TIRAR DO ARQUIVO (#979). `true` é aceito pelo schema e recusado pelo
     * handler, de propósito: quem manda `is_archived: true` quer arquivar, e
     * arquivar tem porta própria (`DELETE`) porque conta as dependências antes
     * — formulário apontando para o funil, automação ativa, ser o padrão ou o
     * último vivo. Deixar o PATCH arquivar daria a volta em todas elas. Recusar
     * no handler, e não com `z.literal(false)`, é o que permite responder
     * "use o DELETE" em vez de "não entendi o que mudar neste funil".
     */
    is_archived: z.boolean().optional(),
    depois_de: z.string().min(1).nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Nada para alterar." });

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_pipelines" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const { id: pipelineId } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail("invalid_request", t("Corpo não é JSON válido."), 400, { requestId });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return fail("unprocessable_entity", t("Não entendi o que mudar neste funil."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const pedido = parsed.data;

  // FORK MIA: as regras e a ORDEM das escritas (arquivado não se edita, o padrão
  // se muda e não se apaga, liberar o antigo antes de marcar o novo) moram em
  // `lib/pipelines/pipeline-operations.ts`, compartilhadas com o MCP de
  // plataforma. Aqui só há transporte, e a tradução da frase para quem lê.
  const supabase = await createClient();
  try {
    const { funis } = await atualizarFunil(
      {
        supabase,
        organizationId: orgId,
        actor: { type: "user", id: authz.user.id, role: authz.org.role },
        requestId,
      },
      { pipelineId, pedido },
    );
    return ok(corpo(funis), { requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, t(err.message), err.status, { requestId, details: err.details });
    }
    throw err;
  }
}

export async function DELETE(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_pipelines" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const { id: pipelineId } = await ctx.params;
  const definitivo = req.nextUrl.searchParams.get("definitivo") === "1";

  const supabase = await createClient();

  let funis: FunilEditavel[];
  try {
    funis = await lerFunis(supabase, orgId);
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
  const alvo = funis.find((f) => f.id === pipelineId);
  if (!alvo) return fail("not_found", t("Funil não encontrado."), 404, { requestId });

  let deps;
  try {
    deps = await lerDependencias(supabase, orgId, pipelineId);
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }

  const veredito = definitivo
    ? podeExcluirDeVez(funis, pipelineId, deps)
    : validarArquivamento(funis, pipelineId, deps);
  if (!veredito.ok) {
    // A CONTAGEM VAI EM `details`, não só dentro da frase: a tela mostra "este
    // funil tem N negócios" sem precisar extrair o número da mensagem com regex —
    // segunda régua que quebraria na primeira vez que alguém melhorasse o texto.
    return fail("unprocessable_entity", veredito.erro, 422, {
      requestId,
      details: {
        negocios: deps.negocios,
        fontes_de_webhook: deps.fontesDeWebhook,
        automacoes: deps.regrasAtivas,
      },
    });
  }

  const { error } = definitivo
    ? await supabase.from("crm_pipelines").delete().eq("id", pipelineId).eq("organization_id", orgId)
    : await supabase
        .from("crm_pipelines")
        .update({ is_archived: true })
        .eq("id", pipelineId)
        .eq("organization_id", orgId);

  if (error) {
    const conflito = conflitoDoBanco(error as { code?: string }, alvo.name, requestId);
    if (conflito) return conflito;
    return fail("internal_error", error.message, 500, { requestId });
  }

  void audit({
    action: definitivo ? "pipeline.deleted" : "pipeline.archived",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "crm_pipeline",
    resourceId: pipelineId,
    requestId,
    metadata: { name: alvo.name, slug: alvo.slug, negocios: deps.negocios },
  });

  try {
    return ok(corpo(await lerFunis(supabase, orgId)), { requestId });
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}
