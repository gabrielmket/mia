/**
 * FORK MIA (.98) · O CUPOM E O SETUP NO PASSO "PAGAMENTO" (protótipo "Cupons e
 * parceiros", tela 1; docs/fork/cupons-e-parceiros.md).
 *
 * "Tenho um cupom" e "Tirar o cupom", antes do primeiro pagamento (depois, só a
 * Time troca). A régua é a do banco (`fn_mia_aplicar_cupom`). Se já há uma
 * cobrança gerada (ou um cartão cadastrado no teste), ela é cancelada no Asaas e
 * o passo recomeça, como na troca de plano: o Pix e o boleto carregam o valor, e
 * a próxima cobrança já nasce com o desconto.
 *
 * O cupom de dias grátis numa empresa de entrada paga muda o MODO do passo: ela
 * entra no teste na hora, é liberada e escolhe como paga depois (cartão ou Pix,
 * sem boleto), pelo mesmo caminho do plano com teste.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { asaasDaMia } from "@/lib/asaas-mia/cobrancas";
import { audit } from "@/lib/audit";
import { codigoDoErro } from "@/lib/asaas-mia/api";
import { logger } from "@/lib/logger";
import {
  cancelarCobrancaAtual,
  conferirPagamento,
  lerAssinatura,
  lerParaEscrever,
  lerPassoDoPagamento,
  pagouAPrimeira,
  reservar,
  SEM_COBRANCA,
  soltar,
  type DependenciasDoPasso,
  type Recusa,
  type ResultadoDoPasso,
} from "@/lib/pagamento-inicial/servico";
import { desistirDoSetup, lerSetupDaEmpresa, pedirSetup } from "@/lib/setup-de-implantacao/servico";

import { aplicarCupomNaEmpresa, lerCupomDaEmpresa, lerCupomPorCodigo, tirarCupomDaEmpresa } from "./banco";
import { codigoValido, fraseDoMotivo, motivoDoCupom, normalizarCodigo, type MotivoDoCupom } from "./regras";

const recusa = (status: number, code: string, message: string, details?: unknown): Recusa => ({
  ok: false,
  status,
  code,
  message,
  ...(details === undefined ? {} : { details }),
});

/** Os nomes dos planos do cupom, para a frase "Vale para: ...". */
async function nomesDosPlanos(admin: SupabaseClient, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data } = await admin.from("cobranca_planos").select("nome").in("id", [...ids]);
  return ((data ?? []) as Array<{ nome: string }>).map((p) => p.nome);
}

/** Cancela a cobrança em aberto para o passo recomeçar. `true` = pode seguir. */
async function recomecarOPasso(
  admin: SupabaseClient,
  orgId: string,
  linha: Awaited<ReturnType<typeof reservar>>,
  deps: DependenciasDoPasso,
): Promise<"seguir" | "ja_pago"> {
  if (!linha) return "seguir";
  const assinatura = await lerAssinatura(admin, orgId);
  if (!assinatura) return "seguir";
  const temCobranca = Boolean(linha.linha.pagamento_ref || assinatura.provedor_assinatura_id);
  if (!temCobranca) return "seguir";
  const asaas = asaasDaMia(deps.asaas);
  if (linha.linha.pagamento_ref) {
    const atual = await asaas.lerCobranca(linha.linha.pagamento_ref);
    if (atual.situacao === "paga" || atual.situacao === "em_analise") return "ja_pago";
  }
  await cancelarCobrancaAtual(admin, orgId, linha.linha, assinatura, asaas, assinatura.pagamento_inicial_pendente ? "entrada_paga" : "teste");
  await admin
    .from("mia_pagamento_inicial")
    .update({
      ...SEM_COBRANCA,
      forma: null,
      primeira_cobranca_em: null,
      cartao_final: null,
      cartao_bandeira: null,
      cartao_recorrente: null,
      cobrancas_refeitas: linha.linha.cobrancas_refeitas + 1,
    })
    .eq("organization_id", orgId);
  return "seguir";
}

/** O modo do passo depois de o cupom entrar ou sair (o teste ou a entrada paga). */
async function acertarOModoDaLinha(admin: SupabaseClient, orgId: string): Promise<void> {
  const assinatura = await lerAssinatura(admin, orgId);
  if (!assinatura) return;
  await admin
    .from("mia_pagamento_inicial")
    .update({ modo: assinatura.pagamento_inicial_pendente ? "entrada_paga" : "teste", plano_id: assinatura.plano_id })
    .eq("organization_id", orgId);
}

/** O setup já pedido acompanha o cupom: o preço da cobrança aberta é refeito. Nunca lança. */
async function acompanharOSetup(admin: SupabaseClient, p: { orgId: string; userId: string; requestId: string }, deps: DependenciasDoPasso): Promise<void> {
  try {
    const setup = await lerSetupDaEmpresa(admin, p.orgId);
    if (setup?.situacao === "aguardando") await pedirSetup(admin, p, { asaas: deps.asaas, emailDoAdmin: deps.emailDoAdmin });
  } catch (e) {
    logger.warn("cupons.setup_nao_acompanhou", { organization_id: p.orgId, codigo: codigoDoErro(e) });
  }
}

/** "Tenho um cupom" no passo do pagamento. */
export async function aplicarCupomNoPasso(
  admin: SupabaseClient,
  p: { orgId: string; userId: string; codigo: unknown; requestId: string },
  deps: DependenciasDoPasso = {},
): Promise<ResultadoDoPasso> {
  const agora = (deps.agora ?? (() => new Date()))();
  const codigo = normalizarCodigo(p.codigo);
  const { assinatura, linha, modo } = await lerParaEscrever(admin, p.orgId, deps);
  if (!assinatura || modo === null) return recusa(409, "sem_passo", "Esta empresa não tem o passo do pagamento.");
  if (pagouAPrimeira(linha, assinatura)) return recusa(409, "ja_pago", "Depois do primeiro pagamento, o cupom só muda com a Time.");
  const falha = async (motivo: MotivoDoCupom, planos: readonly string[] = [], data: string | null = null): Promise<Recusa> => {
    const { data: plano } = await admin.from("cobranca_planos").select("nome").eq("id", assinatura.plano_id).maybeSingle();
    return recusa(422, `cupom_${motivo}`, fraseDoMotivo(motivo, { codigo, data, plano: (plano as { nome?: string } | null)?.nome ?? "", planos: await nomesDosPlanos(admin, planos) }));
  };
  if (codigo === "") return falha("vazio");
  if (!codigoValido(codigo)) return falha("inexistente");
  const [cupom, jaTem, plano] = await Promise.all([
    lerCupomPorCodigo(admin, codigo),
    lerCupomDaEmpresa(admin, p.orgId),
    admin.from("cobranca_planos").select("oferecido_ao_cliente").eq("id", assinatura.plano_id).maybeSingle(),
  ]);
  if (jaTem?.codigo === codigo) return { ok: true, passo: await lerPassoDoPagamento(admin, p.orgId, { podePagar: true }, deps) };
  if (jaTem) return falha("ja_tem_cupom");
  const motivo = motivoDoCupom(cupom, {
    planoId: assinatura.plano_id,
    planoOferecido: (plano.data as { oferecido_ao_cliente?: boolean } | null)?.oferecido_ao_cliente !== false,
    usos: cupom?.usos ?? 0,
    agora,
  });
  if (motivo) return falha(motivo, cupom?.planos ?? [], cupom?.vale_ate ?? null);

  const reserva = await reservar(admin, p.orgId, assinatura.plano_id, agora);
  if (!reserva) return recusa(409, "em_andamento", "Já estamos cuidando deste pagamento. Aguarde alguns segundos.");
  try {
    if ((await recomecarOPasso(admin, p.orgId, reserva, deps)) === "ja_pago") {
      await soltar(admin, p.orgId, reserva.marca);
      await conferirPagamento(admin, p.orgId, { forcar: true, podePagar: true }, deps);
      return recusa(409, "ja_pago", "Depois do primeiro pagamento, o cupom só muda com a Time.");
    }
    const r = await aplicarCupomNaEmpresa(admin, { orgId: p.orgId, codigo, origem: "pagamento", ator: p.userId });
    if (!r.ok) return await falha(r.motivo, r.planos ?? [], r.valeAte ?? null);
    await acertarOModoDaLinha(admin, p.orgId);
    void audit({
      action: "cupom.aplicado",
      actorUserId: p.userId,
      organizationId: p.orgId,
      resourceType: "mia_cupom_da_empresa",
      resourceId: p.orgId,
      requestId: p.requestId,
      metadata: { codigo: r.codigo, beneficio: r.beneficio, origem: "pagamento", dias_aplicados: r.diasAplicados },
    });
  } catch (e) {
    logger.warn("cupons.aplicar_no_passo_falhou", { organization_id: p.orgId, codigo: codigoDoErro(e) });
    return recusa(503, "provedor_recusou", "Não conseguimos aplicar o cupom agora. Tente de novo em alguns minutos.");
  } finally {
    await soltar(admin, p.orgId, reserva.marca);
  }
  await acompanharOSetup(admin, p, deps);
  return { ok: true, passo: await lerPassoDoPagamento(admin, p.orgId, { podePagar: true }, deps) };
}

/** "Tirar o cupom" no passo do pagamento. */
export async function tirarCupomNoPasso(
  admin: SupabaseClient,
  p: { orgId: string; userId: string; requestId: string },
  deps: DependenciasDoPasso = {},
): Promise<ResultadoDoPasso> {
  const agora = (deps.agora ?? (() => new Date()))();
  const { assinatura, linha, modo } = await lerParaEscrever(admin, p.orgId, deps);
  if (!assinatura || modo === null) return recusa(409, "sem_passo", "Esta empresa não tem o passo do pagamento.");
  if (pagouAPrimeira(linha, assinatura)) return recusa(409, "ja_pago", "Depois do primeiro pagamento, o cupom só muda com a Time.");
  const atual = await lerCupomDaEmpresa(admin, p.orgId);
  if (!atual) return { ok: true, passo: await lerPassoDoPagamento(admin, p.orgId, { podePagar: true }, deps) };
  const reserva = await reservar(admin, p.orgId, assinatura.plano_id, agora);
  if (!reserva) return recusa(409, "em_andamento", "Já estamos cuidando deste pagamento. Aguarde alguns segundos.");
  try {
    if ((await recomecarOPasso(admin, p.orgId, reserva, deps)) === "ja_pago") {
      await soltar(admin, p.orgId, reserva.marca);
      await conferirPagamento(admin, p.orgId, { forcar: true, podePagar: true }, deps);
      return recusa(409, "ja_pago", "Depois do primeiro pagamento, o cupom só muda com a Time.");
    }
    const r = await tirarCupomDaEmpresa(admin, p.orgId, p.userId);
    if (!r.ok) return recusa(409, "ja_pago", "Depois do primeiro pagamento, o cupom só muda com a Time.");
    await acertarOModoDaLinha(admin, p.orgId);
    void audit({
      action: "cupom.tirado",
      actorUserId: p.userId,
      organizationId: p.orgId,
      resourceType: "mia_cupom_da_empresa",
      resourceId: p.orgId,
      requestId: p.requestId,
      metadata: { codigo: atual.codigo, tinha_dias: r.tinhaDias },
    });
  } catch (e) {
    logger.warn("cupons.tirar_no_passo_falhou", { organization_id: p.orgId, codigo: codigoDoErro(e) });
    return recusa(503, "provedor_recusou", "Não conseguimos tirar o cupom agora. Tente de novo em alguns minutos.");
  } finally {
    await soltar(admin, p.orgId, reserva.marca);
  }
  await acompanharOSetup(admin, p, deps);
  return { ok: true, passo: await lerPassoDoPagamento(admin, p.orgId, { podePagar: true }, deps) };
}

/** "Quero que a Time implante para mim": marcar pede o setup; desmarcar desiste. */
export async function escolherSetupNoPasso(
  admin: SupabaseClient,
  p: { orgId: string; userId: string; quero: boolean; requestId: string },
  deps: DependenciasDoPasso = {},
): Promise<ResultadoDoPasso> {
  const { assinatura, modo } = await lerParaEscrever(admin, p.orgId, deps);
  if (!assinatura || modo === null) return recusa(409, "sem_passo", "Esta empresa não tem o passo do pagamento.");
  const r = p.quero
    ? await pedirSetup(admin, p, { asaas: deps.asaas, emailDoAdmin: deps.emailDoAdmin, ...(deps.cobrancaLigada ? { cobrancaLigada: deps.cobrancaLigada } : {}) })
    : await desistirDoSetup(admin, p, { asaas: deps.asaas });
  if (!r.ok) return recusa(r.status, r.code, r.message);
  return { ok: true, passo: await lerPassoDoPagamento(admin, p.orgId, { podePagar: true }, deps) };
}
