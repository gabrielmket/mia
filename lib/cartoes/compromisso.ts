/**
 * FORK MIA — O PRÓXIMO COMPROMISSO, EXPLÍCITO: o quê · onde · quando.
 *
 * "Visita ao decorado · Jardim das Flores · sáb 03/10 10h". O cartão fechado
 * corta com reticências e mostra o texto inteiro ao passar o mouse; o cartão
 * aberto e o Foco usam a mesma frase. Uma régua só, para o quadro e o cartão
 * aberto nunca dizerem o mesmo compromisso de dois jeitos.
 *
 * ─── Qual compromisso é "do negócio" ───────────────────────────────────────
 *
 * `calendar_appointments` não tem `lead_id` — o vínculo com o negócio é
 * `crm_lead_links` com `target_kind='appointment'` (DECISÃO 6 da agenda). E a
 * maior parte dos compromissos nasce só com o CONTATO (a IA marca pela
 * conversa). A regra:
 *
 *  1. vale o compromisso futuro LIGADO a este negócio;
 *  2. sem nenhum ligado, vale o do contato que não está ligado a NENHUM negócio;
 *  3. o compromisso ligado a OUTRO negócio da mesma pessoa nunca aparece aqui —
 *     mostrar a visita do negócio B no cartão do negócio A é o mesmo erro que o
 *     roteador da próxima ação recusa (`lib/leads/active-lead.ts`).
 *
 * Cancelado, realizado e falta não são "próximo". O que já começou e ainda não
 * terminou é: a reunião em andamento continua sendo o compromisso da vez.
 */
import { partesNoFuso, diaLocalISO } from "@/lib/agenda/fuso";
import { rotuloDoLocal } from "@/lib/agenda/locais";
import type { Traduzir } from "@/lib/cartoes/tempo";

export interface CompromissoDoCartao {
  id: string;
  /** `calendar_appointments.title` — o que a pessoa escreveu ao marcar. */
  titulo: string;
  /** O nome do tipo de atendimento (`calendar_event_types.name`), quando há. */
  tipo: string | null;
  localTipo: string | null;
  localDetalhe: string | null;
  inicio: string;
  fim: string;
  fuso: string;
  situacao: string;
  /** Negócios aos quais o compromisso está ligado (`crm_lead_links`). */
  leadIds: string[];
}

const SITUACOES_ENCERRADAS = new Set(["cancelled", "completed", "no_show"]);

/** Ver a regra no cabeçalho. `null` quando não há nenhum. */
export function escolherProximoCompromisso(
  lista: CompromissoDoCartao[],
  leadId: string,
  agora: Date,
): CompromissoDoCartao | null {
  const vivos = lista
    .filter((c) => !SITUACOES_ENCERRADAS.has(c.situacao))
    .filter((c) => new Date(c.fim).getTime() > agora.getTime())
    .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime());
  const doNegocio = vivos.find((c) => c.leadIds.includes(leadId));
  if (doNegocio) return doNegocio;
  return vivos.find((c) => c.leadIds.length === 0) ?? null;
}

/** Abreviações do dia da semana, domingo = 0 (a ordem de `Date#getDay`). */
const DIAS_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

/** "10h", "10h30" — o jeito de dizer hora no Brasil, sem ":00" sobrando. */
export function horaCurta(hora: number, minuto: number): string {
  return minuto === 0 ? `${hora}h` : `${hora}h${String(minuto).padStart(2, "0")}`;
}

/**
 * "hoje 16h" · "amanhã 10h" · "sáb 03/10 10h" — no fuso do compromisso, que é
 * o fuso em que ele foi combinado. "Quinta às 14h" combinado em São Paulo
 * continua sendo 14h para quem olha o quadro, mesmo com o servidor em UTC.
 */
export function quandoDoCompromisso(
  inicio: string,
  fuso: string,
  agora: Date,
  t: Traduzir = (x) => x,
): string {
  const instante = new Date(inicio);
  const p = partesNoFuso(instante, fuso);
  const hora = horaCurta(p.hora, p.minuto);
  const diaDele = diaLocalISO(instante, fuso);
  const hoje = diaLocalISO(agora, fuso);
  const amanha = diaLocalISO(new Date(agora.getTime() + 86_400_000), fuso);
  if (diaDele === hoje) return `${t("hoje")} ${hora}`;
  if (diaDele === amanha) return `${t("amanhã")} ${hora}`;
  const semana = new Date(Date.UTC(p.ano, p.mes - 1, p.dia)).getUTCDay();
  const data = `${String(p.dia).padStart(2, "0")}/${String(p.mes).padStart(2, "0")}`;
  const anoDeHoje = partesNoFuso(agora, fuso).ano;
  const comAno = p.ano === anoDeHoje ? data : `${data}/${p.ano}`;
  return `${t(DIAS_DA_SEMANA[semana] ?? "dom")} ${comAno} ${hora}`;
}

/**
 * Onde: o detalhe que quem marcou escreveu ("Jardim das Flores"); sem ele, o
 * TIPO de local quando o tipo já diz onde (Telefone, WhatsApp, Google Meet);
 * e nada para "Presencial" sem endereço — "Presencial" sozinho não responde
 * "onde", e ocuparia a linha curta do cartão para não dizer nada.
 */
export function ondeDoCompromisso(
  c: Pick<CompromissoDoCartao, "localTipo" | "localDetalhe">,
  t: Traduzir = (x) => x,
): string | null {
  const detalhe = c.localDetalhe?.trim();
  if (detalhe) return detalhe;
  if (!c.localTipo || c.localTipo === "in_person") return null;
  return rotuloDoLocal(c.localTipo) ? t(rotuloDoLocal(c.localTipo) as string) : null;
}

export interface TextoDoCompromisso {
  /** A frase inteira — o `title` do cartão e o texto do Foco. */
  texto: string;
  oQue: string;
  onde: string | null;
  quando: string;
  /** Acontece hoje (no fuso dele): o cartão pinta de alerta e a urgência sobe. */
  hoje: boolean;
}

export function textoDoProximoCompromisso(
  c: CompromissoDoCartao,
  agora: Date,
  t: Traduzir = (x) => x,
): TextoDoCompromisso {
  const oQue = c.tipo?.trim() || c.titulo.trim() || t("Compromisso");
  const onde = ondeDoCompromisso(c, t);
  const quando = quandoDoCompromisso(c.inicio, c.fuso, agora, t);
  const hoje = diaLocalISO(new Date(c.inicio), c.fuso) === diaLocalISO(agora, c.fuso);
  return {
    texto: [oQue, onde, quando].filter(Boolean).join(" · "),
    oQue,
    onde,
    quando,
    hoje,
  };
}
