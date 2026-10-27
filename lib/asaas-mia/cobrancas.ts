/**
 * FORK MIA (.96) · AS COBRANÇAS NO ASAAS: ler, listar, cancelar, o Pix, o
 * boleto, a nota fiscal e o recibo. Usado pelo passo "Pagamento" do início
 * (`lib/pagamento-inicial/`) e pela área de cobrança (Configurações › Plano e
 * cobrança).
 *
 * Quem DECIDE que a empresa pagou continua sendo a releitura do upstream
 * (`lib/cobranca/sincronizar.ts`): daqui sai a leitura de UMA cobrança, para a
 * tela saber o que mostrar, e nunca uma escrita em `cobranca_assinaturas`.
 *
 * O cliente do Asaas recebe os dados fiscais (`garantirClienteFiscal`) com
 * `notificationDisabled: true`, como o upstream já faz: os avisos de cobrança
 * são todos da MIA (decisão 8), os do Asaas ficam desligados.
 */
import { z } from "zod";

import type { DadosFiscais } from "@/lib/dados-fiscais/regras";
import { ErroDoProvedor } from "@/lib/cobranca/provedores/contrato";

import { apiDoAsaas, type ApiDoAsaas, type DependenciasDoAsaasDaMia } from "./api";

/** Pago: o mesmo conjunto do adaptador do upstream. CONFIRMED = cartão aprovado. */
export const STATUS_PAGOS = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"]);
export const STATUS_ABERTOS = new Set(["PENDING", "OVERDUE"]);
export const STATUS_ESTORNADOS = new Set([
  "REFUNDED", "REFUND_REQUESTED", "REFUND_IN_PROGRESS", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE", "AWAITING_CHARGEBACK_REVERSAL",
]);

export type SituacaoDaCobranca = "aberta" | "vencida" | "em_analise" | "paga" | "estornada" | "cancelada" | "outra";
export type FormaDaCobranca = "pix" | "boleto" | "cartao" | "a_escolher" | "outra";

export interface CobrancaLida {
  ref: string;
  /** O status cru do Asaas, para diagnóstico. */
  status: string;
  situacao: SituacaoDaCobranca;
  valorCents: number;
  /** AAAA-MM-DD. */
  vencimento: string;
  /** AAAA-MM-DD do pagamento, quando pago. */
  pagaEm: string | null;
  forma: FormaDaCobranca;
  assinaturaRef: string | null;
  descricao: string | null;
  /** A fatura do Asaas (Pix, boleto e cartão na página dele). */
  faturaUrl: string | null;
  /** O PDF do boleto (a segunda via). */
  boletoUrl: string | null;
  /** O comprovante do pagamento (o recibo). Só depois de paga. */
  reciboUrl: string | null;
  cartaoFinal: string | null;
  cartaoBandeira: string | null;
  criadaEm: string | null;
}

const cobrancaDoAsaas = z.object({
  id: z.string().min(1),
  status: z.string(),
  value: z.number().nullish(),
  dueDate: z.string(),
  paymentDate: z.string().nullish(),
  clientPaymentDate: z.string().nullish(),
  confirmedDate: z.string().nullish(),
  billingType: z.string().nullish(),
  subscription: z.string().nullish(),
  description: z.string().nullish(),
  invoiceUrl: z.string().nullish(),
  bankSlipUrl: z.string().nullish(),
  transactionReceiptUrl: z.string().nullish(),
  deleted: z.boolean().nullish(),
  dateCreated: z.string().nullish(),
  creditCard: z
    .object({ creditCardNumber: z.string().nullish(), creditCardBrand: z.string().nullish() })
    .nullish(),
});
type CobrancaDoAsaas = z.infer<typeof cobrancaDoAsaas>;
const lista = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item), hasMore: z.boolean().nullish() });

const FORMA: Record<string, FormaDaCobranca> = {
  PIX: "pix",
  BOLETO: "boleto",
  CREDIT_CARD: "cartao",
  DEBIT_CARD: "cartao",
  UNDEFINED: "a_escolher",
};

function situacaoDe(c: CobrancaDoAsaas): SituacaoDaCobranca {
  if (c.deleted === true) return "cancelada";
  if (STATUS_PAGOS.has(c.status)) return "paga";
  if (c.status === "PENDING") return "aberta";
  if (c.status === "OVERDUE") return "vencida";
  if (c.status === "AWAITING_RISK_ANALYSIS") return "em_analise";
  if (STATUS_ESTORNADOS.has(c.status)) return "estornada";
  return "outra";
}

/** Só os 4 últimos números, e só se forem 4 dígitos: o resto do que o Asaas mandar não fica. */
export function finalDoCartao(bruto: string | null | undefined): string | null {
  const d = (bruto ?? "").replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : null;
}

/** A bandeira em maiúsculas (VISA, MASTERCARD, ELO...), ou `null`. */
export function bandeiraDoCartao(bruto: string | null | undefined): string | null {
  const b = (bruto ?? "").trim().toUpperCase();
  return /^[A-Z_]{2,30}$/.test(b) ? b : null;
}

function paraLida(api: ApiDoAsaas, c: CobrancaDoAsaas): CobrancaLida {
  const pagaEm = c.clientPaymentDate ?? c.paymentDate ?? c.confirmedDate ?? null;
  return {
    ref: c.id,
    status: c.status,
    situacao: situacaoDe(c),
    valorCents: Math.round((c.value ?? 0) * 100),
    vencimento: c.dueDate,
    pagaEm: pagaEm && /^\d{4}-\d{2}-\d{2}/.test(pagaEm) ? pagaEm.slice(0, 10) : null,
    forma: FORMA[c.billingType ?? ""] ?? "outra",
    assinaturaRef: c.subscription ?? null,
    descricao: c.description ?? null,
    faturaUrl: api.linkSeguro(c.invoiceUrl),
    boletoUrl: api.linkSeguro(c.bankSlipUrl),
    reciboUrl: api.linkSeguro(c.transactionReceiptUrl),
    cartaoFinal: finalDoCartao(c.creditCard?.creditCardNumber),
    cartaoBandeira: bandeiraDoCartao(c.creditCard?.creditCardBrand),
    criadaEm: c.dateCreated ?? null,
  };
}

export interface NotaLida {
  ref: string;
  /** SCHEDULED, AUTHORIZED, PROCESSING_CANCELLATION, CANCELED, CANCELLATION_DENIED, ERROR, SYNCHRONIZED. */
  status: string;
  situacao: "agendada" | "emitida" | "cancelada" | "com_erro" | "em_andamento";
  numero: string | null;
  pdfUrl: string | null;
  xmlUrl: string | null;
  pagamentoRef: string | null;
  valorCents: number;
  /** AAAA-MM-DD. */
  emitidaEm: string | null;
}

const notaDoAsaas = z.object({
  id: z.string().min(1),
  status: z.string(),
  number: z.union([z.string(), z.number()]).nullish(),
  pdfUrl: z.string().nullish(),
  xmlUrl: z.string().nullish(),
  payment: z.string().nullish(),
  value: z.number().nullish(),
  effectiveDate: z.string().nullish(),
});

function situacaoDaNota(status: string): NotaLida["situacao"] {
  if (status === "AUTHORIZED" || status === "SYNCHRONIZED") return "emitida";
  if (status === "CANCELED") return "cancelada";
  if (status === "ERROR" || status === "CANCELLATION_DENIED") return "com_erro";
  if (status === "SCHEDULED") return "agendada";
  return "em_andamento";
}

export interface ImpostosDaNota {
  reterIss: boolean;
  iss: number;
  pis: number;
  cofins: number;
  csll: number;
  inss: number;
  ir: number;
}

/** A configuração da nota de serviço da Time (Admin › Cobrança › Conexão). */
export interface ConfiguracaoDaNota {
  servicoMunicipalId: string | null;
  servicoMunicipalCodigo: string | null;
  servicoMunicipalNome: string | null;
  observacoes: string | null;
  impostos: ImpostosDaNota;
}

/** O telefone para o Asaas: o número nacional, sem o 55. */
export function telefoneNacional(telefone: string | null): string | null {
  if (!telefone) return null;
  return telefone.startsWith("55") && (telefone.length === 12 || telefone.length === 13) ? telefone.slice(2) : telefone;
}

/** O corpo do cliente no Asaas a partir dos dados fiscais (o que sai na nota). */
export function corpoDoClienteFiscal(dados: DadosFiscais, email: string | null): Record<string, unknown> {
  const telefone = telefoneNacional(dados.telefone);
  return {
    name: dados.razao_social,
    cpfCnpj: dados.documento,
    ...(email ? { email } : {}),
    ...(telefone ? { mobilePhone: telefone } : {}),
    postalCode: dados.cep,
    address: dados.logradouro,
    addressNumber: dados.numero,
    complement: dados.complemento ?? "",
    province: dados.bairro,
    ...(dados.inscricao_municipal ? { municipalInscription: dados.inscricao_municipal } : {}),
    ...(dados.inscricao_estadual ? { stateInscription: dados.inscricao_estadual } : {}),
    // Os avisos de cobrança são da MIA; os do Asaas sairiam em dobro (decisão 8).
    notificationDisabled: true,
  };
}

const comId = z.object({ id: z.string().min(1), deleted: z.boolean().nullish() });
const UUID = z.string().uuid();

export function asaasDaMia(deps: DependenciasDoAsaasDaMia = {}) {
  const api = apiDoAsaas(deps);
  const ref = (s: string) => encodeURIComponent(s);

  /**
   * O cliente do Asaas DESTA empresa, com os dados fiscais. Já existe (o
   * upstream cria pela `externalReference` = id da empresa): atualiza. Não
   * existe: cria, com a MESMA `externalReference`, para o checkout do upstream
   * achá-lo e não criar outro. Devolve a referência (`cus_...`).
   */
  async function garantirClienteFiscal(p: {
    orgId: string;
    clienteRef: string | null;
    dados: DadosFiscais;
    email: string | null;
  }): Promise<string> {
    const org = UUID.safeParse(p.orgId);
    if (!org.success) throw new ErroDoProvedor(null, "org_invalida", false);
    const corpo = corpoDoClienteFiscal(p.dados, p.email);
    let clienteRef = p.clienteRef;
    if (clienteRef === null) {
      const consulta = new URLSearchParams({ externalReference: org.data, limit: "10" });
      const achado = api
        .ler(lista(comId), await api.chamar("GET", `/customers?${consulta}`))
        .data.find((c) => c.deleted !== true);
      clienteRef = achado?.id ?? null;
    }
    if (clienteRef === null) {
      if (!p.email) throw new ErroDoProvedor(null, "empresa_sem_email", false);
      return api.ler(comId, await api.chamar("POST", "/customers", { ...corpo, externalReference: org.data })).id;
    }
    await api.chamar("PUT", `/customers/${ref(clienteRef)}`, corpo);
    return clienteRef;
  }

  async function lerCobranca(pagamentoRef: string): Promise<CobrancaLida> {
    return paraLida(api, api.ler(cobrancaDoAsaas, await api.chamar("GET", `/payments/${ref(pagamentoRef)}`)));
  }

  /** As cobranças do cliente, da mais nova para a mais velha (até 100). As apagadas o Asaas não lista. */
  async function listarCobrancasDoCliente(clienteRef: string, limite = 100): Promise<CobrancaLida[]> {
    const consulta = new URLSearchParams({ customer: clienteRef, limit: String(Math.min(Math.max(limite, 1), 100)) });
    const lidas = api.ler(lista(cobrancaDoAsaas), await api.chamar("GET", `/payments?${consulta}`)).data;
    return lidas.map((c) => paraLida(api, c)).sort((a, b) => b.vencimento.localeCompare(a.vencimento));
  }

  async function listarCobrancasDaAssinatura(assinaturaRef: string): Promise<CobrancaLida[]> {
    const consulta = new URLSearchParams({ subscription: assinaturaRef, limit: "100" });
    const lidas = api.ler(lista(cobrancaDoAsaas), await api.chamar("GET", `/payments?${consulta}`)).data;
    return lidas.map((c) => paraLida(api, c)).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  }

  /** O Pix da cobrança: o copia e cola e a imagem do QR (base64), e até quando vale. */
  async function lerPix(pagamentoRef: string): Promise<{ copiaECola: string; imagemBase64: string | null; expiraEm: string | null }> {
    const pix = api.ler(
      z.object({ payload: z.string().min(1), encodedImage: z.string().nullish(), expirationDate: z.string().nullish() }),
      await api.chamar("GET", `/payments/${ref(pagamentoRef)}/pixQrCode`),
    );
    return { copiaECola: pix.payload, imagemBase64: pix.encodedImage ?? null, expiraEm: pix.expirationDate ?? null };
  }

  /** A linha digitável do boleto da cobrança. */
  async function lerLinhaDigitavel(pagamentoRef: string): Promise<{ linha: string; codigoDeBarras: string | null }> {
    const l = api.ler(
      z.object({ identificationField: z.string().min(10), barCode: z.string().nullish() }),
      await api.chamar("GET", `/payments/${ref(pagamentoRef)}/identificationField`),
    );
    return { linha: l.identificationField, codigoDeBarras: l.barCode ?? null };
  }

  /** Muda o vencimento de uma cobrança em aberto (o boleto que venceria hoje ganha prazo). */
  async function mudarVencimento(pagamentoRef: string, dataCivil: string): Promise<CobrancaLida> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataCivil)) throw new ErroDoProvedor(null, "data_invalida", false);
    return paraLida(api, api.ler(cobrancaDoAsaas, await api.chamar("PUT", `/payments/${ref(pagamentoRef)}`, { dueDate: dataCivil })));
  }

  /**
   * Muda a forma de uma cobrança em aberto (PUT `/payments/{id}`): "PIX" tira o
   * boleto da fatura (a primeira mensalidade depois do teste não aceita boleto) e
   * deixa o Pix pagar uma cobrança que estava no cartão recusado.
   */
  async function mudarFormaDaCobranca(pagamentoRef: string, forma: "PIX" | "UNDEFINED"): Promise<CobrancaLida> {
    return paraLida(api, api.ler(cobrancaDoAsaas, await api.chamar("PUT", `/payments/${ref(pagamentoRef)}`, { billingType: forma })));
  }

  /** Apaga a cobrança em aberto (o boleto deixa de valer). 404 = já apagada: o efeito desejado. */
  async function cancelarCobranca(pagamentoRef: string): Promise<void> {
    try {
      await api.chamar("DELETE", `/payments/${ref(pagamentoRef)}`);
    } catch (e) {
      if (!(e instanceof ErroDoProvedor && e.status === 404)) throw e;
    }
  }

  /** Encerra a assinatura e leva as cobranças em aberto dela. 404 = já encerrada. */
  async function cancelarAssinatura(assinaturaRef: string): Promise<void> {
    try {
      await api.chamar("DELETE", `/subscriptions/${ref(assinaturaRef)}`);
    } catch (e) {
      if (!(e instanceof ErroDoProvedor && e.status === 404)) throw e;
    }
  }

  /** As notas fiscais de uma cobrança ou de um cliente (até 100). */
  async function listarNotas(filtro: { pagamentoRef?: string; clienteRef?: string }): Promise<NotaLida[]> {
    const consulta = new URLSearchParams({ limit: "100" });
    if (filtro.pagamentoRef) consulta.set("payment", filtro.pagamentoRef);
    if (filtro.clienteRef) consulta.set("customer", filtro.clienteRef);
    if (!filtro.pagamentoRef && !filtro.clienteRef) return [];
    const lidas = api.ler(lista(notaDoAsaas), await api.chamar("GET", `/invoices?${consulta}`)).data;
    return lidas.map((n) => ({
      ref: n.id,
      status: n.status,
      situacao: situacaoDaNota(n.status),
      numero: n.number === null || n.number === undefined ? null : String(n.number),
      pdfUrl: api.linkSeguro(n.pdfUrl),
      xmlUrl: api.linkSeguro(n.xmlUrl),
      pagamentoRef: n.payment ?? null,
      valorCents: Math.round((n.value ?? 0) * 100),
      emitidaEm: n.effectiveDate && /^\d{4}-\d{2}-\d{2}/.test(n.effectiveDate) ? n.effectiveDate.slice(0, 10) : null,
    }));
  }

  /**
   * A nota fiscal da assinatura sai NA CONFIRMAÇÃO do pagamento (decisão 8):
   * `effectiveDatePeriod: ON_PAYMENT_CONFIRMATION`. Cria a configuração; se ela
   * já existe (o Asaas recusa a segunda), atualiza. Pix vencido, boleto apagado e
   * cobrança refeita não geram nota, porque nunca são confirmados.
   */
  async function configurarNotaDaAssinatura(assinaturaRef: string, config: ConfiguracaoDaNota): Promise<void> {
    const corpo: Record<string, unknown> = {
      ...(config.servicoMunicipalId ? { municipalServiceId: config.servicoMunicipalId } : {}),
      ...(config.servicoMunicipalCodigo ? { municipalServiceCode: config.servicoMunicipalCodigo } : {}),
      ...(config.servicoMunicipalNome ? { municipalServiceName: config.servicoMunicipalNome } : {}),
      ...(config.observacoes ? { observations: config.observacoes } : {}),
      effectiveDatePeriod: "ON_PAYMENT_CONFIRMATION",
      updatePayment: false,
      deductions: 0,
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
    const caminho = `/subscriptions/${ref(assinaturaRef)}/invoiceSettings`;
    try {
      await api.chamar("POST", caminho, corpo);
    } catch (e) {
      const recusaDefinitiva = e instanceof ErroDoProvedor && !e.transitorio && e.status === 400;
      if (!recusaDefinitiva) throw e;
      await api.chamar("PUT", caminho, corpo);
    }
  }

  return {
    api,
    garantirClienteFiscal,
    lerCobranca,
    listarCobrancasDoCliente,
    listarCobrancasDaAssinatura,
    lerPix,
    lerLinhaDigitavel,
    mudarVencimento,
    mudarFormaDaCobranca,
    cancelarCobranca,
    cancelarAssinatura,
    listarNotas,
    configurarNotaDaAssinatura,
  };
}

export type AsaasDaMia = ReturnType<typeof asaasDaMia>;
