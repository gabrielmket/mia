/**
 * FORK MIA — PUT /api/v1/leads-da-meta/formularios: escolher um formulário da
 * Meta para importar (ou mudar o destino dele, ou pausá-lo).
 *
 * Admin. Uma linha por formulário e empresa (índice único da 9003): salvar de
 * novo o mesmo formulário ATUALIZA, e a marca de leitura fica onde estava —
 * mudar o funil não pode fazer a importação recomeçar do zero e duplicar nada.
 *
 * Funil e etapa são conferidos contra a EMPRESA da sessão, e a etapa contra o
 * funil: um id de outra empresa vindo no corpo seria um negócio criado no funil
 * do vizinho pela rotina, que usa o service role.
 *
 * .61 — A PÁGINA TAMBÉM (migration 9004). Três camadas, da mais barata à mais
 * forte:
 *
 *   1. a Página do corpo tem de estar atribuída a esta empresa pela plataforma;
 *   2. ligado, o formulário é conferido NA META: ele tem de estar entre os
 *      formulários daquela Página. Sem isto, um id de formulário de outra
 *      Página, colado no corpo ao lado de uma Página nossa, passaria. Nome,
 *      perguntas e nome da Página passam a vir da Meta, e não do corpo;
 *   3. o gatilho do banco recusa formulário ativo de Página alheia (42501),
 *      venha o pedido de onde vier.
 *
 * Desligar um formulário que já existe é sempre permitido: é como a empresa
 * limpa o que ficou de uma Página que deixou de ser dela.
 *
 * .62 — três coisas a mais:
 *
 *   · a escolha de QUAL pergunta é o telefone, o nome e o e-mail
 *     (`campo_telefone`/`campo_nome`/`campo_email`), para quando o automático
 *     errar. Só vale chave que existe no formulário (ou um campo padrão da Meta);
 *   · ligado, a Página é ASSINADA no app para o aviso em tempo real. A recusa
 *     não impede salvar: o formulário fica ligado pela leitura a cada 5 minutos,
 *     e o motivo volta na resposta e fica gravado para a tela dizer o que falta;
 *   · desligado (ou religado), o aviso de falha dele fecha e o contador zera.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { ligarTempoReal, type ColunasDoTempoReal } from "@/lib/leads-da-meta/assinatura";
import { fecharAvisos, SEM_AVISO_DE_FALHA } from "@/lib/leads-da-meta/aviso-de-falha";
import { CAMPOS_PADRAO, PAPEIS_DO_CAMPO } from "@/lib/leads-da-meta/campos-do-formulario";
import { leadsDaMetaLiberados } from "@/lib/leads-da-meta/liberacao";
import { acessoAsPaginas, paginasDaEmpresa } from "@/lib/leads-da-meta/paginas";
import { listarFormularios } from "@/lib/plataformas-de-anuncio/meta/leads";
import { createAdminClient } from "@/lib/supabase/admin";

import { respostaSemConexao } from "../../ads/meta/_falha";

export const dynamic = "force-dynamic";

const idDaMeta = z.string().regex(/^\d{1,30}$/, "Id da Meta inválido.");

const formularioSchema = z
  .object({
    page_id: idDaMeta,
    page_name: z.string().max(300).nullable().optional(),
    form_id: idDaMeta,
    form_name: z.string().max(300).nullable().optional(),
    perguntas: z.record(z.string().max(200), z.string().max(500)).optional(),
    pipeline_id: z.string().uuid(),
    stage_id: z.string().uuid(),
    ativo: z.boolean(),
    // .62: a chave da pergunta; nulo = automático; ausente = não muda.
    campo_telefone: z.string().max(200).nullable().optional(),
    campo_nome: z.string().max(200).nullable().optional(),
    campo_email: z.string().max(200).nullable().optional(),
  })
  .strict();

const COLUNA_DO_PAPEL = {
  telefone: "campo_telefone",
  nome: "campo_nome",
  email: "campo_email",
} as const;

const PAGINA_DE_OUTRA_EMPRESA =
  "Esta Página da Meta não é desta empresa. Quem administra a plataforma define de qual empresa é cada Página.";

export async function PUT(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "leads_da_meta" });
  if (!authz.ok) return authz.response;
  const org = authz.org.orgId;

  const admin = createAdminClient();
  if (!(await leadsDaMetaLiberados(admin, org))) {
    return fail(
      "forbidden",
      "A importação dos leads da Meta não está contratada para esta empresa.",
      403,
      {
        requestId,
      },
    );
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return fail("validation_failed", "Corpo inválido.", 422, { requestId });
  }
  const parsed = formularioSchema.safeParse(corpo);
  if (!parsed.success) {
    return fail("validation_failed", "Formulário inválido.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const f = parsed.data;

  const { data: etapa } = await admin
    .from("crm_stages")
    .select("id, pipeline_id")
    .eq("organization_id", org)
    .eq("id", f.stage_id)
    .maybeSingle();
  if (!etapa || etapa.pipeline_id !== f.pipeline_id) {
    return fail("validation_failed", "Essa etapa não pertence a um funil desta empresa.", 422, {
      requestId,
    });
  }

  // ── a Página é desta empresa? (camada 1) ─────────────────────────────────
  let atribuidas;
  try {
    atribuidas = await paginasDaEmpresa(admin, org);
  } catch {
    return fail("internal_error", "Não consegui ler as Páginas desta empresa.", 500, { requestId });
  }
  const pagina = atribuidas.find((p) => p.page_id === f.page_id) ?? null;

  const { data: existente } = await admin
    .from("mia_leads_da_meta_formularios")
    .select("id, page_id, ativo, perguntas")
    .eq("organization_id", org)
    .eq("form_id", f.form_id)
    .maybeSingle();
  const soDesligando = !f.ativo && Boolean(existente);
  if (!pagina && !soDesligando) {
    return fail("forbidden", PAGINA_DE_OUTRA_EMPRESA, 403, { requestId });
  }

  // ── ligado: o formulário é daquela Página, NA META (camada 2) ────────────
  let pageName = f.page_name ?? null;
  let formName = f.form_name ?? null;
  let perguntas = f.perguntas ?? {};
  /** O token da Página conferida na Meta: é com ele que a Página é assinada no app. */
  let paginaNaMeta: { id: string; token: string } | null = null;
  if (f.ativo && pagina) {
    const acesso = await acessoAsPaginas(admin, org, [pagina]);
    if (!acesso.ok) {
      if (acesso.motivo === "sem_conexao" || acesso.motivo === "cifra_indisponivel") {
        return respostaSemConexao(acesso.motivo, { requestId });
      }
      return fail(
        "validation_failed",
        "Não consegui confirmar na Meta que este formulário é desta Página. Tente de novo em instantes.",
        422,
        { requestId },
      );
    }
    const alcancada = acesso.paginas.get(pagina.page_id);
    if (!alcancada?.tokenDaPagina) {
      return fail(
        "validation_failed",
        "O token não alcança esta Página na Meta. Ela precisa estar atribuída ao usuário do sistema no Gerenciador de Negócios.",
        422,
        { requestId },
      );
    }
    const forms = await listarFormularios(alcancada.tokenDaPagina, alcancada.id);
    if (!forms.ok) {
      return fail(
        "validation_failed",
        "Não consegui confirmar na Meta que este formulário é desta Página. Tente de novo em instantes.",
        422,
        { requestId },
      );
    }
    const daMeta = forms.dados.find((x) => x.id === f.form_id);
    if (!daMeta) {
      return fail("validation_failed", "Este formulário não pertence a esta Página na Meta.", 422, {
        requestId,
      });
    }
    pageName = alcancada.nome;
    formName = daMeta.nome;
    perguntas = daMeta.perguntas;
    paginaNaMeta = { id: alcancada.id, token: alcancada.tokenDaPagina };
  }

  // .62: a pergunta escolhida para cada papel tem de existir no formulário. As
  // perguntas são as da Meta quando ligado; desligando, as que já estavam.
  const perguntasValidas = new Set([
    ...Object.keys(
      f.ativo && pagina
        ? perguntas
        : ((existente?.perguntas as Record<string, string> | null) ?? perguntas),
    ),
    ...PAPEIS_DO_CAMPO.flatMap((papel) => CAMPOS_PADRAO[papel]),
  ]);
  const campos: Record<string, string | null> = {};
  for (const papel of PAPEIS_DO_CAMPO) {
    const coluna = COLUNA_DO_PAPEL[papel];
    const valor = f[coluna];
    if (valor === undefined) continue;
    if (valor !== null && !perguntasValidas.has(valor)) {
      return fail("validation_failed", "Essa pergunta não existe neste formulário.", 422, {
        requestId,
      });
    }
    campos[coluna] = valor;
  }

  // .62: a Página assinada no app, para a Meta avisar na hora. Só depois de tudo
  // validado, porque é uma escrita na Meta. Recusa não impede salvar: vira o
  // motivo que a tela mostra.
  const tempoReal: ColunasDoTempoReal | null = paginaNaMeta
    ? await ligarTempoReal(paginaNaMeta.token, paginaNaMeta.id, new Date())
    : null;

  // Desligado, ou religado depois de desligado: o aviso de falha fecha e o
  // contador zera. Salvar de novo o formulário que segue ligado não mexe: o
  // problema continua o mesmo e já foi avisado.
  const ligou = f.ativo && !(existente?.ativo as boolean | undefined);
  const zeraAviso = !f.ativo || ligou;

  const agora = new Date().toISOString();
  const { data: salvo, error } = await admin
    .from("mia_leads_da_meta_formularios")
    .upsert(
      {
        organization_id: org,
        // Desligando o que ficou de uma Página que não é mais da empresa: a
        // linha fica na Página em que estava, sem mudar de lugar pelo corpo.
        page_id: pagina ? f.page_id : ((existente?.page_id as string | undefined) ?? f.page_id),
        page_name: pageName,
        form_id: f.form_id,
        form_name: formName,
        perguntas,
        pipeline_id: f.pipeline_id,
        stage_id: f.stage_id,
        ativo: f.ativo,
        atualizado_em: agora,
        atualizado_por: authz.user.id,
        ...campos,
        ...(tempoReal ?? {}),
        ...(zeraAviso ? SEM_AVISO_DE_FALHA : {}),
      },
      { onConflict: "organization_id,form_id" },
    )
    .select(
      "id, form_id, ativo, pipeline_id, stage_id, lido_ate, campo_telefone, campo_nome, campo_email, tempo_real, tempo_real_motivo, tempo_real_em",
    )
    .maybeSingle();
  if (error?.code === "42501") {
    // A camada 3 falou: a Página mudou de dono entre a leitura e a gravação.
    return fail("forbidden", PAGINA_DE_OUTRA_EMPRESA, 403, { requestId });
  }
  if (error || !salvo) {
    return fail("internal_error", "Não consegui salvar o formulário.", 500, { requestId });
  }
  if (zeraAviso) await fecharAvisos(admin, org, [salvo.id as string]);

  void audit({
    action: "leads_da_meta.formulario_salvo",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "mia_leads_da_meta_formularios",
    resourceId: salvo.id as string,
    requestId,
    metadata: {
      form_id: f.form_id,
      page_id: f.page_id,
      pipeline_id: f.pipeline_id,
      stage_id: f.stage_id,
      ativo: f.ativo,
      ...campos,
      tempo_real: tempoReal?.tempo_real ?? null,
      tempo_real_motivo: tempoReal?.tempo_real_motivo ?? null,
    },
  });

  return ok(salvo, { requestId });
}
