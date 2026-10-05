/**
 * FORK MIA · AS EMPRESAS DE DEMONSTRAÇÃO — o que toda semente de segmento usa.
 */
import type { CustomFieldDef } from "@/lib/schemas/settings";

/** Um campo de escolha do funil, com as opções iguais ao que se lê. */
export const escolha = (key: string, label: string, opcoes: string[]): CustomFieldDef => ({
  key,
  label,
  type: "select",
  options: opcoes.map((o) => ({ value: o, label: o })),
});

/** Os dois dígitos verificadores de um CNPJ (12 dígitos de base). */
export function digitosDoCnpj(base12: string): string {
  const conta = (digitos: string, pesos: number[]) => {
    const soma = pesos.reduce((t, p, i) => t + p * Number(digitos[i]), 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = conta(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = conta(`${base12}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${d1}${d2}`;
}

/**
 * Um CNPJ que NÃO EXISTE: base `99NNNNNN0001` e o primeiro dígito verificador
 * trocado de propósito. Nenhuma Receita aceita, então não é de empresa nenhuma,
 * e a ficha da demonstração mostra um documento com cara de documento.
 * Só dígitos, como `crm_empresas.cnpj` guarda.
 */
export function cnpjFalso(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999_999) throw new Error(`cnpjFalso: ${n}`);
  const base = `99${String(n).padStart(6, "0")}0001`;
  const [d1, d2] = digitosDoCnpj(base).split("").map(Number) as [number, number];
  return `${base}${(d1 + 1) % 10}${d2}`;
}
