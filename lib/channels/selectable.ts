/**
 * A lista de canais que uma tela pode OFERECER como destino.
 *
 * ─── Por que é uma função só, e não um `select` por tela ─────────────────────
 * O filtro de canal arquivado nasceu espalhado: cada tela com seletor de número
 * escrevia o próprio `select` em `channel_sessions`, e três ficaram sem o
 * `archived_at is null`. O efeito não é cosmético — o canal que o usuário acabou
 * de excluir continuava no dropdown, e salvar um roteador com ele devolvia 404
 * "Número de WhatsApp não encontrado nesta organização": mensagem falsa, porque
 * ele ESTÁ na organização, arquivado. Com uma função só, o próximo seletor nasce
 * filtrado sem ninguém precisar lembrar do filtro.
 *
 * ─── Por que erro SOBE ───────────────────────────────────────────────────────
 * Devolver lista vazia quando a consulta falhou é indistinguível de "esta
 * organização não tem número" — e é assim que se convida alguém a parear de novo
 * um número que já está no ar.
 *
 * Há DUAS falhas toleradas, e as duas pela mesma regra: tolera-se o que, dando
 * errado, devolve a lista de ANTES daquele filtro — nunca o que a esvazia.
 *
 *   `archived_at` ausente   (banco sem a migration 0106) → nada está arquivado,
 *                           e a lista sem o filtro é a lista exata.
 *   o filtro do NÚMERO DE   → volta a aparecer na lista, que é o defeito que
 *   AVISOS (item G4)          já existia. Bloquear a tela seria defeito NOVO.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { nomeDoCanal } from "@/lib/channels/estado";

import { ARCHIVED_AT, isColumnMissing, queryTolerantToMissingArchived } from "./archived";
import { PROVIDERS_DE_MENSAGEM } from "./capabilities";

/** A coluna que marca o número da plataforma. Nome numa constante porque ele
 * aparece no `select` e na deteção de "coluna ausente", e duas grafias
 * divergiriam com o sintoma de a tolerância nunca disparar. */
const COLUNA_AVISOS = "e_numero_de_avisos";

/** Um canal oferecível como destino, já com o rótulo resolvido para a tela. */
export interface SelectableChannel {
  id: string;
  display_name: string;
  status: string;
  phone_number: string | null;
}

const COLUNAS_BASE = "id, display_name, status, phone_number, waha_session_name";

/**
 * O número de avisos vem NO MESMO `select` (item G4).
 *
 * A primeira versão deste filtro fazia uma SEGUNDA consulta, só para descobrir
 * quais ids eram o número de avisos. Custava uma ida a mais ao banco no
 * caminho quente do editor de agente — e, pior, dois `from("channel_sessions")`
 * na mesma função quebraram os testes que já existiam: o duplo de Supabase
 * deles devolve a mesma resposta para qualquer consulta, então a segunda
 * recebia as LINHAS DE CANAL como se fossem as do número de avisos e filtrava
 * tudo. O sintoma foi um seletor vazio — o defeito que o docstring acima
 * chama de pior que todos.
 *
 * Uma coluna a mais no `select` que já ia acontecer não tem nenhum desses
 * problemas.
 */
const COLUNAS_COM_AVISOS = `${COLUNAS_BASE}, ${COLUNA_AVISOS}`;

interface LinhaCanal {
  id: string;
  display_name: string | null;
  status: string;
  phone_number: string | null;
  waha_session_name: string | null;
  /** Ausente num banco que ainda não recebeu a coluna — ver `COLUNAS_COM_AVISOS`. */
  e_numero_de_avisos?: boolean | null;
}

/**
 * Canais ativos da organização, do mais antigo para o mais novo (ordem estável:
 * um dropdown que embaralha a cada render faz o operador clicar no item errado).
 *
 * `db` aceita tanto o client do usuário (RLS) quanto o admin — quem chama com o
 * admin já é responsável pelo `organization_id`, que aqui é sempre explícito.
 */
export async function listSelectableChannels(
  db: SupabaseClient,
  organizationId: string,
): Promise<SelectableChannel[]> {
  const base = (colunas: string) => () =>
    db
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", organizationId)
      // Esta é a FONTE ÚNICA dos seletores de "Número conectado" — e alimenta
      // também `lib/ai/agents/first-publication.ts` (que amarra o primeiro
      // agente publicado a `canais[0]`) e o retrato de
      // `app/api/v1/system/instalacao/route.ts` (que conta canal conectado).
      // Uma linha de chamada de voz (spec 18) aqui vira número escolhível,
      // agente preso a um canal mudo e "1 canal conectado" numa instalação com
      // zero canal de mensagem.
      .in("provider", [...PROVIDERS_DE_MENSAGEM]);

  const tolerandoArquivado = (colunas: string) =>
    queryTolerantToMissingArchived(
      () => base(colunas)().is(ARCHIVED_AT, null).order("created_at", { ascending: true }),
      () => base(colunas)().order("created_at", { ascending: true }),
    );

  /**
   * Tenta COM a coluna do número de avisos; sem ela no banco, repete sem.
   *
   * É a mesma tolerância que `archived_at` já tinha, e pela mesma regra do
   * docstring: tolera-se o que, dando errado, devolve a lista de ANTES daquele
   * filtro. Um `select` que nomeia coluna inexistente derruba a consulta
   * inteira (42703), e esta função alimenta o editor de agente — bloquear a
   * tela seria trocar um defeito velho ("o número aparece numa lista") por um
   * novo ("a tela não abre").
   */
  let { data, error } = await tolerandoArquivado(COLUNAS_COM_AVISOS);
  if (isColumnMissing(error, COLUNA_AVISOS)) {
    ({ data, error } = await tolerandoArquivado(COLUNAS_BASE));
  }
  if (error) throw new Error(`channel_sessions_list_failed: ${error.message ?? "unknown"}`);

  // `as unknown as` porque o `select()` recebe a lista de colunas como
  // VARIÁVEL (são duas, com e sem a coluna do número de avisos) e o
  // supabase-js só infere a forma da linha quando ela é literal. O tipo
  // verdadeiro está em `LinhaCanal`, e é ele que o resto do arquivo usa.
  return ((data ?? []) as unknown as LinhaCanal[])
    // O NÚMERO DE AVISOS DA PLATAFORMA sai daqui (item G4). Ele é da
    // instalação, não do cliente, e continua listado em Conexões da
    // organização que o conectou — é por ali que se lê o QR e se reconecta.
    // O que não pode é aparecer no seletor de "Número conectado": nada
    // impedia amarrar um agente nele por engano, e o efeito seria a IA de um
    // cliente atendendo pelo número que avisa TODOS os grupos.
    //
    // `=== true` e não `truthy`: num banco sem a coluna o campo vem
    // `undefined`, e isso tem de significar "não sei, então mostra".
    .filter((c) => c.e_numero_de_avisos !== true)
    .map((c) => ({
      id: c.id,
      // ⚠️ `waha_session_name` SAIU DESTA CADEIA. Ele era o segundo degrau, e o
      // resultado aparecia na tela: um canal sem apelido virava a opção
      // `org_2dd5e6ea` no seletor "Número conectado" do editor de agente — o
      // identificador que NÓS geramos para o transporte, exposto como se fosse o
      // nome do número da pessoa. Um canal sem apelido e sem telefone é um canal
      // sem nome, e dizer isso é melhor do que inventar um.
      display_name: nomeDoCanal(c),
      status: c.status,
      phone_number: c.phone_number ?? null,
    }));
}
