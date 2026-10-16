/**
 * FORK MIA (item 9) — GET /api/v1/relatorios/exportacoes
 *
 * O registro das exportações do montador: quem, quando, o quê e quantas
 * linhas. Só gestor e administrador (decisão do protótipo; a RLS da 9040
 * confere de novo). Só lê.
 */
import { randomUUID } from "node:crypto";

import { ok } from "@/lib/api/wrappers";
import { idsDePessoa, nomesDaEquipe } from "@/lib/relatorios/equipe";
import { contextoDaRota, respostaDaRecusa } from "@/lib/relatorios/rota";
import { listarExportacoes } from "@/lib/relatorios/servidor";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const r = await contextoDaRota(requestId, "manager");
  if (!r.ok) return r.response;
  const { ctx } = r;
  try {
    const exportacoes = await listarExportacoes(ctx.db, ctx.quem.organizationId);
    const nomes = ctx.admin
      ? await nomesDaEquipe(ctx.admin, ctx.quem.organizationId, idsDePessoa(exportacoes.map((x) => x.userId)))
      : {};
    return ok(
      { exportacoes: exportacoes.map((x) => ({ ...x, quem: x.userId ? (nomes[x.userId] ?? null) : null })) },
      { requestId },
    );
  } catch (e) {
    return respostaDaRecusa(e, ctx.t, requestId);
  }
}
