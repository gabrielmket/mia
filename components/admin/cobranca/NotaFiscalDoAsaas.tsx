"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { MENSAGEM_DA_RECUSA_DE_ESCRITA } from "@/lib/auth/recusa-de-escrita-de-admin";
import type { ConfiguracaoDaNota } from "@/lib/asaas-mia/cobrancas";

const IMPOSTOS = [
  ["iss", "ISS (%)"],
  ["pis", "PIS (%)"],
  ["cofins", "COFINS (%)"],
  ["csll", "CSLL (%)"],
  ["inss", "INSS (%)"],
  ["ir", "IR (%)"],
] as const;

/**
 * FORK MIA (.96) · Admin › Cobrança › Conexão: a nota fiscal pelo Asaas, SÓ
 * DEPOIS do pagamento confirmado (decisão 8 do protótipo "Pagamento no
 * início"), e o lembrete do que conferir no painel do Asaas. A configuração
 * vai para cada assinatura (`invoiceSettings` com `ON_PAYMENT_CONFIRMATION`) na
 * rodada horária da cobrança (lib/pagamento-inicial/rodada.ts).
 */
export function NotaFiscalDoAsaas({ inicial, ehAsaas }: { inicial: ConfiguracaoDaNota | null; ehAsaas: boolean }) {
  const t = useT();
  const [c, setC] = useState({
    servicoMunicipalId: inicial?.servicoMunicipalId ?? "",
    servicoMunicipalCodigo: inicial?.servicoMunicipalCodigo ?? "",
    servicoMunicipalNome: inicial?.servicoMunicipalNome ?? "",
    observacoes: inicial?.observacoes ?? "",
    reterIss: inicial?.impostos.reterIss ?? false,
    iss: String(inicial?.impostos.iss ?? 0),
    pis: String(inicial?.impostos.pis ?? 0),
    cofins: String(inicial?.impostos.cofins ?? 0),
    csll: String(inicial?.impostos.csll ?? 0),
    inss: String(inicial?.impostos.inss ?? 0),
    ir: String(inicial?.impostos.ir ?? 0),
  });
  const [salvo, setSalvo] = useState(inicial !== null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    setMsg(null);
    setOcupado(true);
    try {
      const numero = (v: string) => Number(v.replace(",", "."));
      const r = await fetch("/api/v1/admin/cobranca/nota-fiscal", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          servicoMunicipalId: c.servicoMunicipalId,
          servicoMunicipalCodigo: c.servicoMunicipalCodigo,
          servicoMunicipalNome: c.servicoMunicipalNome,
          observacoes: c.observacoes,
          impostos: {
            reterIss: c.reterIss,
            iss: numero(c.iss),
            pis: numero(c.pis),
            cofins: numero(c.cofins),
            csll: numero(c.csll),
            inss: numero(c.inss),
            ir: numero(c.ir),
          },
        }),
      });
      const corpo = (await r.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      if (!r.ok) {
        const codigo = corpo.error?.code ?? "";
        setMsg(
          codigo in MENSAGEM_DA_RECUSA_DE_ESCRITA
            ? t(MENSAGEM_DA_RECUSA_DE_ESCRITA[codigo as keyof typeof MENSAGEM_DA_RECUSA_DE_ESCRITA])
            : (corpo.error?.message ?? t("Não foi possível salvar. Tente de novo.")),
        );
        return;
      }
      setSalvo(true);
      setMsg(t("Salvo. As assinaturas recebem a configuração na próxima rodada da cobrança (de hora em hora)."));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card className="space-y-4 p-4" data-pagamento="nota-fiscal-do-asaas">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{t("Nota fiscal pelo Asaas, na confirmação do pagamento")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("A nota de serviço sai pelo Asaas só quando o pagamento confirma: Pix vencido, boleto cancelado e cobrança refeita nunca geram nota. Ela é emitida em nome dos dados fiscais que a empresa preencheu.")}
        </p>
        {!ehAsaas ? <p className="text-xs text-muted-foreground">{t("Vale para o Asaas. Com outro provedor, nada é enviado.")}</p> : null}
        {!salvo ? (
          <p className="rounded-md border border-warning-fg/30 bg-warning-bg px-3 py-2 text-sm text-warning-fg">
            {t("Sem esta configuração, o Asaas não emite nota sozinho para as assinaturas.")}
          </p>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="nota-servico-codigo">{t("Código do serviço na prefeitura")}</Label>
          <Input id="nota-servico-codigo" value={c.servicoMunicipalCodigo} onChange={(e) => setC({ ...c, servicoMunicipalCodigo: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nota-servico-id">
            {t("Id do serviço no Asaas")} <span className="font-normal text-muted-foreground">{t("(opcional)")}</span>
          </Label>
          <Input id="nota-servico-id" value={c.servicoMunicipalId} onChange={(e) => setC({ ...c, servicoMunicipalId: e.target.value })} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="nota-servico-nome">{t("Descrição do serviço")}</Label>
        <Input id="nota-servico-nome" value={c.servicoMunicipalNome} onChange={(e) => setC({ ...c, servicoMunicipalNome: e.target.value })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {IMPOSTOS.map(([k, rotulo]) => (
          <div key={k} className="space-y-1.5">
            <Label htmlFor={`nota-${k}`}>{rotulo}</Label>
            <Input id={`nota-${k}`} inputMode="decimal" value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={c.reterIss} onChange={(e) => setC({ ...c, reterIss: e.target.checked })} />
        {t("Reter o ISS")}
      </label>
      <div className="space-y-1.5">
        <Label htmlFor="nota-observacoes">
          {t("Observações da nota")} <span className="font-normal text-muted-foreground">{t("(opcional)")}</span>
        </Label>
        <Input id="nota-observacoes" value={c.observacoes} onChange={(e) => setC({ ...c, observacoes: e.target.value })} />
      </div>
      <Button size="sm" disabled={ocupado} onClick={() => void salvar()}>
        {t("Salvar a nota fiscal")}
      </Button>
      {msg ? (
        <p className="text-xs text-muted-foreground" role="status">
          {msg}
        </p>
      ) : null}
      <div className="space-y-1 rounded-md border p-3 text-sm" data-pagamento="lembrete-do-painel-do-asaas">
        <p className="font-medium">{t("Confira no painel do Asaas")}</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            {t("Os avisos de cobrança do Asaas para os seus clientes estão DESLIGADOS (e-mail, SMS e WhatsApp). Quem avisa é este sistema: o lembrete, o \"Pagamento confirmado\" e a régua. O sistema já pede ao Asaas, cliente por cliente, que não mande os dele; confira também a configuração geral da conta.")}
          </li>
          <li>
            {t("A emissão de nota fiscal está ligada no Asaas, com o seu contador, e a nota sai na confirmação do pagamento, não na criação da cobrança.")}
          </li>
        </ul>
      </div>
    </Card>
  );
}
