"use client";

/**
 * FORK MIA (item 9) — a grade de um painel do montador, SÓ DE LEITURA: a página
 * pública do link para o dono (9042). Os modelos chegam calculados do servidor
 * (cliente de serviço, organização da linha do link); aqui só se desenha, sem
 * a lista por trás do número (o link é só de números somados).
 *
 * Tamanhos do protótipo: P ocupa um quarto da linha, M metade, G a linha
 * inteira. No celular, todos ocupam a largura toda.
 */
import { useT } from "@/hooks/i18n/useT";
import type { Tamanho } from "@/lib/relatorios/catalogo";
import type { ItemDoLink } from "@/lib/relatorios/link";

import { GraficoDoRelatorio } from "./Grafico";

export const CLASSE_DO_TAMANHO: Record<Tamanho, string> = {
  P: "md:col-span-1 lg:col-span-1",
  M: "md:col-span-1 lg:col-span-2",
  G: "md:col-span-2 lg:col-span-4",
};

export function GradeDoPainel({ itens }: { itens: ItemDoLink[] }) {
  const t = useT();
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
      {itens.map((i) => (
        <article key={i.id} className={`flex min-w-0 flex-col gap-2 rounded-md border border-border bg-surface p-4 ${CLASSE_DO_TAMANHO[i.tamanho]}`}>
          <h2 className="font-semibold">{i.traduzir ? t(i.titulo) : i.titulo}</h2>
          {i.modelo ? (
            <GraficoDoRelatorio modelo={i.modelo} vis={i.vis} compacto />
          ) : (
            <p className="text-sm text-text-muted">{t("Este relatório não pôde ser calculado agora.")}</p>
          )}
        </article>
      ))}
    </div>
  );
}
