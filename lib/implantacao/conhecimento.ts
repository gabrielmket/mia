/**
 * FORK MIA — GARANTIR um material de conhecimento que entra por TEXTO:
 * perguntas e respostas (FAQ) ou um documento colado.
 *
 * ── O caminho da tela que isto reusa ──────────────────────────────────────
 *
 *   material novo      `criarMaterial` (`lib/ai/rag/criar-material.ts`), a
 *                      mesma função de `POST /api/v1/ai/knowledge/sources`:
 *                      grava a fonte, os itens (ou o texto como arquivo no
 *                      bucket) e emite o evento que dispara a indexação
 *   trocar o FAQ       apagar e regravar os itens da fonte e emitir o mesmo
 *                      evento, como `PATCH /api/v1/ai/knowledge/sources/[id]`
 *
 * ── O que fica na tela ────────────────────────────────────────────────────
 *
 * Arquivo (PDF, planilha, áudio) entra por upload, e upload de binário não cabe
 * numa chamada de ferramenta. Site e arquivo ficam em IA › Conhecimento.
 *
 * ── Repetir sem duplicar ──────────────────────────────────────────────────
 *
 * A chave é o NOME do material (único entre os ativos da organização).
 *  - FAQ: os itens são comparados com os gravados; iguais, nada acontece;
 *    diferentes, os itens são trocados NO MESMO material (o id não muda, e os
 *    agentes que o consultam continuam consultando).
 *  - Documento: o texto é guardado como arquivo, e a fonte não é editada no
 *    lugar. A ferramenta guarda a impressão digital do texto no próprio
 *    material; texto igual responde "já estava", e texto diferente é recusado
 *    com a saída (um nome novo, ou FAQ para o que muda sempre). Trocar o
 *    material por um novo mudaria o id que os agentes guardam, e eles
 *    parariam de consultá-lo sem aviso.
 */
import { createHash } from "node:crypto";

import { criarMaterial, type ItemDeFaq } from "@/lib/ai/rag/criar-material";
import { canonizarTipoDeFonte } from "@/lib/ai/rag/tipos-de-fonte";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

import { chaveDoNome, mesmoConteudo, type Desfecho, type Implantacao } from "./base";

/** Quantos pares de pergunta e resposta um material aceita numa chamada. */
export const TETO_DE_PERGUNTAS = 200;
/** Tamanho máximo do texto de um documento colado, em caracteres. */
export const TETO_DO_DOCUMENTO = 200_000;

export interface PedidoDeConhecimento {
  nome: string;
  tipo: "faq" | "documento";
  perguntas?: Array<{ pergunta: string; resposta: string; etiquetas?: string[] }>;
  texto?: string;
}

export interface ConhecimentoGarantido {
  material: { id: string; nome: string; tipo: string; desfecho: Desfecho };
  itens: number;
  /** A indexação vai acontecer? Falso = a plataforma está sem chave para indexar. */
  indexacao_habilitada: boolean;
  avisos: string[];
}

function digital(texto: string): string {
  return createHash("sha256").update(texto.trim()).digest("hex");
}

export async function garantirConhecimento(c: Implantacao, pedido: PedidoDeConhecimento): Promise<ConhecimentoGarantido> {
  const nome = pedido.nome.trim();
  const avisos: string[] = [];

  if (pedido.tipo === "faq") {
    if (!pedido.perguntas || pedido.perguntas.length === 0) {
      throw new Recusa(
        'Um material de FAQ precisa de `perguntas`: uma lista de { "pergunta": "...", "resposta": "..." }.',
      );
    }
    if (pedido.texto !== undefined) {
      throw new Recusa("`texto` é do material de tipo documento. Para FAQ, use `perguntas`.");
    }
  } else {
    if (!pedido.texto || pedido.texto.trim() === "") {
      throw new Recusa("Um material de documento precisa de `texto`: o conteúdo corrido (pode ser Markdown).");
    }
    if (pedido.perguntas !== undefined) {
      throw new Recusa("`perguntas` é do material de tipo faq. Para documento, use `texto`.");
    }
  }

  const { data, error } = await c.admin
    .from("ai_knowledge_sources")
    .select("id, name, source_type, is_active, source_metadata")
    .eq("organization_id", c.orgId)
    .eq("is_active", true);
  if (error) throw new Error(`não consegui ler os materiais: ${error.message}`);
  const ativos = (data ?? []) as Array<{
    id: string;
    name: string;
    source_type: string;
    source_metadata: Record<string, unknown> | null;
  }>;
  const existente = ativos.find((m) => chaveDoNome(m.name) === chaveDoNome(nome));

  const itens: ItemDeFaq[] = (pedido.perguntas ?? []).map((p) => ({
    question: p.pergunta.trim(),
    answer: p.resposta.trim(),
    tags: p.etiquetas ?? [],
    locale: "pt-BR",
  }));

  // ── material novo ─────────────────────────────────────────────────────────
  if (!existente) {
    const criado = await criarMaterial(
      { admin: c.admin, leitura: c.admin, organizationId: c.orgId },
      pedido.tipo === "faq"
        ? { source_type: "faq", name: nome, items: itens, source_metadata: { origem_da_gravacao: "mcp_plataforma" } }
        : {
            source_type: "documento",
            name: nome,
            markdown_blob: pedido.texto,
            source_metadata: { origem_da_gravacao: "mcp_plataforma", conteudo_sha256: digital(pedido.texto ?? "") },
          },
    );
    if (!criado.ok) {
      if (criado.status >= 500) throw new Error(criado.message);
      throw new Recusa(criado.message);
    }
    if (!criado.indexacao_habilitada) {
      avisos.push(
        "O material foi gravado, mas a instalação está sem chave para INDEXAR: o agente não vai achá-lo na busca até a plataforma configurar a chave (IA › Conhecimento mostra a situação).",
      );
    }
    return {
      material: { id: criado.id, nome, tipo: pedido.tipo, desfecho: "criou" },
      itens: criado.items_count,
      indexacao_habilitada: criado.indexacao_habilitada,
      avisos,
    };
  }

  // ── material que já existe ────────────────────────────────────────────────
  const tipoAtual = canonizarTipoDeFonte(existente.source_type);
  if (tipoAtual !== pedido.tipo) {
    throw new Recusa(
      `Já existe um material chamado «${existente.name}» do tipo ${tipoAtual ?? existente.source_type}, e o pedido é do tipo ${pedido.tipo}. ` +
        "O tipo de um material não muda: use outro nome.",
    );
  }

  if (pedido.tipo === "documento") {
    const gravada = existente.source_metadata?.conteudo_sha256;
    if (gravada === digital(pedido.texto ?? "")) {
      return {
        material: { id: existente.id, nome: existente.name, tipo: "documento", desfecho: "ja_estava" },
        itens: 0,
        indexacao_habilitada: true,
        avisos,
      };
    }
    throw new Recusa(
      `Já existe um documento chamado «${existente.name}» com outro texto, e um documento não é editado no lugar. ` +
        `Grave o texto novo com outro nome (ex.: «${existente.name} 2») e troque o nome em \`materiais\` do agente; ` +
        "o antigo é arquivado pela tela (IA › Conhecimento). Para conteúdo que muda sempre, prefira o tipo faq, que é atualizado no mesmo material.",
    );
  }

  const { data: gravados, error: itensErr } = await c.admin
    .from("ai_faq_items")
    .select("question, answer, tags, locale, position")
    .eq("organization_id", c.orgId)
    .eq("knowledge_source_id", existente.id)
    .order("position", { ascending: true });
  if (itensErr) throw new Error(`não consegui ler as perguntas do material: ${itensErr.message}`);
  const atuais = ((gravados ?? []) as Array<ItemDeFaq & { position: number }>).map((g) => ({
    question: g.question,
    answer: g.answer,
    tags: g.tags ?? [],
    locale: g.locale,
  }));

  if (mesmoConteudo(atuais, itens)) {
    return {
      material: { id: existente.id, nome: existente.name, tipo: "faq", desfecho: "ja_estava" },
      itens: atuais.length,
      indexacao_habilitada: true,
      avisos,
    };
  }

  // Troca os itens, como o PATCH da tela: apaga os antigos, grava os novos e
  // emite o evento que dispara a reindexação.
  const { error: delErr } = await c.admin
    .from("ai_faq_items")
    .delete()
    .eq("knowledge_source_id", existente.id)
    .eq("organization_id", c.orgId);
  if (delErr) throw new Error(`não consegui remover as perguntas antigas: ${delErr.message}`);

  const { error: insErr } = await c.admin.from("ai_faq_items").insert(
    itens.map((item, idx) => ({
      organization_id: c.orgId,
      knowledge_source_id: existente.id,
      question: item.question,
      answer: item.answer,
      tags: item.tags,
      locale: item.locale,
      position: idx,
    })),
  );
  if (insErr) {
    throw new Error(
      `as perguntas antigas saíram e as novas não entraram (${insErr.message}). Chame de novo com a mesma lista para regravar.`,
    );
  }

  const { error: emitErr } = await c.admin.rpc("emit_event", {
    p_event_type: "knowledge_source.updated",
    p_entity_kind: "ai_knowledge_source",
    p_entity_id: existente.id,
    p_payload: { knowledge_source_id: existente.id, agent_id: null, source_type: existente.source_type },
    p_organization_id: c.orgId,
  });
  if (emitErr) {
    avisos.push("As perguntas foram gravadas, mas o pedido de reindexação falhou. Reindexe pela tela (IA › Conhecimento).");
  }

  return {
    material: { id: existente.id, nome: existente.name, tipo: "faq", desfecho: "atualizou" },
    itens: itens.length,
    indexacao_habilitada: true,
    avisos,
  };
}
