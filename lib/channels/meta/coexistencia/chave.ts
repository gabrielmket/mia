/**
 * FORK MIA · coexistência (S3): a CHAVE da empresa (migration 9164).
 *
 * Liga, por empresa, o botão "Conectar pelo app WhatsApp Business" da tela do
 * canal oficial. Sem linha = desligada, e é assim que toda empresa nasce.
 * Desligar NÃO derruba o número já conectado: só esconde o botão (a rota da
 * conexão recusa quem tentar pela chave desligada).
 *
 * Quem muda é o administrador de plataforma: a rota de /admin/meta
 * (`app/api/v1/admin/coexistencia`) e o MCP de plataforma
 * (`plataforma_ligar_coexistencia`) chamam `mudarChaveDaCoexistencia`, a mesma
 * escrita, para os dois caminhos não divergirem.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient;

export interface ChaveDaCoexistencia {
  ligada: boolean;
  mudadaPor: string | null;
  mudadaEm: string | null;
}

const DESLIGADA: ChaveDaCoexistencia = { ligada: false, mudadaPor: null, mudadaEm: null };

/** A chave da empresa. Sem linha = desligada. Lança se a leitura falhar (falha fechada fica com quem chama). */
export async function lerChaveDaCoexistencia(admin: Admin, organizationId: string): Promise<ChaveDaCoexistencia> {
  const { data, error } = await admin
    .from("mia_coexistencia_da_empresa")
    .select("ligada, mudada_por, mudada_em")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error(`chave_da_coexistencia: ${error.code ?? "sem_codigo"} ${error.message ?? ""}`.trim());
  if (!data) return DESLIGADA;
  const linha = data as { ligada: boolean; mudada_por: string | null; mudada_em: string | null };
  return { ligada: linha.ligada === true, mudadaPor: linha.mudada_por, mudadaEm: linha.mudada_em };
}

/** As chaves de várias empresas de uma vez (a tabela de /admin/meta). Sem linha = desligada. */
export async function chavesDaCoexistencia(
  admin: Admin,
  organizationIds: readonly string[],
): Promise<Map<string, ChaveDaCoexistencia>> {
  const mapa = new Map<string, ChaveDaCoexistencia>();
  if (organizationIds.length === 0) return mapa;
  const { data, error } = await admin
    .from("mia_coexistencia_da_empresa")
    .select("organization_id, ligada, mudada_por, mudada_em")
    .in("organization_id", [...organizationIds]);
  if (error) throw new Error(`chaves_da_coexistencia: ${error.code ?? "sem_codigo"} ${error.message ?? ""}`.trim());
  for (const linha of (data ?? []) as Array<{
    organization_id: string;
    ligada: boolean;
    mudada_por: string | null;
    mudada_em: string | null;
  }>) {
    mapa.set(linha.organization_id, {
      ligada: linha.ligada === true,
      mudadaPor: linha.mudada_por,
      mudadaEm: linha.mudada_em,
    });
  }
  return mapa;
}

export type MudancaDaChave =
  | { ok: true; jaEstava: boolean; chave: ChaveDaCoexistencia }
  | { ok: false; motivo: "falha"; detalhe: string };

/**
 * Liga ou desliga. Reexecução segura: pedir o estado que já vale devolve
 * `jaEstava: true` e não mexe em quem mudou nem quando (o registro de quem
 * ligou continua sendo o de quem ligou de fato).
 */
export async function mudarChaveDaCoexistencia(
  admin: Admin,
  input: { organizationId: string; ligada: boolean; userId: string | null },
): Promise<MudancaDaChave> {
  let atual: ChaveDaCoexistencia;
  try {
    atual = await lerChaveDaCoexistencia(admin, input.organizationId);
  } catch (err) {
    return { ok: false, motivo: "falha", detalhe: err instanceof Error ? err.message : String(err) };
  }
  if (atual.ligada === input.ligada) return { ok: true, jaEstava: true, chave: atual };

  const mudadaEm = new Date().toISOString();
  const { error } = await admin.from("mia_coexistencia_da_empresa").upsert(
    {
      organization_id: input.organizationId,
      ligada: input.ligada,
      mudada_por: input.userId,
      mudada_em: mudadaEm,
    },
    { onConflict: "organization_id" },
  );
  if (error) return { ok: false, motivo: "falha", detalhe: `${error.code ?? ""} ${error.message ?? ""}`.trim() };
  return { ok: true, jaEstava: false, chave: { ligada: input.ligada, mudadaPor: input.userId, mudadaEm } };
}
