/**
 * O servidor MCP de PLATAFORMA (item E6).
 *
 * ── A diferença que importa em relação ao `lib/mcp/server.ts` ─────────────
 *
 * O outro serve UM cliente: tudo que ele faz acontece dentro de uma
 * organização, e a RLS está lá embaixo como última linha. Aqui não há
 * organização e não há RLS: o `service_role` atravessa tudo.
 *
 * Então a guarda é a lista branca, e ela é conferida ANTES de o handler ser
 * chamado — não dentro dele. Um handler que confere a própria permissão é um
 * handler que alguém escreve sem conferir no dia em que estiver com pressa.
 *
 * ── Por que o `Server` de baixo nível, e não o `McpServer` ────────────────
 *
 * O `McpServer` valida os argumentos sozinho, antes do handler, e a recusa dele
 * é a mensagem crua do validador, em inglês: "Invalid input: expected string,
 * received undefined". Quem chama este servidor é um agente implantando um
 * cliente, e a mensagem de erro é a única instrução que ele tem para tentar de
 * novo. Com o `Server` de baixo nível a validação é nossa: a recusa diz o
 * campo, o que era esperado, o que o campo significa e mostra um exemplo que
 * passa (`lib/mcp-plataforma/recusa.ts`). O que o modelo recebe em `tools/list`
 * é o mesmo: nome, descrição e o JSON Schema dos argumentos.
 *
 * A validação é ESTRITA: campo desconhecido é recusado, com o nome. Um campo
 * escrito errado (`etapa` no lugar de `etapas`) que fosse ignorado em silêncio
 * faria a ferramenta responder "feito" sobre um pedido que ela não leu.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { FERRAMENTAS, FERRAMENTA_POR_NOME } from "./ferramentas";
// A lista de pessoas de uma importação não vai para a auditoria.
import { argumentosParaAuditoria } from "./importacao/auditoria";
import { operacaoPorChave, podeExecutar } from "./operacoes";
import { explicarValidacao, textoDaFalha } from "./recusa";
import type { TokenDePlataforma } from "./auth";
import type { FerramentaDePlataforma } from "./tipos";

const NOME = "mia-plataforma";
const VERSAO = "0.2.0";

/**
 * Quem responde pelo token, para as colunas de autoria (`created_by`), que são
 * FK para `auth.users` e não aceitam um token.
 *
 * É quem CRIOU o token: a pessoa que respondeu por ele existir. A auditoria
 * grava o token junto, então "quem fez" fica com as duas metades — a pessoa
 * responsável e a chave usada.
 */
async function autorDoToken(tokenId: string): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("platform_api_tokens")
    .select("created_by")
    .eq("id", tokenId)
    .maybeSingle();
  if (error || !data) {
    throw new Error("não consegui identificar quem criou este token");
  }
  return (data as { created_by: string }).created_by;
}

/**
 * A descrição que o MODELO lê carrega o aviso de escopo. Sem isso, um agente
 * com token só-leitura tentaria a escrita, levaria a recusa e contaria ao
 * usuário que "o sistema falhou" — quando o sistema recusou exatamente como
 * devia.
 */
export function descricaoParaOModelo(ferramenta: FerramentaDePlataforma): string {
  return ferramenta.operacao
    ? `${ferramenta.description}\n\n(Escrita. Exige que o token carregue a operação "${ferramenta.operacao}".)`
    : `${ferramenta.description}\n\n(Leitura.)`;
}

/** O JSON Schema dos argumentos, como o cliente MCP o recebe em `tools/list`. */
export function esquemaDosArgumentos(ferramenta: FerramentaDePlataforma): Record<string, unknown> {
  const esquema = z.toJSONSchema(z.strictObject(ferramenta.inputSchema), {
    target: "draft-7",
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  return { ...esquema, type: "object" };
}

const TETO_DE_TEXTO_NA_AUDITORIA = 400;
const TETO_DE_LISTA_NA_AUDITORIA = 25;

/**
 * Os argumentos como vão para a auditoria: inteiros no que é curto, resumidos
 * no que é longo.
 *
 * Os argumentos vão, e é deliberado: sem eles a linha diz "gravou o funil" sem
 * dizer em quem nem o quê. Mas um prompt de vinte mil caracteres ou um catálogo
 * de duzentos produtos por linha encheria a trilha até ninguém mais lê-la. O
 * texto longo vira o começo dele e o tamanho; a lista longa vira os primeiros
 * itens e a contagem. O conteúdo inteiro está onde foi gravado (a versão do
 * agente, o catálogo), com data e autor.
 */
export function resumoParaAuditoria(valor: unknown, profundidade = 0): unknown {
  if (typeof valor === "string") {
    return valor.length <= TETO_DE_TEXTO_NA_AUDITORIA
      ? valor
      : { inicio: valor.slice(0, 200), caracteres: valor.length };
  }
  if (Array.isArray(valor)) {
    if (profundidade > 5) return `[lista de ${valor.length}]`;
    const itens = valor.slice(0, TETO_DE_LISTA_NA_AUDITORIA).map((v) => resumoParaAuditoria(v, profundidade + 1));
    return valor.length > TETO_DE_LISTA_NA_AUDITORIA
      ? { primeiros: itens, total: valor.length }
      : itens;
  }
  if (valor !== null && typeof valor === "object") {
    if (profundidade > 5) return "[objeto]";
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>).map(([k, v]) => [k, resumoParaAuditoria(v, profundidade + 1)]),
    );
  }
  return valor;
}

function erro(texto: string) {
  return { isError: true, content: [{ type: "text" as const, text: texto }] };
}

export function criarServidorDePlataforma(token: TokenDePlataforma, requestId: string): Server {
  const server = new Server({ name: NOME, version: VERSAO }, { capabilities: { tools: {} } });
  const admin = createAdminClient();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: FERRAMENTAS.map((ferramenta) => ({
      name: ferramenta.name,
      description: descricaoParaOModelo(ferramenta),
      inputSchema: esquemaDosArgumentos(ferramenta) as { type: "object"; [chave: string]: unknown },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (pedido) => {
    const inicio = Date.now();
    const ferramenta = FERRAMENTA_POR_NOME.get(pedido.params.name);
    if (!ferramenta) {
      return erro(
        `Não existe a ferramenta "${pedido.params.name}" neste servidor. Liste as ferramentas (tools/list) para ver os nomes.`,
      );
    }
    const escopo = ferramenta.operacao;

    // ⚠️ A GUARDA VEM ANTES DO HANDLER, e fora dele.
    if (escopo && !podeExecutar(token.operacoes, escopo)) {
      const op = operacaoPorChave(escopo);
      // A recusa NOMEIA o que falta e explica o raio — é o que permite a
      // quem opera pedir exatamente a operação que precisa, em vez de
      // pedir "acesso total" por não saber o nome da que resolve.
      const recado =
        `Este token não tem a operação "${escopo}"` +
        (op ? ` (${op.rotulo}).` : ".") +
        ` Peça-a a um admin de plataforma em Admin › Tokens de plataforma.` +
        (op ? `\n\nO que ela permite: ${op.raio}` : "");

      void audit({
        action: "plataforma.mcp_recusado",
        resourceType: "platform_api_token",
        resourceId: null,
        actingAsPlatformAdmin: true,
        requestId,
        metadata: { ferramenta: ferramenta.name, operacao: escopo, token_id: token.tokenId },
      });

      return erro(recado);
    }

    // A conferência dos argumentos, com a recusa que ensina. Depois da guarda:
    // quem não pode executar a operação não precisa saber se o pedido estava
    // bem formado.
    // `reportInput`: sem ele o validador não diz o que chegou, e a recusa não
    // consegue separar "faltou o campo" de "veio texto onde era lista".
    const lido = z.strictObject(ferramenta.inputSchema).safeParse(pedido.params.arguments ?? {}, { reportInput: true });
    if (!lido.success) return erro(explicarValidacao(ferramenta, lido.error));
    const args = lido.data as Record<string, unknown>;

    try {
      const autorUserId = await autorDoToken(token.tokenId);
      const resultado = await ferramenta.handler(
        { admin, autorUserId, tokenId: token.tokenId, requestId },
        args,
      );

      // Auditar só a ESCRITA. Leitura de plataforma é o caminho comum (um
      // agente lista clientes a cada pergunta) e auditá-la encheria a
      // trilha de linhas sem decisão — que é como uma trilha deixa de ser
      // lida, e aí a escrita que importa se esconde no meio.
      if (escopo) {
        void audit({
          action: "plataforma.mcp_executado",
          actorUserId: autorUserId,
          resourceType: "platform_api_token",
          resourceId: null,
          actingAsPlatformAdmin: true,
          bypassedRls: true,
          requestId,
          metadata: {
            ferramenta: ferramenta.name,
            operacao: escopo,
            token_id: token.tokenId,
            // Os ARGUMENTOS vão, e é deliberado: sem eles a linha diz
            // "lançou crédito" sem dizer em quem nem quanto — e é
            // exatamente isso que alguém vai querer saber depois. Texto e
            // lista longos vão resumidos (`resumoParaAuditoria`).
            //
            // Menos nas ferramentas de IMPORTAÇÃO, cujos argumentos são a
            // lista de pessoas de um cliente: elas declaram a própria
            // redação (lista branca, só contagens), e é ela que vale
            // (`importacao/auditoria.ts`). O resumo vem DEPOIS, por cima do
            // que a redação deixou passar.
            argumentos: resumoParaAuditoria(argumentosParaAuditoria(ferramenta, args)),
            duracao_ms: Date.now() - inicio,
          },
        });
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(resultado, null, 2) }],
      };
    } catch (err) {
      return erro(textoDaFalha(err));
    }
  });

  return server;
}
