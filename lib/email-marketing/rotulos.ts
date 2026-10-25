/**
 * FORK MIA (.89) — os RÓTULOS que as telas do e-mail mostram, num módulo sem
 * dependência de servidor (as telas importam daqui; `supressao.ts` usa
 * `node:crypto` e não pode ir para o navegador). São chaves do dicionário.
 */
import type { MotivoDaSupressao } from "./elegibilidade";

export const ROTULO_DA_SUPRESSAO: Record<MotivoDaSupressao, string> = {
  descadastro: "Descadastro",
  rejeicao: "Rejeição",
  reclamacao: "Reclamação",
  manual: "Pedido à equipe",
  importada: "Importada",
};

/** O estado de uma campanha de e-mail, na voz da tela. */
export const ROTULO_DO_STATUS_DA_CAMPANHA: Record<string, string> = {
  rascunho: "Rascunho",
  agendada: "Agendada",
  enviando: "Enviando",
  pausada: "Pausada",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

/** Por que a campanha parou, na voz da tela (o código mora em `motivo_da_pausa`). */
export const ROTULO_DA_PAUSA: Record<string, string> = {
  saldo_insuficiente: "Pausada: o crédito acabou. Recarregue e retome.",
  organizacao_de_demonstracao: "Pausada: esta é a empresa de demonstração, e nada sai daqui.",
  amazon_desligada: "Pausada: o envio pela Amazon foi desligado no servidor.",
  dominio_nao_verificado: "Pausada: o domínio deixou de estar verificado.",
  amazon_pausou_a_conta: "Pausada: a Amazon pausou o envio da conta.",
  // FORK MIA (.90): o módulo saiu do plano da empresa (jornada de assinatura).
  modulo_nao_contratado: "Pausada: o e-mail marketing não faz parte do plano atual da empresa. A lista e os números ficam guardados.",
};

/**
 * O que trava o envio, na voz da tela, pelo código da trava. A conferência
 * devolve também o texto em português (é o que o MCP lê); a tela traduz por aqui.
 */
export const ROTULO_DA_TRAVA: Record<string, string> = {
  modulo: "O módulo de e-mail marketing não está contratado.",
  amazon: "O envio pela Amazon ainda não foi ligado no servidor.",
  dominio: "O domínio do remetente ainda não está verificado.",
  rodape: "O rodapé está incompleto.",
  remetente: "Falta cadastrar um remetente.",
  publico: "Ninguém entra na lista.",
  lia: "Interesse legítimo pede a referência da avaliação (LIA).",
  assunto: "Falta o assunto.",
  botao: "Há botão sem endereço válido.",
  imagem: "Há bloco de imagem sem imagem.",
  teste: "Envie um teste da versão atual.",
  agendamento: "A data do agendamento já passou.",
  saldo: "O crédito não cobre a lista.",
  demonstracao: "Esta é a empresa de demonstração: nenhuma mensagem, e-mail ou aviso sai daqui.",
};

/** Por que o dia do plano parou onde parou. */
export const ROTULO_DO_LIMITE_DO_DIA: Record<string, string> = {
  fim: "acaba a lista",
  aquecimento: "teto do aquecimento",
  ritmo: "ritmo e janela",
};
