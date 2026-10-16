"use client";

/**
 * FORK MIA (item 9) — O GRÁFICO DO MONTADOR: barras, linha, rosca, número
 * grande, funil e tabela, desenhados a partir do modelo que
 * `lib/relatorios/apresentar.ts` monta sobre a resposta do motor.
 *
 * Desenho à mão, em SVG, como o protótipo aprovado em 15/10/2026 (tela 3):
 * "Sem …" em cinza e "Outros" em cinza mais claro, nunca da cor dos grupos; o
 * período anterior como barra fantasma ao lado; a meta como traço por pedaço
 * de tempo (o alvo do mês, e semana e dia proporcionais); agrupando por tempo
 * com muitos pontos, o gráfico rola de lado em vez de espremer.
 *
 * Nenhuma conta aqui: o número já vem somado do banco. Clicar numa barra,
 * fatia, ponto, etapa ou célula chama `onClicar` com a chave do grupo (e da
 * série), e a tela abre a lista por trás do número. Todo alvo de clique é
 * focável e responde a Enter e espaço.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { CHAVE_TUDO } from "@/lib/paineis/catalogo";
import {
  formatarValor,
  textoDoRotulo,
  variacao,
  type Formato,
  type GrupoDesenhado,
  type ModeloDoGrafico,
  type SerieDesenhada,
} from "@/lib/relatorios/apresentar";
import { MEDIDAS_DO_MONTADOR, type Visualizacao } from "@/lib/relatorios/catalogo";

export interface AlvoDoClique {
  chave1: string | null;
  chave2: string | null;
  funil: boolean;
  /** O nome do que foi clicado, para o título da lista. */
  rotulo: string;
}

interface Props {
  modelo: ModeloDoGrafico;
  vis: Visualizacao;
  altura?: number;
  /** Cartão de painel: menos rótulo, menos margem. */
  compacto?: boolean;
  onClicar?: (alvo: AlvoDoClique) => void;
}

const PALETA = [
  "var(--color-accent-600)",
  "var(--color-info)",
  "var(--color-warning)",
  "var(--color-success)",
  "var(--color-error)",
  "var(--color-accent-300)",
  "var(--color-info-fg)",
  "var(--color-warning-fg)",
];
const COR_SEM = "var(--color-text-subtle)";
const COR_OUTROS = "var(--color-border-strong)";
const COR_ANTERIOR = "var(--color-border-strong)";
const COR_META = "var(--color-warning-fg)";
const COR_GRADE = "var(--color-border)";
const COR_TEXTO = "var(--color-text-muted)";

function corDoGrupo(g: { sem: boolean; outros: boolean }, i: number, umaCor: boolean): string {
  if (g.sem) return COR_SEM;
  if (g.outros) return COR_OUTROS;
  return umaCor ? "var(--color-accent-600)" : (PALETA[i % PALETA.length] ?? PALETA[0]!);
}

function coresDasSeries(series: readonly SerieDesenhada[]): Record<string, string> {
  const cores: Record<string, string> = {};
  let i = 0;
  for (const s of series) {
    cores[s.chave] = s.sem ? COR_SEM : s.outros ? COR_OUTROS : (PALETA[i++ % PALETA.length] ?? PALETA[0]!);
  }
  return cores;
}

function passoBonito(x: number): number {
  const e = 10 ** Math.floor(Math.log10(x));
  const f = x / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}

/** Topo e marcas do eixo, "bonitos" (1, 2, 2,5, 5 × 10ⁿ). */
export function escala(max: number, formato: string): { topo: number; marcas: number[] } {
  let m = max > 0 ? max : formato === "%" ? 100 : formato === "r" ? 100_000 : 4;
  if (formato !== "%") m *= 1.04;
  let passo = passoBonito(m / 4);
  if (formato === "n" && passo < 1) passo = 1;
  if (formato === "n" && passo % 1) passo = Math.ceil(passo);
  let topo = Math.ceil(m / passo - 1e-9) * passo;
  if (formato === "%" && max <= 100 && topo > 100) topo = 100;
  const marcas: number[] = [];
  for (let v = 0; v <= topo + 1e-9; v += passo) marcas.push(v);
  return { topo, marcas };
}

function corta(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s;
}

function useLargura(padrao: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [largura, setLargura] = useState(padrao);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entradas) => {
      const w = entradas[0]?.contentRect.width;
      if (w && Math.abs(w - largura) > 1) setLargura(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [largura]);
  return [ref, largura];
}

/** Os atributos de um alvo clicável e focável. */
function clicavel(alvo: AlvoDoClique, rotulo: string, onClicar?: (a: AlvoDoClique) => void) {
  if (!onClicar) return {};
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": rotulo,
    style: { cursor: "pointer" },
    onClick: () => onClicar(alvo),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClicar(alvo);
      }
    },
  };
}

export function GraficoDoRelatorio({ modelo, vis, altura, compacto = false, onClicar }: Props) {
  const t = useT();
  const tag = useTagDeIdioma();
  const f: Formato = { t, tag, moeda: modelo.moeda };
  const [ref, largura] = useLargura(compacto ? 320 : 640);
  const fmt = (v: number | null, curto = false) => formatarValor(modelo.formato, v, f, curto);
  const nomeDoGrupo = (g: GrupoDesenhado) => textoDoRotulo(g.rotulo, t, g.quantos);

  let corpo: ReactNode;
  if (vis === "numero") corpo = <Numero modelo={modelo} f={f} compacto={compacto} onClicar={onClicar} />;
  else if (vis === "funil") corpo = <Funil modelo={modelo} fmt={fmt} nome={nomeDoGrupo} onClicar={onClicar} t={t} />;
  else if (vis === "tabela") corpo = <Tabela modelo={modelo} f={f} nome={nomeDoGrupo} onClicar={onClicar} />;
  else if (vis === "rosca") corpo = <Rosca modelo={modelo} fmt={fmt} nome={nomeDoGrupo} onClicar={onClicar} t={t} compacto={compacto} />;
  else if (modelo.dim1 && ["mes", "semana", "dia"].includes(modelo.dim1)) {
    corpo =
      vis === "linha" ? (
        <Linha modelo={modelo} largura={largura} altura={altura ?? (compacto ? 180 : 260)} fmt={fmt} nome={nomeDoGrupo} onClicar={onClicar} t={t} />
      ) : (
        <Colunas modelo={modelo} largura={largura} altura={altura ?? (compacto ? 180 : 260)} fmt={fmt} nome={nomeDoGrupo} onClicar={onClicar} t={t} compacto={compacto} />
      );
  } else {
    corpo = <Barras modelo={modelo} largura={largura} fmt={fmt} nome={nomeDoGrupo} onClicar={onClicar} t={t} compacto={compacto} />;
  }
  return (
    <div ref={ref} className="w-full min-w-0">
      {corpo}
    </div>
  );
}

// ─── A legenda ──────────────────────────────────────────────────────────────

function Legenda({ itens }: { itens: Array<{ cor: string; texto: string; tracejado?: boolean }> }) {
  if (itens.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
      {itens.map((i) => (
        <li key={i.texto} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-3.5 rounded-sm"
            style={i.tracejado ? { borderTop: `2px dashed ${i.cor}`, height: 0 } : { background: i.cor }}
          />
          {i.texto}
        </li>
      ))}
    </ul>
  );
}

function legendaDe(modelo: ModeloDoGrafico, t: (s: string) => string, opcoes: { anterior: boolean; meta: boolean }) {
  const itens: Array<{ cor: string; texto: string; tracejado?: boolean }> = [];
  if (modelo.series) {
    const cores = coresDasSeries(modelo.series);
    for (const s of modelo.series) itens.push({ cor: cores[s.chave]!, texto: textoDoRotulo(s.rotulo, t, s.quantos) });
  }
  if (opcoes.anterior) itens.push({ cor: COR_ANTERIOR, texto: t("Período anterior") });
  if (opcoes.meta) itens.push({ cor: COR_META, texto: t("Meta"), tracejado: true });
  return itens;
}

// ─── Colunas: agrupamento por tempo ─────────────────────────────────────────

interface PropsDeDesenho {
  modelo: ModeloDoGrafico;
  fmt: (v: number | null, curto?: boolean) => string;
  nome: (g: GrupoDesenhado) => string;
  onClicar?: (a: AlvoDoClique) => void;
  t: (s: string) => string;
}

function maxDoModelo(modelo: ModeloDoGrafico, pilha: boolean, lado: boolean, comAnterior: boolean): number {
  let max = 0;
  for (const g of modelo.grupos) {
    if (pilha && modelo.series) {
      let s = 0;
      for (const sr of modelo.series) s += Math.max(0, g.series[sr.chave]?.valor ?? 0);
      max = Math.max(max, s);
    } else if (lado && modelo.series) {
      for (const sr of modelo.series) max = Math.max(max, g.series[sr.chave]?.valor ?? 0);
    } else if (g.valor !== null) max = Math.max(max, g.valor);
    if (comAnterior && g.anterior !== null) max = Math.max(max, g.anterior);
    if (g.meta !== null) max = Math.max(max, g.meta);
  }
  return max;
}

function Colunas({ modelo, largura, altura, fmt, nome, onClicar, t, compacto }: PropsDeDesenho & { largura: number; altura: number; compacto: boolean }) {
  const series = modelo.series;
  const aditiva = MEDIDAS_DO_MONTADOR[modelo.medida].aditiva;
  const pilha = Boolean(series) && aditiva;
  const lado = Boolean(series) && !aditiva;
  const comAnterior = !series && Boolean(modelo.anterior);
  const comMeta = modelo.grupos.some((g) => g.meta !== null);
  const E = escala(maxDoModelo(modelo, pilha, lado, comAnterior), modelo.formato);
  const rotulosY = E.marcas.map((v) => fmt(v, true));
  const mL = Math.ceil(Math.max(30, Math.max(...rotulosY.map((r) => r.length)) * 6.6 + 12));
  const mR = 8;
  const mT = 14;
  const mB = 24;
  const n = Math.max(1, modelo.grupos.length);
  const minBanda = lado && series ? Math.max(30, series.length * 9 + 10) : comAnterior ? 30 : 22;
  const W = Math.max(largura, Math.ceil(mL + mR + n * minBanda));
  const banda = (W - mL - mR) / n;
  const bw = lado ? banda * 0.8 : Math.min(banda * 0.62, 48);
  const y = (v: number) => mT + (altura - mT - mB) * (1 - v / E.topo);
  const base = y(0);
  const passoDoRotulo = Math.max(1, Math.ceil(44 / banda));
  const comValor = !series && !comAnterior && n <= 10 && !compacto;
  const cores = series ? coresDasSeries(series) : {};

  return (
    <div>
      <div className="overflow-x-auto">
        <svg width={W} height={altura} viewBox={`0 0 ${W} ${altura}`} role="group" aria-label={t("Gráfico de colunas")}>
          {E.marcas.map((v, i) => (
            <g key={`m${i}`}>
              <line x1={mL} x2={W - mR} y1={y(v)} y2={y(v)} stroke={COR_GRADE} strokeWidth={v === 0 ? 1.2 : 1} />
              <text x={mL - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill={COR_TEXTO}>
                {rotulosY[i]}
              </text>
            </g>
          ))}
          {modelo.grupos.map((g, i) => {
            const x0 = mL + i * banda;
            const xc = x0 + banda / 2;
            const bx = xc - bw / 2;
            const rotulo = nome(g);
            const partes: ReactNode[] = [];
            if (pilha && series) {
              let acc = 0;
              for (const sr of series) {
                const v = g.series[sr.chave]?.valor ?? 0;
                if (!(v > 0)) continue;
                const y1 = y(acc + v);
                const y0 = y(acc);
                const texto = `${rotulo} · ${textoDoRotulo(sr.rotulo, t, sr.quantos)}: ${fmt(v)}`;
                partes.push(
                  <rect key={sr.chave} x={bx} y={y1} width={bw} height={Math.max(0.5, y0 - y1)} fill={cores[sr.chave]} {...clicavel({ chave1: g.chave, chave2: sr.chave, funil: false, rotulo: texto }, texto, onClicar)}>
                    <title>{texto}</title>
                  </rect>,
                );
                acc += v;
              }
            } else if (lado && series) {
              const k = series.length;
              const sw = Math.max(2, (bw - (k - 1) * 2) / k);
              series.forEach((sr, j) => {
                const v = g.series[sr.chave]?.valor ?? 0;
                if (!(v > 0)) return;
                const y1 = y(v);
                const texto = `${rotulo} · ${textoDoRotulo(sr.rotulo, t, sr.quantos)}: ${fmt(v)}`;
                partes.push(
                  <rect key={sr.chave} x={bx + j * (sw + 2)} y={y1} width={sw} height={Math.max(0.5, base - y1)} rx={2} fill={cores[sr.chave]} {...clicavel({ chave1: g.chave, chave2: sr.chave, funil: false, rotulo: texto }, texto, onClicar)}>
                    <title>{texto}</title>
                  </rect>,
                );
              });
            } else {
              const texto = `${rotulo}: ${fmt(g.valor)}${comAnterior ? ` · ${t("Período anterior")}: ${fmt(g.anterior)}` : ""}`;
              if (comAnterior && g.anterior !== null && g.anterior > 0) {
                const ya = y(g.anterior);
                partes.push(<rect key="ant" x={bx} y={ya} width={bw * 0.4} height={Math.max(0.5, base - ya)} rx={2} fill={COR_ANTERIOR} opacity={0.7} />);
              }
              if (g.valor !== null && g.valor > 0) {
                const y1 = y(g.valor);
                const larg = comAnterior ? bw * 0.56 : bw;
                partes.push(
                  <rect key="v" x={comAnterior ? bx + bw - larg : bx} y={y1} width={larg} height={Math.max(0.5, base - y1)} rx={3} fill={corDoGrupo(g, 0, true)} {...clicavel({ chave1: g.chave, chave2: null, funil: false, rotulo: texto }, texto, onClicar)}>
                    <title>{texto}</title>
                  </rect>,
                );
                if (comValor) {
                  partes.push(
                    <text key="vl" x={xc} y={y1 - 5} textAnchor="middle" fontSize={11} fill={COR_TEXTO}>
                      {fmt(g.valor, true)}
                    </text>,
                  );
                }
              }
            }
            if (g.meta !== null) {
              const ym = y(g.meta);
              partes.push(
                <line key="meta" x1={x0 + 2} x2={x0 + banda - 2} y1={ym} y2={ym} stroke={COR_META} strokeWidth={2} strokeDasharray="5 3">
                  <title>{`${t("Meta")}: ${fmt(g.meta)}`}</title>
                </line>,
              );
            }
            return (
              <g key={g.chave}>
                {partes}
                {i % passoDoRotulo === 0 ? (
                  <text x={xc} y={altura - 7} textAnchor="middle" fontSize={11} fill={COR_TEXTO}>
                    {corta(rotulo, Math.max(3, Math.floor((banda * passoDoRotulo) / 6.6)))}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <Legenda itens={legendaDe(modelo, t, { anterior: comAnterior, meta: comMeta })} />
    </div>
  );
}

// ─── Barras deitadas: agrupamento por categoria ─────────────────────────────

function Barras({ modelo, largura, fmt, nome, onClicar, t, compacto }: PropsDeDesenho & { largura: number; compacto: boolean }) {
  const series = modelo.series;
  const aditiva = MEDIDAS_DO_MONTADOR[modelo.medida].aditiva;
  const pilha = Boolean(series) && aditiva;
  const lado = Boolean(series) && !aditiva;
  const comAnterior = !series && Boolean(modelo.anterior);
  const W = Math.max(largura, 280);
  const E = escala(maxDoModelo(modelo, pilha, lado, comAnterior), modelo.formato);
  const labW = Math.round(Math.min(170, Math.max(92, W * 0.32)));
  const valW = compacto ? 64 : 96;
  const linhaH = lado && series ? series.length * 9 + 14 : comAnterior ? 32 : 28;
  const mT = 4;
  const mB = 22;
  const n = modelo.grupos.length;
  const H = mT + Math.max(1, n) * linhaH + mB;
  const x0 = labW;
  const x1 = W - valW;
  const x = (v: number) => x0 + ((x1 - x0) * v) / E.topo;
  const pular = (x1 - x0) / Math.max(1, E.marcas.length - 1) < 48 ? 2 : 1;
  const chars = Math.floor((labW - 12) / 6.9);
  const cores = series ? coresDasSeries(series) : {};

  return (
    <div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={t("Gráfico de barras")}>
        {E.marcas.map((v, i) => (
          <g key={`m${i}`}>
            <line x1={x(v)} x2={x(v)} y1={mT} y2={H - mB} stroke={COR_GRADE} strokeWidth={v === 0 ? 1.2 : 1} />
            {i % pular === 0 ? (
              <text x={x(v)} y={H - 6} textAnchor="middle" fontSize={11} fill={COR_TEXTO}>
                {fmt(v, true)}
              </text>
            ) : null}
          </g>
        ))}
        {modelo.grupos.map((g, i) => {
          const yt = mT + i * linhaH;
          const rotulo = nome(g);
          const partes: ReactNode[] = [];
          let fim = x0;
          if (pilha && series) {
            let acc = 0;
            const by = yt + (linhaH - 16) / 2;
            for (const sr of series) {
              const v = g.series[sr.chave]?.valor ?? 0;
              if (!(v > 0)) continue;
              const xa = x(acc);
              const xb = x(acc + v);
              const texto = `${rotulo} · ${textoDoRotulo(sr.rotulo, t, sr.quantos)}: ${fmt(v)}`;
              partes.push(
                <rect key={sr.chave} x={xa} y={by} width={Math.max(0.5, xb - xa)} height={16} fill={cores[sr.chave]} {...clicavel({ chave1: g.chave, chave2: sr.chave, funil: false, rotulo: texto }, texto, onClicar)}>
                  <title>{texto}</title>
                </rect>,
              );
              acc += v;
            }
            fim = x(acc);
          } else if (lado && series) {
            series.forEach((sr, j) => {
              const v = g.series[sr.chave]?.valor ?? 0;
              if (!(v > 0)) return;
              const by = yt + 7 + j * 9;
              const texto = `${rotulo} · ${textoDoRotulo(sr.rotulo, t, sr.quantos)}: ${fmt(v)}`;
              partes.push(
                <rect key={sr.chave} x={x0} y={by} width={Math.max(0.5, x(v) - x0)} height={7} rx={2} fill={cores[sr.chave]} {...clicavel({ chave1: g.chave, chave2: sr.chave, funil: false, rotulo: texto }, texto, onClicar)}>
                  <title>{texto}</title>
                </rect>,
              );
              fim = Math.max(fim, x(v));
            });
          } else {
            const cor = corDoGrupo(g, 0, true);
            if (comAnterior && g.anterior !== null && g.anterior > 0) {
              partes.push(<rect key="ant" x={x0} y={yt + 4} width={Math.max(0.5, x(g.anterior) - x0)} height={8} rx={2} fill={COR_ANTERIOR} opacity={0.7} />);
            }
            if (g.valor !== null && g.valor > 0) {
              const by = comAnterior ? yt + 14 : yt + (linhaH - 16) / 2;
              const texto = `${rotulo}: ${fmt(g.valor)}${comAnterior ? ` · ${t("Período anterior")}: ${fmt(g.anterior)}` : ""}`;
              partes.push(
                <rect key="v" x={x0} y={by} width={Math.max(0.5, x(g.valor) - x0)} height={comAnterior ? 12 : 16} rx={3} fill={cor}>
                  <title>{texto}</title>
                </rect>,
              );
              fim = x(g.valor);
            }
          }
          const totalDaLinha = g.valor;
          const textoLinha = `${rotulo}: ${fmt(totalDaLinha)}`;
          return (
            <g key={g.chave}>
              <rect
                x={0}
                y={yt}
                width={W}
                height={linhaH}
                fill="transparent"
                {...(pilha || lado ? {} : clicavel({ chave1: g.chave, chave2: null, funil: false, rotulo: textoLinha }, textoLinha, onClicar))}
              >
                <title>{textoLinha}</title>
              </rect>
              <text x={labW - 8} y={yt + linhaH / 2 + 4} textAnchor="end" fontSize={12} fill={g.sem || g.outros ? COR_TEXTO : "var(--color-text)"} style={{ pointerEvents: "none" }}>
                {corta(rotulo, chars)}
              </text>
              <g style={{ pointerEvents: pilha || lado ? "auto" : "none" }}>{partes}</g>
              <text x={Math.min(fim + 6, W - valW + 4)} y={yt + linhaH / 2 + 4} fontSize={12} fill={COR_TEXTO} style={{ pointerEvents: "none" }}>
                {fmt(totalDaLinha, compacto)}
              </text>
            </g>
          );
        })}
      </svg>
      <Legenda itens={legendaDe(modelo, t, { anterior: comAnterior, meta: false })} />
    </div>
  );
}

// ─── Linha: evolução no tempo ───────────────────────────────────────────────

function Linha({ modelo, largura, altura, fmt, nome, onClicar, t }: PropsDeDesenho & { largura: number; altura: number }) {
  const series = modelo.series;
  const comAnterior = !series && Boolean(modelo.anterior);
  const comMeta = modelo.grupos.some((g) => g.meta !== null);
  const E = escala(maxDoModelo(modelo, false, Boolean(series), comAnterior), modelo.formato);
  const rotulosY = E.marcas.map((v) => fmt(v, true));
  const mL = Math.ceil(Math.max(30, Math.max(...rotulosY.map((r) => r.length)) * 6.6 + 12));
  const mR = 12;
  const mT = 14;
  const mB = 24;
  const n = Math.max(1, modelo.grupos.length);
  const W = Math.max(largura, Math.ceil(mL + mR + n * 18));
  const passo = (W - mL - mR) / n;
  const xc = (i: number) => mL + passo * i + passo / 2;
  const y = (v: number) => mT + (altura - mT - mB) * (1 - v / E.topo);
  const passoDoRotulo = Math.max(1, Math.ceil(44 / passo));
  const cores = series ? coresDasSeries(series) : {};

  const caminho = (valores: Array<number | null>) => {
    let d = "";
    let caneta = false;
    valores.forEach((v, i) => {
      if (v === null) {
        caneta = false;
        return;
      }
      d += `${caneta ? "L" : "M"}${xc(i).toFixed(1)},${y(v).toFixed(1)}`;
      caneta = true;
    });
    return d;
  };

  const linhas: Array<{ chave: string | null; cor: string; valores: Array<number | null>; rotulo: string }> = series
    ? series.map((s) => ({
        chave: s.chave,
        cor: cores[s.chave]!,
        valores: modelo.grupos.map((g) => g.series[s.chave]?.valor ?? null),
        rotulo: textoDoRotulo(s.rotulo, t, s.quantos),
      }))
    : [{ chave: null, cor: "var(--color-accent-600)", valores: modelo.grupos.map((g) => g.valor), rotulo: "" }];

  return (
    <div>
      <div className="overflow-x-auto">
        <svg width={W} height={altura} viewBox={`0 0 ${W} ${altura}`} role="group" aria-label={t("Gráfico de linha")}>
          {E.marcas.map((v, i) => (
            <g key={`m${i}`}>
              <line x1={mL} x2={W - mR} y1={y(v)} y2={y(v)} stroke={COR_GRADE} strokeWidth={v === 0 ? 1.2 : 1} />
              <text x={mL - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill={COR_TEXTO}>
                {rotulosY[i]}
              </text>
            </g>
          ))}
          {comMeta
            ? modelo.grupos.map((g, i) =>
                g.meta === null ? null : (
                  <line key={`meta${g.chave}`} x1={xc(i) - passo / 2 + 2} x2={xc(i) + passo / 2 - 2} y1={y(g.meta)} y2={y(g.meta)} stroke={COR_META} strokeWidth={2} strokeDasharray="5 3">
                    <title>{`${t("Meta")}: ${fmt(g.meta)}`}</title>
                  </line>
                ),
              )
            : null}
          {comAnterior ? (
            <path d={caminho(modelo.grupos.map((g) => g.anterior))} fill="none" stroke={COR_ANTERIOR} strokeWidth={2} strokeDasharray="4 4" />
          ) : null}
          {linhas.map((l) => (
            <g key={l.chave ?? "total"}>
              <path d={caminho(l.valores)} fill="none" stroke={l.cor} strokeWidth={2.2} strokeLinejoin="round" />
              {l.valores.map((v, i) => {
                if (v === null) return null;
                const g = modelo.grupos[i]!;
                const texto = `${nome(g)}${l.rotulo ? ` · ${l.rotulo}` : ""}: ${fmt(v)}`;
                return (
                  <circle key={g.chave} cx={xc(i)} cy={y(v)} r={4} fill={l.cor} stroke="var(--color-surface)" strokeWidth={1.5} {...clicavel({ chave1: g.chave, chave2: l.chave, funil: false, rotulo: texto }, texto, onClicar)}>
                    <title>{texto}</title>
                  </circle>
                );
              })}
            </g>
          ))}
          {modelo.grupos.map((g, i) =>
            i % passoDoRotulo === 0 ? (
              <text key={`r${g.chave}`} x={xc(i)} y={altura - 7} textAnchor="middle" fontSize={11} fill={COR_TEXTO}>
                {corta(nome(g), Math.max(3, Math.floor((passo * passoDoRotulo) / 6.6)))}
              </text>
            ) : null,
          )}
        </svg>
      </div>
      <Legenda itens={legendaDe(modelo, t, { anterior: comAnterior, meta: comMeta })} />
    </div>
  );
}

// ─── Rosca ──────────────────────────────────────────────────────────────────

function arco(cx: number, cy: number, R: number, r: number, a0: number, a1: number): string {
  const p = (a: number, raio: number) => `${(cx + raio * Math.sin(a)).toFixed(2)},${(cy - raio * Math.cos(a)).toFixed(2)}`;
  const grande = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(a0, R)}A${R},${R} 0 ${grande} 1 ${p(a1, R)}L${p(a1, r)}A${r},${r} 0 ${grande} 0 ${p(a0, r)}Z`;
}

function Rosca({ modelo, fmt, nome, onClicar, t, compacto }: Omit<PropsDeDesenho, "modelo"> & { modelo: ModeloDoGrafico; compacto: boolean }) {
  const fatias = modelo.grupos.filter((g) => (g.valor ?? 0) > 0);
  const total = fatias.reduce((s, g) => s + (g.valor ?? 0), 0);
  const tam = compacto ? 150 : 200;
  const R = tam / 2 - 4;
  const r = R * 0.6;
  let a = 0;
  let rank = 0;
  const desenho = fatias.map((g) => {
    const fra = total > 0 ? (g.valor ?? 0) / total : 0;
    const a0 = a;
    const a1 = a + Math.max(fra * Math.PI * 2 - 0.0001, 0.0001);
    a += fra * Math.PI * 2;
    const cor = corDoGrupo(g, g.sem || g.outros ? 0 : rank++, false);
    return { g, a0, a1, cor, fra };
  });
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <svg width={tam} height={tam} viewBox={`0 0 ${tam} ${tam}`} role="group" aria-label={t("Gráfico de rosca")} className="shrink-0">
        {desenho.length === 1 ? (
          <circle cx={tam / 2} cy={tam / 2} r={(R + r) / 2} fill="none" stroke={desenho[0]!.cor} strokeWidth={R - r} />
        ) : (
          desenho.map(({ g, a0, a1, cor }) => {
            const texto = `${nome(g)}: ${fmt(g.valor)}`;
            return (
              <path key={g.chave} d={arco(tam / 2, tam / 2, R, r, a0, a1)} fill={cor} {...clicavel({ chave1: g.chave, chave2: null, funil: false, rotulo: texto }, texto, onClicar)}>
                <title>{texto}</title>
              </path>
            );
          })
        )}
        <text x={tam / 2} y={tam / 2 + 2} textAnchor="middle" fontSize={compacto ? 16 : 20} fontWeight={600} fill="var(--color-text)">
          {fmt(total, true)}
        </text>
        <text x={tam / 2} y={tam / 2 + 18} textAnchor="middle" fontSize={11} fill={COR_TEXTO}>
          {t("Total")}
        </text>
      </svg>
      <ul className="flex w-full min-w-0 flex-col gap-1 text-sm">
        {desenho.map(({ g, cor, fra }) => (
          <li key={g.chave}>
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-left text-base hover:bg-surface-elevated lg:min-h-0 lg:py-1 lg:text-sm"
              onClick={onClicar ? () => onClicar({ chave1: g.chave, chave2: null, funil: false, rotulo: nome(g) }) : undefined}
              disabled={!onClicar}
            >
              <span aria-hidden="true" className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: cor }} />
              <span className="min-w-0 flex-1 truncate">{nome(g)}</span>
              <span className="tabular-nums text-text-muted">
                {fmt(g.valor)} · {Math.round(fra * 100)}%
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Número grande ──────────────────────────────────────────────────────────

function Numero({ modelo, f, compacto, onClicar }: { modelo: ModeloDoGrafico; f: Formato; compacto: boolean; onClicar?: (a: AlvoDoClique) => void }) {
  const t = f.t;
  const m = MEDIDAS_DO_MONTADOR[modelo.medida];
  const v = modelo.total.valor;
  const d = modelo.anterior ? variacao(v, modelo.anterior.valor, modelo.formato, f) : null;
  const bom = d ? d.sobe !== m.menor : true;
  const meta = modelo.meta;
  const texto = formatarValor(modelo.formato, v, f);
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={!onClicar}
        onClick={onClicar ? () => onClicar({ chave1: CHAVE_TUDO, chave2: null, funil: false, rotulo: t("Tudo o que foi contado") }) : undefined}
        className={`w-fit rounded-sm text-left ${compacto ? "text-3xl" : "text-5xl"} font-semibold tabular-nums tracking-tight hover:underline disabled:no-underline`}
      >
        {texto}
      </button>
      {d ? (
        <p className={`text-sm ${bom ? "text-success-fg" : "text-error-fg"}`}>
          {d.sobe ? "▲" : "▼"} {d.texto}{" "}
          <span className="text-text-muted">
            {t("contra o período anterior")} ({formatarValor(modelo.formato, modelo.anterior?.valor ?? null, f)})
          </span>
        </p>
      ) : null}
      {meta && meta.fracao !== null ? (
        <div className="flex flex-col gap-1">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-elevated" aria-hidden="true">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.round(meta.fracao * 100))}%` }} />
          </div>
          <p className="text-sm text-text-muted">
            {Math.round(meta.fracao * 100)}% {meta.proporcional ? t("da meta proporcional ao período") : t("da meta do mês")}
            {meta.alvo_cents !== null ? ` (${formatarValor("r", meta.alvo_cents, f)})` : ""}
            {meta.corrido !== null ? ` · ${Math.round(meta.corrido * 100)}% ${t("do mês já correu")}` : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ─── Funil ──────────────────────────────────────────────────────────────────

function Funil({ modelo, fmt, nome, onClicar, t }: PropsDeDesenho) {
  const max = Math.max(1, ...modelo.grupos.map((g) => g.valor ?? 0));
  return (
    <ol className="flex flex-col gap-1.5">
      {modelo.grupos.map((g, i) => {
        const seguinte = modelo.grupos[i + 1];
        const seguem = seguinte && g.n > 0 ? Math.round((seguinte.n * 100) / g.n) : null;
        const texto = `${nome(g)}: ${fmt(g.valor)}`;
        return (
          <li key={g.chave} className="flex flex-col gap-0.5">
            <button
              type="button"
              disabled={!onClicar}
              onClick={onClicar ? () => onClicar({ chave1: g.chave, chave2: null, funil: true, rotulo: `${nome(g)} (${t("chegaram até esta etapa")})` }) : undefined}
              className="flex min-h-11 w-full items-center gap-3 rounded-sm text-left text-base hover:bg-surface-elevated lg:min-h-9 lg:text-sm"
              aria-label={texto}
            >
              <span className="w-32 shrink-0 truncate sm:w-44">{nome(g)}</span>
              <span className="relative h-6 min-w-0 flex-1">
                <span
                  className="absolute inset-y-0 left-0 rounded-sm bg-primary"
                  style={{ width: `${Math.max(1, ((g.valor ?? 0) * 100) / max)}%`, opacity: 0.35 + 0.65 * (1 - i / Math.max(1, modelo.grupos.length)) }}
                />
              </span>
              <span className="w-24 shrink-0 text-right tabular-nums">{fmt(g.valor)}</span>
            </button>
            {seguem !== null ? (
              <span className="pl-32 text-xs text-text-muted sm:pl-44">
                ↓ {seguem}% {t("seguem adiante")}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Tabela ─────────────────────────────────────────────────────────────────

function Tabela({ modelo, f, nome, onClicar }: { modelo: ModeloDoGrafico; f: Formato; nome: (g: GrupoDesenhado) => string; onClicar?: (a: AlvoDoClique) => void }) {
  const t = f.t;
  const series = modelo.series ?? [];
  const compara = Boolean(modelo.anterior) && series.length === 0;
  const aditiva = MEDIDAS_DO_MONTADOR[modelo.medida].aditiva;
  const fmt = (v: number | null) => formatarValor(modelo.formato, v, f);
  const celula = (chave1: string, chave2: string | null, v: number | null, rotulo: string) =>
    onClicar && v !== null ? (
      <button type="button" className="min-h-11 w-full text-right tabular-nums hover:underline lg:min-h-0" onClick={() => onClicar({ chave1, chave2, funil: false, rotulo })}>
        {fmt(v)}
      </button>
    ) : (
      <span className="tabular-nums">{fmt(v)}</span>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-text-muted">
            <th className="py-2 pr-3 font-medium" />
            {series.map((s) => (
              <th key={s.chave} className="py-2 pr-3 text-right font-medium">
                {textoDoRotulo(s.rotulo, t, s.quantos)}
              </th>
            ))}
            <th className="py-2 pr-3 text-right font-medium">{series.length ? (aditiva ? t("Total") : t("Geral")) : t("Valor")}</th>
            {compara ? <th className="py-2 pr-3 text-right font-medium">{t("Período anterior")}</th> : null}
            {compara ? <th className="py-2 text-right font-medium">{t("Variação")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {modelo.grupos.map((g) => {
            const d = compara ? variacao(g.valor, g.anterior, modelo.formato, f) : null;
            return (
              <tr key={g.chave} className="border-b border-border/60">
                <th scope="row" className={`py-1.5 pr-3 text-left font-normal ${g.sem || g.outros ? "text-text-muted" : ""}`}>
                  {nome(g)}
                </th>
                {series.map((s) => (
                  <td key={s.chave} className="py-1.5 pr-3 text-right">
                    {celula(g.chave, s.chave, g.series[s.chave]?.valor ?? null, `${nome(g)} · ${textoDoRotulo(s.rotulo, t, s.quantos)}`)}
                  </td>
                ))}
                <td className="py-1.5 pr-3 text-right font-medium">{celula(g.chave, null, g.valor, nome(g))}</td>
                {compara ? <td className="py-1.5 pr-3 text-right tabular-nums text-text-muted">{fmt(g.anterior)}</td> : null}
                {compara ? <td className="py-1.5 text-right tabular-nums">{d?.texto ?? ""}</td> : null}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-medium">
            <th scope="row" className="py-2 pr-3 text-left">
              {aditiva ? t("Total") : t("Geral")}
            </th>
            {series.map((s) => (
              <td key={s.chave} />
            ))}
            <td className="py-2 pr-3 text-right">{celula(CHAVE_TUDO, null, modelo.total.valor, t("Tudo o que foi contado"))}</td>
            {compara ? <td className="py-2 pr-3 text-right tabular-nums text-text-muted">{fmt(modelo.anterior?.valor ?? null)}</td> : null}
            {compara ? <td /> : null}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
