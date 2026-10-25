"use client";

import type { UseFormRegisterReturn } from "react-hook-form";

import { useT } from "@/hooks/i18n/useT";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import { ROTULO_DO_MODULO_DO_PLANO } from "@/lib/planos-mia/catalogo";
import type { CartaoDoPlano } from "@/lib/planos-mia/cadastro";

/**
 * FORK MIA (.90) — os planos do cadastro em cartões (protótipo de 25/10/2026,
 * tela 2): limites, módulos e "cerca de N conversas", nunca dólar. O valor
 * escolhido é o mesmo campo `cobranca_plan_id` do seletor do upstream, e quem o
 * confere é a action do cadastro.
 */
export function CartoesDoPlano({
  cartoes,
  registro,
  veioDoLink,
}: {
  cartoes: readonly CartaoDoPlano[];
  registro: UseFormRegisterReturn<"cobranca_plan_id">;
  veioDoLink: boolean;
}) {
  const t = useT();
  const idioma = useIdioma();
  const brl = new Intl.NumberFormat(idioma, {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
  const numero = new Intl.NumberFormat(idioma);
  return (
    <fieldset className="space-y-2" aria-describedby="planos-do-cadastro-ajuda">
      <legend className="text-sm font-medium">{t("Plano")}</legend>
      <div className="space-y-2">
        {cartoes.map((c) => {
          const detalhes = [
            c.numeros === null
              ? t("números sem limite")
              : c.numeros === 1
                ? t("1 número")
                : t("{n} números").replace("{n}", String(c.numeros)),
            c.pessoas === null
              ? t("pessoas sem limite")
              : t("até {n} pessoas").replace("{n}", String(c.pessoas)),
            c.conversas === null
              ? t("conversas com IA sem limite")
              : t("cerca de {n} conversas").replace("{n}", numero.format(c.conversas)),
            ...c.modulos.map((m) => t(ROTULO_DO_MODULO_DO_PLANO[m].rotulo)),
          ];
          return (
            <label
              key={c.id}
              className="flex cursor-pointer items-start gap-3 rounded-md border bg-background p-3 has-[:checked]:border-primary has-[:checked]:bg-muted/40"
              data-plano-do-cadastro={c.id}
            >
              <input type="radio" value={c.id} className="mt-1" {...registro} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {c.nome}
                  {c.padrao && (
                    <span className="rounded-md border px-1.5 text-xs font-normal text-muted-foreground">
                      {t("padrão")}
                    </span>
                  )}
                  {c.destaque && !c.padrao && (
                    <span className="rounded-md border px-1.5 text-xs font-normal text-muted-foreground">
                      {t("Mais escolhido")}
                    </span>
                  )}
                </span>
                {c.frase && <span className="block text-xs text-muted-foreground">{c.frase}</span>}
                <span className="block text-xs text-muted-foreground">{detalhes.join(" · ")}</span>
              </span>
              <span className="shrink-0 text-right text-sm font-semibold">
                {brl.format(c.preco_cents / 100)}
                <span className="block text-xs font-normal text-muted-foreground">
                  {c.intervalo === "ano" ? t("/ano") : t("/mês")}
                </span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {c.trial_dias > 0
                    ? t("{n} dias de teste").replace("{n}", String(c.trial_dias))
                    : t("entrada paga")}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <p id="planos-do-cadastro-ajuda" className="text-xs text-muted-foreground">
        {veioDoLink
          ? t(
              "Veio da página de preços com o plano marcado. Dá para trocar aqui ou depois, no teste.",
            )
          : t("Dá para trocar de plano depois, inclusive durante o teste.")}
      </p>
    </fieldset>
  );
}
