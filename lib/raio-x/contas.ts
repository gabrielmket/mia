/**
 * FORK MIA (.106) · A CONTA DE QUEM SE CADASTROU NO RAIO-X: o banco da conta,
 * a regra da grátis, o código de acesso e o que a área mostra.
 *
 * Tudo com o cliente de serviço: as tabelas do raio-X são só do servidor
 * (9150, 9152). Quem chama já conferiu a pessoa (o cookie assinado na área, o
 * código no e-mail na entrada, o teto por IP no cadastro).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { phoneLookupVariants } from "@/lib/channels/phone-variants";

import {
  codigoConfere,
  gerarCodigoDeAcesso,
  hashDoCodigoDeAcesso,
  TENTATIVAS_DO_CODIGO,
  VALIDADE_DO_CODIGO_MS,
} from "./acesso";
import { limparEmail } from "./aceite";
import { COLUNAS_DO_RAIO_X, type LinhaDoRaioX } from "./banco";

export interface LinhaDaConta {
  id: string;
  email: string;
  nome: string;
  telefone: string;
  crm_lead_id: string | null;
  crm_enviado_em: string | null;
  crm_erro: string | null;
  asaas_cliente_id: string | null;
  ultimo_acesso_em: string | null;
  created_at: string;
}

export const COLUNAS_DA_CONTA = "id, email, nome, telefone, crm_lead_id, crm_enviado_em, crm_erro, asaas_cliente_id, ultimo_acesso_em, created_at";

function falhou(contexto: string, erro: { code?: string } | null): never {
  throw new Error(`raio-x: ${contexto} (${erro?.code ?? "sem_codigo"})`);
}

export async function lerConta(admin: SupabaseClient, id: string): Promise<LinhaDaConta | null> {
  const { data, error } = await admin.from("mia_raio_x_contas").select(COLUNAS_DA_CONTA).eq("id", id).maybeSingle();
  if (error) falhou("leitura da conta", error);
  return (data as unknown as LinhaDaConta | null) ?? null;
}

export async function contaPeloEmail(admin: SupabaseClient, email: string): Promise<LinhaDaConta | null> {
  const limpo = limparEmail(email);
  if (!limpo) return null;
  const { data, error } = await admin.from("mia_raio_x_contas").select(COLUNAS_DA_CONTA).eq("email", limpo).maybeSingle();
  if (error) falhou("conta pelo e-mail", error);
  return (data as unknown as LinhaDaConta | null) ?? null;
}

/**
 * Acha a conta pelo e-mail ou cria. Achou: atualiza o nome e o WhatsApp da
 * pessoa com o que ela acabou de mandar (decisão do brief da .106). Dois
 * cadastros do mesmo e-mail ao mesmo tempo: o segundo cai no `unique` e relê.
 */
export async function acharOuCriarConta(admin: SupabaseClient, p: { email: string; nome: string; telefone: string }): Promise<LinhaDaConta> {
  const email = limparEmail(p.email);
  const existente = await contaPeloEmail(admin, email);
  if (existente) {
    const { data, error } = await admin
      .from("mia_raio_x_contas")
      .update({ nome: p.nome, telefone: p.telefone })
      .eq("id", existente.id)
      .select(COLUNAS_DA_CONTA)
      .maybeSingle();
    if (error) falhou("a conta não atualizou", error);
    return ((data as unknown as LinhaDaConta | null) ?? { ...existente, nome: p.nome, telefone: p.telefone });
  }
  const { data, error } = await admin
    .from("mia_raio_x_contas")
    .insert({ email, nome: p.nome, telefone: p.telefone })
    .select(COLUNAS_DA_CONTA)
    .single();
  if (error?.code === "23505") {
    const outra = await contaPeloEmail(admin, email);
    if (outra) return outra;
  }
  if (error || !data) falhou("a conta não gravou", error);
  return data as unknown as LinhaDaConta;
}

/** As duas grafias do nono dígito de um número (com e sem o 9), em dígitos. */
export function grafiasDoNumero(digitos: string): string[] {
  return [...new Set([digitos, ...phoneLookupVariants(digitos).map((v) => v.replace(/\D/g, ""))])];
}

/**
 * A GRÁTIS JÁ FOI USADA? Uma por número analisado (pelas duas grafias do nono
 * dígito) e uma por conta. Não conta a que fechou sem histórico (0 conversas).
 * Devolve o raio-X que a usou, ou `null`.
 */
export async function gratisUsada(admin: SupabaseClient, p: { contaId: string | null; whatsapp: string }): Promise<LinhaDoRaioX | null> {
  const porNumero = await admin
    .from("mia_raio_x")
    .select(COLUNAS_DO_RAIO_X)
    .eq("gratis", true)
    .is("sem_historico_em", null)
    .in("whatsapp", grafiasDoNumero(p.whatsapp))
    .limit(1);
  if (porNumero.error) falhou("a grátis pelo número", porNumero.error);
  const achado = ((porNumero.data ?? []) as unknown as LinhaDoRaioX[])[0];
  if (achado) return achado;
  if (!p.contaId) return null;
  const porConta = await admin
    .from("mia_raio_x")
    .select(COLUNAS_DO_RAIO_X)
    .eq("gratis", true)
    .is("sem_historico_em", null)
    .eq("conta_id", p.contaId)
    .limit(1);
  if (porConta.error) falhou("a grátis pela conta", porConta.error);
  return ((porConta.data ?? []) as unknown as LinhaDoRaioX[])[0] ?? null;
}

/** Os raio-X da conta, do mais novo para o mais velho. */
export async function raioXDaConta(admin: SupabaseClient, contaId: string): Promise<LinhaDoRaioX[]> {
  const { data, error } = await admin
    .from("mia_raio_x")
    .select(COLUNAS_DO_RAIO_X)
    .eq("conta_id", contaId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) falhou("os raio-X da conta", error);
  return (data ?? []) as unknown as LinhaDoRaioX[];
}

// ─── O código de acesso ─────────────────────────────────────────────────────

/**
 * Pede um código para entrar. Sem conta para o e-mail: `null`, e quem chama
 * responde IGUAL (ninguém descobre quem tem cadastro pela resposta). Com conta:
 * grava só o hash, com 15 minutos, e devolve o código para o e-mail.
 */
export async function criarCodigoDeAcesso(
  admin: SupabaseClient,
  email: string,
  agora: Date = new Date(),
): Promise<{ conta: LinhaDaConta; codigo: string } | null> {
  const conta = await contaPeloEmail(admin, email);
  if (!conta) return null;
  const codigo = gerarCodigoDeAcesso();
  const { error } = await admin.from("mia_raio_x_codigos_de_acesso").insert({
    conta_id: conta.id,
    codigo_hash: hashDoCodigoDeAcesso(conta.id, codigo),
    expira_em: new Date(agora.getTime() + VALIDADE_DO_CODIGO_MS).toISOString(),
    created_at: agora.toISOString(),
  });
  if (error) falhou("o código não gravou", error);
  return { conta, codigo };
}

export type ResultadoDoCodigo =
  | { ok: true; conta: LinhaDaConta }
  | { ok: false; motivo: "errado" | "vencido" | "esgotado"; restam: number };

/**
 * Confere o código. Vale só o MAIS NOVO da conta, não usado, dentro dos 15
 * minutos e com tentativa sobrando (5). Cada tentativa conta ANTES de comparar,
 * por update condicional (duas tentativas ao mesmo tempo não usam a mesma
 * contagem). E-mail sem conta responde como código errado.
 */
export async function conferirCodigoDeAcesso(
  admin: SupabaseClient,
  email: string,
  codigo: string,
  agora: Date = new Date(),
): Promise<ResultadoDoCodigo> {
  const conta = await contaPeloEmail(admin, email);
  if (!conta) return { ok: false, motivo: "errado", restam: TENTATIVAS_DO_CODIGO - 1 };
  const { data, error } = await admin
    .from("mia_raio_x_codigos_de_acesso")
    .select("id, codigo_hash, expira_em, tentativas, usado_em, created_at")
    .eq("conta_id", conta.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) falhou("leitura do código", error);
  const linha = data as { id: string; codigo_hash: string; expira_em: string; tentativas: number; usado_em: string | null } | null;
  if (!linha || linha.usado_em) return { ok: false, motivo: "vencido", restam: 0 };
  if (Date.parse(linha.expira_em) <= agora.getTime()) return { ok: false, motivo: "vencido", restam: 0 };
  const tentativas = Number(linha.tentativas) || 0;
  if (tentativas >= TENTATIVAS_DO_CODIGO) return { ok: false, motivo: "esgotado", restam: 0 };
  const { data: contou, error: erroDaConta } = await admin
    .from("mia_raio_x_codigos_de_acesso")
    .update({ tentativas: tentativas + 1 })
    .eq("id", linha.id)
    .eq("tentativas", tentativas)
    .select("id");
  if (erroDaConta) falhou("a tentativa não contou", erroDaConta);
  // Outra tentativa contou no meio: esta não vale (a pessoa digita de novo).
  if ((contou ?? []).length === 0) return { ok: false, motivo: "errado", restam: Math.max(0, TENTATIVAS_DO_CODIGO - tentativas - 1) };
  if (!codigoConfere(linha.codigo_hash, conta.id, codigo)) {
    const restam = Math.max(0, TENTATIVAS_DO_CODIGO - tentativas - 1);
    return { ok: false, motivo: restam === 0 ? "esgotado" : "errado", restam };
  }
  const usado = agora.toISOString();
  await admin.from("mia_raio_x_codigos_de_acesso").update({ usado_em: usado }).eq("id", linha.id);
  await admin.from("mia_raio_x_contas").update({ ultimo_acesso_em: usado }).eq("id", conta.id);
  return { ok: true, conta: { ...conta, ultimo_acesso_em: usado } };
}
