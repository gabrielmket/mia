"use client";

/**
 * FORK MIA (.93) — a trilha que o Início recomenda: a que a Time escolheu para a
 * empresa (`plataforma_configurar_trilhas`), ou a pausada da pessoa, ou a
 * primeira que falta, na ordem (`trilhaRecomendada`). Sem nenhuma, nada.
 */
import Link from "next/link";

import { useTrilhas } from "@/hooks/assistente/useTrilhas";
import { useT } from "@/hooks/i18n/useT";
import { trilhaPorId } from "@/lib/assistente/trilhas/catalogo";

import { BotaoMeMostraComo } from "./BotaoMeMostraComo";

export function TrilhaRecomendada() {
  const t = useT();
  const dados = useTrilhas();
  const d = dados.data;
  if (!d?.disponivel || !d.me_mostra_como || !d.recomendada) return null;
  const trilha = trilhaPorId(d.recomendada);
  const s = d.trilhas.find((x) => x.id === d.recomendada);
  if (!trilha || !s) return null;
  const parada = s.estado === "pausada" || s.estado === "andando";

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-background p-4" data-testid="trilha-recomendada">
      <p className="text-xs font-medium text-primary">{parada ? t("Você parou no meio desta trilha") : t("Recomendada agora")}</p>
      <h2 className="text-base font-semibold">{t(trilha.titulo)}</h2>
      <p className="text-sm text-text-muted">
        {t(trilha.objetivo)} · {trilha.tempo}
        {parada ? ` · ${t("passo")} ${(s.passo ?? 0) + 1} ${t("de")} ${s.de}` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <BotaoMeMostraComo trilha={trilha.id} variante="default" />
        <Link href="/app/assistente?aba=trilhas" className="text-sm underline">
          {t("Ver as trilhas")}
        </Link>
      </div>
      <p className="text-xs text-text-muted">{t("O assistente destaca cada passo na tela e confere no sistema. Quem clica é sempre você.")}</p>
    </section>
  );
}
