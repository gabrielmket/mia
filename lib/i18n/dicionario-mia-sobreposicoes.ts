/**
 * FORK MIA (MIA-372) · as frases em que a NOSSA tradução vence a do upstream
 * para a mesma chave.
 *
 * É o contrário da regra dos outros arquivos `dicionario-mia-*`: lá, chave
 * igual do upstream prevalece; aqui, prevalece a nossa. Por isso cada linha
 * precisa de motivo, e a lista é curta de propósito. `lib/i18n/dicionario-mia.ts`
 * aplica estas DEPOIS do dicionário do upstream, trocando a entrada inteira
 * (todos os idiomas dela).
 *
 * Antes da MIA-372 estas linhas moravam no meio do `lib/i18n/dicionario.ts` do
 * upstream, numa posição depois da dele, ou no lugar da dele. Mudaram de
 * arquivo sem mudar texto.
 */
import type { Idioma } from "./idiomas";

type Traducoes = Record<string, Partial<Record<Exclude<Idioma, "pt-BR">, string>>>;

export const DICIONARIO_SOBREPOSICOES_MIA: Traducoes = {
  // O financeiro: o upstream traduz "Estornar" como "Anular", "estornada" como
  // "anulada" e "Avulso" como "Suelto". Ficam as NOSSAS porque as telas desta
  // árvore já dizem "Reembolsar". Se o financeiro em espanhol for revisado,
  // reveja as três JUNTAS: "anular" é desfazer o lançamento, "reembolsar" é
  // devolver o dinheiro, e a tela não pode dizer as duas coisas na mesma operação.
  "Estornar": { es: "Reembolsar" },
  estornada: { es: "reembolsada" },
  "Avulso": { es: "Puntual" },

  // O relatório de vendas do mês. O upstream tem a mesma chave no painel do
  // Google Ads (`lib/i18n/painel-google-ads.ts`), com o mesmo espanhol e mais o
  // inglês "Win rate". A nossa entrada não tem inglês, e o `traducoes/en.json`
  // também não tem a chave: em inglês a tela mostra o português, como já
  // mostrava antes da MIA-372. Tirar esta linha faz o inglês dizer "Win rate";
  // é mudança visível, e por isso não entrou na MIA-372.
  "Taxa de ganho": { es: "Tasa de cierre" },

  // O arquivo da campanha, sem hospedagem. O upstream diz "Subiendo el
  // archivo…" no arquivo da abordagem (`lib/i18n/prospeccao-arquivo-da-abordagem.ts`).
  "Enviando o arquivo…": { es: "Enviando el archivo…" },

  // O segredo copiado (tokens e integrações). O upstream diz "Ya copié".
  "Já copiei": {
    es: "Ya lo copié",
  },
};
