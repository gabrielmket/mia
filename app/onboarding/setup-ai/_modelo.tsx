"use client";

/**
 * FORK MIA (.91) — o MODELO DO SEGMENTO no passo "Treinar".
 *
 * Duas peças: o aviso de onde o texto parte (o agente de exemplo da
 * demonstração do segmento, com o link para trocar o segmento) e o que o
 * modelo ensina a ele. As frases desta lista SÃO as frases do texto do agente
 * (lib/onboarding/modelos-de-agente-da-mia.ts): a tela não promete o que o
 * texto não diz. As conferências antes de cada mensagem continuam no bloco do
 * upstream ("E nunca vai fazer"), que vem do runtime.
 *
 * As frases do modelo saem como estão, sem `t()`: são o texto que vai para o
 * agente (em português, a língua em que ele atende), e não interface.
 */
import Link from "next/link";

import { useT } from "@/hooks/i18n/useT";

export interface ModeloNaTela {
  segmento: string;
  rotulo: string;
  curto: string;
  nome: string;
  jeito: "ecommerce_friendly" | "ecommerce_professional" | "support_minimal";
  regrasDeExemplo: string[];
  faz: string[];
  naoFaz: string[];
}

export function AvisoDoModelo({ modelo }: { modelo: ModeloNaTela }) {
  const t = useT();
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-4 text-sm" data-testid="modelo-do-segmento">
      <p>
        {t("Modelo do segmento:")} <strong>{t(modelo.rotulo)}</strong>.{" "}
        {t("O texto de partida é o do agente de exemplo da demonstração de")} {t(modelo.curto)}.{" "}
        <Link href="/onboarding/welcome" className="underline">
          {t("Trocar o segmento")}
        </Link>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("A inteligência é da MIA: você não precisa de chave nem de conta em provedor nenhum.")}
      </p>
    </div>
  );
}

export function OQueOModeloEnsina({ modelo }: { modelo: ModeloNaTela }) {
  const t = useT();
  return (
    <section className="rounded-lg border bg-background p-4">
      <h3 className="text-sm font-medium">
        {t("O que o modelo de")} {t(modelo.curto)} {t("ensina a ele")}
      </h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <ul className="space-y-1 text-xs text-muted-foreground">
          {modelo.faz.map((f) => (
            <li key={f}>· {f}</li>
          ))}
        </ul>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {modelo.naoFaz.map((f) => (
            <li key={f}>· {f}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
