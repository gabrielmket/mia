"use client";
/**
 * FORK MIA (item 8) — a tela da ANÁLISE DO FUNIL, por cima de
 * `GET /api/v1/metrics/funil` (upstream #1750, `lib/metrics/funil.ts`).
 *
 * Três respostas, na ordem em que o gestor pergunta:
 *
 *  1. Quantos passam de cada etapa para a seguinte (entraram, passaram, taxa
 *     com a amostra; saltos e retrocessos à parte, como a conta os separa).
 *  2. Quanto tempo do primeiro contato ao fechamento (mediana e quartis, só
 *     ganhos — a régua da conta: média puxada por um negócio parado mente).
 *  3. De que origem vêm os que fecham (origem × situação, valor por moeda).
 *
 * E a contra-métrica no mesmo corpo (doutrina §3.3): turnos até o desfecho e
 * opt-outs, os custos de empurrar a conversão.
 *
 * O período é de 7, 30 ou 90 dias até agora; a rota lê no máximo 5 páginas de
 * cada tabela e diz `truncado` quando o teto chega, e a tela repete o aviso.
 */
import Link from "next/link";
import { useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { useAnaliseDoFunil } from "@/hooks/metrics/useAnaliseDoFunil";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { formatValorDoNegocio } from "@/lib/money";
import { ROTULO_DA_ORIGEM } from "@/lib/paineis/catalogo";

const JANELAS = [
  { dias: 7, rotulo: "7 dias" },
  { dias: 30, rotulo: "30 dias" },
  { dias: 90, rotulo: "90 dias" },
] as const;

const ROTULO_DO_STATUS: Record<string, string> = {
  won: "Ganhos",
  lost: "Perdidos",
  open: "Abertos",
};

export function AnaliseDoFunilClient() {
  const t = useT();
  const tag = tagDeIdioma(useIdioma());
  const [dias, setDias] = useState<number>(30);
  const janela = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - dias * 86_400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [dias]);
  const { data, isLoading, isError, refetch } = useAnaliseDoFunil(janela);
  const r = data?.data;

  const numero = (n: number | null | undefined, casas = 0) =>
    n === null || n === undefined ? "—" : new Intl.NumberFormat(tag, { maximumFractionDigits: casas }).format(n);
  const taxa = (x: number | null) => (x === null ? "—" : `${numero(x * 100)}%`);

  const funis = useMemo(() => {
    const porFunil = new Map<string, NonNullable<typeof r>["conversao"]["etapas"]>();
    for (const linha of r?.conversao.etapas ?? []) {
      const lista = porFunil.get(linha.funil) ?? [];
      lista.push(linha);
      porFunil.set(linha.funil, lista);
    }
    return [...porFunil.entries()];
  }, [r]);

  return (
    <div className="flex h-full flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Análise do funil")}</h1>
          <p className="text-sm text-text-muted">
            {t("Quantos passam de cada etapa, em quanto tempo fecham e de onde vêm os que fecham.")}
          </p>
        </div>
        <Link
          href="/app/paineis"
          className="inline-flex min-h-11 items-center self-start rounded-sm border border-border px-4 text-sm font-medium hover:bg-surface-elevated lg:min-h-9"
        >
          {t("Voltar aos painéis")}
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("Período")}>
        <span className="text-sm text-text-muted">{t("Período")}</span>
        {JANELAS.map((j) => (
          <button
            key={j.dias}
            type="button"
            aria-pressed={dias === j.dias}
            onClick={() => setDias(j.dias)}
            className={
              dias === j.dias
                ? "inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-base text-primary-foreground lg:min-h-8 lg:text-sm"
                : "inline-flex min-h-11 items-center rounded-full border border-border px-4 text-base hover:bg-surface-elevated lg:min-h-8 lg:text-sm"
            }
          >
            {t(j.rotulo)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label={t("Carregando a análise do funil")}>
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : isError || !r ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-text-muted">{t("Não consegui carregar a análise do funil.")}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 text-sm font-medium lg:min-h-9"
          >
            {t("Tentar de novo")}
          </button>
        </div>
      ) : (
        <>
          {r.truncado ? (
            <p className="rounded-md bg-warning-bg p-3 text-sm text-warning-fg">
              {t("O período tem mais registros do que a análise lê de uma vez: os números contam os mais recentes.")}
            </p>
          ) : null}
          {r.vazio ? <p className="text-sm text-text-muted">{t("Nada no período.")}</p> : null}

          {funis.map(([funil, etapas]) => (
            <Card key={funil}>
              <CardHeader className="p-4 pb-2">
                <CardTitle>
                  {t("Conversão etapa a etapa")} · {funil}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 p-4 pt-2">
                {etapas.map((e) => (
                  <div key={e.etapa.id} className="flex flex-col gap-1 border-b border-border pb-2 last:border-b-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium">{e.etapa.nome}</span>
                      <span className="tabular-nums text-text-muted">
                        {numero(e.entraram)} {t("entraram")}
                        {e.proxima ? ` · ${numero(e.passaram)} ${t("passaram para")} ${e.proxima.nome} · ${taxa(e.taxa)}` : ""}
                      </span>
                    </div>
                    {e.proxima && e.taxa !== null ? (
                      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, e.taxa * 100)}%` }} />
                      </div>
                    ) : null}
                    {e.desvios > 0 || e.saidas_sem_entrada_na_janela > 0 ? (
                      <span className="text-xs text-text-muted">
                        {e.desvios > 0 ? `${numero(e.desvios)} ${t("saltaram ou voltaram de etapa")}` : ""}
                        {e.desvios > 0 && e.saidas_sem_entrada_na_janela > 0 ? " · " : ""}
                        {e.saidas_sem_entrada_na_janela > 0
                          ? `${numero(e.saidas_sem_entrada_na_janela)} ${t("já estavam aqui antes do período")}`
                          : ""}
                      </span>
                    ) : null}
                  </div>
                ))}
                <p className="text-xs text-text-muted">
                  {t("A taxa é dos que entraram na etapa dentro do período e passaram para a seguinte.")}
                </p>
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle>{t("Do primeiro contato ao fechamento")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 p-4 pt-2">
              <dl className="grid grid-cols-3 gap-2">
                <div className="flex flex-col rounded-md bg-surface-elevated p-2">
                  <dt className="text-xs text-text-muted">{t("Metade fecha em até")}</dt>
                  <dd className="text-base font-semibold tabular-nums">
                    {numero(r.dias_ate_fechar.mediana, 1)} {t("dias")}
                  </dd>
                </div>
                <div className="flex flex-col rounded-md bg-surface-elevated p-2">
                  <dt className="text-xs text-text-muted">{t("1 em 4 fecha em até")}</dt>
                  <dd className="text-base font-semibold tabular-nums">
                    {numero(r.dias_ate_fechar.p25, 1)} {t("dias")}
                  </dd>
                </div>
                <div className="flex flex-col rounded-md bg-surface-elevated p-2">
                  <dt className="text-xs text-text-muted">{t("3 em 4 fecham em até")}</dt>
                  <dd className="text-base font-semibold tabular-nums">
                    {numero(r.dias_ate_fechar.p75, 1)} {t("dias")}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-text-muted">
                {numero(r.dias_ate_fechar.amostra)} {t("negócio(s) ganho(s) no período. Abertos e perdidos ficam de fora.")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle>{t("De onde vêm os que fecham")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 p-4 pt-2">
              {r.origem.linhas.length === 0 ? (
                <p className="text-sm text-text-muted">{t("Nada no período.")}</p>
              ) : (
                r.origem.linhas.map((l) => (
                  <div key={`${l.origem}-${l.status}`} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span>
                      {l.origem === "sem origem" ? t("Sem origem") : ROTULO_DA_ORIGEM[l.origem] ? t(ROTULO_DA_ORIGEM[l.origem] as string) : l.origem}{" "}
                      · {t(ROTULO_DO_STATUS[l.status] ?? l.status)}
                    </span>
                    <span className="tabular-nums text-text-muted">
                      {numero(l.quantidade)}
                      {l.por_moeda
                        .filter((m) => m.moeda.length === 3)
                        .map((m) => ` · ${formatValorDoNegocio(m.valor_cents, m.moeda, { semCentavos: true })}`)
                        .join("")}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {r.contra_metrica ? (
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle>{t("O custo de empurrar a conversão")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 p-4 pt-2 text-sm">
                <p>
                  {t("Mensagens até o desfecho (metade / 9 em 10):")} {numero(r.contra_metrica.turnos?.p50 ?? null)} /{" "}
                  {numero(r.contra_metrica.turnos?.p90 ?? null)}
                </p>
                <p>
                  {t("Pediram para não receber mais mensagens:")} {numero(r.contra_metrica.opt_outs?.quantidade ?? null)}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
