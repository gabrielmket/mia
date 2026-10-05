/**
 * FORK MIA — GARANTIR, PUBLICAR e PAUSAR o agente de IA de um cliente.
 *
 * ── Quantos agentes uma organização pode ter, e quem atende ───────────────
 *
 * Não é "um agente por organização". Uma organização tem QUANTOS agentes
 * quiser (o único limite do banco é o nome, `ai_agents_name_unique`). Quem
 * decide qual deles responde uma mensagem é o motor, nesta ordem
 * (`lib/agent-engine/agent/agent-config.ts`, `lib/ai/agents/agente-da-conversa.ts`):
 *
 *   1. a conversa já "grudou" num agente (`conversations.active_ai_agent_id`,
 *      gravado pelo roteador de intenção): é ele;
 *   2. senão, o agente cuja versão PUBLICADA aponta para o NÚMERO em que a
 *      mensagem chegou (`ai_agent_versions.channel_session_id`). Com mais de um
 *      no mesmo número, vence a maior `priority` e, no empate, o mais antigo;
 *   3. dois ou mais agentes no MESMO número só dividem o atendimento de
 *      verdade com um roteador (IA › Roteadores), que classifica a intenção e
 *      escolhe. O roteador tem ferramenta própria desde a .73
 *      (`lib/implantacao/roteador.ts`): nasce desligado, e ligar é pôr no ar.
 *
 * Então o desenho de implantação é: um agente por número, ou vários agentes em
 * números diferentes. Vários no mesmo número pedem roteador.
 *
 * ── O caminho da tela que isto reusa ──────────────────────────────────────
 *
 *   agente novo      `agentMcpCreateSchema` + `mcpAgentDraftRecords` + a
 *                    conferência de escopo: `POST /api/v1/ai/agents`
 *   versão nova      `versionCreateSchema`, a conferência da chave da
 *                    instalação e do escopo: `POST /api/v1/ai/agents/[id]/versions`
 *   editar rascunho  `versionPatchSchema`: `PATCH .../versions/[vid]`
 *   publicar         `iaPodeIrAoAr` + `publishAgentVersion` (a função do banco
 *                    `fn_publish_ai_agent_version`): `POST .../publish`
 *   pausar           só `paused_at`: `POST .../pause`
 *   limiar de        `agentPatchSchema` e a mescla de `config` com os padrões:
 *   sentimento       `PATCH /api/v1/ai/agents/[id]` (upstream 1.71, #2216). Mora
 *                    no CADASTRO (`ai_agents.config.sentiment_threshold`), não
 *                    na versão: vale na hora, sem publicar.
 *
 * ── O aviso de fora do horário (upstream 1.72, #1926) ─────────────────────
 *
 * É um texto dentro do horário de atendimento da versão
 * (`trigger_config.filters.business_hours.notice`), conferido pelo mesmo
 * `versionCreateSchema`. Quem manda é o motor, no turno adiado, no máximo uma
 * vez por contato por período fechado. A ferramenta só grava o texto no
 * rascunho, e PRESERVA o que a tela gravou quando o pedido muda só o horário.
 *
 * ── A IA do agente é da PLATAFORMA ────────────────────────────────────────
 *
 * Nenhuma ferramenta daqui recebe provedor, modelo ou chave. O agente novo
 * nasce com o par que a plataforma definiu e com "a chave desta instalação"
 * (`credential_id: null`), e a versão nova herda a IA que o agente já usa:
 * exatamente o que `travarIaDaVersaoNova` faz para quem não escolhe IA
 * (`lib/ai/trava-da-ia.ts`). Trocar o modelo continua sendo um ato de pessoa,
 * com MFA, no painel da plataforma: um token não apresenta segundo fator, e o
 * modelo é custo na conta de quem opera a plataforma.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { mcpAgentDraftRecords } from "@/lib/ai/agents/create-draft";
import { bloqueioDePublicacao, type EstadoDaCredencial, type MotivoDeBloqueio } from "@/lib/ai/agents/bloqueio-de-publicacao";
import { validarEscopoDaVersao } from "@/lib/ai/agents/escopo";
import { estadoDoAgente } from "@/lib/ai/agents/no-ar";
import { publishAgentVersion } from "@/lib/ai/agents/publish";
import {
  agentMcpCreateSchema,
  versionCreateSchema,
  versionPatchSchema,
  type VersionInput,
} from "@/lib/ai/agents/validation";
import { escolherVersoesDaTela } from "@/lib/ai/agents/versoes-da-tela";
import { capacidadesPadraoDoOnboarding } from "@/lib/ai/agents/capacidades-padrao";
import { AGENT_CONFIG_DEFAULTS, agentPatchSchema } from "@/lib/ai/guardrails-schema";
import { DEFAULT_SENTIMENT_THRESHOLD } from "@/lib/ai/prompts/sentiment";
import { iaPodeIrAoAr, travarIaDaVersaoNova } from "@/lib/ai/trava-da-ia";
import { audit } from "@/lib/audit";
import { listSelectableChannels, type SelectableChannel } from "@/lib/channels/selectable";
import { lerAmbiente } from "@/lib/instalacao/ambiente";
import { VALID_TOOL_IDS } from "@/lib/mcp/tools/catalog";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

import {
  acharPorNomeOuId,
  chaveDoNome,
  mesmoConteudo,
  type Desfecho,
  type Implantacao,
  type OrganizacaoDaImplantacao,
} from "./base";
import { capacidadesOferecidas, montarCapacidades } from "./capacidades";

/**
 * Quem pede, para a trava da IA: NÃO escolhe. É o que faz a ferramenta herdar a
 * IA da plataforma em vez de aceitar uma do pedido.
 */
const QUEM_NAO_ESCOLHE_IA = { is_platform_admin: false, support: null } as const;

const COLUNAS_DO_AGENTE =
  "id, organization_id, name, description, kind, priority, is_active, is_default, published_version_id, paused_at, archived_at, config, created_at";

const COLUNAS_DA_VERSAO =
  "id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id, tool_ids, trigger_config, channel_session_id, max_steps, token_budget, cost_budget_cents, history_message_window, history_token_window, handoff_keywords, handoff_tool_enabled, proposal_ai_draft_enabled, cases_enabled, split_messages, split_max_chars, followup, operator_enabled, operator_model, operator_tool_ids, status, published_at, created_at, pipeline_ids, knowledge_source_ids, inbound_debounce_ms";

/** Os campos de conteúdo de uma versão: é sobre eles que se pergunta "mudou?". */
const CAMPOS_DA_VERSAO = [
  "system_prompt",
  "provider",
  "model",
  "credential_id",
  "tool_ids",
  "trigger_config",
  "channel_session_id",
  "max_steps",
  "token_budget",
  "cost_budget_cents",
  "history_message_window",
  "history_token_window",
  "handoff_keywords",
  "handoff_tool_enabled",
  "proposal_ai_draft_enabled",
  "cases_enabled",
  "split_messages",
  "split_max_chars",
  "inbound_debounce_ms",
  "followup",
  "operator_enabled",
  "operator_model",
  "operator_tool_ids",
  "pipeline_ids",
  "knowledge_source_ids",
] as const;

const ROTULO_DO_CAMPO: Record<string, string> = {
  system_prompt: "prompt",
  tool_ids: "capacidades",
  trigger_config: "horário de atendimento",
  channel_session_id: "número",
  max_steps: "máximo de passos",
  handoff_keywords: "palavras de passagem",
  handoff_tool_enabled: "passagem para humano",
  cases_enabled: "casos",
  split_messages: "dividir mensagens",
  split_max_chars: "tamanho da mensagem",
  inbound_debounce_ms: "espera por rajada",
  followup: "follow-ups",
  pipeline_ids: "funis",
  knowledge_source_ids: "materiais",
  provider: "IA da plataforma",
  model: "IA da plataforma",
  credential_id: "IA da plataforma",
  operator_model: "IA da plataforma",
};

export interface LinhaDoAgente {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  priority: number;
  is_active: boolean;
  is_default: boolean;
  published_version_id: string | null;
  paused_at: string | null;
  archived_at: string | null;
  /** Os ajustes do CADASTRO (não da versão): é onde mora o limiar de sentimento. */
  config?: Record<string, unknown> | null;
  created_at: string;
}

/** O limiar de sentimento em vigor: o gravado no cadastro, ou o padrão que o worker usa. */
export function limiarDeSentimentoDo(agente: Pick<LinhaDoAgente, "config">): number {
  const gravado = (agente.config ?? {}).sentiment_threshold;
  return typeof gravado === "number" ? gravado : DEFAULT_SENTIMENT_THRESHOLD;
}

export type LinhaDaVersao = Record<(typeof CAMPOS_DA_VERSAO)[number], unknown> & {
  id: string;
  agent_id: string;
  version_number: number;
  status: string;
  published_at: string | null;
};

export interface PedidoDeAgente {
  nome: string;
  /** Para renomear ou desambiguar. Sem ele, o agente é achado pelo nome. */
  agente_id?: string;
  descricao?: string | null;
  prioridade?: number;
  prompt?: string;
  pacotes?: string[];
  capacidades?: string[];
  /** Nomes ou ids dos funis em que o agente pode criar e mover negócio. */
  funis?: string[];
  /** Nomes ou ids dos materiais de conhecimento que o agente consulta. */
  materiais?: string[];
  followups?: {
    fluxos: string[];
    janela?: { inicio: string; fim: string; dias: number[] } | null;
  };
  palavras_de_passagem?: string[];
  passagem_para_humano?: boolean;
  casos?: boolean;
  dividir_mensagens?: boolean;
  tamanho_da_mensagem?: number;
  espera_por_rajada_ms?: number | null;
  horario_de_atendimento?: { inicio: string; fim: string; dias: number[]; fuso?: string } | null;
  /**
   * O texto mandado a quem escreve FORA do horário de atendimento (upstream
   * 1.72, #1926). `null` apaga. Ausente: fica o que está gravado.
   */
  aviso_fora_do_horario?: string | null;
  /**
   * A nota de clima (0 a 1) abaixo da qual a conversa passa para uma pessoa
   * (upstream 1.71, #2216). Mora no cadastro do agente e vale na hora.
   */
  limiar_de_sentimento?: number;
  /** Id, nome ou telefone de um número já conectado. */
  numero?: string | null;
  max_passos?: number;
}

export interface AgenteGarantido {
  agente: { id: string; nome: string; desfecho: Desfecho; mudancas: string[] };
  versao: {
    id: string;
    numero: number;
    situacao: "rascunho" | "publicada";
    desfecho: Desfecho;
    mudancas: string[];
  };
  no_ar: boolean;
  /** O que ainda impede publicar o rascunho, com quem resolve. Vazio = pode publicar. */
  falta_para_publicar: PendenciaDePublicacao[];
  avisos: string[];
}

export interface PendenciaDePublicacao {
  codigo: string;
  o_que: string;
  quem_resolve: "agente_implantador" | "humano_na_tela" | "plataforma";
  como: string;
}

// ---------------------------------------------------------------------------
// leitura
// ---------------------------------------------------------------------------

export async function lerAgentes(admin: SupabaseClient, orgId: string): Promise<LinhaDoAgente[]> {
  const { data, error } = await admin
    .from("ai_agents")
    .select(COLUNAS_DO_AGENTE)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`não consegui ler os agentes: ${error.message}`);
  return (data ?? []) as unknown as LinhaDoAgente[];
}

export async function lerVersoes(admin: SupabaseClient, orgId: string, agentId: string): Promise<LinhaDaVersao[]> {
  const { data, error } = await admin
    .from("ai_agent_versions")
    .select(COLUNAS_DA_VERSAO)
    .eq("organization_id", orgId)
    .eq("agent_id", agentId)
    .order("version_number", { ascending: false });
  if (error) throw new Error(`não consegui ler as versões do agente: ${error.message}`);
  return (data ?? []) as unknown as LinhaDaVersao[];
}

function conteudoDa(versao: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(CAMPOS_DA_VERSAO.map((campo) => [campo, versao[campo]]));
}

/** O estado da credencial escolhida, na régua de `bloqueioDePublicacao`. */
async function estadoDaCredencial(
  admin: SupabaseClient,
  orgId: string,
  credentialId: string | null,
): Promise<EstadoDaCredencial | null> {
  if (!credentialId) return null;
  const { data } = await admin
    .from("ai_provider_credentials")
    .select("is_active, validated_at")
    .eq("id", credentialId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!data) return null;
  const linha = data as { is_active: boolean; validated_at: string | null };
  if (!linha.is_active) return "inactive";
  return linha.validated_at ? "validated" : "unvalidated";
}

function explicarBloqueio(motivo: MotivoDeBloqueio): PendenciaDePublicacao {
  switch (motivo.codigo) {
    case "sem_rascunho":
      return {
        codigo: motivo.codigo,
        o_que: "Não há rascunho para publicar.",
        quem_resolve: "agente_implantador",
        como: "Chame plataforma_garantir_agente para criar ou alterar o rascunho.",
      };
    case "instalacao_sem_chave_do_provedor":
    case "sem_chave":
    case "chave_nao_utilizavel":
      return {
        codigo: motivo.codigo,
        o_que: `A instalação não tem uma chave de IA utilizável para ${motivo.provedor}.`,
        quem_resolve: "plataforma",
        como: "Quem opera a plataforma configura a chave do provedor de IA (painel Admin › IA, ou a variável de ambiente da instalação). Não é configuração do cliente.",
      };
    case "sem_numero":
      return {
        codigo: motivo.codigo,
        o_que: "O agente ainda não tem número de WhatsApp escolhido.",
        quem_resolve: "humano_na_tela",
        como: "Uma pessoa conecta o número em Conexões (/app/connections), por QR Code ou pela conta oficial. Depois chame plataforma_publicar_agente: com um único número conectado ele é escolhido sozinho; com mais de um, informe `numero`.",
      };
    case "numero_desconectado":
      return {
        codigo: motivo.codigo,
        o_que: `O número escolhido não está conectado (situação: ${motivo.estado}).`,
        quem_resolve: "humano_na_tela",
        como: "Uma pessoa reconecta o número em Conexões (/app/connections). Depois chame plataforma_publicar_agente de novo.",
      };
    default:
      return {
        codigo: motivo.codigo,
        o_que: "O rascunho não está pronto para publicar.",
        quem_resolve: "agente_implantador",
        como: "Chame plataforma_garantir_agente de novo com os campos do agente.",
      };
  }
}

/** O que impede publicar uma versão, medido com a régua do botão "Publicar". */
export async function pendenciasDePublicacao(
  admin: SupabaseClient,
  orgId: string,
  versao: LinhaDaVersao | null,
  canais: SelectableChannel[],
): Promise<PendenciaDePublicacao[]> {
  if (!versao) return [explicarBloqueio({ codigo: "sem_rascunho" })];
  const provedor = String(versao.provider);
  const credentialId = (versao.credential_id as string | null) ?? null;
  const canal = canais.find((x) => x.id === versao.channel_session_id) ?? null;
  const motivo = bloqueioDePublicacao({
    temRascunhoVigente: true,
    formularioValido: true,
    alteracoesNaoSalvas: false,
    provedor,
    chave: {
      daInstalacao: credentialId === null,
      instalacaoTemChaveDoProvedor: lerAmbiente().chavesDeProvedor[provedor] === true,
      estadoDaCredencialDaOrg: await estadoDaCredencial(admin, orgId, credentialId),
    },
    numero: { estado: versao.channel_session_id ? (canal?.status ?? "DESCONHECIDO") : null },
  });
  // A régua devolve o PRIMEIRO motivo; a chave e o número são resolvidos por
  // pessoas diferentes, então os dois saem quando os dois faltam.
  const pendencias: PendenciaDePublicacao[] = [];
  if (motivo) pendencias.push(explicarBloqueio(motivo));
  if (motivo && motivo.codigo !== "sem_numero" && motivo.codigo !== "numero_desconectado") {
    if (!versao.channel_session_id) pendencias.push(explicarBloqueio({ codigo: "sem_numero" }));
    else if (canal && canal.status.toUpperCase() !== "WORKING") {
      pendencias.push(explicarBloqueio({ codigo: "numero_desconectado", estado: canal.status }));
    }
  }
  return pendencias;
}

// ---------------------------------------------------------------------------
// resolver nomes em ids
// ---------------------------------------------------------------------------

function soDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

export function acharNumero(canais: SelectableChannel[], referencia: string): SelectableChannel {
  const ref = referencia.trim();
  const porId = canais.find((x) => x.id === ref);
  if (porId) return porId;
  const digitos = soDigitos(ref);
  const candidatos = canais.filter(
    (x) =>
      chaveDoNome(x.display_name) === chaveDoNome(ref) ||
      (digitos.length >= 8 && x.phone_number !== null && soDigitos(x.phone_number).endsWith(digitos.slice(-8))),
  );
  if (candidatos.length === 1) return candidatos[0]!;
  const lista = canais.map((x) => `«${x.display_name}»${x.phone_number ? ` (${x.phone_number})` : ""} id ${x.id}`);
  throw new Recusa(
    candidatos.length > 1
      ? `Mais de um número conectado casa com «${ref}». Informe o id: ${lista.join("; ")}.`
      : canais.length === 0
        ? "Esta organização ainda não tem número de WhatsApp conectado. Conectar o número é com uma pessoa, em Conexões (/app/connections). O rascunho do agente pode ser criado sem número: deixe `numero` de fora."
        : `Não achei o número «${ref}». Os números conectados são: ${lista.join("; ")}.`,
  );
}

async function resolverFunis(admin: SupabaseClient, orgId: string, referencias: string[]): Promise<string[]> {
  const { data, error } = await admin
    .from("crm_pipelines")
    .select("id, name, is_archived")
    .eq("organization_id", orgId);
  if (error) throw new Error(`não consegui ler os funis: ${error.message}`);
  const funis = ((data ?? []) as Array<{ id: string; name: string; is_archived: boolean }>).filter((f) => !f.is_archived);
  return [
    ...new Set(
      referencias.map(
        (r) =>
          acharPorNomeOuId(funis, r, (f) => f.name, {
            singular: "o funil",
            comoListar: "Crie o funil com plataforma_garantir_funil antes de autorizar o agente nele.",
          }).id,
      ),
    ),
  ];
}

async function resolverMateriais(admin: SupabaseClient, orgId: string, referencias: string[]): Promise<string[]> {
  const { data, error } = await admin
    .from("ai_knowledge_sources")
    .select("id, name, is_active")
    .eq("organization_id", orgId);
  if (error) throw new Error(`não consegui ler os materiais: ${error.message}`);
  const materiais = ((data ?? []) as Array<{ id: string; name: string; is_active: boolean }>).filter((m) => m.is_active);
  return [
    ...new Set(
      referencias.map(
        (r) =>
          acharPorNomeOuId(materiais, r, (m) => m.name, {
            singular: "o material",
            comoListar: "Crie o material com plataforma_garantir_conhecimento antes de ligá-lo ao agente.",
          }).id,
      ),
    ),
  ];
}

async function resolverFluxos(
  admin: SupabaseClient,
  orgId: string,
  referencias: string[],
  avisos: string[],
): Promise<string[]> {
  const { data, error } = await admin
    .from("followup_flow_pointers")
    .select("id, name, status, surface")
    .eq("organization_id", orgId);
  if (error) throw new Error(`não consegui ler os fluxos de follow-up: ${error.message}`);
  const fluxos = ((data ?? []) as Array<{ id: string; name: string; status: string; surface: string | null }>).filter(
    (f) => f.surface !== "atendimento",
  );
  const ids: string[] = [];
  for (const r of referencias) {
    const fluxo = acharPorNomeOuId(fluxos, r, (f) => f.name, {
      singular: "o fluxo de follow-up",
      comoListar: "Instale o fluxo com plataforma_garantir_followup antes de armá-lo no agente.",
    });
    if (fluxo.status !== "active") {
      avisos.push(
        `O fluxo «${fluxo.name}» ainda não está publicado: armado no agente, ele só começa a rodar depois de plataforma_publicar_followup.`,
      );
    }
    if (!ids.includes(fluxo.id)) ids.push(fluxo.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// garantir
// ---------------------------------------------------------------------------

/** O corpo da versão desejada: a de referência, com o que o pedido trouxe por cima. */
async function montarVersao(
  c: Implantacao,
  org: OrganizacaoDaImplantacao,
  pedido: PedidoDeAgente,
  referencia: LinhaDaVersao | null,
  canais: SelectableChannel[],
  avisos: string[],
): Promise<Record<string, unknown>> {
  const corpo: Record<string, unknown> = referencia ? conteudoDa(referencia) : {};

  if (pedido.prompt !== undefined) corpo.system_prompt = pedido.prompt;
  if (corpo.system_prompt === undefined) {
    throw new Recusa(
      "Agente novo precisa de `prompt`: o texto que diz quem ele é, o que a empresa faz e como ele conduz a conversa (de 10 a 20.000 caracteres).",
    );
  }

  if (pedido.pacotes !== undefined || pedido.capacidades !== undefined) {
    const montadas = montarCapacidades(await capacidadesOferecidas(c.admin, c.orgId), pedido);
    corpo.tool_ids = montadas.tool_ids;
    avisos.push(...montadas.avisos);
  } else if (!referencia) {
    // Sem capacidade o turno não monta ferramenta nenhuma: o agente conversa e
    // não alcança contato, negócio nem funil. O agente novo nasce como o do
    // onboarding, com o pacote de vender.
    corpo.tool_ids = capacidadesPadraoDoOnboarding();
    avisos.push('Sem `pacotes` no pedido, o agente nasceu com o pacote "vender" (o mesmo do onboarding).');
  }

  if (pedido.funis !== undefined) corpo.pipeline_ids = await resolverFunis(c.admin, c.orgId, pedido.funis);
  if (pedido.materiais !== undefined) {
    corpo.knowledge_source_ids = await resolverMateriais(c.admin, c.orgId, pedido.materiais);
  }

  if (pedido.followups !== undefined) {
    const anterior = (corpo.followup as Record<string, unknown> | null | undefined) ?? {};
    const ids = await resolverFluxos(c.admin, c.orgId, pedido.followups.fluxos, avisos);
    const janela =
      pedido.followups.janela === undefined
        ? (anterior.send_window ?? null)
        : pedido.followups.janela === null
          ? null
          : { start: pedido.followups.janela.inicio, end: pedido.followups.janela.fim, weekdays: pedido.followups.janela.dias };
    corpo.followup = {
      ...anterior,
      enabled: ids.length > 0,
      flow_pointer_ids: ids,
      send_window: janela,
    };
  }

  if (pedido.palavras_de_passagem !== undefined) corpo.handoff_keywords = pedido.palavras_de_passagem;
  if (pedido.passagem_para_humano !== undefined) corpo.handoff_tool_enabled = pedido.passagem_para_humano;
  if (pedido.casos !== undefined) corpo.cases_enabled = pedido.casos;
  if (pedido.dividir_mensagens !== undefined) corpo.split_messages = pedido.dividir_mensagens;
  if (pedido.tamanho_da_mensagem !== undefined) corpo.split_max_chars = pedido.tamanho_da_mensagem;
  if (pedido.espera_por_rajada_ms !== undefined) corpo.inbound_debounce_ms = pedido.espera_por_rajada_ms;
  if (pedido.max_passos !== undefined) corpo.max_steps = pedido.max_passos;

  if (pedido.horario_de_atendimento !== undefined) {
    const anterior = (corpo.trigger_config as Record<string, unknown> | null | undefined) ?? {};
    const filtros = (anterior.filters as Record<string, unknown> | undefined) ?? {};
    // O aviso de fora do horário mora DENTRO do horário (`notice`). Trocar a
    // janela não pode apagar o texto que alguém escreveu, pela tela ou por aqui.
    const horarioAnterior = (filtros.business_hours as Record<string, unknown> | null | undefined) ?? null;
    corpo.trigger_config = {
      events: anterior.events ?? ["message"],
      concurrency: anterior.concurrency ?? "one_per_conversation",
      filters: {
        ignore_groups: filtros.ignore_groups ?? true,
        ignore_self: filtros.ignore_self ?? true,
        keyword_regex: filtros.keyword_regex ?? null,
        business_hours:
          pedido.horario_de_atendimento === null
            ? null
            : {
                timezone: pedido.horario_de_atendimento.fuso ?? org.timezone,
                start: pedido.horario_de_atendimento.inicio,
                end: pedido.horario_de_atendimento.fim,
                weekdays: pedido.horario_de_atendimento.dias,
                ...(horarioAnterior !== null && "notice" in horarioAnterior ? { notice: horarioAnterior.notice } : {}),
              },
      },
    };
  }

  if (pedido.aviso_fora_do_horario !== undefined) {
    const gatilho = (corpo.trigger_config as Record<string, unknown> | null | undefined) ?? null;
    const filtros = (gatilho?.filters as Record<string, unknown> | undefined) ?? {};
    const horario = (filtros.business_hours as Record<string, unknown> | null | undefined) ?? null;
    if (horario === null) {
      // Sem janela não existe "fora dela": o motor nem adia o turno.
      if (pedido.aviso_fora_do_horario !== null) {
        throw new Recusa(
          "O aviso de fora do horário só existe para agente que tem horário de atendimento, e este responde a qualquer hora. " +
            'Informe `horario_de_atendimento` na mesma chamada. Ex.: { "horario_de_atendimento": { "inicio": "08:00", "fim": "18:00", "dias": [1,2,3,4,5] }, ' +
            '"aviso_fora_do_horario": "Recebemos sua mensagem. Nosso atendimento volta às 8h." }.',
        );
      }
    } else if (pedido.aviso_fora_do_horario !== null || (horario.notice ?? null) !== null) {
      // `null` só é gravado quando havia um texto para apagar: o rascunho que
      // nunca teve aviso não muda por um pedido de "sem aviso".
      corpo.trigger_config = {
        ...gatilho,
        filters: { ...filtros, business_hours: { ...horario, notice: pedido.aviso_fora_do_horario } },
      };
    }
  }

  if (pedido.numero !== undefined) {
    corpo.channel_session_id = pedido.numero === null ? null : acharNumero(canais, pedido.numero).id;
  } else if (!referencia) {
    corpo.channel_session_id = null;
  }

  // `trigger_config` nulo vindo do banco não é o mesmo que ausente para o schema.
  if (corpo.trigger_config === null) delete corpo.trigger_config;
  return corpo;
}

/** O horário de atendimento de um `trigger_config`, ou `null`. */
function horarioDoGatilho(gatilho: unknown): Record<string, unknown> | null {
  const filtros = (gatilho as { filters?: { business_hours?: unknown } } | null | undefined)?.filters;
  const horario = filtros?.business_hours;
  return horario && typeof horario === "object" ? (horario as Record<string, unknown>) : null;
}

/** O que mudou no gatilho, nas palavras de quem configura: a janela, o aviso, ou os dois. */
function rotulosDoGatilho(antes: unknown, depois: unknown): string[] {
  const semAviso = (h: Record<string, unknown> | null) => {
    if (h === null) return null;
    const { notice: _aviso, ...janela } = h;
    return janela;
  };
  const a = horarioDoGatilho(antes);
  const d = horarioDoGatilho(depois);
  const rotulos: string[] = [];
  if (!mesmoConteudo(semAviso(a), semAviso(d))) rotulos.push("horário de atendimento");
  if (((a?.notice as string | null | undefined) ?? null) !== ((d?.notice as string | null | undefined) ?? null)) {
    rotulos.push("aviso de fora do horário");
  }
  return rotulos.length > 0 ? rotulos : ["horário de atendimento"];
}

/**
 * O `config` do cadastro com o limiar pedido, ou `null` quando não há o que
 * gravar. A MESMA mescla do `PATCH /api/v1/ai/agents/[id]`: os padrões, o que
 * está gravado e o pedido por cima, conferido por `agentPatchSchema`.
 *
 * Limiar igual ao que vale hoje (o gravado, ou o padrão de quem nunca mexeu)
 * não escreve: o agente que nunca foi configurado não ganha a chave por um
 * pedido que repete o padrão.
 */
function configComLimiar(
  agente: Pick<LinhaDoAgente, "config">,
  limiar: number | undefined,
): Record<string, unknown> | null {
  if (limiar === undefined || limiar === limiarDeSentimentoDo(agente)) return null;
  const conferido = agentPatchSchema.safeParse({ config: { sentiment_threshold: limiar } });
  if (!conferido.success) {
    throw new Recusa(
      "`limiar_de_sentimento` vai de 0 a 1 (ex.: 0.3, o padrão). Nota mais alta passa mais conversas para uma pessoa; mais baixa deixa só a hostilidade forte acionar a passagem.",
    );
  }
  return { ...AGENT_CONFIG_DEFAULTS, ...((agente.config ?? {}) as Record<string, unknown>), ...conferido.data.config };
}

function recusaDoSchema(erro: { issues: Array<{ path: PropertyKey[]; message: string }> }): never {
  const linhas = erro.issues.slice(0, 8).map((i) => {
    const caminho = i.path.join(".");
    const dica: Record<string, string> = {
      system_prompt: "`prompt` precisa de 10 a 20.000 caracteres.",
      handoff_keywords: "`palavras_de_passagem` aceita até 20 expressões de 1 a 60 caracteres.",
      split_max_chars: "`tamanho_da_mensagem` vai de 80 a 4000 caracteres.",
      inbound_debounce_ms: "`espera_por_rajada_ms` vai de 0 a 60000.",
      max_steps: "`max_passos` vai de 1 a 25.",
      name: "`nome` precisa de 1 a 120 caracteres.",
      priority: "`prioridade` vai de 0 a 1000.",
    };
    const campo = String(i.path[i.path[0] === "version" ? 1 : 0] ?? "");
    if (caminho.endsWith("business_hours.notice")) {
      return "`aviso_fora_do_horario` aceita até 1000 caracteres.";
    }
    if (caminho.includes("business_hours") || caminho.includes("send_window")) {
      return 'O horário usa "HH:MM" de 24 horas e dias de 0 (domingo) a 6 (sábado), com o fim depois do início. Ex.: { "inicio": "08:00", "fim": "18:00", "dias": [1,2,3,4,5] }.';
    }
    return dica[campo] ?? `\`${caminho}\`: ${i.message}`;
  });
  throw new Recusa(`O agente não passou na conferência:\n- ${[...new Set(linhas)].join("\n- ")}`);
}

async function inserirVersao(
  c: Implantacao,
  agentId: string,
  v: VersionInput,
): Promise<LinhaDaVersao> {
  // Mesma ordem e mesmas colunas de `POST /api/v1/ai/agents/[id]/versions`: o
  // número é `max + 1`, com retentativa quando outra gravação chega primeiro
  // (`unique(agent_id, version_number)`).
  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    const { data: maior } = await c.admin
      .from("ai_agent_versions")
      .select("version_number")
      .eq("agent_id", agentId)
      .eq("organization_id", c.orgId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const numero = (((maior as { version_number?: number } | null)?.version_number as number | undefined) ?? 0) + 1;

    const { data, error } = await c.admin
      .from("ai_agent_versions")
      .insert({
        organization_id: c.orgId,
        agent_id: agentId,
        version_number: numero,
        system_prompt: v.system_prompt,
        provider: v.provider,
        model: v.model,
        credential_id: v.credential_id,
        tool_ids: v.tool_ids,
        trigger_config: v.trigger_config ?? undefined,
        channel_session_id: v.channel_session_id,
        max_steps: v.max_steps,
        token_budget: v.token_budget,
        cost_budget_cents: v.cost_budget_cents,
        history_message_window: v.history_message_window,
        history_token_window: v.history_token_window,
        handoff_keywords: v.handoff_keywords,
        handoff_tool_enabled: v.handoff_tool_enabled,
        // Upstream 1.70 (#2013): a rota passou a gravar a chave do rascunho de
        // proposta pela IA na versão nova; o espelho grava junto.
        proposal_ai_draft_enabled: v.proposal_ai_draft_enabled,
        cases_enabled: v.cases_enabled,
        split_messages: v.split_messages,
        split_max_chars: v.split_max_chars,
        inbound_debounce_ms: v.inbound_debounce_ms ?? null,
        followup: v.followup,
        operator_enabled: v.operator_enabled,
        operator_model: v.operator_model,
        operator_tool_ids: v.operator_tool_ids,
        pipeline_ids: v.pipeline_ids,
        knowledge_source_ids: v.knowledge_source_ids,
        status: "draft",
        created_by: c.autorUserId,
      })
      .select(COLUNAS_DA_VERSAO)
      .single();

    if (!error && data) {
      void audit({
        action: "ai_agent.version_created",
        actorUserId: c.autorUserId,
        organizationId: c.orgId,
        resourceType: "ai_agent_version",
        resourceId: (data as unknown as { id: string }).id,
        requestId: c.requestId,
        metadata: { agent_id: agentId, version_number: numero, via: "mcp_plataforma" },
      });
      return data as unknown as LinhaDaVersao;
    }
    if (error?.code !== "23505") throw new Error(`não consegui gravar a versão do agente: ${error?.message ?? "sem linha"}`);
  }
  throw new Error("conflito de numeração de versão. Chame de novo.");
}

export async function garantirAgente(
  c: Implantacao,
  org: OrganizacaoDaImplantacao,
  pedido: PedidoDeAgente,
): Promise<AgenteGarantido> {
  const avisos: string[] = [];
  const nome = pedido.nome.trim();
  const agentes = await lerAgentes(c.admin, c.orgId);
  const canais = await listSelectableChannels(c.admin, c.orgId);

  let agente: LinhaDoAgente | undefined;
  if (pedido.agente_id) {
    agente = agentes.find((a) => a.id === pedido.agente_id);
    if (!agente) throw new Recusa(`Não existe agente com o id ${pedido.agente_id} nesta organização.`);
  } else {
    agente = agentes.find((a) => chaveDoNome(a.name) === chaveDoNome(nome));
  }
  if (agente?.archived_at) {
    throw new Recusa(
      `Existe um agente ARQUIVADO chamado «${agente.name}», e o nome do agente não se repete na organização. Use outro nome.`,
    );
  }

  // ── agente novo: o caminho de `POST /api/v1/ai/agents` ────────────────────
  if (!agente) {
    const corpo = await montarVersao(c, org, pedido, null, canais, avisos);
    // A IA vem da plataforma: o corpo recebe o par e "a chave desta instalação".
    const provisorio = { ...corpo, provider: "anthropic", model: "a-definir", credential_id: null };
    const lido = agentMcpCreateSchema.safeParse({
      name: nome,
      ...(pedido.descricao ? { description: pedido.descricao } : {}),
      ...(pedido.prioridade !== undefined ? { priority: pedido.prioridade } : {}),
      version: provisorio,
    });
    if (!lido.success) recusaDoSchema(lido.error);

    const travada = await travarIaDaVersaoNova(
      c.admin,
      { user: QUEM_NAO_ESCOLHE_IA, orgId: c.orgId, agenteDeReferencia: null },
      lido.data.version,
    );
    if (!travada.ok) {
      throw new Recusa(
        "A plataforma ainda não tem um modelo de IA definido para os agentes, nem catálogo de modelos sincronizado. " +
          "Quem opera a plataforma define o modelo padrão em Admin › IA. Depois chame de novo.",
      );
    }
    const entrada = { ...lido.data, version: travada.corpo };

    const escopo = await validarEscopoDaVersao(c.admin, c.orgId, entrada.version);
    if (!escopo.ok) throw new Recusa("Um dos funis ou materiais do agente não existe mais nesta organização. Chame de novo.");

    const registros = mcpAgentDraftRecords({ orgId: c.orgId, userId: c.autorUserId }, entrada);
    const { data: criado, error: agenteErr } = await c.admin
      .from("ai_agents")
      .insert(registros.agent)
      .select(COLUNAS_DO_AGENTE)
      .single();
    if (agenteErr || !criado) {
      if (agenteErr?.code === "23505") {
        throw new Recusa(`Já existe um agente chamado «${nome}» nesta organização. Chame de novo: ele será atualizado.`);
      }
      throw new Error(`não consegui criar o agente: ${agenteErr?.message ?? "sem linha"}`);
    }
    const linhaDoAgente = criado as unknown as LinhaDoAgente;
    const { data: versao, error: versaoErr } = await c.admin
      .from("ai_agent_versions")
      .insert(registros.version)
      .select(COLUNAS_DA_VERSAO)
      .single();
    if (versaoErr || !versao) {
      // Agente sem versão é agente que nenhuma tela consegue editar: desfaz.
      await c.admin
        .from("ai_agents")
        .update({ archived_at: new Date().toISOString() })
        .eq("organization_id", c.orgId)
        .eq("id", linhaDoAgente.id);
      throw new Error(`não consegui criar a primeira versão do agente: ${versaoErr?.message ?? "sem linha"}`);
    }
    const linhaDaVersao = versao as unknown as LinhaDaVersao;

    void audit({
      action: "ai_agent.created",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "ai_agent",
      resourceId: linhaDoAgente.id,
      requestId: c.requestId,
      metadata: { kind: "mcp_agent", first_version_id: linhaDaVersao.id, priority: entrada.priority, via: "mcp_plataforma" },
    });

    // O limiar de sentimento é do cadastro: entra depois de o agente nascer, pela
    // mesma mescla de `config` do PATCH da tela.
    const configDoNovo = configComLimiar(linhaDoAgente, pedido.limiar_de_sentimento);
    if (configDoNovo) {
      const { error } = await c.admin
        .from("ai_agents")
        .update({ config: configDoNovo })
        .eq("id", linhaDoAgente.id)
        .eq("organization_id", c.orgId);
      if (error) throw new Error(`o agente nasceu, mas não consegui gravar o limiar de sentimento: ${error.message}. Chame de novo.`);
    }

    return {
      agente: { id: linhaDoAgente.id, nome: linhaDoAgente.name, desfecho: "criou", mudancas: [] },
      versao: { id: linhaDaVersao.id, numero: linhaDaVersao.version_number, situacao: "rascunho", desfecho: "criou", mudancas: [] },
      no_ar: false,
      falta_para_publicar: await pendenciasDePublicacao(c.admin, c.orgId, linhaDaVersao, canais),
      avisos,
    };
  }

  // ── agente que já existe ──────────────────────────────────────────────────
  if (agente.kind !== "mcp_agent") {
    throw new Recusa(
      `O agente «${agente.name}» é do formato antigo (sem versões) e é editado pela tela. Crie um agente novo com outro nome.`,
    );
  }

  const mudancasDoAgente: string[] = [];
  const patchDoAgente: Record<string, unknown> = {};
  if (agente.name !== nome) {
    patchDoAgente.name = nome;
    mudancasDoAgente.push("nome");
  }
  if (pedido.descricao !== undefined && (agente.description ?? null) !== (pedido.descricao || null)) {
    patchDoAgente.description = pedido.descricao || null;
    mudancasDoAgente.push("descrição");
  }
  if (pedido.prioridade !== undefined && agente.priority !== pedido.prioridade) {
    patchDoAgente.priority = pedido.prioridade;
    mudancasDoAgente.push("prioridade");
  }
  const configNova = configComLimiar(agente, pedido.limiar_de_sentimento);
  if (configNova) {
    patchDoAgente.config = configNova;
    mudancasDoAgente.push("limiar de sentimento");
    if (estadoDoAgente(agente) === "no_ar") {
      avisos.push(
        "O limiar de sentimento é do cadastro do agente, não do rascunho: já vale para a próxima mensagem que tiver o clima medido, sem publicar.",
      );
    }
  }
  if (Object.keys(patchDoAgente).length > 0) {
    const { error } = await c.admin
      .from("ai_agents")
      .update(patchDoAgente)
      .eq("id", agente.id)
      .eq("organization_id", c.orgId);
    if (error) {
      if (error.code === "23505") throw new Recusa(`Já existe outro agente chamado «${nome}» nesta organização.`);
      throw new Error(`não consegui atualizar o agente: ${error.message}`);
    }
  }

  const versoes = await lerVersoes(c.admin, c.orgId, agente.id);
  const tela = escolherVersoesDaTela(versoes, agente.published_version_id);
  const referencia = tela.base;
  const corpo = await montarVersao(c, org, pedido, referencia, canais, avisos);

  // A IA que vale: a atual do agente (ou a da plataforma, sem versão nenhuma).
  const comIa = await travarIaDaVersaoNova(
    c.admin,
    { user: QUEM_NAO_ESCOLHE_IA, orgId: c.orgId, agenteDeReferencia: agente.id },
    { ...corpo, provider: corpo.provider ?? "anthropic", model: corpo.model ?? "a-definir", credential_id: corpo.credential_id ?? null },
  );
  if (!comIa.ok) {
    throw new Recusa(
      "A plataforma ainda não tem um modelo de IA definido para os agentes. Quem opera a plataforma define o modelo padrão em Admin › IA.",
    );
  }
  const lido = versionCreateSchema.safeParse(comIa.corpo);
  if (!lido.success) recusaDoSchema(lido.error);
  const desejada = lido.data;

  const mudou = referencia
    ? CAMPOS_DA_VERSAO.filter((campo) => !mesmoConteudo(referencia[campo], (desejada as Record<string, unknown>)[campo]))
    : [...CAMPOS_DA_VERSAO];
  const mudancasDaVersao = [
    ...new Set(
      mudou.flatMap((campo) =>
        // O gatilho carrega duas coisas que a pessoa enxerga separadas: a janela e o aviso.
        campo === "trigger_config" && referencia
          ? rotulosDoGatilho(referencia.trigger_config, desejada.trigger_config)
          : [ROTULO_DO_CAMPO[campo] ?? campo],
      ),
    ),
  ];

  let versaoFinal: LinhaDaVersao;
  let desfechoDaVersao: Desfecho;

  if (referencia && mudou.length === 0) {
    versaoFinal = referencia;
    desfechoDaVersao = "ja_estava";
  } else {
    const escopo = await validarEscopoDaVersao(c.admin, c.orgId, {
      pipeline_ids: desejada.pipeline_ids,
      knowledge_source_ids: desejada.knowledge_source_ids,
    });
    if (!escopo.ok) throw new Recusa("Um dos funis ou materiais do agente não existe mais nesta organização. Chame de novo.");

    if (tela.draft && referencia && tela.draft.id === referencia.id) {
      // Há rascunho vigente: edita o rascunho, como `PATCH .../versions/[vid]`.
      const patch = Object.fromEntries(mudou.map((campo) => [campo, (desejada as Record<string, unknown>)[campo]]));
      const conferido = versionPatchSchema.safeParse(patch);
      if (!conferido.success) recusaDoSchema(conferido.error);
      const { data, error } = await c.admin
        .from("ai_agent_versions")
        .update(patch)
        .eq("id", tela.draft.id)
        .eq("organization_id", c.orgId)
        .select(COLUNAS_DA_VERSAO)
        .single();
      if (error || !data) throw new Error(`não consegui atualizar o rascunho do agente: ${error?.message ?? "sem linha"}`);
      versaoFinal = data as unknown as LinhaDaVersao;
      desfechoDaVersao = "atualizou";
      void audit({
        action: "ai_agent.version_updated",
        actorUserId: c.autorUserId,
        organizationId: c.orgId,
        resourceType: "ai_agent_version",
        resourceId: tela.draft.id,
        requestId: c.requestId,
        metadata: { agent_id: agente.id, fields: mudou, via: "mcp_plataforma" },
      });
    } else {
      // A versão no ar não se edita: nasce um rascunho novo, como
      // `POST .../versions`. A mesma conferência da rota: "a chave desta
      // instalação" só vale se a instalação TEM chave daquele provedor.
      if (desejada.credential_id === null && lerAmbiente().chavesDeProvedor[desejada.provider] !== true) {
        throw new Recusa(
          `Esta instalação não tem chave de ${desejada.provider} no ambiente, então a versão nova nasceria sem conseguir responder. ` +
            "Quem opera a plataforma configura a chave do provedor de IA. Não é configuração do cliente.",
        );
      }
      versaoFinal = await inserirVersao(c, agente.id, desejada);
      desfechoDaVersao = referencia ? "atualizou" : "criou";
    }
  }

  const noAr = estadoDoAgente(agente) === "no_ar";
  const ehRascunho = versaoFinal.status === "draft";
  if (noAr && ehRascunho) {
    avisos.push(
      "O agente está no ar com a versão publicada; a mudança ficou num RASCUNHO e só passa a valer depois de plataforma_publicar_agente.",
    );
  }

  return {
    agente: {
      id: agente.id,
      nome,
      desfecho: mudancasDoAgente.length > 0 ? "atualizou" : "ja_estava",
      mudancas: mudancasDoAgente,
    },
    versao: {
      id: versaoFinal.id,
      numero: versaoFinal.version_number,
      situacao: ehRascunho ? "rascunho" : "publicada",
      desfecho: desfechoDaVersao,
      mudancas: desfechoDaVersao === "ja_estava" ? [] : mudancasDaVersao,
    },
    no_ar: noAr,
    falta_para_publicar: ehRascunho ? await pendenciasDePublicacao(c.admin, c.orgId, versaoFinal, canais) : [],
    avisos,
  };
}

// ---------------------------------------------------------------------------
// publicar
// ---------------------------------------------------------------------------

export interface AgentePublicado {
  agente: { id: string; nome: string };
  desfecho: "publicou" | "ja_estava";
  versao: { id: string; numero: number };
  numero: { id: string; nome: string; telefone: string | null } | null;
  publicado_em: string | null;
  avisos: string[];
}

const FRASE_DO_CODIGO: Record<string, { o_que: string; como: string }> = {
  credential_missing: {
    o_que: "a instalação não tem chave do provedor de IA desta versão",
    como: "Quem opera a plataforma configura a chave do provedor de IA. Não é configuração do cliente.",
  },
  credential_not_found: { o_que: "a chave de IA escolhida na versão não existe mais", como: "Quem opera a plataforma escolhe a chave em IA › Credenciais." },
  credential_inactive: { o_que: "a chave de IA escolhida na versão está desativada", como: "Quem opera a plataforma reativa a chave em IA › Credenciais." },
  credential_not_validated: { o_que: "a chave de IA escolhida ainda não foi confirmada pelo provedor", como: "Espere a confirmação (alguns instantes) e chame de novo." },
  credential_provider_mismatch: { o_que: "a chave de IA escolhida é de outro provedor", como: "Quem opera a plataforma corrige em IA › Credenciais." },
  channel_session_not_found: { o_que: "o número escolhido não existe mais nesta organização", como: "Chame de novo informando `numero` com um número conectado." },
  channel_session_offline: { o_que: "o número escolhido não está conectado", como: "Uma pessoa reconecta o número em Conexões (/app/connections). Depois chame de novo." },
  model_not_found: { o_que: "o modelo de IA da versão não está no catálogo desta instalação", como: "Quem opera a plataforma confere o modelo padrão em Admin › IA e a sincronização do catálogo." },
  version_invalid_state: { o_que: "a versão não está em estado de publicar", como: "Chame plataforma_garantir_agente para ter um rascunho, e publique de novo." },
  agent_archived: { o_que: "o agente está arquivado", como: "Crie um agente novo com outro nome." },
};

export async function publicarAgente(
  c: Implantacao,
  pedido: { agente: string; numero?: string },
): Promise<AgentePublicado> {
  const avisos: string[] = [];
  const agentes = (await lerAgentes(c.admin, c.orgId)).filter((a) => !a.archived_at);
  const agente = acharPorNomeOuId(agentes, pedido.agente, (a) => a.name, {
    singular: "o agente",
    comoListar: "Crie o agente com plataforma_garantir_agente.",
  });
  const versoes = await lerVersoes(c.admin, c.orgId, agente.id);
  const tela = escolherVersoesDaTela(versoes, agente.published_version_id);
  const canais = await listSelectableChannels(c.admin, c.orgId);

  if (!tela.draft) {
    if (tela.published) {
      const canal = canais.find((x) => x.id === tela.published!.channel_session_id) ?? null;
      if (pedido.numero && canal && acharNumero(canais, pedido.numero).id !== canal.id) {
        throw new Recusa(
          `O agente «${agente.name}» está no ar em «${canal.display_name}» e não tem rascunho. ` +
            "Para trocar o número, chame plataforma_garantir_agente com `numero` (nasce um rascunho) e publique de novo.",
        );
      }
      return {
        agente: { id: agente.id, nome: agente.name },
        desfecho: "ja_estava",
        versao: { id: tela.published.id, numero: tela.published.version_number },
        numero: canal ? { id: canal.id, nome: canal.display_name, telefone: canal.phone_number } : null,
        publicado_em: tela.published.published_at,
        avisos: agente.paused_at ? ["O agente está PAUSADO. Use plataforma_pausar_agente com `pausar: false` para ele voltar a responder."] : [],
      };
    }
    throw new Recusa(
      `O agente «${agente.name}» não tem rascunho para publicar. Chame plataforma_garantir_agente com o prompt e as capacidades.`,
    );
  }

  let rascunho = tela.draft;

  // O número: o do pedido; senão o do rascunho; senão o único conectado.
  let alvoDoNumero: SelectableChannel | null = null;
  if (pedido.numero) alvoDoNumero = acharNumero(canais, pedido.numero);
  else if (!rascunho.channel_session_id) {
    if (canais.length === 1) {
      alvoDoNumero = canais[0]!;
      avisos.push(`O rascunho não tinha número; usei o único conectado, «${alvoDoNumero.display_name}».`);
    } else if (canais.length > 1) {
      throw new Recusa(
        "O rascunho não tem número e a organização tem mais de um conectado. Informe `numero`: " +
          canais.map((x) => `«${x.display_name}»${x.phone_number ? ` (${x.phone_number})` : ""}`).join("; ") +
          ".",
      );
    }
  }
  if (alvoDoNumero && rascunho.channel_session_id !== alvoDoNumero.id) {
    const { data, error } = await c.admin
      .from("ai_agent_versions")
      .update({ channel_session_id: alvoDoNumero.id })
      .eq("id", rascunho.id)
      .eq("organization_id", c.orgId)
      .select(COLUNAS_DA_VERSAO)
      .single();
    if (error || !data) throw new Error(`não consegui gravar o número no rascunho: ${error?.message ?? "sem linha"}`);
    rascunho = data as unknown as LinhaDaVersao;
  }

  // As pendências que a régua do botão "Publicar" acusa, todas de uma vez e com
  // quem resolve cada uma: é o que deixa o implantador saber que agora é com o humano.
  const pendencias = await pendenciasDePublicacao(c.admin, c.orgId, rascunho, canais);
  if (pendencias.length > 0) {
    throw new Recusa(
      `O agente «${agente.name}» ainda não pode ir ao ar:\n` +
        pendencias.map((p) => `- ${p.o_que} Quem resolve: ${p.quem_resolve.replace(/_/g, " ")}. ${p.como}`).join("\n"),
    );
  }

  const invalidas = ((rascunho.tool_ids as string[] | null) ?? []).filter(
    (id) => !(VALID_TOOL_IDS as readonly string[]).includes(id),
  );
  if (invalidas.length > 0) {
    throw new Recusa(
      `O rascunho tem capacidades que não existem mais no catálogo: ${invalidas.join(", ")}. ` +
        "Chame plataforma_garantir_agente informando `pacotes` de novo.",
    );
  }

  // A versão só vai ao ar com a IA atual do agente ou com o par da plataforma.
  if (
    !(await iaPodeIrAoAr(c.admin, {
      user: QUEM_NAO_ESCOLHE_IA,
      orgId: c.orgId,
      agentId: agente.id,
      versao: rascunho as unknown as Record<string, unknown>,
    }))
  ) {
    throw new Recusa(
      "O rascunho foi gravado com uma IA que não é mais a da plataforma (o modelo padrão mudou depois). " +
        "Chame plataforma_garantir_agente de novo: o rascunho herda a IA atual. Depois publique.",
    );
  }

  const resultado = await publishAgentVersion(c.admin, { orgId: c.orgId, agentId: agente.id, versionId: rascunho.id });
  if (!resultado.ok) {
    const frase = FRASE_DO_CODIGO[resultado.code];
    if (frase) throw new Recusa(`Não publiquei o agente «${agente.name}»: ${frase.o_que}. ${frase.como}`);
    throw new Error(`não consegui publicar o agente: ${resultado.message}`);
  }

  void c.admin
    .from("event_log")
    .insert({
      organization_id: c.orgId,
      event_type: "ai_agent.published",
      // NOT NULL sem default: ver `tests/unit/evento-de-publicacao-tem-dono.test.ts`.
      entity_kind: "ai_agent",
      payload: {
        agent_id: resultado.agent_id,
        version_id: resultado.version_id,
        previous_version_id: resultado.previous_version_id,
        published_at: resultado.published_at,
      },
    })
    .then(({ error }) => {
      if (error) console.error("[implantacao/agente] event_log error", error.message);
    });
  void audit({
    action: "ai_agent.published",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "ai_agent",
    resourceId: agente.id,
    requestId: c.requestId,
    metadata: { version_id: resultado.version_id, previous_version_id: resultado.previous_version_id, via: "mcp_plataforma" },
  });

  const canal = canais.find((x) => x.id === rascunho.channel_session_id) ?? null;
  if (agente.paused_at) {
    avisos.push("O agente está PAUSADO: a versão foi publicada, e ele só responde depois de plataforma_pausar_agente com `pausar: false`.");
  }
  const outros = agentes.filter((a) => a.id !== agente.id && estadoDoAgente(a) === "no_ar");
  if (outros.length > 0 && canal) {
    const { data: vizinhos } = await c.admin
      .from("ai_agent_versions")
      .select("id, agent_id, channel_session_id")
      .eq("organization_id", c.orgId)
      .in("id", outros.map((a) => a.published_version_id as string));
    const noMesmoNumero = ((vizinhos ?? []) as Array<{ agent_id: string; channel_session_id: string | null }>).filter(
      (v) => v.channel_session_id === canal.id,
    );
    if (noMesmoNumero.length > 0) {
      avisos.push(
        `Há ${noMesmoNumero.length + 1} agentes publicados no número «${canal.display_name}». Sem roteador, só o de maior prioridade responde. ` +
          "Para dividir o atendimento entre eles, monte o roteador de intenção com plataforma_garantir_roteador e ligue com plataforma_ligar_roteador.",
      );
    }
  }

  return {
    agente: { id: agente.id, nome: agente.name },
    desfecho: "publicou",
    versao: { id: resultado.version_id, numero: rascunho.version_number },
    numero: canal ? { id: canal.id, nome: canal.display_name, telefone: canal.phone_number } : null,
    publicado_em: resultado.published_at,
    avisos,
  };
}

// ---------------------------------------------------------------------------
// pausar e retomar
// ---------------------------------------------------------------------------

export async function pausarAgente(
  c: Implantacao,
  pedido: { agente: string; pausar: boolean },
): Promise<{ agente: { id: string; nome: string }; pausado: boolean; desfecho: "atualizou" | "ja_estava" }> {
  const agentes = (await lerAgentes(c.admin, c.orgId)).filter((a) => !a.archived_at);
  const agente = acharPorNomeOuId(agentes, pedido.agente, (a) => a.name, {
    singular: "o agente",
    comoListar: "Use plataforma_ver_agentes para ver os agentes da organização.",
  });
  const estaPausado = Boolean(agente.paused_at);
  if (estaPausado === pedido.pausar) {
    return { agente: { id: agente.id, nome: agente.name }, pausado: estaPausado, desfecho: "ja_estava" };
  }
  // Grava só `paused_at`: a versão segue publicada e o ponteiro fica, como na
  // rota de pausar. Quem cala o agente é quem lê `paused_at`.
  const agora = new Date().toISOString();
  const { error } = await c.admin
    .from("ai_agents")
    .update({ paused_at: pedido.pausar ? agora : null, updated_at: agora })
    .eq("id", agente.id)
    .eq("organization_id", c.orgId);
  if (error) throw new Error(`não consegui ${pedido.pausar ? "pausar" : "retomar"} o agente: ${error.message}`);
  if (pedido.pausar) {
    void audit({
      action: "ai_agent.paused",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "ai_agent",
      resourceId: agente.id,
      requestId: c.requestId,
      metadata: { previous_version_id: agente.published_version_id, via: "mcp_plataforma" },
    });
  }
  return { agente: { id: agente.id, nome: agente.name }, pausado: pedido.pausar, desfecho: "atualizou" };
}
