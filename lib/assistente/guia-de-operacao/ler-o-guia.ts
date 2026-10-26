/**
 * FORK MIA (.89) — O GUIA DE OPERAÇÃO DO UPSTREAM VIRA TRECHOS DE AJUDA.
 *
 * O upstream mantém, para quem opera o produto, um guia tela a tela em
 * `.claude/skills/deskcomm-operacao/` (o mapa da interface e as
 * funcionalidades de cada área, tiradas do CHANGELOG). É a descrição mais
 * completa do produto que existe, e o assistente da MIA não a enxergava.
 *
 * Esta função lê o TEXTO desses arquivos e devolve trechos curtos (um por
 * funcionalidade, um por linha do mapa), cada um com a tela (`href`) quando
 * dá para ligar. Quem grava é `scripts/gerar-guia-de-operacao.ts`, num módulo
 * versionado (`lib/assistente/guia-de-operacao.gen.ts`): a imagem de produção
 * não leva a pasta `.claude/`, então nada aqui é lido em tempo de execução.
 *
 * `tests/unit/assistente-guia-de-operacao.test.ts` gera de novo a partir da
 * fonte e compara com o módulo gravado: quando a fusão trouxer o guia novo do
 * upstream, o teste fica vermelho e diz o comando que regera.
 *
 * Módulo PURO: recebe o conteúdo dos arquivos, não lê disco.
 */
import { createHash } from "node:crypto";

export interface TrechoDoGuia {
  /** Estável entre gerações enquanto o título e a seção não mudam. */
  id: string;
  /** O arquivo do guia, relativo à pasta da skill. */
  arquivo: string;
  /** `mapa` = linha do mapa da interface; `funcionalidade` = item de uma área; `sem-tela` = só por API, token ou rotina. */
  tipo: "mapa" | "funcionalidade" | "sem-tela";
  /** "Atendimento → Agenda", como o guia escreve. */
  secao: string;
  titulo: string;
  texto: string;
  /** A versão do upstream em que apareceu, quando o guia diz. */
  desde: string | null;
  /** A tela do upstream (`/app/...`) quando o guia permite ligar; `null` quando não. */
  href: string | null;
}

/**
 * Os arquivos que NÃO viram trecho, e por quê. Eles continuam na assinatura:
 * mudar um deles também avisa a fusão.
 *
 * - `SKILL.md`: instrução para quem consulta o guia (como responder, que skill
 *   chamar), não descrição de tela.
 * - `admin-e-plataforma.md`: telas de `/admin` e o kit de instalação da VPS.
 *   Na MIA isso é da Time Company, nunca da equipe do cliente que pergunta.
 * - `citado-e-nao-encontrado.md`: o próprio guia avisa "não afirme que existem".
 */
export const ARQUIVOS_SEM_TRECHO: ReadonlySet<string> = new Set([
  "SKILL.md",
  "references/funcionalidades/admin-e-plataforma.md",
  "references/funcionalidades/citado-e-nao-encontrado.md",
]);

const SEPARADOR = " → ";

function semFormatacao(texto: string): string {
  return texto
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** As células de uma linha de tabela markdown (`| a | b |`). */
function celulas(linha: string): string[] {
  return linha
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function ehSeparadorDeTabela(linha: string): boolean {
  return /^\|\s*:?-{3,}/.test(linha.trim());
}

/**
 * O mapa da interface: "Grupo → Tela" para o caminho, e os hubs de cada grupo.
 * É daí que as seções das funcionalidades ("### CRM → Funis") ganham a tela.
 */
function lerMapa(texto: string): {
  linhas: Array<{ grupo: string; tela: string; caminho: string; serve: string; quem: string; obs: string; href: string }>;
  hubs: Map<string, string>;
} {
  const linhas: Array<{ grupo: string; tela: string; caminho: string; serve: string; quem: string; obs: string; href: string }> = [];
  const hubs = new Map<string, string>();
  let grupo = "";
  for (const bruta of texto.split("\n")) {
    const linha = bruta.trimEnd();
    const h2 = /^## (.+)$/.exec(linha);
    if (h2) {
      grupo = h2[1]!.trim();
      continue;
    }
    const hub = /^Hub: .*`(\/app[^`]*)`/.exec(linha);
    if (hub && grupo) {
      hubs.set(grupo, hub[1]!);
      continue;
    }
    if (!linha.startsWith("|") || ehSeparadorDeTabela(linha)) continue;
    const c = celulas(linha);
    if (c.length < 4 || c[0] === "Tela" || c[0] === "Rota") continue;
    const caminho = /`(\/app[^`]*)`/.exec(c[1] ?? "");
    if (!caminho || !grupo) continue;
    linhas.push({
      grupo,
      tela: c[0]!,
      caminho: semFormatacao(c[1]!),
      serve: semFormatacao(c[2] ?? ""),
      quem: semFormatacao(c[3] ?? ""),
      obs: semFormatacao(c[4] ?? ""),
      href: caminho[1]!,
    });
  }
  return { linhas, hubs };
}

/** "Grupo → Tela" (como as seções das funcionalidades escrevem) para o caminho. */
function hrefDaSecao(
  secao: string,
  porTela: ReadonlyMap<string, string>,
  hubs: ReadonlyMap<string, string>,
): string | null {
  const direto = porTela.get(secao);
  if (direto) return direto;
  const [grupo, resto] = secao.split(SEPARADOR);
  if (grupo && resto?.startsWith("Hub")) return hubs.get(grupo) ?? null;
  return null;
}

const ITEM = /^- \*\*(.+?)\*\*\s*[—-]\s*(.+)$/;
const DESDE = /\s*_\(desde ([0-9][0-9A-Za-z.\-]*)\)_\s*$/;

/** Assinatura de TODOS os arquivos do guia (inclusive os que não viram trecho). */
export function assinaturaDoGuia(arquivos: Readonly<Record<string, string>>): string {
  const h = createHash("sha256");
  for (const nome of Object.keys(arquivos).sort()) {
    h.update(nome);
    h.update("\0");
    h.update(arquivos[nome]!.replace(/\r\n/g, "\n"));
    h.update("\0");
  }
  return h.digest("hex");
}

/**
 * Os trechos do guia, na ordem dos arquivos (nome em ordem alfabética) e, dentro
 * de cada um, na ordem em que aparecem.
 */
export function trechosDoGuia(arquivos: Readonly<Record<string, string>>): TrechoDoGuia[] {
  const normal = (nome: string) => (arquivos[nome] ?? "").replace(/\r\n/g, "\n");
  const mapa = lerMapa(normal("references/mapa-da-interface.md"));
  const porTela = new Map<string, string>();
  for (const l of mapa.linhas) porTela.set(`${l.grupo}${SEPARADOR}${l.tela}`, l.href);

  const trechos: TrechoDoGuia[] = [];
  const usados = new Set<string>();
  const novoId = (base: string) => {
    let id = base;
    let n = 2;
    while (usados.has(id)) id = `${base}-${n++}`;
    usados.add(id);
    return id;
  };

  for (const nome of Object.keys(arquivos).sort()) {
    if (ARQUIVOS_SEM_TRECHO.has(nome)) continue;
    const texto = normal(nome);
    const prefixo = slug(nome.replace(/^references\/(funcionalidades\/)?/, "").replace(/\.md$/, ""));

    if (nome === "references/mapa-da-interface.md") {
      for (const l of mapa.linhas) {
        const partes = [`Serve para: ${l.serve}`, `Caminho: ${l.caminho}.`, `Quem vê: ${l.quem}.`];
        if (l.obs) partes.push(l.obs);
        trechos.push({
          id: novoId(`${prefixo}/${slug(l.grupo)}/${slug(l.tela)}`),
          arquivo: nome,
          tipo: "mapa",
          secao: l.grupo,
          titulo: l.tela,
          texto: partes.join(" ").replace(/\.\./g, "."),
          desde: null,
          href: l.href,
        });
      }
      continue;
    }

    let secao = "";
    let hrefDaVez: string | null = null;
    for (const bruta of texto.split("\n")) {
      const linha = bruta.trimEnd();
      const h3 = /^### (.+)$/.exec(linha);
      if (h3) {
        secao = semFormatacao(h3[1]!);
        hrefDaVez = hrefDaSecao(secao, porTela, mapa.hubs);
        continue;
      }
      const item = ITEM.exec(linha);
      if (item && secao) {
        const desde = DESDE.exec(item[2]!);
        const corpo = semFormatacao(item[2]!.replace(DESDE, ""));
        const titulo = semFormatacao(item[1]!);
        trechos.push({
          id: novoId(`${prefixo}/${slug(secao)}/${slug(titulo)}`),
          arquivo: nome,
          tipo: "funcionalidade",
          secao,
          titulo,
          texto: corpo,
          desde: desde?.[1] ?? null,
          href: hrefDaVez,
        });
        continue;
      }
      // A tabela do "só por API ou sem tela": Funcionalidade | Desde | O que se sabe | Evidência.
      if (linha.startsWith("|") && !ehSeparadorDeTabela(linha)) {
        const c = celulas(linha);
        if (c.length < 4 || c[0] === "Funcionalidade") continue;
        const onde = /\(([^()]*→[^()]*)\)\s*$/.exec(c[2] ?? "");
        const evidencia = (c[3] ?? "").trim();
        const href = evidencia.startsWith("/app/")
          ? evidencia.split(/[?:\s]/)[0]!
          : onde
            ? (porTela.get(semFormatacao(onde[1]!)) ?? null)
            : null;
        trechos.push({
          id: novoId(`${prefixo}/${slug(c[0]!)}`),
          arquivo: nome,
          tipo: "sem-tela",
          secao: "Só por API ou sem tela",
          titulo: semFormatacao(c[0]!),
          texto: semFormatacao(c[2] ?? ""),
          desde: /^[0-9]/.test(c[1] ?? "") ? c[1]!.trim() : null,
          href,
        });
      }
    }
  }
  return trechos;
}

/**
 * O módulo TypeScript que o gerador grava. Determinístico: mesma fonte, mesmos bytes.
 * `pasta` é a pasta do guia a partir da raiz: quem chama sabe (o nome dela leva a
 * marca do upstream, que a cerca `branding` não deixa no código de `lib/`).
 */
export function moduloDoGuia(arquivos: Readonly<Record<string, string>>, pasta: string): string {
  const trechos = trechosDoGuia(arquivos);
  const nomes = Object.keys(arquivos).sort();
  const linhas = trechos.map((t) => `  ${JSON.stringify(t)},`);
  return [
    "/**",
    " * GERADO por `scripts/gerar-guia-de-operacao.ts` a partir do guia de operação do",
    ` * upstream (\`${pasta}/\`). NÃO EDITE À MÃO.`,
    " *",
    " * Para regerar depois de uma fusão que mudou o guia:",
    " *   npx tsx scripts/gerar-guia-de-operacao.ts",
    " *",
    " * Onde o código desmente o guia, quem corrige é o fork, em",
    " * `lib/assistente/guia-de-operacao.ts` (SUPERADOS_PELO_CODIGO) e nos manuais",
    " * do fork, nunca este arquivo nem o guia do upstream.",
    " */",
    'import type { TrechoDoGuia } from "./guia-de-operacao/ler-o-guia";',
    "",
    `export const ASSINATURA_DO_GUIA = ${JSON.stringify(assinaturaDoGuia(arquivos))};`,
    "",
    `export const ARQUIVOS_DO_GUIA: readonly string[] = ${JSON.stringify(nomes)};`,
    "",
    "export const TRECHOS_DO_GUIA: readonly TrechoDoGuia[] = [",
    ...linhas,
    "];",
    "",
  ].join("\n");
}
