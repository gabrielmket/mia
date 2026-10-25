/**
 * FORK MIA (.91) · OS MODELOS DE AGENTE POR SEGMENTO.
 *
 * Mora ao lado de `pacotes-da-mia.ts` pelo mesmo motivo: a diferença com o
 * upstream fica em pontos de ligação pequenos (`FORK MIA`), e o que é nosso
 * mora num arquivo nosso.
 *
 * ── O que é um modelo ─────────────────────────────────────────────────────
 *
 * É o agente de exemplo das DEMONSTRAÇÕES por segmento
 * (`lib/demonstracao/semente/segmentos/`), escrito uma vez só: quem ele é, o
 * que faz e o que nunca faz. A demonstração e o passo a passo de entrada
 * (`/onboarding`) montam o texto do agente pela MESMA função
 * (`promptDoModelo`), e a demonstração só acrescenta os fatos da empresa
 * fictícia dela (preços, empreendimento, tabela). Assim o cliente que entra
 * sozinho começa do agente que a Time já mostra em venda, sem nenhum fato
 * inventado no texto dele.
 *
 * Cada segmento também diz o quadro pronto do funil (`PACOTES`, pelo id) e o
 * modelo de follow-up (`lib/followup/modelos`, pelo id), com a etapa do
 * gatilho pelo PASSO do agente (a etapa que o quadro pronto marca com ele).
 *
 * ── As frases são o texto do agente ────────────────────────────────────────
 *
 * `faz` e `naoFaz` vão para o texto do agente, frase por frase, e são as
 * mesmas que a tela mostra em "O modelo de clínica ensina a ele". A tela não
 * promete nada que o texto não diga. As conferências que rodam antes de cada
 * mensagem continuam vindo do runtime (`CONFERENCIAS_DE_SAIDA`), como no
 * upstream.
 *
 * Sem travessão e sem emoji, como todo texto que o cliente lê.
 */
import type { LeadStage } from "@/lib/agent-engine/agent/lead-state";
import type { SegmentoDeDemonstracao } from "@/lib/demonstracao/semente/tipos";
import type { PromptTemplate } from "@/lib/schemas/onboarding";

import { PACOTES, PACOTE_PADRAO, type PacoteDeFunil } from "./pacotes-de-funil";

/** Os segmentos que o passo "Seu negócio" oferece, na ordem da tela. */
export const SEGMENTOS_DO_ONBOARDING = ["clinica", "academia", "imobiliaria", "industria", "outro"] as const;
export type SegmentoDoOnboarding = (typeof SEGMENTOS_DO_ONBOARDING)[number];

export function ehSegmentoDoOnboarding(valor: unknown): valor is SegmentoDoOnboarding {
  return typeof valor === "string" && (SEGMENTOS_DO_ONBOARDING as readonly string[]).includes(valor);
}

/**
 * O segmento que veio do formulário das boas-vindas, ou `undefined`. O segmento
 * só SOMA ao passo do upstream: vazio ou fora da lista não vira erro de
 * validação (que travaria nome, fuso e termos), só deixa de ser gravado.
 */
export function segmentoDoFormulario(valor: unknown): SegmentoDoOnboarding | undefined {
  const limpo = typeof valor === "string" ? valor.trim() : "";
  return ehSegmentoDoOnboarding(limpo) ? limpo : undefined;
}

export interface ModeloDeAgente {
  segmento: SegmentoDoOnboarding;
  /** Como o dono reconhece o próprio negócio na lista. */
  rotulo: string;
  /** A palavra curta das frases ("o modelo de clínica"). */
  curto: string;
  /** O nome do agente de exemplo, o mesmo da demonstração do segmento. */
  persona: string;
  /** O cargo, que vai no nome que a equipe vê ("Clara · Recepção"). */
  papel: string;
  /** O que ele cuida, na frase do texto ("cuida da recepção de ..."). */
  cuidaDe: string;
  /** O jeito de falar que o modelo sugere (os três do upstream). */
  jeito: PromptTemplate;
  /** O que ele faz, frase por frase. Vai para o texto do agente e para a tela. */
  faz: readonly string[];
  /** O que ele nunca faz, frase por frase. Vai para o texto e para a tela. */
  naoFaz: readonly string[];
  /** Exemplos de regras da casa: só o exemplo do campo, nunca o valor gravado. */
  regrasDeExemplo: readonly string[];
  /** O quadro pronto do funil (`PACOTES`, pelo id). */
  pacote: string;
  /** O modelo de follow-up e o passo da etapa que o dispara (`null` = gatilho sem etapa). */
  followup: { modelo: string; passo: LeadStage | null };
  /** A demonstração cujo agente de exemplo é este (`null` = não há demonstração do segmento). */
  demonstracao: SegmentoDeDemonstracao | null;
  /** As palavras do dono que apontam para o segmento. */
  pistas: RegExp;
}

export const MODELOS_DE_AGENTE: Readonly<Record<SegmentoDoOnboarding, ModeloDeAgente>> = {
  clinica: {
    segmento: "clinica",
    rotulo: "Clínica ou consultório",
    curto: "clínica",
    persona: "Clara",
    papel: "Recepção",
    cuidaDe: "da recepção",
    jeito: "ecommerce_friendly",
    faz: [
      "Atende pelo WhatsApp quem quer marcar uma avaliação, tirar dúvida de tratamento ou remarcar.",
      "Entende o que a pessoa procura e oferece a avaliação, que é o primeiro passo de todo tratamento.",
      "Marca a avaliação na agenda, remarca e confirma.",
      "Fala o preço de referência só do que está no catálogo.",
      "Passa para a equipe quem já fez a avaliação e quer fechar o tratamento.",
    ],
    naoFaz: ["Não dá diagnóstico e não promete resultado.", "Não fala preço de tratamento antes da avaliação."],
    regrasDeExemplo: [
      "Chamar o paciente pelo primeiro nome.",
      "Horário da clínica: 8h às 19h, de segunda a sábado.",
      "Preço de tratamento só depois da avaliação.",
    ],
    pacote: "clinica",
    followup: { modelo: "clinica-consulta-retomada", passo: null },
    demonstracao: "clinica-odonto",
    pistas:
      /\b(cl[ií]nic|consult[óo]ri|dentist|odonto|m[ée]dic|terapeut|psic[óo]log|fisioterap|est[ée]tic|sal[ãa]o|barbear|veterin[áa]ri|nutricion|dermatolog|fonoaudi)/i,
  },
  academia: {
    segmento: "academia",
    rotulo: "Academia ou estúdio",
    curto: "academia",
    persona: "Duda",
    papel: "Atendimento",
    cuidaDe: "do atendimento",
    jeito: "ecommerce_friendly",
    faz: [
      "Atende pelo WhatsApp quem quer conhecer o espaço, saber dos planos e horários ou voltar a treinar.",
      "Entende o objetivo e a rotina da pessoa e oferece a aula experimental.",
      "Marca a aula experimental na agenda.",
      "Explica os planos e o que cada um inclui, com os valores do catálogo.",
      "Passa para a equipe quem já escolheu o plano e quer fechar a matrícula.",
    ],
    naoFaz: [
      "Não promete resultado de treino nem de dieta e não comenta o corpo ou a saúde de ninguém.",
      "Não dá desconto sem a gerência.",
    ],
    regrasDeExemplo: ["Aula experimental de graça, uma por pessoa.", "Horário: 6h às 22h, de segunda a sábado."],
    pacote: "curso",
    followup: { modelo: "academia-aula-experimental", passo: "qualifying" },
    demonstracao: "academia",
    pistas: /\b(academi|muscula[çc]|pilates|crossfit|yoga|ioga|treino|personal|est[úu]dio de|funcional|nata[çc][ãa]o|jiu|boxe|dan[çc]a)/i,
  },
  imobiliaria: {
    segmento: "imobiliaria",
    rotulo: "Imobiliária ou corretor",
    curto: "imobiliária",
    persona: "Lívia",
    papel: "Atendimento",
    cuidaDe: "do atendimento",
    jeito: "ecommerce_professional",
    faz: [
      "Atende pelo WhatsApp quem procura imóvel para comprar ou alugar.",
      "Entende o que a pessoa procura: bairro, quartos, faixa de preço e prazo para mudar.",
      "Mostra os imóveis do catálogo que cabem no que ela procura.",
      "Marca a visita na agenda e passa para o corretor quem já tem perfil.",
    ],
    naoFaz: [
      "Não garante aprovação de financiamento nem valor de parcela.",
      "Não passa valor de imóvel que não está no catálogo.",
    ],
    regrasDeExemplo: ["Visitas de segunda a sábado, das 9h às 18h.", "Confirmar a visita no dia anterior."],
    pacote: "imobiliaria",
    followup: { modelo: "imobiliario-visita", passo: "qualifying" },
    demonstracao: "construtora",
    pistas: /\b(imobili[áa]ri|corret|im[óo]ve|apartament|alugu|loteament|terren|construtor|incorporador)/i,
  },
  industria: {
    segmento: "industria",
    rotulo: "Indústria ou distribuidora",
    curto: "indústria",
    persona: "Bento",
    papel: "Atendimento comercial",
    cuidaDe: "do atendimento comercial",
    jeito: "ecommerce_professional",
    faz: [
      "Atende pelo WhatsApp revendas, distribuidores, instaladores e construtoras.",
      "Entende quem é o cliente, a cidade, os itens e as quantidades.",
      "Consulta o catálogo pelo código e monta a cotação com o preço da tabela.",
      "Passa para o representante da região quem quer fechar o pedido.",
    ],
    naoFaz: [
      "Não promete prazo de entrega nem estoque sem confirmar com o comercial.",
      "Não dá desconto fora da tabela.",
    ],
    regrasDeExemplo: [
      "Pedido mínimo de R$ 1.500 para revenda.",
      "Só atende CNPJ: pessoa física vai para a loja parceira.",
    ],
    pacote: "industria",
    followup: { modelo: "industria-b2b-cotacao", passo: "qualified" },
    demonstracao: "industria",
    pistas: /\b(ind[úu]stri|f[áa]bric|fabricant|distribuidor|atacad|revend|insumo|material el[ée]tric|metal[úu]rg)/i,
  },
  outro: {
    segmento: "outro",
    rotulo: "Outro tipo de negócio",
    curto: "negócio",
    persona: "Mia",
    papel: "Atendimento",
    cuidaDe: "do atendimento",
    jeito: "ecommerce_friendly",
    faz: [
      "Atende pelo WhatsApp quem chega com uma dúvida ou um pedido.",
      "Entende o que a pessoa precisa antes de oferecer qualquer coisa.",
      "Responde com o que está no conhecimento da empresa e no catálogo.",
      "Passa para a equipe quem está pronto para fechar.",
    ],
    naoFaz: ["Não inventa preço nem prazo.", "Não promete o que não está escrito."],
    regrasDeExemplo: ["Chamar o cliente pelo primeiro nome.", "Horário de atendimento: 9h às 18h."],
    pacote: "generico",
    followup: { modelo: "geral-retomada", passo: null },
    demonstracao: null,
    pistas: /$^/,
  },
};

export function modeloDoSegmento(segmento: SegmentoDoOnboarding): ModeloDeAgente {
  return MODELOS_DE_AGENTE[segmento];
}

/**
 * O segmento que a MIA lê no que o dono escreveu ("A MIA leu como"). A pessoa
 * confirma ou troca: a leitura é só o ponto de partida. A ordem decide o
 * empate e é estável (academia antes de clínica: "estúdio de pilates" não é
 * consultório).
 */
const ORDEM_DA_LEITURA: readonly SegmentoDoOnboarding[] = ["academia", "industria", "imobiliaria", "clinica"];

export function sugerirSegmento(texto: string | null | undefined): SegmentoDoOnboarding {
  const limpo = (texto ?? "").trim();
  if (!limpo) return "outro";
  for (const segmento of ORDEM_DA_LEITURA) {
    if (MODELOS_DE_AGENTE[segmento].pistas.test(limpo)) return segmento;
  }
  return "outro";
}

/** O nome que a equipe vê: "Clara · Recepção". */
export function nomeDoAgenteDoModelo(segmento: SegmentoDoOnboarding): string {
  const m = MODELOS_DE_AGENTE[segmento];
  return `${m.persona} · ${m.papel}`;
}

/**
 * O nome que o agente usa com o cliente, a partir do nome que a equipe deu.
 * "Bia · Recepção" vira "Bia"; um nome vazio volta ao do modelo.
 */
export function personaDoNome(nome: string | null | undefined, segmento: SegmentoDoOnboarding): string {
  const primeiro = (nome ?? "").split("·")[0]?.trim() ?? "";
  return primeiro.length >= 2 ? primeiro.slice(0, 60) : MODELOS_DE_AGENTE[segmento].persona;
}

/**
 * O jeito de falar, em uma frase do texto do agente. Os três jeitos são os do
 * upstream (`PROMPT_TEMPLATES`); a frase é a do modelo.
 */
export const FRASE_DO_JEITO: Readonly<Record<PromptTemplate, string>> = {
  ecommerce_friendly: "Fala de um jeito próximo e caloroso, como alguém que gosta de ajudar, e confirma os detalhes antes de agir.",
  ecommerce_professional: "Fala de um jeito objetivo e cordial, vai direto ao ponto e sempre diz qual é o próximo passo.",
  support_minimal: "Responde em frases curtas, pergunta só o essencial e chama uma pessoa da equipe assim que a dúvida sair do seu alcance.",
};

export interface TextoDoAgente {
  /** O nome que o agente usa com o cliente ("Clara"). */
  persona: string;
  /** O nome do negócio. */
  negocio: string;
  /** O que o negócio faz, na palavra do dono (opcional). */
  oQueFaz?: string | null;
  /** O jeito de falar; sem ele, o do modelo. */
  jeito?: PromptTemplate;
  /** Os fatos da empresa (a demonstração usa; o cliente novo não tem nenhum inventado). */
  extras?: readonly string[];
}

/**
 * O texto do agente do modelo: quem ele é, onde trabalha, o que faz, o que
 * nunca faz e como fala. É a MESMA função para a demonstração, para o passo
 * "Treinar" e para a proposta do assistente.
 */
export function promptDoModelo(segmento: SegmentoDoOnboarding, texto: TextoDoAgente): string {
  const m = MODELOS_DE_AGENTE[segmento];
  const oQueFaz = (texto.oQueFaz ?? "").trim();
  const onde = oQueFaz ? `${texto.negocio.trim()} (${oQueFaz})` : texto.negocio.trim();
  return [
    `Seu nome é ${texto.persona.trim()}. Você cuida ${m.cuidaDe} de ${onde}.`,
    ...m.faz,
    ...m.naoFaz,
    ...(texto.extras ?? []),
    FRASE_DO_JEITO[texto.jeito ?? m.jeito],
  ].join(" ");
}

/** O quadro pronto do segmento. Nunca falta: no pior caso, o genérico do upstream. */
export function pacoteDoSegmento(segmento: SegmentoDoOnboarding): PacoteDeFunil {
  return PACOTES.find((p) => p.id === MODELOS_DE_AGENTE[segmento].pacote) ?? PACOTE_PADRAO;
}

/** O segmento gravado no passo "Seu negócio" (`onboarding_state.welcome.segmento`), ou `null`. */
export function segmentoDoEstado(estado: unknown): SegmentoDoOnboarding | null {
  const welcome = (estado as { welcome?: { segmento?: unknown } } | null | undefined)?.welcome;
  return ehSegmentoDoOnboarding(welcome?.segmento) ? welcome.segmento : null;
}
