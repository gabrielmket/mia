"use client";

/**
 * FORK MIA (item 9) — EXPORTAR PLANILHA (protótipo, tela 6).
 *
 * A planilha do relatório (os números somados, sem nome de cliente) ou a da
 * lista por trás de um número (linha a linha, com nome e telefone). Só gestor
 * e administrador; para os outros a janela explica por quê. A prévia é montada
 * aqui, com o MESMO montador de CSV do servidor (`lib/relatorios/csv.ts`), sem
 * registrar nada; o arquivo de verdade vem da rota, que registra a exportação
 * antes de entregá-lo.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { rotuloDaMedida, textoDoRotulo, type ModeloDoGrafico } from "@/lib/relatorios/apresentar";
import type { ConfigDoRelatorio } from "@/lib/relatorios/config";
import { csvDaLista, csvDoRelatorio, type Separador } from "@/lib/relatorios/csv";
import { colunasDaLista, type LinhaDaLista } from "@/lib/relatorios/lista";

import { baixarPlanilha, exportacoes as pedirExportacoes, lista as pedirLista, mensagemDoErro, type Exportacao } from "./api";
import type { ListaAberta } from "./ListaPorTras";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  modelo: ModeloDoGrafico | null;
  config: ConfigDoRelatorio;
  nome: string;
  relatorioId: string | null;
  pronto: string | null;
  podeExportar: boolean;
  /** Quando veio da lista: já abre na planilha da lista, neste grupo. */
  grupoInicial: ListaAberta | null;
}

const LINHAS_DA_PREVIA = 40;

function gruposDoModelo(m: ModeloDoGrafico | null, t: (s: string) => string): ListaAberta[] {
  if (!m) return [];
  const funil = m.ehFunil;
  return m.grupos
    .filter((g) => g.n > 0)
    .map((g) => ({
      chave1: g.chave,
      chave2: null,
      dobrados1: g.outros ? m.dobrados : null,
      funil,
      rotulo: textoDoRotulo(g.rotulo, t, g.quantos),
    }));
}

export function ExportarPlanilha({ aberto, onFechar, modelo, config, nome, relatorioId, pronto, podeExportar, grupoInicial }: Props) {
  const t = useT();
  const tag = useTagDeIdioma();
  const [tipo, setTipo] = useState<"relatorio" | "lista">(grupoInicial ? "lista" : "relatorio");
  const [sep, setSep] = useState<Separador>(";");
  const grupos = useMemo(() => {
    const doModelo = gruposDoModelo(modelo, t);
    if (grupoInicial && !doModelo.some((g) => g.chave1 === grupoInicial.chave1 && g.chave2 === grupoInicial.chave2)) {
      return [grupoInicial, ...doModelo];
    }
    return doModelo;
  }, [modelo, grupoInicial, t]);
  const [grupoIdx, setGrupoIdx] = useState(0);
  const [amostra, setAmostra] = useState<{ linhas: LinhaDaLista[]; nomes: Record<string, string>; n: number; moeda: string; fuso: string; valores: boolean } | null>(null);
  const [registro, setRegistro] = useState<Exportacao[] | null>(null);
  const [baixando, setBaixando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setTipo(grupoInicial ? "lista" : "relatorio");
    const i = grupoInicial ? grupos.findIndex((g) => g.chave1 === grupoInicial.chave1 && g.chave2 === grupoInicial.chave2) : 0;
    setGrupoIdx(Math.max(0, i));
    if (podeExportar) {
      pedirExportacoes()
        .then((r) => setRegistro(r.slice(0, 8)))
        .catch(() => setRegistro([]));
    }
  }, [aberto, grupoInicial, grupos, podeExportar]);

  const grupo = grupos[grupoIdx] ?? null;

  useEffect(() => {
    if (!aberto || !podeExportar || tipo !== "lista" || !grupo) return;
    let vivo = true;
    setAmostra(null);
    pedirLista(config, grupo)
      .then((r) => {
        if (vivo) {
          setAmostra({ linhas: r.lista.linhas, nomes: r.nomes, n: r.lista.n, moeda: r.lista.moeda, fuso: r.lista.janela.fuso, valores: r.lista.valores });
        }
      })
      .catch(() => vivo && setAmostra({ linhas: [], nomes: {}, n: 0, moeda: "BRL", fuso: "America/Sao_Paulo", valores: true }));
    return () => {
      vivo = false;
    };
  }, [aberto, podeExportar, tipo, grupo, config]);

  const previa = useMemo(() => {
    if (!podeExportar) return null;
    const f = { t, tag, moeda: modelo?.moeda ?? "BRL" };
    if (tipo === "relatorio") {
      if (!modelo) return null;
      const csv = csvDoRelatorio(modelo, { sep, f, rotuloDaMedida: rotuloDaMedida(config.medida, config.fonte, t) });
      return { texto: csv.texto.replace(/^﻿/, ""), linhas: csv.linhas };
    }
    if (!amostra) return null;
    const csv = csvDaLista(colunasDaLista(config.fonte, { valores: amostra.valores, tela: false }), amostra.linhas, {
      sep,
      moeda: amostra.moeda,
      ctx: { nomes: amostra.nomes, fuso: amostra.fuso, t },
    });
    return { texto: csv.texto.replace(/^﻿/, ""), linhas: amostra.n };
  }, [podeExportar, tipo, modelo, sep, config, amostra, t, tag]);

  async function baixar() {
    setBaixando(true);
    try {
      const r = await baixarPlanilha({
        tipo,
        nome,
        relatorio_id: relatorioId,
        pronto,
        config,
        separador: sep,
        ...(tipo === "lista" && grupo
          ? {
              chave1: grupo.chave1,
              chave2: grupo.chave2,
              dobrados1: grupo.dobrados1 ?? null,
              dobrados2: grupo.dobrados2 ?? null,
              funil: grupo.funil,
              grupo: grupo.rotulo,
            }
          : {}),
      });
      toast.success(`${t("Planilha baixada")}: ${r.linhas} ${t(r.linhas === 1 ? "linha" : "linhas")}.`);
      if (r.cortada) toast.warning(t("A lista passou de 20.000 linhas: a planilha saiu com as 20.000 mais recentes."));
      onFechar();
    } catch (e) {
      toast.error(mensagemDoErro(e, t));
    } finally {
      setBaixando(false);
    }
  }

  const linhasDaPrevia = previa ? previa.texto.split("\r\n").filter(Boolean) : [];

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? onFechar() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Exportar planilha")}</DialogTitle>
          <DialogDescription>{t("Sai em CSV, que abre no Excel e no Google Planilhas.")}</DialogDescription>
        </DialogHeader>

        <p className={`rounded-sm px-3 py-2 text-sm ${podeExportar ? "bg-info-bg text-info-fg" : "bg-warning-bg text-warning-fg"}`}>
          <b>{t("Quem pode exportar: gestor e administrador.")}</b>{" "}
          {podeExportar
            ? t("Você pode. Cada exportação fica registrada com quem, quando e o quê.")
            : t("Você vê os relatórios na tela, mas não leva a lista de clientes para fora do sistema. Se precisar, peça a um gestor.")}
        </p>

        {podeExportar ? (
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{t("O que exportar")}</legend>
              <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-sm border border-border p-3 lg:min-h-0">
                <input type="radio" name="tipo" className="mt-1" checked={tipo === "relatorio"} onChange={() => setTipo("relatorio")} />
                <span>
                  <b className="block text-base lg:text-sm">{t("Planilha do relatório")}</b>
                  <span className="text-sm text-text-muted">{t("Os números somados, uma linha por grupo. Sem nome de cliente.")}</span>
                </span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-sm border border-border p-3 lg:min-h-0">
                <input type="radio" name="tipo" className="mt-1" checked={tipo === "lista"} onChange={() => setTipo("lista")} disabled={grupos.length === 0} />
                <span>
                  <b className="block text-base lg:text-sm">{t("Planilha da lista por trás do número")}</b>
                  <span className="text-sm text-text-muted">{t("Linha a linha, com nome e telefone. É a que mais pede cuidado.")}</span>
                </span>
              </label>
            </fieldset>

            {tipo === "lista" ? (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{t("De qual grupo")}</span>
                <select
                  className="min-h-11 rounded-sm border border-border bg-bg px-3 text-base lg:min-h-9 lg:text-sm"
                  value={grupoIdx}
                  onChange={(e) => setGrupoIdx(Number(e.target.value))}
                >
                  {grupos.map((g, i) => (
                    <option key={`${g.chave1}|${g.chave2 ?? ""}`} value={i}>
                      {g.rotulo}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("Separador")}</span>
              <select
                className="min-h-11 rounded-sm border border-border bg-bg px-3 text-base lg:min-h-9 lg:text-sm"
                value={sep}
                onChange={(e) => setSep(e.target.value as Separador)}
              >
                <option value=";">{t("Ponto e vírgula (Excel em português)")}</option>
                <option value=",">{t("Vírgula (Google Planilhas e outros)")}</option>
              </select>
              <span className="text-text-muted">{t("Decimais com vírgula, datas em dd/mm/aaaa, arquivo em UTF-8.")}</span>
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                {t("Prévia da planilha")}
                {previa ? ` · ${previa.linhas} ${t(previa.linhas === 1 ? "linha" : "linhas")}` : ""}
              </span>
              <pre className="max-h-64 overflow-auto rounded-sm border border-border bg-surface-elevated p-3 text-xs" tabIndex={0}>
                {previa ? linhasDaPrevia.slice(0, LINHAS_DA_PREVIA).join("\n") + (linhasDaPrevia.length > LINHAS_DA_PREVIA ? "\n…" : "") : t("Carregando…")}
              </pre>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void baixar()} disabled={baixando || !previa}>
                {t("Baixar planilha")}
              </Button>
              <Button variant="outline" onClick={onFechar}>
                {t("Cancelar")}
              </Button>
            </div>

            {registro && registro.length > 0 ? (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">{t("Registro de exportações")}</span>
                <ul className="text-sm text-text-muted">
                  {registro.map((r) => (
                    <li key={r.id}>
                      {r.quem ?? t("Pessoa fora da equipe")} · {new Date(r.criadoEm).toLocaleString(tag)} · {r.relatorioNome}
                      {r.grupo ? ` · ${t("lista de")} ${r.grupo}` : ""} · {r.linhas} {t(r.linhas === 1 ? "linha" : "linhas")}
                    </li>
                  ))}
                </ul>
                <Link href="/app/relatorios/exportacoes" className="inline-flex min-h-11 items-center text-sm text-accent hover:underline lg:min-h-0">
                  {t("Ver o registro inteiro")}
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
