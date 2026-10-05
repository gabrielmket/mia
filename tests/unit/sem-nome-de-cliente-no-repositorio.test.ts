/**
 * FORK MIA — catraca: nome de cliente real não volta ao repositório.
 *
 * O repositório é público. Comentário de medição ("medido na empresa tal"),
 * fixture de teste e documento de auditoria já carregaram nome de cliente, um
 * telefone de chip e um id de grupo do WhatsApp. Foram trocados por nomes
 * fictícios (Academia Alfa, Academia Beta, Vita Odonto, Construtora Delta,
 * Protetora Zeta, Bosque Aurora) e por identificadores sintéticos.
 *
 * As impressões dos nomes moram em `tests/helpers/nomes-reservados.ts`, que
 * guarda só o SHA-256 de cada um. Aqui a varredura: todo arquivo de texto do
 * repositório, rastreado ou não (fora do .gitignore), para o nome ser pego
 * antes do commit.
 *
 * Precisa citar onde algo foi medido? Diga "numa implantação" ou use um dos
 * nomes fictícios acima. Fora da varredura: o histórico do git.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";

import { describe, expect, it } from "vitest";

import { impressaoDoNome, nomesReservadosEm, palavrasComparaveis, trechosComImpressao } from "../helpers/nomes-reservados";

const TEXTO = /\.(?:[cm]?[jt]sx?|json|md|mdx|sql|sh|ya?ml|html?|css|txt|toml|env|example|conf|ini|svg|csv)$/i;
/** Gerado por máquina e sem prosa: só custa tempo. */
const FORA = new Set(["pnpm-lock.yaml"]);

function arquivos(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((f) => f && TEXTO.test(f) && !FORA.has(f) && fs.existsSync(f)); // --cached lista também o apagado do disco
}

/** A linha (1-based) em que começa a palavra de número `alvo` do texto. */
function linhaDaPalavra(texto: string, alvo: number): number {
  let vistas = 0;
  const linhas = texto.split("\n");
  for (let i = 0; i < linhas.length; i += 1) {
    vistas += palavrasComparaveis(linhas[i]!).length;
    if (vistas > alvo) return i + 1;
  }
  return linhas.length;
}

describe("nome de cliente real não volta ao repositório", () => {
  it("nenhum arquivo de texto cita um nome reservado", () => {
    const achados: string[] = [];
    for (const arquivo of arquivos()) {
      const texto = fs.readFileSync(arquivo, "utf8");
      for (const a of nomesReservadosEm(texto)) {
        // Só o caminho, a linha e a entrada: a mensagem de falha não repete o nome.
        achados.push(`${arquivo}:${linhaDaPalavra(texto, a.palavra)} (entrada ${a.entrada})`);
      }
    }
    expect(achados, "troque por um nome fictício (ver o cabeçalho)").toEqual([]);
  }, 60_000);

  it("a sonda enxerga o nome com acento, caixa e quebra de linha no meio", () => {
    // Controle positivo com um nome INVENTADO: a comparação é pela impressão,
    // então o caso prova o caminho inteiro (normalizar, sonda, SHA-256) sem
    // escrever nome de cliente nenhum.
    const impressao = impressaoDoNome("Empresa Inventada Açaí");
    expect(impressao).toMatch(/^[0-9a-f]{8}:[0-9a-f]{64}$/);
    expect(impressaoDoNome("EMPRESA\n * inventada acai")).toBe(impressao);

    const comentario = "/**\n * Medido na Empresa\n * Inventada Açaí (18/09/2026): o turno adiado.\n */";
    const achados = trechosComImpressao(comentario, [impressao, impressaoDoNome("5511900000001")]);
    expect(achados).toEqual([{ palavra: 2, tamanho: 3, entrada: impressao.slice(9, 17) }]);
    expect(linhaDaPalavra(comentario, achados[0]!.palavra)).toBe(2);
    expect(trechosComImpressao("chip +55 (11) 90000-0001 e 5511900000001", [impressaoDoNome("5511900000001")])).toHaveLength(1);

    expect(palavrasComparaveis("Medido na Empresa-Inventada (18/09)")).toEqual(["medido", "na", "empresa", "inventada", "18", "09"]);
    expect(nomesReservadosEm("Texto sem nome reservado nenhum, com 5511900000001.")).toEqual([]);
  });
});
