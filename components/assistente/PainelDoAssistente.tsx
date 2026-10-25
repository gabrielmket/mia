"use client";

/**
 * FORK MIA (.88) — O PAINEL DO ASSISTENTE DA MIA: a conversa, as sugestões e a
 * caixa de pergunta. O mesmo painel abre ao lado de qualquer tela (pelo botão
 * do topo, `BotaoDoAssistente`) e na página `/app/assistente`.
 *
 * O painel sabe em que tela a pessoa está (`caminho`) e manda junto de cada
 * pergunta: o assistente responde "onde fica" a partir dali, e o chamado leva
 * a tela no contexto.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useAssistente, usePerguntar } from "@/hooks/assistente/useAssistente";
import { useT } from "@/hooks/i18n/useT";
import { oQueOPapelVe } from "@/lib/assistente/prompt";
import { destinoDaTela } from "@/lib/assistente/telas";
import type { MensagemDoAssistente as Mensagem } from "@/lib/assistente/tipos";
import { ROTULO_DO_PAPEL, type Role } from "@/lib/auth/types";

import { MensagemDoAssistente } from "./MensagemDoAssistente";

/** As perguntas do protótipo, para começar sem saber o que perguntar. */
export const SUGESTOES: ReadonlyArray<{ texto: string }> = [
  { texto: "Como está minha rotina hoje?" },
  { texto: "Por onde eu começo?" },
  { texto: "Como estão meus leads?" },
  { texto: "Como está minha performance no mês?" },
  { texto: "Quanto a equipe vendeu no mês?" },
  { texto: "Por que a IA não respondeu um cliente?" },
  { texto: "Como configuro o horário da IA?" },
  { texto: "Encontrei um erro" },
];

export function PainelDoAssistente({
  caminho,
  conversaId,
  aoMudarConversa,
  aoNavegar,
  ativo = true,
  sugestoes = SUGESTOES,
  saudacao,
  perguntaExterna = null,
}: {
  caminho: string;
  conversaId: string | null;
  aoMudarConversa: (id: string | null) => void;
  aoNavegar?: () => void;
  ativo?: boolean;
  /** FORK MIA (.91): as sugestões do contexto (nos primeiros passos, as do "o que falta"). */
  sugestoes?: ReadonlyArray<{ texto: string }>;
  /** FORK MIA (.91): a saudação do contexto, no lugar da padrão. */
  saudacao?: ReactNode;
  /**
   * FORK MIA (.91): uma pergunta que vem de fora do painel (o botão "Pedir ao
   * assistente" do bloco "O que falta"). Cada `id` novo é enviado uma vez.
   */
  perguntaExterna?: { id: number; texto: string } | null;
}) {
  const t = useT();
  const { user, activeOrg } = useAuth();
  const estado = useAssistente(conversaId, { ativo });
  const perguntar = usePerguntar();
  const [texto, setTexto] = useState("");
  const [pendente, setPendente] = useState<string | null>(null);
  // A LISTA das mensagens, não a página: o painel mora ao lado do passo a passo
  // (.91) e um `scrollIntoView` rolava a JANELA junto, no meio do que a pessoa
  // preenchia (o fuso do passo "Seu negócio" abria fora da tela). Rola só aqui.
  const lista = useRef<HTMLDivElement | null>(null);

  const papel = (activeOrg?.role ?? "viewer") as Role;
  const primeiroNome = (user.full_name ?? "").trim().split(/\s+/)[0] ?? "";
  const destino = destinoDaTela(caminho);
  const mensagens: Mensagem[] = useMemo(() => estado.data?.mensagens ?? [], [estado.data?.mensagens]);

  useEffect(() => {
    const el = lista.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length, pendente]);

  function enviar(pergunta: string) {
    const limpa = pergunta.trim();
    if (limpa.length < 2 || perguntar.isPending) return;
    setPendente(limpa);
    setTexto("");
    perguntar.mutate(
      { pergunta: limpa, conversaId, caminho },
      {
        onSuccess: (r) => {
          if (r.conversa_id !== conversaId) aoMudarConversa(r.conversa_id);
        },
        onError: (e) => {
          setTexto(limpa);
          toast.error(t(e instanceof Error && e.message ? e.message : "Não consegui responder agora."));
        },
        onSettled: () => setPendente(null),
      },
    );
  }

  // FORK MIA (.91): a pergunta que chegou do bloco "O que falta".
  const ultimaExterna = useRef<number | null>(null);
  useEffect(() => {
    if (!perguntaExterna || ultimaExterna.current === perguntaExterna.id) return;
    ultimaExterna.current = perguntaExterna.id;
    enviar(perguntaExterna.texto);
    // `enviar` muda a cada render; a chave é o id da pergunta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perguntaExterna?.id]);

  const uso = estado.data?.uso;
  const disponivel = estado.data?.disponivel ?? true;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="painel-do-assistente">
      <div className="flex flex-wrap items-center gap-2 border-b pb-2 text-xs text-text-muted">
        <Badge variant="info">{t(ROTULO_DO_PAPEL[papel])}</Badge>
        <span className="min-w-0 truncate">
          {t("Você está em")}: {destino ? t(destino.label) : caminho}
        </span>
        {uso ? (
          <span className="ml-auto">
            {t("Hoje")}: {uso.feitas}/{uso.limite}
          </span>
        ) : null}
      </div>

      <div ref={lista} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-3" aria-live="polite">
        {mensagens.length === 0 && !pendente && saudacao ? (
          <div className="flex justify-start">
            <div className="max-w-[92%] rounded-2xl rounded-bl-sm border bg-surface-muted px-3 py-2 text-sm">{saudacao}</div>
          </div>
        ) : null}
        {mensagens.length === 0 && !pendente && !saudacao ? (
          <div className="flex justify-start">
            <div className="max-w-[92%] rounded-2xl rounded-bl-sm border bg-surface-muted px-3 py-2 text-sm">
              <p>
                {primeiroNome ? `${t("Olá")}, ${primeiroNome}. ` : `${t("Olá")}. `}
                {t("Sou o assistente da MIA. Posso te mostrar sua rotina e seus números, e te ajudar a usar o sistema.")}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {t("Eu vejo só o que você já pode ver")}: {t(oQueOPapelVe(papel))}.
              </p>
            </div>
          </div>
        ) : null}
        {mensagens.map((m) => (
          <MensagemDoAssistente key={m.id} mensagem={m} caminho={caminho} conversaId={conversaId} aoNavegar={aoNavegar} />
        ))}
        {pendente ? (
          <>
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
                {pendente}
              </div>
            </div>
            <p className="text-xs text-text-muted">{t("Consultando o sistema com o seu acesso…")}</p>
          </>
        ) : null}
      </div>

      {!disponivel ? (
        <p className="rounded-md bg-warning-bg p-2 text-sm text-warning-fg">
          {t("O assistente está desligado para o seu papel nesta empresa.")}
        </p>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-2" data-testid="sugestoes-do-assistente">
            {sugestoes.map((sugestao) => (
              <button
                key={sugestao.texto}
                type="button"
                className="h-11 shrink-0 rounded-full border px-3 text-xs hover:bg-muted lg:h-8"
                disabled={perguntar.isPending}
                onClick={() => enviar(t(sugestao.texto))}
              >
                {t(sugestao.texto)}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              enviar(texto);
            }}
          >
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              maxLength={1000}
              placeholder={t("Pergunte do seu jeito")}
              aria-label={t("Sua pergunta")}
              className="h-11 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm lg:h-9"
            />
            <Button type="submit" className="h-11 lg:h-9" disabled={perguntar.isPending || texto.trim().length < 2}>
              {t("Enviar")}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
