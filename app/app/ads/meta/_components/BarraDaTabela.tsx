"use client";

/**
 * FORK MIA — a barra acima da tabela de campanhas: o filtro "só com impressão",
 * a contagem do que está à vista e a volta à ordem da plataforma.
 *
 * A contagem não é enfeite: com o filtro ligado, "4 de 7" é o que impede alguém
 * de concluir que três campanhas sumiram. Ela é `aria-live` para o leitor de
 * tela anunciar a mudança ao ligar a chave.
 */
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";

import { ID_DA_DICA_DE_ORDEM } from "./CabecalhoOrdenavel";

interface Props {
  soComImpressao: boolean;
  aoMudarFiltro: (ligado: boolean) => void;
  visiveis: number;
  total: number;
  /** Há ordem escolhida pela pessoa? Só então o botão de voltar aparece. */
  ordenada: boolean;
  aoVoltarOrdem: () => void;
}

export function BarraDaTabela({
  soComImpressao,
  aoMudarFiltro,
  visiveis,
  total,
  ordenada,
  aoVoltarOrdem,
}: Props) {
  const t = useT();

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <div className="flex items-center gap-2">
        <Switch id="so-com-impressao" checked={soComImpressao} onCheckedChange={aoMudarFiltro} />
        <Label htmlFor="so-com-impressao" className="cursor-pointer">
          {t("Só campanhas com impressão")}
        </Label>
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {t("Mostrando")} {visiveis} {t("de")} {total}
      </p>

      {ordenada && (
        <button
          type="button"
          onClick={aoVoltarOrdem}
          className="rounded-sm text-xs text-muted-foreground underline underline-offset-2 hover:text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        >
          {t("Voltar à ordem da plataforma")}
        </button>
      )}

      {/* Citada por todo cabeçalho (`aria-describedby`): diz o que o clique faz. */}
      <span id={ID_DA_DICA_DE_ORDEM} className="sr-only">
        {t("Clique no nome da coluna para ordenar; clique de novo para inverter.")}
      </span>
    </div>
  );
}
