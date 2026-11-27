/**
 * O AGENTE PUBLICADO SEGUE A IA DA PLATAFORMA — FORK MIA (MIA-309; desenho na
 * MIA-285, seção 3; docs/fork/ia-da-plataforma.md, seção 8).
 *
 * ── O defeito ──────────────────────────────────────────────────────────────
 *
 * A troca em `/admin/modelo-de-ia` chega a `settings.llm` de toda empresa que
 * segue a plataforma (os gatilhos da 9172). Mas o turno do agente não lê
 * `settings.llm`: lê o par GRAVADO na versão publicada (`provider`, `model`,
 * `credential_id`), e a versão publicada é imutável no banco. Na próxima troca,
 * os agentes já publicados ficariam no modelo antigo, calados sobre isso.
 *
 * ── A regra ────────────────────────────────────────────────────────────────
 *
 * Na CARGA da versão (`lib/agent-engine/agent/agent-config.ts`, um ponto no fim
 * da lista de colunas e um no fim de `mapAgentConfigRow`), para a empresa com
 * `ia_segue_a_plataforma = true`:
 *
 *   - `provider` e `model` passam a ser os de `settings.llm` da empresa (que o
 *     gatilho mantém igual a `platform_ia`);
 *   - `credentialId` vira `null`: o resolvedor desce a escada de sempre
 *     (credencial ativa da empresa naquele provedor, senão a da instalação);
 *   - com o provedor da plataforma DIFERENTE do da versão, `operatorModel` e a
 *     reserva de modelo (9368) também viram `null`. Os dois foram escolhidos ao
 *     lado do par da versão: o modelo do operador é um id do provedor antigo, e
 *     a reserva foi pensada como saída para quando o provedor antigo caísse.
 *     Sem eles, o operador usa o mesmo modelo da conversa e não há degrau, que é
 *     o comportamento de quem não configurou nada.
 *
 * O resto da versão fica como está, inclusive o teto por versão
 * (`cost_budget_cents`, `token_budget`).
 *
 * `settings.llm` sem provedor ou sem modelo não muda nada: a versão é a melhor
 * informação que sobra, e trocar por um par pela metade seria pior.
 *
 * Empresa com escolha própria (`ia_segue_a_plataforma = false`) fica com a
 * versão intacta: ela escolheu.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { enxergaImagem } from "@/lib/ai/pontos/capacidade-em-vigor";
import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";

/**
 * A coluna que a carga da versão acrescenta no FIM de
 * `SELECT_AGENT_CONFIG_COLUMNS`: o `settings.llm` da empresa quando ela segue
 * a plataforma E a plataforma escolheu um par em `platform_ia`; senão `null`.
 * Sem par na plataforma, o gatilho da 9172 não mexe em `settings.llm` (ficaria
 * o padrão semeado do produto), e a versão é a melhor informação que sobra.
 * Todo carregador daquela lista usa o alias `a` para `ai_agents`. O resolvedor
 * do turno (`SQL_CONFIG_COM_ORCAMENTO`) já lê as duas tabelas com o mesmo pool.
 */
export const COLUNA_DA_IA_DA_PLATAFORMA = `(select o.settings->'llm' from organizations o
               where o.id = a.organization_id
                 and o.ia_segue_a_plataforma is true
                 and exists (select 1 from platform_ia p where p.id = 1 and p.provider is not null and p.model_id is not null)
            ) as ia_da_plataforma`;

/** Os campos da versão que a regra pode trocar. */
export interface ParDaVersao {
  provider: string;
  model: string;
  credentialId: string | null;
  operatorModel: string | null;
  reserveProvider?: string | null;
  reserveModel?: string | null;
}

/**
 * O par de `settings.llm` que vale, ou `null` (a empresa não segue, ou o
 * jsonb não tem provedor e modelo).
 */
export function parDaPlataforma(iaDaPlataforma: unknown): { provider: string; model: string } | null {
  if (iaDaPlataforma === null || typeof iaDaPlataforma !== "object") return null;
  const llm = iaDaPlataforma as { provider?: unknown; default_model?: unknown };
  const provider = typeof llm.provider === "string" ? llm.provider.trim() : "";
  const model = typeof llm.default_model === "string" ? llm.default_model.trim() : "";
  return provider !== "" && model !== "" ? { provider, model } : null;
}

/**
 * A config da versão com o par da plataforma, para quem segue. Pura.
 * `iaDaPlataforma` é a coluna `ia_da_plataforma` da carga: o `settings.llm`
 * de quem segue, `null` para quem tem escolha própria.
 */
export function agenteSegueAPlataforma<T extends ParDaVersao>(config: T, iaDaPlataforma: unknown): T {
  const par = parDaPlataforma(iaDaPlataforma);
  if (par === null) return config;
  const trocouDeProvedor = par.provider !== config.provider;
  return {
    ...config,
    provider: par.provider,
    model: par.model,
    credentialId: null,
    ...(trocouDeProvedor ? { operatorModel: null, reserveProvider: null, reserveModel: null } : {}),
  } as T;
}

// ── A conta da plataforma (MCP e a trava de /admin/modelo-de-ia) ────────────

/** Um agente publicado, com o que a conta precisa da versão no ar. */
export interface AgentePublicado {
  organizationId: string;
  provider: string;
  model: string;
  /** O agente lê a foto do cliente: `multimodal_input` ligado e `image_vision_enabled` não desligado. */
  usaFoto: boolean;
}

/** Teto de páginas: 100 × 1000 agentes, como o lote de `iaDasEmpresas`. */
const PAGINAS_MAXIMAS = 100;

/**
 * Os agentes PUBLICADOS e não arquivados de todas as empresas, com o par
 * GRAVADO na versão no ar (antes da regra). `null` quando a leitura falhou ou
 * passou do teto: quem conta diz "não sei", nunca a conta de um recorte.
 */
export async function agentesPublicados(admin: SupabaseClient): Promise<AgentePublicado[] | null> {
  type Linha = {
    organization_id: string;
    versao: {
      provider: string | null;
      model: string | null;
      status: string | null;
      multimodal_input: boolean | null;
      image_vision_enabled: boolean | null;
    } | null;
  };
  try {
    const leitura = await lerTodasAsPaginas<Linha>(
      (de, ate, pedirContagem) =>
        admin
          .from("ai_agents")
          .select(
            "organization_id, versao:ai_agent_versions!ai_agents_published_version_id_fkey(provider, model, status, multimodal_input, image_vision_enabled)",
            pedirContagem ? { count: "exact" } : undefined,
          )
          .not("published_version_id", "is", null)
          .is("archived_at", null)
          .order("id", { ascending: true })
          .range(de, ate),
      { paginasMaximas: PAGINAS_MAXIMAS },
    );
    if (leitura.erro || leitura.truncado) return null;
    return leitura.linhas
      .filter((l) => l.versao !== null && l.versao.status === "published")
      .map((l) => ({
        organizationId: l.organization_id,
        provider: l.versao!.provider ?? "",
        model: l.versao!.model ?? "",
        usaFoto: l.versao!.multimodal_input === true && l.versao!.image_vision_enabled !== false,
      }));
  } catch {
    return null;
  }
}

/** A empresa como a conta precisa: a origem e o par em vigor (`iaDasEmpresas`). */
export interface EmpresaParaAConta {
  organizationId: string;
  origem: "plataforma" | "propria";
  provider: string;
  modelId: string | null;
}

/**
 * Por empresa: quantos agentes publicados ela tem e quantos respondem FORA do
 * par em vigor, com a regra aplicada como na carga. Para quem segue a
 * plataforma tem de dar zero: é a prova de que a troca em `/admin/modelo-de-ia`
 * chegou aos agentes. Para quem tem escolha própria, conta o agente que ficou
 * num modelo diferente do padrão da empresa (pode ser de propósito).
 */
export function agentesForaDoPar(
  empresas: ReadonlyArray<EmpresaParaAConta>,
  agentes: ReadonlyArray<AgentePublicado>,
): Map<string, { publicados: number; foraDoPar: number }> {
  const porEmpresa = new Map(empresas.map((e) => [e.organizationId, e]));
  const conta = new Map<string, { publicados: number; foraDoPar: number }>();
  for (const e of empresas) conta.set(e.organizationId, { publicados: 0, foraDoPar: 0 });
  for (const a of agentes) {
    const empresa = porEmpresa.get(a.organizationId);
    const linha = conta.get(a.organizationId);
    if (!empresa || !linha) continue;
    const emVigor =
      empresa.origem === "plataforma"
        ? agenteSegueAPlataforma(
            { provider: a.provider, model: a.model, credentialId: null, operatorModel: null },
            { provider: empresa.provider, default_model: empresa.modelId },
          )
        : a;
    linha.publicados += 1;
    if (emVigor.provider !== empresa.provider || emVigor.model !== empresa.modelId) linha.foraDoPar += 1;
  }
  return conta;
}

/**
 * Quantos agentes publicados das empresas que seguem a plataforma (e operam)
 * leem a foto do cliente. Com algum, a plataforma não pode passar para um
 * modelo que não enxerga imagem: o agente deixaria de ler o comprovante sem
 * ninguém ver.
 */
export function agentesQueSeguemEUsamFoto(
  empresas: ReadonlyArray<EmpresaParaAConta & { operante: boolean }>,
  agentes: ReadonlyArray<AgentePublicado>,
): number {
  const seguem = new Set(empresas.filter((e) => e.origem === "plataforma" && e.operante).map((e) => e.organizationId));
  return agentes.filter((a) => a.usaFoto && seguem.has(a.organizationId)).length;
}

/** A recusa da trava de `/admin/modelo-de-ia`, no formato que a rota devolve. */
export interface RecusaDoModeloDaPlataforma {
  codigo: "modelo_sem_visao" | "db_error";
  mensagem: string;
  status: 422 | 500;
}

/**
 * A TRAVA DA VISÃO de `/admin/modelo-de-ia`: o modelo novo da plataforma passa a
 * atender os agentes já publicados de quem segue. Com algum deles lendo foto
 * (`multimodal_input` e `image_vision_enabled`), um modelo que não enxerga
 * imagem faria o agente ignorar o comprovante do cliente, calado. A capacidade
 * é a que o motor usa (`enxergaImagem`, catálogo e registro). A de ferramentas
 * a rota já confere no catálogo (`supports_tools`).
 *
 * `null` = pode salvar. Leitura que falhou recusa (a ação falha fechada).
 */
export async function recusaDoModeloSemVisao(
  admin: SupabaseClient,
  p: {
    provider: string;
    modelId: string;
    empresas: ReadonlyArray<EmpresaParaAConta & { operante: boolean }>;
  },
): Promise<RecusaDoModeloDaPlataforma | null> {
  const { data, error } = await admin
    .from("ai_models")
    .select("supports_vision")
    .eq("provider", p.provider)
    .eq("model_id", p.modelId)
    .is("deprecated_at", null)
    .maybeSingle();
  if (error) {
    return { codigo: "db_error", mensagem: "Não deu para conferir se o modelo enxerga imagem. Tente de novo.", status: 500 };
  }
  const doCatalogo = (data as { supports_vision?: boolean | null } | null)?.supports_vision ?? null;
  if (enxergaImagem({ provider: p.provider, modelId: p.modelId, doCatalogo })) return null;

  const agentes = await agentesPublicados(admin);
  if (agentes === null) {
    return {
      codigo: "db_error",
      mensagem: "Não deu para conferir os agentes das empresas que seguem a plataforma. Tente de novo.",
      status: 500,
    };
  }
  const comFoto = agentesQueSeguemEUsamFoto(p.empresas, agentes);
  if (comFoto === 0) return null;
  const quem =
    comFoto === 1
      ? "1 agente de uma empresa que segue a plataforma lê as fotos que os clientes mandam"
      : `${comFoto} agentes de empresas que seguem a plataforma leem as fotos que os clientes mandam`;
  return {
    codigo: "modelo_sem_visao",
    mensagem: `Não dá para salvar: esse modelo não enxerga imagem, e ${quem}. Escolha um modelo que enxerga imagem.`,
    status: 422,
  };
}
