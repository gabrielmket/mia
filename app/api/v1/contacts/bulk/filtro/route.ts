/**
 * POST /api/v1/contacts/bulk/filtro · FORK MIA (.97): a ação em lote valendo
 * para TODOS os contatos de um filtro, uma parte por chamada.
 *
 * ── O defeito ─────────────────────────────────────────────────────────────
 *
 * A etiqueta em massa da tela de Contatos parava em 100: a barra só conhecia os
 * ids marcados, e a rota de lote recusa mais que isso por chamada. Quem tinha
 * 565 contatos para etiquetar marcava página por página, ou desistia.
 *
 * ── O desenho ─────────────────────────────────────────────────────────────
 *
 * O servidor resolve o filtro e cada chamada anda UMA parte (até `TETO_DO_LOTE`
 * contatos) e devolve o `cursor` da próxima. Quem repete é a tela, com a barra
 * mostrando quantos já foram (`lib/contacts/lote-em-partes.ts`). Tudo numa
 * chamada só amarraria milhares de escritas a um pedido HTTP: um proxy no meio
 * derrubaria o pedido e ninguém saberia até onde foi.
 *
 * Esta rota não decide nada sozinha, e é por isso que ela é curta:
 *
 *  - QUEM ENTRA NO FILTRO: `listContactsHandler`, o MESMO da lista e da
 *    exportação, com a sessão de quem chama (RLS) e a organização da sessão.
 *    Reescrever o WHERE aqui seria uma segunda resposta para a mesma pergunta;
 *  - O QUE ACONTECE COM CADA UM: o `POST` de `../route.ts`, a rota de lote de
 *    sempre, que encaminha cada id à rota individual. Permissão, auditoria por
 *    contato e recusa por item seguem morando lá.
 *
 * A ordem é `created_at`, que não muda: com `last_activity_at` a própria ação
 * poderia mexer na posição do contato e fazer a parte seguinte pular gente. O
 * cursor é por posição (keyset), e não por deslocamento: "remover a etiqueta X"
 * do filtro "etiqueta X" tira os contatos do filtro enquanto anda, e ninguém é
 * pulado por isso.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { bulkContactActionSchema, contactListQuerySchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

import { listContactsHandler } from "../../_handler";
import { POST as rodarOLote, TETO_DO_LOTE } from "../route";

export const dynamic = "force-dynamic";

/** O filtro da tela: os mesmos campos e a mesma validação da lista. */
const filtroSchema = contactListQuerySchema.pick({
  search: true,
  tag: true,
  modo: true,
  source: true,
  pessoais: true,
});

/** A ação é a da rota de lote; só os ids saem, porque quem os resolve é o filtro. */
const corpoSchema = z
  .object({ filtro: filtroSchema, cursor: z.string().optional() })
  .and(
    z.discriminatedUnion("action", [
      bulkContactActionSchema.options[0].omit({ ids: true }),
      bulkContactActionSchema.options[1].omit({ ids: true }),
      bulkContactActionSchema.options[2].omit({ ids: true }),
    ]),
  );

interface RelatorioDaParte {
  feitos: number;
  recusados: number;
  resultados: Array<{ id: string; feito: boolean; codigo?: string; motivo?: string }>;
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;

  let corpo: z.output<typeof corpoSchema>;
  try {
    corpo = await validateRequest(corpoSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }
  const { filtro, cursor, ...acao } = corpo;

  // A carteira é de gerente para cima. Aqui a recusa é da CHAMADA: com o filtro
  // inteiro, deixar para o item seria devolver milhares de recusas iguais.
  if (acao.action === "carteira") {
    const gerente = await requireRole("manager", { requestId, resource: "contacts" });
    if (!gerente.ok) return gerente.response;
  }

  const supabase = await createClient();
  let lidos: { ids: string[]; cursor: string | null; has_more: boolean };
  try {
    const { contacts, cursor: proximo, has_more } = await listContactsHandler(
      supabase,
      {
        organization_id: authz.org.orgId,
        actor: { type: "user", id: authz.user.id },
        requestId,
        idioma: authz.user.idioma,
      },
      { ...filtro, cursor, limit: TETO_DO_LOTE, order_by: "created_at", order_dir: "asc" },
    );
    lidos = { ids: contacts.map((c) => c.id), cursor: proximo, has_more };
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { requestId });
    throw err;
  }

  if (lidos.ids.length === 0) {
    return ok(
      { acao: acao.action, processados: 0, feitos: 0, recusados: 0, recusas: [], cursor: null, has_more: false },
      { requestId },
    );
  }

  const resposta = await rodarOLote(
    new NextRequest("http://localhost/api/v1/contacts/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...acao, ids: lidos.ids }),
    }),
  );
  // Recusa da CHAMADA (papel, corpo, teto): ela sobe como veio, e a tela para.
  if (!resposta.ok) return resposta;
  const { data } = (await resposta.json()) as { data: RelatorioDaParte };

  return ok(
    {
      acao: acao.action,
      processados: lidos.ids.length,
      feitos: data.feitos,
      recusados: data.recusados,
      // Só os recusados: o relatório inteiro de milhares de contatos é peso sem uso.
      recusas: data.resultados
        .filter((r) => !r.feito)
        .map((r) => ({ id: r.id, codigo: r.codigo, motivo: r.motivo })),
      cursor: lidos.cursor,
      has_more: lidos.has_more,
    },
    { requestId },
  );
}
