/**
 * FORK MIA — "VEIO DA CONVERSA": o campo do negócio que a IA preencheu e
 * ninguém confirmou ainda.
 *
 * A marca sai da linha do tempo, sem coluna nova: toda edição do negócio grava
 * `lead_edited` com o ATOR (humano, IA, sistema), e a partir do cartão aberto
 * ela passa a dizer também QUAIS campos personalizados mudaram
 * (`payload.custom_field_keys`, calculado aqui e gravado pelo `updateLeadHandler`
 * do upstream). Para cada campo vale a ÚLTIMA palavra: se foi da IA, o campo veio
 * da conversa; se foi de uma pessoa (edição ou "Confirmar"), está confirmado.
 *
 * Edição anterior a esta versão não diz quais campos mudou: esses campos ficam
 * sem marca — a tela não inventa autoria que não foi registrada.
 */

function igual(a: unknown, b: unknown): boolean {
  const vazio = (v: unknown) => v === null || v === undefined || v === "";
  if (vazio(a) && vazio(b)) return true;
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/** As chaves de `custom_fields` cujo valor mudou entre o antes e o depois. */
export function chavesPersonalizadasAlteradas(depois: unknown, antes: unknown): string[] {
  const d = depois && typeof depois === "object" && !Array.isArray(depois) ? (depois as Record<string, unknown>) : {};
  const a = antes && typeof antes === "object" && !Array.isArray(antes) ? (antes as Record<string, unknown>) : {};
  return [...new Set([...Object.keys(d), ...Object.keys(a)])].filter((k) => !igual(d[k], a[k])).sort();
}

export interface OrigemDoCampo {
  /** A última palavra foi da IA e ninguém confirmou. */
  veioDaConversa: boolean;
  em: string;
}

/**
 * Para cada chave, quem falou por último. As atividades podem vir em qualquer
 * ordem; só `lead_edited` com `custom_field_keys` conta.
 */
export function origemDosCampos(
  atividades: Array<{
    type: string;
    performed_at: string;
    actor_kind?: string | null;
    payload?: Record<string, unknown> | null;
  }>,
): Map<string, OrigemDoCampo> {
  const ordenadas = [...atividades]
    .filter((a) => a.type === "lead_edited" && Array.isArray(a.payload?.custom_field_keys))
    .sort((x, y) => new Date(x.performed_at).getTime() - new Date(y.performed_at).getTime());
  const saida = new Map<string, OrigemDoCampo>();
  for (const a of ordenadas) {
    for (const chave of a.payload!.custom_field_keys as unknown[]) {
      if (typeof chave !== "string") continue;
      saida.set(chave, { veioDaConversa: a.actor_kind === "ai", em: a.performed_at });
    }
  }
  return saida;
}
