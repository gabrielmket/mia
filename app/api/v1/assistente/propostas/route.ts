/**
 * FORK MIA (.91, .94) · GET /api/v1/assistente/propostas: as propostas do
 * assistente (9080, 9100), para o cartão mostrar a situação e a página do
 * assistente mostrar as listas.
 *
 *   ?ids=<id>,<id>   as pedidas (as do histórico de quem pergunta)
 *   ?lista=pedidos   as que alguém pediu e esta pessoa aprova
 *   ?lista=meus_pedidos  as que esta pessoa fez e não aprova
 *   ?lista=feitas    as aplicadas e as desfeitas ("o que o assistente fez")
 *   sem nada         as pendentes da empresa
 *
 * Pela SESSÃO: a RLS da 9100 mostra todas a gestor e administrador, e ao
 * atendente as que ele fez. Cada uma volta como o cartão a mostra
 * (`leitura.ts`): nomes, quem aprova, o que a pessoa pode fazer e o que trava o
 * desfazer, decididos aqui. O pedido (o texto do agente) não sai daqui.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { contextoDaRotaDasPropostas } from "@/lib/assistente/propostas/contexto-da-rota";
import { LISTAS_DE_PROPOSTAS, lerLista } from "@/lib/assistente/propostas/leitura";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

const consulta = z
  .object({
    ids: z
      .string()
      .max(2000)
      .optional()
      .transform((v) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []))
      .pipe(z.array(z.string().uuid()).max(50)),
    lista: z.enum(LISTAS_DE_PROPOSTAS).optional(),
  })
  .strict();

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "mia_assistente_propostas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const lido = consulta.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  if (!lido.success) {
    return fail("validation_failed", t("Filtro inválido."), 422, { requestId, details: lido.error.flatten() });
  }
  const administra = roleAtLeast(authz.org.role, "admin");
  // O somente leitura não propõe nem decide (a RLS devolveria zero): resposta vazia, sem erro.
  if (!roleAtLeast(authz.org.role, "agent")) return ok({ propostas: [], pode_aplicar: false }, { requestId });

  const c = await contextoDaRotaDasPropostas(authz);
  const propostas = await lerLista(c, { ids: lido.data.ids, lista: lido.data.lista });
  if (!propostas) return fail("unavailable", t("Não deu para ler as propostas agora."), 503, { requestId });
  return ok({ propostas, pode_aplicar: administra }, { requestId });
}
