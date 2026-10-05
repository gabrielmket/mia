/**
 * FORK MIA — cartões e fichas. O tempo dito como uma pessoa diria.
 *
 * Duas réguas, e cada uma tem o seu lugar:
 *
 *  - `duracaoCurta` é a do cartão: "12 min", "3 h", "4 dias". Cabe na linha da
 *    conversa ("Lead há 12 min") e responde "há quanto tempo a bola está com
 *    alguém" — que é pergunta de minutos e horas.
 *  - `duracaoLonga` é a do histórico de compras: "8 meses", "1 ano e 3 meses".
 *    Compra se mede em meses; "há 392 dias" obrigaria quem lê a fazer a conta.
 *
 * Nenhuma das duas lança nem devolve negativo: instante no futuro (relógio do
 * servidor adiantado, dado escrito com fuso errado) vira "agora" / "0 dias", e
 * nunca "há -3 min" na frente do cliente.
 */

export type Traduzir = (texto: string) => string;

const SEM_TRADUCAO: Traduzir = (texto) => texto;

const MINUTO = 60_000;
const DIA = 86_400_000;
/** A média do calendário gregoriano; é o que faz 12 "meses" darem um ano. */
const DIAS_POR_MES = 30.44;

/** "12 min", "3 h", "4 dias", "2 meses" — para o cartão. */
export function duracaoCurta(ms: number, t: Traduzir = SEM_TRADUCAO): string {
  const minutos = Math.floor(Math.max(0, ms) / MINUTO);
  if (minutos < 1) return t("agora");
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias < 31) return dias === 1 ? `1 ${t("dia")}` : `${dias} ${t("dias")}`;
  const meses = Math.floor(dias / DIAS_POR_MES);
  if (meses < 12) return meses <= 1 ? `1 ${t("mês")}` : `${meses} ${t("meses")}`;
  const anos = Math.floor(meses / 12);
  return anos === 1 ? `1 ${t("ano")}` : `${anos} ${t("anos")}`;
}

/** "há 12 min" — ou "agora", que já diz o "há". */
export function haQuanto(desde: string | Date, agora: Date, t: Traduzir = SEM_TRADUCAO): string {
  const ms = agora.getTime() - new Date(desde).getTime();
  const curta = duracaoCurta(ms, t);
  return curta === t("agora") ? curta : t("há {tempo}").replace("{tempo}", curta);
}

/** "8 dias", "5 meses", "1 ano e 3 meses" — para compras. */
export function duracaoLonga(dias: number, t: Traduzir = SEM_TRADUCAO): string {
  const n = Math.max(0, Math.floor(dias));
  if (n < 31) return n === 1 ? `1 ${t("dia")}` : `${n} ${t("dias")}`;
  const meses = Math.floor(n / DIAS_POR_MES);
  if (meses < 12) return meses <= 1 ? `1 ${t("mês")}` : `${meses} ${t("meses")}`;
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  const parteAnos = anos === 1 ? `1 ${t("ano")}` : `${anos} ${t("anos")}`;
  if (resto === 0) return parteAnos;
  const parteMeses = resto === 1 ? `1 ${t("mês")}` : `${resto} ${t("meses")}`;
  return `${parteAnos} ${t("e")} ${parteMeses}`;
}

/** Dias inteiros entre dois instantes (b − a), nunca negativo. */
export function diasEntre(a: string | Date, b: string | Date): number {
  return Math.max(0, Math.floor((new Date(b).getTime() - new Date(a).getTime()) / DIA));
}

export const MS_POR_DIA = DIA;
