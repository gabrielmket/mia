/**
 * FORK MIA · EMPRESA ÚNICA — o CNPJ na tela e no banco. Puro, sem dependência:
 * a tela (cliente) e o servidor usam o mesmo.
 */

/** `00.000.000/0000-00` a partir de qualquer coisa com 14 dígitos. */
export function formatarCnpj(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  if (d.length !== 14) return v;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Só os dígitos, quando são 14. A mesma régua de `fn_mia_cnpj_normalizado` (9032). */
export function cnpjNormalizado(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length === 14 ? d : null;
}
