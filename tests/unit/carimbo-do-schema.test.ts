/**
 * O CARIMBO DO SCHEMA TEM DE DIZER A VERDADE — nos três lugares.
 *
 * ── Por que ele existe ────────────────────────────────────────────────────
 *
 * `easypanel/bootstrap.sh` aplica `supabase/baseline.sql` com `|| true` num
 * banco que já existe — que é TODO deploy depois do primeiro. Se uma migration
 * tropeça, ele escreve `AVISO: ... (o app sobe mesmo assim)` e segue. O produto
 * sobe saudável, com o código novo e o schema de ontem, e as duas afirmações
 * são verdadeiras. O único registro fica no stdout de um contêiner efêmero, e a
 * agregação de logs da VPS está desligada (item E4).
 *
 * O carimbo dá resposta a "o banco veio junto?" com um curl em `/api/v1/health`.
 *
 * ── Por que este teste é a metade que faz o carimbo valer ─────────────────
 *
 * Um carimbo mantido à mão que envelhece em silêncio é PIOR que nenhum: ele
 * responde `em_dia: true` com confiança sobre um banco atrasado, e desliga a
 * pergunta em vez de deixá-la aberta. Exatamente o que este repositório
 * documenta em `version: "desconhecido"` na mesma rota.
 *
 * Então a verdade tem de bater em três lugares, e é máquina que confere:
 *
 *   1. `supabase/migrations/`     o arquivo mais novo
 *   2. `lib/schema/carimbo.ts`    a constante compilada na imagem
 *   3. `supabase/baseline.sql`    o `insert` que o bootstrap executa
 *
 * Quem acrescentar migration e esquecer de mexer nos outros dois reprova aqui,
 * com a linha pronta na mensagem.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CARIMBO_DO_SCHEMA, compararCarimbo } from "@/lib/schema/carimbo";

const RAIZ = path.resolve(__dirname, "../..");
const DIR_MIGRATIONS = path.join(RAIZ, "supabase/migrations");
const BASELINE = fs.readFileSync(path.join(RAIZ, "supabase/baseline.sql"), "utf8");

/** O nome (sem `.sql`) da migration com o maior prefixo de timestamp. */
function migrationMaisNova(): string {
  const arquivos = fs
    .readdirSync(DIR_MIGRATIONS)
    .filter((f) => /^\d{14}_.*\.sql$/.test(f))
    .sort();
  const ultima = arquivos[arquivos.length - 1];
  expect(ultima, "nenhuma migration encontrada — o parser quebrou").toBeDefined();
  return ultima!.replace(/\.sql$/, "");
}

/** O valor que o `insert` do BASELINE grava em `schema_baseline`. */
function carimboNoBaseline(): string | null {
  // O último `insert` da tabela é o que vale: o baseline pode carregar o bloco
  // da migration original mais o apêndice, e quem roda por último decide.
  const re =
    /insert into public\.schema_baseline[\s\S]*?values\s*\(\s*1\s*,\s*'([^']+)'/g;
  const achados = [...BASELINE.matchAll(re)].map((m) => m[1]);
  return achados.length > 0 ? (achados[achados.length - 1] ?? null) : null;
}

describe("o carimbo do schema", () => {
  it("a constante da imagem é a migration mais nova do repositório", () => {
    const maisNova = migrationMaisNova();
    expect(
      CARIMBO_DO_SCHEMA,
      "migration nova sem atualizar o carimbo. Em `lib/schema/carimbo.ts`:\n" +
        `  export const CARIMBO_DO_SCHEMA = "${maisNova}";\n` +
        "Sem isso, `/api/v1/health` responderia `em_dia: false` em toda instalação " +
        "correta — e um alarme que toca sempre é um alarme que ninguém escuta.",
    ).toBe(maisNova);
  });

  it("o baseline grava o MESMO valor que a imagem espera", () => {
    const noBaseline = carimboNoBaseline();
    expect(
      noBaseline,
      "o `insert into public.schema_baseline` sumiu do baseline — sem ele o banco " +
        "nunca é carimbado e a saúde acusa `em_dia: false` para sempre",
    ).not.toBeNull();
    expect(
      noBaseline,
      "o baseline carimba um valor e a imagem espera outro. Atualize o `values (1, '…')` " +
        `do apêndice do carimbo em supabase/baseline.sql para "${CARIMBO_DO_SCHEMA}".`,
    ).toBe(CARIMBO_DO_SCHEMA);
  });

  it("o carimbo é gravado ANTES do bloco da varredura anon", () => {
    // O bloco da varredura é, de propósito, o último do arquivo. Um apêndice
    // depois dele desarma a cura para tudo que vier em seguida — a mesma regra
    // que `varredura-anon-e-o-ultimo-bloco.test.ts` guarda para funções.
    const carimbo = BASELINE.lastIndexOf("insert into public.schema_baseline");
    const varredura = BASELINE.indexOf("-- ---- VARREDURA anon:");
    expect(carimbo).toBeGreaterThan(-1);
    expect(varredura).toBeGreaterThan(-1);
    expect(
      carimbo,
      "o carimbo foi parar depois do bloco da varredura anon",
    ).toBeLessThan(varredura);
  });

  it("ausência de carimbo NÃO é 'em dia'", () => {
    // O caso perigoso: banco que nunca foi carimbado é exatamente aquele em que
    // o baseline pode não ter passado. Responder `true` ali seria trocar "não
    // sei" por "está tudo bem" — a mentira mais cara que um health check conta.
    expect(compararCarimbo(null).em_dia).toBe(false);
    expect(compararCarimbo("").em_dia).toBe(false);
  });

  it("carimbo de outra entrega é 'fora de dia', e diz qual é qual", () => {
    const lido = compararCarimbo("20260101000000_0001_qualquer_coisa");
    expect(lido.em_dia).toBe(false);
    expect(
      lido.no_banco,
      "quem diagnostica precisa ver os DOIS lados; só 'false' não diz se o banco " +
        "está atrasado ou se a imagem é que é velha",
    ).toBe("20260101000000_0001_qualquer_coisa");
    expect(lido.esperado).toBe(CARIMBO_DO_SCHEMA);
  });

  it("carimbo igual é 'em dia'", () => {
    expect(compararCarimbo(CARIMBO_DO_SCHEMA).em_dia).toBe(true);
  });
});
