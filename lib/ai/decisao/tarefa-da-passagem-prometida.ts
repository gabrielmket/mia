/**
 * FORK MIA — a tarefa do Jev "passagem prometida": a rede de segurança da
 * passagem de bastão que o agente PROMETE e não faz.
 *
 * Mora num arquivo nosso, ao lado das do upstream, e entra na lista dele
 * (`TAREFAS_DO_JEV`, `./tarefas.ts`) por uma linha: a fusão não conflita aqui.
 * Só o TIPO vem de `./tarefas` — import de tipo não existe em runtime, então não
 * há ciclo entre os dois arquivos.
 *
 * ─── A pergunta, e por que ela existe ────────────────────────────────────────
 *
 * Medido na Vita Odonto (29/09/2026): o agente diz ao cliente "vou encaminhar
 * para a equipe, em breve entrarão em contato" com ZERO ações — nem ficha, nem
 * funil, nem caso. O cliente fica esperando um contato que o time não sabe que
 * tem de fazer. O Jev lê a resposta que SAIU e responde sim/não: "o atendente
 * disse que o atendimento está sendo passado para a equipe?".
 *
 * ─── Por que ela começa PAUSADA (e não observando, como as outras) ───────────
 *
 * A regra das tarefas novas (DEC-012 #3) as liga observando porque "observar
 * usa o dado já aceito". O aceite do Jev é o de mandar "cada mensagem DOS
 * CLIENTES"; esta tarefa manda a do ATENDENTE — outro dado, fora da letra do
 * que a empresa consentiu. Então ela nasce pausada e só roda quando o
 * administrador a liga no cartão do Jev; ligada, começa observando.
 *
 * `familia: "novo"`: não há mecanismo de hoje que responda a mesma pergunta. O
 * que ela compara é o DESFECHO do turno — se o time foi mesmo avisado —, e é daí
 * que sai o número do cartão: "prometeu passar e nada andou no mesmo turno".
 */
import type { TarefaDoJev } from "./tarefas";

export const TAREFA_DA_PASSAGEM_PROMETIDA = {
  id: "passagem_prometida",
  ponto: "handoff_promise",
  primitiva: "noul",
  alcance: "mensagem",
  familia: "novo",
  comecaPausada: true,
  aoDecidir:
    "Quando o atendente disser ao cliente que a equipe vai dar sequência e nada tiver andado no turno, o Jev abre a passagem: caso na Central e aviso no grupo do time. O funil só vai a “qualificado” se a ficha do turno existir.",
  aoDecidirNoPonto:
    "O Jev confere a resposta que saiu; se ela prometeu passar ao time e nada andou, a passagem é aberta.",
  aoConfirmarDecidir:
    "A partir de agora, promessa de passagem sem nada andando vira passagem de verdade: a conversa sai do automático, a Central e o grupo do time são avisados.",
  concordancia: {
    antes: "dias, o Jev e o que o sistema fez concordaram em",
    depois: "respostas — prometer passar ao time e o time ser mesmo avisado, ou nenhum dos dois.",
  },
  rotulo: "Pegar a passagem prometida que não aconteceu",
  oQueFaz:
    "Lê cada resposta que o ATENDENTE envia, sozinha, e percebe quando ele diz ao cliente que a equipe vai dar sequência — para ninguém ficar esperando um contato que o time não sabe que tem de fazer.",
} as const satisfies TarefaDoJev;
