/**
 * FORK MIA · coexistência (S3): a VARREDURA de 5 em 5 minutos.
 *
 * Cobre o que a rota e o worker não conseguiram fechar, SEM nunca pedir duas
 * vezes (a trava de `sincronizacao.ts` vale aqui também):
 *
 *  1. pedido `pedindo` há mais de 5 minutos: o processo morreu entre a trava e
 *     a resposta da Meta. Vira `sem_resposta` (não dá para saber se a Meta
 *     aceitou) e avisa. Não chama a Meta.
 *  2. ciclo aberto pela janela sem os dois pedidos (a rota não conseguiu
 *     emitir o pedido ao worker): pede pela mesma função, atrás da trava. Já
 *     passado o prazo, grava `prazo_vencido` e avisa.
 *  3. lote do histórico guardado e esquecido em `recebido` (o pedido ao worker
 *     se perdeu na rota, S2): pede ao worker de novo. A gravação é idempotente
 *     (o lote já gravado volta `ja_gravado`).
 *  4. LGPD: lote cru parado há mais de 7 dias vira `falhou` com o `payload`
 *     nulo, e o pedido reconta a falha. A conversa não fica guardada sem prazo
 *     numa tabela que a anonimização do titular não olha (ressalva do Revisor
 *     no PR #92).
 *
 * Cada passo tem teto por rodada e falha sozinho: um passo que quebra vai ao
 * log e os outros seguem.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { avisarSincronizacaoQueNaoVeio, type TipoDoPedido } from "./avisos";
import { EVENTO_DO_LOTE } from "./receber";
import { pedirSincronizacao, type DependenciasDoPedido } from "./sincronizacao";

type Admin = SupabaseClient;

const LIMITE = 200;
export const PEDINDO_PARADO_MS = 5 * 60 * 1000;
/** Quanto tempo para trás a varredura procura ciclo sem pedido. */
const CICLOS_RECENTES_MS = 3 * 24 * 60 * 60 * 1000;
export const LOTE_ESQUECIDO_MS = 2 * 60 * 60 * 1000;
export const PRAZO_DO_LOTE_CRU_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResultadoDaVarredura {
  semResposta: number;
  ciclosPedidos: number;
  lotesRetomados: number;
  lotesVencidos: number;
  falhas: string[];
}

function antes(agora: Date, ms: number): string {
  return new Date(agora.getTime() - ms).toISOString();
}

async function fecharPedindoParado(admin: Admin, agora: Date): Promise<number> {
  const { data, error } = await admin
    .from("mia_coexistencia_sincronizacoes")
    .update({ estado: "sem_resposta" })
    .eq("estado", "pedindo")
    .lt("pedida_em", antes(agora, PEDINDO_PARADO_MS))
    .select("id, organization_id, conexao_id, tipo");
  if (error) throw new Error(`pedindo_parado: ${error.message}`);
  const linhas = (data ?? []) as Array<{ id: string; organization_id: string; conexao_id: string; tipo: TipoDoPedido }>;
  for (const l of linhas) {
    const { data: ciclo } = await admin
      .from("mia_coexistencia_conexoes")
      .select("channel_session_id")
      .eq("organization_id", l.organization_id)
      .eq("id", l.conexao_id)
      .maybeSingle();
    const channelSessionId = (ciclo as { channel_session_id?: string } | null)?.channel_session_id;
    if (!channelSessionId) continue;
    await avisarSincronizacaoQueNaoVeio(admin, {
      organizationId: l.organization_id,
      channelSessionId,
      sincronizacaoId: l.id,
      tipo: l.tipo,
      estado: "sem_resposta",
    });
  }
  return linhas.length;
}

async function pedirCiclosSemPedido(admin: Admin, agora: Date, deps: DependenciasDoPedido): Promise<number> {
  const { data, error } = await admin
    .from("mia_coexistencia_conexoes")
    .select("id, organization_id")
    .eq("estado", "no_ar")
    .eq("aberta_por", "conexao_pelo_app")
    .gt("conectada_em", antes(agora, CICLOS_RECENTES_MS))
    .limit(LIMITE);
  if (error) throw new Error(`ciclos_sem_pedido: ${error.message}`);
  const ciclos = (data ?? []) as Array<{ id: string; organization_id: string }>;
  if (ciclos.length === 0) return 0;

  const { data: pedidos, error: erroDosPedidos } = await admin
    .from("mia_coexistencia_sincronizacoes")
    .select("conexao_id")
    .in("conexao_id", ciclos.map((c) => c.id));
  if (erroDosPedidos) throw new Error(`pedidos_dos_ciclos: ${erroDosPedidos.message}`);
  const contagem = new Map<string, number>();
  for (const p of (pedidos ?? []) as Array<{ conexao_id: string }>) {
    contagem.set(p.conexao_id, (contagem.get(p.conexao_id) ?? 0) + 1);
  }

  let pedidosAgora = 0;
  for (const c of ciclos) {
    if ((contagem.get(c.id) ?? 0) >= 2) continue;
    await pedirSincronizacao(admin, { organizationId: c.organization_id, conexaoId: c.id }, { ...deps, agora: () => agora });
    pedidosAgora += 1;
  }
  return pedidosAgora;
}

async function retomarLotesEsquecidos(admin: Admin, agora: Date): Promise<number> {
  const { data, error } = await admin
    .from("mia_coexistencia_lotes")
    .select("id, organization_id, sincronizacao_id")
    .eq("estado", "recebido")
    .lt("updated_at", antes(agora, LOTE_ESQUECIDO_MS))
    .gt("updated_at", antes(agora, PRAZO_DO_LOTE_CRU_MS))
    .limit(LIMITE);
  if (error) throw new Error(`lotes_esquecidos: ${error.message}`);
  let retomados = 0;
  for (const l of (data ?? []) as Array<{ id: string; organization_id: string; sincronizacao_id: string }>) {
    const { error: erroDoEvento } = await admin.rpc("emit_event" as never, {
      p_event_type: EVENTO_DO_LOTE,
      p_entity_kind: "mia_coexistencia_lote",
      p_entity_id: l.id,
      p_payload: { lote_id: l.id, sincronizacao_id: l.sincronizacao_id },
      p_metadata: { source: "coexistencia_varredura" },
      p_organization_id: l.organization_id,
    } as never);
    if (erroDoEvento) continue;
    // Marca a retomada: a próxima rodada não pede de novo o mesmo lote.
    await admin
      .from("mia_coexistencia_lotes")
      .update({ updated_at: agora.toISOString() })
      .eq("organization_id", l.organization_id)
      .eq("id", l.id)
      .eq("estado", "recebido");
    retomados += 1;
  }
  return retomados;
}

async function vencerLotesCrus(admin: Admin, agora: Date): Promise<number> {
  const { data, error } = await admin
    .from("mia_coexistencia_lotes")
    .update({ estado: "falhou", payload: null, erro: "prazo_do_lote_cru" })
    .eq("estado", "recebido")
    .lt("created_at", antes(agora, PRAZO_DO_LOTE_CRU_MS))
    .select("sincronizacao_id");
  if (error) throw new Error(`lotes_crus_vencidos: ${error.message}`);
  const pedidos = new Set(((data ?? []) as Array<{ sincronizacao_id: string }>).map((l) => l.sincronizacao_id));
  for (const sincronizacaoId of pedidos) {
    const { error: erroDaRecontagem } = await admin.rpc("fn_mia_coexistencia_recontar" as never, {
      p_sincronizacao: sincronizacaoId,
    } as never);
    if (erroDaRecontagem) {
      logger.warn("[meta.coexistencia] pedido não recontado depois do lote vencido", {
        sincronizacao_id: sincronizacaoId,
        erro: erroDaRecontagem.message,
      });
    }
  }
  return (data ?? []).length;
}

export async function varrerCoexistencia(
  admin: Admin,
  deps: DependenciasDoPedido & { agora?: () => Date } = {},
): Promise<ResultadoDaVarredura> {
  const agora = deps.agora?.() ?? new Date();
  const r: ResultadoDaVarredura = { semResposta: 0, ciclosPedidos: 0, lotesRetomados: 0, lotesVencidos: 0, falhas: [] };
  const passo = async (nome: string, fn: () => Promise<number>, gravar: (n: number) => void) => {
    try {
      gravar(await fn());
    } catch (err) {
      r.falhas.push(nome);
      logger.error("[meta.coexistencia] passo da varredura falhou", {
        passo: nome,
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  };
  await passo("pedindo_parado", () => fecharPedindoParado(admin, agora), (n) => (r.semResposta = n));
  await passo("ciclos_sem_pedido", () => pedirCiclosSemPedido(admin, agora, deps), (n) => (r.ciclosPedidos = n));
  await passo("lotes_esquecidos", () => retomarLotesEsquecidos(admin, agora), (n) => (r.lotesRetomados = n));
  await passo("lotes_crus_vencidos", () => vencerLotesCrus(admin, agora), (n) => (r.lotesVencidos = n));
  return r;
}
