/**
 * FORK MIA (.61) — GET|PUT|POST|DELETE /api/v1/admin/paginas-da-meta
 *
 * GET    → a conexão da plataforma, as Páginas que ela alcança com o dono de cada
 *          uma, e as empresas.
 * PUT    → escolhe QUAL empresa empresta a conexão de Meta Ads (a Time Company).
 * POST   → atribui (ou troca) o dono de uma Página.
 * DELETE → retira o dono de uma Página (`?page_id=`).
 *
 * ─── Por que ato humano, no painel da plataforma ───────────────────────────
 *
 * O token da agência alcança as Páginas de vários clientes, e nada na resposta
 * da Meta diz de qual cliente NOSSO cada Página é. Adivinhar (pelo nome, pelo
 * Gerenciador) seria arriscar os leads de um cliente no funil de outro, que é o
 * pior desfecho desta funcionalidade. Mesma decisão do cadastro incorporado.
 *
 * Trocar o dono é permitido (corrige engano) e seguro: o gatilho da 9004 desliga
 * na hora os formulários da empresa antiga naquela Página, com o motivo gravado.
 *
 * Nenhum token sai daqui: a resposta leva nomes, ids e donos.
 *
 * .64 (migration 9008): a empresa com conta própria da Meta também assume as
 * Páginas dela. Cada dono tem a ORIGEM (`plataforma` ou `conta_propria`), que a
 * lista mostra; e o que a plataforma grava aqui é sempre `plataforma` — é esta
 * origem que o gatilho da 9008 deixa transferir a Página de uma empresa a outra.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita, requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { permissoesQueFaltam } from "@/lib/leads-da-meta/diagnostico";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { lerCredencialDeLeitura } from "@/lib/plataformas-de-anuncio/credenciais-de-leitura";
import { lerPermissoes, listarPaginas } from "@/lib/plataformas-de-anuncio/meta/leads";
import type { FalhaDeLeitura } from "@/lib/plataformas-de-anuncio/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const idDaPagina = z.string().regex(/^\d{1,30}$/, "Id de Página inválido.");

const conexaoSchema = z
  .object({ organizacao_da_conexao: z.string().uuid().nullable() })
  .strict();

const atribuirSchema = z
  .object({
    page_id: idDaPagina,
    page_name: z.string().max(300).nullable().optional(),
    organization_id: z.string().uuid(),
  })
  .strict();

async function exigirPlataforma() {
  try {
    return await requirePlatformAdmin();
  } catch {
    return null;
  }
}

/**
 * FORK MIA — a ESCRITA desta rota exige scope `full` e MFA em dia (upstream
 * 1.70, `requirePlatformAdminEscrita`): o acesso só de leitura ao painel de
 * plataforma (`support_readonly`) lê e não muda nada.
 */
async function exigirPlataformaParaEscrever(requestId: string) {
  try {
    return { ok: true as const, ctx: await requirePlatformAdminEscrita() };
  } catch (err) {
    return { ok: false as const, resposta: falhaDaEscritaDePlatformAdmin(err, requestId) };
  }
}

interface LinhaDeDono {
  page_id: string;
  organization_id: string;
  page_name: string | null;
  atribuida_em: string;
  /** .64 (9008): quem pôs o dono. Linha anterior à 9008 = plataforma. */
  origem?: "plataforma" | "conta_propria" | null;
}

interface PaginaNoPainel {
  id: string;
  nome: string;
  organization_id: string | null;
  organizacao: string | null;
  /** A conexão da plataforma alcança esta Página hoje? */
  alcancada: boolean;
  /** .64: atribuída pela plataforma ou assumida pela empresa. `null` = sem dono. */
  origem: "plataforma" | "conta_propria" | null;
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const ctx = await exigirPlataforma();
  if (!ctx) return fail("forbidden", "Platform admin required", 403, { requestId });

  const admin = createAdminClient();
  const [conexao, orgs, conectadas, donos] = await Promise.all([
    admin
      .from("mia_meta_conexao_da_plataforma")
      .select("organizacao_da_conexao, atualizado_em")
      .eq("id", 1)
      .maybeSingle(),
    admin
      .from("organizations")
      .select("id, display_name")
      .is("redacted_at", null)
      .order("display_name", { ascending: true }),
    admin.from("ad_insights_connections").select("organization_id").eq("platform", "meta_ads"),
    admin
      .from("mia_paginas_da_meta")
      .select("page_id, organization_id, page_name, atribuida_em, origem")
      .order("page_name", { ascending: true }),
  ]);
  const falhou = conexao.error ?? orgs.error ?? conectadas.error ?? donos.error;
  if (falhou) {
    return fail("internal_error", "Não consegui ler as Páginas da Meta agora.", 500, { requestId });
  }

  const empresas = (orgs.data ?? []) as Array<{ id: string; display_name: string }>;
  const nomeDaEmpresa = new Map(empresas.map((e) => [e.id, e.display_name]));
  const comConexao = new Set(
    ((conectadas.data ?? []) as Array<{ organization_id: string }>).map((c) => c.organization_id),
  );
  const donoDaPagina = new Map(
    ((donos.data ?? []) as LinhaDeDono[]).map((d) => [d.page_id, d]),
  );
  const empresaDaConexao =
    (conexao.data as { organizacao_da_conexao?: string | null } | null)?.organizacao_da_conexao ??
    null;

  const paginas: PaginaNoPainel[] = [];
  let erro: { falha: FalhaDeLeitura | "sem_conexao" | "cifra_indisponivel"; detalhe: string } | null =
    null;
  let permissoes: { verificadas: boolean; faltandoObrigatorias: string[]; faltandoRecomendadas: string[] } | null =
    null;

  if (empresaDaConexao) {
    const credencial = await lerCredencialDeLeitura(admin, empresaDaConexao, "meta_ads");
    if (!credencial.ok) {
      erro = { falha: credencial.motivo, detalhe: "" };
    } else {
      const token = credencial.credencial.accessToken;
      const [lidas, concedidas] = await Promise.all([listarPaginas(token), lerPermissoes(token)]);
      permissoes = concedidas.ok
        ? { verificadas: true, ...permissoesQueFaltam(concedidas.dados) }
        : { verificadas: false, faltandoObrigatorias: [], faltandoRecomendadas: [] };
      if (!lidas.ok) {
        erro = { falha: lidas.falha, detalhe: lidas.detalhe };
      } else {
        for (const p of lidas.dados) {
          const dono = donoDaPagina.get(p.id);
          paginas.push({
            id: p.id,
            nome: p.nome,
            organization_id: dono?.organization_id ?? null,
            organizacao: dono ? (nomeDaEmpresa.get(dono.organization_id) ?? null) : null,
            alcancada: true,
            origem: dono ? (dono.origem ?? "plataforma") : null,
          });
        }
      }
    }
  }

  // As Páginas com dono que a conexão não alcança (ou não foi lida) continuam
  // na lista: é daqui que se retira o dono de uma Página que saiu do token.
  const vistas = new Set(paginas.map((p) => p.id));
  for (const d of donoDaPagina.values()) {
    if (vistas.has(d.page_id)) continue;
    paginas.push({
      id: d.page_id,
      nome: d.page_name ?? d.page_id,
      organization_id: d.organization_id,
      organizacao: nomeDaEmpresa.get(d.organization_id) ?? null,
      alcancada: false,
      origem: d.origem ?? "plataforma",
    });
  }

  return ok(
    {
      conexao: {
        organizacao_da_conexao: empresaDaConexao,
        organizacao: empresaDaConexao ? (nomeDaEmpresa.get(empresaDaConexao) ?? null) : null,
      },
      empresas,
      empresas_com_conexao: empresas.filter((e) => comConexao.has(e.id)),
      paginas,
      permissoes,
      erro,
    },
    { requestId },
  );
}

export async function PUT(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const escrita = await exigirPlataformaParaEscrever(requestId);
  if (!escrita.ok) return escrita.resposta;
  const ctx = escrita.ctx;

  const parsed = conexaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Dados inválidos.", 422, { requestId });
  const escolhida = parsed.data.organizacao_da_conexao;

  const admin = createAdminClient();
  if (escolhida) {
    // Só uma empresa que TEM conexão de Meta Ads: apontar para quem não tem
    // deixaria todo cliente sem leitura, calado, até alguém abrir a tela.
    const { data: tem } = await admin
      .from("ad_insights_connections")
      .select("organization_id")
      .eq("organization_id", escolhida)
      .eq("platform", "meta_ads")
      .maybeSingle();
    if (!tem) {
      return fail(
        "validation_failed",
        "Essa empresa não tem conexão de Meta Ads. Conecte o token em Configurações › Meta Ads dela antes.",
        422,
        { requestId },
      );
    }
  }

  const { error } = await admin.from("mia_meta_conexao_da_plataforma").upsert(
    {
      id: 1,
      organizacao_da_conexao: escolhida,
      atualizado_em: new Date().toISOString(),
      atualizado_por: ctx.user.id,
    },
    { onConflict: "id" },
  );
  if (error) return fail("internal_error", "Não consegui salvar a conexão.", 500, { requestId });

  void audit({
    action: "platform.conexao_da_meta_escolhida",
    actorUserId: ctx.user.id,
    organizationId: null,
    requestId,
    metadata: { organizacao_da_conexao: escolhida },
  });

  return ok({ organizacao_da_conexao: escolhida }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const escrita = await exigirPlataformaParaEscrever(requestId);
  if (!escrita.ok) return escrita.resposta;
  const ctx = escrita.ctx;

  const parsed = atribuirSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Dados inválidos.", 422, { requestId });
  const { page_id, page_name, organization_id } = parsed.data;

  const admin = createAdminClient();
  const { data: empresa } = await admin
    .from("organizations")
    .select("id")
    .eq("id", organization_id)
    .is("redacted_at", null)
    .maybeSingle();
  if (!empresa) return fail("not_found", "Empresa não encontrada.", 404, { requestId });

  const { data: antes } = await admin
    .from("mia_paginas_da_meta")
    .select("organization_id, origem")
    .eq("page_id", page_id)
    .maybeSingle();
  const donoAnterior = (antes as { organization_id?: string } | null)?.organization_id ?? null;
  const origemAnterior = (antes as { origem?: string } | null)?.origem ?? null;

  const { error } = await admin.from("mia_paginas_da_meta").upsert(
    {
      page_id,
      organization_id,
      page_name: page_name ?? null,
      atribuida_em: new Date().toISOString(),
      atribuida_por: ctx.user.id,
      // .64: o que a plataforma grava é da plataforma, inclusive ao transferir
      // uma Página que a empresa tinha assumido (o gatilho da 9008 só deixa
      // trocar o dono com esta origem).
      origem: "plataforma",
    },
    { onConflict: "page_id" },
  );
  if (error) return fail("internal_error", "Não consegui atribuir a Página.", 500, { requestId });

  void audit({
    action: "platform.pagina_da_meta_atribuida",
    actorUserId: ctx.user.id,
    // A empresa é o alvo: a Página passou a ser dela.
    organizationId: organization_id,
    requestId,
    metadata: { page_id, dono_anterior: donoAnterior, origem_anterior: origemAnterior },
  });

  return ok({ page_id, organization_id, dono_anterior: donoAnterior }, { requestId });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const escrita = await exigirPlataformaParaEscrever(requestId);
  if (!escrita.ok) return escrita.resposta;
  const ctx = escrita.ctx;

  const pageId = idDaPagina.safeParse(req.nextUrl.searchParams.get("page_id"));
  if (!pageId.success) return fail("validation_failed", "Id de Página inválido.", 422, { requestId });

  const admin = createAdminClient();
  const { data: removidas, error } = await admin
    .from("mia_paginas_da_meta")
    .delete()
    .eq("page_id", pageId.data)
    .select("organization_id");
  if (error) return fail("internal_error", "Não consegui retirar o dono.", 500, { requestId });

  const dono = ((removidas ?? []) as Array<{ organization_id: string }>)[0]?.organization_id ?? null;
  if (dono) {
    void audit({
      action: "platform.pagina_da_meta_retirada",
      actorUserId: ctx.user.id,
      organizationId: dono,
      requestId,
      metadata: { page_id: pageId.data },
    });
  }

  return ok({ page_id: pageId.data, dono_anterior: dono }, { requestId });
}
