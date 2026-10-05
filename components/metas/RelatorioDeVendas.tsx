"use client";

/**
 * O RELATÓRIO DE VENDAS — quatro perguntas de gestão, em uma tela.
 *
 * O funil ao lado mostra onde os negócios ESTÃO. Isto mostra o que aconteceu:
 * quantos fecharam e em que proporção, quanto tempo levaram, por que os outros
 * se perderam, e se o mês está melhor ou pior que os anteriores.
 *
 * ── Duas decisões de leitura que a tela torna visíveis ──────────────────────
 *
 * O ciclo mostra MÉDIA e MEDIANA lado a lado. Quando as duas se afastam, é
 * porque há um negócio arrastado no meio — e a distância entre elas é a única
 * coisa na tela que conta isso.
 *
 * A evolução mostra os meses VAZIOS. Omitir mês sem venda faria a linha parecer
 * contínua e esconderia exatamente o buraco que interessa.
 */
import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useRelatorioDeVendas } from "@/hooks/useRelatorioDeVendas";
import { formatCentsBRL } from "@/lib/money";

/** Os motivos canônicos em português — o resto aparece como veio. */
const MOTIVO: Record<string, string> = {
  requested_by_customer: "O cliente pediu",
  price: "Preço",
  no_response: "Não respondeu",
  product_unavailable: "Não temos o que ele queria",
  cancelled_by_store: "Cancelado por nós",
  cancelled_by_customer: "Cancelado pelo cliente",
  payment_failed: "Pagamento falhou",
  other: "Outro",
};

function mesAtual(): string {
  return new Date().toISOString().slice(0, 7);
}

function rotuloDoMes(periodo: string, tag: string): string {
  const [ano, mes] = periodo.split("-").map(Number);
  return new Date(Date.UTC(ano!, mes! - 1, 1)).toLocaleDateString(tag, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

export function RelatorioDeVendas() {
  const t = useT();
  const tag = useTagDeIdioma();
  const [periodo, setPeriodo] = useState(mesAtual());
  const { data, isLoading, isError } = useRelatorioDeVendas(periodo);

  const maior = Math.max(1, ...(data?.historico ?? []).map((m) => m.receitaCents));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{t("Relatório de vendas")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("O que aconteceu no mês: o que fechou, o que se perdeu e por quê.")}
          </p>
        </div>
        <label className="text-xs text-muted-foreground">
          {t("Mês")}
          <input
            type="month"
            className="ml-2 h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value || mesAtual())}
          />
        </label>
      </div>

      {isLoading ? (
        <div className="h-24 animate-pulse rounded-md border" />
      ) : isError || !data ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          {t("Não consegui carregar o relatório agora.")}
        </p>
      ) : (
        <>
          {data.truncado ? (
            // A leitura foi cortada no teto de páginas da rota (do fechamento
            // mais novo para o mais antigo). Sem esta linha os números se
            // leriam como o período inteiro. Mesmo aviso do relatório por
            // etiqueta do upstream.
            <p className="text-xs text-amber-600 dark:text-amber-500" data-testid="aviso-de-corte">
              {t(
                "O período passou do limite de leitura: os números contam só os negócios fechados mais recentes.",
              )}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("Taxa de ganho")}
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {data.taxa_de_ganho.taxa === null
                  ? "—"
                  : `${Math.round(data.taxa_de_ganho.taxa * 100)}%`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.taxa_de_ganho.ganhos} {t("ganhos")} · {data.taxa_de_ganho.perdidos}{" "}
                {t("perdidos")}
              </p>
            </div>

            <div className="rounded-md border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("Ciclo de venda")}
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {data.ciclo_de_venda.medianaDias === null
                  ? "—"
                  : `${data.ciclo_de_venda.medianaDias} ${t("dias")}`}
              </p>
              {/* A média ao lado da mediana: quando se afastam, há um negócio
                  arrastado no meio, e essa distância é a informação. */}
              <p className="mt-1 text-xs text-muted-foreground">
                {data.ciclo_de_venda.mediaDias === null
                  ? t("Nenhuma venda no mês.")
                  : `${t("média")} ${data.ciclo_de_venda.mediaDias} ${t("dias")} · ${data.ciclo_de_venda.vendas} ${t("vendas")}`}
              </p>
            </div>

            <div className="rounded-md border p-4 sm:col-span-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("Receita do mês")}
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatCentsBRL(
                  data.historico.find((m) => m.periodo === periodo)?.receitaCents ?? 0,
                )}
              </p>
            </div>
          </div>

          <div className="rounded-md border p-4">
            <p className="text-sm font-medium">{t("Evolução")}</p>
            <div className="mt-3 flex items-end gap-2">
              {data.historico.map((m) => (
                <div key={m.periodo} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {m.receitaCents > 0 ? formatCentsBRL(m.receitaCents) : ""}
                  </span>
                  <div
                    className={`w-full rounded-t ${
                      m.periodo === periodo ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                    style={{ height: `${Math.max(2, (m.receitaCents / maior) * 80)}px` }}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {rotuloDoMes(m.periodo, tag)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border p-4">
            <p className="text-sm font-medium">{t("Por que perdemos")}</p>
            {data.motivos_de_perda.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {t("Nenhuma perda registrada no mês.")}
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                {/* Ordenado por VALOR: dez leads pequenos perdidos por preço e
                    um contrato grande perdido por prazo não são o mesmo
                    problema, e uma lista por contagem esconderia o segundo. */}
                {data.motivos_de_perda.map((m) => (
                  <div key={m.motivo} className="flex items-center gap-3 text-sm">
                    <span className="w-48 shrink-0 truncate">
                      {t(MOTIVO[m.motivo] ?? m.motivo)}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {m.quantidade} {m.quantidade === 1 ? t("negócio") : t("negócios")}
                    </span>
                    <span className="ml-auto tabular-nums">{formatCentsBRL(m.valorCents)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
