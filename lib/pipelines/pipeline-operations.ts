/**
 * FORK MIA — as operações de FUNIL: criar e editar, fora do Route Handler.
 *
 * ── Por que isto saiu das rotas ───────────────────────────────────────────
 *
 * O MCP de plataforma (`lib/mcp-plataforma/`) passou a montar o funil de um
 * cliente por conversa, e a regra da casa é que toda escrita por ferramenta
 * reusa o caminho da TELA. A sequência que cria um funil (validar o nome antes
 * de tocar no banco, calcular slug e posição, eleger padrão o primeiro, desfazer
 * o funil se as etapas não entrarem) e a que o edita (liberar o padrão antigo
 * antes de marcar o novo) moravam dentro de `app/api/v1/pipelines/route.ts` e
 * `[id]/route.ts`. Uma cópia delas aqui divergiria no primeiro ajuste, em
 * silêncio. Movidas, as rotas ficam só com o transporte, e uma mudança do
 * upstream nelas vira conflito de fusão (barulhento) em vez de comportamento
 * diferente entre a tela e a ferramenta (mudo).
 *
 * É o mesmo desenho que o upstream já usa para as etapas
 * (`lib/leads/stage-operations.ts`): a operação lança `ApiError`, e a rota
 * traduz com `respostaDeRecusa`. O texto de cada recusa é o que a tela mostrava
 * antes, palavra por palavra.
 *
 * O que NÃO veio para cá: arquivar e excluir (`DELETE`). A implantação nunca
 * apaga funil, e mover o que ninguém precisa compartilhar seria mexer no
 * arquivo do upstream sem ganho.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import type { Actor } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import {
  ETAPAS_INICIAIS,
  posicaoEntre,
  slugDeFunil,
  updatesDeMarcaExclusiva,
  updatesDePadrao,
  validarNomeDeFunil,
  type FunilEditavel,
} from "@/lib/pipelines/pipeline-editing";

type SB = SupabaseClient;

export interface DepsDeFunil {
  supabase: SB;
  organizationId: string;
  /** Quem está agindo. NUNCA sai do input: é resolvido de fonte confiável pelo chamador. */
  actor: Actor;
  requestId: string;
}

/** `position` entra: a reordenação calcula em cima dela. As mesmas colunas de `_funis.ts`. */
const COLUNAS =
  "id, name, slug, description, position, is_default, is_client_pipeline, is_archived";

/**
 * Os funis da organização, na ordem da lista, arquivados inclusive.
 *
 * Mesma leitura de `app/api/v1/pipelines/_funis.ts` (`lerFunis`), que continua
 * servindo o `DELETE`. O filtro explícito de organização é obrigatório aqui: a
 * ferramenta de plataforma chega com `service_role`, sem RLS embaixo.
 */
export async function lerFunisDaOrganizacao(supabase: SB, orgId: string): Promise<FunilEditavel[]> {
  const { data, error } = await supabase
    .from("crm_pipelines")
    .select(COLUNAS)
    .eq("organization_id", orgId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as FunilEditavel[];
}

async function funisOuErro(deps: DepsDeFunil): Promise<FunilEditavel[]> {
  try {
    return await lerFunisDaOrganizacao(deps.supabase, deps.organizationId);
  } catch (err) {
    throw new ApiError(500, "internal_error", undefined, deps.requestId, (err as Error).message);
  }
}

/**
 * Recusa do banco traduzida, ou `null` se o erro não é de conflito.
 *
 * A mesma frase de `conflitoDoBanco` em `_funis.ts` (que devolve `Response` e
 * segue servindo o `DELETE`): `23505` é o conflito que dois funis editados em
 * duas abas produzem, e o texto do Postgres não ensina nada a quem só queria
 * trocar o funil padrão.
 */
function conflitoDoFunil(
  erro: { code?: string } | null | undefined,
  nomeDoFunil: string,
  requestId: string,
): ApiError | null {
  if (erro?.code !== "23505") return null;
  return new ApiError(
    409,
    "state_conflict",
    undefined,
    requestId,
    `«${nomeDoFunil}» mudou enquanto você editava — outro funil já ocupa esse nome ou o lugar de padrão. ` +
      `Recarregue a página e tente de novo.`,
  );
}

function autorDoAudit(actor: Actor): string | null {
  return actor.type === "user" ? actor.id : null;
}

// ---------------------------------------------------------------------------
// criar
// ---------------------------------------------------------------------------

/** As etapas com que o funil nasce, já com a régua de posição do board. */
function etapasIniciais(orgId: string, pipelineId: string) {
  return ETAPAS_INICIAIS.map((etapa, i) => ({
    organization_id: orgId,
    pipeline_id: pipelineId,
    name: etapa.name,
    slug: etapa.slug,
    position: (i + 1) * 1000,
    is_won: etapa.is_won,
    is_lost: etapa.is_lost,
  }));
}

export interface FunilCriado {
  pipelineId: string;
  slug: string;
  isDefault: boolean;
  /** A lista relida do banco: quem chama mostra o que o banco tem. */
  funis: FunilEditavel[];
}

/**
 * Cria um funil COM as etapas com que ele nasce (`ETAPAS_INICIAIS`).
 *
 * `input.name` chega já validado na FORMA por quem chama (a rota usa Zod); aqui
 * mora o que depende do banco.
 */
export async function criarFunil(
  deps: DepsDeFunil,
  input: { name: string; description?: string | null },
): Promise<FunilCriado> {
  const orgId = deps.organizationId;
  const name = input.name.trim();
  const description = input.description?.trim() || null;

  const funis = await funisOuErro(deps);

  // ⚠️ VALIDAR ANTES DE TOCAR O BANCO. O índice único é a rede de segurança, não
  // a primeira linha: um 23505 cru não diz QUAL funil já tem esse nome.
  const veredito = validarNomeDeFunil(name, funis, null);
  if (!veredito.ok) {
    throw new ApiError(422, "unprocessable_entity", undefined, deps.requestId, veredito.erro);
  }

  const row = {
    organization_id: orgId,
    name,
    description,
    // Arquivados entram na conta do slug: `uniq_crm_pipelines_org_slug` não é parcial.
    slug: slugDeFunil(name, funis.map((f) => f.slug)),
    // No fim da lista: funil novo aparecendo no meio seria a tela decidindo por
    // quem criou. A leitura vem ordenada.
    position: posicaoEntre(funis[funis.length - 1]?.position ?? null, null),
    // ⚠️ O PRIMEIRO FUNIL DA ORGANIZAÇÃO NASCE PADRÃO. Numa instalação onde o
    // gatilho de seed não rodou, a org fica sem padrão nenhum — e todo lead
    // criado sem funil escolhido não teria para onde ir. `uniq_..._org_default`
    // é parcial, então só os ativos disputam esse lugar.
    is_default: funis.filter((f) => !f.is_archived).length === 0,
  };

  const { data: criado, error } = await deps.supabase
    .from("crm_pipelines")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    throw (
      conflitoDoFunil(error as { code?: string }, name, deps.requestId) ??
      new ApiError(500, "internal_error", undefined, deps.requestId, error.message)
    );
  }
  const pipelineId = (criado as { id: string }).id;

  const { error: etapasErr } = await deps.supabase
    .from("crm_stages")
    .insert(etapasIniciais(orgId, pipelineId));

  // ⚠️ COMPENSAÇÃO, PORQUE SÃO DUAS ESCRITAS SEM TRANSAÇÃO. Um funil sem etapa é
  // quadro morto: o board abre sem coluna nenhuma, não recebe negócio, e quem
  // criou não tem como saber que aquilo nasceu quebrado. O funil recém-criado
  // ainda não tem negócio, então `crm_leads_pipeline_id_fkey ON DELETE RESTRICT`
  // não atrapalha o desfazimento. A alternativa correta-por-construção seria uma
  // função SQL transacional — que custaria migration + apêndice no baseline para
  // um caso que estas três linhas cobrem.
  if (etapasErr) {
    await deps.supabase
      .from("crm_pipelines")
      .delete()
      .eq("id", pipelineId)
      .eq("organization_id", orgId);
    throw new ApiError(
      500,
      "internal_error",
      { erro: etapasErr.message },
      deps.requestId,
      `Não consegui criar as etapas de «${name}». Nada foi salvo — tente de novo.`,
    );
  }

  void audit({
    action: "pipeline.created",
    actorUserId: autorDoAudit(deps.actor),
    organizationId: orgId,
    resourceType: "crm_pipeline",
    resourceId: pipelineId,
    requestId: deps.requestId,
    metadata: { name, slug: row.slug, is_default: row.is_default },
  });

  // Relê em vez de espelhar o que foi pedido: a tela mostra o que o banco tem.
  return { pipelineId, slug: row.slug, isDefault: row.is_default, funis: await funisOuErro(deps) };
}

// ---------------------------------------------------------------------------
// atualizar
// ---------------------------------------------------------------------------

/** O corpo do `PATCH /api/v1/pipelines/[id]`, já validado na forma pela rota. */
export interface PedidoDeEdicaoDoFunil {
  name?: string;
  description?: string | null;
  is_default?: boolean;
  is_client_pipeline?: boolean;
  is_archived?: boolean;
  /** O vizinho DE CIMA (`null` = primeiro da lista), não um número de posição. */
  depois_de?: string | null;
}

type PatchDoFunil = {
  name?: string;
  description?: string | null;
  position?: number;
  is_default?: boolean;
  is_client_pipeline?: boolean;
  is_archived?: boolean;
};

export interface FunilAtualizado {
  funis: FunilEditavel[];
  /** Os UPDATEs que saíram, na ordem. Vazio = o pedido já estava atendido. */
  updates: Array<{ pipelineId: string; patch: PatchDoFunil }>;
}

export async function atualizarFunil(
  deps: DepsDeFunil,
  input: { pipelineId: string; pedido: PedidoDeEdicaoDoFunil },
): Promise<FunilAtualizado> {
  const { pipelineId, pedido } = input;
  const orgId = deps.organizationId;
  const recusa = (status: number, code: string, mensagem: string) =>
    new ApiError(status, code, undefined, deps.requestId, mensagem);

  const funis = await funisOuErro(deps);

  // Funil de outra org morre AQUI, antes de qualquer escrita: a leitura filtra
  // por `organization_id`, então ele simplesmente não está nesta lista — e a
  // resposta é a mesma de um funil inexistente (dizer "existe, mas não é seu" já
  // vaza a existência).
  const alvo = funis.find((f) => f.id === pipelineId);
  if (!alvo) throw recusa(404, "not_found", "Funil não encontrado.");

  // ⚠️ ARQUIVAR É DO `DELETE`, NÃO DAQUI — ele conta as dependências antes
  // (`validarArquivamento`), e esta operação não conta nenhuma.
  if (pedido.is_archived === true) {
    throw recusa(
      422,
      "unprocessable_entity",
      `Para arquivar «${alvo.name}», use a opção Arquivar da lista de funis — ela confere antes se algum ` +
        `formulário ou automação ainda manda negócio para ele. Por aqui só dá para tirar do arquivo.`,
    );
  }

  // ⚠️ ARQUIVADO NÃO SE EDITA — e a guarda fica, mas o MOTIVO escrito aqui era
  // falso. Dizia que `uniq_crm_pipelines_org_default` é parcial em
  // `is_archived`, e que por isso marcar um arquivado como padrão "passa pelo
  // índice". Medido em `supabase/baseline.sql`: ele é `where (is_default = true)`
  // e mais nada, então essa marcação bate em 23505, não passa.
  //
  // O que a guarda evita de verdade é pior de explicar ao usuário: editar nome,
  // posição ou marca de um funil que sumiu da lista dele. Alcançável sem má-fé —
  // uma aba aberta antes de o funil ser arquivado — e o erro do banco, quando
  // vem, fala de índice, não do que a pessoa fez.
  //
  // ⚠️ A ÚNICA EXCEÇÃO É TIRÁ-LO DO ARQUIVO, E SÓ SE FOR ISSO SOZINHO (#979).
  // Pedido MISTO (desarquivar + renomear, por exemplo) continua 409: quem o
  // montou está com uma tela antiga na frente, e as validações de nome e de
  // posição são medidas contra a lista de ATIVOS — lista de onde o alvo ainda
  // não saiu no instante em que elas rodariam. Aceitar metade do pedido seria
  // pior: o funil voltaria com o nome velho e ninguém saberia por quê.
  const soTiraDoArquivo = pedido.is_archived === false && Object.keys(pedido).length === 1;
  if (alvo.is_archived && !soTiraDoArquivo) {
    throw recusa(
      409,
      "state_conflict",
      `O funil «${alvo.name}» está arquivado e não está mais na sua lista. Tire-o do arquivo antes de editar.`,
    );
  }

  if (pedido.name !== undefined) {
    const veredito = validarNomeDeFunil(pedido.name, funis, pipelineId);
    if (!veredito.ok) throw recusa(422, "unprocessable_entity", veredito.erro);
  }

  // ⚠️ O PADRÃO SE MUDA, NÃO SE APAGA — mesma regra da marcação de ganho nas
  // etapas. Sem funil padrão, todo lead criado sem funil escolhido fica sem
  // destino; e o índice único não impede a organização de ficar com ZERO.
  if (pedido.is_default === false) {
    throw recusa(
      422,
      "unprocessable_entity",
      `«${alvo.name}» é o funil padrão e a organização precisa de um. Marque OUTRO funil como padrão — ` +
        `o padrão se muda, não se apaga.`,
    );
  }

  const patchDoAlvo: PatchDoFunil = {};
  if (pedido.name !== undefined) patchDoAlvo.name = pedido.name.trim();
  if (pedido.description !== undefined) {
    patchDoAlvo.description = pedido.description?.trim() || null;
  }

  // Tirar do arquivo é update SIMPLES: nenhum índice a disputar (nem o de slug
  // nem o de padrão são parciais em `is_archived`, então o funil já ocupava o
  // lugar dele enquanto estava arquivado). Só entra no patch se ele ESTIVER
  // arquivado — pedir de novo em quem já está fora é pedido já atendido, e uma
  // escrita vazia viraria linha de auditoria sem fato nenhum por trás.
  const tiraDoArquivo = pedido.is_archived === false && alvo.is_archived;
  if (tiraDoArquivo) patchDoAlvo.is_archived = false;

  if (pedido.depois_de !== undefined) {
    // Só os ativos compõem a régua: arquivado não ocupa lugar na lista.
    const ativos = funis.filter((f) => !f.is_archived && f.id !== pipelineId);
    const i = pedido.depois_de === null ? -1 : ativos.findIndex((f) => f.id === pedido.depois_de);
    if (pedido.depois_de !== null && i < 0) {
      throw recusa(
        422,
        "unprocessable_entity",
        "O funil que você escolheu como vizinho não está mais na lista. Recarregue a página.",
      );
    }
    const posicao = posicaoEntre(ativos[i]?.position ?? null, ativos[i + 1]?.position ?? null);
    // `posicaoEntre` devolve NaN com vizinhos de MESMA posição (lista que precisa
    // de rebalanceamento). NaN vira `null` no JSON e a coluna é NOT NULL: seria um
    // 23502 cru. Recusar aqui é a diferença entre "tente de novo" e "null value in
    // column position violates not-null constraint".
    if (!Number.isFinite(posicao)) {
      throw recusa(
        409,
        "state_conflict",
        "Os funis desta lista estão empatados na ordenação. Recarregue a página e mova o funil para outro lugar.",
      );
    }
    patchDoAlvo.position = posicao;
  }

  // Eleger padrão pode exigir DOIS updates (liberar o antigo, ocupar o lugar);
  // nome, descrição e posição viajam junto com o update do alvo, nunca num terceiro.
  // O tipo é o mais LARGO dos dois de propósito: `UpdateDePadrao` (só `is_default`)
  // cabe aqui dentro, e declarar assim evita o cast que esconderia um erro real
  // se o formato do patch de padrão mudasse.
  const updates: Array<{ pipelineId: string; patch: PatchDoFunil }> =
    pedido.is_default === true
      ? updatesDePadrao(funis, pipelineId)
      : pedido.is_client_pipeline === true
        ? updatesDeMarcaExclusiva(funis, pipelineId, "is_client_pipeline")
        : [];

  // Desligar é update SIMPLES: não há anterior a liberar, e nenhum índice a
  // disputar. Entra pelo patch do alvo como nome e descrição entram.
  if (pedido.is_client_pipeline === false) patchDoAlvo.is_client_pipeline = false;
  if (Object.keys(patchDoAlvo).length > 0) {
    const i = updates.findIndex((u) => u.pipelineId === pipelineId);
    if (i >= 0) updates[i] = { pipelineId, patch: { ...updates[i]!.patch, ...patchDoAlvo } };
    else updates.push({ pipelineId, patch: patchDoAlvo });
  }

  // ⚠️ EM SEQUÊNCIA, NA ORDEM QUE `updatesDePadrao` DEVOLVE.
  // `uniq_crm_pipelines_org_default` é imediato (não deferível): marcar o novo
  // antes de liberar o antigo é 23505 na cara do usuário. Disparar em paralelo
  // desfaz exatamente essa proteção.
  for (const u of updates) {
    const { error } = await deps.supabase
      .from("crm_pipelines")
      .update(u.patch)
      .eq("id", u.pipelineId)
      .eq("organization_id", orgId);
    if (!error) continue;

    const nome = funis.find((f) => f.id === u.pipelineId)?.name ?? alvo.name;
    throw (
      conflitoDoFunil(error as { code?: string }, nome, deps.requestId) ??
      new ApiError(500, "internal_error", undefined, deps.requestId, error.message)
    );
  }

  if (updates.length > 0) {
    void audit({
      // Tirar do arquivo tem código PRÓPRIO, espelhando o `pipeline.archived`
      // que o DELETE emite: quem audita quer saber quem trouxe o funil de volta,
      // e `pipeline.updated` esconderia isso entre os renames.
      action: tiraDoArquivo ? "pipeline.unarchived" : "pipeline.updated",
      actorUserId: autorDoAudit(deps.actor),
      organizationId: orgId,
      resourceType: "crm_pipeline",
      resourceId: pipelineId,
      requestId: deps.requestId,
      metadata: { pedido, updates },
    });
  }

  return { funis: await funisOuErro(deps), updates };
}
