import type { ChannelAdapter } from "@/lib/channels";
import {
  motivoDaFalhaAoListarGrupos,
  type MotivoDaFalhaDeGrupos,
} from "@/lib/channels/motivo-da-falha-de-grupos";

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
  const r = await lerGruposDoNumero(adapter, sessionRef);
  return r.ok ? r.grupos : null;
}

export type LeituraDosGrupos =
  | { ok: true; grupos: Array<{ id: string; nome: string }> }
  | { ok: false; motivo: MotivoDaFalhaDeGrupos };

/**
 * A mesma leitura, com o PORQUÊ da falha.
 *
 * Em produção (29/09/2026) o seletor de grupo de cada empresa ficou travado e
 * a tela só dizia "não consegui perguntar ao WhatsApp" — um beco sem saída. O
 * motivo é um CÓDIGO que vem de `lib/channels/` (o único lugar que pode ler o
 * erro do transporte); a frase, traduzida, é da tela.
 */
export async function lerGruposDoNumero(
  adapter: Pick<ChannelAdapter, "listGroups">,
  sessionRef: string,
): Promise<LeituraDosGrupos> {
  if (!adapter.listGroups) {
    return { ok: false, motivo: "recusado" };
  }
  try {
    const grupos = await adapter.listGroups({ sessionRef });
    return { ok: true, grupos: grupos.map((g) => ({ id: g.chatId, nome: g.subject || g.chatId })) };
  } catch (err) {
    return { ok: false, motivo: motivoDaFalhaAoListarGrupos(err) };
  }
}
