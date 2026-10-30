/**
 * FORK MIA (.97) · ETIQUETAR os contatos de um filtro, pelo MCP de plataforma.
 *
 * É a mesma função que a tela de Contatos ganhou ("Selecionar todos os N contatos
 * deste filtro"), para quem implanta ou migra um cliente sem clicar na tela. A
 * regra da casa manda: função nova entra no MCP na mesma versão.
 *
 * ── O que ela reaproveita, e no que difere da tela ────────────────────────
 *
 *  - QUEM ENTRA NO FILTRO é o `listContactsHandler`, o mesmo da tela: uma lista
 *    só de contatos, sem uma segunda régua de busca e etiqueta;
 *  - a etiqueta é normalizada pela mesma regra da escrita (`normalizarTags`);
 *  - NÃO emite `contact.tag_added`, como `plataforma_importar_contatos`: pelo
 *    token de plataforma, um "quando ganhar a etiqueta X, enviar mensagem" viraria
 *    um disparo para a base inteira sem ninguém olhando. Pela tela o evento sai,
 *    porque quem clica leu o aviso;
 *  - anda em partes de até `TETO_POR_CHAMADA` e devolve o `cursor`: quem chama
 *    repete, e nada amarra milhares de escritas a um pedido só.
 *
 * Contato anonimizado nunca é tocado (LGPD), e é o mesmo que o PATCH recusa.
 */
import { listContactsHandler } from "@/app/api/v1/contacts/_handler";
import { normalizarTag, normalizarTags } from "@/lib/contacts/tag-normalizada";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

import type { Implantacao } from "./base";

/** Quantos contatos uma chamada alcança. Acima disso, `continua: true` e o `cursor`. */
export const TETO_POR_CHAMADA = 1000;

/** O tamanho da página da lista (o teto de `contactListQuerySchema`). */
const PAGINA = 100;

export interface FiltroDaEtiquetagem {
  busca?: string;
  etiquetas?: string[];
  modo?: "e" | "ou";
  origem?: string;
  pessoais?: boolean;
}

export interface PedidoDeEtiquetagem {
  etiqueta: string;
  acao?: "adicionar" | "remover";
  filtro?: FiltroDaEtiquetagem;
  toda_a_base?: boolean;
  apenas_contar?: boolean;
  cursor?: string;
}

export async function etiquetarContatos(c: Implantacao, pedido: PedidoDeEtiquetagem) {
  const etiqueta = normalizarTag(pedido.etiqueta);
  if (etiqueta === "") throw new Recusa("A etiqueta veio vazia. Mande o nome dela em `etiqueta`.");

  const filtro = pedido.filtro ?? {};
  const temFiltro = Boolean(
    filtro.busca || filtro.origem || filtro.pessoais || (filtro.etiquetas && filtro.etiquetas.length > 0),
  );
  // Um filtro esquecido não pode virar a base inteira.
  if (!temFiltro && !pedido.toda_a_base) {
    throw new Recusa(
      "Sem filtro, a etiqueta iria para a base inteira. Mande `filtro`, ou `toda_a_base: true` se é isso mesmo.",
    );
  }

  const ctx = {
    organization_id: c.orgId,
    actor: { type: "user" as const, id: c.autorUserId },
    requestId: c.requestId,
  };
  const consulta = {
    search: filtro.busca,
    tag: filtro.etiquetas,
    modo: filtro.modo,
    source: filtro.origem,
    pessoais: filtro.pessoais,
    order_by: "created_at" as const,
    order_dir: "asc" as const,
  };

  const contagem = await listContactsHandler(c.admin, ctx, { ...consulta, limit: 1 }, undefined, { comTotal: true });
  const total = contagem.total ?? null;
  if (pedido.apenas_contar) return { total_do_filtro: total, gravou_algo: false };

  const adicionar = (pedido.acao ?? "adicionar") === "adicionar";
  let processados = 0;
  let alterados = 0;
  let jaEstavam = 0;
  let anonimizados = 0;
  const falhas: string[] = [];
  let cursor = pedido.cursor;
  let continua = true;

  while (continua && processados < TETO_POR_CHAMADA) {
    const pagina = await listContactsHandler(c.admin, ctx, {
      ...consulta,
      limit: Math.min(PAGINA, TETO_POR_CHAMADA - processados),
      cursor,
    });
    for (const contato of pagina.contacts) {
      processados += 1;
      if (contato.is_anonymized) {
        anonimizados += 1;
        continue;
      }
      const atuais = contato.tags ?? [];
      const novas = adicionar
        ? normalizarTags([...atuais, etiqueta])
        : normalizarTags(atuais.filter((t) => normalizarTag(t) !== etiqueta));
      if (novas.length === atuais.length) {
        jaEstavam += 1;
        continue;
      }
      const { error } = await c.admin
        .from("contacts")
        .update({ tags: novas, updated_at: new Date().toISOString() })
        .eq("organization_id", c.orgId)
        .eq("id", contato.id);
      if (error) falhas.push(`${contato.id}: ${error.message}`);
      else alterados += 1;
    }
    continua = pagina.has_more && Boolean(pagina.cursor);
    cursor = pagina.cursor ?? undefined;
  }

  return {
    total_do_filtro: total,
    processados,
    alterados,
    ja_estavam: jaEstavam,
    anonimizados_ignorados: anonimizados,
    falhas: falhas.slice(0, 20),
    continua,
    cursor: continua ? (cursor ?? null) : null,
    gravou_algo: alterados > 0,
  };
}
