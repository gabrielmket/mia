"use client";

/**
 * FORK MIA (item 9) — O QUE ESTÁ POR TRÁS DO NÚMERO (protótipo, tela 4), numa
 * folha ao lado do editor e do painel.
 *
 * A lista vem de `fn_mia_relatorio_lista` (9041), com o mesmo pedido do
 * gráfico, e o topo diz a conta: "R$ 48.000 com 12 negócios desta lista: é o
 * mesmo número do gráfico". Cada linha abre o cadastro no CRM, para corrigir
 * na origem o que estiver errado (um negócio sem origem, por exemplo).
 */
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { formatarValor } from "@/lib/relatorios/apresentar";
import { FONTES_DO_MONTADOR, MEDIDAS_DO_MONTADOR, type PeriodoDoMontador } from "@/lib/relatorios/catalogo";
import type { ConfigDoRelatorio } from "@/lib/relatorios/config";
import { colunasDaLista, type Celula, type LinhaDaLista, type RespostaDaLista } from "@/lib/relatorios/lista";

import { lista as pedirLista, mensagemDoErro, type GrupoDaLista } from "./api";

export interface ListaAberta extends GrupoDaLista {
  rotulo: string;
}

interface Props {
  aberta: ListaAberta | null;
  onFechar: () => void;
  config: ConfigDoRelatorio;
  periodo?: PeriodoDoMontador | null;
  podeExportar: boolean;
  onExportar?: (grupo: ListaAberta) => void;
}

function textoDaCelula(c: Celula, tag: string): string {
  if (c.tipo === "texto") return c.texto;
  if (c.tipo === "numero") return c.valor === null ? "" : new Intl.NumberFormat(tag).format(c.valor);
  if (c.centavos === null) return "";
  return new Intl.NumberFormat(tag, { style: "currency", currency: c.moeda, maximumFractionDigits: 0 }).format(c.centavos / 100);
}

export function ListaPorTras({ aberta, onFechar, config, periodo, podeExportar, onExportar }: Props) {
  const t = useT();
  const tag = useTagDeIdioma();
  const [lista, setLista] = useState<RespostaDaLista | null>(null);
  const [linhas, setLinhas] = useState<LinhaDaLista[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(
    async (deslocamento: number) => {
      if (!aberta) return;
      setCarregando(true);
      setErro(null);
      try {
        const r = await pedirLista(config, aberta, { periodo, deslocamento });
        setLista(r.lista);
        setNomes((n) => ({ ...n, ...r.nomes }));
        setLinhas((atuais) => (deslocamento === 0 ? r.lista.linhas : [...atuais, ...r.lista.linhas]));
      } catch (e) {
        setErro(mensagemDoErro(e, t));
      } finally {
        setCarregando(false);
      }
    },
    [aberta, config, periodo, t],
  );

  useEffect(() => {
    setLista(null);
    setLinhas([]);
    if (aberta) void carregar(0);
  }, [aberta, carregar]);

  const fonte = FONTES_DO_MONTADOR[config.fonte];
  const medidaDaConta = aberta?.funil ? "qtd" : config.medida;
  const formato = aberta?.funil && config.medida !== "soma" ? "n" : MEDIDAS_DO_MONTADOR[config.medida].formato;
  const total = lista ? (lista.total.valores[aberta?.funil && config.medida === "soma" ? "soma" : medidaDaConta] ?? (formato === "n" ? lista.total.n : null)) : null;
  const colunas = lista ? colunasDaLista(config.fonte, { valores: lista.valores, tela: true }) : [];
  const ctx = { nomes, fuso: lista?.janela.fuso ?? "America/Sao_Paulo", t };
  const aditiva = MEDIDAS_DO_MONTADOR[config.medida].aditiva;

  return (
    <Sheet open={aberta !== null} onOpenChange={(v) => (!v ? onFechar() : undefined)}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>
            {t("Lista")} · {aberta?.rotulo}
          </SheetTitle>
          <SheetDescription>{t("A lista usa o mesmo filtro, o mesmo período e a mesma regra de data do gráfico.")}</SheetDescription>
        </SheetHeader>

        {erro ? <p className="rounded-sm bg-error-bg px-3 py-2 text-sm text-error-fg">{erro}</p> : null}

        {lista ? (
          <p className="rounded-sm bg-success-bg px-3 py-2 text-sm text-success-fg">
            {lista.n === 0 ? (
              <>{t("Nenhum registro neste grupo.")}</>
            ) : (
              <>
                <b>{formatarValor(formato, total, { t, tag, moeda: lista.moeda })}</b> {t("com")} {new Intl.NumberFormat(tag).format(lista.n)}{" "}
                {t(lista.n === 1 ? fonte.um : fonte.varios)} {t("desta lista: é o mesmo número do gráfico")}
                {aditiva ? "" : t(", calculado só com estas linhas")}.
              </>
            )}
          </p>
        ) : carregando ? (
          <p className="text-sm text-text-muted">{t("Carregando a lista…")}</p>
        ) : null}

        {lista && !lista.valores && config.fonte === "negocios" ? (
          <p className="text-sm text-text-muted">{t("A coluna de valor não aparece para o seu acesso.")}</p>
        ) : null}

        {linhas.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-muted">
                  {colunas.map((c) => (
                    <th key={c.titulo} className={`py-2 pr-3 font-medium ${c.valor ? "text-right" : ""}`}>
                      {t(c.titulo)}
                    </th>
                  ))}
                  <th className="py-2 font-medium">
                    <span className="sr-only">{t("Abrir no CRM")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.registro} className="border-b border-border/60 align-top">
                    {colunas.map((c) => (
                      <td key={c.titulo} className={`py-1.5 pr-3 ${c.valor ? "text-right tabular-nums" : ""}`}>
                        {textoDaCelula(c.celula(l, ctx), tag)}
                      </td>
                    ))}
                    <td className="py-1 text-right">
                      {l.detalhe.link ? (
                        <Link
                          href={l.detalhe.link}
                          className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-sm px-2 text-base text-accent hover:underline lg:min-h-0 lg:text-sm"
                          aria-label={`${t("Abrir no CRM")}: ${t(fonte.abrir)}`}
                        >
                          {t("Abrir no CRM")}
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {lista && linhas.length < lista.n ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" disabled={carregando} onClick={() => void carregar(linhas.length)}>
              {t("Mostrar mais")}
            </Button>
            <span className="text-sm text-text-muted">
              {t("Mostrando")} {linhas.length} {t("de")} {new Intl.NumberFormat(tag).format(lista.n)}
            </span>
          </div>
        ) : null}

        {lista && lista.n > 0 && aberta ? (
          podeExportar && onExportar ? (
            <div>
              <Button variant="secondary" size="sm" onClick={() => onExportar(aberta)}>
                {t("Exportar esta lista (planilha)")}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-text-muted">{t("Exportar a lista é para gestor e administrador.")}</p>
          )
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
