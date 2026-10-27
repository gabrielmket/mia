/**
 * FORK MIA (.96) · OS AVISOS DO PASSO DO PAGAMENTO, POR E-MAIL.
 *
 * Os avisos de cobrança são todos da MIA (decisão 8): o lembrete do dia seguinte,
 * o Pix do fim do teste e o bloqueio do fim do teste. Mesmo molde dos e-mails
 * da régua do upstream (`lib/cobranca/emails.ts`): um e-mail por administrador
 * da empresa, com a marca da instalação, no idioma da empresa. Melhor esforço:
 * e-mail que não sai vira log (sem endereço), nunca exceção.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { marcaDaSaida } from "@/lib/branding/saida";
import { emailsDosAdmins } from "@/lib/cobranca/emails";
import { sendEmail } from "@/lib/email/roteador";
import { buildEmailDaCobranca } from "@/lib/email/templates/cobranca";
import { env } from "@/lib/env";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { logger } from "@/lib/logger";

export interface AvisoPorEmail {
  titulo: string;
  corpo: string;
  /** `href` absoluto, ou um caminho do sistema (`/onboarding/pagamento`). */
  botao: { rotulo: string; href: string };
}

/** O endereço do sistema para um caminho. */
export function enderecoDoSistema(caminho: string): string {
  return `${(env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "")}${caminho}`;
}

/** Manda o aviso a cada administrador da empresa. Devolve quantos receberam. Nunca lança. */
export async function avisarOsAdmins(
  admin: SupabaseClient,
  org: { id: string; idioma: Idioma },
  aviso: AvisoPorEmail,
  enviar: typeof sendEmail = sendEmail,
): Promise<number> {
  try {
    const para = await emailsDosAdmins(admin, org.id);
    if (para.length === 0) return 0;
    const marca = await marcaDaSaida(org.id);
    const t = (s: string) => traduzir(s, org.idioma);
    const email = buildEmailDaCobranca({
      titulo: aviso.titulo,
      corpo: aviso.corpo,
      marca,
      idioma: org.idioma,
      botao: { rotulo: aviso.botao.rotulo, href: aviso.botao.href.startsWith("/") ? enderecoDoSistema(aviso.botao.href) : aviso.botao.href },
      rodape: t("Você recebe este aviso porque administra esta empresa."),
    });
    for (const to of para) {
      const r = await enviar({
        to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromName: marca.nome,
        tags: [{ name: "tipo", value: "cobranca" }],
      });
      if (!r.ok) logger.warn("pagamento_inicial.email_nao_saiu", { organization_id: org.id, erro: r.error ?? "desconhecido" });
    }
    return para.length;
  } catch (e) {
    logger.warn("pagamento_inicial.email_nao_saiu", { organization_id: org.id, erro: e instanceof Error ? e.message : "desconhecido" });
    return 0;
  }
}
