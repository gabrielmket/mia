/**
 * A PROCEDÊNCIA de uma anotação da memória da organização.
 *
 * Espelha o CHECK de `org_memory_entries.source` (migration 0252) e é cobrado por
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts`.
 *
 * ## Por que a distinção não é enfeite
 *
 * `org_memory_entries` guarda POLÍTICA DA EMPRESA — o que todos os agentes de IA
 * seguem em qualquer conversa. Quem lê essa tela precisa saber se um humano
 * assinou aquilo:
 *
 *  • `manual` ..... uma pessoa escreveu e respondeu por isso.
 *  • `flywheel` ... a destilação propôs e alguém aprovou (`lib/ai/apply-proposal.ts`).
 *  • `agent` ...... a IA anotou sozinha, pela ferramenta MCP `crm_save_org_memory`.
 *
 * ## O 23514 que este arquivo fecha
 *
 * `crm_save_org_memory` sempre gravou `source: "agent"`, e o CHECK da 0067 só
 * aceitava `manual|flywheel`: a ferramenta NUNCA funcionou — toda chamada morria
 * em `23514` e voltava ao agente como `gravar_memoria_falhou`.
 *
 * ⚠️ O conserto barato era o errado. Trocar o handler para `'manual'` é uma
 * linha e dispensa migration, e faria a anotação da IA chegar à tela
 * indistinguível de política que um gestor digitou — um erro RUIDOSO (a
 * ferramenta falha e o agente sabe) trocado por um erro SILENCIOSO (ela grava e
 * mente sobre a autoria). A descrição da própria ferramenta, que o modelo lê,
 * promete a origem `agent`.
 *
 * ## A segunda cópia, no hook do upstream — de propósito
 *
 * `hooks/ai/useOrgMemory.ts` declara o MESMO vocabulário como união literal, e a
 * cerca do upstream (`tests/unit/memoria-da-org-origem-cabe-no-check.test.ts`)
 * exige a declaração literal ALI. Na fusão da v1.60 o hook passou a reexportar
 * o tipo daqui, e a cerca reprovou. O hook voltou a ser byte a byte o do
 * upstream; as duas cópias ficam, e nenhuma é solta: esta é presa ao CHECK pelo
 * invariante de vocabulário, a do hook pela cerca. Origem nova entra nas duas.
 */
export const ORIGENS_DA_MEMORIA = ['manual', 'flywheel', 'agent'] as const;
export type OrigemDaMemoria = (typeof ORIGENS_DA_MEMORIA)[number];
