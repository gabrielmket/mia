/**
 * FORK MIA · coexistência (S3): o PEDIDO ÚNICO da sincronização (`smb_app_data`).
 *
 * Depois da conexão pelo app, a Meta dá 24 horas para a MIA pedir os contatos
 * (`smb_app_state_sync`) e o histórico (`history`). Cada pedido é aceito UMA
 * vez só: refazer exige o cliente sair da coexistência no app e passar pela
 * janela de novo, o que abre um ciclo novo (`conectar.ts`).
 *
 * ─── A trava ─────────────────────────────────────────────────────────────────
 *
 * `unique (conexao_id, tipo)` em `mia_coexistencia_sincronizacoes` (9162).
 * Quem consegue INSERIR a linha do pedido é o único que chama a Meta; quem
 * chega depois (o worker repetido, a varredura, duas chegadas ao mesmo tempo)
 * vê o insert voltar vazio e não chama nada. A linha nasce `pedindo` ANTES da
 * chamada, então até o processo que morre no meio deixa a trava fechada.
 *
 * ─── Os desfechos, todos sem segunda tentativa automática ────────────────────
 *
 *   200 com request_id     → `pedida` (vira `em_andamento` quando o 1º contato
 *                            ou lote chega, pela S2)
 *   a Meta respondeu erro  → `falhou`, com o código e o título dela, e aviso
 *   sem resposta (rede)    → `sem_resposta`: não dá para saber se a Meta aceitou
 *   passou das 24 h        → `prazo_vencido` (insert com o estado final, mesma trava)
 *   processo morreu        → a varredura muda `pedindo` parado para `sem_resposta`
 *
 * D1 (aprovada pelo Gabriel em 17/11/2026): os contatos falharam, o histórico
 * é pedido mesmo assim. São pedidos independentes, com o mesmo prazo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { resolveMetaCreds } from "../credentials";
import { graphBaseUrl } from "../graph-base";
import { avisarSincronizacaoQueNaoVeio, type TipoDoPedido } from "./avisos";

type Admin = SupabaseClient;

export const EVENTO_DA_SINCRONIZACAO = "coexistencia.sincronizacao_requested";

/** O prazo que a Meta dá depois da conexão. */
export const PRAZO_DA_SINCRONIZACAO_MS = 24 * 60 * 60 * 1000;

/** Quanto a chamada à Meta pode demorar antes de virar `sem_resposta`. */
const TEMPO_DA_CHAMADA_MS = 20_000;

/** Na ordem: primeiro os contatos, depois o histórico (página da Meta, 17/11/2026). */
export const PEDIDOS: ReadonlyArray<{ tipo: TipoDoPedido; syncType: string }> = [
  { tipo: "contatos", syncType: "smb_app_state_sync" },
  { tipo: "historico", syncType: "history" },
];

export type DesfechoDoPedido =
  | "pedida"
  | "falhou"
  | "sem_resposta"
  | "prazo_vencido"
  | "ja_pedido"
  | "ciclo_fora_do_ar"
  | "sem_ciclo";

export interface DependenciasDoPedido {
  fetch?: typeof fetch;
  agora?: () => Date;
  /** Para o teste: o tempo da chamada antes de desistir. */
  tempoDaChamadaMs?: number;
}

interface Ciclo {
  id: string;
  organization_id: string;
  channel_session_id: string;
  phone_number_id: string;
  estado: string;
  conectada_em: string;
}

function erroDe(onde: string, error: { message?: string; code?: string } | null): Error {
  return new Error(`${onde}: ${error?.code ?? "sem_codigo"} ${error?.message ?? ""}`.trim());
}

/** Pede ao worker. `false` quando o pedido não foi gravado: a varredura cobre. Nunca lança. */
export async function emitirPedidoDaSincronizacao(
  admin: Admin,
  input: { organizationId: string; conexaoId: string; requestId: string },
): Promise<boolean> {
  try {
    const { error } = await admin.rpc("emit_event" as never, {
      p_event_type: EVENTO_DA_SINCRONIZACAO,
      p_entity_kind: "mia_coexistencia_conexao",
      p_entity_id: input.conexaoId,
      p_payload: { conexao_id: input.conexaoId },
      p_metadata: { source: "coexistencia_conexao" },
      p_organization_id: input.organizationId,
    } as never);
    if (!error) return true;
    logger.error("[meta.coexistencia] pedido da sincronização não emitido", {
      request_id: input.requestId,
      conexao_id: input.conexaoId,
      erro: error.message,
    });
    return false;
  } catch (err) {
    logger.error("[meta.coexistencia] pedido da sincronização não emitido", {
      request_id: input.requestId,
      conexao_id: input.conexaoId,
      erro: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function lerCiclo(admin: Admin, organizationId: string, conexaoId: string): Promise<Ciclo | null> {
  const { data, error } = await admin
    .from("mia_coexistencia_conexoes")
    .select("id, organization_id, channel_session_id, phone_number_id, estado, conectada_em")
    .eq("organization_id", organizationId)
    .eq("id", conexaoId)
    .maybeSingle();
  if (error) throw erroDe("ciclo_do_pedido", error);
  return (data as Ciclo | null) ?? null;
}

/**
 * Tenta pegar a trava. Devolve o id da linha nova, ou `null` quando outro já
 * pediu (e então NINGUÉM aqui chama a Meta).
 */
async function pegarTrava(
  admin: Admin,
  ciclo: Ciclo,
  tipo: TipoDoPedido,
  linha: { estado: "pedindo" | "prazo_vencido"; pedidaEm: string | null },
): Promise<string | null> {
  const { data, error } = await admin
    .from("mia_coexistencia_sincronizacoes")
    .upsert(
      {
        organization_id: ciclo.organization_id,
        conexao_id: ciclo.id,
        tipo,
        estado: linha.estado,
        pedida_em: linha.pedidaEm,
      },
      { onConflict: "conexao_id,tipo", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw erroDe("trava_do_pedido", error);
  return ((data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
}

/** Grava o desfecho só se a linha ainda está `pedindo` (a S2 pode já tê-la movido). */
async function gravarDesfecho(
  admin: Admin,
  ciclo: Ciclo,
  sincronizacaoId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin
    .from("mia_coexistencia_sincronizacoes")
    .update(patch)
    .eq("organization_id", ciclo.organization_id)
    .eq("id", sincronizacaoId)
    .eq("estado", "pedindo");
  if (error) throw erroDe("desfecho_do_pedido", error);
}

function corta(v: unknown, max: number): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/** A chamada à Meta. Separada para o teste contar quantas vezes ela sai. */
async function chamarMeta(
  f: typeof fetch,
  input: { token: string; graphVersion: string; phoneNumberId: string; syncType: string; tempoMs: number },
): Promise<
  | { tipo: "aceito"; requestId: string | null }
  | { tipo: "recusado"; codigo: string | null; titulo: string | null }
  | { tipo: "sem_resposta" }
> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), input.tempoMs);
  try {
    const res = await f(`${graphBaseUrl(input.graphVersion)}/${input.phoneNumberId}/smb_app_data`, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", sync_type: input.syncType }),
      signal: controle.signal,
    });
    const corpo = (await res.json().catch(() => null)) as {
      request_id?: unknown;
      error?: { code?: unknown; error_subcode?: unknown; message?: unknown; error_user_title?: unknown };
    } | null;
    if (res.ok && corpo && !corpo.error) return { tipo: "aceito", requestId: corta(corpo.request_id, 200) };
    // 5xx sem corpo de erro da Meta: não dá para saber se ela aceitou.
    if (!corpo?.error && res.status >= 500) return { tipo: "sem_resposta" };
    const e = corpo?.error;
    return {
      tipo: "recusado",
      codigo: corta(e?.code, 40) ?? corta(String(res.status), 40),
      titulo: corta(e?.error_user_title, 300) ?? corta(e?.message, 300),
    };
  } catch {
    return { tipo: "sem_resposta" };
  } finally {
    clearTimeout(relogio);
  }
}

async function pedirUm(
  admin: Admin,
  ciclo: Ciclo,
  pedido: { tipo: TipoDoPedido; syncType: string },
  deps: Required<Pick<DependenciasDoPedido, "agora">> & DependenciasDoPedido,
): Promise<DesfechoDoPedido> {
  const agora = deps.agora();
  const prazo = new Date(ciclo.conectada_em).getTime() + PRAZO_DA_SINCRONIZACAO_MS;

  if (agora.getTime() >= prazo) {
    const id = await pegarTrava(admin, ciclo, pedido.tipo, { estado: "prazo_vencido", pedidaEm: null });
    if (!id) return "ja_pedido";
    await avisarSincronizacaoQueNaoVeio(admin, {
      organizationId: ciclo.organization_id,
      channelSessionId: ciclo.channel_session_id,
      sincronizacaoId: id,
      tipo: pedido.tipo,
      estado: "prazo_vencido",
    });
    return "prazo_vencido";
  }

  const id = await pegarTrava(admin, ciclo, pedido.tipo, { estado: "pedindo", pedidaEm: agora.toISOString() });
  if (!id) return "ja_pedido";

  // Daqui para baixo, ESTE processo é o único dono do pedido.
  const creds = await resolveMetaCreds(admin, {
    organizationId: ciclo.organization_id,
    phoneNumberId: ciclo.phone_number_id,
  });
  const resposta = creds
    ? await chamarMeta(deps.fetch ?? fetch, {
        token: creds.token,
        graphVersion: creds.graphVersion,
        phoneNumberId: ciclo.phone_number_id,
        syncType: pedido.syncType,
        tempoMs: deps.tempoDaChamadaMs ?? TEMPO_DA_CHAMADA_MS,
      })
    : ({ tipo: "recusado", codigo: "sem_credencial", titulo: null } as const);
  const respondidaEm = deps.agora().toISOString();

  if (resposta.tipo === "aceito") {
    await gravarDesfecho(admin, ciclo, id, {
      estado: "pedida",
      request_id: resposta.requestId,
      respondida_em: respondidaEm,
    });
    return "pedida";
  }
  if (resposta.tipo === "sem_resposta") {
    await gravarDesfecho(admin, ciclo, id, { estado: "sem_resposta" });
  } else {
    await gravarDesfecho(admin, ciclo, id, {
      estado: "falhou",
      erro_codigo: resposta.codigo,
      erro_titulo: resposta.titulo,
      respondida_em: respondidaEm,
    });
  }
  await avisarSincronizacaoQueNaoVeio(admin, {
    organizationId: ciclo.organization_id,
    channelSessionId: ciclo.channel_session_id,
    sincronizacaoId: id,
    tipo: pedido.tipo,
    estado: resposta.tipo === "sem_resposta" ? "sem_resposta" : "falhou",
    erroCodigo: resposta.tipo === "recusado" ? resposta.codigo : null,
    erroTitulo: resposta.tipo === "recusado" ? resposta.titulo : null,
  });
  return resposta.tipo === "sem_resposta" ? "sem_resposta" : "falhou";
}

/**
 * Os dois pedidos do ciclo, na ordem. Reexecução segura: o que já foi pedido
 * volta `ja_pedido` sem chamar a Meta. Lança só quando o banco falha (o
 * `event_log` refaz, e a trava segura o que já saiu).
 */
export async function pedirSincronizacao(
  admin: Admin,
  input: { organizationId: string; conexaoId: string },
  deps: DependenciasDoPedido = {},
): Promise<Record<TipoDoPedido, DesfechoDoPedido>> {
  const ciclo = await lerCiclo(admin, input.organizationId, input.conexaoId);
  if (!ciclo) return { contatos: "sem_ciclo", historico: "sem_ciclo" };
  // Ciclo encerrado ou fora do ar: pedir agora queimaria a única chance num
  // número que não está ligado à API.
  if (ciclo.estado !== "no_ar") return { contatos: "ciclo_fora_do_ar", historico: "ciclo_fora_do_ar" };

  const comRelogio = { ...deps, agora: deps.agora ?? (() => new Date()) };
  const desfechos = {} as Record<TipoDoPedido, DesfechoDoPedido>;
  for (const pedido of PEDIDOS) {
    // D1: um pedido que falha não impede o outro.
    desfechos[pedido.tipo] = await pedirUm(admin, ciclo, pedido, comRelogio);
  }
  return desfechos;
}
