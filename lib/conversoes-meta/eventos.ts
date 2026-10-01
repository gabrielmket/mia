/**
 * FORK MIA — OS EVENTOS que uma etapa do funil pode informar à Meta, num lugar só.
 *
 * Módulo PURO (sem banco, sem `next/headers`, sem rede): a tela (componente de
 * cliente), a ação, o consumidor, a ferramenta do MCP e o histórico leem daqui.
 * Os CHECK da tabela `mia_conversoes_meta_regras` (migration 9017) repetem as
 * mesmas listas: são a segunda linha de defesa, não a fonte.
 *
 * ── A chave é nossa; o nome técnico é da Meta ───────────────────────────────
 *
 * O banco, a tela e o livro-razão guardam a CHAVE (`lead_qualificado`). O nome
 * que viaja para a Meta (`QualifiedLead`) mora só nesta lista. Trocar um nome
 * técnico é uma linha aqui, e não reenvia o que já foi: a deduplicação é
 * `Meta:<chave>` por negócio.
 *
 * ── De onde vêm os nomes técnicos (conferido em 01/10/2026) ─────────────────
 *
 * A API de conversões para mensagens de negócio (a que aceita o clique em
 * anúncio para WhatsApp como identidade) publica uma lista FECHADA de eventos:
 *
 *   Purchase, LeadSubmitted, InitiateCheckout, AddToCart, ViewContent,
 *   OrderCreated, OrderShipped, OrderDelivered, OrderCanceled, OrderReturned,
 *   CartAbandoned, QualifiedLead, RatingProvided, ReviewProvided
 *
 * Dos cinco eventos da casa, três estão nela: `LeadSubmitted`, `QualifiedLead`
 * e `InitiateCheckout`. "Agendou" e "Pediu orçamento ou proposta" NÃO têm
 * evento nessa lista. Para eles vai o nome do evento padrão da API de
 * conversões geral (`Schedule`, `SubmitApplication`), marcado aqui como
 * `naListaDaMensagem: false`: a tela avisa, e o que a Meta responder aparece no
 * histórico (aceito, ou recusado com o motivo dela). Só uma conta real, com o
 * código de teste, diz qual dos dois acontece.
 *
 * Para o lead de formulário a Meta usa outra porta (a API de conversões para
 * CRM), onde o nome do evento é texto livre ("a etapa que você usa no CRM"):
 * os mesmos nomes servem.
 *
 * As páginas estão em docs/fork/conversoes-da-meta.md, seção "Os eventos".
 */

export interface EventoDaMeta {
  /** A chave da casa: o que o banco e o livro-razão guardam. */
  chave: string;
  /** O que a pessoa lê. */
  rotulo: string;
  /** O `event_name` que viaja para a Meta. */
  nomeTecnico: string;
  /** Está na lista de eventos da API de conversões para mensagens de negócio. */
  naListaDaMensagem: boolean;
}

export const EVENTOS_DA_META = [
  { chave: "novo_lead", rotulo: "Novo lead", nomeTecnico: "LeadSubmitted", naListaDaMensagem: true },
  { chave: "lead_qualificado", rotulo: "Lead qualificado", nomeTecnico: "QualifiedLead", naListaDaMensagem: true },
  { chave: "agendou", rotulo: "Agendou", nomeTecnico: "Schedule", naListaDaMensagem: false },
  {
    chave: "pediu_orcamento",
    rotulo: "Pediu orçamento ou proposta",
    nomeTecnico: "SubmitApplication",
    naListaDaMensagem: false,
  },
  { chave: "iniciou_compra", rotulo: "Iniciou a compra", nomeTecnico: "InitiateCheckout", naListaDaMensagem: true },
] as const satisfies readonly EventoDaMeta[];

export type ChaveDoEventoDaMeta = (typeof EVENTOS_DA_META)[number]["chave"];

export const CHAVES_DOS_EVENTOS_DA_META = EVENTOS_DA_META.map((e) => e.chave) as [
  ChaveDoEventoDaMeta,
  ...ChaveDoEventoDaMeta[],
];

/** A compra: não é regra de etapa (é o negócio ganho), mas aparece no quadro e no histórico. */
export const COMPRA_NA_META = { rotulo: "Compra", nomeTecnico: "Purchase" } as const;

export function ehChaveDeEventoDaMeta(valor: unknown): valor is ChaveDoEventoDaMeta {
  return typeof valor === "string" && (CHAVES_DOS_EVENTOS_DA_META as readonly string[]).includes(valor);
}

export function eventoDaMeta(chave: ChaveDoEventoDaMeta): EventoDaMeta {
  // A lista é fechada e `chave` vem do tipo: sempre existe.
  return EVENTOS_DA_META.find((e) => e.chave === chave)!;
}

// ── O livro-razão ───────────────────────────────────────────────────────────

const PREFIXO_NO_LIVRO = "Meta:";
const PADRAO_NO_LIVRO = /^Meta:[a-z_]{3,40}$/;

/**
 * A chave do evento no livro-razão (`ad_conversion_dispatches.event_name`).
 *
 * Por EVENTO, e não por etapa: é o que faz o mesmo evento ligado em duas etapas
 * sair só na primeira, e sair e voltar à etapa não duplicar.
 */
export function eventoNoLivro(chave: ChaveDoEventoDaMeta): string {
  return `${PREFIXO_NO_LIVRO}${chave}`;
}

/** É um evento de etapa da Meta, do jeito que o livro-razão o guarda? */
export function ehEventoDaMetaNoLivro(nome: unknown): nome is string {
  return typeof nome === "string" && PADRAO_NO_LIVRO.test(nome);
}

/** A chave da casa a partir do nome no livro-razão, ou `null` quando não é das nossas. */
export function chaveDoEventoNoLivro(nome: unknown): ChaveDoEventoDaMeta | null {
  if (!ehEventoDaMetaNoLivro(nome)) return null;
  const chave = nome.slice(PREFIXO_NO_LIVRO.length);
  return ehChaveDeEventoDaMeta(chave) ? chave : null;
}

/**
 * O nome que a pessoa reconhece para um evento da Meta no livro-razão: a compra
 * ou um dos eventos de etapa. `null` quando o evento não é desta peça (os do
 * Google, que o upstream rotula).
 */
export function rotuloDoEventoDaMetaNoLivro(evento: string): string | null {
  if (evento === COMPRA_NA_META.nomeTecnico) return COMPRA_NA_META.rotulo;
  const chave = chaveDoEventoNoLivro(evento);
  return chave ? eventoDaMeta(chave).rotulo : null;
}

// ── Canal de entrada e valor ────────────────────────────────────────────────

/** Por onde o negócio entrou. O MESMO vocabulário da regra do Google (0436). */
export const CANAIS_DE_ENTRADA_DA_META = [
  { valor: "todos", rotulo: "Todos os canais" },
  { valor: "whatsapp", rotulo: "Só WhatsApp" },
  { valor: "outros", rotulo: "Só fora do WhatsApp" },
] as const;

export type CanalDeEntradaDaMeta = (typeof CANAIS_DE_ENTRADA_DA_META)[number]["valor"];

/** O rótulo de cada canal, por valor: é por esta tabela que a tela traduz. */
export const ROTULO_DO_CANAL_DA_META: Record<CanalDeEntradaDaMeta, string> = {
  todos: "Todos os canais",
  whatsapp: "Só WhatsApp",
  outros: "Só fora do WhatsApp",
};

export const VALORES_DE_CANAL_DA_META = CANAIS_DE_ENTRADA_DA_META.map((c) => c.valor) as [
  CanalDeEntradaDaMeta,
  ...CanalDeEntradaDaMeta[],
];

/** Quanto vale o evento de etapa. Nasce `sem_valor` até alguém configurar. */
export const MODOS_DO_VALOR = [
  { valor: "sem_valor", rotulo: "Sem valor" },
  { valor: "valor_fixo", rotulo: "Valor fixo" },
  { valor: "valor_do_negocio", rotulo: "Valor do negócio" },
] as const;

export type ModoDoValor = (typeof MODOS_DO_VALOR)[number]["valor"];

export const VALORES_DE_MODO_DO_VALOR = MODOS_DO_VALOR.map((m) => m.valor) as [ModoDoValor, ...ModoDoValor[]];

/** Teto do valor fixo: R$ 10 milhões. Acima disso é erro de digitação, não valor de evento. */
export const TETO_DO_VALOR_FIXO_CENTAVOS = 1_000_000_000;

/**
 * O valor que o evento de etapa leva, em centavos, ou `null` (sai sem valor).
 *
 * `valor_do_negocio` num negócio sem valor envia o evento SEM valor: é evento de
 * etapa, não é a compra. Zero nunca sai: ensinaria à Meta que o evento não vale
 * nada.
 */
export function valorDoEvento(
  regra: { modoDoValor: ModoDoValor; valorFixoCentavos: number | null },
  valorDoNegocioCentavos: number | null,
): number | null {
  if (regra.modoDoValor === "valor_fixo") {
    return regra.valorFixoCentavos !== null && regra.valorFixoCentavos > 0 ? regra.valorFixoCentavos : null;
  }
  if (regra.modoDoValor === "valor_do_negocio") {
    return valorDoNegocioCentavos !== null && valorDoNegocioCentavos > 0 ? valorDoNegocioCentavos : null;
  }
  return null;
}

// ── O recomendado ───────────────────────────────────────────────────────────

function semAcento(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/**
 * A sugestão para uma etapa, pelo lugar e pelo nome. `null` = não recomenda
 * ligar esta etapa.
 *
 * "Iniciou a compra" não entra no recomendado, de propósito: é o evento mais
 * perto da compra, e ligá-lo por palpite de nome ensinaria a campanha a
 * perseguir quem ainda não decidiu.
 */
export function eventoRecomendado(nomeDaEtapa: string, primeiraDoFunil: boolean): ChaveDoEventoDaMeta | null {
  if (primeiraDoFunil) return "novo_lead";
  const nome = semAcento(nomeDaEtapa);
  if (nome.includes("qualific")) return "lead_qualificado";
  if (/agend|visita|reuni/.test(nome)) return "agendou";
  if (/proposta|orcamento/.test(nome)) return "pediu_orcamento";
  return null;
}

// ── A regra, do jeito que a tela e a ferramenta a escrevem ──────────────────

export interface RegraDaEtapa {
  ligada: boolean;
  evento: ChaveDoEventoDaMeta;
  canal: CanalDeEntradaDaMeta;
  modoDoValor: ModoDoValor;
  valorFixoCentavos: number | null;
}

/**
 * Como a regra de uma etapa nasce: desligada, todos os canais, sem valor.
 *
 * O evento já vem preenchido para a pessoa só ligar: o recomendado pelo nome
 * ou, sem recomendação, o que costuma caber no lugar da etapa (do meio para o
 * fim do funil, "Iniciou a compra"; antes, "Lead qualificado").
 */
export function regraInicial(nomeDaEtapa: string, indiceNoFunil: number): RegraDaEtapa {
  return {
    ligada: false,
    evento:
      eventoRecomendado(nomeDaEtapa, indiceNoFunil === 0) ??
      (indiceNoFunil >= 3 ? "iniciou_compra" : "lead_qualificado"),
    canal: "todos",
    modoDoValor: "sem_valor",
    valorFixoCentavos: null,
  };
}

/**
 * "Usar o recomendado" numa etapa: liga com o evento sugerido, ou desliga quando
 * não há sugestão. Trocar de evento zera o valor (o valor era do evento antigo);
 * o canal fica como estava.
 */
export function aplicarRecomendado(atual: RegraDaEtapa, nomeDaEtapa: string, primeiraDoFunil: boolean): RegraDaEtapa {
  const sugerido = eventoRecomendado(nomeDaEtapa, primeiraDoFunil);
  if (!sugerido) return { ...atual, ligada: false };
  if (atual.evento === sugerido) return { ...atual, ligada: true };
  return { ...atual, ligada: true, evento: sugerido, modoDoValor: "sem_valor", valorFixoCentavos: null };
}

// ── Como a Meta vai enxergar o funil ────────────────────────────────────────

export interface PassoDoFunil {
  stageId: string;
  etapa: string;
  evento: ChaveDoEventoDaMeta;
  canal: CanalDeEntradaDaMeta;
  modoDoValor: ModoDoValor;
  valorFixoCentavos: number | null;
  /**
   * O mesmo evento já está ligado numa etapa anterior: este não envia de novo
   * para o mesmo negócio. A tela AVISA; não bloqueia.
   */
  repetido: boolean;
}

/** A sequência dos eventos ligados, na ordem das etapas, marcando o repetido. */
export function passosDoFunil(
  etapas: ReadonlyArray<{ id: string; nome: string }>,
  regras: Readonly<Record<string, RegraDaEtapa | undefined>>,
): PassoDoFunil[] {
  const vistos = new Set<ChaveDoEventoDaMeta>();
  const passos: PassoDoFunil[] = [];
  for (const etapa of etapas) {
    const regra = regras[etapa.id];
    if (!regra?.ligada) continue;
    passos.push({
      stageId: etapa.id,
      etapa: etapa.nome,
      evento: regra.evento,
      canal: regra.canal,
      modoDoValor: regra.modoDoValor,
      valorFixoCentavos: regra.valorFixoCentavos,
      repetido: vistos.has(regra.evento),
    });
    vistos.add(regra.evento);
  }
  return passos;
}
