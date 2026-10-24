/**
 * FORK MIA (.88) — QUEM É QUEM NA EQUIPE, para o assistente dizer "quem pode"
 * pelo nome e "o Diego tem 6 das 9 tarefas atrasadas".
 *
 * ── Por que mora FORA do turno ──────────────────────────────────────────────
 *
 * O nome de quem é da equipe não é legível pela sessão de um atendente: a RLS
 * de `user_organizations` só mostra a ele o próprio vínculo, e o nome mora no
 * GoTrue. O produto inteiro resolve isso do mesmo jeito, com o cliente de
 * serviço e a organização de fonte confiável: `/api/v1/team/assignable` (a
 * lista que qualquer atendente já recebe para passar uma conversa) e
 * `nomesDosAtendentes`. Este diretório entrega EXATAMENTE aquilo: nome e papel,
 * nunca e-mail nem telefone.
 *
 * A rota monta o diretório ANTES do turno e o passa pronto. Dentro do turno o
 * cliente de serviço continua proibido (`turno.ts`): o diretório não é leitura
 * de dado do CRM, é a mesma lista de nomes que a tela já mostra.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";
import type { Role } from "@/lib/auth/types";

import type { PessoaDaEquipe } from "./leituras/comum";

const CACHE_EM_MS = 120_000;
const cache = new Map<string, { quando: number; equipe: PessoaDaEquipe[] }>();

const PAPEIS_DE_GENTE = new Set(["viewer", "agent", "manager", "admin"]);

export async function diretorioDaEquipe(organizationId: string, agora = Date.now()): Promise<PessoaDaEquipe[]> {
  const guardado = cache.get(organizationId);
  if (guardado && agora - guardado.quando < CACHE_EM_MS) return guardado.equipe;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_organizations")
    .select("user_id, role")
    .eq("organization_id", organizationId)
    .is("revoked_at", null)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return guardado?.equipe ?? [];

  const vinculos = ((data ?? []) as Array<{ user_id: string; role: string }>).filter((v) => PAPEIS_DE_GENTE.has(v.role));
  const nomes = await nomesDosAtendentes(vinculos.map((v) => v.user_id));
  const equipe = vinculos.map((v) => ({
    user_id: v.user_id,
    nome: (nomes.get(v.user_id) ?? "").trim() || "Pessoa sem nome",
    papel: v.role as Role,
  }));
  cache.set(organizationId, { quando: agora, equipe });
  return equipe;
}
