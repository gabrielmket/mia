/**
 * FORK MIA (.91, ligado à .90) — OS PRIMEIROS PASSOS VISTOS PELA TIME.
 *
 * A tela da Time (Admin › Empresas do cadastro), o MCP da cobrança
 * (`plataforma_listar_assinaturas`, `plataforma_ver_assinatura`) e os recados no
 * zap leem daqui o que a empresa nova ainda não fez, pela MESMA fonte do bloco
 * "O que falta" do cliente: o checklist do MCP no rótulo do cliente
 * (`lerOQueFalta`, `rotuloDoCliente`). Não há uma terceira régua.
 *
 *   - na LISTA, o retrato mais novo de cada empresa (`mia_assistente_retratos`,
 *     9081): é a rodada que o próprio cliente viu, sem rodar o checklist de
 *     quinhentas empresas a cada abertura da tela. Sem retrato (a empresa que
 *     nunca abriu o bloco, a implantada pela Time) = `null`, e a tela fica com
 *     os passos do `/onboarding` do upstream;
 *   - no DETALHE de uma empresa, a conta de AGORA, com o papel de quem
 *     administra (o mesmo rótulo do Início);
 *   - as empresas que entraram com o Facebook no passo do telefone e esperam a
 *     Time ligar o número (`whatsapp.status = "esperando_a_time"`, a área
 *     `primeiros_passos` do checklist).
 *
 * Só o servidor chama, com o cliente de serviço, depois de quem chama conferir
 * que é admin de plataforma. Nada de dado do cliente final: o nome da empresa,
 * as contas e a coluna de cada item.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerOQueFalta } from "@/lib/assistente/leituras/o-que-falta";
import { STATUS_SAUDAVEL } from "@/lib/channels/health";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { logger } from "@/lib/logger";
import { numeroOficialEsperando } from "@/lib/mcp-plataforma/checklist/area-dos-primeiros-passos";
import type { ColunaDoRotulo, QuemFaz } from "@/lib/mcp-plataforma/checklist/rotulo-do-cliente";
import type { OnboardingState } from "@/lib/schemas/onboarding";

export interface OQueFaltaNaLista {
  faltam: number;
  total: number;
  /** Quantos faltavam no primeiro retrato (ao entrar). */
  ao_entrar: number;
  /** A rodada do retrato mais novo. */
  em: string;
}

/** O retrato mais novo e o primeiro de cada empresa. NUNCA LANÇA: falha = mapa vazio (a tela segue com os passos). */
export async function lerRetratosDasEmpresas(
  admin: SupabaseClient,
  orgIds?: readonly string[],
): Promise<Map<string, OQueFaltaNaLista>> {
  const mapa = new Map<string, OQueFaltaNaLista>();
  try {
    let consulta = admin
      .from("mia_assistente_retratos")
      .select("organization_id, faltam, total, rodada_em")
      .order("rodada_em", { ascending: true })
      .limit(10_000);
    if (orgIds) {
      if (orgIds.length === 0) return mapa;
      consulta = consulta.in("organization_id", [...orgIds]);
    }
    const { data, error } = await consulta;
    if (error) {
      logger.warn("primeiros passos: retratos ilegíveis para a Time", { codigo: error.code ?? null });
      return mapa;
    }
    // Em ordem de rodada: o primeiro que aparece é o "ao entrar"; o último, o mais novo.
    for (const r of (data ?? []) as Array<{ organization_id: string; faltam: number; total: number; rodada_em: string }>) {
      const antes = mapa.get(r.organization_id);
      mapa.set(r.organization_id, {
        faltam: r.faltam,
        total: r.total,
        ao_entrar: antes ? antes.ao_entrar : r.faltam,
        em: r.rodada_em,
      });
    }
  } catch (erro) {
    logger.warn("primeiros passos: retratos falharam para a Time", {
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
  }
  return mapa;
}

export interface OQueFaltaAgora {
  faltam: number;
  total: number;
  preenchido: number;
  posso_completar: number;
  preciso_confirmar: number;
  /** Os itens que faltam, com a coluna e quem faz (sem texto livre do cliente). */
  itens: Array<{ chave: string; coluna: ColunaDoRotulo; quem: QuemFaz | null; depende_de: string | null }>;
  nao_se_aplica: string[];
}

/**
 * A conta de AGORA de uma empresa, com o papel de quem administra: o mesmo
 * rótulo que o Início mostra. NUNCA LANÇA: falha = `null`.
 */
export async function oQueFaltaAgora(
  admin: SupabaseClient,
  orgId: string,
  opcoes: { cobrancaLigada?: boolean } = {},
): Promise<OQueFaltaAgora | null> {
  try {
    const cobrancaLigada = opcoes.cobrancaLigada ?? (await moduloLigado(admin, "cobranca"));
    const { rotulo } = await lerOQueFalta(admin, { organizationId: orgId, papel: "admin", cobrancaLigada });
    return {
      faltam: rotulo.contas.faltam,
      total: rotulo.contas.total,
      preenchido: rotulo.contas.preenchido,
      posso_completar: rotulo.contas.posso_completar,
      preciso_confirmar: rotulo.contas.preciso_confirmar,
      itens: rotulo.itens
        .filter((i) => i.coluna !== "preenchido")
        .map((i) => ({ chave: i.chave, coluna: i.coluna, quem: i.quem ?? null, depende_de: i.depende_de?.chave ?? null })),
      nao_se_aplica: rotulo.nao_se_aplica.map((n) => n.chave),
    };
  } catch (erro) {
    logger.warn("primeiros passos: o que falta de agora falhou para a Time", {
      organization_id: orgId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return null;
  }
}

export interface EmpresaEsperandoONumero {
  organization_id: string;
  nome: string;
  /** Quando a pessoa entrou com o Facebook no passo do telefone. */
  desde: string | null;
}

/**
 * As empresas que entraram com o Facebook no passo do telefone e ainda não têm
 * número conectado: a Time precisa ligar o número oficial a ELAS. É a mesma
 * regra da área `primeiros_passos` do checklist. LANÇA na falha (como
 * `lerNumerosEsperando`; quem chama decide).
 */
export async function lerEmpresasEsperandoONumero(admin: SupabaseClient): Promise<EmpresaEsperandoONumero[]> {
  const { data, error } = await admin
    .from("organizations")
    .select("id, display_name, onboarding_state, demonstracao")
    .eq("onboarding_state->whatsapp->>status", "esperando_a_time")
    .limit(200);
  if (error) throw new Error(`empresas esperando o número: leitura falhou (${error.code ?? "sem_codigo"})`);
  const candidatas = (
    (data ?? []) as Array<{ id: string; display_name: string | null; onboarding_state: OnboardingState | null; demonstracao: boolean | null }>
  )
    .filter((o) => o.demonstracao !== true)
    .map((o) => ({ o, esperando: numeroOficialEsperando(o.onboarding_state) }))
    .filter((c) => c.esperando !== null);
  if (candidatas.length === 0) return [];

  const { data: sessoes, error: erroDasSessoes } = await admin
    .from("channel_sessions")
    .select("organization_id, status")
    .in(
      "organization_id",
      candidatas.map((c) => c.o.id),
    )
    .is("archived_at", null);
  if (erroDasSessoes)
    throw new Error(`empresas esperando o número: canais ilegíveis (${erroDasSessoes.code ?? "sem_codigo"})`);
  // O número que a Time ligou já conta como conectado: aí não há mais o que esperar.
  const conectadas = new Set(
    ((sessoes ?? []) as Array<{ organization_id: string; status: string | null }>)
      .filter((s) => s.status === STATUS_SAUDAVEL)
      .map((s) => s.organization_id),
  );
  return candidatas
    .filter((c) => !conectadas.has(c.o.id))
    .map((c) => ({ organization_id: c.o.id, nome: c.o.display_name ?? "", desde: c.esperando!.desde }))
    .sort((a, b) => (a.desde ?? "").localeCompare(b.desde ?? ""));
}
