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

import { alertaDoSchema, CARIMBO_DO_SCHEMA, compararCarimbo } from "@/lib/schema/carimbo";

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

/**
 * ─── A SEGUNDA METADE: erro no meio do baseline (migration 0269) ──────────
 *
 * O carimbo sozinho provava que o arquivo foi lido até o fim, e não que cada
 * comando passou: num banco existente o `psql` roda sem `ON_ERROR_STOP`, então
 * um `alter table` que falha vira uma linha de ERROR e a execução continua —
 * inclusive até o bloco que carimba.
 *
 * O bootstrap já contava esses erros e os deixava morrer no stdout.
 */
describe("o carimbo conta os erros do baseline", () => {
  it("carimbo certo E zero erros = em dia", () => {
    expect(compararCarimbo(CARIMBO_DO_SCHEMA, 0).em_dia).toBe(true);
  });

  it("carimbo certo e erro no meio NÃO é em dia", () => {
    // O caso exato: a migration nova falhou, o baseline seguiu até o fim e
    // carimbou com o nome dela. Sem esta metade, a saúde diria que está tudo
    // bem sobre um banco que não tem o que o carimbo afirma ter.
    const lido = compararCarimbo(CARIMBO_DO_SCHEMA, 3, 'ERROR: column "x" does not exist');
    expect(lido.em_dia).toBe(false);
    expect(lido.erros).toBe(3);
  });

  it("o padrão de erros é 0 — banco anterior à 0269 não vira alarme", () => {
    // A coluna não existia antes desta migration. Tratar ausência como
    // "desconhecido, logo suspeito" faria toda instalação correta acusar
    // problema na primeira leitura, e um alarme que toca sempre ninguém escuta.
    expect(compararCarimbo(CARIMBO_DO_SCHEMA).em_dia).toBe(true);
  });

  it("a amostra do erro viaja junto, para o diagnóstico começar em algum lugar", () => {
    // Um contador sozinho responde "deu errado" e não "o quê".
    const lido = compararCarimbo(CARIMBO_DO_SCHEMA, 1, "ERROR: permission denied");
    expect(lido.amostra).toBe("ERROR: permission denied");
  });

  it("o bootstrap grava o contador DEPOIS de aplicar o baseline", () => {
    // Antes, a tabela e as colunas ainda não existem — a escrita cairia, e o
    // `|| true` a engoliria em silêncio, deixando o contador eternamente zerado
    // (que é o valor que diz "está tudo bem").
    const bootstrap = fs.readFileSync(path.join(RAIZ, "easypanel/bootstrap.sh"), "utf8");
    const aplica = bootstrap.indexOf('psql "$DB" -q -f "$BASELINE"');
    const grava = bootstrap.indexOf("update public.schema_baseline");
    expect(aplica, "o passo que aplica o baseline sumiu do bootstrap").toBeGreaterThan(-1);
    expect(grava, "o bootstrap parou de gravar o contador de erros").toBeGreaterThan(-1);
    expect(grava).toBeGreaterThan(aplica);
  });

  it("o bootstrap não deixa a escrita do relatório derrubar a instalação", () => {
    // Nenhum deploy pode falhar por causa do relatório sobre ele mesmo — e num
    // banco anterior à 0269 as colunas não existem.
    const bootstrap = fs.readFileSync(path.join(RAIZ, "easypanel/bootstrap.sh"), "utf8");
    const grava = bootstrap.indexOf("update public.schema_baseline");
    const trecho = bootstrap.slice(Math.max(0, grava - 600), grava);
    expect(
      trecho.includes("|| true"),
      "a escrita do contador precisa tolerar falha (`|| true`)",
    ).toBe(true);
  });
});

/**
 * ─── O ALERTA NO GRUPO INTERNO ────────────────────────────────────────────
 *
 * `/api/v1/health` e o painel de admin respondem a quem PERGUNTA. Nenhum dos
 * dois avisa — e ninguém abre a saúde depois de um deploy que subiu verde. O
 * cron do report leva a pergunta ao grupo interno; estes casos medem a regra
 * que decide se há o que dizer.
 */
describe("o alerta de schema no grupo interno", () => {
  const limpo = {
    migration_mais_nova: CARIMBO_DO_SCHEMA,
    erros_inesperados: 0,
    erros_amostra: null,
  };

  it("cala quando está tudo em dia", () => {
    expect(alertaDoSchema(limpo)).toBeNull();
  });

  it("cala quando o banco NUNCA foi carimbado", () => {
    // Instalação anterior à 0268. Acusar ali faria toda instalação antiga tocar
    // o alarme na primeira rodada, e alarme que toca sempre ninguém escuta.
    expect(alertaDoSchema({ ...limpo, migration_mais_nova: null })).toBeNull();
    expect(alertaDoSchema({ ...limpo, migration_mais_nova: "  " })).toBeNull();
  });

  it("fala quando o banco está numa entrega diferente", () => {
    const a = alertaDoSchema({ ...limpo, migration_mais_nova: "20260101000000_0001_x" });
    expect(a).not.toBeNull();
    expect(a!.corpo, "quem lê precisa dos DOIS lados para saber qual está velho").toContain(
      "20260101000000_0001_x",
    );
    expect(a!.corpo).toContain(CARIMBO_DO_SCHEMA);
  });

  it("fala quando o carimbo bate mas houve erro no meio", () => {
    const a = alertaDoSchema({ ...limpo, erros_inesperados: 2, erros_amostra: "ERROR: x" });
    expect(a).not.toBeNull();
    expect(a!.corpo).toContain("ERROR: x");
  });

  it("a chave carrega o ESTADO, para problema NOVO render recado novo", () => {
    // A trava anti-ruído é por chave. Com uma chave fixa, consertar um problema
    // e cair noutro deixaria o grupo calado até o dia seguinte.
    const um = alertaDoSchema({ ...limpo, erros_inesperados: 1, erros_amostra: "a" });
    const outro = alertaDoSchema({ ...limpo, erros_inesperados: 3, erros_amostra: "b" });
    expect(um!.chave).not.toBe(outro!.chave);

    const mesmo = alertaDoSchema({ ...limpo, erros_inesperados: 1, erros_amostra: "a" });
    expect(mesmo!.chave, "o MESMO problema tem de render a mesma chave").toBe(um!.chave);
  });

  it("a amostra é cortada — o recado é um aviso, não um despejo de log", () => {
    const a = alertaDoSchema({
      ...limpo,
      erros_inesperados: 1,
      erros_amostra: "E".repeat(5_000),
    });
    expect(a!.corpo.length).toBeLessThan(1_200);
  });
});

/**
 * ─── O CONTADOR SÓ SERVE SE CHEGAR A ZERO ─────────────────────────────────
 *
 * A 0269 pôs um contador de erros do baseline na saúde. Ele só vale enquanto
 * "zero" for alcançável: um comando que falha em TODO deploy o trava em 1 para
 * sempre, e um alarme que nunca apaga é um alarme que se aprende a ignorar —
 * aí ele para de servir para o erro seguinte, que é o que importa.
 *
 * Foi o que a produção mostrou: `erros: 1` que não descia. A causa era
 * `ALTER SCHEMA "public" OWNER TO ...`, crua no topo do dump — num Supabase
 * hospedado o papel que conecta não é dono do schema, e o comando falha com
 * `must be owner of schema public` desde sempre.
 */
describe("o baseline não emite comando que sempre falha", () => {
  it("nenhum `ALTER SCHEMA ... OWNER` solto", () => {
    // Solto = fora de um bloco que trate `insufficient_privilege`. A regra é
    // simples: a linha pode existir (serve ao self-host com Postgres próprio),
    // mas não pode DERRUBAR o contador de quem roda hospedado.
    const linhas = BASELINE.split("\n");
    const soltos = linhas
      .map((linha, i) => ({ linha: linha.trim(), n: i + 1 }))
      .filter(({ linha }) => /^ALTER SCHEMA .* OWNER TO/i.test(linha))
      .filter(({ n }) => {
        // Olha as 6 linhas acima: um `DO $$ BEGIN` perto significa guardado.
        const antes = linhas.slice(Math.max(0, n - 7), n - 1).join("\n");
        return !/DO \$\$ BEGIN/i.test(antes);
      })
      .map(({ n }) => n);

    expect(
      soltos,
      "`ALTER SCHEMA ... OWNER` fora de um bloco com `exception when " +
        "insufficient_privilege`. Num Supabase hospedado ele falha em todo " +
        "deploy e trava o contador de erros do schema em 1 para sempre.",
    ).toEqual([]);
  });

  it("o filtro de erros benignos conhece a frase REAL do Postgres", () => {
    // O padrão antigo era `is already a member` — o português do erro, não o
    // inglês do Postgres (`is already member of publication`). Nunca casou
    // nada, e no dia em que um `alter publication ... add table` entrasse sem
    // guarda viraria alarme permanente.
    const bootstrap = fs.readFileSync(path.join(RAIZ, "easypanel/bootstrap.sh"), "utf8");
    const m = bootstrap.match(/^BENIGNOS='([^']+)'$/m);
    expect(m?.[1], "a linha BENIGNOS sumiu do bootstrap").toBeDefined();
    expect(
      m![1],
      "o filtro precisa casar `is already member of publication`, que é como o " +
        "Postgres escreve — sem o 'a'",
    ).toContain("is already member of publication");
  });
});
