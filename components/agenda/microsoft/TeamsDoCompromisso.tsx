"use client";

/**
 * "Microsoft Teams" no detalhe do compromisso: o estado do link, abrir, copiar
 * e mandar ao cliente pelo WhatsApp.
 *
 * FORK MIA (docs/fork/agenda-microsoft.md, 3.7 e 6.4). O envio usa as rotas da
 * entrega DO UPSTREAM (`.../google/meet/deliver` e `resend`, que valem para
 * qualquer local desde a 0366): a mesma confirmação de quem é o responsável, a
 * mesma escolha de conversa, as mesmas travas do canal. O que muda é o texto,
 * e o envio só é oferecido com o link pronto (a entrega dele não espera link de
 * quem não é Meet).
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { copyToClipboard } from "@/lib/clipboard";

import type { TeamsDetalhe } from "@/lib/agenda-mia/compromisso-no-outlook";
import type { MeetingDetail } from "../MeetDoCompromisso";

const ESTADO: Record<TeamsDetalhe["state"], string> = {
  nao_pedido: "Link ainda não solicitado",
  pendente: "Criando link do Microsoft Teams",
  pronto: "Link do Microsoft Teams pronto",
  falhou: "Não foi possível criar o link do Microsoft Teams",
  cancelado: "Solicitação de link cancelada",
};

const ERRO: Record<string, string> = {
  nao_permite: "Esta agenda não permite Microsoft Teams. Confira a conta conectada ou escolha outro destino.",
  destino_google: "O Teams só é criado em agenda do Outlook. Este compromisso foi para o Google.",
  sem_destino: "O Teams só é criado em agenda do Outlook. Quem atende ainda não tem o Outlook como destino.",
  microsoft_falhou: "A Microsoft não conseguiu criar a reunião. Tente sincronizar novamente.",
  desconhecido: "O link ainda não foi confirmado pela Microsoft. Confira o evento no Outlook.",
  invalido: "A Microsoft não devolveu um link do Teams válido. Confira o evento no Outlook.",
};

export function TeamsDoCompromisso({
  id,
  revision,
  teams,
  meeting,
  onSaved,
}: {
  id: string;
  revision: string;
  teams: TeamsDetalhe;
  meeting: MeetingDetail | null | undefined;
  onSaved: () => void;
}) {
  const t = useT();
  const destinos = meeting?.destinations ?? [];
  const erroDoTeams = teams.error && ERRO[teams.error] ? t(ERRO[teams.error] as string) : undefined;
  const [conversa, setConversa] = useState(destinos[0]?.id ?? "");
  const mesmaConversa = meeting?.delivery_conversation_id === conversa && meeting?.delivery_authorization_current === true;
  const jaEnviado = mesmaConversa && meeting?.delivery_state === "sent";
  const aCaminho = mesmaConversa && ["waiting_for_link", "queued"].includes(meeting?.delivery_state ?? "");

  const enviar = useMutation({
    mutationFn: (tipo: "deliver" | "resend") =>
      apiClient.post(`/api/v1/agenda/agendamentos/${id}/google/meet/${tipo}`, {
        revision,
        request_id: meeting?.request_id ?? null,
        conversation_id: conversa,
      }),
    onSuccess: () => {
      toast.success(t("Link enviado para a conversa autorizada."));
      onSaved();
    },
    onError: (e) => {
      showApiError(e);
      onSaved();
    },
  });

  return (
    <section className="space-y-2 rounded-md border p-3" aria-label={t("Microsoft Teams")} data-testid="teams-do-compromisso">
      <h3 className="text-sm font-medium">{t("Microsoft Teams")}</h3>
      <p className="text-sm">{t(ESTADO[teams.state])}</p>
      {erroDoTeams && (
        <p role="alert" className="text-sm text-destructive">
          {erroDoTeams}
        </p>
      )}
      {teams.state === "pendente" && (
        <p className="text-xs text-muted-foreground">
          {t("O link fica pronto quando o compromisso chega ao Outlook. Até lá, nada é enviado ao cliente.")}
        </p>
      )}
      {teams.url && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={teams.url} target="_blank" rel="noreferrer noopener">
                {t("Abrir reunião")}
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void copyToClipboard(teams.url ?? "").then((ok) =>
                  ok
                    ? toast.success(t("Link copiado."))
                    : toast.error(t("Não foi possível copiar. Use o link de abrir reunião para acessar a sala.")),
                )
              }
            >
              {t("Copiar link")}
            </Button>
          </div>
          {meeting?.can_manage && (
            <div className="space-y-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
                {t("Conversa que receberá o link")}
                <select
                  value={conversa}
                  onChange={(e) => setConversa(e.target.value)}
                  className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
                >
                  {destinos.length === 0 && <option value="">{t("Nenhum atendimento aberto para este contato")}</option>}
                  {destinos.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={!conversa || enviar.isPending || aCaminho}
                  onClick={() => enviar.mutate(jaEnviado ? "resend" : "deliver")}
                >
                  {t(jaEnviado ? "Enviar de novo" : aCaminho ? "Envio já autorizado" : "Enviar link ao cliente")}
                </Button>
                {jaEnviado && <span className="text-xs text-muted-foreground">{t("Link enviado na conversa autorizada.")}</span>}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
