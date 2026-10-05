"use client";

/**
 * FORK MIA — FOCO · O QUE FAZER AGORA, no topo do cartão aberto.
 *
 * No máximo cinco itens, por urgência: o lead esperando resposta; a proposta da
 * IA para aprovar (aprovar vira TAREFA — e a tela diz para quem e com que prazo
 * ANTES do clique); o próximo compromisso; a tarefa atrasada ou a mais próxima.
 * Os documentos e as atividades recorrentes entram logo abaixo: a proposta do
 * agente esperando confirmação e os itens vencidos, vencendo ou pedidos sem
 * resposta, com a ação direta (components/obrigacoes/ObrigacoesNoFoco.tsx).
 *
 * Embaixo, o compositor: Nota e Tarefa gravam aqui; Mensagem e Agendar levam à
 * conversa e à agenda — responder de dentro do cartão exigiria uma segunda cópia
 * do compositor do inbox, e duas cópias divergem (a mesma razão do atalho de
 * conversa do quadro, `ConversaSlot`).
 */
import Link from "next/link";
import { toast } from "sonner";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useActiveOrg } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useDecidirProximaAcao } from "@/hooks/kanban/useNextAction";
import { useTasks } from "@/hooks/tasks/useTasks";
import { useNotaDoNegocio } from "@/hooks/cartoes/useCartaoAberto";
import type { Lead } from "@/lib/types/leads";
import { cn } from "@/lib/utils";
import { quemFalouRotulo } from "@/lib/cartoes/bola";
import { textoDoProximoCompromisso } from "@/lib/cartoes/compromisso";
import { duracaoCurta } from "@/lib/cartoes/tempo";
import { prazoDaProximaAcao, responsavelDaProximaAcao } from "@/lib/cartoes/regras-da-proxima-acao";
import { fusoUtilizavel } from "@/lib/tempo/fusos";
import { useAgoraDoCartao, useContextoDoCartao } from "@/components/cartoes/ContextoDoCartao";
import { ObrigacoesNoFoco, obrigacoesDoFoco } from "@/components/obrigacoes/ObrigacoesNoFoco";
import { useObrigacoes } from "@/hooks/obrigacoes/useObrigacoes";

type Item = {
  chave: string;
  sigla: string;
  tom: "alerta" | "acento" | "perigo" | "neutro" | "ok";
  titulo: string;
  detalhe: string;
  acoes?: React.ReactNode;
};

function quandoCurto(iso: string, fuso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: fuso,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function Foco({ lead, pipelineId }: { lead: Lead; pipelineId: string }) {
  const t = useT();
  const agora = useAgoraDoCartao();
  const ctx = useContextoDoCartao();
  const org = useActiveOrg();
  const idioma = useTagDeIdioma();
  const fuso = fusoUtilizavel(org?.timezone);
  const decidir = useDecidirProximaAcao(pipelineId);
  const { tarefas: lista, editarTarefa } = useTasks({ lead_id: lead.id, aberto: true });
  const [concluindo, setConcluindo] = useState<string | null>(null);
  const { data: membros } = useAssignableMembers(true);
  const nomeDe = (id: string | null | undefined) =>
    id ? (membros?.find((m) => m.user_id === id)?.full_name ?? null) : null;

  // Documentos e obrigações do negócio, da empresa dele e do contato dele: a
  // mesma leitura que a seção do cartão aberto usa (uma chave de cache só).
  const obrigacoes = useObrigacoes({ tipo: "negocio", id: lead.id });
  const doFoco = obrigacoesDoFoco(obrigacoes.data);
  const semObrigacoes = doFoco.propostas.length === 0 && doFoco.urgentes.length === 0;

  const bola = lead.cartao?.bola ?? lead.conversa?.bola ?? null;
  const compromisso = lead.cartao?.compromisso ?? null;

  const itens = useMemo(() => {
    const saida: Item[] = [];
    if (lead.status === "open" && bola?.com === "nos") {
      saida.push({
        chave: "bola",
        sigla: "!",
        tom: "alerta",
        titulo: `${t("Lead esperando resposta há")} ${duracaoCurta(agora.getTime() - new Date(bola.desde).getTime(), t)}`,
        detalhe: lead.conversa?.preview ? `“${lead.conversa.preview}”` : t("A última mensagem é do cliente."),
        acoes: lead.conversa?.id ? (
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link href={`/app/inbox?id=${lead.conversa.id}`}>{t("Abrir conversa")}</Link>
          </Button>
        ) : undefined,
      });
    }
    if (lead.status === "open" && lead.next_action?.label) {
      const responsavel = responsavelDaProximaAcao(lead, ctx.usuarioAtualId ?? "");
      const quem = responsavel === ctx.usuarioAtualId ? t("você") : (nomeDe(responsavel) ?? t("o dono do negócio"));
      const prazo = quandoCurto(prazoDaProximaAcao(agora, fuso).toISOString(), fuso, idioma);
      saida.push({
        chave: "ia",
        sigla: "IA",
        tom: "acento",
        titulo: `${t("Propõe:")} ${lead.next_action.label}`,
        detalhe: `${t("Ao aprovar, vira tarefa para")} ${quem} · ${t("prazo")} ${prazo}`,
        acoes: (
          <>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={decidir.isPending}
              onClick={() =>
                decidir.mutate({ leadId: lead.id, decision: "approve", approvedSeq: lead.next_action!.seq })
              }
            >
              {t("Aprovar e criar tarefa")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={decidir.isPending}
              onClick={() =>
                decidir.mutate({ leadId: lead.id, decision: "dismiss", approvedSeq: lead.next_action!.seq })
              }
            >
              {t("Descartar")}
            </Button>
          </>
        ),
      });
    }
    if (compromisso) {
      const texto = textoDoProximoCompromisso(compromisso, agora, t);
      saida.push({
        chave: "agenda",
        sigla: "AG",
        tom: texto.hoje ? "acento" : "neutro",
        titulo: texto.texto,
        detalhe: texto.hoje ? t("É hoje.") : t("Próximo compromisso deste negócio."),
        acoes: (
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link href="/app/agenda">{t("Ver na agenda")}</Link>
          </Button>
        ),
      });
    }
    const ordenadas = [...lista].sort((a, b) => {
      const da = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
      const db = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
      return da - db;
    });
    const primeira = ordenadas[0];
    if (primeira) {
      const atrasada = primeira.due_date ? new Date(primeira.due_date).getTime() < agora.getTime() : false;
      const prazo = primeira.due_date ? quandoCurto(primeira.due_date, fuso, idioma) : t("sem prazo");
      const mais = ordenadas.length > 1 ? ` · +${ordenadas.length - 1} ${t("tarefas")}` : "";
      saida.push({
        chave: "tarefa",
        sigla: "TF",
        tom: atrasada ? "perigo" : "neutro",
        titulo: `${primeira.title} · ${atrasada ? `${t("atrasada desde")} ${prazo}` : prazo}`,
        detalhe: `${nomeDe(primeira.assigned_to) ?? t("sem responsável")}${mais}`,
        acoes: (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={concluindo === primeira.id}
            onClick={() => {
              setConcluindo(primeira.id);
              void editarTarefa(primeira.id, { status: "done" })
                .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
                .finally(() => setConcluindo(null));
            }}
          >
            {t("Concluir")}
          </Button>
        ),
      });
    }
    return saida.slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead, bola, compromisso, lista, agora, membros, ctx.usuarioAtualId, fuso, idioma, decidir.isPending, concluindo, editarTarefa, t]);

  return (
    <section
      className="rounded-lg border border-border bg-surface p-3"
      data-testid="foco-do-negocio"
      aria-label={t("Foco · o que fazer agora")}
    >
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
        {t("Foco · o que fazer agora")}
      </h3>
      {itens.length === 0 && semObrigacoes ? (
        <p className="text-xs text-text-muted">{t("Nada pendente. Tudo em dia neste negócio.")}</p>
      ) : itens.length === 0 ? null : (
        <ul className="space-y-2">
          {itens.map((i) => (
            <li key={i.chave} className="flex gap-2">
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md px-1 text-[10px] font-semibold",
                  i.tom === "alerta" && "bg-warning-bg text-warning-fg",
                  i.tom === "acento" && "bg-accent/10 text-accent",
                  i.tom === "perigo" && "bg-error-bg text-error-fg",
                  i.tom === "neutro" && "bg-surface-muted text-text-muted",
                  i.tom === "ok" && "bg-success-bg text-success-fg",
                )}
              >
                {i.sigla}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-xs font-medium text-text">{i.titulo}</p>
                <p className="break-words text-[11px] text-text-muted">{i.detalhe}</p>
                {i.acoes ? <div className="mt-1 flex flex-wrap gap-1">{i.acoes}</div> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className={itens.length > 0 && !semObrigacoes ? "mt-2" : undefined}>
        <ObrigacoesNoFoco dados={obrigacoes.data} />
      </div>
      <Compositor lead={lead} />
      {/* O quem-falou da bola, para quem abriu o cartão vir do quadro com a mesma leitura. */}
      {bola && bola.com === "cliente" ? (
        <p className="mt-2 text-[11px] text-text-muted">
          {t("Última mensagem")}: {quemFalouRotulo(bola, { ...ctx, t })} ·{" "}
          {t("há {tempo}").replace("{tempo}", duracaoCurta(agora.getTime() - new Date(bola.desde).getTime(), t))} ·{" "}
          {t("aguardando o cliente")}
        </p>
      ) : null}
    </section>
  );
}

const ABAS = ["nota", "tarefa", "mensagem", "agendar"] as const;
type Aba = (typeof ABAS)[number];

const ROTULO_DA_ABA = {
  nota: "Nota",
  tarefa: "Tarefa",
  mensagem: "Mensagem",
  agendar: "Agendar",
} as const satisfies Record<Aba, string>;

function Compositor({ lead }: { lead: Lead }) {
  const t = useT();
  const [aba, setAba] = useState<Aba>("nota");
  return (
    <div className="mt-3 border-t border-border pt-2" data-testid="compositor-do-negocio">
      <div role="tablist" aria-label={t("Registrar no negócio")} className="mb-2 flex flex-wrap gap-1">
        {ABAS.map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={aba === a}
            onClick={() => setAba(a)}
            className={cn(
              "rounded-md px-2 py-1 text-xs",
              aba === a ? "bg-accent/10 font-medium text-accent" : "text-text-muted hover:bg-surface-muted hover:text-text",
            )}
          >
            {t(ROTULO_DA_ABA[a])}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {aba === "nota" ? <NovaNota leadId={lead.id} /> : null}
        {aba === "tarefa" ? <NovaTarefa lead={lead} /> : null}
        {aba === "mensagem" ? (
          <div className="space-y-1 text-xs text-text-muted">
            <p>{t("A resposta sai pela conversa, respeitando horário, ritmo e a janela de 24 h do número oficial.")}</p>
            {lead.conversa?.id ? (
              <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                <Link href={`/app/inbox?id=${lead.conversa.id}`}>{t("Responder na conversa")}</Link>
              </Button>
            ) : (
              <p>{t("Este negócio ainda não tem conversa.")}</p>
            )}
          </div>
        ) : null}
        {aba === "agendar" ? (
          <div className="space-y-1 text-xs text-text-muted">
            <p>{t("O compromisso marcado para este contato aparece no cartão e no Foco.")}</p>
            {lead.contact_id ? (
              <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                <Link
                  href={`/app/agenda?contato=${lead.contact_id}${lead.conversa?.id ? `&conversa=${lead.conversa.id}` : ""}`}
                >
                  {t("Marcar compromisso")}
                </Link>
              </Button>
            ) : (
              <p>{t("Ligue um contato ao negócio para marcar compromisso.")}</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NovaNota({ leadId }: { leadId: string }) {
  const t = useT();
  const nota = useNotaDoNegocio(leadId);
  const [texto, setTexto] = useState("");
  const [fixada, setFixada] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!texto.trim()) return;
        nota.mutate(
          { texto: texto.trim(), fixada },
          {
            onSuccess: () => {
              setTexto("");
              setFixada(false);
            },
          },
        );
      }}
    >
      <Label htmlFor="nota-do-negocio" className="text-xs">
        {t("Nota interna (a equipe vê; o cliente não)")}
      </Label>
      <Textarea
        id="nota-do-negocio"
        rows={3}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={t("Ex.: o marido só pode aos sábados")}
        className="text-xs"
      />
      <label className="flex items-center gap-2 text-xs text-text-muted">
        <input type="checkbox" checked={fixada} onChange={(e) => setFixada(e.target.checked)} />
        {t("Fixar no topo do histórico")}
      </label>
      <Button type="submit" size="sm" className="h-7 text-xs" disabled={nota.isPending || !texto.trim()}>
        {t("Salvar nota")}
      </Button>
    </form>
  );
}

function NovaTarefa({ lead }: { lead: Lead }) {
  const t = useT();
  const { criarTarefa } = useTasks({ lead_id: lead.id, aberto: true });
  const [salvando, setSalvando] = useState(false);
  const { data: membros } = useAssignableMembers(true);
  const [titulo, setTitulo] = useState("");
  const [prazo, setPrazo] = useState("");
  const [responsavel, setResponsavel] = useState<string>(lead.owner_kind === "user" ? (lead.owner_user_id ?? "") : "");
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!titulo.trim()) return;
        setSalvando(true);
        void criarTarefa({
          title: titulo.trim(),
          due_date: prazo ? new Date(prazo).toISOString() : null,
          priority: "medium",
          lead_id: lead.id,
          contact_id: lead.contact_id,
          assigned_to: responsavel || null,
        })
          .then(() => {
            setTitulo("");
            setPrazo("");
          })
          .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
          .finally(() => setSalvando(false));
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="tarefa-titulo" className="text-xs">
          {t("Tarefa")}
        </Label>
        <Input
          id="tarefa-titulo"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder={t("Ex.: enviar a planta com medidas")}
          className="h-8 text-xs"
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="tarefa-prazo" className="text-xs">
            {t("Prazo")}
          </Label>
          <Input
            id="tarefa-prazo"
            type="datetime-local"
            value={prazo}
            onChange={(e) => setPrazo(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tarefa-responsavel" className="text-xs">
            {t("Responsável")}
          </Label>
          <select
            id="tarefa-responsavel"
            value={responsavel}
            onChange={(e) => setResponsavel(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="">{t("Sem responsável")}</option>
            {(membros ?? []).map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name ?? t("Sem nome")}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Button type="submit" size="sm" className="h-7 text-xs" disabled={salvando || !titulo.trim()}>
        {t("Criar tarefa")}
      </Button>
    </form>
  );
}
