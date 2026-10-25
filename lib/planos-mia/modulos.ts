/**
 * FORK MIA (.90) — O MÓDULO QUE VEM PELO PLANO.
 *
 * Duas origens para um módulo vendável numa empresa:
 *   - "pela Time": a liberação à mão em `organization_modules` (0245), que
 *     continua como sempre e não sai com troca de plano;
 *   - "pelo plano": `mia_plano_modulos` do plano ATUAL da assinatura, perguntado
 *     ao banco na hora (`fn_mia_modulos_do_plano`, 9070). Não há cópia para
 *     envelhecer: o upstream só troca `plano_id` quando a troca vale (no teste
 *     na hora; subindo quando a diferença é paga; descendo na renovação), e o
 *     módulo segue sozinho.
 *
 * A pergunta devolve vazio com a cobrança desligada e para a empresa isenta
 * (sem assinatura) — é o que garante que, desligada, nada muda para ninguém.
 *
 * ⚠️ FALHA DE LEITURA = NENHUM MÓDULO PELO PLANO (o mesmo contrato de
 * `lib/modulos/liberacao.ts`): liberar por engano um módulo que cobra por
 * mensagem é dinheiro saindo; recusar se vê e se conserta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { ehModuloDoPlano, MODULOS_DO_PLANO, type ModuloDoPlano } from "./catalogo";

/**
 * Os módulos que o plano da empresa liga agora. Aceita o cliente da sessão (a
 * função confere que a empresa é de quem pergunta) ou o de serviço. NUNCA LANÇA.
 */
export async function modulosPeloPlano(
  db: SupabaseClient,
  orgId: string,
): Promise<ModuloDoPlano[]> {
  try {
    if (typeof (db as { rpc?: unknown }).rpc !== "function") return [];
    const { data, error } = await db.rpc("fn_mia_modulos_do_plano", { p_org: orgId });
    if (error) {
      logger.warn("planos-mia: módulos do plano ilegíveis — nenhum pelo plano", {
        organization_id: orgId,
        codigo: error.code ?? null,
      });
      return [];
    }
    return Array.isArray(data)
      ? (data as unknown[]).filter(
          (m): m is ModuloDoPlano => typeof m === "string" && ehModuloDoPlano(m),
        )
      : [];
  } catch (erro) {
    logger.warn("planos-mia: módulos do plano falharam — nenhum pelo plano", {
      organization_id: orgId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return [];
  }
}

export interface OrigemDoModulo {
  modulo: ModuloDoPlano;
  pelo_plano: boolean;
  pela_time: boolean;
}

/**
 * Cada módulo vendável com a origem dele nesta empresa (só os ligados). Para as
 * telas da Time e o MCP. LANÇA se a liberação à mão não puder ser lida: quem lê
 * isto vai decidir (liberar, trocar plano) e não pode decidir sobre um "nenhum"
 * que ninguém leu.
 */
export async function origemDosModulos(
  admin: SupabaseClient,
  orgId: string,
): Promise<OrigemDoModulo[]> {
  const [pelaTime, peloPlano] = await Promise.all([
    admin
      .from("organization_modules")
      .select("modulo")
      .eq("organization_id", orgId)
      .is("revoked_at", null),
    modulosPeloPlano(admin, orgId),
  ]);
  if (pelaTime.error)
    throw new Error(`módulos liberados: leitura falhou (${pelaTime.error.code ?? "sem_codigo"})`);
  const aMao = new Set(((pelaTime.data ?? []) as Array<{ modulo: string }>).map((l) => l.modulo));
  const doPlano = new Set<string>(peloPlano);
  return MODULOS_DO_PLANO.filter((m) => aMao.has(m) || doPlano.has(m)).map((m) => ({
    modulo: m,
    pelo_plano: doPlano.has(m),
    pela_time: aMao.has(m),
  }));
}

/** "pelo plano", "pela Time" ou os dois (a chave de `t()` da tela). */
export function rotuloDaOrigem(o: Pick<OrigemDoModulo, "pelo_plano" | "pela_time">): string {
  if (o.pelo_plano && o.pela_time) return "pelo plano e pela Time";
  return o.pelo_plano ? "pelo plano" : "pela Time";
}

/**
 * Vendas B2B (`crm_b2b`) é módulo DA INSTALAÇÃO no upstream: ligado, vale para
 * todas as empresas. Com a cobrança ligada, a empresa que TEM plano só o vê se o
 * plano o liga ou se a Time o liberou à mão. A isenta segue como hoje (a
 * instalação decide), e com a cobrança desligada esta função diz sempre `false`.
 *
 * `true` = a empresa está num plano que não tem Vendas B2B: menu escondido, tela
 * "não contratado", rota recusada. Leitura que falha com a cobrança ligada
 * RECUSA (o mesmo contrato do módulo vendável).
 */
export async function crmB2bForaDoPlano(
  admin: SupabaseClient,
  orgId: string,
  cobrancaLigada: boolean,
): Promise<boolean> {
  if (!cobrancaLigada) return false;
  try {
    const { data: assinatura, error } = await admin
      .from("cobranca_assinaturas")
      .select("organization_id")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (error) return true;
    if (!assinatura) return false;
    if ((await modulosPeloPlano(admin, orgId)).includes("crm_b2b")) return false;
    const { data: aMao, error: erroDaMao } = await admin
      .from("organization_modules")
      .select("id")
      .eq("organization_id", orgId)
      .eq("modulo", "crm_b2b")
      .is("revoked_at", null)
      .maybeSingle();
    if (erroDaMao) return true;
    return !aMao;
  } catch {
    return true;
  }
}

/**
 * A lista dos módulos da INSTALAÇÃO que o menu desta empresa enxerga: a mesma da
 * instalação, menos `crm_b2b` quando o plano da empresa não o tem. Pura.
 */
export function ligadosNaInstalacaoParaAEmpresa<T extends string>(
  ligados: readonly T[],
  crmB2bFora: boolean,
): T[] {
  return crmB2bFora ? ligados.filter((m) => m !== "crm_b2b") : [...ligados];
}
