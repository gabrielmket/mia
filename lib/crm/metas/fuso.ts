/**
 * O MÊS DE QUEM OPERA, e não o mês de Greenwich.
 *
 * O relatório fechava o mês em UTC: a janela ia de `AAAA-MM-01T00:00:00Z` até o
 * dia 1º do mês seguinte, também em Z. Para uma empresa em São Paulo (UTC-3)
 * isso corta o mês às 21h do último dia — uma venda fechada às 22h do dia 30
 * cai em outubro, e a reunião marcada depois das 21h some do mês em que ela
 * aconteceu para quem a marcou.
 *
 * Ninguém notaria olhando o total do mês: o dinheiro não some, ele muda de
 * mês. O defeito só aparece na conferência de comissão, um mês depois, quando
 * já não dá para lembrar.
 *
 * `Intl` faz a conta com as regras de fuso do sistema, inclusive horário de
 * verão onde ele existe — cravar `-3` acertaria o Brasil de hoje e erraria o
 * Brasil de 2018, o Chile e Portugal.
 */

/** O fuso usado quando a organização não declarou nenhum. */
export const FUSO_PADRAO = "UTC";

/**
 * Em que mês (AAAA-MM) este instante caiu, no fuso informado.
 *
 * Instante inválido devolve string vazia — que não casa com período nenhum, e
 * por isso a linha some da conta em vez de entrar no mês errado.
 */
export function mesNoFuso(iso: string | null, fuso: string): string {
  if (!iso) return "";
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return "";
  try {
    const partes = formatadorDoMes(fuso).formatToParts(quando);
    const ano = partes.find((p) => p.type === "year")?.value;
    const mes = partes.find((p) => p.type === "month")?.value;
    return ano && mes ? `${ano}-${mes}` : "";
  } catch {
    // Fuso desconhecido (dado velho, digitação): cai em UTC em vez de derrubar
    // o relatório inteiro. É o mesmo mês de antes desta correção.
    return iso.slice(0, 7);
  }
}

/**
 * O formatador do mês, UM por fuso.
 *
 * Construir um `Intl.DateTimeFormat` é a parte cara desta conta (medido: perto
 * de 0,1 ms cada), e `mesNoFuso` roda uma vez por negócio em cada pergunta do
 * relatório. Enquanto a rota lia no máximo 1000 linhas isso não aparecia; com a
 * leitura inteira (`lib/leitura/todas-as-paginas.ts`), 50 mil negócios custavam
 * 18 segundos de processador só construindo formatador. Guardado, o mesmo
 * relatório sai em menos de um segundo, com o mesmo resultado.
 *
 * Fuso inválido LANÇA na construção e não entra no mapa: quem chama cai no
 * `catch` de sempre, a cada vez.
 */
const FORMATADORES_DO_MES = new Map<string, Intl.DateTimeFormat>();

function formatadorDoMes(fuso: string): Intl.DateTimeFormat {
  let formatador = FORMATADORES_DO_MES.get(fuso);
  if (!formatador) {
    formatador = new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
    });
    FORMATADORES_DO_MES.set(fuso, formatador);
  }
  return formatador;
}

/**
 * Quanto o relógio do fuso está à frente do UTC NAQUELE instante, em minutos.
 * Negativo para as Américas.
 */
function deslocamentoEmMinutos(fuso: string, instante: Date): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instante);
  const n = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? "0");
  // `hour` volta 24 à meia-noite em algumas engines; 24 e 0 são o mesmo instante.
  const hora = n("hour") % 24;
  const comoSeFosseUtc = Date.UTC(n("year"), n("month") - 1, n("day"), hora, n("minute"), n("second"));
  return (comoSeFosseUtc - instante.getTime()) / 60_000;
}

export interface JanelaDoMes {
  /** Primeiro instante do mês, no fuso — já convertido para UTC. */
  inicio: string;
  /** Primeiro instante do mês SEGUINTE. Fim exclusivo. */
  fim: string;
}

/**
 * A janela de um mês (AAAA-MM ou AAAA-MM-DD) no fuso de quem opera.
 *
 * Duas passadas de propósito: o deslocamento depende do instante, e o instante
 * depende do deslocamento. A primeira passada chuta UTC, a segunda corrige com
 * o deslocamento real daquela data — é o que acerta a virada do horário de
 * verão, em que a primeira estimativa cai do lado errado da mudança.
 */
export function janelaDoMes(periodo: string, fuso: string): JanelaDoMes {
  const partes = periodo.slice(0, 7).split("-");
  const ano = Number(partes[0]);
  const mes = Number(partes[1]);

  const instanteDe = (a: number, m: number): string => {
    const chute = Date.UTC(a, m - 1, 1, 0, 0, 0);
    let real = chute;
    for (let i = 0; i < 2; i++) {
      const desloc = deslocamentoEmMinutos(fuso, new Date(real));
      real = chute - desloc * 60_000;
    }
    return new Date(real).toISOString();
  };

  return {
    inicio: instanteDe(ano, mes),
    fim: mes === 12 ? instanteDe(ano + 1, 1) : instanteDe(ano, mes + 1),
  };
}
