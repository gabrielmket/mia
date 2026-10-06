"use client";

/**
 * SALDO DA CONTA DO PROVEDOR — e os lançamentos que o explicam.
 *
 * Quando o crédito acaba, a chave continua válida e a chamada volta recusada: o
 * sintoma chega como "a IA parou de responder", e ninguém liga uma coisa à
 * outra. Esta seção existe para esse dia não chegar de surpresa.
 *
 * O saldo não é digitado: é derivado da última LEITURA (o valor que estava na
 * conta do provedor num instante), mais as RECARGAS depois dela, menos o consumo
 * medido desde então. Por isso ele cai sozinho enquanto os agentes trabalham, e
 * uma leitura nova reancora tudo — inclusive o erro acumulado da nossa medição.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import {
  useAiSaldo,
  useApagarLancamento,
  useDefinirCotacao,
  useLancarSaldo,
  type SaldoDoProvedor as Saldo,
} from "@/hooks/useAiSaldo";

/** O provedor cobra em dólar; o formato do NÚMERO segue o idioma de quem lê. */
function usd(v: number, tag: string): string {
  return v.toLocaleString(tag, { style: "currency", currency: "USD" });
}

function brl(v: number, taxa: number, tag: string): string {
  return (v * taxa).toLocaleString(tag, { style: "currency", currency: "BRL" });
}

function dia(iso: string, tag: string): string {
  return new Date(iso).toLocaleDateString(tag);
}

function Cartao({
  titulo,
  valor,
  detalhe,
  alerta,
}: {
  titulo: string;
  valor: string;
  detalhe: string;
  alerta?: boolean;
}) {
  return (
    <div className={`rounded-md border p-4 ${alerta ? "border-amber-500/60" : ""}`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${alerta ? "text-amber-600 dark:text-amber-500" : ""}`}
      >
        {valor}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>
    </div>
  );
}

function Cartoes({ s }: { s: Saldo }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const taxa = s.cotacao?.usd_brl ?? null;
  // Uma semana é o aviso que ainda dá tempo de agir sem correria.
  const acabaCedo = s.dias_restantes !== null && s.dias_restantes <= 7;

  return (
    <>
    {s.consumo_parcial ? (
      // O consumo somado não cobre o período inteiro: sem esta linha o saldo se
      // leria como o saldo, e ele está acima do real.
      <p className="text-sm text-amber-600 dark:text-amber-500" data-testid="aviso-de-corte">
        {t("O consumo passou do limite de leitura: a conta inclui só as chamadas mais recentes, e o saldo real é menor que o mostrado.")}
      </p>
    ) : s.ritmo_parcial ? (
      // O saldo está certo, mas os 30 dias da média não couberam: o "dura até"
      // sai tarde demais, e é ele que diz quando recarregar.
      <p className="text-sm text-amber-600 dark:text-amber-500" data-testid="aviso-de-corte">
        {t("O ritmo dos últimos 30 dias passou do limite de leitura: a média diária está subestimada, e o crédito acaba antes da data mostrada.")}
      </p>
    ) : null}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Cartao
        titulo={t("Saldo estimado")}
        valor={s.saldo_usd === null ? "—" : usd(s.saldo_usd, tag)}
        detalhe={
          s.saldo_usd === null
            ? t("registre uma leitura de saldo para começar")
            : taxa
              ? `${brl(s.saldo_usd, taxa, tag)} · ${t("na cotação registrada")}`
              : t("conta do provedor")
        }
        alerta={acabaCedo}
      />
      <Cartao
        titulo={t("Última leitura")}
        valor={s.leitura ? usd(s.leitura.amount_usd, tag) : "—"}
        detalhe={
          s.leitura
            ? `${t("conferida em")} ${dia(s.leitura.occurred_at, tag)}`
            : t("nenhuma leitura registrada")
        }
      />
      <Cartao
        titulo={t("Consumido desde então")}
        valor={usd(s.consumo_desde_leitura_usd, tag)}
        detalhe={
          s.recargas_desde_leitura_usd > 0
            ? `${usd(s.recargas_desde_leitura_usd, tag)} ${t("recarregados depois")}`
            : t("medido pelas chamadas do período")
        }
      />
      <Cartao
        titulo={t("Dura até")}
        valor={s.dura_ate ? dia(s.dura_ate, tag) : "—"}
        detalhe={
          s.dias_restantes === null
            ? t("sem ritmo medido nos últimos 30 dias")
            : `${usd(s.media_diaria_usd, tag)}/${t("dia")} · ${Math.floor(s.dias_restantes)} ${t("dia(s)")}`
        }
        alerta={acabaCedo}
      />
    </div>
    </>
  );
}

function Formulario() {
  const t = useT();
  const lancar = useLancarSaldo();
  const [tipo, setTipo] = useState<"recarga" | "leitura">("recarga");
  const [valor, setValor] = useState("");
  const [quando, setQuando] = useState("");
  const [reais, setReais] = useState("");
  const [nota, setNota] = useState("");

  const numero = Number(valor.replace(",", "."));
  const valido = Number.isFinite(numero) && numero >= 0 && valor.trim() !== "";

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-md border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valido) return;
        lancar.mutate(
          {
            tipo,
            amount_usd: numero,
            ...(quando ? { occurred_at: new Date(quando).toISOString() } : {}),
            // Só em recarga: é o par (reais que saíram, dólares que entraram)
            // que revela IOF e spread sem ninguém estimar percentual.
            ...(tipo === "recarga" && Number(reais.replace(",", ".")) > 0
              ? { amount_brl: Number(reais.replace(",", ".")) }
              : {}),
            ...(nota.trim() ? { note: nota.trim() } : {}),
          },
          {
            onSuccess: () => {
              setValor("");
              setReais("");
              setNota("");
              setQuando("");
            },
          },
        );
      }}
    >
      <div className="space-y-1">
        <label className="block text-xs text-muted-foreground" htmlFor="saldo-tipo">
          {t("Tipo")}
        </label>
        <select
          id="saldo-tipo"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as "recarga" | "leitura")}
        >
          <option value="recarga">{t("Recarga (crédito que entrou)")}</option>
          <option value="leitura">{t("Leitura (saldo conferido na conta)")}</option>
        </select>
      </div>
      <div className="space-y-1">
        <label className="block text-xs text-muted-foreground" htmlFor="saldo-valor">
          {t("Valor em US$")}
        </label>
        <Input
          id="saldo-valor"
          className="w-32"
          inputMode="decimal"
          placeholder="30,00"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
      </div>
      {tipo === "recarga" ? (
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground" htmlFor="saldo-reais">
            {t("Quanto saiu em R$ (opcional)")}
          </label>
          <Input
            id="saldo-reais"
            className="w-36"
            inputMode="decimal"
            placeholder="64,00"
            value={reais}
            onChange={(e) => setReais(e.target.value)}
          />
        </div>
      ) : null}
      <div className="space-y-1">
        <label className="block text-xs text-muted-foreground" htmlFor="saldo-quando">
          {t("Quando (opcional)")}
        </label>
        {/* A DATA DO FATO, não a da digitação: recarga lançada dois dias depois
            precisa contar do dia certo, senão o saldo do intervalo sai errado. */}
        <Input
          id="saldo-quando"
          type="date"
          className="w-40"
          value={quando}
          onChange={(e) => setQuando(e.target.value)}
        />
      </div>
      <div className="min-w-[12rem] flex-1 space-y-1">
        <label className="block text-xs text-muted-foreground" htmlFor="saldo-nota">
          {t("Observação (opcional)")}
        </label>
        <Input
          id="saldo-nota"
          placeholder={t("cartão da empresa")}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={!valido || lancar.isPending}>
        {lancar.isPending ? t("Registrando…") : t("Registrar")}
      </Button>
      {lancar.isError ? (
        <p className="w-full text-xs text-destructive">
          {t("Não consegui registrar. Tente de novo.")}
        </p>
      ) : null}
    </form>
  );
}

function Cotacao({ atual }: { atual: { usd_brl: number; cotado_em: string | null } | null }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const definir = useDefinirCotacao();
  const [valor, setValor] = useState("");
  const numero = Number(valor.replace(",", "."));
  const valido = Number.isFinite(numero) && numero > 0;

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valido) definir.mutate(numero, { onSuccess: () => setValor("") });
      }}
    >
      <div className="space-y-1">
        <label className="block text-xs text-muted-foreground" htmlFor="cotacao">
          {t("Cotação do dólar")}
        </label>
        <Input
          id="cotacao"
          className="w-28"
          inputMode="decimal"
          placeholder={atual ? String(atual.usd_brl) : "5,45"}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
      </div>
      <Button type="submit" variant="outline" disabled={!valido || definir.isPending}>
        {t("Atualizar")}
      </Button>
      <p className="text-xs text-muted-foreground">
        {atual
          ? `${t("Em uso:")} R$ ${atual.usd_brl}${atual.cotado_em ? ` · ${t("de")} ${dia(atual.cotado_em, tag)}` : ""}`
          : t("Sem cotação: os valores aparecem em dólar.")}
      </p>
    </form>
  );
}

function Lancamentos({ linhas }: { linhas: Saldo["lancamentos"] }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const apagar = useApagarLancamento();

  if (linhas.length === 0) {
    return (
      <p className="rounded-md border p-4 text-sm text-muted-foreground">
        {t(
          "Nenhum lançamento ainda. Comece registrando uma leitura: o saldo que está hoje na conta do provedor.",
        )}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2">{t("Data")}</th>
            <th className="px-3 py-2">{t("Tipo")}</th>
            <th className="px-3 py-2 text-right">{t("Valor")}</th>
            <th className="px-3 py-2">{t("Observação")}</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id} className="border-t">
              <td className="px-3 py-2 tabular-nums">{dia(l.occurred_at, tag)}</td>
              <td className="px-3 py-2">
                <span
                  className={`rounded-md px-2 py-0.5 text-xs ${
                    l.tipo === "recarga"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-sky-500/10 text-sky-700 dark:text-sky-400"
                  }`}
                >
                  {l.tipo === "recarga" ? t("recarga") : t("leitura")}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {l.tipo === "recarga" ? "+" : ""}
                {usd(l.amount_usd, tag)}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {/* O valor em reais fica ao lado da observação: é o que explica
                    por que o seu dólar custou mais que o do mercado. */}
                {l.amount_brl !== null
                  ? [
                      l.amount_brl.toLocaleString(tag, { style: "currency", currency: "BRL" }),
                      l.note,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : (l.note ?? "—")}
              </td>
              <td className="px-3 py-2 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={apagar.isPending}
                  onClick={() => apagar.mutate(l.id)}
                >
                  {t("Excluir")}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SaldoDoProvedorSecao() {
  const t = useT();
  const { data, isLoading, isError } = useAiSaldo();

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t("Saldo e recarga do provedor")}</h2>
        <p className="text-xs text-muted-foreground">
          {t(
            "O saldo se atualiza sozinho: cai conforme os agentes trabalham e sobe quando você registra uma recarga. Registre uma leitura sempre que conferir a conta do provedor — ela corrige qualquer diferença acumulada.",
          )}
        </p>
      </div>

      {isLoading ? (
        <div className="h-24 animate-pulse rounded-md border" />
      ) : isError || !data ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          {t("Não consegui ler o saldo agora.")}
        </p>
      ) : (
        <>
          <Cartoes s={data} />
          <Cotacao atual={data.cotacao} />
          <Formulario />
          <Lancamentos linhas={data.lancamentos} />
        </>
      )}
    </section>
  );
}
