/**
 * De ONDE sai o aviso de grupo e PARA ONDE ele vai.
 *
 * As duas metades vêm de lugares diferentes de propósito:
 *
 *  - o NÚMERO é da plataforma (`channel_sessions.e_numero_de_avisos`). Um só,
 *    conectado uma vez por quem opera e adicionado aos grupos de todos os
 *    clientes. Exigir um número por cliente transformaria cada implantação numa
 *    conexão a mais, e é encanamento nosso — mesma doutrina da chave de IA.
 *
 *  - o GRUPO é do cliente (`organizations.settings.grupo_de_avisos`), porque é
 *    a única parte que muda de um para o outro: o time comercial de cada um
 *    trabalha no grupo dele.
 *
 * Por que isto não mora dentro da ação `notify_group`: o mesmo par
 * número+grupo precisa ser respondido pela tela do admin (para mostrar o que
 * está valendo antes de alguém disparar) e pela ação (na hora de enviar). Duas
 * respostas para a mesma pergunta divergem no dia em que uma das duas mudar.
 *
 * ⚠️ A sessão devolvida é de OUTRA organização — a da plataforma, não a do
 * cliente cujo lead foi qualificado. É a única passagem do sistema em que isso
 * é intencional, e é por isso que ela vem daqui, com nome e comentário, em vez
 * de um `select` sem `organization_id` solto no meio de uma feature.
 *
 * FORK MIA (.62): a empresa pode escolher um número DELA no lugar do da
 * plataforma (`origem-do-aviso.ts`, que é quem decide). Aí a sessão é da própria
 * organização, conferida pela coluna — e, se ela cair, o aviso só passa para o
 * número da plataforma quando a empresa ligou a reserva, com o desvio dito no
 * retorno (`via`, `desvio`) para quem registra.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CHANNEL_SESSION_REF_COLUMNS,
  type ChannelSessionRef,
} from "@/lib/channels/session-ref";

import {
  escolherNumeroDoAviso,
  lerOrigemDoAviso,
  type MotivoSemNumero,
  type ProblemaDoNumeroDaEmpresa,
  type SessaoDaEmpresa,
  type SituacaoDaReserva,
  type ViaDoAviso,
} from "./origem-do-aviso";

/** Onde o grupo do cliente mora dentro de `organizations.settings`. */
export const CHAVE_DO_GRUPO = "grupo_de_avisos";

export type GrupoDeAvisos = {
  /** O id do WhatsApp (`120363…@g.us`) — é ele que endereça o envio. */
  id: string;
  /**
   * O nome do grupo NA HORA em que foi escolhido.
   *
   * Guardado junto e não buscado toda vez porque a tela precisa dizer qual
   * grupo está valendo mesmo com o canal fora do ar — e "grupo 120363…@g.us"
   * não é resposta para quem vai conferir se o aviso vai para o lugar certo.
   * Pode envelhecer se renomearem o grupo; envelhecer é melhor que sumir.
   */
  nome: string;
};

/**
 * Um id de grupo do WhatsApp termina em `@g.us`; um número, em `@c.us`.
 *
 * A checagem vive aqui, e não só na ação, porque o mesmo erro tem duas portas
 * de entrada: colar um telefone no campo do grupo e escolher da lista um item
 * que não é grupo. O aviso leva nome do lead e resumo da qualificação — isso
 * chegando a um CLIENTE é o pior desfecho desta funcionalidade, pior que o
 * aviso não sair.
 */
export function pareceGrupo(chatId: string): boolean {
  return /@g\.us$/i.test(chatId.trim());
}

/** Lê o grupo escolhido de dentro do jsonb, tolerando lixo e ausência. */
export function lerGrupoDeAvisos(settings: unknown): GrupoDeAvisos | null {
  if (!settings || typeof settings !== "object") return null;
  const bruto = (settings as Record<string, unknown>)[CHAVE_DO_GRUPO];
  if (!bruto || typeof bruto !== "object") return null;
  const { id, nome } = bruto as { id?: unknown; nome?: unknown };
  if (typeof id !== "string" || !pareceGrupo(id)) return null;
  return { id, nome: typeof nome === "string" && nome ? nome : id };
}

/** As colunas da sessão da EMPRESA: a referência e o que decide se ela serve. */
export const COLUNAS_DA_SESSAO_DA_EMPRESA = `id, organization_id, status, archived_at, ${CHANNEL_SESSION_REF_COLUMNS}`;

export type DestinoDoAviso =
  | {
      ok: true;
      sessao: ChannelSessionRef;
      chatId: string;
      nomeDoGrupo: string;
      /** Por onde sai: `reserva` = era para ser o da empresa, e ele não serve agora. */
      via: ViaDoAviso;
      desvio: ProblemaDoNumeroDaEmpresa | null;
    }
  | {
      ok: false;
      motivo: MotivoSemNumero | "sem_grupo_no_cliente";
      reserva: SituacaoDaReserva;
    };

/**
 * Os motivos são separados porque as correções são de pessoas diferentes: sem
 * número é a plataforma que precisa conectar; sem grupo é este cliente que
 * precisa ser configurado; número da empresa caído é a empresa que precisa
 * reconectar. Um motivo genérico faria quem lê o log procurar no lugar errado
 * — e o aviso interno é justamente o que ninguém repara faltando.
 */
export async function destinoDoAviso(
  admin: SupabaseClient,
  organizationId: string,
): Promise<DestinoDoAviso> {
  // A organização vem PRIMEIRO: é nela que está dito por qual número sair.
  const { data: org } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle();
  const settings = (org as { settings?: unknown } | null)?.settings;
  const origem = lerOrigemDoAviso(settings);
  const idDaEmpresa = origem.modo === "empresa" ? origem.channel_session_id : null;

  const [{ data: daPlataforma }, { data: daEmpresa }] = await Promise.all([
    admin
      .from("channel_sessions")
      .select(CHANNEL_SESSION_REF_COLUMNS)
      .eq("e_numero_de_avisos", true)
      .maybeSingle(),
    idDaEmpresa
      ? admin
          .from("channel_sessions")
          .select(COLUNAS_DA_SESSAO_DA_EMPRESA)
          .eq("id", idDaEmpresa)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // A CAPACIDADE (entrega em grupo?) é perguntada lá dentro, nunca o nome do
  // canal: recusar aqui devolve a frase que explica, enquanto deixar passar
  // devolveria um 4xx do adapter — e o time concluiria que o produto não avisa.
  const numero = escolherNumeroDoAviso({
    organizationId,
    origem,
    daEmpresa: (daEmpresa as unknown as SessaoDaEmpresa | null) ?? null,
    daPlataforma: (daPlataforma as unknown as ChannelSessionRef | null) ?? null,
  });
  if (!numero.ok) return { ok: false, motivo: numero.motivo, reserva: numero.reserva };

  const grupo = lerGrupoDeAvisos(settings);
  if (!grupo) return { ok: false, motivo: "sem_grupo_no_cliente", reserva: null };

  return {
    ok: true,
    sessao: numero.sessao,
    chatId: grupo.id,
    nomeDoGrupo: grupo.nome,
    via: numero.via,
    desvio: numero.desvio,
  };
}
