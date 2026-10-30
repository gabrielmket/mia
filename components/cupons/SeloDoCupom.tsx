"use client";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { textoDoBeneficio, type CupomParaRegra } from "@/lib/cupons/regras";

/**
 * FORK MIA (.98) · O SELO "Cupom X aplicado: o que dá. Indicação de quem."
 * (protótipo "Cupons e parceiros", tela 1), na página de preços, no cadastro e
 * no passo do pagamento.
 */
export function SeloDoCupom({
  codigo,
  cupom,
  parceiro,
  aoTirar,
  ocupado = false,
}: {
  codigo: string;
  cupom: Pick<CupomParaRegra, "beneficio" | "valor" | "meses">;
  parceiro: string | null;
  aoTirar?: () => void;
  ocupado?: boolean;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary bg-muted/40 px-3 py-2 text-sm" data-cupom="selo">
      <span>
        {t("Cupom")} <b className="font-mono">{codigo}</b> {t("aplicado:")} {textoDoBeneficio(cupom, t)}
        {parceiro ? `. ${t("Indicação de {nome}.").replace("{nome}", parceiro)}` : "."}
      </span>
      {aoTirar ? (
        <Button type="button" variant="outline" size="sm" disabled={ocupado} onClick={aoTirar} data-cupom="tirar">
          {t("Tirar o cupom")}
        </Button>
      ) : null}
    </div>
  );
}
