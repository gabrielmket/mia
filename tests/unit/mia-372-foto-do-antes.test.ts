/**
 * MIA-372 · a prova de que tirar o nosso do `lib/i18n/dicionario.ts` e do
 * `lib/audit/actions.ts` do upstream não mudou nada: nem o que o cliente lê,
 * nem o que a auditoria grava.
 *
 * A foto em `tests/fixtures/mia-372-antes/` foi tirada na cabeça da
 * `time/fusao-v1.126-v1.127` (e07768af0f), ANTES da troca: o `DICIONARIO`
 * montado, um arquivo por idioma (chave em português → texto), e o
 * `AUDIT_ACTIONS` na ordem de então. O gerador não ficou no repositório: era
 * importar os dois e gravar o JSON, com as chaves em ordem.
 *
 * É uma prova de UMA troca, não uma cerca para sempre: frase nova ou texto
 * corrigido depois desta troca reprova aqui de propósito. Este teste e a foto
 * saem no primeiro PR depois que a MIA-372 for juntada.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { DICIONARIO } from "@/lib/i18n/dicionario";

const RAIZ = process.cwd();
const FOTO = join(RAIZ, "tests/fixtures/mia-372-antes");

function foto<T>(arquivo: string): T {
  return JSON.parse(readFileSync(join(FOTO, arquivo), "utf8")) as T;
}

/**
 * As duas frases do upstream que o fork APAGAVA do dicionário dele, para pôr no
 * lugar as da plataforma (o crédito de IA é da plataforma). Agora o arquivo do
 * upstream fica inteiro e elas voltam a ter espanhol. Nenhum código chama essas
 * frases (o último caso deste arquivo confere), então nada muda na tela.
 */
const VOLTARAM_DO_UPSTREAM = [
  "As respostas aos clientes estão esperando. Recarregue o saldo na conta do provedor: elas saem sozinhas quando o saldo voltar, durante até 6 horas. Depois disso, a conversa que não foi respondida aparece aqui na Central.",
  "Recarregue o saldo na conta do provedor: as respostas saem sozinhas quando ele voltar.",
];

const IDIOMAS = readdirSync(FOTO)
  .map((f) => /^dicionario\.(.+)\.json$/.exec(f)?.[1])
  .filter((i): i is string => Boolean(i));

describe("MIA-372 · o dicionário montado é o mesmo de antes", () => {
  it("a foto tem os idiomas que o dicionário usa", () => {
    expect(IDIOMAS.sort()).toEqual(["en", "es"]);
    const usados = new Set<string>();
    for (const entrada of Object.values(DICIONARIO)) for (const i of Object.keys(entrada)) usados.add(i);
    expect([...usados].sort()).toEqual(IDIOMAS);
  });

  it.each(IDIOMAS)("%s: as mesmas chaves, com o mesmo texto, chave a chave", (idioma) => {
    const antes = foto<Record<string, string>>(`dicionario.${idioma}.json`);
    const agora: Record<string, string> = {};
    for (const [chave, entrada] of Object.entries(DICIONARIO)) {
      const texto = (entrada as Record<string, string | undefined>)[idioma];
      if (texto !== undefined && !VOLTARAM_DO_UPSTREAM.includes(chave)) agora[chave] = texto;
    }

    const sumiram = Object.keys(antes).filter((k) => !(k in agora));
    const nasceram = Object.keys(agora).filter((k) => !(k in antes));
    const mudaram = Object.keys(antes)
      .filter((k) => k in agora && agora[k] !== antes[k])
      .map((k) => ({ chave: k, antes: antes[k], agora: agora[k] }));

    expect(sumiram, "chave que tinha texto e perdeu").toEqual([]);
    expect(nasceram, "chave que ganhou texto").toEqual([]);
    expect(mudaram, "texto que mudou").toEqual([]);
    expect(Object.keys(agora).length).toBe(Object.keys(antes).length);
  });

  it("as duas frases que voltaram do upstream não são chamadas por código nenhum", () => {
    const achados: string[] = [];
    const anda = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        if (nome === "node_modules" || nome.startsWith(".")) continue;
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) {
          anda(caminho);
          continue;
        }
        if (!/\.(ts|tsx|js|mjs)$/.test(nome)) continue;
        const rel = caminho.slice(RAIZ.length + 1);
        if (rel.startsWith("lib/i18n/")) continue;
        const fonte = readFileSync(caminho, "utf8");
        for (const frase of VOLTARAM_DO_UPSTREAM) if (fonte.includes(frase)) achados.push(rel);
      }
    };
    for (const raiz of ["app", "components", "hooks", "lib", "workers"]) anda(join(RAIZ, raiz));
    expect(achados).toEqual([]);
    for (const frase of VOLTARAM_DO_UPSTREAM) expect(DICIONARIO[frase]?.es).toBeTruthy();
  });
});

describe("MIA-372 · a lista de ações de auditoria é a mesma de antes", () => {
  it("os mesmos códigos, sem faltar nem sobrar nem repetir", () => {
    const antes = foto<string[]>("acoes-de-auditoria.json");
    const agora = [...AUDIT_ACTIONS] as string[];
    expect(agora.length).toBe(antes.length);
    expect(new Set(agora).size).toBe(agora.length);
    expect(agora.filter((a) => !antes.includes(a)), "código novo").toEqual([]);
    expect(antes.filter((a) => !agora.includes(a)), "código que sumiu").toEqual([]);
  });

  it("a ordem do upstream não mudou; só as nossas subiram para o bloco do topo", () => {
    const antes = foto<string[]>("acoes-de-auditoria.json");
    const agora = [...AUDIT_ACTIONS] as string[];
    const fonte = readFileSync(join(RAIZ, "lib/audit/actions.ts"), "utf8");
    const fimDoBloco = fonte.indexOf("// ── fim do bloco da MIA");
    expect(fimDoBloco).toBeGreaterThan(0);
    const nossas = new Set(
      [...fonte.slice(0, fimDoBloco).matchAll(/^\s*"([^"]+)",\s*$/gm)].map((m) => m[1]),
    );
    expect(agora.slice(0, nossas.size)).toEqual(antes.filter((a) => nossas.has(a)));
    expect(agora.slice(nossas.size)).toEqual(antes.filter((a) => !nossas.has(a)));
  });
});
