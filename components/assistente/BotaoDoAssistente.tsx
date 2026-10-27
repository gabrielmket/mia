"use client";

/**
 * FORK MIA (.88) — O BOTÃO "ASSISTENTE" NO TOPO, ao lado do sino (o atalho que
 * a spec do upstream #2860 desenhou junto do avatar). Abre o painel do
 * assistente ao lado da tela em que a pessoa está, sem tirá-la de lá.
 *
 * O painel é uma gaveta (`Sheet`), que vive num PORTAL: o `<header>` do
 * `TopBar` tem `backdrop-blur`, e filho com `position: fixed` dentro dele nasce
 * cortado (a armadilha medida em `AvisoDePropostaEmDestaque`). O Radix já
 * monta a gaveta em `document.body`.
 *
 * Mesmo gate do `AlertsBell`: o botão só aparece para quem a interface da
 * empresa deixa abrir `/app/assistente`.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { destinosDaInterface } from "@/lib/navigation/interface";
import { Sparkle } from "@/lib/ui/icons";

import { PainelDoAssistente } from "./PainelDoAssistente";
import { GuiaNaTela } from "./trilhas/GuiaNaTela";

export function BotaoDoAssistente() {
  const { user, activeOrg } = useAuth();
  if (
    !destinosDaInterface(
      activeOrg?.interface_settings,
      user.is_platform_admin && !user.support,
      activeOrg?.role ?? null,
    ).some((d) => d.href === "/app/assistente")
  )
    return null;
  return <BotaoVisivel />;
}

function BotaoVisivel() {
  const t = useT();
  const caminho = usePathname() ?? "/app";
  const [aberto, setAberto] = useState(false);
  const [conversaId, setConversaId] = useState<string | null>(null);

  return (
    <>
      {/* FORK MIA (.93): a guia do "Me mostra como"; a gaveta sai da frente pelo aoNavegar do painel. */}
      <GuiaNaTela />
      <Sheet open={aberto} onOpenChange={setAberto}>
        <button
          type="button"
          onClick={() => setAberto(true)}
          aria-label={t("Assistente")}
          title={t("Assistente")}
          data-testid="botao-do-assistente"
          className="relative inline-flex h-11 items-center justify-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:h-9"
        >
          <Sparkle size={18} aria-hidden />
          <span className="hidden xl:inline">{t("Assistente")}</span>
        </button>
        <SheetContent side="right" className="flex w-full flex-col gap-3 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t("Assistente")}</SheetTitle>
            <SheetDescription>
              {t("Sua rotina, seus números e como usar o sistema, com o que você já pode ver.")}{" "}
              <Link href="/app/assistente" className="underline" onClick={() => setAberto(false)}>
                {t("Abrir o histórico")}
              </Link>
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            <PainelDoAssistente
              caminho={caminho}
              conversaId={conversaId}
              aoMudarConversa={setConversaId}
              aoNavegar={() => setAberto(false)}
              ativo={aberto}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
