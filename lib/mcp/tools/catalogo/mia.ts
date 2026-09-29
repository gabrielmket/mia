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
]);
