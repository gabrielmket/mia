/**
 * FORK MIA (.88) — A CONFIGURAÇÃO DO ASSISTENTE NUMA EMPRESA, e o limite do dia.
 *
 * Mora em `mia_assistente_config` (9050), uma linha por empresa. Sem linha vale
 * o padrão do protótipo: ligado, todos os papéis, 50 perguntas por pessoa por
 * dia, resumo da manhã desligado.
 *
 * ── Por que o limite existe ─────────────────────────────────────────────────
 *
 * A IA do assistente é da PLATAFORMA (regra "Custo" do protótipo): o gasto entra
 * no consumo de IA da empresa, e quem paga a conta do provedor é a Time. Pela
 * sessão-cookie não há teto nativo (os tetos do MCP valem para token), e sem
 * limite o assistente vira cheque em branco. O limite é POR PESSOA, contado no
 * banco (as perguntas de hoje, no fuso da empresa), e ajustável por empresa pelo
 * MCP de plataforma.
 *
 * Quem lê aqui recebe o cliente que tiver: a rota passa o da SESSÃO (a
 * configuração é legível por quem é da empresa), o cron e o MCP passam o de
 * serviço. Módulo sem `server-only`: só importa TIPO do supabase-js.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { instanteDe, partesNoFuso } from "@/lib/agenda/fuso";
import { fusoUtilizavel } from "@/lib/tempo/fusos";

import { PAPEIS_DO_ASSISTENTE, type PapelDoAssistente } from "./tipos";

export const LIMITE_PADRAO_POR_DIA = 50;
export const LIMITE_MAXIMO_POR_DIA = 1000;

export interface ConfigDoAssistente {
  ligado: boolean;
  papeis: PapelDoAssistente[];
  perguntasPorPessoaPorDia: number;
  resumoDaManhaPadrao: boolean;
  /** `false` = ninguém gravou ainda; vale o padrão. */
  gravada: boolean;
}

export const CONFIG_PADRAO: ConfigDoAssistente = {
  ligado: true,
  papeis: [...PAPEIS_DO_ASSISTENTE],
  perguntasPorPessoaPorDia: LIMITE_PADRAO_POR_DIA,
  resumoDaManhaPadrao: false,
  gravada: false,
};

function ehPapel(valor: unknown): valor is PapelDoAssistente {
  return typeof valor === "string" && (PAPEIS_DO_ASSISTENTE as readonly string[]).includes(valor);
}

/** A linha do banco na forma do código; linha ausente é o padrão. */
export function configDaLinha(linha: Record<string, unknown> | null | undefined): ConfigDoAssistente {
  if (!linha) return { ...CONFIG_PADRAO, papeis: [...CONFIG_PADRAO.papeis] };
  const papeis = Array.isArray(linha.papeis) ? linha.papeis.filter(ehPapel) : [...PAPEIS_DO_ASSISTENTE];
  const limite = Number(linha.perguntas_por_pessoa_por_dia);
  return {
    ligado: linha.ligado !== false,
    papeis,
    perguntasPorPessoaPorDia:
      Number.isInteger(limite) && limite >= 1 && limite <= LIMITE_MAXIMO_POR_DIA ? limite : LIMITE_PADRAO_POR_DIA,
    resumoDaManhaPadrao: linha.resumo_da_manha_padrao === true,
    gravada: true,
  };
}

/**
 * A configuração da empresa. Falha de leitura NÃO desliga nada nem libera nada
 * além do padrão: devolve o padrão, que já tem o limite de 50.
 */
export async function lerConfigDoAssistente(
  db: Pick<SupabaseClient, "from">,
  organizationId: string,
): Promise<ConfigDoAssistente> {
  const { data, error } = await db
    .from("mia_assistente_config")
    .select("ligado, papeis, perguntas_por_pessoa_por_dia, resumo_da_manha_padrao")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) return { ...CONFIG_PADRAO, papeis: [...CONFIG_PADRAO.papeis] };
  return configDaLinha(data as Record<string, unknown> | null);
}

/** O assistente atende este papel nesta empresa? */
export function papelUsaOAssistente(config: ConfigDoAssistente, papel: string | null | undefined): boolean {
  return config.ligado && ehPapel(papel) && config.papeis.includes(papel);
}

/** O começo e o fim do dia de `agora`, no fuso da empresa. */
export function janelaDoDia(agora: Date, fuso: string | null | undefined): { inicio: Date; fim: Date; dia: string } {
  const tz = fusoUtilizavel(fuso);
  const p = partesNoFuso(agora, tz);
  const inicio = instanteDe({ ano: p.ano, mes: p.mes, dia: p.dia }, tz);
  const amanha = new Date(Date.UTC(p.ano, p.mes - 1, p.dia + 1));
  const fim = instanteDe(
    { ano: amanha.getUTCFullYear(), mes: amanha.getUTCMonth() + 1, dia: amanha.getUTCDate() },
    tz,
  );
  const dois = (n: number) => String(n).padStart(2, "0");
  return { inicio, fim, dia: `${p.ano}-${dois(p.mes)}-${dois(p.dia)}` };
}

export interface UsoDoDia {
  feitas: number;
  limite: number;
  restantes: number;
}

/**
 * Quantas perguntas a pessoa já fez hoje. Conta no BANCO, pela sessão dela: a
 * contagem sobrevive a várias réplicas do contêiner e à ausência de Redis, e a
 * pessoa não apaga as próprias perguntas (a sessão não tem `delete` no
 * histórico, 9050). Falha de leitura conta como limite atingido: sem saber,
 * a resposta não é "pode gastar".
 */
export async function usoDoDia(
  db: Pick<SupabaseClient, "from">,
  entrada: { organizationId: string; userId: string; fuso: string | null | undefined; agora: Date; limite: number },
): Promise<UsoDoDia> {
  const { inicio } = janelaDoDia(entrada.agora, entrada.fuso);
  const { count, error } = await db
    .from("mia_assistente_mensagens")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", entrada.organizationId)
    .eq("user_id", entrada.userId)
    .eq("tipo", "pergunta")
    .gte("created_at", inicio.toISOString());
  const feitas = error ? entrada.limite : (count ?? 0);
  return { feitas, limite: entrada.limite, restantes: Math.max(0, entrada.limite - feitas) };
}
