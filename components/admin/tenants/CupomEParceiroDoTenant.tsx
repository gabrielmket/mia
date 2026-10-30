"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { CopiarLinkDePagamento } from "@/components/admin/cobranca/CopiarLinkDePagamento";
import { gravar } from "@/components/admin/parceiros/chamada";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import type { CupomEParceiroDaEmpresa } from "@/lib/cupons/na-ficha";
import { reais } from "@/lib/cupons/regras";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";

const ROTULO_DO_SETUP: Record<string, string> = {
  aguardando: "aguardando o pagamento",
  pago: "pago",
  cortesia: "cortesia do cupom",
  cancelado: "cancelado",
  estornado: "estornado",
};

/**
 * FORK MIA (.98) · O CUPOM E O PARCEIRO NA FICHA DA EMPRESA (decisão 5 do protótipo
 * "Cupons e parceiros"). O cliente fica ligado ao parceiro pelo cupom da primeira
 * mensalidade; aqui a Time troca o cupom ou o parceiro, com a verificação em duas
 * etapas e o Audit Log. Mais o setup de implantação vendido e as comissões.
 */
export function CupomEParceiroDoTenant({
  orgId,
  dados,
  parceiros,
}: {
  orgId: string;
  dados: CupomEParceiroDaEmpresa;
  parceiros: ReadonlyArray<{ id: string; nome: string }>;
}) {
  const t = useT();
  const idioma = useIdioma();
  const router = useRouter();
  const [codigo, setCodigo] = useState("");
  const [parceiro, setParceiro] = useState(dados.parceiro?.id ?? "");
  const [ocupado, setOcupado] = useState(false);
  const dia = (iso: string | null) => (iso ? new Intl.DateTimeFormat(idioma, { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso)) : "-");

  async function enviar(corpo: unknown, pronto: string) {
    setOcupado(true);
    const r = await gravar(`/api/v1/admin/tenants/${orgId}/cupom-e-parceiro`, "PUT", corpo, t);
    setOcupado(false);
    if (!r.ok) {
      toast.error(r.mensagem);
      return;
    }
    toast.success(pronto);
    setCodigo("");
    router.refresh();
  }

  const c = dados.cupom;
  const p = dados.parceiro;
  return (
    <Card className="space-y-4 p-6" data-cupons="ficha-da-empresa">
      <h2 className="text-sm font-semibold">{t("Cupom e parceiro")}</h2>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">{t("Cupom")}</dt>
        <dd>
          {c ? (
            <>
              <b className="font-mono">{c.codigo}</b> · {c.o_que_da}
              <span className="block text-xs text-muted-foreground">
                {c.setup} · {t("desde {data}").replace("{data}", dia(c.aplicado_em))}
                {c.desconto_encerrado_em ? ` · ${t("o desconto já acabou em {data}").replace("{data}", dia(c.desconto_encerrado_em))}` : ""}
              </span>
            </>
          ) : (
            t("sem cupom")
          )}
        </dd>
        <dt className="text-muted-foreground">{t("Parceiro")}</dt>
        <dd>
          {p ? (
            <>
              {p.nome}
              <span className="block text-xs text-muted-foreground">
                {p.termos_fixados_em
                  ? t("Comissão fixada: {pct}% da mensalidade ({prazo}) e {setup}% do setup.")
                      .replace("{pct}", String(p.comissao_pct ?? 0).replace(".", ","))
                      .replace("{prazo}", p.comissao_meses === null ? t("enquanto pagar") : t("{n} meses").replace("{n}", String(p.comissao_meses)))
                      .replace("{setup}", String(p.comissao_setup_pct ?? 0).replace(".", ","))
                  : t("A comissão fica fixada no primeiro pagamento.")}
              </span>
            </>
          ) : (
            t("sem parceiro")
          )}
        </dd>
        <dt className="text-muted-foreground">{t("Setup de implantação")}</dt>
        <dd>
          {dados.setup ? (
            <>
              {reais(dados.setup.valor_cents)} · {t(ROTULO_DO_SETUP[dados.setup.situacao] ?? "aguardando o pagamento")}
              {dados.setup.nota_erro === "sem_configuracao" ? (
                <span className="block text-xs text-warning-fg">{t("Sem o serviço do setup na Conexão, a nota dele não sai sozinha.")}</span>
              ) : null}
            </>
          ) : (
            t("não pediu")
          )}
          {/* A Time também vende o setup por link (decisão 10). */}
          <span className="mt-1 flex flex-wrap items-center gap-2">
            {dados.setup?.link ? <CopiarLinkDePagamento link={dados.setup.link} /> : null}
            {!dados.setup || dados.setup.situacao === "cancelado" ? (
              <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void enviar({ setup: true }, t("Cobrança do setup gerada."))} data-cupons="gerar-link-do-setup">
                {t("Gerar o link do setup")}
              </Button>
            ) : null}
          </span>
        </dd>
        <dt className="text-muted-foreground">{t("Comissões lançadas")}</dt>
        <dd>
          {dados.comissoes.lancadas} · {reais(dados.comissoes.total_cents)}
        </dd>
      </dl>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="ficha-cupom" className="text-xs font-medium">
            {c ? t("Trocar o cupom") : t("Aplicar um cupom")}
          </label>
          <div className="flex gap-2">
            <Input id="ficha-cupom" className="uppercase" value={codigo} maxLength={40} onChange={(e) => setCodigo(e.target.value)} />
            <Button size="sm" variant="outline" disabled={ocupado || codigo.trim() === ""} onClick={() => void enviar({ codigo }, t("Cupom salvo."))}>
              {t("Salvar")}
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ficha-parceiro" className="text-xs font-medium">
            {t("Trocar o parceiro")}
          </label>
          <div className="flex gap-2">
            <select id="ficha-parceiro" className="h-10 w-full rounded-md border bg-background px-3 text-sm" disabled={!c} value={parceiro} onChange={(e) => setParceiro(e.target.value)}>
              <option value="">{t("Sem parceiro")}</option>
              {parceiros.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" disabled={ocupado || !c || parceiro === (p?.id ?? "")} onClick={() => void enviar({ parceiro_id: parceiro || null }, t("Parceiro trocado."))}>
              {t("Salvar")}
            </Button>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("O parceiro novo recebe comissão só dos pagamentos a partir de hoje, com a comissão dele. O que já foi lançado para o anterior fica com ele. Fica no Audit Log.")}
      </p>
    </Card>
  );
}
