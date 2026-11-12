/**
 * FORK MIA (.108) · A configuração da trava de robô, por empresa (migration 9153).
 *
 * Sem tela de propósito: quem ajusta é a Time, pelo MCP de plataforma
 * (`plataforma_configurar_trava_de_robo`). Empresa sem linha usa o padrão, e o
 * padrão é LIGADA: o laço com outro robô gasta IA de qualquer cliente, e a
 * proteção não pode depender de alguém lembrar de ligar.
 *
 * Os limites moram em três lugares que conferem um ao outro: aqui (o padrão e a
 * faixa), nas CHECKs da 9153 e no teste `tests/unit/trava-de-robo.test.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export interface ConfigDaTrava {
  /** Liga as duas proteções: o laço com robô e o teto de respostas. */
  ligada: boolean;
  /** A janela em que os giros do laço são contados. */
  janela_minutos: number;
  /** Quantos giros (mensagem de robô depois de uma resposta da IA) disparam a trava. */
  mensagens_para_disparar: number;
  /** O sinal B olha para trás até aqui. */
  repeticao_janela_minutos: number;
  /** O sinal B: quantas vezes o mesmo texto já tinha chegado (a próxima conta). */
  repeticoes_anteriores: number;
  /** O sinal C só vale para texto deste tamanho para cima. */
  velocidade_minimo_de_caracteres: number;
  /** O sinal C: acima disto, ninguém digita. */
  velocidade_caracteres_por_segundo: number;
  /** O teto: respostas (turnos) da IA na mesma conversa... */
  teto_respostas: number;
  /** ...nesta janela. */
  teto_janela_minutos: number;
}

export const CONFIG_PADRAO_DA_TRAVA: Readonly<ConfigDaTrava> = Object.freeze({
  ligada: true,
  janela_minutos: 15,
  mensagens_para_disparar: 3,
  repeticao_janela_minutos: 120,
  repeticoes_anteriores: 2,
  velocidade_minimo_de_caracteres: 80,
  velocidade_caracteres_por_segundo: 15,
  teto_respostas: 30,
  teto_janela_minutos: 60,
});

/** A faixa de cada limite: a mesma das CHECKs da 9153. */
export const FAIXAS_DA_TRAVA = {
  janela_minutos: [1, 240],
  mensagens_para_disparar: [2, 20],
  repeticao_janela_minutos: [10, 1440],
  repeticoes_anteriores: [1, 10],
  velocidade_minimo_de_caracteres: [20, 2000],
  velocidade_caracteres_por_segundo: [3, 200],
  teto_respostas: [5, 500],
  teto_janela_minutos: [5, 1440],
} as const satisfies Record<Exclude<keyof ConfigDaTrava, "ligada">, readonly [number, number]>;

export type LimiteDaTrava = keyof typeof FAIXAS_DA_TRAVA;

export const LIMITES_DA_TRAVA = Object.keys(FAIXAS_DA_TRAVA) as LimiteDaTrava[];

function inteiro(chave: LimiteDaTrava) {
  const [min, max] = FAIXAS_DA_TRAVA[chave];
  return z.number().int().min(min).max(max);
}

/** O pedido de ajuste: só o que vier muda. */
export const pedidoDeConfigDaTravaSchema = z
  .object({
    ligada: z.boolean().optional(),
    janela_minutos: inteiro("janela_minutos").optional(),
    mensagens_para_disparar: inteiro("mensagens_para_disparar").optional(),
    repeticao_janela_minutos: inteiro("repeticao_janela_minutos").optional(),
    repeticoes_anteriores: inteiro("repeticoes_anteriores").optional(),
    velocidade_minimo_de_caracteres: inteiro("velocidade_minimo_de_caracteres").optional(),
    velocidade_caracteres_por_segundo: inteiro("velocidade_caracteres_por_segundo").optional(),
    teto_respostas: inteiro("teto_respostas").optional(),
    teto_janela_minutos: inteiro("teto_janela_minutos").optional(),
  })
  .strict();

export type PedidoDeConfigDaTrava = z.infer<typeof pedidoDeConfigDaTravaSchema>;

/**
 * A linha gravada, ou o padrão. Valor fora da faixa (linha escrita à mão, banco
 * antigo) cai no padrão daquele campo: a trava nunca fica com um limite que a
 * desliga sem ninguém ter pedido.
 */
export function configDaLinha(linha: Record<string, unknown> | null | undefined): ConfigDaTrava {
  const c: ConfigDaTrava = { ...CONFIG_PADRAO_DA_TRAVA };
  if (!linha) return c;
  if (typeof linha.ligada === "boolean") c.ligada = linha.ligada;
  for (const chave of LIMITES_DA_TRAVA) {
    const valor = Number(linha[chave]);
    const [min, max] = FAIXAS_DA_TRAVA[chave];
    if (Number.isInteger(valor) && valor >= min && valor <= max) c[chave] = valor;
  }
  return c;
}

export const TABELA_DA_CONFIG = "mia_trava_de_robo_config";

/**
 * Lê a configuração da empresa. Erro de leitura devolve o PADRÃO (ligada), com
 * `lida: false`: a proteção é o comportamento de fábrica, e uma tabela que ainda
 * não chegou ao banco não pode desligá-la.
 */
export async function lerConfigDaTrava(
  db: Pick<SupabaseClient, "from">,
  organizationId: string,
): Promise<{ config: ConfigDaTrava; gravada: boolean; lida: boolean; erro?: string }> {
  const { data, error } = await db
    .from("mia_trava_de_robo_config")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) return { config: { ...CONFIG_PADRAO_DA_TRAVA }, gravada: false, lida: false, erro: error.message };
  return { config: configDaLinha(data as Record<string, unknown> | null), gravada: data !== null, lida: true };
}
