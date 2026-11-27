/**
 * FORK MIA (MIA-250 D) · as frases do LIMITE DE AGENTES DE IA POR PLANO
 * (lib/planos-mia/limite-de-agentes.ts), em espanhol e inglês. O produto serve hoje
 * pt-BR e es (`lib/i18n/idiomas.ts`); o `en` fica pronto aqui para quando o
 * idioma for ligado (o `DICIONARIO` já aceita a coluna).
 *
 * Mora num arquivo NOSSO, espalhado no `DICIONARIO` do upstream por uma linha,
 * para a sincronização com o upstream não conflitar a cada frase nova
 * (docs/FORK-MIA.md, regra 1). A chave é o texto em português.
 *
 * ⚠️ O texto é PROPOSTA (desenho da MIA-258, seção 8): só chega ao cliente
 * quando um plano tiver teto de agentes, e o teto é decisão da MIA-249.
 */
type Traducoes = Record<string, { en: string; es: string }>;

export const DICIONARIO_DO_LIMITE_DE_AGENTES: Traducoes = {
  // ── criar ou duplicar acima do teto (o 409 plan_limit_reached) ──
  "Seu plano permite 1 agente de IA e ele já foi criado. Arquive um agente em Agentes de IA ou troque de plano em Configurações › Plano e cobrança.":
    {
      en: "Your plan allows 1 AI agent and it has already been created. Archive an agent in AI agents or change your plan in Settings › Plan and billing.",
      es: "Tu plan permite 1 agente de IA y ya fue creado. Archiva un agente en Agentes de IA o cambia de plan en Configuración › Plan y facturación.",
    },
  "Seu plano permite {n} agentes de IA e todos já foram criados. Arquive um agente em Agentes de IA ou troque de plano em Configurações › Plano e cobrança.":
    {
      en: "Your plan allows {n} AI agents and all of them have already been created. Archive an agent in AI agents or change your plan in Settings › Plan and billing.",
      es: "Tu plan permite {n} agentes de IA y todos ya fueron creados. Archiva un agente en Agentes de IA o cambia de plan en Configuración › Plan y facturación.",
    },
  // ── a troca de plano que não cabe (a lista "Para trocar, primeiro:") ──
  "Arquive {n} agente(s) de IA em Agentes de IA.": {
    en: "Archive {n} AI agent(s) in AI agents.",
    es: "Archiva {n} agente(s) de IA en Agentes de IA.",
  },
  // ── o formulário do admin (Cobrança › Módulos dos planos) ──
  "Agentes de IA (vazio = sem limite)": {
    en: "AI agents (empty = no limit)",
    es: "Agentes de IA (vacío = sin límite)",
  },
  "Número de agentes inválido: use de 1 a 1000, ou deixe vazio.": {
    en: "Invalid number of agents: use 1 to 1000, or leave it empty.",
    es: "Número de agentes no válido: usa de 1 a 1000, o déjalo vacío.",
  },
};
