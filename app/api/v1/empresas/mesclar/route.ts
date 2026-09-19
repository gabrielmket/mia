/**
 * POST /api/v1/empresas/mesclar — junta duas fichas da MESMA empresa.
 *
 * A regra inteira mora em `fn_mesclar_empresas` (migration 0263), e de
 * propósito: a fusão trava as duas pontas, reponta toda FK derivada de
 * `pg_constraint` e escreve a lápide na MESMA transação. Aqui em TypeScript,
 * com um `update` por tabela, cada timeout deixaria fusão pela metade — e fusão
 * não tem desfazer.
 *
 * Esta rota é a porta: autoriza, valida, chama, audita.
 *
 * O cliente é o do USUÁRIO (cookie), não o admin: assim `auth.uid()` chega à
 * função e ela reconfere o papel na organização. Trocar por service role
 * apagaria a segunda checagem — e a primeira passaria a ser a única.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({
  /** A ficha que FICA. Os dados dela nunca são sobrescritos. */
  vencedora: z.string().uuid(),
  /** A que vira lápide. */
  perdedora: z.string().uuid(),
});

/**
 * O que a função levanta ↔ o que o operador precisa ler.
 *
 * Sem este mapa, todo desfecho previsto viraria 500 — e um 500 diz "o sistema
 * quebrou" quando o que houve foi "essa escolha não serve".
 */
const FRASES: Record<string, { status: number; frase: string }> = {
  insufficient_role: {
    status: 403,
    frase: "Juntar empresas é ação de gestor.",
  },
  selecao_de_mesclagem_invalida: {
    status: 422,
    frase: "Escolha duas empresas diferentes.",
  },
  empresa_nao_encontrada: {
    status: 404,
    frase: "Uma das empresas não existe nesta conta.",
  },
  empresa_ja_mesclada: {
    status: 409,
    frase: "Essa empresa já foi juntada a outra antes.",
  },
};

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  // `manager`, o mesmo piso da fusão de contatos: é destrutivo na prática.
  const authz = await requireRole("manager", { requestId, resource: "empresas" });
  if (!authz.ok) return authz.response;

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Escolha inválida.", 422, { requestId });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_mesclar_empresas", {
    p_organization_id: authz.org.orgId,
    p_vencedora: parsed.data.vencedora,
    p_perdedora: parsed.data.perdedora,
  });

  if (error) {
    const conhecido = Object.entries(FRASES).find(([chave]) => error.message.includes(chave));
    if (conhecido) {
      const [, { status, frase }] = conhecido;
      return fail("invalid_request", frase, status, { requestId });
    }
    return fail("db_error", error.message, 500, { requestId });
  }

  void audit({
    action: "empresas.mescladas",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    // `repontado` diz QUANTAS linhas mudaram de dono em cada tabela. É o que
    // responde "o que essa fusão mexeu" meses depois, sem reconstituir nada.
    metadata: { ...parsed.data, resultado: data },
  });

  return ok(data, { requestId });
}
