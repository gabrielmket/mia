/**
 * FORK MIA (MIA-358) — as VERSÕES de um agente de IA pelo MCP de plataforma:
 * ver o histórico e voltar o agente para uma versão anterior.
 *
 * ── Nenhuma regra nova de reversão ────────────────────────────────────────
 *
 * Voltar é `reverterParaVersao` (`lib/ai/agents/edicao.ts`), o mesmo do botão
 * "Reverter" da tela e do `crm_rollback_ai_agent` do MCP da empresa: copia a
 * versão de destino num rascunho novo e o publica, e se a publicação recusa o
 * rascunho copiado é apagado (o Histórico não ganha lixo). A cópia fica com a
 * IA ATUAL do agente, não com a da versão antiga (a trava da IA, `trava-da-ia.ts`).
 * O que este módulo acrescenta é o que um agente implantador precisa: achar o
 * agente e a versão pelo que ele conhece (nome e número), a recusa que ensina,
 * e a reexecução segura (voltar de novo para o mesmo conteúdo não cria versão).
 *
 * ── Quem publicou ─────────────────────────────────────────────────────────
 *
 * `ai_agent_versions` não guarda quem publicou (só `created_by`, quem criou). A
 * resposta sai da trilha que já existe, `api_audit_log` (`ai_agent.published` e
 * `ai_agent.reverted` do agente), sem migration. Versão publicada antes de a
 * trilha existir, ou por um caminho que não a grava, volta com `publicada_por: null`.
 *
 * ⚠️ A organização vem de `c.orgId` (já conferida), e toda consulta filtra por
 * ela: o cliente é o `service_role`, sem RLS embaixo. Agente e versão de outra
 * empresa não são achados, e a recusa é a de "não existe".
 */
import { reverterParaVersao, type AtorDaEdicao } from "@/lib/ai/agents/edicao";
import { escolherVersoesDaTela } from "@/lib/ai/agents/versoes-da-tela";
import { CAMPOS_DA_IA, FREIOS_DE_GASTO } from "@/lib/ai/trava-da-ia";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

import { diferencasEntreVersoes, FRASE_DO_CODIGO, lerAgentes, lerVersoes, type LinhaDaVersao, type LinhaDoAgente } from "./agente";
import { acharPorNomeOuId, type Implantacao } from "./base";

/** A IA é da plataforma e a reversão não a volta: não conta como diferença entre versões. */
const CAMPOS_QUE_A_REVERSAO_NAO_VOLTA: readonly string[] = [...CAMPOS_DA_IA, ...FREIOS_DE_GASTO];

export const LIMITE_PADRAO_DE_VERSOES = 20;
export const LIMITE_MAXIMO_DE_VERSOES = 100;

export type SituacaoDaVersao = "publicada" | "rascunho" | "rascunho_superado" | "antiga";

/** Por onde a publicação veio, lido da trilha. */
export type CaminhoDaPublicacao = "mcp_de_plataforma" | "token_da_empresa" | "tela";

export interface QuemPublicou {
  por: CaminhoDaPublicacao;
  /** A pessoa: quem clicou na tela, ou quem criou o token de plataforma. */
  pessoa: { id: string; email: string | null } | null;
  quando: string;
}

export interface VersaoNoHistorico {
  id: string;
  numero: number;
  situacao: SituacaoDaVersao;
  criada_em: string | null;
  publicada_em: string | null;
  publicada_por: QuemPublicou | null;
  /** Quando a versão nasceu de uma reversão: o número da versão copiada. */
  copia_da_versao: number | null;
  /** O tamanho do prompt, em caracteres. O texto inteiro sai em plataforma_ver_agentes. */
  tamanho_do_prompt: number;
  /** O que esta versão tem de diferente da publicada (`[]` = o mesmo conteúdo; `null` na publicada ou sem publicada). */
  diferente_da_publicada: string[] | null;
}

interface LinhaDaTrilha {
  action: string;
  created_at: string;
  actor_user_id: string | null;
  actor_api_token_id: string | null;
  metadata: Record<string, unknown> | null;
}

function acharAgente(agentes: LinhaDoAgente[], referencia: string): LinhaDoAgente {
  return acharPorNomeOuId(
    agentes.filter((a) => !a.archived_at),
    referencia,
    (a) => a.name,
    { singular: "o agente", comoListar: "Use plataforma_ver_agentes para ver os agentes da organização." },
  );
}

function situacaoDa(v: LinhaDaVersao, agente: LinhaDoAgente, rascunhoVigenteId: string | null): SituacaoDaVersao {
  if (v.id === agente.published_version_id) return "publicada";
  if (v.id === rascunhoVigenteId) return "rascunho";
  if (v.status === "draft") return "rascunho_superado";
  return "antiga";
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

/** As publicações e reversões do agente, da mais nova para a mais antiga. */
async function lerTrilhaDoAgente(c: Implantacao, agenteId: string): Promise<LinhaDaTrilha[]> {
  const { data, error } = await c.admin
    .from("api_audit_log")
    .select("action, created_at, actor_user_id, actor_api_token_id, metadata")
    .eq("organization_id", c.orgId)
    .eq("resource_type", "ai_agent")
    .eq("resource_id", agenteId)
    .in("action", ["ai_agent.published", "ai_agent.reverted"])
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`não consegui ler a trilha de publicações do agente: ${error.message}`);
  return (data ?? []) as LinhaDaTrilha[];
}

async function emailDe(c: Implantacao, userId: string, cache: Map<string, string | null>): Promise<string | null> {
  if (cache.has(userId)) return cache.get(userId) ?? null;
  let email: string | null = null;
  try {
    const { data } = await c.admin.auth.admin.getUserById(userId);
    email = data?.user?.email?.trim().toLowerCase() ?? null;
  } catch {
    // Sem o e-mail, a resposta ainda diz o caminho e o id.
  }
  cache.set(userId, email);
  return email;
}

// ---------------------------------------------------------------------------
// ver as versões
// ---------------------------------------------------------------------------

export async function verVersoesDoAgente(
  c: Implantacao,
  pedido: { agente: string; limite?: number },
): Promise<{
  agente: { id: string; nome: string; pausado: boolean };
  versao_publicada: number | null;
  total_de_versoes: number;
  versoes: VersaoNoHistorico[];
  avisos: string[];
}> {
  const agente = acharAgente(await lerAgentes(c.admin, c.orgId), pedido.agente);
  const todas = await lerVersoes(c.admin, c.orgId, agente.id);
  const tela = escolherVersoesDaTela(todas, agente.published_version_id);
  const publicada = todas.find((v) => v.id === agente.published_version_id) ?? null;
  const limite = Math.min(Math.max(pedido.limite ?? LIMITE_PADRAO_DE_VERSOES, 1), LIMITE_MAXIMO_DE_VERSOES);
  const mostradas = todas.slice(0, limite);

  // Quem publicou cada versão: a linha mais nova da trilha que a cita.
  const trilha = await lerTrilhaDoAgente(c, agente.id);
  const numeroPorId = new Map(todas.map((v) => [v.id, v.version_number]));
  const publicacao = new Map<string, LinhaDaTrilha>();
  const copiaDe = new Map<string, number | null>();
  for (const linha of trilha) {
    const m = linha.metadata ?? {};
    const versaoId = linha.action === "ai_agent.reverted" ? texto(m.new_version_id) : texto(m.version_id);
    if (!versaoId || publicacao.has(versaoId)) continue;
    publicacao.set(versaoId, linha);
    if (linha.action === "ai_agent.reverted") {
      const origem = texto(m.from_version_id);
      copiaDe.set(versaoId, origem ? (numeroPorId.get(origem) ?? null) : null);
    }
  }

  const emails = new Map<string, string | null>();
  const versoes: VersaoNoHistorico[] = [];
  for (const v of mostradas) {
    const linha = publicacao.get(v.id);
    let publicadaPor: QuemPublicou | null = null;
    if (linha) {
      const por: CaminhoDaPublicacao =
        linha.metadata?.via === "mcp_plataforma" ? "mcp_de_plataforma" : linha.actor_api_token_id ? "token_da_empresa" : "tela";
      publicadaPor = {
        por,
        pessoa: linha.actor_user_id ? { id: linha.actor_user_id, email: await emailDe(c, linha.actor_user_id, emails) } : null,
        quando: linha.created_at,
      };
    }
    const situacao = situacaoDa(v, agente, tela.draft?.id ?? null);
    versoes.push({
      id: v.id,
      numero: v.version_number,
      situacao,
      criada_em: texto((v as Record<string, unknown>).created_at),
      publicada_em: v.published_at ?? publicadaPor?.quando ?? null,
      publicada_por: publicadaPor,
      copia_da_versao: copiaDe.get(v.id) ?? null,
      tamanho_do_prompt: typeof v.system_prompt === "string" ? v.system_prompt.length : 0,
      diferente_da_publicada:
        publicada && situacao !== "publicada"
          ? diferencasEntreVersoes(publicada as Record<string, unknown>, v as Record<string, unknown>, CAMPOS_QUE_A_REVERSAO_NAO_VOLTA)
          : null,
    });
  }

  const avisos: string[] = [];
  if (todas.length > mostradas.length) {
    avisos.push(`Mostrando as ${mostradas.length} versões mais novas de ${todas.length}. Para ver mais, chame com \`limite\` (até ${LIMITE_MAXIMO_DE_VERSOES}).`);
  }
  if (!publicada) avisos.push(`O agente «${agente.name}» não tem versão publicada: não há para onde voltar. Para pôr no ar, use plataforma_publicar_agente.`);
  if (agente.paused_at) avisos.push("O agente está PAUSADO: a versão publicada não responde até plataforma_pausar_agente com `pausar: false`.");

  return {
    agente: { id: agente.id, nome: agente.name, pausado: Boolean(agente.paused_at) },
    versao_publicada: publicada?.version_number ?? null,
    total_de_versoes: todas.length,
    versoes,
    avisos,
  };
}

// ---------------------------------------------------------------------------
// voltar para uma versão anterior
// ---------------------------------------------------------------------------

export interface AgenteRevertido {
  agente: { id: string; nome: string };
  desfecho: "reverteu" | "ja_estava";
  /** O número da versão cujo conteúdo voltou ao ar. */
  copiada_da_versao: number;
  /** A versão que está no ar agora (a nova, ou a que já estava). */
  versao_publicada: { id: string; numero: number };
  /** A que estava no ar antes da chamada. */
  versao_anterior: { id: string; numero: number } | null;
  /** O que mudou no atendimento com a troca, nas palavras de quem configura. */
  mudancas: string[];
  avisos: string[];
}

export async function reverterAgente(
  c: Implantacao,
  pedido: { agente: string; para_versao: number },
): Promise<AgenteRevertido> {
  const agente = acharAgente(await lerAgentes(c.admin, c.orgId), pedido.agente);
  const versoes = await lerVersoes(c.admin, c.orgId, agente.id);
  const tela = escolherVersoesDaTela(versoes, agente.published_version_id);
  const publicada = versoes.find((v) => v.id === agente.published_version_id) ?? null;
  const origem = versoes.find((v) => v.version_number === pedido.para_versao) ?? null;

  if (!origem) {
    const numeros = versoes.map((v) => `v${v.version_number}`).slice(0, 30);
    throw new Recusa(
      `O agente «${agente.name}» não tem a versão ${pedido.para_versao}. ` +
        (numeros.length > 0 ? `As que existem: ${numeros.join(", ")}. ` : "Ele ainda não tem versão nenhuma. ") +
        "Use plataforma_ver_versoes_do_agente para ver cada uma com a situação e quem publicou.",
    );
  }
  if (!publicada) {
    throw new Recusa(
      `O agente «${agente.name}» não tem versão publicada: voltar é desfazer uma publicação, e não há o que desfazer. ` +
        "Para pôr o rascunho no ar, use plataforma_publicar_agente.",
    );
  }
  if (origem.status === "draft") {
    throw new Recusa(
      `A versão ${origem.version_number} do agente «${agente.name}» é um RASCUNHO: nunca foi ao ar, então não é uma versão anterior. ` +
        "Para publicar o rascunho vigente, use plataforma_publicar_agente; para voltar, escolha uma versão que já esteve no ar (plataforma_ver_versoes_do_agente).",
    );
  }

  const anterior = { id: publicada.id, numero: publicada.version_number };
  const avisos: string[] = [];
  if (agente.paused_at) {
    avisos.push("O agente está PAUSADO: a versão está no ar, e ele só responde depois de plataforma_pausar_agente com `pausar: false`.");
  }

  // Reexecução segura: o que está no ar já é o conteúdo pedido (a própria
  // versão, ou uma cópia dela de uma reversão anterior). Nada é gravado.
  const mudancas = diferencasEntreVersoes(
    publicada as Record<string, unknown>,
    origem as Record<string, unknown>,
    CAMPOS_QUE_A_REVERSAO_NAO_VOLTA,
  );
  if (origem.id === publicada.id || mudancas.length === 0) {
    return {
      agente: { id: agente.id, nome: agente.name },
      desfecho: "ja_estava",
      copiada_da_versao: origem.version_number,
      versao_publicada: anterior,
      versao_anterior: anterior,
      mudancas: [],
      avisos,
    };
  }

  // O ator: quem criou o token, como no resto da implantação, marcado como
  // vindo do MCP de plataforma. Sem `quemPede`, a trava da IA responde "não
  // escolhe IA": a cópia herda a IA atual do agente.
  const ator: AtorDaEdicao = { userId: c.autorUserId, apiTokenId: null, requestId: c.requestId, via: "mcp_plataforma" };
  const r = await reverterParaVersao(c.admin, { orgId: c.orgId, agentId: agente.id, versionId: origem.id, ator });
  if (!r.ok) {
    const frase = FRASE_DO_CODIGO[r.error];
    if (frase) throw new Recusa(`Não voltei o agente «${agente.name}» para a v${origem.version_number}: ${frase.o_que}. ${frase.como}`);
    if (r.error === "tool_id_invalid") {
      const invalidas = ((r.details as { invalid?: string[] } | undefined)?.invalid ?? []).join(", ");
      throw new Recusa(
        `A v${origem.version_number} do agente «${agente.name}» tem capacidades que não existem mais no catálogo (${invalidas}), e voltar para ela não é possível. ` +
          "Monte um rascunho com plataforma_garantir_agente (com o prompt e os `pacotes`) e publique.",
      );
    }
    if (r.error === "not_found" || r.error === "version_not_found") {
      throw new Recusa(`O agente «${agente.name}» ou a v${origem.version_number} sumiu no meio da chamada. Confira com plataforma_ver_versoes_do_agente.`);
    }
    if (r.message) throw new Recusa(`Não voltei o agente «${agente.name}» para a v${origem.version_number}: ${r.message}`);
    throw new Error(`não consegui voltar o agente para a versão ${origem.version_number}: ${r.error}`);
  }

  if (tela.draft) {
    avisos.push(
      `O rascunho v${tela.draft.version_number}, que não tinha sido publicado, ficou para trás (a versão nova tem número maior) e a tela não o abre mais. ` +
        "Ele continua no Histórico; se havia algo nele a aproveitar, grave de novo com plataforma_garantir_agente.",
    );
  }
  if (origem.channel_session_id !== publicada.channel_session_id) {
    avisos.push(`A v${origem.version_number} atendia por outro número: o agente voltou a atender pelo número dela.`);
  }

  return {
    agente: { id: agente.id, nome: agente.name },
    desfecho: "reverteu",
    copiada_da_versao: origem.version_number,
    versao_publicada: { id: r.data.new_version_id, numero: r.data.new_version_number },
    versao_anterior: anterior,
    mudancas,
    avisos,
  };
}
