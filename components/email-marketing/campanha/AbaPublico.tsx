"use client";

/**
 * FORK MIA (.89) — a tela PÚBLICO de uma campanha de e-mail (protótipo, tela 2).
 *
 * O recorte é o filtro das Campanhas do upstream (etiquetas, funil e etapa,
 * origem, interação) com dois acréscimos nossos: a empresa e a campanha de
 * e-mail anterior. A base legal é da campanha: consentimento (o padrão) ou
 * interesse legítimo, só para clientes dos últimos 24 meses e com a LIA.
 *
 * A contagem refaz a cada mudança e diz, para cada um dos dez motivos, quantos
 * ficam de fora e quem são. Não existe "todos os contatos".
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { SeletorDeEtapas } from "@/components/broadcast/SeletorDeEtapas";
import { SeletorDeTags } from "@/components/broadcast/SeletorDeTags";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useEmpresasDoSeletor } from "@/hooks/useEmpresas";
import {
  useCampanhasDeEmail,
  useContagemDoPublico,
  useEditarCampanha,
  useSalvarSegmento,
  useSegmentos,
  type CampanhaNaTela,
} from "@/hooks/useEmailMarketing";
import {
  MOTIVOS_DE_EXCLUSAO,
  PORQUE_DO_MOTIVO,
  ROTULO_DO_MOTIVO,
} from "@/lib/email-marketing/elegibilidade";
import {
  COMPORTAMENTOS_NA_CAMPANHA,
  ROTULO_DO_COMPORTAMENTO,
  temCriterio,
  type RecorteDoEmail,
} from "@/lib/email-marketing/recorte";
import { CaretDown } from "@/lib/ui/icons";

const TOQUE = "min-h-11 lg:min-h-0";

const CORES: Record<string, string> = {
  descadastro: "bg-error",
  reclamacao: "bg-error",
  manual: "bg-warning",
  outros: "bg-info",
  sem_email: "bg-surface-elevated",
  email_invalido: "bg-warning",
  rejeicao: "bg-error",
  sem_consentimento: "bg-info",
  nao_cliente: "bg-info",
  duplicado: "bg-surface-elevated",
};

export function AbaPublico({
  campanha,
  aoSeguir,
}: {
  campanha: CampanhaNaTela;
  aoSeguir: () => void;
}) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const rascunho = campanha.status === "rascunho";
  const editar = useEditarCampanha(campanha.id);
  const [recorte, setRecorte] = useState<RecorteDoEmail>(campanha.recorte);
  const [base, setBase] = useState(campanha.base_legal);
  const [lia, setLia] = useState(campanha.lia_ref ?? "");
  const [funil, setFunil] = useState<string | null>(campanha.recorte.funis[0] ?? null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [nomeDoSegmento, setNomeDoSegmento] = useState("");
  // A conta refaz meio segundo depois da última mudança.
  const [recorteAplicado, setRecorteAplicado] = useState(recorte);
  useEffect(() => {
    const id = setTimeout(() => setRecorteAplicado(recorte), 500);
    return () => clearTimeout(id);
  }, [recorte]);
  const contagem = useContagemDoPublico(recorteAplicado, base, temCriterio(recorteAplicado));
  const segmentos = useSegmentos();
  const salvarSegmento = useSalvarSegmento();
  const empresas = useEmpresasDoSeletor();
  const anteriores = useCampanhasDeEmail();
  const outrasCampanhas = useMemo(
    () => (anteriores.data ?? []).filter((x) => x.id !== campanha.id && x.status !== "rascunho"),
    [anteriores.data, campanha.id],
  );
  const mudou =
    JSON.stringify(recorte) !== JSON.stringify(campanha.recorte) ||
    base !== campanha.base_legal ||
    (lia || null) !== (campanha.lia_ref || null);

  const mudar = (patch: Partial<RecorteDoEmail>) => setRecorte((r) => ({ ...r, ...patch }));
  const salvar = (depois?: () => void) =>
    editar.mutate(
      {
        recorte,
        base_legal: base,
        lia_ref: base === "legitimate_interest" ? lia.trim() || null : null,
      },
      { onSuccess: () => depois?.() },
    );

  const c = contagem.data;
  const fora = c ? c.no_recorte - c.recebem : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr,380px]">
      <div className="space-y-4">
        <Card className="space-y-4 p-4">
          <h2 className="text-base font-semibold">{t("Recorte")}</h2>
          <div className="space-y-1">
            <Label>{t("Tem alguma etiqueta")}</Label>
            <SeletorDeTags
              selecionadas={recorte.com_alguma_tag}
              onChange={(tags) => mudar({ com_alguma_tag: tags })}
              disabled={!rascunho}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("Não tem a etiqueta")}</Label>
            <SeletorDeTags
              selecionadas={recorte.sem_tags}
              onChange={(tags) => mudar({ sem_tags: tags })}
              disabled={!rascunho}
            />
          </div>
          <SeletorDeEtapas
            funil={funil}
            aoMudarFunil={(id) => {
              setFunil(id);
              mudar({ funis: id ? [id] : [], etapas: [] });
            }}
            etapas={recorte.etapas}
            aoMudarEtapas={(ids) => mudar({ etapas: ids })}
            disabled={!rascunho}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="pub-empresa">{t("Empresa")}</Label>
              <select
                id="pub-empresa"
                className={`h-9 w-full rounded-md border border-border bg-surface px-2 text-sm ${TOQUE}`}
                value={recorte.empresa ?? ""}
                onChange={(e) =>
                  mudar({ empresa: (e.target.value || null) as RecorteDoEmail["empresa"] })
                }
                disabled={!rascunho}
              >
                <option value="">{t("Qualquer uma, ou nenhuma")}</option>
                <option value="com">{t("Só quem tem empresa")}</option>
                <option value="sem">{t("Só quem não tem empresa")}</option>
                {(empresas.data?.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pub-silencio">{t("Sem interação há quantos dias")}</Label>
              <Input
                id="pub-silencio"
                type="number"
                min={1}
                value={recorte.sem_interacao_ha_dias ?? ""}
                onChange={(e) =>
                  mudar({
                    sem_interacao_ha_dias: e.target.value
                      ? Math.max(1, Number(e.target.value))
                      : null,
                  })
                }
                disabled={!rascunho}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="pub-campanha">{t("Campanha de e-mail anterior")}</Label>
              <select
                id="pub-campanha"
                className={`h-9 w-full rounded-md border border-border bg-surface px-2 text-sm ${TOQUE}`}
                value={recorte.campanha_anterior?.campanha_id ?? ""}
                onChange={(e) =>
                  mudar({
                    campanha_anterior: e.target.value
                      ? {
                          campanha_id: e.target.value,
                          comportamento: recorte.campanha_anterior?.comportamento ?? "clicou",
                        }
                      : null,
                  })
                }
                disabled={!rascunho}
              >
                <option value="">{t("Nenhuma")}</option>
                {outrasCampanhas.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pub-comportamento">{t("Quem")}</Label>
              <select
                id="pub-comportamento"
                className={`h-9 w-full rounded-md border border-border bg-surface px-2 text-sm ${TOQUE}`}
                value={recorte.campanha_anterior?.comportamento ?? "clicou"}
                onChange={(e) =>
                  recorte.campanha_anterior &&
                  mudar({
                    campanha_anterior: {
                      ...recorte.campanha_anterior,
                      comportamento: e.target.value as (typeof COMPORTAMENTOS_NA_CAMPANHA)[number],
                    },
                  })
                }
                disabled={!rascunho || !recorte.campanha_anterior}
              >
                {COMPORTAMENTOS_NA_CAMPANHA.map((k) => (
                  <option key={k} value={k}>
                    {t(ROTULO_DO_COMPORTAMENTO[k])}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("Etiqueta, funil e etapa são o filtro das Campanhas. Os critérios somam como E.")}
          </p>
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="text-base font-semibold">{t("Base legal da campanha")}</h2>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("Base legal")}>
            <Button
              variant={base === "consent" ? "default" : "outline"}
              onClick={() => setBase("consent")}
              disabled={!rascunho}
            >
              {t("Consentimento")}
            </Button>
            <Button
              variant={base === "legitimate_interest" ? "default" : "outline"}
              onClick={() => setBase("legitimate_interest")}
              disabled={!rascunho}
            >
              {t("Interesse legítimo (clientes)")}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {base === "consent"
              ? t(
                  "Recebe só quem tem o aceite de e-mail marketing registrado na ficha: data, origem e o texto aceito. É o padrão.",
                )
              : t(
                  "Recebe só quem comprou nos últimos 24 meses, mesmo sem aceite registrado. Exige a referência da avaliação de interesse legítimo, e esses e-mails saem sem medição de abertura.",
                )}
          </p>
          {base === "legitimate_interest" ? (
            <div className="space-y-1">
              <Label htmlFor="pub-lia">{t("Referência da avaliação (LIA)")}</Label>
              <Input
                id="pub-lia"
                value={lia}
                onChange={(e) => setLia(e.target.value)}
                placeholder="LIA-2026-03"
                disabled={!rascunho}
              />
              <p className="text-xs text-muted-foreground">
                {t("Mesma regra das Campanhas: interesse legítimo sem a referência não sai.")}
              </p>
            </div>
          ) : null}
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="text-base font-semibold">{t("Segmentos salvos")}</h2>
          <ul className="divide-y divide-border">
            {(segmentos.data ?? []).length === 0 ? (
              <li className="py-2 text-sm text-muted-foreground">
                {t("Nenhum segmento salvo ainda.")}
              </li>
            ) : null}
            {(segmentos.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <b>{s.nome}</b>
                  <span className="block text-xs text-muted-foreground">
                    {s.base_legal === "legitimate_interest"
                      ? t("Interesse legítimo")
                      : t("Consentimento")}{" "}
                    · {new Date(s.created_at).toLocaleDateString(idioma)}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  disabled={!rascunho}
                  onClick={() => {
                    setRecorte(s.recorte);
                    setFunil(s.recorte.funis[0] ?? null);
                    setBase(s.base_legal);
                    setLia(s.lia_ref ?? "");
                    toast.success(t("Segmento carregado. A conta foi refeita agora."));
                  }}
                >
                  {t("Usar")}
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {t(
              "O segmento guarda o filtro, não a lista: a conta refaz na hora de usar, e serve ao WhatsApp e ao e-mail.",
            )}
          </p>
        </Card>
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Card className="space-y-3 p-4" data-publico="contagem">
          <h2 className="text-base font-semibold">{t("Quem recebe")}</h2>
          {!temCriterio(recorte) ? (
            <p className="rounded-md bg-warning-bg p-3 text-sm text-warning-fg">
              {t(
                'Escolha pelo menos um critério. Não existe "todos os contatos": recorte sem critério é o envio que ninguém confere antes de apertar.',
              )}
            </p>
          ) : contagem.isLoading || !c ? (
            <p className="text-sm text-muted-foreground">{t("Contando…")}</p>
          ) : (
            <>
              <div className="flex items-end justify-between">
                <div>
                  <b className="text-3xl" data-recebem>
                    {c.recebem.toLocaleString(idioma)}
                  </b>
                  <span className="block text-sm text-muted-foreground">
                    {t("recebem este e-mail")}
                  </span>
                </div>
                <div className="text-right text-sm text-muted-foreground">
                  <b>{c.no_recorte.toLocaleString(idioma)}</b> {t("no recorte")}
                  <br />
                  <b>{fora.toLocaleString(idioma)}</b> {t("ficam de fora")}
                </div>
              </div>
              {c.truncado ? (
                <p className="text-xs text-warning-fg">
                  {t("O recorte passou do teto de 50 mil contatos: divida a campanha.")}
                </p>
              ) : null}
              {base === "legitimate_interest" && !lia.trim() ? (
                <p className="rounded-md bg-error-bg p-2 text-sm text-error-fg">
                  {t(
                    "Falta a referência da avaliação de interesse legítimo. Sem ela, a campanha não sai.",
                  )}
                </p>
              ) : null}
              <ul className="space-y-1">
                {MOTIVOS_DE_EXCLUSAO.filter((m) => (c.fora_por_motivo[m] ?? 0) > 0).map((m) => (
                  <li key={m}>
                    <button
                      type="button"
                      className={`flex w-full items-start gap-2 rounded-md p-1 text-left text-sm hover:bg-surface-elevated ${TOQUE}`}
                      aria-expanded={aberto === m}
                      onClick={() => setAberto(aberto === m ? null : m)}
                    >
                      <i
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${CORES[m]}`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        {t(ROTULO_DO_MOTIVO[m])}
                        <small className="block text-xs text-muted-foreground">
                          {t(PORQUE_DO_MOTIVO[m])}
                        </small>
                      </span>
                      <b>{(c.fora_por_motivo[m] ?? 0).toLocaleString(idioma)}</b>
                      <CaretDown size={14} aria-hidden />
                    </button>
                    {aberto === m ? (
                      <ul className="ml-4 space-y-0.5 text-xs text-muted-foreground">
                        {(c.amostras[m] ?? []).map((p, i) => (
                          <li key={i}>
                            {p.nome ?? t("Sem nome")} · {p.email ?? t("sem e-mail")}
                          </li>
                        ))}
                        {(c.fora_por_motivo[m] ?? 0) > (c.amostras[m]?.length ?? 0) ? (
                          <li>
                            {t("e mais")}{" "}
                            {(
                              (c.fora_por_motivo[m] ?? 0) - (c.amostras[m]?.length ?? 0)
                            ).toLocaleString(idioma)}
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                {t(
                  "A mesma conta roda de novo antes de cada e-mail sair: quem se descadastrar depois de agendado não recebe.",
                )}
              </p>
            </>
          )}
          {rascunho ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  value={nomeDoSegmento}
                  onChange={(e) => setNomeDoSegmento(e.target.value)}
                  placeholder={t("Nome do segmento")}
                  aria-label={t("Nome do segmento")}
                />
                <Button
                  variant="outline"
                  disabled={
                    !nomeDoSegmento.trim() || !temCriterio(recorte) || salvarSegmento.isPending
                  }
                  onClick={() =>
                    salvarSegmento.mutate(
                      {
                        nome: nomeDoSegmento.trim(),
                        recorte,
                        base_legal: base,
                        lia_ref: base === "legitimate_interest" ? lia.trim() || null : null,
                      },
                      {
                        onSuccess: () => {
                          setNomeDoSegmento("");
                          toast.success(t("Segmento salvo."));
                        },
                      },
                    )
                  }
                >
                  {t("Salvar como segmento")}
                </Button>
              </div>
              <Button
                className="w-full"
                disabled={editar.isPending || !temCriterio(recorte)}
                onClick={() => (mudou ? salvar(aoSeguir) : aoSeguir())}
              >
                {mudou ? t("Salvar e seguir para a mensagem") : t("Seguir para a mensagem")}
              </Button>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
