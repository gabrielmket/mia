/**
 * FORK MIA (.76) — se a conexão tem a opção "guardar o histórico do número".
 *
 * A opção (`lib/channels/acervo-do-historico.ts`, do upstream) só faz efeito no
 * número conectado por QR Code: é o transporte do QR que guarda o histórico.
 * O número oficial e as redes sociais não têm o que guardar. Quem pergunta é o
 * MCP de plataforma (`plataforma_configurar_canal` recusa explicando, e
 * `plataforma_ver_configuracao` mostra `null` para quem não tem a opção).
 *
 * Mora aqui, e não na feature, pela doutrina de restrição de canal: nenhuma
 * feature nomeia o provider; ela pergunta a `lib/channels/`.
 */
import type { ChannelProvider } from "./types";

const COM_HISTORICO_GUARDADO: ReadonlySet<ChannelProvider> = new Set<ChannelProvider>(["waha"]);

export function conexaoGuardaHistorico(provider: string | null | undefined): boolean {
  return provider != null && COM_HISTORICO_GUARDADO.has(provider as ChannelProvider);
}
