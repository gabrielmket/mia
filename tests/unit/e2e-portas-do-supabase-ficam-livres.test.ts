/**
 * A PORTA DO SUPABASE PRESA ANTES DA RESERVA É SOLTA, NÃO SÓ AVISADA.
 *
 * Medido no run 45456996778 (parte 5, 24/11/2026): o passo "Tirar as portas do
 * Supabase da faixa efêmera" avisou que a 54324 já estava em uso por conexão
 * aberta antes da reserva, e 94 s depois o `supabase start` morreu no bind dela
 * (`address already in use`). A parte caiu em 2 min sem rodar caso nenhum.
 *
 * Este teste RODA o script do passo (extraído do e2e.yml, sem cópia) com `ss`,
 * `sudo` e `sysctl` falsos no PATH e mede:
 *   - conexão de saída viva numa porta reservada → é derrubada (`ss -K`, só
 *     estado estabelecido, só naquela porta) e o passo diz que soltou;
 *   - quem ESCUTA numa porta reservada nunca é derrubado, e o aviso fica;
 *   - TIME-WAIT não conta como presa (some sozinho em 60 s);
 *   - kernel que não deixa derrubar → o aviso de antes, sem falhar o passo;
 *   - nada aberto nas portas → nenhum `ss -K`.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../..");
const E2E = path.join(RAIZ, ".github/workflows/e2e.yml");
const PASSO = "Tirar as portas do Supabase da faixa efêmera";

function scriptDoPasso(): string {
  const linhas = readFileSync(E2E, "utf-8").split("\n");
  const inicio = linhas.findIndex((l) => l.includes(`- name: ${PASSO}`));
  expect(inicio, `o passo '${PASSO}' sumiu do e2e.yml`).toBeGreaterThan(-1);
  const run = linhas.findIndex((l, i) => i > inicio && /^\s+run: \|\s*$/.test(l));
  const corpo: string[] = [];
  for (const l of linhas.slice(run + 1)) {
    if (l.trim() !== "" && !l.startsWith(" ".repeat(10))) break;
    corpo.push(l.slice(10));
  }
  return corpo.join("\n");
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** `sockets`: uma linha por socket, "ESTADO porta". `kRecusa`: o kernel sem INET_DIAG_DESTROY. */
function rodar(sockets: string[], { kRecusa = false }: { kRecusa?: boolean } = {}) {
  const raiz = mkdtempSync(path.join(tmpdir(), "e2e-portas-"));
  dirs.push(raiz);
  const bin = path.join(raiz, "bin");
  mkdirSync(bin);
  const estado = path.join(raiz, "sockets.txt");
  writeFileSync(estado, sockets.map((s) => `${s}\n`).join(""));
  const log = path.join(raiz, "chamadas.log");
  writeFileSync(log, "");
  const executavel = (nome: string, corpo: string, interpretador = "/bin/sh") => {
    const arquivo = path.join(bin, nome);
    writeFileSync(arquivo, `#!${interpretador}\n${corpo}\n`);
    chmodSync(arquivo, 0o755);
  };
  executavel("sudo", 'echo "sudo $*" >> "$TEST_LOG"\nexec "$@"');
  executavel("sysctl", 'echo "sysctl $*" >> "$TEST_LOG"');
  // O `ss` dublê imprime como o real com `-H`: estado, filas, local, remoto.
  // Com `-K`, apaga do estado os sockets da porta nos estados pedidos.
  executavel(
    "ss",
    `import os, re, sys
args = sys.argv[1:]
with open(os.environ["TEST_LOG"], "a") as log:
    log.write("ss " + " ".join(args) + "\\n")
arquivo = os.environ["TEST_SOCKETS"]
linhas = [l.split() for l in open(arquivo).read().splitlines() if l.strip()]
filtro = next((a for a in args if a.startswith("(")), None)
porta = re.search(r"sport = :(\\d+)", filtro).group(1) if filtro else None
nomes = {"established": "ESTAB", "close-wait": "CLOSE-WAIT"}
estados = [nomes[args[i + 1]] for i, a in enumerate(args) if a == "state"]
if "-K" in args:
    if os.environ.get("TEST_K_RECUSA") == "1":
        sys.exit(0)
    resto = [l for l in linhas if not (l[1] == porta and l[0] in estados)]
    open(arquivo, "w").write("".join(f"{e} {p}\\n" for e, p in resto))
    sys.exit(0)
for e, p in linhas:
    if porta is None or p == porta:
        print(f"{e} 0 0 10.1.0.4:{p} 140.82.112.21:443")
`,
    "/usr/bin/env python3",
  );
  const r = spawnSync("bash", ["-e", "-c", scriptDoPasso()], {
    cwd: RAIZ,
    env: {
      ...process.env,
      PATH: `${bin}:/usr/bin:/bin`,
      TEST_LOG: log,
      TEST_SOCKETS: estado,
      TEST_K_RECUSA: kRecusa ? "1" : "0",
    },
    encoding: "utf-8",
    timeout: 10_000,
  });
  return {
    status: r.status,
    saida: `${r.stdout}${r.stderr}`,
    chamadas: readFileSync(log, "utf-8").trim().split("\n").filter(Boolean),
    sobra: readFileSync(estado, "utf-8").trim(),
  };
}

const derrubadas = (chamadas: string[]) => chamadas.filter((c) => / -K /.test(c));

describe("portas do Supabase presas antes da reserva", () => {
  it("conexão de saída viva na 54324 é derrubada, e o passo diz que soltou", () => {
    const r = rodar(["ESTAB 54324", "ESTAB 41000"]);
    expect(r.status, r.saida).toBe(0);
    expect(derrubadas(r.chamadas)).toEqual([
      'sudo ss -K -Htan state established state close-wait ( sport = :54324 )',
      'ss -K -Htan state established state close-wait ( sport = :54324 )',
    ]);
    expect(r.sobra).toBe("ESTAB 41000");
    expect(r.saida).toContain("porta(s) 54324 liberadas");
    expect(r.saida).not.toContain("::warning::");
  });

  it("quem escuta numa porta reservada não é derrubado, e o aviso fica", () => {
    const r = rodar(["LISTEN 54322"]);
    expect(r.status, r.saida).toBe(0);
    expect(r.sobra).toBe("LISTEN 54322");
    expect(r.saida).toContain("::warning::porta(s) do Supabase ainda presas por conexão aberta antes da reserva: 54322");
  });

  it("TIME-WAIT não conta como presa", () => {
    const r = rodar(["TIME-WAIT 54321"]);
    expect(r.status, r.saida).toBe(0);
    expect(r.saida).not.toContain("::warning::");
  });

  it("kernel que não deixa derrubar: o aviso de antes, sem falhar o passo", () => {
    const r = rodar(["ESTAB 54324"], { kRecusa: true });
    expect(r.status, r.saida).toBe(0);
    expect(r.sobra).toBe("ESTAB 54324");
    expect(r.saida).toContain("::warning::porta(s) do Supabase ainda presas por conexão aberta antes da reserva: 54324");
  });

  it("nada aberto nas portas do Supabase: nenhum ss -K", () => {
    const r = rodar(["ESTAB 41000", "LISTEN 22"]);
    expect(r.status, r.saida).toBe(0);
    expect(derrubadas(r.chamadas)).toEqual([]);
    expect(r.saida).not.toContain("porta(s)");
  });

  it("a reserva continua lendo as portas do config.toml", () => {
    const r = rodar([]);
    expect(r.status, r.saida).toBe(0);
    const sysctl = r.chamadas.find((c) => c.startsWith("sysctl"));
    expect(sysctl).toMatch(/^sysctl -w net\.ipv4\.ip_local_reserved_ports=54320,54321,54322,54323,54324,54329$/);
  });
});
