/**
 * FORK MIA (.109) · O PRODUTO OU SERVIÇO NO NEGÓCIO, as regras puras
 * (docs/fork/produto-no-negocio.md).
 *
 * O negócio passa a dizer o que foi vendido: uma lista de itens escolhidos SÓ do
 * catálogo de Produtos (o mesmo da Proposta), com quantidade e desconto, e o
 * valor do negócio nasce da soma. Tudo aqui é puro: recebe os itens e devolve
 * números e textos. Quem lê e grava banco é `servidor.ts`; quem desenha é
 * `components/produto-no-negocio/`.
 *
 * ── As regras (tela 6 do protótipo aprovado) ────────────────────────────────
 *
 *  1. O PREÇO ENTRA CONGELADO no dia em que o item é adicionado: o item guarda o
 *     preço do catálogo daquele dia, e mudar o catálogo depois não mexe nele.
 *  2. O VALOR DO NEGÓCIO É A SOMA dos itens, a não ser que alguém digite o valor
 *     à mão; aí ele para de somar até alguém clicar "Usar a soma".
 *  3. NEGÓCIO ANTIGO NÃO É TOCADO nem adivinhado: fica com o valor que tinha,
 *     sem item, e a tela o trata como "negócio de antes dos itens".
 *  4. OS ITENS DA PROPOSTA enviada aparecem no mesmo bloco, com o número da
 *     proposta, e só mudam pela própria proposta. Eles entram na soma.
 */

/** O teto da quantidade de um item do negócio (a mesma CHECK da 9160). */
export const QUANTIDADE_MAXIMA = 99;

export type OrigemDoItem = "negocio" | "proposta";

export interface PropostaDoItem {
  id: string;
  numero: number | null;
  ano: number | null;
}

/** Um item do negócio, seja do bloco do negócio ou da proposta enviada. */
export interface ItemDoNegocio {
  /** O id da linha (do bloco ou do item da proposta). `null` = ainda não gravado. */
  id: string | null;
  origem: OrigemDoItem;
  productId: string | null;
  /** O nome gravado no item: o do catálogo no dia em que entrou (ou a descrição da proposta). */
  nome: string;
  codigo: string | null;
  /** O preço congelado (rascunho novo: o preço do catálogo de agora). */
  precoUnitarioCents: number;
  /** Inteiro no bloco do negócio; a proposta aceita fração (numeric). */
  quantidade: number;
  descontoCents: number;
  moeda: string;
  /** Só nos itens da proposta: de qual proposta eles vieram. */
  proposta?: PropostaDoItem | null;
  /** O nome do produto no catálogo HOJE, quando a leitura o pediu (o relatório agrupa por ele). */
  nomeNoCatalogo?: string | null;
}

/**
 * O valor de um item: preço × quantidade, menos o desconto, nunca negativo. É a
 * conta de `calcularTotal` da proposta (`lib/propostas/total.ts`), para o item
 * da proposta somar no bloco exatamente o que somou na proposta.
 */
export function valorDoItem(item: Pick<ItemDoNegocio, "precoUnitarioCents" | "quantidade" | "descontoCents">): number {
  const bruto = Math.round(item.quantidade * item.precoUnitarioCents);
  return Math.max(0, bruto - item.descontoCents);
}

/** A soma dos itens, em centavos. */
export function somaDosItens(itens: readonly ItemDoNegocio[]): number {
  return itens.reduce((acc, it) => acc + valorDoItem(it), 0);
}

/** A soma que o negócio deveria ter: `null` quando não há item nenhum ("Sem valor"). */
export function somaEsperada(itens: readonly ItemDoNegocio[]): number | null {
  return itens.length > 0 ? somaDosItens(itens) : null;
}

/**
 * FORK MIA (fusão v1.124) · o Valor do negócio segue as VENDAS REGISTRADAS do
 * upstream (9449/9450, "Registrar venda") só quando o bloco de itens não tem item.
 *
 * Os dois escrevem `crm_leads.value_cents`: o gatilho dele a cada venda, a rota
 * dos itens a cada gravação. A regra da fusão é "nada muda para quem já usa
 * itens": com item do bloco, a soma dos itens (ou o valor à mão) continua
 * mandando, e o banco desfaz a troca pela soma das vendas (gatilho
 * `trg_mia_valor_do_negocio_segue_os_itens`, 9167). Esta função é a MESMA régua
 * do lado da tela: o campo só vira "soma das vendas" quando o banco também vai
 * mostrar a soma das vendas. Itens da proposta não contam: o valor da proposta é
 * do upstream, como antes.
 */
export function valorSegueAsVendas(args: {
  vendas: number;
  itens: readonly Pick<ItemDoNegocio, "origem">[] | null | undefined;
}): boolean {
  if (args.vendas <= 0) return false;
  return !(args.itens ?? []).some((i) => i.origem === "negocio");
}

export type ModoDoValor = "soma" | "a_mao";

export interface EstadoDoValor {
  modo: ModoDoValor;
  /**
   * Negócio de antes dos itens: nunca foi gravado pelo bloco (`valor_a_mao`
   * nulo) e tem um valor que não é a soma. A tela usa a frase própria dele.
   */
  antigo: boolean;
  /** A soma dos itens de agora; `null` sem item. */
  somaCents: number | null;
  /** O valor gravado no negócio. */
  valorCents: number | null;
}

/**
 * Em que modo está o valor do negócio.
 *
 * É À MÃO quando alguém disse que é (`valor_a_mao` verdadeiro) OU quando o valor
 * gravado não é a soma. A segunda metade cobre todo caminho que grava o valor
 * sem passar pelo bloco (o painel do Inbox, a REST, o MCP, a importação): para o
 * negócio, isso é "alguém digitou o valor", e ele para de somar até alguém pedir.
 * A marca sozinha não bastaria por isso; a divergência sozinha falharia quando
 * alguém digita, à mão, exatamente o valor da soma e depois muda um item.
 */
export function estadoDoValor(args: {
  itens: readonly ItemDoNegocio[];
  valorCents: number | null;
  valorAMao: boolean | null;
}): EstadoDoValor {
  const soma = somaEsperada(args.itens);
  const diverge = (args.valorCents ?? null) !== soma;
  const aMao = args.valorAMao === true || diverge;
  return {
    modo: aMao ? "a_mao" : "soma",
    antigo: aMao && args.valorAMao === null,
    somaCents: soma,
    valorCents: args.valorCents ?? null,
  };
}

/**
 * O que gravar em `value_cents` ao salvar o bloco: a soma no modo soma (`null`
 * sem item, que é "Sem valor"), o valor digitado no modo à mão.
 */
export function valorParaGravar(
  modo: ModoDoValor,
  itens: readonly ItemDoNegocio[],
  digitadoCents: number | null,
): number | null {
  return modo === "soma" ? somaEsperada(itens) : digitadoCents;
}

/** Um produto do catálogo, como a busca do bloco o devolve. */
export interface ProdutoDoCatalogo {
  id: string;
  codigo: string | null;
  nome: string;
  precoCents: number;
  moeda: string;
}

/**
 * Pôr um produto no rascunho. Produto que JÁ está no negócio (fora da proposta)
 * soma 1 na quantidade, até o teto, em vez de virar uma segunda linha: um
 * produto aparece uma vez por negócio (o índice único da 9160). O preço do item
 * novo é o do catálogo de agora, e é ele que fica congelado ao gravar.
 */
export function adicionarAoRascunho(itens: readonly ItemDoNegocio[], produto: ProdutoDoCatalogo): ItemDoNegocio[] {
  const i = itens.findIndex((it) => it.origem === "negocio" && it.productId === produto.id);
  if (i >= 0) {
    return itens.map((it, j) =>
      j === i ? { ...it, quantidade: Math.min(QUANTIDADE_MAXIMA, it.quantidade + 1) } : it,
    );
  }
  return [
    ...itens,
    {
      id: null,
      origem: "negocio",
      productId: produto.id,
      nome: produto.nome,
      codigo: produto.codigo,
      precoUnitarioCents: produto.precoCents,
      quantidade: 1,
      descontoCents: 0,
      moeda: produto.moeda,
      proposta: null,
    },
  ];
}

/**
 * Mudar a quantidade de um item do negócio. O desconto acompanha para baixo:
 * nunca passa do valor do item (a CHECK da 9160), então diminuir a quantidade
 * de um item com desconto grande encolhe o desconto junto.
 */
export function comQuantidade(item: ItemDoNegocio, quantidade: number): ItemDoNegocio {
  const q = Math.max(1, Math.min(QUANTIDADE_MAXIMA, Math.trunc(quantidade)));
  const teto = item.precoUnitarioCents * q;
  return { ...item, quantidade: q, descontoCents: Math.min(item.descontoCents, teto) };
}

export type RecusaDoItem = "quantidade_invalida" | "desconto_invalido" | "desconto_maior_que_o_item";

/** A régua de um item do bloco antes de gravar (a mesma das CHECKs da 9160). */
export function recusaDoItem(item: Pick<ItemDoNegocio, "quantidade" | "descontoCents" | "precoUnitarioCents">): RecusaDoItem | null {
  if (!Number.isInteger(item.quantidade) || item.quantidade < 1 || item.quantidade > QUANTIDADE_MAXIMA) {
    return "quantidade_invalida";
  }
  if (!Number.isInteger(item.descontoCents) || item.descontoCents < 0) return "desconto_invalido";
  if (item.descontoCents > item.precoUnitarioCents * item.quantidade) return "desconto_maior_que_o_item";
  return null;
}

/**
 * O ganho pode ser confirmado? Com "Pedir o produto ao marcar como ganho"
 * ligado, só com pelo menos um item (do negócio ou da proposta). Desligado,
 * sempre: a janela mostra os itens mas deixa fechar sem.
 */
export function podeConfirmarGanho(args: { pedir: boolean; itens: readonly ItemDoNegocio[] }): boolean {
  return !args.pedir || args.itens.length > 0;
}

/** A quantidade como se lê: inteira sem casa, fração com vírgula (a proposta aceita fração). */
export function quantidadeLegivel(q: number): string {
  if (Number.isInteger(q)) return String(q);
  return q.toFixed(2).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
}

export interface LinhaDoCartao {
  /** O que cabe na linha: um nome, dois nomes, ou o primeiro e "+N". */
  texto: string;
  /** Todos os nomes, para o `title` (e o dossiê). */
  completo: string;
  /** Algum item veio de uma Proposta: o cartão mostra a etiqueta "proposta". */
  daProposta: boolean;
}

/**
 * Como o cartão escreve o que foi vendido (tela 1 do protótipo):
 *   um item     o nome, com "×2" quando a quantidade passa de um;
 *   dois        os dois nomes;
 *   três ou +   o primeiro e "+2" (o nome inteiro fica no `title` e no dossiê).
 * Sem item, `null`: o cartão diz "Sem <produto>".
 */
export function linhaDoCartao(itens: readonly ItemDoNegocio[]): LinhaDoCartao | null {
  if (itens.length === 0) return null;
  const nomes = itens.map((it) => (it.quantidade > 1 ? `${it.nome} ×${quantidadeLegivel(it.quantidade)}` : it.nome));
  const texto = nomes.length <= 2 ? nomes.join(" · ") : `${nomes[0]} +${nomes.length - 1}`;
  return { texto, completo: nomes.join(", "), daProposta: itens.some((it) => it.origem === "proposta") };
}

/**
 * A proposta dos itens do bloco, para o rótulo "da proposta 0012/2026": o número
 * com quatro dígitos, como o PDF da proposta e o "Excluir" do cartão o escrevem.
 */
export function rotuloDaProposta(p: PropostaDoItem | null | undefined): string | null {
  if (!p || p.numero === null || p.ano === null) return null;
  return `${String(p.numero).padStart(4, "0")}/${p.ano}`;
}

/**
 * Centavos como texto de campo ("4500,00"), o mesmo formato do campo Valor do
 * formulário do negócio (`centsToReais` do `LeadFieldsForm`). Quem lê de volta é
 * `parseReaisToCents` (lib/money.ts), com a moeda do negócio.
 */
export function centavosParaTexto(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * O arrasto (e o "Mover para…", e a barra de etapas do cartão aberto) até a
 * etapa de ganho passa pela janela de ganho. Não passa quem já está ganho, nem
 * quem só reordena dentro da própria etapa.
 */
export function arrastoAbreJanelaDoGanho(args: {
  etapaDeDestino: { is_won: boolean } | null | undefined;
  lead: { status: string | null; stage_id: string } | null | undefined;
  stageId: string;
}): boolean {
  const { etapaDeDestino, lead, stageId } = args;
  return !!etapaDeDestino?.is_won && !!lead && lead.status !== "won" && lead.stage_id !== stageId;
}
