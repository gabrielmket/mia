"use client";

/**
 * FORK MIA (item 9) — um filtro do editor, com VÁRIOS valores (9041: a lista
 * passa se casar com qualquer um). O que dá para escolher vem do próprio motor:
 * os valores que existem no período, com quantos registros cada um tem. O
 * funil é de um valor só (a etapa depende dele).
 */
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/hooks/i18n/useT";
import { textoDoRotulo } from "@/lib/relatorios/apresentar";
import { FILTROS_DE_UM_VALOR, type Dimensao } from "@/lib/relatorios/catalogo";
import type { ConfigDoRelatorio, ValorDeFiltro } from "@/lib/relatorios/config";

import { mensagemDoErro, valores as pedirValores, type ValorPossivel } from "./api";

interface Props {
  config: ConfigDoRelatorio;
  filtro: Dimensao;
  rotulo: string;
  valor: ValorDeFiltro | undefined;
  /** Por que o filtro está desligado (ex.: a medida já escolhe a situação). */
  desligado?: string | null;
  onMudar: (novo: string[] | string | null) => void;
  /** Avisa os nomes dos valores, para os chips e a frase do relatório. */
  onRotulos: (filtro: string, rotulos: Record<string, string>) => void;
}

function comoLista(v: ValorDeFiltro | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v) return [v];
  return [];
}

export function FiltroDoRelatorio({ config, filtro, rotulo, valor, desligado, onMudar, onRotulos }: Props) {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const [opcoes, setOpcoes] = useState<ValorPossivel[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const escolhidos = comoLista(valor);
  const umSo = FILTROS_DE_UM_VALOR.has(filtro);

  async function abrir(v: boolean) {
    setAberto(v);
    if (!v) return;
    setErro(null);
    try {
      const lista = await pedirValores(config, filtro);
      setOpcoes(lista);
      onRotulos(filtro, Object.fromEntries(lista.map((o) => [o.chave, textoDoRotulo(o.rotulo, t)])));
    } catch (e) {
      setErro(mensagemDoErro(e, t));
    }
  }

  function alternar(chave: string) {
    if (umSo) {
      onMudar(escolhidos[0] === chave ? null : chave);
      setAberto(false);
      return;
    }
    const nova = escolhidos.includes(chave) ? escolhidos.filter((c) => c !== chave) : [...escolhidos, chave];
    onMudar(nova.length === 0 ? null : nova);
  }

  const resumo = escolhidos.length === 0 ? (umSo ? t("O principal") : t("Todos")) : escolhidos.length === 1 ? t("1 escolhido") : `${escolhidos.length} ${t("escolhidos")}`;

  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      <span className="font-medium">{rotulo}</span>
      <Popover open={aberto} onOpenChange={(v) => void abrir(v)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={Boolean(desligado)}
            className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-sm border px-3 text-left text-base lg:min-h-9 lg:text-sm ${escolhidos.length ? "border-accent" : "border-border"} bg-bg disabled:opacity-50`}
          >
            <span className="truncate">{resumo}</span>
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-80 w-72 overflow-y-auto p-2">
          {erro ? <p className="px-2 py-1 text-sm text-error-fg">{erro}</p> : null}
          {!opcoes && !erro ? <p className="px-2 py-1 text-sm text-text-muted">{t("Carregando…")}</p> : null}
          {opcoes && opcoes.length === 0 ? <p className="px-2 py-1 text-sm text-text-muted">{t("Nada no período.")}</p> : null}
          {opcoes?.map((o) => (
            <label key={o.chave} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 text-base hover:bg-surface-elevated lg:min-h-8 lg:text-sm">
              <input type={umSo ? "radio" : "checkbox"} checked={escolhidos.includes(o.chave)} onChange={() => alternar(o.chave)} />
              <span className={`min-w-0 flex-1 truncate ${o.chave === "__sem" ? "text-text-muted" : ""}`}>{textoDoRotulo(o.rotulo, t)}</span>
              {umSo ? null : <span className="tabular-nums text-text-muted">{o.n}</span>}
            </label>
          ))}
        </PopoverContent>
      </Popover>
      {desligado ? <span className="text-xs text-text-muted">{desligado}</span> : null}
    </div>
  );
}
