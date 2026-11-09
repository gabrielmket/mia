/**
 * FORK MIA (.107) · POST /api/v1/publico/raio-x/minha-area/conexao — a conexão
 * do número na área do Raio-X (protótipo de 06/11/2026, tela 6). Corpo:
 * `{ raio_x_id, acao: "desconectar" | "conectar" }`.
 *
 *   desconectar  derruba a conexão AGORA, só do raio-X DESTA conta (o mesmo
 *                `desconectarAgora` do Admin: logout no aparelho e a sessão
 *                apagada no leitor); o relatório que já saiu fica
 *   conectar     o link de conexão vivo do raio-X que ainda espera conectar
 *                (gera outro quando o de 48 h venceu) para a página abrir
 *
 * Raio-X de outra conta responde como inexistente (404). Confere a origem (o
 * próprio app) e o cookie da área.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { conferirPedidoDaArea, raioXDaContaPeloId } from "@/lib/raio-x/area";
import { desconectarAgora, gerarOutroLinkDeConexao, linkDeConexaoAtual, podeConectar } from "@/lib/raio-x/banco";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const admin = createAdminClient();
  const acesso = await conferirPedidoDaArea(admin, req.headers);
  if (!acesso.ok) {
    return acesso.motivo === "origem"
      ? fail("forbidden", "Pedido de fora da página do Raio-X.", 403, { requestId })
      : fail("unauthenticated", "Entre de novo na área do Raio-X.", 401, { requestId });
  }
  const corpo = ((await req.json().catch(() => null)) ?? {}) as { raio_x_id?: unknown; acao?: unknown };
  const achado = typeof corpo.raio_x_id === "string" ? await raioXDaContaPeloId(admin, acesso.conta, corpo.raio_x_id) : null;
  if (!achado) return fail("not_found", "Raio-X não encontrado.", 404, { requestId });
  const r = achado.raioX;

  if (corpo.acao === "desconectar") {
    if (!r.sessao || !r.conectado_em || r.desconectado_em || r.situacao === "encerrado") return fail("conflict", "Este WhatsApp não está conectado.", 409, { requestId });
    const d = await desconectarAgora(admin, r);
    void audit({
      action: "raio_x.desconectado",
      actorUserId: null,
      actingAsPlatformAdmin: false,
      resourceType: "mia_raio_x",
      resourceId: r.id,
      requestId,
      metadata: { origem: "area", conta_id: acesso.conta.id, falha_no_leitor: d.falhaNoLeitor },
    });
    return ok({ desconectou: d.desconectou, aviso: d.falhaNoLeitor ? "Se o aparelho ainda aparecer, tire em WhatsApp › Aparelhos conectados." : null }, { requestId });
  }

  if (corpo.acao === "conectar") {
    if (r.situacao !== "aguardando" && r.situacao !== "conectando") return fail("conflict", "Este Raio-X não está esperando conectar.", 409, { requestId });
    if (podeConectar(r)) return ok({ link: linkDeConexaoAtual(r).link }, { requestId });
    const g = await gerarOutroLinkDeConexao(admin, r);
    if (!g.ok) return fail("conflict", "Este Raio-X não está esperando conectar.", 409, { requestId });
    void audit({
      action: "raio_x.link_de_conexao_gerado",
      actorUserId: null,
      actingAsPlatformAdmin: false,
      resourceType: "mia_raio_x",
      resourceId: r.id,
      requestId,
      metadata: { origem: "area", conta_id: acesso.conta.id, expira_em: g.expiraEm },
    });
    return ok({ link: g.link }, { requestId });
  }

  return fail("validation_failed", "Ação desconhecida.", 400, { requestId });
}
