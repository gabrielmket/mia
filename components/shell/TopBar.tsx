"use client";
import { BotaoDoAssistente } from "@/components/assistente/BotaoDoAssistente"; // FORK MIA (.88)
import { AlertsBell } from "./AlertsBell";
import { AvisoDePropostaEmDestaque } from "./AvisoDePropostaEmDestaque";
import { MobileSidebar } from "./MobileSidebar";
import { TenantSwitcher } from "./TenantSwitcher";
import { UserMenu } from "./UserMenu";
import { SearchTrigger } from "./SearchTrigger";
import { BotaoDoPainelDoModulo, PainelDoModuloProvider } from "@/components/modulo/PainelDoModulo";

export function TopBar() {
  return (
    <PainelDoModuloProvider>
      <header className="sticky top-[var(--faixas-de-cima,0px)] z-20 flex h-14 items-center justify-between gap-2 border-b bg-background/95 px-3 backdrop-blur md:gap-4 md:px-6" data-casca="topo">
        <div className="flex min-w-0 items-center gap-2">
          <MobileSidebar />
          <TenantSwitcher />
        </div>
        <div className="flex min-w-0 flex-1 justify-center md:max-w-md">
          <SearchTrigger />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <BotaoDoPainelDoModulo />
          {/* FORK MIA (.88): o assistente da MIA, ao lado do sino (docs/fork/assistente.md). */}
          <BotaoDoAssistente />
          <AlertsBell />
          <AvisoDePropostaEmDestaque />
          <UserMenu />
        </div>
      </header>
    </PainelDoModuloProvider>
  );
}
