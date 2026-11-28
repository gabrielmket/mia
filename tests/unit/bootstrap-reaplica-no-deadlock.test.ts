/**
 * FORK MIA (dívida 5, MIA-348) · O BOOTSTRAP DO EASYPANEL APLICA O SCHEMA COM
 * ESPERA CURTA POR LOCK E REPETE A PASSADA INTEIRA, ATÉ 3 VEZES, QUANDO ALGUM
 * COMANDO PERDE A DISPUTA (easypanel/bootstrap.sh, modo update).
 *
 * A implantação reaplica o baseline com o app ANTIGO ainda atendendo, e um
 * `drop`/`create policy` esbarra num lock dele. Até a .119 havia uma 2ª passada
 * só quando TODOS os erros eram deadlock. Agora:
 *   - cada comando desiste do lock em least(500ms, deadlock_timeout/2), lido do
 *     banco (o `baseline.sql` vai por uma cópia com só a linha 5 trocada);
 *   - até 3 passadas, quando há ALGUM erro de disputa ou conexão;
 *   - o `psql` que sai com código diferente de 0 conta como erro;
 *   - a amostra do carimbo começa pelo que não é disputa.
 *
 * Roda o `bootstrap.sh` DE VERDADE, com o `psql` trocado por um dublê que
 * devolve a saída (e o código) de cada aplicação de arquivo (o mesmo molde de
 * tests/shell/baseline-reaplica-apos-disputa.test.sh, que prova a regra no kit
 * do upstream). Os casos 1 a 6 são os da seção 6 do desenho (MIA-348).
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

const DEADLOCK = "psql:/tmp/deskcomm/baseline.sql:16766: ERROR:  deadlock detected\nDETAIL:  Process 4121 waits for AccessExclusiveLock on relation 29187 of database 5; blocked by process 3987.";
const DEADLOCK_MIA = "psql:/deskcomm/baseline-mia.sql:19790: ERROR:  deadlock detected";
const LOCK_TIMEOUT = "psql:/tmp/deskcomm/baseline.sql:20311: ERROR:  canceling statement due to lock timeout";
const LOCK_TIMEOUT_MIA = "psql:/deskcomm/baseline-mia.sql:4410: ERROR:  canceling statement due to lock timeout";
const BENIGNO = 'psql:/tmp/deskcomm/baseline.sql:1918: ERROR:  relation "ai_invocations_org_created_idx" already exists';
const PERMISSAO = "psql:/deskcomm/baseline-mia.sql:88: ERROR:  permission denied for schema public";

/** O cabeçalho do `baseline.sql` do upstream (o `SET lock_timeout = 0;` na linha 5). */
const CABECALHO = [
  "",
  "",
  "",
  "SET statement_timeout = 0;",
  "SET lock_timeout = 0;",
  "SET idle_in_transaction_session_timeout = 0;",
  "SET client_encoding = 'UTF8';",
  "select 1;",
  "",
].join("\n");

type Aplicacao = { saida?: string; codigo?: number };

/**
 * Roda o bootstrap com o roteiro: `aplicacoes[i]` é o que o psql imprime (e o
 * código com que sai) na i-ésima aplicação de arquivo (1 = baseline.sql,
 * 2 = baseline-mia.sql da 1ª passada; 3 e 4 = os da 2ª; 5 e 6 = os da 3ª).
 */
function rodar(caso: string, aplicacoes: Record<number, string | Aplicacao>, opcoes: { baseline?: string; meioDoDeadlock?: string } = {}) {
  const dir = join(TRABALHO, caso);
  const bin = join(dir, "bin");
  const roteiro = join(dir, "roteiro");
  mkdirSync(bin, { recursive: true });
  mkdirSync(roteiro, { recursive: true });
  for (const [n, a] of Object.entries(aplicacoes)) {
    const { saida = "", codigo = 0 } = typeof a === "string" ? { saida: a } : a;
    writeFileSync(join(roteiro, `saida.${n}`), saida ? `${saida}\n` : "");
    writeFileSync(join(roteiro, `codigo.${n}`), String(codigo));
  }
  const baseline = opcoes.baseline ?? CABECALHO;
  writeFileSync(join(dir, "baseline.sql"), baseline);
  writeFileSync(join(dir, "baseline-mia.sql"), "select 1;\n");
  // O bootstrap usa caminhos fixos da imagem (/deskcomm, /tmp): a cópia aponta para a pasta do caso.
  const original = readFileSync(join(RAIZ, "easypanel", "bootstrap.sh"), "utf8");
  // Uma passada só: a pasta do caso mora em /tmp no Linux, e trocar em duas passadas
  // trocaria de novo o /tmp/ que a primeira acabou de escrever. O `/tmp/deskcomm/`
  // da cópia do baseline vira `<caso>/deskcomm/`.
  const copia = original.replace(/\/(deskcomm|tmp)\//g, `${paraSh(dir)}/`);
  expect(copia, "o bootstrap mudou de forma: a cópia ainda aponta para /deskcomm").not.toMatch(/(?<![\w.-])\/deskcomm\//);
  writeFileSync(join(dir, "bootstrap.sh"), copia);
  const dubleDoPsql = [
    "#!/bin/sh",
    'printf "%s\\n" "$*" >> "$PSQL_LOG"',
    'case " $* " in',
    '  *" -f "*baseline*)',
    '    n=$(( $(cat "$ROTEIRO/n" 2>/dev/null || echo 0) + 1 ))',
    '    printf "%s" "$n" > "$ROTEIRO/n"',
    '    [ -f "$ROTEIRO/saida.$n" ] && cat "$ROTEIRO/saida.$n"',
    '    exit "$(cat "$ROTEIRO/codigo.$n" 2>/dev/null || echo 0)" ;;',
    '  *" n="*) printf "%s" "$*" > "$ROTEIRO/carimbo"; cat > /dev/null; exit 0 ;;',
    '  *"deadlock_timeout"*) printf "%s\\n" "$MEIO_DO_DEADLOCK"; exit 0 ;;',
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
    MEIO_DO_DEADLOCK: opcoes.meioDoDeadlock ?? "250",
    BASELINE_ESPERA_S: "0",
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
  const deArquivo = chamadas.filter((l) => / -f /.test(l));
  const carimbo = existsSync(join(roteiro, "carimbo")) ? readFileSync(join(roteiro, "carimbo"), "utf8") : "";
  const gravado = carimbo.match(/ n=(\d+)/)?.[1] ?? null;
  const amostra = carimbo.match(/ amostra=([\s\S]*)$/)?.[1] ?? null;
  return {
    tela,
    chamadas,
    deArquivo,
    carimbo,
    aplicacoes: deArquivo.filter((l) => / -f .*baseline/.test(l)).length,
    gravado,
    amostra,
    copiaDoBaseline: join(dir, "deskcomm", "baseline.sql"),
    passadaGuardada: (n: number) => existsSync(join(dir, `baseline-passada-${n}.log`)),
  };
}

describe.skipIf(!temSh())("o bootstrap aplica o schema com espera curta e repete a passada na disputa", () => {
  it("controle: sem erro, uma passada (baseline e o da MIA uma vez cada) e o contador grava zero", () => {
    const r = rodar("limpo", {});
    expect(r.aplicacoes).toBe(2);
    expect(r.gravado).toBe("0");
    expect(r.tela).toContain("passada 1 de 3: sem erro");
    expect(r.tela).toContain("schema atualizado");
  });

  it("⭐ 1. lock timeout na passada 1, limpa na 2: duas passadas e o contador fica zero", () => {
    const r = rodar("lock-timeout-passa", { 1: `${BENIGNO}\n${LOCK_TIMEOUT}` });
    expect(r.aplicacoes).toBe(4);
    expect(r.gravado).toBe("0");
    expect(r.tela).toContain("passada 1 de 3: 1 comando(s) perderam a disputa");
    expect(r.tela).toContain("passada 2 de 3: sem erro");
    expect(r.tela).toContain("schema atualizado");
    expect(r.passadaGuardada(1), "o log da 1ª passada fica para quem investigar").toBe(true);
    expect(r.passadaGuardada(2)).toBe(true);
  });

  it("2. disputa nas 3 passadas: para na 3ª, e o contador é o da 3ª", () => {
    const r = rodar("disputa-persiste", {
      1: DEADLOCK,
      2: DEADLOCK_MIA,
      3: LOCK_TIMEOUT,
      5: `${LOCK_TIMEOUT}\n${DEADLOCK}`,
      6: LOCK_TIMEOUT_MIA,
    });
    expect(r.aplicacoes, "três passadas, e não quatro").toBe(6);
    expect(r.gravado).toBe("3");
    expect(r.tela).toContain("passada 3 de 3: 3 comando(s) perderam a disputa, e acabaram as passadas");
    expect(r.tela).toContain("AVISO");
    expect(r.passadaGuardada(3)).toBe(true);
  });

  it("3. disputa junto com erro de permissão: repete, e a amostra começa pela permissão", () => {
    const r = rodar("disputa-e-permissao", { 1: DEADLOCK, 2: PERMISSAO, 4: PERMISSAO });
    expect(r.aplicacoes, "a disputa pede uma passada nova mesmo com erro de verdade junto").toBe(4);
    expect(r.gravado, "a 2ª passada só tem a permissão").toBe("1");
    expect(r.amostra).toBe(PERMISSAO);
    expect(r.tela).toContain("passada 2 de 3: 1 erro(s), nenhum de disputa");
  });

  it("3b. a amostra põe o que não é disputa na frente, mesmo quando a disputa vem antes no log", () => {
    const r = rodar("amostra-ordem", { 1: LOCK_TIMEOUT, 2: `${LOCK_TIMEOUT_MIA}\n${PERMISSAO}`, 3: LOCK_TIMEOUT, 4: `${LOCK_TIMEOUT_MIA}\n${PERMISSAO}`, 5: LOCK_TIMEOUT, 6: `${LOCK_TIMEOUT_MIA}\n${PERMISSAO}` });
    expect(r.gravado).toBe("3");
    expect(r.amostra?.split("\n")).toEqual([PERMISSAO, LOCK_TIMEOUT, LOCK_TIMEOUT_MIA]);
  });

  it("4. o ruído benigno de sempre: uma passada só", () => {
    const r = rodar("benigno", { 1: BENIGNO });
    expect(r.aplicacoes).toBe(2);
    expect(r.gravado).toBe("0");
  });

  it("5. psql sai com código 2 sem imprimir ERROR: conta 1, e não repete (não é disputa)", () => {
    const r = rodar("psql-cai", { 1: { saida: "", codigo: 2 } });
    expect(r.aplicacoes).toBe(2);
    expect(r.gravado).toBe("1");
    expect(r.amostra).toContain("a aplicação não chegou ao fim do arquivo (o psql saiu com código 2)");
    expect(r.tela).toContain("AVISO");
  });

  it("5b. psql que cai por conexão perdida: é disputa, e a passada se repete", () => {
    const r = rodar("psql-cai-conexao", {
      1: { saida: "psql:/tmp/deskcomm/baseline.sql:900: server closed the connection unexpectedly\n\tThis probably means the server terminated abnormally", codigo: 2 },
    });
    expect(r.aplicacoes).toBe(4);
    expect(r.gravado).toBe("0");
  });

  it("6. o psql recebe `set lock_timeout` nas chamadas do schema, e a cópia do baseline.sql só troca a linha 5", () => {
    const r = rodar("espera-curta", {});
    expect(r.tela).toContain("espera curta por lock: 250 ms");
    // As três aplicações da passada: o trecho "antes do upstream", o baseline.sql e o da MIA.
    expect(r.deArquivo).toHaveLength(3);
    for (const chamada of r.deArquivo) expect(chamada).toContain("-c set lock_timeout = '250ms' -f ");
    const doUpstream = r.deArquivo.find((l) => / -f \S*\/deskcomm\/baseline\.sql$/.test(l));
    expect(doUpstream, "o baseline.sql vai pela cópia em /tmp/deskcomm").toBeTruthy();
    expect(r.deArquivo.some((l) => / -f \S*baseline-mia\.sql$/.test(l))).toBe(true);
    // O carimbo fica fora da espera curta.
    expect(r.carimbo).not.toContain("lock_timeout");

    const original = CABECALHO.split("\n");
    const copia = readFileSync(r.copiaDoBaseline, "utf8").split("\n");
    expect(copia).toHaveLength(original.length);
    const diferentes = original.map((l, i) => (l === copia[i] ? null : i + 1)).filter((x) => x !== null);
    expect(diferentes).toEqual([5]);
    expect(copia[4]).toBe("SET lock_timeout = '250ms';");
    expect(readFileSync(join(TRABALHO, "espera-curta", "baseline.sql"), "utf8"), "o arquivo do upstream não muda").toBe(CABECALHO);
  });

  it("sem o `SET lock_timeout = 0;` nas 20 primeiras linhas: avisa e aplica o original", () => {
    const r = rodar("sem-a-linha", {}, { baseline: "SET statement_timeout = 0;\nselect 1;\n" });
    expect(r.tela).toContain("aplico o original");
    expect(r.deArquivo.some((l) => /\/deskcomm\/baseline\.sql$/.test(l)), "sem a linha, nada de cópia").toBe(false);
    expect(r.aplicacoes).toBe(2);
    expect(r.gravado).toBe("0");
  });

  it("deadlock_timeout ilegível: cai nos 500 ms", () => {
    const r = rodar("sem-deadlock-timeout", {}, { meioDoDeadlock: "" });
    expect(r.tela).toContain("não li o deadlock_timeout");
    for (const chamada of r.deArquivo) expect(chamada).toContain("set lock_timeout = '500ms'");
  });
});
