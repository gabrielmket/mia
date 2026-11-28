// @vitest-environment node
/**
 * A seção "Assinaturas que mudaram" do `scripts/sincronizar-upstream.mjs`.
 *
 * FORK: o upstream não tem este script (ver docs/FORK-MIA.md, regra 4).
 *
 * Função do upstream que muda de assinatura quebra arquivo nosso que nem deu
 * conflito, e só o typecheck da CI acusa (fusão 1.107: 13 erros). A medição lê
 * o código das duas versões com o parser do TypeScript, sem checker. Aqui, dois
 * trechos fictícios de antes e depois provam o que ela acha (parâmetro novo
 * obrigatório, parâmetro removido, retorno trocado, função renomeada, campo novo
 * de tipo) e o que ela NÃO acusa (mudança só de corpo, de comentário, de nome de
 * parâmetro). No fim, um repositório git descartável prova a ponta inteira:
 * quem chama, o que é nosso e a assinatura que o fork mudou e o upstream novo
 * chama do jeito dele (o `hubSections` da 1.107).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  acrescimoInofensivo,
  assinaturasDoArquivo,
  compararAssinaturas,
  linhasDaSecao,
  medirAssinaturas,
  resolverImportacao,
  trocou,
  usosNoArquivo,
  type ResultadoDaMedicao,
} from "../../scripts/assinaturas-do-upstream.mjs";

const ANTES = `
import type { SupabaseClient } from "@supabase/supabase-js";

/** Cria o registro. */
export async function criarRegistro(db: SupabaseClient, nome: string): Promise<string> {
  return nome;
}

export function removerRegistro(id: string, motivo: string): void {
  void id;
  void motivo;
}

export function contarRegistros(lista: string[]): number {
  return lista.length;
}

export const nomeAntigo = (id: string, quantidade: number): string => id + quantidade;

export function soCorpo(texto: string): string {
  return texto;
}

export function soNomeDoParametro(valor: number): number {
  return valor;
}

export function ganhaOpcionalNoFim(a: string): string {
  return a;
}

export interface LinhaDaTabela {
  id: string;
  nome: string | null;
}

export type Estado = "aberto" | "fechado";

function interna(x: string): string {
  return x;
}
`;

const DEPOIS = `
import type { SupabaseClient } from "@supabase/supabase-js";

/** Cria o registro, agora dentro da organização. */
export async function criarRegistro(db: SupabaseClient, organizacaoId: string, nome: string): Promise<string> {
  return organizacaoId + nome;
}

export function removerRegistro(id: string): void {
  void id;
}

export function contarRegistros(lista: string[]): string {
  return String(lista.length);
}

export const nomeNovo = (codigo: string, total: number): string => codigo + total;

export function soCorpo(texto: string): string {
  // corpo diferente, comentário diferente, mesma assinatura
  const limpo = texto.trim();
  return limpo;
}

export function soNomeDoParametro(outroNome: number): number {
  return outroNome * 2;
}

export function ganhaOpcionalNoFim(a: string, b?: number): string {
  return a + (b ?? "");
}

export interface LinhaDaTabela {
  id: string;
  nome: string | null;
  criadaEm: string | null;
}

export type Estado = "aberto" | "fechado" | "arquivado";

function interna(x: string, y: string): string {
  return x + y;
}
`;

function mudancasPorNome() {
  const lista = compararAssinaturas(assinaturasDoArquivo(ts, ANTES, "lib/x.ts"), assinaturasDoArquivo(ts, DEPOIS, "lib/x.ts"));
  return new Map(lista.map((m) => [m.nome, m]));
}

describe("compararAssinaturas: dois trechos fictícios de antes e depois", () => {
  const porNome = mudancasPorNome();

  it("parâmetro novo obrigatório aparece, na posição certa e com o tipo", () => {
    const m = porNome.get("criarRegistro");
    expect(m?.motivos).toEqual(["parâmetro novo obrigatório na posição 2: organizacaoId: string"]);
    expect(m?.antes).toBe("(db: SupabaseClient, nome: string): Promise<string>");
    expect(m?.depois).toBe("(db: SupabaseClient, organizacaoId: string, nome: string): Promise<string>");
  });

  it("parâmetro removido aparece", () => {
    expect(porNome.get("removerRegistro")?.motivos).toEqual(["parâmetro removido na posição 2: motivo: string"]);
  });

  it("retorno trocado aparece", () => {
    expect(porNome.get("contarRegistros")?.motivos).toEqual(["retorno trocou: number → string"]);
  });

  it("função renomeada aparece com o nome novo (mesma forma, nome de parâmetro não importa)", () => {
    const m = porNome.get("nomeAntigo");
    expect(m?.motivos).toEqual(["renomeada: nomeAntigo → nomeNovo"]);
    expect(m?.renomeadaPara).toBe("nomeNovo");
    expect(porNome.has("nomeNovo")).toBe(false);
  });

  it("mudança só de corpo, de comentário ou de nome de parâmetro não aparece", () => {
    expect(porNome.has("soCorpo")).toBe(false);
    expect(porNome.has("soNomeDoParametro")).toBe(false);
  });

  it("função que não é exportada não aparece", () => {
    expect(porNome.has("interna")).toBe(false);
  });

  it("tipo exportado: campo novo obrigatório e união que ganhou membro aparecem", () => {
    expect(porNome.get("LinhaDaTabela")?.motivos).toEqual(["campo novo obrigatório: criadaEm: string | null"]);
    expect(porNome.get("Estado")?.motivos).toEqual(['o tipo trocou: "aberto" | "fechado" → "aberto" | "fechado" | "arquivado"']);
  });

  it("parâmetro opcional novo no fim aparece, mas marcado como acréscimo que não quebra", () => {
    const m = porNome.get("ganhaOpcionalNoFim");
    expect(m?.motivos).toEqual(["parâmetro novo opcional na posição 2: b?: number"]);
    expect(acrescimoInofensivo(m!.motivos[0]!, 1)).toBe(true);
    expect(acrescimoInofensivo("parâmetro novo opcional na posição 1: b?: number", 1)).toBe(false);
    expect(acrescimoInofensivo(porNome.get("criarRegistro")!.motivos[0]!, 2)).toBe(false);
  });

  it("o que mudou é só isto (controle: nada a mais)", () => {
    expect([...porNome.keys()].sort()).toEqual(
      ["Estado", "LinhaDaTabela", "contarRegistros", "criarRegistro", "ganhaOpcionalNoFim", "nomeAntigo", "removerRegistro"].sort(),
    );
  });

  it("parâmetro-objeto diz qual campo mudou", () => {
    const a = assinaturasDoArquivo(ts, "export function f(p: { a: string; b: number }): void {}", "f.ts");
    const d = assinaturasDoArquivo(ts, "export function f(p: { a: string; b: number; c: boolean }): void {}", "f.ts");
    expect(compararAssinaturas(a, d)[0]?.motivos).toEqual(["parâmetro 1 (p), campo novo obrigatório: c: boolean"]);
  });

  it("sobrecarga: a implementação não conta, as declarações sim", () => {
    const fonte = (extra: string) => `
      export function g(a: string): string;
      export function g(a: number${extra}): number;
      export function g(a: unknown): unknown { return a; }`;
    const a = assinaturasDoArquivo(ts, fonte(""), "g.ts");
    const d = assinaturasDoArquivo(ts, fonte(", b: string"), "g.ts");
    expect(compararAssinaturas(a, d)[0]?.motivos).toEqual(["parâmetro novo obrigatório na posição 2 (sobrecarga 2): b: string"]);
  });

  it("export { a as b } de declaração local entra com o nome público", () => {
    const ass = assinaturasDoArquivo(ts, "function local(x: string): void {}\nexport { local as publica };", "h.ts");
    expect(Object.keys(ass)).toEqual(["publica"]);
  });

  it("texto longo mostra só o trecho que mudou", () => {
    const base = Array.from({ length: 20 }, (_, i) => `"acao_${i}"`).join(" | ");
    const resumo = trocou(base, `${base.slice(0, 100)} | "nova"${base.slice(100)}`);
    expect(resumo.length).toBeLessThan(160);
    expect(resumo).toContain('"nova"');
  });
});

describe("usosNoArquivo: quem importa e usa", () => {
  const vigiados = new Map([["lib/users/nome", new Set(["nomes", "Linha"])]]);

  it("acha pelo alias @/, pelo caminho relativo e pelo apelido do import, com a linha", () => {
    const pelaArroba = 'import { nomes } from "@/lib/users/nome";\n\nconst x = nomes("a");\n';
    expect(usosNoArquivo(ts, pelaArroba, "lib/a/b.ts", vigiados)).toEqual([{ modulo: "lib/users/nome", nome: "nomes", linhas: [3] }]);

    const relativo = 'import { nomes as n, type Linha } from "../users/nome";\nlet l: Linha;\nn(l);\n';
    expect(usosNoArquivo(ts, relativo, "lib/a/b.ts", vigiados)).toEqual([
      { modulo: "lib/users/nome", nome: "nomes", linhas: [3] },
      { modulo: "lib/users/nome", nome: "Linha", linhas: [2] },
    ]);
  });

  it("nome igual de outro módulo, ou em propriedade, não conta", () => {
    const outro = 'import { nomes } from "@/lib/outro";\nnomes();\n';
    expect(usosNoArquivo(ts, outro, "lib/a/b.ts", vigiados)).toEqual([]);
    const propriedade = 'import { nomes } from "@/lib/users/nome";\nconst o = { nomes: 1 };\no.nomes;\n';
    expect(usosNoArquivo(ts, propriedade, "lib/a/b.ts", vigiados)).toEqual([{ modulo: "lib/users/nome", nome: "nomes", linhas: [1] }]);
  });

  it("resolve o import do jeito do repositório", () => {
    expect(resolverImportacao("@/lib/x/index", "a.ts")).toBe("lib/x");
    expect(resolverImportacao("./y.ts", "lib/x/a.ts")).toBe("lib/x/y");
    expect(resolverImportacao("react", "a.ts")).toBeNull();
  });
});

/* ── A ponta inteira, num repositório git descartável ──────────────────────*/

describe("medirAssinaturas: upstream, fork e quem chama", () => {
  let pasta = "";
  let resultado: ResultadoDaMedicao;
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=teste", "-c", "user.email=teste@exemplo.invalid", "-c", "commit.gpgsign=false", ...args], {
      cwd: pasta,
      encoding: "utf8",
    }).trim();
  const escrever = (arquivo: string, texto: string) => {
    mkdirSync(dirname(join(pasta, arquivo)), { recursive: true });
    writeFileSync(join(pasta, arquivo), texto);
  };

  beforeAll(() => {
    pasta = mkdtempSync(join(tmpdir(), "assinaturas-"));
    git("init", "-q", "-b", "main");
    // Base do upstream: a função dele, um arquivo dele com bloco nosso, e um chamador dele.
    escrever("lib/users/nome.ts", 'export async function nomes(ids: string[]): Promise<string[]> {\n  return ids;\n}\n');
    escrever("lib/nav/registro.ts", "export function secoes(grupo: string, modulos?: string[]): string[] {\n  return [grupo, ...(modulos ?? [])];\n}\n");
    escrever("lib/dele/usa.ts", 'import { nomes } from "@/lib/users/nome";\nexport const x = () => nomes([]);\n');
    git("add", ".");
    git("commit", "-q", "-m", "base");
    git("tag", "antes");

    // O fork: módulo só nosso que chama a função dele, e um parâmetro nosso no meio de `secoes`.
    git("checkout", "-q", "-b", "fork");
    escrever("lib/nosso/painel.ts", 'import { nomes } from "@/lib/users/nome";\n\nexport const painel = () => nomes(["a"]);\n');
    escrever(
      "lib/nav/registro.ts",
      "// FORK MIA: o modo de venda vem antes dos módulos.\nexport function secoes(grupo: string, modo: string | undefined, modulos?: string[]): string[] {\n  return [grupo, modo ?? \"\", ...(modulos ?? [])];\n}\n",
    );
    git("add", ".");
    git("commit", "-q", "-m", "fork");

    // O upstream anda: `nomes` ganha a organização na frente, e um teste novo dele chama `secoes` do jeito dele.
    git("checkout", "-q", "main");
    escrever("lib/users/nome.ts", 'export async function nomes(orgId: string, ids: string[]): Promise<string[]> {\n  return [orgId, ...ids];\n}\n');
    escrever("lib/dele/usa.ts", 'import { nomes } from "@/lib/users/nome";\nexport const x = () => nomes("org", []);\n');
    escrever("tests/secoes.test.ts", 'import { secoes } from "@/lib/nav/registro";\n\nsecoes("crm", ["agenda"]);\n');
    git("add", ".");
    git("commit", "-q", "-m", "upstream anda");
    git("tag", "depois");

    resultado = medirAssinaturas({ ts, antes: "antes", depois: "depois", cabeca: "fork", cwd: pasta });
  });

  afterAll(() => {
    if (pasta) rmSync(pasta, { recursive: true, force: true });
  });

  it("acha a função que mudou e o arquivo NOSSO que a chama, com a linha (o do upstream não conta)", () => {
    expect(resultado.mudancas).toHaveLength(1);
    const m = resultado.mudancas[0]!;
    expect(m).toMatchObject({ arquivo: "lib/users/nome.ts", nome: "nomes", provavelQuebra: true });
    expect(m.motivos).toEqual(["parâmetro novo obrigatório na posição 1: orgId: string"]);
    expect(m.chamadores).toEqual(["lib/nosso/painel.ts:3"]);
  });

  it("acha a assinatura que o fork mudou e que o upstream novo chama do jeito dele", () => {
    expect(resultado.divergencias).toHaveLength(1);
    const d = resultado.divergencias[0]!;
    expect(d).toMatchObject({ arquivo: "lib/nav/registro.ts", nome: "secoes" });
    expect(d.motivos).toEqual(["parâmetro novo obrigatório na posição 2: modo: string | undefined"]);
    expect(d.chamadores).toEqual(["tests/secoes.test.ts:3"]);
  });

  it("o relatório em texto tem a seção, com antes, depois e quem usa", () => {
    const texto = linhasDaSecao(resultado).join("\n");
    expect(texto).toContain("Assinaturas que mudaram: 1 no upstream, 1 usadas por arquivo nosso, 1 provavelmente quebram quem usa");
    expect(texto).toContain("antes:  (ids: string[]): Promise<string[]>");
    expect(texto).toContain("depois: (orgId: string, ids: string[]): Promise<string[]>");
    expect(texto).toContain("quem usa: lib/nosso/painel.ts:3");
    expect(texto).toContain("quem chama no upstream: tests/secoes.test.ts:3");
  });
});
