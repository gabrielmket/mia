"use client";

/**
 * FORK MIA (.106) · Admin › Raio-X: o PREÇO da nova análise do raio-X por
 * cadastro (avulsa e mensal), um formulário pequeno. Sem preço ativo não há
 * venda: o pedido na área vira interesse e a equipe fala com a pessoa. A
 * escrita passa pela rota com a verificação em duas etapas.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { gravar, numeroDigitado } from "@/components/admin/parceiros/chamada";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";

export interface PrecoDoAdmin {
  tipo: "avulsa" | "mensal";
  valorCentavos: number | null;
  ativo: boolean;
}

function LinhaDoPreco({ inicial }: { inicial: PrecoDoAdmin }) {
  const t = useT();
  const router = useRouter();
  const [valor, setValor] = useState(inicial.valorCentavos === null ? "" : (inicial.valorCentavos / 100).toFixed(2).replace(".", ","));
  const [ativo, setAtivo] = useState(inicial.ativo);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const reais = valor.trim() === "" ? null : numeroDigitado(valor);
    if (valor.trim() !== "" && (reais === null || reais < 5 || reais > 10_000)) {
      toast.error(t("O preço vai de R$ 5 a R$ 10.000 (vazio tira o preço)."));
      return;
    }
    setSalvando(true);
    const r = await gravar("/api/v1/admin/raio-x/precos", "PUT", { tipo: inicial.tipo, valor_centavos: reais === null ? null : Math.round(reais * 100), ativo }, t);
    setSalvando(false);
    if (!r.ok) {
      toast.error(r.mensagem);
      return;
    }
    toast.success(t("Preço salvo."));
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-end gap-3" data-raio-x-preco={inicial.tipo}>
      <div className="space-y-1">
        <Label htmlFor={`raio-x-preco-${inicial.tipo}`}>{inicial.tipo === "avulsa" ? t("Avulsa (R$)") : t("Mensal (R$ por mês)")}</Label>
        <Input id={`raio-x-preco-${inicial.tipo}`} className="w-32" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder={t("sem preço")} />
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
        {t("vendendo")}
      </label>
      <Button type="button" size="sm" variant="outline" onClick={salvar} disabled={salvando}>
        {salvando ? t("Salvando…") : t("Salvar")}
      </Button>
    </div>
  );
}

export function PrecosDoRaioX({ precos }: { precos: PrecoDoAdmin[] }) {
  const t = useT();
  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-5" data-raio-x="precos">
      <h2 className="text-base font-semibold">{t("Preço da nova análise (cadastro)")}</h2>
      <p className="text-sm text-text-muted">
        {t("A primeira análise do cadastro é grátis. Sem preço (ou desligado), o pedido de nova análise vira interesse: a equipe fala com a pessoa. Com preço, a cobrança sai pelo Asaas da MIA.")}
      </p>
      <div className="space-y-3">
        {precos.map((p) => (
          <LinhaDoPreco key={p.tipo} inicial={p} />
        ))}
      </div>
    </section>
  );
}
