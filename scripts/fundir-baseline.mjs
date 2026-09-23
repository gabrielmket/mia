/**
 * Reconstrói o `supabase/baseline.sql` da fusão com o upstream.
 *
 * ── Por que reconstruir em vez de resolver o conflito ────────────────────────
 *
 * O `git merge` deixou 11 conflitos neste arquivo cobrindo mais de 15 mil linhas.
 * Nenhum deles é briga de conteúdo: é GEOGRAFIA. Os dois lados emendaram blocos
 * novos no mesmo rodapé, e o git não tem como saber em que ordem eles deveriam
 * ficar. Resolver hunk a hunk seria adivinhar 11 vezes, num arquivo que a
 * produção aplica inteiro a cada deploy.
 *
 * A montagem é determinística e verificável:
 *
 *   [ baseline DELE, inteiro ]        <- 37.296 linhas, sem tocar
 *   [ nossos 3 retoques cirúrgicos ]  <- reaplicados por busca exata
 *   [ nosso apêndice ]                <- os blocos das migrations 0239..0272
 *   [ VARREDURA anon ]                <- por último, sempre
 *
 * ── Por que a VARREDURA vai para o fim ───────────────────────────────────────
 *
 * O baseline traz, do dump do Supabase, um `ALTER DEFAULT PRIVILEGES ... GRANT
 * ALL ON FUNCTIONS TO anon`. Isso grava uma entrada em `pg_default_acl` que fica
 * no catálogo PARA SEMPRE: a partir dali, toda função criada em `public` nasce
 * com EXECUTE para `anon`. A varredura da 0116 é auto-curativa e cura tudo que
 * foi criado ANTES dela — então ela tem de ser a última coisa do arquivo.
 *
 * O baseline do upstream não tem esse bloco: ele revoga função por função. Pôr o
 * nosso no fim da fusão cura os dois lados de uma vez, e não desfaz nada dele.
 *
 * ── Como rodar ───────────────────────────────────────────────────────────────
 *
 *   node scripts/fundir-baseline.mjs           # confere e escreve
 *   node scripts/fundir-baseline.mjs --conferir # só confere, não escreve
 *
 * Toda premissa é asserção: se o upstream mexer no que este script procura, ele
 * PARA com a mensagem do que mudou, em vez de escrever um baseline torto.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const SO_CONFERIR = process.argv.includes("--conferir");

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function parar(mensagem) {
  console.error(`\n[fundir-baseline] PAROU: ${mensagem}\n`);
  process.exit(1);
}

const nosso = git("show", "HEAD:supabase/baseline.sql");
const dele = git("show", "MERGE_HEAD:supabase/baseline.sql");

console.log(`nosso: ${nosso.split("\n").length} linhas`);
console.log(`dele:  ${dele.split("\n").length} linhas`);

/* ── 1. Os três retoques cirúrgicos ────────────────────────────────────────────
 *
 * Cada um é um par (procurar, trocar por). A busca é do texto DELE; a troca é a
 * nossa versão. `once: true` exige ocorrência única — se o upstream duplicou o
 * trecho, preferimos parar a escolher a errada em silêncio.
 */
const RETOQUES = [
  {
    nome: "ALTER SCHEMA public OWNER envolvido (não somos donos no Supabase hospedado)",
    procurar: 'ALTER SCHEMA "public" OWNER TO "pg_database_owner";',
    trocar:
      '-- ⚠️ ENVOLVIDO NUM BLOCO, e a linha crua vinha do dump original.\n' +
      '--\n' +
      '-- Num Supabase HOSPEDADO o papel que conecta (`postgres`) não é superusuário e\n' +
      '-- não é dono do schema `public`. O comando falha com `must be owner of schema\n' +
      '-- public` em TODO deploy — uma linha de ERROR no log de um contêiner efêmero,\n' +
      '-- que ninguém lia. Passou a incomodar quando a 0269 começou a CONTAR erros:\n' +
      '-- um contador que nunca chega a zero é um alarme que se aprende a ignorar.\n' +
      '--\n' +
      '-- O comando continua valendo para quem instala num Postgres próprio.\n' +
      '-- `insufficient_privilege` é o mínimo: não engole erro de outra natureza.\n' +
      'DO $$ BEGIN\n' +
      '  ALTER SCHEMA "public" OWNER TO "pg_database_owner";\n' +
      'EXCEPTION WHEN insufficient_privilege THEN\n' +
      '  NULL;\n' +
      'END $$;',
  },
  {
    nome: "COMMENT ON SCHEMA envolvido (mesma falta de dono)",
    procurar: "COMMENT ON SCHEMA \"public\" IS 'DeskcommCRM",
    trocarLinhaInteira: (linha) =>
      'DO $$ BEGIN\n' +
      `  ${linha.trim()}\n` +
      'EXCEPTION WHEN insufficient_privilege THEN\n' +
      '  -- Mesma história: comentar o schema também exige ser dono dele.\n' +
      '  NULL;\n' +
      'END $$;',
  },
  {
    nome: "followup_flow_pointers.trigger_config nasce com cancel_on_reply (0270)",
    procurar: `  trigger_config jsonb not null default '{"kind":"manual"}',`,
    trocar:
      '  -- `cancel_on_reply` no default desde a 0270 (item B1-a): régua NOVA encerra\n' +
      '  -- quando o lead responde, em vez de avançar para o passo seguinte — que podia\n' +
      '  -- ser a despedida, mandada a quem acabou de falar. Réguas criadas antes NÃO\n' +
      '  -- foram tocadas: mudar comportamento de régua viva é decisão de quem opera.\n' +
      `  trigger_config jsonb not null default '{"kind":"manual","cancel_on_reply":true}',`,
  },
];

let montado = dele;

for (const r of RETOQUES) {
  const ocorrencias = montado.split(r.procurar).length - 1;
  if (ocorrencias === 0) {
    parar(`retoque não encontrado no baseline do upstream: ${r.nome}\n  procurava: ${r.procurar}`);
  }
  if (ocorrencias > 1) {
    parar(`retoque ambíguo (${ocorrencias} ocorrências): ${r.nome}`);
  }
  if (r.trocarLinhaInteira) {
    // A linha carrega uma data que o upstream pode ter mudado: preserva a dele.
    const linha = montado.split("\n").find((l) => l.includes(r.procurar));
    montado = montado.replace(linha, r.trocarLinhaInteira(linha));
  } else {
    montado = montado.replace(r.procurar, r.trocar);
  }
  console.log(`  ok  retoque: ${r.nome}`);
}

/* ── 2. O nosso apêndice ──────────────────────────────────────────────────────
 *
 * Tudo que acrescentamos vive depois da última linha que herdamos da base comum.
 * A âncora é o cabeçalho do primeiro bloco nosso; a varredura sai daqui e volta
 * no fim, sozinha.
 */
const ANCORA_APENDICE = "-- ---- tags dos contatos (migration 0249) ----";
const ANCORA_VARREDURA = "-- ---- VARREDURA anon: função nova nasce exposta em quem ATUALIZA (migration 0116) ----";

const iApendice = nosso.indexOf(ANCORA_APENDICE);
if (iApendice < 0) parar(`não achei o início do nosso apêndice:\n  ${ANCORA_APENDICE}`);

const iVarredura = nosso.indexOf(ANCORA_VARREDURA);
if (iVarredura < 0) parar(`não achei o bloco da varredura anon no nosso baseline`);
if (nosso.indexOf(ANCORA_VARREDURA, iVarredura + 1) >= 0) {
  parar("o bloco da varredura aparece mais de uma vez no nosso baseline");
}

/* O bloco da varredura vai do cabeçalho dele até o cabeçalho do bloco seguinte. */
const restoDepoisDaVarredura = nosso.slice(iVarredura + ANCORA_VARREDURA.length);
const iProximoBloco = restoDepoisDaVarredura.indexOf("\n-- ---- ");
if (iProximoBloco < 0) parar("a varredura é o último bloco do nosso baseline — o script assume que há blocos depois dela");

const blocoVarredura = nosso.slice(iVarredura, iVarredura + ANCORA_VARREDURA.length + iProximoBloco);
const apendiceAntes = nosso.slice(iApendice, iVarredura);
const apendiceDepois = nosso.slice(iVarredura + ANCORA_VARREDURA.length + iProximoBloco);

console.log(`  ok  apêndice antes da varredura: ${apendiceAntes.split("\n").length} linhas`);
console.log(`  ok  bloco da varredura:          ${blocoVarredura.split("\n").length} linhas`);
console.log(`  ok  apêndice depois:             ${apendiceDepois.split("\n").length} linhas`);

const apendice = apendiceAntes + apendiceDepois;

/* ── 3. A montagem ────────────────────────────────────────────────────────────*/
const CABECALHO_APENDICE = [
  "",
  "",
  "-- ═══════════════════════════════════════════════════════════════════════════",
  "-- APÊNDICE DA PLATAFORMA MIA — migrations 0239 em diante",
  "--",
  "-- Tudo abaixo desta linha foi construído no fork da Time Company e não existe",
  "-- no upstream. Entra DEPOIS do corpo dele de propósito: os blocos aqui",
  "-- dependem de tabelas que o corpo acima cria.",
  "--",
  "-- A varredura `anon` fecha o arquivo, e é a última coisa por desenho.",
  "-- ═══════════════════════════════════════════════════════════════════════════",
  "",
  "",
].join("\n");

montado = montado.trimEnd() + "\n" + CABECALHO_APENDICE + apendice.trimEnd() + "\n\n\n" + blocoVarredura.trimEnd() + "\n";

/* ── 4. As provas ─────────────────────────────────────────────────────────────
 *
 * As mesmas que a catraca `varredura-anon-e-o-ultimo-bloco` cobra, conferidas
 * aqui para o script não escrever um arquivo que já se sabe reprovado.
 */
const posFinalVarredura = montado.lastIndexOf(ANCORA_VARREDURA);

/**
 * A prosa do bloco FALA sobre `create function` e sobre `grant ... anon` — é o
 * assunto dele. Contar comentário como código reprovaria o arquivo correto, que
 * é o erro mais caro aqui: mandaria alguém "consertar" o que já está certo.
 * A catraca faz a mesma exclusão (tests/unit/varredura-anon-e-o-ultimo-bloco).
 */
const semComentario = (sql) =>
  sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

const depoisDaVarredura = semComentario(montado.slice(posFinalVarredura));

const criaFuncaoDepois = (depoisDaVarredura.match(/create\s+(or\s+replace\s+)?function/gi) ?? []).length;
const grantAnonDepois = (depoisDaVarredura.match(/grant[^;]*\bto\b[^;]*\banon\b/gi) ?? []).length;

console.log("");
console.log(`  prova: 'create function' depois da varredura: ${criaFuncaoDepois} (tem de ser 0)`);
console.log(`  prova: 'grant ... anon'  depois da varredura: ${grantAnonDepois} (tem de ser 0)`);

if (criaFuncaoDepois > 0) parar("há criação de função depois da varredura — a cura não alcançaria essas funções");
if (grantAnonDepois > 0) parar("há grant para anon depois da varredura — a cura seria desfeita no mesmo run");

if (montado.includes("<<<<<<<") || montado.includes(">>>>>>>")) parar("sobrou marcador de conflito no arquivo montado");

console.log(`\nbaseline montado: ${montado.split("\n").length} linhas`);

if (SO_CONFERIR) {
  console.log("(--conferir: nada foi escrito)");
} else {
  writeFileSync("supabase/baseline.sql", montado, "utf8");
  console.log("escrito em supabase/baseline.sql");
}
