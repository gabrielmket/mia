/**
 * FORK MIA (.101) · O RAIO-X DO ATENDIMENTO: as regras do cadastro, PURAS.
 *
 * A Time cadastra o raio-X de uma empresa (que não precisa ser cliente da MIA),
 * manda o link, o dono autoriza e conecta o WhatsApp comercial, e o sistema lê
 * as conversas para gerar o relatório. A arquitetura, as definições das
 * métricas e a LGPD estão em `docs/fork/raio-x-do-atendimento.md`.
 *
 * Este módulo não importa nada de servidor: a tela do "Novo raio-X" usa as
 * mesmas listas e o mesmo esquema que a rota e o MCP.
 */
import { z } from "zod";

// ─── Os prazos aprovados (decisões 5 e 6 do protótipo de 04/11/2026) ───────

/** O link de conexão vale 48 horas; depois, gera-se outro na lista. */
export const HORAS_DO_LINK_DE_CONEXAO = 48;
/** No diagnóstico único, a conexão cai sozinha 7 dias depois do relatório. */
export const DIAS_ATE_DESCONECTAR = 7;
/** As conversas lidas são apagadas 30 dias depois do relatório. */
export const DIAS_ATE_APAGAR_AS_CONVERSAS = 30;
/** O link do dono vale, por padrão, 30 dias (molde do link dos painéis). */
export const VALIDADES_DO_LINK_DO_DONO = [7, 30, 90] as const;
export type ValidadeDoLinkDoDono = (typeof VALIDADES_DO_LINK_DO_DONO)[number];
export const VALIDADE_PADRAO_DO_LINK_DO_DONO: ValidadeDoLinkDoDono = 30;

/** O teto de custo de UM raio-X, em centavos de real (padrão R$ 40, editável). */
export const TETO_PADRAO_CENTAVOS = 4000;
/** Teto mínimo e máximo aceitos no cadastro: R$ 5 a R$ 500. */
export const TETO_MINIMO_CENTAVOS = 500;
export const TETO_MAXIMO_CENTAVOS = 50_000;

// ─── As listas do cadastro ──────────────────────────────────────────────────

export const SEGMENTOS = [
  "revenda_de_veiculos",
  "clinica_odontologica",
  "clinica_de_estetica",
  "academia",
  "imobiliaria",
  "loja_e_varejo",
  "outro",
] as const;
export type Segmento = (typeof SEGMENTOS)[number];

export const PERIODOS_EM_DIAS = [30, 60, 90] as const;
export type PeriodoEmDias = (typeof PERIODOS_EM_DIAS)[number];

export const TIPOS = ["unico", "mensal"] as const;
export type TipoDoRaioX = (typeof TIPOS)[number];

export const QUEM_ATENDE = ["humano", "agente", "misto"] as const;
export type QuemAtende = (typeof QUEM_ATENDE)[number];

/**
 * A situação do raio-X, na ordem em que ela anda:
 *
 *   aguardando  link mandado, ninguém autorizou ainda
 *   conectando  o dono aceitou o termo; falta parear o aparelho
 *   lendo       pareado; o histórico chega em partes e é lido
 *   analisando  a leitura terminou; transcrição, nota e relatório
 *   pronto      há relatório (rascunho ou revisado); no mensal, segue conectado
 *   encerrado   desconectado; as conversas apagam no prazo
 */
export const SITUACOES = ["aguardando", "conectando", "lendo", "analisando", "pronto", "encerrado"] as const;
export type SituacaoDoRaioX = (typeof SITUACOES)[number];

// ─── O número comercial ─────────────────────────────────────────────────────

/**
 * O WhatsApp comercial em dígitos E.164 (sem `+`). Aceita o que se digita no
 * Brasil ("(31) 90000-1101") e põe o 55; número de outro país vem com o `+`.
 * `null` quando não tem forma de telefone.
 *
 * É o número da EMPRESA, não de um cliente dela: é por ele que a Time reconhece
 * "a mesma empresa" entre um raio-X e o seguinte (decisão 13).
 */
export function normalizarWhatsapp(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const texto = bruto.trim();
  if (!/^\+?[\d\s().-]+$/.test(texto)) return null;
  let digitos = texto.replace(/\D/g, "");
  const internacional = texto.startsWith("+");
  if (!internacional && (digitos.length === 10 || digitos.length === 11)) digitos = `55${digitos}`;
  if (!/^[1-9]\d{9,14}$/.test(digitos)) return null;
  if (digitos.startsWith("55") && !(digitos.length === 12 || digitos.length === 13)) return null;
  return digitos;
}

/** "(31) 90000-1101" para número do Brasil; "+<dígitos>" para os outros. */
export function whatsappParaLer(digitos: string): string {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digitos);
  if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  return `+${digitos}`;
}

// ─── O horário comercial ────────────────────────────────────────────────────

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutos desde a meia-noite de "HH:MM", ou `null`. */
export function minutosDoHorario(hhmm: unknown): number | null {
  if (typeof hhmm !== "string") return null;
  const m = HORA.exec(hhmm.trim().slice(0, 5));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export interface HorarioComercial {
  /** Minutos desde a meia-noite, de segunda a sexta. */
  abre: number;
  fecha: number;
  /** Até que horas o sábado vai (a abertura é a mesma da semana); `null` = não abre. */
  sabadoAte: number | null;
}

// ─── O cadastro ─────────────────────────────────────────────────────────────

const textoCurto = (max: number) => z.string().trim().min(1).max(max);
const opcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null));

export const esquemaDoNovoRaioX = z
  .object({
    empresa: textoCurto(120),
    segmento: z.enum(SEGMENTOS),
    whatsapp: z.string().trim().min(8).max(32),
    responsavel_nome: opcional(120),
    responsavel_contato: opcional(160),
    quem_atende: z.enum(QUEM_ATENDE).default("humano"),
    periodo_dias: z.coerce.number().int().refine((n) => (PERIODOS_EM_DIAS as readonly number[]).includes(n)).default(90),
    tipo: z.enum(TIPOS).default("unico"),
    abre: z.string().trim().regex(HORA).default("08:00"),
    fecha: z.string().trim().regex(HORA).default("18:00"),
    /** `null` = não abre no sábado. */
    sabado_ate: z.string().trim().regex(HORA).nullable().default("13:00"),
    /** A empresa da MIA, quando já é cliente (opcional; dá para ligar depois). */
    organization_id: z.string().uuid().nullable().optional().default(null),
    teto_centavos: z.coerce
      .number()
      .int()
      .min(TETO_MINIMO_CENTAVOS)
      .max(TETO_MAXIMO_CENTAVOS)
      .default(TETO_PADRAO_CENTAVOS),
  })
  .strict();

export type NovoRaioXBruto = z.input<typeof esquemaDoNovoRaioX>;

export interface NovoRaioX {
  empresa: string;
  segmento: Segmento;
  whatsapp: string;
  responsavel_nome: string | null;
  responsavel_contato: string | null;
  quem_atende: QuemAtende;
  periodo_dias: PeriodoEmDias;
  tipo: TipoDoRaioX;
  abre: string;
  fecha: string;
  sabado_ate: string | null;
  organization_id: string | null;
  teto_centavos: number;
}

export type ResultadoDoCadastro =
  | { ok: true; valor: NovoRaioX }
  | { ok: false; campos: string[] };

/** Valida e normaliza o cadastro. A recusa diz os CAMPOS, nunca o valor. */
export function validarNovoRaioX(bruto: unknown): ResultadoDoCadastro {
  const r = esquemaDoNovoRaioX.safeParse(bruto ?? {});
  if (!r.success) {
    return { ok: false, campos: [...new Set(r.error.issues.map((i) => String(i.path[0] ?? "corpo")))] };
  }
  const whatsapp = normalizarWhatsapp(r.data.whatsapp);
  if (!whatsapp) return { ok: false, campos: ["whatsapp"] };
  const abre = minutosDoHorario(r.data.abre)!;
  const fecha = minutosDoHorario(r.data.fecha)!;
  if (fecha <= abre) return { ok: false, campos: ["fecha"] };
  const sabado = r.data.sabado_ate === null ? null : minutosDoHorario(r.data.sabado_ate);
  if (sabado !== null && sabado <= abre) return { ok: false, campos: ["sabado_ate"] };
  return {
    ok: true,
    valor: {
      ...r.data,
      whatsapp,
      periodo_dias: r.data.periodo_dias as PeriodoEmDias,
      organization_id: r.data.organization_id ?? null,
    },
  };
}

/** O horário comercial de um raio-X gravado ("HH:MM" ou "HH:MM:SS" do Postgres). */
export function horarioDoRaioX(linha: { abre: string; fecha: string; sabado_ate: string | null }): HorarioComercial {
  return {
    abre: minutosDoHorario(linha.abre) ?? 8 * 60,
    fecha: minutosDoHorario(linha.fecha) ?? 18 * 60,
    sabadoAte: linha.sabado_ate ? minutosDoHorario(linha.sabado_ate) : null,
  };
}

/** "0187": o número de ordem com quatro dígitos. */
export function ordemFormatada(numero: number): string {
  return String(Math.max(0, Math.trunc(numero))).padStart(4, "0");
}

/**
 * "Cliente 0187": o número de ordem, nunca o telefone nem o nome (decisão 7).
 * Para texto que sai em português (MCP, mensagem pronta); a tela traduz
 * "Cliente {n}" com `ordemFormatada`.
 */
export function rotuloDoCliente(numero: number): string {
  return `Cliente ${ordemFormatada(numero)}`;
}
