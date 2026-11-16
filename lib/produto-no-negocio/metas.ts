/**
 * FORK MIA (.109) · o funil sem valor recorrente conta como avulso nas metas
 * (decisão 2 do protótipo aprovado, docs/fork/produto-no-negocio.md).
 *
 * Com "Mostrar valor recorrente" desligado, o funil esconde o Valor recorrente,
 * a Duração e o Tipo de receita. Numa clínica, "Recorrente (mensalidade)"
 * confunde do mesmo jeito que o valor recorrente, e o que se vende ali é avulso.
 * Então, nas metas e no relatório de vendas, a venda desse funil vale como
 * AVULSO: o valor único inteiro vai para o lado do avulso, e o que tiver ficado
 * gravado no recorrente não entra (o campo não aparece, e o negócio que tem
 * valor ali mostra o aviso para corrigir). Nada é regravado: é só leitura.
 */
import { mostrarValorRecorrente } from "./funil";

export function funisSemRecorrente(
  funis: ReadonlyArray<{ id: string; settings: unknown }> | null | undefined,
): ReadonlySet<string> {
  return new Set((funis ?? []).filter((f) => !mostrarValorRecorrente(f.settings)).map((f) => f.id));
}

interface VendaComRecorrencia {
  pipeline_id: string;
  revenue_kind: "recorrente" | "avulso" | null;
  recurring_value_cents?: number | null;
  recurring_months?: number | null;
}

/** As vendas, com as dos funis sem recorrente lidas como avulso. */
export function contarComoAvulso<T extends VendaComRecorrencia>(vendas: readonly T[], semRecorrente: ReadonlySet<string>): T[] {
  if (semRecorrente.size === 0) return [...vendas];
  return vendas.map((v) =>
    semRecorrente.has(v.pipeline_id)
      ? { ...v, revenue_kind: "avulso", recurring_value_cents: null, recurring_months: null }
      : v,
  );
}
