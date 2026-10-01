"use client";

/**
 * "Suas agendas": as contas do Google e do Outlook juntas, com UM destino.
 *
 * FORK MIA (docs/fork/agenda-microsoft.md, 3.5 e 6.2). Substitui, só quando a
 * instalação tem a Microsoft configurada, o `AgendasConectadas` do upstream, e
 * repete dele o desenho (o mesmo rascunho, os mesmos textos da parte do Google):
 * a regra dele já era "um destino entre todas as contas", e aqui ela passa a
 * valer entre os dois provedores. Salvar grava as duas listas numa transação só
 * (`PATCH /api/v1/agenda/microsoft/calendarios`, `fn_mia_agenda_selecao`).
 *
 * Regras que a tela carrega: agenda só-leitura nunca é destino (o rádio fica
 * desabilitado e o banco recusa); o que "conta como ocupado" só bloqueia horário
 * (o título do evento de fora nunca é guardado).
 */

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import { GoogleLogo, MicrosoftOutlookLogo } from "@/lib/ui/icons";

import type { CalendarCatalog } from "@/components/agenda/AgendasConectadas";

export interface CatalogoDoOutlook {
  connections: Array<{
    id: string;
    account_email: string;
    account_kind: "trabalho" | "pessoal";
    status: string;
    last_sync_error: string | null;
    last_sync_at: string | null;
    selection_revision: string;
  }>;
  calendars: Array<{
    id: string;
    connection_id: string;
    name: string;
    is_default: boolean;
    counts_for_conflicts: boolean;
    is_destination: boolean;
    can_read: boolean;
    can_write: boolean;
    teams: boolean;
    last_sync_at: string | null;
    sync_error: string | null;
    realtime: boolean;
    realtime_error: string | null;
  }>;
}

interface Rascunho {
  fontesGoogle: string[];
  fontesMicrosoft: string[];
  destino: { provider: "google" | "microsoft"; id: string } | null;
}

/**
 * `tiposTeamsDaPessoa`: os tipos "Microsoft Teams" em que a pessoa atende. Com o
 * destino no Google, eles ficam sem link do Teams para ela, e a tela avisa.
 */
export function AgendasConectadasMia({ tiposTeamsDaPessoa = [] }: { tiposTeamsDaPessoa?: string[] }) {
  const t = useT();
  const locale = useTagDeIdioma();
  const google = useQuery({
    queryKey: ["agenda", "calendarios"],
    queryFn: async () => (await apiClient.get<{ data: CalendarCatalog }>("/api/v1/agenda/google/calendarios")).data,
  });
  const outlook = useQuery({
    queryKey: ["agenda", "calendarios-outlook"],
    queryFn: async () => (await apiClient.get<{ data: CatalogoDoOutlook }>("/api/v1/agenda/microsoft/calendarios")).data,
  });
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const g = google.data;
  const o = outlook.data;
  const destinoSalvo: Rascunho["destino"] = (() => {
    const dg = g?.calendars.filter((c) => c.is_destination) ?? [];
    const dm = o?.calendars.filter((c) => c.is_destination) ?? [];
    if (dm.length === 1 && dm[0]) return { provider: "microsoft", id: dm[0].id };
    if (dg.length === 1 && dg[0]) return { provider: "google", id: dg[0].id };
    return null;
  })();
  const atual: Rascunho = rascunho ?? {
    fontesGoogle: g?.calendars.filter((c) => c.counts_for_conflicts).map((c) => c.id) ?? [],
    fontesMicrosoft: o?.calendars.filter((c) => c.counts_for_conflicts).map((c) => c.id) ?? [],
    destino: destinoSalvo,
  };
  const sujo = rascunho !== null;
  const carregando = google.isLoading || outlook.isLoading;
  const falhou = google.isError || outlook.isError;
  const destinoNoGoogle = atual.destino?.provider === "google";

  async function executar(acao: () => Promise<unknown>) {
    setOcupado(true);
    try {
      await acao();
      setRascunho(null);
      await Promise.all([google.refetch(), outlook.refetch()]);
    } catch (e) {
      showApiError(e);
    } finally {
      setOcupado(false);
    }
  }

  const salvar = () =>
    executar(() =>
      apiClient.patch("/api/v1/agenda/microsoft/calendarios", {
        revisions: {
          google: (g?.connections ?? []).map((c) => ({ connection_id: c.id, revision: c.calendar_selection_revision })),
          microsoft: (o?.connections ?? []).map((c) => ({ connection_id: c.id, revision: c.selection_revision })),
        },
        sources: { google: atual.fontesGoogle, microsoft: atual.fontesMicrosoft },
        destination: atual.destino,
      }),
    );

  const quando = (iso: string | null) =>
    iso
      ? `${t("Última sincronização")}: ${new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso))}`
      : t("Ainda não sincronizada");

  return (
    <section className="space-y-3 rounded-md border p-4" aria-label={t("Suas agendas")} data-testid="agendas-conectadas-mia">
      <h2 className="font-medium">{t("Suas agendas")}</h2>
      <p className="text-sm text-muted-foreground">
        {t(
          "Escolha quais agendas ocupam seus horários e onde publicar os novos compromissos. Os já publicados continuam na agenda onde estão.",
        )}
      </p>
      {carregando && <p>{t("Carregando agendas…")}</p>}
      {falhou && (
        <div role="alert">
          <p>{t("Não foi possível carregar suas agendas.")}</p>
          <Button onClick={() => void Promise.all([google.refetch(), outlook.refetch()])} variant="outline">
            {t("Tentar novamente")}
          </Button>
        </div>
      )}
      {destinoNoGoogle && destinoSalvo?.provider === "microsoft" && (
        // O motor do Google (upstream) publica no destino dele todo compromisso
        // que ainda não está no Google, e não enxerga o vínculo com o Outlook:
        // trocar o destino do Outlook para o Google leva os já publicados no
        // Outlook também para o Google. A pessoa precisa saber antes de salvar.
        <p role="status" className="rounded-md border border-warning/40 bg-warning-bg p-2 text-xs text-text">
          {t("Os compromissos que já estão no Outlook continuam lá e também serão publicados no Google.")}
        </p>
      )}
      {destinoNoGoogle && tiposTeamsDaPessoa.length > 0 && (
        <p role="status" className="rounded-md border border-warning/40 bg-warning-bg p-2 text-xs text-text">
          {t("Com o destino no Google, estes tipos ficam sem link do Teams para você (o Teams só é criado em agenda do Outlook):")}{" "}
          <span className="font-medium">{tiposTeamsDaPessoa.join(", ")}</span>
        </p>
      )}

      {/* ── Google ── */}
      {g && (
        <div className="space-y-2 border-t pt-3" data-testid="agendas-google">
          {g.connections.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <GoogleLogo size={14} weight="bold" aria-hidden />
              {t("Google · não conectado.")}{" "}
              <Link className="underline" href="/app/agenda">
                {t("Conecte sua conta pela Agenda")}
              </Link>
            </p>
          ) : (
            g.connections.map((conexao) => (
              <div key={conexao.id} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-medium break-all">
                    <GoogleLogo size={14} weight="bold" aria-hidden />
                    {t("Google")} · {conexao.account_email}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={ocupado}
                    onClick={() =>
                      void executar(() =>
                        apiClient.post("/api/v1/agenda/google/calendarios/atualizar", { connection_id: conexao.id }),
                      )
                    }
                  >
                    {t("Atualizar lista")}
                  </Button>
                </div>
                {conexao.last_sync_error && (
                  <p role="alert" className="text-sm text-destructive">
                    {conexao.last_sync_error}
                  </p>
                )}
                {g.calendars
                  .filter((c) => c.connection_id === conexao.id)
                  .map((c) => (
                    <LinhaDeAgenda
                      key={c.id}
                      nome={c.name}
                      capacidade={
                        c.allowed_conference_types == null
                          ? t("Google Meet: atualize a lista para conferir")
                          : c.allowed_conference_types.includes("hangoutsMeet")
                            ? t("Permite criar links do Google Meet")
                            : t("Esta agenda não permite criar Google Meet")
                      }
                      conta={atual.fontesGoogle.includes(c.id)}
                      podeContar={c.can_read}
                      destino={atual.destino?.provider === "google" && atual.destino.id === c.id}
                      podeSerDestino={c.can_write}
                      ocupado={ocupado}
                      aoContar={(marcado) =>
                        setRascunho({
                          ...atual,
                          fontesGoogle: marcado ? [...atual.fontesGoogle, c.id] : atual.fontesGoogle.filter((id) => id !== c.id),
                        })
                      }
                      aoEscolherDestino={() => setRascunho({ ...atual, destino: { provider: "google", id: c.id } })}
                      rodape={quando(c.last_sync_at)}
                      erro={c.sync_error}
                    />
                  ))}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Outlook ── */}
      {o && (
        <div className="space-y-2 border-t pt-3" data-testid="agendas-outlook">
          {o.connections.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <MicrosoftOutlookLogo size={14} weight="bold" aria-hidden />
                {t("Outlook · não conectado. Conecte para escolher uma agenda do Outlook como destino.")}
              </p>
              <Button variant="outline" size="sm" asChild>
                <a href="/api/v1/agenda/microsoft/connect">{t("Conectar Outlook")}</a>
              </Button>
            </div>
          ) : (
            o.connections.map((conexao) => (
              <div key={conexao.id} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-medium break-all">
                    <MicrosoftOutlookLogo size={14} weight="bold" aria-hidden />
                    {t("Outlook")} · {conexao.account_email} ·{" "}
                    {conexao.account_kind === "pessoal" ? t("conta pessoal") : t("conta de trabalho")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={ocupado}
                    onClick={() =>
                      void executar(() =>
                        apiClient.post("/api/v1/agenda/microsoft/calendarios/atualizar", { connection_id: conexao.id }),
                      )
                    }
                  >
                    {t("Atualizar lista")}
                  </Button>
                </div>
                {conexao.status !== "healthy" && (
                  <p role="alert" className="text-sm text-destructive">
                    {t("A conexão com o Outlook parou. Conecte de novo pela Agenda.")}
                  </p>
                )}
                {conexao.last_sync_error && (
                  <p role="alert" className="text-sm text-destructive">
                    {conexao.last_sync_error}
                  </p>
                )}
                {o.calendars
                  .filter((c) => c.connection_id === conexao.id)
                  .map((c) => (
                    <LinhaDeAgenda
                      key={c.id}
                      nome={c.name}
                      capacidade={
                        !c.can_write
                          ? t("Só leitura")
                          : c.teams
                            ? t("Permite Microsoft Teams")
                            : t("Esta agenda não permite Microsoft Teams")
                      }
                      conta={atual.fontesMicrosoft.includes(c.id)}
                      podeContar={c.can_read}
                      destino={atual.destino?.provider === "microsoft" && atual.destino.id === c.id}
                      podeSerDestino={c.can_write}
                      ocupado={ocupado}
                      aoContar={(marcado) =>
                        setRascunho({
                          ...atual,
                          fontesMicrosoft: marcado
                            ? [...atual.fontesMicrosoft, c.id]
                            : atual.fontesMicrosoft.filter((id) => id !== c.id),
                        })
                      }
                      aoEscolherDestino={() => setRascunho({ ...atual, destino: { provider: "microsoft", id: c.id } })}
                      rodape={`${quando(c.last_sync_at)}${c.realtime ? ` · ${t("Tempo real ligado")}` : ""}`}
                      erro={c.sync_error ?? (c.realtime_error && (c.counts_for_conflicts || c.is_destination) ? c.realtime_error : null)}
                    />
                  ))}
              </div>
            ))
          )}
        </div>
      )}

      {(g || o) && (
        <div className="flex flex-wrap items-center gap-2">
          {sujo && <span className="mr-auto text-xs text-muted-foreground">{t("Alterações não salvas")}</span>}
          <Button onClick={() => void salvar()} disabled={ocupado || !sujo || !atual.destino} data-testid="salvar-agendas">
            {t("Salvar agendas")}
          </Button>
          {sujo && (
            <Button
              variant="ghost"
              onClick={() => {
                setRascunho(null);
                void Promise.all([google.refetch(), outlook.refetch()]);
              }}
              disabled={ocupado}
            >
              {t("Descartar alterações")}
            </Button>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("Um só destino entre Google e Outlook: marcar um desmarca o outro.")}</p>
    </section>
  );
}

function LinhaDeAgenda(props: {
  nome: string;
  capacidade: string;
  conta: boolean;
  podeContar: boolean;
  destino: boolean;
  podeSerDestino: boolean;
  ocupado: boolean;
  aoContar: (marcado: boolean) => void;
  aoEscolherDestino: () => void;
  rodape: string;
  erro: string | null;
}) {
  const t = useT();
  return (
    <div className="space-y-1 rounded-md bg-muted/40 p-3">
      <p className="font-medium break-words">{props.nome}</p>
      <p className="text-xs text-muted-foreground">{props.capacidade}</p>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={props.conta}
            disabled={props.ocupado || (!props.podeContar && !props.conta)}
            onChange={(e) => props.aoContar(e.target.checked)}
          />
          {t("Conta como ocupado")}
        </label>
        <label className={props.podeSerDestino ? "flex items-center gap-2" : "flex items-center gap-2 text-muted-foreground"}>
          <input
            type="radio"
            name="calendar-destination"
            checked={props.destino}
            disabled={props.ocupado || !props.podeSerDestino}
            onChange={() => props.aoEscolherDestino()}
          />
          {t("Destino dos novos compromissos")}
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{props.rodape}</p>
      {props.erro && (
        <p role="alert" className="text-sm text-destructive">
          {props.erro}
        </p>
      )}
    </div>
  );
}
