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
};
