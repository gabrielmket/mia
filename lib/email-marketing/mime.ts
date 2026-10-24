/**
 * FORK MIA (.89) — A MENSAGEM em MIME, com o descadastro de um clique.
 *
 * O Gmail e o Yahoo exigem, de quem manda em volume, os dois cabeçalhos da
 * RFC 8058: `List-Unsubscribe` (um endereço https) e
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Com eles, o botão
 * "Cancelar inscrição" aparece no topo do e-mail e o pedido chega direto, sem a
 * pessoa ver página nenhuma (decisão "Como se descadastra" do protótipo).
 *
 * Todo valor que vira cabeçalho perde `\r` e `\n`: um nome de remetente com
 * quebra de linha injetaria um cabeçalho novo na mensagem.
 */
import { randomUUID } from "node:crypto";

function semQuebra(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

/** RFC 2047, codificação B: texto com acento no assunto e no nome de exibição. */
export function codificarCabecalho(texto: string): string {
  const limpo = semQuebra(texto);
  if (/^[\x20-\x7e]*$/.test(limpo)) return limpo;
  // Pedaços de até 45 bytes viram linhas de no máximo 76 caracteres.
  const bytes = Buffer.from(limpo, "utf8");
  const pedacos: string[] = [];
  let inicio = 0;
  while (inicio < bytes.length) {
    let fim = Math.min(bytes.length, inicio + 45);
    // Não corta um caractere de vários bytes no meio.
    while (fim < bytes.length && (bytes[fim]! & 0xc0) === 0x80) fim -= 1;
    pedacos.push(`=?UTF-8?B?${bytes.subarray(inicio, fim).toString("base64")}?=`);
    inicio = fim;
  }
  return pedacos.join("\r\n ");
}

/** `Nome <endereço>`, com o nome codificado e as aspas que a RFC 5322 pede. */
export function enderecoComNome(nome: string | null | undefined, endereco: string): string {
  const e = semQuebra(endereco).replace(/[<>"]/g, "");
  const n = semQuebra(nome ?? "").replace(/[<>"\\]/g, "");
  if (!n) return e;
  const ascii = /^[\x20-\x7e]*$/.test(n);
  return ascii ? `"${n}" <${e}>` : `${codificarCabecalho(n)} <${e}>`;
}

function base64EmLinhas(texto: string): string {
  return (
    Buffer.from(texto, "utf8")
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") ?? ""
  );
}

export interface MensagemParaMontar {
  de: { nome: string; endereco: string };
  para: string;
  responderPara?: string | null;
  assunto: string;
  html: string;
  texto: string;
  /** O endereço https do descadastro de um clique. */
  descadastro: string;
  /** Identifica a campanha para o painel de reclamações do Gmail (`Feedback-ID`). */
  feedbackId?: string;
}

export function montarMime(m: MensagemParaMontar): string {
  const fronteira = `mia-${randomUUID()}`;
  const cabecalhos = [
    `From: ${enderecoComNome(m.de.nome, m.de.endereco)}`,
    `To: ${semQuebra(m.para)}`,
    ...(m.responderPara ? [`Reply-To: ${semQuebra(m.responderPara)}`] : []),
    `Subject: ${codificarCabecalho(m.assunto)}`,
    "MIME-Version: 1.0",
    `List-Unsubscribe: <${semQuebra(m.descadastro)}>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    ...(m.feedbackId
      ? [`Feedback-ID: ${semQuebra(m.feedbackId).replace(/[^A-Za-z0-9:._-]/g, "")}`]
      : []),
    `Content-Type: multipart/alternative; boundary="${fronteira}"`,
  ];
  return [
    ...cabecalhos,
    "",
    `--${fronteira}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64EmLinhas(m.texto),
    `--${fronteira}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64EmLinhas(m.html),
    `--${fronteira}--`,
    "",
  ].join("\r\n");
}
