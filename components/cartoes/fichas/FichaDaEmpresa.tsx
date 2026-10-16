"use client";

/**
 * FORK MIA — a FICHA DA EMPRESA, em `/app/companies/<id>` (desde a .79; antes
 * `/app/empresas/<id>`, que agora leva para cá).
 *
 * Tela 2 do protótipo aprovado em 15/10/2026, "Uma ficha só": em cima os dados
 * da Receita, que vêm do cadastro do upstream; embaixo o que é nosso: pessoas
 * com papel, negócios, compras e obrigações. Na ficha:
 *
 *  - as PESSOAS com papel (lista fechada), cargo, a principal (uma por empresa,
 *    garantida pelo banco), todos os números de cada uma e as outras empresas
 *    em que a mesma pessoa está ("Também está em");
 *  - vincular pessoa aqui mesmo, trocar o papel, tornar principal, tirar da
 *    empresa (os negócios de antes ficam como estavam);
 *  - "Atualizar pela Receita" (só pela tela; a demonstração não consulta);
 *  - mesclar com outra empresa e excluir (gestor). Excluir é RECUSADO com
 *    negócio aberto; sem ele, as pessoas ficam como contato sem empresa e os
 *    negócios encerrados ficam no histórico, sem empresa.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDistanceToNow, format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { usePipelines } from "@/hooks/webhooks/useWebhookSources";
import { useDefaultPipeline } from "@/hooks/pipelines/useDefaultPipeline";
import { useFichaDaEmpresa } from "@/hooks/cartoes/useFichas";
import {
  useAtualizarPelaReceita,
  useDesvincularPessoa,
  useEmpresasDoSeletor,
  useExcluirEmpresa,
  useMesclarEmpresas,
  useVincularPessoa,
} from "@/hooks/useEmpresas";
import { SeletorDeContato } from "@/components/kanban/SeletorDeContato";
import { NewLeadDialog } from "@/components/kanban/NewLeadDialog";
import { HistoricoDeCompras } from "@/components/cartoes/HistoricoDeCompras";
import { Par, Pares, Secao } from "@/components/cartoes/aberto/Secao";
import { FormularioDaEmpresa } from "@/components/empresas/FormularioDaEmpresa";
import { SecaoDeObrigacoes } from "@/components/obrigacoes/SecaoDeObrigacoes";
import { ApiError } from "@/lib/api/types";
import { ROLE_RANK } from "@/lib/auth/types";
import { cn } from "@/lib/utils";
import { camposDoFunil } from "@/lib/leads/campos-do-funil";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { valorCheio, valorCurto } from "@/lib/cartoes/dinheiro";
import { ehPapel, PAPEIS, ROTULO_DO_PAPEL, type Papel } from "@/lib/cartoes/papel";
import { formatarCnpj } from "@/lib/empresas/formato";
import type { Contact } from "@/lib/types/contacts";
import { ArrowsClockwise, Buildings, CheckCircle } from "@/lib/ui/icons";

const ROTULO_DO_STATUS = { open: "aberto", won: "ganho", lost: "perdido" } as const;

/** O `<select>` das fichas: 44px e 16px no celular, como `components/ui/input.tsx`. */
const SELECT =
  "min-h-11 w-full rounded-md border border-border bg-background px-2 text-base lg:min-h-0 lg:h-8 lg:text-xs";

export function FichaDaEmpresa({ empresaId }: { empresaId: string }) {
  const t = useT();
  const router = useRouter();
  const q = useFichaDaEmpresa(empresaId);
  const locale = useLocaleDeData();
  const { user, activeOrg } = useAuth();
  const { data: membros } = useAssignableMembers(true);
  const funis = usePipelines();
  const vincular = useVincularPessoa();
  const desvincular = useDesvincularPessoa();
  const receita = useAtualizarPelaReceita();
  const excluir = useExcluirEmpresa();
  const [editando, setEditando] = useState<false | "tudo" | "cnpj">(false);
  const [vinculando, setVinculando] = useState(false);
  const [mesclando, setMesclando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erroDeExclusao, setErroDeExclusao] = useState<string | null>(null);
  const [novoNegocio, setNovoNegocio] = useState(false);
  const funilPadrao = useDefaultPipeline(novoNegocio);

  const ehGestor =
    Boolean(user.is_platform_admin && !user.support) ||
    Boolean(activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager);

  if (q.isLoading) return <p className="p-6 text-sm text-text-muted">{t("Carregando…")}</p>;
  if (q.isError || !q.data) {
    return <p className="p-6 text-sm text-warning-fg">{t("Não consegui carregar a empresa. Tente de novo em instantes.")}</p>;
  }
  const e = q.data;
  const f = e.ficha;
  const compras = f.compras;
  const abertosDaEmpresa = f.negocios.filter((n) => n.status === "open" && n.empresaId === empresaId).length;

  return (
    <div className="space-y-4 p-4 md:p-6" data-testid="ficha-da-empresa">
      <nav className="text-[11px] text-text-muted" aria-label={t("Como as áreas se ligam")}>
        <Link href="/app/companies" className="hover:text-text hover:underline">
          {t("Empresas")}
        </Link>{" "}
        › <b className="font-medium text-text">{e.nome}</b>
      </nav>

      {e.parece_com && !e.cnpj ? (
        <div className="flex flex-col gap-2 rounded-lg border border-warning-fg bg-warning-bg p-3 text-sm text-warning-fg sm:flex-row sm:items-center sm:justify-between">
          <span>
            {t("Parece a mesma empresa que")} <b>{e.parece_com.nome}</b>. {t("Nome muito parecido e esta não tem CNPJ.")}
          </span>
          {ehGestor ? (
            <Button size="sm" variant="outline" onClick={() => setMesclando(true)}>
              {t("Mesclar as duas")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 break-words text-2xl font-semibold tracking-tight">
            <Buildings size={22} aria-hidden /> {e.nome}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {e.razao_social ?? t("Razão social não informada")}
            {" · "}
            {e.cnpj ? <span className="font-mono">{formatarCnpj(e.cnpj)}</span> : t("sem CNPJ")}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {compras ? (
              <a
                href="#compras-da-empresa"
                className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-fg hover:underline"
              >
                {compras.selo === "recorrente" ? <ArrowsClockwise size={12} aria-hidden /> : <CheckCircle size={12} aria-hidden />}
                {compras.selo === "recorrente" ? t("Cliente recorrente") : t("Já é cliente")} · {compras.quantidade}{" "}
                {compras.quantidade === 1 ? t("compra") : t("compras")} · {valorCurto(compras.totalCents, compras.moeda)}
              </a>
            ) : null}
            {(e.tags ?? []).map((tag) => (
              <span key={tag} className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-text-muted">
                {tag}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditando("tudo")}>
            {t("Editar")}
          </Button>
          <Button variant="outline" onClick={() => setVinculando((v) => !v)}>
            {t("Vincular pessoa")}
          </Button>
          {ehGestor ? (
            <>
              <Button variant="outline" onClick={() => setMesclando(true)}>
                {t("Mesclar")}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setErroDeExclusao(null);
                  setExcluindo(true);
                }}
              >
                {t("Excluir")}
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {excluindo ? (
        abertosDaEmpresa > 0 ? (
          <div role="alert" className="rounded-lg border border-error-fg bg-error-bg p-3 text-sm text-error-fg" data-testid="excluir-recusado">
            {abertosDaEmpresa === 1
              ? t("Não dá para excluir: 1 negócio aberto com esta empresa.")
              : t("Não dá para excluir: {n} negócios abertos com esta empresa.").replace("{n}", String(abertosDaEmpresa))}{" "}
            {t("Encerre ou mova os negócios, ou mescle com outra empresa.")}
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={() => setExcluindo(false)}>
                {t("Entendi")}
              </Button>
            </div>
          </div>
        ) : (
          <div role="alert" className="rounded-lg border border-warning-fg bg-warning-bg p-3 text-sm text-warning-fg" data-testid="excluir-confirmar">
            {t("Excluir")} {e.nome}?{" "}
            {f.pessoas.length > 0
              ? f.pessoas.length === 1
                ? t("1 pessoa fica como contato sem empresa.")
                : t("{n} pessoas ficam como contato sem empresa.").replace("{n}", String(f.pessoas.length))
              : null}{" "}
            {t("Os negócios encerrados continuam no histórico, sem empresa.")}
            {erroDeExclusao ? <p className="mt-1 font-medium">{erroDeExclusao}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={excluir.isPending}
                onClick={() =>
                  excluir.mutate(empresaId, {
                    onSuccess: () => router.push("/app/companies"),
                    onError: (err) => setErroDeExclusao(err instanceof Error ? err.message : t("Não foi possível excluir.")),
                  })
                }
              >
                {t("Excluir")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setExcluindo(false)}>
                {t("Cancelar")}
              </Button>
            </div>
          </div>
        )
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="numeros-da-empresa">
        <Numero rotulo={t("Negócios abertos")} valor={`${f.numeros.abertos} · ${valorCurto(f.numeros.abertosCents, f.numeros.moeda)}`} />
        <Numero rotulo={t("Total comprado")} valor={compras ? valorCurto(compras.totalCents, compras.moeda) : t("nenhuma compra ainda")} />
        <Numero
          rotulo={t("Última interação")}
          valor={f.numeros.ultimaInteracao ? format(new Date(f.numeros.ultimaInteracao), "dd/MM/yyyy HH:mm") : t("sem interação")}
        />
        <Numero rotulo={t("Negócio mais quente")} valor={f.numeros.maisQuente === null ? t("sem chance calculada") : `${f.numeros.maisQuente}%`} />
      </div>

      {vinculando ? (
        <VincularPessoa
          empresaId={empresaId}
          temPrincipal={f.pessoas.some((p) => p.principal)}
          aoTerminar={() => setVinculando(false)}
        />
      ) : null}

      <div className="grid gap-x-6 lg:grid-cols-2">
        <div className="min-w-0">
          <Secao titulo={t("Pessoas")} contagem={f.pessoas.length} testid="pessoas-da-empresa">
            {f.pessoas.length === 0 ? (
              <p className="text-xs text-text-muted">{t("Nenhuma pessoa vinculada. Use Vincular pessoa, acima.")}</p>
            ) : (
              <ul className="space-y-3">
                {f.pessoas.map((p) => (
                  <li key={p.pessoaId} className="text-xs" data-testid="pessoa-da-empresa">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/app/contacts/${p.id}`} className="font-medium text-text hover:underline">
                          {p.nome ?? t("Contato")}
                        </Link>
                        {p.principal ? (
                          <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-accent/10 px-1.5 text-[10px] text-accent">
                            <span aria-hidden>★</span> {t("principal")}
                          </span>
                        ) : null}
                        <p className="text-[11px] text-text-muted">
                          {[p.cargo ?? t("cargo não informado"), p.telefones.map((tel) => phoneForDisplay(tel)).join(` ${t("e")} `), p.email]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {p.outrasEmpresas.length > 0 ? (
                          <p className="text-[11px] text-text-muted">
                            {t("Também está em")}:{" "}
                            {p.outrasEmpresas.map((o, i) => (
                              <span key={o.id}>
                                {i > 0 ? ", " : ""}
                                <Link href={`/app/companies/${o.id}`} className="hover:underline">
                                  {o.nome}
                                </Link>
                              </span>
                            ))}
                          </p>
                        ) : null}
                      </div>
                      {p.conversaId ? (
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/app/inbox?id=${p.conversaId}`}>{t("Conversa")}</Link>
                        </Button>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1">
                        <span className="sr-only">{t("Papel")}</span>
                        <select
                          aria-label={`${t("Papel")}: ${p.nome ?? t("Contato")}`}
                          value={ehPapel(p.papel) ? p.papel : ""}
                          disabled={vincular.isPending}
                          onChange={(ev) =>
                            vincular.mutate({ empresaId, contatoId: p.id, papel: (ev.target.value || null) as Papel | null })
                          }
                          className={cn(SELECT, "w-auto")}
                        >
                          <option value="">{t("Sem papel definido")}</option>
                          {PAPEIS.map((papel) => (
                            <option key={papel} value={papel}>
                              {t(ROTULO_DO_PAPEL[papel])}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!p.principal ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={vincular.isPending}
                          onClick={() => vincular.mutate({ empresaId, contatoId: p.id, principal: true })}
                        >
                          {t("Tornar principal")}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={desvincular.isPending}
                        onClick={() => desvincular.mutate({ empresaId, contatoId: p.id })}
                      >
                        {t("Tirar da empresa")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Secao>
          <Secao
            titulo={t("Negócios")}
            contagem={f.negocios.length}
            testid="negocios-da-empresa"
            acoes={
              <Button size="sm" variant="ghost" onClick={() => setNovoNegocio(true)}>
                {t("Novo negócio com esta empresa")}
              </Button>
            }
          >
            {f.negocios.length === 0 ? (
              <p className="text-xs text-text-muted">{t("Nenhum negócio com esta empresa.")}</p>
            ) : (
              <ul className="space-y-1.5">
                {f.negocios.map((n) => {
                  const dono = membros?.find((m) => m.user_id === n.donoUserId)?.full_name ?? (n.donoKind === "ai" ? t("Agente") : null);
                  return (
                    <li key={n.id} className="flex items-start justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <Link href={`/app/leads/${n.id}`} className="font-medium text-text hover:underline">
                          {n.titulo}
                        </Link>
                        <p className="text-[11px] text-text-muted">
                          {[n.etapa, n.valorCents ? valorCheio(n.valorCents, n.moeda) : null, dono, n.probabilidade !== null ? `${Math.round(n.probabilidade)}%` : null]
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
          </Secao>
        </div>
        <div className="min-w-0">
          <Secao titulo={t("Dados da Receita")} testid="dados-da-receita">
            {e.cnpj ? (
              <>
                {e.receita ? (
                  <Pares>
                    {e.receita.situacao ? <Par rotulo={t("Situação")}>{e.receita.situacao}</Par> : null}
                    {e.receita.abertura ? <Par rotulo={t("Abertura")}>{format(new Date(`${e.receita.abertura}T12:00:00`), "dd/MM/yyyy")}</Par> : null}
                    {e.receita.atividade ? <Par rotulo={t("Atividade")}>{e.receita.atividade}</Par> : null}
                    {e.receita.endereco ? <Par rotulo={t("Endereço")}>{e.receita.endereco}</Par> : null}
                  </Pares>
                ) : (
                  <p className="text-xs text-text-muted">{t("Ainda não consultada na Receita.")}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                  <Button size="sm" variant="outline" disabled={receita.isPending} onClick={() => receita.mutate(empresaId)}>
                    {receita.isPending ? t("Consultando…") : t("Atualizar pela Receita")}
                  </Button>
                  {e.receita?.consultadaEm ? (
                    <span>
                      {t("Consultado")} {formatDistanceToNow(new Date(e.receita.consultadaEm), { addSuffix: true, locale })}
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-text-muted">{t("Sem CNPJ, não há o que consultar. A empresa funciona normalmente só com o nome.")}</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => setEditando("cnpj")}>
                  {t("Informar o CNPJ")}
                </Button>
              </>
            )}
          </Secao>
          {/* Os documentos e as atividades da empresa: o mesmo registro que
              aparece no cartão aberto de cada negócio dela. */}
          <SecaoDeObrigacoes escopo={{ tipo: "empresa", id: empresaId }} id="documentos-da-empresa" />
          <HistoricoDeCompras resumo={compras} modo="empresa" id="compras-da-empresa" />
          <Secao titulo={t("Dados")} testid="dados-da-empresa">
            <Pares>
              {e.endereco ? <Par rotulo={t("Endereço")}>{e.endereco}</Par> : null}
              {e.telefone ? <Par rotulo={t("Telefone")}>{e.telefone}</Par> : null}
              {e.email ? <Par rotulo={t("E-mail")}>{e.email}</Par> : null}
              {e.site ? <Par rotulo={t("Site")}>{e.site}</Par> : null}
              {e.observacoes ? <Par rotulo={t("Observações")}>{e.observacoes}</Par> : null}
            </Pares>
          </Secao>
        </div>
      </div>

      {editando ? (
        <FormularioDaEmpresa
          empresa={e}
          focarCnpj={editando === "cnpj"}
          aoFechar={() => setEditando(false)}
          camposExtras={(funis.data?.data ?? []).flatMap((p) => camposDoFunil(p.settings))}
        />
      ) : null}
      {mesclando ? (
        <MesclarEmpresa
          empresaId={empresaId}
          nome={e.nome}
          sugerida={e.parece_com?.id ?? null}
          pessoas={f.pessoas.length}
          negocios={f.negocios.filter((n) => n.empresaId === empresaId).length}
          aoFechar={() => setMesclando(false)}
          aoMesclar={(vencedora) => router.push(`/app/companies/${vencedora}`)}
        />
      ) : null}
      {novoNegocio && funilPadrao.data ? (
        <NewLeadDialog
          open
          onOpenChange={(v) => !v && setNovoNegocio(false)}
          pipelineId={funilPadrao.data.pipeline.id}
          stages={funilPadrao.data.stages}
          empresaIdInicial={empresaId}
        />
      ) : null}
    </div>
  );
}

function VincularPessoa({ empresaId, temPrincipal, aoTerminar }: { empresaId: string; temPrincipal: boolean; aoTerminar: () => void }) {
  const t = useT();
  const vincular = useVincularPessoa();
  const [pessoa, setPessoa] = useState<Contact | null>(null);
  const [papel, setPapel] = useState<Papel | "">("usuario");
  const [cargo, setCargo] = useState("");
  const [principal, setPrincipal] = useState(false);
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-xs" data-testid="vincular-pessoa">
      <SeletorDeContato escolhido={pessoa} onEscolher={setPessoa} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="vp-papel" className="text-xs">
            {t("Papel")}
          </Label>
          <select id="vp-papel" value={papel} onChange={(ev) => setPapel(ev.target.value as Papel | "")} className={SELECT}>
            <option value="">{t("Sem papel definido")}</option>
            {PAPEIS.map((p) => (
              <option key={p} value={p}>
                {t(ROTULO_DO_PAPEL[p])}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="vp-cargo" className="text-xs">
            {t("Cargo (opcional)")}
          </Label>
          <Input id="vp-cargo" value={cargo} onChange={(ev) => setCargo(ev.target.value)} placeholder={t("Ex.: sócia, gerente")} />
        </div>
      </div>
      <label className="flex min-h-11 items-center gap-2 lg:min-h-0">
        <input type="checkbox" checked={principal} onChange={(ev) => setPrincipal(ev.target.checked)} />
        {t("É o contato principal desta empresa")}
      </label>
      {principal && temPrincipal ? <p className="text-text-muted">{t("O principal de hoje deixa de ser.")}</p> : null}
      <p className="text-text-muted">
        {t("Se a pessoa ainda não é contato, ela é criada pela conversa ou pela tela de contatos, e depois vinculada aqui.")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!pessoa || vincular.isPending}
          onClick={() =>
            pessoa &&
            vincular.mutate(
              { empresaId, contatoId: pessoa.id, papel: papel || null, cargo: cargo.trim() || null, principal },
              { onSuccess: aoTerminar },
            )
          }
        >
          {t("Vincular")}
        </Button>
        <Button size="sm" variant="outline" onClick={aoTerminar}>
          {t("Cancelar")}
        </Button>
      </div>
    </div>
  );
}

function MesclarEmpresa({
  empresaId,
  nome,
  sugerida,
  pessoas,
  negocios,
  aoFechar,
  aoMesclar,
}: {
  empresaId: string;
  nome: string;
  sugerida: string | null;
  pessoas: number;
  negocios: number;
  aoFechar: () => void;
  aoMesclar: (vencedora: string) => void;
}) {
  const t = useT();
  const { data } = useEmpresasDoSeletor();
  const mesclar = useMesclarEmpresas();
  const outras = (data?.data ?? []).filter((x) => x.id !== empresaId);
  const [alvo, setAlvo] = useState<string>(sugerida ?? "");
  const escolhida = outras.find((x) => x.id === (alvo || outras[0]?.id));
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="sm:max-w-lg" data-testid="mesclar-empresa">
        <DialogHeader>
          <DialogTitle>{t("Mesclar empresas")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <Label htmlFor="ms-alvo">{t("A empresa que fica")}</Label>
            <select id="ms-alvo" value={escolhida?.id ?? ""} onChange={(ev) => setAlvo(ev.target.value)} className={SELECT}>
              {outras.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}
                  {x.cnpj ? ` · ${formatarCnpj(x.cnpj)}` : ""}
                </option>
              ))}
            </select>
          </div>
          {escolhida ? (
            <p className="text-text-muted">
              {t("O que acontece")}: {pessoas} {pessoas === 1 ? t("pessoa") : t("pessoas")}, {negocios}{" "}
              {negocios === 1 ? t("negócio") : t("negócios")} {t("e as obrigações de")} {nome} {t("passam para")}{" "}
              <b className="text-text">{escolhida.nome}</b>. {t("A empresa antiga sai da lista, e quem tiver o endereço dela salvo cai na que ficou.")}
            </p>
          ) : null}
          {erro ? (
            <p role="alert" className="text-error-fg">
              {erro}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={aoFechar}>
              {t("Cancelar")}
            </Button>
            <Button
              disabled={!escolhida || mesclar.isPending}
              onClick={() =>
                escolhida &&
                mesclar.mutate(
                  { vencedora: escolhida.id, perdedora: empresaId },
                  {
                    onSuccess: () => {
                      aoFechar();
                      aoMesclar(escolhida.id);
                    },
                    onError: (err) => setErro(err instanceof ApiError ? err.message : t("Falha ao juntar as empresas.")),
                  },
                )
              }
            >
              {t("Mesclar")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-[11px] text-text-muted">{rotulo}</p>
      <p className="mt-0.5 text-sm font-medium text-text">{valor}</p>
    </div>
  );
}
