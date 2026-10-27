/**
 * FORK MIA (.96) · OS DADOS FISCAIS NO BANCO (`mia_dados_fiscais`, migration 9120).
 *
 * Leitura e escrita pelo SERVIDOR (service role), depois que quem chama conferiu
 * a autoridade: o administrador da própria empresa (sessão), o passo do
 * pagamento ou a plataforma. A organização vem sempre de fonte confiável
 * (sessão, path, gatilho), nunca do corpo. As regras do dado moram em
 * `./regras.ts`; aqui, só o que depende do banco:
 *
 *   - o CPF ou CNPJ NÃO muda depois do primeiro pagamento (decisão 10: trocar de
 *     titular é pedido à Time). Antes de pagar, muda: é o "Corrigir" do passo do
 *     pagamento, para quem errou um número no cadastro;
 *   - toda gravação zera `asaas_sincronizado_em` (pela versão da linha): a
 *     próxima conferência leva os dados ao cliente do Asaas, e a mudança vale
 *     para as próximas notas;
 *   - a passagem do cadastro (`mia_dados_fiscais_do_cadastro`) espera o usuário;
 *     o gatilho da 9120 a leva para a empresa quando ela nasce.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DadosFiscais } from "./regras";

export interface DadosFiscaisGravados extends DadosFiscais {
  organization_id: string;
  asaas_sincronizado_em: string | null;
  updated_at: string;
}

const COLUNAS =
  "organization_id, tipo, documento, razao_social, cep, logradouro, numero, complemento, bairro, cidade, uf, " +
  "inscricao_municipal, inscricao_estadual, telefone, asaas_sincronizado_em, updated_at";

/** Os dados fiscais da empresa, ou `null` quando ainda não há. LANÇA na falha de leitura. */
export async function lerDadosFiscais(admin: SupabaseClient, orgId: string): Promise<DadosFiscaisGravados | null> {
  const { data, error } = await admin.from("mia_dados_fiscais").select(COLUNAS).eq("organization_id", orgId).maybeSingle();
  if (error) throw new Error(`dados fiscais: leitura falhou (${error.code ?? "sem_codigo"})`);
  return (data as unknown as DadosFiscaisGravados | null) ?? null;
}

export type ResultadoDaGravacaoFiscal =
  | { ok: true; dados: DadosFiscaisGravados; mudouDocumento: boolean }
  | { ok: false; motivo: "documento_nao_muda" | "falha_no_banco" };

/**
 * Grava (cria ou atualiza) os dados fiscais da empresa. `permitirTrocarDocumento`
 * só é verdadeiro no passo do pagamento, ANTES do primeiro pagamento: depois, o
 * CPF ou CNPJ e o tipo ficam como estão (a tela da área de cobrança nem os manda).
 */
export async function gravarDadosFiscais(
  admin: SupabaseClient,
  orgId: string,
  dados: DadosFiscais,
  opcoes: { userId: string | null; permitirTrocarDocumento: boolean },
): Promise<ResultadoDaGravacaoFiscal> {
  let atual: DadosFiscaisGravados | null;
  try {
    atual = await lerDadosFiscais(admin, orgId);
  } catch {
    return { ok: false, motivo: "falha_no_banco" };
  }
  const mudouDocumento = atual !== null && (atual.documento !== dados.documento || atual.tipo !== dados.tipo);
  if (mudouDocumento && !opcoes.permitirTrocarDocumento) return { ok: false, motivo: "documento_nao_muda" };
  const linha = {
    organization_id: orgId,
    tipo: dados.tipo,
    documento: dados.documento,
    razao_social: dados.razao_social,
    cep: dados.cep,
    logradouro: dados.logradouro,
    numero: dados.numero,
    complemento: dados.complemento,
    bairro: dados.bairro,
    cidade: dados.cidade,
    uf: dados.uf,
    inscricao_municipal: dados.inscricao_municipal,
    inscricao_estadual: dados.inscricao_estadual,
    // O WhatsApp só sai quando a tela manda outro: a área de cobrança não o edita.
    telefone: dados.telefone ?? atual?.telefone ?? null,
    // Versão nova: o Asaas ainda não a recebeu.
    asaas_sincronizado_em: null,
    updated_by: opcoes.userId,
  };
  const { data, error } = await admin
    .from("mia_dados_fiscais")
    .upsert(linha, { onConflict: "organization_id" })
    .select(COLUNAS)
    .maybeSingle();
  if (error || !data) return { ok: false, motivo: "falha_no_banco" };
  return { ok: true, dados: data as unknown as DadosFiscaisGravados, mudouDocumento };
}

/**
 * Marca que o cliente do Asaas recebeu os dados da versão `updated_at` lida.
 * Compare-and-set na versão: se alguém gravou no meio, a marca não vale e a
 * próxima conferência leva a versão nova. Nunca lança.
 */
export async function marcarDadosFiscaisNoAsaas(
  admin: SupabaseClient,
  orgId: string,
  versao: string,
  quando: Date = new Date(),
): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("mia_dados_fiscais")
      .update({ asaas_sincronizado_em: quando.toISOString() })
      .eq("organization_id", orgId)
      .eq("updated_at", versao)
      .select("organization_id")
      .maybeSingle();
    return !error && data !== null;
  } catch {
    return false;
  }
}

/** Os dados fiscais esperam a empresa nascer (o cadastro público). Nunca lança: `false` na falha. */
export async function guardarDadosDoCadastro(
  admin: SupabaseClient,
  userId: string,
  dados: DadosFiscais,
): Promise<boolean> {
  try {
    const { error } = await admin.from("mia_dados_fiscais_do_cadastro").upsert(
      {
        user_id: userId,
        tipo: dados.tipo,
        documento: dados.documento,
        razao_social: dados.razao_social,
        cep: dados.cep,
        logradouro: dados.logradouro,
        numero: dados.numero,
        complemento: dados.complemento,
        bairro: dados.bairro,
        cidade: dados.cidade,
        uf: dados.uf,
        inscricao_municipal: dados.inscricao_municipal,
        inscricao_estadual: dados.inscricao_estadual,
        telefone: dados.telefone,
        created_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    return !error;
  } catch {
    return false;
  }
}

/** Empresas com dados fiscais que o Asaas ainda não recebeu (a rodada leva). LANÇA na falha. */
export async function dadosFiscaisParaOAsaas(
  admin: SupabaseClient,
  limite = 50,
): Promise<DadosFiscaisGravados[]> {
  const { data, error } = await admin
    .from("mia_dados_fiscais")
    .select(COLUNAS)
    .is("asaas_sincronizado_em", null)
    .order("updated_at", { ascending: true })
    .limit(limite);
  if (error) throw new Error(`dados fiscais: leitura falhou (${error.code ?? "sem_codigo"})`);
  return (data ?? []) as unknown as DadosFiscaisGravados[];
}
