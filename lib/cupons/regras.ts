/**
 * FORK MIA (.97) · A RÉGUA DOS CUPONS, PURA (protótipo "Cupons e parceiros",
 * aprovado em 27/10/2026, versão 9; docs/fork/cupons-e-parceiros.md).
 *
 * Sem servidor e sem banco: a página de preços, o cadastro, o passo do
 * pagamento, as telas da Time e o MCP falam esta língua. A régua que DECIDE
 * (com o limite de usos travado) é a função do banco `fn_mia_aplicar_cupom`
 * (9130); esta aqui é a mesma régua para MOSTRAR antes (o selo, o "não vale
 * neste plano", a mensagem de erro), e o teste `cupons-regras` confere os dois
 * lados nos mesmos casos.
 */

export type Beneficio = "pct" | "reais" | "dias";
export type TipoDoDescontoNoSetup = "nenhum" | "pct" | "reais";
export const MESES_DO_DESCONTO = [1, 3, 6, 12] as const;

/** O Asaas não cobra menos que R$ 5,00 (é também o piso do plano do upstream). */
export const MINIMO_DA_COBRANCA_CENTS = 500;

/** O cupom guarda no navegador por 30 dias (decisão 8). */
export const DIAS_DO_CUPOM_NO_NAVEGADOR = 30;
export const COOKIE_DO_CUPOM = "mia_cupom";

export interface CupomParaRegra {
  codigo: string;
  beneficio: Beneficio;
  /** O percentual, os reais ou os dias. */
  valor: number;
  /** Por quantas mensalidades; `null` = todas. Nulo nos dias grátis. */
  meses: number | null;
  setup_tipo: TipoDoDescontoNoSetup;
  setup_valor: number;
  planos: readonly string[];
  /** AAAA-MM-DD, inclusive. */
  vale_ate: string | null;
  limite_de_usos: number | null;
  ativo: boolean;
}

export type MotivoDoCupom =
  | "inexistente"
  | "pausado"
  | "vencido"
  | "esgotado"
  | "fora_do_plano"
  | "plano_escondido"
  | "ja_tem_cupom"
  | "ja_pagou"
  | "isenta"
  | "cobranca_desligada"
  | "vazio";

/** O código como o banco guarda: maiúsculas, sem espaço. */
export function normalizarCodigo(bruto: unknown): string {
  return String(bruto ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function codigoValido(codigo: string): boolean {
  return /^[A-Z0-9]{3,20}$/.test(codigo);
}

/** O dia civil de hoje em São Paulo (AAAA-MM-DD). */
export function hojeEmSaoPaulo(agora: Date): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    numberingSystem: "latn",
  }).formatToParts(agora);
  const de = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${de("year")}-${de("month")}-${de("day")}`;
}

/**
 * O cupom vale para este plano, agora? O motivo do primeiro "não", na ordem da
 * função do banco; `null` = vale. `usos` é quantas empresas já o usam.
 */
export function motivoDoCupom(
  cupom: CupomParaRegra | null,
  p: { planoId: string | null; planoOferecido?: boolean; usos: number; agora: Date },
): MotivoDoCupom | null {
  if (!cupom) return "inexistente";
  if (!cupom.ativo) return "pausado";
  if (cupom.vale_ate && cupom.vale_ate < hojeEmSaoPaulo(p.agora)) return "vencido";
  if (p.planoId !== null && p.planoOferecido === false) return "plano_escondido";
  if (p.planoId !== null && !cupom.planos.includes(p.planoId)) return "fora_do_plano";
  if (cupom.limite_de_usos !== null && p.usos >= cupom.limite_de_usos) return "esgotado";
  return null;
}

/** "07/11/2026" a partir de AAAA-MM-DD, sem fuso (é dia civil). */
export function diaCivilFormatado(data: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(data);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : data;
}

/**
 * A frase de cada motivo, como no protótipo (tela 1). `{codigo}`, `{data}`,
 * `{plano}` e `{planos}` são trocados por quem mostra.
 */
export const FRASE_DO_MOTIVO: Record<MotivoDoCupom, string> = {
  inexistente: "Não encontramos o cupom {codigo}. Confira as letras e os números.",
  pausado: "O cupom {codigo} está pausado. Fale com quem te passou o cupom.",
  vencido: "O cupom {codigo} venceu em {data}.",
  esgotado: "O cupom {codigo} já foi usado o número máximo de vezes.",
  fora_do_plano: "O cupom {codigo} não vale para o plano {plano}. Vale para: {planos}.",
  plano_escondido: "O cupom {codigo} não vale para este plano.",
  ja_tem_cupom: "A empresa já tem um cupom. Um cupom por cliente.",
  ja_pagou: "Depois do primeiro pagamento, o cupom só muda com a Time.",
  isenta: "Esta empresa não tem plano de cobrança.",
  cobranca_desligada: "Os cupons ainda não estão disponíveis.",
  vazio: "Digite o código do cupom.",
};

/** A frase pronta, com as trocas feitas (traduzir antes de trocar). */
export function fraseDoMotivo(
  motivo: MotivoDoCupom,
  o: { codigo: string; data?: string | null; plano?: string | null; planos?: readonly string[] },
  traduzir: (s: string) => string = (s) => s,
): string {
  return traduzir(FRASE_DO_MOTIVO[motivo])
    .replace("{codigo}", o.codigo)
    .replace("{data}", o.data ? diaCivilFormatado(o.data) : "")
    .replace("{plano}", o.plano ?? "")
    .replace("{planos}", (o.planos ?? []).join(", "));
}

const reaisDe = (cents: number) => Math.round(cents);

/**
 * A mensalidade com o desconto, em centavos. Dias grátis não mexem no preço.
 * Nunca abaixo do mínimo de cobrança do Asaas (nem acima do preço cheio).
 */
export function mensalidadeComCupom(precoCents: number, c: Pick<CupomParaRegra, "beneficio" | "valor"> | null): number {
  if (!c || c.beneficio === "dias") return precoCents;
  const desconto = c.beneficio === "pct" ? Math.round((precoCents * c.valor) / 100) : reaisDe(c.valor * 100);
  const com = precoCents - desconto;
  if (com >= precoCents) return precoCents;
  return Math.max(Math.min(MINIMO_DA_COBRANCA_CENTS, precoCents), com);
}

/**
 * O setup com o desconto do cupom, em centavos. Pode chegar a zero (cortesia:
 * nada é cobrado). Valor entre zero e o mínimo do Asaas sobe para o mínimo.
 */
export function setupComCupom(precoCents: number, c: Pick<CupomParaRegra, "setup_tipo" | "setup_valor"> | null): number {
  if (!c || c.setup_tipo === "nenhum" || precoCents <= 0) return Math.max(0, precoCents);
  const desconto = c.setup_tipo === "pct" ? Math.round((precoCents * c.setup_valor) / 100) : reaisDe(c.setup_valor * 100);
  const com = Math.max(0, precoCents - desconto);
  if (com === 0) return 0;
  return Math.max(Math.min(MINIMO_DA_COBRANCA_CENTS, precoCents), com);
}

/**
 * A mensalidade de ORDEM `n` (1 = a primeira paga) leva desconto? Pelo combinado:
 * as `meses` primeiras, ou todas (`null`). Dias grátis: nenhuma.
 */
export function mensalidadeTemDesconto(c: Pick<CupomParaRegra, "beneficio" | "meses">, n: number): boolean {
  if (c.beneficio === "dias") return false;
  return c.meses === null || n <= c.meses;
}

/** O valor de cada mensalidade de ordem `n`, com o combinado. */
export function valorDaMensalidade(precoCents: number, c: Pick<CupomParaRegra, "beneficio" | "valor" | "meses">, n: number): number {
  return mensalidadeTemDesconto(c, n) ? mensalidadeComCupom(precoCents, c) : precoCents;
}

const pct = (n: number) => `${String(Number(n)).replace(".", ",")}%`;

/** "R$ 1.234,56" a partir de centavos, sem depender do idioma do servidor. */
export function reais(cents: number): string {
  const negativo = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const inteiro = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const centavos = String(abs % 100).padStart(2, "0");
  return `${negativo ? "-" : ""}R$ ${inteiro},${centavos}`;
}
const brl = (n: number) => reais(Math.round(Number(n) * 100));

/**
 * O que o cupom dá, em palavras (o selo, as telas da Time, o MCP). As frases
 * fixas passam pelo `traduzir`; os números entram depois.
 */
export function textoDoBeneficio(
  c: Pick<CupomParaRegra, "beneficio" | "valor" | "meses">,
  traduzir: (s: string) => string = (s) => s,
): string {
  if (c.beneficio === "dias") return traduzir("{n} dias grátis").replace("{n}", String(c.valor));
  const quanto = c.beneficio === "pct" ? pct(c.valor) : brl(c.valor);
  const quando =
    c.meses === null
      ? traduzir("{v} de desconto em todas as mensalidades")
      : c.meses === 1
        ? traduzir("{v} de desconto na primeira mensalidade")
        : traduzir("{v} de desconto nas {n} primeiras mensalidades").replace("{n}", String(c.meses));
  return quando.replace("{v}", quanto);
}

export function textoDoSetup(
  c: Pick<CupomParaRegra, "setup_tipo" | "setup_valor"> | null,
  traduzir: (s: string) => string = (s) => s,
): string {
  if (!c || c.setup_tipo === "nenhum") return traduzir("sem desconto no setup");
  const quanto = c.setup_tipo === "pct" ? pct(c.setup_valor) : brl(c.setup_valor);
  return traduzir("{v} de desconto no setup").replace("{v}", quanto);
}

/** Quando o preço cheio volta (o texto curto do preço riscado). */
export function textoDoPeriodo(c: Pick<CupomParaRegra, "beneficio" | "meses">, traduzir: (s: string) => string = (s) => s): string {
  if (c.beneficio === "dias") return "";
  if (c.meses === null) return traduzir("sempre");
  if (c.meses === 1) return traduzir("no 1º mês");
  return traduzir("nos {n} primeiros meses").replace("{n}", String(c.meses));
}
