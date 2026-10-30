/**
 * FORK MIA (.98) · O REPASSE DO MÊS (decisões 2 e 3; docs/fork/cupons-e-parceiros.md, seção 6).
 *
 * O calendário, com os dias configuráveis em Admin › Cobrança:
 *   - dia 1: o sistema FECHA o mês anterior (as comissões ainda sem repasse, de
 *     cada parceiro, viram um repasse) e manda o extrato por e-mail;
 *   - até o dia 5: o parceiro manda a nota (CNPJ) ou o recibo (CPF), e a Time o
 *     ANEXA ao repasse; sem o anexo, o repasse fica "aguardando nota" e não dá
 *     para marcar como pago (o banco recusa, CHECK da 9132);
 *   - até o dia 10: a Time faz o Pix por fora e marca como pago (a data e quem).
 *
 * Saldo negativo (só estornos no mês) não vira repasse: as linhas ficam abertas
 * e descontam no mês seguinte. O sistema nunca manda dinheiro (decisão 3).
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { hojeEmSaoPaulo } from "@/lib/cupons/regras";

import { competenciaDe, mesAnterior, type ConfiguracaoDaComissao } from "./regras";

export interface LancamentoDoRepasse {
  id: string;
  organization_id: string | null;
  empresa: string;
  tipo: "mensalidade" | "setup" | "estorno";
  pago_em: string;
  competencia: string;
  valor_pago_cents: number;
  aliquota_pct: number;
  imposto_cents: number;
  taxa_cents: number;
  liquido_cents: number;
  comissao_pct: number;
  comissao_cents: number;
}

export interface Repasse {
  id: string;
  parceiro_id: string;
  competencia: string;
  total_cents: number;
  fechado_em: string;
  extrato_enviado_em: string | null;
  extrato_erro: string | null;
  anexo_nome: string | null;
  anexo_em: string | null;
  anexo_removido_em: string | null;
  tem_anexo: boolean;
  pago_em: string | null;
  pago_por: string | null;
}

export type SituacaoDoRepasse = "aguardando_nota" | "pronto_para_pagar" | "pago";

export function situacaoDoRepasse(r: Pick<Repasse, "anexo_em" | "pago_em">): SituacaoDoRepasse {
  if (r.pago_em) return "pago";
  return r.anexo_em ? "pronto_para_pagar" : "aguardando_nota";
}

const COLUNAS_DO_REPASSE =
  "id, parceiro_id, competencia, total_cents, fechado_em, extrato_enviado_em, extrato_erro, anexo_path, anexo_nome, anexo_em, anexo_removido_em, pago_em, pago_por";

export function paraRepasse(l: Record<string, unknown>): Repasse {
  return {
    id: String(l.id),
    parceiro_id: String(l.parceiro_id),
    competencia: String(l.competencia),
    total_cents: Number(l.total_cents),
    fechado_em: String(l.fechado_em ?? ""),
    extrato_enviado_em: (l.extrato_enviado_em as string | null) ?? null,
    extrato_erro: (l.extrato_erro as string | null) ?? null,
    anexo_nome: (l.anexo_nome as string | null) ?? null,
    anexo_em: (l.anexo_em as string | null) ?? null,
    anexo_removido_em: (l.anexo_removido_em as string | null) ?? null,
    tem_anexo: typeof l.anexo_path === "string" && l.anexo_path !== "",
    pago_em: (l.pago_em as string | null) ?? null,
    pago_por: (l.pago_por as string | null) ?? null,
  };
}

/** O mês que o dia de fechamento fecha: o anterior ao de hoje, se o dia já chegou. Puro. */
export function competenciaParaFechar(agora: Date, config: Pick<ConfiguracaoDaComissao, "dia_fechamento">): string | null {
  const hoje = hojeEmSaoPaulo(agora);
  const dia = Number(hoje.slice(8, 10));
  if (dia < config.dia_fechamento) return null;
  return mesAnterior(competenciaDe(hoje));
}

/** As datas do calendário do mês seguinte ao da competência (o extrato as cita). Puro. */
export function prazosDoRepasse(competencia: string, config: Pick<ConfiguracaoDaComissao, "dia_nota" | "dia_pagamento">) {
  const [a, m] = competencia.split("-").map(Number) as [number, number];
  const seguinte = new Date(Date.UTC(a, m, 1));
  const ano = seguinte.getUTCFullYear();
  const mes = String(seguinte.getUTCMonth() + 1).padStart(2, "0");
  const dia = (d: number) => `${ano}-${mes}-${String(d).padStart(2, "0")}`;
  return { nota_ate: dia(config.dia_nota), pix_ate: dia(config.dia_pagamento) };
}

/**
 * Fecha a competência (AAAA-MM-01) de cada parceiro com comissões abertas até
 * ela. Idempotente: o repasse é único por parceiro e mês, e as comissões ganham
 * o `repasse_id` só se ainda estão abertas. Devolve os repasses criados.
 */
export async function fecharMes(admin: SupabaseClient, competencia: string): Promise<Repasse[]> {
  const { data, error } = await admin
    .from("mia_comissoes")
    .select("id, parceiro_id, comissao_cents")
    .is("repasse_id", null)
    .lte("competencia", competencia)
    .limit(20_000);
  if (error) throw new Error(`repasses: comissões abertas ilegíveis (${error.code ?? "sem_codigo"})`);
  const porParceiro = new Map<string, Array<{ id: string; comissao_cents: number }>>();
  for (const l of (data ?? []) as Array<{ id: string; parceiro_id: string; comissao_cents: number }>) {
    porParceiro.set(l.parceiro_id, [...(porParceiro.get(l.parceiro_id) ?? []), { id: l.id, comissao_cents: Number(l.comissao_cents) }]);
  }
  const criados: Repasse[] = [];
  for (const [parceiroId, linhas] of porParceiro) {
    const total = linhas.reduce((s, l) => s + l.comissao_cents, 0);
    // Saldo zero ou negativo: fica para o mês seguinte, com os estornos descontando.
    if (total <= 0) continue;
    const { data: criado, error: erroDoRepasse } = await admin
      .from("mia_repasses")
      .upsert({ parceiro_id: parceiroId, competencia, total_cents: total }, { onConflict: "parceiro_id,competencia", ignoreDuplicates: true })
      .select(COLUNAS_DO_REPASSE);
    if (erroDoRepasse) throw new Error(`repasses: o repasse não foi gravado (${erroDoRepasse.code ?? "sem_codigo"})`);
    const repasse = ((criado ?? []) as Array<Record<string, unknown>>)[0];
    if (!repasse) continue;
    const ids = linhas.map((l) => l.id);
    const { error: erroDasLinhas } = await admin.from("mia_comissoes").update({ repasse_id: repasse.id }).in("id", ids).is("repasse_id", null);
    if (erroDasLinhas) throw new Error(`repasses: as comissões não foram ligadas (${erroDasLinhas.code ?? "sem_codigo"})`);
    criados.push(paraRepasse(repasse));
  }
  return criados;
}

/** Os repasses de uma competência, com os lançamentos de cada um. LANÇA na falha. */
export async function lerRepassesDoMes(
  admin: SupabaseClient,
  competencia: string,
): Promise<Array<Repasse & { lancamentos: LancamentoDoRepasse[] }>> {
  const { data, error } = await admin.from("mia_repasses").select(COLUNAS_DO_REPASSE).eq("competencia", competencia).limit(1000);
  if (error) throw new Error(`repasses: leitura falhou (${error.code ?? "sem_codigo"})`);
  const repasses = ((data ?? []) as Array<Record<string, unknown>>).map(paraRepasse);
  if (repasses.length === 0) return [];
  const lancamentos = await lancamentosDos(admin, { repasseIds: repasses.map((r) => r.id) });
  return repasses.map((r) => ({ ...r, lancamentos: lancamentos.filter((l) => (l as LancamentoDoRepasse & { repasse_id: string }).repasse_id === r.id) }));
}

/** As comissões ainda abertas (o mês em curso e o saldo que ficou), por parceiro. */
export async function lancamentosAbertos(admin: SupabaseClient, parceiroId?: string): Promise<LancamentoDoRepasse[]> {
  return lancamentosDos(admin, { abertas: true, parceiroId });
}

async function lancamentosDos(
  admin: SupabaseClient,
  f: { repasseIds?: string[]; abertas?: boolean; parceiroId?: string },
): Promise<Array<LancamentoDoRepasse & { repasse_id: string | null; parceiro_id: string }>> {
  let q = admin
    .from("mia_comissoes")
    .select("id, parceiro_id, repasse_id, organization_id, tipo, pago_em, competencia, valor_pago_cents, aliquota_pct, imposto_cents, taxa_cents, liquido_cents, comissao_pct, comissao_cents")
    .order("pago_em")
    .limit(20_000);
  if (f.repasseIds) q = q.in("repasse_id", f.repasseIds);
  if (f.abertas) q = q.is("repasse_id", null);
  if (f.parceiroId) q = q.eq("parceiro_id", f.parceiroId);
  const { data, error } = await q;
  if (error) throw new Error(`repasses: lançamentos ilegíveis (${error.code ?? "sem_codigo"})`);
  const linhas = (data ?? []) as Array<Record<string, unknown>>;
  const orgIds = [...new Set(linhas.map((l) => l.organization_id).filter((x): x is string => typeof x === "string"))];
  const orgs = orgIds.length ? await admin.from("organizations").select("id, display_name").in("id", orgIds) : { data: [] };
  const nome = new Map(((orgs.data ?? []) as Array<{ id: string; display_name: string }>).map((o) => [o.id, o.display_name]));
  return linhas.map((l) => ({
    id: String(l.id),
    parceiro_id: String(l.parceiro_id),
    repasse_id: (l.repasse_id as string | null) ?? null,
    organization_id: (l.organization_id as string | null) ?? null,
    empresa: typeof l.organization_id === "string" ? (nome.get(l.organization_id) ?? "Empresa apagada") : "Empresa apagada",
    tipo: l.tipo as LancamentoDoRepasse["tipo"],
    pago_em: String(l.pago_em),
    competencia: String(l.competencia),
    valor_pago_cents: Number(l.valor_pago_cents),
    aliquota_pct: Number(l.aliquota_pct),
    imposto_cents: Number(l.imposto_cents),
    taxa_cents: Number(l.taxa_cents),
    liquido_cents: Number(l.liquido_cents),
    comissao_pct: Number(l.comissao_pct),
    comissao_cents: Number(l.comissao_cents),
  }));
}

/** Os totais de um conjunto de lançamentos, separados como a tela e o extrato mostram. Puro. */
export function totaisDosLancamentos(ls: readonly LancamentoDoRepasse[]) {
  const soma = (t: LancamentoDoRepasse["tipo"], campo: keyof LancamentoDoRepasse) =>
    ls.filter((l) => l.tipo === t).reduce((s, l) => s + Number(l[campo]), 0);
  return {
    mensalidades: ls.filter((l) => l.tipo === "mensalidade").length,
    mensalidades_pago_cents: soma("mensalidade", "valor_pago_cents"),
    mensalidades_imposto_cents: soma("mensalidade", "imposto_cents"),
    mensalidades_taxa_cents: soma("mensalidade", "taxa_cents"),
    mensalidades_liquido_cents: soma("mensalidade", "liquido_cents"),
    mensalidades_comissao_cents: soma("mensalidade", "comissao_cents"),
    setups: ls.filter((l) => l.tipo === "setup").length,
    setups_pago_cents: soma("setup", "valor_pago_cents"),
    setups_imposto_cents: soma("setup", "imposto_cents"),
    setups_taxa_cents: soma("setup", "taxa_cents"),
    setups_liquido_cents: soma("setup", "liquido_cents"),
    setups_comissao_cents: soma("setup", "comissao_cents"),
    estornos_cents: soma("estorno", "comissao_cents"),
    total_cents: ls.reduce((s, l) => s + l.comissao_cents, 0),
  };
}

const TIPOS_DO_ANEXO = new Set(["application/pdf", "image/png", "image/jpeg", "application/xml", "text/xml"]);
const EXTENSAO: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/xml": "xml",
  "text/xml": "xml",
};
export const TETO_DO_ANEXO = 10 * 1024 * 1024;

/**
 * Anexa a nota ou o recibo ao repasse (bucket privado `mia-repasses`). Troca o
 * anterior (o arquivo velho sai). Depois de pago, não troca.
 */
export async function anexarAoRepasse(
  admin: SupabaseClient,
  p: { repasseId: string; arquivo: Blob; nome: string; tipo: string; ator: string },
): Promise<{ ok: true; repasse: Repasse } | { ok: false; motivo: "nao_encontrado" | "ja_pago" | "tipo_invalido" | "grande_demais" | "falha_no_armazenamento" | "falha_no_banco" }> {
  if (!TIPOS_DO_ANEXO.has(p.tipo)) return { ok: false, motivo: "tipo_invalido" };
  if (p.arquivo.size <= 0 || p.arquivo.size > TETO_DO_ANEXO) return { ok: false, motivo: "grande_demais" };
  const { data: atual, error } = await admin.from("mia_repasses").select(COLUNAS_DO_REPASSE).eq("id", p.repasseId).maybeSingle();
  if (error) return { ok: false, motivo: "falha_no_banco" };
  if (!atual) return { ok: false, motivo: "nao_encontrado" };
  const repasse = atual as Record<string, unknown>;
  if (repasse.pago_em) return { ok: false, motivo: "ja_pago" };
  const anterior = typeof repasse.anexo_path === "string" && repasse.anexo_path ? repasse.anexo_path : null;
  const caminho = `${String(repasse.parceiro_id)}/${String(repasse.competencia).slice(0, 7)}/${randomUUID()}.${EXTENSAO[p.tipo] ?? "bin"}`;
  const { error: erroDoArquivo } = await admin.storage.from("mia-repasses").upload(caminho, p.arquivo, { contentType: p.tipo, upsert: false });
  if (erroDoArquivo) return { ok: false, motivo: "falha_no_armazenamento" };
  const nome = p.nome.replace(/[\\/\r\n\t]/g, " ").trim().slice(0, 120) || `anexo.${EXTENSAO[p.tipo] ?? "bin"}`;
  const { data: gravado, error: erroDaLinha } = await admin
    .from("mia_repasses")
    .update({ anexo_path: caminho, anexo_nome: nome, anexo_tipo: p.tipo, anexo_em: new Date().toISOString(), anexo_por: p.ator, anexo_removido_em: null })
    .eq("id", p.repasseId)
    .is("pago_em", null)
    .select(COLUNAS_DO_REPASSE)
    .maybeSingle();
  if (erroDaLinha || !gravado) {
    await admin.storage.from("mia-repasses").remove([caminho]);
    return { ok: false, motivo: erroDaLinha ? "falha_no_banco" : "ja_pago" };
  }
  if (anterior) await admin.storage.from("mia-repasses").remove([anterior]);
  return { ok: true, repasse: paraRepasse(gravado as Record<string, unknown>) };
}

/** O link assinado (5 minutos) do anexo. `null` = sem anexo. */
export async function linkDoAnexo(admin: SupabaseClient, repasseId: string): Promise<string | null> {
  const { data } = await admin.from("mia_repasses").select("anexo_path").eq("id", repasseId).maybeSingle();
  const caminho = (data as { anexo_path: string | null } | null)?.anexo_path;
  if (!caminho) return null;
  const { data: assinado } = await admin.storage.from("mia-repasses").createSignedUrl(caminho, 300);
  return assinado?.signedUrl ?? null;
}

/**
 * Marca como pago (o Pix feito por fora), com a data e quem. Sem o anexo,
 * recusa (o banco também recusa). Já pago: devolve como está (idempotente).
 */
export async function marcarRepassePago(
  admin: SupabaseClient,
  p: { repasseId: string; ator: string; pagoEm?: Date },
): Promise<{ ok: true; repasse: Repasse; jaEstava: boolean } | { ok: false; motivo: "nao_encontrado" | "sem_anexo" | "falha_no_banco" }> {
  const { data: atual, error } = await admin.from("mia_repasses").select(COLUNAS_DO_REPASSE).eq("id", p.repasseId).maybeSingle();
  if (error) return { ok: false, motivo: "falha_no_banco" };
  if (!atual) return { ok: false, motivo: "nao_encontrado" };
  const r = paraRepasse(atual as Record<string, unknown>);
  if (r.pago_em) return { ok: true, repasse: r, jaEstava: true };
  if (!r.anexo_em) return { ok: false, motivo: "sem_anexo" };
  const { data, error: erroDaGravacao } = await admin
    .from("mia_repasses")
    .update({ pago_em: (p.pagoEm ?? new Date()).toISOString(), pago_por: p.ator })
    .eq("id", p.repasseId)
    .is("pago_em", null)
    .select(COLUNAS_DO_REPASSE)
    .maybeSingle();
  if (erroDaGravacao) return { ok: false, motivo: erroDaGravacao.code === "23514" ? "sem_anexo" : "falha_no_banco" };
  if (!data) return { ok: true, repasse: r, jaEstava: true };
  return { ok: true, repasse: paraRepasse(data as Record<string, unknown>), jaEstava: false };
}

const celula = (v: string | number) => {
  const s = String(v);
  return /[;"\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
};
const decimal = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/**
 * A planilha do mês (CSV com ponto e vírgula, que o Excel abre em pt-BR): uma
 * linha por cobrança, com a conta inteira, e o total por parceiro. Puro.
 */
export function planilhaDoMes(
  repasses: ReadonlyArray<Repasse & { lancamentos: LancamentoDoRepasse[]; parceiro: string; chave_pix: string | null }>,
): string {
  const cabecalho = [
    "Parceiro",
    "Chave Pix",
    "Cliente",
    "Tipo",
    "Pago em",
    "Valor pago",
    "Alíquota (%)",
    "Imposto",
    "Taxa do Asaas",
    "Líquido",
    "Comissão (%)",
    "Comissão",
    "Situação do repasse",
  ];
  const linhas = [cabecalho.join(";")];
  for (const r of repasses) {
    const situacao = situacaoDoRepasse(r);
    for (const l of r.lancamentos) {
      linhas.push(
        [
          r.parceiro,
          r.chave_pix ?? "",
          l.empresa,
          l.tipo,
          l.pago_em,
          decimal(l.valor_pago_cents),
          String(l.aliquota_pct).replace(".", ","),
          decimal(l.imposto_cents),
          decimal(l.taxa_cents),
          decimal(l.liquido_cents),
          String(l.comissao_pct).replace(".", ","),
          decimal(l.comissao_cents),
          situacao,
        ]
          .map(celula)
          .join(";"),
      );
    }
    linhas.push([r.parceiro, r.chave_pix ?? "", "TOTAL", "", "", "", "", "", "", "", "", decimal(r.total_cents), situacao].map(celula).join(";"));
  }
  return `﻿${linhas.join("\r\n")}\r\n`;
}

