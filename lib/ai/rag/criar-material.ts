/**
 * FORK MIA — CADASTRAR um material de conhecimento, fora do Route Handler.
 *
 * A criação morava inteira em `POST /api/v1/ai/knowledge/sources`: canonizar o
 * tipo, recusar conteúdo para tipo que não o ingere, ler o FAQ colado, guardar
 * o texto de documento como arquivo no bucket, gravar a fonte, gravar os itens
 * (desfazendo a fonte se eles não entrarem) e emitir o evento que dispara a
 * indexação. O MCP de plataforma cadastra FAQ e texto ao implantar um cliente;
 * com a sequência aqui, a tela e a ferramenta gravam igual e disparam a mesma
 * indexação.
 *
 * A rota ficou com o transporte: papel, leitura do corpo, tradução da frase.
 * As recusas voltam como dado (`ok: false` com `status`, `code` e `message`),
 * com as frases de antes.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { temChaveDeEmbedding } from "@/lib/ai/embeddings/chave";
import { BUCKET_DE_CONHECIMENTO } from "@/lib/ai/rag/ingest/documento";
import { parseFaqMarkdown } from "@/lib/ai/rag/ingest/faq";
import {
  aceitaTextoColado,
  canonizarTipoDeFonte,
  ePerguntaEResposta,
  rotuloDoTipo,
} from "@/lib/ai/rag/tipos-de-fonte";

export interface ItemDeFaq {
  question: string;
  answer: string;
  tags: string[];
  locale: string;
}

export interface EntradaDoMaterial {
  /** Opcional desde a 0181: o material é da organização. */
  agent_id?: string;
  source_type: string;
  name: string;
  items?: ItemDeFaq[];
  markdown_blob?: string;
  source_metadata?: Record<string, unknown>;
}

export type ResultadoDoMaterial =
  | { ok: true; id: string; items_count: number; indexacao_habilitada: boolean }
  | { ok: false; status: number; code: string; message: string };

export interface DepsDoMaterial {
  /** Client com `service_role`: grava a fonte, os itens e o arquivo. */
  admin: SupabaseClient;
  /**
   * Client que CONFERE o agente histórico. Na rota é o da sessão (a RLS recorta
   * a organização); na ferramenta de plataforma é o próprio admin, e o filtro
   * de organização abaixo faz o recorte.
   */
  leitura: SupabaseClient;
  organizationId: string;
}

function recusa(status: number, code: string, message: string): ResultadoDoMaterial {
  return { ok: false, status, code, message };
}

export async function criarMaterial(deps: DepsDoMaterial, input: EntradaDoMaterial): Promise<ResultadoDoMaterial> {
  const { admin, leitura, organizationId } = deps;

  const tipo = canonizarTipoDeFonte(input.source_type);
  if (tipo === null) {
    return recusa(
      422,
      "validation_failed",
      `Tipo de material desconhecido: "${input.source_type}". Use faq, documento, conversas ou catalogo.`,
    );
  }

  // Conteúdo mandado para um tipo que esta rota não ingere era ACEITO e
  // descartado em silêncio: a fonte nascia vazia, com 201, e ninguém entendia
  // por que o agente não sabia nada dali. Recusar alto é a única resposta honesta.
  const temConteudo =
    (input.items?.length ?? 0) > 0 || (input.markdown_blob?.trim().length ?? 0) > 0;
  if (temConteudo && !aceitaTextoColado(tipo)) {
    return recusa(
      422,
      "unprocessable_entity",
      `Material de ${rotuloDoTipo(tipo).toLowerCase()} não recebe conteúdo colado — ` +
        "ele é preenchido automaticamente.",
    );
  }

  // `agent_id` é HISTÓRICO. Continua validado — mandar o id de um agente de
  // outra organização tem de doer — mas não decide mais quem lê o material.
  if (input.agent_id) {
    const { data: agent, error: agentErr } = await leitura
      .from("ai_agents")
      .select("id")
      .eq("id", input.agent_id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (agentErr) {
      console.error("[ai-knowledge-sources] validação do agente falhou:", agentErr.message);
      return recusa(500, "internal_error", "Erro ao validar agent_id.");
    }
    if (!agent) {
      return recusa(404, "not_found", "Assistente não encontrado nesta organização.");
    }
  }

  let faqItems: ItemDeFaq[] = [];

  if (ePerguntaEResposta(tipo)) {
    if (input.items && input.items.length > 0) {
      faqItems = input.items.map((it) => ({
        question: it.question,
        answer: it.answer,
        tags: it.tags,
        locale: it.locale,
      }));
    } else if (input.markdown_blob) {
      faqItems = parseFaqMarkdown(input.markdown_blob);
      if (faqItems.length === 0) {
        return recusa(
          400,
          "invalid_request",
          "Não achei nenhum par pergunta/resposta no texto. Use uma linha ## Pergunta: e uma ## Resposta: por item.",
        );
      }
    } else {
      return recusa(400, "invalid_request", "Cole o conteúdo do material antes de criar.");
    }
  } else if (tipo === "documento" && !input.markdown_blob?.trim()) {
    return recusa(
      400,
      "invalid_request",
      "Cole o texto do documento, ou envie o arquivo em /api/v1/ai/knowledge/sources/upload.",
    );
  }

  // TEXTO COLADO DE DOCUMENTO VIRA ARQUIVO.
  //
  // Um documento não é uma lista de pergunta/resposta: é texto corrido, e não
  // havia onde guardá-lo — o indexador só sabia ler `ai_faq_items`, e era por
  // isso que colar uma política produzia uma fonte que nunca indexava nada.
  //
  // Em vez de uma tabela nova para "texto que não é P/R", o texto é guardado
  // como `.md` no mesmo bucket dos arquivos e segue exatamente a mesma rota de
  // extração. Um destino, um caminho, um lugar para consertar.
  let metadata: Record<string, unknown> = { ...(input.source_metadata ?? {}) };
  if (tipo === "documento" && input.markdown_blob) {
    const blobPath = `${organizationId}/${randomUUID()}.md`;
    const { error: upErr } = await admin.storage
      .from(BUCKET_DE_CONHECIMENTO)
      .upload(blobPath, Buffer.from(input.markdown_blob, "utf8"), {
        contentType: "text/markdown",
        upsert: false,
      });
    if (upErr) {
      console.error("[ai-knowledge-sources] guardar o texto falhou:", upErr.message);
      return recusa(500, "internal_error", "Erro ao guardar o conteúdo do material.");
    }
    metadata = { ...metadata, blob_path: blobPath, ext: "md", origem: "texto_colado" };
  }

  const { data: ks, error: ksErr } = await admin
    .from("ai_knowledge_sources")
    .insert({
      organization_id: organizationId,
      agent_id: input.agent_id ?? null,
      source_type: tipo,
      name: input.name,
      status: "ready",
      is_active: true,
      source_metadata: metadata,
      ingested_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (ksErr || !ks) {
    // `ai_knowledge_sources_nome_unico_por_org`: dois materiais ativos não podem
    // ter o mesmo nome — é por ele que a pessoa os distingue na tela e no
    // seletor do assistente. Sem esta tradução o 23505 saía como 500.
    if (ksErr?.code === "23505") {
      return recusa(
        409,
        "knowledge_source_name_in_use",
        `Já existe um material chamado "${input.name}". Escolha outro nome.`,
      );
    }
    console.error("[ai-knowledge-sources] insert falhou:", ksErr?.message);
    return recusa(500, "internal_error", "Erro ao criar o material.");
  }

  const ksId: string = (ks as { id: string }).id;

  let itemsCount = 0;
  if (faqItems.length > 0) {
    const rows = faqItems.map((item, idx) => ({
      organization_id: organizationId,
      knowledge_source_id: ksId,
      question: item.question,
      answer: item.answer,
      tags: item.tags,
      locale: item.locale,
      position: idx,
    }));

    const { error: itemsErr } = await admin.from("ai_faq_items").insert(rows);

    if (itemsErr) {
      // Fonte sem item nenhum é fonte vazia: melhor desfazer do que deixar uma
      // linha que promete conteúdo e nunca vai indexar nada.
      await admin.from("ai_knowledge_sources").delete().eq("id", ksId);
      console.error("[ai-knowledge-sources] insert dos itens falhou:", itemsErr.message);
      return recusa(500, "internal_error", "Erro ao gravar o conteúdo do material.");
    }
    itemsCount = rows.length;
  }

  const { error: emitErr } = await admin.rpc("emit_event" as never, {
    p_event_type: "knowledge_source.updated",
    p_entity_kind: "ai_knowledge_source",
    p_entity_id: ksId,
    p_payload: {
      knowledge_source_id: ksId,
      agent_id: input.agent_id ?? null,
      source_type: tipo,
    },
    p_organization_id: organizationId,
  } as never);

  if (emitErr) {
    console.warn("[ai-knowledge-sources] emit_event falhou (não bloqueia):", emitErr.message);
  }

  // A resposta DIZ se a indexação vai acontecer. Sem isto a tela prometia
  // "começa em instantes" para uma organização sem chave de embedding, e o
  // material ficava parado sem que nada na tela mudasse.
  const temChave = await temChaveDeEmbedding(organizationId);

  return { ok: true, id: ksId, items_count: itemsCount, indexacao_habilitada: temChave };
}
