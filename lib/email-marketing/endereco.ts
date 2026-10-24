/**
 * FORK MIA (.89) — o ENDEREÇO de e-mail: forma, hash, máscara.
 *
 * O hash é o que mora na supressão (`campaign_suppressions.recipient_address_hash`,
 * com `tipo_de_endereco = 'email'`) e no registro de consentimento: SHA-256 do
 * endereço aparado e em minúsculas, o mesmo cálculo da coluna gerada
 * `contacts.email_normalized` (`lower(trim(email))`). Mudar um lado sem o outro
 * faz a lista parar de casar, em silêncio — por isso o cálculo mora num lugar só.
 *
 * O telefone da lista do upstream é normalizado como `+` e dígitos; o e-mail tem
 * `@`. Os dois nunca produzem o mesmo texto, então nunca o mesmo hash.
 */
import { createHash } from "node:crypto";

/** O mesmo piso de "cara de endereço" do CHECK `contacts_email_format`. */
const FORMA = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizarEmail(bruto: string | null | undefined): string {
  return (bruto ?? "").trim().toLowerCase();
}

/** Tem forma de endereço? Não diz se o domínio recebe e-mail (isso é do DNS). */
export function emailComForma(bruto: string | null | undefined): boolean {
  const e = normalizarEmail(bruto);
  return e.length > 0 && e.length <= 254 && FORMA.test(e);
}

export function hashDoEmail(bruto: string): string {
  return createHash("sha256").update(normalizarEmail(bruto), "utf8").digest("hex");
}

/** O domínio do endereço, em minúsculas. Vazio quando não há `@`. */
export function dominioDoEmail(bruto: string | null | undefined): string {
  const e = normalizarEmail(bruto);
  const i = e.lastIndexOf("@");
  return i < 0 ? "" : e.slice(i + 1);
}

/**
 * O começo do endereço, para a tela dizer DE QUEM é a linha sem guardá-lo
 * inteiro: `an•••@example.com`. É o `address_tail` da lista do upstream, e sai
 * na anonimização junto com o contato (o gatilho do upstream o apaga).
 */
export function mascararEmail(bruto: string | null | undefined): string {
  const e = normalizarEmail(bruto);
  const i = e.lastIndexOf("@");
  if (i < 0) return "";
  return `${e.slice(0, Math.min(2, i))}•••@${e.slice(i + 1)}`;
}
