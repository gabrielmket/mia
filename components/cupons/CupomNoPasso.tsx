"use client";

import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { reais, textoDoPeriodo } from "@/lib/cupons/regras";
import type { PassoDoPagamento } from "@/lib/pagamento-inicial/tipos";

import { CampoDoCupom } from "./CampoDoCupom";
import { SeloDoCupom } from "./SeloDoCupom";

interface Resposta {
  data?: { passo?: PassoDoPagamento };
  error?: { message?: string };
}

/**
 * FORK MIA (.98) · O CUPOM NO PASSO "PAGAMENTO" (protótipo "Cupons e parceiros",
 * tela 1): o selo, o preço riscado e até quando vale, ou o campo "Tenho um
 * cupom". Antes de pagar, dá para pôr e tirar (uma cobrança já gerada é refeita
 * com o valor novo). Depois de pago, só a Time troca.
 */
export function CupomNoPasso({ passo, aoAtualizar }: { passo: PassoDoPagamento; aoAtualizar: (p: PassoDoPagamento) => void }) {
  const t = useT();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function chamar(metodo: "POST" | "DELETE", corpo?: unknown) {
    setErro(null);
    setOcupado(true);
    try {
      const r = await fetch("/api/v1/cobranca/pagamento-inicial/cupom", {
        method: metodo,
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
      const lido = ((await r.json().catch(() => ({}))) ?? {}) as Resposta;
      if (lido.data?.passo) aoAtualizar(lido.data.passo);
      if (!r.ok) setErro(lido.error?.message ?? t("Não deu para aplicar o cupom. Tente de novo."));
    } catch {
      setErro(t("Não deu para falar com o servidor. Confira a conexão e tente de novo."));
    } finally {
      setOcupado(false);
    }
  }

  const c = passo.cupom;
  if (!c) {
    if (passo.pago) return null;
    return <CampoDoCupom aoAplicar={(codigo) => chamar("POST", { codigo })} erro={erro} ocupado={ocupado} prefixo="passo-cupom" />;
  }
  const cheio = c.preco_cheio_cents;
  const comDesconto = c.primeira_mensalidade_cents;
  return (
    <div className="space-y-1">
      <SeloDoCupom
        codigo={c.codigo}
        cupom={{ beneficio: c.beneficio, valor: c.valor, meses: c.meses }}
        parceiro={c.parceiro}
        aoTirar={passo.pago ? undefined : () => void chamar("DELETE")}
        ocupado={ocupado}
      />
      {c.vale_no_plano && c.beneficio !== "dias" && cheio !== null && comDesconto !== null && comDesconto < cheio ? (
        <p className="text-xs text-muted-foreground" data-cupom="preco">
          <span className="line-through">{reais(cheio)}</span> {reais(comDesconto)} {textoDoPeriodo(c, t)}
          {c.meses !== null ? `. ${t("Depois, o valor volta a {valor}. A cobrança avisa antes.").replace("{valor}", reais(cheio))}` : ""}
        </p>
      ) : null}
      {!c.vale_no_plano ? <p className="text-xs text-muted-foreground">{t("Este cupom não vale no plano atual: a mensalidade fica no preço cheio.")}</p> : null}
      {erro ? (
        <p className="text-xs text-destructive" role="alert">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
