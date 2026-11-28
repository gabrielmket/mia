#!/usr/bin/env node
// Refaz vitest.fatias.pesos.json a partir dos logs do `invariants-majors`
// (MIA-346). A tabela só decide o EQUILÍBRIO entre as fatias (vitest.fatias.ts),
// nunca quais arquivos rodam: refaça quando uma fatia passar a levar bem mais que as
// outras, ou quando um invariante pesado novo entrar.
//
// Uso (logs de rodadas VERDES; quanto mais rodadas, melhor a mediana):
//   for r in <id1> <id2> <id3>; do gh run view "$r" -R gabrielmket/mia --log > "/tmp/ci-$r.log"; done
//   node scripts/peso-dos-invariantes.mjs /tmp/ci-*.log
//
// Lê as linhas do vitest `✓ tests/invariants/x.test.ts (N tests) 1234ms` de cada log,
// fica com a MEDIANA por arquivo e grava só os de LIMIAR segundos ou mais.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const LIMIAR = 5;
const DESTINO = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "vitest.fatias.pesos.json");
const ANSI = /\x1b\[[0-9;]*m/g;
const LINHA = /[✓❯↓×] (tests\/invariants\/\S+\.test\.ts) \(\d+ tests?[^)]*\)\s*(\d+)ms/;

const logs = process.argv.slice(2);
if (logs.length === 0) {
  console.error("uso: node scripts/peso-dos-invariantes.mjs <log do ci.yml>...");
  process.exit(1);
}

const amostras = new Map();
for (const log of logs) {
  for (const linha of readFileSync(log, "utf8").split("\n")) {
    const m = LINHA.exec(linha.replace(ANSI, ""));
    if (!m) continue;
    const lista = amostras.get(m[1]) ?? [];
    lista.push(Number(m[2]) / 1000);
    amostras.set(m[1], lista);
  }
}
if (amostras.size === 0) {
  console.error("nenhuma linha de arquivo do vitest nos logs: são logs do invariants-majors?");
  process.exit(1);
}

const mediana = (v) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const segundos = Object.fromEntries(
  [...amostras]
    .map(([arquivo, v]) => [arquivo, mediana(v)])
    .filter(([, s]) => s >= LIMIAR)
    .map(([arquivo, s]) => [arquivo, Math.round(s)])
    .sort(([a], [b]) => (a < b ? -1 : 1)),
);
const tabela = {
  _leia:
    `Segundos medidos por arquivo de tests/invariants: mediana de ${logs.length} log(s) do ci.yml, ` +
    `refeita em ${new Date().toISOString().slice(0, 10)}. Só os de ${LIMIAR} s ou mais; os outros pesam ` +
    "PESO_PADRAO. Quem lê: vitest.fatias.ts. Para refazer: scripts/peso-dos-invariantes.mjs.",
  segundos,
};
writeFileSync(DESTINO, `${JSON.stringify(tabela, null, 2)}\n`);
console.info(`${amostras.size} arquivos lidos, ${Object.keys(segundos).length} com ${LIMIAR} s ou mais → ${DESTINO}`);
