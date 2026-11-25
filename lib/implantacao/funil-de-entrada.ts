/**
 * FORK MIA (upstream 1.119, 9430, MIA-96) — o FUNIL DE ENTRADA de um número: o
 * funil e a etapa onde a conversa nova DAQUELE número vira negócio
 * (`channel_sessions.entry_pipeline_id` e `entry_stage_id`). Os dois nulos são o
 * comportamento de sempre: o funil padrão da organização.
 *
 * ── O caminho da tela que isto espelha ────────────────────────────────────
 *
 * `PATCH /api/v1/channel-sessions/[id]/entrada` (Conexões › o número › Funil de
 * entrada). A lógica mora dentro da rota, e a cerca dos espelhos
 * (`tests/unit/mcp-de-implantacao-espelhos.test.ts`) guarda a impressão dela. As
 * mesmas regras, na mesma ordem:
 *
 *   1. o funil é da organização do NÚMERO e não está arquivado;
 *   2. a etapa (opcional) é desse funil, não está arquivada e não é de ganho nem
 *      de perda: o card nasce numa etapa aberta;
 *   3. sem funil, a etapa vira nula (a coluna da etapa só vale com o funil);
 *   4. pedido igual ao gravado não escreve; mudou, a trilha é
 *      `channel.entry_pipeline_changed`, com o de e o para.
 *
 * Quem APLICA é `lib/leads/nascimento-do-lead.ts`, que confere de novo na hora de
 * usar e cai no funil padrão quando a escolha não serve mais.
 *
 * ── O que é diferente da tela, e por quê ──────────────────────────────────
 *
 * Funil e etapa vêm pelo NOME (ou pelo id), como em toda ferramenta do MCP, e a
 * recusa lista os que existem. Etapa sem funil é recusada (a rota zera calada):
 * o implantador que mandou a etapa queria um funil, e zerar seria fazer outra
 * coisa do que foi pedido.
 */
import { audit } from "@/lib/audit";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

import { acharPorNomeOuId, chaveDoNome, type Implantacao } from "./base";

/** O que a ferramenta pede: `funil: null` volta ao funil padrão da organização. */
export interface FunilDeEntradaPedido {
  /** Nome ou id do funil. `null` = o funil padrão da organização. */
  funil: string | null;
  /** Nome ou id de uma etapa aberta do funil. Ausente ou `null` = a etapa de entrada do próprio funil. */
  etapa?: string | null;
}

/** O retrato que a leitura e a resposta devolvem. */
export interface FunilDeEntradaLido {
  /** `true` = o número segue o funil padrão da organização (nada escolhido). */
  padrao: boolean;
  funil: { id: string; nome: string } | null;
  /** `null` com funil escolhido = a etapa de entrada do próprio funil. */
  etapa: { id: string; nome: string } | null;
}

interface FunilVivo {
  id: string;
  name: string;
  is_default: boolean;
  /** As etapas onde um card pode nascer: abertas, nem ganho nem perdido. */
  etapas: Array<{ id: string; name: string }>;
}

/** Os funis vivos da organização com as etapas abertas: o que o seletor da tela oferece (o GET da rota). */
async function lerFunisDaEntrada(c: Pick<Implantacao, "admin" | "orgId">): Promise<FunilVivo[]> {
  const [funis, etapas] = await Promise.all([
    c.admin
      .from("crm_pipelines")
      .select("id, name, is_default")
      .eq("organization_id", c.orgId)
      .eq("is_archived", false)
      .order("created_at", { ascending: true }),
    c.admin
      .from("crm_stages")
      .select("id, name, pipeline_id, position")
      .eq("organization_id", c.orgId)
      .eq("is_archived", false)
      .eq("is_won", false)
      .eq("is_lost", false)
      .order("position", { ascending: true }),
  ]);
  if (funis.error) throw new Error(`não consegui ler os funis: ${funis.error.message}`);
  if (etapas.error) throw new Error(`não consegui ler as etapas: ${etapas.error.message}`);
  const abertas = (etapas.data ?? []) as Array<{ id: string; name: string; pipeline_id: string }>;
  return ((funis.data ?? []) as Array<{ id: string; name: string; is_default: boolean | null }>).map((f) => ({
    id: f.id,
    name: f.name,
    is_default: f.is_default === true,
    etapas: abertas.filter((e) => e.pipeline_id === f.id).map((e) => ({ id: e.id, name: e.name })),
  }));
}

interface ColunasDaEntrada {
  entry_pipeline_id: string | null;
  entry_stage_id: string | null;
}

/** As duas colunas como a leitura as mostra, com o nome do funil e da etapa. */
function retrato(linha: ColunasDaEntrada | undefined, nomes: Map<string, string>): FunilDeEntradaLido {
  const funilId = linha?.entry_pipeline_id ?? null;
  const etapaId = funilId ? (linha?.entry_stage_id ?? null) : null;
  return {
    padrao: funilId === null,
    funil: funilId ? { id: funilId, nome: nomes.get(funilId) ?? funilId } : null,
    etapa: etapaId ? { id: etapaId, nome: nomes.get(etapaId) ?? etapaId } : null,
  };
}

/**
 * O funil de entrada de cada número da organização, para a seção `canais` de
 * plataforma_ver_configuracao. Funil arquivado continua aparecendo pelo id: a
 * coluna ainda aponta para ele, e quem cria o negócio cai no padrão.
 */
export async function lerFunisDeEntrada(
  c: Pick<Implantacao, "admin" | "orgId">,
): Promise<Map<string, FunilDeEntradaLido>> {
  const { data, error } = await c.admin
    .from("channel_sessions")
    .select("id, entry_pipeline_id, entry_stage_id")
    .eq("organization_id", c.orgId)
    .is("archived_at", null);
  if (error) throw new Error(`não consegui ler o funil de entrada das conexões: ${error.message}`);
  const linhas = (data ?? []) as Array<ColunasDaEntrada & { id: string }>;
  const nomes = new Map<string, string>();
  if (linhas.some((l) => l.entry_pipeline_id)) {
    const [funis, etapas] = await Promise.all([
      c.admin.from("crm_pipelines").select("id, name").eq("organization_id", c.orgId),
      c.admin.from("crm_stages").select("id, name").eq("organization_id", c.orgId),
    ]);
    if (funis.error) throw new Error(`não consegui ler os funis: ${funis.error.message}`);
    if (etapas.error) throw new Error(`não consegui ler as etapas: ${etapas.error.message}`);
    for (const x of [...(funis.data ?? []), ...(etapas.data ?? [])] as Array<{ id: string; name: string }>) nomes.set(x.id, x.name);
  }
  return new Map(linhas.map((l) => [l.id, retrato(l, nomes)]));
}

/**
 * Define o funil de entrada de UM número. `canal` já foi achado pela operação de
 * canal (`acharCanal`), dentro desta organização.
 */
export async function definirFunilDeEntrada(
  c: Implantacao,
  canal: { id: string },
  pedido: FunilDeEntradaPedido,
): Promise<FunilDeEntradaLido & { desfecho: "atualizou" | "ja_estava" }> {
  const funis = await lerFunisDaEntrada(c);
  let funil: FunilVivo | null = null;
  let etapa: { id: string; name: string } | null = null;

  if (pedido.funil === null) {
    if (pedido.etapa !== undefined && pedido.etapa !== null) {
      throw new Recusa(
        "`funil_de_entrada.etapa` só vale com um funil: sem `funil` (null), o número volta ao funil padrão da organização e entra na etapa de entrada dele. " +
          'Mande os dois, ex.: { "funil": "Atacado", "etapa": "Novo contato" }, ou só { "funil": null } para voltar ao padrão.',
      );
    }
  } else {
    funil = acharPorNomeOuId(funis, pedido.funil, (f) => f.name, {
      singular: "o funil",
      comoListar: "Funil arquivado não serve de entrada. Crie o funil com plataforma_garantir_funil, ou veja os que existem em plataforma_ver_funis.",
    });
    if (pedido.etapa !== undefined && pedido.etapa !== null) {
      const ref = pedido.etapa.trim();
      const porId = funil.etapas.find((e) => e.id === ref);
      const porNome = funil.etapas.filter((e) => chaveDoNome(e.name) === chaveDoNome(ref));
      etapa = porId ?? (porNome.length === 1 ? porNome[0]! : null);
      if (!etapa) {
        throw new Recusa(
          porNome.length > 1
            ? `O funil «${funil.name}» tem ${porNome.length} etapas abertas chamadas «${ref}». Informe o id: ${porNome.map((e) => e.id).join(", ")}.`
            : `\`funil_de_entrada.etapa\`: escolha uma etapa ABERTA do funil «${funil.name}» (nem ganho nem perdido, não arquivada). ` +
                (funil.etapas.length > 0
                  ? `As que servem: ${funil.etapas.map((e) => `«${e.name}»`).join(", ")}. Sem etapa, o card nasce na etapa de entrada do funil.`
                  : "Este funil não tem nenhuma etapa aberta."),
        );
      }
    }
  }

  const pipelineId = funil?.id ?? null;
  const stageId = etapa?.id ?? null;
  const nomes = new Map<string, string>();
  if (funil) nomes.set(funil.id, funil.name);
  if (etapa) nomes.set(etapa.id, etapa.name);

  const { data: antes, error: erroAoLer } = await c.admin
    .from("channel_sessions")
    .select("entry_pipeline_id, entry_stage_id")
    .eq("organization_id", c.orgId)
    .eq("id", canal.id)
    .is("archived_at", null)
    .maybeSingle();
  if (erroAoLer) throw new Error(`não consegui ler a conexão: ${erroAoLer.message}`);
  if (!antes) throw new Recusa("A conexão foi arquivada ou não existe mais nesta organização.");
  // Os valores, e não a linha: a trilha guarda o de ANTES do update.
  const funilAnterior = (antes as ColunasDaEntrada).entry_pipeline_id ?? null;
  const etapaAnterior = (antes as ColunasDaEntrada).entry_stage_id ?? null;

  if (funilAnterior === pipelineId && etapaAnterior === stageId) {
    return { ...retrato({ entry_pipeline_id: pipelineId, entry_stage_id: stageId }, nomes), desfecho: "ja_estava" };
  }

  const { data, error } = await c.admin
    .from("channel_sessions")
    .update({ entry_pipeline_id: pipelineId, entry_stage_id: stageId })
    .eq("organization_id", c.orgId)
    .eq("id", canal.id)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`não consegui salvar o funil de entrada: ${error.message}`);
  if (!data) throw new Recusa("A conexão foi arquivada ou não existe mais nesta organização.");

  void audit({
    action: "channel.entry_pipeline_changed",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "channel_session",
    resourceId: canal.id,
    requestId: c.requestId,
    metadata: {
      previous_entry_pipeline_id: funilAnterior,
      previous_entry_stage_id: etapaAnterior,
      entry_pipeline_id: pipelineId,
      entry_stage_id: stageId,
      via: "mcp_plataforma",
    },
  });
  return { ...retrato({ entry_pipeline_id: pipelineId, entry_stage_id: stageId }, nomes), desfecho: "atualizou" };
}
