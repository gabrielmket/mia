/**
 * Sequenciador da suíte de invariantes (vitest.db.config.ts), MIA-346.
 *
 * Troca SÓ o corte do `--shard`: em vez do hash do caminho, a divisão por peso
 * medido de tests/db/fatia-por-peso.ts. A ordem dentro da fatia continua sorteada,
 * como era (issue #207: o veredito não pode depender da ordem dos arquivos).
 *
 * Por que o sorteio mora aqui: com um sequenciador próprio na config, o vitest não
 * troca mais para o `RandomSequencer` dele quando recebe
 * `--sequence.shuffle.files=true` (scripts/test-db.sh), nem escolhe semente. Então
 * a semente é a de `--sequence.seed`, se veio, ou o relógio, e sai no log com a
 * mesma frase que o vitest escrevia.
 */
import path from "node:path";

import { BaseSequencer, type TestSpecification } from "vitest/node";

import { embaralhar, fatiaPorPeso, type Pesos } from "./fatia-por-peso";
import pesosMedidos from "./peso-dos-invariantes.json";

const PESOS: Pesos = pesosMedidos.segundos;

function caminhoDoRepositorio(raiz: string, spec: TestSpecification): string {
  return path.relative(raiz, spec.moduleId).split(path.sep).join("/");
}

export default class SequenciadorDosInvariantes extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { root, shard } = this.ctx.config;
    if (!shard) return files;
    const porCaminho = new Map(files.map((spec) => [caminhoDoRepositorio(root, spec), spec]));
    const escolhidos = fatiaPorPeso([...porCaminho.keys()], shard.index, shard.count, PESOS);
    return escolhidos.map((caminho) => porCaminho.get(caminho) as TestSpecification);
  }

  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const semente = this.ctx.config.sequence.seed ?? Date.now();
    this.ctx.logger.log(`      Running tests with seed "${semente}"`);
    return embaralhar([...files], semente);
  }
}
