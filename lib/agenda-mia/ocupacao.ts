/**
 * A ocupação do Outlook para os leitores da agenda do upstream.
 *
 * O motor de horários livres (`coletaOQueOcupa`, em `lib/agenda/consulta.ts`) e
 * a grade (`lerOcupacaoExterna`, em `lib/agenda/ocupacao-externa.ts`) perguntam
 * ao Google por `fn_agenda_ocupacao_google_do_dono`. As nossas funções devolvem
 * AS MESMAS colunas (migration 9011), e estes helpers entregam as linhas no
 * formato dele: quem chama só concatena. É o único ponto de ligação da
 * ocupação no código do upstream (docs/fork/agenda-microsoft.md, 3.4).
 *
 * ─── Por que a exceção vira lista vazia, e o erro do banco não ─────────────
 *
 * O `supabase-js` NÃO lança em erro de banco: devolve `{ error }`. Esse erro
 * sobe igual ao do Google (sem saber o que ocupa, não se oferece horário). O que
 * LANÇA é o dublê dos testes do upstream, que recusa rpc que ele não previu: ali
 * a ausência da Microsoft é o estado certo, e derrubar a suíte dele por isso
 * seria acoplar os testes dele ao nosso módulo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface LinhaDeOcupacaoExterna {
  starts_at: string;
  ends_at: string;
  transparency: string;
  status: string;
  connection_status: string | null;
}

export interface LinhaDeConexaoExterna {
  status: string;
  last_sync_at: string | null;
}

async function rpcSeguro<T>(
  supabase: SupabaseClient,
  nome: string,
  args: Record<string, unknown>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  try {
    const { data, error } = await supabase.rpc(nome, args as never);
    return { data: (data ?? null) as T | null, error: error ? { message: error.message } : null };
  } catch {
    return { data: null, error: null };
  }
}

/** A ocupação do Outlook de um dono, com as colunas de `fn_agenda_ocupacao_google_do_dono`. */
export async function ocupacaoMicrosoftDoDono(
  supabase: SupabaseClient,
  args: { p_org: string; p_owner: string; p_de: string; p_ate: string },
): Promise<{ linhas: LinhaDeOcupacaoExterna[]; error: { message: string } | null }> {
  const { data, error } = await rpcSeguro<LinhaDeOcupacaoExterna[]>(
    supabase,
    "fn_mia_agenda_ocupacao_microsoft_do_dono",
    args,
  );
  return { linhas: Array.isArray(data) ? data : [], error };
}

/** A situação das contas Microsoft de um dono, com as colunas de `fn_agenda_conexoes_google_do_dono`. */
export async function conexoesMicrosoftDoDono(
  supabase: SupabaseClient,
  args: { p_org: string; p_owner: string },
): Promise<LinhaDeConexaoExterna[]> {
  const { data } = await rpcSeguro<LinhaDeConexaoExterna[]>(
    supabase,
    "fn_mia_agenda_conexoes_microsoft_do_dono",
    args,
  );
  return Array.isArray(data) ? data : [];
}

/**
 * Alguma agenda do Outlook do dono não foi lida por inteiro e recentemente no
 * período? Leitura incerta não afirma cobertura: erro vira `true`, como o
 * `googleCoberturaParcial` do upstream.
 */
export async function coberturaMicrosoftParcial(
  supabase: SupabaseClient,
  args: { p_org: string; p_owner: string; p_start: string; p_end: string },
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("fn_mia_agenda_cobertura_microsoft", args as never);
    if (error) return true;
    return Boolean(data);
  } catch {
    // O dublê dos testes do upstream: sem Microsoft, nada a cobrir.
    return false;
  }
}
