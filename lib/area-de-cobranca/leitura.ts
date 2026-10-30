/**
 * FORK MIA (.96) · A ÁREA DE COBRANÇA, A LEITURA (Configurações › Plano e
 * cobrança; protótipo "Pagamento no início", tela 3; docs/fork/area-de-cobranca.md).
 *
 * Junta, para o ADMINISTRADOR da empresa (quem chama confere o papel):
 *   - as cobranças do cliente do Asaas desta empresa, com a nota fiscal de cada
 *     uma (PDF e XML), o recibo, a fatura para pagar e a segunda via;
 *   - o chamado "A nota saiu errada" de cada cobrança (`mia_chamados`, pela marca
 *     `contexto.cobranca.ref` que a rota grava);
 *   - a forma das próximas mensalidades: o cartão (final e bandeira) e o dia da
 *     próxima, pela assinatura no Asaas e pelo cartão trocado aqui (9125);
 *   - os dados fiscais (9120).
 *
 * Só LÊ, com o cliente de serviço. Asaas que não responde não derruba a tela: a
 * lista diz "falhou" e o resto (forma e dados fiscais) aparece pelo banco.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DependenciasDoAsaasDaMia } from "@/lib/asaas-mia/api";
import { codigoDoErro } from "@/lib/asaas-mia/api";
import { asaasDaMia, type CobrancaLida, type NotaLida } from "@/lib/asaas-mia/cobrancas";
import { lerDadosFiscais, type DadosFiscaisGravados } from "@/lib/dados-fiscais/banco";
import { enderecoEmUmaLinha, formatarDocumento } from "@/lib/dados-fiscais/regras";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { logger } from "@/lib/logger";

import { lerAssinaturaNoAsaas, type AssinaturaLidaNoAsaas } from "./asaas";
import { cobrancaEmAberto, MOTIVOS_DA_NOTA_ERRADA, notaDaCobranca, situacaoNaArea, type MotivoDaNotaErrada } from "./regras";
import type { AreaDeCobranca, CobrancaDaArea, FiscaisDaArea, FormaDasMensalidades } from "./tipos";

export interface DependenciasDaArea {
  asaas?: DependenciasDoAsaasDaMia;
  cobrancaLigada?: () => Promise<boolean>;
}

/** Quantas cobranças a tela mostra (as mais novas). */
export const TETO_DA_LISTA = 36;

interface AssinaturaDaEmpresa {
  provedor: string | null;
  provedor_cliente_id: string | null;
  provedor_assinatura_id: string | null;
}

export async function lerAssinaturaDaEmpresa(admin: SupabaseClient, orgId: string): Promise<AssinaturaDaEmpresa | null> {
  const { data, error } = await admin
    .from("cobranca_assinaturas")
    .select("provedor, provedor_cliente_id, provedor_assinatura_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`área de cobrança: assinatura ilegível (${error.code ?? "sem_codigo"})`);
  return (data as AssinaturaDaEmpresa | null) ?? null;
}

export function fiscaisDaArea(d: DadosFiscaisGravados): FiscaisDaArea {
  return {
    tipo: d.tipo,
    documento: formatarDocumento(d.documento),
    razao_social: d.razao_social,
    endereco: enderecoEmUmaLinha(d),
    inscricao_municipal: d.inscricao_municipal,
    inscricao_estadual: d.inscricao_estadual,
    no_asaas: d.asaas_sincronizado_em !== null,
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

/** O chamado "A nota saiu errada" mais novo de cada cobrança. Nunca lança (sem chamado, sem marca). */
export async function correcoesPedidas(
  admin: SupabaseClient,
  orgId: string,
): Promise<Map<string, NonNullable<CobrancaDaArea["correcao"]>>> {
  const mapa = new Map<string, NonNullable<CobrancaDaArea["correcao"]>>();
  try {
    const { data, error } = await admin
      .from("mia_chamados")
      .select("numero, situacao, created_at, cobranca_ref:contexto->cobranca->>ref, motivo:contexto->cobranca->>motivo")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return mapa;
    for (const c of (data ?? []) as Array<{ numero: number; situacao: string; cobranca_ref: string | null; motivo: string | null }>) {
      if (!c.cobranca_ref || mapa.has(c.cobranca_ref)) continue;
      const situacao = c.situacao === "em_analise" || c.situacao === "resolvido" ? c.situacao : "novo";
      const motivo = (MOTIVOS_DA_NOTA_ERRADA as readonly string[]).includes(c.motivo ?? "") ? (c.motivo as MotivoDaNotaErrada) : null;
      mapa.set(c.cobranca_ref, { chamado: Number(c.numero), situacao, motivo });
    }
  } catch {
    // Sem a marca, a cobrança mostra o botão de novo; o chamado continua na Time.
  }
  return mapa;
}

export function paraCobrancaDaArea(
  c: CobrancaLida,
  notas: readonly NotaLida[],
  correcoes: ReadonlyMap<string, NonNullable<CobrancaDaArea["correcao"]>>,
): CobrancaDaArea {
  const situacao = situacaoNaArea(c);
  const aberta = cobrancaEmAberto(situacao);
  const nota = situacao === "paga" || situacao === "estornada" ? notaDaCobranca(notas, c.ref) : null;
  return {
    ref: c.ref,
    vencimento: c.vencimento,
    valor_cents: c.valorCents,
    forma: c.forma,
    cartao_final: c.cartaoFinal,
    situacao,
    paga_em: situacao === "paga" ? c.pagaEm : null,
    mensalidade: c.assinaturaRef !== null,
    descricao: c.assinaturaRef === null ? c.descricao : null,
    pagar_url: aberta ? c.faturaUrl : null,
    segunda_via_url: aberta ? (c.boletoUrl ?? c.faturaUrl) : null,
    recibo_url: situacao === "paga" ? c.reciboUrl : null,
    nota: nota ? { numero: nota.numero, situacao: nota.situacao, pdf_url: nota.pdfUrl, xml_url: nota.xmlUrl } : null,
    correcao: correcoes.get(c.ref) ?? null,
  };
}

interface CartaoGuardado {
  cartao_final: string;
  cartao_bandeira: string | null;
  assinatura_ref: string;
  trocado_em: string;
}

/**
 * A forma das próximas mensalidades. O cartão, nesta ordem: o que o Asaas diz
 * da assinatura; o trocado aqui (9125) para ESTA assinatura; a última
 * mensalidade paga no cartão; o do passo do pagamento (o primeiro). Puro.
 */
export function formaDasMensalidades(p: {
  assinaturaRef: string;
  noAsaas: AssinaturaLidaNoAsaas | null;
  trocado: CartaoGuardado | null;
  cobrancas: readonly CobrancaLida[];
  doPasso: { cartao_final: string | null; cartao_bandeira: string | null; cartao_recorrente: string | null; assinatura_ref: string | null } | null;
}): FormaDasMensalidades {
  const trocado = p.trocado && p.trocado.assinatura_ref === p.assinaturaRef ? p.trocado : null;
  const ultimaNoCartao = p.cobrancas
    .filter((c) => c.assinaturaRef === p.assinaturaRef && c.forma === "cartao" && c.cartaoFinal && c.situacao === "paga")
    .sort((a, b) => (b.pagaEm ?? b.vencimento).localeCompare(a.pagaEm ?? a.vencimento))[0];
  const passo = p.doPasso && p.doPasso.cartao_recorrente === "ok" && p.doPasso.cartao_final ? p.doPasso : null;
  // A troca feita aqui vale sobre a mensalidade paga ANTES dela.
  const trocaMaisNova = trocado && (!ultimaNoCartao || trocado.trocado_em.slice(0, 10) >= (ultimaNoCartao.pagaEm ?? ultimaNoCartao.vencimento));
  const cartao = p.noAsaas?.cartaoFinal
    ? { final: p.noAsaas.cartaoFinal, bandeira: p.noAsaas.cartaoBandeira }
    : trocaMaisNova && trocado
      ? { final: trocado.cartao_final, bandeira: trocado.cartao_bandeira }
      : ultimaNoCartao
        ? { final: ultimaNoCartao.cartaoFinal, bandeira: ultimaNoCartao.cartaoBandeira }
        : trocado
          ? { final: trocado.cartao_final, bandeira: trocado.cartao_bandeira }
          : passo
            ? { final: passo.cartao_final, bandeira: passo.cartao_bandeira }
            : null;
  const noCartao = p.noAsaas ? p.noAsaas.forma === "CREDIT_CARD" : cartao !== null;
  return {
    no_cartao: noCartao,
    cartao_final: noCartao ? (cartao?.final ?? null) : null,
    cartao_bandeira: noCartao ? (cartao?.bandeira ?? null) : null,
    proxima_em: p.noAsaas?.proximaEm ?? null,
    pode_trocar: p.noAsaas ? p.noAsaas.ativa : true,
  };
}

/**
 * A área inteira. `null` = a área não aparece (a cobrança está desligada, ou a
 * empresa é cobrada por outro provedor que não o Asaas). Nunca lança por causa
 * do Asaas; LANÇA só se o banco não responder.
 */
export async function lerAreaDeCobranca(
  admin: SupabaseClient,
  orgId: string,
  deps: DependenciasDaArea = {},
): Promise<AreaDeCobranca | null> {
  const ligada = await (deps.cobrancaLigada ?? (() => moduloLigado(admin, "cobranca")))();
  if (!ligada) return null;
  const [assinatura, dados] = await Promise.all([lerAssinaturaDaEmpresa(admin, orgId), lerDadosFiscais(admin, orgId)]);
  if (assinatura?.provedor && assinatura.provedor !== "asaas") return null;
  const fiscais = dados ? fiscaisDaArea(dados) : null;
  const cliente = assinatura?.provedor_cliente_id ?? null;
  if (!cliente) return { leitura: "sem_asaas", cobrancas: [], forma: null, fiscais };

  const asaas = asaasDaMia(deps.asaas);
  const sub = assinatura?.provedor_assinatura_id ?? null;
  const [cobrancas, notas, noAsaas, correcoes, trocado, passo] = await Promise.all([
    asaas.listarCobrancasDoCliente(cliente).catch((e: unknown) => {
      logger.warn("area_de_cobranca.cobrancas_nao_lidas", { organization_id: orgId, codigo: codigoDoErro(e) });
      return null;
    }),
    asaas.listarNotas({ clienteRef: cliente }).catch(() => [] as NotaLida[]),
    sub ? lerAssinaturaNoAsaas(sub, deps.asaas).catch(() => null) : Promise.resolve(null),
    correcoesPedidas(admin, orgId),
    sub
      ? admin
          .from("mia_cartao_das_mensalidades")
          .select("cartao_final, cartao_bandeira, assinatura_ref, trocado_em")
          .eq("organization_id", orgId)
          .maybeSingle()
          .then((r) => (r.error ? null : (r.data as CartaoGuardado | null)))
      : Promise.resolve(null),
    sub
      ? admin
          .from("mia_pagamento_inicial")
          .select("cartao_final, cartao_bandeira, cartao_recorrente, assinatura_ref")
          .eq("organization_id", orgId)
          .maybeSingle()
          .then((r) => (r.error ? null : (r.data as { cartao_final: string | null; cartao_bandeira: string | null; cartao_recorrente: string | null; assinatura_ref: string | null } | null)))
      : Promise.resolve(null),
  ]);
  return {
    leitura: cobrancas === null ? "falhou" : "ok",
    cobrancas: (cobrancas ?? []).slice(0, TETO_DA_LISTA).map((c) => paraCobrancaDaArea(c, notas, correcoes)),
    forma: sub ? formaDasMensalidades({ assinaturaRef: sub, noAsaas, trocado, cobrancas: cobrancas ?? [], doPasso: passo }) : null,
    fiscais,
  };
}
