"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { diaCivilFormatado, reais } from "@/lib/cupons/regras";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import type { RepasseNaTela, RepassesDoMes as Dados } from "@/lib/parceiros/leitura";
import { nomeDoMes } from "@/lib/parceiros/regras";

import { gravar } from "./chamada";

const pct = (n: number) => `${String(n).replace(".", ",")}%`;

/**
 * FORK MIA (.98) · OS REPASSES DO MÊS (protótipo "Cupons e parceiros", tela 4): a
 * conta de cada parceiro (mensalidades e setups separados, sobre o líquido, com os
 * estornos), o anexo da nota ou do recibo e o "Marcar como pago", que só libera com
 * o anexo. A Time faz o Pix por fora. A planilha do mês e os extratos por e-mail.
 */
export function RepassesDoMes({ dados }: { dados: Dados }) {
  const t = useT();
  const idioma = useIdioma();
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const dia = (iso: string) => new Intl.DateTimeFormat(idioma, { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

  async function anexar(r: RepasseNaTela, arquivo: File | undefined) {
    if (!arquivo) return;
    const form = new FormData();
    form.set("arquivo", arquivo);
    setOcupado(r.id);
    const res = await gravar(`/api/v1/admin/repasses/${r.id}/anexo`, "POST", form, t);
    setOcupado(null);
    if (!res.ok) {
      toast.error(res.mensagem);
      return;
    }
    toast.success(t("Nota ou recibo anexado ao repasse. Agora dá para marcar como pago."));
    router.refresh();
  }

  async function marcarPago(r: RepasseNaTela) {
    setOcupado(r.id);
    const res = await gravar(`/api/v1/admin/repasses/${r.id}/pago`, "POST", {}, t);
    setOcupado(null);
    if (!res.ok) {
      toast.error(res.mensagem);
      return;
    }
    toast.success(t("Repasse marcado como pago."));
    router.refresh();
  }

  async function abrirAnexo(r: RepasseNaTela) {
    const resposta = await fetch(`/api/v1/admin/repasses/${r.id}/anexo`, { credentials: "same-origin" });
    const corpo = (await resposta.json().catch(() => ({}))) as { data?: { url?: string } };
    if (corpo.data?.url) window.open(corpo.data.url, "_blank", "noopener,noreferrer");
    else toast.error(t("Não deu para abrir o anexo."));
  }

  async function extratos() {
    setOcupado("extratos");
    const res = await gravar<{ enviados: number; falhas: number }>("/api/v1/admin/repasses/extratos", "POST", { competencia: dados.competencia }, t);
    setOcupado(null);
    if (!res.ok) {
      toast.error(res.mensagem);
      return;
    }
    toast.success(t("Extratos enviados: {n}. Falhas: {f}.").replace("{n}", String(res.data.enviados)).replace("{f}", String(res.data.falhas)));
    router.refresh();
  }

  const aliquota = dados.config.aliquota_pct;
  return (
    <div className="space-y-4" data-repasses="tela">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/parceiros">{t("Voltar aos parceiros")}</Link>
        </Button>
        <label className="flex items-center gap-2 text-sm">
          {t("Mês")}
          <Input
            type="month"
            className="w-44"
            value={dados.competencia.slice(0, 7)}
            onChange={(e) => {
              if (e.target.value) router.push(`/admin/parceiros/repasses?mes=${e.target.value}-01`);
            }}
          />
        </label>
      </div>

      <Card className="space-y-3 p-4">
        <h2 className="text-lg font-semibold">{nomeDoMes(dados.competencia)}</h2>
        <div className="flex flex-wrap gap-2 text-xs" data-repasses="calendario">
          <span className="rounded-full border px-2 py-0.5">{t("Dia {d} · mês fechado e extratos enviados").replace("{d}", String(dados.config.dia_fechamento))}</span>
          <span className="rounded-full border px-2 py-0.5">{t("até {data} · notas e recibos dos parceiros").replace("{data}", diaCivilFormatado(dados.prazos.nota_ate))}</span>
          <span className="rounded-full border px-2 py-0.5">{t("até {data} · Pix e marcar como pago").replace("{data}", diaCivilFormatado(dados.prazos.pix_ate))}</span>
          <span className="text-muted-foreground">{t("Os dias são uma configuração em Admin › Cobrança.")}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {aliquota === null
            ? t("Sem a alíquota do imposto, nenhuma comissão é lançada. Preencha em Admin › Cobrança › Conexão.")
            : t("A comissão é sobre o valor líquido: o que o cliente pagou, menos o imposto (alíquota de {a}, cadastrada em Admin › Cobrança) e menos a taxa real do Asaas em cada cobrança.").replace("{a}", pct(aliquota))}
        </p>

        {dados.repasses.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Nenhum repasse neste mês.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">{t("Parceiro")}</th>
                  <th className="pr-4 text-right font-medium">{t("Mensalidades pagas e líquido")}</th>
                  <th className="pr-4 text-right font-medium">{t("Comissão das mensalidades")}</th>
                  <th className="pr-4 text-right font-medium">{t("Setups pagos e líquido")}</th>
                  <th className="pr-4 text-right font-medium">{t("Comissão dos setups")}</th>
                  <th className="pr-4 text-right font-medium">{t("Estornos")}</th>
                  <th className="pr-4 text-right font-medium">{t("Total")}</th>
                  <th className="pr-4 font-medium">{t("Nota ou recibo")}</th>
                  <th>
                    <span className="sr-only">{t("Ações")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {dados.repasses.map((r) => (
                  <tr key={r.id} className="border-t align-top" data-repasse={r.id}>
                    <td className="py-2 pr-4">
                      <b>{r.parceiro}</b>
                      <span className="block text-xs text-muted-foreground">
                        {t("Pix:")} {r.chave_pix ?? "-"}
                      </span>
                      {r.extrato_erro ? <span className="block text-xs text-destructive">{t("O extrato não saiu.")}</span> : null}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      <b>{r.totais.mensalidades}</b> · {reais(r.totais.mensalidades_pago_cents)}
                      <span className="block text-xs text-muted-foreground">
                        − {reais(r.totais.mensalidades_imposto_cents)} {t("imposto")} · − {reais(r.totais.mensalidades_taxa_cents)} {t("taxa")} = {reais(r.totais.mensalidades_liquido_cents)}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{reais(r.totais.mensalidades_comissao_cents)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {r.totais.setups > 0 ? (
                        <>
                          <b>{r.totais.setups}</b> · {reais(r.totais.setups_pago_cents)}
                          <span className="block text-xs text-muted-foreground">
                            − {reais(r.totais.setups_imposto_cents)} {t("imposto")} · − {reais(r.totais.setups_taxa_cents)} {t("taxa")} = {reais(r.totais.setups_liquido_cents)}
                          </span>
                        </>
                      ) : (
                        "·"
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{r.totais.setups > 0 ? reais(r.totais.setups_comissao_cents) : "·"}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{r.totais.estornos_cents !== 0 ? reais(r.totais.estornos_cents) : "·"}</td>
                    <td className="py-2 pr-4 text-right font-semibold tabular-nums">{reais(r.total_cents)}</td>
                    <td className="py-2 pr-4">
                      {r.anexo_removido_em ? (
                        <span className="text-xs text-muted-foreground">{t("removido (LGPD)")}</span>
                      ) : r.tem_anexo ? (
                        <button type="button" className="text-xs underline" onClick={() => void abrirAnexo(r)}>
                          {r.anexo_nome ?? t("Abrir o anexo")}
                        </button>
                      ) : (
                        <span className="text-xs text-warning-fg">{r.tipo_documento === "cnpj" ? t("aguardando nota") : t("aguardando recibo")}</span>
                      )}
                      {!r.pago_em ? (
                        <label className="mt-1 block text-xs">
                          <span className="sr-only">{t("Anexar a nota ou o recibo")}</span>
                          <input
                            type="file"
                            accept=".pdf,.xml,.png,.jpg,.jpeg"
                            disabled={ocupado === r.id}
                            className="block w-40 text-xs"
                            onChange={(e) => void anexar(r, e.target.files?.[0])}
                          />
                        </label>
                      ) : null}
                    </td>
                    <td className="py-2">
                      {r.pago_em ? (
                        <span className="text-xs text-success-fg">
                          {t("pago em {data}").replace("{data}", dia(r.pago_em))}
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          disabled={ocupado === r.id || !r.anexo_em}
                          title={r.anexo_em ? undefined : t("Anexe a nota ou o recibo antes")}
                          onClick={() => void marcarPago(r)}
                          data-repasses="marcar-pago"
                        >
                          {t("Marcar como pago")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-t pt-2">
          <span className="text-sm">{t("Total a repassar, até {data}").replace("{data}", diaCivilFormatado(dados.prazos.pix_ate))}</span>
          <b className="text-xl tabular-nums">{reais(dados.total_cents)}</b>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href={`/api/v1/admin/repasses/planilha?competencia=${dados.competencia}`}>{t("Baixar a planilha do mês")}</a>
          </Button>
          <Button variant="outline" disabled={ocupado === "extratos" || dados.repasses.length === 0} onClick={() => void extratos()} data-repasses="extratos">
            {t("Mandar os extratos por e-mail")}
          </Button>
        </div>
      </Card>

      {dados.repasses.map((r) => (
        <details key={r.id} className="rounded-md border bg-card p-3 text-sm">
          <summary className="cursor-pointer font-medium">{t("O detalhe de {nome}").replace("{nome}", r.parceiro)}</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">{t("Cliente")}</th>
                  <th className="pr-3 font-medium">{t("Tipo")}</th>
                  <th className="pr-3 font-medium">{t("Pago em")}</th>
                  <th className="pr-3 text-right font-medium">{t("Valor pago")}</th>
                  <th className="pr-3 text-right font-medium">{t("Imposto")}</th>
                  <th className="pr-3 text-right font-medium">{t("Taxa")}</th>
                  <th className="pr-3 text-right font-medium">{t("Líquido")}</th>
                  <th className="pr-3 text-right font-medium">{t("Comissão")}</th>
                </tr>
              </thead>
              <tbody>
                {r.lancamentos.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="py-1 pr-3">{l.empresa}</td>
                    <td className="pr-3">{l.tipo === "mensalidade" ? t("Mensalidade") : l.tipo === "setup" ? t("Setup") : t("Estorno")}</td>
                    <td className="pr-3">{diaCivilFormatado(l.pago_em)}</td>
                    <td className="pr-3 text-right tabular-nums">{reais(l.valor_pago_cents)}</td>
                    <td className="pr-3 text-right tabular-nums">{reais(l.imposto_cents)}</td>
                    <td className="pr-3 text-right tabular-nums">{reais(l.taxa_cents)}</td>
                    <td className="pr-3 text-right tabular-nums">{reais(l.liquido_cents)}</td>
                    <td className="pr-3 text-right tabular-nums">
                      {pct(l.comissao_pct)} · {reais(l.comissao_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}
