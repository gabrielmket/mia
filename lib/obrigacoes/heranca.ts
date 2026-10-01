/**
 * FORK MIA — OBRIGAÇÕES · a HERANÇA.
 *
 * O item é um registro só, e aparece em mais de um lugar:
 *
 *   · o que é da EMPRESA aparece em todos os negócios dela;
 *   · o que é do CONTATO acompanha a pessoa nos negócios em que ela é o contato;
 *   · o que é do NEGÓCIO fica só nele.
 *
 * Mexer num lugar muda no outro, porque não há cópia: estas funções só dizem em
 * que GRUPO o item entra em cada tela. Porta de `itensDoNeg` e `itensDaEmpresa`
 * do protótipo aprovado.
 *
 * ⚠️ Módulo PURO.
 */

export type GrupoDaObrigacao = "negocio" | "empresa" | "contato";

interface Vinculos {
  lead_id: string | null;
  empresa_id: string | null;
  contact_id: string | null;
}

/**
 * O grupo do item NO CARTÃO DE UM NEGÓCIO: do próprio negócio primeiro, depois
 * da empresa dele, depois do contato dele. `null` = o item não é deste negócio.
 */
export function grupoNoNegocio(
  item: Vinculos,
  negocio: { id: string; empresa_id: string | null; contact_id: string | null },
): GrupoDaObrigacao | null {
  if (item.lead_id === negocio.id) return "negocio";
  if (negocio.empresa_id && item.empresa_id === negocio.empresa_id) return "empresa";
  if (negocio.contact_id && item.contact_id === negocio.contact_id) return "contato";
  return null;
}

/**
 * O grupo do item NA FICHA DE UMA EMPRESA: da empresa, de um contato dela, ou
 * de um negócio dela.
 */
export function grupoNaEmpresa(
  item: Vinculos,
  empresa: { id: string; contatos: ReadonlySet<string>; negocios: ReadonlySet<string> },
): GrupoDaObrigacao | null {
  if (item.empresa_id === empresa.id) return "empresa";
  if (item.contact_id && empresa.contatos.has(item.contact_id)) return "contato";
  if (item.lead_id && empresa.negocios.has(item.lead_id)) return "negocio";
  return null;
}

/**
 * O grupo do item NA FICHA DE UM CONTATO: da pessoa, ou da empresa dela (que
 * ela herda).
 */
export function grupoNoContato(
  item: Vinculos,
  contato: { id: string; empresa_id: string | null },
): GrupoDaObrigacao | null {
  if (item.contact_id === contato.id) return "contato";
  if (contato.empresa_id && item.empresa_id === contato.empresa_id) return "empresa";
  return null;
}

/** A quem o item pertence, para a lista geral: negócio, depois empresa, depois contato. */
export function donoDoItem(item: Vinculos): GrupoDaObrigacao {
  if (item.lead_id) return "negocio";
  if (item.empresa_id) return "empresa";
  return "contato";
}
