/**
 * FORK MIA (.101) · O QUE O RAIO-X PROCURA EM CADA SEGMENTO. PURO.
 *
 * O segmento muda o que o relatório procura nas conversas (numa revenda: visita,
 * financiamento, troca; numa clínica: avaliação, convênio, retorno) e o que conta
 * como "chama para o próximo passo". Os rótulos daqui são as CHAVES do
 * dicionário (`lib/i18n/dicionario-mia-raio-x.ts`): a tela as passa por `t()`.
 *
 * ── A versão dos critérios ────────────────────────────────────────────────
 *
 * `CRITERIOS_VERSAO` vai gravada em cada relatório (decisão 13). Mudou o que se
 * pede ao modelo, a lista de assuntos ou de desfechos, ou a régua da nota de
 * rapidez? Suba a versão: a comparação com o raio-X anterior passa a mostrar a
 * nota com aviso, em vez de comparar notas de réguas diferentes.
 */
import type { Segmento } from "./regras";

export const CRITERIOS_VERSAO = "2026-11-v1";

/** De onde veio o cliente, pela primeira mensagem (e pelo clique no anúncio, quando houver). */
export const ORIGENS = ["anuncio_meta", "instagram", "portal", "google_site", "indicacao", "sem_identificacao"] as const;
export type Origem = (typeof ORIGENS)[number];

export const ROTULO_DA_ORIGEM: Record<Origem, string> = {
  anuncio_meta: "Anúncio no Meta (mensagem pronta do anúncio)",
  instagram: "Instagram, direto no perfil",
  portal: "Portais e marketplaces",
  google_site: "Google e site",
  indicacao: "Indicação",
  sem_identificacao: "Sem identificação",
};

/** Como a conversa terminou. `sem_resposta` sai do relógio, nunca do modelo. */
export const DESFECHOS = [
  "agendou",
  "negociando",
  "fechou",
  "pediu_proposta_sem_retorno",
  "sumiu",
  "sem_resposta",
  "sem_interesse",
  "outros_assuntos",
] as const;
export type Desfecho = (typeof DESFECHOS)[number];

/** Desfechos ruins para o atendimento (vermelho) e de atenção (amarelo) na barra. */
export const DESFECHOS_RUINS: readonly Desfecho[] = ["pediu_proposta_sem_retorno", "sem_resposta"];
export const DESFECHOS_DE_ATENCAO: readonly Desfecho[] = ["sumiu"];

/** Os cinco critérios da nota (decisão aprovada). `rapidez` sai do relógio. */
export const CRITERIOS = ["rapidez", "responde_o_perguntado", "proximo_passo", "volta_a_chamar", "educacao"] as const;
export type Criterio = (typeof CRITERIOS)[number];

export const ROTULO_DO_CRITERIO: Record<Criterio, string> = {
  rapidez: "rapidez",
  responde_o_perguntado: "responde o que foi perguntado",
  proximo_passo: "chama para o próximo passo",
  volta_a_chamar: "volta a chamar quem sumiu",
  educacao: "educação e clareza",
};

export interface DefinicaoDoSegmento {
  rotulo: string;
  /** O que conta como "próximo passo" (vai ao modelo, em português). */
  proximoPasso: string;
  /** Os assuntos que o relatório conta (chave → rótulo da tela). */
  assuntos: Record<string, string>;
  /** O rótulo de cada desfecho neste segmento. */
  desfechos: Record<Desfecho, string>;
  /** Exemplos de portal, para o modelo reconhecer a origem. */
  portais: string;
}

const DESFECHOS_COMUNS = {
  negociando: "Negociação em andamento",
  pediu_proposta_sem_retorno: "Pediu proposta e a loja não voltou",
  sumiu: "Cliente sumiu depois da primeira resposta",
  sem_resposta: "Ficou sem resposta",
  sem_interesse: "Desistiu ou não tinha interesse",
  outros_assuntos: "Outros assuntos (fornecedor, pós-venda)",
} as const;

export const DEFINICOES: Record<Segmento, DefinicaoDoSegmento> = {
  revenda_de_veiculos: {
    rotulo: "Revenda de veículos",
    proximoPasso: "convidar para visita ou test drive, simular o financiamento, avaliar a troca",
    assuntos: {
      preco: 'Preço ou "ainda está disponível?"',
      financiamento: "Financiamento e entrada",
      troca: "Troca do carro atual",
      endereco_horario: "Endereço e horário",
      procedencia: "Laudo e procedência",
      outro: "Outros assuntos",
    },
    desfechos: { ...DESFECHOS_COMUNS, agendou: "Agendou visita", fechou: "Venda confirmada na conversa" },
    portais: "OLX, Webmotors, Seminovos, iCarros, Mobiauto",
  },
  clinica_odontologica: {
    rotulo: "Clínica odontológica",
    proximoPasso: "agendar a avaliação, confirmar o horário, explicar o convênio ou a forma de pagamento",
    assuntos: {
      preco: "Preço e formas de pagamento",
      convenio: "Convênio",
      agendamento: "Marcar ou remarcar horário",
      tratamento: "Tratamento específico (implante, aparelho, clareamento)",
      urgencia: "Dor ou urgência",
      endereco_horario: "Endereço e horário",
      outro: "Outros assuntos",
    },
    desfechos: { ...DESFECHOS_COMUNS, agendou: "Agendou avaliação", fechou: "Fechou tratamento na conversa" },
    portais: "Doctoralia, Boa Consulta, iFood Benefícios",
  },
  clinica_de_estetica: {
    rotulo: "Clínica de estética",
    proximoPasso: "agendar a avaliação ou a sessão, mandar o valor do pacote, confirmar o horário",
    assuntos: {
      preco: "Preço e pacotes",
      agendamento: "Marcar ou remarcar horário",
      procedimento: "Dúvida sobre o procedimento",
      resultado: "Resultado e cuidados",
      endereco_horario: "Endereço e horário",
      outro: "Outros assuntos",
    },
    desfechos: { ...DESFECHOS_COMUNS, agendou: "Agendou avaliação ou sessão", fechou: "Fechou pacote na conversa" },
    portais: "Doctoralia, Booksy, Trinks",
  },
  academia: {
    rotulo: "Academia",
    proximoPasso: "convidar para a aula experimental ou a visita, mandar os planos, fazer a matrícula",
    assuntos: {
      preco: "Planos e preços",
      horario: "Horário de funcionamento e aulas",
      experimental: "Aula experimental",
      matricula: "Matrícula e cancelamento",
      endereco_horario: "Endereço e estacionamento",
      outro: "Outros assuntos",
    },
    desfechos: { ...DESFECHOS_COMUNS, agendou: "Agendou aula experimental ou visita", fechou: "Matrícula confirmada na conversa" },
    portais: "Gympass (Wellhub), TotalPass",
  },
  imobiliaria: {
    rotulo: "Imobiliária",
    proximoPasso: "agendar a visita ao imóvel, simular o financiamento, mandar opções parecidas",
    assuntos: {
      preco: "Preço, condomínio e IPTU",
      financiamento: "Financiamento e entrada",
      visita: "Visita ao imóvel",
      documentacao: "Documentação",
      localizacao: "Localização e bairro",
      outro: "Outros assuntos",
    },
    desfechos: { ...DESFECHOS_COMUNS, agendou: "Agendou visita", fechou: "Proposta aceita na conversa" },
    portais: "ZAP Imóveis, Viva Real, OLX, QuintoAndar, Imovelweb",
  },
  loja_e_varejo: {
    rotulo: "Loja e varejo",
    proximoPasso: "mandar o preço e a forma de pagamento, fechar o pedido, combinar a entrega ou a retirada",
    assuntos: {
      preco: "Preço e disponibilidade",
      pagamento: "Formas de pagamento",
      entrega: "Entrega, frete e retirada",
      troca: "Troca e devolução",
      endereco_horario: "Endereço e horário",
      outro: "Outros assuntos",
    },
    desfechos: { ...DESFECHOS_COMUNS, agendou: "Combinou retirada ou visita", fechou: "Venda confirmada na conversa" },
    portais: "Mercado Livre, Shopee, Amazon, OLX",
  },
  outro: {
    rotulo: "Outro",
    proximoPasso: "conduzir o cliente ao próximo passo da venda (agendar, mandar proposta, fechar)",
    assuntos: {
      preco: "Preço",
      prazo: "Prazo e disponibilidade",
      pagamento: "Formas de pagamento",
      endereco_horario: "Endereço e horário",
      outro: "Outros assuntos",
    },
    desfechos: { ...DESFECHOS_COMUNS, agendou: "Agendou o próximo passo", fechou: "Venda confirmada na conversa" },
    portais: "marketplaces e portais do setor",
  },
};

/** Todos os rótulos de assunto e de desfecho, para a tela resolver `t(...)`. */
export const ROTULO_DO_SEGMENTO: Record<Segmento, string> = Object.freeze({
  revenda_de_veiculos: "Revenda de veículos",
  clinica_odontologica: "Clínica odontológica",
  clinica_de_estetica: "Clínica de estética",
  academia: "Academia",
  imobiliaria: "Imobiliária",
  loja_e_varejo: "Loja e varejo",
  outro: "Outro",
});

export function definicaoDoSegmento(segmento: string): DefinicaoDoSegmento {
  return DEFINICOES[(segmento in DEFINICOES ? segmento : "outro") as Segmento];
}
