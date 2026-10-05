"use client";

/**
 * A META DO MÊS, e o quanto dela já foi feito.
 *
 * O que esta tela evita: a planilha paralela de fim de mês. Ela responde três
 * perguntas que hoje vivem fora do sistema — quanto falta para a meta da casa,
 * quanto cada pessoa fez, e quanto da receita nasceu do trabalho de quem
 * ORIGINOU (a participação do SDR numa venda fechada por outra pessoa).
 *
 * O progresso é derivado na leitura, das mesmas linhas do funil e da agenda:
 * se a venda existe, ela conta. Não há número guardado para divergir.
 */
import { useState } from "react";

import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useMetas } from "@/hooks/useMetas";
import { usePermission } from "@/hooks/auth/AuthProvider";
import { DefinirMeta } from "./DefinirMeta";
import type { ProgressoDaMeta } from "@/lib/crm/metas/progresso";

const ROTULO: Record<ProgressoDaMeta["metrica"], string> = {
  reunioes: "Reuniões marcadas",
  reunioes_realizadas: "Reuniões realizadas",
  receita_total: "Receita total",
  receita_recorrente: "Receita recorrente",
  receita_avulsa: "Receita avulsa",
  receita_originada: "Receita originada",
};

function mesAtual(): string {
  return new Date().toISOString().slice(0, 7);
}

function reais(cents: number, tag: string): string {
  return (cents / 100).toLocaleString(tag, { style: "currency", currency: "BRL" });
}

function Barra({ fracao }: { fracao: number }) {
  const pct = Math.min(100, Math.round(fracao * 100));
  // Passar de 100% é vitória, e a barra para de crescer mas muda de cor: uma
  // barra que estoura o quadro vira ruído visual, e o número ao lado já diz.
  const cor = fracao >= 1 ? "bg-emerald-500" : fracao >= 0.7 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="h-2 w-full overflow-hidden rounded-md bg-muted">
      <div className={`h-full ${cor}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function LinhaDaMeta({ meta }: { meta: ProgressoDaMeta }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const ehContagem = meta.metrica === "reunioes";
  const mostrar = (v: number) => (ehContagem ? String(v) : reais(v, tag));

  return (
    <div className="space-y-2 rounded-md border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{t(ROTULO[meta.metrica])}</p>
        <p className="text-sm tabular-nums">
          <span className="font-semibold">{mostrar(meta.realizado)}</span>
          <span className="text-muted-foreground"> / {mostrar(meta.alvo)}</span>
        </p>
      </div>
      <Barra fracao={meta.fracao} />
      <p className="text-xs text-muted-foreground">
        {meta.falta > 0
          ? `${t("faltam")} ${mostrar(meta.falta)} · ${Math.round(meta.fracao * 100)}%`
          : t("meta batida")}
      </p>
    </div>
  );
}

export function PainelDeMetas() {
  const t = useT();
  const tag = useTagDeIdioma();
  const [periodo, setPeriodo] = useState(mesAtual());
  const { data, isLoading, isError } = useMetas(periodo);
  // A mesma régua da rota (spec 13 §4: gestão é manager+).
  const podeDefinir = usePermission("metas.definir");

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{t("Metas do mês")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("O quanto já foi feito sai do próprio funil e da agenda — não é digitado.")}
          </p>
        </div>
        <div className="flex items-end gap-3">
          {/* Definir meta é decisão de gestão (a rota exige manager+). Oferecer
              o botão a quem levaria 403 é prometer o que não se cumpre. */}
          {podeDefinir ? <DefinirMeta periodo={periodo} /> : null}
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
      </div>

      {isLoading ? (
        <div className="h-24 animate-pulse rounded-md border" />
      ) : isError || !data ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          {t("Não consegui carregar as metas agora.")}
        </p>
      ) : (
        <>
          {data.truncado ? (
            // A leitura do mês foi cortada no teto de páginas da rota. Sem esta
            // linha a barra da meta e o fechamento se leriam como o mês inteiro.
            // Mesmo aviso do relatório por etiqueta do upstream.
            <p className="text-xs text-amber-600 dark:text-amber-500" data-testid="aviso-de-corte">
              {t(
                "O mês passou do limite de leitura: os números contam só as vendas e as reuniões mais recentes.",
              )}
            </p>
          ) : null}
          {data.metas.length === 0 ? (
            <p className="rounded-md border p-4 text-sm text-muted-foreground">
              {podeDefinir
                ? t(
                    "Nenhuma meta definida para este mês. Use \"Definir meta\" acima — o acompanhamento aparece aqui na hora.",
                  )
                : t(
                    "Nenhuma meta definida para este mês. Quem define é quem gerencia, e o acompanhamento aparece aqui na hora.",
                  )}
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {data.metas.map((m) => (
                <LinhaDaMeta key={m.id} meta={m} />
              ))}
            </div>
          )}

          {/* O fechamento do mês, que vale mesmo sem meta definida. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("Recorrente")}
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {reais(data.resumo.recorrente, tag)}
              </p>
              {data.resumo.contratoRecorrenteCents > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {reais(data.resumo.contratoRecorrenteCents, tag)} {t("em contrato")}
                </p>
              ) : null}
            </div>
            <div className="rounded-md border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("Avulso")}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {reais(data.resumo.avulso, tag)}
              </p>
            </div>
            <div className="rounded-md border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("Total")}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {reais(data.resumo.total, tag)}
              </p>
            </div>
            <div className="rounded-md border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("Reuniões marcadas")}
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{data.reunioes.marcadas}</p>
              {/* Marcar e comparecer são medidas diferentes, e o número que
                  falta aparecer é sempre o segundo: o dado do desfecho já era
                  gravado pela Agenda e não era somado em lugar nenhum. */}
              <p className="mt-1 text-xs text-muted-foreground">
                {data.reunioes.realizadas} {t("realizadas")} · {data.reunioes.faltas}{" "}
                {t("faltas")}
                {data.reunioes.sem_desfecho > 0
                  ? ` · ${data.reunioes.sem_desfecho} ${t("sem desfecho")}`
                  : ""}
              </p>
            </div>
            <div className="rounded-md border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("Comparecimento")}
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {/* NULO não é zero: zero se leria como "ninguém apareceu", e o
                    que houve foi nenhuma reunião ter chegado ao fim ainda. */}
                {data.reunioes.taxa_de_comparecimento === null
                  ? "—"
                  : `${Math.round(data.reunioes.taxa_de_comparecimento * 100)}%`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.reunioes.taxa_de_comparecimento === null
                  ? t("Nenhuma reunião com desfecho ainda.")
                  : t("Das reuniões que já aconteceram ou faltaram.")}
              </p>
            </div>
          </div>

          {data.resumo.vendasSemClassificacao > 0 ? (
            // Sem esta linha, a soma de recorrente + avulso pareceria o total — e
            // a diferença seria um buraco silencioso no relatório.
            <p className="text-xs text-amber-600 dark:text-amber-500">
              {data.resumo.vendasSemClassificacao}{" "}
              {t(
                "venda(s) ganhas sem natureza declarada: elas entram no total, mas não em recorrente nem em avulso.",
              )}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
