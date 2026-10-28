/**
 * FORK MIA (.96) · A NOTA FISCAL PELO ASAAS, SÓ NA CONFIRMAÇÃO DO PAGAMENTO
 * (decisão 8 do protótipo "Pagamento no início").
 *
 * A configuração da nota de serviço é da INSTALAÇÃO (quem emite é a Time): o
 * serviço municipal e os impostos. Mora em `platform_config`, na chave
 * `MIA_NOTA_FISCAL_DO_ASAAS` (texto JSON, não é segredo), editada em
 * Admin › Cobrança › Conexão. Sem ela, nenhuma assinatura recebe a
 * configuração e o Asaas não emite nota sozinho (a tela avisa).
 *
 * Com ela, toda assinatura do Asaas da instalação recebe `invoiceSettings` com
 * `ON_PAYMENT_CONFIRMATION`: a nota sai quando o dinheiro entra, nunca na
 * criação da cobrança. `mia_nota_da_assinatura` (9121) guarda para qual
 * assinatura já foi feito; assinatura nova (troca de plano, cobrança refeita) é
 * configurada de novo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { logger } from "@/lib/logger";

import { codigoDoErro } from "./api";
import type { DependenciasDoAsaasDaMia } from "./api";
import { asaasDaMia, type ConfiguracaoDaNota } from "./cobrancas";

export const CHAVE_DA_NOTA = "MIA_NOTA_FISCAL_DO_ASAAS";

const percentual = z.number().min(0).max(100);

const impostosSchema = z.object({
  reterIss: z.boolean(),
  iss: percentual,
  pis: percentual,
  cofins: percentual,
  csll: percentual,
  inss: percentual,
  ir: percentual,
});

/**
 * FORK MIA (.97): o serviço e os impostos do SETUP de implantação, separados
 * dos da mensalidade (o Gabriel usa o item 17.06 a 2% para "Setup de
 * implementação"). Opcional: sem ele, a nota do setup não sai sozinha e a
 * Conexão avisa (docs/fork/cupons-e-parceiros.md).
 */
const servicoDoSetupSchema = z
  .object({
    servicoMunicipalId: z.string().trim().max(60).nullish().transform((v) => v || null),
    servicoMunicipalCodigo: z.string().trim().max(60).nullish().transform((v) => v || null),
    servicoMunicipalNome: z.string().trim().max(250).nullish().transform((v) => v || null),
    observacoes: z.string().trim().max(1000).nullish().transform((v) => v || null),
    impostos: impostosSchema,
  })
  .refine((c) => Boolean(c.servicoMunicipalId || c.servicoMunicipalCodigo), {
    path: ["servicoMunicipalCodigo"],
    message: "servico_obrigatorio",
  });

export const configuracaoDaNotaSchema = z
  .object({
    servicoMunicipalId: z.string().trim().max(60).nullish().transform((v) => v || null),
    servicoMunicipalCodigo: z.string().trim().max(60).nullish().transform((v) => v || null),
    servicoMunicipalNome: z.string().trim().max(250).nullish().transform((v) => v || null),
    observacoes: z.string().trim().max(1000).nullish().transform((v) => v || null),
    impostos: impostosSchema,
    // FORK MIA (.97): a nota do setup, com o serviço próprio.
    setup: servicoDoSetupSchema.nullish().transform((v) => v ?? null),
  })
  .refine((c) => Boolean(c.servicoMunicipalId || c.servicoMunicipalCodigo), {
    path: ["servicoMunicipalCodigo"],
    message: "servico_obrigatorio",
  });

/**
 * FORK MIA (.97): a configuração da nota do SETUP, no formato da nota (o mesmo
 * corpo que o Asaas recebe), ou `null` quando a Time ainda não configurou.
 */
export function configuracaoDaNotaDoSetup(config: ConfiguracaoDaNota | null): ConfiguracaoDaNota | null {
  const s = config?.setup ?? null;
  if (!s) return null;
  return { ...s, setup: null };
}

/** A configuração gravada, ou `null` (ausente ou ilegível: nenhuma nota é pedida). Nunca lança. */
export async function lerConfiguracaoDaNota(admin: SupabaseClient): Promise<ConfiguracaoDaNota | null> {
  try {
    const { data, error } = await admin.from("platform_config").select("valor").eq("chave", CHAVE_DA_NOTA).maybeSingle();
    if (error || !data || typeof (data as { valor?: unknown }).valor !== "string") return null;
    const lido = configuracaoDaNotaSchema.safeParse(JSON.parse((data as { valor: string }).valor));
    return lido.success ? (lido.data as ConfiguracaoDaNota) : null;
  } catch {
    return null;
  }
}

/** Grava a configuração (quem chama já conferiu o dono da instalação e o MFA). */
export async function gravarConfiguracaoDaNota(
  admin: SupabaseClient,
  config: z.input<typeof configuracaoDaNotaSchema>,
  ator: string,
): Promise<{ ok: true; config: ConfiguracaoDaNota } | { ok: false; motivo: "invalida" | "falha_no_banco" }> {
  const lido = configuracaoDaNotaSchema.safeParse(config);
  if (!lido.success) return { ok: false, motivo: "invalida" };
  const { error } = await admin.from("platform_config").upsert(
    {
      chave: CHAVE_DA_NOTA,
      valor: JSON.stringify(lido.data),
      eh_segredo: false,
      semeado_do_env: false,
      updated_by: ator,
    },
    { onConflict: "chave" },
  );
  if (error) return { ok: false, motivo: "falha_no_banco" };
  // A configuração mudou: as assinaturas recebem a nova na próxima rodada.
  await admin.from("mia_nota_da_assinatura").update({ configurada_em: null, tentativas: 0 }).not("assinatura_ref", "is", null);
  return { ok: true, config: lido.data as ConfiguracaoDaNota };
}

/**
 * Garante a nota na confirmação para a assinatura do Asaas desta empresa. Já
 * feito para esta assinatura: nada. Sem configuração: nada (a tela da Conexão
 * avisa). Nunca lança; devolve o que aconteceu.
 */
export async function garantirNotaNaConfirmacao(
  admin: SupabaseClient,
  orgId: string,
  assinaturaRef: string,
  deps: DependenciasDoAsaasDaMia = {},
): Promise<"configurada" | "ja_estava" | "sem_configuracao" | "falhou"> {
  try {
    const { data } = await admin
      .from("mia_nota_da_assinatura")
      .select("assinatura_ref, configurada_em, tentativas")
      .eq("organization_id", orgId)
      .maybeSingle();
    const atual = data as { assinatura_ref: string; configurada_em: string | null; tentativas: number } | null;
    if (atual && atual.assinatura_ref === assinaturaRef && atual.configurada_em !== null) return "ja_estava";
    const config = await lerConfiguracaoDaNota(admin);
    if (config === null) return "sem_configuracao";
    const tentativas = atual && atual.assinatura_ref === assinaturaRef ? atual.tentativas + 1 : 1;
    try {
      await asaasDaMia(deps).configurarNotaDaAssinatura(assinaturaRef, config);
    } catch (e) {
      await admin.from("mia_nota_da_assinatura").upsert(
        { organization_id: orgId, assinatura_ref: assinaturaRef, configurada_em: null, tentativas, ultimo_erro: codigoDoErro(e).slice(0, 80) },
        { onConflict: "organization_id" },
      );
      logger.warn("asaas_mia.nota_nao_configurada", { organization_id: orgId, codigo: codigoDoErro(e), tentativas });
      return "falhou";
    }
    await admin.from("mia_nota_da_assinatura").upsert(
      { organization_id: orgId, assinatura_ref: assinaturaRef, configurada_em: new Date().toISOString(), tentativas, ultimo_erro: null },
      { onConflict: "organization_id" },
    );
    return "configurada";
  } catch (e) {
    logger.warn("asaas_mia.nota_nao_configurada", { organization_id: orgId, codigo: codigoDoErro(e) });
    return "falhou";
  }
}
