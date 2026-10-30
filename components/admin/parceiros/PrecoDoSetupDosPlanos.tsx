"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";

import { gravar, numeroDigitado } from "./chamada";

/**
 * FORK MIA (.98) · O PREÇO DO SETUP DE IMPLANTAÇÃO DE CADA PLANO (Admin › Cobrança ›
 * Módulos dos planos; decisão 10). Venda única e opcional, no passo do pagamento.
 * Sem preço, o plano não oferece. Componente próprio, ao lado dos módulos: quem já
 * pediu fica com o preço do dia do pedido.
 */
export function PrecoDoSetupDosPlanos({ planos }: { planos: ReadonlyArray<{ id: string; nome: string; setup_cents: number | null }> }) {
  const t = useT();
  const router = useRouter();
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const inicial = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2).replace(".", ","));

  async function salvar(id: string, valor: string) {
    const reais = numeroDigitado(valor);
    if (valor.trim() !== "" && (reais === null || reais < 0)) {
      toast.error(t("Preço do setup inválido."));
      return;
    }
    setOcupado(id);
    const r = await gravar(`/api/v1/admin/planos-mia/${id}/setup`, "PUT", { preco_cents: reais === null ? null : Math.round(reais * 100) }, t);
    setOcupado(null);
    if (!r.ok) {
      toast.error(r.mensagem);
      return;
    }
    toast.success(t("Preço do setup salvo."));
    router.refresh();
  }

  if (planos.length === 0) return null;
  return (
    <Card className="space-y-4 p-6" data-cupons="preco-do-setup">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{t("Setup de implantação de cada plano")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Venda única e opcional: o cliente marca \"Quero que a Time implante para mim\" no passo do pagamento e paga uma cobrança separada da mensalidade. Vazio: o plano não oferece.")}
        </p>
      </div>
      <div className="space-y-2">
        {planos.map((p) => {
          const valor = rascunho[p.id] ?? inicial(p.setup_cents);
          return (
            <div key={p.id} className="flex flex-wrap items-center gap-3" data-plano-setup={p.id}>
              <span className="min-w-40 flex-1 text-sm font-medium">{p.nome}</span>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                {t("Setup (R$)")}
                <Input className="w-32" inputMode="decimal" placeholder="1.500,00" value={valor} onChange={(e) => setRascunho((x) => ({ ...x, [p.id]: e.target.value }))} />
              </label>
              <Button size="sm" variant="outline" disabled={ocupado === p.id} onClick={() => void salvar(p.id, valor)}>
                {t("Salvar")}
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
