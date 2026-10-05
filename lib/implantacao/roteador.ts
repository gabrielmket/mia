/**
 * FORK MIA — GARANTIR e LIGAR o ROTEADOR DE INTENÇÃO de um número.
 *
 * ── O que é ───────────────────────────────────────────────────────────────
 *
 * Dois agentes publicados no MESMO número só dividem o atendimento com um
 * roteador (IA › Roteadores): a cada mensagem ele classifica a intenção do
 * cliente e escolhe o agente daquela intenção. Desde o upstream 1.73 (#2290)
 * cada intenção também pode levar o NEGÓCIO para o funil certo: quando ela
 * casa, o card sai do funil de entrada e vai para o funil (e a etapa) de
 * destino, antes de o agente responder.
 *
 * ── O caminho da tela que isto espelha ────────────────────────────────────
 *
 *   criar      `POST /api/v1/ai/routers`: o número conferido contra a
 *              organização (arquivado não é destino) e `configDoRoteador`
 *              (`lib/ai/trava-da-ia.ts`): o modelo do classificador é da
 *              plataforma, e roteador novo nasce no "Automático"
 *   editar     `PATCH /api/v1/ai/routers/[id]`: nome e agente reserva
 *   intenções  `PUT /api/v1/ai/routers/[id]/members`: a lista INTEIRA, gravada
 *              por `writeRouterMembers` (com `SUPABASE_DB_URL`, numa transação)
 *              ou `replaceRouterMembersHttp` (sem ela), que conferem agente,
 *              nome repetido e roteiro. Funil e etapa de outra empresa são
 *              recusados pela FK composta da 0542
 *   ligar      o mesmo PATCH, com `is_active`
 *
 * As três rotas estão na cerca `tests/unit/mcp-de-implantacao-espelhos.test.ts`.
 *
 * ── O que é diferente da tela, e por quê ──────────────────────────────────
 *
 * 1. NASCE DESLIGADO. Na tela o roteador nasce ativo (o padrão da coluna). Aqui
 *    não: roteador ativo passa a decidir quem responde a cada mensagem do
 *    número e, com destino de funil, MOVE o negócio do cliente. Isso é pôr no
 *    ar. Montar grava o roteador desligado (`implantar_configuracao`), e ligar é
 *    outra ferramenta, com outra operação do token (`colocar_no_ar`).
 * 2. LIGADO NÃO SE EDITA POR AQUI. As tabelas do roteador não têm rascunho: a
 *    mudança valeria na mensagem seguinte. Desliga, ajusta, religa. A mesma
 *    regra das automações e das regras de conversão.
 * 3. Os nomes viram ids aqui. Agente, funil e etapa chegam pelo NOME e são
 *    resolvidos contra a organização: o cliente do banco é o `service_role`, e
 *    um id de outra empresa não esbarraria em RLS nenhuma. A etapa é resolvida
 *    DENTRO do funil de destino (a FK da 0542 confere a empresa, não o funil).
 * 4. O roteiro de atendimento amarrado a uma intenção (`flow_pointer_id`) não
 *    entra por aqui: roteiro é outra superfície, sem ferramenta de montagem. O
 *    que uma pessoa amarrou pela tela é PRESERVADO na intenção de mesmo nome.
 * 5. O modelo do classificador não se informa: é da plataforma.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PoolClient } from "pg";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { estadoDoAgente } from "@/lib/ai/agents/no-ar";
import { writeRouterMembers, type RouterMemberInput } from "@/lib/ai/agents/router-members";
import { replaceRouterMembersHttp } from "@/lib/ai/agents/router-members-http";
import { configDoRoteador } from "@/lib/ai/trava-da-ia";
import { audit } from "@/lib/audit";
import { STATUS_SAUDAVEL } from "@/lib/channels/health";
import { listSelectableChannels, type SelectableChannel } from "@/lib/channels/selectable";
import { chaveDeNome } from "@/lib/leads/stage-editing";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

import { acharNumero, lerAgentes, type LinhaDoAgente } from "./agente";
import { acharPorNomeOuId, chaveDoNome, mesmoConteudo, type Desfecho, type Implantacao } from "./base";

/** Quantas intenções um roteador aceita por chamada. O classificador lê todas a cada mensagem. */
export const TETO_DE_INTENCOES = 20;

/** Quem pede, para a trava da IA: NÃO escolhe o modelo do classificador. */
const QUEM_NAO_ESCOLHE_IA = { is_platform_admin: false, platform_admin_scope: null, support: null } as const;

export interface IntencaoPedida {
  /** O nome curto da intenção (ex.: "Comprar plano"). Único no roteador. */
  nome: string;
  /** Quando o classificador deve escolher esta intenção. */
  descricao: string;
  /** Frases de cliente que são desta intenção. */
  exemplos?: string[];
  /** Nome ou id do agente que atende esta intenção. */
  agente: string;
  /** Para onde o negócio vai quando a intenção casa. `null` = só escolhe o agente. */
  destino?: { funil: string; etapa?: string } | null;
}

export interface PedidoDeRoteador {
  nome: string;
  /** Para renomear ou desambiguar. Sem ele, o roteador é achado pelo nome. */
  roteador_id?: string;
  /** Id, nome ou telefone de um número conectado. Obrigatório para criar. */
  numero?: string;
  /** Nome ou id do agente que atende quando nenhuma intenção casa. `null` tira. */
  agente_reserva?: string | null;
  /** A lista COMPLETA de intenções, na ordem. Substitui a que existe. */
  intencoes?: IntencaoPedida[];
}

export interface LinhaDoRoteador {
  id: string;
  name: string;
  channel_session_id: string;
  is_active: boolean;
  config: Record<string, unknown> | null;
  fallback_agent_id: string | null;
  created_at: string;
}

export interface LinhaDaIntencao {
  id: string;
  router_id: string;
  agent_id: string;
  intent_name: string;
  intent_description: string;
  examples: string[] | null;
  position: number;
  flow_pointer_id: string | null;
  pipeline_id: string | null;
  stage_id: string | null;
}

const COLUNAS_DO_ROTEADOR = "id, name, channel_session_id, is_active, config, fallback_agent_id, created_at";
const COLUNAS_DA_INTENCAO =
  "id, router_id, agent_id, intent_name, intent_description, examples, position, flow_pointer_id, pipeline_id, stage_id";

// ---------------------------------------------------------------------------
// leitura
// ---------------------------------------------------------------------------

export async function lerRoteadores(admin: SupabaseClient, orgId: string): Promise<LinhaDoRoteador[]> {
  const { data, error } = await admin
    .from("ai_routers")
    .select(COLUNAS_DO_ROTEADOR)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`não consegui ler os roteadores: ${error.message}`);
  return (data ?? []) as unknown as LinhaDoRoteador[];
}

export async function lerIntencoes(admin: SupabaseClient, orgId: string): Promise<LinhaDaIntencao[]> {
  const { data, error } = await admin
    .from("ai_router_members")
    .select(COLUNAS_DA_INTENCAO)
    .eq("organization_id", orgId)
    .order("position", { ascending: true });
  if (error) throw new Error(`não consegui ler as intenções dos roteadores: ${error.message}`);
  return (data ?? []) as unknown as LinhaDaIntencao[];
}

interface FunilComEtapas {
  id: string;
  name: string;
  etapas: Array<{ id: string; name: string; is_won: boolean; is_lost: boolean }>;
}

async function lerFunisComEtapas(admin: SupabaseClient, orgId: string): Promise<FunilComEtapas[]> {
  const [funis, etapas] = await Promise.all([
    admin.from("crm_pipelines").select("id, name, is_archived, position").eq("organization_id", orgId).order("position", { ascending: true }),
    admin
      .from("crm_stages")
      .select("id, name, pipeline_id, position, is_won, is_lost, is_archived")
      .eq("organization_id", orgId)
      .order("position", { ascending: true }),
  ]);
  if (funis.error) throw new Error(`não consegui ler os funis: ${funis.error.message}`);
  if (etapas.error) throw new Error(`não consegui ler as etapas: ${etapas.error.message}`);
  type Etapa = { id: string; name: string; pipeline_id: string; is_won: boolean; is_lost: boolean; is_archived: boolean | null };
  const vivas = ((etapas.data ?? []) as unknown as Etapa[]).filter((e) => e.is_archived !== true);
  return ((funis.data ?? []) as unknown as Array<{ id: string; name: string; is_archived: boolean }>)
    .filter((f) => !f.is_archived)
    .map((f) => ({
      id: f.id,
      name: f.name,
      etapas: vivas
        .filter((e) => e.pipeline_id === f.id)
        .map((e) => ({ id: e.id, name: e.name, is_won: e.is_won === true, is_lost: e.is_lost === true })),
    }));
}

/**
 * Os roteadores em palavras: o número, o agente reserva e cada intenção com o
 * agente e o destino pelo NOME. É o que `plataforma_ver_agentes` devolve.
 */
export async function retratoDosRoteadores(admin: SupabaseClient, orgId: string): Promise<Array<Record<string, unknown>>> {
  const roteadores = await lerRoteadores(admin, orgId);
  if (roteadores.length === 0) return [];
  const [intencoes, agentes, numeros, funis] = await Promise.all([
    lerIntencoes(admin, orgId),
    lerAgentes(admin, orgId),
    listSelectableChannels(admin, orgId),
    lerFunisComEtapas(admin, orgId),
  ]);
  const nomeDoAgente = (id: string | null) => (id ? (agentes.find((a) => a.id === id)?.name ?? id) : null);

  return roteadores.map((r) => {
    const numero = numeros.find((n) => n.id === r.channel_session_id);
    return {
      id: r.id,
      nome: r.name,
      ligado: r.is_active,
      numero: numero
        ? { id: numero.id, nome: numero.display_name, telefone: numero.phone_number, conectado: numero.status === STATUS_SAUDAVEL }
        : { id: r.channel_session_id, nome: null, telefone: null, conectado: false },
      agente_reserva: nomeDoAgente(r.fallback_agent_id),
      intencoes: intencoes
        .filter((i) => i.router_id === r.id)
        .map((i) => {
          const funil = i.pipeline_id ? funis.find((f) => f.id === i.pipeline_id) : undefined;
          return {
            nome: i.intent_name,
            descricao: i.intent_description,
            exemplos: i.examples ?? [],
            agente: nomeDoAgente(i.agent_id),
            destino: i.pipeline_id
              ? {
                  funil: funil?.name ?? i.pipeline_id,
                  etapa: i.stage_id ? (funil?.etapas.find((e) => e.id === i.stage_id)?.name ?? i.stage_id) : null,
                }
              : null,
            ...(i.flow_pointer_id ? { roteiro_de_atendimento_id: i.flow_pointer_id } : {}),
          };
        }),
    };
  });
}

// ---------------------------------------------------------------------------
// garantir
// ---------------------------------------------------------------------------

export interface RoteadorGarantido {
  roteador: {
    id: string;
    nome: string;
    ligado: boolean;
    numero: { id: string; nome: string; telefone: string | null };
    agente_reserva: string | null;
    desfecho: Desfecho;
    mudancas: string[];
  };
  intencoes: { desfecho: Desfecho | "nao_pedidas"; total: number; mudancas: string[] };
  avisos: string[];
}

function acharAgente(agentes: LinhaDoAgente[], referencia: string): LinhaDoAgente {
  return acharPorNomeOuId(agentes, referencia, (a) => a.name, {
    singular: "o agente",
    comoListar: "Crie o agente com plataforma_garantir_agente, ou veja os que existem em plataforma_ver_agentes.",
  });
}

/** As intenções do pedido com agente, funil e etapa resolvidos em id, nesta organização. */
function resolverIntencoes(
  pedidas: IntencaoPedida[],
  agentes: LinhaDoAgente[],
  funis: FunilComEtapas[],
  atuais: LinhaDaIntencao[],
  avisos: string[],
): RouterMemberInput[] {
  const vistos = new Map<string, string>();
  const roteiroPorNome = new Map(atuais.map((i) => [chaveDoNome(i.intent_name), i.flow_pointer_id]));

  return pedidas.map((p, i) => {
    const nome = p.nome.trim();
    const chave = chaveDoNome(nome);
    const repetida = vistos.get(chave);
    if (repetida !== undefined) {
      throw new Recusa(
        `\`intencoes[${i}].nome\`: as intenções «${repetida}» e «${nome}» têm o mesmo nome. Cada intenção de um roteador precisa de um nome próprio.`,
      );
    }
    vistos.set(chave, nome);

    const agente = acharAgente(agentes, p.agente);

    let pipelineId: string | null = null;
    let stageId: string | null = null;
    if (p.destino) {
      const funil = acharPorNomeOuId(funis, p.destino.funil, (f) => f.name, {
        singular: "o funil",
        comoListar: "Crie o funil com plataforma_garantir_funil, ou veja os que existem em plataforma_ver_funis.",
      });
      pipelineId = funil.id;
      if (p.destino.etapa !== undefined) {
        const ref = p.destino.etapa.trim();
        const etapa = funil.etapas.find((e) => e.id === ref || chaveDeNome(e.name) === chaveDeNome(ref));
        if (!etapa) {
          throw new Recusa(
            `\`intencoes[${i}].destino.etapa\`: o funil «${funil.name}» não tem uma etapa chamada «${ref}». As etapas são: ${funil.etapas
              .map((e) => `«${e.name}»`)
              .join(", ")}. Sem \`etapa\`, vale a primeira etapa aberta do funil.`,
          );
        }
        if (etapa.is_won || etapa.is_lost) {
          avisos.push(
            `A intenção «${nome}» leva o negócio direto para «${etapa.name}», que é a etapa de ${etapa.is_won ? "ganho" : "perda"} do funil «${funil.name}»: o negócio chega lá já encerrado.`,
          );
        }
        stageId = etapa.id;
      }
    }

    return {
      agent_id: agente.id,
      intent_name: nome,
      intent_description: p.descricao.trim(),
      examples: (p.exemplos ?? []).map((e) => e.trim()).filter((e) => e !== ""),
      // O roteiro amarrado pela tela à intenção de mesmo nome é preservado.
      flow_pointer_id: roteiroPorNome.get(chave) ?? null,
      pipeline_id: pipelineId,
      stage_id: stageId,
    };
  });
}

/** A intenção gravada, na forma em que o pedido a descreve: é sobre ela que se pergunta "mudou?". */
function comoEntrada(i: LinhaDaIntencao): RouterMemberInput {
  return {
    agent_id: i.agent_id,
    intent_name: i.intent_name,
    intent_description: i.intent_description,
    examples: i.examples ?? [],
    flow_pointer_id: i.flow_pointer_id ?? null,
    pipeline_id: i.pipeline_id ?? null,
    stage_id: i.stage_id ?? null,
  };
}

/**
 * A gravação das intenções, pela MESMA bifurcação da rota: com o Postgres do
 * app, numa transação (`writeRouterMembers`); sem ele, pelo PostgREST
 * (`replaceRouterMembersHttp`). As recusas das duas viram frase.
 */
async function gravarIntencoes(c: Implantacao, routerId: string, members: RouterMemberInput[]): Promise<void> {
  let db: PoolClient | undefined;
  try {
    if (process.env.SUPABASE_DB_URL) {
      db = await getRequestPool().connect();
      await db.query("begin");
      await writeRouterMembers(db, c.orgId, routerId, members, "replace");
      await db.query("commit");
    } else {
      await replaceRouterMembersHttp(c.admin, c.orgId, routerId, members);
    }
  } catch (err) {
    if (db) await db.query("rollback").catch(() => undefined);
    const mensagem = err instanceof Error ? err.message : "";
    const codigo = (err as { code?: string } | null)?.code;
    if (mensagem === "router_not_found") throw new Recusa("O roteador não existe mais nesta organização. Chame de novo.");
    if (mensagem === "member_agent_not_found") {
      throw new Recusa("Um dos agentes das intenções não existe mais nesta organização (ou foi arquivado). Confira em plataforma_ver_agentes e chame de novo.");
    }
    if (mensagem === "member_flow_not_found") {
      throw new Recusa("O roteiro de atendimento amarrado a uma das intenções não existe mais. Tire o vínculo pela tela (IA › Roteadores) e chame de novo.");
    }
    if (codigo === "23503") {
      throw new Recusa("O funil ou a etapa de destino de uma intenção não existe mais nesta organização. Confira em plataforma_ver_funis e chame de novo.");
    }
    if (mensagem === "duplicate_intent_name" || codigo === "23505") {
      throw new Recusa("Duas intenções não podem ter o mesmo nome no roteador.");
    }
    throw new Error(`não consegui gravar as intenções do roteador: ${mensagem || "erro desconhecido"}`);
  } finally {
    db?.release();
  }
}

function recusaDeRoteadorLigado(nome: string): never {
  throw new Recusa(
    `O roteador «${nome}» está LIGADO, e ele não tem rascunho: a mudança valeria na próxima mensagem que chegar ao número. ` +
      "Desligue (plataforma_ligar_roteador com `ligado: false`), ajuste e religue.",
  );
}

export async function garantirRoteador(c: Implantacao, pedido: PedidoDeRoteador): Promise<RoteadorGarantido> {
  const avisos: string[] = [];
  const nome = pedido.nome.trim();
  if ((pedido.intencoes?.length ?? 0) > TETO_DE_INTENCOES) {
    throw new Recusa(`Um roteador aceita até ${TETO_DE_INTENCOES} intenções por chamada, e vieram ${pedido.intencoes?.length}.`);
  }

  const [roteadores, agentesTodos, numeros] = await Promise.all([
    lerRoteadores(c.admin, c.orgId),
    lerAgentes(c.admin, c.orgId),
    listSelectableChannels(c.admin, c.orgId),
  ]);
  // Arquivado não atende: a mesma conferência de `writeRouterMembers`.
  const agentes = agentesTodos.filter((a) => !a.archived_at);

  let existente: LinhaDoRoteador | undefined;
  if (pedido.roteador_id) {
    existente = roteadores.find((r) => r.id === pedido.roteador_id);
    if (!existente) {
      throw new Recusa(
        `Não existe roteador com o id ${pedido.roteador_id} nesta organização. Os que existem: ${roteadores.map((r) => `«${r.name}» (${r.id})`).join(", ") || "nenhum"}.`,
      );
    }
  } else {
    const comEsteNome = roteadores.filter((r) => chaveDoNome(r.name) === chaveDoNome(nome));
    if (comEsteNome.length > 1) {
      throw new Recusa(
        `Há ${comEsteNome.length} roteadores chamados «${nome}» nesta organização. Informe \`roteador_id\`: ${comEsteNome.map((r) => r.id).join(", ")}.`,
      );
    }
    existente = comEsteNome[0];
  }

  const reserva =
    pedido.agente_reserva === undefined ? undefined : pedido.agente_reserva === null ? null : acharAgente(agentes, pedido.agente_reserva);

  const precisaDeFunil = (pedido.intencoes ?? []).some((i) => i.destino);
  const funis = precisaDeFunil ? await lerFunisComEtapas(c.admin, c.orgId) : [];
  const intencoesAtuais = existente
    ? (await lerIntencoes(c.admin, c.orgId)).filter((i) => i.router_id === existente!.id)
    : [];
  const desejadas =
    pedido.intencoes === undefined ? undefined : resolverIntencoes(pedido.intencoes, agentes, funis, intencoesAtuais, avisos);

  let linha: LinhaDoRoteador;
  let desfecho: Desfecho = "ja_estava";
  const mudancas: string[] = [];

  if (!existente) {
    // ── roteador novo: o caminho de `POST /api/v1/ai/routers` ───────────────
    if (!pedido.numero) {
      throw new Recusa(
        numeros.length === 0
          ? "Roteador novo precisa de `numero`, e esta organização ainda não tem número de WhatsApp conectado. Conectar o número é com uma pessoa, em Conexões (/app/connections). Depois chame de novo."
          : `Roteador novo precisa de \`numero\`: o número em que ele divide o atendimento. Os conectados são: ${numeros
              .map((n) => `«${n.display_name}»${n.phone_number ? ` (${n.phone_number})` : ""}`)
              .join("; ")}.`,
      );
    }
    const numero = acharNumero(numeros, pedido.numero);
    // O modelo do classificador é da plataforma: roteador novo nasce no "Automático".
    const config = configDoRoteador(QUEM_NAO_ESCOLHE_IA, undefined, null);
    const { data: criado, error } = await c.admin
      .from("ai_routers")
      .insert({
        organization_id: c.orgId,
        name: nome,
        channel_session_id: numero.id,
        fallback_agent_id: reserva ? reserva.id : null,
        // Nasce DESLIGADO: ligar é `plataforma_ligar_roteador` (colocar_no_ar).
        is_active: false,
        ...(config !== undefined ? { config } : {}),
        created_by: c.autorUserId,
      })
      .select(COLUNAS_DO_ROTEADOR)
      .single();
    if (error || !criado) throw new Error(`não consegui criar o roteador: ${error?.message ?? "sem linha"}`);
    linha = criado as unknown as LinhaDoRoteador;
    desfecho = "criou";
    void audit({
      action: "ai.router_created",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "ai_router",
      resourceId: linha.id,
      requestId: c.requestId,
      metadata: { name: nome, channel_session_id: numero.id, is_active: false, via: "mcp_plataforma" },
    });
    avisos.push("O roteador nasceu DESLIGADO: ele ainda não decide nada. Para ele rodar, chame plataforma_ligar_roteador.");
  } else {
    // ── roteador que já existe: o caminho de `PATCH /api/v1/ai/routers/[id]` ─
    linha = existente;
    if (pedido.numero !== undefined && acharNumero(numeros, pedido.numero).id !== existente.channel_session_id) {
      throw new Recusa(
        `O roteador «${existente.name}» é de outro número, e o número de um roteador não se troca. Crie um roteador com outro nome para o número novo.`,
      );
    }
    const patch: Record<string, unknown> = {};
    if (existente.name !== nome) {
      patch.name = nome;
      mudancas.push("nome");
    }
    if (reserva !== undefined && (existente.fallback_agent_id ?? null) !== (reserva ? reserva.id : null)) {
      patch.fallback_agent_id = reserva ? reserva.id : null;
      mudancas.push("agente reserva");
    }
    if (Object.keys(patch).length > 0) {
      if (existente.is_active) recusaDeRoteadorLigado(existente.name);
      const { error } = await c.admin.from("ai_routers").update(patch).eq("id", existente.id).eq("organization_id", c.orgId);
      if (error) throw new Error(`não consegui atualizar o roteador: ${error.message}`);
      linha = { ...existente, ...(patch as Partial<LinhaDoRoteador>) };
      desfecho = "atualizou";
      void audit({
        action: "ai.router_updated",
        actorUserId: c.autorUserId,
        organizationId: c.orgId,
        resourceType: "ai_router",
        resourceId: existente.id,
        requestId: c.requestId,
        metadata: { patch: Object.keys(patch), via: "mcp_plataforma" },
      });
    }
  }

  // ── as intenções: o caminho de `PUT .../members` ──────────────────────────
  let intencoes: RoteadorGarantido["intencoes"] = { desfecho: "nao_pedidas", total: intencoesAtuais.length, mudancas: [] };
  if (desejadas !== undefined) {
    const atuais = intencoesAtuais.map(comoEntrada);
    if (mesmoConteudo(atuais, desejadas)) {
      intencoes = { desfecho: "ja_estava", total: desejadas.length, mudancas: [] };
    } else {
      if (linha.is_active) recusaDeRoteadorLigado(linha.name);
      await gravarIntencoes(c, linha.id, desejadas);
      const antes = new Map(atuais.map((a) => [chaveDoNome(a.intent_name), a]));
      const depois = new Set(desejadas.map((d) => chaveDoNome(d.intent_name)));
      const mudancasDasIntencoes = [
        ...desejadas.flatMap((d) => {
          const anterior = antes.get(chaveDoNome(d.intent_name));
          if (!anterior) return [`intenção «${d.intent_name}» criada`];
          return mesmoConteudo(anterior, d) ? [] : [`intenção «${d.intent_name}» atualizada`];
        }),
        ...atuais.filter((a) => !depois.has(chaveDoNome(a.intent_name))).map((a) => `intenção «${a.intent_name}» removida`),
      ];
      intencoes = {
        desfecho: atuais.length === 0 ? "criou" : "atualizou",
        total: desejadas.length,
        mudancas: mudancasDasIntencoes.length > 0 ? mudancasDasIntencoes : ["ordem das intenções"],
      };
      void audit({
        action: "ai.router_members_updated",
        actorUserId: c.autorUserId,
        organizationId: c.orgId,
        resourceType: "ai_router",
        resourceId: linha.id,
        requestId: c.requestId,
        metadata: { count: desejadas.length, via: "mcp_plataforma" },
      });
    }
  }

  // ── o que a pessoa precisa saber antes de ligar ───────────────────────────
  const finais = desejadas ?? intencoesAtuais.map(comoEntrada);
  if (finais.length === 0) {
    avisos.push("O roteador não tem intenção nenhuma: informe `intencoes`. Sem elas ele não roteia nada.");
  }
  const semVersao = [...new Set(finais.map((f) => f.agent_id))]
    .map((id) => agentes.find((a) => a.id === id))
    .filter((a): a is LinhaDoAgente => a !== undefined && estadoDoAgente(a) !== "no_ar");
  if (semVersao.length > 0) {
    avisos.push(
      `${semVersao.map((a) => `«${a.name}»`).join(", ")} ${semVersao.length === 1 ? "não está" : "não estão"} no ar: a intenção que aponta para agente sem versão publicada cai no agente reserva. ` +
        "Publique com plataforma_publicar_agente antes de ligar o roteador.",
    );
  }
  if (linha.fallback_agent_id === null && finais.length > 0) {
    avisos.push("Sem `agente_reserva`: quando nenhuma intenção casar, responde o agente publicado no número (o de maior prioridade).");
  }
  if (finais.some((f) => f.pipeline_id)) {
    avisos.push(
      "Intenção com `destino` MOVE o negócio do cliente: quando ela casa, o card vai para o funil de destino e o negócio de origem é encerrado como transferência (não conta como perda). " +
        "Se a etapa de destino exige um campo que o negócio não tem, a transferência é recusada e abre um aviso na Central.",
    );
  }

  const numero = numeros.find((n) => n.id === linha.channel_session_id);
  return {
    roteador: {
      id: linha.id,
      nome: linha.name,
      ligado: linha.is_active,
      numero: { id: linha.channel_session_id, nome: numero ? numero.display_name : "", telefone: numero ? numero.phone_number : null },
      agente_reserva: linha.fallback_agent_id ? (agentes.find((a) => a.id === linha.fallback_agent_id)?.name ?? linha.fallback_agent_id) : null,
      desfecho,
      mudancas,
    },
    intencoes,
    avisos,
  };
}

// ---------------------------------------------------------------------------
// ligar e desligar
// ---------------------------------------------------------------------------

export interface RoteadorLigado {
  roteador: { id: string; nome: string; ligado: boolean };
  desfecho: "atualizou" | "ja_estava";
  avisos: string[];
}

export async function ligarRoteador(c: Implantacao, pedido: { roteador: string; ligado: boolean }): Promise<RoteadorLigado> {
  const avisos: string[] = [];
  const roteadores = await lerRoteadores(c.admin, c.orgId);
  const roteador = acharPorNomeOuId(roteadores, pedido.roteador, (r) => r.name, {
    singular: "o roteador",
    comoListar: "Crie o roteador com plataforma_garantir_roteador, ou veja os que existem em plataforma_ver_agentes.",
  });
  if (roteador.is_active === pedido.ligado) {
    return { roteador: { id: roteador.id, nome: roteador.name, ligado: roteador.is_active }, desfecho: "ja_estava", avisos };
  }

  if (pedido.ligado) {
    const [intencoes, agentes, numeros] = await Promise.all([
      lerIntencoes(c.admin, c.orgId),
      lerAgentes(c.admin, c.orgId),
      listSelectableChannels(c.admin, c.orgId),
    ]);
    const doRoteador = intencoes.filter((i) => i.router_id === roteador.id);
    if (doRoteador.length === 0) {
      throw new Recusa(
        `O roteador «${roteador.name}» não tem intenção nenhuma: ligado, ele não rotearia nada. Informe \`intencoes\` em plataforma_garantir_roteador e ligue depois.`,
      );
    }
    // Um roteador ativo por número (`uniq_ai_routers_active_session`).
    const outro = roteadores.find((r) => r.id !== roteador.id && r.is_active && r.channel_session_id === roteador.channel_session_id);
    if (outro) {
      throw new Recusa(
        `Este número já tem um roteador ligado, «${outro.name}», e só um decide por número. Desligue-o antes (plataforma_ligar_roteador com \`ligado: false\`).`,
      );
    }
    avisarAntesDeLigar(roteador, doRoteador, agentes, numeros, avisos);
  }

  const { error } = await c.admin
    .from("ai_routers")
    .update({ is_active: pedido.ligado })
    .eq("id", roteador.id)
    .eq("organization_id", c.orgId);
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new Recusa("Este número já tem um roteador ligado, e só um decide por número. Desligue o outro antes.");
    }
    throw new Error(`não consegui ${pedido.ligado ? "ligar" : "desligar"} o roteador: ${error.message}`);
  }
  void audit({
    action: "ai.router_updated",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "ai_router",
    resourceId: roteador.id,
    requestId: c.requestId,
    metadata: { patch: ["is_active"], is_active: pedido.ligado, via: "mcp_plataforma" },
  });
  if (!pedido.ligado) {
    avisos.push("Com o roteador desligado, volta a responder o agente publicado no número (o de maior prioridade).");
  }
  return { roteador: { id: roteador.id, nome: roteador.name, ligado: pedido.ligado }, desfecho: "atualizou", avisos };
}

/** O que não impede ligar, mas muda o que o cliente final vai ver. */
function avisarAntesDeLigar(
  roteador: LinhaDoRoteador,
  intencoes: LinhaDaIntencao[],
  agentes: LinhaDoAgente[],
  numeros: SelectableChannel[],
  avisos: string[],
): void {
  const numero = numeros.find((n) => n.id === roteador.channel_session_id);
  if (!numero || numero.status !== STATUS_SAUDAVEL) {
    avisos.push("O número deste roteador não está conectado: ele só decide quando o número voltar. Uma pessoa reconecta em Conexões (/app/connections).");
  }
  const foraDoAr = [...new Set(intencoes.map((i) => i.agent_id))]
    .map((id) => agentes.find((a) => a.id === id))
    .filter((a): a is LinhaDoAgente => a !== undefined && (Boolean(a.archived_at) || estadoDoAgente(a) !== "no_ar"));
  if (foraDoAr.length > 0) {
    avisos.push(
      `${foraDoAr.map((a) => `«${a.name}»`).join(", ")} ${foraDoAr.length === 1 ? "não está" : "não estão"} no ar: a intenção que aponta para ${foraDoAr.length === 1 ? "ele" : "eles"} cai no agente reserva. Publique com plataforma_publicar_agente.`,
    );
  }
  if (roteador.fallback_agent_id === null) {
    avisos.push("Sem agente reserva: quando nenhuma intenção casar, responde o agente publicado no número.");
  }
}
