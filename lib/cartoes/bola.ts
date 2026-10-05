/**
 * FORK MIA — COM QUEM ESTÁ A BOLA.
 *
 * A quinta pergunta do cartão fechado, e a que mais importa num CRM de
 * WhatsApp: o cliente falou por último e ninguém respondeu (a bola é NOSSA), ou
 * nós falamos por último e esperamos por ele (a bola é DO CLIENTE).
 *
 * ─── De onde sai ───────────────────────────────────────────────────────────
 *
 * `conversations.last_inbound_at` × `last_outbound_at`, que o banco mantém a
 * cada mensagem (`fn_mark_conversation_message`). Quem mandou a última saída
 * (a IA, uma automação, uma pessoa da equipe) vem de `messages.sent_via` e
 * `sent_by_user_id`, lidos pela `fn_mia_sinais_do_cartao` (migration 9012) —
 * a conversa guarda QUANDO saiu, não QUEM mandou.
 *
 * ─── Por que "a IA falou" não esquenta o negócio ───────────────────────────
 *
 * A bola só volta para o cliente quando ALGUÉM respondeu depois dele. Mas quem
 * foi importa para quem lê o quadro: "Agente há 1 h" e "Você há 4 dias" pedem
 * atitudes diferentes — o primeiro está andando sozinho; o segundo esfriou na
 * mão de uma pessoa. Por isso o rótulo diz quem, e não só "respondido".
 */
import { duracaoCurta, type Traduzir } from "@/lib/cartoes/tempo";

/** Quem mandou a última mensagem da conversa. */
export type QuemFalou = "lead" | "agente" | "automacao" | "equipe";

export interface Bola {
  /** `nos` = o cliente falou por último e ninguém respondeu. */
  com: "nos" | "cliente";
  quem: QuemFalou;
  /** Instante da última mensagem de quem falou por último. */
  desde: string;
  /** Quem da equipe mandou, quando foi uma pessoa (para "Você" × o nome dela). */
  porUsuarioId: string | null;
}

export interface EntradaDaBola {
  ultimaEntrada: string | null;
  ultimaSaida: string | null;
  /** `messages.sent_via` da última saída (ai, automation, crm, user…). */
  saidaVia: string | null;
  saidaPor: string | null;
}

/**
 * Os valores de `messages.sent_via` (CHECK `messages_sent_via_check`) que não
 * são pessoa. `system` entra com a automação: é o produto falando sozinho
 * (lembrete da agenda, régua), e dizer "Equipe" ali poria na conta de alguém
 * uma mensagem que ninguém escreveu.
 */
const VIA_DA_IA = new Set(["ai"]);
const VIA_AUTOMATICA = new Set(["automation", "system"]);

export function bolaDaConversa(e: EntradaDaBola): Bola | null {
  const entrada = e.ultimaEntrada ? new Date(e.ultimaEntrada).getTime() : null;
  const saida = e.ultimaSaida ? new Date(e.ultimaSaida).getTime() : null;
  if (entrada === null && saida === null) return null;

  if (entrada !== null && (saida === null || entrada > saida)) {
    return { com: "nos", quem: "lead", desde: e.ultimaEntrada as string, porUsuarioId: null };
  }

  const via = e.saidaVia ?? "";
  const quem: QuemFalou = VIA_DA_IA.has(via)
    ? "agente"
    : VIA_AUTOMATICA.has(via)
      ? "automacao"
      : "equipe";
  return {
    com: "cliente",
    quem,
    desde: e.ultimaSaida as string,
    porUsuarioId: quem === "equipe" ? e.saidaPor : null,
  };
}

/**
 * "Lead há 12 min" · "Agente há 1 h" · "Você há 4 dias" · "Juliana há 2 h".
 *
 * `nomeDoUsuario` resolve a pessoa da equipe (a lista de membros do quadro); o
 * próprio usuário vira "Você". Sem nome resolvido, "Equipe" — nunca um id.
 */
export function rotuloDaBola(
  bola: Bola,
  opcoes: {
    agora: Date;
    usuarioAtualId?: string | null;
    nomeDoUsuario?: (id: string) => string | null | undefined;
    t?: Traduzir;
  },
): string {
  const t = opcoes.t ?? ((x: string) => x);
  const tempo = duracaoCurta(opcoes.agora.getTime() - new Date(bola.desde).getTime(), t);
  const quando = tempo === t("agora") ? tempo : t("há {tempo}").replace("{tempo}", tempo);
  return `${quemFalouRotulo(bola, opcoes)} ${quando}`;
}

export function quemFalouRotulo(
  bola: Pick<Bola, "quem" | "porUsuarioId">,
  opcoes: {
    usuarioAtualId?: string | null;
    nomeDoUsuario?: (id: string) => string | null | undefined;
    t?: Traduzir;
  },
): string {
  const t = opcoes.t ?? ((x: string) => x);
  if (bola.quem === "lead") return t("Lead");
  if (bola.quem === "agente") return t("Agente");
  if (bola.quem === "automacao") return t("Automação");
  if (bola.porUsuarioId && bola.porUsuarioId === opcoes.usuarioAtualId) return t("Você");
  const nome = bola.porUsuarioId ? opcoes.nomeDoUsuario?.(bola.porUsuarioId) : null;
  const primeiro = nome?.trim().split(/\s+/)[0];
  return primeiro || t("Equipe");
}
