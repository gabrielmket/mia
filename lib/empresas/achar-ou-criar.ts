/**
 * A EMPRESA QUE O CLIENTE DISSE — achar a que já existe, ou criar uma.
 *
 * O agente pergunta "de qual empresa você é?" e recebe texto livre: "Padaria do
 * Zé", "padaria do ze", "PADARIA DO ZÉ LTDA". Se cada resposta virasse uma
 * empresa nova, a entidade perderia a única coisa que a justifica — poder
 * perguntar quanto já vendemos para AQUELE cliente.
 *
 * ─── Por que o casamento é frouxo, e por que isso é seguro aqui ───────────
 *
 * A comparação ignora caixa, acento, pontuação e sufixo societário. É frouxa de
 * propósito: o custo de errar para cada lado é MUITO diferente.
 *
 *  • Frouxo demais junta duas empresas parecidas. O operador vê as duas na
 *    ficha, percebe, e separa — o histórico está todo lá.
 *  • Rígido demais cria "Padaria do Zé" pela quinta vez. Ninguém percebe,
 *    porque cinco fichas com uma conversa cada parecem cinco clientes — e a
 *    pergunta agregada passa a responder errado para sempre.
 *
 * ⚠️ O que NÃO se faz aqui: casar por CNPJ. O cliente não dita CNPJ numa
 * conversa de WhatsApp, e um número mal ouvido pelo modelo viraria vínculo
 * errado com aparência de precisão.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Sufixos societários que não distinguem uma empresa de outra. */
const SUFIXOS = /\b(ltda|me|epp|eireli|sa|s\/a|s\.a|mei|cia|e cia)\b/g;

/**
 * A forma comparável do nome. NÃO é o que se guarda: a empresa fica com o nome
 * como a pessoa escreveu — normalizar o que se mostra faria a ficha exibir
 * "padaria do ze" para quem digitou direito.
 */
export function nomeComparavel(nome: string): string {
  const limpo = nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(SUFIXOS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  /**
   * Letras soltas em sequência viram uma palavra só: `j h s` → `jhs`.
   *
   * É o que faz "J.H.S. Biomateriais" e "JHS Biomateriais" serem a mesma
   * empresa — e sigla pontuada é comum em razão social brasileira, enquanto o
   * agente ouve a sigla e digita sem ponto. Sem isto, o mesmo cliente vira duas
   * fichas por causa de três pontos.
   */
  return limpo
    .split(" ")
    .reduce<string[]>((tokens, palavra) => {
      const anterior = tokens[tokens.length - 1];
      if (palavra.length === 1 && anterior !== undefined && anterior.length <= 3 && /^[a-z]+$/.test(anterior)) {
        tokens[tokens.length - 1] = anterior + palavra;
        return tokens;
      }
      tokens.push(palavra);
      return tokens;
    }, [])
    .join(" ")
    .trim();
}

export type ResultadoDaEmpresa =
  | { ok: true; empresaId: string; criada: boolean; nome: string }
  | { ok: false; motivo: "nome_curto" | "erro"; detalhe?: string };

export async function acharOuCriarEmpresa(
  db: SupabaseClient,
  organizationId: string,
  nomeDito: string,
): Promise<ResultadoDaEmpresa> {
  const nome = nomeDito.trim();
  const comparavel = nomeComparavel(nome);
  /**
   * Nome de uma letra ou dois caracteres não identifica empresa nenhuma, e
   * viraria uma ficha que ninguém consegue procurar depois. Recusar é melhor
   * que criar lixo que o operador terá de limpar sem saber de onde veio.
   */
  if (comparavel.length < 3) return { ok: false, motivo: "nome_curto" };

  try {
    // Lê a lista da organização e compara em memória: a normalização (acento,
    // sufixo societário) não existe em SQL sem `unaccent`, e a lista de
    // empresas de um tenant é pequena — quem tiver dez mil pede um índice
    // funcional, não um `ilike` que erraria justamente nos acentuados.
    const { data, error } = await db
      .from("crm_empresas")
      .select("id, nome")
      .eq("organization_id", organizationId)
      .limit(5_000);
    if (error) return { ok: false, motivo: "erro", detalhe: error.message };

    const existente = (data ?? []).find(
      (e) => nomeComparavel((e as { nome: string }).nome) === comparavel,
    );
    if (existente) {
      const linha = existente as { id: string; nome: string };
      return { ok: true, empresaId: linha.id, criada: false, nome: linha.nome };
    }

    const { data: nova, error: erroInsert } = await db
      .from("crm_empresas")
      // O nome vai como a pessoa DISSE. O comparável serve para achar, não para
      // guardar.
      .insert({ organization_id: organizationId, nome })
      .select("id, nome")
      .single();
    if (erroInsert) return { ok: false, motivo: "erro", detalhe: erroInsert.message };

    const linha = nova as { id: string; nome: string };
    return { ok: true, empresaId: linha.id, criada: true, nome: linha.nome };
  } catch (err) {
    return {
      ok: false,
      motivo: "erro",
      detalhe: err instanceof Error ? err.message : "erro",
    };
  }
}
