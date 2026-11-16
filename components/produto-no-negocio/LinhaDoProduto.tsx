"use client";
/**
 * FORK MIA (.109) · a linha do que o negócio vendeu, no cartão do quadro (tela 1
 * do protótipo, docs/fork/produto-no-negocio.md), logo acima do valor.
 *
 *   um item      o nome, com "×2" quando a quantidade passa de um
 *   dois         os dois nomes; três ou mais, o primeiro e "+2"
 *   sem item     "Sem <produto>", apagado, e o valor fica o que já era
 *   da proposta  a etiqueta "proposta" ao lado
 *
 * O nome inteiro fica no `title` (parar o mouse em cima) e no cabeçalho do
 * cartão aberto. Sem os sinais do quadro (a leitura falhou), a linha some.
 */
import { useContextoDoCartao } from "@/components/cartoes/ContextoDoCartao";
import { useT } from "@/hooks/i18n/useT";
import { usePalavraDoProduto } from "@/hooks/produto-no-negocio/useProdutoNoNegocio";
import type { SinaisDoCartao } from "@/lib/cartoes/tipos";
import { cn } from "@/lib/utils";

export function LinhaDoProduto({ sinais, denso = false }: { sinais: SinaisDoCartao | null | undefined; denso?: boolean }) {
  const t = useT();
  const { funil } = useContextoDoCartao();
  const palavra = usePalavraDoProduto(funil.palavra);
  if (!sinais || sinais.itens === undefined) return null;
  const linha = sinais.itens;
  return (
    <p
      data-testid="card-produto"
      title={linha ? linha.completo : t("Nenhum {produto} escolhido").replace("{produto}", palavra.s)}
      className={cn(
        "flex min-w-0 items-center gap-1.5 truncate",
        denso ? "mt-0.5 h-4 text-[11px] leading-4" : "mt-1 h-5 text-xs leading-5",
        linha ? "font-medium text-accent" : "text-text-muted",
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-[2px] bg-current" />
      <span className="min-w-0 truncate">
        {linha ? linha.texto : t("Sem {produto}").replace("{produto}", palavra.s)}
      </span>
      {linha?.daProposta ? (
        <span className="shrink-0 rounded-full bg-info-bg px-1.5 text-[10px] font-normal leading-4 text-info-fg">
          {t("proposta")}
        </span>
      ) : null}
    </p>
  );
}

/** O que o negócio vendeu, por extenso, para o cabeçalho do cartão aberto. */
export function ProdutosPorExtenso({ sinais }: { sinais: SinaisDoCartao | null | undefined }) {
  if (!sinais?.itens) return null;
  return (
    <span className="min-w-0 truncate text-accent" title={sinais.itens.completo} data-testid="cartao-aberto-produtos">
      {sinais.itens.completo}
    </span>
  );
}
