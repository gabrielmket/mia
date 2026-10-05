/**
 * FORK MIA — GARANTIR e PUBLICAR um fluxo de follow-up a partir de um modelo.
 *
 * ── O caminho da tela que isto espelha ────────────────────────────────────
 *
 *   instalar o modelo   `POST /api/v1/ai/followup-flows/from-model`: o modelo
 *                       do catálogo (`lib/followup/modelos/`) vira um fluxo
 *                       RASCUNHO, com os textos, os prazos e o gatilho
 *   ajustar             `PATCH /api/v1/ai/followup-flows/[id]`, com o mesmo
 *                       `patchFollowupFlowSchema`
 *   publicar            `POST /api/v1/ai/followup-flows/[id]/publish`: a
 *                       validação da tela (`validateFlowForPublish`, com as
 *                       etapas citadas e os canais da organização) e a função
 *                       do banco `fn_publish_followup_flow_version`
 *   desligar            `POST /api/v1/ai/followup-flows/[id]/disable`
 *
 * ── Por que espelha, em vez de extrair ────────────────────────────────────
 *
 * As outras áreas tiraram a sequência de dentro da rota para a rota e a
 * ferramenta chamarem a mesma função. Aqui a rota de publicar é LIDA por uma
 * cerca do upstream (`tests/unit/gatilhos-oferecidos-tem-motor.test.ts` procura
 * `KINDS_COM_MOTOR` no texto dela), e movê-la quebraria essa cerca. Então a
 * sequência daqui é montada com as MESMAS funções de `lib/followup/`, e a
 * única regra que morava só na rota, a lista de gatilhos com motor, é
 * comparada com a da rota em `tests/unit/mcp-de-implantacao-espelhos.test.ts`:
 * se o upstream acrescentar um gatilho lá e não aqui, o teste reprova.
 *
 * ── O que instalar NÃO faz, como na tela ──────────────────────────────────
 *
 * Não publica e não arma o fluxo em agente nenhum. Gatilho automático só
 * inscreve alguém se um agente PUBLICADO tem o fluxo na lista dele: isso é
 * `plataforma_garantir_agente` com `followups`.
 *
 * ── As caixas que não falam com o cliente (upstream 1.70, #2181) ──────────
 *
 * O construtor ganhou duas caixas: "mover lead no funil" (`move_lead`) e
 * "editar tag do lead" (`edit_lead_tag`). Nenhum modelo do catálogo as traz,
 * então a ferramenta as GARANTE no rascunho: ou ajusta uma caixa que já existe
 * (`no`), ou põe uma caixa nova ANTES de um nó (`antes_de`), que é como se diz
 * "quando o fluxo chegar aqui, mova o card": antes do fim «sem resposta», antes
 * de uma mensagem. Pôr antes de um nó desvia para a caixa TODAS as setas que
 * chegavam nele e liga a caixa a ele por uma seta só, que é a forma que o motor
 * exige (`processNode`: a caixa avança pela única aresta `always`).
 *
 * A forma de cada caixa é a do upstream (`flowGraphSchema`), o rascunho passa
 * pelo mesmo `patchFollowupFlowSchema` do PATCH, e quem exige etapa viva e
 * etiqueta preenchida é a publicação (`validateFlowForPublish`), como na tela.
 *
 * ── O gatilho de silêncio (upstream 1.70, #2037) ──────────────────────────
 *
 * Três parâmetros novos do gatilho `silence`, conferidos pelo mesmo
 * `triggerConfigSchema`: o teto do silêncio, a pausa antes de recomeçar para
 * quem já passou pelo fluxo, e de onde a pausa conta. A ferramenta os grava
 * como a tela grava: pausa zero some com a chave, e a base só existe com pausa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { patchFollowupFlowSchema, triggerConfigSchema, type TriggerConfig } from "@/lib/followup/api-schemas";
import { carregaEtapasCitadas } from "@/lib/followup/etapas-citadas";
import { flowGraphSchema, type FlowGraph } from "@/lib/followup/graph-schema";
import { modeloPorId, MODELOS_DE_FOLLOWUP } from "@/lib/followup/modelos";
import { numeroEhDaOrganizacao } from "@/lib/followup/numero-do-gatilho";
import { MAX_PAUSA_DE_REENTRADA_MINUTES } from "@/lib/followup/pausa-de-reentrada";
import { publishFollowupFlowVersion } from "@/lib/followup/publish";
import { rascunhoDoFluxo } from "@/lib/followup/rascunho";
import { algumCanalExigeModeloForaDaJanela, validateFlowForPublish } from "@/lib/followup/validate-publish";
import { chaveDeNome } from "@/lib/leads/stage-editing";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

import { acharPorNomeOuId, chaveDoNome, mesmoConteudo, type Desfecho, type Implantacao } from "./base";
import { acharNumero } from "./agente";

/**
 * Os gatilhos que têm motor de inscrição vivo. A MESMA lista de
 * `KINDS_COM_MOTOR` na rota de publicar, conferida contra ela por teste.
 */
export const GATILHOS_COM_MOTOR: readonly string[] = [
  "manual",
  "webhook",
  "silence",
  "stage_change",
  "case_opened",
  "appointment_no_show",
  "inbound_after_silence",
  "lead_created",
];

const COLUNAS_DO_FLUXO =
  "id, name, status, active_version_id, draft_graph, handoff_policy, trigger_config, surface, created_at, updated_at";

export interface LinhaDoFluxo {
  id: string;
  name: string;
  status: string;
  active_version_id: string | null;
  draft_graph: FlowGraph | null;
  handoff_policy: string;
  trigger_config: TriggerConfig | null;
  surface: string | null;
  updated_at: string;
}

export async function lerFluxos(admin: SupabaseClient, orgId: string): Promise<LinhaDoFluxo[]> {
  const { data, error } = await admin
    .from("followup_flow_pointers")
    .select(COLUNAS_DO_FLUXO)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`não consegui ler os fluxos de follow-up: ${error.message}`);
  // Roteiro de atendimento é outra superfície, com tela e regras próprias.
  return ((data ?? []) as unknown as LinhaDoFluxo[]).filter((f) => f.surface !== "atendimento");
}

export interface PedidoDeFollowup {
  /** O id do modelo do catálogo (ver plataforma_listar_modelos). Obrigatório para instalar. */
  modelo?: string;
  /** O nome do fluxo. Sem ele, vale o nome do modelo. É a chave para repetir sem duplicar. */
  nome?: string;
  /** Para o modelo que dispara por etapa: o funil e a etapa, pelo nome. */
  etapa?: { funil: string; etapa: string };
  /** Troca o texto (ou a instrução para a IA) dos nós de mensagem, pelo id do nó. */
  textos?: Array<{ no: string; texto: string }>;
  /** Troca a espera dos nós de espera fixa, pelo id do nó, em minutos. */
  esperas?: Array<{ no: string; minutos: number }>;
  /** Para gatilho de silêncio: depois de quantos minutos sem resposta. */
  silencio_minutos?: number;
  /** Para gatilho de negócio criado: por qual número abordar (id, nome ou telefone). */
  numero?: string;
  cancelar_ao_responder?: boolean;
  /** O que acontece com o fluxo quando uma pessoa assume a conversa. */
  quando_humano_assume?: "pause" | "cancel" | "allow";
  /**
   * Para gatilho de silêncio: o fluxo só começa enquanto o silêncio for
   * RECENTE (entre `silencio_minutos` e este teto). `null` tira o teto.
   */
  silencio_maximo_minutos?: number | null;
  /**
   * Para gatilho de silêncio: quanto esperar antes de o fluxo recomeçar para
   * quem JÁ passou por ele. `0` ou `null` = sem pausa.
   */
  pausa_para_recomecar_minutos?: number | null;
  /** A pausa conta do último envio deste fluxo, e não da última mensagem do cliente. */
  pausa_conta_do_ultimo_envio?: boolean;
  /** Caixas "mover lead no funil": o card vai para a etapa quando o fluxo chega ali. */
  mover_no_funil?: Array<AncoraDaCaixa & { funil: string; etapa: string }>;
  /** Caixas "editar tag do lead": as etiquetas são gravadas no negócio quando o fluxo chega ali. */
  etiquetar?: Array<AncoraDaCaixa & { etiquetas: string[] }>;
}

/** Onde a caixa está: uma que já existe (`no`), ou uma nova antes de um nó (`antes_de`). */
export interface AncoraDaCaixa {
  no?: string;
  antes_de?: string;
  rotulo?: string;
}

export interface FollowupGarantido {
  fluxo: { id: string; nome: string; situacao: string; desfecho: Desfecho; mudancas: string[] };
  gatilho: string;
  nos: ReturnType<typeof nosDoGrafo>;
  avisos: string[];
}

/**
 * O grafo em palavras: o que o implantador precisa para ajustar texto, prazo e
 * as caixas que mexem no negócio. `nomeDaEtapa` dá nome ao destino de uma caixa
 * de mover (o grafo guarda só o id).
 */
export function nosDoGrafo(grafo: FlowGraph | null, nomeDaEtapa?: (id: string) => string | null) {
  if (!grafo) return [];
  return grafo.nodes.map((n) => {
    const base = { no: n.id, tipo: n.type as string, rotulo: n.label ?? null };
    if (n.type === "action") {
      const cfg = n.config;
      if (cfg.mode === "text") return { ...base, modo: "texto", texto: cfg.body };
      if (cfg.mode === "ai_message") return { ...base, modo: "mensagem_da_ia", texto: cfg.prompt_hint };
      return { ...base, modo: "modelo_do_canal" };
    }
    if (n.type === "wait" && n.config.mode === "fixed") {
      return { ...base, espera_minutos: Math.round(n.config.duration_ms / 60_000) };
    }
    if (n.type === "move_lead") {
      const id = n.config.stage_id.trim();
      return {
        ...base,
        faz: "move o card para outra etapa do funil",
        etapa_de_destino_id: id === "" ? null : id,
        ...(id !== "" && nomeDaEtapa ? { etapa_de_destino: nomeDaEtapa(id) } : {}),
      };
    }
    if (n.type === "edit_lead_tag") {
      return { ...base, faz: "grava etiquetas no negócio", etiquetas: n.config.tags };
    }
    return base;
  });
}

// ---------------------------------------------------------------------------
// as caixas que não falam com o cliente
// ---------------------------------------------------------------------------

/** Uma caixa já com o destino resolvido em id, pronta para entrar no grafo. */
export type CaixaResolvida = AncoraDaCaixa &
  ({ tipo: "move_lead"; config: { stage_id: string } } | { tipo: "edit_lead_tag"; config: { tags: string[] } });

/** O rótulo com que cada caixa nasce no construtor (`nodeVisuals.ts`) e o prefixo do id estável. */
const CAIXA: Record<CaixaResolvida["tipo"], { prefixo: string; rotulo: string; oQue: string; campo: string }> = {
  move_lead: { prefixo: "mover", rotulo: "Mover card de etapa", oQue: "mover no funil", campo: "mover_no_funil" },
  edit_lead_tag: { prefixo: "etiqueta", rotulo: "Gravar tag no lead", oQue: "etiquetar", campo: "etiquetar" },
};

/** A largura de uma coluna do desenho dos modelos (`modelos/escada.ts`). */
const COLUNA_DO_DESENHO = 260;

/**
 * O id de uma caixa posta por aqui: estável, legível e derivado de ONDE ela
 * está. É o que faz a segunda chamada achar a caixa em vez de pôr outra.
 */
export function idDaCaixa(tipo: CaixaResolvida["tipo"], antesDe: string): string {
  return `${CAIXA[tipo].prefixo}-antes-de-${antesDe}`;
}

/**
 * Garante as caixas no grafo. Pura: recebe o grafo e as caixas resolvidas e
 * devolve o grafo novo e o que mudou. Rodar de novo com o mesmo pedido não muda
 * nada, porque a caixa é achada pelo id.
 */
export function garantirCaixas(grafo: FlowGraph, caixas: readonly CaixaResolvida[]): { grafo: FlowGraph; mudancas: string[] } {
  let nodes = [...grafo.nodes];
  let edges = [...grafo.edges];
  const mudancas: string[] = [];
  const lista = () => nodes.map((n) => `${n.id} (${n.type})`).join(", ");

  for (const caixa of caixas) {
    const visual = CAIXA[caixa.tipo];
    if ((caixa.no === undefined) === (caixa.antes_de === undefined)) {
      throw new Recusa(
        `Cada item de \`${visual.campo}\` informa \`no\` (ajusta uma caixa que já existe) OU \`antes_de\` (garante uma caixa antes daquele nó), e só um dos dois. ` +
          "Veja os nós em plataforma_ver_followup.",
      );
    }
    const id = caixa.no ?? idDaCaixa(caixa.tipo, caixa.antes_de as string);
    const existente = nodes.find((n) => n.id === id);

    if (existente) {
      if (existente.type !== caixa.tipo) {
        throw new Recusa(
          `O nó «${id}» é do tipo ${existente.type}, e \`${visual.campo}\` só ajusta caixa do tipo ${caixa.tipo}. Os nós são: ${lista()}.`,
        );
      }
      const rotulo = caixa.rotulo ?? existente.label;
      if (!mesmoConteudo(existente.config, caixa.config) || rotulo !== existente.label) {
        nodes = nodes.map((n) => (n.id === id ? ({ ...n, label: rotulo, config: caixa.config } as FlowGraph["nodes"][number]) : n));
        mudancas.push(caixa.tipo === "move_lead" ? `destino de ${id}` : `etiquetas de ${id}`);
      }
      continue;
    }

    if (caixa.no !== undefined) {
      throw new Recusa(`O fluxo não tem um nó «${caixa.no}». Os nós são: ${lista()}.`);
    }
    const alvo = nodes.find((n) => n.id === caixa.antes_de);
    if (!alvo) {
      throw new Recusa(`\`antes_de\`: o fluxo não tem um nó «${caixa.antes_de}». Os nós são: ${lista()}.`);
    }
    if (alvo.type === "trigger") {
      throw new Recusa(
        `«${alvo.id}» é o início do fluxo, e nada vem antes dele. Para a caixa rodar logo que o fluxo começa, use \`antes_de\` com o primeiro nó depois do início.`,
      );
    }
    if (!edges.some((e) => e.target === alvo.id)) {
      throw new Recusa(
        `Nenhuma seta chega ao nó «${alvo.id}»: uma caixa posta antes dele nunca rodaria. Ligue o nó pela tela (IA › Follow-ups) ou escolha outro.`,
      );
    }

    // Abre uma coluna no desenho: o alvo e tudo que está à direita dele andam
    // para o lado, e a caixa ocupa o lugar do alvo, na mesma linha.
    const lugar = { x: alvo.position.x, y: alvo.position.y };
    nodes = nodes.map((n) =>
      n.position.x >= lugar.x ? ({ ...n, position: { x: n.position.x + COLUNA_DO_DESENHO, y: n.position.y } } as FlowGraph["nodes"][number]) : n,
    );
    nodes.push({ id, type: caixa.tipo, label: caixa.rotulo ?? visual.rotulo, position: lugar, config: caixa.config } as FlowGraph["nodes"][number]);
    // Toda seta que chegava ao alvo passa a chegar à caixa, com a MESMA
    // condição (o ramo continua sendo o ramo); a caixa segue para o alvo por uma
    // seta só, que é a que o motor procura.
    edges = edges.map((e) => (e.target === alvo.id ? { ...e, target: id } : e));
    edges.push({ id: `${id}__${alvo.id}__segue`, source: id, target: alvo.id, priority: 0, condition: { type: "always" } });
    mudancas.push(`caixa de ${visual.oQue} antes de ${alvo.id}`);
  }

  return { grafo: { ...grafo, nodes, edges } as FlowGraph, mudancas };
}

async function resolverEtapa(admin: SupabaseClient, orgId: string, ref: { funil: string; etapa: string }): Promise<string> {
  const { data: funis, error } = await admin.from("crm_pipelines").select("id, name, is_archived").eq("organization_id", orgId);
  if (error) throw new Error(`não consegui ler os funis: ${error.message}`);
  const funil = acharPorNomeOuId(
    ((funis ?? []) as Array<{ id: string; name: string; is_archived: boolean }>).filter((f) => !f.is_archived),
    ref.funil,
    (f) => f.name,
    { singular: "o funil", comoListar: "Crie o funil com plataforma_garantir_funil antes do follow-up." },
  );
  const { data: etapas, error: etapasErr } = await admin
    .from("crm_stages")
    .select("id, name, is_archived")
    .eq("organization_id", orgId)
    .eq("pipeline_id", funil.id);
  if (etapasErr) throw new Error(`não consegui ler as etapas: ${etapasErr.message}`);
  const vivas = ((etapas ?? []) as Array<{ id: string; name: string; is_archived: boolean }>).filter((e) => !e.is_archived);
  const etapa = vivas.find((e) => e.id === ref.etapa || chaveDeNome(e.name) === chaveDeNome(ref.etapa));
  if (!etapa) {
    throw new Recusa(
      `O funil «${funil.name}» não tem uma etapa chamada «${ref.etapa}». As etapas são: ${vivas.map((e) => `«${e.name}»`).join(", ")}.`,
    );
  }
  return etapa.id;
}

/**
 * As caixas do pedido com o destino resolvido: a etapa pelo nome (viva, deste
 * funil, desta organização) e as etiquetas limpas. O que cada caixa faz na hora
 * de rodar entra em `avisos`, porque nem sempre é o que o nome sugere.
 */
async function resolverCaixas(c: Implantacao, pedido: PedidoDeFollowup, avisos: string[]): Promise<CaixaResolvida[]> {
  const caixas: CaixaResolvida[] = [];
  const ancora = (a: AncoraDaCaixa): AncoraDaCaixa => ({
    ...(a.no !== undefined ? { no: a.no } : {}),
    ...(a.antes_de !== undefined ? { antes_de: a.antes_de } : {}),
    ...(a.rotulo !== undefined ? { rotulo: a.rotulo } : {}),
  });

  for (const m of pedido.mover_no_funil ?? []) {
    const stageId = await resolverEtapa(c.admin, c.orgId, { funil: m.funil, etapa: m.etapa });
    caixas.push({ ...ancora(m), tipo: "move_lead", config: { stage_id: stageId } });
  }
  for (const [i, e] of (pedido.etiquetar ?? []).entries()) {
    const tags = [...new Set(e.etiquetas.map((t) => t.trim()).filter((t) => t !== ""))];
    if (tags.length === 0) {
      throw new Recusa(`\`etiquetar[${i}].etiquetas\`: informe ao menos uma etiqueta com texto (ex.: ["Follow-up sem resposta"]).`);
    }
    caixas.push({ ...ancora(e), tipo: "edit_lead_tag", config: { tags } });
  }

  if ((pedido.mover_no_funil ?? []).length > 0) {
    avisos.push(
      "A caixa de mover leva o negócio MAIS RECENTE do contato que está no funil da etapa de destino. Contato sem negócio nesse funil não tem card para mover, e o fluxo segue.",
    );
  }
  if ((pedido.etiquetar ?? []).length > 0) {
    avisos.push("A caixa de etiquetar grava no negócio mais recente do contato; sem negócio, grava no contato.");
  }
  return caixas;
}

/** O grafo que vai ser gravado passa pela forma do upstream; a recusa diz o que não coube. */
function conferirGrafo(grafo: FlowGraph): void {
  const lido = flowGraphSchema.safeParse(grafo);
  if (lido.success) return;
  const onde = lido.error.issues.map((i) => i.path.join(".")).join(" ");
  if (grafo.nodes.length > 60) {
    throw new Recusa(`O fluxo ficaria com ${grafo.nodes.length} caixas, e o construtor aceita até 60. Tire caixas pela tela (IA › Follow-ups) antes de acrescentar.`);
  }
  if (/config\.tags/.test(onde)) {
    throw new Recusa("As etiquetas não passaram na conferência: até 10 por caixa, cada uma com até 60 caracteres.");
  }
  if (/\.label/.test(onde)) {
    throw new Recusa("O `rotulo` de uma caixa tem de 1 a 60 caracteres.");
  }
  throw new Recusa("Os ajustes não passaram na conferência: cada mensagem tem de 1 a 4000 caracteres, e cada instrução para a IA de 1 a 1000.");
}

/** Aplica os ajustes de texto e de espera num grafo. Devolve o grafo novo e o que mudou. */
function ajustarGrafo(grafo: FlowGraph, pedido: PedidoDeFollowup): { grafo: FlowGraph; mudancas: string[] } {
  const mudancas: string[] = [];
  const ids = grafo.nodes.map((n) => n.id);
  const nodes = grafo.nodes.map((no) => {
    const texto = pedido.textos?.find((t) => t.no === no.id);
    if (texto) {
      if (no.type !== "action") {
        throw new Recusa(`O nó «${no.id}» é do tipo ${no.type}, não é uma mensagem. Os nós de mensagem são os de tipo "action".`);
      }
      if (no.config.mode === "text" && no.config.body !== texto.texto) {
        mudancas.push(`texto de ${no.id}`);
        return { ...no, config: { ...no.config, body: texto.texto } };
      }
      if (no.config.mode === "ai_message" && no.config.prompt_hint !== texto.texto) {
        mudancas.push(`instrução de ${no.id}`);
        return { ...no, config: { ...no.config, prompt_hint: texto.texto } };
      }
      if (no.config.mode === "template") {
        throw new Recusa(`O nó «${no.id}» envia um modelo aprovado do canal; o texto dele é o do modelo, e se troca pela tela.`);
      }
    }
    const espera = pedido.esperas?.find((e) => e.no === no.id);
    if (espera) {
      if (no.type !== "wait" || no.config.mode !== "fixed") {
        throw new Recusa(`O nó «${no.id}» não é uma espera fixa. Use plataforma_ver_followup para ver os nós com \`espera_minutos\`.`);
      }
      const ms = espera.minutos * 60_000;
      if (no.config.duration_ms !== ms) {
        mudancas.push(`espera de ${no.id}`);
        return { ...no, config: { ...no.config, duration_ms: ms } };
      }
    }
    return no;
  });
  for (const ref of [...(pedido.textos ?? []), ...(pedido.esperas ?? [])]) {
    if (!ids.includes(ref.no)) {
      throw new Recusa(`O fluxo não tem um nó «${ref.no}». Os nós são: ${ids.join(", ")}.`);
    }
  }
  return { grafo: { ...grafo, nodes } as FlowGraph, mudancas };
}

/** O gatilho com os parâmetros que o pedido trouxe por cima. */
async function ajustarGatilho(
  c: Implantacao,
  atual: TriggerConfig,
  pedido: PedidoDeFollowup,
): Promise<{ gatilho: TriggerConfig; mudancas: string[] }> {
  const mudancas: string[] = [];
  const novo = JSON.parse(JSON.stringify(atual)) as Record<string, unknown> & { kind: string; params?: Record<string, unknown> };

  if (pedido.silencio_minutos !== undefined) {
    if (novo.kind !== "silence" && novo.kind !== "inbound_after_silence") {
      throw new Recusa(`\`silencio_minutos\` só vale para fluxo que dispara por silêncio; este dispara por «${novo.kind}».`);
    }
    novo.params = { ...(novo.params ?? {}), threshold_minutes: pedido.silencio_minutos };
  }
  if (pedido.etapa !== undefined) {
    if (novo.kind !== "stage_change") {
      throw new Recusa(`\`etapa\` só vale para fluxo que dispara por etapa do funil; este dispara por «${novo.kind}».`);
    }
    novo.params = { ...(novo.params ?? {}), stage_id: await resolverEtapa(c.admin, c.orgId, pedido.etapa) };
  }
  if (pedido.numero !== undefined) {
    if (novo.kind !== "lead_created") {
      throw new Recusa(`\`numero\` só vale para fluxo que dispara por negócio criado; este dispara por «${novo.kind}».`);
    }
    const canal = acharNumero(await listSelectableChannels(c.admin, c.orgId), pedido.numero);
    // A mesma conferência da rota: o número é um canal ativo DESTA organização.
    const conferido = await numeroEhDaOrganizacao(c.admin, c.orgId, canal.id);
    if (!conferido.ok) throw new Recusa("O número escolhido para o gatilho não é desta empresa ou foi excluído. Escolha outro número.");
    novo.params = { ...(novo.params ?? {}), channel_session_id: canal.id };
  }
  if (pedido.cancelar_ao_responder !== undefined) novo.cancel_on_reply = pedido.cancelar_ao_responder;

  // ── os três parâmetros do gatilho de silêncio (upstream 1.70, #2037) ──────
  const doSilencio = [
    ["silencio_maximo_minutos", pedido.silencio_maximo_minutos],
    ["pausa_para_recomecar_minutos", pedido.pausa_para_recomecar_minutos],
    ["pausa_conta_do_ultimo_envio", pedido.pausa_conta_do_ultimo_envio],
  ] as const;
  const pedidos = doSilencio.filter(([, valor]) => valor !== undefined).map(([campo]) => campo);
  if (pedidos.length > 0) {
    if (novo.kind !== "silence") {
      throw new Recusa(
        `${pedidos.map((p) => `\`${p}\``).join(", ")} só ${pedidos.length === 1 ? "vale" : "valem"} para fluxo que dispara por silêncio; este dispara por «${novo.kind}».`,
      );
    }
    const params: Record<string, unknown> = { ...(novo.params ?? {}) };
    if (pedido.silencio_maximo_minutos !== undefined) {
      if (pedido.silencio_maximo_minutos === null) delete params.max_silence_minutes;
      else params.max_silence_minutes = pedido.silencio_maximo_minutos;
    }
    // Como a tela grava: pausa zero some com a chave, e a base da pausa só
    // existe com pausa (e só quando não é a padrão, `ultima_mensagem`).
    if (pedido.pausa_para_recomecar_minutos !== undefined) {
      if (pedido.pausa_para_recomecar_minutos === null || pedido.pausa_para_recomecar_minutos === 0) {
        delete params.reentry_pause_minutes;
      } else {
        params.reentry_pause_minutes = pedido.pausa_para_recomecar_minutos;
      }
    }
    const temPausa = typeof params.reentry_pause_minutes === "number" && params.reentry_pause_minutes > 0;
    if (pedido.pausa_conta_do_ultimo_envio === true && !temPausa) {
      throw new Recusa(
        "`pausa_conta_do_ultimo_envio` diz de onde a pausa conta, e este fluxo não tem pausa. Informe `pausa_para_recomecar_minutos` junto (ex.: 1440 para um dia).",
      );
    }
    if (!temPausa || pedido.pausa_conta_do_ultimo_envio === false) delete params.reentry_pause_basis;
    else if (pedido.pausa_conta_do_ultimo_envio === true) params.reentry_pause_basis = "ultimo_envio";
    novo.params = params;
  }
  // O motor IGNORA, sem avisar, um teto que não passa do mínimo
  // (`silence-sweep.ts`): gravar seria prometer um corte que não acontece. Só
  // é conferido quando o pedido mexeu num dos dois, para um fluxo montado na
  // tela continuar aceitando os outros ajustes.
  if (
    novo.kind === "silence" &&
    (pedido.silencio_minutos !== undefined || (pedido.silencio_maximo_minutos ?? null) !== null)
  ) {
    const minimo = novo.params?.threshold_minutes;
    const teto = novo.params?.max_silence_minutes;
    if (typeof minimo === "number" && typeof teto === "number" && teto <= minimo) {
      throw new Recusa(
        `O teto do silêncio (\`silencio_maximo_minutos\`: ${teto}) precisa ser MAIOR que o silêncio que começa o fluxo (\`silencio_minutos\`: ${minimo}): ` +
          "o fluxo começa para quem está calado entre os dois. Aumente o teto, diminua o mínimo, ou tire o teto com `silencio_maximo_minutos: null`.",
      );
    }
  }

  const lido = triggerConfigSchema.safeParse(novo);
  if (!lido.success) {
    throw new Recusa(
      "O gatilho do fluxo não passou na conferência. `silencio_minutos` vai de 5 a 10080 no gatilho de silêncio, e de 60 a 129600 no de cliente que voltou; " +
        `\`silencio_maximo_minutos\` vai de 5 a 10080; \`pausa_para_recomecar_minutos\` vai de 0 a ${MAX_PAUSA_DE_REENTRADA_MINUTES}.`,
    );
  }
  if (!mesmoConteudo(lido.data, atual)) mudancas.push("gatilho");
  return { gatilho: lido.data, mudancas };
}

export async function garantirFollowup(c: Implantacao, pedido: PedidoDeFollowup): Promise<FollowupGarantido> {
  const avisos: string[] = [];
  const modelo = pedido.modelo ? modeloPorId(pedido.modelo) : undefined;
  if (pedido.modelo && !modelo) {
    throw new Recusa(
      `Não existe modelo de follow-up com o id «${pedido.modelo}». Os modelos são: ${MODELOS_DE_FOLLOWUP.map((m) => m.id).join(", ")}. ` +
        "Veja o que cada um faz em plataforma_listar_modelos, seção followup.",
    );
  }
  const nome = (pedido.nome ?? modelo?.nome ?? "").trim();
  if (nome === "") {
    throw new Recusa("Informe `modelo` (para instalar um fluxo) ou `nome` (para ajustar um fluxo que já existe).");
  }

  const fluxos = await lerFluxos(c.admin, c.orgId);
  const existente = fluxos.find((f) => chaveDoNome(f.name) === chaveDoNome(nome));

  // ── instalar: o caminho de `from-model` ───────────────────────────────────
  if (!existente) {
    if (!modelo) {
      throw new Recusa(
        `Não existe fluxo chamado «${nome}» nesta organização, e o pedido não trouxe \`modelo\`. ` +
          `Para instalar, informe o modelo. Os fluxos que existem: ${fluxos.map((f) => `«${f.name}»`).join(", ") || "nenhum"}.`,
      );
    }
    // A etapa é conferida AQUI: etapa de outra organização, apagada ou
    // arquivada deixaria o fluxo ativo sem nunca inscrever ninguém.
    let stageId: string | undefined;
    if (modelo.pedeEtapa) {
      if (!pedido.etapa) {
        throw new Recusa(
          `O modelo «${modelo.nome}» dispara quando o negócio entra numa etapa do funil. Informe \`etapa\`: { "funil": "nome do funil", "etapa": "nome da etapa" }.`,
        );
      }
      stageId = await resolverEtapa(c.admin, c.orgId, pedido.etapa);
    }

    const gatilhoBase = triggerConfigSchema.safeParse(modelo.gatilho({ stageId }));
    const grafoBase = flowGraphSchema.safeParse(modelo.grafo);
    const publicavel = grafoBase.success ? validateFlowForPublish(grafoBase.data) : null;
    if (!gatilhoBase.success || !grafoBase.success || (publicavel && !publicavel.ok)) {
      throw new Error(`modelo_invalido: ${modelo.id}`);
    }

    const ajustado = ajustarGrafo(grafoBase.data, pedido);
    const comCaixas = garantirCaixas(ajustado.grafo, await resolverCaixas(c, pedido, avisos));
    const grafo = comCaixas.grafo;
    const { gatilho } = await ajustarGatilho(c, gatilhoBase.data, { ...pedido, etapa: undefined });
    if (ajustado.mudancas.length + comCaixas.mudancas.length > 0) conferirGrafo(grafo);

    const { data: criado, error } = await c.admin
      .from("followup_flow_pointers")
      .insert({
        organization_id: c.orgId,
        name: nome,
        draft_graph: grafo,
        trigger_config: gatilho,
        handoff_policy: pedido.quando_humano_assume ?? modelo.handoffPolicy,
      })
      .select(COLUNAS_DO_FLUXO)
      .single();
    if (error || !criado) {
      if (error?.code === "23505") {
        throw new Recusa(`Já existe um fluxo chamado «${nome}». Chame de novo: ele será ajustado em vez de recriado.`);
      }
      throw new Error(`não consegui instalar o fluxo: ${error?.message ?? "sem linha"}`);
    }
    const linha = criado as unknown as LinhaDoFluxo;
    void audit({
      action: "followup_flow.created",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "followup_flow_pointer",
      resourceId: linha.id,
      requestId: c.requestId,
      metadata: { name: nome, model_id: modelo.id, trigger_kind: gatilho.kind, via: "mcp_plataforma" },
    });
    avisos.push(
      "O fluxo nasceu como RASCUNHO: não manda mensagem para ninguém. Para rodar, ele precisa ser publicado (plataforma_publicar_followup) e, se o gatilho é automático, armado num agente publicado (plataforma_garantir_agente com `followups`).",
    );
    return {
      fluxo: { id: linha.id, nome: linha.name, situacao: linha.status, desfecho: "criou", mudancas: [] },
      gatilho: gatilho.kind,
      nos: nosDoGrafo(grafo),
      avisos,
    };
  }

  // ── ajustar: o caminho do PATCH ───────────────────────────────────────────
  const rascunho = await rascunhoDoFluxo(c.admin, existente, c.orgId);
  if (!rascunho) throw new Recusa(`O fluxo «${existente.name}» está vazio. Monte-o pela tela (IA › Follow-ups) ou instale um modelo com outro nome.`);

  const ajustado = ajustarGrafo(rascunho, pedido);
  const comCaixas = garantirCaixas(ajustado.grafo, await resolverCaixas(c, pedido, avisos));
  const grafo = comCaixas.grafo;
  const mudancasDoGrafo = [...ajustado.mudancas, ...comCaixas.mudancas];
  const gatilhoAtual = triggerConfigSchema.safeParse(existente.trigger_config ?? { kind: "manual" });
  if (!gatilhoAtual.success) {
    throw new Recusa(`O gatilho do fluxo «${existente.name}» está num formato que não reconheço. Ajuste-o pela tela (IA › Follow-ups).`);
  }
  const { gatilho, mudancas: mudancasDoGatilho } = await ajustarGatilho(c, gatilhoAtual.data, pedido);

  const patch: Record<string, unknown> = {};
  // Com versão publicada e sem rascunho, o rascunho passa a existir a partir do
  // que está no ar: só assim o ajuste tem onde ser gravado.
  if (mudancasDoGrafo.length > 0) patch.draft_graph = grafo;
  if (mudancasDoGatilho.length > 0) patch.trigger_config = gatilho;
  if (pedido.quando_humano_assume !== undefined && pedido.quando_humano_assume !== existente.handoff_policy) {
    patch.handoff_policy = pedido.quando_humano_assume;
  }
  const mudancas = [
    ...mudancasDoGrafo,
    ...mudancasDoGatilho,
    ...(patch.handoff_policy ? ["quando uma pessoa assume"] : []),
  ];

  // O texto de um fluxo publicado muda no RASCUNHO e só vale depois de publicar.
  // O gatilho e a política moram no próprio fluxo e valeriam na hora: num fluxo
  // que está no ar, isso é mexer no que fala com o cliente final, e montar não
  // faz isso.
  if (existente.status === "active" && (patch.trigger_config !== undefined || patch.handoff_policy !== undefined)) {
    throw new Recusa(
      `O fluxo «${existente.name}» está publicado, e o gatilho e a regra de quando uma pessoa assume valem na hora. ` +
        "Desligue o fluxo (plataforma_publicar_followup com `ativo: false`), ajuste e publique de novo.",
    );
  }

  if (Object.keys(patch).length === 0) {
    return {
      fluxo: { id: existente.id, nome: existente.name, situacao: existente.status, desfecho: "ja_estava", mudancas: [] },
      gatilho: gatilho.kind,
      nos: nosDoGrafo(rascunho),
      avisos,
    };
  }

  if (patch.draft_graph !== undefined) conferirGrafo(grafo);
  const conferido = patchFollowupFlowSchema.safeParse(patch);
  if (!conferido.success) {
    throw new Recusa("Os ajustes não passaram na conferência: cada mensagem tem de 1 a 4000 caracteres, e cada instrução para a IA de 1 a 1000.");
  }
  const { data: atualizado, error: updErr } = await c.admin
    .from("followup_flow_pointers")
    .update({ ...conferido.data, updated_at: new Date().toISOString() })
    .eq("id", existente.id)
    .eq("organization_id", c.orgId)
    .select(COLUNAS_DO_FLUXO)
    .single();
  if (updErr || !atualizado) throw new Error(`não consegui ajustar o fluxo: ${updErr?.message ?? "sem linha"}`);

  void audit({
    action: "followup_flow.updated",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "followup_flow_pointer",
    resourceId: existente.id,
    requestId: c.requestId,
    metadata: { fields_changed: Object.keys(patch), via: "mcp_plataforma" },
  });
  if (existente.status === "active" && patch.draft_graph) {
    avisos.push("O fluxo está publicado: as mudanças (textos, esperas e caixas) ficaram no rascunho e só passam a valer depois de plataforma_publicar_followup.");
  }
  return {
    fluxo: { id: existente.id, nome: existente.name, situacao: existente.status, desfecho: "atualizou", mudancas },
    gatilho: gatilho.kind,
    nos: nosDoGrafo(grafo),
    avisos,
  };
}

// ---------------------------------------------------------------------------
// publicar e desligar
// ---------------------------------------------------------------------------

export interface FollowupPublicado {
  fluxo: { id: string; nome: string; situacao: string };
  desfecho: "publicou" | "desligou" | "ja_estava";
  avisos: string[];
}

export async function publicarFollowup(
  c: Implantacao,
  pedido: { fluxo: string; ativo: boolean },
): Promise<FollowupPublicado> {
  const avisos: string[] = [];
  const fluxos = await lerFluxos(c.admin, c.orgId);
  const fluxo = acharPorNomeOuId(fluxos, pedido.fluxo, (f) => f.name, {
    singular: "o fluxo de follow-up",
    comoListar: "Instale o fluxo com plataforma_garantir_followup.",
  });

  // ── desligar ──────────────────────────────────────────────────────────────
  if (!pedido.ativo) {
    if (fluxo.status !== "active") {
      return { fluxo: { id: fluxo.id, nome: fluxo.name, situacao: fluxo.status }, desfecho: "ja_estava", avisos };
    }
    const { error } = await c.admin
      .from("followup_flow_pointers")
      .update({ status: "disabled", updated_at: new Date().toISOString() })
      .eq("id", fluxo.id)
      .eq("organization_id", c.orgId);
    if (error) throw new Error(`não consegui desligar o fluxo: ${error.message}`);
    void audit({
      action: "followup_flow.disabled",
      actorUserId: c.autorUserId,
      organizationId: c.orgId,
      resourceType: "followup_flow_pointer",
      resourceId: fluxo.id,
      requestId: c.requestId,
      metadata: { via: "mcp_plataforma" },
    });
    return { fluxo: { id: fluxo.id, nome: fluxo.name, situacao: "disabled" }, desfecho: "desligou", avisos };
  }

  // ── publicar ──────────────────────────────────────────────────────────────
  const gatilho = (fluxo.trigger_config ?? { kind: "manual" }) as { kind?: string; params?: { stage_id?: string } };
  const kind = gatilho.kind ?? "manual";
  // ALLOWLIST, como na rota: gatilho só publica se tem motor de inscrição vivo.
  // Fora dela o fluxo ficaria ativo sem nunca inscrever ninguém.
  if (!GATILHOS_COM_MOTOR.includes(kind)) {
    throw new Recusa(`O gatilho «${kind}» não está disponível. Use etapa do funil, silêncio, negócio criado ou manual.`);
  }

  if (kind === "stage_change") {
    const stageId = gatilho.params?.stage_id;
    if (!stageId) {
      throw new Recusa(
        'Este fluxo dispara por etapa do funil e ainda não tem etapa. Chame plataforma_garantir_followup com `etapa`: { "funil": "...", "etapa": "..." }.',
      );
    }
    const { data: etapa, error } = await c.admin
      .from("crm_stages")
      .select("id, name, is_archived")
      .eq("id", stageId)
      .eq("organization_id", c.orgId)
      .maybeSingle();
    if (error) throw new Error(`não consegui conferir a etapa do gatilho: ${error.message}`);
    if (!etapa) {
      throw new Recusa("A etapa escolhida para o gatilho não existe mais neste funil. Chame plataforma_garantir_followup com `etapa` de novo.");
    }
    if ((etapa as { is_archived: boolean }).is_archived) {
      throw new Recusa(
        `A etapa «${(etapa as { name: string }).name}» está arquivada e nunca receberia um negócio. Escolha uma etapa ativa em plataforma_garantir_followup.`,
      );
    }
  }

  if (!fluxo.draft_graph) {
    if (fluxo.status === "active") {
      return { fluxo: { id: fluxo.id, nome: fluxo.name, situacao: "active" }, desfecho: "ja_estava", avisos };
    }
    throw new Recusa(`O fluxo «${fluxo.name}» não tem rascunho para publicar. Instale um modelo com plataforma_garantir_followup.`);
  }

  // Publicado e sem mudança no rascunho: publicar de novo criaria uma versão
  // idêntica a cada rodada da implantação.
  if (fluxo.status === "active" && fluxo.active_version_id) {
    const { data: versao } = await c.admin
      .from("followup_flow_versions")
      .select("graph")
      .eq("id", fluxo.active_version_id)
      .eq("organization_id", c.orgId)
      .maybeSingle();
    if (versao && mesmoConteudo((versao as { graph: unknown }).graph, fluxo.draft_graph)) {
      return { fluxo: { id: fluxo.id, nome: fluxo.name, situacao: "active" }, desfecho: "ja_estava", avisos };
    }
  }

  const grafo = fluxo.draft_graph;
  // A regra de etapa guarda o `stage_id`, e só o banco diz se a etapa existe.
  const citadas = await carregaEtapasCitadas(c.admin, c.orgId, grafo.nodes);
  if (!citadas.ok) throw new Error(citadas.mensagem);
  // O plano B da mensagem por IA só existe para canal com janela de 24 horas.
  const { data: conexoes, error: conexoesErr } = await c.admin
    .from("channel_sessions")
    .select("provider")
    .eq("organization_id", c.orgId)
    .is("archived_at", null);
  if (conexoesErr) throw new Error(`não consegui ler os canais da organização: ${conexoesErr.message}`);
  const validacao = validateFlowForPublish(grafo, {
    etapas: citadas.etapas,
    surface: "followup",
    exigeModeloForaDaJanela: algumCanalExigeModeloForaDaJanela(
      ((conexoes ?? []) as Array<{ provider: string | null }>).map((x) => x.provider),
    ),
  });
  if (!validacao.ok) {
    throw new Recusa(
      `O fluxo «${fluxo.name}» não passou na validação de publicação:\n` +
        validacao.errors.map((e) => `- ${e.node_id ? `nó ${e.node_id}: ` : ""}${e.message}`).join("\n"),
    );
  }

  const resultado = await publishFollowupFlowVersion(c.admin, {
    orgId: c.orgId,
    pointerId: fluxo.id,
    graph: grafo,
    createdBy: c.autorUserId,
  });
  if (!resultado.ok) throw new Error(`não consegui publicar o fluxo: ${resultado.message}`);

  void audit({
    action: "followup_flow.published",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "followup_flow_pointer",
    resourceId: fluxo.id,
    requestId: c.requestId,
    metadata: { version_id: resultado.version_id, via: "mcp_plataforma" },
  });

  if (kind !== "manual" && kind !== "webhook") {
    // Gatilho automático só inscreve se um agente PUBLICADO tem o fluxo.
    const { data: versoes } = await c.admin
      .from("ai_agent_versions")
      .select("id, followup, status")
      .eq("organization_id", c.orgId)
      .eq("status", "published");
    const armado = ((versoes ?? []) as Array<{ followup: { enabled?: boolean; flow_pointer_ids?: string[] } | null }>).some(
      (v) => v.followup?.enabled === true && (v.followup.flow_pointer_ids ?? []).includes(fluxo.id),
    );
    if (!armado) {
      avisos.push(
        "O fluxo está publicado, mas nenhum agente PUBLICADO o tem armado: ele não vai inscrever ninguém sozinho. " +
          "Chame plataforma_garantir_agente com `followups` e depois plataforma_publicar_agente.",
      );
    }
  }

  return { fluxo: { id: fluxo.id, nome: fluxo.name, situacao: "active" }, desfecho: "publicou", avisos };
}
