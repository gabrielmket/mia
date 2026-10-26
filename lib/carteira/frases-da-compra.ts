/**
 * FORK MIA (.90) — as frases de "por que não dá para comprar créditos por Pix
 * agora". Módulo PURO (a tela de cliente importa; o servidor também), chaves de
 * `t()`. O motivo sai de `podeComprarCreditos` (lib/carteira/compra-pelo-asaas.ts).
 */
export type MotivoSemCompra =
  | "cobranca_desligada"
  | "sem_assinatura"
  | "sem_cliente_no_asaas"
  | "provedor_nao_e_asaas"
  | "sem_chave"
  | "sem_pacotes";

export const FRASE_SEM_COMPRA: Record<MotivoSemCompra, string> = {
  cobranca_desligada:
    "A compra de créditos por Pix não está ligada nesta instalação. Fale com a nossa equipe para recarregar.",
  sem_assinatura:
    "Sua empresa recebe créditos pela nossa equipe. Fale com a equipe para recarregar.",
  sem_cliente_no_asaas:
    "Assine o plano em Plano e cobrança antes de comprar créditos: o Pix sai no mesmo cadastro do pagamento.",
  provedor_nao_e_asaas:
    "A compra de créditos por Pix é só pelo Asaas. Fale com a nossa equipe para recarregar.",
  sem_chave:
    "A compra por Pix está indisponível agora. Tente de novo mais tarde ou fale com a nossa equipe.",
  sem_pacotes: "Ainda não há pacotes de crédito à venda.",
};

export function fraseSemCompra(motivo: string | null): string | null {
  if (motivo === null) return null;
  return Object.hasOwn(FRASE_SEM_COMPRA, motivo)
    ? FRASE_SEM_COMPRA[motivo as MotivoSemCompra]
    : FRASE_SEM_COMPRA.sem_chave;
}
