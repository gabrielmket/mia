/**
 * FORK MIA (MIA-44) · as frases das quebras do consumo de IA na aba Uso do
 * cliente (`components/admin/tenants/UsoDoTenant.tsx`), em espanhol. Os outros
 * idiomas ficam em `lib/i18n/traducoes/*.json`.
 *
 * Moram num arquivo NOSSO, espalhado no `DICIONARIO` do upstream por uma linha,
 * para a sincronização com o upstream não conflitar a cada frase nova
 * (docs/FORK-MIA.md, regra 1). A chave é o texto em português.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_DO_CONSUMO_DE_IA: Traducoes = {
  "Custo de IA por agente": { es: "Costo de IA por agente" },
  "Custo de IA por finalidade": { es: "Costo de IA por finalidad" },
  "Do cache": { es: "De la caché" },
  "Agente removido": { es: "Agente eliminado" },
  "Nenhuma chamada de IA no período.": { es: "Ninguna llamada de IA en el período." },
  "O valor em R$ é parcial: dias sem cotação": { es: "El valor en R$ es parcial: días sin cotización" },
  'Sistema são as chamadas sem agente: o resumo depois da conversa, os classificadores e a transcrição. "Do cache" é parte dos tokens de entrada.':
    {
      es: 'Sistema son las llamadas sin agente: el resumen después de la conversación, los clasificadores y la transcripción. "De la caché" es parte de los tokens de entrada.',
    },
};
