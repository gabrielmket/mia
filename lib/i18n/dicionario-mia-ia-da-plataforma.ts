/**
 * FORK MIA (MIA-218) · as frases da IA que segue a plataforma (o aviso da chave
 * e o aviso da trava em IA › Provedores), em espanhol.
 *
 * Moram num arquivo NOSSO, espalhado no `DICIONARIO` do upstream por uma linha,
 * para a sincronização com o upstream não conflitar a cada frase nova
 * (docs/FORK-MIA.md, regra 1). A chave é o texto em português.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_DA_IA_DA_PLATAFORMA: Traducoes = {
  "Usando a chave da {marca}. Nenhuma chave precisa ser cadastrada.": {
    es: "Usando la clave de {marca}. No es necesario registrar ninguna clave.",
  },
  "Opção avançada:": { es: "Opción avanzada:" },
  "cadastrar uma chave própria desta empresa": { es: "registrar una clave propia de esta empresa" },
  "A IA desta conta está sem chave para funcionar. Fale com o suporte.": {
    es: "La IA de esta cuenta no tiene clave para funcionar. Habla con soporte.",
  },
  "A IA principal desta empresa ({provedor}) está sem chave e não responde aos clientes.": {
    es: "La IA principal de esta empresa ({provedor}) no tiene clave y no responde a los clientes.",
  },
  "Escolha no padrão abaixo um provedor com chave.": {
    es: "Elige abajo, en el estándar, un proveedor con clave.",
  },
  "{n} seguem a plataforma": { es: "{n} siguen la plataforma" },
  "{n} com escolha própria": { es: "{n} con elección propia" },
  "{n} sem chave": { es: "{n} sin clave" },
  "Empresa sem chave não responde com IA. Para ver quais: plataforma_ver_ia_das_empresas no MCP de plataforma.": {
    es: "Una empresa sin clave no responde con IA. Para ver cuáles: plataforma_ver_ia_das_empresas en el MCP de plataforma.",
  },
  // MIA-262: o aviso de orçamento na Central, para quem não vê custo.
  "A IA continua respondendo normalmente — isto é o aviso, não a parada.": {
    es: "La IA sigue respondiendo con normalidad — esto es el aviso, no la detención.",
  },
  "Inteligência artificial pronta": { es: "Inteligencia artificial lista" },
  "Quando o assistente passa a conversa para alguém da equipe, ou quando a IA para.": {
    es: "Cuando el asistente pasa la conversación a alguien del equipo, o cuando la IA se detiene.",
  },
  "Não enviei: o uso de IA do plano acabou": { es: "No envié: se acabó el uso de IA del plan" },
  "o uso de IA do plano acabou": { es: "se acabó el uso de IA del plan" },
  "A ação não rodou: a regra foi gravada sem autorizar o uso de IA. Corrija a regra pela API; este passo ainda não tem tela.": {
    es: "La acción no se ejecutó: la regla se guardó sin autorizar el uso de IA. Corrige la regla por la API; este paso aún no tiene pantalla.",
  },
};
