/**
 * O token de uma conta Microsoft conectada: ler, decifrar, renovar.
 *
 * A renovação mora aqui (e não só na rotina) porque o token da Microsoft dura
 * entre 60 e 90 minutos e a rotina roda a cada 10: quem vai usar o token e o
 * encontra a menos de dois minutos do fim renova na hora, pela MESMA função.
 * Duas réguas para "está na hora" divergiriam em silêncio.
 *
 * ⚠️ A renovação da Microsoft devolve um `refresh_token` NOVO. `fundirTokens`
 * fica com ele; gravar só o `access_token` deixaria o velho, que a Microsoft
 * pode recusar depois.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { fundirTokens, precisaRenovar, type TokenDoGoogle } from "@/lib/agenda/google/oauth";
import { decryptWebhookSecret, encryptWebhookSecret } from "@/lib/webhooks/secrets";

import { configuracaoDaMicrosoft, type AppDaMicrosoft } from "./config";
import { classificarErroDaMicrosoft, estadoDaConexaoApos } from "./erros";
import { escoposFaltandoMicrosoft } from "./oauth";
import { renovarTokenMicrosoft } from "./token";

export interface LinhaDaConexaoMicrosoft {
  id: string;
  organization_id: string;
  user_id: string;
  conta_email: string;
  status: string;
  token_expira_em: string | null;
  access_token_cifrado: string | null;
  refresh_token_cifrado: string | null;
  escopos: string[] | null;
}

export const COLUNAS_DA_CONEXAO =
  "id, organization_id, user_id, conta_email, status, token_expira_em, access_token_cifrado, refresh_token_cifrado, escopos";

export type DesfechoDaRenovacao =
  | { ok: true; accessToken: string }
  | { ok: false; situacao: "token_expired" | "scope_missing" | "error" | "rate_limited" | null; motivo: string };

async function marcar(db: SupabaseClient, linha: LinhaDaConexaoMicrosoft, status: string, motivo: string): Promise<void> {
  await db
    .from("mia_agenda_microsoft_conexoes")
    .update({ status, ultimo_erro: motivo.slice(0, 300) })
    .eq("organization_id", linha.organization_id)
    .eq("id", linha.id);
}

/**
 * Renova e grava. Nunca lança: devolve o desfecho, e quem chama decide se conta
 * como falha. Segredo que não decifra NÃO rebaixa a conexão (o problema é do
 * servidor, não da autorização da pessoa).
 */
export async function renovarConexaoMicrosoft(
  db: SupabaseClient,
  linha: LinhaDaConexaoMicrosoft,
  app: AppDaMicrosoft,
  agora: Date,
): Promise<DesfechoDaRenovacao> {
  if (!linha.refresh_token_cifrado) {
    await marcar(db, linha, "token_expired", "sem chave de renovação guardada");
    return { ok: false, situacao: "token_expired", motivo: "sem chave de renovação" };
  }
  const refresh = await decryptWebhookSecret(db, linha.refresh_token_cifrado);
  if (!refresh) return { ok: false, situacao: null, motivo: "a chave de cifra da instalação não abriu o token" };

  const leitura = await renovarTokenMicrosoft(app, refresh, { agora });
  if (!leitura.ok) {
    // Sem `error` do Entra é rede ou corpo ilegível: ninguém decidiu nada do lado
    // de lá, e o desfecho é transitório (sem motivo, sem status).
    const classificacao = classificarErroDaMicrosoft(leitura.erro ? { error: leitura.erro } : {}, "token");
    const situacao = estadoDaConexaoApos(classificacao.desfecho);
    if (situacao && situacao !== "healthy") {
      await marcar(db, linha, situacao, classificacao.mensagem);
      return {
        ok: false,
        situacao: situacao === "token_expired" || situacao === "scope_missing" || situacao === "error" || situacao === "rate_limited" ? situacao : null,
        motivo: classificacao.mensagem,
      };
    }
    return { ok: false, situacao: null, motivo: classificacao.mensagem };
  }

  const anterior: TokenDoGoogle = {
    access_token: "",
    refresh_token: refresh,
    scope: linha.escopos ?? [],
    token_type: "Bearer",
    expira_em: linha.token_expira_em ?? agora.toISOString(),
  };
  const fundido = fundirTokens(anterior, leitura.token);
  const faltando = escoposFaltandoMicrosoft(fundido.scope);
  if (faltando.length > 0) {
    await marcar(db, linha, "scope_missing", `faltou permissão: ${faltando.join(", ")}`);
    return { ok: false, situacao: "scope_missing", motivo: "faltou permissão" };
  }

  const accessCifrado = await encryptWebhookSecret(db, fundido.access_token);
  const refreshCifrado = fundido.refresh_token ? await encryptWebhookSecret(db, fundido.refresh_token) : null;
  if (!accessCifrado || (fundido.refresh_token && !refreshCifrado)) {
    return { ok: false, situacao: null, motivo: "a chave de cifra da instalação não está disponível" };
  }

  const { error } = await db
    .from("mia_agenda_microsoft_conexoes")
    .update({
      access_token_cifrado: accessCifrado,
      ...(refreshCifrado ? { refresh_token_cifrado: refreshCifrado } : {}),
      token_expira_em: fundido.expira_em,
      escopos: fundido.scope,
      status: "healthy",
      ultimo_erro: null,
    })
    .eq("organization_id", linha.organization_id)
    .eq("id", linha.id);
  if (error) return { ok: false, situacao: null, motivo: "não consegui gravar o token renovado" };
  return { ok: true, accessToken: fundido.access_token };
}

/**
 * O token de acesso de uma conexão, para quem vai chamar a Graph.
 *
 * Lança com frase de tela (é o que o executor grava como erro): conexão fora do
 * ar, dono fora da empresa, ou sem token.
 */
export async function tokenDaConexaoMicrosoft(
  db: SupabaseClient,
  org: string,
  conexaoId: string,
  agora: Date = new Date(),
): Promise<string> {
  const { data, error } = await db
    .from("mia_agenda_microsoft_conexoes")
    .select(COLUNAS_DA_CONEXAO)
    .eq("organization_id", org)
    .eq("id", conexaoId)
    .maybeSingle();
  const linha = data as LinhaDaConexaoMicrosoft | null;
  if (error || !linha || linha.status !== "healthy") {
    throw new Error("A conexão com o Outlook precisa de atenção nas configurações.");
  }
  const { data: membro, error: erroDoMembro } = await db
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", org)
    .eq("user_id", linha.user_id)
    .is("revoked_at", null)
    .maybeSingle();
  if (erroDoMembro || !membro) throw new Error("O responsável não possui vínculo ativo.");

  if (precisaRenovar(linha.token_expira_em, agora, 2 * 60_000)) {
    const app = await configuracaoDaMicrosoft();
    if (!app) throw new Error("A conexão com a Microsoft não está configurada nesta instalação.");
    const renovada = await renovarConexaoMicrosoft(db, linha, app, agora);
    if (renovada.ok) return renovada.accessToken;
    throw new Error("Conecte o Outlook de novo para continuar.");
  }

  const token = linha.access_token_cifrado ? await decryptWebhookSecret(db, linha.access_token_cifrado) : null;
  if (!token) throw new Error("Conecte o Outlook de novo para continuar.");
  return token;
}
