/**
 * FORK MIA — nomes de clientes reais não entram no repositório (ele é público).
 *
 * No molde de `tests/unit/sem-identificador-de-producao.test.ts`, do upstream:
 * este arquivo guarda SÓ a impressão de cada nome, nunca o nome. Quem usa:
 *
 *   - `tests/unit/sem-nome-de-cliente-no-repositorio.test.ts` varre o repositório
 *     inteiro atrás dos nomes completos (`NOMES`);
 *   - `tests/unit/cliente-modelo-semente.test.ts` cobra as sementes de
 *     demonstração também pelos pedaços de nome (`PEDACOS`), que são palavras
 *     comuns demais para proibir no repositório inteiro.
 *
 * ## Como se compara
 *
 * O texto vira palavras em minúsculas e sem acento (`[a-z0-9]+`), e cada trecho
 * de 1 a 3 palavras seguidas é comparado com as impressões. Número (telefone,
 * id de grupo) é uma palavra como outra qualquer.
 *
 * Cada impressão é `sonda:sha256` do nome já normalizado. A sonda (FNV-1a de 32
 * bits) existe só para a varredura caber em segundos: ela se calcula de carona,
 * letra a letra, e o SHA-256 confirma o que a sonda apontar.
 *
 * ## Como acrescentar um nome
 *
 *     npx tsx -e 'import("./tests/helpers/nomes-reservados").then((m) => console.log(m.impressaoDoNome("Nome do Cliente")))'
 *
 * e cole a linha em `NOMES`. Rode fora do repositório compartilhado de tela: a
 * linha de comando é o único lugar onde o nome aparece. A mensagem de falha
 * também nunca repete o nome (o log do CI é público): ela diz o arquivo, a
 * linha e o começo do SHA-256 da entrada que bateu.
 */
import { createHash } from "node:crypto";

/** Nome completo de cliente (ou identificador de produção): proibido em todo o repositório. */
const NOMES = [
  "086947b2:b68172bbb3501a9a3075a2187baeee4870a0e75d56d27e05e105ce87d39f6b0e",
  "1c1e009d:987db4b0edfd000c93f9b9f683b2d1acd59e9c82d788c17b812e313bdce00891",
  "3fbff901:b8dbf3aa179d23b1584c3b2a37650ce11311cf00b35f09fd70ea6bdebb9c89c4",
  "47fe6d64:14b38635e6469947a3e985a240af14fc0aa59e02a3066d9079aa14c683453edd",
  "51bf047b:098cb6d347479b33bd42986079ceb360e358d6a87f87ad8690c8283b4e20d0b6",
  "5a080f68:176feee578ffacc311b665dc2816a45256c7bef12edc98d53ec7d154242b2026",
  "6ff7bf1c:efc6b0411f1117601dc9140cf12ab4d92ad44ddd66c52c9dc9f08c0b90c2e7d8",
  "73287ee2:74e1189fab5aedf4e5806201ced31ea3bb7e979772a30c8023bc895eff1222bb",
  "7562d6b6:706532418a119c441ac55f5b5a0356f227d234f3305442bbde97de091bd7884c",
  "7fa7ab2f:b48079aed18063336173f99fc7ade327496067c4809826e93a8bc0f25e03204d",
  "83abb812:5fa5b8eaf40e169ac65184beeb3e51da5a70b0f49d0a2885e6a232fc2c4296a7",
  "8def7af7:950e1712ed04ae03394a9c3f7f60a3c08dd4e4097ae118dabd993524fd790884",
  "9ef2d004:a348c1b75675d372e6f7a5ed2c8c51f1536135c206075da04fcd7813104c8e0f",
  "b1e6e4c1:8a0a7317bcb9064c2c1b4e07aa0a6088473ea3d261388e9abe340cfc6b073684",
  "b66f7c96:811511274fe992b195fe65adb64500df5d9e68536a66694b249cf2738376a7fa",
  "cba8431c:4761945c7da2dba2227d267d861cc4865ec520c34f7762018e4a0128dbe87079",
  "cd60b87a:fad04465fdb49f04828ea419b0c627e9d62666cfa4a73aa60c2eb05c61443b77",
  "de59aca5:8936b4c4bd0347937959094471ca8b06de5094836cfa2c4a2625b4206fe11385",
  "dedc8034:7687cd8e551085260e98c26a7caf99130ab88e05322f02e9dd7ed1a83d231288",
  "f5cd8e99:a0d6318f068d20dccf8abe8b2ba1734ae97c12ea9466a9e8d49e0b05dce31730",
  "fe38f25f:7dfb6546f59705713ab54375632125b2980e83b4f6f60a2cc4a6837272c5695a",
];

/** Pedaço de nome (palavra comum): proibido só onde o texto é vitrine, como as sementes de demonstração. */
const PEDACOS = [
  "008eb513:9f9f35c639deae6e91a8819d410ebec065842af36bf08101ec71546955636c77",
  "0f738c82:62ffa705acf69414671dcdc09b5581d888abff4c77892666cd76a4402e3241e9",
  "14bfd910:eddf50c34dbf7fdb5e3ebcc10b9e9a9a34c6c72e9a2c021d02187e2559c1ed84",
  "1e90b17c:c8bcd9f912be81adbb378f2ac7a2eeb54a804a1b460d888feb5388700232955d",
  "408919f1:9bf099228236eb626753a4b4cbd6d88ea7d06d01e54accccebc997f34afbd1ca",
  "6e5670e5:99ddb4db7684ff2371d75cf44e37be54f339f19ac0cf37c9490459e555c1b60e",
  "754cab4c:22b686f8a61062abe4d823185b91499022c5c81ba81cf3c13e539477e63bba91",
  "889ee3ec:5b15481549de6ac2942d8b1304a72a19a53f53a5a0765dd567d56655699d0f6b",
  "8a0b0218:82580cbbf4cf666ad0b60da0f5a2e55ccd46fcdb015e3f5471462a4321c1c61c",
  "933dbeea:8c1a64a5158bd82094f807facfb967c546718d031644ab61782be12c4af36a5f",
  "c4506678:84256626eabd553eb3b30e64919c67a08ee38a7de3b83560b9b497ab5dfd97fc",
];

/** O maior nome reservado tem três palavras; trecho maior que isso não se compara. */
const MAIOR_NOME_EM_PALAVRAS = 3;

const FNV_BASE = 0x811c9dc5;
const FNV_PRIMO = 16777619;
const ESPACO = 32;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Minúsculas, sem acento, só letras e dígitos: a forma em que os nomes são comparados. */
export function palavrasComparaveis(texto: string): string[] {
  return (
    texto
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .match(/[a-z0-9]+/g) ?? []
  );
}

function sondaDe(nome: string): number {
  let h = FNV_BASE;
  for (let i = 0; i < nome.length; i += 1) h = Math.imul(h ^ nome.charCodeAt(i), FNV_PRIMO);
  return h >>> 0;
}

/** A linha para colar em `NOMES` (ou `PEDACOS`). Ver o cabeçalho. */
export function impressaoDoNome(nome: string): string {
  const normal = palavrasComparaveis(nome).join(" ");
  return `${sondaDe(normal).toString(16).padStart(8, "0")}:${sha256(normal)}`;
}

function indice(impressoes: string[]): Map<number, Set<string>> {
  const mapa = new Map<number, Set<string>>();
  for (const impressao of impressoes) {
    const [sonda, sha] = impressao.split(":") as [string, string];
    const chave = Number.parseInt(sonda, 16);
    mapa.set(chave, (mapa.get(chave) ?? new Set()).add(sha));
  }
  return mapa;
}

const SO_NOMES = indice(NOMES);
const NOMES_E_PEDACOS = indice([...NOMES, ...PEDACOS]);

export interface NomeAchado {
  /** Posição da primeira palavra do trecho, na lista de `palavrasComparaveis`. */
  palavra: number;
  /** Quantas palavras o trecho tem. */
  tamanho: number;
  /** O começo do SHA-256 da entrada que bateu: identifica a entrada sem dizer o nome. */
  entrada: string;
}

/**
 * Os trechos do texto que são nome reservado. `alcance: "com_pedacos"` cobra
 * também os pedaços de nome, para texto de vitrine.
 */
export function nomesReservadosEm(texto: string, alcance: "nomes" | "com_pedacos" = "nomes"): NomeAchado[] {
  return varrer(texto, alcance === "com_pedacos" ? NOMES_E_PEDACOS : SO_NOMES);
}

/** A mesma varredura contra uma lista qualquer de impressões: o controle positivo dos testes. */
export function trechosComImpressao(texto: string, impressoes: string[]): NomeAchado[] {
  return varrer(texto, indice(impressoes));
}

function varrer(texto: string, reservados: Map<number, Set<string>>): NomeAchado[] {
  const palavras = palavrasComparaveis(texto);
  const achados: NomeAchado[] = [];
  for (let i = 0; i < palavras.length; i += 1) {
    let h = FNV_BASE;
    for (let n = 0; n < MAIOR_NOME_EM_PALAVRAS && i + n < palavras.length; n += 1) {
      const palavra = palavras[i + n]!;
      if (n > 0) h = Math.imul(h ^ ESPACO, FNV_PRIMO);
      for (let k = 0; k < palavra.length; k += 1) h = Math.imul(h ^ palavra.charCodeAt(k), FNV_PRIMO);
      const candidatos = reservados.get(h >>> 0);
      if (!candidatos) continue;
      const sha = sha256(palavras.slice(i, i + n + 1).join(" "));
      if (candidatos.has(sha)) achados.push({ palavra: i, tamanho: n + 1, entrada: sha.slice(0, 8) });
    }
  }
  return achados;
}
