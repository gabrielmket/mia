/**
 * FORK MIA (.102) · QUAIS NÚMEROS DA CONTA O RAIO-X DO CLIENTE ATIVO LÊ.
 *
 * Mora em `lib/channels/` porque é aqui que se pode dizer o NOME do transporte
 * (`scripts/lint-channels.ts`: nenhuma feature nomeia provider). O raio-X só
 * pergunta "é um número de WhatsApp?" e "é da API oficial?".
 *
 * A leitura do cliente ativo é do que JÁ ESTÁ na conta (`conversations` e
 * `messages`), não do aparelho: por isso o número da API oficial entra, ao
 * contrário da conexão da .101 (que precisa do aplicativo no celular).
 */
import {
  CHANNEL_PROVIDER_DATAFY,
  CHANNEL_PROVIDER_META,
  PROVIDERS_DE_TELEFONE,
} from "@/lib/channels/capabilities";

/** O canal é um número de WhatsApp (o endereço é um telefone)? Rede social e voz ficam de fora. */
export function ehNumeroDeWhatsapp(provider: string | null | undefined): boolean {
  return typeof provider === "string" && (PROVIDERS_DE_TELEFONE as readonly string[]).includes(provider);
}

/** O número está na API oficial do WhatsApp (direto ou pelo parceiro que a espelha)? */
export function ehApiOficial(provider: string | null | undefined): boolean {
  return provider === CHANNEL_PROVIDER_META || provider === CHANNEL_PROVIDER_DATAFY;
}
