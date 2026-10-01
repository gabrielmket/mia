"use client";

/**
 * FORK MIA — o botão "Reenviar" do histórico de envios.
 *
 * Um botão, duas portas: o evento de etapa da Meta (`Meta:<evento>`) vai pela
 * ação nossa; a compra e os eventos do Google vão pela rota do upstream
 * (`/api/v1/leads/[id]/conversion/retry`), a mesma do botão "Verificar ou tentar
 * novamente" da aba Configuração. Quem decide SE o botão aparece é o servidor
 * (`reenvioDoEnvio`, em `lib/conversoes-meta/situacao.ts`).
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { reenviarConversaoDaMeta } from "@/app/actions/settings/conversoesDaMeta";
import { Button } from "@/components/ui/button";
import { ehEventoDaMetaNoLivro } from "@/lib/conversoes-meta/eventos";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

export function ReenviarEnvio({ leadId, evento, idioma }: { leadId: string; evento: string; idioma: Idioma }) {
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const t = (texto: string) => traduzir(texto, idioma);

  async function pedir(): Promise<boolean> {
    if (ehEventoDaMetaNoLivro(evento)) {
      const r = await reenviarConversaoDaMeta(leadId, evento);
      if (!r.ok) throw new Error(r.error);
      return r.agendado;
    }
    const resposta = await fetch(
      `/api/v1/leads/${encodeURIComponent(leadId)}/conversion/retry${
        evento === "Purchase" ? "" : `?event_name=${encodeURIComponent(evento)}`
      }`,
      { method: "POST" },
    );
    if (!resposta.ok) throw new Error(String(resposta.status));
    const corpo = (await resposta.json()) as { data?: { queued?: boolean } };
    return corpo.data?.queued === true;
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pendente}
      onClick={() =>
        iniciar(async () => {
          try {
            const agendado = await pedir();
            toast.success(
              t(
                agendado
                  ? "Reenvio na fila, com os dados do primeiro envio."
                  : "Não há novo envio a agendar. Atualizamos a lista.",
              ),
            );
            router.refresh();
          } catch {
            toast.error(t("Não foi possível reprocessar. Confira sua sessão e tente novamente."));
          }
        })
      }
    >
      {t(pendente ? "Agendando..." : "Reenviar")}
    </Button>
  );
}
