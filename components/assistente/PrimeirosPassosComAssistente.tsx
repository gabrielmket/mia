"use client";

/**
 * FORK MIA (.91) — OS PRIMEIROS PASSOS COM O ASSISTENTE AO LADO.
 *
 * O protótipo da jornada de assinatura (tela 3): o passo atual (ou o Início) e
 * o bloco "O que falta" de um lado; do outro, o painel do assistente da .88, o
 * mesmo componente, com as sugestões e a saudação dos primeiros passos. O botão
 * "Pedir ao assistente" do bloco manda a pergunta ao painel, e a proposta volta
 * como cartão na resposta.
 *
 * Quem vê: a rota do "o que falta" decide (`criterio`); o painel só aparece
 * junto do bloco.
 */
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { useOQueFalta } from "@/hooks/assistente/usePrimeirosPassos";
import { useT } from "@/hooks/i18n/useT";
import { roleAtLeast } from "@/lib/auth/types";

import { OQueFalta } from "./OQueFalta";
import { PainelDoAssistente } from "./PainelDoAssistente";

/** As sugestões do protótipo para os primeiros passos. */
export const SUGESTOES_DOS_PRIMEIROS_PASSOS: ReadonlyArray<{ texto: string }> = [
  { texto: "O que falta?" },
  { texto: "Monta o agente" },
  { texto: "Monta o funil" },
  { texto: "Liga o follow-up" },
  { texto: "Conecta o WhatsApp pra mim" },
  { texto: "Por que a IA não respondeu?" },
];

export function PrimeirosPassosComAssistente({ children }: { children?: ReactNode }) {
  const t = useT();
  const caminho = usePathname() ?? "/app/inicio";
  const { user, activeOrg } = useAuth();
  const administra = roleAtLeast(activeOrg?.role ?? null, "admin");
  const estado = useOQueFalta({ guardar: administra && !user.support });
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [pergunta, setPergunta] = useState<{ id: number; texto: string } | null>(null);
  const aparece = estado.data?.criterio.aparece === true;
  const primeiroNome = (user.full_name ?? "").trim().split(/\s+/)[0] ?? "";
  const faltam = estado.data?.rotulo?.contas.faltam ?? null;
  const agente = estado.data?.rotulo?.agente ?? null;

  // A MESMA estrutura com e sem o bloco: o passo (`children`) fica sempre no
  // mesmo lugar da árvore, e a chegada da resposta não remonta o formulário
  // que a pessoa está preenchendo.
  return (
    <div className={aparece ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]" : undefined}>
      <div className="min-w-0 space-y-6">
        {children}
        {aparece ? (
          <OQueFalta
            administra={administra && !user.support}
            aoPedirAoAssistente={(texto) => setPergunta((p) => ({ id: (p?.id ?? 0) + 1, texto }))}
          />
        ) : null}
      </div>
      {aparece ? (
        <aside
          className="flex h-[70vh] min-h-[420px] flex-col rounded-lg border bg-background p-3 lg:sticky lg:top-4"
          aria-label={t("Assistente da MIA")}
        >
          <h2 className="mb-2 text-sm font-semibold">{t("Assistente da MIA")}</h2>
          <PainelDoAssistente
            caminho={caminho}
            conversaId={conversaId}
            aoMudarConversa={setConversaId}
            sugestoes={SUGESTOES_DOS_PRIMEIROS_PASSOS}
            perguntaExterna={pergunta}
            saudacao={
              <>
                <p>
                  {primeiroNome ? `${t("Olá")}, ${primeiroNome}. ` : `${t("Olá")}. `}
                  {t("Eu sou o assistente da MIA.")}{" "}
                  {faltam !== null && faltam > 0 ? (
                    <>
                      {t("Faltam")} <strong>{faltam}</strong> {t("coisas para")} {agente ?? t("seu funcionário")} {t("atender por conta própria.")}
                    </>
                  ) : null}
                </p>
                <p className="mt-1">
                  {administra
                    ? t("Número, pagamento e convite só você faz. O agente, o funil e o follow-up eu preparo para você aprovar.")
                    : t("Número, pagamento e convite são de quem administra. Eu preparo o agente, o funil e o follow-up; quem aprova é quem administra.")}
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  {t("Leio só o que você vê. Não conecto número, não pago, não convido e não publico.")}
                </p>
              </>
            }
          />
        </aside>
      ) : null}
    </div>
  );
}
