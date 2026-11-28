// @vitest-environment node
/**
 * As fatias do `invariants-majors` são cortadas por PESO (MIA-346), e o corte
 * novo não pode deixar arquivo de invariante sem rodar.
 *
 * O que esta cerca fecha, todos erros VERDES no CI:
 *  1. arquivo que não cai em fatia nenhuma, ou cai em duas (o `--shard` do vitest
 *     garantia a partição; o corte por peso tem de garantir de novo);
 *  2. divisão que depende da ORDEM em que o vitest entregou os arquivos — cada
 *     fatia roda num runner diferente e calcula a divisão sozinha;
 *  3. o sequenciador sair da config (o corte volta ao hash sem ninguém ver) ou
 *     deixar de sortear a ordem dentro da fatia (issue #207).
 */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import type { TestSpecification } from "vitest/node";

import {
  CUSTO_FIXO_POR_ARQUIVO,
  PESO_PADRAO,
  embaralhar,
  fatiaPorPeso,
  pesoDoArquivo,
} from "../db/fatia-por-peso";
import pesosMedidos from "../db/peso-dos-invariantes.json";
import SequenciadorDosInvariantes from "../db/sequenciador-dos-invariantes";

const RAIZ = path.resolve(__dirname, "../..");
const PESOS = pesosMedidos.segundos as Record<string, number>;
const ARQUIVOS = globSync("tests/invariants/**/*.test.ts", { cwd: RAIZ })
  .map((p) => p.split(path.sep).join("/"))
  .sort();

function fatias(caminhos: readonly string[], total: number): string[][] {
  return Array.from({ length: total }, (_, i) => fatiaPorPeso(caminhos, i + 1, total, PESOS));
}

describe("fatias dos invariantes por peso (MIA-346)", () => {
  it("controle positivo: a lista de invariantes e a tabela de pesos foram lidas", () => {
    expect(ARQUIVOS.length).toBeGreaterThan(500);
    expect(Object.keys(PESOS).length).toBeGreaterThan(20);
    const medidosQueExistem = Object.keys(PESOS).filter((p) => ARQUIVOS.includes(p));
    expect(medidosQueExistem.length, "a tabela não casa com nenhum caminho real").toBeGreaterThan(20);
  });

  it.each([1, 2, 3, 4, 5, 6])("com %i fatia(s), todo arquivo roda exatamente uma vez", (total) => {
    const todas = fatias(ARQUIVOS, total).flat();
    expect(todas).toHaveLength(ARQUIVOS.length);
    expect([...todas].sort()).toEqual(ARQUIVOS);
  });

  it("arquivo novo, fora da tabela, cai numa fatia só", () => {
    const novo = "tests/invariants/um-invariante-que-ainda-nao-tem-medida.test.ts";
    const comNovo = [...ARQUIVOS, novo];
    const onde = fatias(comNovo, 4).map((f) => f.includes(novo));
    expect(onde.filter(Boolean)).toHaveLength(1);
    expect(pesoDoArquivo(novo, PESOS)).toBe(PESO_PADRAO + CUSTO_FIXO_POR_ARQUIVO);
  });

  it("a divisão não depende da ordem em que os arquivos chegam", () => {
    const embaralhados = embaralhar([...ARQUIVOS], 1795829445174);
    expect(embaralhados).not.toEqual(ARQUIVOS);
    expect(fatias(embaralhados, 4)).toEqual(fatias(ARQUIVOS, 4));
  });

  it("as quatro fatias ficam equilibradas pelo peso medido (a mais pesada até 10% acima da média)", () => {
    const cargas = fatias(ARQUIVOS, 4).map((f) => f.reduce((s, c) => s + pesoDoArquivo(c, PESOS), 0));
    const media = cargas.reduce((a, b) => a + b, 0) / cargas.length;
    expect(Math.max(...cargas) / media).toBeLessThan(1.1);
  });

  it("recusa fatia fora do intervalo em vez de devolver lista vazia", () => {
    expect(() => fatiaPorPeso(ARQUIVOS, 0, 4, PESOS)).toThrow(/fora de 1\.\.4/);
    expect(() => fatiaPorPeso(ARQUIVOS, 5, 4, PESOS)).toThrow(/fora de 1\.\.4/);
    expect(() => fatiaPorPeso(ARQUIVOS, 1, 0, PESOS)).toThrow(/total de fatias/);
  });

  it("o embaralhamento é uma permutação e repete com a mesma semente", () => {
    const a = embaralhar([...ARQUIVOS], 42);
    expect([...a].sort()).toEqual(ARQUIVOS);
    expect(embaralhar([...ARQUIVOS], 42)).toEqual(a);
    expect(embaralhar([...ARQUIVOS], 43)).not.toEqual(a);
  });
});

describe("o sequenciador da suíte de banco", () => {
  const specs = ARQUIVOS.map((p) => ({ moduleId: path.join(RAIZ, p) }) as unknown as TestSpecification);
  const logs: string[] = [];
  const sequenciador = (shard?: { index: number; count: number }, seed?: number) =>
    new SequenciadorDosInvariantes({
      config: { root: RAIZ, shard, sequence: { seed } },
      logger: { log: (m: string) => logs.push(m) },
    } as never);

  it("vitest.db.config.ts usa o sequenciador (sem ele o corte volta ao hash)", () => {
    const config = readFileSync(path.join(RAIZ, "vitest.db.config.ts"), "utf8");
    expect(config).toMatch(/import SequenciadorDosInvariantes from "\.\/tests\/db\/sequenciador-dos-invariantes"/);
    expect(config).toMatch(/sequence: \{ sequencer: SequenciadorDosInvariantes \}/);
  });

  it("o `--shard` devolve a fatia por peso, e as quatro somam a suíte", async () => {
    const porFatia = await Promise.all(
      [1, 2, 3, 4].map(async (index) => (await sequenciador({ index, count: 4 }).shard(specs)).map((s) => s.moduleId)),
    );
    expect(porFatia[1]).toEqual(fatiaPorPeso(ARQUIVOS, 2, 4, PESOS).map((p) => path.join(RAIZ, p)));
    expect(porFatia.flat().sort()).toEqual(specs.map((s) => s.moduleId).sort());
  });

  it("sem `--shard`, roda tudo", async () => {
    expect(await sequenciador().shard(specs)).toHaveLength(specs.length);
  });

  it("a ordem dentro da fatia é sorteada pela semente, e a semente sai no log", async () => {
    logs.length = 0;
    const ordem = (await sequenciador(undefined, 7).sort(specs)).map((s) => s.moduleId);
    expect(ordem).toEqual(embaralhar(specs.map((s) => s.moduleId), 7));
    expect(logs.join("\n")).toContain('Running tests with seed "7"');
  });
});
