/**
 * FORK MIA (.96) · O PAGAMENTO NO INÍCIO NA RODADA HORÁRIA DA COBRANÇA.
 *
 * Roda dentro da rodada da jornada (`lib/planos-mia/rodada.ts`), no cron da
 * cobrança, e por isso só com a cobrança LIGADA. Quatro passos, cada um nunca
 * lança e audita o próprio efeito:
 *   1. marca como paga a primeira cobrança que a releitura do upstream já
 *      liberou (o aviso do Asaas chegou com a tela fechada);
 *   2. o LEMBRETE do dia seguinte (decisão 6): UM e-mail para quem gerou a
 *      cobrança e não pagou, com o caminho de volta ao passo do pagamento;
 *   3. a nota fiscal NA CONFIRMAÇÃO para toda assinatura do Asaas da instalação
 *      que ainda não tem a configuração (decisão 8);
 *   4. os dados fiscais que o Asaas ainda não recebeu vão ao cliente dele (as
 *      próximas notas saem com eles).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import type { DependenciasDoAsaasDaMia } from "@/lib/asaas-mia/api";
import { codigoDoErro } from "@/lib/asaas-mia/api";
import { asaasDaMia } from "@/lib/asaas-mia/cobrancas";
import { garantirNotaNaConfirmacao } from "@/lib/asaas-mia/nota";
import { marcaDaSaida } from "@/lib/branding/saida";
import { emailDoAdminDaEmpresa } from "@/lib/cobranca/emails";
import { dadosFiscaisParaOAsaas, marcarDadosFiscaisNoAsaas } from "@/lib/dados-fiscais/banco";
import type { sendEmail } from "@/lib/email/roteador";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma, type Idioma } from "@/lib/i18n/idiomas";
import { logger } from "@/lib/logger";

import { avisarOsAdmins } from "./avisos";
import { CAMINHO_DO_PASSO_DO_PAGAMENTO } from "./destino";
import { marcarPagoSeLiberou } from "./servico";

const DIA_MS = 24 * 3_600_000;
/** O lembrete sai 1 dia depois de gerada a cobrança, e só até 7 dias (depois, a Time decide). */
const LEMBRETE_DEPOIS_MS = DIA_MS;
const LEMBRETE_ATE_MS = 7 * DIA_MS;

export interface ResumoDoPagamentoInicial {
  marcadosPagos: number;
  lembretes: number;
  notasConfiguradas: number;
  fiscaisLevados: number;
}

export interface DependenciasDaRodada {
  asaas?: DependenciasDoAsaasDaMia;
  enviar?: typeof sendEmail;
}

/** O texto do lembrete, no idioma da empresa e com a marca da instalação. Puro. */
export function textoDoLembrete(idioma: Idioma, marca: string, plano: string | null): { titulo: string; corpo: string } {
  const t = (s: string) => traduzir(s, idioma);
  return {
    titulo: t("Falta só o pagamento para começar a usar o {marca}").replace("{marca}", marca),
    corpo: (plano
      ? t("Você gerou a cobrança do plano {plano} e o pagamento ainda não chegou.").replace("{plano}", plano)
      : t("Você gerou a cobrança e o pagamento ainda não chegou.")) +
      " " +
      t("Pague por Pix ou cartão e a conta é liberada na hora. Se pagou com boleto, é só aguardar a compensação."),
  };
}

/**
 * Decisão 6: um lembrete, no dia seguinte, para quem GEROU a cobrança (Pix,
 * boleto ou cartão recusado) e não pagou. Uma vez por cobrança: a marca
 * `lembrete_enviado_em` é gravada ANTES do envio (compare-and-set), e uma
 * cobrança refeita zera a marca. Devolve quantos saíram. Nunca lança.
 */
export async function lembrarQuemNaoPagou(
  admin: SupabaseClient,
  agora: Date = new Date(),
  deps: DependenciasDaRodada = {},
): Promise<number> {
  let enviados = 0;
  try {
    const { data, error } = await admin
      .from("mia_pagamento_inicial")
      .select("organization_id, plano_id, gerada_em")
      .in("situacao", ["aguardando", "recusado"])
      .is("lembrete_enviado_em", null)
      .lte("gerada_em", new Date(agora.getTime() - LEMBRETE_DEPOIS_MS).toISOString())
      .gte("gerada_em", new Date(agora.getTime() - LEMBRETE_ATE_MS).toISOString())
      .limit(50);
    if (error) return 0;
    for (const l of (data ?? []) as Array<{ organization_id: string; plano_id: string | null }>) {
      try {
        const { data: a } = await admin
          .from("cobranca_assinaturas")
          .select("pagamento_inicial_pendente")
          .eq("organization_id", l.organization_id)
          .maybeSingle();
        if ((a as { pagamento_inicial_pendente?: boolean } | null)?.pagamento_inicial_pendente !== true) continue;
        const { data: marcou } = await admin
          .from("mia_pagamento_inicial")
          .update({ lembrete_enviado_em: agora.toISOString() })
          .eq("organization_id", l.organization_id)
          .is("lembrete_enviado_em", null)
          .select("organization_id")
          .maybeSingle();
        if (!marcou) continue;
        const [{ data: org }, { data: plano }] = await Promise.all([
          admin.from("organizations").select("locale").eq("id", l.organization_id).maybeSingle(),
          l.plano_id
            ? admin.from("cobranca_planos").select("nome").eq("id", l.plano_id).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        const idioma = normalizarIdioma((org as { locale?: string | null } | null)?.locale ?? null);
        const marca = await marcaDaSaida(l.organization_id);
        const texto = textoDoLembrete(idioma, marca.nome, (plano as { nome?: string } | null)?.nome ?? null);
        const para = await avisarOsAdmins(
          admin,
          { id: l.organization_id, idioma },
          { ...texto, botao: { rotulo: traduzir("Voltar ao pagamento", idioma), href: CAMINHO_DO_PASSO_DO_PAGAMENTO } },
          deps.enviar,
        );
        if (para === 0) continue;
        enviados += 1;
        void audit({
          action: "pagamento_inicial.lembrete_enviado",
          actorUserId: null,
          bypassedRls: true,
          organizationId: l.organization_id,
          resourceType: "mia_pagamento_inicial",
          resourceId: l.organization_id,
          metadata: { destinatarios: para },
        });
      } catch (e) {
        logger.warn("pagamento_inicial.lembrete_falhou", { organization_id: l.organization_id, detalhe: e instanceof Error ? e.message : "desconhecido" });
      }
    }
  } catch {
    return enviados;
  }
  return enviados;
}

/** A primeira cobrança que a releitura já liberou e a linha ainda não sabe. Nunca lança. */
async function marcarOsQueJaPagaram(admin: SupabaseClient): Promise<number> {
  try {
    const { data } = await admin
      .from("mia_pagamento_inicial")
      .select("organization_id")
      .in("situacao", ["aguardando", "em_analise", "recusado"])
      .not("pagamento_ref", "is", null)
      .limit(100);
    let n = 0;
    for (const { organization_id } of (data ?? []) as Array<{ organization_id: string }>) {
      if (await marcarPagoSeLiberou(admin, organization_id)) n += 1;
    }
    return n;
  } catch {
    return 0;
  }
}

/** A nota na confirmação para as assinaturas do Asaas que ainda não a têm. Nunca lança. */
async function configurarNotasQueFaltam(admin: SupabaseClient, deps: DependenciasDaRodada): Promise<number> {
  try {
    const { data } = await admin
      .from("cobranca_assinaturas")
      .select("organization_id, provedor_assinatura_id")
      .eq("provedor", "asaas")
      .not("provedor_assinatura_id", "is", null)
      .limit(500);
    const { data: feitas } = await admin.from("mia_nota_da_assinatura").select("organization_id, assinatura_ref, configurada_em, tentativas");
    const porOrg = new Map(
      ((feitas ?? []) as Array<{ organization_id: string; assinatura_ref: string; configurada_em: string | null; tentativas: number }>).map((f) => [
        f.organization_id,
        f,
      ]),
    );
    let n = 0;
    for (const a of (data ?? []) as Array<{ organization_id: string; provedor_assinatura_id: string }>) {
      const f = porOrg.get(a.organization_id);
      if (f && f.assinatura_ref === a.provedor_assinatura_id && (f.configurada_em !== null || f.tentativas >= 5)) continue;
      if ((await garantirNotaNaConfirmacao(admin, a.organization_id, a.provedor_assinatura_id, deps.asaas)) === "configurada") n += 1;
      if (n >= 50) break;
    }
    return n;
  } catch {
    return 0;
  }
}

/** Os dados fiscais que o Asaas ainda não recebeu (gravados na área de cobrança ou no passo). Nunca lança. */
async function levarDadosFiscaisAoAsaas(admin: SupabaseClient, deps: DependenciasDaRodada): Promise<number> {
  let n = 0;
  try {
    const pendentes = await dadosFiscaisParaOAsaas(admin, 50);
    for (const d of pendentes) {
      try {
        const { data } = await admin
          .from("cobranca_assinaturas")
          .select("provedor, provedor_cliente_id")
          .eq("organization_id", d.organization_id)
          .maybeSingle();
        const a = data as { provedor: string | null; provedor_cliente_id: string | null } | null;
        // Sem cliente no Asaas ainda: vão junto na primeira cobrança.
        if (!a || a.provedor !== "asaas" || !a.provedor_cliente_id) continue;
        const email = await emailDoAdminDaEmpresa(admin, d.organization_id);
        await asaasDaMia(deps.asaas).garantirClienteFiscal({ orgId: d.organization_id, clienteRef: a.provedor_cliente_id, dados: d, email });
        if (await marcarDadosFiscaisNoAsaas(admin, d.organization_id, d.updated_at)) n += 1;
      } catch (e) {
        logger.warn("pagamento_inicial.fiscais_nao_foram_ao_asaas", { organization_id: d.organization_id, codigo: codigoDoErro(e) });
      }
    }
  } catch {
    return n;
  }
  return n;
}

export async function rodadaDoPagamentoInicial(
  admin: SupabaseClient,
  agora: Date = new Date(),
  deps: DependenciasDaRodada = {},
): Promise<ResumoDoPagamentoInicial> {
  const marcadosPagos = await marcarOsQueJaPagaram(admin);
  const lembretes = await lembrarQuemNaoPagou(admin, agora, deps);
  const notasConfiguradas = await configurarNotasQueFaltam(admin, deps);
  const fiscaisLevados = await levarDadosFiscaisAoAsaas(admin, deps);
  return { marcadosPagos, lembretes, notasConfiguradas, fiscaisLevados };
}
