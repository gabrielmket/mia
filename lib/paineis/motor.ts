/**
 * FORK MIA (9030) — A PORTA DO MOTOR DE CONTA, do lado do TypeScript.
 *
 * Toda conta dos painéis prontos (item 8) e do montador de relatórios (item 9)
 * é feita no banco, por `fn_mia_relatorio` (migration 9030). Aqui mora só o
 * pedido tipado e a leitura da resposta: nenhuma soma, nenhuma mediana, nenhuma
 * taxa é refeita no servidor ou no navegador (decisão do protótipo: "no
 * navegador a conta para nas primeiras 1000 linhas e o número sai errado sem
 * avisar").
 *
 * ── Quem chama, e com qual cliente ────────────────────────────────────────
 *
 * - A TELA chama com o cliente da SESSÃO (`createClient`): o motor é `security
 *   invoker`, e cada um vê o que a RLS já deixa ver no CRM.
 * - O LINK DO DONO e o MCP chamam com o cliente de SERVIÇO, com a organização
 *   resolvida no servidor (a linha do link, o token de plataforma) — nunca do
 *   corpo do pedido.
 *
 * Módulo sem `server-only` de propósito: só importa TIPO do supabase-js, e o
 * cliente vem de quem chama.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Dimensao, Fonte, Medida, PeriodoDoMotor } from "./catalogo";

export interface PedidoAoMotor {
  organizationId: string;
  fonte: Fonte;
  medidas: readonly Medida[];
  dim1?: Dimensao | null;
  dim2?: Dimensao | null;
  /**
   * Um valor por chave, ou uma lista (qualquer um passa, 9041); `"__sem"` pede
   * a ausência. Funil e só-receita são de um valor só.
   */
  filtros?: Record<string, string | boolean | string[]>;
  periodo: PeriodoDoMotor;
  /** Só com `periodo: "pers"`: `AAAA-MM-DD`, no fuso da empresa. */
  de?: string | null;
  ate?: string | null;
  /** `false`: as medidas de dinheiro voltam nulas, e a meta sem o alvo. */
  valores?: boolean;
  comparar?: boolean;
  /** Só para teste: congela o "agora". O produto não passa. */
  agora?: string | null;
}

export interface ValoresDoGrupo {
  n: number;
  n_ok: number;
  valores: Partial<Record<Medida, number | null>>;
}

export interface GrupoDoMotor extends ValoresDoGrupo {
  chave: string;
  /** O nome que o banco tem (etapa, tipo, régua, agente); nulo quando a chave é código. */
  rotulo: string | null;
  /** A posição da etapa, quando o agrupamento é por etapa. */
  ordem: number | null;
  sem: boolean;
  outros: boolean;
  /** Em "Outros": quantos grupos foram dobrados nele. */
  quantos?: number | null;
  /** Etapa de ganho (só no funil "chegaram"). */
  ganho?: boolean;
  /**
   * A meta daquele pedaço de tempo, em centavos (9041): na soma dos ganhos
   * agrupando por mês, semana ou dia. Nula sem meta cadastrada ou sem valores.
   */
  meta_cents?: number | null;
  series?: Record<string, ValoresDoGrupo>;
}

export interface SerieDoMotor {
  chave: string;
  rotulo: string | null;
  sem: boolean;
  outros: boolean;
  quantos?: number | null;
  n: number;
}

export interface JanelaDoMotor {
  periodo: string;
  de: string | null;
  ate: string | null;
  inicio: string | null;
  fim: string | null;
  fuso: string;
  hoje: string;
  futuro: boolean;
  dias: number | null;
}

export interface MetaDoMotor {
  /** Nulo quando a resposta não leva dinheiro. */
  alvo_cents: number | null;
  proporcional: boolean;
  meses_sem_meta: number;
  /** Realizado ÷ alvo (1 = 100%). */
  fracao: number | null;
  /** Quanto do mês já correu (0 a 1), só em "Este mês". */
  corrido: number | null;
}

export interface RespostaDoMotor {
  fonte: Fonte;
  medidas: Medida[];
  dim1: Dimensao | null;
  dim2: Dimensao | null;
  filtros: Record<string, unknown>;
  janela: JanelaDoMotor;
  moeda: string;
  valores: boolean;
  total: ValoresDoGrupo;
  fora_da_moeda: number;
  grupos: GrupoDoMotor[];
  series: SerieDoMotor[] | null;
  dobrados: string[];
  /** As séries que foram para "Outros" (9041): a lista da célula "Outros" pede por elas. */
  series_dobradas?: string[];
  funil: { id: string; nome: string; vocabulario: Record<string, unknown> | null } | null;
  meta: MetaDoMotor | null;
  anterior: {
    janela: JanelaDoMotor;
    total: ValoresDoGrupo;
    grupos: Record<string, { n: number; valores: Partial<Record<Medida, number | null>> }>;
  } | null;
}

/**
 * A recusa do motor, com o SQLSTATE: `42501` é "você não pode ver isto" (sem
 * vínculo com a empresa, ou anúncios sem ser gestor); `22023` é pedido fora do
 * catálogo. Quem chama decide a frase.
 */
export class RecusaDoMotor extends Error {
  constructor(
    readonly codigo: string | null,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "RecusaDoMotor";
  }

  get semPermissao(): boolean {
    return this.codigo === "42501";
  }
}

export async function consultarMotor(
  db: Pick<SupabaseClient, "rpc">,
  pedido: PedidoAoMotor,
): Promise<RespostaDoMotor> {
  const { data, error } = await db.rpc("fn_mia_relatorio", {
    p_org: pedido.organizationId,
    p_fonte: pedido.fonte,
    p_medidas: [...pedido.medidas],
    p_dim1: pedido.dim1 ?? null,
    p_dim2: pedido.dim2 ?? null,
    p_filtros: pedido.filtros ?? {},
    p_periodo: pedido.periodo,
    p_de: pedido.de ?? null,
    p_ate: pedido.ate ?? null,
    p_valores: pedido.valores ?? true,
    p_comparar: pedido.comparar ?? false,
    p_agora: pedido.agora ?? null,
  });
  if (error) {
    throw new RecusaDoMotor((error as { code?: string }).code ?? null, error.message);
  }
  if (!data || typeof data !== "object") {
    throw new RecusaDoMotor(null, "o motor não devolveu resposta");
  }
  return data as RespostaDoMotor;
}

/** O grupo de uma chave, ou `undefined`. */
export function grupo(resposta: Pick<RespostaDoMotor, "grupos">, chave: string): GrupoDoMotor | undefined {
  return resposta.grupos.find((g) => g.chave === chave);
}

/** O número de uma medida num grupo (ou no total), com zero no lugar do ausente para contagens. */
export function numero(
  alvo: ValoresDoGrupo | undefined,
  medida: Medida,
): number | null {
  if (!alvo) return null;
  const v = alvo.valores[medida];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
