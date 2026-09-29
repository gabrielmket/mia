import type { ChannelAdapter } from "@/lib/channels";

/**
 * Os grupos do número de avisos, no formato que a tela lê (`id`, `nome`).
 *
 * FORK MIA — usa o `listGroups` do UPSTREAM (v1.61, "grupos na inbox"). O fork
 * tinha criado o seu, com o MESMO nome no `ChannelAdapter` e outro formato, e
 * a fusão fez os dois colidirem; ficou o dele, que também lê o formato em mapa
 * e o `JID`, e o fork carrega uma diferença a menos nos arquivos dele.
 *
 * ⚠️ `null` é FALHA (canal fora do ar, sessão caída; o do upstream LANÇA) e
 * `[]` é "não está em grupo nenhum". Juntar os dois faria a tela dizer "nenhum
 * grupo" quando o problema é que ninguém respondeu, e o operador iria adicionar
 * o número a um grupo onde ele já está.
 */
export async function gruposDoNumero(
  adapter: Pick<ChannelAdapter, "listGroups">,
  sessionRef: string,
): Promise<Array<{ id: string; nome: string }> | null> {
  if (!adapter.listGroups) return null;
  try {
    const grupos = await adapter.listGroups({ sessionRef });
    return grupos.map((g) => ({ id: g.chatId, nome: g.subject || g.chatId }));
  } catch {
    return null;
  }
}
