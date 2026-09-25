/**
 * Separa o schema da MIA do schema do upstream: dois arquivos, nunca um só.
 *
 * ── A regra do fork que este script materializa ──────────────────────────────
 *
 *   supabase/baseline.sql      = o do upstream, BYTE A BYTE. Nunca editado aqui.
 *   supabase/baseline-mia.sql  = o nosso, aplicado DEPOIS, por easypanel/bootstrap.sh.
 *
 * Até 25/09/2026 os dois moravam no mesmo arquivo. Cada sincronização com o
 * upstream virava conflito dentro dele — na de 23/09 foram 11 blocos cobrindo
 * 15 mil linhas, não por briga de conteúdo, mas por geografia: os dois lados
 * emendavam blocos no mesmo rodapé. Com o nosso num arquivo próprio, o
 * `baseline.sql` passa a entrar da sincronização exatamente como o upstream o
 * escreveu, e esse conflito deixa de ser possível.
 *
 * ── Estender, nunca redefinir ────────────────────────────────────────────────
 *
 * Arquivo separado não basta: se o nosso fizer `create or replace` de um objeto
 * que existe no dele, vale o nosso (roda por último) e cada melhoria futura do
 * upstream naquele objeto é desfeita em silêncio. Medido em 25/09/2026, o nosso
 * apêndice fazia isso TRÊS vezes, todas na LGPD:
 *
 *   · fn_lgpd_cascade_redact_contact                    (0264) — a cascata
 *   · fn_contato_anonimizado_limpa_campos_personalizados (0265) — o gatilho dele
 *   · trg_contacts_anonimizado_limpa_custom_fields       (0265) — idem
 *
 * A primeira quase apagou doze tabelas da anonimização na fusão de 23/09. As
 * três viram UM gatilho com nome nosso, pendurado ao lado do dele no mesmo fato
 * (`is_anonymized` passando a true). O dele continua zerando `custom_fields`; o
 * nosso zera o resto. A cascata dele faz `is_anonymized = true`, o nosso gatilho
 * dispara junto — e a cascata não precisa mais ser tocada.
 *
 * O próprio upstream estende a anonimização assim
 * (`trg_contacts_anonimizado_limpa_custom_fields`, migration 0211 dele). É o
 * padrão da casa, não uma invenção do fork.
 *
 * ── Provas ───────────────────────────────────────────────────────────────────
 *
 * Toda premissa é asserção: se o upstream mudar o que este script procura, ele
 * PARA com a mensagem, em vez de escrever um schema torto. As provas finais são
 * as mesmas que as catracas cobram — nenhuma redefinição de objeto do upstream,
 * e a varredura `anon` como o último bloco que existe.
 *
 *   node scripts/separar-baseline-mia.mjs --conferir
 *   node scripts/separar-baseline-mia.mjs
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const SO_CONFERIR = process.argv.includes("--conferir");

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
  });
}

function parar(mensagem) {
  console.error(`\n[separar-baseline-mia] PAROU: ${mensagem}\n`);
  process.exit(1);
}

/** Troca `de` por `para` exigindo ocorrência ÚNICA. Ambígua ou ausente, para. */
function trocarUnico(texto, de, para, nome) {
  const n = texto.split(de).length - 1;
  if (n !== 1) parar(`${nome}: esperava 1 ocorrência, achei ${n}\n  procurava: ${de.slice(0, 120)}`);
  return texto.replace(de, para);
}

/** Corta de `inicio` (inclusive) até `fim` (inclusive). Os dois têm de existir, nessa ordem. */
function cortar(texto, inicio, fim, nome) {
  const i = texto.indexOf(inicio);
  if (i < 0) parar(`${nome}: não achei o início\n  ${inicio.slice(0, 120)}`);
  const f = texto.indexOf(fim, i);
  if (f < 0) parar(`${nome}: não achei o fim depois do início\n  ${fim.slice(0, 120)}`);
  return { antes: texto.slice(0, i), trecho: texto.slice(i, f + fim.length), depois: texto.slice(f + fim.length) };
}

/* ── As duas fontes ──────────────────────────────────────────────────────────
 *
 * A fusão é o último merge commit: o pai 2 é o upstream que entrou, o pai 1 é o
 * nosso de antes. Ler das duas pontas, e não do arquivo fundido em disco, é o
 * que garante que o `baseline.sql` sai idêntico ao dele — nem um retoque nosso.
 */
const fusao = git("log", "--merges", "--format=%H", "-1").trim();
if (!fusao) parar("não achei o commit de fusão com o upstream");

const deles = git("show", `${fusao}^2:supabase/baseline.sql`);
const nossoPreFusao = git("show", `${fusao}^1:supabase/baseline.sql`);

console.log(`fusão:               ${fusao.slice(0, 9)}`);
console.log(`baseline do upstream: ${deles.split("\n").length} linhas`);

/* ── O nosso apêndice, como estava antes da fusão ────────────────────────────*/
const ANCORA_APENDICE = "-- ---- tags dos contatos (migration 0249) ----";
const ANCORA_VARREDURA =
  "-- ---- VARREDURA anon: função nova nasce exposta em quem ATUALIZA (migration 0116) ----";

const iApendice = nossoPreFusao.indexOf(ANCORA_APENDICE);
if (iApendice < 0) parar("não achei o início do nosso apêndice");
let apendice = nossoPreFusao.slice(iApendice);

/* A varredura sai do meio e volta no fim, sozinha. */
const iVarredura = apendice.indexOf(ANCORA_VARREDURA);
if (iVarredura < 0) parar("não achei a varredura anon no nosso apêndice");
if (apendice.indexOf(ANCORA_VARREDURA, iVarredura + 1) >= 0) parar("a varredura aparece duas vezes");
const fimVarredura = apendice.indexOf("\n-- ---- ", iVarredura + ANCORA_VARREDURA.length);
if (fimVarredura < 0) parar("não achei o bloco seguinte à varredura");
const blocoVarredura = apendice.slice(iVarredura, fimVarredura);
apendice = apendice.slice(0, iVarredura) + apendice.slice(fimVarredura + 1);

/* ── 0264: a redefinição da cascata sai inteira ──────────────────────────────
 *
 * O bloco era SÓ isto: a função e os dois grants dela. O que ele fazia — zerar
 * cargo, setor e custom_fields — passa a ser do gatilho da MIA, abaixo.
 */
{
  const c = cortar(
    apendice,
    'CREATE OR REPLACE FUNCTION "public"."fn_lgpd_cascade_redact_contact"',
    "grant execute on function public.fn_lgpd_cascade_redact_contact(uuid,uuid,uuid) to service_role;",
    "0264 (redefinição da cascata)",
  );
  apendice =
    c.antes +
    "-- (Aqui ficava uma REDEFINIÇÃO de fn_lgpd_cascade_redact_contact, a cascata do\n" +
    "-- upstream. Removida em 25/09/2026 pela regra do fork: estender, nunca\n" +
    "-- redefinir. O que ela acrescentava — zerar cargo, setor e empresa_id — é\n" +
    "-- feito pelo gatilho `trg_contacts_anonimizado_limpa_mia`, no bloco 0265.\n" +
    "-- A cascata que vale é a do upstream, intacta, com as tabelas dele todas.)\n" +
    c.depois;
}

/* ── 0265: a função e o gatilho dele viram a função e o gatilho NOSSOS ───────*/
const GATILHO_MIA = `-- ── A MIA pendura o SEU gatilho ao lado do dele, nunca por cima ─────────
--
-- Até 25/09/2026 este bloco REDEFINIA a função do gatilho do upstream
-- (\`fn_contato_anonimizado_limpa_campos_personalizados\`) para acrescentar
-- colunas. Funcionava — até o dia em que o upstream mexesse na função dele: a
-- mudança entraria na sincronização e seria desfeita pela nossa cópia, que roda
-- depois. É o mesmo defeito que quase apagou doze tabelas da cascata em 23/09.
--
-- Agora são DOIS gatilhos no mesmo fato. O dele zera \`custom_fields\`, como
-- sempre. O nosso zera o resto. Nenhum escreve coluna do outro, então a ordem
-- em que o Postgres os dispara não importa.
--
-- As colunas daqui são de dois tipos, e o motivo de cada um é diferente:
--   · cargo, setor, empresa_id — só existem na MIA (0262, 0255). Nenhum código
--     do upstream as conhece, então só um gatilho nosso pode alcançá-las.
--   · source_metadata, tags, consent — são do upstream, e a CASCATA dele as zera.
--     Mas a rota DIRETA (\`fn_lgpd_anonymize_contact\`) não: ela para no nome, no
--     e-mail e no telefone. Pendurar no fato \`is_anonymized\`, e não numa rota,
--     é o que cobre as duas. (Candidato a PR no upstream: é defeito dele, não
--     particularidade nossa.)
--   · social_identity — do upstream (redes sociais nativas, 0368 dele), e
--     NENHUM caminho a zera: nem a cascata, nem a rota direta, nem o gatilho
--     dele. É a chave da pessoa numa rede social; quem pede exclusão continuaria
--     identificável por ela. Achado pela catraca lgpd-as-duas-pontas em
--     25/09/2026, dois dias depois de a coluna nascer. (Também candidato a PR.)
create or replace function public.fn_mia_contato_anonimizado_limpa()
  returns trigger
  language plpgsql
as $$
begin
  new.cargo := null;
  new.setor := null;
  new.empresa_id := null;
  new.source_metadata := '{}'::jsonb;
  new.tags := '{}'::text[];
  new.consent := '{}'::jsonb;
  new.social_identity := null;
  return new;
end$$;

comment on function public.fn_mia_contato_anonimizado_limpa() is
  'Gatilho da MIA: zera cargo, setor, empresa_id, source_metadata, tags, consent e social_identity quando o contato é anonimizado. Ao lado de trg_contacts_anonimizado_limpa_custom_fields (do upstream), nunca por cima.';

revoke all on function public.fn_mia_contato_anonimizado_limpa() from public;
revoke execute on function public.fn_mia_contato_anonimizado_limpa() from anon;
revoke execute on function public.fn_mia_contato_anonimizado_limpa() from authenticated;

drop trigger if exists trg_contacts_anonimizado_limpa_mia on public.contacts;
create trigger trg_contacts_anonimizado_limpa_mia
  before update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized = true and coalesce(old.is_anonymized, false) = false)
  execute function public.fn_mia_contato_anonimizado_limpa();`;

{
  const c = cortar(
    apendice,
    "create or replace function public.fn_contato_anonimizado_limpa_campos_personalizados()",
    "execute function public.fn_contato_anonimizado_limpa_campos_personalizados();",
    "0265 (redefinição do gatilho)",
  );
  apendice = c.antes + GATILHO_MIA + c.depois;
}

/* ── 0266: o nosso gatilho passa a alcançar as refs de anúncio do upstream ───
 *
 * `fn_redigir_o_que_sobrou_do_contato_anonimizado` é NOSSA (0266), então
 * acrescentar aqui é estender — a regra do fork. As duas tabelas são do
 * upstream (0306 dele) e nenhum caminho de anonimização as alcançava: achadas
 * pela catraca lgpd-exporta-o-que-redige em 25/09/2026.
 */
apendice = trocarUnico(
  apendice,
  "     and (phone_e164 <> v_rotulo or valores <> '{}'::jsonb);\n\n  return new;\nend$$;",
  "     and (phone_e164 <> v_rotulo or valores <> '{}'::jsonb);\n\n" +
    "  -- 4 · google_ads_click_refs e meta_ads_click_refs — do upstream (0306 dele).\n" +
    "  --     O perigo é `query_raw`: a query string CRUA da landing page, e página\n" +
    "  --     de anúncio costuma carregar e-mail e nome na URL. A atribuição de\n" +
    "  --     campanha (gclid, utm) continua servindo ao relatório; o elo com a\n" +
    "  --     pessoa, não. `contact_id` já é `on delete set null`, então nulo é um\n" +
    "  --     estado que a tabela aceita e o resto do código já trata.\n" +
    "  update public.google_ads_click_refs\n" +
    "     set query_raw  = '{}'::jsonb,\n" +
    "         contact_id = null\n" +
    "   where organization_id = new.organization_id\n" +
    "     and contact_id = new.id;\n\n" +
    "  update public.meta_ads_click_refs\n" +
    "     set query_raw  = '{}'::jsonb,\n" +
    "         contact_id = null\n" +
    "   where organization_id = new.organization_id\n" +
    "     and contact_id = new.id;\n\n" +
    "  return new;\nend$$;",
  "0266 (refs de anúncio no gatilho da MIA)",
);

/* ── 0270: a tabela certa ───────────────────────────────────────────────────
 *
 * `followup_flows` NUNCA existiu. A 0270 errava em todo deploy desde a .46 — e
 * era o `erros: 1` que a saúde reportava, sem ninguém saber o que era, até o
 * carimbo passar a guardar a amostra. A tabela das réguas é
 * `followup_flow_pointers`, e a 0270 nunca teve efeito em lugar nenhum.
 */
apendice = trocarUnico(
  apendice,
  "alter table public.followup_flows\n",
  "-- ⚠️ Era `public.followup_flows`, que NUNCA existiu: a 0270 errou em todo deploy\n" +
    "-- desde a .46 e era o `erros: 1` da saúde. Corrigido em 25/09/2026.\n" +
    "alter table public.followup_flow_pointers\n",
  "0270 (tabela das réguas)",
);

/* ── 0252: absorvida pela 0385 do upstream ──────────────────────────────────
 *
 * Os dois lados consertaram o mesmo defeito (a ferramenta MCP gravava a origem
 * 'agent' e o CHECK recusava com 23514) com dias de diferença, e o SQL efetivo é
 * idêntico. Manter o nosso seria redefinir a constraint dele: no dia em que o
 * upstream acrescentar uma quarta origem, a nossa cópia a reverteria para três.
 */
{
  const c = cortar(
    apendice,
    "-- ---- memória da org aceita origem 'agent' (migration 0252) ----",
    "\n-- ---- ",
    "0252 (absorvida pela 0385)",
  );
  apendice =
    c.antes +
    "-- ---- memória da org aceita origem 'agent' (migration 0252) ----\n" +
    "--\n" +
    "-- (ABSORVIDA pela 0385 do upstream, que faz exatamente o mesmo `CHECK`.\n" +
    "-- Removida daqui em 25/09/2026: repeti-la seria redefinir a constraint dele,\n" +
    "-- e a próxima origem que ele acrescentasse seria desfeita pela nossa cópia.)\n" +
    "\n-- ---- " +
    c.depois;
}

/* ── A montagem ─────────────────────────────────────────────────────────────*/
const CABECALHO = `-- ═══════════════════════════════════════════════════════════════════════════
-- baseline-mia.sql — O SCHEMA DA PLATAFORMA MIA
--
-- Aplicado por easypanel/bootstrap.sh DEPOIS de supabase/baseline.sql, que é o
-- do upstream (melgarafael/DeskcommCRM) byte a byte e NUNCA é editado aqui.
--
-- AS DUAS REGRAS DESTE ARQUIVO:
--
--   1. Estender, nunca redefinir. Nada aqui pode fazer \`create or replace\` de
--      função, gatilho ou view que já exista em baseline.sql. Quando a MIA
--      precisa de mais, pendura o seu ao lado (gatilho próprio, tabela nova,
--      função com nome nosso). Vigiado por scripts/redefinicoes-do-upstream.mjs.
--
--   2. A varredura \`anon\` é o ÚLTIMO bloco deste arquivo — e portanto do schema
--      inteiro. Ela é auto-curativa e cura as funções dos DOIS arquivos, mas só
--      as que já existem quando ela roda.
--
-- Gerado por scripts/separar-baseline-mia.mjs em 25/09/2026.
-- ═══════════════════════════════════════════════════════════════════════════


`;

const mia = CABECALHO + apendice.trimEnd() + "\n\n\n" + blocoVarredura.trimEnd() + "\n";

/* ── As provas ──────────────────────────────────────────────────────────────*/
const semComentario = (sql) =>
  sql
    .split("\n")
    .map((l) => (l.trimStart().startsWith("--") ? "" : l))
    .join("\n");

const normalizar = (nome) => nome.replace(/"/g, "").replace(/^public\./i, "").toLowerCase();
const nomes = (sql, re) => new Set([...semComentario(sql).matchAll(re)].map((m) => normalizar(m[1])));

const RE_FUNCAO = /create\s+(?:or\s+replace\s+)?function\s+((?:"?public"?\.)?"?[a-z0-9_]+"?)/gi;
const RE_GATILHO = /create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+("?[a-z0-9_]+"?)/gi;

/**
 * Constraint também é objeto do upstream. A primeira versão desta prova olhava
 * só função e gatilho — e deixou passar a 0252, que fazia `drop constraint` +
 * `add constraint` num CHECK dele. Mesma mina, outra forma.
 */
const RE_CONSTRAINT = /add\s+constraint\s+("?[a-z0-9_]+"?)/gi;

const funcoesDeles = nomes(deles, RE_FUNCAO);
const gatilhosDeles = nomes(deles, RE_GATILHO);
const constraintsDeles = nomes(deles, RE_CONSTRAINT);
const redefinidas = [
  ...[...nomes(mia, RE_FUNCAO)].filter((n) => funcoesDeles.has(n)),
  ...[...nomes(mia, RE_GATILHO)].filter((n) => gatilhosDeles.has(n)),
  ...[...nomes(mia, RE_CONSTRAINT)].filter((n) => constraintsDeles.has(n)),
];

console.log("");
console.log(`  prova: objetos do upstream redefinidos pela MIA: ${redefinidas.length} (tem de ser 0)`);
if (redefinidas.length > 0) parar(`a MIA ainda redefine objeto do upstream: ${redefinidas.join(", ")}`);

const posVarredura = mia.lastIndexOf(ANCORA_VARREDURA);
const depois = semComentario(mia.slice(posVarredura));
const funcoesDepois = (depois.match(/create\s+(or\s+replace\s+)?function/gi) ?? []).length;
const grantsAnonDepois = (depois.match(/grant[^;]*\bto\b[^;]*\banon\b/gi) ?? []).length;
console.log(`  prova: função criada depois da varredura:          ${funcoesDepois} (tem de ser 0)`);
console.log(`  prova: grant para anon depois da varredura:        ${grantsAnonDepois} (tem de ser 0)`);
if (funcoesDepois > 0) parar("há função criada depois da varredura");
if (grantsAnonDepois > 0) parar("há grant para anon depois da varredura");

if (mia.includes("<<<<<<<") || mia.includes(">>>>>>>")) parar("marcador de conflito no resultado");
if (/public\.followup_flows\b/.test(semComentario(mia))) parar("sobrou referência à tabela inexistente followup_flows");

console.log("");
console.log(`baseline.sql      ← upstream intacto: ${deles.split("\n").length} linhas`);
console.log(`baseline-mia.sql  ← nosso:            ${mia.split("\n").length} linhas`);

if (SO_CONFERIR) {
  console.log("(--conferir: nada foi escrito)");
} else {
  writeFileSync("supabase/baseline.sql", deles, "utf8");
  writeFileSync("supabase/baseline-mia.sql", mia, "utf8");
  console.log("escritos.");
}
