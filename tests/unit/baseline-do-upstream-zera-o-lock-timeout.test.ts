/**
 * FORK MIA (dívida 5, MIA-348) · CERCA: o `supabase/baseline.sql` do upstream
 * abre com exatamente um `SET lock_timeout = 0;` nas 20 primeiras linhas.
 *
 * Por quê: no modo update, o `easypanel/bootstrap.sh` aplica o schema com espera
 * curta por lock (least(500ms, deadlock_timeout/2)) para não perder comando por
 * deadlock com o app no ar. O `-c "set lock_timeout = ..."` não basta para o
 * `baseline.sql`, porque a linha dele apagaria a espera; então o bootstrap aplica
 * uma cópia em /tmp com SÓ essa linha trocada. Se a linha não estiver lá, ele
 * avisa e aplica o original, sem espera curta, e ninguém percebe até a próxima
 * implantação perder por disputa.
 *
 * Se o Rafael mexer no cabeçalho, a fusão reprova AQUI, com a explicação.
 * O que fazer então: ajustar a procura do bootstrap (o `grep -x` antes de
 * `BASELINE_COPIA`, no modo update) ao cabeçalho novo e este teste junto.
 * O `supabase/baseline.sql` continua sendo do upstream, byte a byte: não edite.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");

describe("o baseline.sql do upstream zera o lock_timeout no cabeçalho (o bootstrap troca essa linha na cópia)", () => {
  it("exatamente um `SET lock_timeout = 0;` nas 20 primeiras linhas, linha inteira", () => {
    // Lê só o começo: o arquivo tem mais de 100 mil linhas.
    const inicio = readFileSync(join(RAIZ, "supabase", "baseline.sql"), "utf8").slice(0, 4000).split("\n").slice(0, 20);
    const linhas = inicio.map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => l === "SET lock_timeout = 0;");
    expect(
      linhas.map(({ n }) => n),
      "o cabeçalho do baseline.sql mudou: o easypanel/bootstrap.sh procura 'SET lock_timeout = 0;' (linha inteira) nas 20 primeiras linhas para trocar pela espera curta. Ajuste a procura do bootstrap e este teste (MIA-348).",
    ).toHaveLength(1);
  });

  it("o bootstrap procura exatamente essa linha", () => {
    const bootstrap = readFileSync(join(RAIZ, "easypanel", "bootstrap.sh"), "utf8");
    expect(bootstrap).toContain("head -20 \"$BASELINE\" | grep -n -x 'SET lock_timeout = 0;'");
  });
});
