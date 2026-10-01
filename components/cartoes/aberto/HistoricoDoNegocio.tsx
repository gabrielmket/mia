"use client";

/**
 * FORK MIA — o HISTÓRICO do cartão aberto, com filtros: Importante (padrão),
 * Tudo, Conversas e Tarefas.
 *
 * A fonte é a linha do tempo VIVA do upstream (`useLeadTimeline`, que assina o
 * realtime do negócio) mais, em "Conversas", as últimas mensagens da conversa.
 * As regras de filtro e de agrupamento moram em `lib/cartoes/historico.ts`; o
 * rótulo de cada atividade e o nome de quem agiu vêm do vocabulário do upstream
 * (`lib/leads/activity-vocabulary.ts`) — a mesma palavra da timeline de antes.
 */
import { useMemo, useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useMensagensDoNegocio } from "@/hooks/cartoes/useCartaoAberto";
import { activityLabel, actorName, actorShape } from "@/lib/leads/activity-vocabulary";
import type { TimelineItemView } from "@/lib/types/contacts";
import { cn } from "@/lib/utils";
import {
  contagemDoFiltro,
  FILTROS_DO_HISTORICO,
  montarHistorico,
  ROTULO_DO_FILTRO,
  type FiltroDoHistorico,
} from "@/lib/cartoes/historico";
import { TextoDoAvisoAoTime } from "@/components/kanban/TextoDoAvisoAoTime";

function quando(iso: string, idioma: string): string {
  try {
    return new Intl.DateTimeFormat(idioma, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

function Marcador({ kind }: { kind: string | null | undefined }) {
  const forma = actorShape(kind ?? null);
  return (
    <span
      aria-hidden
      className={cn(
        "mt-1 h-2 w-2 shrink-0 rounded-full",
        forma === "filled" && "bg-text",
        forma === "ring" && "border border-text bg-transparent",
        forma === "dashed" && "border border-dashed border-text-muted bg-transparent",
      )}
    />
  );
}

function Linha({ item, fixada, aoVivo }: { item: TimelineItemView; fixada?: boolean; aoVivo?: boolean }) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const nome = actorName(item.actor_kind ?? null, { agente: item.actor_agent_name ?? null, usuario: item.actor_user_name ?? null }, t);
  const textoDaNota = item.type === "note" && typeof item.payload?.texto === "string" ? item.payload.texto : null;
  return (
    <li className={cn("flex gap-2 py-1.5", fixada && "rounded-md bg-warning-bg/40 px-1.5")}>
      <Marcador kind={item.actor_kind} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-text">
          {fixada ? <span className="mr-1 text-[10px] uppercase tracking-wide text-warning-fg">{t("fixada")}</span> : null}
          {t(activityLabel(item.type))}
          {aoVivo ? <span className="ml-1.5 text-[10px] uppercase tracking-wide text-accent">{t("agora")}</span> : null}
        </p>
        {textoDaNota ? (
          <p className="mt-0.5 whitespace-pre-wrap text-xs text-text">{textoDaNota}</p>
        ) : item.reason ? (
          <p className="mt-0.5 text-xs text-text-muted">{t(item.reason)}</p>
        ) : null}
        <TextoDoAvisoAoTime item={item} />
        <p className="mt-0.5 text-[11px] text-text-muted">
          {nome} · {quando(item.performed_at, idioma)}
        </p>
      </div>
    </li>
  );
}

export function HistoricoDoNegocio({
  itens,
  chegouAoVivo,
  isLoading,
  isError,
  conversaId,
}: {
  itens: TimelineItemView[];
  chegouAoVivo: Set<string>;
  isLoading: boolean;
  isError: boolean;
  conversaId: string | null | undefined;
}) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const [filtro, setFiltro] = useState<FiltroDoHistorico>("importante");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const mensagens = useMensagensDoNegocio(conversaId, filtro === "conversas");
  const entradas = useMemo(() => montarHistorico(itens, filtro), [itens, filtro]);

  const conversas = useMemo(() => {
    if (filtro !== "conversas") return [];
    const deMensagens = (mensagens.data ?? []).map((m) => ({
      chave: `m-${m.id}`,
      em: m.sent_at,
      mensagem: m,
    }));
    const deAtividades = entradas
      .filter((e): e is Extract<typeof e, { tipo: "item" }> => e.tipo === "item")
      .map((e) => ({ chave: `a-${e.item.id}`, em: e.item.performed_at, atividade: e.item }));
    return [...deMensagens, ...deAtividades].sort((a, b) => new Date(b.em).getTime() - new Date(a.em).getTime());
  }, [filtro, mensagens.data, entradas]);

  return (
    <section className="py-3" data-testid="historico-do-negocio">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">{t("Histórico")}</h3>
      <div role="group" aria-label={t("Filtrar histórico")} className="mb-2 flex flex-wrap gap-1">
        {FILTROS_DO_HISTORICO.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filtro === f}
            onClick={() => setFiltro(f)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs",
              filtro === f ? "border-accent bg-accent/10 text-accent" : "border-border text-text-muted hover:text-text",
            )}
          >
            {t(ROTULO_DO_FILTRO[f])}
            {f !== "conversas" ? <span className="ml-1 tabular-nums">{contagemDoFiltro(itens, f)}</span> : null}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="py-4 text-xs text-text-muted">{t("Carregando a linha do tempo…")}</p>
      ) : isError ? (
        <p className="py-4 text-xs text-warning-fg">
          {t("Não consegui carregar a linha do tempo. Tente de novo em instantes.")}
        </p>
      ) : filtro === "conversas" ? (
        conversas.length === 0 ? (
          <p className="py-4 text-xs text-text-muted">
            {mensagens.isLoading ? t("Carregando…") : t("Nada neste filtro.")}
          </p>
        ) : (
          <ul className="border-l border-border pl-3">
            {conversas.map((c) =>
              "mensagem" in c && c.mensagem ? (
                <li key={c.chave} className="flex gap-2 py-1.5">
                  <Marcador kind={c.mensagem.direction === "inbound" ? "contact" : c.mensagem.sent_via === "ai" ? "ai" : "user"} />
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words text-xs text-text">
                      {c.mensagem.body?.trim() || <span className="italic text-text-muted">{t("mídia")}</span>}
                    </p>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      {c.mensagem.direction === "inbound"
                        ? t("Cliente")
                        : c.mensagem.sent_via === "ai"
                          ? t("Agente")
                          : c.mensagem.sent_via === "automation" || c.mensagem.sent_via === "system"
                            ? t("Automação")
                            : t("Equipe")}{" "}
                      · {quando(c.mensagem.sent_at, idioma)}
                    </p>
                  </div>
                </li>
              ) : "atividade" in c && c.atividade ? (
                <Linha key={c.chave} item={c.atividade} />
              ) : null,
            )}
          </ul>
        )
      ) : entradas.length === 0 ? (
        <p className="py-4 text-xs text-text-muted">{t("Nada neste filtro.")}</p>
      ) : (
        <ul className="border-l border-border pl-3">
          {entradas.map((e) => {
            if (e.tipo === "item") {
              return <Linha key={e.item.id} item={e.item} fixada={e.fixada} aoVivo={chegouAoVivo.has(e.item.id)} />;
            }
            const aberto = abertos.has(e.dia);
            return (
              <li key={`ia-${e.dia}`} className="py-1.5">
                <button
                  type="button"
                  aria-expanded={aberto}
                  onClick={() =>
                    setAbertos((prev) => {
                      const n = new Set(prev);
                      if (n.has(e.dia)) n.delete(e.dia);
                      else n.add(e.dia);
                      return n;
                    })
                  }
                  className="flex w-full items-center gap-2 text-left text-xs text-text-muted hover:text-text"
                >
                  <Marcador kind="ai" />
                  <span>
                    {t("A IA fez")} {e.itens.length} {e.itens.length === 1 ? t("ação") : t("ações")}
                    {e.naoEnviou > 0
                      ? ` · ${e.naoEnviou} ${e.naoEnviou === 1 ? t("decisão de não enviar") : t("decisões de não enviar")}`
                      : ""}{" "}
                    · {quando(e.itens[0]!.performed_at, idioma)}
                  </span>
                  <span aria-hidden className="ml-auto text-[10px]">
                    {aberto ? "−" : "+"}
                  </span>
                </button>
                {aberto ? (
                  <ul className="ml-2 border-l border-border pl-3">
                    {e.itens.map((it) => (
                      <Linha key={it.id} item={it} />
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-text-muted">
        {t("As ações da IA continuam registradas; em Importante, as de rotina ficam agrupadas numa linha por dia.")}
      </p>
    </section>
  );
}
