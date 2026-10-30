/**
 * FORK MIA (.98) · O SETUP DE IMPLANTAÇÃO (decisão 10 do protótipo "Cupons e
 * parceiros"; docs/fork/cupons-e-parceiros.md, seção 4).
 *
 * Venda ÚNICA e OPCIONAL: o cliente marca "Quero que a Time implante para mim"
 * no passo do pagamento. O preço é POR PLANO (Admin › Cobrança › Módulos dos
 * planos; sem preço, o plano não oferece). O cupom pode dar desconto no setup,
 * separado do da mensalidade. Por baixo é uma cobrança AVULSA no Asaas
 * (`externalReference = setup:<empresa>`), que aceita Pix, boleto e cartão, e a
 * nota fiscal é pedida quando o pagamento CONFIRMA, com o serviço e os impostos
 * do setup (a configuração da nota da Conexão). O desconto que zera o valor vira
 * "cortesia": nada é cobrado e não há comissão.
 *
 * A liberação da empresa nunca depende do setup: ela é da primeira mensalidade.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import QRCode from "qrcode";

import type { DependenciasDoAsaasDaMia } from "@/lib/asaas-mia/api";
import { codigoDoErro } from "@/lib/asaas-mia/api";
import { pagarComCartao, type TitularDoCartao } from "@/lib/asaas-mia/cartao";
import type { CartaoDigitado } from "@/lib/asaas-mia/cartao-regras";
import { asaasDaMia } from "@/lib/asaas-mia/cobrancas";
import { configuracaoDaNotaDoSetup, lerConfiguracaoDaNota } from "@/lib/asaas-mia/nota";
import { pagamentosNoAsaas, type PagamentoDoCliente } from "@/lib/asaas-mia/pagamentos";
import { audit } from "@/lib/audit";
import { emailDoAdminDaEmpresa } from "@/lib/cobranca/emails";
import { dataCivilEmSaoPaulo } from "@/lib/cobranca/provedores/asaas";
import { ErroDoProvedor } from "@/lib/cobranca/provedores/contrato";
import { lerCupomDaEmpresa } from "@/lib/cupons/banco";
import { setupComCupom } from "@/lib/cupons/regras";
import { lerDadosFiscais, marcarDadosFiscaisNoAsaas } from "@/lib/dados-fiscais/banco";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { logger } from "@/lib/logger";
import { referenciaDoSetup } from "@/lib/parceiros/regras";

export type SituacaoDoSetup = "aguardando" | "pago" | "cortesia" | "cancelado" | "estornado";

export interface SetupGravado {
  organization_id: string;
  plano_id: string | null;
  preco_cents: number;
  desconto_cents: number;
  valor_cents: number;
  situacao: SituacaoDoSetup;
  cliente_ref: string | null;
  pagamento_ref: string | null;
  fatura_url: string | null;
  pix_copia_e_cola: string | null;
  pedido_em: string;
  pago_em: string | null;
  forma_paga: string | null;
  nota_ref: string | null;
  nota_pedida_em: string | null;
  nota_tentativas: number;
  nota_erro: string | null;
}

/** O que a tela do passo recebe do setup. */
export interface SetupDoPasso {
  /** O plano oferece o setup (tem preço). */
  oferecido: boolean;
  preco_cents: number;
  desconto_cents: number;
  valor_cents: number;
  /** `null` = não pediu (ou desistiu). */
  situacao: SituacaoDoSetup | null;
  pix: { copia_e_cola: string; qr: string | null } | null;
  fatura_url: string | null;
  pago_em: string | null;
}

const DIAS_PARA_PAGAR = 3;
/** Depois de tantas tentativas, a nota espera a Time olhar (a tela da empresa mostra o erro). */
const TENTATIVAS_DA_NOTA = 5;

export async function lerSetupDaEmpresa(admin: SupabaseClient, orgId: string): Promise<SetupGravado | null> {
  const { data, error } = await admin.from("mia_setup_da_empresa").select("*").eq("organization_id", orgId).maybeSingle();
  if (error) throw new Error(`setup: leitura falhou (${error.code ?? "sem_codigo"})`);
  return (data as SetupGravado | null) ?? null;
}

/** O preço do setup do plano, em centavos. `null` = o plano não oferece (sem preço, ou zero). */
export async function precoDoSetup(admin: SupabaseClient, planoId: string): Promise<number | null> {
  const { data, error } = await admin.from("mia_plano_setup").select("preco_cents").eq("plano_id", planoId).maybeSingle();
  if (error) throw new Error(`setup: preço ilegível (${error.code ?? "sem_codigo"})`);
  const preco = (data as { preco_cents?: number } | null)?.preco_cents;
  return preco && preco > 0 ? Number(preco) : null;
}

/** Os preços de todos os planos (a tela dos módulos dos planos). LANÇA na falha. */
export async function lerPrecosDoSetup(admin: SupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await admin.from("mia_plano_setup").select("plano_id, preco_cents").limit(500);
  if (error) throw new Error(`setup: preços ilegíveis (${error.code ?? "sem_codigo"})`);
  return new Map(((data ?? []) as Array<{ plano_id: string; preco_cents: number }>).map((l) => [l.plano_id, Number(l.preco_cents)]));
}

/** Grava o preço do setup de um plano. `null` ou zero = o plano deixa de oferecer. */
export async function gravarPrecoDoSetup(
  admin: SupabaseClient,
  planoId: string,
  precoCents: number | null,
  ator: string | null,
): Promise<{ ok: true; mudou: boolean } | { ok: false }> {
  const atual = await precoDoSetup(admin, planoId);
  const novo = precoCents && precoCents > 0 ? precoCents : null;
  if ((atual ?? null) === novo) return { ok: true, mudou: false };
  const r =
    novo === null
      ? await admin.from("mia_plano_setup").delete().eq("plano_id", planoId)
      : await admin.from("mia_plano_setup").upsert({ plano_id: planoId, preco_cents: novo, updated_by: ator }, { onConflict: "plano_id" });
  if (r.error) return { ok: false };
  return { ok: true, mudou: true };
}

export type RecusaDoSetup = { ok: false; status: number; code: string; message: string };
const recusa = (status: number, code: string, message: string): RecusaDoSetup => ({ ok: false, status, code, message });

function somarDias(dataCivil: string, dias: number): string {
  const [a, m, d] = dataCivil.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

async function qrDoPix(copiaECola: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(copiaECola, { margin: 1, width: 240, errorCorrectionLevel: "M" });
  } catch {
    return null;
  }
}

function falhaDoAsaas(e: unknown, orgId: string, onde: string): RecusaDoSetup {
  logger.warn("setup.asaas_falhou", { organization_id: orgId, onde, codigo: codigoDoErro(e) });
  if (e instanceof ErroDoProvedor && e.codigo === "invalid_cpfCnpj") {
    return recusa(422, "documento_recusado", "O Asaas não aceitou este CPF ou CNPJ. Confira o número em Corrigir.");
  }
  if (e instanceof ErroDoProvedor && e.codigo === "sem_chave") {
    return recusa(409, "provedor_nao_conectado", "O pagamento ainda não está disponível. Fale com a Time.");
  }
  return recusa(e instanceof ErroDoProvedor && !e.transitorio ? 502 : 503, "provedor_recusou", "O Asaas não respondeu agora. Tente de novo em alguns minutos.");
}

/**
 * "Quero que a Time implante para mim": a cobrança avulsa, com o desconto do
 * cupom. Repetir não cria outra (a mesma referência externa); o valor que mudou
 * (o cupom entrou ou saiu antes de pagar) acerta a cobrança aberta. Antes do
 * Pix, os dados fiscais: a nota sai em nome deles.
 */
export async function pedirSetup(
  admin: SupabaseClient,
  p: { orgId: string; userId: string; requestId: string; agora?: Date },
  deps: { asaas?: DependenciasDoAsaasDaMia; cobrancaLigada?: () => Promise<boolean>; emailDoAdmin?: typeof emailDoAdminDaEmpresa } = {},
): Promise<{ ok: true; setup: SetupGravado; criado: boolean } | RecusaDoSetup> {
  const agora = p.agora ?? new Date();
  if (!(await (deps.cobrancaLigada ?? (() => moduloLigado(admin, "cobranca")))())) return recusa(404, "not_found", "Not found");
  const { data: lida, error } = await admin.from("cobranca_assinaturas").select("plano_id, provedor_cliente_id").eq("organization_id", p.orgId).maybeSingle();
  if (error) return recusa(500, "internal_error", "Não foi possível ler a assinatura.");
  const assinatura = lida as { plano_id: string; provedor_cliente_id: string | null } | null;
  if (!assinatura) return recusa(409, "sem_plano", "Esta empresa não tem plano de cobrança.");
  const preco = await precoDoSetup(admin, assinatura.plano_id);
  if (preco === null) return recusa(409, "setup_indisponivel", "Este plano não oferece o setup de implantação.");
  const atual = await lerSetupDaEmpresa(admin, p.orgId);
  if (atual && (atual.situacao === "pago" || atual.situacao === "cortesia")) return { ok: true, setup: atual, criado: false };
  const cupom = await lerCupomDaEmpresa(admin, p.orgId);
  const valor = setupComCupom(preco, cupom);
  const desconto = preco - valor;
  const base = {
    organization_id: p.orgId,
    plano_id: assinatura.plano_id,
    preco_cents: preco,
    desconto_cents: desconto,
    valor_cents: valor,
    pedido_por: p.userId,
    pedido_em: atual?.situacao === "aguardando" ? atual.pedido_em : agora.toISOString(),
  };
  const gravar = async (campos: Record<string, unknown>) => {
    const { data, error: erroDaGravacao } = await admin
      .from("mia_setup_da_empresa")
      .upsert({ ...base, ...campos }, { onConflict: "organization_id" })
      .select("*")
      .single();
    if (erroDaGravacao || !data) throw new Error(`setup: gravação falhou (${erroDaGravacao?.code ?? "sem_codigo"})`);
    return data as SetupGravado;
  };
  // O desconto zerou o valor: cortesia, nada a cobrar. A cobrança aberta, se havia, sai.
  if (valor === 0) {
    if (atual?.situacao === "aguardando" && atual.pagamento_ref) {
      await asaasDaMia(deps.asaas)
        .cancelarCobranca(atual.pagamento_ref)
        .catch(() => undefined);
    }
    const setup = await gravar({ situacao: "cortesia", pagamento_ref: null, fatura_url: null, pix_copia_e_cola: null, pix_gerado_em: null, pago_em: agora.toISOString() });
    void audit({
      action: "setup.pedido",
      actorUserId: p.userId,
      organizationId: p.orgId,
      resourceType: "mia_setup_da_empresa",
      resourceId: p.orgId,
      requestId: p.requestId,
      metadata: { preco_cents: preco, desconto_cents: desconto, valor_cents: 0, cortesia: true, plano_id: assinatura.plano_id },
    });
    return { ok: true, setup, criado: atual === null };
  }
  const fiscais = await lerDadosFiscais(admin, p.orgId);
  if (!fiscais) return recusa(409, "dados_fiscais_faltando", "Preencha os dados da empresa para a cobrança e a nota fiscal antes de pedir o setup.");
  try {
    const asaas = asaasDaMia(deps.asaas);
    const email = await (deps.emailDoAdmin ?? emailDoAdminDaEmpresa)(admin, p.orgId);
    const clienteRef = await asaas.garantirClienteFiscal({ orgId: p.orgId, clienteRef: assinatura.provedor_cliente_id, dados: fiscais, email });
    await marcarDadosFiscaisNoAsaas(admin, p.orgId, fiscais.updated_at);
    const pagamentos = pagamentosNoAsaas(deps.asaas);
    const { data: plano } = await admin.from("cobranca_planos").select("nome").eq("id", assinatura.plano_id).maybeSingle();
    const cobranca = await pagamentos.garantirCobrancaAvulsa({
      clienteRef,
      valorCents: valor,
      vencimento: somarDias(dataCivilEmSaoPaulo(agora), DIAS_PARA_PAGAR),
      descricao: `Setup de implantação · ${(plano as { nome?: string } | null)?.nome ?? ""}`.trim(),
      referenciaExterna: referenciaDoSetup(p.orgId),
    });
    if (cobranca.pago) {
      const setup = await gravar({ situacao: "aguardando", cliente_ref: clienteRef, pagamento_ref: cobranca.ref, fatura_url: cobranca.faturaUrl });
      await conferirSetup(admin, p.orgId, { pagamentos: [cobranca], deps: deps.asaas, agora });
      return { ok: true, setup: (await lerSetupDaEmpresa(admin, p.orgId)) ?? setup, criado: false };
    }
    if (cobranca.aberto && cobranca.valorCents !== valor) await pagamentos.mudarValor(cobranca.ref, valor);
    const pix = await asaas.lerPix(cobranca.ref).catch(() => null);
    const setup = await gravar({
      situacao: "aguardando",
      cliente_ref: clienteRef,
      pagamento_ref: cobranca.ref,
      fatura_url: cobranca.faturaUrl,
      pix_copia_e_cola: pix?.copiaECola ?? null,
      pix_gerado_em: pix ? agora.toISOString() : null,
    });
    void audit({
      action: "setup.pedido",
      actorUserId: p.userId,
      organizationId: p.orgId,
      resourceType: "mia_setup_da_empresa",
      resourceId: p.orgId,
      requestId: p.requestId,
      metadata: { preco_cents: preco, desconto_cents: desconto, valor_cents: valor, plano_id: assinatura.plano_id },
    });
    return { ok: true, setup, criado: atual?.situacao !== "aguardando" };
  } catch (e) {
    return falhaDoAsaas(e, p.orgId, "pedir_setup");
  }
}

/** Desmarcou antes de pagar: a cobrança sai do Asaas. Depois de pago, só a Time resolve. */
export async function desistirDoSetup(
  admin: SupabaseClient,
  p: { orgId: string; userId: string; requestId: string },
  deps: { asaas?: DependenciasDoAsaasDaMia } = {},
): Promise<{ ok: true } | RecusaDoSetup> {
  const atual = await lerSetupDaEmpresa(admin, p.orgId);
  if (!atual || atual.situacao === "cancelado" || atual.situacao === "estornado") return { ok: true };
  if (atual.situacao === "pago") return recusa(409, "setup_pago", "O setup já foi pago. Para desistir, fale com a Time.");
  try {
    if (atual.situacao === "aguardando" && atual.pagamento_ref) {
      const asaas = asaasDaMia(deps.asaas);
      const lida = await pagamentosNoAsaas(deps.asaas).lerPagamento(atual.pagamento_ref).catch(() => null);
      if (lida?.pago) {
        await conferirSetup(admin, p.orgId, { pagamentos: [lida], deps: deps.asaas });
        return recusa(409, "setup_pago", "O setup já foi pago. Para desistir, fale com a Time.");
      }
      await asaas.cancelarCobranca(atual.pagamento_ref);
    }
  } catch (e) {
    return falhaDoAsaas(e, p.orgId, "desistir_do_setup");
  }
  const { error } = await admin
    .from("mia_setup_da_empresa")
    .update({ situacao: "cancelado", fatura_url: null, pix_copia_e_cola: null, pix_gerado_em: null })
    .eq("organization_id", p.orgId);
  if (error) return recusa(500, "internal_error", "Não foi possível salvar. Tente de novo.");
  void audit({
    action: "setup.cancelado",
    actorUserId: p.userId,
    organizationId: p.orgId,
    resourceType: "mia_setup_da_empresa",
    resourceId: p.orgId,
    requestId: p.requestId,
    metadata: { situacao_antes: atual.situacao },
  });
  return { ok: true };
}

/** A nota do setup: pedida na confirmação do pagamento, com o serviço próprio. Nunca lança. */
async function pedirNota(
  admin: SupabaseClient,
  setup: SetupGravado,
  agora: Date,
  deps?: DependenciasDoAsaasDaMia,
): Promise<void> {
  if (!setup.pagamento_ref || setup.nota_ref || setup.nota_tentativas >= TENTATIVAS_DA_NOTA) return;
  try {
    const config = configuracaoDaNotaDoSetup(await lerConfiguracaoDaNota(admin));
    if (config === null) {
      if (setup.nota_erro !== "sem_configuracao") {
        await admin.from("mia_setup_da_empresa").update({ nota_erro: "sem_configuracao" }).eq("organization_id", setup.organization_id);
      }
      return;
    }
    const nota = await pagamentosNoAsaas(deps).pedirNotaDoSetup(setup.pagamento_ref, setup.valor_cents, config, dataCivilEmSaoPaulo(agora));
    await admin
      .from("mia_setup_da_empresa")
      .update({ nota_ref: nota, nota_pedida_em: agora.toISOString(), nota_erro: null })
      .eq("organization_id", setup.organization_id);
  } catch (e) {
    logger.warn("setup.nota_nao_saiu", { organization_id: setup.organization_id, codigo: codigoDoErro(e) });
    await admin
      .from("mia_setup_da_empresa")
      .update({ nota_tentativas: setup.nota_tentativas + 1, nota_erro: codigoDoErro(e).slice(0, 80) })
      .eq("organization_id", setup.organization_id);
  }
}

/**
 * Relê o setup no Asaas: pagou (a nota é pedida), estornou, sumiu. Pelo aviso do
 * Asaas e pela rodada. `pagamentos`: as cobranças já lidas por quem chama. Nunca lança.
 */
export async function conferirSetup(
  admin: SupabaseClient,
  orgId: string,
  o: { pagamentos?: readonly PagamentoDoCliente[]; deps?: DependenciasDoAsaasDaMia; agora?: Date } = {},
): Promise<"nada" | "pago" | "estornado" | "cancelado"> {
  const agora = o.agora ?? new Date();
  try {
    const setup = await lerSetupDaEmpresa(admin, orgId);
    if (!setup?.pagamento_ref || (setup.situacao !== "aguardando" && setup.situacao !== "pago")) return "nada";
    const naLista = o.pagamentos?.find((p) => p.ref === setup.pagamento_ref);
    const lido = naLista ?? (await pagamentosNoAsaas(o.deps).lerPagamento(setup.pagamento_ref).catch(() => null));
    if (!lido) return "nada";
    if (setup.situacao === "aguardando") {
      if (lido.pago) {
        const { data } = await admin
          .from("mia_setup_da_empresa")
          .update({
            situacao: "pago",
            pago_em: lido.pagoEm ? `${lido.pagoEm}T12:00:00-03:00` : agora.toISOString(),
            forma_paga: lido.forma,
            pix_copia_e_cola: null,
            conferido_em: agora.toISOString(),
          })
          .eq("organization_id", orgId)
          .eq("situacao", "aguardando")
          .select("*")
          .maybeSingle();
        if (data) {
          void audit({
            action: "setup.pago",
            actorUserId: null,
            bypassedRls: true,
            organizationId: orgId,
            resourceType: "mia_setup_da_empresa",
            resourceId: orgId,
            metadata: { valor_cents: setup.valor_cents, forma: lido.forma },
          });
          await pedirNota(admin, data as SetupGravado, agora, o.deps);
        }
        return "pago";
      }
      if (lido.estornado) {
        await admin.from("mia_setup_da_empresa").update({ situacao: "estornado", conferido_em: agora.toISOString() }).eq("organization_id", orgId);
        return "estornado";
      }
      if (!lido.aberto && lido.status !== "AWAITING_RISK_ANALYSIS") {
        await admin
          .from("mia_setup_da_empresa")
          .update({ situacao: "cancelado", fatura_url: null, pix_copia_e_cola: null, conferido_em: agora.toISOString() })
          .eq("organization_id", orgId);
        return "cancelado";
      }
      return "nada";
    }
    if (lido.estornado) {
      await admin.from("mia_setup_da_empresa").update({ situacao: "estornado", conferido_em: agora.toISOString() }).eq("organization_id", orgId);
      void audit({
        action: "setup.estornado",
        actorUserId: null,
        bypassedRls: true,
        organizationId: orgId,
        resourceType: "mia_setup_da_empresa",
        resourceId: orgId,
        metadata: { valor_cents: setup.valor_cents, status: lido.status },
      });
      return "estornado";
    }
    await pedirNota(admin, setup, agora, o.deps);
    return "nada";
  } catch (e) {
    logger.warn("setup.conferencia_falhou", { organization_id: orgId, codigo: codigoDoErro(e) });
    return "nada";
  }
}

/**
 * Paga o setup com o MESMO cartão digitado para a mensalidade, na mesma
 * requisição (o cartão vive só nela). Recusado no setup não desfaz a mensalidade:
 * a tela segue mostrando o Pix e a fatura do setup. Do cartão, nada é gravado aqui.
 */
export async function pagarSetupComOMesmoCartao(
  admin: SupabaseClient,
  p: { orgId: string; cartao: CartaoDigitado; titular: TitularDoCartao },
  deps?: DependenciasDoAsaasDaMia,
): Promise<"nao_havia" | "pago" | "em_analise" | "pendente" | "recusado" | "falhou"> {
  try {
    const setup = await lerSetupDaEmpresa(admin, p.orgId);
    if (setup?.situacao !== "aguardando" || !setup.pagamento_ref) return "nao_havia";
    const r = await pagarComCartao({ pagamentoRef: setup.pagamento_ref, cartao: p.cartao, titular: p.titular }, deps);
    if (r.tipo === "pago" || r.tipo === "em_analise") await conferirSetup(admin, p.orgId, { deps });
    return r.tipo;
  } catch (e) {
    logger.warn("setup.cartao_falhou", { organization_id: p.orgId, codigo: codigoDoErro(e) });
    return "falhou";
  }
}

/** O setup para a tela do passo. Nunca lança (na falha, o bloco some). */
export async function setupParaOPasso(admin: SupabaseClient, orgId: string, planoId: string | null, cupom: Parameters<typeof setupComCupom>[1]): Promise<SetupDoPasso | null> {
  try {
    if (!planoId) return null;
    const [preco, atual] = await Promise.all([precoDoSetup(admin, planoId), lerSetupDaEmpresa(admin, orgId)]);
    const pedido = atual && atual.situacao !== "cancelado" ? atual : null;
    if (preco === null && !pedido) return null;
    const cheio = pedido ? pedido.preco_cents : (preco ?? 0);
    const valor = pedido ? pedido.valor_cents : setupComCupom(cheio, cupom);
    return {
      oferecido: preco !== null,
      preco_cents: cheio,
      desconto_cents: cheio - valor,
      valor_cents: valor,
      situacao: pedido?.situacao ?? null,
      pix: pedido?.situacao === "aguardando" && pedido.pix_copia_e_cola ? { copia_e_cola: pedido.pix_copia_e_cola, qr: await qrDoPix(pedido.pix_copia_e_cola) } : null,
      fatura_url: pedido?.situacao === "aguardando" ? pedido.fatura_url : null,
      pago_em: pedido?.pago_em ?? null,
    };
  } catch {
    return null;
  }
}
