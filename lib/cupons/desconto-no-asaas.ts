/**
 * FORK MIA (.98) · O DESCONTO DO CUPOM NO ASAAS (docs/fork/cupons-e-parceiros.md, seção 3).
 *
 * A cobrança e a nota já saem com o valor com desconto. O Asaas não tem desconto
 * por número de ciclos: o `discount` da assinatura é desconto por pagamento
 * ANTECIPADO e vale em toda cobrança dela; não há campo "nas N primeiras". Por
 * isso o fork conta as mensalidades e acerta cada valor:
 *
 *   - cada cobrança EM ABERTO da assinatura recebe o valor da ordem dela: a
 *     mensalidade de ordem `n` (as já pagas do cliente, mais a posição entre as
 *     abertas) leva o desconto se `n <= meses` (ou sempre, com "todas");
 *   - a ASSINATURA recebe o valor da PRÓXIMA ordem (as próximas cobranças que o
 *     Asaas gerar já nascem certas), com `updatePendingPayments: false`: as já
 *     geradas são acertadas uma a uma, acima;
 *   - a nota AGENDADA de uma cobrança que mudou de valor é acertada junto;
 *   - a cobrança PAGA nunca muda;
 *   - plano que o cupom não cobre (o cliente trocou para outro) volta ao preço
 *     cheio; voltando a um plano coberto, o desconto volta, na ordem que faltar;
 *   - depois da N-ésima mensalidade paga, com tudo no preço cheio, o desconto
 *     ENCERRA (`desconto_encerrado_em`) e esta conferência para de rodar.
 *
 * Quem chama: o gancho do checkout do upstream (assinatura recém-criada), o
 * aviso do Asaas (a troca de plano do upstream põe o preço cheio de volta e o
 * aviso de assinatura alterada acerta de novo), a rodada horária e o passo do
 * pagamento. Nunca lança: devolve o que fez.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DependenciasDoAsaasDaMia } from "@/lib/asaas-mia/api";
import { codigoDoErro } from "@/lib/asaas-mia/api";
import { pagamentosNoAsaas, type PagamentoDoCliente } from "@/lib/asaas-mia/pagamentos";
import { logger } from "@/lib/logger";

import { lerCupomDaEmpresa, type CupomDaEmpresa } from "./banco";
import { hojeEmSaoPaulo, valorDaMensalidade } from "./regras";

export type AcaoDoDesconto = "nada" | "sem_cupom" | "sem_assinatura" | "conferido" | "acertado" | "encerrado" | "falhou";

export interface ResultadoDoDesconto {
  acao: AcaoDoDesconto;
  cobrancasAcertadas: number;
  assinaturaAcertada: boolean;
}

/** As mensalidades do cliente (cobranças de assinatura). Puro. */
export function mensalidadesDoCliente(pagamentos: readonly PagamentoDoCliente[]): PagamentoDoCliente[] {
  return pagamentos.filter((p) => p.assinaturaRef !== null);
}

/**
 * O plano de acerto, PURO: o valor que cada cobrança em aberto da assinatura e
 * a própria assinatura devem ter. `coberto`: o plano atual está entre os do cupom.
 */
export function planoDoDesconto(p: {
  cupom: Pick<CupomDaEmpresa, "beneficio" | "valor" | "meses">;
  precoCents: number;
  coberto: boolean;
  assinaturaRef: string;
  pagamentos: readonly PagamentoDoCliente[];
  /** AAAA-MM-DD: só as mensalidades pagas a partir do dia em que o cupom entrou contam na ordem. */
  desde?: string | null;
}): { cobrancas: Array<{ ref: string; de: number; para: number }>; assinatura: number; pagas: number; tudoCheio: boolean } {
  const mensalidades = mensalidadesDoCliente(p.pagamentos);
  const pagas = mensalidades.filter((m) => m.pago && (!p.desde || (m.pagoEm ?? m.vencimento) >= p.desde)).length;
  const abertas = mensalidades.filter((m) => m.assinaturaRef === p.assinaturaRef && m.aberto).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const valor = (ordem: number) => (p.coberto ? valorDaMensalidade(p.precoCents, p.cupom, ordem) : p.precoCents);
  const cobrancas = abertas.map((c, i) => ({ ref: c.ref, de: c.valorCents, para: valor(pagas + i + 1) }));
  const assinatura = valor(pagas + abertas.length + 1);
  const tudoCheio = cobrancas.every((c) => c.para === p.precoCents) && assinatura === p.precoCents;
  return { cobrancas, assinatura, pagas, tudoCheio };
}

export async function garantirDescontoNoAsaas(
  admin: SupabaseClient,
  orgId: string,
  o: {
    pagamentos?: readonly PagamentoDoCliente[];
    /** A assinatura recém-criada (o gancho do checkout chega antes de ela ser gravada na linha). */
    assinaturaRef?: string;
    clienteRef?: string;
    deps?: DependenciasDoAsaasDaMia;
    agora?: Date;
  } = {},
): Promise<ResultadoDoDesconto> {
  const vazio = (acao: AcaoDoDesconto): ResultadoDoDesconto => ({ acao, cobrancasAcertadas: 0, assinaturaAcertada: false });
  try {
    const cupom = await lerCupomDaEmpresa(admin, orgId);
    if (!cupom || cupom.beneficio === "dias") return vazio("sem_cupom");
    if (cupom.desconto_encerrado_em) return vazio("nada");
    const { data: lida } = await admin
      .from("cobranca_assinaturas")
      .select("plano_id, provedor, provedor_cliente_id, provedor_assinatura_id")
      .eq("organization_id", orgId)
      .maybeSingle();
    const a = lida as { plano_id: string; provedor: string | null; provedor_cliente_id: string | null; provedor_assinatura_id: string | null } | null;
    if (!a) return vazio("sem_assinatura");
    const clienteRef = o.clienteRef ?? a.provedor_cliente_id;
    const assinaturaRef = o.assinaturaRef ?? a.provedor_assinatura_id;
    if ((o.clienteRef === undefined && a.provedor !== "asaas") || !clienteRef || !assinaturaRef) return vazio("sem_assinatura");
    const { data: plano } = await admin.from("cobranca_planos").select("preco_cents").eq("id", a.plano_id).maybeSingle();
    const precoCents = Number((plano as { preco_cents?: number } | null)?.preco_cents ?? 0);
    if (!(precoCents > 0)) return vazio("sem_assinatura");

    const asaas = pagamentosNoAsaas(o.deps);
    const pagamentos = o.pagamentos ?? (await asaas.listarDoCliente(clienteRef));
    const desde = cupom.aplicado_em ? hojeEmSaoPaulo(new Date(cupom.aplicado_em)) : null;
    const plano2 = planoDoDesconto({ cupom, precoCents, coberto: cupom.planos.includes(a.plano_id), assinaturaRef, pagamentos, desde });
    let acertadas = 0;
    for (const c of plano2.cobrancas) {
      if (c.de === c.para) continue;
      await asaas.mudarValor(c.ref, c.para);
      acertadas += 1;
    }
    let assinaturaAcertada = false;
    const atual = await asaas.valorDaAssinatura(assinaturaRef);
    if (atual !== plano2.assinatura) {
      await asaas.mudarValorDaAssinatura(assinaturaRef, plano2.assinatura);
      assinaturaAcertada = true;
    }
    const agora = (o.agora ?? new Date()).toISOString();
    const encerra = cupom.meses !== null && plano2.pagas >= cupom.meses && plano2.tudoCheio;
    await admin
      .from("mia_cupom_da_empresa")
      .update({ desconto_conferido_em: agora, ...(encerra ? { desconto_encerrado_em: agora } : {}) })
      .eq("organization_id", orgId)
      .eq("cupom_id", cupom.cupom_id);
    if (encerra) return { acao: "encerrado", cobrancasAcertadas: acertadas, assinaturaAcertada };
    return { acao: acertadas > 0 || assinaturaAcertada ? "acertado" : "conferido", cobrancasAcertadas: acertadas, assinaturaAcertada };
  } catch (e) {
    logger.warn("cupons.desconto_no_asaas_falhou", { organization_id: orgId, codigo: codigoDoErro(e) });
    return vazio("falhou");
  }
}

/**
 * O preço que o Asaas tem é o do cupom? A conferência de preço do upstream
 * (`conferirPreco`, #2609) audita "preço divergente" quando a assinatura não tem
 * o preço do plano; com o cupom valendo, a diferença é o combinado, não drift.
 * Nunca lança (na dúvida, `false`: o upstream audita como sempre).
 */
export async function precoDoProvedorEhODoCupom(
  admin: SupabaseClient,
  orgId: string,
  planoId: string,
  precoDoProvedorCents: number,
): Promise<boolean> {
  try {
    const cupom = await lerCupomDaEmpresa(admin, orgId);
    if (!cupom || cupom.beneficio === "dias" || cupom.desconto_encerrado_em || !cupom.planos.includes(planoId)) return false;
    const { data } = await admin.from("cobranca_planos").select("preco_cents").eq("id", planoId).maybeSingle();
    const preco = Number((data as { preco_cents?: number } | null)?.preco_cents ?? 0);
    if (!(preco > 0)) return false;
    return valorDaMensalidade(preco, cupom, 1) === precoDoProvedorCents || valorDaMensalidade(preco, cupom, Number.MAX_SAFE_INTEGER) === precoDoProvedorCents;
  } catch {
    return false;
  }
}
