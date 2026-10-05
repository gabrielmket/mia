/**
 * FORK MIA: as frases de tela dos relatórios e das metas que são nossas
 * (components/metas/, a carteira e os painéis de custo), em espanhol.
 *
 * Moram num arquivo NOSSO, espalhado no fim do `DICIONARIO` do upstream por uma
 * linha (`...DICIONARIO_RELATORIOS_MIA`), como as dos cartões e das obrigações:
 * a sincronização com o upstream não conflita a cada frase nova
 * (docs/FORK-MIA.md, regra 1). A chave é o texto em português.
 *
 * As frases antigas de metas e do relatório de vendas ainda moram no dicionário
 * dele (entraram antes desta regra); as novas entram aqui.
 *
 * ⚠️ Não repita aqui uma chave que o upstream (ou outro arquivo nosso) já
 * traduz: o espalhamento vem por último e VENCERIA a tradução de lá em
 * silêncio.
 */
type Traducoes = Record<string, { es: string }>;

export const DICIONARIO_RELATORIOS_MIA: Traducoes = {
  // ─── o aviso de leitura cortada (lib/leitura/todas-as-paginas.ts) ──────────
  // Mesma forma da frase do upstream no relatório por etiqueta ("O período
  // passou do limite de leitura: …"), dizendo o que ficou de fora em cada tela.
  "O período passou do limite de leitura: os números contam só os negócios fechados mais recentes.": {
    es: "El período superó el límite de lectura: los números cuentan solo los negocios cerrados más recientes.",
  },
  "O mês passou do limite de leitura: os números contam só as vendas e as reuniões mais recentes.": {
    es: "El mes superó el límite de lectura: los números cuentan solo las ventas y las reuniones más recientes.",
  },
  // A carteira (lib/carteira/ler-saldo.ts): a tela do cliente e a do painel.
  "O extrato passou do limite de leitura: o saldo soma só os lançamentos mais recentes.": {
    es: "El extracto superó el límite de lectura: el saldo suma solo los movimientos más recientes.",
  },
  // O saldo do provedor de IA (lib/ai/custo/consumo-de-ia.ts), no painel.
  "O consumo passou do limite de leitura: a conta inclui só as chamadas mais recentes, e o saldo real é menor que o mostrado.": {
    es: "El consumo superó el límite de lectura: la cuenta incluye solo las llamadas más recientes, y el saldo real es menor que el mostrado.",
  },
};
