"use client";

/**
 * FORK MIA — CANAL, FAIXA e ORDEM no quadro do funil, como listas suspensas.
 *
 * No mesmo desenho dos filtros do upstream (botão "Rótulo: valor" que abre a
 * lista), dentro da mesma barra — o "Dono" é o filtro "Responsável" que já
 * existe. As opções de canal são as que ESTÃO no quadro: oferecer um canal que
 * nenhum cartão tem seria um filtro que sempre devolve vazio.
 *
 * A regra de filtrar e ordenar mora em lib/cartoes/filtros.ts e urgencia.ts.
 */
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/hooks/i18n/useT";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types/leads";
import {
  FAIXAS_DO_FILTRO,
  ROTULO_DA_FAIXA,
  type FaixaDoFiltro,
  type FiltrosDoCartao as Filtros,
} from "@/lib/cartoes/filtros";
import { ORDENS_DO_QUADRO, ROTULO_DA_ORDEM, type OrdemDoQuadro } from "@/lib/cartoes/urgencia";
import { ROTULO_DO_CANAL, SIGLAS_DE_CANAL, type SiglaDoCanal } from "@/lib/cartoes/tipos";

const TODOS = "__todos__";

export function FiltrosDoCartao({
  filtros,
  onChange,
  leads,
}: {
  filtros: Filtros;
  onChange: (proximo: Filtros) => void;
  leads: Lead[];
}) {
  const t = useT();
  const canaisNoQuadro = useMemo(() => {
    const presentes = new Set(leads.map((l) => l.cartao?.canal.sigla).filter(Boolean));
    return SIGLAS_DE_CANAL.filter((s) => presentes.has(s) || s === filtros.canal);
  }, [leads, filtros.canal]);

  const rotuloDoCanal = filtros.canal ? t(ROTULO_DO_CANAL[filtros.canal]) : t("Todos");
  const rotuloDaFaixa = filtros.faixa ? t(ROTULO_DA_FAIXA[filtros.faixa]) : t("Todas");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            data-testid="filtro-canal"
            className={cn(filtros.canal && "border-accent bg-accent/10")}
          >
            {t("Canal")}: {rotuloDoCanal}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{t("Canal de origem")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={filtros.canal ?? TODOS}
            onValueChange={(v) =>
              onChange({ ...filtros, canal: v === TODOS ? null : (v as SiglaDoCanal) })
            }
          >
            <DropdownMenuRadioItem value={TODOS}>{t("Todos os canais")}</DropdownMenuRadioItem>
            {canaisNoQuadro.map((sigla) => (
              <DropdownMenuRadioItem key={sigla} value={sigla}>
                {t(ROTULO_DO_CANAL[sigla])}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            data-testid="filtro-faixa"
            className={cn(filtros.faixa && "border-accent bg-accent/10")}
          >
            {t("Faixa")}: {rotuloDaFaixa}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{t("Chance de fechar")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={filtros.faixa ?? TODOS}
            onValueChange={(v) =>
              onChange({ ...filtros, faixa: v === TODOS ? null : (v as FaixaDoFiltro) })
            }
          >
            <DropdownMenuRadioItem value={TODOS}>{t("Todas as faixas")}</DropdownMenuRadioItem>
            {FAIXAS_DO_FILTRO.map((faixa) => (
              <DropdownMenuRadioItem key={faixa} value={faixa}>
                {t(ROTULO_DA_FAIXA[faixa])}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" data-testid="filtro-ordem">
            {t("Ordem")}: {t(ROTULO_DA_ORDEM[filtros.ordem])}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-xs">
          <DropdownMenuLabel>{t("Ordem dos cartões na coluna")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={filtros.ordem}
            onValueChange={(v) => onChange({ ...filtros, ordem: v as OrdemDoQuadro })}
          >
            {ORDENS_DO_QUADRO.map((ordem) => (
              <DropdownMenuRadioItem key={ordem} value={ordem}>
                {t(ROTULO_DA_ORDEM[ordem])}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {filtros.ordem === "urgencia" ? (
            <p className="px-2 pb-2 pt-1 text-[11px] leading-4 text-text-muted">
              {t(
                "Em cima: lead esperando resposta, tarefa atrasada, compromisso hoje, proposta da IA para aprovar, esfriando, sem próximo passo e, por último, com o próximo passo marcado.",
              )}
            </p>
          ) : null}
          {filtros.ordem !== "manual" ? (
            <p className="px-2 pb-2 text-[11px] leading-4 text-text-muted">
              {t("Para reordenar arrastando dentro da coluna, escolha Manual.")}
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
