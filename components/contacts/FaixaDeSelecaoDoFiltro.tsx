"use client";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  /** Quantas linhas carregadas estão marcadas. */
  visiveis: number;
  /** Quantos contatos o filtro tem ao todo. `null` = ainda não se sabe. */
  total: number | null;
  /** A seleção já vale para o filtro inteiro. */
  todosDoFiltro: boolean;
  pendente: boolean;
  onSelecionarTodos: () => void;
  onLimpar: () => void;
}

/**
 * FORK MIA (.97) · "Selecionar todos os N contatos deste filtro".
 *
 * O padrão de quem já usou um e-mail: o "selecionar todas" marca o que está na
 * tela, e esta faixa oferece estender ao filtro inteiro. Estender nunca é sem
 * querer: a ação de cima continua pedindo confirmação, agora com o total.
 */
export function FaixaDeSelecaoDoFiltro({
  visiveis,
  total,
  todosDoFiltro,
  pendente,
  onSelecionarTodos,
  onLimpar,
}: Props) {
  const t = useT();

  return (
    <div
      className="flex flex-wrap items-center justify-center gap-2 rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm"
      data-testid="faixa-selecao-do-filtro"
    >
      {todosDoFiltro ? (
        <>
          <span>
            {total === null
              ? t("Todos os contatos deste filtro estão selecionados.")
              : t("Todos os {n} contatos deste filtro estão selecionados.").replace("{n}", String(total))}
          </span>
          <Button size="sm" variant="ghost" onClick={onLimpar} disabled={pendente}>
            {t("Limpar seleção")}
          </Button>
        </>
      ) : (
        <>
          <span>
            {visiveis === 1
              ? t("O contato carregado está selecionado.")
              : t("Os {n} contatos carregados estão selecionados.").replace("{n}", String(visiveis))}
          </span>
          <Button
            size="sm"
            variant="link"
            className="h-auto p-0"
            onClick={onSelecionarTodos}
            disabled={pendente}
            data-testid="selecionar-todos-do-filtro"
          >
            {total === null
              ? t("Selecionar todos os contatos deste filtro")
              : t("Selecionar todos os {n} contatos deste filtro").replace("{n}", String(total))}
          </Button>
        </>
      )}
    </div>
  );
}
