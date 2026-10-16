"use client";
/**
 * FORK MIA (9031) — a tela dos LINKS PARA O DONO DO NEGÓCIO (protótipo, tela 7).
 *
 * Criar, copiar, ver a página, revogar e renovar. O endereço de cada link vem
 * pronto da lista (o token é derivado do id no servidor e nunca é gravado), por
 * isso "Copiar link" copia direto no clique, sem ida ao servidor — o que também
 * vale no Safari, que só deixa copiar colado ao gesto.
 *
 * Revogar pede confirmação e é para sempre (`lib/paineis/link.ts`); para dar
 * acesso de novo, "Criar outro igual" preenche o formulário com o mesmo
 * conteúdo, e o link novo tem outro endereço. Renovar é para o VENCIDO, no
 * mesmo endereço.
 *
 * Todo controle tem 44 px de altura no celular (`min-h-11 lg:min-h-0`) e fonte
 * de 16 px (o iPhone dá zoom em campo com fonte menor), como `components/ui/input.tsx`.
 */
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { copyToClipboard } from "@/lib/clipboard";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import { tagDeIdioma } from "@/lib/i18n/datas";
import {
  PAINEIS_PRONTOS,
  PERIODOS_DOS_PAINEIS,
  ROTULO_DO_PERIODO,
  TITULO_DO_PAINEL,
  VALIDADES_EM_DIAS,
  VALIDADE_PADRAO,
  type ChaveDoPainel,
  type PeriodoDoLink,
  type ValidadeEmDias,
} from "@/lib/paineis/catalogo";
import type { LinkDoDono } from "@/lib/paineis/link";

interface FunilDaTela {
  id: string;
  nome: string;
  principal: boolean;
  /** `vocabulary.compromisso_plural` do funil: o título do painel de agenda. */
  agenda: string | null;
}

interface Props {
  linksIniciais: LinkDoDono[];
  funis: FunilDaTela[];
  demonstracao: boolean;
  disponivel: boolean;
}

/** O que o protótipo marca por padrão no link novo. */
const PAINEIS_PADRAO: ChaveDoPainel[] = ["resultado", "meta", "funil", "origem", "agenda", "atendimento"];

const CONTROLE = "min-h-11 rounded-sm border border-border bg-bg px-3 text-base md:text-sm lg:min-h-9";

interface Rascunho {
  paraQuem: string;
  paineis: ChaveDoPainel[];
  periodo: PeriodoDoLink;
  validade: ValidadeEmDias;
  mostrarValores: boolean;
  pipelineId: string;
}

function rascunhoVazio(): Rascunho {
  return { paraQuem: "", paineis: [...PAINEIS_PADRAO], periodo: "escolhe", validade: VALIDADE_PADRAO, mostrarValores: true, pipelineId: "" };
}

export function LinksDoDonoClient({ linksIniciais, funis, demonstracao, disponivel }: Props) {
  const t = useT();
  const idioma = useIdioma();
  const tag = tagDeIdioma(idioma);
  const [links, setLinks] = useState<LinkDoDono[]>(linksIniciais);
  const [aberto, setAberto] = useState(linksIniciais.length === 0);
  const [rascunho, setRascunho] = useState<Rascunho>(rascunhoVazio);
  const [gravando, setGravando] = useState(false);
  const [revogando, setRevogando] = useState<string | null>(null);

  const funilPrincipal = funis.find((f) => f.principal) ?? funis[0] ?? null;
  const funilDoRascunho = funis.find((f) => f.id === rascunho.pipelineId) ?? funilPrincipal;

  const data = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso)) : null;

  const tituloDoPainel = (chave: ChaveDoPainel, funilId: string | null) => {
    if (chave === "agenda") {
      const f = funis.find((x) => x.id === funilId) ?? funilPrincipal;
      if (f?.agenda) return f.agenda;
    }
    return t(TITULO_DO_PAINEL[chave]);
  };

  function trocarPainel(chave: ChaveDoPainel, marcado: boolean) {
    setRascunho((r) => ({
      ...r,
      paineis: marcado
        ? PAINEIS_PRONTOS.filter((p) => p === chave || r.paineis.includes(p))
        : r.paineis.filter((p) => p !== chave),
    }));
  }

  async function criar() {
    if (!rascunho.paraQuem.trim()) {
      toast.error(t("Diga para quem é o link."));
      return;
    }
    if (rascunho.paineis.length === 0) {
      toast.error(t("Escolha pelo menos um painel."));
      return;
    }
    setGravando(true);
    try {
      const res = await apiClient.post<{ data: { link: LinkDoDono } }>("/api/v1/paineis/links", {
        para_quem: rascunho.paraQuem.trim(),
        paineis: rascunho.paineis,
        periodo: rascunho.periodo,
        mostrar_valores: rascunho.mostrarValores,
        validade_dias: rascunho.validade,
        pipeline_id: rascunho.pipelineId || null,
      });
      setLinks((l) => [res.data.link, ...l]);
      setRascunho(rascunhoVazio());
      setAberto(false);
      if (await copyToClipboard(res.data.link.url)) {
        toast.success(t("Link criado e copiado. Mande para quem vai abrir."));
      } else {
        toast.success(t("Link criado. Use \"Copiar link\" na lista."));
      }
    } catch (e) {
      showApiError(e);
    } finally {
      setGravando(false);
    }
  }

  async function copiar(link: LinkDoDono) {
    if (await copyToClipboard(link.url)) toast.success(t("Endereço copiado."));
    else toast.error(t("Não deu para copiar sozinho. Abra a página e copie o endereço do navegador."));
  }

  async function agir(link: LinkDoDono, acao: "revogar" | "renovar") {
    try {
      const res = await apiClient.post<{ data: { link: LinkDoDono } }>(`/api/v1/paineis/links/${link.id}`, {
        acao,
        ...(acao === "renovar" ? { validade_dias: VALIDADE_PADRAO } : {}),
      });
      setLinks((l) => l.map((x) => (x.id === link.id ? res.data.link : x)));
      toast.success(
        acao === "revogar"
          ? t("Link revogado: quem abrir vê que não está mais disponível.")
          : t("Link renovado por 90 dias, no mesmo endereço."),
      );
    } catch (e) {
      showApiError(e);
    } finally {
      setRevogando(null);
    }
  }

  function criarOutroIgual(link: LinkDoDono) {
    setRascunho({
      paraQuem: link.paraQuem,
      paineis: [...link.paineis],
      periodo: link.periodo,
      validade: VALIDADE_PADRAO,
      mostrarValores: link.mostrarValores,
      pipelineId: link.pipelineId ?? "",
    });
    setAberto(true);
  }

  const SITUACAO: Record<LinkDoDono["situacao"], { rotulo: string; variante: "success" | "warning" | "error" }> = {
    ativo: { rotulo: t("Ativo"), variante: "success" },
    vencido: { rotulo: t("Vencido"), variante: "warning" },
    revogado: { rotulo: t("Revogado"), variante: "error" },
  };

  return (
    <div className="flex h-full flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Links para o dono do negócio")}</h1>
          <p className="text-sm text-text-muted">
            {t("Um endereço que abre os painéis escolhidos sem usuário nem senha. Mostra só números somados.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/app/paineis"
            className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 text-sm font-medium hover:bg-surface-elevated lg:min-h-9"
          >
            {t("Voltar aos painéis")}
          </Link>
          {disponivel ? (
            <Button className="min-h-11 lg:min-h-9" onClick={() => setAberto((a) => !a)}>
              {aberto ? t("Fechar o novo link") : t("Novo link")}
            </Button>
          ) : null}
        </div>
      </header>

      {!disponivel ? (
        <p className="text-sm text-text-muted">{t("O link para o dono não está disponível nesta instalação.")}</p>
      ) : null}

      {demonstracao ? (
        <p className="rounded-md bg-warning-bg p-3 text-sm text-warning-fg">
          {t("Empresa de demonstração: o link mostra os dados fictícios, com o aviso de demonstração na página. Nada sai daqui.")}
        </p>
      ) : null}

      {aberto && disponivel ? (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle>{t("Novo link")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 p-4 pt-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("Para quem é (só para você se organizar)")}</span>
              <Input
                value={rascunho.paraQuem}
                maxLength={120}
                placeholder={t("Ex.: Dono da clínica")}
                onChange={(e) => setRascunho((r) => ({ ...r, paraQuem: e.target.value }))}
              />
            </label>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{t("Painéis")}</legend>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {PAINEIS_PRONTOS.map((chave) => (
                  <label key={chave} className="flex min-h-11 items-center gap-2 text-base md:text-sm lg:min-h-8">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={rascunho.paineis.includes(chave)}
                      onChange={(e) => trocarPainel(chave, e.target.checked)}
                    />
                    <span>{tituloDoPainel(chave, funilDoRascunho?.id ?? null)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{t("Período")}</span>
                <select
                  className={CONTROLE}
                  value={rascunho.periodo}
                  onChange={(e) => setRascunho((r) => ({ ...r, periodo: e.target.value as PeriodoDoLink }))}
                >
                  <option value="escolhe">{t("A pessoa escolhe")}</option>
                  {PERIODOS_DOS_PAINEIS.map((p) => (
                    <option key={p} value={p}>
                      {t("Fixo:")} {t(ROTULO_DO_PERIODO[p])}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{t("Validade")}</span>
                <select
                  className={CONTROLE}
                  value={rascunho.validade}
                  onChange={(e) => setRascunho((r) => ({ ...r, validade: Number(e.target.value) as ValidadeEmDias }))}
                >
                  {VALIDADES_EM_DIAS.map((v) => (
                    <option key={v} value={v}>
                      {v === 365 ? t("1 ano") : `${v} ${t("dias")}`}
                    </option>
                  ))}
                </select>
              </label>
              {funis.length > 1 ? (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{t("Funil")}</span>
                  <select
                    className={CONTROLE}
                    value={rascunho.pipelineId}
                    onChange={(e) => setRascunho((r) => ({ ...r, pipelineId: e.target.value }))}
                  >
                    <option value="">{t("O principal")}</option>
                    {funis.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            <label className="flex min-h-11 items-start gap-2 text-base md:text-sm lg:min-h-0">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={rascunho.mostrarValores}
                onChange={(e) => setRascunho((r) => ({ ...r, mostrarValores: e.target.checked }))}
              />
              <span>
                <span className="font-medium">{t("Mostrar valores em reais")}</span>
                <span className="block text-xs text-text-muted">{t("Desmarcado, a página mostra só quantidades.")}</span>
              </span>
            </label>

            <div className="flex flex-wrap gap-2">
              <Button className="min-h-11 lg:min-h-9" disabled={gravando} onClick={() => void criar()}>
                {gravando ? t("Criando…") : t("Criar link")}
              </Button>
              <Button
                variant="secondary"
                className="min-h-11 lg:min-h-9"
                onClick={() => {
                  setRascunho(rascunhoVazio());
                  setAberto(false);
                }}
              >
                {t("Cancelar")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <section className="flex flex-col gap-3" aria-label={t("Links criados")}>
        {links.length === 0 ? (
          <p className="text-sm text-text-muted">{t("Nenhum link ainda.")}</p>
        ) : (
          links.map((l) => {
            const s = SITUACAO[l.situacao];
            return (
              <Card key={l.id}>
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{l.paraQuem}</p>
                      <p className="truncate text-xs text-text-muted">{l.url.replace(/^https?:\/\//, "").slice(0, 48)}…</p>
                    </div>
                    <Badge variant={s.variante}>{s.rotulo}</Badge>
                  </div>
                  <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div className="min-w-0">
                      <dt className="text-xs text-text-muted">{t("O que mostra")}</dt>
                      <dd className="truncate">
                        {/* FORK MIA (9042): o link de um painel do montador mostra os relatórios dele. */}
                        {l.painelId ? (
                          <a href={`/app/relatorios/paineis/${l.painelId}`} className="text-accent hover:underline">
                            {t("Um painel do montador")}
                          </a>
                        ) : (
                          <>
                            {l.paineis.length} {t("painéis")} · {l.paineis.map((p) => tituloDoPainel(p, l.pipelineId)).join(", ")}
                          </>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-text-muted">{t("Período")}</dt>
                      <dd>
                        {l.periodo === "escolhe" ? t("A pessoa escolhe") : t(ROTULO_DO_PERIODO[l.periodo])} ·{" "}
                        {l.mostrarValores ? t("com valores em reais") : t("só quantidades")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-text-muted">{l.revogadoEm ? t("Revogado em") : t("Vale até")}</dt>
                      <dd>{data(l.revogadoEm ?? l.validoAte)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-text-muted">{t("Último acesso")}</dt>
                      <dd>
                        {data(l.ultimoAcesso) ?? t("ainda não aberto")} · {l.acessos} {t("acessos")}
                      </dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center rounded-sm border border-border px-3 text-sm font-medium hover:bg-surface-elevated lg:min-h-9"
                    >
                      {t("Ver a página")}
                    </a>
                    {l.situacao === "ativo" ? (
                      <>
                        <Button variant="secondary" className="min-h-11 lg:min-h-9" onClick={() => void copiar(l)}>
                          {t("Copiar link")}
                        </Button>
                        {revogando === l.id ? (
                          <>
                            <Button variant="destructive" className="min-h-11 lg:min-h-9" onClick={() => void agir(l, "revogar")}>
                              {t("Confirmar: revogar")}
                            </Button>
                            <Button variant="ghost" className="min-h-11 lg:min-h-9" onClick={() => setRevogando(null)}>
                              {t("Cancelar")}
                            </Button>
                          </>
                        ) : (
                          <Button variant="ghost" className="min-h-11 lg:min-h-9" onClick={() => setRevogando(l.id)}>
                            {t("Revogar")}
                          </Button>
                        )}
                      </>
                    ) : null}
                    {l.situacao === "vencido" ? (
                      <Button variant="secondary" className="min-h-11 lg:min-h-9" onClick={() => void agir(l, "renovar")}>
                        {t("Renovar por 90 dias")}
                      </Button>
                    ) : null}
                    {l.situacao === "revogado" && !l.painelId ? (
                      <Button variant="secondary" className="min-h-11 lg:min-h-9" onClick={() => criarOutroIgual(l)}>
                        {t("Criar outro igual")}
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </section>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle>{t("O que o link garante")}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            <li>{t("Mostra só números somados. Nome, telefone e conversa de cliente não saem, nem o nome de quem é da equipe.")}</li>
            <li>{t("Quem tem o endereço vê; por isso ele tem validade e pode ser revogado na hora. Revogado não volta.")}</li>
            <li>{t("Custo do agente e gasto com anúncio não aparecem: essa conta é da plataforma.")}</li>
            <li>{t("Cada abertura fica registrada (quando e quantas vezes), sem identificar a pessoa.")}</li>
            <li>{t("A página leva o nome da sua empresa.")}</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
