/**
 * FORK MIA (MIA-360): o build do e2e é feito UMA vez, no job `e2e-build`, e as
 * 8 partes do `e2e-parte` baixam o `.next` dele.
 *
 * O job novo COPIA os passos de preparo da parte (checkout, portas, Node,
 * Supabase, `.env.e2e`, build). O risco é a cópia ficar para trás: o upstream
 * muda o preparo da parte (232 edições no `e2e.yml` em dois meses), o build
 * passa a sair de um ambiente diferente do que a parte mede, e ninguém repara.
 * Esta cerca pega isso:
 *
 *   1. passo copiado tem de ser IGUAL ao de mesmo nome na parte (sem os
 *      comentários), e na mesma ordem; o build só difere pelo `if: false`;
 *   2. passo novo na parte ANTES do build tem de ser decidido: copiado aqui ou
 *      declarado em `SO_DA_PARTE`, com o motivo;
 *   3. o `if:` dos dois jobs é o mesmo, e a parte depende do build;
 *   4. o sha256 das `NEXT_PUBLIC_*` (scripts/e2e-next-public-sha256.sh) muda
 *      quando o ambiente do bundle muda, e recusa ambiente vazio;
 *   5. o agregador `e2e` reprova quando o build falha (partes `skipped`).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const WORKFLOW = readFileSync(".github/workflows/e2e.yml", "utf-8");

// Sem parser YAML nas dependências: recorte do job pela indentação de dois
// espaços, como em concorrencia-so-nos-jobs-pesados.test.ts.
function blocoDoJob(job: string): string {
  const inicio = WORKFLOW.indexOf(`\n  ${job}:\n`);
  if (inicio < 0) throw new Error(`job ${job} não encontrado`);
  const resto = WORKFLOW.slice(inicio + 1);
  const fim = resto.slice(1).search(/\n  [a-zA-Z0-9_-]+:\n/);
  return fim < 0 ? resto : resto.slice(0, fim + 1);
}

type Passo = { chave: string; texto: string };

/** Passos do job, sem linhas de comentário; a chave é o `name:` ou o `uses:`. */
function passosDoJob(job: string): Passo[] {
  const bloco = blocoDoJob(job);
  const marca = "\n    steps:\n";
  const inicio = bloco.indexOf(marca);
  if (inicio < 0) throw new Error(`job ${job} sem steps`);
  const passos: Passo[] = [];
  for (const parte of `\n${bloco.slice(inicio + marca.length)}`.split(/\n(?= {6}- )/)) {
    const linhas = parte.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
    if (!linhas[0]?.startsWith("      - ")) continue;
    const texto = linhas.join("\n");
    const nome = /^ {6}(?:- | {2})name: (.*)$/m.exec(texto)?.[1];
    const uses = /^ {6}(?:- | {2})uses: (.*)$/m.exec(texto)?.[1];
    passos.push({ chave: nome ?? `uses: ${uses}`, texto });
  }
  return passos;
}

const BUILD = "Build de produção (com o ambiente do E2E)";
const SE_FALSO = /^ {8}if: \$\{\{ false \}\}\n/m;

// Passos que só o `e2e-build` tem: o empacotamento e o envio do artefato.
const SO_DO_BUILD = [
  "Empacotar o build único (MIA-360)",
  "uses: actions/upload-artifact@v7",
  "Medir o envio do build único (MIA-360)",
];

// Passos da parte ANTES do build que o `e2e-build` NÃO copia, e por quê. Passo
// novo do upstream nesse trecho cai fora desta lista e reprova: decida se ele
// muda o ambiente do bundle (copie no `e2e-build`) ou não (declare aqui).
const SO_DA_PARTE: Record<string, string> = {
  "Marcar o relógio da parte (orçamento × teto)": "relógio do teto de 30 min da parte",
  "Subir WAHA e o par Redis da VPS fresca": "serviços da parte 4, não mexem em NEXT_PUBLIC_*",
  "Habilitar extensões exigidas pelo baseline": "banco: o build não lê o banco",
  "Aplicar o baseline.sql e o baseline-mia.sql (o mesmo que o bootstrap aplica)": "banco",
  "Semear a chave de cifra dos segredos (o que o install.sh faz)": "banco",
  "Reiniciar o Realtime (a publication nasceu no passo anterior)": "banco",
  "Isolar Graph e assinatura WAHA da parte causal": "env de servidor da parte 8 (META_*, WAHA), lido no next start",
  "Provar importação após chat inválido (HTTP e banco reais)": "prova da parte 1",
  "Provar isolamento do worker de derivação de mídia": "prova da parte 1",
  "Baixar o build único do e2e-build (MIA-360)": "é o que traz o build",
  "Abrir o build único e conferir as NEXT_PUBLIC_* (MIA-360)": "é o que confere o build",
};

const doBuild = passosDoJob("e2e-build");
const daParte = passosDoJob("e2e-parte");
const indiceDoBuildNaParte = daParte.findIndex((p) => p.chave === BUILD);
const preparoDaParte = daParte.slice(0, indiceDoBuildNaParte);
const copiados = doBuild.filter((p) => !SO_DO_BUILD.includes(p.chave));

describe("e2e-build: a cópia do preparo não fica para trás do e2e-parte", () => {
  it("controle: o recorte enxerga os dois jobs e o build nos dois", () => {
    expect(doBuild.length).toBeGreaterThanOrEqual(8);
    expect(indiceDoBuildNaParte, "o passo de build sumiu do e2e-parte").toBeGreaterThan(5);
    expect(copiados.map((p) => p.chave)).toContain(BUILD);
    expect(copiados.map((p) => p.chave)).toContain("Subir Supabase local (sem a cadeia de migrations)");
  });

  it("todo passo copiado existe na parte e é igual a ele (o build só difere pelo if: false)", () => {
    for (const passo of copiados) {
      const original = daParte.find((p) => p.chave === passo.chave);
      expect(original, `"${passo.chave}" não existe mais no e2e-parte`).toBeDefined();
      const esperado = passo.chave === BUILD ? original!.texto.replace(SE_FALSO, "") : original!.texto;
      expect(passo.texto, `"${passo.chave}" divergiu do e2e-parte: copie a versão nova`).toBe(esperado);
    }
  });

  it("os passos copiados vêm na mesma ordem da parte e todos antes do build", () => {
    const posicoes = copiados.map((p) => daParte.findIndex((q) => q.chave === p.chave));
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));
    expect(copiados.at(-1)?.chave).toBe(BUILD);
  });

  it("passo da parte antes do build é copiado ou declarado só da parte", () => {
    const decididos = new Set([...copiados.map((p) => p.chave), ...Object.keys(SO_DA_PARTE)]);
    const soltos = preparoDaParte.map((p) => p.chave).filter((c) => !decididos.has(c));
    expect(soltos, "passo novo no preparo da parte: copie no e2e-build ou declare em SO_DA_PARTE").toEqual([]);
    // O recíproco: declarado que já não existe é lista mentindo.
    const existentes = new Set(preparoDaParte.map((p) => p.chave));
    expect(Object.keys(SO_DA_PARTE).filter((c) => !existentes.has(c))).toEqual([]);
  });

  it("o build do upstream fica no lugar, desligado, e o env dele é o da cópia", () => {
    const original = daParte[indiceDoBuildNaParte]!.texto;
    expect(original).toMatch(SE_FALSO);
    expect(original).toContain("run: pnpm e2e:build");
    expect(doBuild.find((p) => p.chave === BUILD)!.texto).not.toMatch(SE_FALSO);
  });
});

describe("e2e-build: o encaixe com as partes e o agregador", () => {
  const ifDoJob = (job: string) => /^ {4}if: (.*)$/m.exec(blocoDoJob(job))?.[1];

  it("o if: do e2e-build é o mesmo do e2e-parte", () => {
    expect(ifDoJob("e2e-parte")).toBeTruthy();
    expect(ifDoJob("e2e-build")).toBe(ifDoJob("e2e-parte"));
  });

  it("a parte depende do build; o build só do alcance", () => {
    expect(/^ {4}needs: \[(.*)\]$/m.exec(blocoDoJob("e2e-parte"))?.[1]).toBe("e2e-alcance, e2e-build");
    expect(/^ {4}needs: \[(.*)\]$/m.exec(blocoDoJob("e2e-build"))?.[1]).toBe("e2e-alcance");
  });

  it("a parte baixa o artefato depois de publicar o .env.e2e e antes do build, com o mesmo nome do envio", () => {
    const chaves = daParte.map((p) => p.chave);
    const publica = chaves.indexOf("Publicar o .env.e2e no ambiente do job");
    const baixa = chaves.indexOf("Baixar o build único do e2e-build (MIA-360)");
    const confere = chaves.indexOf("Abrir o build único e conferir as NEXT_PUBLIC_* (MIA-360)");
    expect(publica).toBeGreaterThan(-1);
    expect(baixa).toBeGreaterThan(publica);
    expect(confere).toBe(baixa + 1);
    expect(confere).toBeLessThan(indiceDoBuildNaParte);

    const nome = (texto: string) => /^ {10}name: (.*)$/m.exec(texto)?.[1];
    const envio = doBuild.find((p) => p.chave === "uses: actions/upload-artifact@v7")!.texto;
    expect(nome(envio)).toBe("e2e-next-build");
    expect(nome(daParte[baixa]!.texto)).toBe(nome(envio));
  });

  it("os dois lados calculam o sha256 pelo mesmo script, e a parte falha se diferir", () => {
    const empacota = doBuild.find((p) => p.chave === "Empacotar o build único (MIA-360)")!.texto;
    const confere = daParte.find((p) => p.chave === "Abrir o build único e conferir as NEXT_PUBLIC_* (MIA-360)")!.texto;
    expect(empacota).toContain("bash scripts/e2e-next-public-sha256.sh > .next/e2e-next-public.sha256");
    expect(empacota).toMatch(/--exclude=\.next\/cache/);
    expect(confere).toContain("desta=$(bash scripts/e2e-next-public-sha256.sh)");
    expect(confere).toMatch(/if \[ -z "\$do_build" \] \|\| \[ "\$desta" != "\$do_build" \]; then\n.*\n\s+exit 1/);
  });

  // Recorte do PRIMEIRO `run: |` do job `e2e`, como em e2e-so-aceita-pulo-declarado.
  function scriptDoAgregador(): string {
    const linhas = WORKFLOW.split("\n");
    const job = linhas.findIndex((l) => l === "  e2e:");
    const run = linhas.findIndex((l, i) => i > job && /^\s+run: \|$/.test(l));
    const indent = (linhas[run + 1] ?? "").match(/^\s*/)![0].length;
    const corpo: string[] = [];
    for (const l of linhas.slice(run + 1)) {
      if (l.trim() && l.match(/^\s*/)![0].length < indent) break;
      corpo.push(l.slice(indent));
    }
    return corpo.join("\n");
  }

  it.each(["pull_request", "push"])("build falhou em %s: partes skipped e o agregador reprova", (evento) => {
    const script = scriptDoAgregador();
    expect(script).toContain('[ "$PARTES" = "success" ]');
    const env = {
      PATH: process.env.PATH,
      GITHUB_STEP_SUMMARY: "/dev/null",
      EVENTO: evento,
      PORTAO: "success",
      ALCANCE: "sim",
      HEAD_VELHO: "nao",
    };
    const rodar = (partes: string) =>
      spawnSync("bash", ["-c", script], {
        env: { ...env, PARTES: partes } as unknown as NodeJS.ProcessEnv,
        stdio: "pipe",
      }).status;
    expect(rodar("success"), "controle: partes verdes passam").toBe(0);
    expect(rodar("skipped")).not.toBe(0);
  });
});

describe("scripts/e2e-next-public-sha256.sh", () => {
  const BASE = [
    "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY=chave-anonima-ficticia",
    "NEXT_PUBLIC_APP_URL=http://localhost:3001",
    "WAHA_API_KEY=e2e-placeholder-nao-e-segredo",
  ];

  function hash(linhas: string[], extra: Record<string, string> = {}): { status: number | null; saida: string } {
    const dir = mkdtempSync(join(tmpdir(), "next-public-"));
    writeFileSync(join(dir, ".env.e2e"), `${linhas.join("\n")}\n`);
    const r = spawnSync("bash", ["scripts/e2e-next-public-sha256.sh", dir], {
      env: { PATH: process.env.PATH, ...extra } as unknown as NodeJS.ProcessEnv,
      stdio: "pipe",
      encoding: "utf-8",
    });
    return { status: r.status, saida: r.stdout.trim() };
  }

  it("mesmo ambiente, mesmo hash; variável de servidor não entra", () => {
    const a = hash(BASE);
    expect(a.status).toBe(0);
    expect(a.saida).toMatch(/^[0-9a-f]{64}$/);
    expect(hash(BASE).saida).toBe(a.saida);
    expect(hash([...BASE.slice(0, 3), "WAHA_API_KEY=outra"]).saida).toBe(a.saida);
    expect(hash(BASE, { META_GRAPH_BASE_URL: "http://127.0.0.1:9" }).saida).toBe(a.saida);
  });

  it("NEXT_PUBLIC_* diferente muda o hash, inclusive uma que nascer depois", () => {
    const a = hash(BASE).saida;
    expect(hash([BASE[0]!, BASE[1]!, "NEXT_PUBLIC_APP_URL=http://localhost:3002", BASE[3]!]).saida).not.toBe(a);
    expect(hash([...BASE, "NEXT_PUBLIC_NOVA=1"]).saida).not.toBe(a);
  });

  it("o .env.e2e vence o ambiente do job, como no scripts/e2e-build.sh", () => {
    expect(hash(BASE, { NEXT_PUBLIC_APP_URL: "http://outro:9" }).saida).toBe(hash(BASE).saida);
  });

  it("recusa NEXT_PUBLIC_* obrigatória vazia ou ausente, e .env.e2e ausente", () => {
    expect(hash([BASE[0]!, BASE[2]!]).status).not.toBe(0);
    expect(hash([BASE[0]!, "NEXT_PUBLIC_SUPABASE_ANON_KEY=", BASE[2]!]).status).not.toBe(0);
    const vazio = mkdtempSync(join(tmpdir(), "next-public-"));
    expect(() => execFileSync("bash", ["scripts/e2e-next-public-sha256.sh", vazio], { stdio: "pipe" })).toThrow();
  });
});
