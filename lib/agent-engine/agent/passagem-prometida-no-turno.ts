/**
 * FORK MIA — a REDE DE SEGURANÇA da passagem prometida, no fim do turno.
 *
 * ─── O defeito ───────────────────────────────────────────────────────────────
 *
 * O agente diz ao cliente "vou encaminhar para a equipe, em breve entrarão em
 * contato" e não faz nada: nem ficha, nem funil, nem caso. Medido na Vita
 * Odonto em 29/09/2026 — é a falha "muda", a pior: o cliente espera um contato
 * que o time não sabe que tem de fazer. A ferramenta `crm_passar_para_o_comercial`
 * reduz a chance; esta peça pega o que ainda escapar.
 *
 * ─── Quando roda, e por que no FIM do turno ──────────────────────────────────
 *
 * Depois que a resposta já SAIU — o cliente não espera por isto — e depois de
 * todas as ferramentas do turno: o modelo pode mandar a mensagem e só então
 * chamar a passagem, e perguntar no envio acusaria uma promessa que ele cumpriu
 * três segundos depois. Roda dentro do escopo do job (e não solta num `void`):
 * a passagem para humano confere a fronteira do atendimento, e fora do job ela
 * recusaria. O custo é o teto da pergunta ao Jev (1,5 s) no fim do job, com o
 * cliente já respondido. Nunca lança: é rede de segurança, não pode derrubar o
 * turno que ela vigia.
 *
 * ─── O que faz com a resposta ────────────────────────────────────────────────
 *
 * OBSERVANDO (o estado ao ligar): só mede e grava — a promessa, e se o time foi
 * avisado no mesmo turno. O cartão do Jev mostra quantas vezes ele prometeu e
 * nada andou.
 *
 * DECIDINDO, com promessa acima do limiar e NADA andou no turno:
 *  1. abre o bastão pelo caminho da passagem para humano do motor
 *     (`performHumanHandoff` — o que o `request_human_handoff` do turno usa): caso
 *     na Central e aviso no grupo do time, com o texto que o atendente mandou. Não
 *     manda nada ao cliente — ele já ouviu a promessa;
 *  2. só leva o funil a `qualified` se a FICHA do turno existir — a frase sozinha
 *     não qualifica ninguém, e o card no comercial sem resumo é conversa crua.
 * Idempotente: a observação é única por mensagem, e só a observação NOVA age; a
 * Central deduplica o item aberto, e o funil já qualificado não anda de novo.
 */
import type pg from "pg";

import {
  perguntarPassagemPrometidaAoJev,
  registrarPassagemPrometidaDoJev,
  type RotuloDaPassagem,
} from "@/lib/ai/decisao/passagem-prometida";
import type { DependenciasDoPonto } from "@/lib/ai/decisao/ponto";

import type { CrmEdgeConfig } from "../edge/crm/mcp-client";
import type { Logger } from "../obs/logger";
import { caminharAteQualificado } from "./caminhar-ate-qualificado";
import { performHumanHandoff } from "./human-handoff";

export interface EntradaDaVigia {
  pool: pg.Pool;
  crm: CrmEdgeConfig;
  tenantId: string;
  /** No motor, o "lead" é o CONTATO. */
  contactId: string;
  conversationId: string;
  jobId: string;
  /** O que saiu para o cliente neste turno (depois da cadeia de envio). */
  textos: readonly string[];
  /** As mensagens que saíram — a primeira é a chave da observação. */
  messageIds: readonly string[];
  /** Caso aberto neste turno (`open_human_case`) — o time foi avisado por ele. */
  abriuCaso: boolean;
  /** Quando o turno começou: a ficha "do turno" é a salva depois disto. */
  inicioDoTurno: Date;
  log: Logger;
  jev?: DependenciasDoPonto;
}

export type DesfechoDaVigia =
  | { rodou: false }
  | { rodou: true; rotuloJev: RotuloDaPassagem; rotuloAtual: RotuloDaPassagem; agiu: false }
  | { rodou: true; rotuloJev: "passou"; rotuloAtual: "nao_passou"; agiu: true; qualificou: boolean };

/**
 * O time foi avisado NESTE turno? O funil do agente chegou a qualificado (pela
 * ferramenta nova ou pelo `update_lead_state` — os dois gravam a transição com o
 * job), ou houve passagem para humano, ou caso aberto.
 */
async function oTimeFoiAvisado(e: EntradaDaVigia): Promise<boolean> {
  if (e.abriuCaso) return true;
  const { rows } = await e.pool.query<{ avisado: boolean }>(
    `select exists (
       select 1 from lead_state_transitions
        where organization_id = $1 and contact_id = $2 and job_id = $3
          and to_stage in ('qualified', 'negotiating', 'won')
     ) or exists (
       select 1 from conversations
        where organization_id = $1 and id = $4 and last_handoff_at >= $5
     ) as avisado`,
    [e.tenantId, e.contactId, e.jobId, e.conversationId, e.inicioDoTurno.toISOString()],
  );
  return rows[0]?.avisado === true;
}

/** A ficha salva NESTE turno, se houver — é ela que autoriza qualificar. */
async function fichaDoTurno(e: EntradaDaVigia): Promise<{ headline: string; body: string } | null> {
  const { rows } = await e.pool.query<{ headline: string; body: string }>(
    `select headline, body from lead_notes
      where organization_id = $1 and contact_id = $2 and created_at >= $3
      order by created_at desc limit 1`,
    [e.tenantId, e.contactId, e.inicioDoTurno.toISOString()],
  );
  return rows[0] ?? null;
}

/** O que o time lê no grupo e na Central: o que foi prometido, e a ficha quando há. */
function resumoParaOTime(texto: string, ficha: { headline: string; body: string } | null): string {
  const partes = [`O assistente disse ao cliente: «${texto.trim()}»`];
  if (ficha) partes.push(`Ficha: ${ficha.headline} — ${ficha.body}`);
  else partes.push("Não houve ficha de qualificação neste atendimento: confira a conversa antes de ligar.");
  return partes.join("\n\n");
}

export async function vigiarPassagemPrometida(e: EntradaDaVigia): Promise<DesfechoDaVigia> {
  try {
    const texto = e.textos.join("\n").trim();
    if (texto === "" || e.messageIds.length === 0) return { rodou: false };

    const jev = await perguntarPassagemPrometidaAoJev(
      e.pool,
      { organizationId: e.tenantId, mensagem: texto, contactId: e.contactId, jobId: e.jobId },
      e.jev,
    );
    if (jev === null) return { rodou: false };

    const rotuloAtual: RotuloDaPassagem = (await oTimeFoiAvisado(e)) ? "passou" : "nao_passou";
    const vaiAgir = jev.estado === "decidindo" && jev.rotulo === "passou" && rotuloAtual === "nao_passou";

    const nova = await registrarPassagemPrometidaDoJev(e.pool, {
      organizationId: e.tenantId,
      contactId: e.contactId,
      conversationId: e.conversationId,
      messageId: e.messageIds[0] ?? null,
      jobId: e.jobId,
      jev,
      rotuloAtual,
      decidiu: vaiAgir,
    });

    if (jev.rotulo === "passou" && rotuloAtual === "nao_passou") {
      // Sistema vivo: a promessa sem ação aparece no log do turno SEMPRE — também
      // observando, que é quando ninguém age e só o número do cartão a conta.
      e.log.warn("passagem prometida ao cliente sem o time ser avisado no turno", {
        estado: jev.estado,
        probabilidade: Number(jev.probabilidade.toFixed(3)),
        age: vaiAgir && nova,
      });
    }
    // Só a observação NOVA age: o retry do job não abre a passagem de novo.
    if (!vaiAgir || !nova) return { rodou: true, rotuloJev: jev.rotulo, rotuloAtual, agiu: false };

    const ficha = await fichaDoTurno(e);
    await performHumanHandoff(
      e.pool,
      { tenantId: e.tenantId, leadId: e.contactId, conversationId: e.conversationId },
      {
        reason: "passagem_prometida",
        conversationSummary: resumoParaOTime(texto, ficha),
        inboxTitle: "O assistente prometeu passar ao time — assumir a conversa",
        // O cliente JÁ foi avisado — pela própria resposta que disparou esta
        // passagem ("vou encaminhar para a equipe…"). Mandar o aviso padrão de
        // escalação por cima repetiria a mesma frase; declarar o desfecho é o que
        // a guarda `tests/unit/handoff-avisa-o-lead.test.ts` pede, e é o que faz o
        // item da Central dizer a verdade a quem assume.
        avisoAoLead: { avisado: true },
        log: e.log,
      },
    );

    let qualificou = false;
    if (ficha) {
      const caminho = await caminharAteQualificado(
        e.pool,
        e.crm,
        { tenantId: e.tenantId, contactId: e.contactId, jobId: e.jobId },
        { motivo: "O assistente prometeu passar ao time e a ficha do atendimento estava salva (rede de segurança do Jev)." },
      );
      qualificou = caminho.ok;
      if (!caminho.ok && caminho.motivo !== "ja_passou") {
        e.log.warn("a rede de segurança abriu a passagem, mas o funil não andou", { motivo: caminho.motivo });
      }
    }
    e.log.info("rede de segurança do Jev abriu a passagem prometida", { qualificou, com_ficha: ficha !== null });
    return { rodou: true, rotuloJev: "passou", rotuloAtual: "nao_passou", agiu: true, qualificou };
  } catch (err) {
    e.log.error("rede de segurança da passagem prometida falhou (o turno segue)", {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return { rodou: false };
  }
}
