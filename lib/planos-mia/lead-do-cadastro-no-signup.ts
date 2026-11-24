/**
 * FORK MIA (MIA-168) · O PONTO DO `signUp` (app/actions/auth/signUp.ts).
 *
 * Monta a entrada do lead a partir do que a action já tem (o formulário, o
 * plano, o cupom, quem assina na entrada paga) e do que só o servidor vê: o IP,
 * o navegador, a página de onde veio e os cookies do site (`_fbp`, `_fbc` e
 * `mia_consentimento`, de `.iamia.com.br`). Mora fora de `lead-do-cadastro.ts`
 * porque lê `next/headers`, e aquele módulo roda também no worker.
 *
 * Nunca lança: o cadastro não depende do CRM.
 */
import { cookies } from "next/headers";

import type { SignupInput } from "@/lib/auth/schemas";
import { ipDoClienteParaInet } from "@/lib/http/ip-do-cliente";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

import { consentimentoDoCookie, registrarCadastroNaTime, type ResultadoDoEnvio } from "./lead-do-cadastro";
import { origemSaneada } from "./origem-do-cadastro";

export interface EntradaDoSignup {
  userId: string;
  dados: SignupInput;
  planoId?: string | null;
  cupom?: string | null;
  /** Só na entrada paga: quem assina. */
  nome?: string | null;
  headers: Headers;
}

async function nomeDoPlano(admin: ReturnType<typeof createAdminClient>, planoId: string | null | undefined): Promise<string | null> {
  if (!planoId) return null;
  const { data } = await admin.from("cobranca_planos").select("nome").eq("id", planoId).maybeSingle();
  return (data as { nome?: string } | null)?.nome ?? null;
}

export async function registrarCadastroDoSignup(e: EntradaDoSignup): Promise<ResultadoDoEnvio> {
  try {
    const admin = createAdminClient();
    const potes = await cookies();
    const consentimento = consentimentoDoCookie(potes.get("mia_consentimento")?.value);
    return await registrarCadastroNaTime(admin, {
      userId: e.userId,
      email: e.dados.email,
      empresa: e.dados.org_name,
      nome: e.nome ?? null,
      // O WhatsApp só existe na entrada paga (o mesmo campo dos dados fiscais).
      telefone: e.nome ? (e.dados.mia_fiscal?.telefone ?? null) : null,
      plano: await nomeDoPlano(admin, e.planoId),
      cupom: e.cupom ?? null,
      origem: origemSaneada(e.dados.mia_origem),
      fbp: potes.get("_fbp")?.value ?? null,
      fbc: potes.get("_fbc")?.value ?? null,
      consentimento,
      ip: ipDoClienteParaInet(e.headers),
      navegador: e.headers.get("user-agent"),
      pagina: e.headers.get("referer"),
    });
  } catch (erro) {
    logger.warn("[cadastro-na-time] o envio do cadastro falhou", { userId: e.userId, detail: erro instanceof Error ? erro.message : "erro" });
    return { ok: false, motivo: "falhou" };
  }
}
