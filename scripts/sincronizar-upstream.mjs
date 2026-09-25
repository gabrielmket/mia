/**
 * Mede a próxima sincronização com o upstream ANTES de alguém fazê-la.
 *
 * ── Por que isto existe ──────────────────────────────────────────────────────
 *
 * A fusão de 23/09/2026 juntou 2.764 commits de uma vez — nove dias de trabalho
 * do upstream — e custou uma tarde inteira: 66 arquivos em conflito, 116 blocos,
 * um buraco de LGPD que só apareceu por acaso. A dor cresce MAIS que o número de
 * commits: dois lados que divergem por nove dias não se tocam em 9 pontos, se
 * tocam em 66.
 *
 * O remédio não é ser mais cuidadoso na fusão grande. É não deixar ela ficar
 * grande. Este script roda toda semana (`.github/workflows/sincronizar-upstream.yml`)
 * e responde, sem fundir nada:
 *
 *   · quantos commits o upstream andou desde a última sincronização;
 *   · quais arquivos entrariam em conflito — e se algum deles é do SCHEMA, que
 *     pela regra do fork nunca deveria conflitar;
 *   · se o schema novo do upstream passaria a colidir com o nosso (redefinição);
 *   · o que o upstream disse que mudou (CHANGELOG), para decidir se vale trazer.
 *
 * Com 50 commits por vez a resposta costuma ser "zero conflito, traga". Com 2.764,
 * foi uma tarde.
 *
 *   node scripts/sincronizar-upstream.mjs            # mede e imprime
 *   node scripts/sincronizar-upstream.mjs --json     # para o robô ler
 *
 * NUNCA funde, nunca commita, nunca empurra: a fusão é decisão de gente. Mede
 * numa árvore descartável e a apaga no fim, com sucesso ou com erro.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COMO_JSON = process.argv.includes("--json");
const REMOTO = process.env.UPSTREAM_REMOTE ?? "upstream";
const RAMO = process.env.UPSTREAM_BRANCH ?? "main";
const ALVO = `${REMOTO}/${RAMO}`;

/** Caminhos do schema: pela regra do fork, NUNCA podem entrar em conflito. */
const SCHEMA_DO_UPSTREAM = ["supabase/baseline.sql", "supabase/migrations/"];

const env = { ...process.env, MSYS_NO_PATHCONV: "1" };

function git(args, opcoes = {}) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env, ...opcoes }).trim();
}

function gitTalvez(args, cwd) {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env, cwd });
  return { ok: r.status === 0, saida: (r.stdout ?? "").trim(), erro: (r.stderr ?? "").trim() };
}

function log(msg) {
  if (!COMO_JSON) process.stdout.write(`${msg}\n`);
}

const relatorio = {
  medido_em: new Date().toISOString(),
  alvo: ALVO,
  commits_novos: 0,
  conflitos: [],
  conflitos_no_schema: [],
  redefinicoes: null,
  changelog: [],
  veredito: "",
};

/* ── 1. O que o upstream andou ───────────────────────────────────────────────*/
log(`buscando ${ALVO}…`);
git(["fetch", "--quiet", "--tags", REMOTO]);

const base = git(["merge-base", "HEAD", ALVO]);
relatorio.commits_novos = Number(git(["rev-list", "--count", `${base}..${ALVO}`]));
log(`commits novos no upstream desde a última sincronização: ${relatorio.commits_novos}`);

if (relatorio.commits_novos === 0) {
  relatorio.veredito = "em dia — nada a trazer";
  finalizar();
}

/* ── 2. O que ele disse que mudou ────────────────────────────────────────────
 *
 * O CHANGELOG do upstream é a descrição, na voz dele, do que as versões novas
 * trazem. Ler isto antes de fundir é o que separa "trazer tudo" de "trazer o que
 * serve".
 */
const tagsNovas = git(["tag", "--merged", ALVO, "--no-merged", "HEAD", "--list", "v*", "--sort=-v:refname"])
  .split("\n")
  .filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
relatorio.changelog = tagsNovas.slice(0, 12);
if (tagsNovas.length > 0) log(`versões novas do upstream: ${tagsNovas.slice(0, 12).join(", ")}`);

/* ── 3. A fusão de ensaio, numa árvore descartável ───────────────────────────*/
const pasta = mkdtempSync(join(tmpdir(), "mia-sync-"));
try {
  git(["worktree", "add", "--quiet", "--detach", pasta, "HEAD"]);
  const fusao = gitTalvez(["merge", "--no-commit", "--no-ff", ALVO], pasta);

  relatorio.conflitos = gitTalvez(["diff", "--name-only", "--diff-filter=U"], pasta)
    .saida.split("\n")
    .filter(Boolean);

  relatorio.conflitos_no_schema = relatorio.conflitos.filter((f) =>
    SCHEMA_DO_UPSTREAM.some((s) => f === s || f.startsWith(s)),
  );

  log(`arquivos em conflito: ${relatorio.conflitos.length}`);
  for (const f of relatorio.conflitos.slice(0, 40)) log(`   ${f}`);
  if (relatorio.conflitos.length > 40) log(`   … e mais ${relatorio.conflitos.length - 40}`);

  if (relatorio.conflitos_no_schema.length > 0) {
    log("");
    log("⚠️  CONFLITO NO SCHEMA DO UPSTREAM — isto não deveria ser possível.");
    log("    A regra do fork é nunca editar supabase/baseline.sql nem supabase/migrations/.");
    log("    Se entrou conflito aí, alguém pôs coisa da MIA dentro dos arquivos dele.");
    for (const f of relatorio.conflitos_no_schema) log(`       ${f}`);
  }

  /* ── 4. O schema novo dele colidiria com o nosso? ─────────────────────────
   *
   * Sem conflito de texto ainda pode haver colisão de SENTIDO: o upstream criar
   * uma função com o mesmo nome de uma nossa, e a nossa (que roda depois)
   * passar a redefinir a dele. É a mina da LGPD, vinda do outro lado.
   */
  const baselineDele = git(["show", `${ALVO}:supabase/baseline.sql`]);
  const arqDele = join(pasta, ".baseline-dele.sql");
  writeFileSync(arqDele, baselineDele, "utf8");
  const nosso = join(process.cwd(), "supabase", "baseline-mia.sql");
  if (existsSync(nosso)) {
    const r = spawnSync("node", [join(process.cwd(), "scripts", "redefinicoes-do-upstream.mjs"), arqDele, nosso], {
      encoding: "utf8",
    });
    const achados = (r.stdout ?? "").split("\n").filter((l) => l.includes("✗")).map((l) => l.trim());
    relatorio.redefinicoes = achados;
    log("");
    log(`objetos do upstream que o schema da MIA passaria a redefinir: ${achados.length}`);
    for (const a of achados) log(`   ${a}`);
  }

  if (!fusao.ok && relatorio.conflitos.length === 0) {
    // A fusão falhou por outro motivo (árvore suja, histórico sem base). Não é
    // "zero conflito": é "não deu para medir", e dizer o contrário seria mentir.
    relatorio.veredito = `não deu para medir: ${fusao.erro.split("\n")[0] ?? "erro desconhecido"}`;
  }
} finally {
  gitTalvez(["merge", "--abort"], pasta);
  gitTalvez(["worktree", "remove", "--force", pasta]);
  rmSync(pasta, { recursive: true, force: true });
}

/* ── 5. O veredito ───────────────────────────────────────────────────────────*/
if (!relatorio.veredito) {
  const r = relatorio;
  if (r.conflitos_no_schema.length > 0) {
    r.veredito = "PARE — conflito no schema do upstream; a regra do fork foi quebrada em algum commit nosso";
  } else if ((r.redefinicoes?.length ?? 0) > 0) {
    r.veredito = "PARE — o schema novo do upstream colide com o da MIA; renomeie o nosso antes de fundir";
  } else if (r.conflitos.length === 0) {
    r.veredito = `traga agora — ${r.commits_novos} commits, zero conflito`;
  } else if (r.conflitos.length <= 10) {
    r.veredito = `traga esta semana — ${r.conflitos.length} conflitos, ainda pequeno`;
  } else {
    r.veredito = `atrasado — ${r.conflitos.length} conflitos; cada semana a mais cresce mais que linear`;
  }
}

finalizar();

function finalizar() {
  if (COMO_JSON) {
    process.stdout.write(JSON.stringify(relatorio, null, 2) + "\n");
  } else {
    log("");
    log(`VEREDITO: ${relatorio.veredito}`);
  }
  const pare = relatorio.veredito.startsWith("PARE");
  process.exit(pare ? 1 : 0);
}
