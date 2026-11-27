/**
 * FORK MIA (.120, MIA-253) — o formato da resposta do assistente, garantido no servidor.
 *
 * A regra 9 do prompt (`prompt.ts`) pede só **negrito** e listas com "- ", e a tela
 * (`components/assistente/TextoDoAssistente.tsx`) só desenha isso. O modelo às vezes
 * escreve o resto mesmo assim, e o diagnóstico da MIA-239 achou 4 respostas com o
 * botão escrito como texto: o "Me leva lá" virou link markdown no fim da resposta,
 * `[[...]]` ou `functions://...`. Os botões de verdade vêm do coletor do turno
 * (`ColetorDoTurno.acoes`), nunca do texto, então o que sobra no texto é lixo.
 *
 * O que esta função faz, e só isso:
 * - link markdown vira só o texto dele; a linha que é só um link para tela do
 *   sistema (o botão escrito como texto) sai inteira;
 * - `functions://...` e `[[...]]` saem;
 * - título com `#` perde o `#` e fica o texto;
 * - tabela vira lista ("- **primeira coluna:** cabeçalho valor, ...");
 * - travessão sai: entre números vira "a", no começo da linha vira "- ", no meio vira ", ".
 *
 * Negrito, listas, o "→" dos caminhos e os endereços soltos ficam como estão. Pura e
 * idempotente: limpar duas vezes dá o mesmo texto.
 */

const LINK = /!?\[([^\]\n]*)\]\(\s*([^)\n]*?)\s*\)/g;
const LINHA_SO_DE_LINK = /^\s*(?:[-*•]\s+)?!?\[[^\]\n]*\]\(\s*([^)\n]*?)\s*\)\s*[.,;]?\s*$/;
const COLCHETE_DUPLO = /\[\[[^\]\n]*\]\]/g;
const FUNCOES = /functions:\/\/[^\s)\]]*/g;
const TITULO = /^(\s{0,3})#{1,6}\s+(.*?)(?:\s+#+)?\s*$/;
const LINHA_DE_TABELA = /^\s*\|.*\|\s*$/;
const SEPARADOR_DE_TABELA = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const TRAVESSAO = /[—–]/;

/** O destino do link é uma tela do sistema ou uma ferramenta, não uma página de fora? */
function eDestinoInterno(destino: string): boolean {
  const limpo = destino.replace(/\\\//g, "/").trim();
  return limpo.startsWith("/") || limpo.startsWith("functions:") || /^https?:\/\/[^/\s]+\/app(?:[/?#]|$)/.test(limpo);
}

function celulas(linha: string): string[] {
  return linha
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.replace(/\*\*/g, "").trim());
}

/** Um bloco de linhas de tabela vira uma lista, uma linha por item. */
function tabelaEmLista(linhas: string[]): string[] {
  const temCabecalho = linhas.length > 1 && SEPARADOR_DE_TABELA.test(linhas[1] ?? "");
  const cabecalho = temCabecalho ? celulas(linhas[0] ?? "") : null;
  const corpo = (temCabecalho ? linhas.slice(2) : linhas).filter((l) => !SEPARADOR_DE_TABELA.test(l));
  const itens: string[] = [];
  for (const linha of corpo) {
    const valores = celulas(linha);
    const [primeira, ...resto] = valores;
    const partes = resto
      .map((valor, i) => {
        if (!valor) return "";
        const nome = cabecalho && cabecalho.length > 2 ? (cabecalho[i + 1] ?? "") : "";
        return nome ? `${nome} ${valor}` : valor;
      })
      .filter(Boolean);
    if (!primeira && !partes.length) continue;
    if (!primeira) itens.push(`- ${partes.join(", ")}`);
    else if (!partes.length) itens.push(`- ${primeira}`);
    else itens.push(`- **${primeira}:** ${partes.join(", ")}`);
  }
  return itens;
}

function semTravessao(linha: string): string {
  if (!TRAVESSAO.test(linha)) return linha;
  return linha
    .replace(/^(\s*)[—–]\s*/, "$1- ")
    .replace(/(\d)\s*[—–]\s*(\d)/g, "$1 a $2")
    .replace(/\s*[—–]+\s*$/, "")
    .replace(/\s*[—–]+\s*/g, ", ")
    .replace(/,\s*([,.;:!?])/g, "$1")
    .replace(/([:;!?.](?:\*\*)?),\s/g, "$1 ");
}

function limparLinha(bruta: string): string | null {
  const soLink = LINHA_SO_DE_LINK.exec(bruta);
  if (soLink && eDestinoInterno(soLink[1] ?? "")) return null;

  let linha = bruta
    .replace(COLCHETE_DUPLO, "")
    .replace(LINK, (_tudo, texto: string) => texto)
    .replace(FUNCOES, "");

  const titulo = TITULO.exec(linha);
  if (titulo) linha = `${titulo[1] ?? ""}${titulo[2] ?? ""}`;

  linha = semTravessao(linha);

  // O que a limpeza deixou para trás: espaço dobrado no meio, espaço no fim e o item vazio.
  const recuo = /^\s*/.exec(linha)?.[0] ?? "";
  const meio = linha.slice(recuo.length).replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trimEnd();
  if (/^[-*•]$/.test(meio)) return "";
  return `${recuo}${meio}`;
}

/** A resposta do modelo só com o formato que a tela mostra. Pura, para o teste. */
export function limparFormatoDaResposta(texto: string): string {
  const linhas = texto.replace(/\r\n?/g, "\n").split("\n");
  const saida: string[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i] ?? "";
    if (LINHA_DE_TABELA.test(linha)) {
      const bloco: string[] = [];
      while (i < linhas.length && LINHA_DE_TABELA.test(linhas[i] ?? "")) bloco.push(linhas[i++] ?? "");
      i--;
      for (const item of tabelaEmLista(bloco)) {
        const limpo = limparLinha(item);
        if (limpo) saida.push(limpo);
      }
      continue;
    }
    const limpa = limparLinha(linha);
    if (limpa !== null) saida.push(limpa);
  }
  return saida
    .join("\n")
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n")
    .trim();
}
