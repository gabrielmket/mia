"use client";

/**
 * FORK MIA (.89) — a tela RESULTADOS de uma campanha de e-mail (protótipo, tela 5).
 *
 * A abertura é SEMPRE estimativa (a Apple e outros abrem a imagem sozinhos), e
 * só conta quem aceitou a medição: interesse legítimo não leva pixel. O clique é
 * medido pelo link de passagem, sem o robô que confere link no primeiro minuto.
 * Quem clicou vira segmento, tarefa ou negócio, pulando quem já tem negócio aberto.
 */
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useAcaoSobreCliques, useResultados, type CampanhaNaTela } from "@/hooks/useEmailMarketing";
import { usePipelines, usePipelineStages } from "@/hooks/webhooks/useWebhookSources";
import { TRAVA_RECLAMACAO_PCT, TRAVA_REJEICAO_PCT } from "@/lib/email-marketing/regras";
import { formatCentsBRL } from "@/lib/money";

const TOQUE = "min-h-11 lg:min-h-0";

function Numero({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-xl font-semibold tabular-nums">{valor}</p>
      {nota ? <p className="text-xs text-muted-foreground">{nota}</p> : null}
    </div>
  );
}

function Medidor({ rotulo, pct, trava }: { rotulo: string; pct: number; trava: number }) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const largura = Math.min(100, trava > 0 ? (pct / trava) * 100 : 0);
  const cor = pct >= trava ? "bg-error" : pct >= trava * 0.6 ? "bg-warning" : "bg-success";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{rotulo}</span>
        <span className="tabular-nums">
          {pct.toLocaleString(idioma, { maximumFractionDigits: 2 })}% · {t("trava em")}{" "}
          {trava.toLocaleString(idioma)}%
        </span>
      </div>
      <div
        className="h-2 w-full rounded-full bg-surface-elevated"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={trava}
        aria-label={rotulo}
      >
        <div className={`h-2 rounded-full ${cor}`} style={{ width: `${largura}%` }} />
      </div>
    </div>
  );
}

function pctDe(parte: number, todo: number): number {
  return todo > 0 ? (parte / todo) * 100 : 0;
}

export function AbaResultados({ campanha }: { campanha: CampanhaNaTela }) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const comecou = campanha.status !== "rascunho";
  const q = useResultados(campanha.id, comecou);
  const acao = useAcaoSobreCliques(campanha.id);
  const [nomeDoSegmento, setNomeDoSegmento] = useState(
    () => `${t("Clicaram em")} ${campanha.nome}`,
  );
  const [tituloDaTarefa, setTituloDaTarefa] = useState("");
  const [funil, setFunil] = useState<string | null>(null);
  const [etapa, setEtapa] = useState<string | null>(null);
  const funis = usePipelines();
  const quadro = usePipelineStages(funil);

  if (!comecou) {
    return (
      <p className="rounded-md bg-surface-elevated p-4 text-sm text-muted-foreground">
        {t("Os resultados aparecem quando a campanha começar a sair.")}
      </p>
    );
  }
  if (q.isLoading) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;
  if (q.isError || !q.data) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-error-fg">{t("Não consegui carregar os resultados.")}</p>
        <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
          {t("Tentar novamente")}
        </Button>
      </div>
    );
  }
  const n = q.data.numeros;
  const semPixel = campanha.base_legal === "legitimate_interest";
  const fmt = (x: number) => x.toLocaleString(idioma);
  const pctTxt = (x: number) => `${x.toLocaleString(idioma, { maximumFractionDigits: 1 })}%`;
  const quem = q.data.quem_clicou;
  const semNegocio = quem.filter((p) => !p.tem_negocio_aberto).length;

  const depois = (r: unknown) => {
    const x = r as { tipo?: string; criados?: number; pulados?: number; semResponsavel?: number };
    if (x.tipo === "segmento")
      toast.success(t("Segmento salvo. Ele aparece no Público da próxima campanha."));
    else
      toast.success(
        t("{criados} criados, {pulados} pulados.")
          .replace("{criados}", String(x.criados ?? 0))
          .replace("{pulados}", String(x.pulados ?? 0)),
      );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Numero
          rotulo={t("Enviados")}
          valor={fmt(n.enviados)}
          nota={
            n.pendentes > 0 ? t("{n} ainda na fila").replace("{n}", fmt(n.pendentes)) : undefined
          }
        />
        <Numero
          rotulo={t("Entregues")}
          valor={fmt(n.entregues)}
          nota={pctTxt(pctDe(n.entregues, n.enviados))}
        />
        <Numero
          rotulo={t("Aberturas (estimativa)")}
          valor={semPixel ? "—" : fmt(n.aberturas)}
          nota={
            semPixel
              ? t("Sem medição de abertura")
              : t("de {n} com medição").replace("{n}", fmt(n.medidas))
          }
        />
        <Numero
          rotulo={t("Cliques únicos")}
          valor={fmt(n.cliquesUnicos)}
          nota={t("{n} cliques no total").replace("{n}", fmt(n.cliquesTotais))}
        />
        <Numero rotulo={t("Descadastros")} valor={fmt(n.descadastros)} />
        <Numero
          rotulo={t("Rejeições")}
          valor={fmt(n.rejeicoesPermanentes + n.rejeicoesTemporarias)}
          nota={t("{n} permanentes").replace("{n}", fmt(n.rejeicoesPermanentes))}
        />
        <Numero rotulo={t("Reclamações de spam")} valor={fmt(n.reclamacoes)} />
        <Numero
          rotulo={t("Cobrado")}
          valor={formatCentsBRL(n.cobradoCents)}
          nota={
            n.pulados > 0
              ? t("{n} ficaram de fora na confirmação").replace("{n}", fmt(n.pulados))
              : undefined
          }
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {semPixel
          ? t(
              "Interesse legítimo: a campanha não leva o pixel de abertura. Só os cliques são medidos.",
            )
          : t(
              "A abertura é estimativa: alguns programas de e-mail abrem a imagem sozinhos, e só conta quem aceitou a medição. O clique é o número firme.",
            )}
        {n.falhas > 0 ? ` ${t("Falhas de envio, sem cobrança:")} ${fmt(n.falhas)}.` : ""}
      </p>

      <Card className="space-y-3 p-4">
        <h2 className="text-base font-semibold">{t("Saúde desta campanha")}</h2>
        <Medidor rotulo={t("Rejeição")} pct={n.rejeicaoPct} trava={TRAVA_REJEICAO_PCT} />
        <Medidor rotulo={t("Reclamação")} pct={n.reclamacaoPct} trava={TRAVA_RECLAMACAO_PCT} />
        <p className="text-xs text-muted-foreground">
          {t(
            "A trava pausa o envio sozinha a partir de 300 entregues, para proteger a conta da Amazon, que é uma só para todas as empresas.",
          )}
        </p>
      </Card>

      <Card className="space-y-2 p-4">
        <h2 className="text-base font-semibold">{t("Cliques por link")}</h2>
        {n.links.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("A mensagem não tem botão.")}</p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-3 font-medium">{t("Botão")}</th>
                <th className="py-1 pr-3 font-medium">{t("Destino")}</th>
                <th className="py-1 pr-3 text-right font-medium">{t("Pessoas")}</th>
                <th className="py-1 text-right font-medium">{t("Cliques")}</th>
              </tr>
            </thead>
            <tbody>
              {n.links.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-1 pr-3">{l.rotulo}</td>
                  <td className="max-w-[240px] truncate py-1 pr-3 text-xs text-muted-foreground">
                    {l.url}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmt(l.pessoas)}</td>
                  <td className="py-1 text-right tabular-nums">{fmt(l.cliques)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          {t(
            "Clique no primeiro minuto depois da entrega, ou de programa que confere link, não conta.",
          )}
        </p>
      </Card>

      <Card className="space-y-3 p-4" data-quem-clicou={quem.length}>
        <h2 className="text-base font-semibold">
          {t("Quem clicou")} <Badge variant="neutral">{fmt(quem.length)}</Badge>
        </h2>
        {quem.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Ninguém clicou ainda.")}</p>
        ) : (
          <>
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="space-y-2 rounded-md border border-border p-3">
                <b className="text-sm">{t("Salvar como segmento")}</b>
                <Label htmlFor="res-seg" className="sr-only">
                  {t("Nome do segmento")}
                </Label>
                <Input
                  id="res-seg"
                  value={nomeDoSegmento}
                  onChange={(e) => setNomeDoSegmento(e.target.value)}
                  placeholder={t("Nome do segmento")}
                />
                <Button
                  size="sm"
                  disabled={!nomeDoSegmento.trim() || acao.isPending}
                  onClick={() =>
                    acao.mutate(
                      { tipo: "segmento", nome: nomeDoSegmento.trim() },
                      { onSuccess: depois },
                    )
                  }
                >
                  {t("Salvar segmento")}
                </Button>
              </div>
              <div className="space-y-2 rounded-md border border-border p-3">
                <b className="text-sm">{t("Tarefa para o responsável")}</b>
                <Label htmlFor="res-tarefa" className="sr-only">
                  {t("Título da tarefa")}
                </Label>
                <Input
                  id="res-tarefa"
                  value={tituloDaTarefa}
                  onChange={(e) => setTituloDaTarefa(e.target.value)}
                  placeholder={t("Ligar para quem clicou")}
                />
                <Button
                  size="sm"
                  disabled={acao.isPending}
                  onClick={() =>
                    acao.mutate(
                      {
                        tipo: "tarefa",
                        titulo: tituloDaTarefa.trim() || t("Ligar para quem clicou"),
                        vence_em_dias: 1,
                        para: "responsavel",
                      },
                      { onSuccess: depois },
                    )
                  }
                >
                  {t("Criar {n} tarefas").replace("{n}", fmt(quem.length))}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t("Sem responsável no contato, a tarefa fica com você.")}
                </p>
              </div>
              <div className="space-y-2 rounded-md border border-border p-3">
                <b className="text-sm">{t("Abrir negócio")}</b>
                <select
                  aria-label={t("Funil")}
                  className={`h-9 w-full rounded-md border border-border bg-surface px-2 text-sm ${TOQUE}`}
                  value={funil ?? ""}
                  onChange={(e) => {
                    setFunil(e.target.value || null);
                    setEtapa(null);
                  }}
                >
                  <option value="">{t("Escolha o funil")}</option>
                  {(funis.data?.data ?? []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                {funil ? (
                  <select
                    aria-label={t("Etapa")}
                    className={`h-9 w-full rounded-md border border-border bg-surface px-2 text-sm ${TOQUE}`}
                    value={etapa ?? ""}
                    onChange={(e) => setEtapa(e.target.value || null)}
                  >
                    <option value="">{t("Escolha a etapa")}</option>
                    {(quadro.data?.data?.stages ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <Button
                  size="sm"
                  disabled={!funil || !etapa || acao.isPending}
                  onClick={() =>
                    funil &&
                    etapa &&
                    acao.mutate(
                      { tipo: "negocio", pipeline_id: funil, stage_id: etapa },
                      { onSuccess: depois },
                    )
                  }
                >
                  {t("Abrir {n} negócios").replace("{n}", fmt(semNegocio))}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t("Quem já tem negócio aberto no funil é pulado.")}
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-3 font-medium">{t("Contato")}</th>
                    <th className="py-1 pr-3 font-medium">{t("E-mail")}</th>
                    <th className="py-1 font-medium">{t("Negócio aberto")}</th>
                  </tr>
                </thead>
                <tbody>
                  {quem.slice(0, 200).map((p) => (
                    <tr key={p.contato_id} className="border-t border-border">
                      <td className="py-1 pr-3">{p.nome ?? t("Sem nome")}</td>
                      <td className="py-1 pr-3 text-xs text-muted-foreground">{p.email ?? "—"}</td>
                      <td className="py-1">
                        {p.tem_negocio_aberto ? (
                          <Badge variant="info">{t("sim")}</Badge>
                        ) : (
                          <Badge variant="neutral">{t("não")}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {quem.length > 200 ? (
              <p className="text-xs text-muted-foreground">{t("Mostrando os 200 primeiros.")}</p>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
