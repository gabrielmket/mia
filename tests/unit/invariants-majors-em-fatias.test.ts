/**
 * O `invariants-majors` RODA EM FATIAS, e as fatias têm de somar o `test:db` inteiro (MIA-71).
 *
 * MEDIDO em 18/11/2026 (7 rodadas verdes do ci.yml): a perna levava 51 a 57 min por
 * major, quase tudo no `vitest` do `test:db` (725 arquivos em série); o passo
 * `update.sh sobre banco COM DADOS` leva 0,2 a 0,4 min. Por isso a matriz é
 * major × fatia (`vitest --shard=N/3`), e não "uma perna por passada".
 *
 * Quatro modos de falha que esta cerca fecha, todos silenciosos:
 *  1. o `3` do `--shard=N/3` não bate com a lista `fatia:` — fatia a menos deixa
 *     arquivos de invariante SEM RODAR e o CI continua verde;
 *  2. o `concurrency:` perde a fatia — as três pernas da mesma major caem no mesmo
 *     grupo e o `cancel-in-progress` cancela duas;
 *  3. a passada do `update.sh` some, ou passa a rodar em fatia que não existe;
 *  4. o agregado `invariants` deixa de exigir o piso (pg15) fora de pull_request.
 *
 * Sem parser YAML nas dependências: recorte do job pela indentação, como em
 * concorrencia-so-nos-jobs-pesados.test.ts, e um controle positivo no começo.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const CI = readFileSync(".github/workflows/ci.yml", "utf-8");

function blocoDoJob(texto: string, job: string): string {
  const inicio = texto.indexOf(`\n  ${job}:\n`);
  if (inicio < 0) throw new Error(`job ${job} não encontrado`);
  const resto = texto.slice(inicio + 1);
  const fim = resto.slice(1).search(/\n  [a-zA-Z0-9_-]+:\n/);
  return fim < 0 ? resto : resto.slice(0, fim + 1);
}

// Sem os comentários: o texto explicativo cita `--shard=N/3` e `fatia: [1, 2, 3]`.
const SEM_COMENTARIO = (s: string) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

// O passo cujo `- name:` começa com `prefixo`, até o próximo `- name:` / `- uses:`.
function passo(job: string, prefixo: string): string | null {
  const partes = job.split(/\n(?=\s+- (?:name|uses):)/);
  return partes.find((p) => p.trim().startsWith(`- name: ${prefixo}`)) ?? null;
}

const MAJORS = SEM_COMENTARIO(blocoDoJob(CI, "invariants-majors"));
const AGREGADO = SEM_COMENTARIO(blocoDoJob(CI, "invariants"));

describe("invariants-majors em fatias (MIA-71)", () => {
  it("controle positivo: o recorte enxerga o job, a matriz e o agregado", () => {
    expect(MAJORS).toMatch(/strategy:/);
    expect(MAJORS).toMatch(/pg: \$\{\{ fromJSON\(needs\.invariants-alcance\.outputs\.majors\) \}\}/);
    expect(AGREGADO).toMatch(/needs: \[invariants-alcance, invariants-majors\]/);
  });

  it("a lista `fatia:` e o N do `--shard=${{ matrix.fatia }}/N` são o mesmo número", () => {
    const lista = /^\s+fatia: \[([0-9, ]+)\]\s*$/m.exec(MAJORS);
    expect(lista, "matriz sem `fatia: [...]`").not.toBeNull();
    const fatias = (lista?.[1] ?? "").split(",").map((x) => Number(x.trim()));
    const n = fatias.length;
    // 1..N sem buraco nem repetição: `--shard=2/3` sem a fatia 2 deixa um terço sem rodar.
    expect(fatias).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(n).toBeGreaterThan(1);

    const chamadas = [...MAJORS.matchAll(/pnpm test:db\b(?!:)[^\n]*/g)].map((m) => m[0]);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toContain(`--shard=\${{ matrix.fatia }}/${n}`);
  });

  it("o `concurrency:` distingue a fatia (senão uma cancela a outra)", () => {
    const grupo = /group: (.*)/.exec(MAJORS)?.[1] ?? "";
    expect(grupo).toContain("matrix.pg");
    expect(grupo).toContain("matrix.fatia");
  });

  it("a passada do update.sh continua sendo gate, em UMA fatia por major", () => {
    const update = passo(MAJORS, "update.sh sobre banco COM DADOS");
    expect(update, "o passo do update.sh sumiu").not.toBeNull();
    expect(update).toMatch(/if: matrix\.fatia == 1\b/);
    expect(update).toMatch(/run: pnpm test:db:update\b/);
  });

  it("nenhuma fatia usa `continue-on-error` nem `if:` no passo do test:db", () => {
    expect(MAJORS).not.toMatch(/continue-on-error/);
    const invariantes = passo(MAJORS, "RLS isolation");
    expect(invariantes, "o passo do test:db sumiu").not.toBeNull();
    expect(invariantes).not.toMatch(/^\s+if:/m);
  });

  it("o agregado continua exigindo o piso fora de pull_request e o sucesso da matriz inteira", () => {
    expect(AGREGADO).toMatch(/\[ "\$EVENTO" != "pull_request" \][\s\S]*?\[ "\$PISO" = "sim" \]/);
    expect(AGREGADO).toMatch(/MAJORS: \$\{\{ needs\.invariants-majors\.result \}\}/);
    expect(AGREGADO).toMatch(/\[ "\$MAJORS" = "success" \]/);
  });
});
