/**
 * FORK MIA — A IA DO AGENTE É DA PLATAFORMA NO SERVIDOR, E NÃO SÓ NA TELA.
 *
 * Mesma doutrina da chave e do custo (`lib/ai/custo-e-da-plataforma.ts`) e do
 * modelo padrão (`lib/ai/modelo-da-plataforma.ts`): quem comprou atendimento
 * comprou um agente que funciona, e o cérebro dele — provedor, modelo, chave e
 * o modelo próprio do papel Operador — é escolha de quem opera a plataforma.
 *
 * ── O buraco que isto fecha ───────────────────────────────────────────────
 *
 * Até a .56 a regra morava só na TELA: o editor escondia o cartão da IA de
 * quem não é da plataforma. As rotas e ações do servidor continuavam gravando
 * o `provider`/`model`/`credential_id`/`operator_model` que viessem no corpo.
 * Bastava o admin da empresa mandar o campo à mão — pelo devtools ou pela API
 * pública — para trocar o modelo do agente, voltar para um modelo antigo pelo
 * "Reverter", ou pôr no ar um rascunho velho com outro modelo.
 *
 * ── O que cada porta faz com isto ─────────────────────────────────────────
 *
 *   versão NOVA        `travarIaDaVersaoNova` troca os quatro campos pela IA
 *                      de referência: a atual do agente (versão no ar; sem
 *                      ela, a mais nova) ou, para agente sem versão, a da
 *                      plataforma (`iaDoAgenteNovo`). O corpo é IGNORADO, não
 *                      recusado: é o que a tela do cliente já manda.
 *   versão EXISTENTE   `semCamposDaIa` tira os quatro campos do patch.
 *   pôr no ar         `iaPodeIrAoAr`: a versão só vai ao ar se a IA dela for a
 *                      atual do agente ou o par padrão da plataforma. É o que
 *                      impede publicar um rascunho antigo com outro modelo.
 *
 * O banco tem a mesma regra para quem escreve direto pelo PostgREST
 * (migration 9002). Aqui é o lado do servidor, que grava com `service_role` e
 * por isso não passa pelos gatilhos de lá.
 *
 * Quem é da plataforma (`podeConfigurarChaveDeIa`: admin de plataforma fora de
 * sessão de suporte) passa por tudo sem mudança — é ele quem escolhe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { podeConfigurarChaveDeIa } from "@/lib/ai/custo-e-da-plataforma";
import { iaDoAgenteNovo, modeloDaPlataforma } from "@/lib/ai/modelo-da-plataforma";
import type { AuthUser } from "@/lib/auth/types";

/** As quatro colunas de `ai_agent_versions` que são o cérebro do agente. */
export const CAMPOS_DA_IA = ["provider", "model", "credential_id", "operator_model"] as const;

export interface IaDaVersao {
  provider: string;
  model: string;
  credential_id: string | null;
  operator_model: string | null;
}

type QuemPede = Pick<AuthUser, "is_platform_admin" | "platform_admin_scope" | "support">;

/** A frase que volta para quem tentou trocar. Mesma da tela (AgentForm). */
export const MENSAGEM_IA_DA_PLATAFORMA =
  "A inteligência dos agentes desta conta é configurada pela nossa equipe. Fale com o suporte para trocar.";

/** Quem escolhe a IA: só a plataforma. */
export function escolheIa(user: QuemPede): boolean {
  return podeConfigurarChaveDeIa(user);
}

function iaDaLinha(linha: Record<string, unknown> | null | undefined): IaDaVersao | null {
  if (!linha) return null;
  return {
    provider: linha.provider as string,
    model: linha.model as string,
    credential_id: (linha.credential_id as string | null | undefined) ?? null,
    operator_model: (linha.operator_model as string | null | undefined) ?? null,
  };
}

/**
 * A IA que o agente usa hoje: a da versão no ar (o ponteiro que o motor
 * executa, `ai_agents.published_version_id`); sem versão no ar, a da versão
 * mais nova. `null` = o agente ainda não tem versão nenhuma.
 *
 * Service role: o filtro de organização é manual e obrigatório.
 */
export async function iaAtualDoAgente(
  admin: SupabaseClient,
  orgId: string,
  agentId: string,
): Promise<IaDaVersao | null> {
  const { data: agente } = await admin
    .from("ai_agents")
    .select("published_version_id")
    .eq("id", agentId)
    .eq("organization_id", orgId)
    .maybeSingle();

  const noAr = (agente as { published_version_id?: string | null } | null)?.published_version_id;
  if (noAr) {
    const { data } = await admin
      .from("ai_agent_versions")
      .select("provider, model, credential_id, operator_model")
      .eq("id", noAr)
      .eq("organization_id", orgId)
      .maybeSingle();
    const ia = iaDaLinha(data as Record<string, unknown> | null);
    if (ia) return ia;
  }

  const { data: maisNova } = await admin
    .from("ai_agent_versions")
    .select("provider, model, credential_id, operator_model")
    .eq("organization_id", orgId)
    .eq("agent_id", agentId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return iaDaLinha(maisNova as Record<string, unknown> | null);
}

/**
 * A IA com que nasce um agente SEM versão, criado por quem não escolhe IA: o
 * par da plataforma (`iaDoAgenteNovo`, a mesma régua da tela de criar e da
 * primeira publicação), com "a chave desta instalação" (`credential_id: null`,
 * que o runtime resolve) e sem modelo próprio de Operador.
 */
export async function iaDeAgenteNovo(
  admin: SupabaseClient,
  orgId: string,
): Promise<IaDaVersao | null> {
  const { data: org } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  const provedorDaOrganizacao = (
    (org as { settings?: { llm?: { provider?: string } } | null } | null)?.settings?.llm
  )?.provider;
  const par = await iaDoAgenteNovo(admin, provedorDaOrganizacao);
  if (!par) return null;
  return { provider: par.provider, model: par.model, credential_id: null, operator_model: null };
}

export type TravaDaIa<T> =
  | { ok: true; corpo: T }
  | { ok: false; erro: "ia_da_plataforma_indisponivel"; mensagem: string };

/**
 * Versão NOVA: devolve o corpo com a IA que vale.
 *
 * `agenteDeReferencia` é o agente cuja IA a versão herda — o próprio agente ao
 * criar versão nova ou reverter; o agente de ORIGEM ao duplicar; `null` para
 * agente novo. Sem versão no agente de referência, vale a da plataforma.
 */
export async function travarIaDaVersaoNova<T extends object>(
  admin: SupabaseClient,
  args: { user: QuemPede; orgId: string; agenteDeReferencia: string | null },
  corpo: T,
): Promise<TravaDaIa<T & IaDaVersao>> {
  if (escolheIa(args.user)) return { ok: true, corpo: corpo as T & IaDaVersao };

  const ia =
    (args.agenteDeReferencia
      ? await iaAtualDoAgente(admin, args.orgId, args.agenteDeReferencia)
      : null) ?? (await iaDeAgenteNovo(admin, args.orgId));

  if (!ia) {
    return {
      ok: false,
      erro: "ia_da_plataforma_indisponivel",
      mensagem:
        "A inteligência dos agentes desta conta é configurada pela nossa equipe e ainda não está pronta. Fale com o suporte.",
    };
  }
  return { ok: true, corpo: { ...corpo, ...ia } };
}

/**
 * DUPLICAR: a cópia de quem não escolhe IA leva a IA ATUAL do agente de origem.
 *
 * A duplicação copia o rascunho mais novo, e todo agente em produção tem
 * rascunho antigo com o modelo de antes: sem isto, "Duplicar" + "Publicar" na
 * cópia era um jeito de pôr um agente no ar com um modelo que a plataforma já
 * tinha trocado. `null` = quem pede escolhe IA, ou a origem não tem versão.
 */
export async function iaDaCopia(
  admin: SupabaseClient,
  args: { user: QuemPede; orgId: string; agentId: string },
): Promise<IaDaVersao | null> {
  if (escolheIa(args.user)) return null;
  return iaAtualDoAgente(admin, args.orgId, args.agentId);
}

/**
 * ROTEADOR: o classificador de intenção também é IA. Para quem não escolhe IA,
 * `classifier_model` e `classifier_provider` do corpo são ignorados: roteador
 * NOVO (`atual === null`) nasce no "Automático" — `null`, e o painel da
 * plataforma decide —, e o EXISTENTE fica com o que tem.
 *
 * `undefined` volta `undefined` para quem escolhe IA, e aí vale o default da
 * coluna, como no upstream.
 */
export function configDoRoteador(
  user: QuemPede,
  pedido: Record<string, unknown> | undefined,
  atual: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  if (escolheIa(user)) return pedido;
  const limpo: Record<string, unknown> = { ...(pedido ?? {}) };
  delete limpo.classifier_model;
  delete limpo.classifier_provider;
  if (atual === null) return { ...limpo, classifier_model: null, classifier_provider: null };
  return limpo;
}

/** Versão EXISTENTE: some com os quatro campos do patch de quem não escolhe IA. */
export function semCamposDaIa<T extends object>(user: QuemPede, patch: T): T {
  if (escolheIa(user)) return patch;
  const limpo = { ...patch } as Record<string, unknown>;
  for (const campo of CAMPOS_DA_IA) delete limpo[campo];
  return limpo as T;
}

function mesmaIa(a: IaDaVersao, b: IaDaVersao): boolean {
  return (
    a.provider === b.provider &&
    a.model === b.model &&
    (a.credential_id ?? null) === (b.credential_id ?? null) &&
    (a.operator_model ?? null) === (b.operator_model ?? null)
  );
}

/**
 * PÔR NO AR uma versão: ela só vai ao ar se a IA dela for a atual do
 * agente, ou o par padrão da plataforma sem modelo próprio de Operador.
 *
 * O caso que isto pega é o mais simples de todos: a função de publicar do
 * upstream aceita versão `draft` E `superseded`, e todo agente em produção tem
 * rascunhos e versões antigas com o modelo de antes. Sem esta pergunta, "pôr
 * no ar a v5" trocava o modelo do agente sem tocar em campo nenhum de IA.
 *
 * A segunda metade existe para a troca feita pela plataforma chegar ao ar: se a
 * equipe pôs um rascunho no par novo, o dono da empresa consegue publicá-lo.
 */
export async function iaPodeIrAoAr(
  admin: SupabaseClient,
  args: { user: QuemPede; orgId: string; agentId: string; versao: Record<string, unknown> },
): Promise<boolean> {
  if (escolheIa(args.user)) return true;
  const alvo = iaDaLinha(args.versao);
  if (!alvo) return false;

  const atual = await iaAtualDoAgente(admin, args.orgId, args.agentId);
  if (atual && mesmaIa(atual, alvo)) return true;

  const par = await modeloDaPlataforma(admin);
  return (
    par !== null &&
    par.provider === alvo.provider &&
    par.modelId === alvo.model &&
    alvo.operator_model === null
  );
}
