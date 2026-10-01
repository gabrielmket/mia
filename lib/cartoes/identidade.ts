/**
 * FORK MIA — QUEM é o negócio, na primeira linha do cartão.
 *
 * "Empresa quando existe, pessoa quando não": em venda B2B a unidade é a
 * empresa ("Clínica Vida Plena · Sala comercial 42 m²"); em venda a pessoas é a
 * pessoa ("Mariana C. · Apto 2 dorm"). O título do negócio continua sendo o do
 * negócio — o que se acrescenta é o PREFIXO, desenhado antes dele.
 *
 * O cuidado que esta função existe para ter: não repetir. O título que nasce da
 * primeira mensagem já É o nome do contato; prefixar daria "Mariana C. ·
 * Mariana Costa". Quando o título já nomeia quem é, não há prefixo.
 */

/** "Mariana Costa" → "Mariana C."; nome de uma palavra fica inteiro. */
export function nomeCurto(nome: string | null | undefined): string | null {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return null;
  if (partes.length === 1) return partes[0]!;
  const ultimo = partes[partes.length - 1]!;
  return `${partes[0]} ${ultimo.charAt(0).toUpperCase()}.`;
}

function normal(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** O prefixo do título do cartão, ou `null` quando o título já diz quem é. */
export function prefixoDoCartao(entrada: {
  titulo: string;
  empresa: string | null | undefined;
  contato: string | null | undefined;
}): string | null {
  const empresa = entrada.empresa?.trim() || null;
  const quem = empresa ?? nomeCurto(entrada.contato);
  if (!quem) return null;
  const titulo = normal(entrada.titulo);
  if (empresa) return titulo.includes(normal(empresa)) ? null : empresa;
  const primeiro = normal((entrada.contato ?? "").trim().split(/\s+/)[0] ?? "");
  if (primeiro && titulo.includes(primeiro)) return null;
  return quem;
}
