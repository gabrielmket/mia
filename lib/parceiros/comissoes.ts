/**
 * FORK MIA (.97) · A COMISSÃO DE CADA COBRANÇA PAGA (decisões 1, 4, 10 e 11;
 * docs/fork/cupons-e-parceiros.md, seção 5).
 *
 * A comissão NASCE quando a cobrança é PAGA, lida no Asaas (nunca pelo corpo do
 * aviso): a releitura das cobranças do cliente acha as pagas e lança uma linha
 * por cobrança e tipo (`mia_comissoes`, único por `pagamento_ref` + `tipo`).
 *
 *   - mensalidade: as cobranças da ASSINATURA (e o ajuste proporcional de uma
 *     troca de plano para cima, que é mensalidade), dentro do prazo do parceiro
 *     (6, 12 ou 24 meses contados da primeira mensalidade paga, ou enquanto
 *     pagar), e só as pagas a partir do dia em que o parceiro passou a ser deste
 *     cliente (`parceiro_desde`);
 *   - setup: a cobrança avulsa do setup de implantação, uma vez, com a comissão
 *     do setup do parceiro. Setup vendido sem parceiro não gera comissão;
 *   - créditos, Broadcast e e-mail avulso não são assinatura nem setup: não entram;
 *   - estorno ou chargeback de cobrança já comissionada vira lançamento NEGATIVO
 *     no mês em que foi visto, e desconta no repasse seguinte.
 *
 * A conta é sobre o LÍQUIDO: valor pago (já com o desconto), menos o imposto
 * (a alíquota do Simples de Admin › Cobrança, gravada no dia), menos a taxa real
 * do Asaas (valor menos o `netValue`). Sem a alíquota configurada, nada é
 * lançado (a tela avisa): lançar com imposto zero pagaria a mais.
 *
 * A comissão (o percentual e o prazo) fica FIXADA no primeiro pagamento do
 * cliente (mensalidade ou setup): mudar o parceiro depois vale só para os novos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DependenciasDoAsaasDaMia } from "@/lib/asaas-mia/api";
import { codigoDoErro } from "@/lib/asaas-mia/api";
import { pagamentosNoAsaas, type PagamentoDoCliente } from "@/lib/asaas-mia/pagamentos";
import { lerCupomDaEmpresa, type CupomDaEmpresa } from "@/lib/cupons/banco";
import { hojeEmSaoPaulo } from "@/lib/cupons/regras";
import { logger } from "@/lib/logger";

import { lerConfiguracaoDaComissao } from "./configuracao";
import { competenciaDe, contaDaComissao, mensalidadeNoPrazo } from "./regras";

export interface ResumoDasComissoes {
  lancadas: number;
  estornos: number;
  motivo?: "sem_parceiro" | "sem_aliquota" | "sem_cliente" | "parceiro_anonimizado" | "falhou";
}

/** A referência externa do ajuste proporcional do upstream: `upgrade:<org>:<chave>`. */
const ehAjusteProporcional = (p: PagamentoDoCliente, orgId: string) => p.referenciaExterna?.startsWith(`upgrade:${orgId}:`) === true;
export const referenciaDoSetup = (orgId: string) => `setup:${orgId}`;

/** É mensalidade (assinatura ou ajuste proporcional)? Puro. */
export function ehMensalidade(p: PagamentoDoCliente, orgId: string): boolean {
  return p.assinaturaRef !== null || ehAjusteProporcional(p, orgId);
}

interface ComissaoGravada {
  id: string;
  tipo: string;
  pagamento_ref: string;
  valor_pago_cents: number;
  imposto_cents: number;
  taxa_cents: number;
  liquido_cents: number;
  aliquota_pct: number;
  comissao_pct: number;
  comissao_cents: number;
}

/**
 * Os termos do parceiro fixados no primeiro pagamento: a comissão do cupom (ou
 * a do parceiro), o prazo e a do setup. Já fixados, ficam. Devolve os vigentes.
 */
async function termosDoCliente(
  admin: SupabaseClient,
  cupom: CupomDaEmpresa,
  primeiraMensalidade: string | null,
  agora: Date,
): Promise<{ pct: number; meses: number | null; setupPct: number; inicio: string | null } | null> {
  if (cupom.termos_fixados_em) {
    const inicio = cupom.primeira_mensalidade_em ?? primeiraMensalidade;
    if (!cupom.primeira_mensalidade_em && primeiraMensalidade) {
      await admin.from("mia_cupom_da_empresa").update({ primeira_mensalidade_em: primeiraMensalidade }).eq("organization_id", cupom.organization_id);
    }
    return { pct: cupom.comissao_pct ?? 0, meses: cupom.comissao_meses, setupPct: cupom.comissao_setup_pct ?? 0, inicio };
  }
  if (!cupom.parceiro_id) return null;
  const [{ data: parceiro }, { data: doCupom }] = await Promise.all([
    admin.from("mia_parceiros").select("comissao_pct, comissao_meses, comissao_setup_pct").eq("id", cupom.parceiro_id).maybeSingle(),
    admin.from("mia_cupons").select("comissao_pct").eq("id", cupom.cupom_id).maybeSingle(),
  ]);
  const p = parceiro as { comissao_pct: number; comissao_meses: number | null; comissao_setup_pct: number } | null;
  if (!p) return null;
  const propria = (doCupom as { comissao_pct: number | null } | null)?.comissao_pct;
  const termos = {
    pct: propria === null || propria === undefined ? Number(p.comissao_pct) : Number(propria),
    meses: p.comissao_meses === null ? null : Number(p.comissao_meses),
    setupPct: Number(p.comissao_setup_pct ?? 0),
    inicio: primeiraMensalidade,
  };
  await admin
    .from("mia_cupom_da_empresa")
    .update({
      comissao_pct: termos.pct,
      comissao_meses: termos.meses,
      comissao_setup_pct: termos.setupPct,
      termos_fixados_em: agora.toISOString(),
      primeira_mensalidade_em: primeiraMensalidade,
    })
    .eq("organization_id", cupom.organization_id)
    .is("termos_fixados_em", null);
  return termos;
}

/**
 * Lança as comissões e os estornos de um cliente a partir das cobranças dele no
 * Asaas (lidas aqui, ou passadas por quem já leu). Idempotente. Nunca lança.
 */
export async function lancarComissoesDoCliente(
  admin: SupabaseClient,
  orgId: string,
  o: { pagamentos?: readonly PagamentoDoCliente[]; deps?: DependenciasDoAsaasDaMia; agora?: Date } = {},
): Promise<ResumoDasComissoes> {
  const agora = o.agora ?? new Date();
  try {
    const cupom = await lerCupomDaEmpresa(admin, orgId);
    if (!cupom?.parceiro_id) return { lancadas: 0, estornos: 0, motivo: "sem_parceiro" };
    const { data: parceiroLido } = await admin.from("mia_parceiros").select("anonimizado_em").eq("id", cupom.parceiro_id).maybeSingle();
    if ((parceiroLido as { anonimizado_em: string | null } | null)?.anonimizado_em) {
      return { lancadas: 0, estornos: 0, motivo: "parceiro_anonimizado" };
    }
    const config = await lerConfiguracaoDaComissao(admin);
    if (config.aliquota_pct === null) return { lancadas: 0, estornos: 0, motivo: "sem_aliquota" };

    const [{ data: assinatura }, { data: setupLido }] = await Promise.all([
      admin.from("cobranca_assinaturas").select("provedor, provedor_cliente_id").eq("organization_id", orgId).maybeSingle(),
      admin.from("mia_setup_da_empresa").select("pagamento_ref, cliente_ref, situacao").eq("organization_id", orgId).maybeSingle(),
    ]);
    const a = assinatura as { provedor: string | null; provedor_cliente_id: string | null } | null;
    const setup = setupLido as { pagamento_ref: string | null; cliente_ref: string | null; situacao: string } | null;
    const clienteRef = (a?.provedor === "asaas" ? a.provedor_cliente_id : null) ?? setup?.cliente_ref ?? null;
    if (!clienteRef) return { lancadas: 0, estornos: 0, motivo: "sem_cliente" };

    const pagamentos = o.pagamentos ?? (await pagamentosNoAsaas(o.deps).listarDoCliente(clienteRef));
    const desde = hojeEmSaoPaulo(new Date(cupom.parceiro_desde || cupom.aplicado_em));
    const diaDoPagamento = (p: PagamentoDoCliente) => p.pagoEm ?? p.vencimento;
    const mensalidadesPagas = pagamentos.filter((p) => p.pago && ehMensalidade(p, orgId) && diaDoPagamento(p) >= desde);
    const setupPago = pagamentos.find(
      (p) => p.pago && (p.ref === setup?.pagamento_ref || p.referenciaExterna === referenciaDoSetup(orgId)) && diaDoPagamento(p) >= desde,
    );
    const primeira = mensalidadesPagas.filter((p) => p.assinaturaRef !== null).map((p) => p.vencimento).sort()[0] ?? null;

    const { data: jaLancadas, error: erroLidas } = await admin
      .from("mia_comissoes")
      .select("id, tipo, pagamento_ref, valor_pago_cents, imposto_cents, taxa_cents, liquido_cents, aliquota_pct, comissao_pct, comissao_cents")
      .eq("organization_id", orgId)
      .limit(5000);
    if (erroLidas) throw new Error(`comissões ilegíveis (${erroLidas.code ?? "sem_codigo"})`);
    const lancadas = (jaLancadas ?? []) as ComissaoGravada[];
    const tem = (ref: string, tipo: string) => lancadas.some((l) => l.pagamento_ref === ref && l.tipo === tipo);

    const novas: Array<Record<string, unknown>> = [];
    if (mensalidadesPagas.length > 0 || setupPago) {
      const termos = await termosDoCliente(admin, cupom, primeira, agora);
      if (termos) {
        for (const p of mensalidadesPagas) {
          if (tem(p.ref, "mensalidade") || p.liquidoCents === null) continue;
          if (!mensalidadeNoPrazo(p.vencimento, termos.inicio, termos.meses)) continue;
          const conta = contaDaComissao({ valorPagoCents: p.valorCents, liquidoDoAsaasCents: p.liquidoCents, aliquotaPct: config.aliquota_pct, comissaoPct: termos.pct });
          novas.push({ tipo: "mensalidade", pagamento_ref: p.ref, pago_em: diaDoPagamento(p), competencia: competenciaDe(diaDoPagamento(p)), ...conta });
        }
        if (setupPago && !tem(setupPago.ref, "setup") && setupPago.liquidoCents !== null && termos.setupPct > 0) {
          const conta = contaDaComissao({
            valorPagoCents: setupPago.valorCents,
            liquidoDoAsaasCents: setupPago.liquidoCents,
            aliquotaPct: config.aliquota_pct,
            comissaoPct: termos.setupPct,
          });
          novas.push({ tipo: "setup", pagamento_ref: setupPago.ref, pago_em: diaDoPagamento(setupPago), competencia: competenciaDe(diaDoPagamento(setupPago)), ...conta });
        }
      }
    }

    // Os estornos: cobrança já comissionada que o Asaas diz estornada ou contestada.
    const hoje = hojeEmSaoPaulo(agora);
    const porRef = new Map(pagamentos.map((p) => [p.ref, p]));
    for (const l of lancadas) {
      if (l.tipo === "estorno" || tem(l.pagamento_ref, "estorno")) continue;
      const atual = porRef.get(l.pagamento_ref);
      if (!atual?.estornado) continue;
      novas.push({
        tipo: "estorno",
        pagamento_ref: l.pagamento_ref,
        estorno_de: l.id,
        pago_em: hoje,
        competencia: competenciaDe(hoje),
        valor_pago_cents: -l.valor_pago_cents,
        aliquota_pct: l.aliquota_pct,
        imposto_cents: -l.imposto_cents,
        taxa_cents: -l.taxa_cents,
        liquido_cents: -l.liquido_cents,
        comissao_pct: l.comissao_pct,
        comissao_cents: -l.comissao_cents,
      });
    }

    let lancadasAgora = 0;
    let estornos = 0;
    for (const n of novas) {
      const { data, error } = await admin
        .from("mia_comissoes")
        .upsert({ ...n, parceiro_id: cupom.parceiro_id, organization_id: orgId }, { onConflict: "pagamento_ref,tipo", ignoreDuplicates: true })
        .select("id");
      if (error) {
        logger.warn("parceiros.comissao_nao_gravada", { organization_id: orgId, codigo: error.code ?? null });
        continue;
      }
      if ((data ?? []).length > 0) {
        if (n.tipo === "estorno") estornos += 1;
        else lancadasAgora += 1;
      }
    }
    await admin.from("mia_cupom_da_empresa").update({ comissoes_lidas_em: agora.toISOString() }).eq("organization_id", orgId);
    return { lancadas: lancadasAgora, estornos };
  } catch (e) {
    logger.warn("parceiros.comissoes_falharam", { organization_id: orgId, codigo: codigoDoErro(e) });
    return { lancadas: 0, estornos: 0, motivo: "falhou" };
  }
}
