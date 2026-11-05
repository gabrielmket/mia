/**
 * FORK MIA (.101) · AS CONVERSAS FICTÍCIAS DA "GARAGEM MODELO VEÍCULOS", fixas,
 * para o teste do relatório e para o E2E. Nenhum dado real: telefones da faixa
 * fictícia (31) 90000-xxxx e o cliente "Ricardo Exemplo".
 *
 * Doze conversas, cada uma com um papel no relatório: respondida rápido e
 * agendou, respondida tarde (loja fechada), sem resposta, sumiu sem retorno,
 * sumiu com retorno, pediu o valor e não recebeu, veio de anúncio...
 */
import { medirConversa } from "@/lib/raio-x/metricas";
import type { HorarioComercial } from "@/lib/raio-x/regras";
import type { AnaliseDaConversa, ConversaParaORelatorio, MensagemDoRelatorio } from "@/lib/raio-x/relatorio";

export const HORARIO_DA_GARAGEM: HorarioComercial = { abre: 8 * 60, fecha: 18 * 60, sabadoAte: 13 * 60 };
export const INICIO_DA_GARAGEM = new Date("2026-08-06T03:00:00.000Z");
export const FIM_DA_GARAGEM = new Date("2026-11-04T15:00:00.000Z");

const sp = (iso: string) => new Date(`${iso}-03:00`).getTime();
const c = (iso: string, texto: string, tipo = "texto"): MensagemDoRelatorio => ({ daLoja: false, em: sp(iso), tipo, texto });
const l = (iso: string, texto: string, tipo = "texto"): MensagemDoRelatorio => ({ daLoja: true, em: sp(iso), tipo, texto });

const notas = (r: number, p: number, v: number | null, e: number) => ({
  responde_o_perguntado: r,
  proximo_passo: p,
  volta_a_chamar: v,
  educacao: e,
});

interface Bruta {
  numero: number;
  anuncio?: boolean;
  nomes?: string[];
  mensagens: MensagemDoRelatorio[];
  analise: AnaliseDaConversa | null;
  foraDoTeto?: boolean;
}

const BRUTAS: Bruta[] = [
  {
    numero: 187,
    anuncio: true,
    nomes: ["Ricardo Exemplo"],
    mensagens: [
      c("2026-10-30T21:14:00", "Boa noite, aqui é o Ricardo. Ainda tem o Polo? Aceita meu Gol 2015 na troca?"),
      l("2026-10-31T10:02:00", "Bom dia! Tem sim, aceitamos. Qual o km do Gol?"),
      c("2026-10-31T10:05:00", "98 mil. Quanto fica? Meu número é (31) 90000-1101"),
    ],
    analise: {
      origem: "anuncio_meta",
      assuntos: ["preco", "troca"],
      pediu_valor: true,
      recebeu_valor: false,
      desfecho: "pediu_proposta_sem_retorno",
      notas: notas(5, 3, 1, 8),
      comentario: "O cliente pediu o valor e a loja não voltou.",
    },
  },
  {
    numero: 233,
    mensagens: [
      c("2026-10-27T14:20:00", "Vocês financiam sem entrada?"),
      l("2026-10-27T14:24:00", "Financiamos em até 60x, sujeito à análise. Quer que eu simule? Me passa seu CPF e a parcela que cabe pra você."),
      c("2026-10-27T14:40:00", "Fechado, passo aí amanhã."),
      l("2026-10-27T14:41:00", "Combinado! Te espero às 10h."),
    ],
    analise: {
      origem: "instagram",
      assuntos: ["financiamento"],
      pediu_valor: false,
      recebeu_valor: false,
      desfecho: "agendou",
      notas: notas(9, 10, null, 9),
      comentario: "Resposta em 4 minutos, com o próximo passo na mesma mensagem.",
    },
  },
  {
    numero: 241,
    anuncio: true,
    mensagens: [c("2026-10-18T19:30:00", "Olá, vi o anúncio do HB20. Qual o valor?")],
    analise: {
      origem: "anuncio_meta",
      assuntos: ["preco"],
      pediu_valor: true,
      recebeu_valor: false,
      desfecho: "sem_resposta",
      notas: notas(0, 0, null, 5),
      comentario: "Ninguém respondeu.",
    },
  },
  {
    numero: 252,
    mensagens: [
      c("2026-10-20T09:10:00", "Bom dia, o Onix prata ainda está disponível?"),
      l("2026-10-20T09:15:00", "Bom dia! Está sim. Quer agendar uma visita?"),
    ],
    analise: {
      origem: "portal",
      assuntos: ["preco"],
      pediu_valor: false,
      recebeu_valor: false,
      desfecho: "sumiu",
      notas: notas(8, 8, 2, 9),
      comentario: "O cliente sumiu e a loja não voltou a chamar.",
    },
  },
  {
    numero: 260,
    mensagens: [
      c("2026-10-21T10:00:00", "Tem laudo cautelar?"),
      l("2026-10-21T10:03:00", "Tem sim, todos os nossos carros têm laudo."),
      l("2026-10-22T11:00:00", "Oi! Conseguiu ver o laudo? Posso te mandar as fotos."),
    ],
    analise: {
      origem: "google_site",
      assuntos: ["procedencia"],
      pediu_valor: false,
      recebeu_valor: false,
      desfecho: "negociando",
      notas: notas(9, 7, 9, 9),
      comentario: "A loja voltou a chamar no dia seguinte.",
    },
  },
  {
    numero: 271,
    mensagens: [
      c("2026-11-01T11:00:00", "Domingo vocês abrem?"),
      l("2026-11-02T09:30:00", "Bom dia! Abrimos de segunda a sábado."),
      c("2026-11-02T09:35:00", "Ok, obrigado"),
    ],
    analise: {
      origem: "sem_identificacao",
      assuntos: ["endereco_horario"],
      pediu_valor: false,
      recebeu_valor: false,
      desfecho: "outros_assuntos",
      notas: notas(7, 4, null, 8),
      comentario: "Pergunta de horário respondida no dia seguinte.",
    },
  },
  {
    numero: 284,
    mensagens: [
      c("2026-10-24T08:40:00", "Quero vender meu carro para vocês"),
      l("2026-10-24T08:45:00", "Ótimo! Traz ele aqui para avaliarmos. Pode ser sábado às 9h?"),
      c("2026-10-24T08:50:00", "Pode sim"),
    ],
    analise: {
      origem: "indicacao",
      assuntos: ["troca"],
      pediu_valor: false,
      recebeu_valor: false,
      desfecho: "agendou",
      notas: notas(9, 10, null, 9),
      comentario: "Agendou a avaliação na hora.",
    },
  },
  {
    numero: 290,
    anuncio: true,
    mensagens: [
      c("2026-10-25T20:00:00", "Vi no Instagram o T-Cross, aceita financiamento?", "texto"),
      c("2026-10-25T20:01:00", "e qual a entrada mínima", "audio"),
      l("2026-10-26T09:00:00", "Bom dia! Aceitamos sim, entrada a partir de 20%."),
      c("2026-10-26T09:10:00", "Vou pensar"),
    ],
    analise: {
      origem: "anuncio_meta",
      assuntos: ["financiamento", "preco"],
      pediu_valor: true,
      recebeu_valor: true,
      desfecho: "negociando",
      notas: notas(8, 5, null, 8),
      comentario: "Respondeu a dúvida, mas sem convidar para a visita.",
    },
  },
  {
    numero: 301,
    mensagens: [c("2026-11-04T08:00:00", "Bom dia, tem Fiat Uno?")],
    analise: null,
    foraDoTeto: false,
  },
  {
    numero: 315,
    mensagens: [
      c("2026-10-28T15:00:00", "Fecho o Sandero hoje se fizer à vista com desconto"),
      l("2026-10-28T15:02:00", "Fazemos sim! Te mando a proposta agora."),
      l("2026-10-28T15:05:00", "Proposta enviada. Confirma?"),
      c("2026-10-28T15:20:00", "Confirmado, vou buscar amanhã"),
    ],
    analise: {
      origem: "sem_identificacao",
      assuntos: ["preco"],
      pediu_valor: true,
      recebeu_valor: true,
      desfecho: "fechou",
      notas: notas(10, 10, null, 9),
      comentario: "Venda fechada na conversa.",
    },
  },
  {
    numero: 322,
    mensagens: [c("2026-10-15T13:00:00", "Oi, vocês compram moto?")],
    analise: null,
    foraDoTeto: true,
  },
  {
    numero: 330,
    mensagens: [l("2026-10-10T10:00:00", "Promoção de outubro! Confira nosso estoque.")],
    analise: null,
  },
];

/** As conversas prontas para `montarRelatorio`, medidas com o relógio de verdade. */
export function conversasDaGaragemModelo(): ConversaParaORelatorio[] {
  return BRUTAS.map((b) => ({
    numeroOrdem: b.numero,
    anuncio: b.anuncio === true,
    medida: medirConversa(
      b.mensagens.map((m) => ({ daLoja: m.daLoja, em: m.em })),
      HORARIO_DA_GARAGEM,
      FIM_DA_GARAGEM.getTime(),
    ),
    analise: b.analise,
    foraDoTeto: b.foraDoTeto === true,
    mensagens: b.mensagens,
    nomes: b.nomes ?? [],
  }));
}
