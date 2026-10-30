/**
 * FORK MIA (.96) · O BOOTSTRAP DO EASYPANEL REAPLICA O SCHEMA UMA VEZ QUANDO SÓ
 * SOBRA `deadlock detected` (easypanel/bootstrap.sh, modo update).
 *
 * A implantação reaplica o baseline com o app ANTIGO ainda atendendo, e um
 * `drop trigger if exists` esbarra num lock dele. Aconteceu em três
 * implantações e deixou a saúde com `erros: 1` à toa. O conserto: quando TODOS
 * os erros inesperados são disputa, os dois arquivos vão mais UMA vez e o
 * contador (`schema_baseline.erros_inesperados`) é o da segunda passada.
 *
 * Roda o `bootstrap.sh` DE VERDADE, com o `psql` trocado por um dublê que
 * devolve a saída de cada passada (o mesmo molde de
 * tests/shell/baseline-reaplica-apos-disputa.test.sh, que prova a mesma regra
 * no kit do upstream). O que se prova:
 *   1. só deadlock na 1ª passada, limpa na 2ª: aplica de novo e grava zero;
 *   2. deadlock nas duas: aplica UMA vez a mais (não três) e grava o da 2ª;
 *   3. deadlock junto com outro erro: não repete (repetir daria o mesmo erro);
 *   4. o ruído benigno de sempre não dispara passada nenhuma;
 *   5. controle: sem erro, duas chamadas (o baseline e o da MIA).
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");

function temSh(): boolean {
  try {
    execFileSync("sh", ["-c", "exit 0"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Caminho que o `sh` entende (no Windows, o do Git Bash usa barra normal). */
const paraSh = (p: string) => p.replace(/\\/g, "/");

const TRABALHO = mkdtempSync(join(tmpdir(), "bootstrap-deadlock-"));
afterAll(() => rmSync(TRABALHO, { recursive: true, force: true }));

const DEADLOCK = "psql:/deskcomm/baseline.sql:16766: ERROR:  deadlock detected\nDETAIL:  Process 4121 waits for AccessExclusiveLock on relation 29187 of database 5; blocked by process 3987.";
const DEADLOCK_MIA = "psql:/deskcomm/baseline-mia.sql:19790: ERROR:  deadlock detected";
const BENIGNO = 'psql:/deskcomm/baseline.sql:1918: ERROR:  relation "ai_invocations_org_created_idx" already exists';
const PERMISSAO = "psql:/deskcomm/baseline-mia.sql:88: ERROR:  permission denied for schema public";

/**
 * Roda o bootstrap com o roteiro: `passadas[i]` é o que o psql imprime na
 * i-ésima aplicação de arquivo (1 = baseline.sql, 2 = baseline-mia.sql da 1ª
 * passada; 3 e 4 = os da 2ª...).
 */
function rodar(caso: string, passadas: Record<number, string>) {
  const dir = join(TRABALHO, caso);
  const bin = join(dir, "bin");
  const roteiro = join(dir, "roteiro");
  mkdirSync(bin, { recursive: true });
  mkdirSync(roteiro, { recursive: true });
  for (const [n, saida] of Object.entries(passadas)) writeFileSync(join(roteiro, `passada.${n}`), `${saida}\n`);
  writeFileSync(join(dir, "baseline.sql"), "select 1;\n");
  writeFileSync(join(dir, "baseline-mia.sql"), "select 1;\n");
  // O bootstrap usa caminhos fixos da imagem (/deskcomm, /tmp): a cópia aponta para a pasta do caso.
  const original = readFileSync(join(RAIZ, "easypanel", "bootstrap.sh"), "utf8");
  // Uma passada só: a pasta do caso mora em /tmp no Linux, e trocar em duas passadas
  // trocaria de novo o /tmp/ que a primeira acabou de escrever.
  const copia = original.replace(/\/(deskcomm|tmp)\//g, `${paraSh(dir)}/`);
  expect(copia, "o bootstrap mudou de forma: a cópia ainda aponta para /deskcomm").not.toContain("/deskcomm/");
  writeFileSync(join(dir, "bootstrap.sh"), copia);
  const dubleDoPsql = [
    "#!/bin/sh",
    'printf "%s\\n" "$*" >> "$PSQL_LOG"',
    'case " $* " in',
    '  *" -f "*baseline*)',
    '    n=$(( $(cat "$ROTEIRO/n" 2>/dev/null || echo 0) + 1 ))',
    '    printf "%s" "$n" > "$ROTEIRO/n"',
    '    [ -f "$ROTEIRO/passada.$n" ] && cat "$ROTEIRO/passada.$n"',
    "    exit 0 ;;",
    '  *"information_schema.tables"*) echo 120; exit 0 ;;',
    '  *"select 1"*) echo 1; exit 0 ;;',
    "esac",
    "cat > /dev/null",
    "exit 0",
    "",
  ].join("\n");
  writeFileSync(join(bin, "psql"), dubleDoPsql);
  chmodSync(join(bin, "psql"), 0o755);
  const log = join(dir, "psql.log");
  const env = {
    ...process.env,
    PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
    PSQL_LOG: paraSh(log),
    ROTEIRO: paraSh(roteiro),
    NEXT_PUBLIC_SUPABASE_URL: "https://exemplo.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "chave-de-teste",
    SUPABASE_DB_URL: "postgresql://postgres:x@db.exemplo:5432/postgres",
    NUVEMSHOP_OAUTH_ENCRYPTION_KEY: "chave-de-teste",
    OWNER_EMAIL: "",
    OWNER_PASSWORD: "",
    CPF_ENCRYPTION_KEY: "",
  };
  const tela = execFileSync("sh", [paraSh(join(dir, "bootstrap.sh"))], { env, encoding: "utf8" });
  const chamadas = readFileSync(log, "utf8").split("\n");
  const aplicacoes = chamadas.filter((l) => / -f .*baseline/.test(l)).length;
  const gravado = chamadas.find((l) => l.includes(" n="))?.match(/ n=(\d+)/)?.[1] ?? null;
  return { tela, aplicacoes, gravado, primeiraPassadaGuardada: existsSync(join(dir, "baseline-passada-1.log")) };
}

describe.skipIf(!temSh())("o bootstrap reaplica o schema uma vez quando só sobra deadlock", () => {
  it("controle: sem erro, o baseline e o da MIA uma vez cada, e o contador grava zero", () => {
    const r = rodar("limpo", {});
    expect(r.aplicacoes).toBe(2);
    expect(r.gravado).toBe("0");
    expect(r.tela).toContain("schema atualizado");
  });

  it("⭐ só deadlock na 1ª passada, limpa na 2ª: aplica os dois de novo e o contador fica zero", () => {
    const r = rodar("deadlock-passa", { 1: `${BENIGNO}\n${DEADLOCK}` });
    expect(r.aplicacoes).toBe(4);
    expect(r.gravado).toBe("0");
    expect(r.tela).toContain("aplicando de novo, uma vez");
    expect(r.tela).toContain("schema atualizado");
    expect(r.primeiraPassadaGuardada, "o log da 1ª passada fica para quem investigar").toBe(true);
  });

  it("deadlock nas duas passadas: só UMA a mais, e o contador é o da 2ª", () => {
    const r = rodar("deadlock-persiste", { 1: DEADLOCK, 2: DEADLOCK_MIA, 3: DEADLOCK });
    expect(r.aplicacoes).toBe(4);
    expect(r.gravado).toBe("1");
    expect(r.tela).toContain("AVISO");
  });

  it("deadlock junto com outro erro: não repete, e conta os dois", () => {
    const r = rodar("deadlock-e-permissao", { 1: DEADLOCK, 2: PERMISSAO });
    expect(r.aplicacoes).toBe(2);
    expect(r.gravado).toBe("2");
  });

  it("o ruído benigno de sempre não dispara passada nenhuma", () => {
    const r = rodar("benigno", { 1: BENIGNO });
    expect(r.aplicacoes).toBe(2);
    expect(r.gravado).toBe("0");
  });
});
