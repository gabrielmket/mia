"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { copyToClipboard } from "@/lib/clipboard";
import { reais } from "@/lib/cupons/regras";
import type { PassoDoPagamento } from "@/lib/pagamento-inicial/tipos";

interface Resposta {
  data?: { passo?: PassoDoPagamento };
  error?: { message?: string };
}

/**
 * FORK MIA (.98) · "Quero que a Time implante para mim" (decisão 10 do protótipo
 * "Cupons e parceiros"): venda única e opcional, no passo do pagamento. Marcar
 * gera uma cobrança AVULSA no Asaas, com o Pix na tela e a fatura (boleto ou
 * cartão); pagando a mensalidade com cartão na tela, o setup sai no mesmo cartão.
 * Desmarcar antes de pagar cancela a cobrança. A liberação da empresa é da
 * mensalidade, nunca do setup.
 */
export function SetupNoPasso({
  passo,
  aoAtualizar,
  teste,
}: {
  passo: PassoDoPagamento;
  aoAtualizar: (p: PassoDoPagamento) => void;
  teste: boolean;
}) {
  const t = useT();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const s = passo.setup;
  if (!s || (!s.oferecido && s.situacao === null)) return null;

  async function chamar(acao: "pedir" | "desistir" | "conferir") {
    setErro(null);
    setAviso(null);
    setOcupado(true);
    try {
      const r = await fetch("/api/v1/cobranca/pagamento-inicial/setup", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acao }),
      });
      const lido = ((await r.json().catch(() => ({}))) ?? {}) as Resposta;
      if (lido.data?.passo) aoAtualizar(lido.data.passo);
      if (!r.ok) setErro(lido.error?.message ?? t("Não deu para salvar. Tente de novo."));
    } catch {
      setErro(t("Não deu para falar com o servidor. Confira a conexão e tente de novo."));
    } finally {
      setOcupado(false);
    }
  }

  const marcado = s.situacao === "aguardando" || s.situacao === "pago" || s.situacao === "cortesia";
  const travado = s.situacao === "pago" || s.situacao === "cortesia";
  const preco =
    s.desconto_cents > 0 ? (
      <>
        <span className="text-muted-foreground line-through">{reais(s.preco_cents)}</span> {reais(s.valor_cents)}
      </>
    ) : (
      reais(s.valor_cents)
    );

  return (
    <div className="space-y-3 rounded-md border p-3" data-cupom="setup">
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={marcado}
          disabled={ocupado || travado}
          onChange={(ev) => void chamar(ev.target.checked ? "pedir" : "desistir")}
          data-cupom="setup-marcar"
        />
        <span>
          <b>{t("Quero que a Time implante para mim")}</b>
          <span className="block text-xs text-muted-foreground">
            {t("Setup de implantação, pagamento único:")} {preco}
            {s.desconto_cents > 0 && passo.cupom ? ` ${t("com o cupom {codigo}").replace("{codigo}", passo.cupom.codigo)}` : ""}
          </span>
        </span>
      </label>
      {s.situacao === "pago" ? (
        <p className="text-sm text-success-fg" role="status">
          {t("Setup pago. A Time entra em contato para combinar a implantação.")}
        </p>
      ) : null}
      {s.situacao === "cortesia" ? (
        <p className="text-sm text-success-fg" role="status">
          {t("Com este cupom, o setup sai sem custo. A Time entra em contato para combinar a implantação.")}
        </p>
      ) : null}
      {s.situacao === "aguardando" ? (
        <div className="space-y-2" data-cupom="setup-cobranca">
          {teste ? <p className="text-xs text-muted-foreground">{t("O setup é cobrado agora. A mensalidade continua só no fim do teste.")}</p> : null}
          {s.pix ? (
            <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
              {s.pix.qr ? (
                // eslint-disable-next-line @next/next/no-img-element -- QR desenhado no servidor, em data URL.
                <img src={s.pix.qr} alt={t("QR Code do Pix do setup")} className="h-36 w-36 rounded-md border bg-white p-2" />
              ) : null}
              <div className="min-w-0 space-y-2">
                <p className="text-sm">{t("Pix do setup, separado do da mensalidade.")}</p>
                <div className="flex gap-2">
                  <Input readOnly value={s.pix.copia_e_cola} className="font-mono text-xs" aria-label={t("Pix copia e cola do setup")} />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void copyToClipboard(s.pix?.copia_e_cola ?? "").then((ok) => setAviso(ok ? t("Pix copia e cola copiado.") : t("Selecione o texto e copie.")))}
                  >
                    {t("Copiar")}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {s.fatura_url ? (
              <Button asChild variant="outline" size="sm">
                <a href={s.fatura_url} target="_blank" rel="noopener noreferrer">
                  {t("Pagar por boleto ou cartão")}
                </a>
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" disabled={ocupado} onClick={() => void chamar("conferir")} data-cupom="setup-conferir">
              {t("Já paguei o setup")}
            </Button>
          </div>
          {!teste ? <p className="text-xs text-muted-foreground">{t("Pagando a mensalidade com cartão nesta tela, o setup sai no mesmo cartão.")}</p> : null}
        </div>
      ) : null}
      {aviso ? (
        <p className="text-xs text-muted-foreground" role="status">
          {aviso}
        </p>
      ) : null}
      {erro ? (
        <p className="text-xs text-destructive" role="alert">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
