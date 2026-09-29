/**
 * FORK MIA — as frases do Broadcast que mais de uma tela diz.
 *
 * Um literal por ramo, dentro de `t()`: a catraca do espanhol
 * (`tests/unit/i18n-espanhol-cobre-a-tela.test.ts`) lê o texto no próprio
 * código, e uma tabela montada em outro lugar é o jeito mais curto de uma frase
 * nova sair sem tradução.
 */
import type { StatusDaCampanha } from "@/lib/campanhas/tipos";

type T = (texto: string) => string;

/** A situação no vocabulário das Campanhas — o mesmo para os dois canais na lista. */
export function rotuloDaSituacao(status: StatusDaCampanha, t: T): string {
  switch (status) {
    case "draft":
      return t("Rascunho");
    case "preparing":
      return t("Montando a lista");
    case "ready":
      return t("Pronta para iniciar");
    case "scheduled":
      return t("Agendada");
    case "running":
      return t("Enviando");
    case "paused":
      return t("Pausada");
    case "completed":
      return t("Concluída");
    case "cancelled":
      return t("Cancelada");
    case "failed":
      return t("Falhou");
  }
}

/**
 * Por que o disparo oficial não sai (ou parou). Vem da API como código: tela
 * que mostra `saldo_insuficiente` a quem opera obriga a pessoa a traduzir de
 * cabeça, e ela não sabe o que fazer com isso.
 */
export function fraseDoMotivo(
  motivo: string | null | undefined,
  t: T,
  /** Já traduzida por quem chama: "não dá para disparar" não serve de motivo de PARADA. */
  seDesconhecido?: string,
): string {
  switch (motivo) {
    case "sem_preco_acordado":
      return t("Ainda não há preço por mensagem acordado para esta empresa.");
    case "saldo_insuficiente":
      return t("O crédito não cobre a lista inteira.");
    case "template_nao_aprovado":
      return t("Este template ainda não foi aprovado pela Meta.");
    case "sem_canal":
      return t("Nenhum número oficial conectado.");
    case "numero_em_risco":
      return t("O número está com qualidade baixa na Meta — disparar agora acelera o bloqueio.");
    case "lista_vazia":
      return t("Nenhum contato entrou na lista.");
    case "saldo_acabou":
      return t("O crédito acabou no meio do disparo.");
    default:
      return seDesconhecido ?? t("Não dá para disparar ainda.");
  }
}
