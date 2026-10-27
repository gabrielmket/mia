"use client";

/**
 * FORK MIA (.93) — PAINEL › ASSISTENTE NOS CLIENTES: onde os clientes travam,
 * do lado da Time (protótipo aprovado em 26/10/2026, tela 6).
 *
 * O que os clientes mais perguntam, em que passo cada trilha para, que trilha
 * abandonam e que proposta desfazem. Cada achado vira melhoria do produto com
 * um clique (a lista do fim, decisão 13). A Time vê números juntados e o texto
 * só das perguntas sem resposta, sem nome de ninguém (decisão 12); nunca a
 * conversa de ninguém.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import {
  ROTULO_DA_SITUACAO_DA_MELHORIA,
  SITUACOES_DA_MELHORIA,
  type Melhoria,
  type OrigemDaMelhoria,
  type SituacaoDaMelhoria,
} from "@/lib/assistente/trilhas/melhorias";
import type { OndeTravam, PeriodoDoPainel, SegmentoDoPainel } from "@/lib/assistente/trilhas/onde-travam";
import { trilhaPorId } from "@/lib/assistente/trilhas/catalogo";
import { cn } from "@/lib/utils";

const PERIODOS: ReadonlyArray<{ id: PeriodoDoPainel; rotulo: string }> = [
  { id: 7, rotulo: "7 dias" },
  { id: 30, rotulo: "30 dias" },
  { id: 90, rotulo: "90 dias" },
];

const SEGMENTOS: ReadonlyArray<{ id: SegmentoDoPainel; rotulo: string }> = [
  { id: "todos", rotulo: "Todos" },
  { id: "clinica", rotulo: "Clínica" },
  { id: "academia", rotulo: "Academia" },
  { id: "imobiliaria", rotulo: "Imobiliária" },
  { id: "industria", rotulo: "Indústria" },
  { id: "outro", rotulo: "Outro" },
];

const EXISTE: Record<OndeTravam["temas"][number]["existe"], string> = {
  trilha: "Trilha",
  guia_curto: "Guia curto do manual",
  sem_manual: "Sem trilha e sem manual",
};

const TIPO_DA_PROPOSTA: Record<string, string> = {
  agente: "Agente do modelo",
  funil: "Funil do quadro pronto",
  followup: "Follow-up do modelo",
};

/** Queda de pontos a partir da qual o passo ganha o alerta. */
const QUEDA_QUE_ALERTA = 15;

interface Resposta {
  painel: OndeTravam;
  melhorias: Melhoria[];
}

export function OndeOsClientesTravam() {
  const t = useT();
  const tag = useTagDeIdioma();
  const qc = useQueryClient();
  const [periodo, setPeriodo] = useState<PeriodoDoPainel>(30);
  const [segmento, setSegmento] = useState<SegmentoDoPainel>("todos");
  const [trilhaEscolhida, setTrilhaEscolhida] = useState<string | null>(null);

  const chave = ["admin", "assistente", periodo, segmento] as const;
  const dados = useQuery({
    queryKey: chave,
    queryFn: () =>
      apiClient
        .get<{ data: Resposta }>(`/api/v1/admin/assistente?periodo=${periodo}&segmento=${segmento}`, { timeoutMs: 60_000 })
        .then((r) => r.data),
  });
  const anotar = useMutation({
    mutationFn: (m: { titulo: string; evidencia?: string | null; origem?: OrigemDaMelhoria; situacao?: SituacaoDaMelhoria }) =>
      apiClient.post<{ data: { desfecho: string } }>("/api/v1/admin/assistente/melhorias", m).then((r) => r.data),
    onSuccess: (r) => {
      toast.success(r.desfecho === "igual" ? t("Essa já está anotada.") : t("Anotada na lista de melhorias."));
      void qc.invalidateQueries({ queryKey: ["admin", "assistente"] });
    },
    onError: () => toast.error(t("Não deu para anotar agora.")),
  });

  const p = dados.data?.painel;
  const melhorias = dados.data?.melhorias ?? [];
  const jaAnotada = (titulo: string) => melhorias.some((m) => m.titulo.trim().toLowerCase() === titulo.trim().toLowerCase());
  const comecadas = useMemo(() => (p?.trilhas ?? []).filter((x) => x.comecaram > 0), [p]);
  const trilha =
    comecadas.find((x) => x.id === trilhaEscolhida) ??
    [...comecadas].sort((a, b) => (b.maior_queda?.pontos ?? 0) - (a.maior_queda?.pontos ?? 0))[0] ??
    null;
  const doCatalogo = trilha ? trilhaPorId(trilha.id) : null;

  return (
    <div className="space-y-5" data-testid="onde-os-clientes-travam">
      <div>
        <h1 className="text-xl font-semibold">{t("Assistente nos clientes")}</h1>
        <p className="max-w-3xl text-sm text-text-muted">
          {t("O que os clientes mais perguntam ao assistente, em que passo das trilhas param, que trilha abandonam e que proposta desfazem. Cada achado vira melhoria do produto com um clique. A Time vê números juntados e as perguntas sem resposta; nunca a conversa de ninguém.")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-text-muted">{t("Período")}:</span>
        {PERIODOS.map((x) => (
          <Button key={x.id} type="button" size="sm" variant={periodo === x.id ? "default" : "outline"} className="h-11 lg:h-8" aria-pressed={periodo === x.id} onClick={() => setPeriodo(x.id)}>
            {t(x.rotulo)}
          </Button>
        ))}
        <span className="ml-2 text-sm text-text-muted">{t("Segmento")}:</span>
        {SEGMENTOS.map((x) => (
          <Button key={x.id} type="button" size="sm" variant={segmento === x.id ? "default" : "outline"} className="h-11 lg:h-8" aria-pressed={segmento === x.id} onClick={() => setSegmento(x.id)}>
            {t(x.rotulo)}
          </Button>
        ))}
      </div>

      {dados.isLoading ? <p className="text-sm text-text-muted">{t("Carregando…")}</p> : null}
      {dados.error ? <p className="text-sm text-warning-fg">{t("Não consegui ler onde os clientes travam.")}</p> : null}

      {p ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Numero rotulo={t("Empresas usando")} valor={String(p.empresas.usando)} nota={`${t("de")} ${p.empresas.no_ar} ${t("no ar")}`} />
            <Numero rotulo={t("Perguntas")} valor={p.perguntas.total.toLocaleString(tag)} nota={`${t("nos últimos")} ${p.periodo_dias} ${t("dias")}`} />
            <Numero
              rotulo={t("Trilhas feitas")}
              valor={`${pct(p.trilhas_resumo.feitas, p.trilhas_resumo.comecadas)}%`}
              nota={`${p.trilhas_resumo.feitas} ${t("de")} ${p.trilhas_resumo.comecadas} ${t("começadas")}`}
            />
            <Numero
              rotulo={t("Propostas desfeitas")}
              valor={`${pct(p.propostas_resumo.desfeitas, p.propostas_resumo.aplicadas + p.propostas_resumo.desfeitas)}%`}
              nota={`${p.propostas_resumo.desfeitas} ${t("de")} ${p.propostas_resumo.aplicadas + p.propostas_resumo.desfeitas} ${t("aplicadas")}`}
            />
            <Numero rotulo={t("Sem resposta")} valor={`${pct(p.perguntas.sem_resposta, p.perguntas.total)}%`} nota={`${p.perguntas.sem_resposta} ${t("perguntas")}`} />
          </div>
          {p.perguntas.lidas_ate_o_teto ? (
            <p className="text-xs text-text-muted">{t("Muitas perguntas no período: os temas contam as 10 mil mais novas.")}</p>
          ) : null}

          <Bloco titulo={t("O que os clientes mais perguntam")} testid="mais-perguntam">
            {p.temas.length === 0 ? <p className="text-sm text-text-muted">{t("Nenhuma pergunta no período.")}</p> : null}
            <ul className="divide-y">
              {p.temas.map((x) => {
                const titulo = `${t("Trilha ou manual")}: ${t(x.tema)}`;
                return (
                  <li key={x.tema} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="min-w-0 flex-1">{t(x.tema)}</span>
                    <span className="w-24 text-right">{x.perguntas} {t("perguntas")}</span>
                    <span className="w-24 text-right text-text-muted">{x.empresas} {t("empresas")}</span>
                    <Badge variant={x.existe === "trilha" ? "success" : x.existe === "guia_curto" ? "info" : "warning"}>{t(EXISTE[x.existe])}</Badge>
                    {x.existe !== "trilha" ? (
                      jaAnotada(titulo) ? (
                        <Badge variant="neutral">{t("anotada")}</Badge>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-11 lg:h-8"
                          disabled={anotar.isPending}
                          onClick={() =>
                            anotar.mutate({
                              titulo,
                              origem: "tema",
                              evidencia: `${x.perguntas} ${t("perguntas em")} ${x.empresas} ${t("empresas")}, ${p.periodo_dias} ${t("dias")}`,
                            })
                          }
                        >
                          {t("Anotar como melhoria")}
                        </Button>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Bloco>

          <Bloco titulo={t("Onde travam: em que passo param")} testid="onde-travam">
            {comecadas.length === 0 ? (
              <p className="text-sm text-text-muted">{t("Nenhuma trilha começada no período.")}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1" role="group" aria-label={t("Trilha")}>
                  {comecadas.map((x) => (
                    <Button
                      key={x.id}
                      type="button"
                      size="sm"
                      variant={trilha?.id === x.id ? "default" : "outline"}
                      className="h-11 lg:h-8"
                      aria-pressed={trilha?.id === x.id}
                      onClick={() => setTrilhaEscolhida(x.id)}
                    >
                      {t(x.titulo)}
                    </Button>
                  ))}
                </div>
                {trilha && doCatalogo ? (
                  <div className="space-y-2">
                    <p className="text-xs text-text-muted">
                      {t("De")} {trilha.comecaram} {t("pessoas que começaram, quantas chegaram a cada passo (%).")}
                    </p>
                    <ul className="space-y-1">
                      {trilha.chegaram_por_passo.map((v, i) => {
                        const queda = trilha.maior_queda && trilha.maior_queda.passo === i + 1 && trilha.maior_queda.pontos >= QUEDA_QUE_ALERTA;
                        return (
                          <li key={i} className="flex items-center gap-2 text-sm">
                            <span className="w-64 shrink-0 truncate" title={t(doCatalogo.passos[i]?.texto ?? "")}>
                              {t("Passo")} {i + 1} · {t(doCatalogo.passos[i]?.texto ?? "")}
                            </span>
                            <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                              <span className={cn("block h-full", queda ? "bg-warning-fg" : "bg-primary")} style={{ width: `${v}%` }} />
                            </span>
                            <span className="w-12 text-right">{v}%</span>
                            {queda ? <Badge variant="warning">{t("maior queda")}</Badge> : null}
                          </li>
                        );
                      })}
                    </ul>
                    {trilha.maior_queda ? (
                      <div className="space-y-1 rounded-md bg-surface-muted p-3 text-sm">
                        <p>
                          <strong>
                            {t("No passo")} {trilha.maior_queda.passo}
                          </strong>
                          : {trilha.perguntas_por_passo[trilha.maior_queda.passo - 1] ?? 0} {t("perguntas ao assistente durante o passo e")}{" "}
                          {trilha.ja_fiz_sem_conferir_por_passo[trilha.maior_queda.passo - 1] ?? 0} {t("\"Já fiz\" que não conferiram.")}
                        </p>
                        {(() => {
                          const titulo = `${t("Trilha")} ${t(trilha.titulo)}: ${t("passo")} ${trilha.maior_queda!.passo} ${t("perde")} ${trilha.maior_queda!.pontos} ${t("pontos")}`;
                          return jaAnotada(titulo) ? (
                            <Badge variant="neutral">{t("anotada")}</Badge>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-11 lg:h-8"
                              disabled={anotar.isPending}
                              onClick={() =>
                                anotar.mutate({
                                  titulo,
                                  origem: "trilha",
                                  evidencia: `${trilha.comecaram} ${t("começaram")}, ${trilha.maior_queda!.pontos} ${t("pontos de queda em")} ${p.periodo_dias} ${t("dias")}`,
                                })
                              }
                            >
                              {t("Anotar como melhoria")}
                            </Button>
                          );
                        })()}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </Bloco>

          <div className="grid gap-4 lg:grid-cols-2">
            <Bloco titulo={t("Que trilha abandonam")} testid="abandonam">
              <p className="text-xs text-text-muted">{t("Pausadas há mais de 7 dias sem voltar, em % das começadas.")}</p>
              <Barras linhas={p.abandonadas.map((x) => [t(x.titulo), x.percentual])} />
            </Bloco>
            <Bloco titulo={t("Que proposta desfazem")} testid="desfazem">
              <p className="text-xs text-text-muted">{t("Desfeitas, em % das aplicadas. Proposta muito desfeita é proposta ruim.")}</p>
              <Barras linhas={p.propostas.map((x) => [t(TIPO_DA_PROPOSTA[x.tipo] ?? x.tipo), x.percentual_desfeitas])} />
              <p className="text-xs text-text-muted">
                {p.propostas.map((x) => `${t(TIPO_DA_PROPOSTA[x.tipo] ?? x.tipo)}: ${x.aplicadas} ${t("aplicadas")}, ${x.rejeitadas} ${t("recusadas")}`).join(" · ")}
              </p>
            </Bloco>
          </div>

          <Bloco titulo={t("Perguntas sem resposta")} testid="sem-resposta">
            {p.sem_resposta.length === 0 ? <p className="text-sm text-text-muted">{t("Nenhuma no período.")}</p> : null}
            <ul className="divide-y">
              {p.sem_resposta.map((x) => {
                const titulo = `${t("Responder")}: "${x.pergunta}"`;
                return (
                  <li key={x.pergunta} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="min-w-0 flex-1">&ldquo;{x.pergunta}&rdquo;</span>
                    <span className="text-xs text-text-muted">
                      {x.empresas} {t("empresas")} · {x.vezes} {t("vezes")}
                    </span>
                    {jaAnotada(titulo) ? (
                      <Badge variant="neutral">{t("anotada")}</Badge>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-11 lg:h-8"
                        disabled={anotar.isPending}
                        onClick={() =>
                          anotar.mutate({ titulo, origem: "sem_resposta", evidencia: `${x.vezes} ${t("vezes, em")} ${x.empresas} ${t("empresas")}` })
                        }
                      >
                        {t("anotar")}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-text-muted">
              {t("Só o texto da pergunta, sem o nome de quem perguntou nem de contato. E-mail, telefone e documento saem mascarados.")}
            </p>
          </Bloco>

          <Bloco titulo={t("O que a Time vê, e o que não vê")} testid="o-que-a-time-ve">
            <p className="text-sm">
              <strong>{t("Vê")}:</strong> {t("contagens por tema, por trilha, por passo e por tipo de proposta, juntadas e por segmento; o texto das perguntas sem resposta.")}
            </p>
            <p className="text-sm">
              <strong>{t("Não vê")}:</strong> {t("a conversa de ninguém com o assistente, nome de pessoa ou de contato, telefone, o texto das propostas.")}
            </p>
            <p className="text-xs text-text-muted">{t("As empresas de demonstração não entram.")}</p>
          </Bloco>
        </>
      ) : null}

      <Bloco titulo={`${t("Melhorias anotadas")} · ${melhorias.length}`} testid="melhorias-anotadas">
        {melhorias.length === 0 ? <p className="text-sm text-text-muted">{t("Nenhuma ainda.")}</p> : null}
        <ul className="divide-y">
          {melhorias.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{m.titulo}</p>
                <p className="text-xs text-text-muted">
                  {m.evidencia ? `${m.evidencia} · ` : ""}
                  {t("anotada em")} {new Date(m.created_at).toLocaleDateString(tag)}
                </p>
              </div>
              <label className="flex items-center gap-1 text-xs">
                <span className="sr-only">{t("Situação")}</span>
                <select
                  className="h-11 rounded-md border bg-background px-2 text-sm lg:h-8"
                  value={m.situacao}
                  disabled={anotar.isPending}
                  aria-label={t("Situação")}
                  onChange={(e) => anotar.mutate({ titulo: m.titulo, situacao: e.target.value as SituacaoDaMelhoria })}
                >
                  {SITUACOES_DA_MELHORIA.map((s) => (
                    <option key={s} value={s}>
                      {t(ROTULO_DA_SITUACAO_DA_MELHORIA[s])}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-xs text-text-muted">
          {t("A lista mora aqui, na tela da Time, e o MCP de plataforma lê e escreve nela: o agente de desenvolvimento pega dali, com a evidência junto.")}
        </p>
      </Bloco>
    </div>
  );
}

const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 100) : 0);

function Numero({ rotulo, valor, nota }: { rotulo: string; valor: string; nota: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-text-muted">{rotulo}</p>
      <p className="text-2xl font-semibold">{valor}</p>
      <p className="text-xs text-text-muted">{nota}</p>
    </div>
  );
}

function Bloco({ titulo, testid, children }: { titulo: string; testid: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-lg border p-4" data-testid={testid}>
      <h2 className="text-base font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

function Barras({ linhas }: { linhas: Array<[string, number]> }) {
  const t = useT();
  if (linhas.length === 0) return <p className="text-sm text-text-muted">{t("Nada no período.")}</p>;
  return (
    <ul className="space-y-1">
      {linhas.map(([rotulo, v]) => (
        <li key={rotulo} className="flex items-center gap-2 text-sm">
          <span className="w-48 shrink-0 truncate">{rotulo}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
            <span className="block h-full bg-primary" style={{ width: `${Math.min(100, v)}%` }} />
          </span>
          <span className="w-12 text-right">{v}%</span>
        </li>
      ))}
    </ul>
  );
}
