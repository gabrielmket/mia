/**
 * FORK MIA (migration 9163) · O TRECHO "ANTES DO UPSTREAM" DO `baseline-mia.sql`
 * NÃO PODE SUMIR NEM DEIXAR DE RODAR PRIMEIRO.
 *
 * ── Por que ele existe ────────────────────────────────────────────────────
 *
 * Desde a v1.118 (9416) o upstream cria uma `public.organization_modules` com
 * outro formato. A nossa (0245) tem de sair do caminho ANTES de o `baseline.sql`
 * rodar; senão a 9416 cai na nossa tabela (comentário em coluna que não existe,
 * `revoke` de `authenticated`, gatilho que grava `updated_at`) e toda revogação
 * de módulo quebra. Esse passo mora no próprio `baseline-mia.sql`, entre
 * `-- >>> ANTES DO BASELINE DO UPSTREAM` e `-- <<< ANTES DO BASELINE DO UPSTREAM`,
 * e o `easypanel/bootstrap.sh` (cada passada do modo update) e o
 * `scripts/ensaio-de-banco.sh` o recortam com `sed` e o aplicam primeiro.
 *
 * Nada disso dá erro quando quebra. Se um marcador some ou muda de texto, o
 * `sed` devolve vazio e o `psql` aplica nada, calado (`|| true`). Se uma
 * passada perde a chamada, o `baseline.sql` chega primeiro. Nos dois casos o
 * bootstrap segue, a 9163 ainda move a nossa tabela no fim (o caminho de
 * reserva) e a do upstream só nasce na PRÓXIMA implantação. Por isso a cerca é
 * de texto e roda na unidade, sem banco.
 *
 * O que se exige:
 *   1. no `baseline-mia.sql`, um par de marcadores, na ordem, com SQL entre eles;
 *   2. os dois scripts recortam com o MESMO texto dos marcadores do arquivo;
 *   3. no `bootstrap.sh`, toda aplicação do `baseline.sql` no modo update vem
 *      logo depois de `antes_do_upstream`, e a função recorta do `$BASELINE_MIA`
 *      e manda para o `psql`. Desde a MIA-348 a passada é uma só no texto
 *      (`aplicar_passada`, repetida até 3 vezes num laço) e o `baseline.sql` vai
 *      por `aplicar_arquivo "$ARQUIVO_DO_UPSTREAM"` (a cópia com espera curta);
 *   4. no `ensaio-de-banco.sh`, toda aplicação do `baseline.sql` em banco que já
 *      existe vem logo depois do `antes-do-upstream.sql` do mesmo lado.
 *
 * O banco NOVO (com `ON_ERROR_STOP`) fica de fora de propósito: lá a nossa
 * tabela ainda não existe e o trecho não tem o que fazer.
 *
 * Documentado em docs/fork/CATALOGO.md (R2 e R3).
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), "utf8");

const ABRE = "-- >>> ANTES DO BASELINE DO UPSTREAM";
const FECHA = "-- <<< ANTES DO BASELINE DO UPSTREAM";
/** O `sed -n '/^ABRE/,/^FECHA/p'` dos dois scripts, escrito igual. */
const RECORTE = `sed -n '/^${ABRE}/,/^${FECHA}/p'`;

/** Linhas com conteúdo (sem as em branco nem as só de comentário de shell). */
function linhasUteis(texto: string): { n: number; linha: string }[] {
  return texto
    .split("\n")
    .map((linha, i) => ({ n: i + 1, linha: linha.trim() }))
    .filter(({ linha }) => linha !== "" && !linha.startsWith("#"));
}

/** O que o `sed` dos scripts recorta: da 1ª linha que começa com ABRE até a 1ª que começa com FECHA. */
function recortar(sql: string): string {
  const linhas = sql.split("\n");
  const ini = linhas.findIndex((l) => l.startsWith(ABRE));
  if (ini < 0) return "";
  const fim = linhas.findIndex((l, i) => i > ini && l.startsWith(FECHA));
  return linhas.slice(ini, fim < 0 ? undefined : fim + 1).join("\n");
}

/** Problemas do trecho no `baseline-mia.sql` (vazio = ok). */
function problemasDoTrecho(sql: string): string[] {
  const linhas = sql.split("\n");
  const aberturas = linhas.filter((l) => l.startsWith(ABRE)).length;
  const fechamentos = linhas.filter((l) => l.startsWith(FECHA)).length;
  const problemas: string[] = [];
  if (aberturas !== 1) problemas.push(`esperava 1 linha começando com "${ABRE}", achei ${aberturas}`);
  if (fechamentos !== 1) problemas.push(`esperava 1 linha começando com "${FECHA}", achei ${fechamentos}`);
  if (problemas.length) return problemas;
  const ini = linhas.findIndex((l) => l.startsWith(ABRE));
  const fim = linhas.findIndex((l) => l.startsWith(FECHA));
  if (fim < ini) return [`"${FECHA}" vem antes de "${ABRE}": o sed recortaria até o fim do arquivo`];
  const sqlDeVerdade = linhas
    .slice(ini + 1, fim)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("--"));
  if (sqlDeVerdade.length === 0) problemas.push("não há SQL entre os marcadores (só comentário ou nada)");
  return problemas;
}

/**
 * Problemas do `bootstrap.sh` (vazio = ok): a função existe e recorta do
 * `$BASELINE_MIA` para o `psql`, e toda aplicação do `baseline.sql` sem
 * `ON_ERROR_STOP` (modo update) vem logo depois de `antes_do_upstream`. A
 * aplicação é o `psql "$DB" ... -f "$BASELINE"` direto ou, desde a MIA-348,
 * `aplicar_arquivo "$ARQUIVO_DO_UPSTREAM"` (a cópia com espera curta por lock).
 */
function problemasDoBootstrap(sh: string): string[] {
  const problemas: string[] = [];
  const def = /^antes_do_upstream\(\)\s*\{([\s\S]*?)^\}/m.exec(sh);
  if (!def) problemas.push("a função antes_do_upstream() sumiu");
  else {
    const corpo = def[1]!;
    if (!corpo.includes(`${RECORTE} "$BASELINE_MIA"`))
      problemas.push(`antes_do_upstream() não recorta mais com ${RECORTE} "$BASELINE_MIA"`);
    if (!/\|\s*psql\s+"\$DB"/.test(corpo)) problemas.push('antes_do_upstream() não manda o recorte para o psql "$DB"');
  }
  const uteis = linhasUteis(sh);
  const passadas = uteis.filter(
    ({ linha }) =>
      (/psql\s+"\$DB".*-f\s+"\$BASELINE"(\s|$)/.test(linha) && !linha.includes("ON_ERROR_STOP")) ||
      /^aplicar_arquivo\s+"\$ARQUIVO_DO_UPSTREAM"(\s|$)/.test(linha),
  );
  if (passadas.length === 0)
    problemas.push("não achei a aplicação do baseline.sql no modo update (a cerca precisa de revisão)");
  if (!/^\s*ARQUIVO_DO_UPSTREAM="\$BASELINE"$/m.test(sh))
    problemas.push('ARQUIVO_DO_UPSTREAM não parte mais do "$BASELINE"');
  for (const p of passadas) {
    const anterior = uteis[uteis.indexOf(p) - 1];
    if (anterior?.linha !== "antes_do_upstream")
      problemas.push(`linha ${p.n}: o baseline.sql é aplicado sem antes_do_upstream na linha de cima`);
  }
  return problemas;
}

/**
 * Problemas do `ensaio-de-banco.sh` (vazio = ok): recorta o trecho do
 * `baseline-mia.sql` de cada lado para `antes-do-upstream.sql`, e toda
 * aplicação do `baseline.sql` sem `ON_ERROR_STOP` vem logo depois dele.
 */
function problemasDoEnsaio(sh: string): string[] {
  const problemas: string[] = [];
  if (!sh.includes(`${RECORTE} "$origem/baseline-mia.sql"`))
    problemas.push(`o ensaio não recorta mais com ${RECORTE} "$origem/baseline-mia.sql"`);
  if (!/docker cp .*\/ensaio\/\$lado\/antes-do-upstream\.sql"/.test(sh))
    problemas.push("o recorte não é mais copiado para /ensaio/$lado/antes-do-upstream.sql");
  const uteis = linhasUteis(sh);
  const passadas = uteis.filter(
    ({ linha }) => /^ARQ\s+-f\s+\/ensaio\/[^/]+\/baseline\.sql/.test(linha),
  );
  if (!passadas.some(({ linha }) => linha.includes("/ensaio/novo/")))
    problemas.push("o ensaio não aplica mais a versão nova em modo update (ARQ -f /ensaio/novo/baseline.sql)");
  for (const p of passadas) {
    const lado = /\/ensaio\/([^/]+)\//.exec(p.linha)![1];
    const anterior = uteis[uteis.indexOf(p) - 1];
    if (!anterior || !new RegExp(`^ARQ\\s+-f\\s+/ensaio/${lado}/antes-do-upstream\\.sql\\b`).test(anterior.linha))
      problemas.push(`linha ${p.n}: /ensaio/${lado}/baseline.sql é aplicado sem antes-do-upstream.sql na linha de cima`);
  }
  return problemas;
}

const BASELINE_MIA = ler("supabase/baseline-mia.sql");
const BOOTSTRAP = ler("easypanel/bootstrap.sh");
const ENSAIO = ler("scripts/ensaio-de-banco.sh");

describe("o trecho 'antes do upstream' da 9163 continua no lugar e rodando primeiro", () => {
  it("o baseline-mia.sql tem o par de marcadores, na ordem, com SQL entre eles", () => {
    expect(problemasDoTrecho(BASELINE_MIA)).toEqual([]);
  });

  it("o recorte que os scripts fazem traz o passo da 9163 inteiro", () => {
    const trecho = recortar(BASELINE_MIA);
    expect(trecho.split("\n").at(-1)).toMatch(new RegExp(`^${FECHA}`));
    expect(trecho).toContain("rename to mia_modulos_contratados");
    expect(trecho).toMatch(/^do \$\$[\s\S]*^end \$\$;$/m);
  });

  it("o bootstrap.sh chama antes_do_upstream antes do baseline.sql em toda passada", () => {
    expect(problemasDoBootstrap(BOOTSTRAP)).toEqual([]);
  });

  it("o ensaio-de-banco.sh aplica o trecho antes do baseline.sql em toda passada sobre banco existente", () => {
    expect(problemasDoEnsaio(ENSAIO)).toEqual([]);
  });
});

describe("a cerca morde (cópias estragadas de propósito)", () => {
  it("reprova marcador sumido, com outro texto, invertido ou trecho vazio", () => {
    expect(problemasDoTrecho(BASELINE_MIA.replace(ABRE, "-- >>> ANTES DO UPSTREAM"))).not.toEqual([]);
    expect(problemasDoTrecho(BASELINE_MIA.replace(FECHA, "-- fim"))).not.toEqual([]);
    expect(problemasDoTrecho(`${FECHA}\nselect 1;\n${ABRE}\n`)).not.toEqual([]);
    expect(problemasDoTrecho(`${ABRE}\n-- só comentário\n\n${FECHA}\n`)).not.toEqual([]);
    expect(problemasDoTrecho(`${ABRE}\nselect 1;\n${FECHA}\n`)).toEqual([]);
  });

  it("reprova o bootstrap sem a chamada em uma das passadas, ou com a chamada depois", () => {
    const linhas = BOOTSTRAP.split("\n");
    const chamadas = linhas.flatMap((l, i) => (l.trim() === "antes_do_upstream" ? [i] : []));
    expect(chamadas.length).toBeGreaterThan(0);
    for (const i of chamadas) {
      const sem = linhas.filter((_, j) => j !== i).join("\n");
      expect(problemasDoBootstrap(sem)).not.toEqual([]);
    }
    const primeira = chamadas[0]!;
    const trocada = [...linhas];
    [trocada[primeira], trocada[primeira + 1]] = [trocada[primeira + 1]!, trocada[primeira]!];
    expect(problemasDoBootstrap(trocada.join("\n"))).not.toEqual([]);
    expect(problemasDoBootstrap(BOOTSTRAP.replace(`'/^${ABRE}`, "'/^-- >>> ANTES"))).not.toEqual([]);
  });

  it("reprova o ensaio sem o trecho antes de uma passada", () => {
    const sem = ENSAIO.split("\n")
      .filter((l) => !l.trim().startsWith("ARQ -f /ensaio/novo/antes-do-upstream.sql"))
      .join("\n");
    expect(problemasDoEnsaio(sem)).not.toEqual([]);
    expect(problemasDoEnsaio(ENSAIO.replace(`/^${FECHA}/p'`, "/^-- fim/p'"))).not.toEqual([]);
  });
});
