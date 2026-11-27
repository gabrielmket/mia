/**
 * FORK MIA (MIA-262) — O ESTADO DA BASE DE CONHECIMENTO, SEM A IA DA PLATAFORMA.
 *
 * A tela "O que o agente sabe" recebia, para todo gerente, a chave de
 * embedding em uso (rótulo e final), a lista das chaves da empresa e a troca do
 * provedor que prepara a base (que refaz a base inteira). Embedding é IA da
 * plataforma (`lib/ai/custo-e-da-plataforma.ts`): para quem não escolhe a IA
 * (`escolheIa`), sobra só o que diz se o material vai ser preparado.
 *
 * Sem `import` de servidor: a tela de cliente usa o tipo.
 */
import type { EstadoDaChave } from "@/lib/ai/embeddings/estado";

export function estadoDaChaveAoCliente(estado: EstadoDaChave, escolheIa: boolean): EstadoDaChave {
  if (escolheIa) return estado;
  return {
    ...estado,
    origem: null,
    explicacao: null,
    chave_em_uso: null,
    avisos: [],
    provedor: null,
    familia_sem_chave: null,
    pode_trocar_para: null,
    credenciais_embedding: [],
  };
}
