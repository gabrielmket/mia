/**
 * FORK MIA (.97) · AS COBRANÇAS DO CLIENTE PARA O CUPOM, A COMISSÃO E O SETUP
 * (docs/fork/cupons-e-parceiros.md).
 *
 * Ao lado de `./cobrancas.ts` (.96), com as mesmas regras de `./api.ts`: a chave
 * só no cabeçalho, toda falha como `ErroDoProvedor` com o `code` do Asaas, Zod
 * lendo só o que se usa. O que este arquivo acrescenta:
 *   - a lista das cobranças de um cliente com o LÍQUIDO de cada uma (`netValue`,
 *     o que caiu na conta depois da taxa do Asaas: é a base da comissão), a
 *     assinatura e a `externalReference`;
 *   - mudar o valor de uma cobrança em aberto e o da assinatura (o desconto do
 *     cupom por N mensalidades; o Asaas não tem desconto por ciclo);
 *   - acertar o valor da nota AGENDADA de uma cobrança cujo valor mudou;
 *   - a cobrança avulsa do setup e a nota do serviço do setup.
 */
import { z } from "zod";

import { ErroDoProvedor } from "@/lib/cobranca/provedores/contrato";

import { apiDoAsaas, type DependenciasDoAsaasDaMia } from "./api";
import { STATUS_ESTORNADOS, STATUS_PAGOS, type ConfiguracaoDaNota } from "./cobrancas";

export interface PagamentoDoCliente {
  ref: string;
  status: string;
  valorCents: number;
  /** O que caiu na conta (depois da taxa do Asaas). `null` = o Asaas ainda não disse. */
  liquidoCents: number | null;
  /** AAAA-MM-DD. */
  vencimento: string;
  /** AAAA-MM-DD do pagamento (o do cliente, senão o da confirmação). */
  pagoEm: string | null;
  assinaturaRef: string | null;
  referenciaExterna: string | null;
  forma: string | null;
  faturaUrl: string | null;
  pago: boolean;
  estornado: boolean;
  aberto: boolean;
}

const pagamentoDoAsaas = z.object({
  id: z.string().min(1),
  status: z.string(),
  value: z.number().nullish(),
  netValue: z.number().nullish(),
  dueDate: z.string(),
  paymentDate: z.string().nullish(),
  clientPaymentDate: z.string().nullish(),
  confirmedDate: z.string().nullish(),
  billingType: z.string().nullish(),
  subscription: z.string().nullish(),
  externalReference: z.string().nullish(),
  invoiceUrl: z.string().nullish(),
  deleted: z.boolean().nullish(),
});
type PagamentoDoAsaas = z.infer<typeof pagamentoDoAsaas>;
const listaDe = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item), hasMore: z.boolean().nullish() });
const DATA = /^\d{4}-\d{2}-\d{2}/;
const cents = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 100));

function paraPagamento(c: PagamentoDoAsaas, link: (u: string | null | undefined) => string | null): PagamentoDoCliente {
  const pagoEm = c.clientPaymentDate ?? c.paymentDate ?? c.confirmedDate ?? null;
  return {
    ref: c.id,
    status: c.status,
    valorCents: cents(c.value) ?? 0,
    liquidoCents: cents(c.netValue),
    vencimento: c.dueDate.slice(0, 10),
    pagoEm: pagoEm && DATA.test(pagoEm) ? pagoEm.slice(0, 10) : null,
    assinaturaRef: c.subscription ?? null,
    referenciaExterna: c.externalReference ?? null,
    forma: c.billingType ?? null,
    faturaUrl: link(c.invoiceUrl),
    pago: c.deleted !== true && STATUS_PAGOS.has(c.status),
    estornado: STATUS_ESTORNADOS.has(c.status),
    aberto: c.deleted !== true && (c.status === "PENDING" || c.status === "OVERDUE"),
  };
}

const notaAgendada = z.object({ id: z.string().min(1), status: z.string(), value: z.number().nullish() });

export function pagamentosNoAsaas(deps: DependenciasDoAsaasDaMia = {}) {
  const api = apiDoAsaas(deps);
  const ref = (s: string) => encodeURIComponent(s);

  /**
   * As cobranças do cliente (até 300, da mais velha para a mais nova pelo
   * vencimento). As apagadas o Asaas não lista.
   */
  async function listarDoCliente(clienteRef: string): Promise<PagamentoDoCliente[]> {
    const todas: PagamentoDoCliente[] = [];
    for (let offset = 0; offset < 300; offset += 100) {
      const consulta = new URLSearchParams({ customer: clienteRef, limit: "100", offset: String(offset) });
      const pagina = api.ler(listaDe(pagamentoDoAsaas), await api.chamar("GET", `/payments?${consulta}`));
      todas.push(...pagina.data.map((c) => paraPagamento(c, api.linkSeguro)));
      if (pagina.hasMore !== true) break;
    }
    return todas.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  }

  async function lerPagamento(pagamentoRef: string): Promise<PagamentoDoCliente> {
    return paraPagamento(api.ler(pagamentoDoAsaas, await api.chamar("GET", `/payments/${ref(pagamentoRef)}`)), api.linkSeguro);
  }

  /** O valor por ciclo da assinatura, em centavos (`null` = o Asaas não disse). */
  async function valorDaAssinatura(assinaturaRef: string): Promise<number | null> {
    const lida = api.ler(z.object({ id: z.string(), value: z.number().nullish() }), await api.chamar("GET", `/subscriptions/${ref(assinaturaRef)}`));
    return cents(lida.value);
  }

  /**
   * O valor das PRÓXIMAS cobranças da assinatura. As já geradas não mudam
   * (`updatePendingPayments: false`): cada uma é acertada por `mudarValor`.
   */
  async function mudarValorDaAssinatura(assinaturaRef: string, valorCents: number): Promise<void> {
    await api.chamar("PUT", `/subscriptions/${ref(assinaturaRef)}`, { value: valorCents / 100, updatePendingPayments: false });
  }

  /**
   * O valor de UMA cobrança em aberto e, se ela já tem nota AGENDADA (a da
   * confirmação do pagamento), o valor da nota também: a cobrança e a nota saem
   * com o mesmo número.
   */
  async function mudarValor(pagamentoRef: string, valorCents: number): Promise<void> {
    await api.chamar("PUT", `/payments/${ref(pagamentoRef)}`, { value: valorCents / 100 });
    const consulta = new URLSearchParams({ payment: pagamentoRef, limit: "10" });
    const notas = api.ler(listaDe(notaAgendada), await api.chamar("GET", `/invoices?${consulta}`)).data;
    for (const n of notas) {
      if (n.status === "SCHEDULED" && cents(n.value) !== valorCents) {
        await api.chamar("PUT", `/invoices/${ref(n.id)}`, { value: valorCents / 100 });
      }
    }
  }

  /**
   * A cobrança AVULSA do setup (venda única), na fatura do Asaas que aceita Pix,
   * boleto e cartão. A releitura antes de criar (pela `externalReference`) cura
   * o clique repetido e a resposta perdida: o Asaas não tem chave de idempotência.
   */
  async function garantirCobrancaAvulsa(p: {
    clienteRef: string;
    valorCents: number;
    vencimento: string;
    descricao: string;
    referenciaExterna: string;
  }): Promise<PagamentoDoCliente> {
    if (p.valorCents < 500) throw new ErroDoProvedor(null, "valor_abaixo_do_minimo", false);
    const consulta = new URLSearchParams({ customer: p.clienteRef, externalReference: p.referenciaExterna, limit: "10" });
    const existentes = api.ler(listaDe(pagamentoDoAsaas), await api.chamar("GET", `/payments?${consulta}`)).data.map((c) =>
      paraPagamento(c, api.linkSeguro),
    );
    const viva = existentes.find((c) => c.aberto || c.pago || c.status === "AWAITING_RISK_ANALYSIS");
    if (viva) return viva;
    const criada = api.ler(
      pagamentoDoAsaas,
      await api.chamar("POST", "/payments", {
        customer: p.clienteRef,
        billingType: "UNDEFINED",
        value: p.valorCents / 100,
        dueDate: p.vencimento,
        description: p.descricao,
        externalReference: p.referenciaExterna,
      }),
    );
    return paraPagamento(criada, api.linkSeguro);
  }

  /**
   * A nota do SETUP, pedida quando o pagamento confirma: o serviço e os impostos
   * do setup (separados dos da mensalidade, na configuração da Conexão). Já
   * existe uma nota para a cobrança: devolve a dela.
   */
  async function pedirNotaDoSetup(pagamentoRef: string, valorCents: number, config: ConfiguracaoDaNota, hoje: string): Promise<string> {
    const consulta = new URLSearchParams({ payment: pagamentoRef, limit: "10" });
    const ja = api.ler(listaDe(notaAgendada), await api.chamar("GET", `/invoices?${consulta}`)).data.find((n) => n.status !== "CANCELED");
    if (ja) return ja.id;
    const corpo: Record<string, unknown> = {
      payment: pagamentoRef,
      serviceDescription: config.servicoMunicipalNome ?? "Setup de implementação",
      observations: config.observacoes ?? "Setup de implementação",
      value: valorCents / 100,
      deductions: 0,
      effectiveDate: hoje,
      ...(config.servicoMunicipalId ? { municipalServiceId: config.servicoMunicipalId } : {}),
      ...(config.servicoMunicipalCodigo ? { municipalServiceCode: config.servicoMunicipalCodigo } : {}),
      ...(config.servicoMunicipalNome ? { municipalServiceName: config.servicoMunicipalNome } : {}),
      taxes: {
        retainIss: config.impostos.reterIss,
        iss: config.impostos.iss,
        pis: config.impostos.pis,
        cofins: config.impostos.cofins,
        csll: config.impostos.csll,
        inss: config.impostos.inss,
        ir: config.impostos.ir,
      },
    };
    return api.ler(z.object({ id: z.string().min(1) }), await api.chamar("POST", "/invoices", corpo)).id;
  }

  return { api, listarDoCliente, lerPagamento, valorDaAssinatura, mudarValorDaAssinatura, mudarValor, garantirCobrancaAvulsa, pedirNotaDoSetup };
}

export type PagamentosNoAsaas = ReturnType<typeof pagamentosNoAsaas>;
