/**
 * A CONTA QUE CHEGA PELO CADASTRO INCORPORADO.
 *
 * Quando o cliente termina o cadastro hospedado pela Meta, ela nos avisa por
 * webhook — e o aviso NÃO diz de qual cliente nosso ele é. O link é da
 * instalação, não do tenant: dois clientes podem entrar na mesma tarde.
 *
 * Por isso este arquivo só GUARDA o fato. Amarrar a WABA ao cliente é ato
 * humano, no painel. Adivinhar o dono erraria no dia em que houvesse dois — e
 * amarrar o número errado ao tenant errado faz a conversa de um cliente sair
 * pelo número de outro, que é o pior desfecho possível desta feature.
 *
 * ⚠️ Nada aqui lança. O webhook da Meta re-entrega tudo que não recebe 2xx, em
 * backoff, por horas: transformar uma falha de gravação em erro HTTP vira
 * auto-DDoS e ainda atrasa as MENSAGENS, que chegam pelo mesmo endpoint.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

/** Os campos de webhook que dizem "uma conta se conectou ao nosso app". */
export const CAMPOS_DE_CHEGADA = ["account_update", "partner_added"] as const;

export interface ChegadaDoCadastro {
  wabaId: string;
  businessName: string | null;
  phoneNumberId: string | null;
  phoneNumber: string | null;
  payload: Record<string, unknown>;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Lê a chegada de dentro do `change` do webhook, ou `null` quando não é uma.
 *
 * O formato destes avisos varia entre `account_update` e `partner_added`, e a
 * Meta mexe neles sem avisar. Por isso a leitura é defensiva e o payload cru vai
 * junto: o que hoje não se sabe ler pode ser exatamente o que falta amanhã.
 */
export function lerChegada(
  field: string,
  wabaIdDaEntry: string,
  value: Record<string, unknown>,
): ChegadaDoCadastro | null {
  if (!(CAMPOS_DE_CHEGADA as readonly string[]).includes(field)) return null;

  const wabaId = texto(value.waba_id) ?? texto(wabaIdDaEntry);
  // Sem WABA não há o que guardar: é a chave natural da linha, e uma linha sem
  // ela seria um registro que o operador vê e não consegue amarrar a nada.
  if (!wabaId) return null;

  const numeros = Array.isArray(value.phone_numbers)
    ? (value.phone_numbers as Record<string, unknown>[])
    : [];
  const primeiro = numeros[0] ?? {};

  return {
    wabaId,
    businessName:
      texto(value.business_name) ??
      texto((value.business as Record<string, unknown> | undefined)?.name) ??
      null,
    phoneNumberId: texto(value.phone_number_id) ?? texto(primeiro.id) ?? null,
    phoneNumber: texto(value.display_phone_number) ?? texto(primeiro.display_phone_number) ?? null,
    payload: value,
  };
}

/**
 * Grava (ou atualiza) a chegada. Reenvio da Meta atualiza a mesma linha — o
 * índice único de `waba_id` é o que garante que o operador não abra a tela e
 * tenha de escolher qual das três cópias é a boa.
 *
 * NÃO mexe em linha já amarrada a um cliente: um `account_update` que chegue
 * depois (a Meta manda vários, ao longo da vida da conta) não pode desfazer a
 * decisão que alguém já tomou.
 */
export async function guardarChegada(
  admin: SupabaseClient,
  chegada: ChegadaDoCadastro,
): Promise<boolean> {
  try {
    const { data: existente } = await admin
      .from("meta_onboardings")
      .select("id, organization_id")
      .eq("waba_id", chegada.wabaId)
      .maybeSingle();

    const linha = {
      waba_id: chegada.wabaId,
      business_name: chegada.businessName,
      phone_number_id: chegada.phoneNumberId,
      phone_number: chegada.phoneNumber,
      payload: chegada.payload,
      updated_at: new Date().toISOString(),
    };

    if (existente && (existente as { organization_id?: string | null }).organization_id) {
      // Já é de alguém: atualiza só o retrato (nome, número), nunca o vínculo.
      await admin
        .from("meta_onboardings")
        .update({
          business_name: linha.business_name,
          phone_number_id: linha.phone_number_id,
          phone_number: linha.phone_number,
          payload: linha.payload,
          updated_at: linha.updated_at,
        })
        .eq("waba_id", chegada.wabaId);
      return true;
    }

    const { error } = await admin
      .from("meta_onboardings")
      .upsert(linha, { onConflict: "waba_id" });
    if (error) {
      logger.warn("[cadastro-incorporado] não deu para guardar a chegada", {
        detail: error.message,
      });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn("[cadastro-incorporado] falhou ao guardar", {
      detail: err instanceof Error ? err.message : "erro",
    });
    return false;
  }
}
