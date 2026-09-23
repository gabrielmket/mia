/**
 * Resolução da sessão dona de um webhook da Meta.
 *
 * Existe porque o `lint-channels` me pegou: a rota `/api/v1/webhooks/meta/[token]`
 * cravava `.eq("provider", "meta_cloud")`, e nome de provider fora de
 * `lib/channels/` viola o invariante 1 da doutrina de restrição de canal.
 *
 * A tentação era pôr a rota na allowlist do lint — afinal, um endpoint de webhook
 * É inerentemente específico do provider (o protocolo da Meta não é o do WAHA).
 * Mas allowlist sem conserto é dívida silenciosa: o nome continuaria espalhado, e a
 * próxima rota copiaria o padrão. Mover a query para cá custa 20 linhas e mantém a
 * regra valendo de verdade — a rota vira transporte puro e não sabe com quem fala.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "../archived";
import { CHANNEL_PROVIDER_META } from "../capabilities";

export interface MetaWebhookSession {
  id: string;
  organizationId: string;
  wabaId: string | null;
}

/**
 * A sessão oficial ATIVA da organização **e o número dela**.
 *
 * O par `(organization_id, meta_phone_number_id)` é a chave com que
 * `resolveMetaCreds` acha a credencial que o operador salvou na tela — a mesma porta
 * que `send`, `checkHealth` e `fetchInboundMedia` já usam. Mora aqui, e não na rota,
 * porque nome de provider fora de `lib/channels/` viola o invariante 1 (o
 * `lint-channels` pegou isso uma vez e a lição ficou); e existe como interface
 * própria para não obrigar a sessão do WEBHOOK, que não tem número, a carregar um
 * campo que ela nunca preenche.
 */
export interface MetaSessaoDaOrg extends MetaWebhookSession {
  /** `channel_sessions.meta_phone_number_id` — `null` em base anterior à 0144. */
  phoneNumberId: string | null;
}

/**
 * Sessão amarrada a este token de webhook. `null` = token desconhecido — o que
 * NÃO é mais o fim da linha: quem decide o dono do evento é `donoDoEvento`, e
 * ele pergunta à WABA quando o token não responde. (Era "a rota responde 404
 * sem revelar por quê"; continua valendo para quem chama esta função direto,
 * mas a rota já não para aqui.)
 *
 * Canal ARQUIVADO continua contando como token desconhecido, e essa é a única
 * resposta honesta: o usuário mandou excluir o canal. A exclusão já revoga a
 * credencial e rotaciona este token, mas o evento em voo (e a re-entrega que a
 * plataforma faz de tudo que não recebe 2xx) chegaria com o token antigo e
 * ressuscitaria o canal — criando contato, conversa e mensagem num inbox onde o
 * operador nem consegue responder, porque o arquivamento deixa a sessão STOPPED.
 * `metaSessionByWabaId` filtra arquivado pelo mesmo motivo, então a promessa
 * continua de pé pelos dois caminhos.
 *
 * ── O que se perdeu ao deixar de exigir o token ──────────────────────────────
 *
 * Antes, quem tivesse o App Secret E um token válido só escrevia na organização
 * daquele token. Agora escreveria em qualquer organização cuja WABA conhecesse.
 * A troca é consciente e barata: o App Secret é a chave-mestra do APP, e quem a
 * tem já manda mensagem, lê template e opera TODAS as WABAs conectadas pela
 * Graph API. Escrever no inbox delas não é escalada — é menos do que já dava. Do
 * outro lado da balança estava o produto inteiro: exigir o token fazia só o
 * primeiro cliente receber mensagem, e fazia arquivar um canal calar todos.
 */
export async function metaSessionByWebhookToken(
  token: string,
): Promise<MetaWebhookSession | null> {
  if (!token || token.length < 8) return null;

  const admin = createAdminClient();
  const base = () =>
    admin
      .from("channel_sessions")
      .select("id, organization_id, meta_waba_id")
      .eq("webhook_path_token", token)
      .eq("provider", CHANNEL_PROVIDER_META);
  const { data } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );

  if (!data) return null;
  return {
    id: data.id,
    organizationId: data.organization_id,
    wabaId: data.meta_waba_id ?? null,
  };
}

/**
 * A sessão DONA desta WABA — a chave que funciona com N clientes.
 *
 * ## Por que o token do caminho não basta
 *
 * A URL de callback do app da Meta é UMA SÓ, e o token nela aponta para UMA
 * sessão. Isso funciona enquanto houver uma conta WhatsApp; com duas, os
 * eventos da segunda chegam com o token da primeira, a rota vê que a WABA não
 * bate e DESCARTA em silêncio.
 *
 * E não é um caso de borda: é o desenho inteiro do cadastro embutido. Cada
 * cliente conecta a WABA dele ao NOSSO app, todas apontando para a mesma URL —
 * então, do jeito antigo, só o primeiro cliente receberia mensagem. Medido em
 * 17/09/2026, quando a segunda conta (Time Company, 4660237264244026) entrou ao
 * lado da de teste.
 *
 * ## Por que é seguro decidir pela WABA do corpo
 *
 * A rota só chega aqui DEPOIS de conferir a assinatura HMAC com o App Secret —
 * ou seja, depois de provar que quem falou foi a Meta. E a Meta só entrega os
 * eventos de uma WABA para os apps em que aquela WABA está inscrita. O
 * `waba_id` do payload não é uma alegação de terceiro: é o remetente
 * autenticado dizendo de qual conta dele veio o evento.
 *
 * O mapa WABA → organização continua sendo NOSSO (`channel_sessions`), e é ele
 * que decide onde escrever. Nenhum campo do corpo escolhe organização.
 */
export async function metaSessionByWabaId(
  wabaId: string,
): Promise<MetaWebhookSession | null> {
  if (!wabaId) return null;
  const admin = createAdminClient();
  const base = () =>
    admin
      .from("channel_sessions")
      .select("id, organization_id, meta_waba_id")
      .eq("meta_waba_id", wabaId)
      .eq("provider", CHANNEL_PROVIDER_META)
      .order("created_at", { ascending: true })
      .limit(1);
  const { data } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );
  if (!data) return null;
  return {
    id: data.id,
    organizationId: data.organization_id,
    wabaId: data.meta_waba_id ?? null,
  };
}

/**
 * A sessão oficial ATIVA da organização (se houver). Usada pela tela de templates
 * para saber QUAL WABA espelhar — e para dizer ao operador o que fazer quando não
 * há nenhuma, em vez de mostrar uma tabela vazia sem explicação.
 *
 * Arquivada não conta: sem o filtro, a tela seguia nomeando a WABA de um canal
 * que o operador excluiu e o botão de sincronizar continuava puxando templates
 * dela — o token do env não foi revogado junto com o da linha, então a chamada
 * ia mesmo. "Excluído" que continua operando é a promessa quebrada.
 */
export async function metaSessionForOrg(
  organizationId: string,
): Promise<MetaSessaoDaOrg | null> {
  const admin = createAdminClient();
  const base = () =>
    admin
      .from("channel_sessions")
      // `meta_phone_number_id` entra na seleção porque é a segunda metade da chave da
      // credencial (`organization_id` + ele): sem o número, quem chama não tem como
      // pedir a credencial DESTA sessão e volta a olhar o ambiente — que é o defeito
      // que a fatia F4 da #850 fecha.
      .select("id, organization_id, meta_waba_id, meta_phone_number_id")
      .eq("organization_id", organizationId)
      .eq("provider", CHANNEL_PROVIDER_META)
      .order("created_at", { ascending: true })
      .limit(1);
  const { data } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );

  if (!data) return null;
  return {
    id: data.id,
    organizationId: data.organization_id,
    wabaId: data.meta_waba_id ?? null,
    phoneNumberId: data.meta_phone_number_id ?? null,
  };
}
