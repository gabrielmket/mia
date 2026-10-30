/**
 * FORK MIA (.98) · OS PARCEIROS NO BANCO (migration 9130; docs/fork/cupons-e-parceiros.md).
 *
 * Os dados do parceiro (CPF ou CNPJ, e-mail, Pix) só a Time vê: a tabela não
 * tem política, e quem lê é o servidor com o cliente de serviço (Admin ›
 * Parceiros e o MCP de plataforma). Mudar a comissão vale para os clientes
 * NOVOS: quem já pagou a primeira vez tem a comissão fixada no cupom da empresa
 * (`mia_cupom_da_empresa.termos_fixados_em`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { documentoDoParceiro, parceiroSchema, type TipoDeDocumento } from "./regras";

export interface Parceiro {
  id: string;
  nome: string;
  tipo_documento: TipoDeDocumento | null;
  documento: string | null;
  email: string | null;
  chave_pix: string | null;
  comissao_pct: number;
  comissao_meses: number | null;
  comissao_setup_pct: number;
  ativo: boolean;
  anonimizado_em: string | null;
  created_at: string;
  updated_at: string;
}

const COLUNAS =
  "id, nome, tipo_documento, documento, email, chave_pix, comissao_pct, comissao_meses, comissao_setup_pct, ativo, anonimizado_em, created_at, updated_at";

export function paraParceiro(l: Record<string, unknown>): Parceiro {
  return {
    id: String(l.id),
    nome: String(l.nome),
    tipo_documento: (l.tipo_documento as TipoDeDocumento | null) ?? null,
    documento: (l.documento as string | null) ?? null,
    email: (l.email as string | null) ?? null,
    chave_pix: (l.chave_pix as string | null) ?? null,
    comissao_pct: Number(l.comissao_pct ?? 0),
    comissao_meses: l.comissao_meses === null || l.comissao_meses === undefined ? null : Number(l.comissao_meses),
    comissao_setup_pct: Number(l.comissao_setup_pct ?? 0),
    ativo: l.ativo !== false,
    anonimizado_em: (l.anonimizado_em as string | null) ?? null,
    created_at: String(l.created_at ?? ""),
    updated_at: String(l.updated_at ?? ""),
  };
}

export async function lerParceiros(admin: SupabaseClient): Promise<Parceiro[]> {
  const { data, error } = await admin.from("mia_parceiros").select(COLUNAS).order("nome").limit(1000);
  if (error) throw new Error(`parceiros: leitura falhou (${error.code ?? "sem_codigo"})`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(paraParceiro);
}

export async function lerParceiro(admin: SupabaseClient, id: string): Promise<Parceiro | null> {
  const { data, error } = await admin.from("mia_parceiros").select(COLUNAS).eq("id", id).maybeSingle();
  if (error) throw new Error(`parceiros: leitura falhou (${error.code ?? "sem_codigo"})`);
  return data ? paraParceiro(data as Record<string, unknown>) : null;
}

export type ResultadoDoParceiro =
  | { ok: true; parceiro: Parceiro; criado: boolean; mudou: boolean }
  | { ok: false; motivo: "invalido"; campos: Record<string, string> }
  | { ok: false; motivo: "documento_invalido" | "documento_de_outro" | "nao_encontrado" | "anonimizado" | "falha_no_banco" };

const COMPARAVEIS = ["nome", "tipo_documento", "documento", "email", "chave_pix", "comissao_pct", "comissao_meses", "comissao_setup_pct", "ativo"] as const;

/**
 * Cria ou muda um parceiro. Sem `id`, o DOCUMENTO é a chave (idempotente: a
 * mesma entrada não regrava). Com `id`, muda aquele (inclusive o documento,
 * desde que não seja o de outro parceiro).
 */
export async function garantirParceiro(
  admin: SupabaseClient,
  entrada: unknown,
  o: { ator: string | null; id?: string | null },
): Promise<ResultadoDoParceiro> {
  const lido = parceiroSchema.safeParse(entrada);
  if (!lido.success) {
    const campos: Record<string, string> = {};
    for (const i of lido.error.issues) campos[String(i.path[0] ?? "parceiro")] ??= i.message;
    return { ok: false, motivo: "invalido", campos };
  }
  const doc = documentoDoParceiro(lido.data.documento);
  if (!doc) return { ok: false, motivo: "documento_invalido" };
  const linha = {
    nome: lido.data.nome,
    tipo_documento: doc.tipo,
    documento: doc.documento,
    email: lido.data.email.toLowerCase(),
    chave_pix: lido.data.chave_pix,
    comissao_pct: lido.data.comissao_pct,
    comissao_meses: lido.data.comissao_meses,
    comissao_setup_pct: lido.data.comissao_setup_pct,
    ...(lido.data.ativo === undefined ? {} : { ativo: lido.data.ativo }),
  };
  const { data: peloDoc, error: erroDoc } = await admin.from("mia_parceiros").select(COLUNAS).eq("documento", doc.documento).maybeSingle();
  if (erroDoc) return { ok: false, motivo: "falha_no_banco" };
  let atual: Parceiro | null = peloDoc ? paraParceiro(peloDoc as Record<string, unknown>) : null;
  if (o.id) {
    const doId = await lerParceiro(admin, o.id);
    if (!doId) return { ok: false, motivo: "nao_encontrado" };
    if (atual && atual.id !== doId.id) return { ok: false, motivo: "documento_de_outro" };
    atual = doId;
  }
  if (atual?.anonimizado_em) return { ok: false, motivo: "anonimizado" };
  if (atual) {
    const igual = COMPARAVEIS.every((k) => !(k in linha) || String(atual[k as keyof Parceiro] ?? "") === String((linha as Record<string, unknown>)[k] ?? ""));
    if (igual) return { ok: true, parceiro: atual, criado: false, mudou: false };
    const { data, error } = await admin.from("mia_parceiros").update({ ...linha, updated_by: o.ator }).eq("id", atual.id).select(COLUNAS).single();
    if (error || !data) return { ok: false, motivo: error?.code === "23505" ? "documento_de_outro" : "falha_no_banco" };
    return { ok: true, parceiro: paraParceiro(data as Record<string, unknown>), criado: false, mudou: true };
  }
  const { data, error } = await admin
    .from("mia_parceiros")
    .insert({ ...linha, created_by: o.ator, updated_by: o.ator })
    .select(COLUNAS)
    .single();
  if (error || !data) return { ok: false, motivo: error?.code === "23505" ? "documento_de_outro" : "falha_no_banco" };
  return { ok: true, parceiro: paraParceiro(data as Record<string, unknown>), criado: true, mudou: true };
}

export interface ClienteDoParceiro {
  organization_id: string;
  nome: string;
  codigo: string;
  plano: string | null;
  entrou_em: string;
  comissao_pct: number | null;
  comissao_meses: number | null;
  termos_fixados: boolean;
  primeira_mensalidade_em: string | null;
}

/** Os clientes ligados a um parceiro (pelo cupom da empresa). LANÇA na falha. */
export async function clientesDoParceiro(admin: SupabaseClient, parceiroId: string): Promise<ClienteDoParceiro[]> {
  const { data, error } = await admin
    .from("mia_cupom_da_empresa")
    .select("organization_id, codigo, aplicado_em, comissao_pct, comissao_meses, termos_fixados_em, primeira_mensalidade_em")
    .eq("parceiro_id", parceiroId)
    .order("aplicado_em", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`parceiros: clientes ilegíveis (${error.code ?? "sem_codigo"})`);
  const linhas = (data ?? []) as Array<Record<string, unknown>>;
  const ids = linhas.map((l) => String(l.organization_id));
  if (ids.length === 0) return [];
  const [orgs, assinaturas] = await Promise.all([
    admin.from("organizations").select("id, display_name").in("id", ids),
    admin.from("cobranca_assinaturas").select("organization_id, plano_id").in("organization_id", ids),
  ]);
  const nomes = new Map(((orgs.data ?? []) as Array<{ id: string; display_name: string }>).map((o) => [o.id, o.display_name]));
  const planosDe = new Map(((assinaturas.data ?? []) as Array<{ organization_id: string; plano_id: string }>).map((a) => [a.organization_id, a.plano_id]));
  const planoIds = [...new Set(planosDe.values())];
  const planos = planoIds.length ? await admin.from("cobranca_planos").select("id, nome").in("id", planoIds) : { data: [] };
  const nomeDoPlano = new Map(((planos.data ?? []) as Array<{ id: string; nome: string }>).map((p) => [p.id, p.nome]));
  return linhas.map((l) => {
    const id = String(l.organization_id);
    const planoId = planosDe.get(id);
    return {
      organization_id: id,
      nome: nomes.get(id) ?? "Empresa apagada",
      codigo: String(l.codigo),
      plano: planoId ? (nomeDoPlano.get(planoId) ?? null) : null,
      entrou_em: String(l.aplicado_em ?? ""),
      comissao_pct: l.comissao_pct === null ? null : Number(l.comissao_pct),
      comissao_meses: l.comissao_meses === null ? null : Number(l.comissao_meses),
      termos_fixados: l.termos_fixados_em !== null,
      primeira_mensalidade_em: (l.primeira_mensalidade_em as string | null) ?? null,
    };
  });
}

/**
 * LGPD do parceiro (uma pessoa): o arquivo de cada anexo sai do armazenamento
 * e a função do banco apaga nome, documento, e-mail e Pix e tira a referência
 * do anexo. Os valores ficam (registro financeiro). Arquivo que não sai =
 * nada é apagado no banco (o pedido pode ser repetido).
 */
export async function anonimizarParceiro(
  admin: SupabaseClient,
  parceiroId: string,
  ator: string | null,
): Promise<{ ok: true; anexos: number } | { ok: false; motivo: "nao_encontrado" | "arquivo_nao_saiu" | "falha_no_banco" }> {
  const parceiro = await lerParceiro(admin, parceiroId);
  if (!parceiro) return { ok: false, motivo: "nao_encontrado" };
  const { data: repasses, error } = await admin.from("mia_repasses").select("anexo_path").eq("parceiro_id", parceiroId).not("anexo_path", "is", null);
  if (error) return { ok: false, motivo: "falha_no_banco" };
  const caminhos = ((repasses ?? []) as Array<{ anexo_path: string }>).map((r) => r.anexo_path);
  if (caminhos.length > 0) {
    const { error: erroDoArquivo } = await admin.storage.from("mia-repasses").remove(caminhos);
    if (erroDoArquivo) return { ok: false, motivo: "arquivo_nao_saiu" };
  }
  const { data, error: erroDaFuncao } = await admin.rpc("fn_mia_anonimizar_parceiro", { p_parceiro: parceiroId, p_ator: ator });
  if (erroDaFuncao) return { ok: false, motivo: "falha_no_banco" };
  const r = (data ?? {}) as { ok?: boolean; anexos_removidos?: number };
  if (r.ok !== true) return { ok: false, motivo: "nao_encontrado" };
  return { ok: true, anexos: Number(r.anexos_removidos ?? caminhos.length) };
}

/**
 * LGPD do parceiro: a cópia dos dados dele (o acesso do titular). Tudo o que o
 * sistema guarda sobre a pessoa: o cadastro, os cupons, as empresas que vieram
 * por ele (o nome, que o extrato já mostra), as comissões e os repasses.
 */
export async function exportarDadosDoParceiro(admin: SupabaseClient, parceiroId: string): Promise<Record<string, unknown> | null> {
  const parceiro = await lerParceiro(admin, parceiroId);
  if (!parceiro) return null;
  const [cupons, clientes, comissoes, repasses] = await Promise.all([
    admin.from("mia_cupons").select("codigo, beneficio, valor, meses, setup_tipo, setup_valor, vale_ate, comissao_pct, ativo, created_at").eq("parceiro_id", parceiroId),
    clientesDoParceiro(admin, parceiroId),
    admin
      .from("mia_comissoes")
      .select("tipo, pago_em, competencia, valor_pago_cents, aliquota_pct, imposto_cents, taxa_cents, liquido_cents, comissao_pct, comissao_cents, organization_id")
      .eq("parceiro_id", parceiroId)
      .order("pago_em"),
    admin.from("mia_repasses").select("competencia, total_cents, fechado_em, extrato_enviado_em, anexo_nome, anexo_em, pago_em").eq("parceiro_id", parceiroId).order("competencia"),
  ]);
  const nomeDa = new Map(clientes.map((c) => [c.organization_id, c.nome]));
  return {
    gerado_em: new Date().toISOString(),
    parceiro: {
      nome: parceiro.nome,
      tipo_documento: parceiro.tipo_documento,
      documento: parceiro.documento,
      email: parceiro.email,
      chave_pix: parceiro.chave_pix,
      comissao_pct: parceiro.comissao_pct,
      comissao_meses: parceiro.comissao_meses,
      comissao_setup_pct: parceiro.comissao_setup_pct,
      ativo: parceiro.ativo,
      anonimizado_em: parceiro.anonimizado_em,
      cadastrado_em: parceiro.created_at,
    },
    cupons: cupons.data ?? [],
    clientes: clientes.map((c) => ({ empresa: c.nome, cupom: c.codigo, entrou_em: c.entrou_em, plano: c.plano })),
    comissoes: ((comissoes.data ?? []) as Array<Record<string, unknown>>).map(({ organization_id, ...resto }) => ({
      ...resto,
      empresa: organization_id ? (nomeDa.get(String(organization_id)) ?? null) : null,
    })),
    repasses: repasses.data ?? [],
  };
}
