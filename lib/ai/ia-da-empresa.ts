/**
 * QUAL IA VALE PARA ESTA EMPRESA, DE ONDE ELA VEIO E SE TEM CHAVE — uma régua só.
 *
 * FORK MIA (MIA-215; desenho na MIA-216; migration 9172).
 *
 * A regra mora no BANCO: `organizations.ia_segue_a_plataforma` diz se a empresa
 * segue a IA da plataforma (`platform_ia`), e dois gatilhos nossos mantêm
 * `settings.llm` igual ao par da plataforma para quem segue. Por isso o tempo de
 * execução (o seam, o gateway, o `resolverParEfetivo`) não chama este arquivo:
 * ele lê `settings.llm`, que já está certo.
 *
 * Quem chama este arquivo é quem precisa CONTAR ou EXPLICAR: a tela Provedores
 * de IA (o GET diz a origem e a chave; o PATCH e o PUT recusam provedor sem
 * chave), o cartão do admin (`/api/v1/admin/modelo-de-ia`), a saúde, o
 * relatório interno e o MCP de plataforma.
 *
 * "Chave utilizável" é a mesma régua do turno (`resolveOrgLlmConfig`):
 *   - PRÓPRIA: linha ATIVA e VALIDADA em `ai_provider_credentials` daquele
 *     provedor;
 *   - DA INSTALAÇÃO: as variáveis do `.env` que o turno lê (`lerAmbiente`, a
 *     mesma tabela de `chaveDePlataforma`; Google não tem). Lida daqui, e não
 *     de `lib/ai/runtime/agent.ts`, para quem conta não carregar os SDKs de IA.
 * A assinatura do ChatGPT sem login cai na reserva da OpenAI, como o turno.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerAmbiente } from "@/lib/instalacao/ambiente";
import { PROVEDOR_POR_ASSINATURA, rotuloDoProvedor } from "@/lib/ai/pontos/provedores";
import { PROVEDOR_DE_RESERVA_DA_ASSINATURA } from "@/lib/ai/pontos/reserva-da-assinatura";
import { ehOperante } from "@/lib/organizacao/operante";

/** `plataforma` = segue `platform_ia`; `propria` = escolha própria da empresa. */
export type OrigemDaIa = "plataforma" | "propria";

/** De onde sai a chave do padrão. `null` = nenhuma chave utilizável: a empresa fica sem IA. */
export type ChaveDaIa = "propria" | "instalacao" | null;

export interface IaDaEmpresa {
  organizationId: string;
  provider: string;
  modelId: string | null;
  origem: OrigemDaIa;
  chave: ChaveDaIa;
}

/** A linha de `ai_provider_credentials` que interessa para a régua (nunca a chave em si). */
export interface CredencialParaARegua {
  provider: string;
  is_active?: boolean | null;
  validated_at?: string | null;
}

/** A instalação tem chave deste provedor no `.env`? */
type ChaveDaInstalacao = (provider: string) => boolean;

/** A leitura de verdade: o `.env` deste processo (app e worker leem o mesmo). */
export function chaveDaInstalacaoNoAmbiente(provider: string): boolean {
  return lerAmbiente().chavesDeProvedor[provider] === true;
}

/**
 * A chave que o padrão neste provedor usaria. Pura: as credenciais e a leitura
 * do `.env` entram por parâmetro.
 */
export function chaveUtilizavel(
  provider: string,
  credenciais: ReadonlyArray<CredencialParaARegua>,
  chaveDaInstalacao: ChaveDaInstalacao = chaveDaInstalacaoNoAmbiente,
): ChaveDaIa {
  const propria = credenciais.some(
    (c) => c.provider === provider && c.is_active !== false && Boolean(c.validated_at),
  );
  if (propria) return "propria";
  // A assinatura sem login utilizável cai na reserva (a OpenAI da empresa ou da
  // instalação), a mesma escada de `resolveOrgLlmConfig`.
  if (provider === PROVEDOR_POR_ASSINATURA) {
    return chaveUtilizavel(PROVEDOR_DE_RESERVA_DA_ASSINATURA, credenciais, chaveDaInstalacao);
  }
  return chaveDaInstalacao(provider) ? "instalacao" : null;
}

/** O nome que a pessoa reconhece ("OpenAI (GPT)"), ou o id quando o provedor não é da lista. */
export function nomeDoProvedor(provider: string): string {
  return rotuloDoProvedor(provider) ?? provider;
}

/**
 * O texto da trava da tela Provedores de IA, ou `null` quando há chave.
 * `alvo` diz o que se está salvando: o padrão da empresa (PATCH) ou uma função
 * (PUT de um ponto sem credencial escolhida).
 */
export function recusaDoPadraoSemChave(p: {
  provider: string;
  chave: ChaveDaIa;
  alvo: "empresa" | "funcao";
}): string | null {
  if (p.chave !== null) return null;
  const nome = nomeDoProvedor(p.provider);
  return p.alvo === "empresa"
    ? `Não dá para salvar: ${nome} não tem chave nesta instalação e esta empresa não cadastrou uma. ` +
        "Escolha um provedor com chave, ou deixe a empresa seguindo a IA da plataforma."
    : `Não dá para salvar: ${nome} não tem chave nesta instalação e esta empresa não cadastrou uma, ` +
        "então esta função ficaria sem IA. Escolha um provedor com chave para esta função.";
}

/**
 * O texto da trava do cartão do admin (`/api/v1/admin/modelo-de-ia`), ou `null`
 * quando a escolha pode ser salva.
 *
 * - par preenchido: recusa quando a instalação não tem chave do provedor (as
 *   empresas que seguem não têm chave própria por definição);
 * - par vazio ("automático"): recusa enquanto houver empresa seguindo, que
 *   ficaria no padrão antigo do produto.
 */
export function recusaDaPlataformaSemChave(p: {
  provider: string | null;
  seguem: number;
  chaveDaInstalacao?: ChaveDaInstalacao;
}): string | null {
  const chaveDaInstalacao = p.chaveDaInstalacao ?? chaveDaInstalacaoNoAmbiente;
  if (p.provider === null) {
    if (p.seguem === 0) return null;
    return p.seguem === 1
      ? "Escolha um modelo: 1 empresa segue a plataforma e ficaria com o padrão antigo do produto."
      : `Escolha um modelo: ${p.seguem} empresas seguem a plataforma e ficariam com o padrão antigo do produto.`;
  }
  if (chaveDaInstalacao(p.provider)) return null;
  const nome = nomeDoProvedor(p.provider);
  const quem =
    p.seguem === 0
      ? "As empresas novas ficariam sem IA."
      : p.seguem === 1
        ? "A empresa que segue a plataforma ficaria sem IA."
        : `As ${p.seguem} empresas que seguem a plataforma ficariam sem IA.`;
  return `Não dá para salvar: ${nome} não tem chave nesta instalação. ${quem} Escolha um provedor com chave.`;
}

interface LinhaDaEmpresa {
  id: string;
  settings: unknown;
  ia_segue_a_plataforma: boolean | null;
}

/** A IA de uma linha de `organizations`, dadas as credenciais dela. Pura. */
export function iaDaLinha(
  linha: LinhaDaEmpresa,
  credenciais: ReadonlyArray<CredencialParaARegua>,
  chaveDaInstalacao: ChaveDaInstalacao = chaveDaInstalacaoNoAmbiente,
): IaDaEmpresa {
  const llm = ((linha.settings as { llm?: unknown } | null)?.llm ?? {}) as {
    provider?: unknown;
    default_model?: unknown;
  };
  // A mesma queda de `resolveOrgLlmConfig` quando o jsonb não tem provedor.
  const provider = typeof llm.provider === "string" && llm.provider !== "" ? llm.provider : "anthropic";
  const modelId = typeof llm.default_model === "string" && llm.default_model !== "" ? llm.default_model : null;
  return {
    organizationId: linha.id,
    provider,
    modelId,
    origem: linha.ia_segue_a_plataforma === true ? "plataforma" : "propria",
    chave: chaveUtilizavel(provider, credenciais, chaveDaInstalacao),
  };
}

/**
 * A IA de UMA empresa. `null` quando a empresa não existe ou a leitura falhou
 * (quem chama decide: a tela não mostra o aviso; a trava, que precisa da
 * resposta, trata `null` como "sem chave própria" e confere só a instalação).
 */
export async function iaDaEmpresa(
  admin: SupabaseClient,
  organizationId: string,
  chaveDaInstalacao: ChaveDaInstalacao = chaveDaInstalacaoNoAmbiente,
): Promise<IaDaEmpresa | null> {
  const [orgRes, credsRes] = await Promise.all([
    admin
      .from("organizations")
      .select("id, settings, ia_segue_a_plataforma")
      .eq("id", organizationId)
      .maybeSingle(),
    credenciaisValidadas(admin, organizationId),
  ]);
  if (orgRes.error || !orgRes.data) return null;
  return iaDaLinha(orgRes.data as LinhaDaEmpresa, credsRes, chaveDaInstalacao);
}

/** Uma empresa no lote: a IA dela e o que a saúde e o MCP mostram sem outra leitura. */
export type IaDaEmpresaNoLote = IaDaEmpresa & {
  /** `organizations.status`, cru. */
  status: string | null;
  /** `organizations.display_name`, para o MCP. */
  nome: string | null;
  /** `ehOperante(status)`: a saúde e o cartão contam só as que operam. */
  operante: boolean;
};

/**
 * A IA de TODAS as empresas, em duas leituras (sem N+1): para o cartão do
 * admin, a saúde, o relatório interno e o MCP. `null` quando a leitura falhou,
 * nunca lista vazia: quem conta diz "não sei", e não "0 sem chave".
 */
export async function iaDasEmpresas(
  admin: SupabaseClient,
  chaveDaInstalacao: ChaveDaInstalacao = chaveDaInstalacaoNoAmbiente,
): Promise<IaDaEmpresaNoLote[] | null> {
  const [orgRes, credsRes] = await Promise.all([
    admin.from("organizations").select("id, status, display_name, settings, ia_segue_a_plataforma").order("id"),
    admin
      .from("ai_provider_credentials")
      .select("organization_id, provider, is_active, validated_at")
      .eq("is_active", true)
      .not("validated_at", "is", null),
  ]);
  if (orgRes.error || credsRes.error) return null;

  const porEmpresa = new Map<string, CredencialParaARegua[]>();
  for (const c of (credsRes.data ?? []) as Array<CredencialParaARegua & { organization_id: string }>) {
    const lista = porEmpresa.get(c.organization_id) ?? [];
    lista.push(c);
    porEmpresa.set(c.organization_id, lista);
  }
  type LinhaDoLote = LinhaDaEmpresa & { status: string | null; display_name: string | null };
  return ((orgRes.data ?? []) as LinhaDoLote[]).map((linha) => ({
    ...iaDaLinha(linha, porEmpresa.get(linha.id) ?? [], chaveDaInstalacao),
    status: linha.status ?? null,
    nome: linha.display_name ?? null,
    operante: ehOperante(linha.status ?? null),
  }));
}

/**
 * FORK MIA (9172): a conta das empresas que OPERAM — quantas seguem a
 * plataforma, quantas têm escolha própria e quantas estão sem chave utilizável
 * (de qualquer origem). Empresa suspensa ou anonimizada não conta: ela não
 * atende ninguém. `null` quando a leitura falhou.
 */
export function contarEmpresas(
  empresas: ReadonlyArray<IaDaEmpresa & { status: string | null }> | null,
): { seguem: number; propria: number; sem_chave: number } | null {
  if (empresas === null) return null;
  const operantes = empresas.filter((e) => ehOperante(e.status));
  return {
    seguem: operantes.filter((e) => e.origem === "plataforma").length,
    propria: operantes.filter((e) => e.origem === "propria").length,
    sem_chave: operantes.filter((e) => e.chave === null).length,
  };
}

/** As credenciais ativas e validadas de uma empresa (só provedor e datas). Falha vira lista vazia. */
export async function credenciaisValidadas(
  admin: SupabaseClient,
  organizationId: string,
): Promise<CredencialParaARegua[]> {
  try {
    const { data, error } = await admin
      .from("ai_provider_credentials")
      .select("provider, is_active, validated_at")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .not("validated_at", "is", null);
    if (error) return [];
    return (data ?? []) as CredencialParaARegua[];
  } catch {
    return [];
  }
}
