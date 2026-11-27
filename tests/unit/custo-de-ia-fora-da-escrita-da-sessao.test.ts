/**
 * FORK MIA (MIA-251 D) · O CUSTO DE IA SÓ O SERVIDOR GRAVA.
 *
 * `llm_calls.cost_cents` é a régua do teto do plano (`fn_gasto_de_ia_do_mes`,
 * `lib/agent-engine/edge/llm/orcamento.ts`) e do "IA do mês" da cobrança. Até a
 * migration 9173, `authenticated` tinha INSERT e UPDATE em `llm_calls` e em
 * `ai_agent_runs`: qualquer membro, pelo PostgREST, zerava o gasto do mês com um
 * `update llm_calls set cost_cents = 0`. A 9173 (`fn_mia_colunas_de_ia_fechadas`)
 * tirou a escrita da sessão e deixou só `update (tool_calls)` em `ai_agent_runs`,
 * que é o que a anonimização LGPD grava (`lib/lgpd/cascata.ts`, passo 6).
 *
 * Esta cerca é a metade do código: escrita nova pela SESSÃO nessas duas tabelas
 * daria 42501 em produção, calada para quem escreveu (o teste de rota mocka o
 * cliente). Ela reprova `insert`, `update`, `upsert` e `delete` em `llm_calls` ou
 * `ai_agent_runs` cujo cliente não seja o admin, provado pela ORIGEM ou pelo TIPO
 * (o mesmo resolvedor de `escrita-em-organizations-usa-cliente-admin.test.ts`,
 * em `./helpers/cliente-admin`). A única escrita da sessão aceita é o
 * `update` de `ai_agent_runs` que só toca `tool_calls`, igual à permissão do banco.
 *
 * Na fusão do upstream: escritor novo dele nessas tabelas vai pelo cliente admin
 * depois do portão (`docs/fork/ia-da-plataforma.md`, conferência da fusão).
 *
 *     npx vitest run tests/unit/custo-de-ia-fora-da-escrita-da-sessao.test.ts
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { arquivosDeCodigo, caminhoRelativo } from "./helpers/varrer-codigo";
import {
  caminhoDaCadeia,
  caminhosDoClienteAdmin,
  ehReceptorAdmin,
  escopoDeTipos,
  raizDaCadeia,
} from "./helpers/cliente-admin";

const RAIZES = ["app", "lib", "workers", "components", "hooks"] as const;
const TABELAS = new Set(["llm_calls", "ai_agent_runs"]);
const MUTACOES = new Set(["update", "insert", "upsert", "delete"]);

/** O que o banco deixa a sessão gravar (9173): só esta coluna, só nesta tabela. */
const COLUNAS_QUE_A_SESSAO_GRAVA: Readonly<Record<string, ReadonlySet<string>>> = {
  ai_agent_runs: new Set(["tool_calls"]),
};

/**
 * Arquivos cujo cliente chega por parâmetro de tipo genérico (`SupabaseClient`),
 * que o resolvedor não tem como provar, com o motivo escrito: quem chama e com
 * que cliente. Esta lista só encolhe. Quem acrescentar um nome aqui está dizendo
 * que TODO chamador entrega o cliente admin, e diz qual.
 */
const LIBERADOS = new Map<string, string>([
  [
    "lib/agent-engine/edge/crm/send-voice.ts",
    "`registrarCustoDeVoz` recebe `params.supabase`; os dois chamadores entregam o cliente de " +
      "serviço: a prévia de voz (`app/api/v1/ai/voz/preview/route.ts`, `createAdminClient()`) e o " +
      "turno (`send-message.ts`, `cfg.supabase` do motor, criado com a SERVICE_ROLE em `mcp-client.ts`).",
  ],
  [
    "lib/ai/agents/teste-da-versao.ts",
    "`testarVersaoDoAgente(admin, …)` só é chamado pela rota de teste da versão, que passa " +
      "`createAdminClient()` (`app/api/v1/ai/agents/[id]/versions/[vid]/test/route.ts`).",
  ],
]);

interface Achado {
  arquivo: string;
  linha: number;
  tabela: string;
  cliente: string;
  metodo: string;
}

/** As chaves do objeto literal do `update(...)`; `null` quando não dá para ler (spread, variável). */
function chavesDoUpdate(chamada: ts.CallExpression): Set<string> | null {
  const arg = chamada.arguments[0];
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return null;
  const chaves = new Set<string>();
  for (const p of arg.properties) {
    if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name !== undefined) {
      if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) chaves.add(p.name.text);
      else return null;
    } else {
      return null;
    }
  }
  return chaves;
}

function escritaQueOBancoAceita(tabela: string, metodo: string, chamada: ts.CallExpression): boolean {
  const permitidas = COLUNAS_QUE_A_SESSAO_GRAVA[tabela];
  if (permitidas === undefined || metodo !== "update") return false;
  const chaves = chavesDoUpdate(chamada);
  return chaves !== null && chaves.size > 0 && [...chaves].every((c) => permitidas.has(c));
}

function achadosNaFonte(fonte: ts.SourceFile, arquivo: string): Achado[] {
  const escopo = escopoDeTipos(fonte);
  const caminhos = caminhosDoClienteAdmin(fonte);
  const achados: Achado[] = [];

  const visitar = (no: ts.Node): void => {
    // `<cliente>.from("<tabela>").<mutação>(...)`
    if (
      ts.isCallExpression(no) &&
      ts.isPropertyAccessExpression(no.expression) &&
      MUTACOES.has(no.expression.name.text)
    ) {
      const alvo = no.expression.expression;
      const argumentoDoFrom = ts.isCallExpression(alvo) ? alvo.arguments[0] : undefined;
      if (
        ts.isCallExpression(alvo) &&
        ts.isPropertyAccessExpression(alvo.expression) &&
        alvo.expression.name.text === "from" &&
        argumentoDoFrom !== undefined &&
        ts.isStringLiteralLike(argumentoDoFrom) &&
        TABELAS.has(argumentoDoFrom.text)
      ) {
        const tabela = argumentoDoFrom.text;
        const metodo = no.expression.name.text;
        const receptor = alvo.expression.expression;
        const raiz = raizDaCadeia(receptor);
        const deServico = ehReceptorAdmin(receptor, fonte, escopo, caminhos);
        if (!deServico && !escritaQueOBancoAceita(tabela, metodo, no)) {
          achados.push({
            arquivo,
            linha: fonte.getLineAndCharacterOfPosition(no.getStart()).line + 1,
            tabela,
            cliente: caminhoDaCadeia(receptor) ?? raiz ?? "?",
            metodo,
          });
        }
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return achados;
}

const TOCA = /from\(\s*["'`](llm_calls|ai_agent_runs)["'`]\s*\)/;
const ARQUIVOS = arquivosDeCodigo(RAIZES);
const QUE_TOCAM = ARQUIVOS.filter((a) => TOCA.test(readFileSync(a, "utf8")));

function achadosDoArquivo(caminho: string): Achado[] {
  const texto = readFileSync(caminho, "utf8");
  const fonte = ts.createSourceFile(caminho, texto, ts.ScriptTarget.Latest, true);
  return achadosNaFonte(fonte, caminhoRelativo(caminho));
}

const fonteDe = (codigo: string): ts.SourceFile =>
  ts.createSourceFile("sintetico.ts", codigo, ts.ScriptTarget.Latest, true);

const IMPORTA_ADMIN = 'import { createAdminClient } from "@/lib/supabase/admin";\n';
const IMPORTA_SESSAO = 'import { createClient } from "@/lib/supabase/server";\n';

describe("o custo de IA só o servidor grava (9173)", () => {
  it("CONTROLE: a varredura enxerga quem toca as duas tabelas", () => {
    expect(ARQUIVOS.length).toBeGreaterThan(500);
    expect(
      QUE_TOCAM.length,
      "quase ninguém tocando `llm_calls`/`ai_agent_runs` é indistinguível de 'está tudo em ordem': a sonda cegou",
    ).toBeGreaterThan(15);
    // Os escritores conhecidos pelo cliente admin estão no alcance e passam.
    for (const conhecido of ["lib/ai/usage/registrar-chamada.ts", "lib/ai/runtime/finalize.ts"]) {
      const achado = QUE_TOCAM.find((a) => caminhoRelativo(a) === conhecido);
      expect(achado, `${conhecido} sumiu da varredura`).toBeDefined();
      expect(achadosDoArquivo(achado as string)).toEqual([]);
    }
  });

  it("nenhuma escrita em llm_calls ou ai_agent_runs pela sessão, fora o tool_calls da anonimização", () => {
    const achados = QUE_TOCAM.filter((a) => !LIBERADOS.has(caminhoRelativo(a))).flatMap(achadosDoArquivo);
    expect(
      achados.map((a) => `${a.arquivo}:${a.linha} ${a.cliente}.from("${a.tabela}").${a.metodo}(...)`),
      "escrita de custo de IA por cliente que não é o admin. Desde a 9173 a sessão recebe 42501 nessas " +
        "tabelas. Grave com o cliente admin (`createAdminClient()` ou parâmetro tipado " +
        "`ReturnType<typeof createAdminClient>`) DEPOIS do portão de papel, filtrando `organization_id`, " +
        "e marque a linha com `FORK MIA` se o arquivo for do upstream.",
    ).toEqual([]);
  });

  it("todo liberado ainda existe e ainda escreve (a lista só encolhe)", () => {
    for (const [arquivo] of LIBERADOS) {
      const achado = QUE_TOCAM.find((a) => caminhoRelativo(a) === arquivo);
      expect(achado, `${arquivo} não toca mais as tabelas: tire da lista de liberados`).toBeDefined();
      expect(
        achadosDoArquivo(achado as string).length,
        `${arquivo} já escreve por um cliente provado: tire da lista de liberados`,
      ).toBeGreaterThan(0);
    }
  });

  it("a anonimização LGPD continua sendo a única escrita da sessão, e só em tool_calls", () => {
    const cascata = QUE_TOCAM.find((a) => caminhoRelativo(a) === "lib/lgpd/cascata.ts");
    expect(cascata, "lib/lgpd/cascata.ts sumiu da varredura").toBeDefined();
    expect(achadosDoArquivo(cascata as string)).toEqual([]);
    expect(readFileSync(cascata as string, "utf8")).toMatch(
      /from\("ai_agent_runs"\)\s*\.update\(\{\s*tool_calls:/,
    );
  });

  it("CONTROLE: a sessão gravando custo é reprovada; o admin e o tool_calls passam", () => {
    const vermelhos: readonly { forma: string; codigo: string }[] = [
      {
        forma: "sessão zera o custo",
        codigo:
          IMPORTA_SESSAO +
          "export async function f(org: string) { const supabase = await createClient();\n" +
          '  await supabase.from("llm_calls").update({ cost_cents: 0 }).eq("organization_id", org); }',
      },
      {
        forma: "sessão insere chamada",
        codigo:
          IMPORTA_SESSAO +
          "export async function f(org: string) { const supabase = await createClient();\n" +
          '  await supabase.from("llm_calls").insert({ organization_id: org, cost_cents: 0 }); }',
      },
      {
        forma: "sessão faz upsert no run",
        codigo:
          IMPORTA_SESSAO +
          "export async function f(org: string) { const supabase = await createClient();\n" +
          '  await supabase.from("ai_agent_runs").upsert({ organization_id: org, cost_cents: 0 }); }',
      },
      {
        forma: "sessão apaga run",
        codigo:
          IMPORTA_SESSAO +
          "export async function f(id: string) { const supabase = await createClient();\n" +
          '  await supabase.from("ai_agent_runs").delete().eq("id", id); }',
      },
      {
        forma: "sessão grava tool_calls JUNTO com custo",
        codigo:
          IMPORTA_SESSAO +
          "export async function f(id: string) { const supabase = await createClient();\n" +
          '  await supabase.from("ai_agent_runs").update({ tool_calls: [], cost_cents: 0 }).eq("id", id); }',
      },
      {
        forma: "sessão grava tool_calls em llm_calls (a exceção é só de ai_agent_runs)",
        codigo:
          IMPORTA_SESSAO +
          "export async function f(id: string) { const supabase = await createClient();\n" +
          '  await supabase.from("llm_calls").update({ tool_calls: [] }).eq("id", id); }',
      },
      {
        forma: "sessão com objeto que não dá para ler",
        codigo:
          IMPORTA_SESSAO +
          "export async function f(id: string, campos: Record<string, unknown>) { const supabase = await createClient();\n" +
          '  await supabase.from("ai_agent_runs").update(campos).eq("id", id); }',
      },
      {
        forma: "cliente chamado de `admin` sem ser admin",
        codigo:
          IMPORTA_SESSAO +
          "export async function f(org: string) { const admin = await createClient();\n" +
          '  await admin.from("llm_calls").update({ cost_cents: 0 }).eq("organization_id", org); }',
      },
    ];
    for (const { forma, codigo } of vermelhos) {
      expect.soft(achadosNaFonte(fonteDe(codigo), "sintetico.ts").length, `${forma}: passou pela cerca`).toBe(1);
    }

    const verdes: readonly { forma: string; codigo: string }[] = [
      {
        forma: "admin criado aqui",
        codigo:
          IMPORTA_ADMIN +
          "export async function f(org: string) { const admin = createAdminClient();\n" +
          '  await admin.from("llm_calls").insert({ organization_id: org, cost_cents: 1 }); }',
      },
      {
        forma: "admin tipado por parâmetro",
        codigo:
          'import type { createAdminClient } from "@/lib/supabase/admin";\n' +
          "export async function f(admin: ReturnType<typeof createAdminClient>, id: string) {\n" +
          '  await admin.from("ai_agent_runs").update({ cost_cents: 1 }).eq("id", id); }',
      },
      {
        forma: "sessão redige só tool_calls (a anonimização)",
        codigo:
          IMPORTA_SESSAO +
          "export async function f(id: string) { const db = await createClient();\n" +
          '  await db.from("ai_agent_runs").update({ tool_calls: [] }).eq("id", id); }',
      },
      {
        forma: "sessão só lê",
        codigo:
          IMPORTA_SESSAO +
          "export async function f(org: string) { const db = await createClient();\n" +
          '  await db.from("llm_calls").select("id").eq("organization_id", org); }',
      },
    ];
    for (const { forma, codigo } of verdes) {
      expect.soft(achadosNaFonte(fonteDe(codigo), "sintetico.ts"), `${forma}: reprovado sem motivo`).toEqual([]);
    }
  });
});
