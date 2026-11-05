/**
 * FORK MIA (.102) · O QUE O ACEITE PEDE, NAS DUAS FONTES: nome completo e e-mail.
 * PURO (a página do dono, a rota pública e o teste usam o mesmo).
 *
 * A .101 pedia só o nome. O protótipo de 05/11/2026 (telas 3 e 8) passou a
 * pedir o NOME COMPLETO (nome e sobrenome) e o E-MAIL também na página de
 * conexão de quem ainda não é cliente. O aceite grava os dois, com a data, a
 * hora, a versão e o texto inteiro do termo (`mia_raio_x_aceites`, 9151, que
 * confere o formato de novo no banco).
 *
 * O e-mail NÃO é usado para mandar nada: o serviço de envio ainda não está
 * configurado. Ele fica com o aceite, como mais um dado de quem autorizou.
 */

export const TAMANHO_MAXIMO_DO_NOME = 120;
export const TAMANHO_MAXIMO_DO_EMAIL = 160;

/** Uma palavra do nome tem pelo menos uma letra (aceita acento, hífen e apóstrofo). */
const PALAVRA_DO_NOME = /^[\p{L}\p{M}][\p{L}\p{M}'’.-]*$/u;

/** O formato do e-mail: algo@dominio.ext, sem espaço. O mesmo do CHECK da 9151. */
const FORMA_DO_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

/** O nome como fica gravado: sem espaço sobrando. */
export function limparNome(bruto: unknown): string {
  return typeof bruto === "string" ? bruto.replace(/\s+/g, " ").trim() : "";
}

/** Nome completo = nome e sobrenome: duas palavras ou mais, cada uma com letra. */
export function ehNomeCompleto(bruto: unknown): boolean {
  const nome = limparNome(bruto);
  if (nome.length < 3 || nome.length > TAMANHO_MAXIMO_DO_NOME) return false;
  const palavras = nome.split(" ");
  if (palavras.length < 2) return false;
  return palavras.every((p) => PALAVRA_DO_NOME.test(p)) && palavras[0]!.replace(/[^\p{L}]/gu, "").length >= 2;
}

/** O e-mail como fica gravado: minúsculo e sem espaço nas pontas. */
export function limparEmail(bruto: unknown): string {
  return typeof bruto === "string" ? bruto.trim().toLowerCase() : "";
}

export function ehEmailValido(bruto: unknown): boolean {
  const email = limparEmail(bruto);
  return email.length >= 6 && email.length <= TAMANHO_MAXIMO_DO_EMAIL && FORMA_DO_EMAIL.test(email);
}

export type CampoDoAceite = "nome" | "email" | "aceito";

export type ResultadoDoAceite =
  | { ok: true; nome: string; email: string }
  | { ok: false; campos: CampoDoAceite[] };

/** O corpo do "Autorizar": nome completo, e-mail válido e a caixa marcada. Diz os CAMPOS, nunca o valor. */
export function validarAceite(corpo: unknown): ResultadoDoAceite {
  const c = (corpo && typeof corpo === "object" ? corpo : {}) as { nome?: unknown; email?: unknown; aceito?: unknown };
  const campos: CampoDoAceite[] = [];
  if (!ehNomeCompleto(c.nome)) campos.push("nome");
  if (!ehEmailValido(c.email)) campos.push("email");
  if (c.aceito !== true) campos.push("aceito");
  if (campos.length > 0) return { ok: false, campos };
  return { ok: true, nome: limparNome(c.nome), email: limparEmail(c.email) };
}

/** A frase da recusa, para a rota pública dizer o que falta (a tela diz o mesmo, campo a campo). */
export function fraseDaRecusaDoAceite(campos: readonly CampoDoAceite[]): string {
  const partes: string[] = [];
  if (campos.includes("nome")) partes.push("escreva o nome e o sobrenome");
  if (campos.includes("email")) partes.push("confira o e-mail");
  if (campos.includes("aceito")) partes.push("marque a autorização");
  const texto = partes.join(", ").replace(/, ([^,]*)$/, " e $1");
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}.`;
}
