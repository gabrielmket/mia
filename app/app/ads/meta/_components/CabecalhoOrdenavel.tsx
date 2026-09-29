"use client";

/**
 * FORK MIA — um cabeçalho de coluna que ordena ao clicar.
 *
 * Acessível por teclado de graça: o clique mora num `<button>` de verdade (Tab
 * alcança, Enter e Espaço acionam), e o `<th>` declara a ordem atual em
 * `aria-sort`, que é o que o leitor de tela anuncia ao entrar na coluna. A seta
 * é enfeite (`aria-hidden`) — a informação está no `aria-sort` e na dica.
 *
 * O `title` fica no `<th>`, onde as colunas do upstream já o tinham (a fórmula do
 * Connect rate, o numerador do Hook Rate): mover para o botão mudaria o que os
 * testes da tabela leem, e o hover funciona igual.
 */
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";

import { TableHead } from "@/components/ui/table";
import type {
  ColunaDaTabela,
  OrdemDaTabela,
} from "@/lib/plataformas-de-anuncio/meta/ordem-da-tabela";
import { cn } from "@/lib/utils";

/** O id do texto que explica o clique — um só na página, citado por todo botão. */
export const ID_DA_DICA_DE_ORDEM = "dica-ordem-tabela-de-campanhas";

interface Props {
  coluna: ColunaDaTabela;
  ordem: OrdemDaTabela | null;
  aoOrdenar: (coluna: ColunaDaTabela) => void;
  className?: string;
  title?: string;
  children: ReactNode;
}

export function CabecalhoOrdenavel({
  coluna,
  ordem,
  aoOrdenar,
  className,
  title,
  children,
}: Props) {
  const ativa = ordem?.coluna === coluna;
  const direcao = ativa ? ordem.direcao : null;
  const Seta = direcao === "desc" ? ArrowDown : direcao === "asc" ? ArrowUp : ArrowUpDown;

  return (
    <TableHead
      className={className}
      title={title}
      aria-sort={direcao === "asc" ? "ascending" : direcao === "desc" ? "descending" : "none"}
    >
      <button
        type="button"
        onClick={() => aoOrdenar(coluna)}
        aria-describedby={ID_DA_DICA_DE_ORDEM}
        data-coluna={coluna}
        className={cn(
          "-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 font-medium",
          "hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
          ativa && "text-text",
        )}
      >
        <span>{children}</span>
        <Seta
          aria-hidden="true"
          className={cn("h-3.5 w-3.5 shrink-0", ativa ? "opacity-100" : "opacity-40")}
        />
      </button>
    </TableHead>
  );
}
