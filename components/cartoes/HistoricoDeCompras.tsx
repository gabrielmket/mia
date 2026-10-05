"use client";

/**
 * FORK MIA — o HISTÓRICO DE COMPRAS, o mesmo bloco no cartão aberto, na ficha do
 * contato e na ficha da empresa.
 *
 * Responde, nesta ordem: já é cliente? quantas vezes e quanto? quando foi a
 * última e há quanto tempo? de quanto em quanto tempo compra, e quando é provável
 * a próxima (ESTIMATIVA, e dito assim)? como costuma comprar (o hábito, DERIVADO
 * do que existe, e dito assim)? e a lista, com a origem de cada compra.
 *
 * Na empresa, a soma é de todas as pessoas dela, e cada linha diz quem comprou.
 * As regras moram em lib/cartoes/compras.ts; aqui é só desenho.
 */
import Link from "next/link";

import { useT } from "@/hooks/i18n/useT";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { format, type Locale } from "date-fns";
import { ArrowsClockwise, CheckCircle } from "@/lib/ui/icons";
import type { ResumoDeCompras } from "@/lib/cartoes/compras";
import { valorCheio, valorCurto } from "@/lib/cartoes/dinheiro";
import { duracaoLonga } from "@/lib/cartoes/tempo";
import { Secao } from "@/components/cartoes/aberto/Secao";

function data(iso: string, locale: Locale): string {
  try {
    return format(new Date(iso), "dd/MM/yyyy", { locale });
  } catch {
    return iso.slice(0, 10);
  }
}

export function HistoricoDeCompras({
  resumo,
  modo,
  id,
  rodape,
}: {
  resumo: ResumoDeCompras | null;
  modo: "contato" | "empresa" | "negocio";
  id?: string;
  rodape?: React.ReactNode;
}) {
  const t = useT();
  const locale = useLocaleDeData();

  if (!resumo) {
    // No cartão aberto, sem compra não há bloco: o aviso do cabeçalho também não aparece.
    if (modo === "negocio") return null;
    return (
      <Secao titulo={t("Histórico de compras")} id={id} testid="historico-de-compras">
        <p className="text-xs text-text-muted">
          {modo === "empresa"
            ? t("Nenhuma compra desta empresa ainda. Aparecem aqui os negócios ganhos e os pedidos das pessoas dela.")
            : t("Nenhuma compra ainda. Aparecem aqui os negócios ganhos e os pedidos deste contato.")}
        </p>
      </Secao>
    );
  }

  const r = resumo;
  const selo =
    r.selo === "recorrente" ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-fg">
        <ArrowsClockwise size={12} weight="bold" aria-hidden /> {t("Cliente recorrente")}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-fg">
        <CheckCircle size={12} weight="bold" aria-hidden /> {t("Já é cliente")}
      </span>
    );

  const intervalo =
    r.intervaloMedioDias === null
      ? null
      : `${t("a cada")} ~${duracaoLonga(r.intervaloMedioDias, t)}`;

  return (
    <Secao titulo={t("Histórico de compras")} id={id} testid="historico-de-compras">
      <div className="space-y-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {selo}
          <span className="text-text">
            <b className="font-medium">
              {r.quantidade === 1 ? t("1 compra") : `${r.quantidade} ${t("compras")}`}
            </b>{" "}
            · <b className="font-medium tabular-nums">{valorCheio(r.totalCents, r.moeda)}</b> {t("no total")}
          </span>
        </div>
        {r.outrasMoedas ? (
          <p className="text-[11px] text-text-muted">
            {t("Há compras em outra moeda, fora desta soma; elas estão na lista abaixo.")}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Numero rotulo={t("Ticket médio")} valor={valorCurto(r.ticketMedioCents, r.moeda)} />
          <Numero rotulo={t("Última compra")} valor={data(r.ultima.data, locale)} />
          <Numero rotulo={t("Há quanto tempo")} valor={t("há {tempo}").replace("{tempo}", duracaoLonga(r.ultima.haDias, t))} />
          {intervalo ? (
            <Numero
              rotulo={t("Intervalo médio entre compras")}
              valor={intervalo}
              nota={
                r.intervalosMedidos === 1
                  ? t("1 intervalo medido")
                  : `${r.intervalosMedidos} ${t("intervalos medidos")}`
              }
            />
          ) : (
            <Numero
              rotulo={t("Frequência")}
              valor={t("ainda sem padrão")}
              nota={t("aparece a partir da 2ª compra")}
            />
          )}
          {r.proximaProvavel ? (
            <Numero
              rotulo={t("Próxima compra provável")}
              valor={data(r.proximaProvavel.data, locale)}
              selo={t("estimativa")}
              nota={
                r.proximaProvavel.jaPassou
                  ? t("já passou: bom momento para oferecer")
                  : `${t("daqui a")} ${duracaoLonga(r.proximaProvavel.emDias, t)}`
              }
            />
          ) : null}
        </div>

        {r.habito.oQue || r.habito.pagamento || r.habito.finalidade ? (
          <div className="rounded-md bg-surface-muted/60 px-2 py-1.5">
            <p className="text-[11px] text-text-muted">
              {t("Hábito")} · {t("derivado das compras e dos campos dos negócios; não é um cadastro")}
            </p>
            <p className="mt-0.5 text-text">
              {[
                r.habito.oQue ? `${t("O quê")}: ${r.habito.oQue}` : null,
                r.habito.pagamento ? `${t("Pagamento")}: ${r.habito.pagamento}` : null,
                r.habito.finalidade ? `${t("Finalidade")}: ${r.habito.finalidade}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        ) : null}

        <ul className="divide-y divide-border rounded-md border border-border">
          {r.compras.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 px-2 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-text" title={c.item}>
                  {c.negocioId ? (
                    <Link href={`/app/leads/${c.negocioId}`} className="hover:underline">
                      {c.item}
                    </Link>
                  ) : (
                    c.item
                  )}
                </p>
                <p className="text-[11px] text-text-muted">
                  <span className="tabular-nums">{data(c.data, locale)}</span> ·{" "}
                  {c.origem === "negocio_ganho" ? t("negócio ganho") : `${t("pedido")} ${c.referencia}`}
                  {modo === "empresa" && c.contatoId ? (
                    <>
                      {" · "}
                      {t("comprou")}:{" "}
                      <Link href={`/app/contacts/${c.contatoId}`} className="underline-offset-2 hover:underline">
                        {c.contatoNome ?? t("Contato")}
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
              <span className="shrink-0 font-medium tabular-nums text-text">{valorCheio(c.valorCents, c.moeda)}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-text-muted">
          {modo === "empresa"
            ? t("Soma as compras de todas as pessoas da empresa. Origem: negócios ganhos e pedidos.")
            : t("Origem: negócios ganhos e pedidos do contato.")}
        </p>
        {rodape}
      </div>
    </Secao>
  );
}

function Numero({
  rotulo,
  valor,
  nota,
  selo,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  selo?: string;
}) {
  return (
    <div className="rounded-md border border-border px-2 py-1.5">
      <p className="text-[11px] text-text-muted">{rotulo}</p>
      <p className="mt-0.5 font-medium text-text">
        {valor}
        {selo ? (
          <span className="ml-1 rounded-full bg-info-bg px-1.5 text-[10px] font-normal text-info-fg">{selo}</span>
        ) : null}
      </p>
      {nota ? <p className="text-[11px] text-text-muted">{nota}</p> : null}
    </div>
  );
}
