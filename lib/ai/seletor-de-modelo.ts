/**
 * QUAIS ITENS O SELETOR DE MODELO DA PLATAFORMA OFERECE — a regra, sem tela.
 *
 * ── Por que isto sai do componente ────────────────────────────────────────
 *
 * As garantias que importam aqui são invisíveis num teste de renderização: o
 * Radix só monta `SelectContent` quando o menu está ABERTO, e abrir um Radix
 * Select em jsdom exige remendar `hasPointerCapture`. Medir o DOM fechado testa
 * o gatilho e nada mais — foi o que esta função veio corrigir depois de dois
 * casos passarem a medir vazio.
 *
 * E são garantias que valem a pena prender, porque cada uma existe por um
 * defeito concreto:
 *
 *   1. O Radix renderiza o gatilho EM BRANCO quando o `value` não tem
 *      `SelectItem` correspondente. Em branco lê-se como "nada escolhido" — e
 *      o Salvar seguinte grava outra coisa por cima, no campo que define a
 *      margem de todos os clientes.
 *   2. "Automático" não é um modelo de operadora nenhuma: é a ausência de
 *      escolha. Deixá-lo ser filtrado por uma busca tiraria da tela o único
 *      caminho de volta para `{provider: null, model_id: null}`.
 *   3. O valor que precisa sobreviver é o CORRENTE, não o salvo: quem marca um
 *      modelo e depois mexe no filtro veria a marcação sumir da tela enquanto
 *      ela continua na memória do componente — e salvaria às cegas.
 */

export interface ModeloParaSeletor {
  provider: string;
  model_id: string;
  display_name: string | null;
  input_price_per_million_cents: number | null;
}

/** `Select` do Radix não aceita valor vazio; este é o "nenhum". */
export const AUTOMATICO = "__automatico__";

/** O filtro desligado. Não é uma operadora — é a ausência de filtro. */
export const TODAS = "__todas__";

export type MotivoDaInjecao = "fora_do_filtro" | "fora_do_catalogo";

export interface ItemDoSeletor {
  valor: string;
  /** O modelo do catálogo, quando ele ainda está lá. */
  modelo: ModeloParaSeletor | null;
  /** Preenchido só no item que foi trazido de volta à força. */
  injetado: MotivoDaInjecao | null;
}

export interface ListaDoSeletor {
  itens: ItemDoSeletor[];
  /** Quantos passaram pelos filtros, para o contador da tela. */
  filtrados: number;
  total: number;
  /** Os filtros escondem tudo, e o catálogo NÃO está vazio. */
  filtroNaoCasa: boolean;
  /** O valor corrente saiu do catálogo — o caso grave. */
  foraDoCatalogo: boolean;
}

export const chaveDoModelo = (m: { provider: string; model_id: string }) =>
  `${m.provider}::${m.model_id}`;

/**
 * Compara sem acento e sem caixa.
 *
 * Quem digita "codigo" tem de achar "código". Reprovar a busca por uma
 * diferença que não aparece na tela é reprovar o operador por nada.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function itensDoSeletor(entrada: {
  modelos: readonly ModeloParaSeletor[];
  operadora: string;
  busca: string;
  /** O que está valendo AGORA: o salvo, ou o marcado e ainda não salvo. */
  valor: string;
}): ListaDoSeletor {
  const { modelos, operadora, busca, valor } = entrada;
  const termo = normalizar(busca.trim());

  const filtrados = modelos.filter((m) => {
    if (operadora !== TODAS && m.provider !== operadora) return false;
    if (!termo) return true;
    // Procura no que a pessoa vê E no id: o id é o que aparece no log quando a
    // chamada falha, e é por ele que alguém chega a esta tela.
    return normalizar(`${m.provider} ${m.display_name ?? ""} ${m.model_id}`).includes(termo);
  });

  const noCatalogo = modelos.find((m) => chaveDoModelo(m) === valor) ?? null;
  const visivel = filtrados.some((m) => chaveDoModelo(m) === valor);
  const foraDoCatalogo = valor !== AUTOMATICO && noCatalogo === null;

  const itens: ItemDoSeletor[] = [
    // O Automático vem SEMPRE e primeiro, imune aos dois filtros.
    { valor: AUTOMATICO, modelo: null, injetado: null },
  ];

  if (valor !== AUTOMATICO && !visivel) {
    itens.push({
      valor,
      modelo: noCatalogo,
      injetado: foraDoCatalogo ? "fora_do_catalogo" : "fora_do_filtro",
    });
  }

  for (const m of filtrados) {
    itens.push({ valor: chaveDoModelo(m), modelo: m, injetado: null });
  }

  return {
    itens,
    filtrados: filtrados.length,
    total: modelos.length,
    filtroNaoCasa: modelos.length > 0 && filtrados.length === 0,
    foraDoCatalogo,
  };
}
