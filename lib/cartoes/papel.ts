/**
 * FORK MIA — o PAPEL de uma pessoa: na empresa (contacts.papel_na_empresa,
 * migration 9013) e num negócio (crm_lead_links.metadata.papel, "contatos
 * envolvidos").
 *
 * Vocabulário FECHADO, e o mesmo nos dois lugares: quem decide, quem aprova o
 * valor, quem vai usar, quem influencia. Gravado como código (sem acento, sem
 * maiúscula) e mostrado pelo rótulo, que passa pela tradução da tela.
 */
export const PAPEIS = ["decisor", "financeiro", "usuario", "influenciador", "outro"] as const;
export type Papel = (typeof PAPEIS)[number];

export const ROTULO_DO_PAPEL = {
  decisor: "Decisor",
  financeiro: "Financeiro",
  usuario: "Usuário",
  influenciador: "Influenciador",
  outro: "Outro",
} as const satisfies Record<Papel, string>;

export function ehPapel(v: unknown): v is Papel {
  return typeof v === "string" && (PAPEIS as readonly string[]).includes(v);
}
