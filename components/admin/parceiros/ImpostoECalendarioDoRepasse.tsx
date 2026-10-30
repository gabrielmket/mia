"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import type { ConfiguracaoDaComissao } from "@/lib/parceiros/regras";

import { gravar, numeroDigitado } from "./chamada";

/**
 * FORK MIA (.98) · Admin › Cobrança › Conexão: a alíquota do Simples (um campo só,
 * para todo o sistema) e os dias do calendário do repasse dos parceiros.
 */
export function ImpostoECalendarioDoRepasse({ inicial }: { inicial: ConfiguracaoDaComissao }) {
  const t = useT();
  const [c, setC] = useState({
    aliquota: inicial.aliquota_pct === null ? "" : String(inicial.aliquota_pct).replace(".", ","),
    fechamento: String(inicial.dia_fechamento),
    nota: String(inicial.dia_nota),
    pix: String(inicial.dia_pagamento),
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    setMsg(null);
    setOcupado(true);
    const r = await gravar(
      "/api/v1/admin/cobranca/comissao",
      "PUT",
      {
        aliquota_pct: numeroDigitado(c.aliquota),
        dia_fechamento: Number(c.fechamento),
        dia_nota: Number(c.nota),
        dia_pagamento: Number(c.pix),
      },
      t,
    );
    setOcupado(false);
    setMsg(r.ok ? t("Salvo. A alíquota nova vale para os pagamentos seguintes.") : r.mensagem);
  }

  return (
    <Card className="space-y-4 p-4" data-cupons="imposto-e-calendario">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{t("Comissão dos parceiros: imposto e calendário do repasse")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("A comissão é sobre o valor líquido: o que o cliente pagou, menos este imposto e menos a taxa real do Asaas em cada cobrança. A alíquota é uma só, para todo o sistema, e mudar vale para os pagamentos seguintes.")}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="comissao-aliquota">{t("Alíquota do Simples (%)")}</Label>
          <Input id="comissao-aliquota" inputMode="decimal" placeholder="10" value={c.aliquota} onChange={(e) => setC({ ...c, aliquota: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="comissao-fechamento">{t("Dia que fecha o mês")}</Label>
          <Input id="comissao-fechamento" inputMode="numeric" value={c.fechamento} onChange={(e) => setC({ ...c, fechamento: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="comissao-nota">{t("Nota ou recibo até o dia")}</Label>
          <Input id="comissao-nota" inputMode="numeric" value={c.nota} onChange={(e) => setC({ ...c, nota: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="comissao-pix">{t("Pix até o dia")}</Label>
          <Input id="comissao-pix" inputMode="numeric" value={c.pix} onChange={(e) => setC({ ...c, pix: e.target.value })} />
        </div>
      </div>
      {c.aliquota.trim() === "" ? (
        <p className="rounded-md border border-warning-fg/30 bg-warning-bg px-3 py-2 text-sm text-warning-fg">
          {t("Sem a alíquota, nenhuma comissão é lançada: lançar com imposto zero pagaria a mais.")}
        </p>
      ) : null}
      <Button size="sm" disabled={ocupado} onClick={() => void salvar()} data-cupons="salvar-imposto">
        {t("Salvar o imposto e o calendário")}
      </Button>
      {msg ? (
        <p className="text-xs text-muted-foreground" role="status">
          {msg}
        </p>
      ) : null}
    </Card>
  );
}
