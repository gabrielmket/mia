"use client";

/**
 * FORK MIA — os blocos do cartão aberto: resumo da IA, pessoas, empresa,
 * origem e atribuição, campos do funil, agenda e tarefas.
 *
 * Cada bloco lê de uma área que já grava o dado (ver `lib/cartoes/cartao-aberto.ts`)
 * e leva a ela: o nome da pessoa abre a ficha, a empresa abre a ficha dela, o
 * compromisso abre a agenda, a conversa abre o inbox. As regras moram em
 * `lib/cartoes/`; aqui é só desenho.
 */
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useHierarquiaDoAnuncio } from "@/hooks/contacts/useHierarquiaDoAnuncio";
import { useDecidirProximaAcao } from "@/hooks/kanban/useNextAction";
import { useEditLead } from "@/hooks/kanban/useUpdateLead";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useTasks } from "@/hooks/tasks/useTasks";
import { useConfirmarCampo, useEnvolvidosDoNegocio } from "@/hooks/cartoes/useCartaoAberto";
import { SeletorDeContato } from "@/components/kanban/SeletorDeContato";
import { ContatoDoNegocio } from "@/components/kanban/ContatoDoNegocio";
import { LeadFieldsForm } from "@/components/kanban/LeadFieldsForm";
import type { CustomFieldDef } from "@/components/contacts/CustomFieldsEditor";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types/leads";
import type { Contact } from "@/lib/types/contacts";
import type { TimelineItemView } from "@/lib/types/contacts";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { validaCamposExigidos } from "@/lib/leads/campos-exigidos";
import type { CartaoAberto } from "@/lib/cartoes/cartao-aberto";
import { origemDosCampos } from "@/lib/cartoes/campos-da-conversa";
import { textoDoProximoCompromisso } from "@/lib/cartoes/compromisso";
import { valorCheio } from "@/lib/cartoes/dinheiro";
import { ehPapel, PAPEIS, ROTULO_DO_PAPEL, type Papel } from "@/lib/cartoes/papel";
import { haQuanto } from "@/lib/cartoes/tempo";
import { ROTULO_DO_CANAL } from "@/lib/cartoes/tipos";
import { useAgoraDoCartao } from "@/components/cartoes/ContextoDoCartao";
import { ConversoesDaOrigem } from "./ConversoesDaOrigem";
import { Par, Pares, Secao } from "./Secao";

// ─── Resumo da IA ────────────────────────────────────────────────────────────

const ESTAGIO_DO_CICLO = {
  new: "Novo",
  contacted: "Contatado",
  qualifying: "Qualificando",
  qualified: "Qualificado",
  negotiating: "Negociando",
  won: "Cliente",
  lost: "Perdido",
} as const;

export function ResumoDaIa({
  lead,
  resumo,
  pipelineId,
}: {
  lead: Lead;
  resumo: CartaoAberto["resumo"];
  pipelineId: string;
}) {
  const t = useT();
  const agora = useAgoraDoCartao();
  const decidir = useDecidirProximaAcao(pipelineId);
  if (!resumo) {
    return (
      <Secao titulo={t("Resumo da IA")} testid="resumo-da-ia">
        <p className="text-xs text-text-muted">
          {t("A IA ainda não registrou nada sobre esta pessoa. O resumo aparece depois da primeira conversa com o agente.")}
        </p>
      </Secao>
    );
  }
  const vazio = <span className="text-text-muted">{t("não informado")}</span>;
  const estagio =
    resumo.estagio && resumo.estagio in ESTAGIO_DO_CICLO
      ? t(ESTAGIO_DO_CICLO[resumo.estagio as keyof typeof ESTAGIO_DO_CICLO])
      : null;
  return (
    <Secao
      titulo={t("Resumo da IA")}
      contagem={resumo.atualizadoEm ? haQuanto(resumo.atualizadoEm, agora, t) : null}
      testid="resumo-da-ia"
    >
      <Pares>
        {estagio ? <Par rotulo={t("Estágio")}>{estagio}</Par> : null}
        <Par rotulo={t("Quer")}>{resumo.quer ?? vazio}</Par>
        <Par rotulo={t("Orçamento e pagamento")}>{resumo.orcamento ?? vazio}</Par>
        <Par rotulo={t("Quem decide")}>{resumo.decide ?? vazio}</Par>
        <Par rotulo={t("Prazo")}>{resumo.prazo ?? vazio}</Par>
        <Par rotulo={t("Objeções")}>
          {resumo.objecoes.length === 0 ? (
            <span className="text-text-muted">{t("nenhuma registrada")}</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {resumo.objecoes.map((o) => (
                <span
                  key={o.texto}
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px]",
                    o.aberta ? "bg-warning-bg text-warning-fg" : "bg-success-bg text-success-fg",
                  )}
                >
                  {o.texto} · {o.aberta ? t("aberta") : t("respondida")}
                </span>
              ))}
            </span>
          )}
        </Par>
        <Par rotulo={t("Prometido")}>
          {resumo.promessas.length === 0 && resumo.compromissos.length === 0 ? (
            <span className="text-text-muted">{t("nada prometido em aberto")}</span>
          ) : (
            <ul className="space-y-0.5">
              {resumo.promessas.map((p) => (
                <li key={`p-${p.oQue}`}>
                  {p.oQue}
                  {p.prazo ? ` · ${t("até")} ${format(new Date(p.prazo), "dd/MM HH:mm")}` : ""}
                </li>
              ))}
              {resumo.compromissos.map((c) => (
                <li key={`c-${c}`}>{c}</li>
              ))}
            </ul>
          )}
        </Par>
        <Par rotulo={t("Próxima ação")}>
          {lead.status === "open" && lead.next_action?.label ? (
            <span className="block space-y-1">
              <span className="block">{lead.next_action.label}</span>
              <span className="flex gap-1">
                <Button
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  disabled={decidir.isPending}
                  onClick={() =>
                    decidir.mutate({ leadId: lead.id, decision: "approve", approvedSeq: lead.next_action!.seq })
                  }
                >
                  {t("Aprovar")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  disabled={decidir.isPending}
                  onClick={() =>
                    decidir.mutate({ leadId: lead.id, decision: "dismiss", approvedSeq: lead.next_action!.seq })
                  }
                >
                  {t("Descartar")}
                </Button>
              </span>
              <span className="block text-[11px] text-text-muted">{t("Aprovar cria a tarefa, com prazo e responsável.")}</span>
            </span>
          ) : (
            <span className="text-text-muted">{t("sem proposta pendente")}</span>
          )}
        </Par>
      </Pares>
      {resumo.resumo ? <p className="mt-2 whitespace-pre-wrap text-xs text-text">{resumo.resumo}</p> : null}
      {lead.conversa?.id ? (
        <p className="mt-1 text-[11px] text-text-muted">
          {t("O que a IA sabe vem da conversa")} ·{" "}
          <Link className="underline-offset-2 hover:underline" href={`/app/inbox?id=${lead.conversa.id}`}>
            {t("ver na conversa")}
          </Link>
        </p>
      ) : null}
    </Secao>
  );
}

// ─── Pessoas e empresa ───────────────────────────────────────────────────────

export function PessoasDoNegocio({
  lead,
  cartao,
  pipelineId,
}: {
  lead: Lead;
  cartao: CartaoAberto;
  pipelineId: string;
}) {
  const t = useT();
  const { incluir, retirar } = useEnvolvidosDoNegocio(lead.id, pipelineId);
  const editar = useEditLead(pipelineId);
  const [adicionando, setAdicionando] = useState(false);
  const [escolhido, setEscolhido] = useState<Contact | null>(null);
  const [papel, setPapel] = useState<Papel | "">("");

  const titulo = cartao.empresa ? t("Contatos envolvidos") : t("Pessoas no negócio");
  return (
    <Secao
      titulo={titulo}
      contagem={cartao.pessoas.length}
      testid="pessoas-do-negocio"
      acoes={
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setAdicionando((v) => !v)}>
          {adicionando ? t("Cancelar") : t("Adicionar pessoa")}
        </Button>
      }
    >
      {cartao.pessoas.length === 0 ? (
        <p className="text-xs text-text-muted">{t("Nenhuma pessoa ligada a este negócio.")}</p>
      ) : (
        <ul className="space-y-1.5">
          {cartao.pessoas.map((p) => (
            <li key={p.contatoId} className="flex items-start justify-between gap-2 text-xs">
              <div className="min-w-0">
                <Link href={`/app/contacts/${p.contatoId}`} className="font-medium text-text hover:underline">
                  {p.nome ?? t("Contato")}
                </Link>
                <p className="text-[11px] text-text-muted">
                  {[
                    p.principal ? t("Contato principal") : null,
                    p.cargo,
                    ehPapel(p.papel) ? t(ROTULO_DO_PAPEL[p.papel]) : null,
                    p.telefone ? phoneForDisplay(p.telefone) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                {p.conversaId ? (
                  <Button asChild size="sm" variant="ghost" className="h-6 px-2 text-[11px]">
                    <Link href={`/app/inbox?id=${p.conversaId}`}>{t("Conversa")}</Link>
                  </Button>
                ) : null}
                {!p.principal ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    disabled={retirar.isPending}
                    onClick={() => retirar.mutate(p.contatoId)}
                    aria-label={`${t("Tirar do negócio")}: ${p.nome ?? t("Contato")}`}
                  >
                    {t("Tirar")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {adicionando ? (
        <div className="mt-2 space-y-2 rounded-md border border-border p-2">
          <SeletorDeContato escolhido={escolhido} onEscolher={setEscolhido} />
          <label className="block text-xs">
            <span className="text-text-muted">{t("Papel neste negócio")}</span>
            <select
              value={papel}
              onChange={(e) => setPapel(e.target.value as Papel | "")}
              className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
            >
              <option value="">{t("Sem papel definido")}</option>
              {PAPEIS.map((p) => (
                <option key={p} value={p}>
                  {t(ROTULO_DO_PAPEL[p])}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={!escolhido || incluir.isPending}
            onClick={() =>
              escolhido &&
              incluir.mutate(
                { contactId: escolhido.id, papel: papel || null },
                {
                  onSuccess: () => {
                    setEscolhido(null);
                    setPapel("");
                    setAdicionando(false);
                  },
                },
              )
            }
          >
            {t("Incluir no negócio")}
          </Button>
        </div>
      ) : null}

      {cartao.outrosNegocios.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-medium text-text-muted">{t("Outros negócios desta pessoa")}</p>
          <ul className="space-y-1">
            {cartao.outrosNegocios.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 text-xs">
                <Link href={`/app/leads/${o.id}`} className="min-w-0 truncate text-text hover:underline">
                  {o.titulo}
                </Link>
                <span className="shrink-0 text-[11px] text-text-muted">
                  {o.status === "won"
                    ? t("ganho")
                    : o.status === "lost"
                      ? `${t("perdido")}${o.motivoDaPerda ? ` · ${o.motivoDaPerda}` : ""}`
                      : (o.etapa ?? t("aberto"))}
                  {o.valorCents ? ` · ${valorCheio(o.valorCents, o.moeda)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {cartao.empresaDoContato && lead.status === "open" ? (
        <p className="mt-2 text-[11px] text-text-muted">
          {t("Esta pessoa é de")} <b className="font-medium text-text">{cartao.empresaDoContato.nome}</b>.{" "}
          <button
            type="button"
            className="underline-offset-2 hover:underline"
            disabled={editar.isPending}
            onClick={() =>
              editar.mutate({ leadId: lead.id, patch: { empresa_id: cartao.empresaDoContato!.id } })
            }
          >
            {t("Ligar este negócio à empresa")}
          </button>
        </p>
      ) : null}

      {lead.contact_id ? (
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-medium text-text-muted">{t("Dados do contato principal")}</p>
          <ContatoDoNegocio contactId={lead.contact_id} pipelineId={pipelineId} />
        </div>
      ) : null}
    </Secao>
  );
}

export function EmpresaDoNegocio({ empresa }: { empresa: CartaoAberto["empresa"] }) {
  const t = useT();
  if (!empresa) return null;
  return (
    <Secao titulo={t("Empresa")} testid="empresa-do-negocio">
      <p className="mb-1 text-xs">
        <Link href={`/app/empresas/${empresa.id}`} className="font-medium text-text hover:underline">
          {empresa.nome}
        </Link>
      </p>
      <Pares>
        {empresa.cnpj ? <Par rotulo={t("CNPJ")}>{empresa.cnpj}</Par> : null}
        {empresa.telefone ? <Par rotulo={t("Telefone")}>{empresa.telefone}</Par> : null}
        {empresa.site ? <Par rotulo={t("Site")}>{empresa.site}</Par> : null}
      </Pares>
    </Secao>
  );
}

// ─── Origem e atribuição ─────────────────────────────────────────────────────

export function OrigemDoNegocio({
  lead,
  origem,
  camposDoFunil,
}: {
  lead: Lead;
  origem: CartaoAberto["origem"];
  camposDoFunil: CustomFieldDef[];
}) {
  const t = useT();
  const locale = useLocaleDeData();
  const hierarquia = useHierarquiaDoAnuncio(lead.contact_id ?? "", origem.anuncioSemNome);
  const campanha = origem.campanha ?? hierarquia.data?.campaign_name ?? null;
  const conjunto = origem.conjunto ?? hierarquia.data?.adset_name ?? null;
  const anuncio = origem.anuncio ?? hierarquia.data?.ad_name ?? null;

  // As respostas do formulário da Meta moram nos campos do negócio, com a
  // pergunta como chave — e as que o funil não declarou nenhuma tela mostrava.
  const definidas = new Set(camposDoFunil.map((c) => c.key));
  const respostas =
    origem.canal.sigla === "FORM"
      ? Object.entries(lead.custom_fields ?? {}).filter(
          ([k, v]) => !definidas.has(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"),
        )
      : [];

  return (
    <Secao titulo={t("Origem e atribuição")} testid="origem-do-negocio">
      <Pares>
        <Par rotulo={t("Canal")}>{t(ROTULO_DO_CANAL[origem.canal.sigla])}</Par>
        {campanha ? <Par rotulo={t("Campanha")}>{campanha}</Par> : null}
        {conjunto ? <Par rotulo={t("Conjunto")}>{conjunto}</Par> : null}
        {anuncio ? <Par rotulo={t("Anúncio")}>{anuncio}</Par> : null}
        {origem.primeiraMensagem ? (
          <Par rotulo={t("1ª mensagem")}>
            “{origem.primeiraMensagem.texto}”
            <span className="block text-[11px] text-text-muted">
              {format(new Date(origem.primeiraMensagem.em), "dd/MM/yyyy HH:mm", { locale })}
            </span>
          </Par>
        ) : null}
        {origem.primeiroToque ? (
          <Par rotulo={t("1º toque")}>{format(new Date(origem.primeiroToque.em), "dd/MM/yyyy HH:mm", { locale })}</Par>
        ) : null}
        {respostas.length > 0 ? (
          <Par rotulo={t("Formulário")}>
            <ul className="space-y-0.5">
              {respostas.map(([pergunta, resposta]) => (
                <li key={pergunta}>
                  {pergunta}: <b className="font-medium">{String(resposta)}</b>
                </li>
              ))}
            </ul>
          </Par>
        ) : null}
      </Pares>
      {/* FORK MIA (9017): por plataforma, o que foi informado e quando, ou por que não foi. */}
      <ConversoesDaOrigem origem={origem} />
    </Secao>
  );
}

// ─── Campos do funil ─────────────────────────────────────────────────────────

function valorLegivel(v: unknown, def: CustomFieldDef, t: (x: string) => string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? t("Sim") : t("Não");
  if (Array.isArray(v)) {
    const rot = v.map((x) => def.options?.find((o) => o.value === x)?.label ?? String(x));
    return rot.length > 0 ? rot.join(", ") : null;
  }
  const opcao = def.options?.find((o) => o.value === v);
  return opcao?.label ?? String(v);
}

export function CamposDoSegmento({
  lead,
  pipelineId,
  camposDoFunil,
  settingsDoFunil,
  proximaEtapa,
  timeline,
  podeVerEquipe,
}: {
  lead: Lead;
  pipelineId: string;
  camposDoFunil: CustomFieldDef[];
  settingsDoFunil: Record<string, unknown> | null;
  proximaEtapa: { id: string; nome: string } | null;
  timeline: TimelineItemView[];
  podeVerEquipe: boolean;
}) {
  const t = useT();
  const confirmar = useConfirmarCampo(lead.id);
  const [editando, setEditando] = useState(false);
  const origem = useMemo(() => origemDosCampos(timeline), [timeline]);
  const faltando = useMemo(() => {
    if (!proximaEtapa) return new Set<string>();
    const v = validaCamposExigidos({
      lead: lead as unknown as Record<string, unknown>,
      settingsDoFunil,
      destino: { stageId: proximaEtapa.id },
    });
    return new Set(v.faltando.map((f) => f.chave));
  }, [lead, settingsDoFunil, proximaEtapa]);

  return (
    <Secao
      titulo={t("Campos do funil")}
      contagem={camposDoFunil.length}
      testid="campos-do-segmento"
      acoes={
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setEditando((v) => !v)}>
          {editando ? t("Fechar edição") : t("Editar campos")}
        </Button>
      }
    >
      {camposDoFunil.length === 0 ? (
        <p className="text-xs text-text-muted">
          {t("Este funil não tem campos próprios. Eles se cadastram em Configurações › Funis.")}
        </p>
      ) : (
        <Pares>
          {camposDoFunil.map((def) => {
            const valor = valorLegivel((lead.custom_fields ?? {})[def.key], def, t);
            const marca = origem.get(def.key);
            const exigido = faltando.has(def.key);
            return (
              <Par key={def.key} rotulo={def.label}>
                {valor ?? <span className="text-text-muted">{t("não preenchido")}</span>}
                {valor && marca?.veioDaConversa ? (
                  <span className="ml-1 inline-flex items-center gap-1">
                    <span className="rounded-full bg-info-bg px-1.5 text-[10px] text-info-fg">{t("veio da conversa")}</span>
                    <button
                      type="button"
                      className="text-[11px] text-accent underline-offset-2 hover:underline"
                      disabled={confirmar.isPending}
                      onClick={() => confirmar.mutate(def.key)}
                    >
                      {t("Confirmar")}
                    </button>
                  </span>
                ) : null}
                {exigido && proximaEtapa ? (
                  <span className="ml-1 rounded-full bg-warning-bg px-1.5 text-[10px] text-warning-fg">
                    {t("obrigatório para")} {proximaEtapa.nome}
                  </span>
                ) : null}
              </Par>
            );
          })}
        </Pares>
      )}
      {camposDoFunil.length > 0 ? (
        <p className="mt-2 text-[11px] text-text-muted">
          {t("A IA preenche da conversa; o que ela preencheu fica marcado até alguém confirmar.")}
        </p>
      ) : null}
      {editando ? (
        <div className="mt-3 border-t border-border pt-3">
          <LeadFieldsForm lead={lead} pipelineId={pipelineId} fieldDefs={camposDoFunil} podeVerEquipe={podeVerEquipe} />
        </div>
      ) : null}
    </Secao>
  );
}

// ─── Agenda e tarefas ────────────────────────────────────────────────────────

const RESULTADO_DO_COMPROMISSO = {
  completed: "compareceu",
  no_show: "faltou",
  cancelled: "cancelado",
} as const;

export function AgendaDoNegocio({ agenda, contatoId }: { agenda: CartaoAberto["agenda"]; contatoId: string | null }) {
  const t = useT();
  const agora = useAgoraDoCartao();
  const futuros = agenda.filter((a) => new Date(a.fim).getTime() > agora.getTime() && !a.resultado);
  const passados = agenda.filter((a) => !futuros.includes(a));
  return (
    <Secao
      titulo={t("Agenda")}
      contagem={agenda.length}
      testid="agenda-do-negocio"
      acoes={
        contatoId ? (
          <Button asChild size="sm" variant="ghost" className="h-6 px-2 text-[11px]">
            <Link href={`/app/agenda?contato=${contatoId}`}>{t("Marcar")}</Link>
          </Button>
        ) : undefined
      }
    >
      {agenda.length === 0 ? (
        <p className="text-xs text-text-muted">{t("Nenhum compromisso deste negócio.")}</p>
      ) : (
        <ul className="space-y-1">
          {[...futuros.reverse(), ...passados].map((a) => {
            const texto = textoDoProximoCompromisso(a, agora, t);
            return (
              <li key={a.id} className="flex items-start justify-between gap-2 text-xs">
                <span className={cn("min-w-0", a.resultado ? "text-text-muted" : "text-text")}>{texto.texto}</span>
                <span className="shrink-0 text-[11px] text-text-muted">
                  {a.resultado && a.resultado in RESULTADO_DO_COMPROMISSO
                    ? t(RESULTADO_DO_COMPROMISSO[a.resultado as keyof typeof RESULTADO_DO_COMPROMISSO])
                    : new Date(a.fim).getTime() > agora.getTime()
                      ? t("marcado")
                      : t("sem resultado")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Secao>
  );
}

export function TarefasDoNegocio({ leadId }: { leadId: string }) {
  const t = useT();
  const agora = useAgoraDoCartao();
  const { tarefas, alternarConcluida } = useTasks({ lead_id: leadId });
  const { data: membros } = useAssignableMembers(true);
  const abertas = tarefas.filter((x) => x.status === "pending" || x.status === "in_progress");
  return (
    <Secao titulo={t("Tarefas")} contagem={`${abertas.length} ${t("abertas")}`} testid="tarefas-do-negocio">
      {tarefas.length === 0 ? (
        <p className="text-xs text-text-muted">{t("Nenhuma tarefa. Crie uma no Foco, acima.")}</p>
      ) : (
        <ul className="space-y-1">
          {tarefas.map((x) => {
            const feita = x.status === "done" || x.status === "cancelled";
            const atrasada = !feita && x.due_date ? new Date(x.due_date).getTime() < agora.getTime() : false;
            const dono = membros?.find((m) => m.user_id === x.assigned_to)?.full_name ?? null;
            return (
              <li key={x.id} className="flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <p className={cn(feita ? "text-text-muted line-through" : "text-text")}>{x.title}</p>
                  <p className="text-[11px] text-text-muted">
                    {[dono, x.due_date ? format(new Date(x.due_date), "dd/MM HH:mm") : t("sem prazo")]
                      .filter(Boolean)
                      .join(" · ")}
                    {atrasada ? <span className="ml-1 font-medium text-error-fg">{t("atrasada")}</span> : null}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 shrink-0 px-2 text-[11px]"
                  onClick={() => void alternarConcluida(x).catch(() => undefined)}
                >
                  {feita ? t("Reabrir") : t("Concluir")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Secao>
  );
}
