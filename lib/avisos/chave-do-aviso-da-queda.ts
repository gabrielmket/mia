/**
 * FORK MIA (MIA-48) — a CHAVE do aviso da queda do número, por cliente.
 *
 * Mora em `organizations.settings`, ao lado de `grupo_de_avisos`, pela mesma
 * razão que ele: é escolha de operação, não entidade, e não pede migration.
 * Vem LIGADA: só o `false` gravado desliga. Sem grupo de avisos configurado,
 * ligada não manda nada (`lib/avisos/aviso-da-queda.ts`).
 *
 * Arquivo puro e separado de propósito: quem grava a chave (o MCP de plataforma,
 * `lib/implantacao/empresa.ts`) não precisa carregar o envio de WhatsApp.
 */

/** Onde a chave mora dentro de `organizations.settings`. */
export const CHAVE_DO_AVISO_DA_QUEDA = "aviso_da_queda_do_numero";

/** A chave como o cron a lê: ausente ou lixo = ligada. */
export function avisoDaQuedaLigado(settings: unknown): boolean {
  if (!settings || typeof settings !== "object") return true;
  return (settings as Record<string, unknown>)[CHAVE_DO_AVISO_DA_QUEDA] !== false;
}
