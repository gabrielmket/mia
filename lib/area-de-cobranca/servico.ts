/**
 * FORK MIA (.96) · A ÁREA DE COBRANÇA, AS ESCRITAS (Configurações › Plano e
 * cobrança; protótipo "Pagamento no início", tela 3 e decisões 9 a 11;
 * docs/fork/area-de-cobranca.md). Só o ADMINISTRADOR chega aqui (a rota confere).
 *
 *   - Dados fiscais: o administrador edita a razão social, o endereço, as
 *     inscrições e o WhatsApp. O CPF ou CNPJ (e o tipo) NUNCA mudam por aqui
 *     (decisão 10: trocar o titular é pedido à Time): o servidor usa o que está
 *     gravado e grava com `permitirTrocarDocumento: false`. O cliente do Asaas
 *     recebe na hora (`garantirClienteFiscal`): vale para as próximas notas.
 *   - Trocar o cartão: o cartão novo vai para a ASSINATURA do Asaas pelo
 *     checkout transparente (`cartaoNaAssinatura`, token nulo), sem cobrar nada
 *     na hora; as próximas mensalidades caem nele. O cartão vive só nesta
 *     chamada: do cartão, o banco recebe o final de 4 números e a bandeira; a
 *     auditoria, só o resultado. A prova é
 *     `tests/unit/area-de-cobranca-cartao-fora-dos-registros.test.ts`.
 *   - "A nota saiu errada" (decisão 10): a cobrança PAGA, conferida contra o
 *     cliente do Asaas da empresa, vira um chamado para a Time pelo sistema de
 *     chamados do assistente (.88, `mia_chamados`), aberto pela SESSÃO de quem
 *     pede (o gatilho `fn_mia_chamado_nasce` carimba a pessoa, o número e a
 *     demonstração). A marca `contexto.cobranca.ref` liga o chamado à cobrança.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DependenciasDoAsaasDaMia } from "@/lib/asaas-mia/api";
import { codigoDoErro } from "@/lib/asaas-mia/api";
import { cartaoNaAssinatura, type TitularDoCartao } from "@/lib/asaas-mia/cartao";
import { finalDigitado, type CartaoDigitado } from "@/lib/asaas-mia/cartao-regras";
import { asaasDaMia, telefoneNacional } from "@/lib/asaas-mia/cobrancas";
import { ROTULO_DO_TIPO_DE_CHAMADO } from "@/lib/assistente/tipos";
import { audit } from "@/lib/audit";
import { reportar } from "@/lib/avisos/report-da-plataforma";
import { emailDoAdminDaEmpresa } from "@/lib/cobranca/emails";
import { gravarDadosFiscais, lerDadosFiscais, marcarDadosFiscaisNoAsaas } from "@/lib/dados-fiscais/banco";
import { conferirDadosFiscais } from "@/lib/dados-fiscais/regras";
import { logger } from "@/lib/logger";

import { correcoesPedidas, lerAssinaturaDaEmpresa } from "./leitura";
import { bandeiraPeloNumero, notaDaCobranca, notaErradaSchema, ROTULO_DO_MOTIVO, textoDoChamadoDaNota } from "./regras";

export interface DependenciasDaEscrita {
  asaas?: DependenciasDoAsaasDaMia;
  agora?: () => Date;
  emailDoAdmin?: typeof emailDoAdminDaEmpresa;
  reportar?: typeof reportar;
}

export type Recusa = { ok: false; status: number; code: string; message: string; details?: unknown };
const recusa = (status: number, code: string, message: string, details?: unknown): Recusa => ({
  ok: false,
  status,
  code,
  message,
  ...(details === undefined ? {} : { details }),
});

// ── os dados fiscais ───────────────────────────────────────────────────────

/**
 * Grava os dados fiscais pela área de cobrança. O documento e o tipo vêm do que
 * está gravado (o que a tela mandar nesses dois campos não vale); a empresa que
 * ainda não tem dados fiscais preenche tudo, uma vez.
 */
export async function salvarDadosFiscaisDaArea(
  admin: SupabaseClient,
  p: { orgId: string; userId: string; entrada: unknown; requestId: string },
  deps: DependenciasDaEscrita = {},
): Promise<{ ok: true; no_asaas: boolean } | Recusa> {
  let atual;
  try {
    atual = await lerDadosFiscais(admin, p.orgId);
  } catch {
    return recusa(500, "internal_error", "Não foi possível ler os dados. Tente de novo.");
  }
  const bruto = (p.entrada && typeof p.entrada === "object" ? p.entrada : {}) as Record<string, unknown>;
  // O CPF ou CNPJ não muda por aqui (decisão 10): vale o gravado.
  const entrada = atual ? { ...bruto, tipo: atual.tipo, documento: atual.documento } : bruto;
  const conferido = conferirDadosFiscais(entrada, { exigeTelefone: false });
  if (!conferido.ok) return recusa(422, "validation_failed", "Confira os dados fiscais.", { campos: conferido.campos });
  const gravado = await gravarDadosFiscais(admin, p.orgId, conferido.dados, { userId: p.userId, permitirTrocarDocumento: false });
  if (!gravado.ok) {
    return gravado.motivo === "documento_nao_muda"
      ? recusa(409, "documento_nao_muda", "O CNPJ ou CPF não muda por aqui. Para trocar o titular, fale com a Time.")
      : recusa(500, "internal_error", "Não foi possível salvar os dados. Tente de novo.");
  }
  void audit({
    action: "dados_fiscais.gravados",
    actorUserId: p.userId,
    organizationId: p.orgId,
    resourceType: "mia_dados_fiscais",
    resourceId: p.orgId,
    requestId: p.requestId,
    // Nunca o documento: só o tipo e de onde veio.
    metadata: { onde: "area_de_cobranca", tipo: conferido.dados.tipo, mudou_documento: false },
  });
  let noAsaas = false;
  try {
    const assinatura = await lerAssinaturaDaEmpresa(admin, p.orgId);
    if (assinatura?.provedor === "asaas" && assinatura.provedor_cliente_id) {
      const email = await (deps.emailDoAdmin ?? emailDoAdminDaEmpresa)(admin, p.orgId);
      await asaasDaMia(deps.asaas).garantirClienteFiscal({
        orgId: p.orgId,
        clienteRef: assinatura.provedor_cliente_id,
        dados: gravado.dados,
        email,
      });
      noAsaas = await marcarDadosFiscaisNoAsaas(admin, p.orgId, gravado.dados.updated_at);
    }
  } catch (e) {
    // A rodada leva ao Asaas depois (`asaas_sincronizado_em` continua nulo).
    logger.warn("area_de_cobranca.dados_fiscais_nao_foram_ao_asaas", { organization_id: p.orgId, codigo: codigoDoErro(e) });
  }
  return { ok: true, no_asaas: noAsaas };
}

// ── trocar o cartão ────────────────────────────────────────────────────────

/**
 * O cartão novo para as PRÓXIMAS mensalidades, sem cobrar nada agora. O cartão
 * vive só nesta chamada: vai ao Asaas e some. Nunca lança.
 */
export async function trocarCartaoDaArea(
  admin: SupabaseClient,
  p: { orgId: string; userId: string; cartao: CartaoDigitado; ipRemoto: string | null; requestId: string },
  deps: DependenciasDaEscrita = {},
): Promise<{ ok: true; cartao_final: string; cartao_bandeira: string | null } | Recusa> {
  let resultado: "trocado" | "recusado" | "falhou" = "falhou";
  let tentou = false;
  try {
    const [assinatura, fiscais] = await Promise.all([lerAssinaturaDaEmpresa(admin, p.orgId), lerDadosFiscais(admin, p.orgId)]);
    const sub = assinatura?.provedor === "asaas" ? assinatura.provedor_assinatura_id : null;
    if (!sub) return recusa(409, "sem_assinatura", "A empresa ainda não tem assinatura no Asaas para receber o cartão.");
    if (!fiscais) return recusa(409, "dados_fiscais_faltando", "Preencha os dados fiscais antes de trocar o cartão.");
    const telefone = telefoneNacional(fiscais.telefone);
    if (!telefone) {
      return recusa(409, "telefone_faltando", "Preencha o WhatsApp em Dados fiscais antes de trocar o cartão: o Asaas pede um telefone do titular.");
    }
    const email = (await (deps.emailDoAdmin ?? emailDoAdminDaEmpresa)(admin, p.orgId)) ?? "";
    const titular: TitularDoCartao = {
      nome: fiscais.razao_social,
      email,
      documento: fiscais.documento,
      cep: fiscais.cep,
      numeroDoEndereco: fiscais.numero,
      complemento: fiscais.complemento,
      telefone,
    };
    tentou = true;
    const r = await cartaoNaAssinatura({ assinaturaRef: sub, cartao: p.cartao, token: null, titular, ipRemoto: p.ipRemoto }, deps.asaas);
    if (!r.ok) {
      resultado = ["sem_resposta", "provedor_fora", "sem_chave", "fora_do_asaas", "resposta_invalida"].includes(r.codigo) ? "falhou" : "recusado";
      return resultado === "recusado"
        ? recusa(402, "cartao_recusado", "O banco recusou o cartão. Confira os dados ou tente outro cartão.")
        : recusa(502, "cartao_sem_resposta", "Não tivemos a resposta do Asaas. Tente de novo em alguns segundos.");
    }
    resultado = "trocado";
    // Do cartão, só o que se mostra a quem digitou: o final e a bandeira.
    const final = finalDigitado(p.cartao.numero);
    const bandeira = bandeiraPeloNumero(p.cartao.numero);
    const agora = (deps.agora ?? (() => new Date()))();
    const { error } = await admin.from("mia_cartao_das_mensalidades").upsert(
      {
        organization_id: p.orgId,
        cartao_final: final,
        cartao_bandeira: bandeira,
        assinatura_ref: sub,
        trocado_em: agora.toISOString(),
        trocado_por: p.userId,
      },
      { onConflict: "organization_id" },
    );
    if (error) logger.warn("area_de_cobranca.cartao_nao_gravado", { organization_id: p.orgId, codigo: error.code ?? null });
    return { ok: true, cartao_final: final, cartao_bandeira: bandeira };
  } catch (e) {
    logger.warn("area_de_cobranca.troca_de_cartao_falhou", { organization_id: p.orgId, codigo: codigoDoErro(e) });
    return recusa(503, "provedor_indisponivel", "O Asaas não respondeu agora. Tente de novo em alguns minutos.");
  } finally {
    if (tentou) {
      void audit({
        action: "area_de_cobranca.cartao_trocado",
        actorUserId: p.userId,
        organizationId: p.orgId,
        resourceType: "mia_cartao_das_mensalidades",
        resourceId: p.orgId,
        requestId: p.requestId,
        // Só o resultado. O cartão nunca entra na auditoria.
        metadata: { resultado },
      });
    }
  }
}

// ── "A nota saiu errada" ───────────────────────────────────────────────────

/**
 * O pedido de correção da nota vira um chamado para a Time. `sessao` é o
 * cliente da SESSÃO de quem pede (o chamado nasce dela, como o do assistente);
 * `admin` lê o Asaas e manda o recado ao grupo interno.
 */
export async function pedirCorrecaoDaNota(
  sessao: SupabaseClient,
  admin: SupabaseClient,
  p: {
    orgId: string;
    userId: string;
    papel: string;
    entrada: unknown;
    requestId: string;
    contexto: { versao: string; navegador: string; hora_local: string | null; empresa: string | null };
  },
  deps: DependenciasDaEscrita = {},
): Promise<{ ok: true; chamado: number; demonstracao: boolean } | Recusa> {
  const lido = notaErradaSchema.safeParse(p.entrada);
  if (!lido.success) return recusa(422, "validation_failed", "Conte o que está errado na nota.", { campos: lido.error.flatten().fieldErrors });
  const { cobranca_ref: ref, motivo, texto } = lido.data;

  let cobranca;
  let numeroDaNota: string | null = null;
  try {
    const assinatura = await lerAssinaturaDaEmpresa(admin, p.orgId);
    const cliente = assinatura?.provedor === "asaas" ? assinatura.provedor_cliente_id : null;
    if (!cliente) return recusa(404, "cobranca_nao_encontrada", "Não achamos esta cobrança entre as da sua empresa.");
    const asaas = asaasDaMia(deps.asaas);
    // A cobrança tem de ser DESTA empresa: ela é procurada entre as do cliente do Asaas dela.
    cobranca = (await asaas.listarCobrancasDoCliente(cliente)).find((c) => c.ref === ref);
    if (!cobranca) return recusa(404, "cobranca_nao_encontrada", "Não achamos esta cobrança entre as da sua empresa.");
    if (cobranca.situacao !== "paga") return recusa(409, "cobranca_nao_paga", "Só a cobrança paga tem nota fiscal para corrigir.");
    numeroDaNota = notaDaCobranca(await asaas.listarNotas({ pagamentoRef: ref }).catch(() => []), ref)?.numero ?? null;
  } catch (e) {
    logger.warn("area_de_cobranca.nota_errada_sem_asaas", { organization_id: p.orgId, codigo: codigoDoErro(e) });
    return recusa(503, "provedor_indisponivel", "O Asaas não respondeu agora. Tente de novo em alguns minutos.");
  }

  const aberta = (await correcoesPedidas(admin, p.orgId)).get(ref);
  if (aberta && aberta.situacao !== "resolvido") {
    return recusa(409, "correcao_ja_pedida", "A correção desta nota já foi pedida. A Time responde pelo chamado.", { chamado: aberta.chamado });
  }

  const agora = (deps.agora ?? (() => new Date()))();
  const contexto = {
    tela: { caminho: "/app/settings/billing", rotulo: "Plano e cobrança" },
    hora: agora.toISOString(),
    hora_local: p.contexto.hora_local,
    versao: p.contexto.versao,
    navegador: p.contexto.navegador,
    mensagem_do_sistema: null,
    papel: p.papel,
    tem_print: false,
    // A marca que liga o chamado à cobrança (a área mostra "correção pedida · chamado nº X").
    cobranca: {
      ref,
      nota: numeroDaNota,
      motivo,
      vencimento: cobranca.vencimento,
      valor_cents: cobranca.valorCents,
    },
  };
  const { data: criado, error } = await sessao
    .from("mia_chamados")
    .insert({
      organization_id: p.orgId,
      tipo: "pedido",
      texto: textoDoChamadoDaNota({ vencimento: cobranca.vencimento, valorCents: cobranca.valorCents, numeroDaNota, motivo, texto }),
      contexto,
    })
    .select("id, numero, demonstracao")
    .single();
  if (error || !criado) {
    logger.warn("area_de_cobranca.chamado_nao_gravado", { organization_id: p.orgId, codigo: error?.code ?? null });
    return recusa(503, "unavailable", "Não deu para pedir a correção agora. Tente de novo em instantes.");
  }
  const chamado = criado as { id: string; numero: number; demonstracao: boolean };

  // O recado ao grupo interno da Time (nunca da demonstração), como o chamado do assistente.
  if (!chamado.demonstracao) {
    void (deps.reportar ?? reportar)(admin, {
      chave: `assistente_chamado:${chamado.numero}`,
      horas: 24 * 365,
      texto:
        `*Chamado #${chamado.numero}* · ${ROTULO_DO_TIPO_DE_CHAMADO.pedido} · A nota saiu errada\n` +
        `${p.contexto.empresa ?? "Empresa"}\n` +
        `${ROTULO_DO_MOTIVO[motivo]}${numeroDaNota ? ` · nota nº ${numeroDaNota}` : ""}\n` +
        "Pedido pela área de cobrança. Responda em Admin › Chamados.",
      detalhe: { chamado: chamado.numero, organizacao: p.orgId },
    });
  }
  void audit({
    action: "area_de_cobranca.nota_errada_pedida",
    actorUserId: p.userId,
    organizationId: p.orgId,
    resourceType: "mia_chamados",
    resourceId: chamado.id,
    requestId: p.requestId,
    // O número do chamado, o motivo e a cobrança; nunca o texto.
    metadata: { numero: chamado.numero, motivo, cobranca: ref, demonstracao: chamado.demonstracao },
  });
  return { ok: true, chamado: Number(chamado.numero), demonstracao: chamado.demonstracao };
}
