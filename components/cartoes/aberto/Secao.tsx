"use client";

/**
 * FORK MIA — uma seção do cartão aberto e das fichas: título pequeno em
 * maiúsculas (o desenho que o dossiê do upstream já usa), recolhível, com
 * ações à direita. Recolher é conveniência de quem lê; nada se perde.
 */
import { useState, type ReactNode } from "react";

import { useT } from "@/hooks/i18n/useT";
import { CaretDown, CaretRight } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

export function Secao({
  titulo,
  contagem,
  acoes,
  children,
  id,
  recolhida = false,
  className,
  testid,
}: {
  titulo: string;
  contagem?: number | string | null;
  acoes?: ReactNode;
  children: ReactNode;
  id?: string;
  recolhida?: boolean;
  className?: string;
  testid?: string;
}) {
  const t = useT();
  const [aberta, setAberta] = useState(!recolhida);
  return (
    <section id={id} data-testid={testid} className={cn("border-b border-border py-3", className)}>
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setAberta((v) => !v)}
          aria-expanded={aberta}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-medium uppercase tracking-wide text-text-muted hover:text-text"
          title={aberta ? t("Recolher") : t("Mostrar")}
        >
          {aberta ? <CaretDown size={12} aria-hidden /> : <CaretRight size={12} aria-hidden />}
          <span className="truncate">{titulo}</span>
          {contagem !== undefined && contagem !== null ? (
            <span className="font-normal normal-case tracking-normal">· {contagem}</span>
          ) : null}
        </button>
        {acoes ? <div className="flex shrink-0 items-center gap-1">{acoes}</div> : null}
      </div>
      {aberta ? children : null}
    </section>
  );
}

/** Um par rótulo/valor, na grade de duas colunas das seções. */
export function Par({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-xs text-text-muted">{rotulo}</dt>
      <dd className="min-w-0 break-words text-xs text-text">{children}</dd>
    </>
  );
}

export function Pares({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[minmax(90px,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1.5">{children}</dl>;
}
