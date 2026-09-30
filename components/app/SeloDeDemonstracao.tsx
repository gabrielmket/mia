/**
 * FORK MIA · CLIENTE MODELO — o selo "Demonstração".
 *
 * A empresa de demonstração tem cara de empresa de verdade: funis cheios,
 * conversas, agenda. É exatamente por isso que ela precisa dizer, em toda tela,
 * que não é — quem está mostrando o produto numa reunião e quem entrou para
 * testar sabem, à primeira olhada, que ali os dados são inventados e que nada
 * que se clique vai chegar a uma pessoa.
 *
 * É só informação. Quem TRAVA é o banco (migration 9010): um selo que sumisse
 * por erro de leitura não abre porta nenhuma.
 */
"use client";
// Client pelo mesmo motivo da faixa de conexão caída: mora no layout de /app,
// DENTRO do `IdiomaProvider`, e lê o idioma de lá.
import { useT } from "@/hooks/i18n/useT";

export function SeloDeDemonstracao({ ligado }: { ligado: boolean }) {
  const t = useT();
  if (!ligado) return null;
  return (
    <div
      role="status"
      data-selo-de-demonstracao=""
      className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-2 border-b border-amber-300 bg-amber-100/95 px-4 py-1 text-xs text-amber-950 backdrop-blur dark:border-amber-800/60 dark:bg-amber-950/70 dark:text-amber-50"
    >
      <span className="rounded-full bg-amber-600 px-2 py-0.5 font-semibold uppercase tracking-wide text-white">
        {t("Demonstração")}
      </span>
      <span>{t("Dados fictícios. Nenhuma mensagem, e-mail ou aviso sai desta empresa.")}</span>
    </div>
  );
}
