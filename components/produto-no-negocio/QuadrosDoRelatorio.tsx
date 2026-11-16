"use client";
/**
 * FORK MIA (.109) · os dois quadros novos do Relatório de vendas (tela 5 do
 * protótipo, docs/fork/produto-no-negocio.md): o que se vendeu no mês, por
 * produto, e o tempo até fechar, por produto. Ficam antes de Taxa de ganho; os
 * quadros de sempre continuam abaixo, sem mudança. A conta é de
 * `lib/produto-no-negocio/relatorio.ts`; aqui só o desenho.
 */
import { useT } from "@/hooks/i18n/useT";
import { usePalavraDoProduto } from "@/hooks/produto-no-negocio/useProdutoNoNegocio";
import { formatCentsBRL } from "@/lib/money";
import type { TempoAteFechar, VendidosNoMes } from "@/lib/produto-no-negocio/relatorio";
import { quantidadeLegivel } from "@/lib/produto-no-negocio/regras";

export interface ProdutoNoRelatorio {
  palavra: string | null;
  vendidos: VendidosNoMes;
  tempo: TempoAteFechar;
}

function useDias() {
  const t = useT();
  return (n: number) => {
    const r = Math.round(n * 10) / 10;
    const texto = r.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    return r === 1 ? t("{n} dia").replace("{n}", texto) : t("{n} dias").replace("{n}", texto);
  };
}

const Barra = ({ pct, apagada = false }: { pct: number; apagada?: boolean }) => (
  <div className="mt-1.5 h-1.5 max-w-64 overflow-hidden rounded-full bg-muted" aria-hidden>
    <i
      className={`block h-full rounded-full ${apagada ? "bg-border-strong" : "bg-primary"}`}
      style={{ width: `${Math.max(2, Math.round(pct))}%` }}
    />
  </div>
);

/** O cartão do topo: quantos itens, em quantos negócios, quantos sem item. */
export function CartaoDosVendidos({ dados }: { dados: ProdutoNoRelatorio }) {
  const t = useT();
  const palavra = usePalavraDoProduto(dados.palavra);
  const v = dados.vendidos;
  return (
    <div className="rounded-md border p-4" data-testid="cartao-dos-vendidos">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {t("{produtos} vendidos").replace("{produtos}", palavra.P)}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{quantidadeLegivel(v.total.quantidade)}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("em {n} negócios · {m} sem {produto}")
          .replace("{n}", String(v.negociosComItem))
          .replace("{m}", String(v.sem.negocios))
          .replace("{produto}", palavra.s)}
      </p>
    </div>
  );
}

export function QuadrosDoProdutoNoRelatorio({ dados }: { dados: ProdutoNoRelatorio }) {
  const t = useT();
  const dias = useDias();
  const palavra = usePalavraDoProduto(dados.palavra);
  const v = dados.vendidos;
  const maiorValor = Math.max(1, ...v.linhas.map((l) => l.valorCents));
  const tempo = dados.tempo;
  const maiorMediana = Math.max(1, ...tempo.linhas.map((l) => l.medianaDias), tempo.sem?.medianaDias ?? 0);
  const th = "px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  const thNum = `${th} text-right`;
  const td = "border-b border-border px-2 py-2 align-top";
  const tdNum = `${td} text-right tabular-nums whitespace-nowrap`;

  return (
    <>
      <div className="rounded-md border p-4" data-testid="quadro-vendidos-no-mes">
        <p className="text-sm font-medium">{t("{produtos} vendidos no mês").replace("{produtos}", palavra.P)}</p>
        {v.total.negocios === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t("Nenhuma venda no mês.")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>{palavra.S}</th>
                  <th className={thNum}>{t("Qtd")}</th>
                  <th className={thNum}>{t("Negócios")}</th>
                  <th className={thNum}>{t("Valor")}</th>
                </tr>
              </thead>
              <tbody>
                {v.linhas.map((l) => (
                  <tr key={l.chave}>
                    <td className={td}>
                      {l.nome}
                      <Barra pct={(l.valorCents / maiorValor) * 100} />
                    </td>
                    <td className={tdNum}>{quantidadeLegivel(l.quantidade)}</td>
                    <td className={tdNum}>{l.negocios}</td>
                    <td className={tdNum}>{formatCentsBRL(l.valorCents)}</td>
                  </tr>
                ))}
                {v.sem.negocios > 0 ? (
                  <tr className="text-muted-foreground">
                    <td className={td}>
                      {t("Sem {produto}").replace("{produto}", palavra.s)}
                      <small className="block text-xs">
                        {t("negócios de antes, ainda sem {produto} escolhido").replace("{produto}", palavra.s)}
                      </small>
                    </td>
                    <td className={tdNum}>-</td>
                    <td className={tdNum}>{v.sem.negocios}</td>
                    <td className={tdNum}>{formatCentsBRL(v.sem.valorCents)}</td>
                  </tr>
                ) : null}
                {v.ajuste.negocios > 0 ? (
                  <tr className="text-muted-foreground">
                    <td className={td}>
                      {t("Ajuste do valor digitado à mão")}
                      <small className="block text-xs">
                        {(v.ajuste.negocios === 1
                          ? t("{n} negócio fechou por um valor diferente da soma")
                          : t("{n} negócios fecharam por um valor diferente da soma")
                        ).replace("{n}", String(v.ajuste.negocios))}
                      </small>
                    </td>
                    <td className={tdNum}>-</td>
                    <td className={tdNum}>{v.ajuste.negocios}</td>
                    <td className={tdNum}>
                      {v.ajuste.valorCents < 0 ? "-" : "+"}
                      {formatCentsBRL(Math.abs(v.ajuste.valorCents))}
                    </td>
                  </tr>
                ) : null}
                {v.recorrente.negocios > 0 ? (
                  <tr className="text-muted-foreground">
                    <td className={td}>
                      {t("Valor recorrente (mensal)")}
                      <small className="block text-xs">
                        {t("a mensalidade dos negócios, fora da soma dos {produtos}").replace("{produtos}", palavra.p)}
                      </small>
                    </td>
                    <td className={tdNum}>-</td>
                    <td className={tdNum}>{v.recorrente.negocios}</td>
                    <td className={tdNum}>{formatCentsBRL(v.recorrente.valorCents)}</td>
                  </tr>
                ) : null}
                <tr className="font-semibold">
                  <td className="border-t-2 border-border-strong px-2 py-2">{t("Total, igual à Receita do mês")}</td>
                  <td className="border-t-2 border-border-strong px-2 py-2 text-right tabular-nums">
                    {quantidadeLegivel(v.total.quantidade)}
                  </td>
                  <td className="border-t-2 border-border-strong px-2 py-2 text-right tabular-nums">{v.total.negocios}</td>
                  <td className="border-t-2 border-border-strong px-2 py-2 text-right tabular-nums">
                    {formatCentsBRL(v.total.valorCents)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {t(
            "Quantidade soma as unidades: dois itens iguais contam 2. Negócios conta cada negócio fechado uma vez; o negócio com dois {produtos} aparece nos dois. O valor de cada linha é preço × quantidade, menos o desconto.",
          ).replace("{produtos}", palavra.p)}
        </p>
      </div>

      <div className="rounded-md border p-4" data-testid="quadro-tempo-ate-fechar">
        <p className="text-sm font-medium">{t("Tempo até fechar por {produto}").replace("{produto}", palavra.s)}</p>
        {tempo.linhas.length === 0 && !tempo.sem ? (
          <p className="mt-1 text-sm text-muted-foreground">{t("Nenhuma venda no mês.")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>{palavra.S}</th>
                  <th className={thNum}>{t("Vendas")}</th>
                  <th className={thNum}>{t("Mediana")}</th>
                  <th className={thNum}>{t("Média")}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...tempo.linhas.map((l) => ({ ...l, fraca: false })),
                  ...(tempo.sem
                    ? [{ ...tempo.sem, chave: "-", nome: t("Sem {produto}").replace("{produto}", palavra.s), fraca: true }]
                    : []),
                ].map((l) => (
                  <tr key={l.chave} className={l.fraca ? "text-muted-foreground" : undefined}>
                    <td className={td}>
                      {l.nome}
                      {l.poucas ? (
                        <small className="block text-xs text-muted-foreground">
                          {t("poucas vendas no mês para tirar conclusão")}
                        </small>
                      ) : null}
                      <Barra pct={(l.medianaDias / maiorMediana) * 100} apagada={l.fraca} />
                    </td>
                    <td className={tdNum}>{l.vendas}</td>
                    <td className={tdNum}>{dias(l.medianaDias)}</td>
                    <td className={tdNum}>{dias(l.mediaDias)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {t(
            "Do dia em que o negócio nasceu até o dia em que fechou, a mesma conta do Ciclo de venda. A mediana mostra o caso típico; a média sobe quando um negócio se arrasta. Com menos de 3 vendas no mês, a linha avisa que é pouco para tirar conclusão.",
          )}
        </p>
      </div>
    </>
  );
}
