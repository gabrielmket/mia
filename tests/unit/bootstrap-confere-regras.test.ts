/**
 * FORK MIA (dívida 5, MIA-354) · DEPOIS DA ÚLTIMA PASSADA, O BOOTSTRAP RECRIA A
 * REGRA DE ISOLAMENTO QUE FICOU FALTANDO (easypanel/bootstrap.sh, modo update).
 *
 * Com a espera curta do #178, o `drop policy if exists` pode ganhar a disputa e
 * o `create policy` perder, na última passada: a regra fica fora do banco até o
 * próximo deploy (uma restritiva faltando AMPLIA o acesso). O bootstrap:
 *   - roda as passadas com `psql -b`, que escreve o comando inteiro de cada erro
 *     (`STATEMENT:`), recortado pelo próprio psql;
 *   - para cada erro contado cujo comando é `create policy` ou `create trigger`,
 *     pergunta ao catálogo se a regra está no banco;
 *   - só o último `create` da regra no nível de cima da passada pode voltar, e
 *     nunca o de uma regra que o arquivo apaga de vez depois (MIA-356);
 *   - a que falta roda de novo, sozinha, e o catálogo é lido outra vez;
 *   - voltou: o erro sai da contagem; não voltou: vira "regra de isolamento fora
 *     do banco" no começo da amostra, com `erros > 0` (`em_dia: false`).
 *
 * Roda o `bootstrap.sh` DE VERDADE, com o `psql` trocado por um dublê (o molde de
 * tests/unit/bootstrap-reaplica-no-deadlock.test.ts). A prova com Postgres de
 * verdade é a etapa 3c do scripts/ensaio-de-banco.sh.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const TRABALHO = mkdtempSync(join(tmpdir(), "bootstrap-regras-"));
afterAll(() => rmSync(TRABALHO, { recursive: true, force: true }));

/**
 * Os arquivos de mentira têm os comandos nas linhas que o erro cita: a
 * conferência só recria o `create` que ela acha no nível de cima do arquivo
 * (`mencoes_das_regras`). `@UP@` é o baseline.sql que o psql leu (a cópia com
 * espera curta) e `@MIA@` o baseline-mia.sql; `rodar` troca pelos caminhos do caso.
 */
const CABECALHO = ["", "", "", "SET statement_timeout = 0;", "SET lock_timeout = 0;"];
const SEARCH_PATH = "select pg_catalog.set_config('search_path', 'public, extensions', false);";
/**
 * A forma de verdade (baseline.sql:61599): o nome sozinho na linha e o `on` na
 * de baixo. O `error_count` e o `-- ...;` estão aí de propósito: o texto do
 * comando não pode entrar na contagem, e o recorte não pode parar no `;` do
 * comentário.
 */
const POLITICA = [
  "create policy conversation_participant_read_is_not_control_update",
  "  on public.conversations as restrictive for update to authenticated",
  "  using (public.fn_can_view_conversation(organization_id, assigned_to_user_id)) -- nada de error_count;",
  "  with check (true);",
];
const DROP_DA_POLITICA = "drop policy if exists conversation_participant_read_is_not_control_update on public.conversations;";
/** baseline.sql: o cabeçalho, o search_path e o par drop/create (o create acaba na linha 11). */
const UPSTREAM = [...CABECALHO, SEARCH_PATH, DROP_DA_POLITICA, ...POLITICA, "select 1;", ""];
const ONDE = "psql:@UP@:11:";
const LOCK_TIMEOUT = `${ONDE} ERROR:  canceling statement due to lock timeout`;
const erroDe = (onde: string, comando: string[]) => [`${onde} ERROR:  canceling statement due to lock timeout`, `${onde} STATEMENT:  ${comando[0]}`, ...comando.slice(1)].join("\n");
const ERRO_DA_POLITICA = erroDe(ONDE, POLITICA);

/** baseline-mia.sql: o par drop/create do gatilho (o create acaba na linha 5). */
const GATILHO = ["create trigger trg_mensagem_de_teste", "  after insert or update of body on public.messages", "  for each row execute function public.fn_de_teste();"];
const MIA = ["select 1;", "drop trigger if exists trg_mensagem_de_teste on public.messages;", ...GATILHO, ""];
const ONDE_GATILHO = "psql:@MIA@:5:";
const ERRO_DO_GATILHO = erroDe(ONDE_GATILHO, GATILHO);

const ONDE_ALTER = "psql:/tmp/deskcomm/baseline.sql:20311:";
const ERRO_DO_ALTER = [`${ONDE_ALTER} ERROR:  canceling statement due to lock timeout`, `${ONDE_ALTER} STATEMENT:  alter table public.conversations add column if not exists x int;`].join("\n");
const PERMISSAO = "psql:/deskcomm/baseline-mia.sql:88: ERROR:  permission denied for schema public";

type Saida = { erro?: string; codigo?: number };

/**
 * `passadas[i]` é o que o psql escreve no stderr (e o código) na i-ésima
 * aplicação de arquivo (1 = baseline.sql e 2 = baseline-mia.sql da 1ª passada,
 * 3 e 4 da 2ª, 5 e 6 da 3ª). `catalogo` são as respostas do catálogo, em ordem
 * ("1" está, "0" falta). `recriar[i]` é a i-ésima vez que um comando roda sozinho.
 */
function rodar(
  caso: string,
  passadas: Record<number, string>,
  catalogo: string[] = [],
  recriar: Record<number, Saida> = {},
  arquivos: { upstream?: string[]; mia?: string[] } = {},
) {
  const dir = join(TRABALHO, caso);
  const caminhos = (t: string) => t.replace(/@UP@/g, `${paraSh(dir)}/deskcomm/baseline.sql`).replace(/@MIA@/g, `${paraSh(dir)}/baseline-mia.sql`);
  const bin = join(dir, "bin");
  const roteiro = join(dir, "roteiro");
  mkdirSync(bin, { recursive: true });
  mkdirSync(roteiro, { recursive: true });
  for (const [n, erro] of Object.entries(passadas)) writeFileSync(join(roteiro, `erro.${n}`), `${caminhos(erro)}\n`);
  for (const [n, r] of Object.entries(recriar)) {
    writeFileSync(join(roteiro, `recriar-erro.${n}`), r.erro ? `${r.erro}\n` : "");
    writeFileSync(join(roteiro, `recriar-codigo.${n}`), String(r.codigo ?? 0));
  }
  catalogo.forEach((c, i) => writeFileSync(join(roteiro, `catalogo.${i + 1}`), `${c}\n`));
  writeFileSync(join(dir, "baseline.sql"), (arquivos.upstream ?? UPSTREAM).join("\n"));
  writeFileSync(join(dir, "baseline-mia.sql"), (arquivos.mia ?? MIA).join("\n"));
  const original = readFileSync(join(RAIZ, "easypanel", "bootstrap.sh"), "utf8");
  const copia = original.replace(/\/(deskcomm|tmp)\//g, `${paraSh(dir)}/`);
  expect(copia, "o bootstrap mudou de forma: a cópia ainda aponta para /deskcomm").not.toMatch(/(?<![\w.-])\/deskcomm\//);
  writeFileSync(join(dir, "bootstrap.sh"), copia);
  const dubleDoPsql = [
    "#!/bin/sh",
    'printf "%s\\n" "$*" >> "$PSQL_LOG"',
    "proximo() {",
    '  n=$(( $(cat "$ROTEIRO/$1" 2>/dev/null || echo 0) + 1 ))',
    '  printf "%s" "$n" > "$ROTEIRO/$1"',
    "}",
    'case " $* " in',
    '  *" -f "*baseline*)',
    "    proximo n",
    '    [ -f "$ROTEIRO/erro.$n" ] && cat "$ROTEIRO/erro.$n" >&2',
    "    exit 0 ;;",
    '  *" -f "*/regras/*.sql*)',
    "    proximo nr",
    '    [ -f "$ROTEIRO/recriar-erro.$n" ] && cat "$ROTEIRO/recriar-erro.$n" >&2',
    '    exit "$(cat "$ROTEIRO/recriar-codigo.$n" 2>/dev/null || echo 0)" ;;',
    '  *" nome="*" -f - "*)',
    '    entrada="$(cat)"',
    '    printf "%s\\n" "$entrada" >> "$PSQL_LOG"',
    "    proximo nc",
    '    [ -f "$ROTEIRO/catalogo.$n" ] && cat "$ROTEIRO/catalogo.$n"',
    "    exit 0 ;;",
    '  *" n="*) printf "%s" "$*" > "$ROTEIRO/carimbo"; cat > /dev/null; exit 0 ;;',
    '  *"deadlock_timeout"*) echo 250; exit 0 ;;',
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
  const carimbo = existsSync(join(roteiro, "carimbo")) ? readFileSync(join(roteiro, "carimbo"), "utf8") : "";
  const ler = (nome: string) => (existsSync(join(roteiro, nome)) ? Number(readFileSync(join(roteiro, nome), "utf8")) : 0);
  return {
    tela,
    chamadas,
    passadas: ler("n") / 2,
    consultasAoCatalogo: ler("nc"),
    recriacoes: chamadas.filter((l) => / -f \S*\/regras\/\d+\.sql$/.test(l)),
    caminhos,
    gravado: carimbo.match(/ n=(\d+)/)?.[1] ?? null,
    amostra: carimbo.match(/ amostra=([\s\S]*)$/)?.[1] ?? null,
    comandoRecriado: (n: number) => readFileSync(join(dir, "regras", `${n}.sql`), "utf8"),
    logDaPassada: (n: number) => readFileSync(join(dir, `baseline-passada-${n}.log`), "utf8"),
  };
}

describe.skipIf(!temSh())("o bootstrap recria a regra de isolamento que a última passada deixou fora do banco", () => {
  it("1. nada falta: sem erro, nenhuma pergunta ao catálogo, nada recriado, contador zero", () => {
    const r = rodar("nada-falta", {});
    expect(r.passadas).toBe(1);
    expect(r.consultasAoCatalogo).toBe(0);
    expect(r.recriacoes).toHaveLength(0);
    expect(r.gravado).toBe("0");
  });

  it("1b. o erro que sobrou não é de política nem de gatilho: nada a recriar, e ele continua contando", () => {
    const r = rodar("so-alter", { 1: ERRO_DO_ALTER, 3: ERRO_DO_ALTER, 5: ERRO_DO_ALTER });
    expect(r.passadas).toBe(3);
    expect(r.consultasAoCatalogo).toBe(0);
    expect(r.recriacoes).toHaveLength(0);
    expect(r.tela).toContain("nenhuma política ou gatilho perdeu na última passada");
    expect(r.gravado).toBe("1");
  });

  it("⭐ 2. falta uma política restritiva e volta: o comando do psql roda sozinho, o catálogo confirma e o contador fica zero", () => {
    const r = rodar("restritiva-volta", { 1: ERRO_DA_POLITICA, 3: ERRO_DA_POLITICA, 5: ERRO_DA_POLITICA }, ["0", "1"], { 1: { codigo: 0 } });
    expect(r.passadas, "a disputa vai até a 3ª passada").toBe(3);
    // O texto do comando (com `error_count`) ficou fora do log que é contado.
    expect(r.tela).toContain("passada 1 de 3: 1 comando(s) perderam a disputa");
    expect(r.logDaPassada(3)).not.toContain("STATEMENT");
    expect(r.logDaPassada(3)).not.toContain("error_count");
    // O catálogo é perguntado pelo nome e pela tabela do cabeçalho em duas linhas.
    const consulta = r.chamadas.find((l) => l.includes(" nome="));
    expect(consulta).toContain("-v nome=conversation_participant_read_is_not_control_update -v tabela=public.conversations -f -");
    expect(r.chamadas.some((l) => l.includes("from pg_catalog.pg_policy where polname = :'nome' and polrelid = to_regclass(:'tabela')"))).toBe(true);
    // Recriada só ela, com o comando inteiro, exatamente como o psql mandou.
    expect(r.recriacoes).toHaveLength(1);
    // Com a espera curta e o search_path que vigorava no arquivo naquele ponto.
    expect(r.recriacoes[0]).toContain(`-v ON_ERROR_STOP=1 -c set lock_timeout = '250ms' -c ${SEARCH_PATH} -f `);
    expect(r.comandoRecriado(1)).toBe(`${POLITICA.join("\n")}\n`);
    expect(r.tela).toContain("política conversation_participant_read_is_not_control_update em public.conversations voltou ao banco");
    expect(r.gravado, "voltou: o comando rodou, como a disputa curada na 2ª passada").toBe("0");
    expect(r.tela).toContain("schema atualizado");
  });

  it("⭐ 3. falta e não volta: três rodadas na disputa, e o carimbo conta a regra fora do banco no começo da amostra", () => {
    const perde = { erro: "psql:/tmp/regras/1.sql:4: ERROR:  canceling statement due to lock timeout", codigo: 3 };
    const r = rodar("restritiva-nao-volta", { 1: ERRO_DA_POLITICA, 3: ERRO_DA_POLITICA, 5: `${ERRO_DO_ALTER}\n${ERRO_DA_POLITICA}` }, ["0", "0"], { 1: perde, 2: perde, 3: perde });
    expect(r.recriacoes, "TENTATIVAS rodadas, como as passadas").toHaveLength(3);
    expect(r.tela).toContain("continua FORA do banco");
    expect(r.gravado, "a regra e o alter").toBe("2");
    const amostra = r.amostra?.split("\n") ?? [];
    expect(amostra[0]).toBe(
      `regra de isolamento fora do banco: política conversation_participant_read_is_not_control_update em public.conversations (o create de ${r.caminhos("@UP@")}:11: perdeu e não voltou: ERROR:  canceling statement due to lock timeout)`,
    );
    expect(r.tela).toContain("AVISO: erros que não são os esperados");
  });

  it("3b. não volta por erro que não é disputa: uma tentativa só", () => {
    const r = rodar("nao-volta-sem-disputa", { 1: ERRO_DA_POLITICA, 3: ERRO_DA_POLITICA, 5: ERRO_DA_POLITICA }, ["0", "0"], {
      1: { erro: "psql:/tmp/regras/1.sql:4: ERROR:  function public.fn_can_view_conversation(uuid, uuid) does not exist", codigo: 3 },
    });
    expect(r.recriacoes).toHaveLength(1);
    expect(r.gravado).toBe("1");
    expect(r.amostra).toContain("does not exist");
  });

  it("4. a regra está no banco (o `drop` também perdeu): não roda nada, e o erro fica", () => {
    const r = rodar("esta-no-banco", { 1: ERRO_DA_POLITICA, 3: ERRO_DA_POLITICA, 5: ERRO_DA_POLITICA }, ["1"]);
    expect(r.consultasAoCatalogo).toBe(1);
    expect(r.recriacoes).toHaveLength(0);
    expect(r.tela).toContain("está no banco");
    expect(r.gravado).toBe("1");
    expect(r.amostra).toBe(r.caminhos(LOCK_TIMEOUT));
  });

  it("4b. o catálogo não responde: o erro fica, com AVISO, e nada é recriado às cegas", () => {
    const r = rodar("catalogo-mudo", { 1: ERRO_DA_POLITICA, 3: ERRO_DA_POLITICA, 5: ERRO_DA_POLITICA }, [""]);
    expect(r.recriacoes).toHaveLength(0);
    expect(r.tela).toContain("AVISO: não li o catálogo");
    expect(r.gravado).toBe("1");
  });

  it("5. um gatilho do baseline-mia.sql: pergunta ao pg_trigger pela tabela depois dos eventos, e volta", () => {
    const r = rodar("gatilho-volta", { 2: ERRO_DO_GATILHO, 4: ERRO_DO_GATILHO, 6: ERRO_DO_GATILHO }, ["0", "1"], { 1: { codigo: 0 } });
    expect(r.chamadas.find((l) => l.includes(" nome="))).toContain("-v nome=trg_mensagem_de_teste -v tabela=public.messages -f -");
    expect(r.chamadas.some((l) => l.includes("from pg_catalog.pg_trigger where not tgisinternal and tgname = :'nome'"))).toBe(true);
    expect(r.comandoRecriado(1)).toBe(`${GATILHO.join("\n")}\n`);
    // O baseline-mia.sql de mentira não mexe no search_path: o comando roda sem.
    expect(r.recriacoes[0]).toContain("-c set lock_timeout = '250ms' -f ");
    expect(r.tela).toContain("gatilho trg_mensagem_de_teste em public.messages voltou ao banco");
    expect(r.gravado).toBe("0");
  });

  it("6. a regra volta e um erro de verdade fica: o contador e a amostra são só dele", () => {
    const r = rodar("volta-e-permissao", { 1: ERRO_DA_POLITICA, 2: PERMISSAO, 3: ERRO_DA_POLITICA, 4: PERMISSAO, 5: ERRO_DA_POLITICA, 6: PERMISSAO }, ["0", "1"], { 1: { codigo: 0 } });
    expect(r.recriacoes).toHaveLength(1);
    expect(r.gravado).toBe("1");
    expect(r.amostra).toBe(PERMISSAO);
  });
  it("⭐ 7. redefinição: dois `create` da mesma regra perderam; só o último (a definição final) roda, e os dois erros saem", () => {
    const antiga = ["create policy conversation_participant_read_is_not_control_update", "  on public.conversations as restrictive for update to authenticated", "  using (false);"];
    // A antiga acaba na linha 10; a final, na 15.
    const upstream = [...CABECALHO, SEARCH_PATH, DROP_DA_POLITICA, ...antiga, DROP_DA_POLITICA, ...POLITICA, ""];
    const erros = `${erroDe("psql:@UP@:10:", antiga)}\n${erroDe("psql:@UP@:15:", POLITICA)}`;
    const r = rodar("redefinicao", { 1: erros, 3: erros, 5: erros }, ["0", "1"], { 1: { codigo: 0 } }, { upstream });
    expect(r.consultasAoCatalogo, "só a final vai ao catálogo (antes e depois)").toBe(2);
    expect(r.recriacoes).toHaveLength(1);
    expect(r.recriacoes[0]).toMatch(/\/regras\/2\.sql$/);
    expect(r.comandoRecriado(2)).toBe(`${POLITICA.join("\n")}\n`);
    expect(r.tela).toContain("voltou ao banco");
    expect(r.gravado, "a definição final voltou; o create antigo segue o resultado dela").toBe("0");
  });

  it("7b. redefinição em que a final também não volta: uma linha só de regra fora do banco, pela final", () => {
    const antiga = ["create policy conversation_participant_read_is_not_control_update", "  on public.conversations as restrictive for update to authenticated", "  using (false);"];
    const upstream = [...CABECALHO, SEARCH_PATH, DROP_DA_POLITICA, ...antiga, DROP_DA_POLITICA, ...POLITICA, ""];
    const erros = `${erroDe("psql:@UP@:10:", antiga)}\n${erroDe("psql:@UP@:15:", POLITICA)}`;
    const perde = { erro: "psql:/tmp/regras/2.sql:4: ERROR:  canceling statement due to lock timeout", codigo: 3 };
    const r = rodar("redefinicao-nao-volta", { 1: erros, 3: erros, 5: erros }, ["0", "0"], { 1: perde, 2: perde, 3: perde }, { upstream });
    expect(r.recriacoes.every((l) => /\/regras\/2\.sql$/.test(l))).toBe(true);
    expect(r.gravado).toBe("1");
    expect(r.amostra).toContain(`o create de ${r.caminhos("@UP@")}:15: perdeu e não voltou`);
  });

  it("7c. só o `create` antigo perdeu e o final rodou: nada é recriado (a definição antiga não volta por cima da final), e o erro fica", () => {
    const antiga = ["create policy conversation_participant_read_is_not_control_update", "  on public.conversations as restrictive for update to authenticated", "  using (false);"];
    const upstream = [...CABECALHO, SEARCH_PATH, DROP_DA_POLITICA, ...antiga, DROP_DA_POLITICA, ...POLITICA, ""];
    const erro = erroDe("psql:@UP@:10:", antiga);
    const r = rodar("so-a-antiga", { 1: erro, 3: erro, 5: erro }, [], {}, { upstream });
    expect(r.consultasAoCatalogo).toBe(0);
    expect(r.recriacoes).toHaveLength(0);
    expect(r.tela).toContain("o último create dela (baseline.sql:15) rodou");
    expect(r.gravado).toBe("1");
  });

  it("⭐ 8. apagada de vez: o `create` perdeu e o arquivo a apaga depois; nada é recriado, o catálogo confirma e o erro sai", () => {
    // A forma da crm_empresas_escrita (baseline-mia.sql:7406-7416 e :10416).
    const criar = ["create policy crm_empresas_escrita on public.crm_empresas", "  for all to authenticated using (true) with check (true);"];
    const mia = ["select 1;", "drop policy if exists crm_empresas_escrita on public.crm_empresas;", ...criar, "-- o cadastro antigo não aceita mais escrita", "drop policy if exists crm_empresas_escrita on public.crm_empresas;", ""];
    const erro = erroDe("psql:@MIA@:4:", criar);
    const r = rodar("apagada", { 2: erro, 4: erro, 6: erro }, ["0"], {}, { mia });
    expect(r.recriacoes, "ressuscitar a regra que o arquivo tira").toHaveLength(0);
    expect(r.consultasAoCatalogo).toBe(1);
    expect(r.tela).toContain("política crm_empresas_escrita em public.crm_empresas fica fora do banco, como o arquivo quer (o drop de baseline-mia.sql:6 a apaga depois");
    expect(r.gravado).toBe("0");
  });

  it("8b. apagada de vez, mas está no banco (o `drop` final também perdeu): o erro fica", () => {
    const criar = ["create policy crm_empresas_escrita on public.crm_empresas", "  for all to authenticated using (true) with check (true);"];
    const mia = ["select 1;", "drop policy if exists crm_empresas_escrita on public.crm_empresas;", ...criar, "drop policy if exists crm_empresas_escrita on public.crm_empresas;", ""];
    const erro = erroDe("psql:@MIA@:4:", criar);
    const r = rodar("apagada-no-banco", { 2: erro, 4: erro, 6: erro }, ["1"], {}, { mia });
    expect(r.recriacoes).toHaveLength(0);
    expect(r.gravado).toBe("1");
  });

  it("9. o `create` do erro não está no nível de cima do arquivo (dentro de `$$`, ou o leitor errou): AVISO, nada recriado às cegas, e o erro fica", () => {
    const corpo = ["create function public.fn_de_teste_provisiona() returns void language plpgsql as $f$", "begin", ...POLITICA, "end $f$;", ""];
    const upstream = [...CABECALHO, SEARCH_PATH, ...corpo];
    const erro = erroDe("psql:@UP@:12:", POLITICA);
    const r = rodar("fora-do-nivel-de-cima", { 1: erro, 3: erro, 5: erro }, [], {}, { upstream });
    expect(r.tela).toContain("AVISO: não achei o create de política conversation_participant_read_is_not_control_update em public.conversations");
    expect(r.consultasAoCatalogo).toBe(0);
    expect(r.recriacoes).toHaveLength(0);
    expect(r.gravado).toBe("1");
  });
});

describe("cerca: o bloco STATEMENT do psql termina na próxima linha que começa com `psql:`", () => {
  it("nenhuma linha dos dois baselines começa com `psql:` (senão o comando recortado levaria o resto junto)", () => {
    for (const arquivo of ["baseline.sql", "baseline-mia.sql"]) {
      const linhas = readFileSync(join(RAIZ, "supabase", arquivo), "utf8").split("\n");
      const ruins = linhas.map((l, i) => (l.startsWith("psql:") ? i + 1 : null)).filter((x) => x !== null);
      expect(ruins, `supabase/${arquivo}: linha que começa com "psql:" (MIA-354, easypanel/bootstrap.sh anotar_saida)`).toEqual([]);
    }
  });
});

/**
 * O leitor do nível de cima (`mencoes_das_regras`) rodando nos arquivos de
 * verdade, na ordem da passada: o trecho "antes do upstream", o baseline.sql e o
 * baseline-mia.sql. Se um arquivo novo o confundir (aspas, `$$` ou comentário
 * que ele não fecha), ou se aparecer outra regra que o arquivo cria e depois
 * apaga de vez, a cerca diz aqui, e não no deploy.
 */
describe.skipIf(!temSh())("cerca: o leitor das regras do nível de cima nos dois baselines", () => {
  const script = [
    'eval "$(sed -n "/^LEITOR_DE_CABECALHO=/,/^}\'\\$/p" "$1")"',
    'eval "$(sed -n "/^mencoes_das_regras() {/,/^}\\$/p" "$1")"',
    "sed -n '/^-- >>> ANTES DO BASELINE DO UPSTREAM/,/^-- <<< ANTES DO BASELINE DO UPSTREAM/p' \"$3\" > \"$4\"",
    'mencoes_das_regras "$4" "$2" "$3"',
  ].join("\n");
  const linhas = execFileSync(
    "sh",
    ["-c", script, "sh", paraSh(join(RAIZ, "easypanel", "bootstrap.sh")), paraSh(join(RAIZ, "supabase", "baseline.sql")), paraSh(join(RAIZ, "supabase", "baseline-mia.sql")), paraSh(join(TRABALHO, "antes.trecho"))],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("|"));
  const mencoes = linhas.filter((c) => c[0] !== "fim");

  it("o leitor fecha os três trechos (nenhum acaba dentro de aspas, `$$` ou comentário)", () => {
    expect(linhas.filter((c) => c[0] === "fim").map((c) => c.join("|"))).toEqual(["fim|1|ok", "fim|2|ok", "fim|3|ok"]);
    expect(mencoes.length, "o leitor achou os drop/create do nível de cima").toBeGreaterThan(1000);
  });

  it("apagada de vez (criada e depois só apagada): hoje é só a crm_empresas_escrita, e o leitor a reconhece", () => {
    const ultima = new Map<string, string[]>();
    const criada = new Set<string>();
    for (const c of mencoes) {
      const regra = `${c[3]}|${c[4]}|${c[5]}`;
      ultima.set(regra, c);
      if (c[2] === "create") criada.add(regra);
    }
    const apagadas = [...ultima].filter(([regra, c]) => criada.has(regra) && c[2] === "drop").map(([regra, c]) => `${regra} @${c[0]}:${c[1]}`);
    expect(apagadas, "outra regra criada e apagada de vez: confira que o bootstrap não deve recriá-la (MIA-354)").toEqual(["politica|crm_empresas_escrita|public.crm_empresas @3:10416"]);
  });

  it("os restritivos de conversations e messages são `create` do nível de cima, na linha do `;` (a que o psql cita no erro)", () => {
    const creates = new Set(mencoes.filter((c) => c[0] === "2" && c[2] === "create").map((c) => `${c[1]}|${c[4]}|${c[5]}`));
    for (const esperado of [
      "61602|conversation_participant_read_is_not_control_update|public.conversations",
      "61606|conversation_participant_read_is_not_control_delete|public.conversations",
      "61626|message_participant_reply_is_not_history_update|public.messages",
      "61632|message_participant_reply_is_not_history_delete|public.messages",
    ]) {
      expect(creates.has(esperado), esperado).toBe(true);
    }
    // E leva o search_path que o baseline.sql fixa na :6291, para a recriação rodar no mesmo ambiente.
    const restritiva = mencoes.find((c) => c[0] === "2" && c[1] === "61602");
    expect(restritiva?.[6]).toBe("select pg_catalog.set_config('search_path', 'public, extensions', false);");
  });

  it("o `create policy` de dentro do corpo de função não é do nível de cima (o email_cadences_select mora em fn_cadencias_provisionar)", () => {
    expect(mencoes.some((c) => c[4] === "email_cadences_select")).toBe(false);
  });
});
