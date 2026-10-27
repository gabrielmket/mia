"use client";

/**
 * FORK MIA (item 9) — o editor do montador (protótipo, tela 3): configuração à
 * esquerda, prévia ao vivo à direita.
 *
 * As regras automáticas (o funil da etapa, o motivo de perda, quem não vê
 * valor, a visualização que não combina) são as de `lib/relatorios/config.ts`,
 * as mesmas da rota. A conta é do banco: a cada mudança (300 ms depois) e a
 * cada 5 minutos a prévia pede `POST /api/v1/relatorios/calcular`.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AdicionarAoPainel } from "@/components/relatorios/AdicionarAoPainel";
import { calcular, alterar, criar, mensagemDoErro, type Calculado } from "@/components/relatorios/api";
import { ExportarPlanilha } from "@/components/relatorios/ExportarPlanilha";
import { FiltroDoRelatorio } from "@/components/relatorios/FiltroDoRelatorio";
import { GraficoDoRelatorio, type AlvoDoClique } from "@/components/relatorios/Grafico";
import { ListaPorTras, type ListaAberta } from "@/components/relatorios/ListaPorTras";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { formatarValor, modeloDoGrafico, rotuloDaMedida, variacao } from "@/lib/relatorios/apresentar";
import {
  ATUALIZAR_A_CADA_MS,
  DIMENSOES_DO_MONTADOR,
  FONTES_DO_MONTADOR,
  MEDIDAS_DO_MONTADOR,
  PERIODOS_DO_MONTADOR,
  ROTULO_DA_VISUALIZACAO,
  ROTULO_DO_PERIODO_DO_MONTADOR,
  VISUALIZACOES,
  dimensoesDaFonte,
  filtrosDaFonte,
  medidasDaFonte,
  rotuloDaDimensao,
  type Dimensao,
  type MedidaDoMontador,
  type PeriodoDoMontador,
  type Visualizacao,
} from "@/lib/relatorios/catalogo";
import { chaveDoMotivo, MOTIVOS_DA_VISUALIZACAO, normalizarConfig, visualizacaoQueVale, type ConfigDoRelatorio } from "@/lib/relatorios/config";
import { fraseDoAnterior, fraseDoRelatorio } from "@/lib/relatorios/frases";

export interface InicioDoEditor {
  origem: "novo" | "pronto" | "meu" | "alheio";
  relatorioId: string | null;
  pronto: string | null;
  nome: string;
  config: ConfigDoRelatorio;
  compartilhado: boolean;
  meu: boolean;
}

interface Props {
  inicio: InicioDoEditor;
  funis: Array<{ id: string; nome: string }>;
  funilPadrao: { id: string; nome: string } | null;
  permissoes: { compartilhar: boolean; exportar: boolean; anuncios: boolean; valores: boolean };
}

const CAMPO =
  "min-h-11 w-full rounded-sm border border-border bg-bg px-3 text-base lg:min-h-9 lg:text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500";

function Secao({ titulo, children }: { titulo?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-border pb-4 last:border-b-0">
      {titulo ? <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{titulo}</h2> : null}
      {children}
    </section>
  );
}

export function EditorDeRelatorio({ inicio, funis, funilPadrao, permissoes }: Props) {
  const t = useT();
  const tag = useTagDeIdioma();
  const router = useRouter();
  const [origem, setOrigem] = useState(inicio.origem);
  const [relatorioId, setRelatorioId] = useState(inicio.relatorioId);
  const [nome, setNome] = useState(inicio.nome);
  const [compartilhado, setCompartilhado] = useState(inicio.compartilhado);
  const [bruta, setBruta] = useState<ConfigDoRelatorio>(inicio.config);
  const [calc, setCalc] = useState<Calculado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [lista, setLista] = useState<ListaAberta | null>(null);
  const [exportar, setExportar] = useState<{ grupo: ListaAberta | null } | null>(null);
  const [painel, setPainel] = useState(false);
  const [rotulosDosFiltros, setRotulosDosFiltros] = useState<Record<string, Record<string, string>>>({
    funil: Object.fromEntries(funis.map((f) => [f.id, f.nome])),
  });
  const avisosVistos = useRef(new Set<string>());

  const contexto = useMemo(() => ({ valores: permissoes.valores, funilPadrao }), [permissoes.valores, funilPadrao]);
  const { config, avisos } = useMemo(() => normalizarConfig(bruta, contexto), [bruta, contexto]);

  useEffect(() => {
    for (const a of avisos) {
      const chave = a.texto + (a.dado ?? "");
      if (avisosVistos.current.has(chave)) continue;
      avisosVistos.current.add(chave);
      toast.info(a.dado ? `${t(a.texto)} (${a.dado})` : t(a.texto));
    }
  }, [avisos, t]);

  const pedir = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setCalc(await calcular(config));
    } catch (e) {
      setErro(mensagemDoErro(e, t));
    } finally {
      setCarregando(false);
    }
  }, [config, t]);

  useEffect(() => {
    const espera = setTimeout(() => void pedir(), 300);
    return () => clearTimeout(espera);
  }, [pedir]);

  useEffect(() => {
    const relogio = setInterval(() => void pedir(), ATUALIZAR_A_CADA_MS);
    return () => clearInterval(relogio);
  }, [pedir]);

  const modelo = useMemo(() => (calc ? modeloDoGrafico(calc.resposta, config.medida, calc.nomes) : null), [calc, config.medida]);
  const vis = visualizacaoQueVale(config, calc?.resposta ?? null);
  const motivos = VISUALIZACOES.map((v) => [v, chaveDoMotivo(config, v, calc?.resposta ?? null)] as const).filter(([, m]) => m);
  const fonte = FONTES_DO_MONTADOR[config.fonte];
  const medida = MEDIDAS_DO_MONTADOR[config.medida];
  const f = { t, tag, moeda: modelo?.moeda ?? "BRL" };

  function mudar(parte: Partial<ConfigDoRelatorio>) {
    setBruta((c) => ({ ...normalizarConfig(c, contexto).config, ...parte }));
  }
  function mudarFiltro(chave: string, valor: string[] | string | null) {
    setBruta((c) => {
      const base = normalizarConfig(c, contexto).config;
      const filtros = { ...base.filtros };
      if (valor === null) delete filtros[chave];
      else filtros[chave] = valor;
      return { ...base, filtros };
    });
  }
  const rotuloDoFiltro = useCallback(
    (k: string, v: string) => rotulosDosFiltros[k]?.[v] ?? (v === "__sem" ? t("nenhum") : v),
    [rotulosDosFiltros, t],
  );

  const alheio = origem === "alheio";
  const vaiSerCopia = origem === "pronto" || alheio;

  /** Salva (ou salva a cópia) e devolve o id. */
  async function salvar(silencioso = false): Promise<string | null> {
    setSalvando(true);
    try {
      if (origem === "meu" && relatorioId) {
        await alterar(relatorioId, { nome: nome.trim() || inicio.nome, config, compartilhado });
        if (!silencioso) toast.success(t("Relatório salvo."));
        router.refresh();
        return relatorioId;
      }
      const nomeDaCopia = vaiSerCopia && nome.trim() === inicio.nome ? `${t("Cópia de")} ${inicio.nome}` : nome.trim() || inicio.nome;
      const novo = await criar({
        nome: nomeDaCopia.slice(0, 80),
        config,
        pronto_de: origem === "pronto" ? inicio.pronto : null,
        copiado_de: alheio ? relatorioId : null,
      });
      setOrigem("meu");
      setRelatorioId(novo.id);
      setNome(novo.nome);
      setCompartilhado(false);
      if (!silencioso) {
        toast.success(
          origem === "pronto"
            ? t("Salvo em Meus relatórios. O pronto continua igual.")
            : alheio
              ? t("Salvo como cópia sua. O original não muda.")
              : t("Salvo em Meus relatórios."),
        );
      }
      router.replace(`/app/relatorios/editor?id=${novo.id}`);
      return novo.id;
    } catch (e) {
      toast.error(mensagemDoErro(e, t));
      return null;
    } finally {
      setSalvando(false);
    }
  }

  async function garantirSalvo() {
    if (origem === "pronto" && inicio.pronto && JSON.stringify(config) === JSON.stringify(normalizarConfig(inicio.config, contexto).config)) {
      return { relatorioId: null, pronto: inicio.pronto };
    }
    const id = origem === "meu" && relatorioId ? relatorioId : await salvar(true);
    return id ? { relatorioId: id, pronto: null } : null;
  }

  function clicar(alvo: AlvoDoClique) {
    setLista({
      chave1: alvo.chave1,
      chave2: alvo.chave2,
      funil: alvo.funil,
      dobrados1: alvo.chave1 === "__outros" ? (modelo?.dobrados ?? []) : null,
      dobrados2: alvo.chave2 === "__outros" ? (modelo?.seriesDobradas ?? []) : null,
      rotulo: alvo.rotulo,
    });
  }

  // As notas da prévia (as do protótipo).
  const notas: string[] = [];
  if (config.fonte === "negocios" && config.medida === "soma") {
    if (config.filtros.situacao !== "ganho") notas.push(t('A meta do mês aparece quando a situação é "ganho".'));
    else if (!(config.dim1 && DIMENSOES_DO_MONTADOR[config.dim1].tempo) && vis !== "numero") {
      notas.push(t("A linha da meta aparece agrupando por mês, semana ou dia, ou no número grande."));
    }
  }
  if (modelo && modelo.dobrados.length > 0 && vis !== "numero") {
    notas.push(`${modelo.dobrados.length} ${t('grupos menores estão em "Outros". Clique em "Outros" para ver a lista.')}`);
  }
  if (modelo && config.dim1 && DIMENSOES_DO_MONTADOR[config.dim1].tempo && modelo.grupos.length > 31 && vis !== "numero") {
    notas.push(`${modelo.grupos.length} ${t("pontos no período: o gráfico rola de lado.")}`);
  }
  if (config.comparar && modelo?.series && (vis === "barras" || vis === "linha")) {
    notas.push(t("Com segundo agrupamento, a comparação aparece no total, acima."));
  }
  if (modelo && modelo.foraDaMoeda > 0) {
    notas.push(`${modelo.foraDaMoeda} ${t("negócios em outra moeda ficaram fora da soma.")}`);
  }

  const delta = modelo?.anterior ? variacao(modelo.total.valor, modelo.anterior.valor, modelo.formato, f) : null;
  const dica: Record<Visualizacao, string> = {
    numero: "Clique no número",
    tabela: "Clique num valor",
    rosca: "Clique numa fatia ou na legenda",
    funil: "Clique numa etapa",
    linha: "Clique num ponto",
    barras: "Clique numa barra",
  };
  const segundos = calc ? new Date(calc.calculadoEm).toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" }) : "";
  const medidas = medidasDaFonte(config.fonte);
  const dims = dimensoesDaFonte(config.fonte);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <nav aria-label={t("Caminho")} className="text-sm text-text-muted">
        <Link href="/app/relatorios" className="inline-flex min-h-11 items-center hover:underline lg:min-h-0">
          {t("Relatórios")}
        </Link>{" "}
        / {t("Editor de relatório")}
      </nav>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
        {/* ── configuração ── */}
        <section aria-label={t("Configuração do relatório")} className="flex min-w-0 flex-col gap-4 rounded-md border border-border bg-surface p-4">
          <Secao>
            {origem === "pronto" ? (
              <p className="rounded-sm bg-info-bg px-3 py-2 text-sm text-info-fg">
                <b>{t("Relatório pronto.")}</b> {t("Mexa à vontade: ao salvar, vira uma cópia sua em Meus relatórios. O original não muda.")}
              </p>
            ) : null}
            {alheio ? (
              <p className="rounded-sm bg-info-bg px-3 py-2 text-sm text-info-fg">
                <b>{t("Compartilhado por outra pessoa.")}</b> {t("Você pode mexer para olhar, mas salva como cópia sua.")}
              </p>
            ) : null}
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("Nome do relatório")}</span>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} />
            </label>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-text-muted">{t("Fonte")}</span>
              <b>{t(fonte.nome)}</b>
              {fonte.sub ? <span className="text-text-muted">({t(fonte.sub)})</span> : null}
              <Link href="/app/relatorios/novo" className="inline-flex min-h-11 items-center text-accent hover:underline lg:min-h-0">
                {t("Trocar")}
              </Link>
            </div>
          </Secao>

          <Secao titulo={t("O que medir")}>
            <label className="flex flex-col gap-1 text-sm">
              <span className="sr-only">{t("Medida")}</span>
              <select
                className={CAMPO}
                value={config.medida}
                onChange={(e) => mudar({ medida: e.target.value as MedidaDoMontador })}
                // FORK MIA (.93): marcador do "Me mostra como" (lib/assistente/trilhas/catalogo.ts).
                data-testid="medida-do-relatorio"
              >
                {medidas.map((m) => (
                  <option key={m} value={m} disabled={MEDIDAS_DO_MONTADOR[m].valor && !permissoes.valores}>
                    {rotuloDaMedida(m, config.fonte, t)}
                    {MEDIDAS_DO_MONTADOR[m].valor && !permissoes.valores ? ` (${t("sem acesso a valores")})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </Secao>

          <Secao titulo={t("Agrupar")}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{t("Agrupar por")}</span>
                <select className={CAMPO} value={config.dim1 ?? ""} onChange={(e) => mudar({ dim1: e.target.value as Dimensao })}>
                  {dims.map((d) => (
                    <option key={d} value={d}>
                      {t(rotuloDaDimensao(config.fonte, d))}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{t("Segundo agrupamento")}</span>
                <select
                  className={CAMPO}
                  value={config.dim2 ?? ""}
                  onChange={(e) => mudar({ dim2: (e.target.value || null) as Dimensao | null })}
                >
                  <option value="">{t("Nenhum")}</option>
                  {dims
                    .filter((d) => d !== config.dim1 && !DIMENSOES_DO_MONTADOR[d].tempo)
                    .map((d) => (
                      <option key={d} value={d}>
                        {t(rotuloDaDimensao(config.fonte, d))}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {config.dim2 ? (
              <p className="text-xs text-text-muted">
                {medida.aditiva ? t("Vira barra empilhada: cada grupo dividido pelo segundo agrupamento.") : t("Média, taxa e tempo não se somam: as barras ficam lado a lado.")}
              </p>
            ) : null}
          </Secao>

          <Secao titulo={t("Filtros")}>
            <div role="group" aria-label={t("Período")} className="flex flex-wrap gap-2">
              {PERIODOS_DO_MONTADOR.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={config.periodo === p}
                  onClick={() => {
                    if (p === "pers") {
                      const hoje = new Date();
                      const ate = calc?.resposta.janela.ate ?? hoje.toISOString().slice(0, 10);
                      const de = calc?.resposta.janela.de ?? ate;
                      mudar({ periodo: p, de: config.de ?? de, ate: config.ate ?? ate });
                    } else mudar({ periodo: p as PeriodoDoMontador });
                  }}
                  className={`inline-flex min-h-11 items-center rounded-full border px-3 text-base lg:min-h-8 lg:text-sm ${config.periodo === p ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-surface-elevated"}`}
                >
                  {t(ROTULO_DO_PERIODO_DO_MONTADOR[p])}
                </button>
              ))}
            </div>
            {config.periodo === "pers" ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{t("De")}</span>
                  <Input type="date" value={config.de ?? ""} onChange={(e) => e.target.value && mudar({ de: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{t("Até")}</span>
                  <Input type="date" value={config.ate ?? ""} onChange={(e) => e.target.value && mudar({ ate: e.target.value })} />
                </label>
              </div>
            ) : null}
            <p className="text-xs text-text-muted">{t(fonte.regraDeData)}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {filtrosDaFonte(config.fonte).map((k) => (
                <FiltroDoRelatorio
                  key={k}
                  config={config}
                  filtro={k}
                  rotulo={t(rotuloDaDimensao(config.fonte, k))}
                  valor={config.filtros[k]}
                  desligado={k === "situacao" && medida.ignoraSituacao ? t("Esta medida já escolhe a situação sozinha.") : null}
                  onMudar={(v) => mudarFiltro(k, v)}
                  onRotulos={(filtro, r) => setRotulosDosFiltros((x) => ({ ...x, [filtro]: { ...x[filtro], ...r } }))}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-2" aria-label={t("Filtros ativos")}>
              {Object.entries(config.filtros)
                .filter(([k]) => k !== "so_receita" && !(k === "situacao" && medida.ignoraSituacao))
                .map(([k, v]) => {
                  const texto = `${t(rotuloDaDimensao(config.fonte, k as Dimensao))}: ${(Array.isArray(v) ? v : [String(v)]).map((x) => rotuloDoFiltro(k, x)).join(", ")}`;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => mudarFiltro(k, null)}
                      aria-label={`${t("Tirar o filtro")} ${texto}`}
                      className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-full bg-accent-soft px-3 text-base text-accent lg:min-h-7 lg:text-xs"
                    >
                      <span className="truncate">{texto}</span> ×
                    </button>
                  );
                })}
            </div>
          </Secao>

          <Secao>
            <label className="flex min-h-11 items-center gap-3 lg:min-h-0">
              <Switch checked={config.comparar} onCheckedChange={(v) => mudar({ comparar: v })} />
              <span className="flex flex-col">
                <b className="text-sm">{t("Comparar com o período anterior")}</b>
                <small className="text-text-muted">
                  {config.comparar
                    ? `${t("Contra")} ${fraseDoAnterior(calc?.resposta.anterior?.janela, t) || t("o período anterior")}`
                    : t("Desligado")}
                </small>
              </span>
            </label>
          </Secao>

          <Secao titulo={t("Visualização")}>
            <div role="group" aria-label={t("Visualização")} className="grid grid-cols-3 gap-2">
              {VISUALIZACOES.map((v) => {
                const motivo = chaveDoMotivo(config, v, calc?.resposta ?? null);
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={vis === v}
                    disabled={Boolean(motivo)}
                    title={motivo ? t(MOTIVOS_DA_VISUALIZACAO[motivo]) : t(ROTULO_DA_VISUALIZACAO[v])}
                    onClick={() => mudar({ visualizacao: v })}
                    className={`min-h-11 rounded-sm border px-2 text-base lg:min-h-9 lg:text-sm ${vis === v ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-surface-elevated"} disabled:opacity-40`}
                  >
                    {t(ROTULO_DA_VISUALIZACAO[v])}
                  </button>
                );
              })}
            </div>
            {motivos.length > 0 ? (
              <ul className="flex flex-col gap-1 text-xs text-text-muted">
                {motivos.map(([v, m]) => (
                  <li key={v}>
                    <b>{t(ROTULO_DA_VISUALIZACAO[v])}:</b> {m ? t(MOTIVOS_DA_VISUALIZACAO[m]) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </Secao>

          <Secao>
            {origem === "meu" && permissoes.compartilhar ? (
              <label className="flex min-h-11 items-center gap-3 lg:min-h-0">
                <Switch checked={compartilhado} onCheckedChange={setCompartilhado} />
                <span className="text-sm">{t("Compartilhar com a equipe")}</span>
              </label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void salvar()}
                disabled={salvando}
                // FORK MIA (.93): marcador do "Me mostra como" (lib/assistente/trilhas/catalogo.ts).
                data-testid="salvar-relatorio"
              >
                {vaiSerCopia ? t("Salvar como cópia") : t("Salvar")}
              </Button>
              <Button variant="secondary" onClick={() => setPainel(true)}>
                {t("Adicionar a um painel")}
              </Button>
              <Button variant="ghost" onClick={() => setExportar({ grupo: null })}>
                {t("Exportar planilha")}
              </Button>
            </div>
          </Secao>
        </section>

        {/* ── prévia ── */}
        <section aria-label={t("Prévia")} className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-surface p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{t("Prévia · muda na hora")}</p>
              <h1 className="text-xl font-semibold">{nome || t("Sem nome")}</h1>
              <p className="text-sm text-text-muted">{fraseDoRelatorio({ ...config, visualizacao: vis }, calc?.resposta.janela ?? null, t, rotuloDoFiltro)}</p>
            </div>
            {vis !== "numero" && modelo ? (
              <div className="flex shrink-0 flex-col items-start sm:items-end">
                <span className="text-xs text-text-muted">{medida.aditiva ? t("Total") : t("Geral")}</span>
                <b className="text-2xl tabular-nums">{formatarValor(modelo.formato, modelo.total.valor, f)}</b>
                {delta ? (
                  <span className={`text-xs ${delta.sobe !== medida.menor ? "text-success-fg" : "text-error-fg"}`}>
                    {delta.sobe ? "▲" : "▼"} {delta.texto} <span className="text-text-muted">{t("contra")} {fraseDoAnterior(modelo.anterior, t)}</span>
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          {notas.map((n) => (
            <p key={n} className="rounded-sm bg-surface-elevated px-3 py-2 text-xs text-text-muted">
              {n}
            </p>
          ))}

          {erro ? <p className="rounded-sm bg-error-bg px-3 py-2 text-sm text-error-fg">{erro}</p> : null}
          {modelo ? (
            <div className={carregando ? "opacity-60 transition-opacity" : ""}>
              <GraficoDoRelatorio modelo={modelo} vis={vis} onClicar={clicar} />
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-text-muted">{carregando ? t("Calculando no banco…") : ""}</p>
          )}

          <p className="text-xs text-text-muted">
            <b>{t(dica[vis])}</b> {t("para ver o que está por trás do número.")}
          </p>
          {calc ? (
            <p className="text-xs text-text-muted">
              {t("Conta feita no banco com")} {new Intl.NumberFormat(tag).format(calc.resposta.total.n)}{" "}
              {t(calc.resposta.total.n === 1 ? fonte.um : fonte.varios)} {t("do período")} · {t("atualizado às")} {segundos} ·{" "}
              {t("recalcula ao abrir e a cada 5 minutos")}
            </p>
          ) : null}
        </section>
      </div>

      <ListaPorTras
        aberta={lista}
        onFechar={() => setLista(null)}
        config={config}
        podeExportar={permissoes.exportar}
        onExportar={(g) => {
          setLista(null);
          setExportar({ grupo: g });
        }}
      />
      <ExportarPlanilha
        aberto={exportar !== null}
        onFechar={() => setExportar(null)}
        modelo={modelo}
        config={config}
        nome={nome || inicio.nome}
        relatorioId={origem === "meu" ? relatorioId : null}
        pronto={origem === "pronto" ? inicio.pronto : null}
        podeExportar={permissoes.exportar}
        grupoInicial={exportar?.grupo ?? null}
      />
      <AdicionarAoPainel aberto={painel} onFechar={() => setPainel(false)} garantirSalvo={garantirSalvo} />
    </div>
  );
}
