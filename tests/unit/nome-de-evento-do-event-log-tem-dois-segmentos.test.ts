/**
 * NOME DE EVENTO DO `event_log` TEM DOIS SEGMENTOS (MIA-206, do PR #138).
 *
 * ## O defeito que fez este arquivo existir
 *
 * Na primeira versão do PR #138 (MIA-168), o gatilho da 9169 emitia
 * `mia.cadastro.empresa_nasceu` e o handler `lead-do-cadastro.handler.ts`
 * escutava o mesmo nome. Três segmentos. O `event_log` do upstream recusa isso
 * no CHECK `event_type_format`, e o `emit_event` estava (de propósito) num
 * bloco que engole o erro, porque o evento nunca pode impedir a empresa de
 * nascer. Resultado: o insert falhava, o erro sumia, nenhuma linha entrava no
 * `event_log` e o handler esperava para sempre por um evento que não existia.
 * Nada reprovava: o nome batia dos dois lados, o teste de unidade do handler
 * passava, e só o invariante com banco, procurando a linha, viu o vazio.
 *
 * ## A regra
 *
 * A regex é a do CHECK `event_type_format` de `supabase/baseline.sql`
 * (tabela `event_log`, do upstream):
 *
 *     ^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$
 *
 * Exatamente dois segmentos (`dominio.acao`), minúsculas, dígitos e `_`, cada
 * segmento começando por letra. O teste abaixo confere que a cópia daqui não
 * se descolou da de lá.
 *
 * ## Onde procura (sem banco)
 *
 *   - **handlers**: pelo registro do dispatcher (`ensureHandlersRegistered()` e
 *     `getRegisteredHandlers()`), não por grep de `events:`. Quem tem
 *     `events: [...]` e não é consumidor do `event_log` não está no registro e
 *     fica de fora sem lista de exceção.
 *   - **SQL da MIA**: o primeiro argumento LITERAL de toda chamada a
 *     `emit_event(...)` em `supabase/migrations-mia/` e no `baseline-mia.sql`,
 *     inclusive com a chamada quebrada em várias linhas e com espaço ou
 *     comentário antes do literal. Chamada cujo primeiro argumento é variável
 *     (o `p_gatilho` da 9018) não tem o que conferir aqui.
 *   - **TypeScript**: os `p_event_type: "..."` de `app`, `lib` e `workers` (a
 *     mesma leitura de `evento-comando-tem-consumidor.test.ts`).
 *
 * Não há lista de exceção: nome fora do formato não grava, então não existe
 * caso legítimo para anistiar.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getRegisteredHandlers } from "@/lib/event-log/dispatcher";
import { ensureHandlersRegistered } from "@/lib/event-log/register-handlers";

/** Cópia do CHECK `event_type_format` de `supabase/baseline.sql`. */
const FORMATO = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

const RAIZES_TS = ["app", "lib", "workers"];
const EMISSAO_TS = /p_event_type:\s*"([^"]*)"/g;

/**
 * `emit_event(` (com ou sem `public.` e aspas), depois espaço, quebra de linha,
 * comentário `--` ou `/* *\/` em qualquer quantidade, e então o literal.
 */
const EMISSAO_SQL = /\bemit_event"?\s*\((?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*'((?:[^']|'')*)'/g;

type Achado = { nome: string; onde: string };

function arquivosTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : arquivosTs(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

function arquivosSqlDaMia(): string[] {
  const dir = "supabase/migrations-mia";
  return [
    "supabase/baseline-mia.sql",
    ...readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => join(dir, f)),
  ];
}

function linhaDe(texto: string, indice: number): number {
  return texto.slice(0, indice).split("\n").length;
}

/** O último teste chama esta função com SQL plantado para provar a leitura. */
function nomesNoSql(texto: string, arquivo: string): Achado[] {
  return [...texto.matchAll(EMISSAO_SQL)].map((m) => ({
    nome: m[1]!.replace(/''/g, "'"),
    onde: `${arquivo}:${linhaDe(texto, m.index!)}`,
  }));
}

function nomesNoTs(texto: string, arquivo: string): Achado[] {
  return [...texto.matchAll(EMISSAO_TS)].map((m) => ({
    nome: m[1]!,
    onde: `${arquivo}:${linhaDe(texto, m.index!)}`,
  }));
}

function nomesDosHandlers(): Achado[] {
  ensureHandlersRegistered();
  return getRegisteredHandlers().flatMap((h) =>
    h.events.map((nome) => ({ nome, onde: `handler ${h.key}` })),
  );
}

function nomesDasMigrations(): Achado[] {
  return arquivosSqlDaMia().flatMap((f) => nomesNoSql(readFileSync(f, "utf8"), f));
}

function nomesDoTs(): Achado[] {
  return RAIZES_TS.flatMap(arquivosTs).flatMap((f) => nomesNoTs(readFileSync(f, "utf8"), f));
}

function foraDoFormato(achados: Achado[]): string[] {
  return achados.filter((a) => !FORMATO.test(a.nome)).map((a) => `${a.nome}  (${a.onde})`);
}

const MENSAGEM =
  "nome de evento fora do formato do CHECK event_type_format (supabase/baseline.sql): " +
  "exatamente dois segmentos, `dominio.acao`, minúsculas, dígitos e _. O insert no " +
  "event_log falha e, se o emit_event estiver num bloco que engole o erro (como no " +
  "PR #138), o evento some calado e o handler espera para sempre. Renomeie dos dois " +
  "lados (quem emite e quem escuta).";

describe("nome de evento do event_log tem dois segmentos", () => {
  it("a regex daqui é a mesma do CHECK event_type_format do baseline.sql", () => {
    const baseline = readFileSync("supabase/baseline.sql", "utf8");
    const check = baseline.match(
      /CONSTRAINT "event_type_format" CHECK \(\("event_type" ~ '([^']+)'/,
    );
    expect(
      check,
      "o CHECK event_type_format sumiu do baseline.sql — reveja esta cerca",
    ).not.toBeNull();
    expect(FORMATO.source).toBe(check![1]);
  });

  it("acha nomes em cada fonte (guarda de vacuidade)", () => {
    // Sem isto, um leitor quebrado (registro vazio, outro jeito de chamar o
    // emit_event) faria a asserção principal passar por AUSÊNCIA de dado.
    expect(nomesDosHandlers().length).toBeGreaterThanOrEqual(5);
    expect(nomesDasMigrations().length).toBeGreaterThanOrEqual(1);
    expect(nomesDoTs().length).toBeGreaterThanOrEqual(20);
  });

  it("todo evento escutado por um handler do event_log tem dois segmentos", () => {
    expect(foraDoFormato(nomesDosHandlers()), MENSAGEM).toEqual([]);
  });

  it("todo literal do emit_event no SQL da MIA tem dois segmentos", () => {
    expect(foraDoFormato(nomesDasMigrations()), MENSAGEM).toEqual([]);
  });

  it("todo p_event_type do app, lib e workers tem dois segmentos", () => {
    expect(foraDoFormato(nomesDoTs()), MENSAGEM).toEqual([]);
  });

  it("a leitura do SQL pega a chamada em várias linhas e com comentário antes do literal", () => {
    // O caso do #138 era exatamente uma chamada quebrada em linhas. Se a regex
    // regredir para só a chamada de uma linha, este teste reprova antes de a
    // cerca ficar cega.
    const sql = [
      "perform public.emit_event('um.dois', 'x', p_id);",
      "v := public.emit_event(",
      "  -- o nome do evento",
      "  'mia.cadastro.empresa_nasceu',",
      "  'mia_origem_da_empresa', new.id);",
      "perform \"emit_event\"( /* nome */ 'tres.segmentos.aqui', 1);",
      "perform public.emit_event(p_gatilho, 'mia_obrigacao', p_id);",
    ].join("\n");
    const achados = nomesNoSql(sql, "plantado.sql");
    expect(achados.map((a) => a.nome)).toEqual([
      "um.dois",
      "mia.cadastro.empresa_nasceu",
      "tres.segmentos.aqui",
    ]);
    expect(foraDoFormato(achados)).toEqual([
      "mia.cadastro.empresa_nasceu  (plantado.sql:2)",
      "tres.segmentos.aqui  (plantado.sql:6)",
    ]);
  });
});
