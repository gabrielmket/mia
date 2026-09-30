/**
 * FORK MIA — O PRIMEIRO NOME DE UMA PESSOA, para ir DENTRO de uma mensagem.
 *
 * Nasceu para a variável do modelo aprovado que o follow-up manda sozinho
 * (`lib/channels/meta/variavel-do-nome.ts`): "Olá {{1}}" vira "Olá Maria". Quem
 * lê é o cliente, então o critério é outro que o do rótulo de tela
 * (`rotuloDoContato`): na dúvida, NÃO há nome, e quem chama decide o que fazer.
 * Mandar "Olá 5531999" ou "Olá Contato" é pior que não mandar.
 *
 * A regra, em ordem:
 *  1. contato anonimizado (LGPD) não tem nome;
 *  2. o nome de gente é o de `nomeDoContato` (o cadastrado, depois o do perfil do
 *     WhatsApp), que já descarta identificador técnico (`@lid`, "Contato 5431",
 *     só dígitos);
 *  3. a primeira palavra que sobra depois de tirar emoji e pontuação das pontas
 *     e pular tratamento ("Dra.", "Sr.");
 *  4. palavra com dígito não é nome (telefone formatado, "Loja123"): sem nome;
 *  5. caixa: "MARIA" e "maria" viram "Maria"; o que já vem com caixa mista
 *     ("McArthur", "DiCaprio") fica como a pessoa escreveu.
 */
import { nomeDoContato, type ContatoNomeavel } from "./rotulo-do-contato";

/** Tratamentos que abrem um nome e não são o nome (comparados sem acento e sem ponto). */
const TRATAMENTOS = new Set(["dr", "dra", "sr", "sra", "srta", "prof", "profa"]);

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "");
}

function capitalizar(palavra: string): string {
  const minuscula = palavra.toLocaleLowerCase("pt-BR");
  const maiuscula = palavra.toLocaleUpperCase("pt-BR");
  if (palavra !== minuscula && palavra !== maiuscula) return palavra;
  return minuscula
    .split("-")
    .map((parte) => parte.charAt(0).toLocaleUpperCase("pt-BR") + parte.slice(1))
    .join("-");
}

export function primeiroNomeDoContato(
  c: (ContatoNomeavel & { is_anonymized?: boolean | null }) | null | undefined,
): string | null {
  if (!c || c.is_anonymized) return null;
  const nome = nomeDoContato(c);
  if (!nome) return null;
  for (const bruto of nome.split(/\s+/)) {
    if (/\d/.test(bruto)) return null;
    const palavra = bruto.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    if (palavra === "") continue;
    if (TRATAMENTOS.has(semAcento(palavra).toLowerCase())) continue;
    return capitalizar(palavra);
  }
  return null;
}
