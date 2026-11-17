import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * FORK MIA: O CATÁLOGO DO FORK CITA TODA FUNÇÃO DO FORK.
 *
 * `docs/fork/CATALOGO.md` é o roteiro de quem confere, a cada fusão do upstream e a
 * cada função nova, se as nossas funções continuam ligadas (a trava da empresa de
 * demonstração, os pontos de encaixe `FORK MIA`, o MCP de plataforma, a LGPD...).
 * Cada função do fork tem o seu documento em `docs/fork/<nome>.md`.
 *
 * O defeito que esta cerca fecha: uma função nova entra com o documento dela e o
 * catálogo não é atualizado. Quem confere a fusão seguinte, guiado pelo catálogo,
 * nunca olha aquela função, e ela pode ser desligada pelo upstream sem ninguém ver.
 * Não dá erro nem teste vermelho: é um buraco de cobertura, igual ao das telas sem
 * manual no assistente.
 *
 * Vermelho = acrescente ao `docs/fork/CATALOGO.md` a seção da função (o que faz, onde
 * mora, os pontos de encaixe no upstream, o que a protege, como conferir depois de
 * uma fusão) e a linha dela na tabela final, no mesmo PR. O documento é citado pelo
 * nome do arquivo, por exemplo `trava-de-robo.md`.
 *
 *     npx vitest run tests/unit/catalogo-do-fork-cobre-cada-funcao.test.ts
 */
const RAIZ = process.cwd();
const PASTA = join(RAIZ, "docs", "fork");
const CATALOGO = "CATALOGO.md";

function documentosDasFuncoes(): string[] {
  return readdirSync(PASTA)
    .filter((nome) => nome.endsWith(".md") && nome !== CATALOGO)
    .sort();
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// O nome conta inteiro: `agenda-microsoft.md` não é satisfeito por `meu-agenda-microsoft.md`.
function cita(catalogo: string, documento: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_-])${escapar(documento)}`).test(catalogo);
}

describe("o catálogo do fork cita toda função do fork", () => {
  it("o catálogo existe e há função para cobrir (controle positivo)", () => {
    expect(
      existsSync(join(PASTA, CATALOGO)),
      "Falta docs/fork/CATALOGO.md: o roteiro de conferência do fork. Ele é lido a cada fusão do upstream.",
    ).toBe(true);
    // Sem este piso a cerca ficaria verde vigiando nada se a pasta mudasse de lugar.
    expect(documentosDasFuncoes().length).toBeGreaterThanOrEqual(22);
  });

  it("nenhum docs/fork/*.md ficou de fora do CATALOGO.md", () => {
    const catalogo = readFileSync(join(PASTA, CATALOGO), "utf8");
    const faltam = documentosDasFuncoes().filter((doc) => !cita(catalogo, doc));
    expect(
      faltam,
      `O docs/fork/CATALOGO.md não cita: ${faltam.join(", ")}.\n` +
        "Cada função do fork precisa da sua seção no catálogo (o que faz, onde mora, os pontos de " +
        "encaixe no upstream, o que a protege, como conferir depois de uma fusão) e da sua linha na " +
        "tabela final. Escreva-as no mesmo PR da função, citando o documento pelo nome do arquivo.",
    ).toEqual([]);
  });

  it("a cerca enxerga a falta (o nome de um documento que não existe não passa)", () => {
    const catalogo = readFileSync(join(PASTA, CATALOGO), "utf8");
    expect(cita(catalogo, "funcao-que-nao-existe.md")).toBe(false);
    expect(cita("veja meu-trava-de-robo.md", "trava-de-robo.md")).toBe(false);
    expect(cita("veja [`trava-de-robo.md`](trava-de-robo.md)", "trava-de-robo.md")).toBe(true);
  });
});
