"use client";

/**
 * FORK MIA (.93) — o "Me mostra como" no painel do assistente, na abertura da
 * conversa (protótipo, tela 1): a trilha pausada ("Ontem você parou no passo 3
 * de 6 de Ligar o primeiro número"), ou a recomendada, e as trilhas que andam
 * na tela em que a pessoa está ("O que dá para fazer nesta tela?"). Não gasta
 * pergunta do dia: começar uma trilha não passa pela IA.
 */
import Link from "next/link";

import { useTrilhas } from "@/hooks/assistente/useTrilhas";
import { useT } from "@/hooks/i18n/useT";
import { trilhaPorId, trilhasDaTela } from "@/lib/assistente/trilhas/catalogo";

import { BotaoMeMostraComo } from "./BotaoMeMostraComo";

export function MeMostraComoNoPainel({ caminho, aoComecar }: { caminho: string; aoComecar?: () => void }) {
  const t = useT();
  const dados = useTrilhas();
  const d = dados.data;
  if (!d?.disponivel || !d.me_mostra_como) return null;

  const recomendada = d.recomendada ? d.trilhas.find((s) => s.id === d.recomendada) : undefined;
  const trilha = recomendada ? trilhaPorId(recomendada.id) : null;
  const parada = recomendada && (recomendada.estado === "pausada" || recomendada.estado === "andando");
  const daTela = trilhasDaTela(caminho)
    .filter((x) => x.id !== recomendada?.id)
    .filter((x) => {
      const s = d.trilhas.find((y) => y.id === x.id);
      return s?.do_papel && (s.estado === "nova" || s.estado === "pausada" || s.estado === "andando");
    })
    .slice(0, 3);
  if (!trilha && daTela.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-2xl rounded-bl-sm border bg-surface-muted px-3 py-2 text-sm" data-testid="me-mostra-como-no-painel">
      {trilha && recomendada ? (
        <>
          <p>
            {parada ? (
              <>
                {t("Você parou no passo")} {(recomendada.passo ?? 0) + 1} {t("de")} {recomendada.de} {t("de")} <strong>{t(trilha.titulo)}</strong>.
              </>
            ) : (
              <>
                {t("Quer que eu te mostre como fazer alguma coisa aqui na tela? A trilha que eu sugiro agora é")}{" "}
                <strong>{t(trilha.titulo)}</strong>.
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <BotaoMeMostraComo trilha={trilha.id} aoComecar={aoComecar} variante="default" />
            <Link href="/app/assistente?aba=trilhas" className="inline-flex h-11 items-center text-xs underline lg:h-8" onClick={() => aoComecar?.()}>
              {t("Ver as trilhas")}
            </Link>
          </div>
        </>
      ) : null}
      {daTela.length > 0 ? (
        <>
          <p className="text-xs text-text-muted">{t("Nesta tela eu te mostro")}:</p>
          <div className="flex flex-wrap gap-2">
            {daTela.map((x) => (
              <BotaoMeMostraComo key={x.id} trilha={x.id} rotulo={t(x.titulo)} aoComecar={aoComecar} />
            ))}
          </div>
        </>
      ) : null}
      <p className="text-xs text-text-muted">{t("Eu destaco o lugar de cada passo e confiro no sistema. Quem clica é sempre você.")}</p>
    </div>
  );
}
