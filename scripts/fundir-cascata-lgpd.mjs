/**
 * Funde as DUAS cascatas de anonimização da LGPD numa só.
 *
 * ── O defeito que este script existe para não deixar acontecer ───────────────
 *
 * `fn_lgpd_cascade_redact_contact` é o único objeto do banco que os dois lados
 * da fusão reescrevem. Medido no baseline fundido: há ONZE definições dela, e no
 * Postgres vale a ÚLTIMA — `create or replace` é substituição, não soma.
 *
 *   · a definição do upstream (a 10ª) redige 19 tabelas dentro da função;
 *   · a nossa (a 11ª, no nosso apêndice) redige 7.
 *
 * Como o nosso apêndice entra depois do corpo dele, a NOSSA venceria — e doze
 * tabelas parariam de ser anonimizadas: agent_cases, agent_case_events,
 * agent_case_chat_messages, agent_inbox_items, campaign_recipients,
 * campaign_suppressions, prospecting_candidates, sales, passagens_de_atendimento,
 * entregas_de_aviso_de_caso, demandas e a limpeza do sal de prospecção.
 *
 * Nada falharia. A função é criada, o deploy passa, a suíte passa. O buraco só
 * apareceria no dia em que um cliente real pedisse exclusão de dados — e aí o
 * dado continuaria lá, com um recibo dizendo que tinha sido apagado.
 *
 * O upstream escreveu o alerta deste erro no comentário da própria migration
 * 0348: "redefinir a partir de uma cópia velha desfaria em silêncio o que a main
 * consertou na cascata". Foi exatamente o que a fusão automática ia fazer.
 *
 * ── Por que a correção é neste sentido ───────────────────────────────────────
 *
 * A nossa versão é SUBCONJUNTO da dele em tudo, menos em quatro colunas de
 * `contacts` que só existem no nosso fork: `custom_fields`, `cargo`, `setor` e
 * `empresa_id` (migrations 0262 e 0264). Então a fusão certa é a dele INTEIRA
 * com essas quatro colunas dentro — e não o contrário.
 *
 * As nossas `ai_agent_runs` e `broadcast_recipients` não entram aqui: elas são
 * redigidas por um GATILHO separado (migration 0266), pendurado no fato
 * `is_anonymized`, que sobrevive à fusão sem depender desta função.
 *
 * ⚠️ O baseline roda com `SET check_function_bodies = false`. Nome de coluna
 * errado no corpo NÃO é pego ao aplicar — só no primeiro uso real. Por isso as
 * asserções abaixo são sobre TEXTO, e por isso a prova final é uma exclusão de
 * verdade num banco de cópia, não a suíte.
 *
 *   node scripts/fundir-cascata-lgpd.mjs --conferir
 *   node scripts/fundir-cascata-lgpd.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const SO_CONFERIR = process.argv.includes("--conferir");
const ARQUIVO = "supabase/baseline.sql";

function parar(mensagem) {
  console.error(`\n[fundir-cascata-lgpd] PAROU: ${mensagem}\n`);
  process.exit(1);
}

const sql = readFileSync(ARQUIVO, "utf8");

const CABECALHO = 'CREATE OR REPLACE FUNCTION "public"."fn_lgpd_cascade_redact_contact"';
const posicoes = [];
{
  let i = sql.indexOf(CABECALHO);
  while (i >= 0) {
    posicoes.push(i);
    i = sql.indexOf(CABECALHO, i + 1);
  }
}

if (posicoes.length < 2) parar(`esperava várias definições da cascata, achei ${posicoes.length}`);
console.log(`definições da cascata no baseline: ${posicoes.length}`);

/** O fim de uma definição é o `$$;` sozinho na linha, a partir do cabeçalho. */
function fimDaDefinicao(inicio) {
  const fim = sql.indexOf("\n$$;", inicio);
  if (fim < 0) parar(`não achei o fim da definição que começa em ${inicio}`);
  return fim + "\n$$;".length;
}

const iDele = posicoes[posicoes.length - 2];
const iNosso = posicoes[posicoes.length - 1];

const dele = sql.slice(iDele, fimDaDefinicao(iDele));
const nosso = sql.slice(iNosso, fimDaDefinicao(iNosso));

const contaUpdates = (corpo) => (corpo.match(/^\s*update\s+[a-z_]+\s+set/gim) ?? []).length;
const tabelasDele = contaUpdates(dele);
const tabelasNossas = contaUpdates(nosso);

console.log(`  penúltima (upstream): ${dele.split("\n").length} linhas, ${tabelasDele} updates`);
console.log(`  última (nossa):       ${nosso.split("\n").length} linhas, ${tabelasNossas} updates`);

if (tabelasDele <= tabelasNossas) {
  parar(
    `a premissa deste script caiu: a definição do upstream (${tabelasDele} updates) deveria cobrir\n` +
      `  mais tabelas que a nossa (${tabelasNossas}). Refaça a comparação à mão antes de seguir.`,
  );
}

/* ── O enxerto: as quatro colunas que só existem no nosso fork ───────────────
 *
 * `tags = '{}'::text[],` aparece DUAS vezes no corpo dele (em `contacts` e em
 * outra tabela). Âncora curta pegaria a errada e o enxerto iria para o lugar
 * errado, criando SQL que não compila — ou, pior, que compila e não faz nada.
 * Por isso a âncora carrega a linha seguinte, que só existe no bloco de
 * `contacts`: o `where id = p_contact_id`.
 */
const ANCORA =
  "    tags = '{}'::text[],\n" +
  "    updated_at = now()\n" +
  "  where id = p_contact_id and organization_id = p_organization_id;\n";
if ((dele.split(ANCORA).length - 1) !== 1) {
  parar(
    "não achei exatamente uma âncora do bloco `update contacts set` na definição do upstream\n" +
      "  (procurava tags + updated_at + where id = p_contact_id)",
  );
}

const ENXERTO =
  "    tags = '{}'::text[],\n" +
  "    -- ── As quatro colunas abaixo só existem neste fork ───────────────────\n" +
  "    --\n" +
  "    -- `custom_fields` é o jsonb LIVRE, onde vai o que a lista fixa de colunas\n" +
  "    -- não previu: \"CPF do responsável\", \"endereço da obra\", \"nome da esposa\".\n" +
  "    -- É o campo com MAIOR chance de guardar o dado mais sensível, justamente\n" +
  "    -- porque ninguém o modelou. A exportação já o selecionava e o descartava\n" +
  "    -- antes do relatório: o produto sabia que era dado pessoal e perdia o\n" +
  "    -- campo nas duas pontas (migration 0264).\n" +
  "    custom_fields = '{}'::jsonb,\n" +
  "    -- Dado pessoal profissional (0262): o que a pessoa faz e onde.\n" +
  "    cargo = null,\n" +
  "    setor = null,\n" +
  "    -- O vínculo é sobre a PESSOA apagada, não sobre a empresa. Sozinho não\n" +
  "    -- identifica ninguém, mas um contato anonimizado ligado a uma empresa de\n" +
  "    -- três pessoas estreita demais o conjunto.\n" +
  "    empresa_id = null,\n" +
  "    updated_at = now()\n" +
  "  where id = p_contact_id and organization_id = p_organization_id;\n";

const fundida = dele.replace(ANCORA, ENXERTO);

for (const coluna of ["custom_fields", "cargo", "setor", "empresa_id"]) {
  if (!fundida.includes(`    ${coluna} =`)) parar(`a coluna ${coluna} não entrou na função fundida`);
}
if (contaUpdates(fundida) !== tabelasDele) {
  parar("o enxerto mudou a contagem de updates — não deveria");
}

const AVISO =
  "-- ─── A CASCATA DE ANONIMIZAÇÃO, FUNDIDA (upstream + fork) ─────────────────\n" +
  "--\n" +
  "-- Esta é a ÚLTIMA definição de `fn_lgpd_cascade_redact_contact` no arquivo, e\n" +
  "-- no Postgres vale a última: `create or replace` substitui, não soma.\n" +
  "--\n" +
  "-- O corpo é o do upstream, inteiro, porque ele redige mais tabelas que o\n" +
  "-- nosso. Dentro dele foram enxertadas as quatro colunas de `contacts` que só\n" +
  "-- existem neste fork (`custom_fields`, `cargo`, `setor`, `empresa_id`).\n" +
  "--\n" +
  "-- Na fusão automática a NOSSA versão vinha por último e apagava doze tabelas\n" +
  "-- da cascata em silêncio — sem erro, sem teste vermelho, e sem ninguém saber\n" +
  "-- até o dia de uma exclusão real. Gerado por scripts/fundir-cascata-lgpd.mjs;\n" +
  "-- se mexer nesta função, mexa lá.\n" +
  "-- ──────────────────────────────────────────────────────────────────────────\n";

const novoSql = sql.slice(0, iNosso) + AVISO + fundida + sql.slice(iNosso + nosso.length);

if (novoSql.includes("<<<<<<<")) parar("marcador de conflito no resultado");

console.log("");
console.log(`  fundida: ${fundida.split("\n").length} linhas, ${contaUpdates(fundida)} updates`);
console.log(`  baseline: ${sql.split("\n").length} -> ${novoSql.split("\n").length} linhas`);

if (SO_CONFERIR) {
  console.log("(--conferir: nada foi escrito)");
} else {
  writeFileSync(ARQUIVO, novoSql, "utf8");
  console.log(`escrito em ${ARQUIVO}`);
}
