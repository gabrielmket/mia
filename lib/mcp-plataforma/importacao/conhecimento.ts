/**
 * IMPORTAR CONHECIMENTO — um arquivo do cliente para a base que o agente de IA lê.
 *
 * ── O que a plataforma aceita, e o que esta ferramenta entrega ────────────
 *
 * A base de conhecimento tem quatro tipos de material (`lib/ai/rag/tipos-de-fonte.ts`):
 * perguntas e respostas, documento, conversas e catálogo. Os dois últimos entram
 * sozinhos. Perguntas e respostas e documento por TEXTO são da ferramenta de
 * conhecimento da implantação. Esta aqui é o DOCUMENTO POR ARQUIVO: o mesmo que
 * a tela faz em "enviar arquivo" (`POST /api/v1/ai/knowledge/sources/upload`).
 *
 * Não existe material do tipo "endereço de site": a plataforma não lê página da
 * web. O endereço que esta ferramenta recebe é o de um ARQUIVO (PDF, Markdown,
 * CSV ou texto), e uma página HTML é recusada com o caminho de saída.
 *
 * ── O caminho é o da tela, passo a passo ──────────────────────────────────
 *
 * Mesmas extensões (`resolverExtensao`), mesmo bucket (`BUCKET_DE_CONHECIMENTO`),
 * mesma conferência de que o arquivo é legível ENQUANTO quem enviou ainda está
 * olhando (`extrairTextoDoArquivo`), mesma linha em `ai_knowledge_sources` e o
 * mesmo evento `knowledge_source.updated`, que é o que faz o indexador rodar.
 * O teto de 20 MB e o tipo por extensão são constantes locais da rota; os
 * daqui são conferidos contra ela em `tests/unit/mcp-de-migracao-materiais.test.ts`.
 *
 * ── Reexecução ────────────────────────────────────────────────────────────
 *
 * O material é reconhecido pelo NOME (a organização não pode ter dois materiais
 * ativos com o mesmo nome) e pelo conteúdo (o resumo criptográfico do arquivo).
 * Mesmo nome e mesmo conteúdo: já estava. Mesmo nome e conteúdo diferente:
 * recusa. Trocar o conteúdo de um material é decisão de gente, na tela.
 */
import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { temChaveDeEmbedding } from "@/lib/ai/embeddings/chave";
import {
  BUCKET_DE_CONHECIMENTO,
  ErroDeExtracao,
  extrairTextoDoArquivo,
  resolverExtensao,
  type ExtensaoAceita,
} from "@/lib/ai/rag/ingest/documento";
import { audit } from "@/lib/audit";

import { organizacaoDaImportacao, RecusaDaImportacao, requestIdDe, texto, NADA_FOI_ENVIADO } from "./base";
import { redigirLote } from "./auditoria";
import { obterArquivo, TETO_DO_BASE64 } from "./download";
import { OPERACAO_IMPORTAR_MATERIAIS } from "./operacoes";
import type { ContextoDaFerramenta, Desfecho, FerramentaDeImportacao } from "./tipos";

/** O mesmo teto de `POST /api/v1/ai/knowledge/sources/upload`. */
export const TAMANHO_MAXIMO_DO_DOCUMENTO = 20 * 1024 * 1024;

/**
 * O tipo gravado no Storage vai pela EXTENSÃO, não pelo que o servidor de
 * origem declarou: o bucket tem lista fechada de tipos, e um `.md` servido como
 * `application/octet-stream` seria recusado por ele. Mesma tabela da rota.
 */
export const MIME_POR_EXTENSAO: Record<ExtensaoAceita, string> = {
  pdf: "application/pdf",
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
};

export interface ResultadoDoConhecimento {
  organizacao: { id: string; nome: string; demonstracao: boolean };
  desfecho: Desfecho;
  id: string;
  nome: string;
  /** `false` = a organização não tem chave de indexação: o material fica parado até ela existir. */
  indexacao_habilitada: boolean;
  situacao_da_indexacao: string;
  nada_foi_enviado: string;
}

interface FonteNaBase {
  id: string;
  name: string;
  source_type: string;
  source_metadata: Record<string, unknown> | null;
  last_index_status: string | null;
}

function situacaoDaIndexacao(status: string | null, habilitada: boolean): string {
  if (!habilitada) {
    return "parada: este cliente não tem chave de indexação. Configure a IA do cliente (a chave de embedding) e o material é indexado.";
  }
  switch (status) {
    case "success":
      return "indexado: o agente já consulta este material.";
    case "partial":
      return "indexado em parte: confira o material na tela Conhecimento.";
    case "failed":
      return "falhou: abra o material na tela Conhecimento para ver o motivo e reindexar.";
    case "sem_credencial":
      return "parada: falta a chave de indexação do cliente.";
    case "indexando":
      return "em andamento.";
    default:
      return "na fila: começa em instantes, e o material passa a ser consultado quando terminar.";
  }
}

export async function importarConhecimento(
  ctx: ContextoDaFerramenta,
  args: Record<string, unknown>,
): Promise<ResultadoDoConhecimento> {
  const organizacao = await organizacaoDaImportacao(ctx.admin, args.organization_id);
  const requestId = requestIdDe(ctx);
  const orgId = organizacao.id;

  const nome = texto(args.nome, 400);
  if (!nome || nome.length < 2 || nome.length > 120) {
    throw new RecusaDaImportacao(
      "`nome` é obrigatório: o nome do material como a equipe vai vê-lo na tela Conhecimento, de 2 a 120 caracteres " +
        '(ex.: "Política de troca"). Nada foi gravado.',
    );
  }

  const arquivo = await obterArquivo(args, TAMANHO_MAXIMO_DO_DOCUMENTO);

  const extensao = resolverExtensao(arquivo.nome, arquivo.tipo ?? undefined);
  if (!extensao) {
    const bruta = arquivo.nome.split(".").pop()?.toLowerCase() ?? "";
    if (bruta === "xlsx" || bruta === "xls") {
      throw new RecusaDaImportacao(
        'A base de conhecimento não lê Excel. No Excel use "Salvar como" → "CSV UTF-8 (delimitado por vírgulas)" e mande o CSV. Nada foi gravado.',
      );
    }
    if (arquivo.tipo === "text/html" || bruta === "html" || bruta === "htm") {
      throw new RecusaDaImportacao(
        "O endereço devolveu uma PÁGINA da web, e a base de conhecimento não lê página: lê arquivo (PDF, Markdown .md, CSV ou " +
          "texto .txt). Salve o conteúdo da página num desses formatos e mande o arquivo, ou cadastre o texto com a ferramenta " +
          "de conhecimento por texto da implantação. Nada foi gravado.",
      );
    }
    throw new RecusaDaImportacao(
      "Não sei ler esse tipo de arquivo. A base de conhecimento aceita PDF, Markdown (.md), CSV (.csv) ou texto (.txt). " +
        "Se o endereço não termina com a extensão, informe `nome_do_arquivo` (ex.: \"catalogo.pdf\"). Nada foi gravado.",
    );
  }

  const sha256 = createHash("sha256").update(arquivo.bytes).digest("hex");

  // Reexecução: o material é o mesmo quando o NOME é o mesmo (sem diferenciar
  // caixa nem espaço nas pontas, como o índice único) e o conteúdo também.
  const { data: ativas, error: erroLeitura } = await ctx.admin
    .from("ai_knowledge_sources")
    .select("id, name, source_type, source_metadata, last_index_status")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  if (erroLeitura) throw new Error(`não consegui ler os materiais do cliente: ${erroLeitura.message}`);
  const chave = nome.trim().toLowerCase();
  const existente = ((ativas ?? []) as unknown as FonteNaBase[]).find((f) => f.name.trim().toLowerCase() === chave);
  if (existente) {
    if (existente.source_metadata?.sha256 === sha256) {
      const habilitada = await temChaveDeEmbedding(orgId);
      return {
        organizacao,
        desfecho: "ja_estava",
        id: existente.id,
        nome: existente.name,
        indexacao_habilitada: habilitada,
        situacao_da_indexacao: situacaoDaIndexacao(existente.last_index_status, habilitada),
        nada_foi_enviado: NADA_FOI_ENVIADO,
      };
    }
    throw new RecusaDaImportacao(
      `Já existe um material chamado "${existente.name}" neste cliente, com OUTRO conteúdo. A importação não troca o ` +
        "conteúdo de um material que já existe: use outro `nome`, ou arquive o antigo na tela Conhecimento e repita. Nada foi gravado.",
    );
  }

  const blobPath = `${orgId}/${randomUUID()}.${extensao}`;
  const { error: erroUpload } = await ctx.admin.storage
    .from(BUCKET_DE_CONHECIMENTO)
    .upload(blobPath, arquivo.bytes, { contentType: MIME_POR_EXTENSAO[extensao], upsert: false });
  if (erroUpload) throw new Error(`não consegui guardar o arquivo: ${erroUpload.message}`);

  // Recusar o ilegível AGORA. Descobrir só quando o indexador rodar
  // transformaria um erro que se corrige num material parado sem explicação.
  try {
    await extrairTextoDoArquivo(blobPath, extensao);
  } catch (err) {
    await ctx.admin.storage.from(BUCKET_DE_CONHECIMENTO).remove([blobPath]);
    if (err instanceof ErroDeExtracao) {
      throw new RecusaDaImportacao(
        `O arquivo não pôde ser lido: ${err.message} Nada foi gravado.`,
      );
    }
    throw new Error("não consegui ler o arquivo depois de guardá-lo. Nada foi gravado.");
  }

  const { data: criada, error: erroInsert } = await ctx.admin
    .from("ai_knowledge_sources")
    .insert({
      organization_id: orgId,
      agent_id: null,
      source_type: "documento",
      name: nome,
      status: "ready",
      is_active: true,
      ingested_at: new Date().toISOString(),
      source_metadata: {
        filename: arquivo.nome,
        blob_path: blobPath,
        ext: extensao,
        uploaded_by: ctx.autorUserId,
        mime_type: arquivo.tipo ?? MIME_POR_EXTENSAO[extensao],
        size_bytes: arquivo.bytes.byteLength,
        // O que a reexecução compara. O ENDEREÇO de origem não é guardado: ele
        // pode carregar um token de acesso na própria URL.
        sha256,
        origem: "mcp_plataforma",
      },
    })
    .select("id")
    .single();
  if (erroInsert || !criada) {
    await ctx.admin.storage.from(BUCKET_DE_CONHECIMENTO).remove([blobPath]);
    if (erroInsert?.code === "23505") {
      throw new RecusaDaImportacao(
        `Já existe um material chamado "${nome}" neste cliente, criado enquanto esta chamada rodava. Repita a chamada. Nada foi gravado.`,
      );
    }
    throw new Error(`não consegui registrar o material: ${erroInsert?.message ?? "sem linha"}`);
  }
  const id = (criada as { id: string }).id;

  // O MESMO evento que a tela emite: é ele que acorda o indexador.
  const { error: erroEvento } = await ctx.admin.rpc("emit_event", {
    p_event_type: "knowledge_source.updated",
    p_entity_kind: "ai_knowledge_source",
    p_entity_id: id,
    p_payload: { knowledge_source_id: id, agent_id: null, source_type: "documento" },
    p_organization_id: orgId,
  });

  const habilitada = await temChaveDeEmbedding(orgId);

  await audit({
    action: "plataforma.importacao",
    actorUserId: ctx.autorUserId,
    organizationId: orgId,
    resourceType: "conhecimento",
    resourceId: id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    requestId,
    metadata: {
      via: "mcp_plataforma",
      ferramenta: "plataforma_importar_conhecimento",
      tipo: "conhecimento",
      token_id: ctx.tokenId,
      total: 1,
      criou: 1,
      extensao,
      bytes: arquivo.bytes.byteLength,
      veio: arquivo.veio,
      indexacao_habilitada: habilitada,
    },
  });

  return {
    organizacao,
    desfecho: "criou",
    id,
    nome,
    indexacao_habilitada: habilitada,
    situacao_da_indexacao: erroEvento
      ? "o material foi gravado, mas o pedido de indexação falhou: abra-o na tela Conhecimento e mande reindexar."
      : situacaoDaIndexacao(null, habilitada),
    nada_foi_enviado: NADA_FOI_ENVIADO,
  };
}

export const FERRAMENTA_IMPORTAR_CONHECIMENTO: FerramentaDeImportacao = {
  name: "plataforma_importar_conhecimento",
  description:
    "Importa UM ARQUIVO para a base de conhecimento de um cliente: o material que o agente de IA consulta para responder " +
    "(política de troca, tabela de preços, manual, catálogo em PDF). Faz parte do passo 6 de uma migração (materiais), " +
    "depois da base. É o mesmo que enviar o arquivo pela tela Conhecimento.\n\n" +
    "Um arquivo por chamada. Formatos: PDF, Markdown (.md), CSV (.csv) e texto (.txt). Excel não: exporte como CSV. " +
    "Página da web (HTML) não: a plataforma não lê site. O arquivo vem por `arquivo_url` (endereço https PÚBLICO, até 20 MB) " +
    `ou por \`arquivo_base64\` (até ${TETO_DO_BASE64 / (1024 * 1024)} MB decodificado) com \`nome_do_arquivo\`.\n\n` +
    "Pode ser repetida sem duplicar: o material é reconhecido pelo `nome`. Mesmo nome e mesmo conteúdo responde que já " +
    "estava; mesmo nome com outro conteúdo é recusado (a importação não troca o conteúdo de um material).\n\n" +
    "Depois de gravar, a indexação é pedida como a tela pede. A resposta diz se ela vai acontecer: sem a chave de IA do " +
    "cliente configurada, o material fica parado.\n\n" +
    "O que NÃO faz: não envia nada a ninguém, não liga o material a um agente (isso é a configuração do agente) e não " +
    "cadastra texto colado nem perguntas e respostas (são da ferramenta de conhecimento da implantação).",
  inputSchema: {
    organization_id: z.string().describe("O id do cliente (de plataforma_listar_clientes)."),
    nome: z.string().describe('O nome do material na tela Conhecimento, de 2 a 120 caracteres. Ex.: "Política de troca".'),
    arquivo_url: z
      .string()
      .optional()
      .describe(
        'Endereço https PÚBLICO de onde baixar o arquivo (abre sem login). Ex.: "https://exemplo.invalid/politica-de-troca.pdf". ' +
          "Use este OU arquivo_base64.",
      ),
    arquivo_base64: z
      .string()
      .optional()
      .describe(`O conteúdo do arquivo em base64, até ${TETO_DO_BASE64 / (1024 * 1024)} MB decodificado. Exige nome_do_arquivo.`),
    nome_do_arquivo: z
      .string()
      .optional()
      .describe('O nome do arquivo com a extensão, que diz o tipo. Ex.: "politica-de-troca.pdf". Obrigatório com base64.'),
  },
  operacao: OPERACAO_IMPORTAR_MATERIAIS,
  exemplo: {
    organization_id: "00000000-0000-4000-8000-000000000001",
    nome: "Política de troca",
    arquivo_url: "https://exemplo.invalid/politica-de-troca.pdf",
  },
  handler: importarConhecimento,
  // O nome do material é dado do cliente, não de uma pessoa, e identifica o que
  // foi importado. O conteúdo e o endereço (que pode carregar token) ficam fora.
  redigirParaAuditoria: redigirLote(["organization_id", "nome", "nome_do_arquivo"], []),
};
