"use client";

/**
 * FORK MIA — O CARTÃO ABERTO: a gaveta larga do negócio, com "tela cheia".
 *
 * Substitui, no quadro, o dossiê estreito do upstream (`LeadDossier`, que segue
 * no repositório) e REUSA as peças dele — `ConversaNoDossie`, `ContatoDoNegocio`,
 * `LeadFieldsForm`, `PropostasDoNegocio`, `ScoreSlot`, `OwnerBadge`, a linha do
 * tempo viva (`useLeadTimeline`) e o vocabulário dela. Peça nova do upstream no
 * dossiê precisa entrar aqui também: `tests/unit/cartao-aberto-mia.test.tsx`
 * reprova quando o dossiê importa um componente que o cartão aberto não importa.
 *
 * A composição (plano v2, §4.2, aprovada no protótipo):
 *   cabeçalho — título, valor, etapa, dono, faixa, canal, ganho/perdido, o
 *               compromisso e o fechamento previsto, e a BARRA DE ETAPAS com os
 *               dias em cada uma (clicar numa etapa move o negócio pelo mesmo
 *               caminho do arrasto, com a mesma recusa de campos obrigatórios);
 *   Foco      — o que fazer agora, e o compositor (à direita no computador; em
 *               cima no celular);
 *   blocos    — resumo da IA, documentos e obrigações (do negócio, da empresa e
 *               do contato), pessoas, empresa, compras, origem, campos, agenda,
 *               tarefas, propostas;
 *   histórico — com filtros e as ações da IA agrupadas.
 */
import Link from "next/link";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useT } from "@/hooks/i18n/useT";
import { useActiveOrg, useUser } from "@/hooks/auth/AuthProvider";
import { usePodeVerEquipe } from "@/hooks/kanban/usePodeVerEquipe";
import { useLeadTimeline } from "@/hooks/leads/useLeadTimeline";
import { useWinLead } from "@/hooks/kanban/useUpdateLead";
import { useCartaoAberto } from "@/hooks/cartoes/useCartaoAberto";
import { ROLE_RANK } from "@/lib/auth/types";
import { resolveLeadOwner } from "@/lib/kanban/owner";
import { formatValorDoNegocio, MOEDA_PADRAO } from "@/lib/money";
import type { Lead } from "@/lib/types/leads";
import type { Stage } from "@/lib/kanban/types";
import type { CustomFieldDef } from "@/components/contacts/CustomFieldsEditor";
import { ArrowsClockwise, ArrowsOutSimple, CheckCircle } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { prefixoDoCartao } from "@/lib/cartoes/identidade";
import { valorCurto } from "@/lib/cartoes/dinheiro";
import { ROTULO_DO_CANAL, SELO_DO_CANAL } from "@/lib/cartoes/tipos";
import { ConversaNoDossie } from "@/components/kanban/ConversaNoDossie";
import { OwnerBadge } from "@/components/kanban/OwnerBadge";
import { ScoreSlot } from "@/components/kanban/ScoreSlot";
import { PropostasDoNegocio } from "@/components/kanban/PropostasDoNegocio";
import { LoseLeadDialog } from "@/components/kanban/LoseLeadDialog";
import { LinhaDoCompromisso, LinhaDoFechamento } from "@/components/cartoes/LinhasDoCartao";
import { HistoricoDeCompras } from "@/components/cartoes/HistoricoDeCompras";
import { Foco } from "./Foco";
import {
  AgendaDoNegocio,
  CamposDoSegmento,
  EmpresaDoNegocio,
  OrigemDoNegocio,
  PessoasDoNegocio,
  ResumoDaIa,
  TarefasDoNegocio,
} from "./Blocos";
import { HistoricoDoNegocio } from "./HistoricoDoNegocio";
import { SecaoDeObrigacoes } from "@/components/obrigacoes/SecaoDeObrigacoes";

const CHAVE_DA_TELA_CHEIA = "mia.cartao-aberto.tela-cheia";

function lerTelaCheia(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_DA_TELA_CHEIA) === "1";
  } catch {
    return false;
  }
}

function gravarTelaCheia(v: boolean) {
  try {
    window.localStorage.setItem(CHAVE_DA_TELA_CHEIA, v ? "1" : "0");
  } catch {
    // Navegador sem armazenamento: a escolha vale só nesta abertura.
  }
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: Lead;
  pipelineId: string;
  fieldDefs?: CustomFieldDef[];
  settingsDoFunil?: Record<string, unknown> | null;
  stages: Stage[];
  stageName: string;
  ownerNames?: Map<string, string | null>;
  /** Mover pela barra de etapas: o MESMO caminho do arrasto do quadro. */
  onMoverEtapa?: (stageId: string) => void;
}

export function CartaoAberto({
  open,
  onOpenChange,
  lead,
  pipelineId,
  fieldDefs = [],
  settingsDoFunil = null,
  stages,
  stageName,
  ownerNames,
  onMoverEtapa,
}: Props) {
  const t = useT();
  const user = useUser();
  const activeOrg = useActiveOrg();
  const podeCriarProposta =
    user.is_platform_admin || (activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager) || false;
  const podeVerEquipe = usePodeVerEquipe();
  const timeline = useLeadTimeline(open ? lead.id : null, lead.contact_id);
  const cartao = useCartaoAberto(open ? lead.id : null);
  const ganhar = useWinLead(pipelineId);
  const [perdendo, setPerdendo] = useState(false);
  // A escolha fica no navegador de quem olha (conveniência, não dado).
  const [telaCheia, setTelaCheia] = useState(lerTelaCheia);
  const compras = useRef<HTMLDivElement | null>(null);

  const owner = resolveLeadOwner(lead, ownerNames);
  const score = lead.score ?? null;
  const aberto = lead.status === "open";
  const dados = cartao.data;
  const prefixo = lead.cartao
    ? prefixoDoCartao({ titulo: lead.title, empresa: lead.empresa_nome, contato: lead.cartao.contatoNome })
    : null;
  const ordenadas = [...stages].filter((s) => !s.is_won && !s.is_lost).sort((a, b) => a.position - b.position);
  const posAtual = ordenadas.findIndex((s) => s.id === lead.stage_id);
  const proxima = posAtual >= 0 ? (ordenadas[posAtual + 1] ?? null) : null;
  const diasDe = new Map((dados?.etapas ?? []).map((e) => [e.id, e.dias]));
  const pessoaPrincipal = dados?.pessoas.find((p) => p.principal) ?? null;
  const empresaDoNegocio = dados?.empresa ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "flex w-full flex-col gap-0 overflow-y-auto",
          telaCheia ? "sm:max-w-none" : "sm:max-w-5xl",
        )}
        data-testid="cartao-aberto"
        data-tela-cheia={telaCheia ? "sim" : "nao"}
        // Observáveis como no dossiê do upstream: "a entrega morreu" e "nada
        // aconteceu" têm a mesma aparência, que é silêncio.
        data-realtime-status={timeline.realtimeStatus.toLowerCase()}
        data-refetch-divergencias={timeline.seguranca.divergencias}
      >
        {/* A trilha: de onde se chega a este negócio, e para onde se vai. */}
        <nav aria-label={t("Como as áreas se ligam")} className="mb-2 flex flex-wrap items-center gap-1 pr-8 text-[11px] text-text-muted">
          {lead.conversa?.id ? (
            <Link href={`/app/inbox?id=${lead.conversa.id}`} className="hover:text-text hover:underline">
              {t("Conversa")}
            </Link>
          ) : (
            <span>{t("sem conversa")}</span>
          )}
          <span aria-hidden>›</span>
          {lead.contact_id ? (
            <Link href={`/app/contacts/${lead.contact_id}`} className="hover:text-text hover:underline">
              {pessoaPrincipal?.nome ?? t("Contato")}
            </Link>
          ) : (
            <span>{t("sem contato")}</span>
          )}
          <span aria-hidden>›</span>
          {empresaDoNegocio ? (
            <Link href={`/app/empresas/${empresaDoNegocio.id}`} className="hover:text-text hover:underline">
              {empresaDoNegocio.nome}
            </Link>
          ) : (
            <span>{t("sem empresa")}</span>
          )}
          <span aria-hidden>›</span>
          <b className="font-medium text-text">{t("Negócio")}</b>
        </nav>

        <SheetHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-2 pr-8">
            <div className="min-w-0">
              {prefixo ? <p className="text-xs text-text-muted">{prefixo}</p> : null}
              <SheetTitle className="text-base leading-6">{lead.title}</SheetTitle>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {lead.status === "won" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-fg">
                    <CheckCircle size={12} aria-hidden /> {t("Ganho")}
                  </span>
                ) : lead.status === "lost" ? (
                  <span className="rounded-full bg-error-bg px-2 py-0.5 text-[11px] font-medium text-error-fg">
                    {t("Perdido")}
                    {lead.lost_reason ? ` · ${lead.lost_reason}` : ""}
                  </span>
                ) : null}
                {dados?.compras ? (
                  <button
                    type="button"
                    onClick={() => compras.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-fg hover:underline"
                    title={t("Ir ao histórico de compras")}
                  >
                    <ArrowsClockwise size={12} aria-hidden />
                    {t("Já comprou")} {dados.compras.quantidade}x · {valorCurto(dados.compras.totalCents, dados.compras.moeda)}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              {aberto ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-success-fg/40 text-xs text-success-fg"
                    disabled={ganhar.isPending}
                    onClick={() => ganhar.mutate({ leadId: lead.id })}
                  >
                    {t("Ganho")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-error-fg/40 text-xs text-error-fg"
                    onClick={() => setPerdendo(true)}
                  >
                    {t("Perdido")}
                  </Button>
                </>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                aria-pressed={telaCheia}
                onClick={() => {
                  setTelaCheia((v) => {
                    gravarTelaCheia(!v);
                    return !v;
                  });
                }}
              >
                <ArrowsOutSimple size={14} className="mr-1" aria-hidden />
                {telaCheia ? t("Sair da tela cheia") : t("Tela cheia")}
              </Button>
            </div>
          </div>
        </SheetHeader>

        {/* valor · etapa · dono · faixa · canal */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span className="font-medium tabular-nums text-text">
            {lead.value_cents === null
              ? "—"
              : formatValorDoNegocio(lead.value_cents, lead.currency ?? MOEDA_PADRAO, { semCentavos: true })}
          </span>
          <span className="text-text-muted">{stageName}</span>
          <OwnerBadge ownerKind={owner.kind} ownerName={owner.name} agentVersion={owner.agentVersion} />
          {score ? (
            <ScoreSlot
              probability={score.probability}
              band={score.band}
              reason={score.reason}
              factors={score.factors.slice(0, 3)}
            />
          ) : null}
          {dados ? (
            <span className="inline-flex items-center gap-1 text-text-muted" title={t(ROTULO_DO_CANAL[dados.origem.canal.sigla])}>
              <span className="rounded-sm border border-border px-1 text-[9px] font-semibold uppercase text-text">
                {t(SELO_DO_CANAL[dados.origem.canal.sigla])}
              </span>
              {dados.origem.campanha ?? ""}
            </span>
          ) : null}
        </div>
        {lead.cartao ? (
          <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
            <LinhaDoCompromisso compromisso={lead.cartao.compromisso} />
            <LinhaDoFechamento lead={lead} />
          </div>
        ) : null}

        {/* A barra de etapas, com os dias em cada uma. */}
        <ol
          className="mt-2 flex flex-wrap gap-1 border-b border-border pb-3"
          aria-label={t("Etapas do funil com os dias em cada uma")}
          data-testid="barra-de-etapas"
        >
          {ordenadas.map((s, i) => {
            const atual = s.id === lead.stage_id;
            const feita = posAtual >= 0 && i < posAtual;
            const dias = diasDe.get(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={!aberto || atual || !onMoverEtapa}
                  aria-current={atual ? "step" : undefined}
                  title={atual ? t("Etapa atual") : `${t("Mover para")} ${s.name}`}
                  onClick={() => onMoverEtapa?.(s.id)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px] transition-colors",
                    atual && "border-accent bg-accent/10 font-medium text-accent",
                    feita && !atual && "border-border bg-surface-muted text-text",
                    !atual && !feita && "border-dashed border-border text-text-muted",
                    aberto && !atual && onMoverEtapa && "hover:border-accent hover:text-text",
                  )}
                >
                  {s.name}
                  {dias !== null && dias !== undefined ? <span className="ml-1 tabular-nums text-text-muted">· {dias}d</span> : null}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="grid gap-x-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
          <div className="pt-3 lg:order-2">
            <div className="lg:sticky lg:top-0">
              <Foco lead={lead} pipelineId={pipelineId} />
            </div>
          </div>
          <div className="min-w-0 lg:order-1">
            {/* Upstream 1.71 (#2207): sem conversa e com contato, vira o botão
                "Abrir conversa" (a mesma rota da tabela de contatos). */}
            <ConversaNoDossie conversa={lead.conversa} contactId={lead.contact_id} phone={lead.contact_phone} />
            {cartao.isLoading ? (
              <p className="py-3 text-xs text-text-muted">{t("Carregando…")}</p>
            ) : cartao.isError || !dados ? (
              <p className="py-3 text-xs text-warning-fg">
                {t("Não consegui carregar os dados do negócio. Tente de novo em instantes.")}
              </p>
            ) : (
              <>
                <ResumoDaIa lead={lead} resumo={dados.resumo} pipelineId={pipelineId} />
                {/* Documentos e atividades recorrentes: os do negócio e, por
                    herança, os da empresa e os do contato. As propostas do
                    agente ficam no Foco. */}
                <SecaoDeObrigacoes escopo={{ tipo: "negocio", id: lead.id }} mostrarPropostas={false} id="documentos-do-negocio" />
                <PessoasDoNegocio lead={lead} cartao={dados} pipelineId={pipelineId} />
                <EmpresaDoNegocio empresa={dados.empresa} />
                <div ref={compras}>
                  <HistoricoDeCompras resumo={dados.compras} modo="negocio" id="compras-do-negocio" />
                </div>
                <OrigemDoNegocio lead={lead} origem={dados.origem} camposDoFunil={fieldDefs} />
                <CamposDoSegmento
                  lead={lead}
                  pipelineId={pipelineId}
                  camposDoFunil={fieldDefs}
                  settingsDoFunil={settingsDoFunil}
                  proximaEtapa={proxima ? { id: proxima.id, nome: proxima.name } : null}
                  timeline={timeline.itens}
                  podeVerEquipe={podeVerEquipe}
                />
                <AgendaDoNegocio agenda={dados.agenda} contatoId={lead.contact_id} />
              </>
            )}
            <TarefasDoNegocio leadId={lead.id} />
            <PropostasDoNegocio leadId={lead.id} pipelineId={pipelineId} podeCriar={podeCriarProposta} />
          </div>
        </div>

        <HistoricoDoNegocio
          itens={timeline.itens}
          chegouAoVivo={timeline.chegouAoVivo}
          isLoading={timeline.isLoading}
          isError={timeline.isError}
          conversaId={lead.conversa?.id}
        />

        <LoseLeadDialog open={perdendo} onOpenChange={setPerdendo} leadId={lead.id} pipelineId={pipelineId} />
      </SheetContent>
    </Sheet>
  );
}
