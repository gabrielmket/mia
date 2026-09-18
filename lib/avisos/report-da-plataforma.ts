/**
 * O REPORT QUE VAI PARA O GRUPO INTERNO.
 *
 * O número de avisos fala com o grupo de cada CLIENTE quando a IA passa o
 * bastão (`aviso-da-passagem.ts`). Aqui é o outro lado do mesmo número: o grupo
 * NOSSO, onde quem opera precisa saber que o crédito de IA está acabando, que
 * um número caiu, que a fila travou.
 *
 * ─── Por que não basta a Central ───────────────────────────────────────────
 *
 * `agent_inbox_items` é por organização e serve a quem está com a tela aberta.
 * Estes avisos são da INSTALAÇÃO e acontecem de madrugada, no fim de semana, no
 * meio de uma implantação. Um crédito que acaba às 2h de sábado derruba TODOS
 * os clientes até alguém abrir o navegador por acaso.
 *
 * ─── A trava anti-ruído é parte da feature, não um detalhe ─────────────────
 *
 * Um grupo que recebe aviso demais é ignorado em uma semana — e aí o aviso que
 * importa chega junto com o lixo. Toda saída daqui passa por `jaAvisou`, que
 * pergunta ao banco quando aquele MESMO aviso saiu pela última vez. O cron roda
 * de minuto em minuto; o recado sai uma vez por dia enquanto a condição durar.
 *
 * ⚠️ Nada aqui lança. Um vigia que derruba a rodada por não conseguir mandar
 * recado é pior que um vigia mudo: ele leva junto os outros avisos da mesma
 * passagem.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { entregaEmGrupo, getAdapter } from "@/lib/channels";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  resolveSessionRef,
  type ChannelSessionRef,
} from "@/lib/channels/session-ref";
import { logger } from "@/lib/logger";

import { pareceGrupo } from "./destino-do-aviso";

export interface GrupoDeReport {
  id: string;
  nome: string;
  limiteSaldoUsd: number;
  resumoDiario: boolean;
}

/** A configuração do report, ou `null` quando ninguém escolheu um grupo. */
export async function grupoDeReport(admin: SupabaseClient): Promise<GrupoDeReport | null> {
  try {
    const { data } = await admin
      .from("platform_avisos")
      .select("grupo_id, grupo_nome, limite_saldo_usd, resumo_diario")
      .eq("id", 1)
      .maybeSingle();
    if (!data) return null;

    const linha = data as {
      grupo_id?: string | null;
      grupo_nome?: string | null;
      limite_saldo_usd?: unknown;
      resumo_diario?: boolean | null;
    };
    // Sem grupo escolhido, CALA. Nunca inventa destino: um report interno traz
    // saldo, nome de cliente e estado da instalação, e isso chegando ao grupo
    // errado é pior que não chegar.
    if (!linha.grupo_id || !pareceGrupo(linha.grupo_id)) return null;

    return {
      id: linha.grupo_id,
      nome: linha.grupo_nome ?? linha.grupo_id,
      limiteSaldoUsd: Number(linha.limite_saldo_usd ?? 20),
      resumoDiario: linha.resumo_diario !== false,
    };
  } catch (err) {
    logger.warn("[report] não deu para ler a configuração", {
      detail: err instanceof Error ? err.message : "erro",
    });
    return null;
  }
}

/**
 * Este aviso já saiu nas últimas `horas`?
 *
 * A chave é do AVISO (`saldo_baixo`, `canal_caiu:<id>`), não do momento. É o
 * que faz o mesmo problema render um recado por dia em vez de um por rodada.
 *
 * Em caso de dúvida responde `true` — ou seja, NÃO avisa. Um erro de leitura
 * aqui não pode virar enxurrada: o defeito que esta função existe para evitar é
 * justamente o grupo que ninguém lê mais.
 */
export async function jaAvisou(
  admin: SupabaseClient,
  chave: string,
  horas: number,
): Promise<boolean> {
  try {
    const { data } = await admin
      .from("platform_avisos_enviados")
      .select("enviado_em")
      .eq("chave", chave)
      .maybeSingle();
    if (!data) return false;
    const quando = new Date((data as { enviado_em: string }).enviado_em).getTime();
    return Date.now() - quando < horas * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

async function marcarEnviado(
  admin: SupabaseClient,
  chave: string,
  detalhe: Record<string, unknown>,
): Promise<void> {
  try {
    await admin
      .from("platform_avisos_enviados")
      .upsert(
        { chave, enviado_em: new Date().toISOString(), detalhe },
        { onConflict: "chave" },
      );
  } catch (err) {
    // Falhar AQUI é o caso perigoso: o recado saiu e a marca não. Na próxima
    // rodada ele sai de novo. Vale o log alto — é a única pista de por que o
    // grupo começou a repetir.
    logger.warn("[report] o recado saiu e a trava não gravou", {
      chave,
      detail: err instanceof Error ? err.message : "erro",
    });
  }
}

/** O número da plataforma — o mesmo que avisa os grupos dos clientes. */
async function numeroDeAvisos(admin: SupabaseClient): Promise<ChannelSessionRef | null> {
  const { data } = await admin
    .from("channel_sessions")
    .select(CHANNEL_SESSION_REF_COLUMNS)
    .eq("e_numero_de_avisos", true)
    .maybeSingle();
  if (!data) return null;
  const ref = data as unknown as ChannelSessionRef;
  return entregaEmGrupo(ref.provider) ? ref : null;
}

/**
 * Manda o recado, respeitando a trava. `false` = não saiu (e o motivo já está
 * no log ou é simplesmente "já avisei hoje").
 */
export async function reportar(
  admin: SupabaseClient,
  args: { chave: string; horas: number; texto: string; detalhe?: Record<string, unknown> },
): Promise<boolean> {
  try {
    const grupo = await grupoDeReport(admin);
    if (!grupo) return false;
    if (await jaAvisou(admin, args.chave, args.horas)) return false;

    const sessao = await numeroDeAvisos(admin);
    if (!sessao) {
      logger.warn("[report] sem número de avisos marcado — o grupo interno ficou sem recado", {
        chave: args.chave,
      });
      return false;
    }

    await getAdapter(sessao.provider).send({
      // A organização aqui é só contexto de log do adapter — este recado não é
      // de tenant nenhum. O canal por QR não usa este campo para endereçar.
      organizationId: "plataforma",
      sessionRef: resolveSessionRef(sessao),
      to: grupo.id,
      kind: "text",
      body: args.texto,
    });

    await marcarEnviado(admin, args.chave, args.detalhe ?? {});
    return true;
  } catch (err) {
    logger.warn("[report] falhou ao enviar", {
      chave: args.chave,
      detail: err instanceof Error ? err.message : "erro",
    });
    return false;
  }
}
