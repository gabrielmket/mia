/**
 * FORK MIA (.94) · o contexto das rotas das propostas do assistente
 * (`/api/v1/assistente/propostas/**`): a SESSÃO de quem clicou (com ela a peça
 * nasce e sai, pela função da tela), o cliente de serviço (só a linha da
 * proposta, que a sessão não escreve, e as contagens das travas), a equipe, o
 * fuso e a configuração da empresa.
 *
 * A empresa e o papel vêm de `requireRole` (a sessão), nunca do corpo.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { RoleCheck } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fusoUtilizavel } from "@/lib/tempo/fusos";

import { lerConfigDoAssistente } from "../config";
import { diretorioDaEquipe } from "../diretorio";
import type { PessoaDaEquipe } from "../leituras/comum";
import type { Role } from "@/lib/auth/types";

export interface ContextoDaRotaDasPropostas {
  db: SupabaseClient;
  admin: SupabaseClient;
  orgId: string;
  userId: string;
  nome: string | null;
  papel: Role;
  idioma: string;
  equipe: PessoaDaEquipe[];
  fuso: string;
  podePedir: boolean;
}

export async function contextoDaRotaDasPropostas(authz: Extract<RoleCheck, { ok: true }>): Promise<ContextoDaRotaDasPropostas> {
  const db = (await createClient()) as unknown as SupabaseClient;
  const [equipe, config, empresa] = await Promise.all([
    diretorioDaEquipe(authz.org.orgId),
    lerConfigDoAssistente(db, authz.org.orgId),
    db.from("organizations").select("timezone").eq("id", authz.org.orgId).maybeSingle(),
  ]);
  return {
    db,
    admin: createAdminClient(),
    orgId: authz.org.orgId,
    userId: authz.user.id,
    nome: (authz.user.full_name ?? "").trim() || null,
    papel: authz.org.role as Role,
    idioma: authz.user.idioma,
    equipe,
    fuso: fusoUtilizavel((empresa.data as { timezone?: string | null } | null)?.timezone),
    podePedir: config.podePedir,
  };
}
