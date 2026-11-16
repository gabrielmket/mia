/**
 * FORK MIA (.109) · a palavra e as duas opções do funil para o produto no negócio
 * (docs/fork/produto-no-negocio.md, tela 4 do protótipo).
 *
 *   vocabulary.produto                 como o funil chama o que o negócio vende
 *                                      ("Tratamento", "Produto", "Serviço"). Em
 *                                      branco (ou ausente), vale o padrão do
 *                                      sistema, "Produto ou serviço".
 *   settings.pedir_produto_no_ganho    ligado, Marcar como ganho só confirma com
 *                                      pelo menos um item. AUSENTE = desligado.
 *   settings.mostrar_valor_recorrente  desligado, o valor recorrente, a duração e o
 *                                      Tipo de receita somem das telas do funil, e
 *                                      o funil conta como avulso nas metas.
 *                                      AUSENTE = ligado.
 *
 * Os dois padrões são os de hoje: nos funis que já existem nada muda até alguém
 * mexer, sem nenhuma linha reescrita.
 */

export const CHAVE_DA_PALAVRA = "produto" as const;
export const CHAVE_DE_PEDIR_NO_GANHO = "pedir_produto_no_ganho" as const;
export const CHAVE_DE_MOSTRAR_RECORRENTE = "mostrar_valor_recorrente" as const;

/** O teto da palavra, o mesmo das outras palavras do vocabulário. */
export const TAMANHO_MAXIMO_DA_PALAVRA = 40;

type Registro = Record<string, unknown> | null | undefined;

function registro(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** A palavra gravada no funil, ou `null` para o padrão do sistema. */
export function palavraGravada(vocabulary: unknown): string | null {
  const v = registro(vocabulary)?.[CHAVE_DA_PALAVRA];
  return typeof v === "string" && v.trim() ? v.trim().slice(0, TAMANHO_MAXIMO_DA_PALAVRA) : null;
}

/** Só o `true` explícito liga: ausente, `false` ou valor torto é desligado. */
export function pedirProdutoNoGanho(settings: Registro | unknown): boolean {
  return registro(settings)?.[CHAVE_DE_PEDIR_NO_GANHO] === true;
}

/** Só o `false` explícito desliga: ausente é ligado, que é o de hoje. */
export function mostrarValorRecorrente(settings: Registro | unknown): boolean {
  return registro(settings)?.[CHAVE_DE_MOSTRAR_RECORRENTE] !== false;
}

/**
 * O plural da palavra, pela régua do protótipo: "ão" vira "ões", "r" e "z"
 * ganham "es", "al" vira "ais", o que termina em "s" fica igual e o resto ganha
 * "s". Cobre Tratamento, Produto, Serviço, Procedimento, Plano, Pacote e Peça;
 * palavra terminada em "el", "il" ou "ol" sai errada ("Imóvel" vira "Imóvels"),
 * a mesma limitação do protótipo aprovado.
 */
export function pluralDaPalavra(palavra: string): string {
  const w = palavra.trim();
  if (/ão$/i.test(w)) return w.replace(/ão$/i, "ões");
  if (/[rz]$/i.test(w)) return `${w}es`;
  if (/al$/i.test(w)) return w.replace(/al$/i, "ais");
  if (/s$/i.test(w)) return w;
  return `${w}s`;
}

export function comMaiuscula(w: string): string {
  return w.length > 0 ? w.charAt(0).toLocaleUpperCase("pt-BR") + w.slice(1) : w;
}

export interface PalavraDoProduto {
  /** "tratamento" (minúscula, para o meio da frase). */
  s: string;
  /** "Tratamento". */
  S: string;
  /** "tratamentos". */
  p: string;
  /** "Tratamentos". */
  P: string;
  /** É a palavra do sistema (o funil não escolheu). */
  padrao: boolean;
}

/**
 * As quatro formas da palavra. `padrao` traz o texto do sistema JÁ na língua da
 * tela (quem chama passa o `t("produto ou serviço")`): a palavra do funil é dado
 * do cliente e não se traduz, a do sistema é interface e se traduz.
 */
export function formasDaPalavra(
  gravada: string | null,
  padrao: { singular: string; plural: string },
): PalavraDoProduto {
  if (!gravada) {
    return {
      s: padrao.singular,
      S: comMaiuscula(padrao.singular),
      p: padrao.plural,
      P: comMaiuscula(padrao.plural),
      padrao: true,
    };
  }
  const s = gravada.toLocaleLowerCase("pt-BR");
  const p = pluralDaPalavra(s);
  return { s, S: comMaiuscula(s), p, P: comMaiuscula(p), padrao: false };
}

/** A palavra e as opções do funil, como as telas do negócio precisam. */
export interface FunilDoProduto {
  pipeline_id: string;
  /** A palavra gravada; `null` = o padrão do sistema. */
  palavra: string | null;
  pedir_no_ganho: boolean;
  mostrar_valor_recorrente: boolean;
  /** O nome do ganho neste funil (`vocabulary.won`), para a janela de ganho. */
  ganho: string | null;
  motivos_de_ganho: string[];
  motivo_de_ganho_obrigatorio: boolean;
}

export function funilDoProduto(linha: { id: string; vocabulary: unknown; settings: unknown }): FunilDoProduto {
  const voc = (linha.vocabulary ?? {}) as Record<string, unknown>;
  const st = (linha.settings ?? {}) as Record<string, unknown>;
  const won = typeof voc.won === "string" && voc.won.trim() ? voc.won.trim() : null;
  return {
    pipeline_id: linha.id,
    palavra: palavraGravada(linha.vocabulary),
    pedir_no_ganho: pedirProdutoNoGanho(linha.settings),
    mostrar_valor_recorrente: mostrarValorRecorrente(linha.settings),
    ganho: won,
    motivos_de_ganho: Array.isArray(st.won_reasons) ? st.won_reasons.filter((m): m is string => typeof m === "string") : [],
    motivo_de_ganho_obrigatorio: st.won_reason_required === true,
  };
}

/** O padrão do sistema em português (a chave do dicionário). */
export const PADRAO_DO_SISTEMA = { singular: "produto ou serviço", plural: "produtos e serviços" } as const;

// ── a palavra do segmento, na implantação ─────────────────────────────────────

export const SEGMENTOS_DA_PALAVRA = ["clinica", "loja", "escritorio"] as const;
export type SegmentoDaPalavra = (typeof SEGMENTOS_DA_PALAVRA)[number];

/**
 * O que a implantação preenche pelo segmento (decisão 1 do protótipo): clínica,
 * Tratamento; loja, Produto; escritório, Serviço. Na clínica, o negócio que já se
 * chama "Tratamento" passa a "Plano de tratamento", para a mesma tela não dizer
 * "Tratamento" duas vezes.
 */
export const PALAVRA_DO_SEGMENTO: Record<
  SegmentoDaPalavra,
  { produto: string; negocioQueRepete?: { de: string; para: string } }
> = {
  clinica: { produto: "Tratamento", negocioQueRepete: { de: "Tratamento", para: "Plano de tratamento" } },
  loja: { produto: "Produto" },
  escritorio: { produto: "Serviço" },
};

export interface MudancaDaPalavraDoSegmento {
  /** O que gravar no vocabulário; vazio = nada a mudar. */
  vocabulario: { produto?: string; deal?: string };
  /** A palavra já estava escolhida (e diferente) e o pedido não mandou sobrescrever. */
  mantida: boolean;
}

/**
 * O que a implantação muda num funil para o segmento. Garantir não atropela
 * escolha: o funil que já tem palavra (outra) fica com ela, a não ser que o
 * pedido diga `sobrescrever`. O negócio só é renomeado quando repete a palavra.
 */
export function palavraDoSegmentoNoFunil(
  vocabulary: unknown,
  segmento: SegmentoDaPalavra,
  sobrescrever = false,
): MudancaDaPalavraDoSegmento {
  const alvo = PALAVRA_DO_SEGMENTO[segmento];
  const atual = palavraGravada(vocabulary);
  const vocabulario: MudancaDaPalavraDoSegmento["vocabulario"] = {};
  let mantida = false;
  if (atual === null || (sobrescrever && atual !== alvo.produto)) {
    vocabulario.produto = alvo.produto;
  } else if (atual !== alvo.produto) {
    mantida = true;
  }
  const palavraFinal = vocabulario.produto ?? atual;
  const deal = registro(vocabulary)?.deal;
  if (
    alvo.negocioQueRepete &&
    palavraFinal === alvo.produto &&
    typeof deal === "string" &&
    deal.trim().toLocaleLowerCase("pt-BR") === alvo.negocioQueRepete.de.toLocaleLowerCase("pt-BR")
  ) {
    vocabulario.deal = alvo.negocioQueRepete.para;
  }
  return { vocabulario, mantida };
}
