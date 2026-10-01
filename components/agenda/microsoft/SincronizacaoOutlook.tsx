"use client";

/**
 * "Sincronização Outlook" no detalhe do compromisso.
 *
 * FORK MIA (docs/fork/agenda-microsoft.md, 6.4). O mesmo desenho da
 * `SincronizacaoDoCompromisso` do upstream (estado, última sincronização, erro,
 * a comparação "Aqui / No Outlook" e as três decisões), falando com a rota
 * `.../microsoft/resolver`.
 */

import { useState } from "react";
import Link from "next/link";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";

import type { SincronizacaoOutlookDetalhe } from "@/lib/agenda-mia/compromisso-no-outlook";

type Escolha = "outlook" | "local" | "preserve_remote" | "retry";
const SEM_ESCOLHA = ["outcome", "series", "identity", "missing"];

export function SincronizacaoOutlook({
  id,
  sync,
  onSaved,
}: {
  id: string;
  sync: SincronizacaoOutlookDetalhe;
  onSaved: () => void;
}) {
  const t = useT();
  const locale = useTagDeIdioma();
  const [ocupado, setOcupado] = useState(false);
  const [enviado, setEnviado] = useState<string | null>(null);

  async function decidir(choice: Escolha) {
    setOcupado(true);
    try {
      await apiClient.post(`/api/v1/agenda/agendamentos/${id}/microsoft/resolver`, {
        choice,
        expected_domain_revision: sync.revision,
        expected_local_revision: sync.local_revision,
        etag: sync.etag,
      });
      setEnviado(`${sync.revision}:${sync.local_revision}:${sync.etag}`);
      onSaved();
    } catch (e) {
      showApiError(e);
      onSaved();
    } finally {
      setOcupado(false);
    }
  }

  const periodo = (v: NonNullable<SincronizacaoOutlookDetalhe["conflict"]>["local"]) =>
    v.cancelled
      ? t("Cancelado")
      : new Intl.DateTimeFormat(locale, { timeZone: v.time_zone, dateStyle: "short", timeStyle: "short" }).formatRange(
          new Date(v.starts_at),
          new Date(v.ends_at),
        );
  const c = sync.conflict;

  return (
    <section className="space-y-2 rounded-md border p-3" aria-label={t("Sincronização Outlook")} data-testid="sincronizacao-outlook">
      <h3 className="text-sm font-medium">{t("Sincronização Outlook")}</h3>
      <p className="text-sm">
        {t(
          c
            ? "O horário mudou nos dois lados. Este compromisso precisa de uma decisão."
            : sync.pending
              ? "Enviando a alteração para o Outlook."
              : sync.synced_at
                ? "Alterações sincronizadas."
                : "Ainda não publicado no Outlook.",
        )}
      </p>
      {sync.synced_at && (
        <p className="text-xs text-muted-foreground">
          {t("Última sincronização")}:{" "}
          {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(sync.synced_at))}
        </p>
      )}
      {sync.error && (
        <p role="alert" className="text-sm text-destructive">
          {sync.error}
        </p>
      )}
      {c && (
        <div className="space-y-2 text-sm" role="alert">
          <p>
            {t("Aqui")}: {periodo(c.local)}
          </p>
          <p>
            {t("No Outlook")}: {c.remote ? periodo(c.remote) : t("Evento indisponível ou incompatível")}
          </p>
          {!!c.groups.length && (
            <p>{t("A publicação também substituiria campos alterados no Outlook. Revise antes de continuar.")}</p>
          )}
          {SEM_ESCOLHA.includes(c.reason) && (
            <p>{t("Preservamos o histórico daqui. Revise o evento no Outlook ou crie outro compromisso pela Agenda.")}</p>
          )}
          {sync.can_resolve && !SEM_ESCOLHA.includes(c.reason) && (
            <div className="flex flex-wrap gap-2">
              {!c.groups.length && (
                <Button variant="outline" onClick={() => void decidir("outlook")} disabled={ocupado || !!c.resolution}>
                  {t(c.remote?.cancelled ? "Usar cancelamento do Outlook" : "Usar horário do Outlook")}
                </Button>
              )}
              {!c.remote?.cancelled && (
                <Button variant="outline" onClick={() => void decidir("local")} disabled={ocupado || !!c.resolution}>
                  {t(c.groups.length ? "Publicar alteração daqui" : "Manter horário daqui")}
                </Button>
              )}
              {!!c.groups.length && (
                <Button variant="outline" onClick={() => void decidir("preserve_remote")} disabled={ocupado || !!c.resolution}>
                  {t("Preservar campos do Outlook")}
                </Button>
              )}
            </div>
          )}
          {(c.resolution || enviado === `${sync.revision}:${sync.local_revision}:${sync.etag}`) && (
            <p>{t("Decisão registrada. O Outlook será relido antes de aplicar; mudanças novas exigem outra decisão.")}</p>
          )}
        </div>
      )}
      {!c && sync.can_resolve && sync.error && (
        <Button variant="outline" onClick={() => void decidir("retry")} disabled={ocupado}>
          {t("Tentar sincronizar novamente")}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        {t("Remarcar ou cancelar no Outlook volta para cá e fica registrado no negócio.")}{" "}
        <Link className="underline" href="/app/settings/tenant/agenda">
          {t("Configurar suas agendas")}
        </Link>
      </p>
    </section>
  );
}
