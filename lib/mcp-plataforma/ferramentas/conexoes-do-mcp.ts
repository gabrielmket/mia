/**
 * FORK MIA (upstream 1.117, migration 9390, MIA-67): as CONEXÕES de aplicativo
 * ao MCP da empresa, pelo OAuth do MCP.
 *
 * Desde a 1.117 um aplicativo que não deixa colar chave (o ChatGPT) conecta ao
 * `/api/mcp` da empresa pelo OAuth: o administrador da empresa consente na tela
 * do CRM e o aplicativo recebe um token `dsk_` comum de `api_tokens`, marcado
 * `aud:mcp` (só vale no `/api/mcp`). Cada conexão é uma linha de
 * `mcp_oauth_concessoes` apontando para a linha do token, e a tela de API Tokens
 * mostra e revoga a conexão como um token.
 *
 * Duas ferramentas, e só estas (decisão do Chefe na MIA-67):
 *
 *   plataforma_ver_conexoes_do_mcp      leitura: quais aplicativos estão
 *                                       conectados, quem autorizou, com que
 *                                       acesso e quando usou pela última vez
 *   plataforma_revogar_conexao_do_mcp   `revogar_conexao_do_mcp`: desliga UMA
 *
 * O MCP não cria conexão: quem conecta é o administrador da empresa, no
 * aplicativo, e o consentimento é dele. O acesso que "Ler e alterar" dá ao
 * aplicativo (o papel gravado no token pelo banco, `fn_mcp_oauth_trocar_codigo`)
 * é do upstream e fica como está: aqui só se lê.
 *
 * A revogação faz o mesmo que as duas portas que já existem, juntas: a da tela
 * (`POST /api/v1/settings/api-tokens/[id]/revoke`: `revoked_at`, `revoked_by`,
 * auditoria `token.revoked`) e a do banco (`fn_mcp_oauth_desligar`: a concessão
 * marcada `revogada_em`, para a renovação não tentar de novo). Nada do token
 * (valor, hash, prefixo) nem do refresh sai daqui.
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { Recusa, recusar } from "@/lib/mcp-plataforma/recusa";
import { nomesDosAtendentesCom } from "@/lib/users/nome-do-atendente";

import type { ContextoDaFerramenta, FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

export const OPERACAO_REVOGAR_CONEXAO_DO_MCP = "revogar_conexao_do_mcp";

/** A marca que o banco grava no token da conexão (`ESCOPO_SO_MCP` de `lib/mcp/auth.ts`). */
const MARCA_DA_CONEXAO = "aud:mcp";

interface LinhaDaConcessao {
  id: string;
  organization_id: string;
  cliente_id: string;
  user_id: string;
  api_token_id: string;
  escopos: string[] | null;
  refresh_expira_em: string | null;
  renovada_em: string | null;
  revogada_em: string | null;
  created_at: string;
}

interface LinhaDoToken {
  id: string;
  organization_id: string;
  name: string | null;
  scopes: unknown;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

interface LinhaDoCliente {
  id: string;
  nome: string;
  redirect_uris: string[] | null;
}

const COLUNAS_DA_CONCESSAO =
  "id, organization_id, cliente_id, user_id, api_token_id, escopos, refresh_expira_em, renovada_em, revogada_em, created_at";
const COLUNAS_DO_TOKEN = "id, organization_id, name, scopes, last_used_at, expires_at, revoked_at";

type Situacao = "ativa" | "revogada" | "vencida";

function escoposDoToken(scopes: unknown): string[] {
  return Array.isArray(scopes) ? scopes.filter((s): s is string => typeof s === "string") : [];
}

/** O endereço para onde o código foi, só o host: o mesmo que a tela de consentimento mostrou. */
function hostDoRetorno(uris: string[] | null): string | null {
  for (const uri of uris ?? []) {
    try {
      return new URL(uri).host || null;
    } catch {
      // Endereço que não se lê fica de fora; o registro já o validou na entrada.
    }
  }
  return null;
}

function situacaoDa(concessao: LinhaDaConcessao, token: LinhaDoToken | undefined, agora: number): Situacao {
  if (concessao.revogada_em || !token || token.revoked_at) return "revogada";
  const refreshVenceu = concessao.refresh_expira_em !== null && Date.parse(concessao.refresh_expira_em) <= agora;
  const tokenVenceu = token.expires_at !== null && Date.parse(token.expires_at) <= agora;
  return refreshVenceu && tokenVenceu ? "vencida" : "ativa";
}

async function lerConexoes(ctx: ContextoDaFerramenta, orgId: string) {
  const { data: concessoes, error } = await ctx.admin
    .from("mcp_oauth_concessoes")
    .select(COLUNAS_DA_CONCESSAO)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`não consegui ler as conexões do MCP: ${error.message}`);
  const lista = (concessoes ?? []) as LinhaDaConcessao[];
  if (lista.length === 0) return [];

  const [tokens, clientes, nomes] = await Promise.all([
    (async () => {
      const { data, error: e } = await ctx.admin
        .from("api_tokens")
        .select(COLUNAS_DO_TOKEN)
        .eq("organization_id", orgId)
        .in("id", lista.map((c) => c.api_token_id));
      if (e) throw new Error(`não consegui ler os tokens das conexões: ${e.message}`);
      return new Map(((data ?? []) as LinhaDoToken[]).map((t) => [t.id, t]));
    })(),
    (async () => {
      const { data, error: e } = await ctx.admin
        .from("mcp_oauth_clientes")
        .select("id, nome, redirect_uris")
        .in("id", [...new Set(lista.map((c) => c.cliente_id))]);
      if (e) throw new Error(`não consegui ler os aplicativos das conexões: ${e.message}`);
      return new Map(((data ?? []) as LinhaDoCliente[]).map((c) => [c.id, c]));
    })(),
    nomesDosAtendentesCom(ctx.admin, orgId, lista.map((c) => c.user_id)),
  ]);

  const agora = Date.now();
  return lista.map((c) => {
    const token = tokens.get(c.api_token_id);
    const cliente = clientes.get(c.cliente_id);
    const escopos = c.escopos ?? [];
    const papel = escoposDoToken(token?.scopes).find((s) => s.startsWith("role:"))?.slice("role:".length) ?? null;
    return {
      conexao_id: c.id,
      aplicativo: cliente?.nome ?? null,
      endereco_de_retorno: hostDoRetorno(cliente?.redirect_uris ?? null),
      situacao: situacaoDa(c, token, agora),
      acesso: escopos.includes("mcp:write") ? "ler_e_alterar" : "ler",
      escopos,
      papel_no_crm: papel,
      autorizada_por: { user_id: c.user_id, nome: nomes.get(c.user_id) ?? null },
      nome_na_tela_de_tokens: token?.name ?? null,
      criada_em: c.created_at,
      renovada_em: c.renovada_em,
      ultimo_uso_em: token?.last_used_at ?? null,
      revogada_em: c.revogada_em ?? token?.revoked_at ?? null,
    };
  });
}

export const FERRAMENTAS_DAS_CONEXOES_DO_MCP: FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_conexoes_do_mcp",
    description:
      "Os aplicativos conectados ao MCP da empresa pelo OAuth (por exemplo, o ChatGPT): cada conexão com o nome que o aplicativo declarou, o endereço para onde " +
      "o acesso foi entregue, a situação (ativa, revogada ou vencida), o acesso (`ler` ou `ler_e_alterar`), quem da empresa autorizou, o nome com que aparece " +
      "na tela de API Tokens e quando foi usada pela última vez. Sem `incluir_revogadas`, mostra só as que não foram revogadas. " +
      "QUANDO USAR: quando a empresa pergunta quem está ligado ao CRM dela por fora, e antes de plataforma_revogar_conexao_do_mcp (o id sai daqui). " +
      "O QUE NÃO FAZ: não mostra os tokens colados à mão na tela de API Tokens nem o valor de token nenhum, e não cria conexão (quem conecta é o administrador da empresa, no aplicativo).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      incluir_revogadas: z.boolean().optional().describe("Inclui as conexões já revogadas. Padrão: não."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO },
    operacao: null,
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      const todas = await lerConexoes(ctx, org.id);
      const conexoes = args.incluir_revogadas === true ? todas : todas.filter((c) => c.situacao !== "revogada");
      return {
        conexoes,
        ativas: todas.filter((c) => c.situacao === "ativa").length,
        ...(conexoes.length === 0
          ? {
              aviso:
                "Nenhuma conexão por OAuth. Para conectar um aplicativo, o administrador da empresa adiciona o conector MCP no aplicativo, com o endereço " +
                "/api/mcp do sistema, e autoriza na tela do CRM.",
            }
          : {}),
      };
    },
  },

  {
    name: "plataforma_revogar_conexao_do_mcp",
    description:
      "REVOGA uma conexão de aplicativo ao MCP da empresa (OAuth): na hora, o aplicativo deixa de ler e de alterar o CRM, e a renovação do acesso é recusada. " +
      "É o mesmo que Revogar na tela de API Tokens, e a trilha grava `token.revoked`. Revogada não volta: para conectar de novo, o administrador da empresa " +
      "autoriza outra vez no aplicativo. Revogar a que já estava revogada responde `ja_estava` e não escreve. " +
      "ANTES DE: confira em plataforma_ver_conexoes_do_mcp qual é a conexão e combine com a empresa, porque o aplicativo dela para de funcionar. " +
      "O QUE NÃO FAZ: não revoga os tokens colados à mão (esses são da tela de API Tokens), não apaga a conexão da lista e não avisa ninguém.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      conexao_id: z.string().uuid().describe("O `conexao_id` de plataforma_ver_conexoes_do_mcp."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, conexao_id: "00000000-0000-4000-8000-0000000000c1" },
    operacao: OPERACAO_REVOGAR_CONEXAO_DO_MCP,
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      const conexaoId = String(args.conexao_id);

      const { data: concessao, error } = await ctx.admin
        .from("mcp_oauth_concessoes")
        .select(COLUNAS_DA_CONCESSAO)
        .eq("id", conexaoId)
        .eq("organization_id", org.id)
        .maybeSingle();
      if (error) throw new Error(`não consegui ler a conexão: ${error.message}`);
      if (!concessao) {
        recusar(
          `Não achei a conexão ${conexaoId} nesta empresa. Os ids saem de plataforma_ver_conexoes_do_mcp ` +
            "(com `incluir_revogadas: true`, aparecem também as revogadas).",
        );
      }
      const c = concessao as LinhaDaConcessao;

      const { data: tokenLido, error: tokenErr } = await ctx.admin
        .from("api_tokens")
        .select(COLUNAS_DO_TOKEN)
        .eq("id", c.api_token_id)
        .eq("organization_id", org.id)
        .maybeSingle();
      if (tokenErr) throw new Error(`não consegui ler o token da conexão: ${tokenErr.message}`);
      const token = tokenLido as LinhaDoToken | null;
      // Só o token da conexão OAuth: um token colado à mão nunca é revogado por aqui.
      if (token && !escoposDoToken(token.scopes).includes(MARCA_DA_CONEXAO)) {
        throw new Recusa(
          "Esta conexão aponta para um token que não é de conexão OAuth. Nada foi revogado: revogue pela tela de API Tokens da empresa.",
        );
      }

      if (c.revogada_em || !token || token.revoked_at) {
        return { desfecho: "ja_estava", conexao: (await lerConexoes(ctx, org.id)).find((x) => x.conexao_id === c.id) ?? null };
      }

      const agora = new Date().toISOString();
      const { error: updTokenErr } = await ctx.admin
        .from("api_tokens")
        .update({ revoked_at: agora, revoked_by: ctx.autorUserId, updated_at: agora })
        .eq("id", token.id)
        .eq("organization_id", org.id)
        .is("revoked_at", null);
      if (updTokenErr) throw new Error(`não consegui revogar o token da conexão: ${updTokenErr.message}`);
      const { error: updConErr } = await ctx.admin
        .from("mcp_oauth_concessoes")
        .update({ revogada_em: agora })
        .eq("id", c.id)
        .eq("organization_id", org.id)
        .is("revogada_em", null);
      if (updConErr) throw new Error(`o token foi revogado, mas não consegui marcar a conexão: ${updConErr.message}`);

      await audit({
        action: "token.revoked",
        actorUserId: ctx.autorUserId,
        organizationId: org.id,
        resourceType: "api_token",
        resourceId: token.id,
        requestId: ctx.requestId,
        metadata: { via: "mcp_plataforma", conexao_id: c.id },
      });

      return { desfecho: "revogou", conexao: (await lerConexoes(ctx, org.id)).find((x) => x.conexao_id === c.id) ?? null };
    },
  },
];
