import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { arquivosDeCodigo, caminhoRelativo } from "./helpers/varrer-codigo";

/**
 * FORK MIA (MIA-340) — WORKER E CRON NÃO LEEM SEM TETO.
 *
 * ## O defeito
 *
 * O PostgREST devolve no máximo 1000 linhas por pedido (`supabase/config.toml`,
 * `max_rows`) e não avisa. Uma leitura `.from(...).select(...)` sem `.range()`
 * funciona em teste e em cliente pequeno, e quebra calada quando o cliente
 * cresce. Em worker e cron isso é pior do que numa tela, porque ninguém olha o
 * resultado: o observador de risco gravou "Negócio esfriou" mais de 20 mil vezes
 * por dia numa empresa (MIA-267) porque metade dos estados gravados ficava fora
 * da página, e a lista de empresas do mesmo cron só via quem caía nas primeiras
 * 1000 linhas (MIA-320).
 *
 * ## A régua
 *
 * Em `lib/**\/*worker*`, `lib/**\/*sweep*` e `app/api/v1/cron/**`, toda cadeia
 * que começa em `.from(...).select(...)` tem de ter teto ou paginar:
 * `.range()`, `.limit()`, `.single()`, `.maybeSingle()` ou `head: true` no
 * `select`. Contam também, por serem a mesma cadeia escrita em dois passos:
 *
 *   · o construtor guardado numa variável (`let q = db.from(…).select(…)`, ou a
 *     função `const base = () => db.from(…).select(…)`) que recebe o teto depois
 *     (`q.range(…)`, `base().limit(…)`);
 *   · a cadeia embrulhada numa chamada que devolve a mesma cadeia
 *     (`filtro(db.from(…).select(…), …).limit(…)`);
 *   · a consulta de lote entregue a `buscaEmLotesSemTeto`, que põe a ordem e o
 *     `range` ele mesmo (`lib/leitura/em-lotes-sem-teto.ts`).
 *
 * Para ler tudo, o auxiliar é `lerTodasAsPaginas` (`lib/leitura/todas-as-paginas.ts`):
 * ordem estável numa chave única, contagem na primeira página, e `truncado`
 * quando o teto de páginas acaba antes do fim.
 *
 * ## A lista
 *
 * As leituras sem teto que existiam em 27/11/2026 estão em `CONHECIDAS`, por
 * arquivo e tabela, com quantas são e a classe:
 *
 *   · `teto natural`: o conjunto é pequeno por construção (uma linha por id de
 *     uma lista que já veio com teto, os números de UMA empresa, um aviso por
 *     contato e ano num lote de 100). O motivo diz qual é o teto;
 *   · `a trocar`: o conjunto cresce com a empresa ou com a instalação, e hoje
 *     cabe em 1000 linhas por sorte do tamanho. Troca para o auxiliar quando
 *     alguém mexer no arquivo, ou antes, quando a contagem na produção chegar
 *     perto de 1000;
 *   · `resolvido`: já trocado num PR que ainda não entrou na `main`. A entrada
 *     some quando ele entrar (a régua aceita zero para esta classe).
 *
 * Leitura sem teto FORA da lista derruba a CI. A lista só encolhe: se uma
 * leitura da lista foi trocada, a régua pede para baixar o número (ou apagar a
 * entrada), senão a vaga ficaria aberta para a próxima leitura sem teto do
 * mesmo arquivo.
 *
 * ## O que esta régua NÃO vê (declarado)
 *
 *   · `rpc(...)`: a função do banco pode devolver lista grande, e o teto de
 *     1000 vale para ela também. Fica para a régua seguinte;
 *   · o `workers/` da raiz (agente, voz, sentimento): fora do escopo da
 *     MIA-340, que é `lib/` de worker e sweep e as rotas de cron;
 *   · se o teto que existe é o CERTO: um `.limit(5000)` passa aqui e devolve
 *     1000. Isso é matéria de revisão e de `curso-tetos-do-supabase`;
 *   · se a ordem da paginação é estável: o auxiliar documenta, a revisão confere.
 */

const TETOS = new Set(["range", "limit", "single", "maybeSingle"]);

/** Quem recebe a consulta SEM `range` e pagina ela mesmo. */
const PAGINADORES = new Set(["buscaEmLotesSemTeto"]);

type Classe = "teto natural" | "a trocar" | "resolvido";

interface Conhecida {
  arquivo: string;
  tabela: string;
  /** Quantas leituras sem teto desta tabela este arquivo tem hoje. */
  quantas: number;
  classe: Classe;
  motivo: string;
}

const CRON = "app/api/v1/cron";

/** As leituras sem teto de 27/11/2026. Só encolhe. */
const CONHECIDAS: readonly Conhecida[] = [
  {
    arquivo: "lib/followup/silence-sweep.ts",
    tabela: "followup_flow_pointers",
    quantas: 1,
    classe: "a trocar",
    motivo: "Os fluxos ativos de TODAS as empresas; cresce com empresas × fluxos.",
  },
  {
    arquivo: `${CRON}/agenda-expira-pendentes/route.ts`,
    tabela: "organizations",
    quantas: 1,
    classe: "teto natural",
    motivo: "Uma linha por empresa das pendências lidas com `.limit(LIMITE_DA_VARREDURA)` (500).",
  },
  {
    arquivo: `${CRON}/agenda-microsoft-sync/route.ts`,
    tabela: "mia_agenda_microsoft_conexoes",
    quantas: 1,
    classe: "a trocar",
    motivo: "As conexões do Outlook saudáveis da instalação inteira; cresce com usuários.",
  },
  {
    arquivo: `${CRON}/catalog-feed-sync/route.ts`,
    tabela: "catalog_products",
    quantas: 1,
    classe: "a trocar",
    motivo:
      "O catálogo inteiro de uma empresa, comparado com o feed. Com mais de 1000 produtos, o que " +
      "ficasse fora da página pareceria novo e seria gravado de novo.",
  },
  {
    arquivo: `${CRON}/contact-avatars/route.ts`,
    tabela: "channel_sessions",
    quantas: 1,
    classe: "teto natural",
    motivo: "Os números conectados de UMA empresa.",
  },
  {
    arquivo: `${CRON}/contact-birthdays/route.ts`,
    tabela: "organizations",
    quantas: 1,
    classe: "teto natural",
    motivo: "Lotes de `TAMANHO_DO_LOTE` (100) ids de empresa, uma linha por id (MIA-369).",
  },
  {
    arquivo: `${CRON}/contact-birthdays/route.ts`,
    tabela: "event_log",
    quantas: 2,
    classe: "teto natural",
    motivo:
      "Lote de 100 contatos: um aviso por contato, regra e ano, e os da janela recente da mesma regra.",
  },
  {
    arquivo: `${CRON}/contact-proposals-watcher/route.ts`,
    tabela: "contact_field_proposals",
    quantas: 1,
    classe: "a trocar",
    motivo:
      "Monta a lista de empresas a partir das propostas vencidas da instalação inteira: a mesma " +
      "forma da lista do observador de risco (MIA-320).",
  },
  {
    arquivo: `${CRON}/contact-proposals-watcher/route.ts`,
    tabela: "lead_field_proposals",
    quantas: 1,
    classe: "a trocar",
    motivo: "Idem, com as propostas de campo do card.",
  },
  {
    arquivo: `${CRON}/followup-sem-agente/route.ts`,
    tabela: "followup_flow_versions",
    quantas: 1,
    classe: "teto natural",
    motivo: "Uma linha por id, e os ids vêm de leitura com `.limit(LIMITE_DA_VARREDURA)` (500).",
  },
  {
    arquivo: `${CRON}/handoff-devolucao/route.ts`,
    tabela: "organizations",
    quantas: 1,
    classe: "a trocar",
    motivo: "As empresas com prazo de devolução, da instalação inteira.",
  },
  {
    arquivo: `${CRON}/handoff-devolucao/route.ts`,
    tabela: "ai_agents",
    quantas: 1,
    classe: "a trocar",
    motivo: "Os agentes publicados de todas as empresas com prazo; cresce com a instalação.",
  },
  {
    arquivo: `${CRON}/handoff-devolucao/route.ts`,
    tabela: "ai_routers",
    quantas: 1,
    classe: "a trocar",
    motivo: "Os roteadores ativos de todas as empresas com prazo; cresce com a instalação.",
  },
  {
    arquivo: `${CRON}/kb-conversations-batch/route.ts`,
    tabela: "ai_agents",
    quantas: 1,
    classe: "a trocar",
    motivo: "Os agentes ativos da instalação inteira.",
  },
  {
    arquivo: `${CRON}/lead-date-field-due/route.ts`,
    tabela: "organizations",
    quantas: 1,
    classe: "teto natural",
    motivo: "Lotes de `TAMANHO_DO_LOTE` (100) ids de empresa, uma linha por id (MIA-369).",
  },
  {
    arquivo: `${CRON}/lead-time-triggers/route.ts`,
    tabela: "organizations",
    quantas: 1,
    classe: "teto natural",
    motivo: "Lotes de `TAMANHO_DO_LOTE` (100) ids de empresa, uma linha por id (MIA-369).",
  },
  {
    arquivo: `${CRON}/proposta-travada/route.ts`,
    tabela: "messages",
    quantas: 1,
    classe: "teto natural",
    motivo: "Uma linha por id, e os ids vêm de leitura com `.limit(SCAN_LIMIT)` (500).",
  },
  {
    arquivo: `${CRON}/recurring-entries/route.ts`,
    tabela: "recurring_entries",
    quantas: 1,
    classe: "a trocar",
    motivo: "Os lançamentos recorrentes ativos da instalação inteira.",
  },
  {
    arquivo: `${CRON}/relatorio-operacao-diario/route.ts`,
    tabela: "TABELA_DOS_RELATORIOS",
    quantas: 1,
    classe: "teto natural",
    motivo: "Lote de 200 empresas, um relatório por empresa e dia, só hoje e ontem.",
  },
  {
    arquivo: `${CRON}/risk-watcher/route.ts`,
    tabela: "crm_leads",
    quantas: 1,
    classe: "resolvido",
    motivo: "Trocada por `lerTodasAsPaginas` no PR #168 (MIA-320), que entra na .120.",
  },
  {
    arquivo: `${CRON}/rodizio-devolucao/route.ts`,
    tabela: "organizations",
    quantas: 1,
    classe: "a trocar",
    motivo: "As empresas com prazo de devolução ao rodízio, da instalação inteira.",
  },
  {
    arquivo: `${CRON}/sync-model-catalog/route.ts`,
    tabela: "ai_models",
    quantas: 1,
    classe: "a trocar",
    motivo:
      "O catálogo de modelos da plataforma, que só cresce (o aposentado fica marcado). Com mais de " +
      "1000, o que ficasse fora da página pareceria novo.",
  },
  {
    arquivo: `${CRON}/task-reminder/route.ts`,
    tabela: "user_organizations",
    quantas: 1,
    classe: "teto natural",
    motivo: "Os vínculos dos responsáveis de até 200 tarefas (`LIMITE_DA_VARREDURA`).",
  },
  {
    arquivo: `${CRON}/task-reminder/route.ts`,
    tabela: "agent_inbox_items",
    quantas: 1,
    classe: "a trocar",
    motivo:
      "Os avisos de até 200 tarefas, mas vários por tarefa (um por prazo e responsável): passa de 1000.",
  },
  {
    arquivo: `${CRON}/varredura-de-avisos/route.ts`,
    tabela: "conversations",
    quantas: 1,
    classe: "teto natural",
    motivo: "Uma linha por id, e os ids vêm de leitura com `.limit(LIMITE)` (500).",
  },
  {
    arquivo: `${CRON}/varredura-de-avisos/route.ts`,
    tabela: "job_queue",
    quantas: 1,
    classe: "teto natural",
    motivo: "Uma linha por id, e os ids vêm de leitura com `.limit(LIMITE)` (500).",
  },
  {
    arquivo: `${CRON}/varredura-de-avisos/route.ts`,
    tabela: "crm_tasks",
    quantas: 1,
    classe: "teto natural",
    motivo: "Uma linha por id, e os ids vêm de leitura com `.limit(LIMITE)` (500).",
  },
];

interface LeituraSemTeto {
  arquivo: string;
  linha: number;
  tabela: string;
}

/** Sobe por `await`, parênteses e `as`, que não mudam a cadeia. */
function semEmbrulho(no: ts.Node): ts.Node {
  let atual = no;
  while (
    atual.parent &&
    (ts.isAwaitExpression(atual.parent) ||
      ts.isParenthesizedExpression(atual.parent) ||
      ts.isAsExpression(atual.parent) ||
      ts.isNonNullExpression(atual.parent) ||
      ts.isSatisfiesExpression(atual.parent))
  ) {
    atual = atual.parent;
  }
  return atual;
}

/**
 * Sobe a cadeia a partir do `.from(...)`: cada `.metodo(...)` seguinte, e a
 * chamada que EMBRULHA a cadeia (`f(cadeia, …).limit()`), devolvendo os nomes
 * dos métodos e o topo.
 */
function subirCadeia(from: ts.CallExpression): { metodos: { nome: string; chamada: ts.CallExpression }[]; topo: ts.Expression } {
  const metodos: { nome: string; chamada: ts.CallExpression }[] = [];
  let topo: ts.Expression = from;
  for (;;) {
    const pai = topo.parent;
    if (ts.isPropertyAccessExpression(pai) && pai.expression === topo && ts.isCallExpression(pai.parent) && pai.parent.expression === pai) {
      metodos.push({ nome: pai.name.text, chamada: pai.parent });
      topo = pai.parent;
      continue;
    }
    // A cadeia como ARGUMENTO de uma chamada que é, ela mesma, o começo de
    // outra cadeia (`filtro(cadeia, …).eq(…).limit(…)`): segue pela chamada.
    if (
      metodos.length > 0 &&
      ts.isCallExpression(pai) &&
      pai.arguments.includes(topo) &&
      ts.isPropertyAccessExpression(pai.parent) &&
      pai.parent.expression === pai
    ) {
      topo = pai;
      continue;
    }
    return { metodos, topo };
  }
}

function selectTemHead(chamada: ts.CallExpression): boolean {
  const opcoes = chamada.arguments[1];
  return (
    opcoes !== undefined &&
    ts.isObjectLiteralExpression(opcoes) &&
    opcoes.properties.some(
      (p) =>
        ts.isPropertyAssignment(p) &&
        p.name.getText() === "head" &&
        p.initializer.kind === ts.SyntaxKind.TrueKeyword,
    )
  );
}

/** O nome que guarda a cadeia (`q = cadeia`) ou a função que a devolve (`base = () => cadeia`). */
function nomeQueGuarda(topo: ts.Expression): string | null {
  let no = semEmbrulho(topo);
  // `const base = () => cadeia`
  if (ts.isArrowFunction(no.parent) && no.parent.body === no) no = no.parent;
  const pai = no.parent;
  if (ts.isVariableDeclaration(pai) && pai.initializer === no && ts.isIdentifier(pai.name)) return pai.name.text;
  if (
    ts.isBinaryExpression(pai) &&
    pai.right === no &&
    pai.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(pai.left)
  ) {
    return pai.left.text;
  }
  return null;
}

/** No escopo da cadeia, alguém faz `nome.range(…)` ou `nome().limit(…)`? */
function tetoPeloNome(topo: ts.Expression, nome: string): boolean {
  let escopo: ts.Node = topo;
  while (!ts.isSourceFile(escopo) && !(ts.isFunctionLike(escopo) && !ts.isArrowFunction(escopo))) {
    escopo = escopo.parent;
  }
  let achou = false;
  const visitar = (no: ts.Node): void => {
    if (achou) return;
    if (ts.isPropertyAccessExpression(no) && TETOS.has(no.name.text)) {
      const alvo = no.expression;
      if (ts.isIdentifier(alvo) && alvo.text === nome) achou = true;
      if (ts.isCallExpression(alvo) && ts.isIdentifier(alvo.expression) && alvo.expression.text === nome) achou = true;
    }
    ts.forEachChild(no, visitar);
  };
  visitar(escopo);
  return achou;
}

/** A cadeia é o corpo de uma função entregue a um paginador conhecido? */
function entregueAoPaginador(topo: ts.Expression): boolean {
  for (let no: ts.Node = topo; !ts.isSourceFile(no); no = no.parent) {
    if (ts.isArrowFunction(no) || ts.isFunctionExpression(no)) {
      const chamada = no.parent;
      return (
        ts.isCallExpression(chamada) &&
        chamada.arguments.includes(no) &&
        ts.isIdentifier(chamada.expression) &&
        PAGINADORES.has(chamada.expression.text)
      );
    }
  }
  return false;
}

/** As leituras `.from(...).select(...)` sem teto de um texto de código. */
function leiturasSemTeto(texto: string, arquivo: string): LeituraSemTeto[] {
  const fonte = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, true);
  const achadas: LeituraSemTeto[] = [];
  const visitar = (no: ts.Node): void => {
    if (
      ts.isCallExpression(no) &&
      ts.isPropertyAccessExpression(no.expression) &&
      no.expression.name.text === "from" &&
      no.arguments.length > 0
    ) {
      const { metodos, topo } = subirCadeia(no);
      const primeiro = metodos[0];
      // Só LEITURA: `.from().insert().select()` devolve o que escreveu.
      if (primeiro?.nome === "select") {
        const nome = nomeQueGuarda(topo);
        const temTeto =
          metodos.some((m) => TETOS.has(m.nome)) ||
          selectTemHead(primeiro.chamada) ||
          entregueAoPaginador(topo) ||
          (nome !== null && tetoPeloNome(topo, nome));
        if (!temTeto) {
          const arg = no.arguments[0];
          achadas.push({
            arquivo,
            linha: fonte.getLineAndCharacterOfPosition(no.getStart(fonte)).line + 1,
            tabela: arg === undefined ? "?" : ts.isStringLiteralLike(arg) ? arg.text : arg.getText(fonte),
          });
        }
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return achadas;
}

function noEscopo(relativo: string): boolean {
  if (relativo.startsWith(`${CRON}/`)) return true;
  if (!relativo.startsWith("lib/")) return false;
  const nome = relativo.slice(relativo.lastIndexOf("/") + 1);
  return /worker|sweep/.test(nome);
}

const ARQUIVOS = arquivosDeCodigo(["lib", CRON])
  .map((abs) => ({ abs, relativo: caminhoRelativo(abs) }))
  .filter(({ relativo }) => noEscopo(relativo));

const ACHADAS = ARQUIVOS.flatMap(({ abs, relativo }) => leiturasSemTeto(readFileSync(abs, "utf8"), relativo));

const chave = (arquivo: string, tabela: string) => `${arquivo} :: ${tabela}`;

describe("worker e cron não leem sem teto (MIA-340)", () => {
  it("controle positivo: a varredura alcança os workers, o sweep e as rotas de cron", () => {
    const relativos = ARQUIVOS.map((a) => a.relativo);
    expect(relativos).toContain("lib/leads/risk-worker.ts");
    expect(relativos).toContain("lib/followup/silence-sweep.ts");
    expect(relativos).toContain(`${CRON}/risk-watcher/route.ts`);
    expect(relativos.filter((r) => r.startsWith(`${CRON}/`)).length).toBeGreaterThan(40);
    // E ACHA alguma coisa: zero achados seria indistinguível de varredura quebrada.
    expect(ACHADAS.length).toBeGreaterThan(10);
  });

  it("a régua, em código de mentira", () => {
    const achar = (codigo: string) => leiturasSemTeto(codigo, "x.ts").map((a) => a.tabela);

    // Sem teto: acusa.
    expect(achar(`async function f(db) { const { data } = await db.from("a").select("id").eq("x", 1); }`)).toEqual(["a"]);
    expect(achar(`async function f(db) { let q = db.from("b").select("id"); q = q.eq("x", 1); await q; }`)).toEqual(["b"]);
    // `.order()` não é teto.
    expect(achar(`async function f(db) { await db.from("c").select("id").order("id"); }`)).toEqual(["c"]);

    // Com teto: passa.
    expect(achar(`async function f(db) { await db.from("a").select("id").range(0, 999); }`)).toEqual([]);
    expect(achar(`async function f(db) { await db.from("a").select("id").limit(10); }`)).toEqual([]);
    expect(achar(`async function f(db) { await db.from("a").select("id").eq("id", 1).single(); }`)).toEqual([]);
    expect(achar(`async function f(db) { await db.from("a").select("id").eq("id", 1).maybeSingle(); }`)).toEqual([]);
    expect(achar(`async function f(db) { await db.from("a").select("id", { count: "exact", head: true }); }`)).toEqual([]);
    expect(achar(`async function f(db) { let q = db.from("a").select("id"); q = q.eq("x", 1); await q.range(0, 9); }`)).toEqual([]);
    expect(achar(`async function f(db) { const base = () => db.from("a").select("id"); await base().limit(5); }`)).toEqual([]);
    expect(achar(`async function f(db) { await filtro(db.from("a").select("id"), 1).eq("y", 2).limit(5); }`)).toEqual([]);
    expect(
      achar(`async function f(db, ids) { await buscaEmLotesSemTeto(ids, (lote, c) => db.from("a").select("id", c).in("id", lote)); }`),
    ).toEqual([]);
    expect(
      achar(`async function f(db) { await lerTodasAsPaginas((de, ate) => db.from("a").select("id").order("id").range(de, ate), { paginasMaximas: 5 }); }`),
    ).toEqual([]);

    // Escrita que devolve o que escreveu não é leitura.
    expect(achar(`async function f(db) { await db.from("a").insert({ x: 1 }).select("id"); }`)).toEqual([]);
    expect(achar(`async function f(db) { await db.from("a").update({ x: 1 }).eq("id", 1).select("id"); }`)).toEqual([]);
  });

  it("nenhuma leitura sem teto fora da lista CONHECIDAS", () => {
    const permitidas = new Map(CONHECIDAS.map((c) => [chave(c.arquivo, c.tabela), c.quantas]));
    const porChave = new Map<string, LeituraSemTeto[]>();
    for (const a of ACHADAS) {
      const k = chave(a.arquivo, a.tabela);
      porChave.set(k, [...(porChave.get(k) ?? []), a]);
    }
    const novas = [...porChave].flatMap(([k, lidas]) =>
      lidas.length > (permitidas.get(k) ?? 0) ? lidas.map((l) => `${l.arquivo}:${l.linha} (${l.tabela})`) : [],
    );
    expect(
      novas,
      "Leitura `.from(...).select(...)` sem `.range()`, `.limit()`, `.single()`, `.maybeSingle()` ou " +
        "`head: true` num worker ou cron. O PostgREST corta em 1000 linhas sem avisar. Leia com " +
        "`lerTodasAsPaginas` (lib/leitura/todas-as-paginas.ts), ordenando por uma chave única, ou ponha " +
        "o teto que o conjunto tem de verdade. Se o conjunto é pequeno por construção, declare em " +
        "CONHECIDAS com a classe \"teto natural\" e o motivo.",
    ).toEqual([]);
  });

  it("a lista só encolhe: entrada trocada baixa o número ou sai", () => {
    const contagem = new Map<string, number>();
    for (const a of ACHADAS) contagem.set(chave(a.arquivo, a.tabela), (contagem.get(chave(a.arquivo, a.tabela)) ?? 0) + 1);
    const sobrando = CONHECIDAS.filter((c) => {
      const hoje = contagem.get(chave(c.arquivo, c.tabela)) ?? 0;
      return c.classe === "resolvido" ? hoje > c.quantas : hoje !== c.quantas;
    }).map((c) => `${chave(c.arquivo, c.tabela)}: a lista diz ${c.quantas}, o código tem ${contagem.get(chave(c.arquivo, c.tabela)) ?? 0}`);
    expect(sobrando, "Ajuste `quantas` (ou apague a entrada) em CONHECIDAS.").toEqual([]);
  });

  it("toda entrada tem classe e motivo, e não se repete", () => {
    const chaves = CONHECIDAS.map((c) => chave(c.arquivo, c.tabela));
    expect(new Set(chaves).size).toBe(chaves.length);
    for (const c of CONHECIDAS) {
      expect(["teto natural", "a trocar", "resolvido"]).toContain(c.classe);
      expect(c.motivo.length, chave(c.arquivo, c.tabela)).toBeGreaterThan(20);
      expect(c.quantas).toBeGreaterThan(0);
    }
  });
});
