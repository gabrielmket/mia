/**
 * FORK MIA — /api/v1/leads-da-meta: o estado da importação dos leads da Meta de
 * UMA empresa (GET) e a chave dela (PATCH). docs/fork/leads-da-meta.md.
 *
 * GET é de gerente para cima: é a tela que diz se os leads estão chegando, com a
 * última leitura de cada formulário e o histórico. PATCH é de admin: ligar a
 * importação cria negócios no funil e dispara automações.
 *
 * A organização é SEMPRE a ativa da sessão (`requireRole`), nunca do corpo. A
 * leitura vai pelo client de SESSÃO, e a RLS da 9003 já recorta pela empresa e
 * pelo papel; a escrita vai pelo admin client (ninguém da sessão escreve nessas
 * tabelas), com a empresa da sessão no filtro.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { leadsDaMetaLiberados } from "@/lib/leads-da-meta/liberacao";
import { existeConexaoDeLeitura } from "@/lib/plataformas-de-anuncio/credenciais-de-leitura";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const RECURSO = "leads_da_meta";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: RECURSO });
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

  const db = await createClient();
  const [config, formularios, leituras, conexao] = await Promise.all([
    db
      .from("mia_leads_da_meta_config")
      .select("ativo, dias_de_recuperacao, ativado_em, atualizado_em")
      .eq("organization_id", org)
      .maybeSingle(),
    db
      .from("mia_leads_da_meta_formularios")
      .select(
        "id, page_id, page_name, form_id, form_name, pipeline_id, stage_id, ativo, lido_ate, ultima_leitura_em, ultimo_status, ultimo_motivo, ultimo_detalhe, importados_total",
      )
      .eq("organization_id", org)
      .order("criado_em", { ascending: true }),
    db
      .from("mia_leads_da_meta_leituras")
      .select(
        "id, formulario_id, iniciada_em, terminada_em, status, novos, repetidos, recusados, motivo, detalhe, janela_de, janela_ate, repeticoes",
      )
      .eq("organization_id", org)
      .order("terminada_em", { ascending: false })
      .limit(50),
    existeConexaoDeLeitura(admin, org, "meta_ads"),
  ]);

  const falhou = config.error ?? formularios.error ?? leituras.error;
  if (falhou) {
    return fail("internal_error", "Não consegui ler a configuração dos formulários da Meta.", 500, {
      requestId,
    });
  }

  return ok(
    {
      config: config.data ?? {
        ativo: false,
        dias_de_recuperacao: 7,
        ativado_em: null,
        atualizado_em: null,
      },
      conectada: conexao.conectada,
      formularios: formularios.data ?? [],
      leituras: leituras.data ?? [],
    },
    { requestId },
  );
}

const configSchema = z
  .object({
    ativo: z.boolean().optional(),
    dias_de_recuperacao: z.number().int().min(0).max(90).optional(),
  })
  .strict()
  .refine((v) => v.ativo !== undefined || v.dias_de_recuperacao !== undefined, {
    message: "Nada para mudar.",
  });

export async function PATCH(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: RECURSO });
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
  const parsed = configSchema.safeParse(corpo);
  if (!parsed.success) {
    return fail("validation_failed", "Configuração inválida.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const { data: atual } = await admin
    .from("mia_leads_da_meta_config")
    .select("ativo, dias_de_recuperacao, ativado_em")
    .eq("organization_id", org)
    .maybeSingle();

  const ativo = parsed.data.ativo ?? (atual?.ativo as boolean | undefined) ?? false;
  const agora = new Date().toISOString();
  const linha = {
    organization_id: org,
    ativo,
    dias_de_recuperacao:
      parsed.data.dias_de_recuperacao ?? (atual?.dias_de_recuperacao as number | undefined) ?? 7,
    // Quando foi ligada pela última vez: é a data que a tela mostra ao lado da chave.
    ativado_em:
      ativo && !atual?.ativo ? agora : ((atual?.ativado_em as string | null | undefined) ?? null),
    atualizado_em: agora,
    atualizado_por: authz.user.id,
  };

  const { error } = await admin
    .from("mia_leads_da_meta_config")
    .upsert(linha, { onConflict: "organization_id" });
  if (error) {
    return fail("internal_error", "Não consegui salvar a configuração.", 500, { requestId });
  }

  void audit({
    action: "leads_da_meta.configurado",
    actorUserId: authz.user.id,
    organizationId: org,
    requestId,
    metadata: {
      ativo: linha.ativo,
      dias_de_recuperacao: linha.dias_de_recuperacao,
      antes: atual ? { ativo: atual.ativo, dias_de_recuperacao: atual.dias_de_recuperacao } : null,
    },
  });

  return ok(linha, { requestId });
}
