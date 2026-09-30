/**
 * FORK MIA · CLIENTE MODELO — a sessão-âncora da empresa de demonstração.
 *
 * As conversas fictícias da demonstração precisam de uma sessão de canal (a FK
 * de `conversations.channel_session_id` é obrigatória), mas a demonstração não
 * fala com ninguém: a sessão nasce ARQUIVADA e a migration 9010 não deixa
 * desarquivar. Nenhum transporte chega a ser procurado.
 *
 * Mora AQUI, e não na semente, pela doutrina de restrição de canal: só
 * `lib/channels/` nomeia o transporte. A semente pede as colunas e não sabe de
 * qual provider elas são.
 */
import { DEFAULT_CHANNEL_PROVIDER } from "./capabilities";
import type { ChannelProvider } from "./types";

/** As colunas de transporte da sessão-âncora (o nome é o identificador da sessão). */
export function colunasDaSessaoDaDemonstracao(nomeDaSessao: string): {
  provider: ChannelProvider;
  waha_session_name: string;
} {
  return { provider: DEFAULT_CHANNEL_PROVIDER, waha_session_name: nomeDaSessao };
}
