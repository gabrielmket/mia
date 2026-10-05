import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * O SCHEMA DA MIA ESTENDE O DO UPSTREAM — NUNCA O REDEFINE.
 *
 * O fork mora ao lado do upstream, não dentro dele:
 *
 *   supabase/baseline.sql      ← do upstream, byte a byte
 *   supabase/migrations/       ← do upstream, arquivos e MANIFEST
 *   supabase/baseline-mia.sql  ← nosso, aplicado depois pelo easypanel/bootstrap.sh
 *   supabase/migrations-mia/   ← nosso, arquivos e MANIFEST próprio
 *
 * Com isso, cada sincronização traz os arquivos do upstream exatamente como ele
 * os escreveu, e as catracas DELE (manifest-x-migrations, varredura-anon, etc.)
 * validam o que é dele sem saber que a MIA existe.
 *
 * Este arquivo é a catraca NOSSA. Ele existe porque separar arquivo não basta:
 * se o `baseline-mia.sql` fizer `create or replace` de um objeto que já existe no
 * `baseline.sql`, vale o nosso (roda por último), e toda melhoria futura do
 * upstream naquele objeto é desfeita em silêncio na próxima sincronização.
 *
 * Não é hipótese. Na fusão de 23/09/2026 a nossa redefinição de
 * `fn_lgpd_cascade_redact_contact` entrava depois da dele e apagaria doze
 * tabelas da anonimização da LGPD. Nada falhava: nem o deploy, nem a suíte. O
 * dado só continuaria lá no dia em que um cliente pedisse exclusão.
 *
 *     npx vitest run tests/unit/schema-mia-estende-nunca-redefine.test.ts
 */

const RAIZ = process.cwd();
const BASELINE_UPSTREAM = readFileSync(join(RAIZ, "supabase", "baseline.sql"), "utf8");
const BASELINE_MIA = readFileSync(join(RAIZ, "supabase", "baseline-mia.sql"), "utf8");
const PASTA_MIA = join(RAIZ, "supabase", "migrations-mia");
const MANIFEST_MIA = readFileSync(join(PASTA_MIA, "MANIFEST.md"), "utf8");
const ARQUIVOS_MIA = readdirSync(PASTA_MIA).filter((f) => f.endsWith(".sql")).sort();

const ANCORA_VARREDURA =
  "-- ---- VARREDURA anon: função nova nasce exposta em quem ATUALIZA (migration 0116) ----";

/** A última migration da cadeia antiga da MIA. Daqui em diante, só a faixa 9000. */
const ULTIMA_DA_CADEIA_ANTIGA = 272;

/** Comentário não é código: a prosa dos nossos blocos cita objetos do upstream. */
function semComentario(sql: string): string {
  return sql
    .split("\n")
    .map((l) => (l.trimStart().startsWith("--") ? "" : l))
    .join("\n");
}

/** `"public"."fn_x"`, `public.fn_x` e `fn_x` são o mesmo objeto para o Postgres. */
function normalizar(nome: string): string {
  return nome.replace(/"/g, "").replace(/^public\./i, "").toLowerCase();
}

function nomesDe(sql: string, re: RegExp): Set<string> {
  return new Set([...semComentario(sql).matchAll(re)].map((m) => normalizar(m[1] ?? "")));
}

const TIPOS = {
  função: /create\s+(?:or\s+replace\s+)?function\s+((?:"?public"?\.)?"?[a-z0-9_]+"?)/gi,
  gatilho: /create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+("?[a-z0-9_]+"?)/gi,
  view: /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+((?:"?public"?\.)?"?[a-z0-9_]+"?)/gi,
  constraint: /add\s+constraint\s+("?[a-z0-9_]+"?)/gi,
} as const;

/**
 * Exceções declaradas: objeto do upstream que a MIA redefine DE PROPÓSITO.
 *
 * Vazia, e é assim que ela deve continuar. Entrar aqui exige o motivo por
 * escrito — e o motivo tem de explicar por que não dá para estender (gatilho
 * próprio, tabela nova, função com nome nosso). "É mais rápido" não é motivo:
 * é exatamente o atalho que produziu o buraco da LGPD.
 */
const REDEFINICOES_DECLARADAS: Record<string, string> = {};

function numeroDe(arquivo: string): number {
  const m = arquivo.match(/^\d{14}_(\d{4})_/);
  return m ? Number(m[1]) : NaN;
}

describe("o schema da MIA estende o do upstream, nunca o redefine", () => {
  for (const [tipo, re] of Object.entries(TIPOS)) {
    it(`nenhum(a) ${tipo} do upstream é redefinido(a) pelo baseline-mia.sql`, () => {
      const doUpstream = nomesDe(BASELINE_UPSTREAM, re);
      const redefinidos = [...nomesDe(BASELINE_MIA, re)].filter(
        (n) => doUpstream.has(n) && !(n in REDEFINICOES_DECLARADAS),
      );
      expect(
        redefinidos,
        `${tipo} do upstream redefinido(a) pela MIA — vale o nosso por rodar depois, e a próxima ` +
          "melhoria do upstream nele(a) seria desfeita em silêncio. Estenda (gatilho próprio, " +
          "tabela nova, nome nosso) ou declare em REDEFINICOES_DECLARADAS com o motivo.",
      ).toEqual([]);
    });
  }

  it("o baseline do upstream não carrega objeto da MIA (ele é do upstream, byte a byte)", () => {
    // Se algum destes aparecer lá, alguém editou o arquivo do upstream — e a
    // próxima sincronização vira conflito, ou apaga o que foi posto lá.
    for (const daMia of ["fn_mia_", "platform_api_tokens", "schema_baseline", "crm_empresas"]) {
      expect(semComentario(BASELINE_UPSTREAM), `objeto da MIA no baseline do upstream: ${daMia}`).not.toContain(
        daMia,
      );
    }
  });

  it("o instrumento enxerga uma redefinição quando ela existe (controle negativo)", () => {
    const sabotado =
      BASELINE_MIA + "\ncreate or replace function public.fn_lgpd_cascade_redact_contact() returns void as $$ $$;\n";
    const doUpstream = nomesDe(BASELINE_UPSTREAM, TIPOS["função"]);
    const achados = [...nomesDe(sabotado, TIPOS["função"])].filter((n) => doUpstream.has(n));
    expect(achados).toContain("fn_lgpd_cascade_redact_contact");
  });
});

describe("a varredura anon fecha o schema da MIA", () => {
  it("existe exatamente uma vez", () => {
    expect(BASELINE_MIA.split(ANCORA_VARREDURA).length - 1).toBe(1);
  });

  it("nada é criado nem reconcedido a anon depois dela", () => {
    const depois = semComentario(BASELINE_MIA.slice(BASELINE_MIA.lastIndexOf(ANCORA_VARREDURA)));
    expect(depois.match(/create\s+(or\s+replace\s+)?function/gi) ?? []).toEqual([]);
    expect(depois.match(/grant[^;]*\bto\b[^;]*\banon\b/gi) ?? []).toEqual([]);
  });
});

describe("as migrations da MIA moram na pasta delas, com MANIFEST próprio", () => {
  // A partir da 9019 (05/10/2026) a MIA segue a convenção nova do upstream
  // (1.70, #2149): a descrição de migration nova mora numa linha
  // `-- manifest: <o quê e por quê>` do próprio .sql, e o MANIFEST vira
  // histórico. Duas frentes em paralelo acrescentando linha no FIM da mesma
  // tabela conflitavam sempre. "Registrada" passa a ser: linha no MANIFEST OU
  // cabeçalho com descrição; nos dois ao mesmo tempo, não (duas fontes para o
  // mesmo fato divergem).
  it("todo arquivo se descreve num lugar só: linha no MANIFEST ou cabeçalho `-- manifest:`", () => {
    const linhas = MANIFEST_MIA.split("\n").filter((l) => /^\| `\d{14}` \|/.test(l));
    const comLinha = new Set(
      linhas.map((l) => {
        const [, ts, nome] = l.match(/^\| `(\d{14})` \| `([^`]+)`/) ?? [];
        return `${ts}_${nome}`;
      }),
    );
    for (const f of ARQUIVOS_MIA) {
      const nome = f.replace(/\.sql$/, "");
      const cabecalho = readFileSync(join(PASTA_MIA, f), "utf8")
        .split("\n")
        .find((l) => l.startsWith("-- manifest:"));
      const temCabecalho = Boolean(cabecalho && cabecalho.slice("-- manifest:".length).trim().length > 0);
      const temLinha = comLinha.has(nome);
      expect(temCabecalho || temLinha, `sem descrição (nem linha no MANIFEST da MIA, nem \`-- manifest:\`): ${f}`).toBe(true);
      expect(temCabecalho && temLinha, `descrita nos DOIS lugares (MANIFEST e cabeçalho): ${f}`).toBe(false);
    }
    // E toda linha do MANIFEST tem arquivo.
    const arquivos = new Set(ARQUIVOS_MIA.map((f) => f.replace(/\.sql$/, "")));
    expect([...comLinha].filter((n) => !arquivos.has(n)), "linha do MANIFEST sem arquivo").toEqual([]);
  });

  it("número e timestamp não se repetem", () => {
    const numeros = ARQUIVOS_MIA.map(numeroDe);
    const timestamps = ARQUIVOS_MIA.map((f) => f.slice(0, 14));
    expect(new Set(numeros).size).toBe(numeros.length);
    expect(new Set(timestamps).size).toBe(timestamps.length);
  });

  it("migration nova da MIA usa a faixa 9000 — nunca a do upstream", () => {
    // As 0239..0272 são história e mantêm o número. Qualquer outra abaixo de
    // 9000 colide com a numeração do upstream, que hoje passa de 0390 e cresce.
    const foraDaFaixa = ARQUIVOS_MIA.filter((f) => {
      const n = numeroDe(f);
      return n > ULTIMA_DA_CADEIA_ANTIGA && (n < 9000 || n > 9999);
    });
    expect(foraDaFaixa, "migration nova da MIA fora da faixa 9000–9999").toEqual([]);
  });

  it("toda migration da MIA tem o seu bloco no baseline-mia.sql", () => {
    const semBloco = ARQUIVOS_MIA.filter((f) => {
      const n = String(numeroDe(f)).padStart(4, "0");
      return !BASELINE_MIA.includes(n);
    });
    expect(semBloco, "migration da MIA sem bloco no baseline-mia.sql — a produção nunca a aplicaria").toEqual([]);
  });

  it("nenhuma migration da MIA sobrou na pasta do upstream", () => {
    const doUpstream = readdirSync(join(RAIZ, "supabase", "migrations")).filter((f) => f.endsWith(".sql"));
    const nossas = new Set(ARQUIVOS_MIA);
    expect(doUpstream.filter((f) => nossas.has(f))).toEqual([]);
  });
});

describe("o baseline-mia.sql instala num banco NOVO, não só atualiza o de produção", () => {
  // Numa atualização o banco já tem tudo, e a ordem dos blocos não aparece. Num
  // banco novo aparece: em 28/09 o bloco da 0263 (`alter table crm_empresas`)
  // vinha antes do da 0255, que cria a tabela, e a instalação morria na linha 66.
  // A prova de verdade é o gate de banco (scripts/test-db.sh e
  // test-update-com-dados.sh aplicam este arquivo com ON_ERROR_STOP); estas duas
  // são a versão barata, que roda em todo PR.
  it("os blocos seguem a ordem das migrations, com a varredura por último", () => {
    const linhas = BASELINE_MIA.split("\n");
    const numeros: number[] = [];
    for (let i = 0; i < linhas.length; i += 1) {
      const linha = linhas[i] ?? "";
      const m =
        linha.match(/^-- ---- .*\(migration (\d{4})\) ----$/) ??
        linha.match(/^-- ─── (\d{4}) · /) ??
        (/^-- =+$/.test(linha) ? (linhas[i + 1] ?? "").match(/^-- APENDICE (\d{4})/) : null);
      if (m) numeros.push(Number(m[1]));
    }
    const semVarredura = numeros.slice(0, -1);
    expect(numeros.length, "nenhum bloco reconhecido: o instrumento ficou cego").toBeGreaterThan(30);
    expect(numeros.at(-1), "o último bloco tem de ser a varredura anon (0116)").toBe(116);
    expect(semVarredura, "bloco fora da ordem das migrations").toEqual([...semVarredura].sort((a, b) => a - b));
  });

  it("todo `$$` aberto é fechado", () => {
    // `end$;` no lugar de `end $$;` deixou uma string aberta: o psql desalinhou o
    // resto do arquivo e 26 comandos, o carimbo entre eles, não rodavam no deploy.
    const dolares = semComentario(BASELINE_MIA).match(/\$\$/g) ?? [];
    expect(dolares.length % 2, "número ímpar de `$$`: alguma função ficou sem fechar").toBe(0);
    expect(semComentario(BASELINE_MIA), "`end$` fecha com UM cifrão: é `end $$`").not.toMatch(/\bend\$(?!\$)/i);
  });
});

describe("a tabela que nunca existiu não volta", () => {
  it("baseline-mia.sql não altera public.followup_flows", () => {
    // A 0270 mirou essa tabela e errou em TODO deploy desde a .46 — era o
    // `erros: 1` da saúde, que ficou dias sem explicação. A das réguas é
    // `followup_flow_pointers`.
    expect(semComentario(BASELINE_MIA)).not.toMatch(/public\.followup_flows\b/);
  });
});
