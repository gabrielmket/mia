/**
 * O ROBÔ DA SINCRONIZAÇÃO ESCREVE A ISSUE NO FORK, NÃO NO UPSTREAM.
 *
 * FORK: o upstream não tem este workflow (ver docs/FORK-MIA.md, regra 4).
 *
 * O `sincronizar-upstream.yml` cria um remoto chamado `upstream` para medir a
 * fusão. Com mais de um remoto, o `gh` escolhe o repositório pelo NOME do
 * remoto, e `upstream` ganha de `origin`. Sem `GH_REPO`, todo `gh issue` e
 * `gh label` do passo de aviso fala com melgarafael/DeskcommCRM. Medido em
 * 30/09/2026 com o gh 2.102: `gh label list` num clone com os dois remotos
 * devolve os rótulos do upstream; com `GH_REPO` devolve os do fork.
 *
 * Foi o que derrubou o run de 29/09: o `gh label create` tentou criar o rótulo
 * no upstream (o GITHUB_TOKEN só escreve no fork), o erro sumiu num
 * `>/dev/null 2>&1 || true`, e o `gh issue create` parou em "could not add
 * label: 'sincronizar-upstream' not found". A medição estava certa; o aviso
 * nunca saiu.
 *
 * Sem parser YAML nas dependências (ver workflows-tem-permissions.test.ts): o
 * teste corta os passos pela indentação e tem controle positivo, para não ficar
 * verde vigiando nada se o arquivo mudar de forma.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const yml = readFileSync(join(process.cwd(), ".github/workflows/sincronizar-upstream.yml"), "utf8");

/** Linhas sem comentário: um `#` citando `gh issue` não conta como chamada. */
function semComentario(texto: string): string[] {
  return texto.split("\n").filter((l) => !l.trimStart().startsWith("#"));
}

/** Cada passo do job, do seu `- name:`/`- uses:` até o próximo. */
function passos(): string[] {
  const linhas = yml.split("\n");
  const inicios = linhas.flatMap((l, i) => (/^ {6}- (name|uses):/.test(l) ? [i] : []));
  return inicios.map((ini, k) => linhas.slice(ini, inicios[k + 1] ?? linhas.length).join("\n"));
}

const CHAMADA_GH = /(^|[\s;(&|])gh\s+(issue|label|pr|release|repo|run|workflow)\b/;
const GH_REPO_DO_FORK = /^\s+GH_REPO:\s*\$\{\{\s*github\.repository\s*\}\}\s*$/m;

describe("robô da sincronização com o upstream", () => {
  it("o instrumento está vivo: cria o remoto upstream e chama o gh", () => {
    // Controle positivo. Se um dos dois sumir, o teste abaixo perde o sentido,
    // e isso tem de ser decisão de quem mexeu, não um verde por acaso.
    expect(semComentario(yml).some((l) => /git remote add upstream\b/.test(l))).toBe(true);
    const comGh = passos().filter((p) => semComentario(p).some((l) => CHAMADA_GH.test(l)));
    expect(comGh.length).toBeGreaterThan(0);
  });

  it("todo passo que chama o gh aponta o repositório do fork (GH_REPO)", () => {
    const semRepo = passos()
      .filter((p) => semComentario(p).some((l) => CHAMADA_GH.test(l)))
      .filter((p) => {
        if (GH_REPO_DO_FORK.test(p)) return false;
        // Aceita também quem diz o repositório em cada chamada.
        return semComentario(p)
          .filter((l) => CHAMADA_GH.test(l))
          .some((l) => !/\s(-R|--repo)[\s=]/.test(l));
      })
      .map((p) => p.split("\n")[0]!.trim());
    expect(semRepo).toEqual([]);
  });

  it("erro do gh aparece no log em vez de ser engolido", () => {
    const engolidas = semComentario(yml).filter(
      (l) => CHAMADA_GH.test(l) && /2>\s*(&1|\/dev\/null)/.test(l) && /\|\|\s*true/.test(l),
    );
    expect(engolidas).toEqual([]);
  });
});
