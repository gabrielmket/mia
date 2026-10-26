/**
 * FORK MIA (.91) — O RETRATO DO "O QUE FALTA" (9081): "ao entrar faltavam N,
 * agora faltam M", e o dia em que a empresa zerou.
 *
 * Um retrato por rodada, mas só quando algo mudou desde o último: abrir o
 * Início dez vezes no mesmo dia não vira dez linhas. Quem grava é a sessão do
 * administrador (a RLS da 9081): o retrato é a régua dele, que enxerga a
 * empresa inteira. O gestor lê a evolução e não grava a dele.
 *
 * Sem dado pessoal: só a chave e a coluna de cada item.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { RotuloDoCliente } from "@/lib/mcp-plataforma/checklist/rotulo-do-cliente";

export interface Evolucao {
  /** Quantos faltavam no primeiro retrato (ao entrar). `null` = ainda não há retrato. */
  ao_entrar: number | null;
  ao_entrar_em: string | null;
  /** O último retrato guardado. */
  ultimo: number | null;
  /** A empresa já teve uma rodada sem nada faltando: o bloco sai do Início. */
  zerou: boolean;
  zerou_em: string | null;
}

interface LinhaDoRetrato {
  faltam: number;
  rodada_em: string;
  itens: Array<{ chave: string; coluna: string }> | null;
  nao_se_aplica: number;
}

export async function lerEvolucao(db: SupabaseClient, organizationId: string): Promise<Evolucao> {
  const [primeiro, ultimo, zero] = await Promise.all([
    db
      .from("mia_assistente_retratos")
      .select("faltam, rodada_em")
      .eq("organization_id", organizationId)
      .order("rodada_em", { ascending: true })
      .limit(1)
      .maybeSingle(),
    db
      .from("mia_assistente_retratos")
      .select("faltam, rodada_em")
      .eq("organization_id", organizationId)
      .order("rodada_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("mia_assistente_retratos")
      .select("rodada_em")
      .eq("organization_id", organizationId)
      .eq("faltam", 0)
      .order("rodada_em", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  const p = primeiro.data as { faltam: number; rodada_em: string } | null;
  const u = ultimo.data as { faltam: number; rodada_em: string } | null;
  const z = zero.data as { rodada_em: string } | null;
  return {
    ao_entrar: p?.faltam ?? null,
    ao_entrar_em: p?.rodada_em ?? null,
    ultimo: u?.faltam ?? null,
    zerou: Boolean(z),
    zerou_em: z?.rodada_em ?? null,
  };
}

/** A assinatura de um rótulo: o que precisa mudar para valer um retrato novo. */
export function assinaturaDoRotulo(itens: ReadonlyArray<{ chave: string; coluna: string }>, naoSeAplica: number): string {
  return `${[...itens].map((i) => `${i.chave}:${i.coluna}`).sort().join("|")}#${naoSeAplica}`;
}

/**
 * Guarda o retrato desta rodada, se algo mudou. Devolve se gravou. Nunca lança:
 * o retrato é a evolução, e não poder gravá-lo não tira o "o que falta" da tela.
 */
export async function guardarRetrato(
  db: SupabaseClient,
  entrada: { organizationId: string; rotulo: RotuloDoCliente; origem: "tela" | "assistente" },
): Promise<boolean> {
  try {
    const itens = entrada.rotulo.itens.map((i) => ({ chave: i.chave, coluna: i.coluna }));
    const c = entrada.rotulo.contas;
    const { data: anterior } = await db
      .from("mia_assistente_retratos")
      .select("faltam, rodada_em, itens, nao_se_aplica")
      .eq("organization_id", entrada.organizationId)
      .order("rodada_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    const ultimo = anterior as LinhaDoRetrato | null;
    if (ultimo && assinaturaDoRotulo(ultimo.itens ?? [], ultimo.nao_se_aplica) === assinaturaDoRotulo(itens, c.nao_se_aplica)) {
      return false;
    }
    const { error } = await db.from("mia_assistente_retratos").insert({
      organization_id: entrada.organizationId,
      faltam: c.faltam,
      total: c.total,
      preenchido: c.preenchido,
      posso_completar: c.posso_completar,
      preciso_confirmar: c.preciso_confirmar,
      nao_se_aplica: c.nao_se_aplica,
      itens,
      origem: entrada.origem,
    });
    return !error;
  } catch {
    return false;
  }
}
