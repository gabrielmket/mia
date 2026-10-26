/**
 * FORK MIA (.89) — Gera `lib/assistente/guia-de-operacao.gen.ts` a partir do guia de
 * operação do upstream (`.claude/skills/deskcomm-operacao/`), para o assistente da MIA
 * usar na busca de ajuda sem ler `.claude/` em tempo de execução.
 *
 * Uso:
 *   npx tsx scripts/gerar-guia-de-operacao.ts             # grava
 *   npx tsx scripts/gerar-guia-de-operacao.ts --conferir  # só confere (sai 1 se divergir)
 *
 * A cerca `tests/unit/assistente-guia-de-operacao.test.ts` faz a mesma conferência.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { moduloDoGuia } from "../lib/assistente/guia-de-operacao/ler-o-guia";

/** A pasta do guia de operação do upstream, a partir da raiz do repositório. */
export const PASTA_DO_GUIA = ".claude/skills/deskcomm-operacao";

const RAIZ = join(__dirname, "..");
const PASTA = join(RAIZ, PASTA_DO_GUIA);
const DESTINO = join(RAIZ, "lib", "assistente", "guia-de-operacao.gen.ts");

export function lerArquivosDoGuia(pasta: string = PASTA): Record<string, string> {
  const arquivos: Record<string, string> = {};
  const visitar = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, e.name);
      const relativo = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === "scripts") continue;
        visitar(caminho, relativo);
      } else if (e.name.endsWith(".md")) {
        arquivos[relativo] = readFileSync(caminho, "utf8");
      }
    }
  };
  visitar(pasta, "");
  return arquivos;
}

function principal(): void {
  const novo = moduloDoGuia(lerArquivosDoGuia(), PASTA_DO_GUIA);
  const conferir = process.argv.includes("--conferir");
  let atual = "";
  try {
    atual = readFileSync(DESTINO, "utf8").replace(/\r\n/g, "\n");
  } catch {
    atual = "";
  }
  if (conferir) {
    if (atual !== novo) {
      console.error("guia-de-operacao.gen.ts está desatualizado. Rode: npx tsx scripts/gerar-guia-de-operacao.ts");
      process.exit(1);
    }
    console.log("guia-de-operacao.gen.ts em dia.");
    return;
  }
  writeFileSync(DESTINO, novo, "utf8");
  console.log(`Gravado ${DESTINO.slice(RAIZ.length + 1)}.`);
}

if (require.main === module) principal();
