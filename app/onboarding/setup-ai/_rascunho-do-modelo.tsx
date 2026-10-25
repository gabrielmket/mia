"use client";

/**
 * FORK MIA (.91) — o passo "Treinar" quando o agente já existe em RASCUNHO,
 * pela proposta do assistente. Rascunho não responde ninguém: publicar põe no
 * ar, e é clique de quem administra (o protótipo: "A Clara já existe em
 * rascunho, pela proposta do assistente").
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { publicarAgenteDoModelo, seguirComORascunhoDoModelo } from "@/app/actions/onboarding/agenteDoModelo";
import { useT } from "@/hooks/i18n/useT";

export function RascunhoDoModelo({ agenteId, nome, administra }: { agenteId: string; nome: string; administra: boolean }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  return (
    <div className="space-y-4 rounded-lg border bg-background p-6" data-testid="rascunho-do-modelo">
      <div role="status" className="rounded-md border border-warning-fg/40 bg-warning-bg p-4 text-sm text-warning-fg">
        <p>
          <strong>{nome}</strong> {t("já existe em rascunho, pela proposta do assistente. Rascunho não responde ninguém: publicar põe no ar.")}
        </p>
        <p className="mt-1 text-xs">
          {t("Antes de publicar, você pode conversar com ele no passo \"Ver ele atender\". Ajustar o texto fica em Agente MIA › Agentes.")}
        </p>
      </div>

      {erro ? (
        <p role="alert" className="rounded-md bg-muted p-3 text-sm">
          {t(erro)}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => startTransition(() => void seguirComORascunhoDoModelo(agenteId))}
        >
          {t("Continuar sem publicar")}
        </Button>
        <Button
          type="button"
          disabled={pending || !administra}
          title={administra ? undefined : t("Só quem administra a empresa publica.")}
          onClick={() =>
            startTransition(async () => {
              setErro(null);
              const r = await publicarAgenteDoModelo(agenteId);
              if (r && !r.ok) {
                setErro(r.erro);
                toast.warning(t("Ainda não está no ar."));
              }
            })
          }
        >
          {pending ? t("Publicando...") : t("Publicar e continuar")}
        </Button>
      </div>
    </div>
  );
}
