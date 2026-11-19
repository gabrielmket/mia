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
import {
  lerIdentidadesSociaisDeTeste,
  lerModoDeAcessoDaIa,
  lerNumerosDeTeste,
} from "@/lib/ai/elegibilidade/pre-go-live";
import type { AcessoDaAiDoCanal } from "@/lib/ai/elegibilidade/aviso-do-modo-de-teste";

import { ARCHIVED_AT, isColumnMissing, queryTolerantToMissingArchived } from "./archived";
import { PROVIDERS_DE_MENSAGEM, capabilitiesOf, transportaMensagem } from "./capabilities";
import type { ProviderDeMensagem } from "./types";

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
  /**
   * O canal manda TEXTO LIVRE a qualquer hora?
   *
   * É a pergunta que a conexão de avisos de caso precisa fazer, e ela é de
   * CAPACIDADE, não de provedor: o aviso sai quando a IA trava, sem nenhuma
   * janela de 24 horas aberta pela equipe — e nunca haverá uma, porque o número
   * do suporte não conversa com ninguém. Um canal que exige modelo aprovado
   * aceitaria a configuração e nunca entregaria um aviso.
   *
   * Sai daqui, e não de um `if` na tela, porque `docs/doctrine/restricao-de-
   * canal.md` (invariante 1) proíbe nome de provedor fora de `lib/channels/` —
   * e `pnpm lint:channels` reprova, inclusive em comentário. O campo é ADITIVO:
   * quem já consumia `SelectableChannel` não muda uma linha.
   */
  aceitaMensagemLivre: boolean;
  /**
   * O canal devolve a venda à Meta pela conversa (capability `reportaConversao`)?
   * É o que decide se a chave "Enviar vendas pelo canal da conversa" tem o que
   * acionar. Também de CAPACIDADE, nunca de provedor.
   */
  reportaConversao: boolean;
  /**
   * A IA consegue responder com NOTA DE VOZ por este canal (capability
   * `voiceNote` diferente de `none`)? A tela do agente usa para avisar, ao lado
   * de "Enviar nota de voz", que neste canal a resposta sai em texto — sem isso
   * o dono liga a voz numa conta de Instagram e não entende por que ela não fala.
   * Também de CAPACIDADE, nunca de provedor.
   */
  enviaNotaDeVoz: boolean;
  /**
   * Como o acesso da IA está NESTE canal — modo e quantos números de teste estão
   * autorizados. Sem isto, a tela do agente não tinha como saber que o número
   * escolhido está em modo de teste com a lista vazia, que é o estado de fábrica
   * de todo canal: a IA não responde ninguém e a tela dizia que estava tudo
   * certo (#3976).
   *
   * Contagem, nunca a lista: os telefones autorizados são PII e exigem
   * administrador (`/api/v1/channel-sessions/[id]/ai-access`). Quem decide a
   * frase é `decidirAvisoDoModoDeTeste` — a tela não reescreve a regra.
   */
  acessoDaAi: AcessoDaAiDoCanal;
}

// `provider` entra no `select` por causa de `aceitaMensagemLivre`. Ele é lido
// aqui e MORRE aqui: o DTO leva a capacidade, nunca o nome do provedor. Ele fica
// nas COLUNAS_BASE (e não só na variante com avisos) porque a queda para a lista
// base é justamente o caminho do banco antigo — e um canal sem `provider` no DTO
// viraria "não aceita recado" em TODA a lista num banco sem a migration 0257.
//
// `metadata` entra SÓ para derivar `acessoDaAi` (modo e contagem, upstream
// 1.10x). O DTO leva o resumo, nunca a metadata crua — é ela que carrega os
// telefones de teste. Fica na base pelo mesmo motivo do `provider`.
const COLUNAS_BASE =
  "id, display_name, status, phone_number, waha_session_name, provider, metadata";

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
  provider: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * A capacidade de mandar texto livre, resolvida sem deixar o erro escapar.
 *
 * `capabilitiesOf` LANÇA para provedor fora da matriz — é o fail-closed certo no
 * caminho de ENVIO. Aqui ele seria o desfecho errado: um clone que aplicou o
 * baseline antes de puxar a imagem nova tem, na coluna, um provedor que este
 * build não conhece, e um throw apagaria a lista INTEIRA de conexões — inclusive
 * as que funcionam. `false` é a resposta conservadora e local: "não use ESTE
 * canal para mandar recado".
 */
function aceitaMensagemLivre(provider: string | null): boolean {
  if (!transportaMensagem(provider)) return false;
  try {
    return capabilitiesOf(provider as ProviderDeMensagem).freeformOutsideWindow;
  } catch {
    return false;
  }
}

/** Mesma régua de `aceitaMensagemLivre`: provedor desconhecido deste build responde `false`. */
function reportaConversao(provider: string | null): boolean {
  if (!transportaMensagem(provider)) return false;
  try {
    return capabilitiesOf(provider as ProviderDeMensagem).reportaConversao;
  } catch {
    return false;
  }
}

/** Mesma régua: provedor desconhecido deste build responde `false` (não promete voz). */
function enviaNotaDeVoz(provider: string | null): boolean {
  if (!transportaMensagem(provider)) return false;
  try {
    return capabilitiesOf(provider as ProviderDeMensagem).voiceNote !== "none";
  } catch {
    return false;
  }
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
      aceitaMensagemLivre: aceitaMensagemLivre(c.provider),
      reportaConversao: reportaConversao(c.provider),
      enviaNotaDeVoz: enviaNotaDeVoz(c.provider),
      acessoDaAi: {
        // O MESMO leitor do runtime (`gate.ts` → `lerModoDeAcessoDaIa`): a tela
        // não pode chamar de "modo de teste" um canal que o motor trata de outro
        // jeito, nem o contrário.
        mode: lerModoDeAcessoDaIa(c.metadata),
        // Testadores de QUALQUER lista: telefone ou conta de rede social. Contar
        // só telefones faria a tela do agente dizer "a IA não responde ninguém"
        // num canal de Instagram com conta de teste autorizada.
        testNumbersCount:
          lerNumerosDeTeste(c.metadata).length + lerIdentidadesSociaisDeTeste(c.metadata).length,
      },
    }));
}
