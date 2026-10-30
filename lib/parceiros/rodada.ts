/**
 * FORK MIA (.98) · O CUPOM, O SETUP E A COMISSÃO NA RODADA DA COBRANÇA
 * (docs/fork/cupons-e-parceiros.md, seção 7).
 *
 * Roda na rodada da jornada (`lib/planos-mia/rodada.ts`), no cron de hora em
 * hora da cobrança, e só com a cobrança LIGADA. E pelo aviso do Asaas
 * (`depoisDoAvisoDoAsaas`, em `lib/cobranca/sinal.handler.ts`), para a empresa
 * daquele aviso. As cobranças do cliente são lidas UMA vez e servem aos três:
 *   1. o desconto do cupom (o valor de cada cobrança em aberto e o da assinatura);
 *   2. o setup (pagou, estornou, a nota na confirmação);
 *   3. a comissão de cada cobrança paga e os estornos.
 * Depois, com o dia do fechamento chegado, fecha o mês anterior e manda os
 * extratos. Nada lança: a rodada do upstream já respondeu.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DependenciasDoAsaasDaMia } from "@/lib/asaas-mia/api";
import { codigoDoErro } from "@/lib/asaas-mia/api";
import { pagamentosNoAsaas } from "@/lib/asaas-mia/pagamentos";
import { audit } from "@/lib/audit";
import { garantirDescontoNoAsaas } from "@/lib/cupons/desconto-no-asaas";
import type { sendEmail } from "@/lib/email/roteador";
import { logger } from "@/lib/logger";
import { conferirSetup } from "@/lib/setup-de-implantacao/servico";

import { lancarComissoesDoCliente } from "./comissoes";
import { lerConfiguracaoDaComissao } from "./configuracao";
import { mandarExtratos } from "./extrato";
import { competenciaParaFechar, fecharMes } from "./repasses";

/** Por rodada: o suficiente para a instalação e sem encostar no teto do Asaas. */
const EMPRESAS_POR_RODADA = 100;

export interface ResumoDosParceiros {
  empresas_lidas: number;
  cobrancas_acertadas: number;
  comissoes: number;
  estornos: number;
  setups_pagos: number;
  repasses_fechados: number;
  extratos: number;
}

/** A empresa tem algo que dependa das cobranças dela? Barato, só banco. */
async function temOQueConferir(admin: SupabaseClient, orgId: string): Promise<boolean> {
  const [{ data: uso }, { data: setup }] = await Promise.all([
    admin.from("mia_cupom_da_empresa").select("organization_id").eq("organization_id", orgId).maybeSingle(),
    admin.from("mia_setup_da_empresa").select("organization_id").eq("organization_id", orgId).maybeSingle(),
  ]);
  return Boolean(uso || setup);
}

/**
 * As cobranças de UMA empresa: lê no Asaas uma vez e passa aos três. Sem cliente
 * no Asaas, nada a ler. Nunca lança.
 */
export async function conferirClienteNoAsaas(
  admin: SupabaseClient,
  orgId: string,
  o: { deps?: DependenciasDoAsaasDaMia; agora?: Date } = {},
): Promise<{ cobrancas: number; comissoes: number; estornos: number; setupPago: boolean }> {
  const vazio = { cobrancas: 0, comissoes: 0, estornos: 0, setupPago: false };
  try {
    const [{ data: assinatura }, { data: setup }] = await Promise.all([
      admin.from("cobranca_assinaturas").select("provedor, provedor_cliente_id").eq("organization_id", orgId).maybeSingle(),
      admin.from("mia_setup_da_empresa").select("cliente_ref").eq("organization_id", orgId).maybeSingle(),
    ]);
    const a = assinatura as { provedor: string | null; provedor_cliente_id: string | null } | null;
    const clienteRef = (a?.provedor === "asaas" ? a.provedor_cliente_id : null) ?? (setup as { cliente_ref: string | null } | null)?.cliente_ref ?? null;
    if (!clienteRef) return vazio;
    const pagamentos = await pagamentosNoAsaas(o.deps).listarDoCliente(clienteRef);
    const desconto = await garantirDescontoNoAsaas(admin, orgId, { pagamentos, deps: o.deps, agora: o.agora });
    const situacaoDoSetup = await conferirSetup(admin, orgId, { pagamentos, deps: o.deps, agora: o.agora });
    const comissoes = await lancarComissoesDoCliente(admin, orgId, { pagamentos, deps: o.deps, agora: o.agora });
    // A fila da rodada anda também para quem não tem parceiro (só o desconto).
    await admin.from("mia_cupom_da_empresa").update({ comissoes_lidas_em: (o.agora ?? new Date()).toISOString() }).eq("organization_id", orgId);
    return { cobrancas: desconto.cobrancasAcertadas, comissoes: comissoes.lancadas, estornos: comissoes.estornos, setupPago: situacaoDoSetup === "pago" };
  } catch (e) {
    logger.warn("parceiros.conferencia_do_cliente_falhou", { organization_id: orgId, codigo: codigoDoErro(e) });
    return vazio;
  }
}

/** O gancho do aviso do Asaas: só a empresa do aviso, e só se ela tem cupom ou setup. Nunca lança. */
export async function depoisDoAvisoDoAsaas(admin: SupabaseClient, orgId: string, o: { deps?: DependenciasDoAsaasDaMia; agora?: Date } = {}): Promise<void> {
  try {
    if (await temOQueConferir(admin, orgId)) await conferirClienteNoAsaas(admin, orgId, o);
  } catch (e) {
    logger.warn("parceiros.depois_do_aviso_falhou", { organization_id: orgId, codigo: codigoDoErro(e) });
  }
}

/** A rodada de hora em hora. Nunca lança. */
export async function rodadaDosParceiros(
  admin: SupabaseClient,
  agora: Date = new Date(),
  deps: { asaas?: DependenciasDoAsaasDaMia; enviar?: typeof sendEmail } = {},
): Promise<ResumoDosParceiros> {
  const resumo: ResumoDosParceiros = { empresas_lidas: 0, cobrancas_acertadas: 0, comissoes: 0, estornos: 0, setups_pagos: 0, repasses_fechados: 0, extratos: 0 };
  try {
    // Quem precisa de leitura: cliente de parceiro, desconto ainda valendo, ou setup em aberto.
    const [{ data: usos }, { data: setups }] = await Promise.all([
      admin
        .from("mia_cupom_da_empresa")
        .select("organization_id, parceiro_id, beneficio, desconto_encerrado_em, comissoes_lidas_em")
        .order("comissoes_lidas_em", { ascending: true, nullsFirst: true })
        .limit(2000),
      admin.from("mia_setup_da_empresa").select("organization_id, situacao, nota_ref, nota_tentativas").in("situacao", ["aguardando", "pago"]).limit(2000),
    ]);
    const ids = new Set<string>();
    for (const u of (usos ?? []) as Array<{ organization_id: string; parceiro_id: string | null; beneficio: string; desconto_encerrado_em: string | null }>) {
      if (u.parceiro_id || (u.beneficio !== "dias" && !u.desconto_encerrado_em)) ids.add(u.organization_id);
    }
    for (const s of (setups ?? []) as Array<{ organization_id: string; situacao: string; nota_ref: string | null; nota_tentativas: number }>) {
      if (s.situacao === "aguardando" || (!s.nota_ref && s.nota_tentativas < 5)) ids.add(s.organization_id);
    }
    for (const orgId of [...ids].slice(0, EMPRESAS_POR_RODADA)) {
      const r = await conferirClienteNoAsaas(admin, orgId, { deps: deps.asaas, agora });
      resumo.empresas_lidas += 1;
      resumo.cobrancas_acertadas += r.cobrancas;
      resumo.comissoes += r.comissoes;
      resumo.estornos += r.estornos;
      if (r.setupPago) resumo.setups_pagos += 1;
    }

    // O calendário: chegou o dia, fecha o mês anterior (idempotente) e manda o que falta.
    const config = await lerConfiguracaoDaComissao(admin);
    const competencia = competenciaParaFechar(agora, config);
    if (competencia) {
      const fechados = await fecharMes(admin, competencia);
      resumo.repasses_fechados = fechados.length;
      if (fechados.length > 0) {
        void audit({
          action: "repasse.mes_fechado",
          actorUserId: null,
          bypassedRls: true,
          resourceType: "mia_repasses",
          metadata: { competencia, repasses: fechados.length, total_cents: fechados.reduce((s, r) => s + r.total_cents, 0) },
        });
      }
      const extratos = await mandarExtratos(admin, competencia, deps.enviar ? { enviar: deps.enviar } : {});
      resumo.extratos = extratos.enviados;
    }
    const efeito = resumo.cobrancas_acertadas + resumo.comissoes + resumo.estornos + resumo.setups_pagos;
    if (efeito > 0) {
      void audit({ action: "parceiros.rodada", actorUserId: null, bypassedRls: true, resourceType: "mia_comissoes", metadata: { ...resumo } });
    }
  } catch (e) {
    logger.warn("parceiros.rodada_falhou", { detalhe: e instanceof Error ? e.message : "desconhecido" });
  }
  return resumo;
}
