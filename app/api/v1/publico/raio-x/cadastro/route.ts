/**
 * FORK MIA (.106) · POST /api/v1/publico/raio-x/cadastro — o cadastro do
 * RAIO-X GRÁTIS (protótipo aprovado em 06/11/2026, tela 1).
 *
 * Quem chama é o formulário do SITE (iamia.com.br, outro repositório) ou a
 * página do próprio sistema (`/raio-x/gratis`). O contrato inteiro (endereço,
 * campos, valores, respostas) está em docs/fork/raio-x-do-atendimento.md,
 * seção 16. Duas formas, a mesma regra:
 *
 *   formulário (x-www-form-urlencoded ou multipart)
 *     criado       303 para a página de conexão do raio-X (/raio-x/<código>),
 *                  que já abre na etapa de conectar (o aceite foi no cadastro)
 *     já usou      303 para /raio-x/entrar?email=…&motivo=ja_usou
 *     inválido     303 de volta ao `retorno_erro` com ?erro=<campos>; sem ele,
 *                  uma página simples de erro do sistema (400)
 *   JSON (o site com fetch; CORS só para https://iamia.com.br e www)
 *     criado 201 { raio_x_id, link, entrar } · já usou 409 { motivo: ja_usou }
 *     inválido 400 { campos } · muitas tentativas 429
 *
 * Público, sem conta: teto por IP e por e-mail (`authRateLimited`) e o campo
 * armadilha `site`, que precisa vir vazio. Sem efeito em empresa da MIA além do
 * lead no CRM da Time.
 */
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { limparEmail } from "@/lib/raio-x/aceite";
import { cadastrar } from "@/lib/raio-x/cadastrar";
import { enderecoDoErro, FRASE_DO_CAMPO, ORIGENS_DO_SITE, validarCadastro, type CampoDoCadastro } from "@/lib/raio-x/cadastro";
import { enderecoDeEntrar } from "@/lib/raio-x/emails";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ROTULO_DO_LIMITE_DO_CADASTRO = "raio_x_cadastro";
const LIMITE_DO_CADASTRO = { ip: 20, id: 5, windowSec: 3600 } as const;

/** CORS só para o site (o formulário por `fetch`); o POST de formulário não precisa. */
function cabecalhosDoSite(origem: string | null): Record<string, string> {
  if (!origem || !(ORIGENS_DO_SITE as readonly string[]).includes(origem)) return {};
  return {
    "Access-Control-Allow-Origin": origem,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function absoluto(caminho: string): string {
  if (/^https?:\/\//.test(caminho)) return caminho;
  const base = (env.NEXT_PUBLIC_APP_URL ?? "http://localhost").replace(/\/+$/, "");
  return `${base}${caminho}`;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** A página simples de erro do sistema, para o formulário sem `retorno_erro`. */
function paginaDeErro(status: number, titulo: string, linhas: string[]): Response {
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Raio-X do atendimento</title></head>
<body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f3f6f4;color:#111513">
<main style="max-width:560px;margin:48px auto;padding:24px;background:#fff;border:1px solid #dce3de;border-radius:12px">
<h1 style="font-size:20px;margin:0 0 12px">${escapar(titulo)}</h1>
<ul style="margin:0 0 16px;padding-left:20px;line-height:1.6">${linhas.map((l) => `<li>${escapar(l)}</li>`).join("")}</ul>
<p style="margin:0"><a href="/raio-x/gratis" style="color:#0a7a57;font-weight:700">Voltar ao cadastro</a></p>
</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

async function lerCorpo(req: NextRequest): Promise<{ corpo: Record<string, unknown>; formulario: boolean } | null> {
  const tipo = req.headers.get("content-type") ?? "";
  if (tipo.includes("application/x-www-form-urlencoded")) {
    return { corpo: Object.fromEntries(new URLSearchParams(await req.text())), formulario: true };
  }
  if (tipo.includes("multipart/form-data")) {
    const dados = await req.formData().catch(() => null);
    if (!dados) return null;
    const corpo: Record<string, unknown> = {};
    for (const [k, v] of dados.entries()) if (typeof v === "string") corpo[k] = v;
    return { corpo, formulario: true };
  }
  const json = await req.json().catch(() => undefined);
  if (json === undefined || json === null || typeof json !== "object" || Array.isArray(json)) return null;
  return { corpo: json as Record<string, unknown>, formulario: false };
}

export async function OPTIONS(req: NextRequest): Promise<Response> {
  return new Response(null, { status: 204, headers: cabecalhosDoSite(req.headers.get("origin")) });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const cors = cabecalhosDoSite(req.headers.get("origin"));
  const lido = await lerCorpo(req);
  if (!lido) return fail("invalid_request", "Corpo do cadastro ilegível.", 400, { requestId, headers: cors });
  const { corpo, formulario } = lido;

  if (await authRateLimited(ROTULO_DO_LIMITE_DO_CADASTRO, limparEmail(corpo.email) || null, LIMITE_DO_CADASTRO)) {
    if (formulario) return paginaDeErro(429, "Muitas tentativas seguidas", ["Aguarde alguns minutos e tente de novo."]);
    return fail("rate_limited", "Muitas tentativas seguidas. Aguarde alguns minutos.", 429, { requestId, headers: { ...cors, "Retry-After": "600" } });
  }

  const v = validarCadastro(corpo);
  if (!v.ok) {
    const frases = v.campos.map((c: CampoDoCadastro) => FRASE_DO_CAMPO[c]);
    if (formulario) {
      if (v.retornoErro) return NextResponse.redirect(absoluto(enderecoDoErro(v.retornoErro, v.campos)), 303);
      return paginaDeErro(400, "Confira o cadastro", frases);
    }
    return fail("validation_failed", frases.join(" "), 400, { requestId, headers: cors, details: { campos: v.campos } });
  }

  let desfecho;
  try {
    desfecho = await cadastrar(createAdminClient(), v.valor);
  } catch (erro) {
    logger.warn("[raio-x] o cadastro falhou", { requestId, detail: erro instanceof Error ? erro.message : "erro" });
    if (formulario) return paginaDeErro(500, "Não deu para criar o seu Raio-X agora", ["Tente de novo em alguns minutos."]);
    return fail("internal_error", "Não deu para criar o seu Raio-X agora. Tente de novo em alguns minutos.", 500, { requestId, headers: cors });
  }

  if (desfecho.tipo === "ja_usou") {
    void audit({
      action: "raio_x.cadastro_repetido",
      actorUserId: null,
      actingAsPlatformAdmin: false,
      resourceType: "mia_raio_x_contas",
      resourceId: desfecho.conta.id,
      requestId,
      metadata: { raio_x_id: desfecho.raioXId, lead: desfecho.lead.ok ? "atualizado" : desfecho.lead.motivo },
    });
    const entrar = `${enderecoDeEntrar(desfecho.conta.email)}&motivo=ja_usou`;
    if (formulario) return NextResponse.redirect(absoluto(entrar), 303);
    return fail("conflict", "A análise grátis deste número (ou deste e-mail) já foi usada. Entre na sua área para ver o Raio-X ou pedir uma nova análise.", 409, {
      requestId,
      headers: cors,
      details: { motivo: "ja_usou", entrar },
    });
  }

  void audit({
    action: "raio_x.criado",
    actorUserId: null,
    actingAsPlatformAdmin: false,
    resourceType: "mia_raio_x",
    resourceId: desfecho.raioX.id,
    requestId,
    metadata: { via: "cadastro", gratis: true, conta_id: desfecho.conta.id, lead: desfecho.lead.ok ? "criado" : desfecho.lead.motivo, email: desfecho.emailSaiu ? "enviado" : "nao_saiu" },
  });
  void audit({
    action: "raio_x.aceite",
    actorUserId: null,
    actingAsPlatformAdmin: false,
    resourceType: "mia_raio_x",
    resourceId: desfecho.raioX.id,
    requestId,
    // O nome e o e-mail de quem aceitou moram em mia_raio_x_aceites; a trilha guarda só a referência.
    metadata: { aceite_id: desfecho.aceiteId, termo_versao: desfecho.termoVersao, fonte: "conexao", via: "cadastro" },
  });
  if (formulario) return NextResponse.redirect(desfecho.link, 303);
  return ok(
    { raio_x_id: desfecho.raioX.id, link: desfecho.link, entrar: enderecoDeEntrar(desfecho.conta.email), pronto_para_parear: desfecho.prontoParaParear },
    { status: 201, requestId, headers: cors },
  );
}
