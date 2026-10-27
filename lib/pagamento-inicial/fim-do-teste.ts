/**
 * FORK MIA (.96) · O FIM DO TESTE GRÁTIS (decisão 12 revista pelo Gabriel em
 * 27/10/2026, dois ajustes).
 *
 * Para a empresa num plano com teste que NUNCA pagou uma mensalidade:
 *   - a primeira mensalidade é por CARTÃO (cadastrado no passo "Pagamento" do
 *     início, debitado sozinho no fim do teste) ou por PIX, gerado 3 DIAS ANTES do
 *     fim do teste, com o aviso. Boleto fica fora nesta primeira mensalidade;
 *   - o teste acaba sem a mensalidade paga (ou com o cartão recusado): a conta
 *     BLOQUEIA NA HORA, sem a tolerância da régua, e passa a ser tratada como a
 *     entrada paga (`fn_mia_bloquear_fim_do_teste`, 9122): o passo "Pagamento"
 *     com o Pix e a troca de cartão, e a releitura do upstream libera quando
 *     pagar. O aviso é o do "falta só o pagamento", nunca o de "conta suspensa
 *     por falta de pagamento".
 * Quem já pagou alguma mensalidade segue a régua de hoje.
 *
 * Roda NO COMEÇO de `aplicarRegua` (lib/cobranca/sincronizar.ts, ponto `FORK MIA
 * (.96)`), antes de a régua do upstream decidir: assim ela já encontra a empresa
 * bloqueada como entrada paga, ou o aviso de 3 dias dado (`ultimo_aviso =
 * trial_acabando`, pela função do upstream que registra os avisos), e não manda
 * os dela. Nunca lança.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import type { DependenciasDoAsaasDaMia } from "@/lib/asaas-mia/api";
import { codigoDoErro } from "@/lib/asaas-mia/api";
import { asaasDaMia } from "@/lib/asaas-mia/cobrancas";
import { garantirNotaNaConfirmacao } from "@/lib/asaas-mia/nota";
import { marcaDaSaida } from "@/lib/branding/saida";
import { gerarLinkDePagamento } from "@/lib/cobranca/checkout";
import { emailDoAdminDaEmpresa } from "@/lib/cobranca/emails";
import { dataCivilEmSaoPaulo, fimDoDiaEmSaoPaulo } from "@/lib/cobranca/provedores/asaas";
import { urlDoHub } from "@/lib/cobranca/url";
import { lerDadosFiscais, marcarDadosFiscaisNoAsaas } from "@/lib/dados-fiscais/banco";
import type { sendEmail } from "@/lib/email/roteador";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma, type Idioma } from "@/lib/i18n/idiomas";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { logger } from "@/lib/logger";
import { ehOperante } from "@/lib/organizacao/operante";

import { avisarOsAdmins } from "./avisos";
import { CAMINHO_DO_PASSO_DO_PAGAMENTO } from "./destino";

const DIA_MS = 24 * 3_600_000;
/** O Pix da primeira mensalidade sai este tempo antes do fim do teste. */
export const PIX_ANTES_DO_FIM_MS = 3 * DIA_MS;

export interface DependenciasDoFimDoTeste {
  asaas?: DependenciasDoAsaasDaMia;
  cobrancaLigada?: () => Promise<boolean>;
  gerarLink?: typeof gerarLinkDePagamento;
  enviar?: typeof sendEmail;
}

interface Linha {
  estado: string;
  plano_id: string;
  trial_ate: string | null;
  pagamento_inicial_pendente: boolean;
  provedor_cliente_id: string | null;
  provedor_assinatura_id: string | null;
  checkout_sessao_id: string | null;
  proximo_vencimento: string | null;
  periodo_pago_desde: string | null;
  prazo_extra_ate: string | null;
  ultimo_aviso: string | null;
}

export type AcaoDoFimDoTeste = "nada" | "gerar_pix" | "bloquear";

/**
 * O que fazer agora, PURO (o relógio é injetado). `cartaoCadastrado`: a forma
 * escolhida no passo é o cartão, com a assinatura viva; aí o bloqueio espera o
 * fim do DIA do débito (o Asaas cobra ao longo dele).
 */
export function decidirFimDoTeste(
  a: Omit<Linha, "plano_id" | "provedor_cliente_id" | "checkout_sessao_id">,
  org: { status: string | null },
  agora: Date,
  cartaoCadastrado: boolean,
): AcaoDoFimDoTeste {
  if (a.pagamento_inicial_pendente || !ehOperante(org.status)) return "nada";
  if (a.estado !== "trial" && a.estado !== "em_atraso") return "nada";
  if (a.trial_ate === null) return "nada";
  // Quem já pagou alguma mensalidade segue a régua de hoje.
  if (a.proximo_vencimento !== null || a.periodo_pago_desde !== null) return "nada";
  if (a.prazo_extra_ate !== null && Date.parse(a.prazo_extra_ate) > agora.getTime()) return "nada";
  const fim = Date.parse(a.trial_ate);
  const t = agora.getTime();
  if (t >= fim) {
    const limite = cartaoCadastrado && a.provedor_assinatura_id
      ? fimDoDiaEmSaoPaulo(dataCivilEmSaoPaulo(new Date(fim))).getTime()
      : fim;
    return t >= limite ? "bloquear" : "nada";
  }
  if (t >= fim - PIX_ANTES_DO_FIM_MS && a.provedor_assinatura_id === null && a.ultimo_aviso === null) return "gerar_pix";
  return "nada";
}

/** "05/11" no fuso da empresa (os números latinos, em qualquer idioma). */
function diaEMes(iso: string, fuso: string | null): string {
  const formatar = (tz: string) =>
    new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "2-digit", timeZone: tz, numberingSystem: "latn" }).formatToParts(new Date(iso));
  let partes: Intl.DateTimeFormatPart[];
  try {
    partes = formatar(fuso ?? "America/Sao_Paulo");
  } catch {
    partes = formatar("America/Sao_Paulo");
  }
  const de = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${de("day")}/${de("month")}`;
}

/** Os textos dos dois avisos, no idioma da empresa e com a marca. Puro. */
export function textosDoFimDoTeste(
  idioma: Idioma,
  marca: string,
  o: { data: string; pix: string | null },
): { pix: { titulo: string; corpo: string }; bloqueio: { titulo: string; corpo: string } } {
  const t = (s: string) => traduzir(s, idioma);
  return {
    pix: {
      titulo: t("Seu teste grátis termina em {data}: o Pix da primeira mensalidade está pronto").replace("{data}", o.data),
      corpo:
        t("Pague até {data} para continuar usando sem interrupção. Sem o pagamento, a conta fica bloqueada no fim do teste até o Pix ser confirmado.").replace("{data}", o.data) +
        (o.pix ? `\n\n${t("Pix copia e cola:")} ${o.pix}` : ""),
    },
    bloqueio: {
      titulo: t("Falta só o pagamento para continuar usando o {marca}").replace("{marca}", marca),
      corpo: t("O teste grátis terminou e a primeira mensalidade ainda não foi paga. Pague por Pix ou cadastre outro cartão: a conta é liberada na hora."),
    },
  };
}

/** O administrador mais antigo da empresa (o ator do checkout que a régua abre por ela). */
async function adminMaisAntigo(admin: SupabaseClient, orgId: string): Promise<string | null> {
  const { data } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("role", "admin")
    .is("revoked_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { user_id?: string } | null)?.user_id ?? null;
}

async function registrarAviso(
  admin: SupabaseClient,
  orgId: string,
  aviso: "trial_acabando" | "suspensa",
  texto: { titulo: string; corpo: string },
  severidade: "info" | "critical",
): Promise<boolean> {
  const { data, error } = await admin.rpc("fn_cobranca_registrar_aviso", {
    p_org: orgId,
    p_aviso: aviso,
    p_desde: null,
    p_titulo: texto.titulo,
    p_corpo: texto.corpo,
    p_severidade: severidade,
  });
  return !error && data === true;
}

/**
 * 3 dias antes do fim do teste: a assinatura do upstream (que no teste nasce com
 * o vencimento no fim dele), a primeira cobrança só no Pix, o QR e o aviso. Sem
 * os dados fiscais (empresa anterior à .96), não gera: a régua do upstream dá o
 * aviso dela ("assine em Plano e cobrança"), e o bloqueio do fim pede os dados
 * no passo do pagamento.
 */
async function gerarPixDoFimDoTeste(
  admin: SupabaseClient,
  orgId: string,
  a: Linha,
  org: { idioma: Idioma; fuso: string | null },
  agora: Date,
  deps: DependenciasDoFimDoTeste,
): Promise<boolean> {
  const fiscais = await lerDadosFiscais(admin, orgId);
  if (!fiscais) return false;
  const asaas = asaasDaMia(deps.asaas);
  try {
    const email = await emailDoAdminDaEmpresa(admin, orgId);
    await asaas.garantirClienteFiscal({ orgId, clienteRef: a.provedor_cliente_id, dados: fiscais, email });
    await marcarDadosFiscaisNoAsaas(admin, orgId, fiscais.updated_at);
    const r = await (deps.gerarLink ?? gerarLinkDePagamento)(admin, {
      orgId,
      documentoBruto: fiscais.documento,
      email,
      chaveIdempotencia: randomUUID(),
      urlDeVolta: urlDoHub(),
      // Quem assina a ação é o administrador mais antigo da empresa (a régua age por ele).
      actorUserId: (await adminMaisAntigo(admin, orgId)) ?? orgId,
      requestId: randomUUID(),
      comoDono: false,
    });
    if (!r.ok && r.code !== "pagamento_em_andamento") {
      logger.warn("pagamento_inicial.pix_do_fim_do_teste_nao_saiu", { organization_id: orgId, codigo: r.code });
      return false;
    }
    const { data } = await admin
      .from("cobranca_assinaturas")
      .select("provedor_assinatura_id, checkout_sessao_id")
      .eq("organization_id", orgId)
      .maybeSingle();
    const depois = data as { provedor_assinatura_id: string | null; checkout_sessao_id: string | null } | null;
    const assinaturaRef = depois?.provedor_assinatura_id ?? null;
    let pagamentoRef = depois?.checkout_sessao_id?.startsWith("pay_") ? depois.checkout_sessao_id : null;
    if (!pagamentoRef && assinaturaRef) {
      pagamentoRef =
        (await asaas.listarCobrancasDaAssinatura(assinaturaRef)).find((c) => c.situacao === "aberta" || c.situacao === "vencida")?.ref ?? null;
    }
    if (!pagamentoRef) return false;
    // Só Pix na primeira mensalidade: o boleto sai da fatura.
    const cobranca = await asaas.mudarFormaDaCobranca(pagamentoRef, "PIX");
    const pix = await asaas.lerPix(pagamentoRef);
    if (assinaturaRef) await garantirNotaNaConfirmacao(admin, orgId, assinaturaRef, deps.asaas);
    await admin.from("mia_pagamento_inicial").upsert(
      {
        organization_id: orgId,
        modo: "teste",
        plano_id: a.plano_id,
        situacao: "aguardando",
        forma: "pix",
        pagamento_ref: pagamentoRef,
        assinatura_ref: assinaturaRef,
        valor_cents: cobranca.valorCents > 0 ? cobranca.valorCents : null,
        vence_em: cobranca.vencimento,
        primeira_cobranca_em: cobranca.vencimento,
        fatura_url: cobranca.faturaUrl,
        pix_copia_e_cola: pix.copiaECola,
        pix_gerado_em: agora.toISOString(),
        gerada_em: agora.toISOString(),
        // Este aviso já é o lembrete: o do dia seguinte não sai em dobro.
        lembrete_enviado_em: agora.toISOString(),
      },
      { onConflict: "organization_id" },
    );
    const marca = await marcaDaSaida(orgId);
    const textos = textosDoFimDoTeste(org.idioma, marca.nome, { data: diaEMes(a.trial_ate as string, org.fuso), pix: pix.copiaECola });
    if (await registrarAviso(admin, orgId, "trial_acabando", textos.pix, "info")) {
      await avisarOsAdmins(
        admin,
        { id: orgId, idioma: org.idioma },
        { ...textos.pix, botao: { rotulo: traduzir("Pagar com Pix", org.idioma), href: cobranca.faturaUrl ?? "/app/settings/billing" } },
        deps.enviar,
      );
    }
    void audit({
      action: "pagamento_inicial.cobranca_gerada",
      actorUserId: null,
      bypassedRls: true,
      organizationId: orgId,
      resourceType: "mia_pagamento_inicial",
      resourceId: orgId,
      metadata: { forma: "pix", modo: "teste", quando: "tres_dias_antes_do_fim_do_teste", plano_id: a.plano_id },
    });
    return true;
  } catch (e) {
    logger.warn("pagamento_inicial.pix_do_fim_do_teste_nao_saiu", { organization_id: orgId, codigo: codigoDoErro(e) });
    return false;
  }
}

/** O teste acabou sem a primeira mensalidade paga: bloqueia como a entrada paga e avisa. */
async function bloquear(
  admin: SupabaseClient,
  orgId: string,
  a: Linha,
  org: { idioma: Idioma },
  agora: Date,
  deps: DependenciasDoFimDoTeste,
): Promise<boolean> {
  const { data, error } = await admin.rpc("fn_mia_bloquear_fim_do_teste", { p_org: orgId });
  if (error || (data as { mudou?: boolean } | null)?.mudou !== true) return false;
  const { data: linha } = await admin.from("mia_pagamento_inicial").select("situacao, forma, pagamento_ref").eq("organization_id", orgId).maybeSingle();
  const l = linha as { situacao: string; forma: string | null; pagamento_ref: string | null } | null;
  await admin.from("mia_pagamento_inicial").upsert(
    {
      organization_id: orgId,
      modo: "teste",
      plano_id: a.plano_id,
      // Com cartão e cobrança, o cartão não passou; com o Pix gerado, segue esperando.
      situacao: l?.pagamento_ref ? (l.forma === "cartao" ? "recusado" : "aguardando") : "sem_cobranca",
      // O aviso do bloqueio já é o lembrete.
      lembrete_enviado_em: agora.toISOString(),
    },
    { onConflict: "organization_id" },
  );
  const marca = await marcaDaSaida(orgId);
  const textos = textosDoFimDoTeste(org.idioma, marca.nome, { data: "", pix: null });
  if (await registrarAviso(admin, orgId, "suspensa", textos.bloqueio, "critical")) {
    await avisarOsAdmins(
      admin,
      { id: orgId, idioma: org.idioma },
      { ...textos.bloqueio, botao: { rotulo: traduzir("Pagar agora", org.idioma), href: CAMINHO_DO_PASSO_DO_PAGAMENTO } },
      deps.enviar,
    );
  }
  void audit({
    action: "pagamento_inicial.fim_do_teste_bloqueou",
    actorUserId: null,
    bypassedRls: true,
    organizationId: orgId,
    resourceType: "cobranca_assinatura",
    resourceId: orgId,
    metadata: { plano_id: a.plano_id, forma_escolhida: l?.forma ?? null },
  });
  return true;
}

/**
 * O gancho no começo de `aplicarRegua`. Com a cobrança desligada, nada (e nada
 * é lido do Asaas). Nunca lança.
 */
export async function antesDaRegua(
  admin: SupabaseClient,
  orgId: string,
  agora: Date = new Date(),
  deps: DependenciasDoFimDoTeste = {},
): Promise<AcaoDoFimDoTeste> {
  try {
    if (!(await (deps.cobrancaLigada ?? (() => moduloLigado(admin, "cobranca")))())) return "nada";
    const { data, error } = await admin
      .from("cobranca_assinaturas")
      .select(
        "estado, plano_id, trial_ate, pagamento_inicial_pendente, provedor_cliente_id, provedor_assinatura_id, checkout_sessao_id, proximo_vencimento, periodo_pago_desde, prazo_extra_ate, ultimo_aviso",
      )
      .eq("organization_id", orgId)
      .maybeSingle();
    if (error || !data) return "nada";
    const a = data as unknown as Linha;
    if (a.pagamento_inicial_pendente) return "nada";
    const [{ data: orgLida }, { data: escolha }] = await Promise.all([
      admin.from("organizations").select("status, locale, timezone").eq("id", orgId).maybeSingle(),
      admin.from("mia_pagamento_inicial").select("forma, situacao").eq("organization_id", orgId).maybeSingle(),
    ]);
    const org = orgLida as { status: string | null; locale: string | null; timezone: string | null } | null;
    if (!org) return "nada";
    const e = escolha as { forma: string | null; situacao: string } | null;
    const acao = decidirFimDoTeste(a, org, agora, e?.forma === "cartao" && e.situacao === "escolhida");
    const idioma = normalizarIdioma(org.locale);
    if (acao === "gerar_pix") return (await gerarPixDoFimDoTeste(admin, orgId, a, { idioma, fuso: org.timezone }, agora, deps)) ? "gerar_pix" : "nada";
    if (acao === "bloquear") return (await bloquear(admin, orgId, a, { idioma }, agora, deps)) ? "bloquear" : "nada";
    return "nada";
  } catch (e) {
    logger.warn("pagamento_inicial.fim_do_teste_falhou", { organization_id: orgId, detalhe: e instanceof Error ? e.message : "desconhecido" });
    return "nada";
  }
}
