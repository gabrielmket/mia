"use client";

/**
 * FORK MIA (.89) — a tela ENVIAR de uma campanha de e-mail (protótipo, tela 4).
 *
 * Agora ou agendado; o ritmo (nunca acima do da configuração) e os dias úteis;
 * o PLANO dia a dia com o aquecimento do domínio; o custo e o saldo; o que
 * trava, com o caminho para resolver. A confirmação é NA PÁGINA, com a
 * declaração da base legal assinada por quem confirma. Criar e editar não
 * disparam: só este botão, e só sem trava.
 */
import { useState } from "react";
import { toast } from "sonner";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import {
  useConferencia,
  useConfirmarCampanha,
  type CampanhaNaTela,
  type DiaDoPlanoNaTela,
  type Retrato,
} from "@/hooks/useEmailMarketing";
import { RITMOS_POR_HORA } from "@/lib/email-marketing/regras";
import { ROTULO_DA_TRAVA, ROTULO_DO_LIMITE_DO_DIA } from "@/lib/email-marketing/rotulos";
import { formatCentsBRL } from "@/lib/money";

import type { AbaDaCampanha } from "../CampanhaDeEmail";

const TOQUE = "min-h-11 lg:min-h-0";

function TabelaDoPlano({ plano, fuso }: { plano: DiaDoPlanoNaTela[]; fuso: string }) {
  const t = useT();
  const idioma = useTagDeIdioma();
  if (plano.length === 0)
    return (
      <p className="text-sm text-muted-foreground">{t("Sem plano: ninguém entra na lista.")}</p>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-plano>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1 pr-3 font-medium">{t("Dia")}</th>
            <th className="py-1 pr-3 font-medium">{t("Horário")}</th>
            <th className="py-1 pr-3 text-right font-medium">{t("E-mails")}</th>
            <th className="py-1 font-medium">{t("O que limita")}</th>
          </tr>
        </thead>
        <tbody>
          {plano.map((d) => (
            <tr key={d.data} className="border-t border-border">
              <td className="py-1 pr-3">
                {new Date(d.inicio).toLocaleDateString(idioma, {
                  weekday: "short",
                  day: "2-digit",
                  month: "2-digit",
                  timeZone: fuso,
                })}
              </td>
              <td className="py-1 pr-3">
                {new Date(d.inicio).toLocaleTimeString(idioma, {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: fuso,
                })}{" "}
                –{" "}
                {new Date(d.fim).toLocaleTimeString(idioma, {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: fuso,
                })}
              </td>
              <td className="py-1 pr-3 text-right tabular-nums">
                {d.quantidade.toLocaleString(idioma)}
              </td>
              <td className="py-1 text-xs text-muted-foreground">
                {t(ROTULO_DO_LIMITE_DO_DIA[d.porQuePara] ?? "ritmo e janela")}
                {d.porQuePara === "aquecimento"
                  ? ` (${t("degrau {n} de 14").replace("{n}", String(d.degrau + 1))})`
                  : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** O que a campanha confirmada guardou: o plano, o preço e a declaração. */
function CampanhaJaConfirmada({
  campanha,
  retrato,
}: {
  campanha: CampanhaNaTela;
  retrato: Retrato;
}) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const plano = (campanha.plano ?? []) as DiaDoPlanoNaTela[];
  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-4">
        <h2 className="text-base font-semibold">{t("Envio confirmado")}</h2>
        <p className="text-sm">
          {campanha.agendada_para
            ? `${t("Começa em")} ${new Date(campanha.agendada_para).toLocaleString(idioma, { timeZone: retrato.empresa.fuso })}.`
            : t("Começou na confirmação.")}
        </p>
        <p className="text-sm">
          {t("Pessoas na lista:")} <b>{(campanha.total_previsto ?? 0).toLocaleString(idioma)}</b> ·{" "}
          {t("Preço por e-mail:")} <b>{formatCentsBRL(campanha.preco_cents ?? 0)}</b> ·{" "}
          {t("Custo previsto:")} <b>{formatCentsBRL(campanha.custo_previsto_cents ?? 0)}</b>
        </p>
        <p className="text-xs text-muted-foreground">
          {t("O débito sai do crédito por lote enviado, só pelo que a Amazon aceitou.")}
        </p>
        {campanha.declaracao_base_legal ? (
          <div className="rounded-md bg-surface-elevated p-3 text-xs">
            <b>{t("Declaração de base legal")}</b>
            <p className="mt-1 whitespace-pre-wrap">{campanha.declaracao_base_legal}</p>
          </div>
        ) : null}
      </Card>
      <Card className="space-y-2 p-4">
        <h2 className="text-base font-semibold">{t("Plano dia a dia")}</h2>
        <TabelaDoPlano plano={plano} fuso={retrato.empresa.fuso} />
      </Card>
    </div>
  );
}

export function AbaEnviar({
  campanha,
  retrato,
  aoIr,
}: {
  campanha: CampanhaNaTela;
  retrato: Retrato;
  aoIr: (aba: AbaDaCampanha) => void;
}) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const rascunho = campanha.status === "rascunho";
  const [modo, setModo] = useState<"agora" | "agendar">("agora");
  const [dataLocal, setDataLocal] = useState("");
  const [ritmo, setRitmo] = useState<number>(
    Math.min(campanha.ritmo_por_hora ?? retrato.ritmo_por_hora, retrato.ritmo_por_hora),
  );
  const [soUteis, setSoUteis] = useState<boolean>(campanha.so_dias_uteis ?? retrato.so_dias_uteis);
  const [revisando, setRevisando] = useState(false);
  const [declarou, setDeclarou] = useState(false);
  const quandoIso = modo === "agora" || !dataLocal ? "agora" : new Date(dataLocal).toISOString();
  const pedido = { quando: quandoIso, ritmo_por_hora: ritmo, so_dias_uteis: soUteis };
  const conferencia = useConferencia(
    campanha.id,
    pedido,
    rascunho && !(modo === "agendar" && !dataLocal),
  );
  const confirmar = useConfirmarCampanha(campanha.id);

  if (!rascunho) return <CampanhaJaConfirmada campanha={campanha} retrato={retrato} />;

  const c = conferencia.data;
  const ritmos = [
    ...new Set([
      ...RITMOS_POR_HORA.filter((r) => r <= retrato.ritmo_por_hora),
      retrato.ritmo_por_hora,
    ]),
  ].sort((a, b) => a - b);
  const travas = c?.travas ?? [];
  const faltaNoSaldo = c ? Math.max(0, c.custoCents - c.saldoCents) : 0;
  const cabem = c && c.precoCents > 0 ? Math.floor(c.saldoCents / c.precoCents) : 0;
  const declaracao =
    campanha.base_legal === "legitimate_interest"
      ? t(
          "Declaro que estas pessoas são clientes com compra nos últimos 24 meses, conforme a avaliação de interesse legítimo indicada, e que a campanha tem relação com o que compraram.",
        )
      : t(
          "Declaro que estas pessoas deram o aceite de e-mail marketing registrado no sistema, e que nenhuma lista comprada ou de terceiros entrou aqui.",
        );

  function irPara(ir: string | null) {
    if (ir === "publico" || ir === "mensagem") aoIr(ir);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr,380px]">
      <div className="space-y-4">
        <Card className="space-y-3 p-4">
          <h2 className="text-base font-semibold">{t("Quando sai")}</h2>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("Quando sai")}>
            <Button
              variant={modo === "agora" ? "default" : "outline"}
              onClick={() => setModo("agora")}
              role="radio"
              aria-checked={modo === "agora"}
            >
              {t("Começar agora")}
            </Button>
            <Button
              variant={modo === "agendar" ? "default" : "outline"}
              onClick={() => setModo("agendar")}
              role="radio"
              aria-checked={modo === "agendar"}
            >
              {t("Agendar")}
            </Button>
          </div>
          {modo === "agendar" ? (
            <div className="space-y-1">
              <Label htmlFor="env-data">{t("Data e hora de início")}</Label>
              <Input
                id="env-data"
                type="datetime-local"
                value={dataLocal}
                onChange={(e) => setDataLocal(e.target.value)}
                className={TOQUE}
              />
              <p className="text-xs text-muted-foreground">
                {t("Fora da janela de envio, começa na próxima abertura da janela.")} (
                {retrato.janela[0]}h–{retrato.janela[1]}h)
              </p>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="env-ritmo">{t("Ritmo por hora")}</Label>
              <select
                id="env-ritmo"
                className={`h-9 w-full rounded-md border border-border bg-surface px-2 text-sm ${TOQUE}`}
                value={ritmo}
                onChange={(e) => setRitmo(Number(e.target.value))}
              >
                {ritmos.map((r) => (
                  <option key={r} value={r}>
                    {`${r.toLocaleString(idioma)} / h`}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {t("Nunca acima do ritmo da configuração da empresa.")}
              </p>
            </div>
            <label className={`flex items-center gap-2 text-sm ${TOQUE}`}>
              <input
                type="checkbox"
                checked={soUteis}
                onChange={(e) => setSoUteis(e.target.checked)}
              />
              {t("Só em dias úteis")}
            </label>
          </div>
        </Card>

        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{t("Plano dia a dia")}</h2>
            {c ? (
              <span className="text-xs text-muted-foreground">
                {t("Aquecimento do domínio:")}{" "}
                {c.degrau >= 14
                  ? t("concluído")
                  : t("degrau {n} de 14").replace("{n}", String(c.degrau + 1))}
              </span>
            ) : null}
          </div>
          {conferencia.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("Calculando o plano…")}</p>
          ) : modo === "agendar" && !dataLocal ? (
            <p className="text-sm text-muted-foreground">
              {t("Escolha a data e a hora para ver o plano.")}
            </p>
          ) : c ? (
            <>
              <TabelaDoPlano plano={c.plano} fuso={retrato.empresa.fuso} />
              <p className="text-xs text-muted-foreground">
                {t(
                  "O domínio novo sobe de degrau só quando o dia anterior fica abaixo de 2% de rejeição e 0,1% de reclamação. Acima disso, o degrau fica parado.",
                )}
              </p>
            </>
          ) : null}
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="space-y-2 p-4" data-custo>
          <h2 className="text-base font-semibold">{t("Custo e crédito")}</h2>
          {c ? (
            <>
              <p className="text-sm">
                {t("Pessoas na lista:")} <b>{c.total.toLocaleString(idioma)}</b>
              </p>
              <p className="text-sm">
                {t("Preço por e-mail:")} <b>{formatCentsBRL(c.precoCents)}</b>{" "}
                {c.precoPadrao ? <Badge variant="neutral">{t("padrão")}</Badge> : null}
              </p>
              <p className="text-sm">
                {t("Custo previsto:")} <b>{formatCentsBRL(c.custoCents)}</b>
              </p>
              <p className="text-sm">
                {t("Saldo:")} <b>{formatCentsBRL(c.saldoCents)}</b>
              </p>
              {faltaNoSaldo > 0 ? (
                <p className="text-sm text-error-fg">
                  {t("Faltam {valor}. Com o saldo de hoje cabem {n} e-mails.")
                    .replace("{valor}", formatCentsBRL(faltaNoSaldo))
                    .replace("{n}", cabem.toLocaleString(idioma))}{" "}
                  <Link className="underline" href="/app/settings/carteira">
                    {t("Ver o crédito")}
                  </Link>
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {t(
                  "Cobra só o e-mail que a Amazon aceitou. O teste não cobra. O saldo é conferido de novo quando o envio começa.",
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {c.medicao === "cliques_e_aberturas"
                  ? t("Medição: cliques, e abertura só de quem aceitou a medição.")
                  : t("Medição: só cliques. Interesse legítimo não leva o pixel de abertura.")}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("Calculando…")}</p>
          )}
        </Card>

        <Card className="space-y-2 p-4" data-travas={travas.length}>
          <h2 className="text-base font-semibold">
            {travas.length > 0 ? t("O que falta para enviar") : t("Pronto para enviar")}
          </h2>
          {travas.length === 0 && c ? (
            <p className="text-sm text-success-fg">{t("Nada trava o envio.")}</p>
          ) : null}
          <ul className="space-y-2">
            {travas.map((tr) => (
              <li
                key={`${tr.codigo}-${tr.texto}`}
                className="flex items-start justify-between gap-2 text-sm"
              >
                <span>
                  {t(ROTULO_DA_TRAVA[tr.codigo] ?? "Há uma trava no envio.")}
                  {tr.codigo === "saldo" && faltaNoSaldo > 0 ? (
                    <small className="block text-xs text-muted-foreground">
                      {formatCentsBRL(faltaNoSaldo)}
                    </small>
                  ) : null}
                </span>
                {tr.ir === "config" ? (
                  <Link href="/app/settings/email-marketing" className="shrink-0 text-xs underline">
                    {t("Resolver")}
                  </Link>
                ) : tr.ir === "publico" || tr.ir === "mensagem" ? (
                  <Button size="sm" variant="link" onClick={() => irPara(tr.ir)}>
                    {t("Resolver")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {!revisando ? (
            <Button
              className="w-full"
              disabled={!c || travas.length > 0 || conferencia.isFetching}
              onClick={() => {
                setDeclarou(false);
                setRevisando(true);
              }}
            >
              {modo === "agora" ? t("Revisar e enviar") : t("Revisar e agendar")}
            </Button>
          ) : null}
        </Card>

        {revisando && c ? (
          <Card className="space-y-3 border-accent p-4" data-confirmacao>
            <h2 className="text-base font-semibold">{t("Confirmar o envio")}</h2>
            <p className="text-sm">
              {modo === "agora"
                ? t("Sai a partir de agora para {n} pessoas, no plano acima.").replace(
                    "{n}",
                    c.total.toLocaleString(idioma),
                  )
                : t("Agendado para {data}, para {n} pessoas, no plano acima.")
                    .replace(
                      "{data}",
                      new Date(quandoIso).toLocaleString(idioma, {
                        timeZone: retrato.empresa.fuso,
                      }),
                    )
                    .replace("{n}", c.total.toLocaleString(idioma))}
            </p>
            <p className="text-sm">
              {t("Custo previsto:")} <b>{formatCentsBRL(c.custoCents)}</b>
            </p>
            <label className={`flex items-start gap-2 text-sm ${TOQUE}`}>
              <input
                type="checkbox"
                className="mt-1"
                checked={declarou}
                onChange={(e) => setDeclarou(e.target.checked)}
              />
              <span>
                {declaracao}
                {campanha.base_legal === "legitimate_interest" && campanha.lia_ref
                  ? ` (${campanha.lia_ref})`
                  : ""}
              </span>
            </label>
            <p className="text-xs text-muted-foreground">
              {t("A declaração fica gravada na campanha, com o seu nome e a hora.")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!declarou || confirmar.isPending}
                onClick={() =>
                  confirmar.mutate(
                    { ...pedido, confirmo_a_base_legal: true },
                    {
                      onSuccess: () => {
                        setRevisando(false);
                        toast.success(
                          modo === "agora"
                            ? t("Envio confirmado. Os primeiros e-mails saem na próxima rodada.")
                            : t("Envio agendado."),
                        );
                      },
                    },
                  )
                }
              >
                {confirmar.isPending ? t("Confirmando…") : t("Confirmar o envio")}
              </Button>
              <Button variant="ghost" onClick={() => setRevisando(false)}>
                {t("Voltar")}
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
