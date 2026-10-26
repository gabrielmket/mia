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
import {
  publicarAgenteDoModelo,
  seguirComORascunhoDoModelo,
  type MotivoDoNaoPublicou,
} from "@/app/actions/onboarding/agenteDoModelo";
import { useT } from "@/hooks/i18n/useT";

export function RascunhoDoModelo({ agenteId, nome, administra }: { agenteId: string; nome: string; administra: boolean }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [motivo, setMotivo] = useState<MotivoDoNaoPublicou | null>(null);

  return (
    <div className="space-y-4 rounded-lg border bg-background p-6" data-testid="rascunho-do-modelo">
      <div className="rounded-md border border-warning-fg/40 bg-warning-bg p-4 text-sm text-warning-fg">
        <p>
          <strong>{nome}</strong> {t("já existe em rascunho, pela proposta do assistente. Rascunho não responde ninguém: publicar põe no ar.")}
        </p>
        <p className="mt-1 text-xs">
          {t("Antes de publicar, você pode conversar com ele no passo \"Ver ele atender\". Ajustar o texto fica em Agente MIA › Agentes.")}
        </p>
      </div>

      {motivo ? (
        <p role="alert" className="rounded-md bg-muted p-3 text-sm">
          {motivo === "sem_numero"
            ? t("Ele ainda não tem um número de WhatsApp conectado. Conecte o número no passo \"O telefone dele\" (ou em Conexões) e publique de novo, ou siga sem publicar.")
            : motivo === "ia_da_plataforma"
              ? t("A inteligência dele é configurada pela nossa equipe e ainda não está pronta nesta conta. Pode seguir; se ele não entrar no ar, fale com o suporte.")
              : motivo === "sessao"
                ? t("Sua sessão expirou. Entre de novo.")
                : motivo === "papel"
                  ? t("Publicar o agente é de quem administra a empresa.")
                  : motivo === "registro"
                    ? t("Publiquei o agente, mas não consegui registrar o passo. Tente continuar de novo.")
                    : t("Ainda não deu para publicar. Pode seguir e publicar depois em Agente MIA › Agentes.")}
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
              setMotivo(null);
              const r = await publicarAgenteDoModelo(agenteId);
              if (r && !r.ok) {
                setMotivo(r.motivo);
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
