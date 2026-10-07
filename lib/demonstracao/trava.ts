/**
 * FORK MIA · CLIENTE MODELO — a trava da empresa de demonstração, do lado do código.
 *
 * Quem TRAVA é o banco (migration 9010, `fn_mia_trava_da_demonstracao`): cada
 * porta por onde um envio passa antes de sair recusa a empresa marcada com
 * `organizations.demonstracao`. Este módulo faz duas coisas só:
 *
 *  1. TRADUZ a recusa do banco para a tela. A recusa chega como 42501 com a
 *     mensagem começando por `organizacao_de_demonstracao:` — sem a tradução, a
 *     pessoa que clicou "Enviar" na demonstração veria um 500 genérico e
 *     concluiria que o produto quebrou;
 *  2. RESPONDE a pergunta onde não há linha para o banco recusar: o e-mail que
 *     sai sem nascer de uma tabela (o relatório LGPD ao titular, o alarme de
 *     prazo). Aí quem pergunta é o roteador de e-mail, e a resposta FALHA
 *     FECHADA: se não der para confirmar que a empresa é de verdade, o e-mail
 *     não sai.
 *
 * A ÚNICA coisa que sai de uma empresa de demonstração é o CONVITE DE EQUIPE
 * (migration 9020): ele fala com uma pessoa de verdade que quem administra
 * escolheu, e não com um contato. No banco, `team_invites` deixou de ter
 * gatilho da trava; no roteador de e-mail, só `issueInvite` pede a exceção
 * `excecaoDaTravaDaDemonstracao: "convite_de_equipe"`. A frase abaixo
 * continua valendo para todo o resto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** O código de erro da API e o `error_code` que a fila grava. */
export const CODIGO_DA_DEMONSTRACAO = "organizacao_de_demonstracao" as const;

/** A frase da tela. Curta, e diz o que fazer: nada — é uma demonstração. */
export const FRASE_DA_DEMONSTRACAO =
  "Esta é a empresa de demonstração: nenhuma mensagem, e-mail ou aviso sai daqui.";

/** O que o PostgREST/pg devolve quando o banco recusa. */
interface ErroDoBanco {
  code?: string | null;
  message?: string | null;
}

/** A recusa veio da trava da demonstração (e não de outra regra que também usa 42501)? */
export function ehRecusaDaDemonstracao(erro: ErroDoBanco | null | undefined): boolean {
  if (!erro) return false;
  return erro.code === "42501" && (erro.message ?? "").startsWith(`${CODIGO_DA_DEMONSTRACAO}:`);
}

/**
 * Sentinelas que chegam no lugar de `organization_id` e não são empresa: o
 * report e o push da PLATAFORMA saem pelo número e pelos administradores dela.
 */
const NAO_E_EMPRESA = new Set(["plataforma"]);

export type RespostaDaTrava =
  | { travado: false }
  | { travado: true; motivo: "demonstracao" | "nao_confirmado" };

/**
 * A empresa pode mandar algo para fora? Pergunta a `fn_mia_e_demonstracao`, a
 * MESMA função que os gatilhos da 9010 consultam.
 *
 * Falha fechada: erro de leitura, função ausente (schema sem a 9010) ou
 * resposta que não seja booleano → `travado`, com o motivo `nao_confirmado`
 * para o registro dizer a diferença entre "é demonstração" e "não deu para
 * saber".
 */
export async function travaDaDemonstracao(
  db: Pick<SupabaseClient, "rpc">,
  organizationId: string,
): Promise<RespostaDaTrava> {
  if (NAO_E_EMPRESA.has(organizationId)) return { travado: false };
  try {
    const { data, error } = await db.rpc("fn_mia_e_demonstracao", { p_org: organizationId });
    if (error || typeof data !== "boolean") return { travado: true, motivo: "nao_confirmado" };
    return data ? { travado: true, motivo: "demonstracao" } : { travado: false };
  } catch {
    return { travado: true, motivo: "nao_confirmado" };
  }
}
