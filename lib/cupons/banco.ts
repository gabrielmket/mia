/**
 * FORK MIA (.97) · OS CUPONS NO BANCO (migration 9130; docs/fork/cupons-e-parceiros.md).
 *
 * Quem escreve é o servidor, com o cliente de serviço: a tela da Time (Admin ›
 * Cupons, com a verificação em duas etapas), o MCP de plataforma e o passo do
 * pagamento. Aplicar e tirar o cupom de uma empresa é SEMPRE pela função do
 * banco (`fn_mia_aplicar_cupom`, `fn_mia_tirar_cupom`): a régua do limite de
 * usos, do plano e do "um por cliente" mora num lugar só.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { codigoValido, normalizarCodigo, type Beneficio, type CupomParaRegra, type MotivoDoCupom, type TipoDoDescontoNoSetup } from "./regras";

export interface CupomGravado extends CupomParaRegra {
  id: string;
  parceiro_id: string | null;
  comissao_pct: number | null;
  created_at: string;
  updated_at: string;
}

export interface CupomComUsos extends CupomGravado {
  usos: number;
}

const COLUNAS =
  "id, codigo, beneficio, valor, meses, setup_tipo, setup_valor, planos, vale_ate, limite_de_usos, parceiro_id, comissao_pct, ativo, created_at, updated_at";

function paraCupom(l: Record<string, unknown>): CupomGravado {
  return {
    id: String(l.id),
    codigo: String(l.codigo),
    beneficio: l.beneficio as Beneficio,
    valor: Number(l.valor),
    meses: l.meses === null || l.meses === undefined ? null : Number(l.meses),
    setup_tipo: (l.setup_tipo as TipoDoDescontoNoSetup) ?? "nenhum",
    setup_valor: Number(l.setup_valor ?? 0),
    planos: ((l.planos as string[] | null) ?? []).map(String),
    vale_ate: (l.vale_ate as string | null) ?? null,
    limite_de_usos: l.limite_de_usos === null || l.limite_de_usos === undefined ? null : Number(l.limite_de_usos),
    parceiro_id: (l.parceiro_id as string | null) ?? null,
    comissao_pct: l.comissao_pct === null || l.comissao_pct === undefined ? null : Number(l.comissao_pct),
    ativo: l.ativo !== false,
    created_at: String(l.created_at ?? ""),
    updated_at: String(l.updated_at ?? ""),
  };
}

/** Quantas empresas usam cada cupom. LANÇA na falha. */
async function usosPorCupom(admin: SupabaseClient, ids?: readonly string[]): Promise<Map<string, number>> {
  let q = admin.from("mia_cupom_da_empresa").select("cupom_id").limit(10_000);
  if (ids) q = q.in("cupom_id", [...ids]);
  const { data, error } = await q;
  if (error) throw new Error(`cupons: usos ilegíveis (${error.code ?? "sem_codigo"})`);
  const conta = new Map<string, number>();
  for (const l of (data ?? []) as Array<{ cupom_id: string }>) conta.set(l.cupom_id, (conta.get(l.cupom_id) ?? 0) + 1);
  return conta;
}

/** Todos os cupons, os mais novos primeiro, com os usos. LANÇA na falha. */
export async function lerCupons(admin: SupabaseClient): Promise<CupomComUsos[]> {
  const { data, error } = await admin.from("mia_cupons").select(COLUNAS).order("created_at", { ascending: false }).limit(1000);
  if (error) throw new Error(`cupons: leitura falhou (${error.code ?? "sem_codigo"})`);
  const cupons = ((data ?? []) as Array<Record<string, unknown>>).map(paraCupom);
  const usos = await usosPorCupom(admin);
  return cupons.map((c) => ({ ...c, usos: usos.get(c.id) ?? 0 }));
}

/** O cupom pelo código (maiúsculas, sem espaço), com os usos. `null` = não existe. LANÇA na falha. */
export async function lerCupomPorCodigo(admin: SupabaseClient, bruto: unknown): Promise<CupomComUsos | null> {
  const codigo = normalizarCodigo(bruto);
  if (!codigoValido(codigo)) return null;
  const { data, error } = await admin.from("mia_cupons").select(COLUNAS).eq("codigo", codigo).maybeSingle();
  if (error) throw new Error(`cupons: leitura falhou (${error.code ?? "sem_codigo"})`);
  if (!data) return null;
  const cupom = paraCupom(data as Record<string, unknown>);
  const usos = await usosPorCupom(admin, [cupom.id]);
  return { ...cupom, usos: usos.get(cupom.id) ?? 0 };
}

const DIA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/** O que a tela e o MCP mandam para criar ou mudar um cupom. */
export const cupomSchema = z
  .object({
    codigo: z.string().transform(normalizarCodigo).refine(codigoValido, "codigo_invalido"),
    beneficio: z.enum(["pct", "reais", "dias"]),
    valor: z.coerce.number().positive(),
    meses: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12), z.null()]).default(null),
    setup_tipo: z.enum(["nenhum", "pct", "reais"]).default("nenhum"),
    setup_valor: z.coerce.number().min(0).default(0),
    planos: z.array(z.string().uuid()).min(1).max(50),
    vale_ate: z.string().regex(DIA_CIVIL).nullable().default(null),
    limite_de_usos: z.coerce.number().int().min(1).nullable().default(null),
    parceiro_id: z.string().uuid().nullable().default(null),
    comissao_pct: z.coerce.number().min(0).max(100).nullable().default(null),
    ativo: z.boolean().optional(),
  })
  .superRefine((c, ctx) => {
    if (c.beneficio === "pct" && !(c.valor > 0 && c.valor < 100)) ctx.addIssue({ code: "custom", path: ["valor"], message: "pct_entre_0_e_100" });
    if (c.beneficio === "dias" && !(Number.isInteger(c.valor) && c.valor >= 1 && c.valor <= 365)) {
      ctx.addIssue({ code: "custom", path: ["valor"], message: "dias_entre_1_e_365" });
    }
    if (c.beneficio === "reais" && c.valor > 100_000) ctx.addIssue({ code: "custom", path: ["valor"], message: "reais_demais" });
    if (c.setup_tipo === "nenhum" && c.setup_valor !== 0) ctx.addIssue({ code: "custom", path: ["setup_valor"], message: "setup_sem_tipo" });
    if (c.setup_tipo === "pct" && !(c.setup_valor > 0 && c.setup_valor <= 100)) ctx.addIssue({ code: "custom", path: ["setup_valor"], message: "setup_pct_entre_0_e_100" });
    if (c.setup_tipo === "reais" && !(c.setup_valor > 0)) ctx.addIssue({ code: "custom", path: ["setup_valor"], message: "setup_reais_positivo" });
    if (c.comissao_pct !== null && c.parceiro_id === null) ctx.addIssue({ code: "custom", path: ["comissao_pct"], message: "comissao_sem_parceiro" });
  });
export type EntradaDoCupom = z.input<typeof cupomSchema>;

export type ResultadoDoCupom =
  | { ok: true; cupom: CupomGravado; criado: boolean; mudou: boolean }
  | { ok: false; motivo: "invalido"; campos: Record<string, string> }
  | { ok: false; motivo: "plano_inexistente" | "parceiro_inexistente" | "falha_no_banco"; detalhe?: string };

const COMPARAVEIS = [
  "beneficio",
  "valor",
  "meses",
  "setup_tipo",
  "setup_valor",
  "vale_ate",
  "limite_de_usos",
  "parceiro_id",
  "comissao_pct",
  "ativo",
] as const;

function iguais(a: CupomGravado, b: Record<string, unknown>): boolean {
  for (const k of COMPARAVEIS) {
    if (!(k in b)) continue;
    const va = a[k as keyof CupomGravado];
    const vb = b[k];
    if (typeof va === "number" || typeof vb === "number") {
      if (Number(va) !== Number(vb) || (va === null) !== (vb === null)) return false;
    } else if ((va ?? null) !== (vb ?? null)) return false;
  }
  const planosNovos = (b.planos as string[] | undefined) ?? a.planos;
  return [...a.planos].sort().join(",") === [...planosNovos].sort().join(",");
}

/**
 * Cria ou muda um cupom pelo CÓDIGO (idempotente: a mesma entrada não regrava).
 * Mudar um cupom já usado vale para quem entrar daqui para a frente: o cliente
 * que já entrou fica com o retrato do dia em que entrou (`mia_cupom_da_empresa`).
 */
export async function garantirCupom(admin: SupabaseClient, entrada: unknown, ator: string | null): Promise<ResultadoDoCupom> {
  const lido = cupomSchema.safeParse(entrada);
  if (!lido.success) {
    const campos: Record<string, string> = {};
    for (const i of lido.error.issues) campos[String(i.path[0] ?? "cupom")] ??= i.message;
    return { ok: false, motivo: "invalido", campos };
  }
  const c = lido.data;
  const linha: Record<string, unknown> = {
    codigo: c.codigo,
    beneficio: c.beneficio,
    valor: c.valor,
    meses: c.beneficio === "dias" ? null : c.meses,
    setup_tipo: c.setup_tipo,
    setup_valor: c.setup_tipo === "nenhum" ? 0 : c.setup_valor,
    planos: [...new Set(c.planos)],
    vale_ate: c.vale_ate,
    limite_de_usos: c.limite_de_usos,
    parceiro_id: c.parceiro_id,
    comissao_pct: c.parceiro_id === null ? null : c.comissao_pct,
    ...(c.ativo === undefined ? {} : { ativo: c.ativo }),
  };
  const planos = await admin.from("cobranca_planos").select("id").in("id", linha.planos as string[]);
  if (planos.error) return { ok: false, motivo: "falha_no_banco", detalhe: planos.error.code ?? undefined };
  if ((planos.data ?? []).length !== (linha.planos as string[]).length) return { ok: false, motivo: "plano_inexistente" };
  if (c.parceiro_id) {
    const p = await admin.from("mia_parceiros").select("id, anonimizado_em").eq("id", c.parceiro_id).maybeSingle();
    if (p.error) return { ok: false, motivo: "falha_no_banco", detalhe: p.error.code ?? undefined };
    if (!p.data || (p.data as { anonimizado_em: string | null }).anonimizado_em) return { ok: false, motivo: "parceiro_inexistente" };
  }
  const { data: atual, error: erroAtual } = await admin.from("mia_cupons").select(COLUNAS).eq("codigo", c.codigo).maybeSingle();
  if (erroAtual) return { ok: false, motivo: "falha_no_banco", detalhe: erroAtual.code ?? undefined };
  if (atual) {
    const gravado = paraCupom(atual as Record<string, unknown>);
    if (iguais(gravado, linha)) return { ok: true, cupom: gravado, criado: false, mudou: false };
    const { data, error } = await admin
      .from("mia_cupons")
      .update({ ...linha, updated_by: ator })
      .eq("id", gravado.id)
      .select(COLUNAS)
      .single();
    if (error || !data) return { ok: false, motivo: "falha_no_banco", detalhe: error?.code ?? undefined };
    return { ok: true, cupom: paraCupom(data as Record<string, unknown>), criado: false, mudou: true };
  }
  const { data, error } = await admin
    .from("mia_cupons")
    .insert({ ...linha, ativo: c.ativo ?? true, created_by: ator, updated_by: ator })
    .select(COLUNAS)
    .single();
  if (error || !data) return { ok: false, motivo: "falha_no_banco", detalhe: error?.code ?? undefined };
  return { ok: true, cupom: paraCupom(data as Record<string, unknown>), criado: true, mudou: true };
}

/** Pausar ou ativar (cupom não se apaga). `null` = não existe. */
export async function mudarSituacaoDoCupom(
  admin: SupabaseClient,
  cupomId: string,
  ativo: boolean,
  ator: string | null,
): Promise<CupomGravado | null> {
  const { data, error } = await admin
    .from("mia_cupons")
    .update({ ativo, updated_by: ator })
    .eq("id", cupomId)
    .select(COLUNAS)
    .maybeSingle();
  if (error) throw new Error(`cupons: gravação falhou (${error.code ?? "sem_codigo"})`);
  return data ? paraCupom(data as Record<string, unknown>) : null;
}

/** O cupom de uma empresa (o retrato do combinado), ou `null`. */
export interface CupomDaEmpresa {
  organization_id: string;
  cupom_id: string;
  parceiro_id: string | null;
  /** Só os pagamentos a partir deste dia geram comissão para o parceiro. */
  parceiro_desde: string;
  codigo: string;
  beneficio: Beneficio;
  valor: number;
  meses: number | null;
  setup_tipo: TipoDoDescontoNoSetup;
  setup_valor: number;
  planos: string[];
  comissao_pct: number | null;
  comissao_meses: number | null;
  comissao_setup_pct: number | null;
  termos_fixados_em: string | null;
  primeira_mensalidade_em: string | null;
  origem: "cadastro" | "pagamento" | "time";
  aplicado_em: string;
  dias_aplicados: number | null;
  desconto_conferido_em: string | null;
  desconto_encerrado_em: string | null;
  comissoes_lidas_em: string | null;
}

export function paraCupomDaEmpresa(l: Record<string, unknown>): CupomDaEmpresa {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    organization_id: String(l.organization_id),
    cupom_id: String(l.cupom_id),
    parceiro_id: (l.parceiro_id as string | null) ?? null,
    parceiro_desde: String(l.parceiro_desde ?? l.aplicado_em ?? ""),
    codigo: String(l.codigo),
    beneficio: l.beneficio as Beneficio,
    valor: Number(l.valor),
    meses: num(l.meses),
    setup_tipo: (l.setup_tipo as TipoDoDescontoNoSetup) ?? "nenhum",
    setup_valor: Number(l.setup_valor ?? 0),
    planos: ((l.planos as string[] | null) ?? []).map(String),
    comissao_pct: num(l.comissao_pct),
    comissao_meses: num(l.comissao_meses),
    comissao_setup_pct: num(l.comissao_setup_pct),
    termos_fixados_em: (l.termos_fixados_em as string | null) ?? null,
    primeira_mensalidade_em: (l.primeira_mensalidade_em as string | null) ?? null,
    origem: (l.origem as CupomDaEmpresa["origem"]) ?? "cadastro",
    aplicado_em: String(l.aplicado_em ?? ""),
    dias_aplicados: num(l.dias_aplicados),
    desconto_conferido_em: (l.desconto_conferido_em as string | null) ?? null,
    desconto_encerrado_em: (l.desconto_encerrado_em as string | null) ?? null,
    comissoes_lidas_em: (l.comissoes_lidas_em as string | null) ?? null,
  };
}

export async function lerCupomDaEmpresa(admin: SupabaseClient, orgId: string): Promise<CupomDaEmpresa | null> {
  const { data, error } = await admin.from("mia_cupom_da_empresa").select("*").eq("organization_id", orgId).maybeSingle();
  if (error) throw new Error(`cupons: o cupom da empresa ficou ilegível (${error.code ?? "sem_codigo"})`);
  return data ? paraCupomDaEmpresa(data as Record<string, unknown>) : null;
}

export type ResultadoDeAplicar =
  | { ok: true; jaEstava: boolean; codigo: string; beneficio: Beneficio; parceiroId: string | null; trocou: boolean; diasAplicados: number | null }
  | { ok: false; motivo: MotivoDoCupom; codigo: string; atual?: string; planos?: string[]; valeAte?: string | null };

/** Aplica pela função do banco (a régua única). LANÇA só na falha do banco. */
export async function aplicarCupomNaEmpresa(
  admin: SupabaseClient,
  p: { orgId: string; codigo: unknown; origem: "cadastro" | "pagamento" | "time"; ator: string | null },
): Promise<ResultadoDeAplicar> {
  const codigo = normalizarCodigo(p.codigo);
  if (codigo === "") return { ok: false, motivo: "vazio", codigo };
  if (!codigoValido(codigo)) return { ok: false, motivo: "inexistente", codigo };
  const { data, error } = await admin.rpc("fn_mia_aplicar_cupom", {
    p_org: p.orgId,
    p_codigo: codigo,
    p_origem: p.origem,
    p_ator: p.ator,
  });
  if (error) throw new Error(`cupons: aplicar falhou (${error.code ?? "sem_codigo"})`);
  const r = (data ?? {}) as Record<string, unknown>;
  if (r.ok === true) {
    return {
      ok: true,
      jaEstava: r.ja_estava === true,
      codigo: String(r.codigo ?? codigo),
      beneficio: r.beneficio as Beneficio,
      parceiroId: (r.parceiro_id as string | null) ?? null,
      trocou: r.trocou === true,
      diasAplicados: r.dias_aplicados === null || r.dias_aplicados === undefined ? null : Number(r.dias_aplicados),
    };
  }
  return {
    ok: false,
    motivo: (r.motivo as MotivoDoCupom) ?? "inexistente",
    codigo: String(r.codigo ?? codigo),
    ...(typeof r.atual === "string" ? { atual: r.atual } : {}),
    ...(Array.isArray(r.planos) ? { planos: (r.planos as unknown[]).map(String) } : {}),
    ...(typeof r.vale_ate === "string" ? { valeAte: r.vale_ate } : {}),
  };
}

/** Tira o cupom antes do primeiro pagamento, pela função do banco. */
export async function tirarCupomDaEmpresa(
  admin: SupabaseClient,
  orgId: string,
  ator: string | null,
): Promise<{ ok: true; mudou: boolean; tinhaDias: boolean } | { ok: false; motivo: "ja_pagou" }> {
  const { data, error } = await admin.rpc("fn_mia_tirar_cupom", { p_org: orgId, p_ator: ator });
  if (error) throw new Error(`cupons: tirar falhou (${error.code ?? "sem_codigo"})`);
  const r = (data ?? {}) as Record<string, unknown>;
  if (r.ok === false) return { ok: false, motivo: "ja_pagou" };
  return { ok: true, mudou: r.mudou === true, tinhaDias: r.tinha_dias === true };
}

/**
 * A passagem do cadastro: o código espera a empresa nascer (o gatilho adiado da
 * 9130 o aplica). Conta que já existia devolve um usuário ofuscado: a gravação
 * falha calada (anti-enumeração). Nunca lança.
 */
export async function guardarCupomDoCadastro(admin: SupabaseClient, userId: string, bruto: unknown): Promise<boolean> {
  const codigo = normalizarCodigo(bruto);
  if (!codigoValido(codigo)) return false;
  try {
    const { error } = await admin.from("mia_cupom_do_cadastro").upsert({ user_id: userId, codigo }, { onConflict: "user_id" });
    return !error;
  } catch {
    return false;
  }
}
