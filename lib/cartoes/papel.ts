/**
 * FORK MIA — o PAPEL de uma pessoa: na empresa (contacts.papel_na_empresa,
 * migration 9013) e num negócio (crm_lead_links.metadata.papel, "contatos
 * envolvidos"; e, desde a .87, também o texto do participante do upstream que
 * é um destes cinco: `papelDoTexto`).
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

/**
 * FORK MIA (.87) — o papel escrito como TEXTO, reconhecido na lista do fork.
 *
 * O dossiê do upstream (v1.88, #1506/#3083) grava o papel do participante em
 * texto livre (`crm_lead_links.metadata.papel`, `link_kind = 'related'`). Quando
 * o texto é um dos cinco papéis do fork, escrito como código ou como rótulo, em
 * português ou espanhol, com ou sem acento ou maiúscula ("Financeiro",
 * "usuário", "Otro"), o fork o lê como o papel da lista: o cartão aberto mostra
 * o mesmo papel que mostraria se ele tivesse sido escolhido aqui. Qualquer outro
 * texto ("Pagante", "Passageira") não é papel da lista e volta `null`.
 */
const PAPEL_POR_TEXTO: Record<string, Papel> = {
  decisor: "decisor",
  financeiro: "financeiro",
  financiero: "financeiro",
  usuario: "usuario",
  influenciador: "influenciador",
  outro: "outro",
  otro: "outro",
};

export function papelDoTexto(texto: unknown): Papel | null {
  if (typeof texto !== "string") return null;
  const chave = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  return PAPEL_POR_TEXTO[chave] ?? null;
}
