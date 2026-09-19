/**
 * GET|PUT /api/v1/admin/modelo-de-ia — o cérebro padrão da instalação.
 *
 * Quem escolhe é quem opera a plataforma. O cliente não vê e não troca: mesma
 * doutrina da chave de IA — ele comprou atendimento, não a tarefa de comparar
 * modelos e descobrir qual chama ferramenta direito.
 *
 * O GET devolve o catálogo JUNTO com a escolha porque a tela precisa das duas
 * coisas na mesma abertura, e porque é o catálogo que diz quais modelos servem:
 * o agente do CRM opera por FERRAMENTAS (criar lead, mover card), e modelo sem
 * tool calling não dá erro — responde um texto plausível e nada chega ao funil,
 * que é o pior desfecho possível deste produto.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { chaveDePlataforma } from "@/lib/ai/runtime/agent";
import { ehProvedorSuportado } from "@/lib/ai/pontos/provedores";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({
  /**
   * `null` nos dois volta à escolha automática de antes.
   *
   * O `refine` é o mesmo de `/api/v1/ai/providers`, e faltava só aqui: sem
   * ele, um provedor que `buildModel` não conhece era gravável — a conferência
   * abaixo só olhava o catálogo, e `ai_models.provider` é texto livre desde a
   * 0127. O sintoma seria `unsupported_provider` em todo agente novo, dias
   * depois, longe desta tela.
   */
  provider: z
    .string()
    .min(1)
    .max(60)
    .refine(ehProvedorSuportado, { message: "Provedor que o sistema não sabe executar." })
    .nullable(),
  model_id: z.string().min(1).max(200).nullable(),
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

  const [{ data: escolha }, { data: modelos, error }] = await Promise.all([
    admin.from("platform_ia").select("provider, model_id, updated_at").eq("id", 1).maybeSingle(),
    admin
      .from("ai_models")
      .select(
        "provider, model_id, display_name, supports_tools, input_price_per_million_cents, output_price_per_million_cents, is_default_for_provider",
      )
      .is("deprecated_at", null)
      .order("provider", { ascending: true })
      .order("model_id", { ascending: true }),
  ]);

  if (error) return fail("db_error", "Falha ao ler o catálogo de modelos.", 500, { requestId });

  /**
   * QUAIS OPERADORAS ESTA INSTALAÇÃO SABE EXECUTAR — e por que isso vem junto.
   *
   * Escolher um modelo de uma operadora sem chave não dá erro AQUI: grava
   * bonito. O erro aparece dias depois, na implantação seguinte, quando
   * `lib/ai/agents/first-publication.ts` não acha credencial da organização nem
   * chave da instalação e devolve `reason: "sem_chave"` — e o cliente novo
   * termina o wizard com "Atendente criado, mas ainda não está no ar".
   *
   * Esta tela diz, na primeira linha, que vale para TODO CLIENTE NOVO. Cliente
   * novo não tem credencial própria: para ele, a chave da instalação é a única.
   * Então a pergunta "esta operadora funciona aqui?" é a mesma pergunta que a
   * tela responde, e escondê-la seria oferecer uma escolha que quebra a
   * publicação de todo mundo que entrar depois.
   *
   * Só o BOOLEANO sai — nunca a chave, nem parte dela. E a rota já exige admin
   * de plataforma.
   */
  const operadorasDoCatalogo = [
    ...new Set((modelos ?? []).map((m) => (m as { provider: string }).provider)),
  ];
  const chaveDaInstalacao = Object.fromEntries(
    operadorasDoCatalogo.map((p) => [p, chaveDePlataforma(p) !== null]),
  );

  return ok(
    {
      escolha: escolha ?? null,
      /**
       * `{ openai: true, google: false, ... }`. `false` NÃO quer dizer "não
       * dá para usar": uma organização pode ter credencial própria validada, e
       * aí o agente dela funciona. Quer dizer "cliente NOVO não publica com
       * esta operadora", que é o que esta tela decide.
       */
      chave_da_instalacao: chaveDaInstalacao,
      /**
       * DOIS filtros, e os dois pela mesma razão: só chega à tela o que
       * realmente funciona se for escolhido.
       *
       * 1. SÓ OS QUE CHAMAM FERRAMENTA. Mostrar os outros com um aviso ao lado
       *    seria oferecer um caminho que termina em agente mudo para o funil —
       *    e a tela do painel é operada com pressa, entre uma implantação e
       *    outra.
       *
       * 2. SÓ OS PROVEDORES QUE O RUNTIME SABE EXECUTAR. `ai_models.provider`
       *    é texto livre desde a 0127 (o sincronizador da OpenRouter escreve
       *    nela), então uma linha com um provedor que `buildModel` não conhece
       *    pode aparecer aqui amanhã, sozinha. Escolhê-la grava 200 e depois
       *    lança `unsupported_provider` em TODO agente novo — e a rota de
       *    credenciais (`/api/v1/ai/providers`) já se protege assim, com o
       *    mesmo `ehProvedorSuportado`. Esta era a única porta de escrita de
       *    provedor sem essa guarda.
       */
      modelos: (modelos ?? [])
        .filter((m) => (m as { supports_tools?: boolean }).supports_tools)
        .filter((m) => ehProvedorSuportado((m as { provider: string }).provider)),
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

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Escolha inválida.", 422, { requestId });

  const { provider, model_id } = parsed.data;
  // Os dois juntos ou nenhum — o mesmo CHECK que o banco cobra. A frase aqui
  // existe para a tela não receber um 23514 cru.
  if ((provider === null) !== (model_id === null)) {
    return fail("validation_failed", "Informe provedor e modelo juntos.", 422, { requestId });
  }

  const admin = createAdminClient();

  if (provider && model_id) {
    // Conferir ANTES de gravar: um id que não está no catálogo (ou que não
    // chama ferramenta) só apareceria como defeito lá na frente, quando um
    // cliente novo publicasse um agente que conversa e não trabalha.
    const { data: existe } = await admin
      .from("ai_models")
      .select("model_id")
      .eq("provider", provider)
      .eq("model_id", model_id)
      .eq("supports_tools", true)
      .is("deprecated_at", null)
      .maybeSingle();
    if (!existe) {
      return fail("validation_failed", "Esse modelo não está no catálogo ou não usa ferramentas.", 422, {
        requestId,
      });
    }
  }

  const { error } = await admin.from("platform_ia").upsert(
    {
      id: 1,
      provider,
      model_id,
      updated_at: new Date().toISOString(),
      updated_by: ctx.user.id,
    },
    { onConflict: "id" },
  );
  if (error) return fail("db_error", error.message, 500, { requestId });

  void audit({
    action: "platform.modelo_de_ia_alterado",
    actorUserId: ctx.user.id,
    // Sem organização: a escolha vale para a instalação inteira, e carimbar o
    // tenant ativo faria a auditoria dizer que mudamos algo "dentro" de um
    // cliente qualquer que estivesse selecionado na hora.
    organizationId: null,
    requestId,
    metadata: { provider, model_id },
  });

  return ok({ provider, model_id }, { requestId });
}
