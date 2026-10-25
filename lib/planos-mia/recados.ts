/**
 * FORK MIA (.90) — OS RECADOS DA JORNADA NO ZAP DA TIME.
 *
 * O mesmo canal dos chamados do assistente (.88): o grupo interno da Time,
 * pelo número de avisos da plataforma (`reportar`, lib/avisos/report-da-plataforma.ts).
 * Quatro momentos em que uma pessoa da Time precisa agir:
 *   1. pedido novo de cadastro, com o plano escolhido (aprovar);
 *   2. número oficial esperando ligação (amarrar à empresa certa);
 *   3. o teste acaba amanhã sem assinatura (falar com quem administra);
 *   4. um dia antes de suspender quem entrou sozinho (ligar para salvar a conta).
 *
 * Cada recado tem CHAVE própria em `platform_avisos_enviados` (prefixo
 * `jornada:zap:`), com janela de um ano: o mesmo recado não sai duas vezes.
 * Só o nome da empresa e o que fazer — nunca dado do cliente final, nem nome ou
 * e-mail de quem administra. Sem grupo escolhido, cala (a regra do `reportar`).
 * Nunca lança: o vigia que derruba a rodada leva junto os outros avisos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { reportar } from "@/lib/avisos/report-da-plataforma";
import { logger } from "@/lib/logger";

import { lerEmpresasDoCadastro, lerNumerosEsperando, lerPedidosDeCadastro } from "./empresas-do-cadastro";

const UM_ANO_EM_HORAS = 24 * 365;
const DIA_MS = 86_400_000;
export const PREFIXO_DOS_RECADOS = "jornada:zap:";

export interface Recado {
  chave: string;
  texto: string;
}

const dia = (iso: string) => iso.slice(0, 10);

/** Os recados que valem AGORA (puro sobre o que foi lido; exportado para os testes). */
export function recadosPendentes(entrada: {
  pedidos: Array<{ id: string; empresa: string; plano: string | null }>;
  numeros: Array<{ id: string; conta: string | null }>;
  empresas: Array<{
    id: string;
    nome: string;
    origem: "cadastro" | "implantacao" | null;
    situacao: string;
    teste_ate: string | null;
    proximo: { tipo: string; suspensao_em: string | null };
  }>;
  agora: Date;
}): Recado[] {
  const t = entrada.agora.getTime();
  const recados: Recado[] = [];
  for (const p of entrada.pedidos) {
    recados.push({
      chave: `${PREFIXO_DOS_RECADOS}pedido:${p.id}`,
      texto:
        `*Pedido novo de cadastro*\n${p.empresa}${p.plano ? ` (${p.plano})` : ""}.\n` +
        "Aprovar em Admin › Empresas do cadastro ou pelo MCP.",
    });
  }
  for (const n of entrada.numeros) {
    recados.push({
      chave: `${PREFIXO_DOS_RECADOS}numero:${n.id}`,
      texto:
        `*Número oficial esperando ligação*\n${n.conta ?? "Conta da Meta sem nome"}.\n` +
        "Confira a conta e ligue à empresa certa em Admin › Cadastro incorporado.",
    });
  }
  for (const e of entrada.empresas) {
    if (e.situacao === "teste" && e.proximo.tipo === "fim_do_teste" && e.teste_ate) {
      const falta = Date.parse(e.teste_ate) - t;
      if (falta > 0 && falta <= DIA_MS) {
        recados.push({
          chave: `${PREFIXO_DOS_RECADOS}teste_acaba:${e.id}:${dia(e.teste_ate)}`,
          texto: `*O teste acaba amanhã sem assinatura*\n${e.nome}.\nVale falar com quem administra a empresa.`,
        });
      }
    }
    if (e.origem === "cadastro" && (e.situacao === "atraso" || e.situacao === "prazo") && e.proximo.suspensao_em) {
      const falta = Date.parse(e.proximo.suspensao_em) - t;
      if (falta > 0 && falta <= DIA_MS) {
        recados.push({
          chave: `${PREFIXO_DOS_RECADOS}suspende:${e.id}:${dia(e.proximo.suspensao_em)}`,
          texto: `*Amanhã a empresa pode ser suspensa*\n${e.nome}, por falta de pagamento.\nVale ligar para quem administra antes.`,
        });
      }
    }
  }
  return recados;
}

/**
 * Lê e manda o que vale. `completo: false` faz só os baratos (pedido e número),
 * que a rodada de minuto em minuto pode pagar; os da régua (teste e suspensão)
 * leem todas as empresas e rodam com `completo: true`, a cada 15 minutos.
 */
export async function mandarRecadosDaJornada(
  admin: SupabaseClient,
  opcoes: { agora?: Date; completo?: boolean } = {},
): Promise<string[]> {
  const agora = opcoes.agora ?? new Date();
  try {
    const [pedidos, numeros, empresas] = await Promise.all([
      lerPedidosDeCadastro(admin).catch(() => []),
      lerNumerosEsperando(admin).catch(() => []),
      opcoes.completo ? lerEmpresasDoCadastro(admin, agora).catch(() => []) : Promise.resolve([]),
    ]);
    const enviados: string[] = [];
    for (const r of recadosPendentes({ pedidos, numeros, empresas, agora })) {
      const saiu = await reportar(admin, { chave: r.chave, horas: UM_ANO_EM_HORAS, texto: r.texto, detalhe: { texto: r.texto } });
      if (saiu) enviados.push(r.chave);
    }
    return enviados;
  } catch (erro) {
    logger.warn("planos-mia: recados da jornada falharam", { detalhe: erro instanceof Error ? erro.message : String(erro) });
    return [];
  }
}

/** Os últimos recados que saíram (para a tela da Time). Nunca lança. */
export async function ultimosRecados(admin: SupabaseClient, limite = 8): Promise<Array<{ texto: string; enviado_em: string }>> {
  try {
    const { data, error } = await admin
      .from("platform_avisos_enviados")
      .select("chave, enviado_em, detalhe")
      .like("chave", `${PREFIXO_DOS_RECADOS}%`)
      .order("enviado_em", { ascending: false })
      .limit(limite);
    if (error) return [];
    return ((data ?? []) as Array<{ enviado_em: string; detalhe: { texto?: unknown } | null }>).map((l) => ({
      texto: typeof l.detalhe?.texto === "string" ? l.detalhe.texto : "",
      enviado_em: l.enviado_em,
    }));
  } catch {
    return [];
  }
}
