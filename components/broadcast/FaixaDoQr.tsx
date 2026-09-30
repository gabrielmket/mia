"use client";
/**
 * FORK MIA — a faixa que diz, nas telas de Campanhas, que elas SÃO o Broadcast
 * pelo número por QR (1.21.0-mia.58, docs/fork/broadcast-unificado.md).
 *
 * As telas de `/app/campaigns/*` são as do upstream, sem uma linha nossa. Esta
 * faixa, posta pelo layout da pasta, é o que as costura ao produto: a volta para
 * a lista unificada e o lembrete do risco, que o formulário do upstream não diz.
 */
import Link from "next/link";

import { useT } from "@/hooks/i18n/useT";
import { ArrowBendUpLeft, QrCode, Warning } from "@/lib/ui/icons";

export function FaixaDoQr() {
  const t = useT();
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-6 py-2 text-sm"
      data-faixa="broadcast-qr"
    >
      <Link
        href="/app/broadcast"
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-text"
      >
        <ArrowBendUpLeft size={14} aria-hidden />
        {t("Broadcast")}
      </Link>
      <span className="inline-flex items-center gap-1 font-medium">
        <QrCode size={14} aria-hidden />
        {t("Número por QR")}
      </span>
      <span className="text-muted-foreground">{t("Sem custo por mensagem, no ritmo do número.")}</span>
      <span className="inline-flex items-center gap-1 text-warning-fg">
        <Warning size={14} aria-hidden />
        {t("O WhatsApp pode bloquear o número se a lista reclamar.")}
      </span>
    </div>
  );
}
