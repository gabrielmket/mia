/**
 * FORK MIA (.90) — decidir um pedido de cadastro pelo MCP de plataforma
 * (`plataforma_decidir_pedido_de_cadastro`).
 *
 * APROVAR é ESPELHO da ação do upstream (`app/actions/registration/decide.ts`,
 * a fila de `/admin/cadastro`): a conta tem de ter o e-mail confirmado pelo
 * provedor, a empresa nasce pelo MESMO caminho do cadastro aberto
 * (`ensureTenantForUser`, com o plano escolhido no cadastro), e só o primeiro a
 * decidir grava (`.eq("status", "pending")`). O ator é quem criou o token. A
 * cerca `mcp-de-implantacao-espelhos` reprova quando a ação do upstream muda.
 *
 * RECUSAR grava a decisão e manda o MOTIVO por e-mail a quem pediu (o protótipo
 * de 25/10/2026: "recusar com o motivo que vai no e-mail"; a tela do upstream
 * recusa sem texto). A conta fica criada, sem empresa.
 *
 * Rodar de novo num pedido já decidido devolve a decisão anterior, sem efeito.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { ensureTenantForUser } from "@/lib/auth/provision";
import { marcaDaSaida } from "@/lib/branding/saida";
import { sendEmail } from "@/lib/email/roteador";
import { buildEmailDaCobranca } from "@/lib/email/templates/cobranca";
import { env } from "@/lib/env";
import { maskEmail } from "@/lib/lgpd/mask";
import { logger } from "@/lib/logger";

import { lerPlanosComModulos } from "./leitura";
import { modulosPeloPlano } from "./modulos";
import { seguirOPlano } from "./seguir-o-plano";

export type DecisaoDoPedido = "aprovar" | "recusar";

export type ResultadoDaDecisao =
  | {
      ok: true;
      decisao: "aprovado" | "recusado";
      ja_decidido: boolean;
      organizacao?: { id: string; nome: string; plano: string | null; teste_ate: string | null; modulos: string[] };
      aviso?: string;
    }
  | { ok: false; code: string; message: string };

export async function decidirPedidoDeCadastro(
  admin: SupabaseClient,
  p: { pedidoId: string; decisao: DecisaoDoPedido; motivo?: string | null },
  ator: { userId: string; tokenId: string | null; requestId: string | null },
): Promise<ResultadoDaDecisao> {
  const { data: pedido, error } = await admin
    .from("registration_requests")
    .select("id, user_id, requested_organization_name, status")
    .eq("id", p.pedidoId)
    .maybeSingle();
  if (error) throw new Error(`pedido ilegível (${error.code ?? "sem_codigo"})`);
  if (!pedido) return { ok: false, code: "not_found", message: "Pedido não encontrado. Veja os pendentes em plataforma_listar_pedidos_de_cadastro." };
  const linha = pedido as { id: string; user_id: string; requested_organization_name: string; status: string };
  if (linha.status !== "pending") {
    return { ok: true, decisao: linha.status === "approved" ? "aprovado" : "recusado", ja_decidido: true };
  }

  const { data: conta } = await admin.auth.admin.getUserById(linha.user_id);
  const aprovar = p.decisao === "aprovar";
  let organizationId: string | null = null;
  if (aprovar) {
    // Sem confirmação pelo provedor de auth, o endereço não foi provado (a mesma régua do upstream).
    if (!conta.user || !conta.user.email_confirmed_at) {
      return { ok: false, code: "account_unavailable", message: "A conta deste pedido não existe mais ou ainda não confirmou o e-mail. Peça à pessoa para confirmar e tente de novo." };
    }
    const provisionado = await ensureTenantForUser(
      {
        id: conta.user.id,
        email: conta.user.email,
        user_metadata: {
          org_name: linha.requested_organization_name,
          ...(typeof conta.user.user_metadata?.cobranca_plan_id === "string"
            ? { cobranca_plan_id: conta.user.user_metadata.cobranca_plan_id }
            : {}),
        },
      },
      { source: "signup" },
    );
    organizationId = provisionado.organizationId ?? null;
  }

  const { data: gravou, error: erroDaGravacao } = await admin
    .from("registration_requests")
    .update({ status: aprovar ? "approved" : "rejected", decided_by: ator.userId, decided_at: new Date().toISOString() })
    .eq("id", linha.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (erroDaGravacao) throw new Error(`decisão não gravada (${erroDaGravacao.code ?? "sem_codigo"})`);
  if (!gravou) return { ok: true, decisao: aprovar ? "aprovado" : "recusado", ja_decidido: true };

  void audit({
    action: aprovar ? "registration.approved" : "registration.rejected",
    actorUserId: ator.userId,
    actorApiTokenId: ator.tokenId,
    organizationId,
    resourceType: "registration_request",
    resourceId: linha.id,
    actingAsPlatformAdmin: true,
    requestId: ator.requestId,
    metadata: { via: "mcp_de_plataforma", motivo_enviado: !aprovar && !!p.motivo },
  });

  const aviso = await avisarQuemPediu(admin, { email: conta.user?.email ?? null, empresa: linha.requested_organization_name, aprovado: aprovar, motivo: p.motivo ?? null });
  if (!aprovar) return { ok: true, decisao: "recusado", ja_decidido: false, ...(aviso ? { aviso } : {}) };

  if (!organizationId) return { ok: true, decisao: "aprovado", ja_decidido: false };
  await seguirOPlano(admin, organizationId, "cadastro");
  const [{ data: a }, planos, modulos, { data: org }] = await Promise.all([
    admin.from("cobranca_assinaturas").select("plano_id, trial_ate").eq("organization_id", organizationId).maybeSingle(),
    lerPlanosComModulos(admin),
    modulosPeloPlano(admin, organizationId),
    admin.from("organizations").select("display_name").eq("id", organizationId).maybeSingle(),
  ]);
  const assinatura = a as { plano_id?: string; trial_ate?: string | null } | null;
  return {
    ok: true,
    decisao: "aprovado",
    ja_decidido: false,
    organizacao: {
      id: organizationId,
      nome: (org as { display_name?: string } | null)?.display_name ?? linha.requested_organization_name,
      plano: assinatura?.plano_id ? planos.find((x) => x.id === assinatura.plano_id)?.nome ?? null : null,
      teste_ate: assinatura?.trial_ate ?? null,
      modulos,
    },
    ...(aviso ? { aviso } : {}),
  };
}

/**
 * O e-mail para quem pediu o cadastro: aprovado (a empresa está pronta, o teste
 * começou) ou recusado (com o motivo, quando houver). Usado pelo MCP e, por um
 * ponto de ligação FORK MIA, pela ação da tela do upstream. Melhor esforço:
 * devolve a frase do que aconteceu, nunca lança. O endereço vai mascarado.
 */
export async function avisarQuemPediu(
  _admin: SupabaseClient,
  p: { email: string | null; empresa: string; aprovado: boolean; motivo: string | null },
): Promise<string | undefined> {
  if (!p.email) return undefined;
  try {
    const marca = await marcaDaSaida(null);
    const base = (env.NEXT_PUBLIC_APP_URL ?? "").replace(//+$/, "");
    const msg = p.aprovado
      ? buildEmailDaCobranca({
          titulo: "Sua empresa está pronta",
          corpo: `O cadastro da ${p.empresa} foi aprovado e o teste grátis começou. Entre para dar os primeiros passos.`,
          marca,
          idioma: "pt-BR",
          botao: { rotulo: "Entrar", href: `${base}/login` },
          rodape: "Você recebe este e-mail porque pediu um cadastro.",
        })
      : buildEmailDaCobranca({
          titulo: "O cadastro não foi aprovado",
          corpo:
            `O cadastro da ${p.empresa} não foi aprovado.` +
            (p.motivo ? ` Motivo: ${p.motivo}` : "") +
            " A sua conta continua criada; responda a este e-mail se quiser conversar.",
          marca,
          idioma: "pt-BR",
          botao: { rotulo: "Entrar", href: `${base}/login` },
          rodape: "Você recebe este e-mail porque pediu um cadastro.",
        });
    const r = await sendEmail({ to: p.email, subject: msg.subject, html: msg.html, text: msg.text, fromName: marca.nome, tags: [{ name: "tipo", value: "cadastro" }] });
    return r.ok
      ? `e-mail de ${p.aprovado ? "liberação" : "recusa"} enviado a ${maskEmail(p.email)}`
      : "o e-mail não saiu (confira o envio de e-mail da instalação)";
  } catch (e) {
    logger.warn("planos-mia: e-mail do pedido de cadastro falhou", { detalhe: e instanceof Error ? e.message : String(e) });
    return "o e-mail não saiu";
  }
}

/** O mesmo aviso, a partir do id da conta (o ponto de ligação da ação do upstream). Nunca lança. */
export async function avisarQuemPediuPeloId(
  admin: SupabaseClient,
  userId: string,
  empresa: string,
  aprovado: boolean,
): Promise<void> {
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    await avisarQuemPediu(admin, { email: data.user?.email ?? null, empresa, aprovado, motivo: null });
  } catch (e) {
    logger.warn("planos-mia: aviso do pedido de cadastro falhou", { detalhe: e instanceof Error ? e.message : String(e) });
  }
}
