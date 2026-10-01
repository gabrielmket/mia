"use client";

/**
 * FORK MIA — a FICHA DA EMPRESA, em página própria (`/app/empresas/<id>`).
 *
 * A conta: os dados dela, os números que importam (negócios abertos, total
 * comprado, última interação, negócio mais quente), as PESSOAS com papel e quem é
 * a principal (vincular pessoa aqui mesmo), os negócios, e o histórico de compras
 * somando todas as pessoas e dizendo quem comprou. Editar abre o formulário que a
 * lista de empresas já usa.
 */
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { usePipelines } from "@/hooks/webhooks/useWebhookSources";
import { useFichaDaEmpresa, useVincularEmpresa } from "@/hooks/cartoes/useFichas";
import { SeletorDeContato } from "@/components/kanban/SeletorDeContato";
import { HistoricoDeCompras } from "@/components/cartoes/HistoricoDeCompras";
import { Par, Pares, Secao } from "@/components/cartoes/aberto/Secao";
import { FormularioDaEmpresa } from "@/app/app/empresas/_client";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { camposDoFunil } from "@/lib/leads/campos-do-funil";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { valorCheio, valorCurto } from "@/lib/cartoes/dinheiro";
import { ehPapel, PAPEIS, ROTULO_DO_PAPEL, type Papel } from "@/lib/cartoes/papel";
import type { Contact } from "@/lib/types/contacts";
import { ArrowsClockwise, Buildings, CheckCircle } from "@/lib/ui/icons";
import { SecaoDeObrigacoes } from "@/components/obrigacoes/SecaoDeObrigacoes";

const ROTULO_DO_STATUS = { open: "aberto", won: "ganho", lost: "perdido" } as const;

function formatarCnpj(v: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  if (d.length !== 14) return v;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function FichaDaEmpresa({ empresaId }: { empresaId: string }) {
  const t = useT();
  const q = useFichaDaEmpresa(empresaId);
  const vincular = useVincularEmpresa();
  const { data: membros } = useAssignableMembers(true);
  const funis = usePipelines();
  const [editando, setEditando] = useState(false);
  const [vinculando, setVinculando] = useState(false);
  const [pessoa, setPessoa] = useState<Contact | null>(null);
  const [papel, setPapel] = useState<Papel | "">("");
  const [cargo, setCargo] = useState("");
  const [principal, setPrincipal] = useState(false);

  if (q.isLoading) return <p className="p-6 text-sm text-text-muted">{t("Carregando…")}</p>;
  if (q.isError || !q.data) {
    return <p className="p-6 text-sm text-warning-fg">{t("Não consegui carregar a empresa. Tente de novo em instantes.")}</p>;
  }
  const e = q.data;
  const f = e.ficha;
  const compras = f.compras;

  return (
    <div className="space-y-4 p-6" data-testid="ficha-da-empresa">
      <nav className="text-[11px] text-text-muted" aria-label={t("Como as áreas se ligam")}>
        <Link href="/app/empresas" className="hover:text-text hover:underline">
          {t("Empresas")}
        </Link>{" "}
        › <b className="font-medium text-text">{e.nome}</b>
      </nav>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 break-words text-2xl font-semibold tracking-tight">
            <Buildings size={22} aria-hidden /> {e.nome}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {[formatarCnpj(e.cnpj), e.telefone, e.email, e.site].filter(Boolean).join(" · ")}
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
          <Button variant="outline" onClick={() => setEditando(true)}>
            {t("Editar")}
          </Button>
          <Button variant="outline" onClick={() => setVinculando((v) => !v)}>
            {t("Vincular pessoa")}
          </Button>
        </div>
      </header>

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
        <div className="space-y-2 rounded-lg border border-border p-3 text-xs" data-testid="vincular-pessoa">
          <SeletorDeContato escolhido={pessoa} onEscolher={setPessoa} />
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="vp-cargo" className="text-xs">
                {t("Cargo")}
              </Label>
              <Input id="vp-cargo" value={cargo} onChange={(ev) => setCargo(ev.target.value)} className="h-8 text-xs" placeholder={t("Ex.: sócia, gerente")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vp-papel" className="text-xs">
                {t("Papel")}
              </Label>
              <select
                id="vp-papel"
                value={papel}
                onChange={(ev) => setPapel(ev.target.value as Papel | "")}
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
              >
                <option value="">{t("Sem papel definido")}</option>
                {PAPEIS.map((p) => (
                  <option key={p} value={p}>
                    {t(ROTULO_DO_PAPEL[p])}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={principal} onChange={(ev) => setPrincipal(ev.target.checked)} />
            {t("Contato principal desta empresa")}
          </label>
          {pessoa?.empresa_id && pessoa.empresa_id !== empresaId ? (
            <p className="text-warning-fg">{t("Esta pessoa está ligada a outra empresa; vincular aqui troca a empresa dela.")}</p>
          ) : null}
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={!pessoa || vincular.isPending}
            onClick={() =>
              pessoa &&
              vincular.mutate(
                { contatoId: pessoa.id, empresaId, cargo: cargo.trim() || null, papel: papel || null, principal },
                {
                  onSuccess: () => {
                    setPessoa(null);
                    setCargo("");
                    setPapel("");
                    setPrincipal(false);
                    setVinculando(false);
                  },
                },
              )
            }
          >
            {t("Vincular")}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-x-6 lg:grid-cols-2">
        <div className="min-w-0">
          <Secao titulo={t("Contatos")} contagem={f.pessoas.length} testid="pessoas-da-empresa">
            {f.pessoas.length === 0 ? (
              <p className="text-xs text-text-muted">{t("Nenhum contato vinculado. Use Vincular pessoa, acima.")}</p>
            ) : (
              <ul className="space-y-1.5">
                {f.pessoas.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <Link href={`/app/contacts/${p.id}`} className="font-medium text-text hover:underline">
                        {p.nome ?? t("Contato")}
                      </Link>
                      {ehPapel(p.papel) ? (
                        <span className="ml-1 rounded-full bg-accent/10 px-1.5 text-[10px] text-accent">{t(ROTULO_DO_PAPEL[p.papel])}</span>
                      ) : null}
                      {p.principal ? (
                        <span className="ml-1 rounded-full bg-surface-muted px-1.5 text-[10px] text-text-muted">{t("principal")}</span>
                      ) : null}
                      <p className="text-[11px] text-text-muted">
                        {[p.cargo, p.telefone ? phoneForDisplay(p.telefone) : null, p.email].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {p.conversaId ? (
                      <Button asChild size="sm" variant="ghost" className="h-6 shrink-0 px-2 text-[11px]">
                        <Link href={`/app/inbox?id=${p.conversaId}`}>{t("Conversa")}</Link>
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Secao>
          <Secao titulo={t("Negócios")} contagem={f.negocios.length} testid="negocios-da-empresa">
            {f.negocios.length === 0 ? (
              <p className="text-xs text-text-muted">{t("Nenhum negócio ligado a esta empresa.")}</p>
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
          aberto
          aoFechar={() => setEditando(false)}
          camposExtras={(funis.data?.data ?? []).flatMap((p) => camposDoFunil(p.settings))}
        />
      ) : null}
    </div>
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
