/**
 * FORK MIA (.90) — os MÓDULOS no Plano e cobrança da empresa (protótipo, tela 4).
 *
 * Para cada módulo vendável: se está ligado e por quê ("pelo plano", "pela
 * Time"), se sai numa descida agendada (e quando), se entra quando o ajuste do
 * upgrade for pago, e, fora do plano, em qual plano oferecido ele vem. Vendas
 * B2B avisa quando o módulo da instalação está desligado. Servidor; LANÇA na
 * falha de leitura (a tela não afirma módulo que não leu).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { modulosLigados } from "@/lib/instalacao/modulos";
import { moduloLiberado } from "@/lib/modulos/liberacao";

import { conversasEstimadas, MODULOS_DO_PLANO, type ModuloDoPlano } from "./catalogo";
import { lerPlanosComModulos, planosOferecidos } from "./leitura";
import { origemDosModulos } from "./modulos";
import { precoPorEmailDaEmpresa } from "./preco-por-email";
import { precoPorMensagemDaEmpresa } from "./preco-por-mensagem";

export interface ModuloNoPainel {
  modulo: ModuloDoPlano;
  ligado: boolean;
  pelo_plano: boolean;
  pela_time: boolean;
  /** A descida agendada tira este módulo nesta data (ISO). */
  sai_em: string | null;
  /** O ajuste do upgrade em aberto liga este módulo quando for pago. */
  entra_ao_pagar: boolean;
  /** Fora do plano: o plano oferecido mais barato (acima do atual) que o tem. */
  em_qual_plano: string | null;
  /** Vendas B2B com o módulo da instalação desligado: o plano não o entrega. */
  desligado_na_instalacao: boolean;
}

export async function lerModulosDoPainel(
  admin: SupabaseClient,
  orgId: string,
): Promise<ModuloNoPainel[]> {
  const [origens, planos, lidaA, ligadosNaInstalacao] = await Promise.all([
    origemDosModulos(admin, orgId),
    lerPlanosComModulos(admin),
    admin
      .from("cobranca_assinaturas")
      .select(
        "plano_id, plano_agendado_id, proximo_vencimento, plano_troca_pendente_id, troca_status",
      )
      .eq("organization_id", orgId)
      .maybeSingle(),
    modulosLigados(admin),
  ]);
  if (lidaA.error)
    throw new Error(`assinatura: leitura falhou (${lidaA.error.code ?? "sem_codigo"})`);
  const a = lidaA.data as {
    plano_id: string;
    plano_agendado_id: string | null;
    proximo_vencimento: string | null;
    plano_troca_pendente_id: string | null;
    troca_status: string | null;
  } | null;
  const porId = new Map(planos.map((p) => [p.id, p]));
  const atual = a ? (porId.get(a.plano_id) ?? null) : null;
  const agendado = a?.plano_agendado_id ? (porId.get(a.plano_agendado_id) ?? null) : null;
  const pendente =
    a?.plano_troca_pendente_id && a.troca_status === "aguardando_pagamento"
      ? (porId.get(a.plano_troca_pendente_id) ?? null)
      : null;
  const origemDe = new Map(origens.map((o) => [o.modulo, o]));
  const b2bNaInstalacao = ligadosNaInstalacao.includes("crm_b2b");
  const ofertados = planosOferecidos(planos).filter(
    (p) => !atual || p.intervalo === atual.intervalo,
  );

  return MODULOS_DO_PLANO.map((m) => {
    const o = origemDe.get(m);
    const ligado = !!o;
    const saiNaDescida =
      ligado && !!agendado && o!.pelo_plano && !o!.pela_time && !agendado.modulos.includes(m);
    const acima = ofertados
      .filter((p) => p.modulos.includes(m) && (!atual || p.preco_cents > atual.preco_cents))
      .sort((x, y) => x.preco_cents - y.preco_cents)[0];
    return {
      modulo: m,
      ligado,
      pelo_plano: o?.pelo_plano ?? false,
      pela_time: o?.pela_time ?? false,
      sai_em: saiNaDescida ? (a?.proximo_vencimento ?? null) : null,
      entra_ao_pagar: !ligado && !!pendente && pendente.modulos.includes(m),
      em_qual_plano: !ligado && acima ? acima.nome : null,
      desligado_na_instalacao: m === "crm_b2b" && !b2bNaInstalacao,
    };
  });
}

/**
 * O bloco Créditos do Plano e cobrança: aparece para a empresa que tem o módulo
 * que usa a carteira (Broadcast ou e-mail marketing), com o preço por mensagem
 * que vale para ela (o combinado, senão o do plano) e, desde a .95, o preço por
 * e-mail de quem tem o e-mail marketing (o definido à mão, senão o do plano,
 * senão o padrão). LANÇA na falha.
 */
export async function lerCreditosDoPainel(
  admin: SupabaseClient,
  orgId: string,
): Promise<{
  temCarteira: boolean;
  precoPorMensagemCents: number | null;
  /** `null` = a empresa não tem o e-mail marketing. */
  precoPorEmailCents: number | null;
}> {
  const [doBroadcast, doEmail, combinado] = await Promise.all([
    moduloLiberado(admin, orgId, "disparador"),
    moduloLiberado(admin, orgId, "email_marketing"),
    admin
      .from("tenant_broadcast_pricing")
      .select("preco_por_mensagem_cents, preco_por_email_cents")
      .eq("organization_id", orgId)
      .maybeSingle(),
  ]);
  if (combinado.error)
    throw new Error(`preço: leitura falhou (${combinado.error.code ?? "sem_codigo"})`);
  const v = (combinado.data as { preco_por_mensagem_cents?: number | null } | null)
    ?.preco_por_mensagem_cents;
  const preco = await precoPorMensagemDaEmpresa(
    admin,
    orgId,
    v === null || v === undefined ? null : Number(v),
  );
  const emailAMao = (combinado.data as { preco_por_email_cents?: number | null } | null)
    ?.preco_por_email_cents;
  const precoPorEmail = doEmail
    ? await precoPorEmailDaEmpresa(
        admin,
        orgId,
        emailAMao === null || emailAMao === undefined ? null : Number(emailAMao),
      )
    : null;
  return {
    temCarteira: doBroadcast || doEmail,
    precoPorMensagemCents: preco.cents,
    precoPorEmailCents: precoPorEmail?.cents ?? null,
  };
}

/** O plano como a tela da EMPRESA o recebe: o teto em dólar sai, a estimativa de conversas entra. */
export function semDolar<T extends { teto_ia_usd_cents: number | null }>(
  plano: T,
): T & { conversas_estimadas: number | null } {
  return {
    ...plano,
    teto_ia_usd_cents: null,
    conversas_estimadas: conversasEstimadas(plano.teto_ia_usd_cents),
  };
}
