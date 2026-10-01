/**
 * FORK MIA — as capacidades que nasceram no fork, no mesmo formato do catálogo
 * do upstream (o que o HUMANO lê ao ligar a capacidade no agente).
 *
 * Arquivo próprio, e não uma entrada a mais nos domínios dele: a fusão do
 * upstream não conflita aqui, e quem procura "o que a MIA acrescentou" acha num
 * lugar só.
 */
import { declararTools } from "./tipos";

export const TOOLS_MIA = declararTools([
  {
    name: "crm_passar_para_o_comercial",
    category: "write",
    rotulo: "Passar o cliente qualificado para o comercial",
    explicacao:
      "Quando o cliente está qualificado, numa ação só: guarda o resumo da qualificação, marca as " +
      "etiquetas pedidas e avança o funil até 'qualificado' — o que avisa o time. Sem isso, o " +
      "assistente pode dizer 'vou encaminhar' e ninguém ficar sabendo.",
    oQueToca: "Funil de vendas",
    /**
     * `critico`: a passagem dispara o que está pendurado na etapa — o aviso no
     * grupo do time, o card no funil comercial — e a máquina do funil não anda
     * para trás. É efeito que sai do sistema, e por isso entra ligada à mão,
     * agente a agente, como a tela pede para o que não se desfaz.
     *
     * Em "vender" porque é o fim natural da jornada de vender e mover o funil.
     * Crítica não entra por pacote, então não come vaga do agente que nasce no
     * onboarding.
     */
    risco: "critico",
    pacotes: ["vender"],
  },
  /**
   * Documentos e obrigações (docs/fork/obrigacoes.md). As duas em "reter": é a
   * jornada de não deixar o cliente escapar por falta de acompanhamento, e
   * renovação de documento é isso. NÃO em "vender" (o pacote com que todo
   * agente nasce): duas capacidades a mais ali comeriam a folga do teto e
   * nenhum segundo pacote caberia (tests/unit/pacote-reserva-vaga-da-critica).
   * Nem em "atender": a conta da tela, que uma spec de ponta a ponta cobra,
   * sairia do lugar (tests/unit/teto-do-atender-bate-com-a-recusa-da-spec).
   */
  {
    name: "crm_listar_obrigacoes_pendentes",
    category: "read",
    rotulo: "Ver documentos e obrigações pendentes do cliente",
    explicacao:
      "O assistente consulta o que está pendente com o cliente (documento a pedir, pedido e não entregue, " +
      "vencendo ou vencido, e atividade recorrente chegando) para lembrar ou pedir na conversa.",
    oQueToca: "Documentos e obrigações",
    risco: "seguro",
    pacotes: ["reter"],
  },
  {
    name: "crm_propor_recebimento_de_documento",
    category: "write",
    rotulo: "Propor que um arquivo recebido é o documento pedido",
    explicacao:
      "Quando o cliente manda um arquivo e há um documento pedido, o assistente registra uma proposta para a " +
      "equipe conferir. Ele nunca marca o documento como recebido: uma pessoa confirma ou diz que não é.",
    oQueToca: "Documentos e obrigações",
    /**
     * `atencao`, e não `critico`: nada sai do sistema e nada é marcado. O pior
     * caso é uma proposta errada, que a pessoa recusa com um clique.
     */
    risco: "atencao",
    pacotes: ["reter"],
  },
]);
