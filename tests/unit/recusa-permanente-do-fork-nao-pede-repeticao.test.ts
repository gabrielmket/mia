import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * FORK MIA (.81, migration 9043) — RECUSA PERMANENTE NÃO SAI COM `40001` NO
 * SCHEMA DA MIA.
 *
 * O par desta cerca no upstream é `recusa-permanente-nao-pede-repeticao`, que lê
 * `baseline.sql` e `supabase/migrations/` (#2805, 0654): `40001` é
 * serialization_failure, e o PostgREST 14 refaz a transação sozinho, sem
 * limite — numa recusa que nunca passa (revisão velha, reserva vencida, item
 * que já mudou de ciclo) isso vira um laço que derruba a instalação inteira. A
 * saída é `PT409`, que o PostgREST lê como HTTP 409 e ninguém repete.
 *
 * As funções NOSSAS (agenda do Outlook, escolha das agendas, obrigações)
 * moram em `baseline-mia.sql` e `supabase/migrations-mia/`, fora do alcance
 * dela. Esta cerca lê os dois com a MESMA régua: a ÚLTIMA definição de cada
 * função e todo `raise exception '<x>' ... errcode = '40001'` cujo `<x>` não
 * esteja em `REPETIR_PASSA`. Recusa nova com `40001` entra na lista com o
 * porquê, ou sai com `PT409`.
 */
const REPETIR_PASSA = new Map<string, string>([
  // Nenhuma ainda: as 14 recusas que existiam eram permanentes e viraram PT409 na 9043.
]);

const RAIZ = join(__dirname, "..", "..", "supabase");
const BASELINE_MIA = readFileSync(join(RAIZ, "baseline-mia.sql"), "utf8");
const CADEIA_MIA = readdirSync(join(RAIZ, "migrations-mia"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(RAIZ, "migrations-mia", f), "utf8"))
  .join("\n");

/** ÚLTIMA definição de cada função (chave: nome + aridade), como na cerca do upstream. */
function ultimasDefinicoes(sql: string): Map<string, { funcao: string; corpo: string }> {
  const ultima = new Map<string, { funcao: string; corpo: string }>();
  const cabecalho = /create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/gi;
  for (const m of sql.matchAll(cabecalho)) {
    let i = m.index + m[0].length;
    let profundidade = 1;
    let virgulas = 0;
    const inicioArgs = i;
    while (profundidade > 0 && i < sql.length) {
      const c = sql[i++];
      if (c === "(") profundidade++;
      else if (c === ")") profundidade--;
      else if (c === "," && profundidade === 1) virgulas++;
    }
    const aridade = sql.slice(inicioArgs, i - 1).trim() === "" ? 0 : virgulas + 1;
    const abertura = /\$(\w*)\$/.exec(sql.slice(i));
    if (!abertura) continue;
    const inicioCorpo = i + abertura.index + abertura[0].length;
    const fim = sql.indexOf(abertura[0], inicioCorpo);
    if (fim < 0) continue;
    const funcao = (m[1] ?? "").toLowerCase();
    ultima.set(`${funcao}/${aridade}`, { funcao, corpo: sql.slice(inicioCorpo, fim) });
  }
  return ultima;
}

type Recusa = { funcao: string; mensagem: string; errcode: string };

function recusasVigentes(sql: string): Recusa[] {
  const recusas: Recusa[] = [];
  for (const { funcao, corpo } of ultimasDefinicoes(sql).values()) {
    for (const [, mensagem = "", errcode = ""] of corpo.matchAll(
      /raise\s+exception\s+'([^']+)'[^;]*?errcode\s*=\s*'(\w+)'/gi,
    )) {
      recusas.push({ funcao, mensagem, errcode: errcode.toUpperCase() });
    }
  }
  return recusas;
}

describe.each([
  ["baseline-mia.sql", BASELINE_MIA],
  ["cadeia de migrations da MIA", CADEIA_MIA],
])("recusa permanente do fork não pede repetição — %s", (_nome, sql) => {
  const recusas = recusasVigentes(sql);

  it("nenhuma recusa permanente sai com 40001", () => {
    const pedemRepeticao = recusas
      .filter((r) => r.errcode === "40001" && !REPETIR_PASSA.has(r.mensagem))
      .map((r) => `${r.funcao}: ${r.mensagem}`);
    expect(pedemRepeticao).toEqual([]);
  });

  it("nenhum handler do fork captura só o código antigo", () => {
    // O ajuste que a 0654 teve de fazer em `fn_appointment_recover`: um
    // `exception when serialization_failure` em volta de quem passou a levantar
    // PT409 deixa a recusa escapar. No fork não há nenhum hoje; se nascer, ele
    // tem de capturar os dois.
    const escapam: string[] = [];
    for (const { funcao, corpo } of ultimasDefinicoes(sql).values()) {
      for (const [, condicao = ""] of corpo.matchAll(/\bwhen\s+([\s\S]*?)\s+then\b/gi)) {
        if (!/serialization_failure|sqlstate\s+'40001'/i.test(condicao)) continue;
        if (!/sqlstate\s+'PT409'/i.test(condicao)) escapam.push(`${funcao}: when ${condicao}`);
      }
    }
    expect(escapam).toEqual([]);
  });

  it("a sonda enxerga as recusas da agenda do Outlook e das obrigações (não está cega)", () => {
    expect(recusas.some((r) => r.funcao === "fn_mia_agenda_microsoft_compromisso" && r.mensagem === "microsoft_stale" && r.errcode === "PT409")).toBe(true);
    expect(recusas.some((r) => r.funcao === "fn_mia_agenda_selecao" && r.mensagem === "agenda_selecao_desatualizada" && r.errcode === "PT409")).toBe(true);
    expect(recusas.some((r) => r.funcao === "fn_mia_obrigacao_fechar_ciclo" && r.errcode === "PT409")).toBe(true);
  });
});

describe("os chamadores leem o código novo E o antigo", () => {
  // O banco e a imagem não sobem no mesmo instante: a imagem nova pode falar
  // com um banco ainda sem a 9043 (40001) e vice-versa.
  const CHAMADORES = [
    "app/api/v1/agenda/microsoft/calendarios/route.ts",
    "app/api/v1/agenda/agendamentos/[id]/microsoft/resolver/route.ts",
    "lib/obrigacoes/operacoes.ts",
  ];
  it.each(CHAMADORES)("%s aceita PT409 e 40001", (arquivo) => {
    const fonte = readFileSync(join(__dirname, "..", "..", arquivo), "utf8");
    expect(fonte).toMatch(/"PT409"/);
    expect(fonte).toMatch(/"40001"/);
  });
});
