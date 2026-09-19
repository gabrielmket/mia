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
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { FERRAMENTAS } from "./ferramentas";
import { operacaoPorChave, podeExecutar } from "./operacoes";
import type { TokenDePlataforma } from "./auth";

const NOME = "mia-plataforma";
const VERSAO = "0.1.0";

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

export function criarServidorDePlataforma(
  token: TokenDePlataforma,
  requestId: string,
): McpServer {
  const server = new McpServer({ name: NOME, version: VERSAO });
  const admin = createAdminClient();

  for (const ferramenta of FERRAMENTAS) {
    // A descrição que o MODELO lê carrega o aviso de escopo. Sem isso, um
    // agente com token só-leitura tentaria a escrita, levaria a recusa e
    // contaria ao usuário que "o sistema falhou" — quando o sistema recusou
    // exatamente como devia.
    const escopo = ferramenta.operacao;
    const descricao = escopo
      ? `${ferramenta.description}\n\n(Escrita. Exige que o token carregue a operação "${escopo}".)`
      : `${ferramenta.description}\n\n(Leitura.)`;

    server.registerTool(
      ferramenta.name,
      { description: descricao, inputSchema: ferramenta.inputSchema },
      async (rawArgs) => {
        const inicio = Date.now();
        const args = (rawArgs ?? {}) as Record<string, unknown>;

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

          return { isError: true, content: [{ type: "text" as const, text: recado }] };
        }

        try {
          const autorUserId = await autorDoToken(token.tokenId);
          const resultado = await ferramenta.handler(
            { admin, autorUserId, tokenId: token.tokenId },
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
                // exatamente isso que alguém vai querer saber depois.
                argumentos: args,
                duracao_ms: Date.now() - inicio,
              },
            });
          }

          return {
            content: [{ type: "text" as const, text: JSON.stringify(resultado, null, 2) }],
          };
        } catch (err) {
          const mensagem = err instanceof Error ? err.message : "erro desconhecido";
          return { isError: true, content: [{ type: "text" as const, text: mensagem }] };
        }
      },
    );
  }

  return server;
}
