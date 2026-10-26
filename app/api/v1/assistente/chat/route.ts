/**
 * FORK MIA (.88) — GET/POST /api/v1/assistente/chat: o assistente da MIA.
 *
 *   GET  ?conversa=<id>  o histórico da pessoa (as conversas e as mensagens de
 *                        uma), o uso do dia, o resumo da manhã e os chamados dela.
 *   POST                 uma pergunta: `{ turn_id, pergunta, conversa_id?, tela,
 *                        ultima_recusa? }` → a resposta, com o "de onde veio" e
 *                        os botões.
 *
 * É a rota da fase 1 da spec do upstream (#2860): sessão-cookie, sem Bearer
 * (nenhuma entrada em `public-paths`), `requireRole`, Zod e `ok`/`fail`.
 *
 * ── A regra inegociável ─────────────────────────────────────────────────────
 *
 * O TURNO lê o CRM com o cliente da SESSÃO (`createClient`), e a RLS e o papel
 * filtram como nas telas. O cliente de serviço só aparece aqui em duas
 * preparações FORA do turno, ambas as mesmas que o produto já faz: o diretório
 * de nomes da equipe (`lib/assistente/diretorio.ts`, o de `/team/assignable`) e
 * o pool do seam de modelo (telemetria e orçamento, `lib/assistente/modelo.ts`).
 * O histórico do assistente também é gravado pela sessão (RLS da 9050).
 *
 * ── O limite do dia ─────────────────────────────────────────────────────────
 *
 * A IA é da plataforma. 50 perguntas por pessoa por dia (ajustável por empresa
 * pelo MCP de plataforma), contadas no banco; mais um teto curto por minuto
 * contra o clique em rajada.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { origemPublicaDoPedido } from "@/lib/agenda/microsoft/config";
import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { LlmNotConfiguredError } from "@/lib/agent-engine/edge/llm/credentials";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { lerConfigDoAssistente, papelUsaOAssistente, usoDoDia } from "@/lib/assistente/config";
import { diretorioDaEquipe } from "@/lib/assistente/diretorio";
import { chamadaDoAssistente } from "@/lib/assistente/modelo";
import { rotuloDaTela, telasParaOPapel } from "@/lib/assistente/telas";
import { caminhoDaTela, type RespostaDoAssistente } from "@/lib/assistente/tipos";
import { responderNoAssistente } from "@/lib/assistente/turno";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { fusoUtilizavel } from "@/lib/tempo/fusos";

export const dynamic = "force-dynamic";

const TETO_POR_MINUTO = 8;
const JANELA_SEGUNDOS = 60;

const COLUNAS_DA_MENSAGEM =
  "id, conversa_id, tipo, texto, tela, fontes, acoes, sem_resposta, erro, created_at";

const corpoDoPost = z
  .object({
    turn_id: z.string().uuid(),
    pergunta: z.string().trim().min(2).max(1000),
    conversa_id: z.string().uuid().nullish(),
    tela: z.object({ caminho: z.string().max(400) }).strict().nullish(),
    ultima_recusa: z
      .object({
        mensagem: z.string().max(300).nullish(),
        codigo: z.string().max(80).nullish(),
        status: z.number().int().min(100).max(599).nullish(),
      })
      .strict()
      .nullish(),
  })
  .strict();

const consultaDoGet = z.object({ conversa: z.string().uuid().optional() }).strict();

type Sessao = Awaited<ReturnType<typeof createClient>>;

/** O fuso e o nome da empresa, pela sessão. */
async function daEmpresa(db: Sessao, orgId: string): Promise<{ fuso: string; nome: string | null }> {
  const { data } = await db.from("organizations").select("timezone, display_name").eq("id", orgId).maybeSingle();
  const linha = data as { timezone?: string | null; display_name?: string | null } | null;
  return { fuso: fusoUtilizavel(linha?.timezone), nome: linha?.display_name ?? null };
}

/** O resumo da manhã desta pessoa: a escolha dela, ou o padrão da empresa. */
async function resumoDaManhaLigado(db: Sessao, orgId: string, userId: string, padrao: boolean): Promise<boolean> {
  const { data } = await db
    .from("mia_assistente_preferencias")
    .select("resumo_da_manha")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  const linha = data as { resumo_da_manha?: boolean } | null;
  return typeof linha?.resumo_da_manha === "boolean" ? linha.resumo_da_manha : padrao;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "mia_assistente" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;
  const userId = authz.user.id;

  const consulta = consultaDoGet.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  if (!consulta.success) {
    return fail("validation_failed", t("Filtro inválido."), 422, { requestId, details: consulta.error.flatten() });
  }

  const db = await createClient();
  const config = await lerConfigDoAssistente(db, orgId);
  const empresa = await daEmpresa(db, orgId);
  const agora = new Date();

  const { data: conversasBrutas, error: erroConversas } = await db
    .from("mia_assistente_conversas")
    .select("id, titulo, origem, created_at, ultima_em")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .order("ultima_em", { ascending: false })
    .limit(40);
  if (erroConversas) {
    return fail("unavailable", t("Não deu para abrir o histórico do assistente agora."), 503, { requestId });
  }
  const conversas = (conversasBrutas ?? []) as Array<{ id: string }>;
  const escolhida = consulta.data.conversa ?? null;
  const conversaId = escolhida && conversas.some((c) => c.id === escolhida) ? escolhida : null;

  let mensagens: unknown[] = [];
  if (conversaId) {
    const { data } = await db
      .from("mia_assistente_mensagens")
      .select(COLUNAS_DA_MENSAGEM)
      .eq("organization_id", orgId)
      .eq("conversa_id", conversaId)
      .order("created_at", { ascending: true })
      .limit(200);
    mensagens = data ?? [];
  }

  const { data: chamados } = await db
    .from("mia_chamados")
    .select("id, numero, tipo, texto, situacao, resposta, respondido_em, demonstracao, created_at, user_id")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  const uso = await usoDoDia(db, {
    organizationId: orgId,
    userId,
    fuso: empresa.fuso,
    agora,
    limite: config.perguntasPorPessoaPorDia,
  });

  return ok(
    {
      disponivel: papelUsaOAssistente(config, authz.org.role),
      papel: authz.org.role,
      conversas: conversasBrutas ?? [],
      conversa_id: conversaId,
      mensagens,
      uso,
      resumo_da_manha: await resumoDaManhaLigado(db, orgId, userId, config.resumoDaManhaPadrao),
      chamados: chamados ?? [],
    },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  // PRIMEIRO passo: o acompanhamento somente leitura não grava histórico em nome
  // de ninguém nem gasta a IA da empresa acompanhada.
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "mia_assistente" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;
  const userId = authz.user.id;
  const papel = authz.org.role;

  let bruto: unknown;
  try {
    bruto = await req.json();
  } catch {
    return fail("invalid_request", t("Body inválido."), 400, { requestId });
  }
  const parsed = corpoDoPost.safeParse(bruto);
  if (!parsed.success) {
    return fail("validation_failed", t("Body inválido."), 422, { requestId, details: parsed.error.flatten() });
  }
  const { turn_id: turnId, pergunta } = parsed.data;

  const db = await createClient();
  const config = await lerConfigDoAssistente(db, orgId);
  if (!papelUsaOAssistente(config, papel)) {
    return fail("forbidden_role", t("O assistente está desligado para o seu papel nesta empresa."), 403, { requestId });
  }

  const agora = new Date();
  const empresa = await daEmpresa(db, orgId);

  // ── o limite do dia, contado no banco ──
  const uso = await usoDoDia(db, {
    organizationId: orgId,
    userId,
    fuso: empresa.fuso,
    agora,
    limite: config.perguntasPorPessoaPorDia,
  });
  if (uso.restantes <= 0) {
    return fail(
      "rate_limited",
      t("Você chegou ao limite de perguntas ao assistente por hoje. Amanhã ele volta a responder."),
      429,
      { requestId, details: { limite: uso.limite, feitas: uso.feitas }, headers: { "Retry-After": "3600" } },
    );
  }
  const rajada = await checkRateLimit(`assistente:${userId}`, TETO_POR_MINUTO, JANELA_SEGUNDOS);
  if (!rajada.allowed) {
    return fail("rate_limited", t("Muitas perguntas seguidas. Tente em um minuto."), 429, {
      requestId,
      headers: { "Retry-After": String(JANELA_SEGUNDOS) },
    });
  }

  const caminho = caminhoDaTela(parsed.data.tela?.caminho) ?? "/app";
  const tela = { caminho, rotulo: rotuloDaTela(caminho) };

  // ── a conversa: a escolhida (se for da pessoa) ou uma nova ──
  let conversaId = parsed.data.conversa_id ?? null;
  if (conversaId) {
    const { data } = await db
      .from("mia_assistente_conversas")
      .select("id")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .eq("id", conversaId)
      .maybeSingle();
    if (!data) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  } else {
    const titulo = pergunta.length > 80 ? `${pergunta.slice(0, 79)}…` : pergunta;
    const { data, error } = await db
      .from("mia_assistente_conversas")
      .insert({ organization_id: orgId, user_id: userId, titulo, origem: "pergunta" })
      .select("id")
      .single();
    if (error || !data) {
      return fail("unavailable", t("Não deu para abrir a conversa com o assistente agora."), 503, { requestId });
    }
    conversaId = (data as { id: string }).id;
  }

  // ── a pergunta é gravada ANTES da chamada (rastro e idempotência) ──
  const { data: perguntaGravada, error: erroPergunta } = await db
    .from("mia_assistente_mensagens")
    .insert({
      organization_id: orgId,
      conversa_id: conversaId,
      user_id: userId,
      tipo: "pergunta",
      texto: pergunta,
      turn_id: turnId,
      tela: caminho,
    })
    .select(COLUNAS_DA_MENSAGEM)
    .single();
  if (erroPergunta) {
    if ((erroPergunta as { code?: string }).code === "23505") {
      // Replay (clique duplo, retentativa): a resposta sai do banco, sem segunda chamada paga.
      const { data: turno } = await db
        .from("mia_assistente_mensagens")
        .select(COLUNAS_DA_MENSAGEM)
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .eq("turn_id", turnId)
        .order("created_at", { ascending: true });
      return ok({ conversa_id: conversaId, turno: turno ?? [], replay: true, uso }, { requestId });
    }
    return fail("unavailable", t("Não deu para guardar a pergunta agora."), 503, { requestId });
  }
  const perguntaId = (perguntaGravada as { id: string }).id;

  const { data: historicoBruto } = await db
    .from("mia_assistente_mensagens")
    .select("tipo, texto, created_at")
    .eq("organization_id", orgId)
    .eq("conversa_id", conversaId)
    .neq("id", perguntaId)
    .order("created_at", { ascending: false })
    .limit(12);
  const historico = ((historicoBruto ?? []) as Array<{ tipo: string; texto: string }>).reverse();

  let resposta: RespostaDoAssistente | null = null;
  let erroCodigo: string | null = null;
  try {
    const deps = requestTurnDeps();
    const equipe = await diretorioDaEquipe(orgId);
    const telas = telasParaOPapel({
      papel,
      interfaceSettings: authz.org.interface_settings,
      modulos: authz.org.modulos,
    });
    resposta = await responderNoAssistente(
      {
        db,
        organizationId: orgId,
        nomeDaEmpresa: empresa.nome ?? authz.org.name ?? null,
        userId,
        primeiroNome: (authz.user.full_name ?? "").trim().split(/\s+/)[0] ?? "",
        papel,
        idioma: authz.user.idioma,
        fuso: empresa.fuso,
        agora,
        tela,
        telas,
        // FORK MIA (.89): quem opera a plataforma abre as telas do dono da instalação
        // (servidor MCP externo, atualização), e a ajuda diz "você pode" para ele.
        daPlataforma: authz.user.is_platform_admin && !authz.user.support,
        // O endereço que a pessoa usa no navegador: o passo do MCP da MIA cita "<endereço>/api/mcp".
        enderecoDoSistema: origemPublicaDoPedido(req.headers),
        equipe,
        historico,
        pergunta,
        ultimaRecusa: parsed.data.ultima_recusa
          ? {
              mensagem: parsed.data.ultima_recusa.mensagem ?? null,
              codigo: parsed.data.ultima_recusa.codigo ?? null,
              status: parsed.data.ultima_recusa.status ?? null,
            }
          : null,
      },
      { chamarModelo: chamadaDoAssistente(getRequestPool(), deps.llmCfg, { registry: deps.registry, log: deps.log }) },
    );
  } catch (erro) {
    erroCodigo = erro instanceof LlmNotConfiguredError ? "ia_nao_configurada" : "modelo_nao_respondeu";
    logger.error("[assistente] o turno não respondeu", {
      requestId,
      organizationId: orgId,
      motivo: erroCodigo,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
  }

  const texto =
    resposta?.texto ??
    (erroCodigo === "ia_nao_configurada"
      ? t("A IA do assistente ainda não está configurada nesta instalação. Avise a Time Company.")
      : t("Não consegui responder agora. Tente de novo em instantes; os números continuam nas telas."));

  const { data: respostaGravada } = await db
    .from("mia_assistente_mensagens")
    .insert({
      organization_id: orgId,
      conversa_id: conversaId,
      user_id: userId,
      tipo: "resposta",
      texto,
      turn_id: turnId,
      tela: caminho,
      fontes: resposta?.fontes ?? [],
      acoes: resposta?.acoes ?? [],
      erro: erroCodigo,
      contatos: resposta?.contatos ?? [],
      llm_call_id: resposta?.llmCallId ?? null,
    })
    .select(COLUNAS_DA_MENSAGEM)
    .single();

  // A pergunta sem resposta entra na lista do administrador; os contatos citados
  // marcam também a pergunta, para a anonimização alcançá-la (9051).
  if (resposta && (resposta.semResposta || resposta.contatos.length > 0)) {
    await db
      .from("mia_assistente_mensagens")
      .update({ sem_resposta: resposta.semResposta, contatos: resposta.contatos })
      .eq("organization_id", orgId)
      .eq("id", perguntaId);
  }
  await db
    .from("mia_assistente_conversas")
    .update({ ultima_em: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", conversaId);

  // SEM a pergunta e SEM a resposta no metadata: `api_audit_log` não sai pela
  // cascata de LGPD. Só o que rodou e como terminou.
  void audit({
    action: "assistente.perguntado",
    actorUserId: userId,
    organizationId: orgId,
    resourceType: "mia_assistente_conversas",
    resourceId: conversaId,
    requestId,
    metadata: {
      turn_id: turnId,
      ferramentas: resposta?.ferramentas ?? [],
      sem_resposta: resposta?.semResposta ?? false,
      respondeu: erroCodigo === null,
      erro: erroCodigo,
      llm_call_id: resposta?.llmCallId ?? null,
    },
  });

  return ok(
    {
      conversa_id: conversaId,
      turno: [perguntaGravada, respostaGravada].filter(Boolean),
      replay: false,
      uso: { ...uso, feitas: uso.feitas + 1, restantes: Math.max(0, uso.restantes - 1) },
    },
    { requestId },
  );
}
