/**
 * FORK MIA (.96) · O PASSO "PAGAMENTO" DO INÍCIO (protótipo "Pagamento no
 * início", aprovado em 27/10/2026; docs/fork/pagamento-no-inicio.md).
 *
 * A empresa de ENTRADA PAGA paga antes do "Seu negócio", na própria tela: Pix
 * com QR e copia e cola, cartão digitado (checkout transparente do Asaas) ou
 * boleto com linha digitável e PDF. Por baixo é a cobrança do UPSTREAM: a
 * assinatura no Asaas (`gerarLinkDePagamento`, billingType UNDEFINED) e a
 * PRIMEIRA cobrança dela, que aceita as três formas. Quem decide que pagou é a
 * releitura do upstream (`sincronizar`): ela desliga `pagamento_inicial_pendente`
 * e reativa a empresa. Daqui sai só o que a tela precisa.
 *
 * As regras, cada uma com caso em `tests/unit/pagamento-inicial-servico.test.ts`:
 *   - só a empresa que espera o primeiro pagamento passa por aqui;
 *   - sem os dados fiscais, não há cobrança (a nota sairia errada);
 *   - o cliente do Asaas recebe os dados fiscais ANTES da cobrança, com os avisos
 *     do Asaas desligados (decisão 8);
 *   - dois cliques, duas abas: uma reserva curta na linha (`reserva_ate`);
 *   - a mesma cobrança serve às três formas; sair do BOLETO para o Pix ou para o
 *     cartão cancela o boleto no Asaas e refaz a cobrança (para não cobrar duas
 *     vezes), e trocar de plano antes de pagar também (decisão 7);
 *   - a nota fiscal da assinatura é pedida NA CONFIRMAÇÃO do pagamento;
 *   - conferir pela tela é uma leitura direta no Asaas, no máximo a cada poucos
 *     segundos por empresa (`conferido_em`); pago, roda a releitura do upstream;
 *   - do cartão, nada é gravado além do final e da bandeira que o Asaas devolve
 *     (`lib/asaas-mia/cartao.ts`).
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import QRCode from "qrcode";

import { audit } from "@/lib/audit";
import type { DependenciasDoAsaasDaMia } from "@/lib/asaas-mia/api";
import { codigoDoErro } from "@/lib/asaas-mia/api";
import { cartaoNaAssinatura, pagarComCartao, type TitularDoCartao } from "@/lib/asaas-mia/cartao";
import { finalDigitado, type CartaoDigitado } from "@/lib/asaas-mia/cartao-regras";
import { asaasDaMia, telefoneNacional, type CobrancaLida } from "@/lib/asaas-mia/cobrancas";
import { garantirNotaNaConfirmacao } from "@/lib/asaas-mia/nota";
import { gerarLinkDePagamento } from "@/lib/cobranca/checkout";
import { emailDoAdminDaEmpresa } from "@/lib/cobranca/emails";
import { dataCivilEmSaoPaulo } from "@/lib/cobranca/provedores/asaas";
import { ErroDoProvedor } from "@/lib/cobranca/provedores/contrato";
import { sincronizar } from "@/lib/cobranca/sincronizar";
import { urlDoHub } from "@/lib/cobranca/url";
import { gravarDadosFiscais, lerDadosFiscais, marcarDadosFiscaisNoAsaas, type DadosFiscaisGravados } from "@/lib/dados-fiscais/banco";
import { conferirDadosFiscais, enderecoEmUmaLinha, formatarDocumento } from "@/lib/dados-fiscais/regras";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { logger } from "@/lib/logger";
import { seguirOPlano } from "@/lib/planos-mia/seguir-o-plano";

import { MOTIVO_DA_ENTRADA_PAGA } from "./destino";
import type { FiscaisDoPasso, FormaDoPagamento, ModoDoPasso, PassoDoPagamento, PlanoDoPasso, SituacaoDoPagamento } from "./tipos";

export interface DependenciasDoPasso {
  asaas?: DependenciasDoAsaasDaMia;
  agora?: () => Date;
  cobrancaLigada?: () => Promise<boolean>;
  sincronizar?: typeof sincronizar;
  gerarLink?: typeof gerarLinkDePagamento;
  emailDoAdmin?: typeof emailDoAdminDaEmpresa;
}

/** A reserva de quem está gerando ou cobrando: curta, e a nova tentativa espera. */
const RESERVA_MS = 90_000;
/** Conferência direta no Asaas pela tela: no máximo uma por empresa neste intervalo. */
export const INTERVALO_DA_CONFERENCIA_MS = 8_000;
/** O boleto que venceria hoje ganha estes dias (o prazo de compensação). */
const DIAS_DO_BOLETO = 3;

interface Assinatura {
  plano_id: string;
  estado: string;
  pagamento_inicial_pendente: boolean;
  provedor: string | null;
  provedor_cliente_id: string | null;
  provedor_assinatura_id: string | null;
  checkout_sessao_id: string | null;
  proximo_vencimento: string | null;
  trial_ate: string | null;
}

export interface LinhaDoPagamento {
  organization_id: string;
  modo: ModoDoPasso;
  primeira_cobranca_em: string | null;
  plano_id: string | null;
  situacao: SituacaoDoPagamento;
  forma: FormaDoPagamento | null;
  pagamento_ref: string | null;
  assinatura_ref: string | null;
  valor_cents: number | null;
  vence_em: string | null;
  fatura_url: string | null;
  pix_copia_e_cola: string | null;
  pix_gerado_em: string | null;
  boleto_linha: string | null;
  boleto_url: string | null;
  boleto_gerado_em: string | null;
  cartao_final: string | null;
  cartao_bandeira: string | null;
  cartao_recusas: number;
  cartao_recusado_em: string | null;
  cartao_recorrente: string | null;
  reserva_ate: string | null;
  gerada_em: string | null;
  pago_em: string | null;
  forma_paga: string | null;
  conferido_em: string | null;
  lembrete_enviado_em: string | null;
  cobrancas_refeitas: number;
}

const COLUNAS_DA_ASSINATURA =
  "plano_id, estado, pagamento_inicial_pendente, provedor, provedor_cliente_id, provedor_assinatura_id, checkout_sessao_id, proximo_vencimento, trial_ate";
const COLUNAS_DO_PLANO = "id, nome, preco_cents, intervalo, trial_dias, max_assentos, max_canais";

export type Recusa = { ok: false; status: number; code: string; message: string; details?: unknown };
export type ResultadoDoPasso = { ok: true; passo: PassoDoPagamento } | Recusa;

const recusa = (status: number, code: string, message: string, details?: unknown): Recusa => ({
  ok: false,
  status,
  code,
  message,
  ...(details === undefined ? {} : { details }),
});

async function lerAssinatura(admin: SupabaseClient, orgId: string): Promise<Assinatura | null> {
  const { data, error } = await admin.from("cobranca_assinaturas").select(COLUNAS_DA_ASSINATURA).eq("organization_id", orgId).maybeSingle();
  if (error) throw new Error(`pagamento inicial: assinatura ilegível (${error.code ?? "sem_codigo"})`);
  return (data as unknown as Assinatura | null) ?? null;
}

export async function lerLinha(admin: SupabaseClient, orgId: string): Promise<LinhaDoPagamento | null> {
  const { data, error } = await admin.from("mia_pagamento_inicial").select("*").eq("organization_id", orgId).maybeSingle();
  if (error) throw new Error(`pagamento inicial: linha ilegível (${error.code ?? "sem_codigo"})`);
  return (data as unknown as LinhaDoPagamento | null) ?? null;
}

/**
 * A releitura do upstream registrou um pagamento: a pendência da entrada paga
 * desligou E há período pago (ou a assinatura está em dia). Só a pendência
 * desligada não basta: no plano com teste ela nunca esteve ligada.
 */
function upstreamRegistrouPagamento(
  assinatura: Pick<Assinatura, "pagamento_inicial_pendente" | "proximo_vencimento" | "estado"> | null,
): boolean {
  return assinatura !== null && !assinatura.pagamento_inicial_pendente && (assinatura.proximo_vencimento !== null || assinatura.estado === "ativa");
}

/**
 * Pagou a primeira: a linha diz "pago", ou houve cobrança e a releitura do
 * upstream já registrou o pagamento (o aviso chegou antes de a linha ser marcada).
 * Quem trocou para um plano com teste, ou escolheu no teste, não pagou nada.
 */
function pagouAPrimeira(
  linha: Pick<LinhaDoPagamento, "situacao" | "pagamento_ref"> | null,
  assinatura: Pick<Assinatura, "pagamento_inicial_pendente" | "proximo_vencimento" | "estado"> | null,
): boolean {
  if (!linha) return false;
  if (linha.situacao === "pago") return true;
  return Boolean(linha.pagamento_ref) && upstreamRegistrouPagamento(assinatura);
}

/**
 * A empresa foi bloqueada no FIM DO TESTE sem a primeira mensalidade paga (9122):
 * espera o pagamento como a entrada paga, mas a linha é do modo teste. Sem boleto
 * (a compensação demora e a pessoa ficaria bloqueada tendo pago).
 */
export function veioDoFimDoTeste(
  linha: Pick<LinhaDoPagamento, "modo"> | null,
  assinatura: Pick<Assinatura, "pagamento_inicial_pendente"> | null,
): boolean {
  return assinatura?.pagamento_inicial_pendente === true && linha?.modo === "teste";
}

/** As formas do passo, na ordem da tela. */
export function formasDoPasso(modo: ModoDoPasso | null, fimDoTeste: boolean): FormaDoPagamento[] {
  if (modo === "teste" || fimDoTeste) return ["cartao", "pix"];
  if (modo === "entrada_paga") return ["pix", "cartao", "boleto"];
  return [];
}

function paraPlano(p: Record<string, unknown>): PlanoDoPasso {
  return {
    id: String(p.id),
    nome: String(p.nome),
    preco_cents: Number(p.preco_cents),
    intervalo: String(p.intervalo),
    trial_dias: Number(p.trial_dias ?? 0),
    pessoas: (p.max_assentos as number | null) ?? null,
    numeros: (p.max_canais as number | null) ?? null,
  };
}

function paraFiscais(d: DadosFiscaisGravados): FiscaisDoPasso {
  return {
    tipo: d.tipo,
    documento: formatarDocumento(d.documento),
    razao_social: d.razao_social,
    endereco: enderecoEmUmaLinha(d),
    campos: {
      tipo: d.tipo,
      documento: formatarDocumento(d.documento),
      razao_social: d.razao_social,
      cep: d.cep,
      logradouro: d.logradouro,
      numero: d.numero,
      complemento: d.complemento ?? "",
      bairro: d.bairro,
      cidade: d.cidade,
      uf: d.uf,
      inscricao_municipal: d.inscricao_municipal ?? "",
      inscricao_estadual: d.inscricao_estadual ?? "",
      telefone: d.telefone ?? "",
    },
  };
}

/**
 * Em que modo o passo aparece para esta empresa. Puro.
 *   - `entrada_paga`: espera o primeiro pagamento, ou já pagou por este passo
 *     (a tela ainda mostra "Pagamento confirmado");
 *   - `teste`: plano com teste grátis e o início ainda não terminou (ou a escolha
 *     já foi feita por este passo): escolhe como paga depois do teste;
 *   - `null`: o passo não existe (cobrança desligada, isenta, empresa antiga).
 */
export function modoDoPasso(p: {
  ligada: boolean;
  assinatura: Pick<Assinatura, "pagamento_inicial_pendente" | "estado"> | null;
  linha: Pick<LinhaDoPagamento, "modo" | "pagamento_ref" | "situacao"> | null;
  onboardedAt: string | null;
}): ModoDoPasso | null {
  if (!p.ligada || !p.assinatura) return null;
  if (p.assinatura.pagamento_inicial_pendente) return "entrada_paga";
  if (p.linha?.modo === "entrada_paga" && (p.linha.pagamento_ref !== null || p.linha.situacao === "pago")) return "entrada_paga";
  if (p.linha?.modo === "teste" && p.linha.situacao === "escolhida") return "teste";
  if (p.assinatura.estado === "trial" && p.onboardedAt === null) return "teste";
  return null;
}

/** O passo está resolvido: pago (entrada paga) ou forma escolhida (teste). Puro. */
export function passoCumprido(
  modo: ModoDoPasso | null,
  linha: Pick<LinhaDoPagamento, "situacao" | "pagamento_ref"> | null,
  assinatura: Pick<Assinatura, "pagamento_inicial_pendente" | "provedor_assinatura_id" | "proximo_vencimento" | "estado"> | null,
): boolean {
  if (modo === null) return true;
  if (modo === "entrada_paga") return pagouAPrimeira(linha, assinatura);
  // Teste: escolheu aqui, ou já assinou por outro caminho (Plano e cobrança).
  return linha?.situacao === "escolhida" || (assinatura?.provedor_assinatura_id ?? null) !== null;
}

/**
 * O passo aparece e ainda não foi resolvido? É o que o roteador do início e o
 * indicador dos passos perguntam. Barato: duas leituras e a da empresa. Na
 * falha, `{ modo: null }` (o início do upstream segue como sempre).
 */
export async function situacaoDoPassoNoInicio(
  admin: SupabaseClient,
  orgId: string,
  deps: DependenciasDoPasso = {},
): Promise<{ modo: ModoDoPasso | null; cumprido: boolean }> {
  try {
    const ligada = await (deps.cobrancaLigada ?? (() => moduloLigado(admin, "cobranca")))();
    if (!ligada) return { modo: null, cumprido: true };
    const [assinatura, linha, org] = await Promise.all([
      lerAssinatura(admin, orgId),
      lerLinha(admin, orgId),
      admin.from("organizations").select("onboarded_at").eq("id", orgId).maybeSingle(),
    ]);
    const onboardedAt = (org.data as { onboarded_at?: string | null } | null)?.onboarded_at ?? null;
    const modo = modoDoPasso({ ligada, assinatura, linha, onboardedAt });
    return { modo, cumprido: passoCumprido(modo, linha, assinatura) };
  } catch {
    return { modo: null, cumprido: true };
  }
}

/**
 * O que a tela mostra agora. Só lê. `podePagar`: quem administra a empresa
 * (decidido por quem chama, pela sessão).
 */
export async function lerPassoDoPagamento(
  admin: SupabaseClient,
  orgId: string,
  opcoes: { podePagar: boolean; comFiscais?: boolean },
  deps: DependenciasDoPasso = {},
): Promise<PassoDoPagamento> {
  const ligada = await (deps.cobrancaLigada ?? (() => moduloLigado(admin, "cobranca")))();
  const [assinatura, linha, org] = await Promise.all([
    lerAssinatura(admin, orgId),
    lerLinha(admin, orgId),
    admin.from("organizations").select("onboarded_at").eq("id", orgId).maybeSingle(),
  ]);
  const onboardedAt = (org.data as { onboarded_at?: string | null } | null)?.onboarded_at ?? null;
  const modo = modoDoPasso({ ligada, assinatura, linha, onboardedAt });
  const espera = ligada && assinatura?.pagamento_inicial_pendente === true;
  const pago = pagouAPrimeira(linha, assinatura);
  const cumprido = passoCumprido(modo, linha, assinatura);
  const trocaAberta = modo !== null && !cumprido && opcoes.podePagar;
  const [plano, visiveis, fiscais] = await Promise.all([
    assinatura
      ? admin.from("cobranca_planos").select(COLUNAS_DO_PLANO).eq("id", assinatura.plano_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    trocaAberta
      ? admin
          .from("cobranca_planos")
          .select(COLUNAS_DO_PLANO)
          .is("arquivado_em", null)
          .eq("oferecido_ao_cliente", true)
          .order("preco_cents", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    opcoes.comFiscais !== false && opcoes.podePagar ? lerDadosFiscais(admin, orgId) : Promise.resolve(null),
  ]);
  const doPlano = plano.data ? paraPlano(plano.data as Record<string, unknown>) : null;
  const mesmaCobranca = linha !== null && linha.pagamento_ref !== null;
  const testeAte = modo === "teste" ? (assinatura?.trial_ate ?? null) : null;
  const fimDoTeste = veioDoFimDoTeste(linha, assinatura);
  return {
    modo,
    fim_do_teste: fimDoTeste,
    formas: formasDoPasso(modo, fimDoTeste),
    espera,
    pago,
    cumprido,
    teste_ate: testeAte,
    primeira_cobranca_em: modo === "teste" ? (linha?.primeira_cobranca_em ?? (testeAte ? dataCivilEmSaoPaulo(new Date(testeAte)) : null)) : null,
    situacao: pago ? "pago" : (linha?.situacao ?? "sem_cobranca"),
    forma: linha?.forma ?? null,
    plano: doPlano,
    planosParaTrocar: ((visiveis.data ?? []) as Array<Record<string, unknown>>).map(paraPlano),
    fiscais: fiscais ? paraFiscais(fiscais) : null,
    valor_cents: linha?.valor_cents ?? doPlano?.preco_cents ?? null,
    vence_em: linha?.vence_em ?? null,
    pix:
      modo === "entrada_paga" && mesmaCobranca && linha.pix_copia_e_cola
        ? { copia_e_cola: linha.pix_copia_e_cola, qr: await qrDoPix(linha.pix_copia_e_cola), gerado_em: linha.pix_gerado_em }
        : null,
    boleto:
      modo === "entrada_paga" && mesmaCobranca && linha.boleto_linha
        ? { linha: linha.boleto_linha, url: linha.boleto_url, gerado_em: linha.boleto_gerado_em }
        : null,
    cartao:
      linha && (linha.cartao_final || linha.cartao_recusas > 0)
        ? { final: linha.cartao_final, bandeira: linha.cartao_bandeira, recusas: linha.cartao_recusas, recusado_em: linha.cartao_recusado_em }
        : null,
    fatura_url: modo === "entrada_paga" && mesmaCobranca ? linha.fatura_url : null,
    pago_em: linha?.pago_em ?? null,
    forma_paga: (linha?.forma_paga as PassoDoPagamento["forma_paga"]) ?? null,
    proxima_cobranca: assinatura?.proximo_vencimento ?? null,
    pode_pagar: opcoes.podePagar,
  };
}

/** O QR do Pix a partir do copia e cola (o mesmo código EMV que o Asaas desenha). Nunca lança. */
async function qrDoPix(copiaECola: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(copiaECola, { margin: 1, width: 240, errorCorrectionLevel: "M" });
  } catch {
    return null;
  }
}

/** Reserva a linha (cria se faltar). `null` = outra requisição está no meio. */
async function reservar(admin: SupabaseClient, orgId: string, planoId: string, agora: Date): Promise<{ marca: string; linha: LinhaDoPagamento } | null> {
  await admin
    .from("mia_pagamento_inicial")
    .upsert({ organization_id: orgId, plano_id: planoId }, { onConflict: "organization_id", ignoreDuplicates: true });
  const marca = new Date(agora.getTime() + RESERVA_MS).toISOString();
  const { data, error } = await admin
    .from("mia_pagamento_inicial")
    .update({ reserva_ate: marca })
    .eq("organization_id", orgId)
    .or(`reserva_ate.is.null,reserva_ate.lt."${agora.toISOString()}"`)
    .select("*")
    .maybeSingle();
  if (error || !data) return null;
  return { marca, linha: data as unknown as LinhaDoPagamento };
}

async function soltar(admin: SupabaseClient, orgId: string, marca: string): Promise<void> {
  try {
    await admin.from("mia_pagamento_inicial").update({ reserva_ate: null }).eq("organization_id", orgId).eq("reserva_ate", marca);
  } catch {
    // A reserva expira sozinha em RESERVA_MS.
  }
}

/** Os campos de uma cobrança que deixou de valer (cancelada, refeita, trocada de plano). */
const SEM_COBRANCA = {
  situacao: "sem_cobranca",
  pagamento_ref: null,
  assinatura_ref: null,
  fatura_url: null,
  vence_em: null,
  pix_copia_e_cola: null,
  pix_gerado_em: null,
  boleto_linha: null,
  boleto_url: null,
  boleto_gerado_em: null,
  gerada_em: null,
  lembrete_enviado_em: null,
} as const;

/**
 * Cancela no Asaas a cobrança em aberto (a assinatura inteira, que leva as
 * cobranças dela) e tira as referências da assinatura do upstream, para o
 * próximo "gerar" criar outra. Só na empresa que ainda espera o primeiro
 * pagamento (entrada paga) ou que ainda está no teste sem ter pago nada (teste).
 */
async function cancelarCobrancaAtual(
  admin: SupabaseClient,
  orgId: string,
  linha: LinhaDoPagamento,
  assinatura: Assinatura,
  asaas: ReturnType<typeof asaasDaMia>,
  modo: ModoDoPasso = "entrada_paga",
): Promise<void> {
  const sub = assinatura.provedor_assinatura_id ?? linha.assinatura_ref;
  if (sub) await asaas.cancelarAssinatura(sub);
  else if (linha.pagamento_ref) await asaas.cancelarCobranca(linha.pagamento_ref);
  const { error } = await admin
    .from("cobranca_assinaturas")
    .update({
      provedor_assinatura_id: null,
      checkout_url: null,
      checkout_expira_em: null,
      checkout_sessao_id: null,
      link_de_pagamento: null,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId)
    .eq(modo === "teste" ? "estado" : "pagamento_inicial_pendente", modo === "teste" ? "trial" : true);
  if (error) throw new Error(`pagamento inicial: assinatura não liberada (${error.code ?? "sem_codigo"})`);
}

function somarDias(dataCivil: string, dias: number): string {
  const [a, m, d] = dataCivil.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

interface Preparada {
  pagamentoRef: string;
  assinaturaRef: string | null;
  cobranca: CobrancaLida;
  gerada: boolean;
  refeita: boolean;
}

/**
 * A cobrança em aberto desta empresa, pronta para a forma pedida. Reaproveita a
 * que existe; refaz quando ela sumiu no Asaas, quando o plano mudou ou quando a
 * pessoa sai do boleto já gerado. Chamada COM a reserva.
 */
async function prepararCobranca(
  admin: SupabaseClient,
  p: { orgId: string; userId: string; forma: FormaDoPagamento; requestId: string; linha: LinhaDoPagamento; assinatura: Assinatura; fiscais: DadosFiscaisGravados },
  deps: DependenciasDoPasso,
): Promise<Preparada | Recusa> {
  const asaas = asaasDaMia(deps.asaas);
  const { orgId, linha, assinatura } = p;
  let refeita = false;
  if (linha.pagamento_ref) {
    const atual = await asaas.lerCobranca(linha.pagamento_ref);
    if (atual.situacao === "paga" || atual.situacao === "em_analise") {
      return { pagamentoRef: atual.ref, assinaturaRef: linha.assinatura_ref, cobranca: atual, gerada: false, refeita: false };
    }
    const sumiu = atual.situacao === "cancelada" || atual.situacao === "estornada" || atual.situacao === "outra";
    const outroPlano = linha.plano_id !== assinatura.plano_id;
    const saiDoBoleto = Boolean(linha.boleto_gerado_em) && p.forma !== "boleto";
    if (!sumiu && !outroPlano && !saiDoBoleto) {
      return { pagamentoRef: atual.ref, assinaturaRef: linha.assinatura_ref ?? atual.assinaturaRef, cobranca: atual, gerada: false, refeita: false };
    }
    // Saiu do boleto, mudou de plano, ou a cobrança sumiu no Asaas (a assinatura do
    // upstream ainda aponta para ela): encerra a assinatura e refaz.
    await cancelarCobrancaAtual(admin, orgId, linha, assinatura, asaas);
    await admin
      .from("mia_pagamento_inicial")
      .update({ ...SEM_COBRANCA, cobrancas_refeitas: linha.cobrancas_refeitas + 1 })
      .eq("organization_id", orgId);
    refeita = true;
    void audit({
      action: "pagamento_inicial.cobranca_refeita",
      actorUserId: p.userId,
      organizationId: orgId,
      resourceType: "mia_pagamento_inicial",
      resourceId: orgId,
      requestId: p.requestId,
      metadata: { motivo: saiDoBoleto ? "saiu_do_boleto" : outroPlano ? "outro_plano" : "cobranca_sumiu", forma: p.forma },
    });
  }

  // Nova: o cliente do Asaas com os dados fiscais, depois a assinatura do upstream.
  const email = await (deps.emailDoAdmin ?? emailDoAdminDaEmpresa)(admin, orgId);
  await asaas.garantirClienteFiscal({ orgId, clienteRef: assinatura.provedor_cliente_id, dados: p.fiscais, email });
  await marcarDadosFiscaisNoAsaas(admin, orgId, p.fiscais.updated_at);
  const r = await (deps.gerarLink ?? gerarLinkDePagamento)(admin, {
    orgId,
    documentoBruto: p.fiscais.documento,
    email,
    chaveIdempotencia: randomUUID(),
    urlDeVolta: urlDoHub(),
    actorUserId: p.userId,
    requestId: p.requestId,
    comoDono: false,
  });
  if (!r.ok && r.code !== "pagamento_em_andamento") return recusa(r.status, r.code, r.message);
  const depois = await lerAssinatura(admin, orgId);
  const assinaturaRef = depois?.provedor_assinatura_id ?? null;
  let pagamentoRef = depois?.checkout_sessao_id?.startsWith("pay_") ? depois.checkout_sessao_id : null;
  if (!pagamentoRef && assinaturaRef) {
    pagamentoRef =
      (await asaas.listarCobrancasDaAssinatura(assinaturaRef)).find((c) => c.situacao === "aberta" || c.situacao === "vencida")?.ref ?? null;
  }
  if (!pagamentoRef) return recusa(503, "provedor_recusou", "O Asaas ainda não gerou a cobrança. Tente de novo em alguns segundos.");
  const cobranca = await asaas.lerCobranca(pagamentoRef);
  return { pagamentoRef, assinaturaRef, cobranca, gerada: true, refeita };
}

function falhaDoAsaas(e: unknown, orgId: string, onde: string): Recusa {
  logger.warn("pagamento_inicial.asaas_falhou", { organization_id: orgId, onde, codigo: codigoDoErro(e) });
  if (e instanceof ErroDoProvedor && e.codigo === "invalid_cpfCnpj") {
    return recusa(422, "documento_recusado", "O Asaas não aceitou este CPF ou CNPJ. Confira o número em Corrigir.");
  }
  if (e instanceof ErroDoProvedor && e.codigo === "empresa_sem_email") {
    return recusa(409, "empresa_sem_email", "A empresa ainda não tem administrador com e-mail.");
  }
  if (e instanceof ErroDoProvedor && e.codigo === "sem_chave") {
    return recusa(409, "provedor_nao_conectado", "O pagamento ainda não está disponível. Fale com a Time.");
  }
  return recusa(
    e instanceof ErroDoProvedor && !e.transitorio ? 502 : 503,
    "provedor_recusou",
    "O Asaas não respondeu agora. Tente de novo em alguns minutos.",
  );
}

interface Contexto {
  assinatura: Assinatura;
  fiscais: DadosFiscaisGravados;
  marca: string;
  linha: LinhaDoPagamento;
}

/** As guardas comuns e a reserva. */
async function abrir(admin: SupabaseClient, orgId: string, deps: DependenciasDoPasso, agora: Date): Promise<Contexto | Recusa> {
  const ligada = await (deps.cobrancaLigada ?? (() => moduloLigado(admin, "cobranca")))();
  const assinatura = ligada ? await lerAssinatura(admin, orgId) : null;
  if (!assinatura || !assinatura.pagamento_inicial_pendente) {
    const linha = assinatura ? await lerLinha(admin, orgId) : null;
    return pagouAPrimeira(linha, assinatura)
      ? recusa(409, "ja_pago", "O pagamento já foi confirmado. Siga para o próximo passo.")
      : recusa(409, "sem_entrada_paga", "Esta empresa não está esperando o primeiro pagamento.");
  }
  const fiscais = await lerDadosFiscais(admin, orgId);
  if (!fiscais) {
    return recusa(409, "dados_fiscais_faltando", "Preencha os dados da empresa para a cobrança e a nota fiscal antes de pagar.");
  }
  const reserva = await reservar(admin, orgId, assinatura.plano_id, agora);
  if (!reserva) return recusa(409, "em_andamento", "Já estamos cuidando deste pagamento. Aguarde alguns segundos.");
  return { assinatura, fiscais, marca: reserva.marca, linha: reserva.linha };
}

/**
 * "Gerar o Pix" e "Gerar o boleto": a cobrança em aberto, com o Pix (copia e
 * cola) ou a linha digitável e o PDF. O cartão tem a função dele.
 */
export async function gerarCobranca(
  admin: SupabaseClient,
  p: { orgId: string; userId: string; forma: Exclude<FormaDoPagamento, "cartao">; requestId: string },
  deps: DependenciasDoPasso = {},
): Promise<ResultadoDoPasso> {
  const agora = (deps.agora ?? (() => new Date()))();
  const ctx = await abrir(admin, p.orgId, deps, agora);
  if ("ok" in ctx) return ctx;
  if (p.forma === "boleto" && veioDoFimDoTeste(ctx.linha, ctx.assinatura)) {
    await soltar(admin, p.orgId, ctx.marca);
    return recusa(422, "sem_boleto", "A primeira mensalidade depois do teste é por Pix ou cartão.");
  }
  const asaas = asaasDaMia(deps.asaas);
  try {
    const prep = await prepararCobranca(admin, { ...p, linha: ctx.linha, assinatura: ctx.assinatura, fiscais: ctx.fiscais }, deps);
    if ("ok" in prep) return prep;
    if (prep.cobranca.situacao === "paga" || prep.cobranca.situacao === "em_analise") {
      return { ok: true, passo: await conferirPagamento(admin, p.orgId, { forcar: true, podePagar: true }, deps) };
    }
    if (prep.assinaturaRef) await garantirNotaNaConfirmacao(admin, p.orgId, prep.assinaturaRef, deps.asaas);
    let cobranca = prep.cobranca;
    const campos: Record<string, unknown> = {
      plano_id: ctx.assinatura.plano_id,
      situacao: "aguardando",
      forma: p.forma,
      pagamento_ref: prep.pagamentoRef,
      assinatura_ref: prep.assinaturaRef,
      fatura_url: cobranca.faturaUrl,
      ...(prep.gerada ? { gerada_em: agora.toISOString(), lembrete_enviado_em: null } : {}),
    };
    const mesma = !prep.gerada && ctx.linha.pagamento_ref === prep.pagamentoRef;
    if (p.forma === "pix") {
      // A cobrança que estava no cartão (o recusado do fim do teste) passa a aceitar o Pix.
      const estavaNoCartao = cobranca.forma === "cartao";
      if (estavaNoCartao) cobranca = await asaas.mudarFormaDaCobranca(prep.pagamentoRef, "PIX");
      if (estavaNoCartao || !(mesma && ctx.linha.pix_copia_e_cola)) {
        const pix = await asaas.lerPix(prep.pagamentoRef);
        campos.pix_copia_e_cola = pix.copiaECola;
        campos.pix_gerado_em = agora.toISOString();
      }
    } else if (!(mesma && ctx.linha.boleto_linha)) {
      const hoje = dataCivilEmSaoPaulo(agora);
      if (cobranca.vencimento <= hoje) cobranca = await asaas.mudarVencimento(prep.pagamentoRef, somarDias(hoje, DIAS_DO_BOLETO));
      const linhaDigitavel = await asaas.lerLinhaDigitavel(prep.pagamentoRef);
      campos.boleto_linha = linhaDigitavel.linha;
      campos.boleto_url = cobranca.boletoUrl ?? cobranca.faturaUrl;
      campos.boleto_gerado_em = agora.toISOString();
      // A mudança do vencimento invalida o QR do Pix desta cobrança: ele é relido se a pessoa voltar ao Pix.
      campos.pix_copia_e_cola = null;
    }
    campos.valor_cents = cobranca.valorCents > 0 ? cobranca.valorCents : null;
    campos.vence_em = cobranca.vencimento;
    const { error } = await admin.from("mia_pagamento_inicial").update(campos).eq("organization_id", p.orgId).eq("reserva_ate", ctx.marca);
    if (error) return recusa(500, "internal_error", "A cobrança foi gerada, mas não conseguimos mostrá-la. Recarregue a página.");
    void audit({
      action: "pagamento_inicial.cobranca_gerada",
      actorUserId: p.userId,
      organizationId: p.orgId,
      resourceType: "mia_pagamento_inicial",
      resourceId: p.orgId,
      requestId: p.requestId,
      metadata: { forma: p.forma, plano_id: ctx.assinatura.plano_id, nova: prep.gerada, refeita: prep.refeita },
    });
  } catch (e) {
    return falhaDoAsaas(e, p.orgId, `gerar_${p.forma}`);
  } finally {
    await soltar(admin, p.orgId, ctx.marca);
  }
  return { ok: true, passo: await lerPassoDoPagamento(admin, p.orgId, { podePagar: true }, deps) };
}

/**
 * O cartão digitado na tela (checkout transparente, decisão 2a). O cartão vive
 * só nesta chamada: vai ao Asaas e some. Aprovado, as próximas mensalidades
 * passam a cair nele (o token do Asaas, ou o mesmo cartão, na mesma requisição).
 */
export async function pagarComCartaoNoPasso(
  admin: SupabaseClient,
  p: { orgId: string; userId: string; cartao: CartaoDigitado; ipRemoto: string | null; requestId: string },
  deps: DependenciasDoPasso = {},
): Promise<ResultadoDoPasso> {
  const agora = (deps.agora ?? (() => new Date()))();
  const ctx = await abrir(admin, p.orgId, deps, agora);
  if ("ok" in ctx) return ctx;
  let resultado: "pago" | "em_analise" | "pendente" | "recusado" | "falhou" = "falhou";
  let tentou = false;
  try {
    const prep = await prepararCobranca(
      admin,
      { orgId: p.orgId, userId: p.userId, forma: "cartao", requestId: p.requestId, linha: ctx.linha, assinatura: ctx.assinatura, fiscais: ctx.fiscais },
      deps,
    );
    if ("ok" in prep) return prep;
    if (prep.assinaturaRef) await garantirNotaNaConfirmacao(admin, p.orgId, prep.assinaturaRef, deps.asaas);
    const base: Record<string, unknown> = {
      plano_id: ctx.assinatura.plano_id,
      forma: "cartao",
      pagamento_ref: prep.pagamentoRef,
      assinatura_ref: prep.assinaturaRef,
      fatura_url: prep.cobranca.faturaUrl,
      valor_cents: prep.cobranca.valorCents > 0 ? prep.cobranca.valorCents : null,
      vence_em: prep.cobranca.vencimento,
      ...(prep.gerada ? { gerada_em: agora.toISOString(), lembrete_enviado_em: null } : {}),
    };
    if (prep.cobranca.situacao === "paga" || prep.cobranca.situacao === "em_analise") {
      await admin.from("mia_pagamento_inicial").update(base).eq("organization_id", p.orgId);
      resultado = prep.cobranca.situacao === "paga" ? "pago" : "em_analise";
    } else {
      const email = (await (deps.emailDoAdmin ?? emailDoAdminDaEmpresa)(admin, p.orgId)) ?? "";
      const titular: TitularDoCartao = {
        nome: ctx.fiscais.razao_social,
        email,
        documento: ctx.fiscais.documento,
        cep: ctx.fiscais.cep,
        numeroDoEndereco: ctx.fiscais.numero,
        complemento: ctx.fiscais.complemento,
        telefone: telefoneNacional(ctx.fiscais.telefone) ?? "",
      };
      tentou = true;
      const r = await pagarComCartao({ pagamentoRef: prep.pagamentoRef, cartao: p.cartao, titular }, deps.asaas);
      resultado = r.tipo;
      if (r.tipo === "pago" || r.tipo === "em_analise" || r.tipo === "pendente") {
        // As próximas mensalidades no mesmo cartão: o token (ou o cartão) na assinatura, agora.
        const recorrente =
          prep.assinaturaRef === null
            ? { ok: false as const, codigo: "sem_assinatura" }
            : await cartaoNaAssinatura(
                { assinaturaRef: prep.assinaturaRef, cartao: p.cartao, token: r.token, titular, ipRemoto: p.ipRemoto },
                deps.asaas,
              );
        await admin
          .from("mia_pagamento_inicial")
          .update({
            ...base,
            // "pago" só pela releitura do upstream (a conferência logo abaixo): ela é que libera.
            situacao: r.tipo === "em_analise" ? "em_analise" : "aguardando",
            cartao_final: r.final,
            cartao_bandeira: r.bandeira,
            cartao_recorrente: recorrente.ok ? "ok" : "falhou",
          })
          .eq("organization_id", p.orgId);
        if (!recorrente.ok) logger.warn("pagamento_inicial.cartao_nao_ficou_na_assinatura", { organization_id: p.orgId, codigo: recorrente.codigo });
      } else if (r.tipo === "recusado") {
        await admin
          .from("mia_pagamento_inicial")
          .update({ ...base, situacao: "recusado", cartao_recusas: ctx.linha.cartao_recusas + 1, cartao_recusado_em: agora.toISOString() })
          .eq("organization_id", p.orgId);
      } else {
        await admin.from("mia_pagamento_inicial").update({ ...base, situacao: "aguardando" }).eq("organization_id", p.orgId);
      }
    }
  } catch (e) {
    return falhaDoAsaas(e, p.orgId, "cartao");
  } finally {
    await soltar(admin, p.orgId, ctx.marca);
    if (tentou) {
      void audit({
        action: "pagamento_inicial.cartao_tentado",
        actorUserId: p.userId,
        organizationId: p.orgId,
        resourceType: "mia_pagamento_inicial",
        resourceId: p.orgId,
        requestId: p.requestId,
        // Só o resultado. O cartão nunca entra na auditoria.
        metadata: { resultado },
      });
    }
  }
  if (resultado === "pago" || resultado === "em_analise") {
    const passo = await conferirPagamento(admin, p.orgId, { forcar: true, podePagar: true }, deps);
    return { ok: true, passo };
  }
  if (resultado === "recusado") {
    return recusa(402, "cartao_recusado", "O banco recusou o cartão. Confira os dados, tente outro cartão ou pague por Pix, que libera na hora.", {
      passo: await lerPassoDoPagamento(admin, p.orgId, { podePagar: true }, deps),
    });
  }
  if (resultado === "falhou") {
    return recusa(502, "cartao_sem_resposta", "Não tivemos a resposta do Asaas. Confira em alguns segundos se o pagamento entrou antes de tentar de novo.");
  }
  return { ok: true, passo: await lerPassoDoPagamento(admin, p.orgId, { podePagar: true }, deps) };
}

/**
 * Pagou e a releitura do upstream já liberou: a linha passa a "pago", com a
 * forma e a data. Barato (só banco), idempotente; o aviso do Asaas e a rodada
 * chamam. `info` vem da leitura da cobrança, quando houve. Nunca lança.
 */
export async function marcarPagoSeLiberou(
  admin: SupabaseClient,
  orgId: string,
  info: { forma?: string | null; pagaEm?: string | null } = {},
): Promise<boolean> {
  try {
    const [assinatura, linha] = await Promise.all([lerAssinatura(admin, orgId), lerLinha(admin, orgId)]);
    if (!upstreamRegistrouPagamento(assinatura) || !linha || linha.situacao === "pago") return false;
    const formaPaga = info.forma === "pix" || info.forma === "boleto" || info.forma === "cartao" ? info.forma : (linha.forma ?? "outra");
    const { data } = await admin
      .from("mia_pagamento_inicial")
      .update({
        situacao: "pago",
        pago_em: info.pagaEm ? `${info.pagaEm.slice(0, 10)}T12:00:00-03:00` : new Date().toISOString(),
        forma_paga: formaPaga,
        reserva_ate: null,
      })
      .eq("organization_id", orgId)
      .neq("situacao", "pago")
      .select("organization_id")
      .maybeSingle();
    if (!data) return false;
    void audit({
      action: "pagamento_inicial.confirmado",
      actorUserId: null,
      bypassedRls: true,
      organizationId: orgId,
      resourceType: "mia_pagamento_inicial",
      resourceId: orgId,
      metadata: { forma: formaPaga, plano_id: linha.plano_id },
    });
    return true;
  } catch (e) {
    logger.warn("pagamento_inicial.marcar_pago_falhou", { organization_id: orgId, detalhe: e instanceof Error ? e.message : "desconhecido" });
    return false;
  }
}

/**
 * A conferência da tela: ao abrir e a cada poucos segundos com ela aberta. Lê
 * a cobrança DIRETO no Asaas (no máximo uma vez a cada
 * `INTERVALO_DA_CONFERENCIA_MS` por empresa, salvo `forcar`); paga, roda a
 * releitura do upstream (que libera) e marca. Leitura que falha não muda nada.
 */
export async function conferirPagamento(
  admin: SupabaseClient,
  orgId: string,
  opcoes: { forcar?: boolean; podePagar: boolean },
  deps: DependenciasDoPasso = {},
): Promise<PassoDoPagamento> {
  const agora = (deps.agora ?? (() => new Date()))();
  try {
    const linha = await lerLinha(admin, orgId);
    if (linha?.pagamento_ref && linha.situacao !== "pago") {
      const limite = new Date(agora.getTime() - INTERVALO_DA_CONFERENCIA_MS).toISOString();
      let q = admin.from("mia_pagamento_inicial").update({ conferido_em: agora.toISOString() }).eq("organization_id", orgId);
      if (!opcoes.forcar) q = q.or(`conferido_em.is.null,conferido_em.lt."${limite}"`);
      const { data: vez } = await q.select("organization_id").maybeSingle();
      if (vez) {
        const c = await asaasDaMia(deps.asaas).lerCobranca(linha.pagamento_ref);
        if (c.situacao === "paga") {
          await (deps.sincronizar ?? sincronizar)(admin, orgId);
          await marcarPagoSeLiberou(admin, orgId, { forma: c.forma, pagaEm: c.pagaEm });
        } else if (c.situacao === "em_analise" && linha.situacao !== "em_analise") {
          await admin.from("mia_pagamento_inicial").update({ situacao: "em_analise" }).eq("organization_id", orgId);
        } else if (c.situacao === "cancelada" || c.situacao === "estornada") {
          // Apagada no Asaas (por fora): a tela oferece gerar de novo.
          await admin.from("mia_pagamento_inicial").update({ ...SEM_COBRANCA }).eq("organization_id", orgId).neq("situacao", "pago");
        }
      }
    } else if (linha && linha.situacao !== "pago") {
      await marcarPagoSeLiberou(admin, orgId);
    }
  } catch (e) {
    logger.warn("pagamento_inicial.conferencia_falhou", { organization_id: orgId, codigo: codigoDoErro(e) });
  }
  return lerPassoDoPagamento(admin, orgId, { podePagar: opcoes.podePagar }, deps);
}

/** O que o passo precisa ler para decidir uma escrita. */
async function lerParaEscrever(admin: SupabaseClient, orgId: string, deps: DependenciasDoPasso) {
  const ligada = await (deps.cobrancaLigada ?? (() => moduloLigado(admin, "cobranca")))();
  const [assinatura, linha, org] = await Promise.all([
    ligada ? lerAssinatura(admin, orgId) : Promise.resolve(null),
    lerLinha(admin, orgId),
    admin.from("organizations").select("onboarded_at").eq("id", orgId).maybeSingle(),
  ]);
  const onboardedAt = (org.data as { onboarded_at?: string | null } | null)?.onboarded_at ?? null;
  const modo = modoDoPasso({ ligada, assinatura, linha, onboardedAt });
  return { assinatura, linha, modo };
}

/**
 * Trocar de plano no passo do pagamento, antes de pagar (decisão 7): entre os
 * planos visíveis às empresas. A cobrança gerada (ou o cartão cadastrado no
 * teste) é cancelada no Asaas e a escolha recomeça no plano novo.
 *   - entrada paga → plano com teste: a empresa entra no teste na hora e é liberada;
 *   - teste → plano de entrada paga: a empresa passa a esperar o primeiro
 *     pagamento (parada, como no cadastro), e o passo vira o da entrada paga;
 *   - teste → outro plano com teste: o fim do teste não muda.
 * A empresa que o fim do teste bloqueou não troca por aqui: ela paga a primeira
 * mensalidade do plano que testou (a troca de plano de quem já usa é a de
 * Plano e cobrança, do upstream).
 */
export async function trocarPlanoAntesDePagar(
  admin: SupabaseClient,
  p: { orgId: string; userId: string; planoId: string; requestId: string },
  deps: DependenciasDoPasso = {},
): Promise<ResultadoDoPasso> {
  const agora = (deps.agora ?? (() => new Date()))();
  const { assinatura, linha, modo } = await lerParaEscrever(admin, p.orgId, deps);
  if (!assinatura || modo === null || veioDoFimDoTeste(linha, assinatura)) {
    return recusa(409, "sem_passo", "Esta empresa não tem o passo do pagamento.");
  }
  if (pagouAPrimeira(linha, assinatura)) return recusa(409, "ja_pago", "O pagamento já foi confirmado. Siga para o próximo passo.");
  if (assinatura.plano_id === p.planoId) return recusa(409, "mesmo_plano", "A empresa já está neste plano.");
  const { data: plano, error: erroDoPlano } = await admin
    .from("cobranca_planos")
    .select(COLUNAS_DO_PLANO)
    .eq("id", p.planoId)
    .is("arquivado_em", null)
    .eq("oferecido_ao_cliente", true)
    .maybeSingle();
  if (erroDoPlano) return recusa(500, "internal_error", "Não foi possível ler os planos.");
  if (!plano) return recusa(422, "plano_indisponivel", "Esse plano não está disponível. Escolha outro.");
  const novo = paraPlano(plano as Record<string, unknown>);
  const reserva = await reservar(admin, p.orgId, assinatura.plano_id, agora);
  if (!reserva) return recusa(409, "em_andamento", "Já estamos cuidando deste pagamento. Aguarde alguns segundos.");
  try {
    const asaas = asaasDaMia(deps.asaas);
    if (reserva.linha.pagamento_ref) {
      const atual = await asaas.lerCobranca(reserva.linha.pagamento_ref);
      if (atual.situacao === "paga" || atual.situacao === "em_analise") {
        await soltar(admin, p.orgId, reserva.marca);
        await conferirPagamento(admin, p.orgId, { forcar: true, podePagar: true }, deps);
        return recusa(409, "ja_pago", "O pagamento já foi confirmado. Siga para o próximo passo.");
      }
    }
    const cobrancaCancelada = Boolean(reserva.linha.pagamento_ref || assinatura.provedor_assinatura_id);
    if (cobrancaCancelada) await cancelarCobrancaAtual(admin, p.orgId, reserva.linha, assinatura, asaas, modo);
    const vaiParaTeste = novo.trial_dias > 0;
    const campos: Record<string, unknown> = { plano_id: novo.id, plano_agendado_id: null, updated_at: agora.toISOString() };
    if (modo === "entrada_paga" && vaiParaTeste) {
      Object.assign(campos, {
        estado: "trial",
        trial_ate: new Date(agora.getTime() + novo.trial_dias * 86_400_000).toISOString(),
        pagamento_inicial_pendente: false,
        vencida_desde: null,
        ultimo_aviso: null,
        ultimo_aviso_em: null,
      });
    } else if (modo === "teste" && !vaiParaTeste) {
      Object.assign(campos, {
        estado: "trial",
        trial_ate: agora.toISOString(),
        pagamento_inicial_pendente: true,
        vencida_desde: null,
        ultimo_aviso: null,
        ultimo_aviso_em: null,
      });
    }
    const { error } = await admin
      .from("cobranca_assinaturas")
      .update(campos)
      .eq("organization_id", p.orgId)
      .eq(modo === "teste" ? "estado" : "pagamento_inicial_pendente", modo === "teste" ? "trial" : true);
    if (error) return recusa(500, "internal_error", "Não foi possível trocar o plano. Tente de novo.");
    if (modo === "entrada_paga" && vaiParaTeste) {
      const { error: erroDaVolta } = await admin.rpc("fn_reativar_organizacao", { p_org: p.orgId, p_kind_exigido: "cobranca", p_ator: p.userId });
      if (erroDaVolta) logger.warn("pagamento_inicial.reativacao_do_teste_falhou", { organization_id: p.orgId, codigo: erroDaVolta.code ?? null });
    } else if (modo === "teste" && !vaiParaTeste) {
      // O mesmo bloqueio que o gatilho da entrada paga do upstream (0679) põe no cadastro.
      const { error: erroDaParada } = await admin.rpc("fn_suspender_organizacao", {
        p_org: p.orgId,
        p_kind: "cobranca",
        p_motivo: MOTIVO_DA_ENTRADA_PAGA,
        p_ator: p.userId,
      });
      if (erroDaParada) logger.warn("pagamento_inicial.parada_da_entrada_paga_falhou", { organization_id: p.orgId, codigo: erroDaParada.code ?? null });
    }
    const novoModo: ModoDoPasso = vaiParaTeste ? "teste" : "entrada_paga";
    await admin
      .from("mia_pagamento_inicial")
      .update({
        ...SEM_COBRANCA,
        modo: novoModo,
        plano_id: novo.id,
        forma: null,
        primeira_cobranca_em: null,
        cartao_final: null,
        cartao_bandeira: null,
        cartao_recorrente: null,
        cobrancas_refeitas: reserva.linha.cobrancas_refeitas + (cobrancaCancelada ? 1 : 0),
      })
      .eq("organization_id", p.orgId);
    await seguirOPlano(admin, p.orgId, "troca");
    void audit({
      action: "pagamento_inicial.plano_trocado",
      actorUserId: p.userId,
      organizationId: p.orgId,
      resourceType: "cobranca_assinatura",
      resourceId: p.orgId,
      requestId: p.requestId,
      metadata: { de: assinatura.plano_id, para: novo.id, modo_antes: modo, modo_depois: novoModo, cobranca_cancelada: cobrancaCancelada },
    });
  } catch (e) {
    return falhaDoAsaas(e, p.orgId, "trocar_plano");
  } finally {
    await soltar(admin, p.orgId, reserva.marca);
  }
  return { ok: true, passo: await lerPassoDoPagamento(admin, p.orgId, { podePagar: true }, deps) };
}

/**
 * "Corrigir" (ou preencher) os dados fiscais no passo, antes de qualquer
 * pagamento, inclusive o CPF ou CNPJ (quem errou um número no cadastro). O
 * WhatsApp é obrigatório aqui: o Asaas pede um telefone no cartão. O cliente
 * do Asaas, se já existe, recebe na hora.
 */
export async function corrigirDadosFiscais(
  admin: SupabaseClient,
  p: { orgId: string; userId: string; entrada: unknown; requestId: string },
  deps: DependenciasDoPasso = {},
): Promise<ResultadoDoPasso> {
  const conferido = conferirDadosFiscais(p.entrada, { exigeTelefone: true });
  if (!conferido.ok) return recusa(422, "validation_failed", "Confira os dados da empresa.", { campos: conferido.campos });
  const { assinatura, linha, modo } = await lerParaEscrever(admin, p.orgId, deps);
  if (!assinatura || modo === null) return recusa(409, "sem_passo", "Esta empresa não tem o passo do pagamento.");
  const gravado = await gravarDadosFiscais(admin, p.orgId, conferido.dados, {
    userId: p.userId,
    // Depois do primeiro pagamento, o titular muda só pela Time (decisão 10).
    permitirTrocarDocumento: !pagouAPrimeira(linha, assinatura),
  });
  if (!gravado.ok) {
    return gravado.motivo === "documento_nao_muda"
      ? recusa(409, "documento_nao_muda", "O CPF ou CNPJ não muda depois do primeiro pagamento. Peça à Time.")
      : recusa(500, "internal_error", "Não foi possível salvar os dados. Tente de novo.");
  }
  void audit({
    action: "dados_fiscais.gravados",
    actorUserId: p.userId,
    organizationId: p.orgId,
    resourceType: "mia_dados_fiscais",
    resourceId: p.orgId,
    requestId: p.requestId,
    // Nunca o documento: só o tipo e se ele mudou.
    metadata: { onde: "passo_do_pagamento", tipo: conferido.dados.tipo, mudou_documento: gravado.mudouDocumento },
  });
  if (assinatura.provedor_cliente_id) {
    try {
      const email = await (deps.emailDoAdmin ?? emailDoAdminDaEmpresa)(admin, p.orgId);
      await asaasDaMia(deps.asaas).garantirClienteFiscal({
        orgId: p.orgId,
        clienteRef: assinatura.provedor_cliente_id,
        dados: conferido.dados,
        email,
      });
      await marcarDadosFiscaisNoAsaas(admin, p.orgId, gravado.dados.updated_at);
    } catch (e) {
      // A rodada leva ao Asaas depois (asaas_sincronizado_em continua nulo).
      logger.warn("pagamento_inicial.dados_fiscais_nao_foram_ao_asaas", { organization_id: p.orgId, codigo: codigoDoErro(e) });
    }
  }
  return { ok: true, passo: await lerPassoDoPagamento(admin, p.orgId, { podePagar: true }, deps) };
}

/** As guardas do modo teste e a reserva. */
async function abrirNoTeste(admin: SupabaseClient, orgId: string, deps: DependenciasDoPasso, agora: Date) {
  const { assinatura, linha, modo } = await lerParaEscrever(admin, orgId, deps);
  if (!assinatura || modo !== "teste") return recusa(409, "sem_passo", "Esta empresa não tem o passo do pagamento.");
  if (pagouAPrimeira(linha, assinatura)) return recusa(409, "ja_pago", "O pagamento já foi confirmado. Siga para o próximo passo.");
  const fiscais = await lerDadosFiscais(admin, orgId);
  if (!fiscais) {
    return recusa(409, "dados_fiscais_faltando", "Preencha os dados da empresa para a cobrança e a nota fiscal antes de escolher.");
  }
  const reserva = await reservar(admin, orgId, assinatura.plano_id, agora);
  if (!reserva) return recusa(409, "em_andamento", "Já estamos cuidando deste pagamento. Aguarde alguns segundos.");
  return { assinatura, fiscais, marca: reserva.marca, linha: reserva.linha };
}

/**
 * Modo teste (decisão 12 revista): a primeira mensalidade por PIX. Nada é
 * cobrado hoje e nada vai ao Asaas agora: o Pix é gerado 3 dias antes do fim
 * do teste, com o aviso (`lib/pagamento-inicial/fim-do-teste.ts`). Boleto fica
 * fora nesta primeira mensalidade: a compensação demora e a pessoa ficaria
 * bloqueada tendo pago. Se havia um cartão cadastrado neste passo, a assinatura
 * dele é cancelada (para o cartão não ser debitado).
 */
export async function escolherPixNoTeste(
  admin: SupabaseClient,
  p: { orgId: string; userId: string; requestId: string },
  deps: DependenciasDoPasso = {},
): Promise<ResultadoDoPasso> {
  const agora = (deps.agora ?? (() => new Date()))();
  const ctx = await abrirNoTeste(admin, p.orgId, deps, agora);
  if ("ok" in ctx) return ctx;
  try {
    const tinhaCartao = Boolean(ctx.assinatura.provedor_assinatura_id || ctx.linha.assinatura_ref);
    if (tinhaCartao) await cancelarCobrancaAtual(admin, p.orgId, ctx.linha, ctx.assinatura, asaasDaMia(deps.asaas), "teste");
    const fim = ctx.assinatura.trial_ate ? dataCivilEmSaoPaulo(new Date(ctx.assinatura.trial_ate)) : null;
    const { error } = await admin
      .from("mia_pagamento_inicial")
      .update({
        ...SEM_COBRANCA,
        modo: "teste",
        situacao: "escolhida",
        forma: "pix",
        plano_id: ctx.assinatura.plano_id,
        primeira_cobranca_em: fim,
        cartao_final: null,
        cartao_bandeira: null,
        cartao_recorrente: null,
      })
      .eq("organization_id", p.orgId)
      .eq("reserva_ate", ctx.marca);
    if (error) return recusa(500, "internal_error", "Não foi possível salvar a escolha. Tente de novo.");
    void audit({
      action: "pagamento_inicial.forma_escolhida",
      actorUserId: p.userId,
      organizationId: p.orgId,
      resourceType: "mia_pagamento_inicial",
      resourceId: p.orgId,
      requestId: p.requestId,
      metadata: { modo: "teste", forma: "pix", cartao_cancelado: tinhaCartao },
    });
  } catch (e) {
    return falhaDoAsaas(e, p.orgId, "teste_pix");
  } finally {
    await soltar(admin, p.orgId, ctx.marca);
  }
  return { ok: true, passo: await lerPassoDoPagamento(admin, p.orgId, { podePagar: true }, deps) };
}

/**
 * Modo teste (decisão 12 revista): o cartão cadastrado AGORA, sem cobrar nada,
 * pelo mesmo checkout transparente. Por baixo é a assinatura do upstream, que
 * no teste nasce com o primeiro vencimento no FIM do teste; o cartão vai para
 * ela sem cobrança (`cartaoNaAssinatura`), e o Asaas debita sozinho naquele dia.
 * Recusado, a assinatura recém-criada é cancelada (nada fica pendurado) e a
 * pessoa tenta outro cartão ou escolhe o Pix. O cartão vive só nesta chamada:
 * nada é gravado além do final e da bandeira.
 */
export async function cadastrarCartaoNoTeste(
  admin: SupabaseClient,
  p: { orgId: string; userId: string; cartao: CartaoDigitado; ipRemoto: string | null; requestId: string },
  deps: DependenciasDoPasso = {},
): Promise<ResultadoDoPasso> {
  const agora = (deps.agora ?? (() => new Date()))();
  const ctx = await abrirNoTeste(admin, p.orgId, deps, agora);
  if ("ok" in ctx) return ctx;
  let resultado: "cadastrado" | "recusado" | "falhou" = "falhou";
  let tentou = false;
  try {
    const asaas = asaasDaMia(deps.asaas);
    let assinaturaRef = ctx.assinatura.provedor_assinatura_id;
    let pagamentoRef = ctx.assinatura.checkout_sessao_id?.startsWith("pay_") ? ctx.assinatura.checkout_sessao_id : null;
    let criada = false;
    const email = await (deps.emailDoAdmin ?? emailDoAdminDaEmpresa)(admin, p.orgId);
    if (!assinaturaRef) {
      await asaas.garantirClienteFiscal({ orgId: p.orgId, clienteRef: ctx.assinatura.provedor_cliente_id, dados: ctx.fiscais, email });
      await marcarDadosFiscaisNoAsaas(admin, p.orgId, ctx.fiscais.updated_at);
      const r = await (deps.gerarLink ?? gerarLinkDePagamento)(admin, {
        orgId: p.orgId,
        documentoBruto: ctx.fiscais.documento,
        email,
        chaveIdempotencia: randomUUID(),
        urlDeVolta: urlDoHub(),
        actorUserId: p.userId,
        requestId: p.requestId,
        comoDono: false,
      });
      if (!r.ok && r.code !== "pagamento_em_andamento") return recusa(r.status, r.code, r.message);
      const depois = await lerAssinatura(admin, p.orgId);
      assinaturaRef = depois?.provedor_assinatura_id ?? null;
      pagamentoRef = depois?.checkout_sessao_id?.startsWith("pay_") ? depois.checkout_sessao_id : null;
      criada = true;
    }
    if (!assinaturaRef) return recusa(503, "provedor_recusou", "O Asaas ainda não criou a assinatura. Tente de novo em alguns segundos.");
    if (!pagamentoRef) {
      pagamentoRef =
        (await asaas.listarCobrancasDaAssinatura(assinaturaRef)).find((c) => c.situacao === "aberta" || c.situacao === "vencida")?.ref ?? null;
    }
    await garantirNotaNaConfirmacao(admin, p.orgId, assinaturaRef, deps.asaas);
    const titular: TitularDoCartao = {
      nome: ctx.fiscais.razao_social,
      email: email ?? "",
      documento: ctx.fiscais.documento,
      cep: ctx.fiscais.cep,
      numeroDoEndereco: ctx.fiscais.numero,
      complemento: ctx.fiscais.complemento,
      telefone: telefoneNacional(ctx.fiscais.telefone) ?? "",
    };
    tentou = true;
    const rec = await cartaoNaAssinatura({ assinaturaRef, cartao: p.cartao, token: null, titular, ipRemoto: p.ipRemoto }, deps.asaas);
    if (!rec.ok) {
      resultado = rec.codigo === "sem_resposta" || rec.codigo === "provedor_fora" ? "falhou" : "recusado";
      // A assinatura que nasceu agora sem cartão emitiria no fim do teste uma
      // fatura que ninguém escolheu: sai, e a pessoa decide de novo.
      if (criada) {
        await cancelarCobrancaAtual(admin, p.orgId, ctx.linha, { ...ctx.assinatura, provedor_assinatura_id: assinaturaRef }, asaas, "teste");
      }
      await admin
        .from("mia_pagamento_inicial")
        .update({
          ...SEM_COBRANCA,
          modo: "teste",
          situacao: resultado === "recusado" ? "recusado" : "sem_cobranca",
          forma: "cartao",
          cartao_recusas: ctx.linha.cartao_recusas + (resultado === "recusado" ? 1 : 0),
          ...(resultado === "recusado" ? { cartao_recusado_em: agora.toISOString() } : {}),
        })
        .eq("organization_id", p.orgId);
    } else {
      const cobranca = pagamentoRef ? await asaas.lerCobranca(pagamentoRef).catch(() => null) : null;
      const fim = cobranca?.vencimento ?? (ctx.assinatura.trial_ate ? dataCivilEmSaoPaulo(new Date(ctx.assinatura.trial_ate)) : null);
      await admin
        .from("mia_pagamento_inicial")
        .update({
          ...SEM_COBRANCA,
          modo: "teste",
          situacao: "escolhida",
          forma: "cartao",
          plano_id: ctx.assinatura.plano_id,
          pagamento_ref: pagamentoRef,
          assinatura_ref: assinaturaRef,
          valor_cents: cobranca && cobranca.valorCents > 0 ? cobranca.valorCents : null,
          vence_em: cobranca?.vencimento ?? null,
          primeira_cobranca_em: fim,
          // Do cartão, só o que se mostra a quem digitou: o final e a bandeira.
          cartao_final: cobranca?.cartaoFinal ?? finalDigitado(p.cartao.numero),
          cartao_bandeira: cobranca?.cartaoBandeira ?? null,
          cartao_recorrente: "ok",
        })
        .eq("organization_id", p.orgId);
      resultado = "cadastrado";
    }
  } catch (e) {
    return falhaDoAsaas(e, p.orgId, "teste_cartao");
  } finally {
    await soltar(admin, p.orgId, ctx.marca);
    if (tentou) {
      void audit({
        action: "pagamento_inicial.cartao_tentado",
        actorUserId: p.userId,
        organizationId: p.orgId,
        resourceType: "mia_pagamento_inicial",
        resourceId: p.orgId,
        requestId: p.requestId,
        // Só o resultado. O cartão nunca entra na auditoria.
        metadata: { modo: "teste", resultado },
      });
    }
  }
  if (resultado === "recusado") {
    return recusa(402, "cartao_recusado", "O banco recusou o cartão. Confira os dados, tente outro cartão ou escolha o Pix.", {
      passo: await lerPassoDoPagamento(admin, p.orgId, { podePagar: true }, deps),
    });
  }
  if (resultado === "falhou") {
    return recusa(502, "cartao_sem_resposta", "Não tivemos a resposta do Asaas. Tente de novo em alguns segundos.");
  }
  return { ok: true, passo: await lerPassoDoPagamento(admin, p.orgId, { podePagar: true }, deps) };
}

/**
 * O aviso do Asaas chegou (lib/cobranca/sinal.handler.ts, depois da releitura
 * do upstream): se a primeira cobrança foi paga e a empresa já foi liberada, a
 * linha passa a "pago", com a forma e a data lidas na cobrança. Nunca lança.
 */
export async function marcarPagoPeloAviso(admin: SupabaseClient, orgId: string, deps: DependenciasDoPasso = {}): Promise<void> {
  try {
    const linha = await lerLinha(admin, orgId);
    if (!linha?.pagamento_ref || linha.situacao === "pago") return;
    let info: { forma?: string | null; pagaEm?: string | null } = {};
    try {
      const c = await asaasDaMia(deps.asaas).lerCobranca(linha.pagamento_ref);
      if (c.situacao !== "paga") return;
      info = { forma: c.forma, pagaEm: c.pagaEm };
    } catch {
      // Sem a leitura, marca com a forma escolhida (a liberação é que importa).
    }
    await marcarPagoSeLiberou(admin, orgId, info);
  } catch {
    // A rodada horária cura.
  }
}
