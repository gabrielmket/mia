"use client";

/**
 * FORK MIA — a FICHA DO CONTATO conectada às outras áreas: a pessoa no centro.
 *
 * Empresa OPCIONAL (regra do Gabriel, 30/09: "o contato pode ser vinculado a uma
 * empresa ou não"): sem empresa, nenhum campo vazio — só o link discreto
 * "Vincular a uma empresa"; e quem vende só a pessoas (modo B2C) não vê nada de
 * empresa. Desde a .79 (empresa única, protótipo aprovado em 15/10/2026, tela
 * 3): o contato pode estar em VÁRIAS empresas, com papel e cargo em cada uma, e
 * uma delas aparece no cartão; e vários números da mesma pessoa são uma pessoa
 * só (cada número segue com a sua conversa). Depois: negócios (os dele e os em que está envolvido), conversas,
 * estágio do ciclo, resumo e memória da IA, agenda, tarefas e histórico de
 * compras. Os dados propostos pela IA para aprovar continuam no topo da página
 * (`PropostasDeDado`, do upstream).
 *
 * Plugado na aba "Visão geral" da ficha do upstream por uma linha.
 */
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { useMostraEmpresas } from "@/hooks/useMostraEmpresas";
import { useDefaultPipeline } from "@/hooks/pipelines/useDefaultPipeline";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useTasks } from "@/hooks/tasks/useTasks";
import { useFichaDoContato } from "@/hooks/cartoes/useFichas";
import { useDesvincularPessoa, useJuntarNumeros, useSepararNumero, useVincularPessoa } from "@/hooks/useEmpresas";
import { SeletorDeContato } from "@/components/kanban/SeletorDeContato";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import type { Contact } from "@/lib/types/contacts";
import { apiClient } from "@/lib/api/client";
import { SeletorDeEmpresa } from "@/components/empresas/SeletorDeEmpresa";
import { NewLeadDialog } from "@/components/kanban/NewLeadDialog";
import { HistoricoDeCompras } from "@/components/cartoes/HistoricoDeCompras";
import { SecaoDeObrigacoes } from "@/components/obrigacoes/SecaoDeObrigacoes";
import { Par, Pares, Secao } from "@/components/cartoes/aberto/Secao";
import { useAgoraDoCartao } from "@/components/cartoes/ContextoDoCartao";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { textoDoProximoCompromisso } from "@/lib/cartoes/compromisso";
import { valorCheio, valorCurto } from "@/lib/cartoes/dinheiro";
import { ehPapel, PAPEIS, ROTULO_DO_PAPEL, type Papel } from "@/lib/cartoes/papel";
import type { FichaDoContato } from "@/lib/cartoes/fichas-servidor";

const ETAPAS_DO_CICLO = ["new", "qualifying", "qualified", "negotiating", "won"] as const;
const ROTULO_DO_CICLO = {
  new: "Novo",
  qualifying: "Qualificando",
  qualified: "Qualificado",
  negotiating: "Negociando",
  won: "Cliente",
} as const;

const ROTULO_DO_STATUS = { open: "aberto", won: "ganho", lost: "perdido" } as const;

const RESULTADO = { completed: "compareceu", no_show: "faltou", cancelled: "cancelado" } as const;

export function FichaConectadaDoContato({
  contactId,
  anonimizado,
  carteira,
}: {
  contactId: string;
  anonimizado: boolean;
  /**
   * (.81) O cartão "Carteira" do upstream (`CartaoDaCarteira`, #2591: o vendedor
   * dono do cliente), passado pela página para morar DENTRO da ficha, logo depois
   * de quem é a pessoa (números e empresa). Quem decide se ele aparece (só de
   * `agent` para cima) continua sendo a página, com a régua do upstream.
   */
  carteira?: ReactNode;
}) {
  const t = useT();
  const ficha = useFichaDoContato(contactId);
  const mostraEmpresa = useMostraEmpresas();

  if (ficha.isLoading) return <p className="text-xs text-text-muted">{t("Carregando…")}</p>;
  if (ficha.isError || !ficha.data) {
    return (
      <p className="text-xs text-warning-fg">
        {t("Não consegui carregar os negócios, a agenda e as compras deste contato. Tente de novo em instantes.")}
      </p>
    );
  }
  const f = ficha.data;
  return (
    <div className="grid gap-x-6 lg:grid-cols-2" data-testid="ficha-conectada-do-contato">
      <div className="min-w-0">
        <Ciclo estagio={f.estagio} temCompra={Boolean(f.compras)} />
        {!anonimizado ? <NumerosDaPessoa contactId={contactId} ficha={f} /> : null}
        {mostraEmpresa && !anonimizado ? <EmpresaDoContato contactId={contactId} ficha={f} /> : null}
        {carteira ? <div className="mb-4">{carteira}</div> : null}
        <NegociosDoContato contactId={contactId} ficha={f} />
        <ConversasDoContato ficha={f} />
        <HistoricoDeCompras
          resumo={f.compras}
          modo="contato"
          id="compras-do-contato"
          rodape={
            f.comprasDaEmpresa && f.empresa ? (
              <p className="text-[11px] text-text-muted">
                {t("A empresa soma")} {f.comprasDaEmpresa.quantidade} {t("compras")} ·{" "}
                {valorCurto(f.comprasDaEmpresa.totalCents, f.comprasDaEmpresa.moeda)} {t("com todos os contatos")} ·{" "}
                <Link className="underline-offset-2 hover:underline" href={`/app/companies/${f.empresa.id}`}>
                  {t("Ver na ficha da empresa")}
                </Link>
              </p>
            ) : null
          }
        />
      </div>
      <div className="min-w-0">
        {/* Os documentos e as atividades da pessoa (e, por herança, os da
            empresa dela). Contato anonimizado não tem mais nenhum: a
            anonimização os leva junto (migration 9018). */}
        {anonimizado ? null : <SecaoDeObrigacoes escopo={{ tipo: "contato", id: contactId }} id="documentos-do-contato" />}
        <ResumoDoContato ficha={f} />
        <MemoriaDaIa ficha={f} />
        <AgendaDoContato ficha={f} contactId={contactId} />
        <TarefasDoContato contactId={contactId} />
      </div>
    </div>
  );
}

function Ciclo({ estagio, temCompra }: { estagio: string | null; temCompra: boolean }) {
  const t = useT();
  const atual = temCompra || estagio === "won" ? 4 : Math.max(0, ETAPAS_DO_CICLO.indexOf((estagio ?? "new") as (typeof ETAPAS_DO_CICLO)[number]));
  return (
    <ol className="flex flex-wrap gap-1 border-b border-border py-3" aria-label={t("Estágio do ciclo")}>
      {ETAPAS_DO_CICLO.map((e, i) => (
        <li
          key={e}
          aria-current={i === atual ? "step" : undefined}
          className={cn(
            "rounded-md border px-2 py-0.5 text-[11px]",
            i === atual && "border-accent bg-accent/10 font-medium text-accent",
            i < atual && "border-border bg-surface-muted text-text",
            i > atual && "border-dashed border-border text-text-muted",
          )}
        >
          {t(ROTULO_DO_CICLO[e])}
        </li>
      ))}
    </ol>
  );
}

/** O `<select>` das fichas: 44px e 16px no celular, como `components/ui/input.tsx`. */
const SELECT =
  "min-h-11 w-full rounded-md border border-border bg-background px-2 text-base lg:min-h-0 lg:h-8 lg:text-xs";

/**
 * FORK MIA (.79) — os números da MESMA pessoa (`contacts.person_id`). Cada um
 * segue com a sua conversa; a ficha, as empresas e os negócios são um só.
 * Juntar soma as empresas dos dois; separar leva uma cópia delas.
 */
function NumerosDaPessoa({ contactId, ficha }: { contactId: string; ficha: FichaDoContato }) {
  const t = useT();
  const juntar = useJuntarNumeros();
  const separar = useSepararNumero();
  const [juntando, setJuntando] = useState(false);
  const [outro, setOutro] = useState<Contact | null>(null);
  const outros = ficha.outrosNumeros ?? [];

  if (outros.length === 0 && !juntando) {
    return (
      <p className="border-b border-border py-3 text-xs">
        <button type="button" className="min-h-11 text-accent underline-offset-2 hover:underline lg:min-h-0" onClick={() => setJuntando(true)}>
          + {t("Outro número desta pessoa")}
        </button>
      </p>
    );
  }

  return (
    <Secao titulo={t("Números desta pessoa")} contagem={outros.length + 1} testid="numeros-da-pessoa">
      {outros.length > 0 ? (
        <>
          <p className="mb-1 text-[11px] text-text-muted">
            {t("{n} números, a mesma pessoa. Cada número continua com a sua conversa; a ficha, a empresa e os negócios são um só.").replace(
              "{n}",
              String(outros.length + 1),
            )}
          </p>
          <ul className="space-y-1 text-xs">
            {outros.map((o) => (
              <li key={o.id}>
                <Link href={`/app/contacts/${o.id}`} className="hover:underline">
                  {o.telefone ? phoneForDisplay(o.telefone) : (o.nome ?? t("Contato"))}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {juntando ? (
        <div className="mt-2 space-y-2 rounded-md border border-border p-2 text-xs" data-testid="juntar-numeros">
          <SeletorDeContato escolhido={outro} onEscolher={setOutro} />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!outro || outro.id === contactId || juntar.isPending}
              onClick={() =>
                outro &&
                juntar.mutate(
                  { contatoId: contactId, outroContatoId: outro.id },
                  {
                    onSuccess: () => {
                      setOutro(null);
                      setJuntando(false);
                    },
                  },
                )
              }
            >
              {t("É a mesma pessoa")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setJuntando(false)}>
              {t("Cancelar")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setJuntando(true)}>
            {t("Juntar outro número")}
          </Button>
          {outros.length > 0 ? (
            <Button size="sm" variant="ghost" disabled={separar.isPending} onClick={() => separar.mutate(contactId)}>
              {t("Separar este número")}
            </Button>
          ) : null}
        </div>
      )}
    </Secao>
  );
}

/**
 * FORK MIA — as EMPRESAS do contato (desde a .79, várias). Cada vínculo com
 * papel (lista fechada) e cargo; a do cartão marcada; "Mostrar esta no cartão"
 * quando há mais de uma; tirar da empresa não mexe nos negócios de antes.
 */
function EmpresaDoContato({ contactId, ficha }: { contactId: string; ficha: FichaDoContato }) {
  const t = useT();
  const vincular = useVincularPessoa();
  const desvincular = useDesvincularPessoa();
  const [editando, setEditando] = useState(false);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [cargo, setCargo] = useState("");
  const [papel, setPapel] = useState<Papel | "">("usuario");
  const [principal, setPrincipal] = useState(false);
  const empresas = ficha.empresas ?? [];
  const abertosSemEmpresa = ficha.negocios.filter(
    (n) => n.status === "open" && n.envolvidoComo === null && !n.empresaId,
  );
  const [ligarNegocios, setLigarNegocios] = useState(true);

  const salvar = () =>
    empresaId &&
    vincular.mutate(
      {
        empresaId,
        contatoId: contactId,
        cargo: cargo.trim() || null,
        papel: papel || null,
        principal,
      },
      {
        onSuccess: async () => {
          if (ligarNegocios) {
            for (const n of abertosSemEmpresa) {
              await apiClient.patch(`/api/v1/leads/${n.id}`, { empresa_id: empresaId });
            }
          }
          setEmpresaId(null);
          setCargo("");
          setPapel("usuario");
          setPrincipal(false);
          setEditando(false);
        },
      },
    );

  if (empresas.length === 0 && !editando) {
    return (
      <p className="border-b border-border py-3 text-xs">
        <button type="button" className="min-h-11 text-accent underline-offset-2 hover:underline lg:min-h-0" onClick={() => setEditando(true)}>
          + {t("Vincular a uma empresa")}
        </button>
      </p>
    );
  }

  return (
    <Secao titulo={empresas.length > 1 ? t("Empresas") : t("Empresa")} contagem={empresas.length || null} testid="empresa-do-contato">
      {empresas.length === 0 ? (
        <p className="text-xs text-text-muted">{t("Sem empresa. É o normal para quem compra como pessoa física.")}</p>
      ) : (
        <ul className="space-y-3">
          {empresas.map((v) => (
            <li key={v.id} className="text-xs" data-testid="vinculo-do-contato">
              <p>
                <Link href={`/app/companies/${v.id}`} className="font-medium text-text hover:underline">
                  {v.nome}
                </Link>
                {empresas.length > 1 && v.noCartao ? (
                  <span className="ml-1 rounded-full bg-accent/10 px-1.5 text-[10px] text-accent">★ {t("a que aparece no cartão")}</span>
                ) : null}
              </p>
              <p className="text-[11px] text-text-muted">
                {[v.cargo ?? t("cargo não informado"), v.principal ? t("contato principal da empresa") : null].filter(Boolean).join(" · ")}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <select
                  aria-label={`${t("Papel")}: ${v.nome}`}
                  value={ehPapel(v.papel) ? v.papel : ""}
                  disabled={vincular.isPending}
                  onChange={(ev) => vincular.mutate({ empresaId: v.id, contatoId: contactId, papel: (ev.target.value || null) as Papel | null })}
                  className={cn(SELECT, "w-auto")}
                >
                  <option value="">{t("Sem papel definido")}</option>
                  {PAPEIS.map((p) => (
                    <option key={p} value={p}>
                      {t(ROTULO_DO_PAPEL[p])}
                    </option>
                  ))}
                </select>
                {empresas.length > 1 && !v.noCartao ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={vincular.isPending}
                    onClick={() => vincular.mutate({ empresaId: v.id, contatoId: contactId, noCartao: true })}
                  >
                    {t("Mostrar esta no cartão")}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={desvincular.isPending}
                  onClick={() => desvincular.mutate({ empresaId: v.id, contatoId: contactId })}
                >
                  {t("Tirar da empresa")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editando ? (
        <div className="mt-3 space-y-2 text-xs" data-testid="vincular-empresa">
          <p className="text-text-muted">{t("Opcional. Sem empresa, tudo funciona igual. Uma empresa tem vários contatos.")}</p>
          <SeletorDeEmpresa id="ficha-empresa" valor={empresaId} aoMudar={setEmpresaId} />
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ficha-papel" className="text-xs">
                {t("Papel")}
              </Label>
              <select id="ficha-papel" value={papel} onChange={(e) => setPapel(e.target.value as Papel | "")} className={SELECT}>
                <option value="">{t("Sem papel definido")}</option>
                {PAPEIS.map((p) => (
                  <option key={p} value={p}>
                    {t(ROTULO_DO_PAPEL[p])}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ficha-cargo" className="text-xs">
                {t("Cargo (opcional)")}
              </Label>
              <Input id="ficha-cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder={t("Ex.: sócia, gerente")} />
            </div>
          </div>
          <label className="flex min-h-11 items-center gap-2 lg:min-h-0">
            <input type="checkbox" checked={principal} onChange={(e) => setPrincipal(e.target.checked)} />
            {t("Contato principal desta empresa")}
          </label>
          {abertosSemEmpresa.length > 0 ? (
            <label className="flex min-h-11 items-center gap-2 lg:min-h-0">
              <input type="checkbox" checked={ligarNegocios} onChange={(e) => setLigarNegocios(e.target.checked)} />
              {t("Ligar também os negócios abertos desta pessoa a esta empresa")} ({abertosSemEmpresa.length})
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={vincular.isPending || !empresaId || empresas.some((x) => x.id === empresaId)} onClick={salvar}>
              {t("Vincular a esta empresa")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditando(false)}>
              {t("Cancelar")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs">
          <button type="button" className="min-h-11 text-accent underline-offset-2 hover:underline lg:min-h-0" onClick={() => setEditando(true)}>
            + {t("Vincular a outra empresa")}
          </button>
        </p>
      )}
    </Secao>
  );
}

function NegociosDoContato({ contactId, ficha }: { contactId: string; ficha: FichaDoContato }) {
  const t = useT();
  const [novo, setNovo] = useState(false);
  const funil = useDefaultPipeline(novo);
  const { data: membros } = useAssignableMembers(true);
  return (
    <Secao
      titulo={t("Negócios")}
      contagem={ficha.negocios.length}
      testid="negocios-do-contato"
      acoes={
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setNovo(true)}>
          {t("Novo negócio")}
        </Button>
      }
    >
      {ficha.negocios.length === 0 ? (
        <p className="text-xs text-text-muted">{t("Nenhum negócio ainda.")}</p>
      ) : (
        <ul className="space-y-1.5">
          {ficha.negocios.map((n) => {
            const dono = membros?.find((m) => m.user_id === n.donoUserId)?.full_name ?? (n.donoKind === "ai" ? t("Agente") : null);
            return (
              <li key={n.id} className="flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <Link href={`/app/leads/${n.id}`} className="font-medium text-text hover:underline">
                    {n.titulo}
                  </Link>
                  <p className="text-[11px] text-text-muted">
                    {[
                      n.funil && n.etapa ? `${n.funil} · ${n.etapa}` : n.etapa,
                      n.valorCents ? valorCheio(n.valorCents, n.moeda) : null,
                      dono,
                      n.status === "lost" && n.motivoDaPerda ? n.motivoDaPerda : null,
                      n.envolvidoComo !== null
                        ? `${t("envolvido")}${
                            ehPapel(n.envolvidoComo)
                              ? ` · ${t(ROTULO_DO_PAPEL[n.envolvidoComo])}`
                              : n.envolvidoComo
                                ? ` · ${n.envolvidoComo}`
                                : ""
                          }`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 text-[10px]",
                    n.status === "open" && "bg-accent/10 text-accent",
                    n.status === "won" && "bg-success-bg text-success-fg",
                    n.status === "lost" && "bg-error-bg text-error-fg",
                  )}
                >
                  {n.status in ROTULO_DO_STATUS ? t(ROTULO_DO_STATUS[n.status as keyof typeof ROTULO_DO_STATUS]) : n.status}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {novo && funil.data ? (
        <NewLeadDialog
          open
          onOpenChange={(v) => !v && setNovo(false)}
          pipelineId={funil.data.pipeline.id}
          stages={funil.data.stages}
          contactId={contactId}
        />
      ) : null}
    </Secao>
  );
}

function ConversasDoContato({ ficha }: { ficha: FichaDoContato }) {
  const t = useT();
  if (ficha.conversas.length === 0) return null;
  return (
    <Secao titulo={t("Conversas")} contagem={ficha.conversas.length} testid="conversas-do-contato">
      <ul className="space-y-1">
        {ficha.conversas.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 text-xs">
            <Link href={`/app/inbox?id=${c.id}`} className="min-w-0 truncate text-text hover:underline">
              {c.preview?.trim() || t("conversa sem mensagens")}
            </Link>
            <span className="shrink-0 text-[11px] text-text-muted">
              {c.ultimaEm ? format(new Date(c.ultimaEm), "dd/MM HH:mm") : ""}
              {c.naoLidas > 0 ? ` · ${c.naoLidas} ${t("sem ler")}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </Secao>
  );
}

function ResumoDoContato({ ficha }: { ficha: FichaDoContato }) {
  const t = useT();
  const r = ficha.resumo;
  const vazio = <span className="text-text-muted">{t("não informado")}</span>;
  return (
    <Secao titulo={t("Resumo da IA")} testid="resumo-do-contato">
      {!r ? (
        <p className="text-xs text-text-muted">{t("A IA ainda não registrou nada sobre esta pessoa.")}</p>
      ) : (
        <>
          <Pares>
            <Par rotulo={t("Quer")}>{r.quer ?? vazio}</Par>
            <Par rotulo={t("Orçamento e pagamento")}>{r.orcamento ?? vazio}</Par>
            <Par rotulo={t("Quem decide")}>{r.decide ?? vazio}</Par>
            <Par rotulo={t("Prazo")}>{r.prazo ?? vazio}</Par>
            <Par rotulo={t("Objeções")}>
              {r.objecoes.length === 0 ? (
                <span className="text-text-muted">{t("nenhuma registrada")}</span>
              ) : (
                r.objecoes.map((o) => `${o.texto} (${o.aberta ? t("aberta") : t("respondida")})`).join(", ")
              )}
            </Par>
          </Pares>
          {r.resumo ? <p className="mt-2 whitespace-pre-wrap text-xs text-text">{r.resumo}</p> : null}
        </>
      )}
    </Secao>
  );
}

function MemoriaDaIa({ ficha }: { ficha: FichaDoContato }) {
  const t = useT();
  return (
    <Secao titulo={t("Memória da IA")} contagem={ficha.memoria.length} testid="memoria-do-contato">
      {ficha.memoria.length === 0 ? (
        <p className="text-xs text-text-muted">{t("A IA ainda não registrou fatos duráveis desta pessoa.")}</p>
      ) : (
        <ul className="space-y-1">
          {ficha.memoria.map((m) => (
            <li key={m.id} className="text-xs">
              <details>
                <summary className="cursor-pointer text-text">{m.titulo}</summary>
                <p className="mt-0.5 whitespace-pre-wrap text-text-muted">{m.corpo}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-text-muted">{t("Fatos que valem para qualquer negócio da pessoa; a IA os usa na conversa.")}</p>
    </Secao>
  );
}

function AgendaDoContato({ ficha, contactId }: { ficha: FichaDoContato; contactId: string }) {
  const t = useT();
  const agora = useAgoraDoCartao();
  return (
    <Secao
      titulo={t("Agenda")}
      contagem={ficha.agenda.length}
      testid="agenda-do-contato"
      acoes={
        <Button asChild size="sm" variant="ghost" className="h-6 px-2 text-[11px]">
          <Link href={`/app/agenda?contato=${contactId}`}>{t("Marcar")}</Link>
        </Button>
      }
    >
      {ficha.agenda.length === 0 ? (
        <p className="text-xs text-text-muted">{t("Nenhum compromisso.")}</p>
      ) : (
        <ul className="space-y-1">
          {ficha.agenda.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2 text-xs">
              <span className={a.resultado ? "text-text-muted" : "text-text"}>{textoDoProximoCompromisso(a, agora, t).texto}</span>
              <span className="shrink-0 text-[11px] text-text-muted">
                {a.resultado && a.resultado in RESULTADO
                  ? t(RESULTADO[a.resultado as keyof typeof RESULTADO])
                  : new Date(a.fim).getTime() > agora.getTime()
                    ? t("marcado")
                    : t("sem resultado")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

function TarefasDoContato({ contactId }: { contactId: string }) {
  const t = useT();
  const agora = useAgoraDoCartao();
  const { tarefas, alternarConcluida } = useTasks({ contact_id: contactId });
  return (
    <Secao titulo={t("Tarefas")} contagem={tarefas.length} testid="tarefas-do-contato">
      {tarefas.length === 0 ? (
        <p className="text-xs text-text-muted">{t("Nenhuma tarefa.")}</p>
      ) : (
        <ul className="space-y-1">
          {tarefas.map((x) => {
            const feita = x.status === "done" || x.status === "cancelled";
            const atrasada = !feita && x.due_date ? new Date(x.due_date).getTime() < agora.getTime() : false;
            return (
              <li key={x.id} className="flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <p className={feita ? "text-text-muted line-through" : "text-text"}>{x.title}</p>
                  <p className="text-[11px] text-text-muted">
                    {x.due_date ? format(new Date(x.due_date), "dd/MM HH:mm") : t("sem prazo")}
                    {atrasada ? <span className="ml-1 font-medium text-error-fg">{t("atrasada")}</span> : null}
                  </p>
                </div>
                <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => void alternarConcluida(x).catch(() => undefined)}>
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
