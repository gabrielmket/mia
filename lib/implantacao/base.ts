/**
 * FORK MIA — a base das operações de IMPLANTAÇÃO de um cliente por ferramenta.
 *
 * ── O que é este módulo ───────────────────────────────────────────────────
 *
 * `lib/implantacao/` é o que as ferramentas do MCP de plataforma
 * (`lib/mcp-plataforma/ferramentas/`) chamam para montar um cliente de ponta a
 * ponta: funil, catálogo, agente, etiquetas, memória e o resto. Cada operação
 * daqui reusa o caminho que a TELA usa (a mesma função de domínio, o mesmo
 * schema, a mesma função do banco). O que este módulo acrescenta é o que a tela
 * não precisa e um agente precisa:
 *
 *  - GARANTIR em vez de criar: a implantação roda mais de uma vez, então toda
 *    escrita casa por uma chave natural (o nome do funil, o código do produto,
 *    o nome do agente) e responde, item a item, se CRIOU, ATUALIZOU ou JÁ
 *    ESTAVA igual. Nada do que não foi mencionado é apagado.
 *  - a organização vem como PARÂMETRO (um token implanta vários clientes), e
 *    por isso todo acesso ao banco carrega o filtro de organização na mão: o
 *    cliente é o `service_role`, sem RLS embaixo.
 *
 * ── O ator ────────────────────────────────────────────────────────────────
 *
 * Quem age é a pessoa que criou o token (`autorUserId`). É ela que vai para as
 * colunas de autoria e para a auditoria de domínio (`pipeline.created`,
 * `catalog_product.created`...), do mesmo jeito que iria se tivesse clicado na
 * tela. A linha `plataforma.mcp_executado`, gravada pelo servidor, guarda o
 * token.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/lib/api/handlers/types";
import type { createAdminClient } from "@/lib/supabase/admin";
import { textoEstavel } from "@/lib/ai/agents/mesmo-rascunho";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

/** O que toda operação de implantação recebe. */
export interface Implantacao {
  admin: SupabaseClient;
  /** A organização do cliente, já conferida por `organizacaoDaImplantacao`. */
  orgId: string;
  /** Quem criou o token: o ator das colunas de autoria. */
  autorUserId: string;
  requestId: string;
}

/** O que aconteceu com um item numa chamada de "garantir". */
export type Desfecho = "criou" | "atualizou" | "ja_estava";

/** O ator como as operações de domínio o esperam: uma pessoa, com papel de administrador. */
export function atorDaImplantacao(c: Pick<Implantacao, "autorUserId">): Actor {
  return { type: "user", id: c.autorUserId, role: "admin" };
}

export interface OrganizacaoDaImplantacao {
  id: string;
  display_name: string;
  legal_name: string;
  slug: string;
  cnpj: string | null;
  status: string;
  timezone: string;
  locale: string;
  currency: string | null;
  country: string | null;
  media_retention_days: number | null;
  dpo_email: string | null;
  privacy_policy_url: string | null;
  settings: Record<string, unknown>;
  onboarded_at: string | null;
  updated_at: string;
  demonstracao: boolean;
}

const COLUNAS_DA_ORGANIZACAO =
  "id, display_name, legal_name, slug, cnpj, status, timezone, locale, currency, country, " +
  "media_retention_days, dpo_email, privacy_policy_url, settings, onboarded_at, updated_at, demonstracao";

/**
 * A organização alvo, ou a recusa que diz como achar o id certo.
 *
 * É o primeiro passo de TODA ferramenta que recebe `organization_id`: com
 * `service_role`, um id errado não esbarra em RLS nenhuma. A escrita seguinte
 * simplesmente não casaria linha, e a ferramenta responderia "feito" sobre
 * nada.
 */
export async function organizacaoDaImplantacao(
  admin: SupabaseClient,
  organizationId: string,
): Promise<OrganizacaoDaImplantacao> {
  const { data, error } = await admin
    .from("organizations")
    .select(COLUNAS_DA_ORGANIZACAO)
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error(`não consegui ler a organização: ${error.message}`);
  if (!data) {
    throw new Recusa(
      `Não existe organização com o id ${organizationId}. ` +
        "Use plataforma_listar_clientes para achar o id certo, ou plataforma_criar_cliente para criar o cliente.",
    );
  }
  const linha = data as unknown as Record<string, unknown>;
  return {
    ...(linha as unknown as OrganizacaoDaImplantacao),
    settings: (linha.settings as Record<string, unknown> | null) ?? {},
    demonstracao: linha.demonstracao === true,
  };
}

/**
 * Muda `organizations.settings` SEM pisar em quem gravou no meio.
 *
 * `settings` é um jsonb com vários donos (IA, agenda, marca, visibilidade,
 * etiquetas), e cada um faz ler-mesclar-gravar do objeto inteiro. Entre a
 * leitura e a gravação de um, outro grava a chave dele e é devolvido ao valor
 * antigo, sem erro em lugar nenhum (o caso medido está em
 * `app/actions/settings/updateTenant.ts`). O agente implantador piora isso: ele
 * dispara ferramentas em paralelo, e duas delas mexem neste jsonb.
 *
 * A saída aqui é comparar-e-trocar: a gravação só casa se `updated_at` ainda é
 * o que foi lido (`trg_organizations_touch` o renova a cada UPDATE). Não casou,
 * alguém gravou no meio: relê e refaz a mescla em cima do valor novo.
 *
 * `mudar` devolve o `settings` novo, ou `null` quando não há o que gravar.
 */
export async function mudarSettingsDaOrganizacao(
  // Tipado pela fábrica do cliente admin de propósito: a cerca
  // `escrita-em-organizations-usa-cliente-admin` só aceita escrita em
  // `organizations` de um cliente que seja admin PELO TIPO, não pelo nome.
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  mudar: (settings: Record<string, unknown>) => Record<string, unknown> | null,
  /** Colunas da própria linha que viajam no MESMO update (nome, fuso, moeda...). */
  colunas: Record<string, unknown> = {},
): Promise<{ mudou: boolean; settings: Record<string, unknown> }> {
  const TENTATIVAS = 5;
  for (let tentativa = 0; tentativa < TENTATIVAS; tentativa += 1) {
    const { data: atual, error: readErr } = await admin
      .from("organizations")
      .select("settings, updated_at")
      .eq("id", orgId)
      .maybeSingle();
    if (readErr) throw new Error(`não consegui ler a configuração da organização: ${readErr.message}`);
    if (!atual) throw new Recusa(`Não existe organização com o id ${orgId}.`);

    const linha = atual as { settings: Record<string, unknown> | null; updated_at: string };
    const settings = linha.settings ?? {};
    const novo = mudar(settings);
    const temColunas = Object.keys(colunas).length > 0;
    if (novo === null && !temColunas) return { mudou: false, settings };

    const { data: gravado, error } = await admin
      .from("organizations")
      .update({ ...colunas, ...(novo !== null ? { settings: novo } : {}) })
      .eq("id", orgId)
      .eq("updated_at", linha.updated_at)
      .select("id");
    if (error) throw error;
    if (((gravado ?? []) as unknown[]).length > 0) {
      return { mudou: true, settings: novo ?? settings };
    }
    // Zero linhas: alguém gravou entre a leitura e a escrita. Tenta de novo.
  }
  throw new Error(
    "a configuração da organização mudou várias vezes seguidas enquanto eu gravava. Chame de novo.",
  );
}

/** Igualdade de conteúdo, sem depender da ordem das chaves de um jsonb. */
export function mesmoConteudo(a: unknown, b: unknown): boolean {
  return textoEstavel(a) === textoEstavel(b);
}

/**
 * A chave de comparação de NOMES: sem acento, sem caixa, espaço colapsado.
 *
 * A mesma conta de `chaveDeNome` (`lib/leads/stage-editing.ts`), que é a régua
 * de "o usuário leria como o mesmo nome" para funil e etapa. Usada aqui para
 * tudo que a implantação casa por nome (agente, regra, material, fluxo).
 */
export function chaveDoNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pareceUuid(texto: string): boolean {
  return UUID.test(texto.trim());
}

/**
 * Acha UM item por id ou por nome, ou recusa dizendo quais existem.
 *
 * O agente implantador fala por NOME ("o funil Atendimento", "o agente Bia"):
 * ele acabou de criar essas coisas e não deveria precisar guardar uuid. O id
 * continua aceito para quem leu de uma listagem.
 */
export function acharPorNomeOuId<T extends { id: string }>(
  itens: readonly T[],
  referencia: string,
  nomeDe: (item: T) => string,
  oQue: { singular: string; comoListar: string },
): T {
  const ref = referencia.trim();
  if (pareceUuid(ref)) {
    const porId = itens.find((i) => i.id === ref);
    if (porId) return porId;
  }
  const chave = chaveDoNome(ref);
  const porNome = itens.filter((i) => chaveDoNome(nomeDe(i)) === chave);
  if (porNome.length === 1) return porNome[0]!;
  if (porNome.length > 1) {
    throw new Recusa(
      `Há ${porNome.length} ${oQue.singular}(s) com o nome «${ref}» nesta organização. ` +
        `Informe o id: ${porNome.map((i) => i.id).join(", ")}.`,
    );
  }
  const existentes = itens.map((i) => `«${nomeDe(i)}»`).slice(0, 30);
  throw new Recusa(
    `Não achei ${oQue.singular} «${ref}» nesta organização. ` +
      (existentes.length > 0
        ? `Os que existem: ${existentes.join(", ")}. `
        : `Ainda não há nenhum. `) +
      oQue.comoListar,
  );
}
