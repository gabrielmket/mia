/**
 * FORK MIA — GARANTIR o funil de um cliente: o funil, as etapas, o passo do
 * agente em cada etapa, os campos e os motivos de perda e de ganho.
 *
 * ── De onde vem cada escrita (nenhuma regra é reescrita aqui) ─────────────
 *
 *   criar o funil            `criarFunil`              (a rota POST /pipelines)
 *   nome, descrição, padrão  `atualizarFunil`          (a rota PATCH /pipelines/[id])
 *   etapas de funil NOVO     `fn_aplicar_quadro_do_onboarding`, a função do
 *                            banco que o passo "onde ele organiza" do
 *                            onboarding usa: troca as etapas numa transação
 *                            só, e recusa funil que já tem negócio
 *   etapas de funil em uso   `criarEtapa`, `atualizarEtapa`, `arquivarEtapa`
 *                            (`lib/leads/stage-operations.ts`, a tela de etapas)
 *   passo do agente          `gravarMapeamentoDoAgente` (a rota agent-mapping)
 *   campos e motivos         `gravarConfiguracaoDoFunil` (a action da tela)
 *
 * ── Por que dois caminhos para as etapas ──────────────────────────────────
 *
 * A função do banco APAGA as etapas e as recria: é o certo para um funil que
 * ninguém usou (o que acabou de nascer, ou o "Pedidos" de e-commerce que o
 * gatilho de seed entrega a toda organização nova), e destruiria os ids que
 * follow-up, automação e webhook guardam num funil em uso. Por isso, com o
 * funil já existente, o caminho é o da tela: etapa a etapa, preservando os
 * ids, e sem arquivar nada que o pedido não cite.
 *
 * ── A janela de esfriando ganhou tela; a cor continua sem ───────────────────
 *
 * `expected_duration_hours` (o prazo que o radar de risco usa para dizer que o
 * negócio esfriou) nasceu sem tela e era escrito direto. O upstream 1.70
 * (#2161) deu a ele um campo na tela de etapas e uma régua
 * (`validarJanelaDeEsfriamento`: 1 a 8760 horas INTEIRAS). Desde então ele vai
 * por `atualizarEtapa`, como a probabilidade, com a mesma recusa e a mesma
 * auditoria (`pipeline.stage_updated`).
 *
 * `color` (a cor da coluna no quadro) segue sem tela: é escrita direto, com a
 * autoria, como a semente da empresa de demonstração faz. `requires_human` fica
 * DE FORA de propósito: o único leitor dela é o worker legado, que não responde
 * mais; oferecê-la seria prometer um comportamento que não existe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { LEAD_STAGES, type LeadStage } from "@/lib/agent-engine/agent/lead-state";
import { ApiError } from "@/lib/api/types";
import { ROTULO_DO_PASSO, type EntradaDeMapeamento } from "@/lib/leads/agent-mapping";
import { gravarMapeamentoDoAgente } from "@/lib/leads/agent-mapping-operations";
import { chaveDeNome, slugDeNome } from "@/lib/leads/stage-editing";
import { arquivarEtapa, atualizarEtapa, criarEtapa } from "@/lib/leads/stage-operations";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { autoriaDaMudanca } from "@/lib/operacao/autoria";
import { etapasParaGravar } from "@/lib/onboarding/proposta-de-funil";
import { gravarConfiguracaoDoFunil } from "@/lib/pipelines/pipeline-config";
import type { FunilEditavel } from "@/lib/pipelines/pipeline-editing";
import {
  atualizarFunil,
  criarFunil,
  lerFunisDaOrganizacao,
  type DepsDeFunil,
} from "@/lib/pipelines/pipeline-operations";
import {
  pipelineConfigPatchSchema,
  type CustomFieldDef,
  type PipelineConfigPatch,
} from "@/lib/schemas/settings";

import { atorDaImplantacao, mesmoConteudo, type Desfecho, type Implantacao } from "./base";

/** Quantas etapas um funil aceita numa chamada. Um quadro maior que isso não cabe em tela nenhuma. */
export const TETO_DE_ETAPAS = 20;

export interface EtapaPedida {
  nome: string;
  /**
   * Quando o AGENTE move o cliente para cá. `won` e `lost` fazem da etapa a de
   * ganho e a de perda. `null` = etapa que só pessoas movem.
   */
  passo: LeadStage | null;
  probabilidade?: number | null;
  prazo_esperado_horas?: number | null;
  cor?: string | null;
  avisar_na_central?: boolean;
}

export interface CampoPedido {
  key: string;
  label: string;
  type: CustomFieldDef["type"];
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  /** Nomes de etapa (não ids): a ferramenta resolve depois de as etapas existirem. */
  obrigatorio_em?: { etapas?: string[]; ao_ganhar?: boolean; ao_perder?: boolean };
}

export interface PedidoDeFunil {
  nome: string;
  /** Para renomear ou desambiguar. Sem ele, o funil é achado pelo nome. */
  funil_id?: string;
  descricao?: string | null;
  padrao?: boolean;
  funil_de_clientes?: boolean;
  /** Sem funil com este nome: adota o funil PADRÃO (o que nasceu semeado), se ele não tem negócio. */
  adotar_funil_padrao?: boolean;
  etapas: EtapaPedida[];
  arquivar_etapas_fora_da_lista?: boolean;
  campos?: CampoPedido[];
  motivos_de_perda?: Array<string | { label: string; categoria?: string }>;
  motivos_de_ganho?: string[];
  motivo_de_ganho_obrigatorio?: boolean;
  vocabulario?: { lead?: string; deal?: string; won?: string; lost?: string };
  reabertura?: "mesmo_registro" | "novo_negocio";
  vitoria_e_receita?: boolean;
}

export interface EtapaGarantida {
  id: string;
  nome: string;
  desfecho: Desfecho;
  /** O que mudou nesta etapa, em palavras. Vazio quando `ja_estava`. */
  mudancas: string[];
}

export interface FunilGarantido {
  funil: {
    id: string;
    nome: string;
    slug: string;
    padrao: boolean;
    desfecho: Desfecho;
    mudancas: string[];
    /** O funil padrão semeado foi renomeado e recebeu estas etapas. */
    adotou_o_funil_padrao?: true;
  };
  etapas: EtapaGarantida[];
  /** Etapas vivas do funil que o pedido não citou: ficam onde estão, salvo pedido explícito. */
  etapas_fora_da_lista: Array<{ id: string; nome: string; arquivada: boolean; motivo?: string }>;
  configuracao: { desfecho: Desfecho | "nao_pedida"; mudancas: string[] };
  avisos: string[];
}

interface EtapaLida {
  id: string;
  name: string;
  slug: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
  is_archived: boolean;
  win_probability: number | null;
  agent_stage_hint: string | null;
  avisar_na_central: boolean | null;
  expected_duration_hours: number | null;
  color: string | null;
}

const COLUNAS_DA_ETAPA =
  "id, name, slug, position, is_won, is_lost, is_archived, win_probability, agent_stage_hint, " +
  "avisar_na_central, expected_duration_hours, color";

async function lerEtapas(admin: SupabaseClient, orgId: string, pipelineId: string): Promise<EtapaLida[]> {
  const { data, error } = await admin
    .from("crm_stages")
    .select(COLUNAS_DA_ETAPA)
    .eq("organization_id", orgId)
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: true });
  if (error) throw new Error(`não consegui ler as etapas do funil: ${error.message}`);
  return (data ?? []) as unknown as EtapaLida[];
}

function deps(c: Implantacao): DepsDeFunil {
  return {
    supabase: c.admin,
    organizationId: c.orgId,
    actor: atorDaImplantacao(c),
    requestId: c.requestId,
  };
}

/**
 * Recusa o pedido que o banco recusaria mais tarde, com um código de erro.
 *
 * São as mesmas regras de `validarProposta` (onboarding): uma etapa de ganho,
 * uma de perda, nomes que não se repetem, um passo por etapa. O que não vem de
 * lá é o teto de oito colunas, que é do wizard (cabe na tela do celular de quem
 * acabou de instalar) e não do produto.
 */
function conferirEtapas(etapas: EtapaPedida[]): void {
  const erros: string[] = [];
  const nomes = new Map<string, string>();
  const passos = new Map<string, string>();

  for (const e of etapas) {
    const chave = chaveDeNome(e.nome);
    const repetida = nomes.get(chave);
    if (repetida) {
      erros.push(`As etapas «${repetida}» e «${e.nome}» têm o mesmo nome. Cada coluna do quadro precisa de um nome próprio.`);
    }
    nomes.set(chave, e.nome);

    if (e.passo !== null) {
      const dona = passos.get(e.passo);
      if (dona) {
        erros.push(
          `As etapas «${dona}» e «${e.nome}» declaram o mesmo passo («${ROTULO_DO_PASSO[e.passo]}»). ` +
            "Cada passo do atendimento vale para uma etapa só. Deixe `passo: null` na que só pessoas movem.",
        );
      }
      passos.set(e.passo, e.nome);
    }

    if ((e.passo === "won" || e.passo === "lost") && typeof e.probabilidade === "number") {
      erros.push(
        `A etapa «${e.nome}» é a de ${e.passo === "won" ? "ganho" : "perda"}: ela vale ${e.passo === "won" ? "100" : "0"} ` +
          "na previsão por regra, e não aceita `probabilidade`. Tire o campo desta etapa.",
      );
    }
  }

  if (!passos.has("won")) {
    erros.push('Falta a etapa onde o negócio é fechado. Marque uma etapa com `passo: "won"` (ex.: «Fechou»).');
  }
  if (!passos.has("lost")) {
    erros.push('Falta a etapa de quem não fechou. Marque uma etapa com `passo: "lost"` (ex.: «Não fechou»).');
  }

  if (erros.length > 0) throw new Recusa(erros.join("\n"));
}

/** As linhas de `crm_stages` de um funil novo, no formato que a função do banco recebe. */
function etapasDoQuadro(etapas: EtapaPedida[]) {
  return etapasParaGravar(
    { nome: "", etapas: etapas.map((e) => ({ nome: e.nome.trim(), passo: e.passo })) },
    slugDeNome,
  ).map((e) => ({
    nome: e.nome,
    slug: e.slug,
    position: e.position,
    is_won: e.is_won,
    is_lost: e.is_lost,
    agent_stage_hint: e.agent_stage_hint,
  }));
}

/** As recusas da função do banco, ditas para quem vai decidir o que fazer em seguida. */
function explicarRecusaDoQuadro(motivo: string | undefined, quantos: number | undefined, nome: string): string {
  switch (motivo) {
    case "funil_com_negocios":
      return (
        `O funil «${nome}» já tem ${quantos ?? "alguns"} negócio(s), então as etapas dele não podem ser trocadas de uma vez. ` +
        "Chame de novo SEM `adotar_funil_padrao` e com o nome que ele tem hoje: as etapas são ajustadas uma a uma, sem mexer nos negócios."
      );
    case "etapa_em_uso_por_webhook":
      return (
        `Uma etapa do funil «${nome}» é o destino de uma entrada automática (formulário ou webhook). ` +
        "Trocar as etapas de uma vez apagaria essa entrada. Aponte a entrada para outro funil pela tela (Entradas automáticas) ou crie um funil novo com outro nome."
      );
    default:
      return `Não consegui gravar as etapas de «${nome}» (${motivo ?? "sem motivo"}). Nada mudou.`;
  }
}

async function aplicarQuadro(
  c: Implantacao,
  funil: { id: string; nome: string; slug: string },
  etapas: EtapaPedida[],
): Promise<void> {
  const { data, error } = await c.admin.rpc("fn_aplicar_quadro_do_onboarding", {
    p_organization_id: c.orgId,
    p_pipeline_id: funil.id,
    p_nome: funil.nome,
    p_slug: funil.slug,
    p_etapas: etapasDoQuadro(etapas),
  });
  if (error) throw new Error(`não consegui gravar as etapas do funil: ${error.message}`);
  const r = (data ?? {}) as { ok?: boolean; motivo?: string; quantos?: number };
  if (!r.ok) throw new Recusa(explicarRecusaDoQuadro(r.motivo, r.quantos, funil.nome));
}

/**
 * O que a função do banco não recebe: as três colunas que a tela de etapas
 * grava (probabilidade, aviso na Central e janela de esfriando) e a cor, que
 * nenhuma tela grava. Devolve o que mudou, em palavras.
 */
async function ajustarAtributos(
  c: Implantacao,
  pipelineId: string,
  atual: EtapaLida,
  pedida: EtapaPedida,
): Promise<string[]> {
  const mudancas: string[] = [];

  // Probabilidade, aviso na Central e a janela de esfriando têm tela: vão pela
  // operação dela, com a mesma validação e a mesma auditoria. A janela ganhou
  // tela no upstream 1.70 (#2161): `atualizarEtapa` confere 1 a 8760 horas
  // inteiras (`validarJanelaDeEsfriamento`) antes de tocar no banco.
  const pedidoDaTela: {
    win_probability?: number | null;
    avisar_na_central?: boolean;
    expected_duration_hours?: number | null;
  } = {};
  if (pedida.probabilidade !== undefined && (atual.win_probability ?? null) !== pedida.probabilidade) {
    pedidoDaTela.win_probability = pedida.probabilidade;
    mudancas.push("probabilidade");
  }
  if (
    pedida.avisar_na_central !== undefined &&
    (atual.avisar_na_central === true) !== pedida.avisar_na_central
  ) {
    pedidoDaTela.avisar_na_central = pedida.avisar_na_central;
    mudancas.push("aviso na Central");
  }
  // `numeric` pode chegar como texto, conforme o transporte: compara como número.
  const prazoAtual =
    atual.expected_duration_hours === null || atual.expected_duration_hours === undefined
      ? null
      : Number(atual.expected_duration_hours);
  if (pedida.prazo_esperado_horas !== undefined && prazoAtual !== pedida.prazo_esperado_horas) {
    pedidoDaTela.expected_duration_hours = pedida.prazo_esperado_horas;
    mudancas.push("prazo esperado");
  }
  if (Object.keys(pedidoDaTela).length > 0) {
    await atualizarEtapa(
      { supabase: c.admin, organizationId: c.orgId, actor: atorDaImplantacao(c), requestId: c.requestId },
      { pipelineId, stageId: atual.id, pedido: pedidoDaTela },
    );
  }

  const direto: Record<string, unknown> = {};
  if (pedida.cor !== undefined && (atual.color ?? null) !== (pedida.cor?.toLowerCase() ?? null)) {
    direto.color = pedida.cor?.toLowerCase() ?? null;
    mudancas.push("cor");
  }
  if (Object.keys(direto).length > 0) {
    const { error } = await c.admin
      .from("crm_stages")
      .update({ ...direto, ...autoriaDaMudanca(atorDaImplantacao(c)) })
      .eq("id", atual.id)
      .eq("organization_id", c.orgId)
      .eq("pipeline_id", pipelineId);
    if (error) throw new Error(`não consegui gravar a etapa «${atual.name}»: ${error.message}`);
  }

  return mudancas;
}

/** O funil em uso, convergido para o pedido etapa a etapa, sem trocar id nenhum. */
async function convergirEtapas(
  c: Implantacao,
  pipelineId: string,
  pedidas: EtapaPedida[],
): Promise<{ etapas: EtapaGarantida[]; idPorNome: Map<string, string> }> {
  const d = { supabase: c.admin, organizationId: c.orgId, actor: atorDaImplantacao(c), requestId: c.requestId };
  const resultado = new Map<string, EtapaGarantida>();
  const idPorNome = new Map<string, string>();

  let vivas = (await lerEtapas(c.admin, c.orgId, pipelineId)).filter((e) => !e.is_archived);

  // 1. as que faltam nascem (no fim do funil, como na tela), e as que existem
  //    com outra grafia ("Pos venda" para «Pós-venda») ganham a do pedido.
  for (const pedida of pedidas) {
    const chave = chaveDeNome(pedida.nome);
    const existente = vivas.find((e) => chaveDeNome(e.name) === chave);
    if (!existente) {
      const criada = await criarEtapa(d, { pipelineId, nome: pedida.nome });
      idPorNome.set(chave, criada.stageId);
      resultado.set(chave, { id: criada.stageId, nome: pedida.nome.trim(), desfecho: "criou", mudancas: [] });
      continue;
    }
    idPorNome.set(chave, existente.id);
    const mudancas: string[] = [];
    if (existente.name !== pedida.nome.trim()) {
      await atualizarEtapa(d, { pipelineId, stageId: existente.id, pedido: { name: pedida.nome } });
      mudancas.push("nome");
    }
    resultado.set(chave, {
      id: existente.id,
      nome: pedida.nome.trim(),
      desfecho: mudancas.length > 0 ? "atualizou" : "ja_estava",
      mudancas,
    });
  }

  const anotar = (pedida: EtapaPedida, mudanca: string) => {
    const r = resultado.get(chaveDeNome(pedida.nome))!;
    r.mudancas.push(mudanca);
    if (r.desfecho === "ja_estava") r.desfecho = "atualizou";
  };

  // 2. ganho e perda. A operação da tela MOVE a marca (libera a antiga antes de
  //    ocupar a nova) e faz o passo do agente acompanhar. Antes disso, a etapa
  //    que vai virar ganho ou perda solta o passo ABERTO que declarava: a regra
  //    da tela recusa marcar como ganho uma etapa que representa "em negociação".
  vivas = (await lerEtapas(c.admin, c.orgId, pipelineId)).filter((e) => !e.is_archived);
  const soltar: EntradaDeMapeamento = {};
  for (const pedida of pedidas) {
    if (pedida.passo !== "won" && pedida.passo !== "lost") continue;
    const atual = vivas.find((e) => e.id === idPorNome.get(chaveDeNome(pedida.nome)));
    if (atual?.agent_stage_hint && atual.agent_stage_hint !== pedida.passo) soltar[atual.agent_stage_hint] = null;
  }
  if (Object.keys(soltar).length > 0) {
    await gravarMapeamentoDoAgente(d, { pipelineId, etapas: vivas, mapeamento: soltar });
    vivas = (await lerEtapas(c.admin, c.orgId, pipelineId)).filter((e) => !e.is_archived);
  }
  for (const [passo, campo, rotulo] of [
    ["won", "is_won", "etapa de ganho"],
    ["lost", "is_lost", "etapa de perda"],
  ] as const) {
    const pedida = pedidas.find((p) => p.passo === passo);
    if (!pedida) continue;
    const id = idPorNome.get(chaveDeNome(pedida.nome))!;
    const atual = vivas.find((e) => e.id === id);
    if (atual && !atual[campo]) {
      await atualizarEtapa(d, { pipelineId, stageId: id, pedido: { [campo]: true } });
      anotar(pedida, rotulo);
    }
  }

  // 3. o passo do agente em cada etapa: o mapa da tela "Atendimento do assistente".
  vivas = (await lerEtapas(c.admin, c.orgId, pipelineId)).filter((e) => !e.is_archived);
  const mapa: EntradaDeMapeamento = {};
  for (const pedida of pedidas) {
    if (pedida.passo !== null) mapa[pedida.passo] = idPorNome.get(chaveDeNome(pedida.nome))!;
  }
  for (const pedida of pedidas) {
    // A etapa que hoje declara OUTRO passo o solta de forma explícita: a regra
    // da tela recusa ocupar uma etapa cujo passo antigo a entrada não cita
    // (seria desmapeá-lo em silêncio). `passo: null` cai aqui também.
    const atual = vivas.find((e) => e.id === idPorNome.get(chaveDeNome(pedida.nome)));
    const hint = atual?.agent_stage_hint;
    if (hint && hint !== pedida.passo && mapa[hint] === undefined) mapa[hint] = null;
  }
  const trocas = await gravarMapeamentoDoAgente(d, { pipelineId, etapas: vivas, mapeamento: mapa });
  for (const troca of trocas) {
    const pedida = pedidas.find((p) => idPorNome.get(chaveDeNome(p.nome)) === troca.stageId);
    if (pedida && !resultado.get(chaveDeNome(pedida.nome))!.mudancas.includes("passo do agente")) {
      anotar(pedida, "passo do agente");
    }
  }

  // 4. probabilidade, aviso, prazo e cor.
  vivas = (await lerEtapas(c.admin, c.orgId, pipelineId)).filter((e) => !e.is_archived);
  for (const pedida of pedidas) {
    const atual = vivas.find((e) => e.id === idPorNome.get(chaveDeNome(pedida.nome)));
    if (!atual) continue;
    for (const mudanca of await ajustarAtributos(c, pipelineId, atual, pedida)) anotar(pedida, mudanca);
  }

  // 5. a ordem. Só mexe se a ordem relativa das etapas pedidas não for a do
  //    pedido: aí cada uma vai para depois da anterior, na ordem declarada, e as
  //    que o pedido não citou ficam no fim.
  vivas = (await lerEtapas(c.admin, c.orgId, pipelineId)).filter((e) => !e.is_archived);
  const ordemPedida = pedidas.map((p) => idPorNome.get(chaveDeNome(p.nome))!);
  const ordemAtual = vivas.map((e) => e.id).filter((id) => ordemPedida.includes(id));
  if (ordemAtual.join() !== ordemPedida.join()) {
    for (let i = 0; i < pedidas.length; i += 1) {
      await atualizarEtapa(d, {
        pipelineId,
        stageId: ordemPedida[i]!,
        pedido: { depois_de: i === 0 ? null : ordemPedida[i - 1]! },
      });
    }
    for (const pedida of pedidas) {
      const r = resultado.get(chaveDeNome(pedida.nome))!;
      if (r.desfecho !== "criou") anotar(pedida, "ordem");
    }
  }

  return { etapas: pedidas.map((p) => resultado.get(chaveDeNome(p.nome))!), idPorNome };
}

/** Mescla o que o pedido traz na configuração do funil, sem apagar o que ele não cita. */
function montarConfiguracao(
  pedido: PedidoDeFunil,
  atual: { settings: Record<string, unknown>; vocabulary: Record<string, unknown> },
  idPorNome: Map<string, string>,
): { patch: PipelineConfigPatch; mudancas: string[] } {
  const patch: PipelineConfigPatch = {};
  const mudancas: string[] = [];

  if (pedido.campos) {
    const existentes = Array.isArray(atual.settings.fields) ? (atual.settings.fields as CustomFieldDef[]) : [];
    const porChave = new Map(existentes.map((f) => [f.key.toLowerCase(), f]));
    const campos = [...existentes];
    for (const campo of pedido.campos) {
      const etapas = campo.obrigatorio_em?.etapas?.map((nome) => {
        const id = idPorNome.get(chaveDeNome(nome));
        if (!id) {
          throw new Recusa(
            `O campo «${campo.label}» é obrigatório na etapa «${nome}», e este funil não tem uma etapa com esse nome. ` +
              `As etapas são: ${[...idPorNome.keys()].join(", ")}.`,
          );
        }
        return id;
      });
      const definicao: CustomFieldDef = {
        key: campo.key,
        label: campo.label,
        type: campo.type,
        ...(campo.required !== undefined ? { required: campo.required } : {}),
        ...(campo.options ? { options: campo.options } : {}),
        ...(campo.obrigatorio_em
          ? {
              obrigatorio_em: {
                ...(etapas ? { etapas } : {}),
                ...(campo.obrigatorio_em.ao_ganhar !== undefined ? { ao_ganhar: campo.obrigatorio_em.ao_ganhar } : {}),
                ...(campo.obrigatorio_em.ao_perder !== undefined ? { ao_perder: campo.obrigatorio_em.ao_perder } : {}),
              },
            }
          : {}),
      };
      const anterior = porChave.get(campo.key.toLowerCase());
      if (!anterior) {
        campos.push(definicao);
        mudancas.push(`campo «${campo.label}» criado`);
      } else if (!mesmoConteudo(anterior, { ...anterior, ...definicao })) {
        campos[campos.indexOf(anterior)] = { ...anterior, ...definicao };
        mudancas.push(`campo «${campo.label}» atualizado`);
      }
    }
    if (mudancas.length > 0) patch.fields = campos;
  }

  if (pedido.motivos_de_perda) {
    const existentes = Array.isArray(atual.settings.lost_reasons)
      ? (atual.settings.lost_reasons as Array<string | { label: string; categoria?: string }>)
      : [];
    const rotulo = (m: string | { label: string }) => (typeof m === "string" ? m : m.label);
    const lista = [...existentes];
    let mudou = false;
    for (const motivo of pedido.motivos_de_perda) {
      const i = lista.findIndex((m) => chaveDeNome(rotulo(m)) === chaveDeNome(rotulo(motivo)));
      if (i < 0) {
        lista.push(motivo);
        mudou = true;
        mudancas.push(`motivo de perda «${rotulo(motivo)}» acrescentado`);
      } else if (typeof motivo !== "string" && !mesmoConteudo(lista[i], motivo)) {
        // Só a versão com categoria substitui: texto puro não apaga a categoria que já havia.
        lista[i] = motivo;
        mudou = true;
        mudancas.push(`motivo de perda «${rotulo(motivo)}» atualizado`);
      }
    }
    if (mudou) patch.lost_reasons = lista;
  }

  if (pedido.motivos_de_ganho) {
    const existentes = Array.isArray(atual.settings.won_reasons) ? (atual.settings.won_reasons as string[]) : [];
    const lista = [...existentes];
    for (const motivo of pedido.motivos_de_ganho) {
      if (!lista.some((m) => chaveDeNome(m) === chaveDeNome(motivo))) {
        lista.push(motivo);
        mudancas.push(`motivo de ganho «${motivo}» acrescentado`);
      }
    }
    if (lista.length !== existentes.length) patch.won_reasons = lista;
  }

  if (
    pedido.motivo_de_ganho_obrigatorio !== undefined &&
    (atual.settings.won_reason_required === true) !== pedido.motivo_de_ganho_obrigatorio
  ) {
    patch.won_reason_required = pedido.motivo_de_ganho_obrigatorio;
    mudancas.push("motivo de ganho obrigatório");
  }
  if (pedido.reabertura !== undefined && (atual.settings.reabertura ?? "mesmo_registro") !== pedido.reabertura) {
    patch.reabertura = pedido.reabertura;
    mudancas.push("reabertura");
  }
  if (
    pedido.vitoria_e_receita !== undefined &&
    (atual.settings.vitoria_e_receita !== false) !== pedido.vitoria_e_receita
  ) {
    patch.vitoria_e_receita = pedido.vitoria_e_receita;
    mudancas.push("vitória conta como receita");
  }
  if (pedido.vocabulario) {
    const novo = Object.fromEntries(
      Object.entries(pedido.vocabulario).filter(([chave, valor]) => valor !== undefined && atual.vocabulary[chave] !== valor),
    );
    if (Object.keys(novo).length > 0) {
      patch.vocabulary = novo;
      mudancas.push("vocabulário");
    }
  }

  return { patch, mudancas };
}

function recusaDoDominio(err: unknown): never {
  // As operações compartilhadas com a tela recusam com `ApiError`, e a frase
  // delas já é a que o dono do funil lê. Sobe como recusa, sem reescrever.
  if (err instanceof ApiError && err.status < 500) throw new Recusa(err.message);
  throw err;
}

export async function garantirFunil(c: Implantacao, pedido: PedidoDeFunil): Promise<FunilGarantido> {
  if (pedido.etapas.length > TETO_DE_ETAPAS) {
    throw new Recusa(`Um funil aceita até ${TETO_DE_ETAPAS} etapas por chamada, e vieram ${pedido.etapas.length}.`);
  }
  conferirEtapas(pedido.etapas);
  for (const e of pedido.etapas) {
    if (e.passo !== null && !(LEAD_STAGES as readonly string[]).includes(e.passo)) {
      throw new Recusa(`«${e.passo}» não é um passo do atendimento. Use um de: ${LEAD_STAGES.join(", ")}, ou null.`);
    }
  }

  const avisos: string[] = [];
  const nome = pedido.nome.trim();
  let funis = await lerFunisDaOrganizacao(c.admin, c.orgId);

  let alvo: FunilEditavel | undefined;
  if (pedido.funil_id) {
    alvo = funis.find((f) => f.id === pedido.funil_id);
    if (!alvo) {
      throw new Recusa(
        `Não existe funil com o id ${pedido.funil_id} nesta organização. ` +
          `Os funis são: ${funis.map((f) => `«${f.name}» (${f.id})`).join(", ") || "nenhum"}.`,
      );
    }
  } else {
    alvo = funis.find((f) => !f.is_archived && chaveDeNome(f.name) === chaveDeNome(nome));
  }

  const mudancasDoFunil: string[] = [];
  let desfecho: Desfecho = "ja_estava";
  let adotou = false;
  let etapas: EtapaGarantida[] = [];
  let idPorNome = new Map<string, string>();

  try {
    if (!alvo) {
      // ── funil que ainda não existe ────────────────────────────────────────
      if (pedido.adotar_funil_padrao) {
        const padrao = funis.find((f) => f.is_default && !f.is_archived);
        if (!padrao) {
          throw new Recusa(
            "Esta organização não tem funil padrão para adotar. Chame de novo sem `adotar_funil_padrao`: o funil é criado.",
          );
        }
        const slug = slugDeNome(
          nome,
          funis.filter((f) => f.id !== padrao.id).map((f) => f.slug),
          "funil",
        );
        await aplicarQuadro(c, { id: padrao.id, nome, slug }, pedido.etapas);
        alvo = padrao;
        adotou = true;
        desfecho = "atualizou";
        mudancasDoFunil.push(`o funil padrão «${padrao.name}» virou «${nome}», com as etapas do pedido`);
      } else {
        const criado = await criarFunil(deps(c), { name: nome, description: pedido.descricao ?? null });
        // O funil nasce com quatro etapas neutras, como na tela. Ele acabou de
        // nascer e não tem negócio: as etapas do pedido entram pela função do
        // banco, numa transação só.
        await aplicarQuadro(c, { id: criado.pipelineId, nome, slug: criado.slug }, pedido.etapas);
        alvo = criado.funis.find((f) => f.id === criado.pipelineId)!;
        desfecho = "criou";
      }

      const lidas = (await lerEtapas(c.admin, c.orgId, alvo.id)).filter((e) => !e.is_archived);
      idPorNome = new Map(lidas.map((e) => [chaveDeNome(e.name), e.id]));
      etapas = [];
      for (const pedida of pedido.etapas) {
        const lida = lidas.find((e) => chaveDeNome(e.name) === chaveDeNome(pedida.nome))!;
        await ajustarAtributos(c, alvo.id, lida, pedida);
        etapas.push({ id: lida.id, nome: lida.name, desfecho: "criou", mudancas: [] });
      }
    } else {
      // ── funil que já existe: converge etapa a etapa, sem trocar id ─────────
      if (alvo.is_archived) {
        throw new Recusa(
          `O funil «${alvo.name}» está arquivado. Tire-o do arquivo pela tela (Configurações › Funis) ou use outro nome.`,
        );
      }
      const convergido = await convergirEtapas(c, alvo.id, pedido.etapas);
      etapas = convergido.etapas;
      idPorNome = convergido.idPorNome;
    }

    // ── nome, descrição, padrão e funil de clientes: a operação da tela ──────
    funis = await lerFunisDaOrganizacao(c.admin, c.orgId);
    const agora = funis.find((f) => f.id === alvo!.id)!;
    const edicao: Parameters<typeof atualizarFunil>[1]["pedido"] = {};
    if (agora.name !== nome) {
      edicao.name = nome;
      if (!adotou) mudancasDoFunil.push("nome");
    }
    if (pedido.descricao !== undefined && (agora.description ?? null) !== (pedido.descricao?.trim() || null)) {
      edicao.description = pedido.descricao;
      if (desfecho !== "criou") mudancasDoFunil.push("descrição");
    }
    if (pedido.padrao === true && !agora.is_default) {
      edicao.is_default = true;
      mudancasDoFunil.push("virou o funil padrão");
    }
    if (pedido.padrao === false && agora.is_default) {
      avisos.push(
        `«${nome}» é o funil padrão e a organização precisa de um: o padrão se muda marcando OUTRO funil com \`padrao: true\`, não se apaga.`,
      );
    }
    if (pedido.funil_de_clientes !== undefined && (agora.is_client_pipeline === true) !== pedido.funil_de_clientes) {
      edicao.is_client_pipeline = pedido.funil_de_clientes;
      mudancasDoFunil.push(pedido.funil_de_clientes ? "virou o funil de clientes" : "deixou de ser o funil de clientes");
    }
    if (Object.keys(edicao).length > 0) {
      const editado = await atualizarFunil(deps(c), { pipelineId: alvo.id, pedido: edicao });
      funis = editado.funis;
      if (desfecho === "ja_estava") desfecho = "atualizou";
    }
  } catch (err) {
    recusaDoDominio(err);
  }
  if (!alvo) throw new Error("o funil não foi resolvido");

  // ── etapas que o pedido não citou ─────────────────────────────────────────
  const vivas = (await lerEtapas(c.admin, c.orgId, alvo.id)).filter((e) => !e.is_archived);
  const citadas = new Set(etapas.map((e) => e.id));
  const foraDaLista: FunilGarantido["etapas_fora_da_lista"] = [];
  for (const e of vivas.filter((v) => !citadas.has(v.id))) {
    if (!pedido.arquivar_etapas_fora_da_lista) {
      foraDaLista.push({ id: e.id, nome: e.name, arquivada: false });
      continue;
    }
    try {
      await arquivarEtapa(
        { supabase: c.admin, organizationId: c.orgId, actor: atorDaImplantacao(c), requestId: c.requestId },
        { pipelineId: alvo.id, stageId: e.id, destinoId: null },
      );
      foraDaLista.push({ id: e.id, nome: e.name, arquivada: true });
    } catch (err) {
      if (!(err instanceof ApiError) || err.status >= 500) throw err;
      foraDaLista.push({ id: e.id, nome: e.name, arquivada: false, motivo: err.message });
    }
  }
  if (foraDaLista.some((e) => !e.arquivada) && !pedido.arquivar_etapas_fora_da_lista) {
    avisos.push(
      "O funil tem etapas que o pedido não citou; elas continuam no quadro. " +
        "Para tirá-las, chame de novo com `arquivar_etapas_fora_da_lista: true` (só arquiva etapa sem negócio).",
    );
  }

  // ── campos, motivos e vocabulário: a gravação da tela de configuração ─────
  let configuracao: FunilGarantido["configuracao"] = { desfecho: "nao_pedida", mudancas: [] };
  const pediuConfiguracao =
    pedido.campos !== undefined ||
    pedido.motivos_de_perda !== undefined ||
    pedido.motivos_de_ganho !== undefined ||
    pedido.motivo_de_ganho_obrigatorio !== undefined ||
    pedido.vocabulario !== undefined ||
    pedido.reabertura !== undefined ||
    pedido.vitoria_e_receita !== undefined;
  if (pediuConfiguracao) {
    const { data: linha, error } = await c.admin
      .from("crm_pipelines")
      .select("settings, vocabulary")
      .eq("id", alvo.id)
      .eq("organization_id", c.orgId)
      .maybeSingle();
    if (error || !linha) throw new Error(`não consegui ler a configuração do funil: ${error?.message ?? "sem linha"}`);
    const lida = linha as { settings: Record<string, unknown> | null; vocabulary: Record<string, unknown> | null };
    const { patch, mudancas } = montarConfiguracao(
      pedido,
      { settings: lida.settings ?? {}, vocabulary: lida.vocabulary ?? {} },
      idPorNome,
    );
    if (mudancas.length === 0) {
      configuracao = { desfecho: "ja_estava", mudancas: [] };
    } else {
      // O MESMO schema da tela confere o que vai ser gravado (tipos de campo,
      // tetos de tamanho, chave em letras e sublinhado).
      const conferido = pipelineConfigPatchSchema.safeParse(patch);
      if (!conferido.success) {
        const primeiro = conferido.error.issues[0];
        throw new Recusa(
          `A configuração do funil não passou na conferência: ${primeiro?.path.join(".")}: ${primeiro?.message}. ` +
            'A chave de um campo usa letras, números e sublinhado e começa por letra (ex.: "plano_de_interesse").',
        );
      }
      const gravado = await gravarConfiguracaoDoFunil(c.admin, {
        organizationId: c.orgId,
        pipelineId: alvo.id,
        patch: conferido.data,
      });
      if (!gravado.ok) throw new Error(`não consegui gravar a configuração do funil: ${gravado.error}`);
      configuracao = { desfecho: "atualizou", mudancas };
    }
  }

  const idDoFunil = alvo.id;
  const final = funis.find((f) => f.id === idDoFunil) ?? alvo;
  return {
    funil: {
      id: alvo.id,
      nome: final.name,
      slug: final.slug,
      padrao: final.is_default,
      desfecho,
      mudancas: mudancasDoFunil,
      ...(adotou ? { adotou_o_funil_padrao: true as const } : {}),
    },
    etapas,
    etapas_fora_da_lista: foraDaLista,
    configuracao,
    avisos,
  };
}
