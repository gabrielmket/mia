/**
 * FORK MIA · EMPRESA ÚNICA — "parece a mesma empresa?" (protótipo aprovado em 15/10/2026).
 *
 * A regra do protótipo para empresa SEM CNPJ: nome parecido com uma que já
 * existe NÃO bloqueia. A tela avisa e deixa escolher entre usar a existente e
 * criar mesmo assim; o agente sempre usa a existente; a lista marca as duas
 * como "possível duplicada" para alguém mesclar.
 *
 * "Parecido" é o que o protótipo mediu com os casos de teste dele: as palavras
 * de mais de três letras do nome novo (sem caixa, acento, pontuação nem
 * sufixo societário) aparecem no nome da outra — duas delas, ou a única que
 * houver. "Trigo Dourado Panificadora" parece "Padaria Trigo Dourado";
 * "Sabor da Serra Restaurante" parece "Restaurante Sabor da Serra"; "Studio
 * Lumi" não parece "Mercadinho Boa Praça".
 *
 * É frouxo de propósito, como `nomeComparavel`: errar para "parece" custa um
 * aviso que a pessoa dispensa num clique; errar para "não parece" custa uma
 * ficha repetida que ninguém vê.
 */
import { nomeComparavel } from "@/lib/empresas/nome-comparavel";

/** As palavras que contam: mais de três letras, na forma comparável. */
export function palavrasQueContam(nome: string): string[] {
  return nomeComparavel(nome)
    .split(" ")
    .filter((p) => p.length > 3);
}

/** O nome `novo` parece o `existente`? (Num sentido só; a lista pergunta nos dois.) */
export function pareceAMesma(novo: string, existente: string): boolean {
  const palavras = palavrasQueContam(novo);
  if (palavras.length === 0) return false;
  const alvo = nomeComparavel(existente);
  if (!alvo) return false;
  const achadas = palavras.filter((p) => alvo.includes(p)).length;
  return achadas >= Math.min(2, palavras.length);
}

/** Nos dois sentidos: o que a lista usa para marcar "possível duplicada". */
export function saoParecidas(a: string, b: string): boolean {
  return pareceAMesma(a, b) || pareceAMesma(b, a);
}

/**
 * A empresa SEM CNPJ que parece alguma outra da lista, com quem ela parece.
 * Só a que não tem CNPJ entra: duas com CNPJ diferente são empresas diferentes
 * (matriz e filial), por mais parecido que seja o nome.
 */
export function duplicadasPossiveis<T extends { id: string; nome: string; cnpj: string | null }>(
  empresas: readonly T[],
): Map<string, T> {
  const parece = new Map<string, T>();
  for (const e of empresas) {
    if (e.cnpj) continue;
    const outra = empresas.find((o) => o.id !== e.id && saoParecidas(e.nome, o.nome));
    if (outra) {
      parece.set(e.id, outra);
      if (!parece.has(outra.id)) parece.set(outra.id, e);
    }
  }
  return parece;
}
