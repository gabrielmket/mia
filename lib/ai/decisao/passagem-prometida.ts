/**
 * FORK MIA — a pergunta da "passagem prometida" ao Jev, e o registro dela.
 *
 * Só PERGUNTA e GRAVA. Quem age sobre a resposta mora fora de `lib/ai/decisao/`
 * (`lib/agent-engine/agent/passagem-prometida-no-turno.ts`): o Jev nunca cala,
 * bloqueia nem responde ninguém sozinho (`tests/unit/jev-nunca-cala-bloqueia-nem-responde.test.ts`),
 * e o desenho é o do clima — o sinal sai daqui; a passagem, pelo caminho de
 * sempre.
 *
 * ─── Os rótulos gravados ─────────────────────────────────────────────────────
 *
 * `rotulo_jev`: `passou` quando a probabilidade de "sim" alcança o limiar,
 * `nao_passou` abaixo dele. `rotulo_atual`: o que o SISTEMA fez no mesmo turno —
 * `passou` se o time foi avisado (o funil chegou a qualificado, ou houve
 * passagem para humano, ou caso aberto), `nao_passou` se não. `concordou` (coluna
 * gerada) é a concordância; e `rotulo_jev = passou` com `rotulo_atual =
 * nao_passou` é o número que o cartão mostra: a promessa que ninguém cumpriu.
 */
import type pg from "pg";

import { costCents } from "@/lib/agent-engine/edge/llm/pricing";
import { logger } from "@/lib/logger";
import { scrubMessage } from "@/lib/sentry/scrub";

import type { EstadoQuePergunta } from "./config";
import { podeTentar, registrarFalha, registrarSucesso } from "./disjuntor";
import { estadoDaTarefaNoPool, registrarFalhaQuePedeAcao } from "./pool";
import { decidirNoPonto, type DependenciasDoPonto } from "./ponto";
import { TAREFA_DA_PASSAGEM_PROMETIDA } from "./tarefa-da-passagem-prometida";

/**
 * O limiar do "sim". PONTO DE PARTIDA, não calibração: sem observação nenhuma
 * ainda, 0,8 favorece não abrir passagem por engano (o custo de abrir sem
 * motivo é tirar a conversa do automático). A calibração é ler as observações
 * (`jev_observacoes`, `probabilidade_jev` contra `rotulo_atual`) depois de uns
 * dias observando, ANTES de deixar decidir — e mudar este número se preciso.
 */
export const LIMIAR_DA_PASSAGEM_PROMETIDA = 0.8;

export type RotuloDaPassagem = "passou" | "nao_passou";

const INSTRUCAO =
  "Nesta mensagem, o atendente diz ao cliente que o atendimento está sendo encaminhado ou passado para a equipe, que vai dar sequência ou entrar em contato?";

const CRITERIOS = {
  true:
    "A mensagem diz ao cliente que outra pessoa ou a equipe vai assumir, dar sequência, retornar ou entrar em contato — por exemplo: 'vou encaminhar para a equipe', 'em breve nossa equipe entra em contato', 'já passei seu contato para o comercial'.",
  false:
    "A mensagem continua o próprio atendimento: responde, pergunta, oferece horário, confirma um agendamento ou se despede sem prometer que outra pessoa vai assumir.",
};

export interface PassagemPrometidaDoJev {
  estado: EstadoQuePergunta;
  /** Probabilidade de "sim" (o `noul`). */
  probabilidade: number;
  rotulo: RotuloDaPassagem;
  modelo: string;
  tokensDeEntrada: number;
  tokensDeSaida: number;
  latenciaMs: number;
}

export function rotuloDaProbabilidade(p: number): RotuloDaPassagem {
  return p >= LIMIAR_DA_PASSAGEM_PROMETIDA ? "passou" : "nao_passou";
}

/**
 * Pergunta ao Jev sobre a RESPOSTA que o atendente enviou. `null` = não houve
 * resposta (tarefa pausada, sem chave, disjuntor, falha) — e aí nada muda.
 */
export async function perguntarPassagemPrometidaAoJev(
  pool: pg.Pool,
  entrada: { organizationId: string; mensagem: string; contactId?: string | null; jobId?: string | null },
  deps: DependenciasDoPonto = {},
): Promise<PassagemPrometidaDoJev | null> {
  if (entrada.mensagem.trim() === "") return null;
  const estado = await estadoDaTarefaNoPool(pool, entrada.organizationId, TAREFA_DA_PASSAGEM_PROMETIDA);
  if (estado === "desligada") return null;

  const alvo = { organizationId: entrada.organizationId, tarefa: TAREFA_DA_PASSAGEM_PROMETIDA.id };
  if (!podeTentar(alvo)) return null;

  const r = await decidirNoPonto(
    {
      ponto: "handoff_promise",
      organizationId: entrada.organizationId,
      // CPF, telefone e e-mail saem do texto antes de ir para fora, como nas outras.
      estado: scrubMessage(entrada.mensagem),
      perguntas: { passagem: { tipo: "noul", instrucao: INSTRUCAO, criterios: CRITERIOS } },
    },
    deps,
  );
  if (!r.ok) {
    registrarFalha(alvo, r.motivo, Date.now(), r.retryAfterMs);
    if (r.motivo !== "sem_credencial") {
      logger.warn("Jev não respondeu sobre a passagem prometida; nada muda no turno", {
        organization_id: entrada.organizationId,
        motivo: r.motivo,
      });
    }
    if (r.exigeAcao) await registrarFalhaQuePedeAcao(pool, { ...entrada, purpose: "handoff_promise" }, r);
    return null;
  }

  const resposta = r.respostas["passagem"];
  if (resposta?.tipo !== "noul" || !Number.isFinite(resposta.noul)) {
    registrarFalha(alvo, "resposta_ilegivel", Date.now());
    logger.warn("Jev respondeu fora do sim/não da passagem prometida; nada muda no turno", {
      organization_id: entrada.organizationId,
    });
    return null;
  }

  registrarSucesso(alvo);
  const probabilidade = Math.min(1, Math.max(0, resposta.noul));
  return {
    estado,
    probabilidade,
    rotulo: rotuloDaProbabilidade(probabilidade),
    modelo: r.modelo,
    tokensDeEntrada: r.uso.tokensDeEntrada,
    tokensDeSaida: r.uso.tokensDeSaida,
    latenciaMs: r.latenciaMs,
  };
}

export interface RegistroDaPassagemPrometida {
  organizationId: string;
  contactId: string | null;
  conversationId: string | null;
  /** A (primeira) mensagem que saiu no turno — a chave da observação. */
  messageId: string | null;
  jobId: string | null;
  jev: PassagemPrometidaDoJev;
  /** O que o sistema fez no turno: o time foi avisado? */
  rotuloAtual: RotuloDaPassagem;
  /** O Jev decidiu e a passagem foi aberta por causa dele. */
  decidiu: boolean;
}

/**
 * Grava a observação e a chamada. Devolve `true` quando a observação é NOVA —
 * o retry do job pergunta de novo sobre a MESMA mensagem, e é esta resposta que
 * impede a passagem de ser aberta duas vezes pelo mesmo turno.
 */
export async function registrarPassagemPrometidaDoJev(
  pool: pg.Pool,
  r: RegistroDaPassagemPrometida,
): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ nova: boolean }>(
      `with observacao as (
         insert into public.jev_observacoes
           (organization_id, tarefa, estado, conversation_id, message_id, job_id,
            rotulo_jev, probabilidade_jev, confianca_jev, rotulo_atual, modelo, latencia_ms)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11)
         on conflict (organization_id, tarefa, message_id) where message_id is not null do nothing
         returning id
       ), chamada as (
         insert into public.llm_calls
           (organization_id, contact_id, job_id, purpose, provider, model,
            input_tokens, output_tokens, cost_cents, latency_ms, status, origem_da_escolha)
         values ($1, $12, $6, 'handoff_promise', 'typesafe', $13, $14, $15, $16, $11, 'ok', $17)
       )
       select exists (select 1 from observacao) as nova`,
      [
        r.organizationId,
        TAREFA_DA_PASSAGEM_PROMETIDA.id,
        r.jev.estado,
        r.conversationId,
        r.messageId,
        r.jobId,
        r.jev.rotulo,
        r.jev.probabilidade,
        r.rotuloAtual,
        r.jev.modelo,
        r.jev.latenciaMs,
        r.contactId,
        `typesafe/${r.jev.modelo}`,
        r.jev.tokensDeEntrada,
        r.jev.tokensDeSaida,
        costCents(r.jev.modelo, {
          inputTokens: r.jev.tokensDeEntrada,
          outputTokens: r.jev.tokensDeSaida,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
        r.decidiu ? "jev" : "jev_observacao",
      ],
    );
    return rows[0]?.nova === true;
  } catch (erro) {
    logger.warn("observação do Jev sobre a passagem prometida não foi gravada", {
      organization_id: r.organizationId,
      erro: erro instanceof Error ? erro.message.slice(0, 200) : typeof erro,
    });
    return false;
  }
}
