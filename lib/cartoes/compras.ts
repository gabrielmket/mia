/**
 * FORK MIA — HISTÓRICO DE COMPRAS: quem já comprou, o quê, quanto e quando.
 *
 * Aparece em três lugares (ficha do contato, ficha da empresa, cartão aberto)
 * e no cartão fechado vira o selo "recorrente". Uma régua só para os quatro: o
 * resumo é esta função pura, e quem busca as compras é `compras-servidor.ts`.
 *
 * ─── De onde vem uma compra ────────────────────────────────────────────────
 *
 *  1. NEGÓCIO GANHO (`crm_leads.status = 'won'`): o valor do negócio, na data
 *     em que fechou (`closed_at`). É a fonte de quem vende pelo funil.
 *  2. PEDIDO DO CONTATO (`orders`, a mesma tabela que a ferramenta
 *     `crm_list_contact_orders` lê): conta o pedido pago, faturado, enviado ou
 *     entregue — pendente, cancelado e reembolsado não são compra.
 *
 * ─── O que é ESTIMATIVA e por isso é dito ──────────────────────────────────
 *
 * "Próxima compra provável" é a última compra mais o intervalo médio entre as
 * compras. É uma média, não uma previsão de comportamento — a tela a marca como
 * estimativa, e com UMA compra só não há intervalo para medir (a tela diz
 * "aparece a partir da 2ª compra", em vez de inventar um padrão).
 *
 * O HÁBITO (o quê, pagamento, finalidade) não tem campo próprio em lugar
 * nenhum. Ele é DERIVADO do que existe: os itens que se repetem, a forma de
 * pagamento dos pedidos e os campos do negócio cujo nome fala de pagamento ou
 * finalidade. `derivado: true` é para a tela dizer isso a quem lê.
 */
import { diasEntre, MS_POR_DIA } from "@/lib/cartoes/tempo";

export type OrigemDaCompra = "negocio_ganho" | "pedido";

export interface Compra {
  id: string;
  /** ISO do dia da compra (fechamento do negócio ou data do pedido). */
  data: string;
  /** O que foi comprado — título do negócio ou itens do pedido. */
  item: string;
  valorCents: number;
  moeda: string;
  origem: OrigemDaCompra;
  /** "Negócio ganho: Sala Moema" · "Pedido nº 1042". */
  referencia: string;
  contatoId: string | null;
  contatoNome: string | null;
  empresaId: string | null;
  /** Negócio que gerou a compra (para o link), quando é negócio ganho. */
  negocioId: string | null;
  /** Forma de pagamento, quando o dado existe (pedido ou campo do negócio). */
  pagamento: string | null;
  /** Finalidade, quando um campo do negócio a registra. */
  finalidade: string | null;
}

export interface HabitoDeCompra {
  oQue: string | null;
  pagamento: string | null;
  finalidade: string | null;
  /** Sempre verdadeiro hoje: não há campo estruturado de hábito. */
  derivado: true;
}

export interface ResumoDeCompras {
  selo: "cliente" | "recorrente";
  quantidade: number;
  /** Soma na moeda principal (a mais frequente). */
  totalCents: number;
  moeda: string;
  /** Há compra em outra moeda, fora da soma — a tela avisa. */
  outrasMoedas: boolean;
  ticketMedioCents: number;
  ultima: { data: string; haDias: number };
  primeira: { data: string; haDias: number };
  /** `null` com uma compra só: não há intervalo para medir. */
  intervaloMedioDias: number | null;
  intervalosMedidos: number;
  /** ESTIMATIVA: última + intervalo médio. `null` com uma compra só. */
  proximaProvavel: { data: string; jaPassou: boolean; emDias: number } | null;
  habito: HabitoDeCompra;
  /** Da mais recente para a mais antiga. */
  compras: Compra[];
}

function maisFrequente(valores: Array<string | null | undefined>): string | null {
  const conta = new Map<string, { n: number; original: string }>();
  for (const v of valores) {
    const limpo = v?.trim();
    if (!limpo) continue;
    const chave = limpo.toLowerCase();
    const atual = conta.get(chave);
    conta.set(chave, { n: (atual?.n ?? 0) + 1, original: atual?.original ?? limpo });
  }
  let melhor: { n: number; original: string } | null = null;
  for (const c of conta.values()) if (!melhor || c.n > melhor.n) melhor = c;
  return melhor?.original ?? null;
}

/**
 * O "o quê" do hábito: o item que se repete, quando algum se repete; senão os
 * dois mais recentes, distintos. Nunca a lista inteira — hábito é padrão, não
 * extrato.
 */
function oQueCompra(compras: Compra[]): string | null {
  const repetido = maisFrequente(compras.map((c) => c.item));
  const vezes = compras.filter((c) => c.item.trim().toLowerCase() === repetido?.toLowerCase()).length;
  if (repetido && vezes >= 2) return repetido;
  const distintos: string[] = [];
  for (const c of compras) {
    const item = c.item.trim();
    if (item && !distintos.some((d) => d.toLowerCase() === item.toLowerCase())) distintos.push(item);
    if (distintos.length === 2) break;
  }
  return distintos.length > 0 ? distintos.join("; ") : null;
}

export function resumirCompras(lista: Compra[], agora: Date): ResumoDeCompras | null {
  if (lista.length === 0) return null;
  const compras = [...lista].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

  const moeda = maisFrequente(compras.map((c) => c.moeda)) ?? "BRL";
  const daMoeda = compras.filter((c) => c.moeda === moeda);
  const totalCents = daMoeda.reduce((s, c) => s + c.valorCents, 0);
  const ultima = compras[0]!;
  const primeira = compras[compras.length - 1]!;

  const crescente = [...compras].reverse();
  let somaIntervalos = 0;
  for (let i = 1; i < crescente.length; i++) {
    somaIntervalos +=
      (new Date(crescente[i]!.data).getTime() - new Date(crescente[i - 1]!.data).getTime()) / MS_POR_DIA;
  }
  const intervalosMedidos = crescente.length - 1;
  const intervaloMedioDias = intervalosMedidos > 0 ? Math.round(somaIntervalos / intervalosMedidos) : null;

  let proximaProvavel: ResumoDeCompras["proximaProvavel"] = null;
  if (intervaloMedioDias !== null) {
    const quando = new Date(new Date(ultima.data).getTime() + intervaloMedioDias * MS_POR_DIA);
    const jaPassou = quando.getTime() < agora.getTime();
    proximaProvavel = {
      data: quando.toISOString(),
      jaPassou,
      emDias: jaPassou ? 0 : diasEntre(agora, quando),
    };
  }

  return {
    selo: compras.length >= 2 ? "recorrente" : "cliente",
    quantidade: compras.length,
    totalCents,
    moeda,
    outrasMoedas: daMoeda.length !== compras.length,
    ticketMedioCents: daMoeda.length > 0 ? Math.round(totalCents / daMoeda.length) : 0,
    ultima: { data: ultima.data, haDias: diasEntre(ultima.data, agora) },
    primeira: { data: primeira.data, haDias: diasEntre(primeira.data, agora) },
    intervaloMedioDias,
    intervalosMedidos,
    proximaProvavel,
    habito: {
      oQue: oQueCompra(compras),
      pagamento: maisFrequente(compras.map((c) => c.pagamento)),
      finalidade: maisFrequente(compras.map((c) => c.finalidade)),
      derivado: true,
    },
    compras,
  };
}

/**
 * Os campos do negócio que respondem "como pagou" e "para quê", lidos pelo
 * NOME do campo (chave ou rótulo). Os modelos por segmento os chamam de
 * "Forma de pagamento", "Pagamento", "Finalidade" — o que achar primeiro vale.
 */
export function habitoDosCampos(
  camposDoNegocio: Record<string, unknown> | null | undefined,
  definicoes: Array<{ key: string; label?: string | null }> = [],
): { pagamento: string | null; finalidade: string | null } {
  const valores = camposDoNegocio ?? {};
  const rotulo = new Map(definicoes.map((d) => [d.key, (d.label ?? d.key).toLowerCase()]));
  const achar = (padrao: RegExp): string | null => {
    for (const [chave, valor] of Object.entries(valores)) {
      const nome = `${chave.toLowerCase()} ${rotulo.get(chave) ?? ""}`;
      if (!padrao.test(nome)) continue;
      if (typeof valor === "string" && valor.trim()) return valor.trim();
      if (Array.isArray(valor) && valor.length > 0) return valor.map(String).join(", ");
    }
    return null;
  };
  return { pagamento: achar(/pagamento|payment/), finalidade: achar(/finalidade|objetivo|uso/) };
}

/** Situações de `orders.status` que são compra de fato. */
export const PEDIDO_E_COMPRA = ["paid", "fulfilled", "shipped", "delivered"] as const;

/**
 * O nome dos itens de um pedido, lido do `payload` da loja (Nuvemshop, VTEX,
 * Shopify guardam listas com nomes diferentes). Sem itens legíveis, `null` — e
 * quem chama usa "Pedido nº X".
 */
export function itensDoPedido(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const lista = [p.products, p.items, p.line_items, p.itens].find(Array.isArray) as unknown[] | undefined;
  if (!lista) return null;
  const nomes = lista
    .map((i) => {
      if (!i || typeof i !== "object") return null;
      const o = i as Record<string, unknown>;
      const nome = [o.name, o.title, o.product_name, o.nome].find((v) => typeof v === "string" && v.trim());
      return typeof nome === "string" ? nome.trim() : null;
    })
    .filter((n): n is string => Boolean(n));
  if (nomes.length === 0) return null;
  return nomes.length > 3 ? `${nomes.slice(0, 3).join(", ")} +${nomes.length - 3}` : nomes.join(", ");
}
