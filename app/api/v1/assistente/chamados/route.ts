/**
 * FORK MIA (.88) — GET/POST /api/v1/assistente/chamados: o chamado para a Time
 * Company, aberto pelo assistente da MIA.
 *
 *   GET   os chamados da pessoa; o administrador da empresa recebe os da empresa
 *         inteira com `?todos=1` (a RLS da 9050 decide, não esta rota).
 *   POST  abre um chamado (Erro, Dúvida ou Pedido). JSON, ou `multipart/form-data`
 *         com o print em `print`. O contexto (tela, hora, versão, navegador e a
 *         mensagem do sistema) é montado AQUI, no servidor: a versão vem da
 *         imagem e o navegador do cabeçalho, nunca do que a tela diz.
 *
 * O chamado é gravado pela SESSÃO (RLS + `fn_mia_chamado_nasce`): quem abre é a
 * própria pessoa, nasce "novo", sem resposta, e a marca de demonstração vem da
 * empresa. Na empresa de demonstração ele fica no assistente e NÃO sai para a
 * Time: não aparece na lista do admin da plataforma e não vai recado ao grupo
 * interno (regra "Demonstração" do protótipo).
 *
 * O cliente de serviço entra só depois, fora de qualquer leitura de CRM: para
 * guardar o print no bucket privado e para o recado ao grupo interno da Time.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { navegadorLegivel, semDadoPessoal } from "@/lib/assistente/chamado";
import { guardarPrint, validarPrint } from "@/lib/assistente/print";
import { rotuloDaTela } from "@/lib/assistente/telas";
import { caminhoDaTela, ROTULO_DO_TIPO_DE_CHAMADO, TIPOS_DE_CHAMADO } from "@/lib/assistente/tipos";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { reportar } from "@/lib/avisos/report-da-plataforma";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { rotuloLocal } from "@/lib/tempo/agora";
import { fusoUtilizavel } from "@/lib/tempo/fusos";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, numero, tipo, texto, contexto, situacao, resposta, respondido_em, demonstracao, print_path, conversa_id, user_id, created_at, updated_at";

const pedidoSchema = z
  .object({
    tipo: z.enum(TIPOS_DE_CHAMADO),
    texto: z.string().trim().min(3).max(4000),
    mensagem_do_sistema: z.string().trim().max(300).nullish(),
    tela: z.string().max(400).nullish(),
    conversa_id: z.string().uuid().nullish(),
  })
  .strict();

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "mia_chamados" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const todos = new URL(req.url).searchParams.get("todos") === "1" && roleAtLeast(authz.org.role, "admin");

  const db = await createClient();
  let consulta = db
    .from("mia_chamados")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (!todos) consulta = consulta.eq("user_id", authz.user.id);
  const { data, error } = await consulta;
  if (error) return fail("unavailable", t("Não deu para ler os chamados agora."), 503, { requestId });
  // O caminho do print não sai: a tela pede o link assinado pela rota do print.
  const chamados = ((data ?? []) as Array<Record<string, unknown>>).map(({ print_path, ...resto }) => ({
    ...resto,
    tem_print: typeof print_path === "string" && print_path.length > 0,
  }));
  return ok({ chamados }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "mia_chamados" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  // ── o pedido: JSON ou formulário com o print ──
  const tipoDoCorpo = req.headers.get("content-type") ?? "";
  let campos: Record<string, unknown> = {};
  let print: File | null = null;
  try {
    if (tipoDoCorpo.includes("multipart/form-data")) {
      const tamanho = Number(req.headers.get("content-length") ?? "0");
      if (tamanho > 11 * 1024 * 1024) {
        return fail("payload_too_large", t("O print passa de 10 MB."), 413, { requestId });
      }
      const form = await req.formData();
      for (const chave of ["tipo", "texto", "mensagem_do_sistema", "tela", "conversa_id"]) {
        const v = form.get(chave);
        if (typeof v === "string" && v.length > 0) campos[chave] = v;
      }
      const arquivo = form.get("print");
      if (arquivo && typeof arquivo !== "string") print = arquivo;
    } else {
      campos = (await req.json()) as Record<string, unknown>;
    }
  } catch {
    return fail("invalid_request", t("Body inválido."), 400, { requestId });
  }
  const parsed = pedidoSchema.safeParse(campos);
  if (!parsed.success) {
    return fail("validation_failed", t("Chamado inválido."), 422, { requestId, details: parsed.error.flatten() });
  }
  let printLido: { conteudo: Buffer; mime: string; ext: string } | null = null;
  if (print) {
    const checagem = validarPrint(print.type, print.size);
    if (!checagem.ok) return fail("validation_failed", t(checagem.motivo), 422, { requestId });
    printLido = { conteudo: Buffer.from(await print.arrayBuffer()), mime: print.type, ext: checagem.ext };
  }

  const db = await createClient();
  const { data: orgRow } = await db.from("organizations").select("timezone, display_name").eq("id", orgId).maybeSingle();
  const empresa = orgRow as { timezone?: string | null; display_name?: string | null } | null;
  const agora = new Date();
  const caminho = caminhoDaTela(parsed.data.tela) ?? null;
  const contexto = {
    tela: caminho ? { caminho, rotulo: rotuloDaTela(caminho) } : null,
    hora: agora.toISOString(),
    hora_local: rotuloLocal(agora, fusoUtilizavel(empresa?.timezone)),
    versao: process.env.APP_VERSION || "desconhecida",
    navegador: navegadorLegivel(req.headers.get("user-agent")),
    mensagem_do_sistema: parsed.data.mensagem_do_sistema ? semDadoPessoal(parsed.data.mensagem_do_sistema) : null,
    papel: authz.org.role,
    tem_print: printLido !== null,
  };

  const { data: criado, error } = await db
    .from("mia_chamados")
    .insert({
      organization_id: orgId,
      tipo: parsed.data.tipo,
      texto: parsed.data.texto,
      contexto,
      conversa_id: parsed.data.conversa_id ?? null,
    })
    .select(COLUNAS)
    .single();
  if (error || !criado) {
    logger.warn("[assistente] o chamado não foi gravado", { requestId, organizationId: orgId, erro: error?.message });
    return fail("unavailable", t("Não deu para abrir o chamado agora."), 503, { requestId });
  }
  const chamado = criado as { id: string; numero: number; demonstracao: boolean };

  // ── o print, no bucket privado ──
  let printGuardado = false;
  if (printLido) {
    try {
      const admin = createAdminClient();
      const path = await guardarPrint(admin, { organizationId: orgId, chamadoId: chamado.id, ...printLido });
      const { error: erroPrint } = await admin
        .from("mia_chamados")
        .update({ print_path: path, updated_at: new Date().toISOString() })
        .eq("organization_id", orgId)
        .eq("id", chamado.id);
      printGuardado = !erroPrint;
    } catch (erro) {
      logger.warn("[assistente] o print do chamado não foi guardado", {
        requestId,
        organizationId: orgId,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }

  // ── o recado ao grupo interno da Time (nunca da demonstração) ──
  if (!chamado.demonstracao) {
    void reportar(createAdminClient(), {
      chave: `assistente_chamado:${chamado.numero}`,
      horas: 24 * 365,
      texto:
        `*Chamado #${chamado.numero}* · ${ROTULO_DO_TIPO_DE_CHAMADO[parsed.data.tipo]}\n` +
        `${empresa?.display_name ?? authz.org.name ?? "Empresa"}\n` +
        "Aberto pelo assistente da MIA. Responda em Admin › Chamados.",
      detalhe: { chamado: chamado.numero, organizacao: orgId },
    });
  }

  void audit({
    action: "assistente.chamado_aberto",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "mia_chamados",
    resourceId: chamado.id,
    requestId,
    metadata: {
      numero: chamado.numero,
      tipo: parsed.data.tipo,
      demonstracao: chamado.demonstracao,
      print: printGuardado,
    },
  });

  return ok(
    {
      chamado: { ...criado, print_path: undefined, tem_print: printGuardado },
      demonstracao: chamado.demonstracao,
      aviso: chamado.demonstracao
        ? t("Esta é a empresa de demonstração: o chamado fica registrado aqui, mas não sai para a Time Company.")
        : null,
    },
    { requestId },
  );
}
