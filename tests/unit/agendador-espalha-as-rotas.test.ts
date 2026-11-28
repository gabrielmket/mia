import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

/**
 * FORK MIA (MIA-341): O AGENDADOR ESPALHA AS ROTAS DENTRO DO MINUTO.
 *
 * Antes, as 70 linhas de `docker/scheduler/entrypoint.sh` batiam no segundo zero,
 * todas contra o mesmo app e o mesmo banco (34 juntas nos múltiplos de 5 minutos,
 * 41 nos de 10). Agora cada linha dorme um atraso fixo, tirado do `cksum` do
 * caminho da rota, antes do curl. Documento: `docs/fork/agendador-espalhado.md`.
 *
 * Este teste RODA o entrypoint (com o `crond` dublado), lê o crontab que ele
 * gera e prova:
 *  1. toda linha tem o atraso, entre 0 e 45 s;
 *  2. o agendamento, o `-m` e a rota de cada linha são os da tabela `CRONS=`,
 *     na mesma ordem: a frequência de nenhuma rota mudou;
 *  3. o atraso é o do nome: o mesmo número que o `cksum` POSIX dá, recalculado
 *     aqui sem shell, e o mesmo em duas gerações seguidas;
 *  4. nenhum segundo junta mais de 4 rotas, fora o segundo zero, que só guarda
 *     as rotas sem folga nenhuma (item 5);
 *  5. o atraso não empurra o fim da chamada, no pior caso (o `-m`), para uma
 *     batida depois daquela em que ele já caía. O `crond` do busybox não dispara
 *     a linha enquanto a rodada anterior dela roda, e o `sleep` conta como rodada:
 *     sem esse teto, uma rota de minuto com `-m 25` e atraso 40 perderia a batida
 *     seguinte sempre que a chamada passasse de 20 s.
 *
 * Vermelho no item 4 depois de criar uma rota: o nome novo caiu num segundo que já
 * tinha 4. O conserto é no agendamento (outro `-m`, outra cadência) ou no teto,
 * nunca um atraso escrito à mão na tabela.
 *
 *     npx vitest run tests/unit/agendador-espalha-as-rotas.test.ts
 */

const RAIZ = join(__dirname, "..", "..");
const ENTRYPOINT = join(RAIZ, "docker", "scheduler", "entrypoint.sh");
const TETO = 45;
const MAXIMO_POR_SEGUNDO = 4;

type Linha = { quando: string; timeout: number; rota: string };
type Gerada = Linha & { atraso: number };

const TMP = mkdtempSync(join(tmpdir(), "agendador-espalha-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** A tabela escrita no arquivo: `quando|timeout|rota`, uma por linha, sem comentários. */
function tabela(): Linha[] {
  const sh = readFileSync(ENTRYPOINT, "utf8");
  const bloco = sh.split('CRONS="')[1]?.split('\n"')[0] ?? "";
  return bloco
    .split("\n")
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map((l) => {
      const [quando, timeout, rota] = l.split("|");
      return { quando: quando!, timeout: Number(timeout), rota: rota! };
    });
}

let geracao = 0;
/** Roda o entrypoint como o contêiner roda e devolve as linhas do crontab gerado. */
function gerar(): Gerada[] {
  geracao += 1;
  const bin = join(TMP, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "crond"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "crond"), 0o755);
  const crontab = join(TMP, `crontab-${geracao}`);
  execFileSync("sh", [ENTRYPOINT], {
    // Ambiente mínimo, sem herdar o da máquina. O `NODE_ENV` vai porque o tipo do
    // Next (`next/types/global.d.ts`) o exige no `ProcessEnv`; o entrypoint não o lê.
    env: {
      NODE_ENV: "test",
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      INTERNAL_SECRET: "segredo-do-teste",
      CRONTAB_PATH: crontab,
      CRON_AUTH_DIR: join(TMP, `auth-${geracao}`),
    },
    stdio: "ignore",
  });
  const formato =
    /^(\S+ \S+ \S+ \S+ \S+) sleep (\d+); curl -fsS -m(\d+) -H '@[^']+' "http:\/\/app:3000\/([^"]+)"/;
  return readFileSync(crontab, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => {
      const m = formato.exec(l);
      if (!m) throw new Error(`Linha do crontab fora do formato esperado: ${l.slice(0, 80)}`);
      return { quando: m[1]!, atraso: Number(m[2]), timeout: Number(m[3]), rota: m[4]! };
    });
}

/** O `cksum` POSIX (CRC-32 0x04C11DB7, sem reflexo, com o tamanho no fim), sem shell. */
function cksum(texto: string): number {
  const bytes = [...Buffer.from(texto, "utf8")];
  for (let n = bytes.length; n > 0; n = Math.floor(n / 256)) bytes.push(n & 0xff);
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 24;
    for (let i = 0; i < 8; i++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    crc >>>= 0;
  }
  return ~crc >>> 0;
}

/** Segundos entre duas batidas da linha. Minuto fixo: no mínimo de hora em hora. */
function intervalo(quando: string): number {
  const minuto = quando.split(" ")[0]!;
  if (minuto === "*") return 60;
  const passo = /^\*\/(\d+)$/.exec(minuto);
  if (passo) return Number(passo[1]) * 60;
  if (/^\d+$/.test(minuto)) return 3600;
  throw new Error(`Campo de minuto que o teto do atraso não sabe ler: ${quando}`);
}

/** A folga entre o fim da chamada no pior caso e a batida seguinte à que ela já alcançava. */
function folga(l: Linha): number {
  const i = intervalo(l.quando);
  return Math.ceil(l.timeout / i) * i - l.timeout;
}

describe("o agendador espalha as rotas dentro do minuto (MIA-341)", () => {
  const geradas = gerar();
  const linhas = tabela();

  it("o instrumento enxerga a tabela e o crontab (controle positivo)", () => {
    expect(linhas.length).toBeGreaterThanOrEqual(60);
    expect(geradas.length).toBe(linhas.length);
    // O cksum daqui é o mesmo do GNU e do busybox do Alpine 3.20 (medido nos dois).
    expect(cksum("api/v1/cron/prospecting")).toBe(3189215386);
  });

  it("nenhuma rota sem atraso, e o atraso fica entre 0 e 45 s", () => {
    const fora = geradas.filter((g) => !(g.atraso >= 0 && g.atraso <= TETO));
    expect(fora.map((g) => `${g.rota}: ${g.atraso}`)).toEqual([]);
  });

  it("a lista de rotas, as frequências e os -m são os da tabela, na mesma ordem", () => {
    expect(geradas.map(({ quando, timeout, rota }) => ({ quando, timeout, rota }))).toEqual(linhas);
  });

  it("o atraso é o do nome da rota: o mesmo do cksum, e o mesmo a cada geração", () => {
    const divergentes = geradas.filter((g) => {
      const f = Math.min(TETO, folga(g));
      const esperado = f > 0 ? 1 + (cksum(g.rota) % f) : 0;
      return g.atraso !== esperado;
    });
    expect(divergentes.map((g) => g.rota)).toEqual([]);
    expect(gerar()).toEqual(geradas);
  });

  it(`nenhum segundo junta mais de ${MAXIMO_POR_SEGUNDO} rotas; no zero, só as sem folga`, () => {
    const porSegundo = new Map<number, string[]>();
    for (const g of geradas) porSegundo.set(g.atraso, [...(porSegundo.get(g.atraso) ?? []), g.rota]);
    const cheios = [...porSegundo]
      .filter(([s, rotas]) => s > 0 && rotas.length > MAXIMO_POR_SEGUNDO)
      .map(([s, rotas]) => `${s}s: ${rotas.join(", ")}`);
    expect(
      cheios,
      "Um segundo passou de 4 rotas. Mude o agendamento ou o -m da rota nova; não escreva o atraso à mão.",
    ).toEqual([]);
    const noZeroComFolga = geradas.filter((g) => g.atraso === 0 && folga(g) > 0).map((g) => g.rota);
    expect(noZeroComFolga).toEqual([]);
  });

  it("o atraso não faz a chamada encostar na batida seguinte mais do que hoje", () => {
    const encostam = geradas
      .filter((g) => g.atraso > folga(g))
      .map((g) => `${g.rota}: atraso ${g.atraso}, -m ${g.timeout}, folga ${folga(g)}`);
    expect(encostam).toEqual([]);
  });

  it("o teto enxerga a falta (controle negativo)", () => {
    // De minuto, -m 25: folga 35. De minuto, -m 60: folga 0. De 5 min, -m 240: folga 60.
    expect(folga({ quando: "* * * * *", timeout: 25, rota: "x" })).toBe(35);
    expect(folga({ quando: "* * * * *", timeout: 60, rota: "x" })).toBe(0);
    expect(folga({ quando: "* * * * *", timeout: 90, rota: "x" })).toBe(30);
    expect(folga({ quando: "*/5 * * * *", timeout: 240, rota: "x" })).toBe(60);
    expect(() => intervalo("0,30 * * * *")).toThrow();
  });
});
