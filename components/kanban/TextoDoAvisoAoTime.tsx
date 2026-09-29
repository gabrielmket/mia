"use client";

/**
 * FORK MIA — o texto que a automação mandou ao grupo do time, na linha do tempo
 * do negócio.
 *
 * A linha (`group_notice_sent`/`group_notice_failed`) diz QUAL grupo, QUAL regra
 * e o desfecho — sem dado pessoal, porque o `reason` é exibido e exportado no
 * LGPD. O texto em si (nome, telefone, a ficha da qualificação) mora no
 * `payload`, que a anonimização limpa; é daqui que ele aparece, fechado por
 * padrão para não empurrar o resto da história para baixo.
 *
 * Para qualquer outro tipo, não desenha nada.
 */
import { useT } from "@/hooks/i18n/useT";
import type { TimelineItemView } from "@/lib/types/contacts";

const TIPOS_DO_AVISO = new Set(["group_notice_sent", "group_notice_failed"]);

export function TextoDoAvisoAoTime({ item }: { item: TimelineItemView }) {
  const t = useT();
  if (!TIPOS_DO_AVISO.has(item.type)) return null;
  const texto = typeof item.payload?.texto === "string" ? item.payload.texto.trim() : "";
  if (!texto) return null;
  return (
    <details className="mt-1" data-testid="texto-do-aviso-ao-time">
      <summary className="cursor-pointer text-[11px] text-text-muted">
        {t("O que foi mandado ao grupo")}
      </summary>
      {/* O texto é o que o time recebeu, na língua em que foi escrito: não passa por t(). */}
      <p className="mt-1 whitespace-pre-wrap rounded-md border border-border p-2 text-xs text-text">
        {texto}
      </p>
    </details>
  );
}
