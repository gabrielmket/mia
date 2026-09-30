/**
 * Lista o que o schema da MIA REDEFINE do schema do upstream.
 *
 * ── Por que isto existe ──────────────────────────────────────────────────────
 *
 * A regra do fork é ESTENDER, nunca REDEFINIR. Quando um arquivo nosso faz
 * `create or replace function X` e X já existe no baseline do upstream, vale a
 * definição que roda por último — a nossa. No dia em que o upstream melhorar X,
 * a melhoria dele entra na sincronização e é desfeita, em silêncio, pela nossa
 * cópia velha. Nada falha: a função é criada, os testes passam.
 *
 * Foi exatamente assim que a fusão de 23/09/2026 quase apagou doze tabelas da
 * anonimização da LGPD: a nossa `fn_lgpd_cascade_redact_contact` (7 tabelas)
 * entrava depois da dele (19).
 *
 * Este script é a medição. Ele não decide nada — lista, com a linha, cada objeto
 * do nosso lado que já existe do lado dele, para que cada um seja convertido em
 * extensão (gatilho próprio, tabela nova, função com nome nosso) ou declarado
 * como exceção com o motivo por escrito.
 *
 *   node scripts/redefinicoes-do-upstream.mjs <baseline-dele.sql> <apendice-nosso.sql>
 */
import { readFileSync } from "node:fs";

const [, , arquivoDele, arquivoNosso] = process.argv;
if (!arquivoDele || !arquivoNosso) {
  console.error("uso: node scripts/redefinicoes-do-upstream.mjs <baseline-dele.sql> <apendice-nosso.sql>");
  process.exit(2);
}

const dele = readFileSync(arquivoDele, "utf8");
const nosso = readFileSync(arquivoNosso, "utf8");

/** Comentário SQL não é código: a prosa dos nossos blocos cita funções dele. */
const semComentario = (sql) =>
  sql
    .split("\n")
    .map((l) => (l.trimStart().startsWith("--") ? "" : l))
    .join("\n");

/**
 * Nome normalizado: sem aspas, sem `public.`, minúsculo. O dump do Supabase
 * escreve `"public"."fn_x"`; os blocos à mão escrevem `public.fn_x` ou `fn_x`.
 * Os três são o mesmo objeto para o Postgres, e têm de ser para esta conta.
 */
const normalizar = (nome) => nome.replace(/"/g, "").replace(/^public\./i, "").toLowerCase();

const PADROES = {
  funcao: /create\s+(?:or\s+replace\s+)?function\s+((?:"?public"?\.)?"?[a-z0-9_]+"?)/gi,
  gatilho: /create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+("?[a-z0-9_]+"?)/gi,
  view: /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+((?:"?public"?\.)?"?[a-z0-9_]+"?)/gi,
};

function coletar(sql) {
  const limpo = semComentario(sql);
  const achados = {};
  for (const [tipo, re] of Object.entries(PADROES)) {
    achados[tipo] = new Map();
    for (const m of limpo.matchAll(re)) {
      const nome = normalizar(m[1]);
      const linha = limpo.slice(0, m.index).split("\n").length;
      if (!achados[tipo].has(nome)) achados[tipo].set(nome, linha);
    }
  }
  return achados;
}

const doLadoDele = coletar(dele);
const doNossoLado = coletar(nosso);

let total = 0;
for (const tipo of Object.keys(PADROES)) {
  const redefinidos = [...doNossoLado[tipo].entries()].filter(([nome]) => doLadoDele[tipo].has(nome));
  const novos = doNossoLado[tipo].size - redefinidos.length;
  console.log(`\n${tipo}: ${doNossoLado[tipo].size} no nosso apêndice — ${novos} só nossos, ${redefinidos.length} REDEFINEM o do upstream`);
  for (const [nome, linha] of redefinidos) {
    console.log(`   ✗ ${nome}   (nosso apêndice, linha ${linha})`);
    total += 1;
  }
}

console.log(`\n${total} redefinição(ões) de objeto do upstream.`);
process.exitCode = total > 0 ? 1 : 0;
