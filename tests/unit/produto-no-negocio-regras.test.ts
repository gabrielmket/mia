/**
 * FORK MIA (.109) · O PRODUTO NO NEGÓCIO, as regras puras
 * (lib/produto-no-negocio/; docs/fork/produto-no-negocio.md).
 *
 * A soma, o valor à mão, o preço congelado no rascunho, a regra do ganho com
 * "pedir" ligado ou desligado, o arrasto até a etapa de ganho, a linha do
 * cartão, a palavra do funil e do segmento, e o funil sem recorrente nas metas.
 *
 * Dado fictício: a Clínica Sorriso Exemplo e o catálogo do protótipo aprovado.
 */
import { describe, expect, it } from "vitest";

import {
  formasDaPalavra,
  funilDoProduto,
  mostrarValorRecorrente,
  palavraDoSegmentoNoFunil,
  palavraGravada,
  pedirProdutoNoGanho,
  pluralDaPalavra,
} from "@/lib/produto-no-negocio/funil";
import { contarComoAvulso, funisSemRecorrente } from "@/lib/produto-no-negocio/metas";
import {
  digitarAMao,
  pedidoDoRascunho,
  rascunhoInicial,
  rascunhoMudou,
  usarASoma,
  valorDoRascunho,
} from "@/lib/produto-no-negocio/rascunho";
import {
  adicionarAoRascunho,
  arrastoAbreJanelaDoGanho,
  comQuantidade,
  estadoDoValor,
  linhaDoCartao,
  podeConfirmarGanho,
  recusaDoItem,
  rotuloDaProposta,
  somaDosItens,
  somaEsperada,
  valorDoItem,
  type ItemDoNegocio,
  valorSegueAsVendas,
} from "@/lib/produto-no-negocio/regras";

const IMPLANTE = { id: "p-imp", codigo: "IMP-01", nome: "Implante unitário", precoCents: 450_000, moeda: "BRL" };
const CLAREAMENTO = { id: "p-cla", codigo: "CLA-01", nome: "Clareamento", precoCents: 120_000, moeda: "BRL" };
const LIMPEZA = { id: "p-lim", codigo: "LIM-01", nome: "Limpeza", precoCents: 22_000, moeda: "BRL" };

function item(p: typeof IMPLANTE, ajuste: Partial<ItemDoNegocio> = {}): ItemDoNegocio {
  return {
    id: `i-${p.id}`,
    origem: "negocio",
    productId: p.id,
    nome: p.nome,
    codigo: p.codigo,
    precoUnitarioCents: p.precoCents,
    quantidade: 1,
    descontoCents: 0,
    moeda: "BRL",
    proposta: null,
    ...ajuste,
  };
}

const daProposta = (ajuste: Partial<ItemDoNegocio> = {}): ItemDoNegocio => ({
  id: "pi-1",
  origem: "proposta",
  productId: "p-len",
  nome: "Lente de contato dental",
  codigo: null,
  precoUnitarioCents: 140_000,
  quantidade: 6,
  descontoCents: 40_000,
  moeda: "BRL",
  proposta: { id: "prop-1", numero: 12, ano: 2026 },
  ...ajuste,
});

describe("a soma dos itens", () => {
  it("é preço × quantidade, menos o desconto, item a item", () => {
    const itens = [item(IMPLANTE, { quantidade: 2 }), item(CLAREAMENTO, { descontoCents: 10_000 })];
    expect(valorDoItem(itens[0]!)).toBe(900_000);
    expect(valorDoItem(itens[1]!)).toBe(110_000);
    expect(somaDosItens(itens)).toBe(1_010_000);
  });

  it("o item nunca fica negativo, e o da proposta soma como na proposta (com fração)", () => {
    expect(valorDoItem(item(LIMPEZA, { descontoCents: 99_999 }))).toBe(0);
    expect(valorDoItem(daProposta())).toBe(6 * 140_000 - 40_000);
    expect(valorDoItem(daProposta({ quantidade: 1.5, descontoCents: 0 }))).toBe(210_000);
  });

  it("sem item a soma esperada é nula (Sem valor), com item é a soma, a proposta inclusive", () => {
    expect(somaEsperada([])).toBeNull();
    expect(somaEsperada([item(LIMPEZA), daProposta()])).toBe(22_000 + 800_000);
  });
});

describe("o valor do negócio: a soma, ou à mão", () => {
  it("valor igual à soma e nunca digitado: soma", () => {
    const itens = [item(IMPLANTE)];
    expect(estadoDoValor({ itens, valorCents: 450_000, valorAMao: false })).toMatchObject({ modo: "soma", antigo: false, somaCents: 450_000 });
  });

  it("digitado à mão (a marca) continua à mão mesmo quando bate com a soma", () => {
    expect(estadoDoValor({ itens: [item(IMPLANTE)], valorCents: 450_000, valorAMao: true }).modo).toBe("a_mao");
  });

  it("valor que não é a soma (gravado por fora do bloco: Inbox, MCP, REST) é à mão", () => {
    expect(estadoDoValor({ itens: [item(IMPLANTE)], valorCents: 500_000, valorAMao: false }).modo).toBe("a_mao");
  });

  it("negócio antigo (marca nula) com valor e sem item: à mão e antigo, sem adivinhar nada", () => {
    expect(estadoDoValor({ itens: [], valorCents: 340_000, valorAMao: null })).toEqual({
      modo: "a_mao",
      antigo: true,
      somaCents: null,
      valorCents: 340_000,
    });
  });

  it("negócio antigo sem valor e sem item: soma, Sem valor", () => {
    expect(estadoDoValor({ itens: [], valorCents: null, valorAMao: null })).toMatchObject({ modo: "soma", antigo: false });
  });

  it("digitar à mão parte da soma; usar a soma volta a seguir os itens", () => {
    const dados = { itens: [item(IMPLANTE), item(LIMPEZA)], valor: estadoDoValor({ itens: [item(IMPLANTE), item(LIMPEZA)], valorCents: 472_000, valorAMao: false }) };
    const r0 = rascunhoInicial(dados);
    expect(r0.modo).toBe("soma");
    const r1 = digitarAMao(r0);
    expect(r1).toMatchObject({ modo: "a_mao", valorTexto: "4720,00" });
    const r2 = { ...r1, valorTexto: "4.000,00" };
    expect(valorDoRascunho(r2, "BRL")).toBe(400_000);
    // Mudar um item não muda o valor digitado...
    const r3 = { ...r2, itens: [...r2.itens, item(CLAREAMENTO)] };
    expect(valorDoRascunho(r3, "BRL")).toBe(400_000);
    // ...até alguém pedir a soma.
    const r4 = usarASoma(r3);
    expect(r4).toMatchObject({ modo: "soma", antigo: false });
    expect(valorDoRascunho(r4, "BRL")).toBe(450_000 + 22_000 + 120_000);
  });

  it("o pedido leva só os itens do bloco e o modo do valor; valor digitado inválido não sai", () => {
    const itens = [item(IMPLANTE, { quantidade: 2 }), daProposta()];
    const r = rascunhoInicial({ itens, valor: estadoDoValor({ itens, valorCents: 1_700_000, valorAMao: false }) });
    expect(pedidoDoRascunho(r, "BRL")).toEqual({
      ok: true,
      pedido: { itens: [{ id: "i-p-imp", product_id: "p-imp", quantidade: 2, desconto_cents: 0 }], valor: { modo: "soma" } },
    });
    expect(pedidoDoRascunho({ ...r, modo: "a_mao", valorTexto: "abc" }, "BRL")).toEqual({ ok: false, motivo: "valor_invalido" });
    expect(pedidoDoRascunho({ ...r, modo: "a_mao", valorTexto: "" }, "BRL")).toMatchObject({
      ok: true,
      pedido: { valor: { modo: "a_mao", value_cents: null } },
    });
  });

  it("abrir e salvar sem mexer não muda nada: o negócio antigo continua intocado", () => {
    const gravado = { itens: [] as ItemDoNegocio[], valor: estadoDoValor({ itens: [], valorCents: 340_000, valorAMao: null }) };
    const r = rascunhoInicial(gravado);
    expect(r).toMatchObject({ modo: "a_mao", antigo: true, valorTexto: "3400,00" });
    expect(rascunhoMudou(r, gravado, "BRL")).toBe(false);
    expect(rascunhoMudou(adicionarEm(r), gravado, "BRL")).toBe(true);
  });
});

function adicionarEm(r: ReturnType<typeof rascunhoInicial>) {
  return { ...r, itens: adicionarAoRascunho(r.itens, IMPLANTE) };
}

describe("o preço entra congelado", () => {
  it("o item novo leva o preço do catálogo de agora, e o que já está no negócio fica com o dele", () => {
    const antigo = item(IMPLANTE, { precoUnitarioCents: 400_000 });
    const comNovoPreco = { ...IMPLANTE, precoCents: 480_000 };
    const depois = adicionarAoRascunho([antigo], comNovoPreco);
    // O mesmo produto soma 1 na quantidade, com o preço DO DIA em que entrou.
    expect(depois).toHaveLength(1);
    expect(depois[0]).toMatchObject({ quantidade: 2, precoUnitarioCents: 400_000 });
    const outro = adicionarAoRascunho(depois, CLAREAMENTO);
    expect(outro[1]).toMatchObject({ id: null, productId: "p-cla", precoUnitarioCents: 120_000, quantidade: 1 });
  });

  it("a quantidade para em 99 e o desconto encolhe junto com ela", () => {
    const cheio = item(LIMPEZA, { quantidade: 99 });
    expect(adicionarAoRascunho([cheio], LIMPEZA)[0]!.quantidade).toBe(99);
    const comDesconto = item(LIMPEZA, { quantidade: 3, descontoCents: 60_000 });
    expect(comQuantidade(comDesconto, 2)).toMatchObject({ quantidade: 2, descontoCents: 44_000 });
    expect(comQuantidade(comDesconto, 0).quantidade).toBe(1);
  });

  it("a régua do item é a das CHECKs da 9160", () => {
    expect(recusaDoItem({ quantidade: 0, descontoCents: 0, precoUnitarioCents: 100 })).toBe("quantidade_invalida");
    expect(recusaDoItem({ quantidade: 100, descontoCents: 0, precoUnitarioCents: 100 })).toBe("quantidade_invalida");
    expect(recusaDoItem({ quantidade: 1, descontoCents: -1, precoUnitarioCents: 100 })).toBe("desconto_invalido");
    expect(recusaDoItem({ quantidade: 2, descontoCents: 201, precoUnitarioCents: 100 })).toBe("desconto_maior_que_o_item");
    expect(recusaDoItem({ quantidade: 2, descontoCents: 200, precoUnitarioCents: 100 })).toBeNull();
  });
});

describe("Marcar como ganho: pedir ligado ou desligado", () => {
  it("ligado, só confirma com pelo menos um item (do bloco ou da proposta)", () => {
    expect(podeConfirmarGanho({ pedir: true, itens: [] })).toBe(false);
    expect(podeConfirmarGanho({ pedir: true, itens: [item(LIMPEZA)] })).toBe(true);
    expect(podeConfirmarGanho({ pedir: true, itens: [daProposta()] })).toBe(true);
  });

  it("desligado, confirma sempre", () => {
    expect(podeConfirmarGanho({ pedir: false, itens: [] })).toBe(true);
  });

  it("a opção: ausente é desligada, só o true liga", () => {
    expect(pedirProdutoNoGanho(null)).toBe(false);
    expect(pedirProdutoNoGanho({})).toBe(false);
    expect(pedirProdutoNoGanho({ pedir_produto_no_ganho: "sim" })).toBe(false);
    expect(pedirProdutoNoGanho({ pedir_produto_no_ganho: true })).toBe(true);
  });
});

describe("o arrasto até a etapa de ganho abre a janela", () => {
  const aberto = { status: "open", stage_id: "avaliacao" };
  it("chegar à etapa de ganho abre", () => {
    expect(arrastoAbreJanelaDoGanho({ etapaDeDestino: { is_won: true }, lead: aberto, stageId: "fechado" })).toBe(true);
  });
  it("etapa aberta, negócio já ganho, ou reordenar na própria etapa não abre", () => {
    expect(arrastoAbreJanelaDoGanho({ etapaDeDestino: { is_won: false }, lead: aberto, stageId: "orcamento" })).toBe(false);
    expect(arrastoAbreJanelaDoGanho({ etapaDeDestino: { is_won: true }, lead: { status: "won", stage_id: "fechado" }, stageId: "fechado" })).toBe(false);
    expect(arrastoAbreJanelaDoGanho({ etapaDeDestino: { is_won: true }, lead: { status: "open", stage_id: "fechado" }, stageId: "fechado" })).toBe(false);
    expect(arrastoAbreJanelaDoGanho({ etapaDeDestino: undefined, lead: aberto, stageId: "x" })).toBe(false);
  });
});

describe("a linha do cartão", () => {
  it("um item: o nome, com ×2 quando passa de um", () => {
    expect(linhaDoCartao([item(IMPLANTE)])).toEqual({ texto: "Implante unitário", completo: "Implante unitário", daProposta: false });
    expect(linhaDoCartao([item(IMPLANTE, { quantidade: 2 })])?.texto).toBe("Implante unitário ×2");
  });
  it("dois: os dois nomes; três ou mais: o primeiro e +2, com todos no completo", () => {
    expect(linhaDoCartao([item(CLAREAMENTO), item(LIMPEZA)])?.texto).toBe("Clareamento · Limpeza");
    const tres = linhaDoCartao([item(IMPLANTE), item(CLAREAMENTO), item(LIMPEZA)]);
    expect(tres).toMatchObject({ texto: "Implante unitário +2", completo: "Implante unitário, Clareamento, Limpeza" });
  });
  it("sem item é nulo (o cartão diz Sem <produto>); item da proposta liga a etiqueta", () => {
    expect(linhaDoCartao([])).toBeNull();
    expect(linhaDoCartao([daProposta()])).toMatchObject({ texto: "Lente de contato dental ×6", daProposta: true });
    expect(rotuloDaProposta({ id: "x", numero: 12, ano: 2026 })).toBe("0012/2026");
    expect(rotuloDaProposta({ id: "x", numero: null, ano: null })).toBeNull();
  });
});

describe("a palavra do funil e as opções", () => {
  const padrao = { singular: "produto ou serviço", plural: "produtos e serviços" };
  it("em branco vale o padrão do sistema; escrita, as quatro formas", () => {
    expect(palavraGravada({ produto: "  " })).toBeNull();
    expect(formasDaPalavra(null, padrao)).toEqual({
      s: "produto ou serviço",
      S: "Produto ou serviço",
      p: "produtos e serviços",
      P: "Produtos e serviços",
      padrao: true,
    });
    expect(formasDaPalavra("Tratamento", padrao)).toEqual({ s: "tratamento", S: "Tratamento", p: "tratamentos", P: "Tratamentos", padrao: false });
  });

  it("o plural pela régua do protótipo", () => {
    expect(pluralDaPalavra("Serviço")).toBe("Serviços");
    expect(pluralDaPalavra("Procedimento")).toBe("Procedimentos");
    expect(pluralDaPalavra("Sessão")).toBe("Sessões");
    expect(pluralDaPalavra("Colar")).toBe("Colares");
    expect(pluralDaPalavra("Animal")).toBe("Animais");
    expect(pluralDaPalavra("Pacotes")).toBe("Pacotes");
  });

  it("os funis que já existem nascem como hoje: pedir desligado, recorrente ligado", () => {
    expect(mostrarValorRecorrente(null)).toBe(true);
    expect(mostrarValorRecorrente({ mostrar_valor_recorrente: false })).toBe(false);
    expect(funilDoProduto({ id: "f", vocabulary: { won: "Fechado" }, settings: { won_reasons: ["Indicação"] } })).toEqual({
      pipeline_id: "f",
      palavra: null,
      pedir_no_ganho: false,
      mostrar_valor_recorrente: true,
      ganho: "Fechado",
      motivos_de_ganho: ["Indicação"],
      motivo_de_ganho_obrigatorio: false,
    });
  });
});

describe("a palavra do segmento na implantação", () => {
  it("clínica: Tratamento, e o negócio que se chama Tratamento vira Plano de tratamento", () => {
    expect(palavraDoSegmentoNoFunil({ deal: "Tratamento" }, "clinica")).toEqual({
      vocabulario: { produto: "Tratamento", deal: "Plano de tratamento" },
      mantida: false,
    });
    expect(palavraDoSegmentoNoFunil({ deal: "Avaliação" }, "clinica").vocabulario).toEqual({ produto: "Tratamento" });
  });
  it("loja e escritório", () => {
    expect(palavraDoSegmentoNoFunil({}, "loja").vocabulario).toEqual({ produto: "Produto" });
    expect(palavraDoSegmentoNoFunil(null, "escritorio").vocabulario).toEqual({ produto: "Serviço" });
  });
  it("garantir não atropela a palavra escolhida, a não ser que peça sobrescrever; repetir não muda nada", () => {
    expect(palavraDoSegmentoNoFunil({ produto: "Procedimento" }, "clinica")).toEqual({ vocabulario: {}, mantida: true });
    expect(palavraDoSegmentoNoFunil({ produto: "Procedimento" }, "clinica", true).vocabulario).toEqual({ produto: "Tratamento" });
    expect(palavraDoSegmentoNoFunil({ produto: "Tratamento", deal: "Plano de tratamento" }, "clinica")).toEqual({ vocabulario: {}, mantida: false });
  });
});

describe("o funil sem valor recorrente conta como avulso nas metas", () => {
  it("as vendas desse funil viram avulso, sem a mensalidade; as dos outros ficam como estão", () => {
    const semRecorrente = funisSemRecorrente([
      { id: "clinica", settings: { mostrar_valor_recorrente: false } },
      { id: "academia", settings: {} },
    ]);
    expect([...semRecorrente]).toEqual(["clinica"]);
    const vendas = [
      { pipeline_id: "clinica", revenue_kind: "recorrente" as const, recurring_value_cents: 110_000, recurring_months: 12, value_cents: 0 },
      { pipeline_id: "academia", revenue_kind: "recorrente" as const, recurring_value_cents: 9_900, recurring_months: 12, value_cents: 0 },
    ];
    const lidas = contarComoAvulso(vendas, semRecorrente);
    expect(lidas[0]).toMatchObject({ revenue_kind: "avulso", recurring_value_cents: null, recurring_months: null });
    expect(lidas[1]).toEqual(vendas[1]);
    // Nada é regravado: a lista de entrada continua igual.
    expect(vendas[0]!.revenue_kind).toBe("recorrente");
  });
});

// FORK MIA (fusão v1.124): o Valor só segue as vendas registradas do upstream sem item do bloco.
describe("valorSegueAsVendas", () => {
  it("sem venda, nunca", () => {
    expect(valorSegueAsVendas({ vendas: 0, itens: [] })).toBe(false);
    expect(valorSegueAsVendas({ vendas: 0, itens: undefined })).toBe(false);
  });
  it("com venda e sem item do bloco, segue as vendas (o upstream inteiro)", () => {
    expect(valorSegueAsVendas({ vendas: 2, itens: [] })).toBe(true);
    expect(valorSegueAsVendas({ vendas: 1, itens: null })).toBe(true);
    // Item da proposta é do upstream: não tira o negócio das vendas.
    expect(valorSegueAsVendas({ vendas: 1, itens: [{ origem: "proposta" }] })).toBe(true);
  });
  it("com item do bloco, o valor é dos itens mesmo com venda", () => {
    expect(valorSegueAsVendas({ vendas: 3, itens: [{ origem: "negocio" }] })).toBe(false);
    expect(valorSegueAsVendas({ vendas: 3, itens: [{ origem: "proposta" }, { origem: "negocio" }] })).toBe(false);
  });
});
