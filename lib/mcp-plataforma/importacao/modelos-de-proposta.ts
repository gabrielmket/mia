/**
 * IMPORTAR MODELO DE PROPOSTA — a proposta comercial que o cliente já usa,
 * transformada num modelo reutilizável.
 *
 * ── O caminho da tela, em dois atos ───────────────────────────────────────
 *
 * Na tela (Configurações › Propostas › Modelos) isto são dois cliques:
 *
 *  1. "Importar" (`POST /api/v1/settings/proposal-templates/importar`): lê o
 *     arquivo e pede à IA (`gerarModeloDoTexto`) que o divida em seções, com as
 *     variáveis no lugar dos dados de um cliente específico. Devolve um
 *     RASCUNHO, não grava;
 *  2. "Salvar" (`POST /api/v1/settings/proposal-templates`, ação "novo"):
 *     valida (`validarModelo`) e grava a versão 1 do modelo.
 *
 * A ferramenta faz os dois, com as mesmas funções: o mesmo extrator de texto,
 * a mesma chamada de IA, a mesma validação, o mesmo slug (`slugDaEmpresa`) e a
 * mesma gravação (`proximaVersao`, `secoesParaGravar`).
 *
 * ── O que custa, e por que o nome vem antes ───────────────────────────────
 *
 * O ato 1 gasta crédito de IA da plataforma. Por isso o `nome` é obrigatório e
 * é conferido ANTES de ler o arquivo: se o cliente já tem um modelo ativo com
 * esse nome, a resposta é "já estava" e nenhum token é gasto. É o que torna a
 * reexecução de uma migração inteira barata.
 */
import { z } from "zod";

import { llmEdgeConfigFromEnv } from "@/lib/agent-engine/edge/llm/credentials";
import {
  LlmBudgetExceededError,
  LlmModelNotEnabledError,
  LlmProviderUnknownError,
} from "@/lib/agent-engine/edge/llm/run-model-call";
import { extractMarkdownText } from "@/lib/ai/rag/extractors/markdown";
import { extractPdfText, PdfExtractError } from "@/lib/ai/rag/extractors/pdf";
import { resolverExtensao } from "@/lib/ai/rag/ingest/documento";
import { getSkillsPool } from "@/lib/ai/skills/db";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { capacidadesDaOrganizacao } from "@/lib/organizacao/capacidades";
import { proximaVersao, secoesParaGravar } from "@/lib/propostas/modelos/gravacao";
import { gerarModeloDoTexto } from "@/lib/propostas/modelos/importar";
import { slugDaEmpresa, validarModelo } from "@/lib/propostas/modelos/validar-modelo";

import { NADA_FOI_ENVIADO, organizacaoDaImportacao, RecusaDaImportacao, requestIdDe, texto } from "./base";
import { redigirLote } from "./auditoria";
import { obterArquivo, TETO_DO_BASE64 } from "./download";
import { OPERACAO_IMPORTAR_MATERIAIS } from "./operacoes";
import type { ContextoDaFerramenta, Desfecho, FerramentaDeImportacao } from "./tipos";

/** O mesmo teto de `POST /api/v1/settings/proposal-templates/importar`. */
export const TAMANHO_MAXIMO_DA_PROPOSTA = 5 * 1024 * 1024;

/** Abaixo disto não há proposta para ler: é PDF escaneado ou arquivo vazio. */
const TEXTO_MINIMO = 50;

export interface ResultadoDoModelo {
  organizacao: { id: string; nome: string; demonstracao: boolean };
  desfecho: Desfecho;
  slug: string;
  nome: string;
  secoes?: number;
  nada_foi_enviado: string;
}

const SEM_TEXTO =
  "Não encontrei texto neste arquivo. Se for um PDF escaneado (só imagem), exporte a proposta original como PDF com texto. Nada foi gravado.";

export async function importarModeloDeProposta(
  ctx: ContextoDaFerramenta,
  args: Record<string, unknown>,
): Promise<ResultadoDoModelo> {
  const organizacao = await organizacaoDaImportacao(ctx.admin, args.organization_id);
  const requestId = requestIdDe(ctx);
  const orgId = organizacao.id;

  const nome = texto(args.nome, 400);
  if (!nome || nome.length < 2 || nome.length > 80) {
    throw new RecusaDaImportacao(
      "`nome` é obrigatório: o nome do modelo, de 2 a 80 caracteres, dizendo o TIPO de proposta e não o nome de um cliente " +
        '(ex.: "Site institucional"). Nada foi gravado.',
    );
  }
  const descricao = texto(args.descricao, 400);
  if (descricao && descricao.length > 300) {
    throw new RecusaDaImportacao("`descricao` aceita até 300 caracteres. Nada foi gravado.");
  }

  // A mesma porta das rotas de proposta: com a capacidade desligada, o produto
  // não tem modelos para aquele cliente.
  const capacidades = await capacidadesDaOrganizacao(ctx.admin, orgId);
  if (!capacidades.includes("propostas")) {
    throw new RecusaDaImportacao(
      "As Propostas estão desligadas neste cliente. Ligue em Configurações › Propostas e repita: sem isso o modelo não " +
        "apareceria em tela nenhuma. Nada foi gravado.",
    );
  }

  // Reexecução, ANTES de gastar IA: o modelo ativo com este nome já existe?
  const slug = slugDaEmpresa(nome);
  const { data: ativo, error: erroLeitura } = await ctx.admin
    .from("proposal_templates")
    .select("id, nome, slug")
    .eq("organization_id", orgId)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (erroLeitura) throw new Error(`não consegui ler os modelos do cliente: ${erroLeitura.message}`);
  if (ativo) {
    return {
      organizacao,
      desfecho: "ja_estava",
      slug,
      nome: (ativo as { nome: string | null }).nome ?? nome,
      nada_foi_enviado: NADA_FOI_ENVIADO,
    };
  }

  const arquivo = await obterArquivo(args, TAMANHO_MAXIMO_DA_PROPOSTA);
  const extensaoBruta = arquivo.nome.split(".").pop()?.toLowerCase() ?? "";
  if (extensaoBruta === "docx" || extensaoBruta === "doc") {
    throw new RecusaDaImportacao(
      'Não leio Word diretamente. No Word use "Salvar como" → PDF e mande o PDF. Nada foi gravado.',
    );
  }
  const extensao = resolverExtensao(arquivo.nome, arquivo.tipo ?? undefined);
  if (extensao !== "pdf" && extensao !== "md" && extensao !== "txt") {
    throw new RecusaDaImportacao(
      "A proposta precisa vir em PDF, Markdown (.md) ou texto (.txt). Se o endereço não termina com a extensão, informe " +
        '`nome_do_arquivo` (ex.: "proposta.pdf"). Nada foi gravado.',
    );
  }

  let lido: string;
  try {
    lido = extensao === "pdf" ? await extractPdfText(arquivo.bytes) : extractMarkdownText(arquivo.bytes);
  } catch (err) {
    if (err instanceof PdfExtractError) throw new RecusaDaImportacao(SEM_TEXTO);
    throw new RecusaDaImportacao("Não consegui ler este arquivo. Nada foi gravado.");
  }
  if (lido.trim().length < TEXTO_MINIMO) throw new RecusaDaImportacao(SEM_TEXTO);

  let modelo: Awaited<ReturnType<typeof gerarModeloDoTexto>>;
  try {
    modelo = await gerarModeloDoTexto({
      texto: lido,
      pool: getSkillsPool(),
      cfg: llmEdgeConfigFromEnv(env),
      tenantId: orgId,
    });
  } catch (err) {
    if (
      err instanceof LlmBudgetExceededError ||
      err instanceof LlmProviderUnknownError ||
      err instanceof LlmModelNotEnabledError
    ) {
      throw new RecusaDaImportacao(
        `A IA que transforma a proposta em modelo não está disponível para este cliente: ${err.message} ` +
          "Confira a IA do cliente (chave e orçamento) e repita. Nada foi gravado.",
      );
    }
    throw err;
  }
  if (!modelo) {
    throw new RecusaDaImportacao(
      "A IA não conseguiu dividir este texto em seções de proposta. Confira se o arquivo é mesmo uma proposta comercial e repita. Nada foi gravado.",
    );
  }

  // A MESMA validação de "Salvar" na tela, com o nome que quem migra escolheu
  // (e não o que a IA sugeriu): é por ele que a reexecução reconhece o modelo.
  const erros = validarModelo({ nome, descricao, sections: modelo.sections, sectionOrder: modelo.sectionOrder });
  if (erros.length > 0) {
    throw new RecusaDaImportacao(
      "O modelo que a IA montou a partir do arquivo tem problemas e não foi gravado:\n" +
        erros.slice(0, 8).map((e) => `- ${e.campo}: ${e.mensagem}`).join("\n") +
        "\nImporte pela tela (Configurações › Propostas › Modelos), onde dá para corrigir as seções antes de salvar.",
    );
  }

  const { error: erroInsert } = await ctx.admin.from("proposal_templates").insert({
    organization_id: orgId,
    slug,
    version: await proximaVersao(ctx.admin, orgId, slug),
    base_slug: null,
    base_version: null,
    nome,
    descricao,
    sections: secoesParaGravar(modelo.sections),
    section_order: modelo.sectionOrder,
    is_active: true,
  });
  if (erroInsert) {
    if (erroInsert.code === "23505") {
      throw new RecusaDaImportacao(
        `Já existe um modelo ativo chamado "${nome}", criado enquanto esta chamada rodava. Repita a chamada. Nada foi gravado.`,
      );
    }
    throw new Error(`não consegui salvar o modelo: ${erroInsert.message}`);
  }

  // As duas linhas que a tela grava (importou, salvou) e a da importação.
  await audit({
    action: "proposal_template.imported",
    actorUserId: ctx.autorUserId,
    organizationId: orgId,
    resourceType: "proposal_templates",
    resourceId: null,
    requestId,
    metadata: { extensao, bytes: arquivo.bytes.byteLength, secoes: modelo.sections.length, via: "importacao" },
  });
  await audit({
    action: "proposal_template.saved",
    actorUserId: ctx.autorUserId,
    organizationId: orgId,
    resourceType: "proposal_templates",
    resourceId: null,
    requestId,
    metadata: { slug, acao: "novo", version: 1, via: "importacao" },
  });
  await audit({
    action: "plataforma.importacao",
    actorUserId: ctx.autorUserId,
    organizationId: orgId,
    resourceType: "modelos_de_proposta",
    resourceId: null,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    requestId,
    metadata: {
      via: "mcp_plataforma",
      ferramenta: "plataforma_importar_modelo_de_proposta",
      tipo: "modelos_de_proposta",
      token_id: ctx.tokenId,
      total: 1,
      criou: 1,
      slug,
      secoes: modelo.sections.length,
    },
  });

  return {
    organizacao,
    desfecho: "criou",
    slug,
    nome,
    secoes: modelo.sections.length,
    nada_foi_enviado: NADA_FOI_ENVIADO,
  };
}

export const FERRAMENTA_IMPORTAR_MODELO_DE_PROPOSTA: FerramentaDeImportacao = {
  name: "plataforma_importar_modelo_de_proposta",
  description:
    "Importa UM MODELO DE PROPOSTA para um cliente a partir da proposta comercial que ele já usa. A plataforma lê o arquivo, " +
    "divide em seções e troca os dados de um cliente específico por variáveis; o resultado é um modelo novo em " +
    "Configurações › Propostas › Modelos. Faz parte do passo 6 de uma migração (materiais).\n\n" +
    "Um arquivo por chamada, em PDF, Markdown (.md) ou texto (.txt), até 5 MB. Word não: salve como PDF. PDF escaneado " +
    "(só imagem) não tem texto para ler. O arquivo vem por `arquivo_url` (endereço https PÚBLICO) ou por `arquivo_base64` " +
    `(até ${TETO_DO_BASE64 / (1024 * 1024)} MB decodificado) com \`nome_do_arquivo\`.\n\n` +
    "Exige as Propostas LIGADAS no cliente. Gasta crédito de IA da plataforma a cada modelo novo. Pode ser repetida sem " +
    "duplicar nem gastar de novo: o modelo é reconhecido pelo `nome`, e se já existe um ativo com esse nome a resposta é " +
    "que já estava.\n\n" +
    "O que NÃO faz: não envia proposta a ninguém, não troca o conteúdo de um modelo que já existe e não mexe nos modelos " +
    "prontos da plataforma. Confira o modelo na tela antes de usá-lo: quem dividiu as seções foi uma IA.",
  inputSchema: {
    organization_id: z.string().describe("O id do cliente (de plataforma_listar_clientes)."),
    nome: z
      .string()
      .describe('O nome do modelo, de 2 a 80 caracteres: o TIPO de proposta, não o nome de um cliente. Ex.: "Site institucional".'),
    descricao: z.string().optional().describe("Uma frase sobre quando usar este modelo, até 300 caracteres."),
    arquivo_url: z
      .string()
      .optional()
      .describe('Endereço https PÚBLICO de onde baixar a proposta. Ex.: "https://exemplo.invalid/proposta.pdf". Use este OU arquivo_base64.'),
    arquivo_base64: z
      .string()
      .optional()
      .describe(`O conteúdo do arquivo em base64, até ${TETO_DO_BASE64 / (1024 * 1024)} MB decodificado. Exige nome_do_arquivo.`),
    nome_do_arquivo: z
      .string()
      .optional()
      .describe('O nome do arquivo com a extensão. Ex.: "proposta.pdf". Obrigatório com base64.'),
  },
  operacao: OPERACAO_IMPORTAR_MATERIAIS,
  exemplo: {
    organization_id: "00000000-0000-4000-8000-000000000001",
    nome: "Site institucional",
    arquivo_url: "https://exemplo.invalid/proposta.pdf",
  },
  handler: importarModeloDeProposta,
  redigirParaAuditoria: redigirLote(["organization_id", "nome", "nome_do_arquivo"], []),
};
