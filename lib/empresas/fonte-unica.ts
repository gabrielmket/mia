/**
 * FORK MIA · EMPRESA ÚNICA — a empresa como o produto a lê e a grava (.79).
 *
 * ── De onde vem ───────────────────────────────────────────────────────────
 *
 * Até a .77 havia dois cadastros sem ponte: `companies` (o do upstream, com a
 * consulta de CNPJ na Receita) e `crm_empresas` (o nosso, com pessoas, negócios
 * e obrigações). Desde as migrations 9032 a 9034 o cadastro é UM, o do upstream,
 * e o que é só nosso mora ao lado (`mia_companies_extra`). O desenho inteiro está
 * em docs/fork/empresa-unica.md.
 *
 * ── O que este módulo resolve ─────────────────────────────────────────────
 *
 * Toda tela do fork falava com a empresa pelo formato de `crm_empresas` (`nome`,
 * `cnpj` só com dígitos, `telefone`, `site`, `endereco`, `observacoes`, `tags`,
 * `custom_fields`). Este módulo LÊ `companies` + `mia_companies_extra` e entrega
 * esse mesmo formato, com o que a Receita acrescenta (`razao_social`, `receita`).
 * Assim cada leitor troca uma consulta, e não a tela inteira.
 *
 * A ESCRITA vai sempre por `fn_mia_gravar_empresa` (9034): ela grava os dois
 * lados numa transação, normaliza o CNPJ, recusa CNPJ repetido dizendo qual
 * empresa já o tem e confere o papel de quem chama (atendente, gestor e o
 * agente criam; a RLS do upstream deixa só o gestor criar direto na tabela, e
 * continua deixando).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";

import { cnpjNormalizado, formatarCnpj } from "./formato";

export { cnpjNormalizado, formatarCnpj };

type Db = Pick<SupabaseClient, "from" | "rpc">;

/**
 * O que a consulta pede de `companies`. O que é só nosso (`mia_companies_extra`)
 * é lido À PARTE e juntado pela chave (`juntarOQueESoNosso`), e não embutido no
 * select: o embed de uma tabela filha 1:1 depende de o PostgREST reconhecer a
 * relação como um-para-um (senão volta lista), e duas leituras simples valem o
 * mesmo em qualquer cliente.
 */
export const COLUNAS_DA_EMPRESA_UNICA =
  "id, organization_id, trade_name, legal_name, cnpj, normalized_cnpj, phone, email, " +
  "street, number, complement, district, city, state, zip_code, registration_status, legal_nature, " +
  "company_size, opened_at, main_cnae_code, main_cnae_description, enrichment_status, enriched_at, " +
  "created_at, updated_at";

/** O que se lê de `mia_companies_extra`. */
export const COLUNAS_DO_QUE_E_SO_NOSSO = "company_id, site, endereco, observacoes, tags, custom_fields";

/** Só o necessário para o nome (o quadro, o cartão, as listas de obrigações). */
export const COLUNAS_DO_NOME = "id, trade_name, legal_name, normalized_cnpj";

export interface ExtraDaEmpresa {
  site: string | null;
  endereco: string | null;
  observacoes: string | null;
  tags: string[] | null;
  custom_fields: Record<string, unknown> | null;
}

/** A linha como o PostgREST devolve `COLUNAS_DA_EMPRESA_UNICA`. */
export interface LinhaDaEmpresa {
  id: string;
  organization_id?: string;
  trade_name: string | null;
  legal_name: string | null;
  cnpj?: string | null;
  normalized_cnpj: string | null;
  phone?: string | null;
  email?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  registration_status?: string | null;
  legal_nature?: string | null;
  company_size?: string | null;
  opened_at?: string | null;
  main_cnae_code?: string | null;
  main_cnae_description?: string | null;
  enrichment_status?: string | null;
  enriched_at?: string | null;
  created_at?: string;
  updated_at?: string;
  /** Objeto (1:1) — ou lista, quando o cliente não reconhece a chave como única. */
  extra?: ExtraDaEmpresa | ExtraDaEmpresa[] | null;
}

/** O que a Receita disse, para o bloco "Dados da Receita" da ficha. */
export interface DadosDaReceita {
  situacao: string | null;
  abertura: string | null;
  atividade: string | null;
  natureza: string | null;
  porte: string | null;
  endereco: string | null;
  consultadaEm: string | null;
}

/** A empresa no formato que as telas do fork leem desde a 0255. */
export interface EmpresaUnica {
  id: string;
  nome: string;
  razao_social: string | null;
  /** Só dígitos, como `crm_empresas.cnpj` guardava. */
  cnpj: string | null;
  site: string | null;
  telefone: string | null;
  email: string | null;
  /** O nosso, em texto livre; sem ele, o da Receita numa linha. */
  endereco: string | null;
  observacoes: string | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
  /** `null` = nunca consultada (sem CNPJ, ou cadastrada sem a consulta). */
  receita: DadosDaReceita | null;
  created_at: string;
  updated_at: string;
}

/**
 * O nome que a tela mostra: o fantasia, senão a razão social, senão o CNPJ.
 * `companies` aceita linha sem nome nenhum (a planilha do upstream cria assim);
 * a nossa porta de escrita não, mas a leitura não pode quebrar com a dele.
 */
export function nomeDaEmpresa(l: Pick<LinhaDaEmpresa, "trade_name" | "legal_name" | "normalized_cnpj">): string {
  return (
    l.trade_name?.trim() ||
    l.legal_name?.trim() ||
    formatarCnpj(l.normalized_cnpj) ||
    "Empresa sem nome"
  );
}

/** "Rua das Acácias, 120 · Belo Horizonte, MG", ou `null` sem endereço da Receita. */
export function enderecoDaReceita(l: LinhaDaEmpresa): string | null {
  const rua = [l.street, l.number].filter(Boolean).join(", ");
  const resto = [l.complement, l.district].filter(Boolean).join(", ");
  const cidade = [l.city, l.state].filter(Boolean).join(", ");
  const partes = [[rua, resto].filter(Boolean).join(" · "), cidade, l.zip_code ? `CEP ${l.zip_code}` : null].filter(
    (p): p is string => Boolean(p && p.trim()),
  );
  return partes.length ? partes.join(" · ") : null;
}

function extraDe(l: LinhaDaEmpresa): ExtraDaEmpresa | null {
  if (!l.extra) return null;
  return Array.isArray(l.extra) ? (l.extra[0] ?? null) : l.extra;
}

export function paraEmpresa(l: LinhaDaEmpresa): EmpresaUnica {
  const x = extraDe(l);
  const consultada = l.enrichment_status === "completed" || Boolean(l.registration_status);
  const receita: DadosDaReceita | null = consultada
    ? {
        situacao: l.registration_status ?? null,
        abertura: l.opened_at ?? null,
        atividade: l.main_cnae_description ?? null,
        natureza: l.legal_nature ?? null,
        porte: l.company_size ?? null,
        endereco: enderecoDaReceita(l),
        consultadaEm: l.enriched_at ?? null,
      }
    : null;
  return {
    id: l.id,
    nome: nomeDaEmpresa(l),
    razao_social: l.legal_name ?? null,
    cnpj: l.normalized_cnpj ?? cnpjNormalizado(l.cnpj ?? null),
    site: x?.site ?? null,
    telefone: l.phone ?? null,
    email: l.email ?? null,
    endereco: x?.endereco ?? enderecoDaReceita(l),
    observacoes: x?.observacoes ?? null,
    tags: x?.tags ?? [],
    custom_fields: x?.custom_fields ?? {},
    receita,
    created_at: l.created_at ?? "",
    updated_at: l.updated_at ?? "",
  };
}

/**
 * O nome de cada empresa de uma lista de ids, numa consulta só (o quadro com
 * duzentos cards faz uma, não duzentas). Empresa que não existe mais não entra
 * no mapa, e quem lê mostra nada em vez de um rótulo vazio.
 */
export async function lerNomesDasEmpresas(
  db: Db,
  organizationId: string,
  ids: readonly string[],
): Promise<{ nomes: Map<string, string>; erro: string | null }> {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (unicos.length === 0) return { nomes: new Map(), erro: null };
  const { data, error } = await db
    .from("companies")
    .select(COLUNAS_DO_NOME)
    .eq("organization_id", organizationId)
    .in("id", unicos);
  if (error) return { nomes: new Map(), erro: error.message };
  const linhas = (data ?? []) as Array<Pick<LinhaDaEmpresa, "id" | "trade_name" | "legal_name" | "normalized_cnpj">>;
  return { nomes: new Map(linhas.map((l) => [l.id, nomeDaEmpresa(l)])), erro: null };
}

/** Uma empresa inteira, ou `null` quando ela não existe nesta organização. */
export async function lerEmpresa(db: Db, organizationId: string, id: string): Promise<EmpresaUnica | null> {
  const { data, error } = await db
    .from("companies")
    .select(COLUNAS_DA_EMPRESA_UNICA)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const linha = data as unknown as LinhaDaEmpresa;
  const { data: extra } = await db
    .from("mia_companies_extra")
    .select(COLUNAS_DO_QUE_E_SO_NOSSO)
    .eq("organization_id", organizationId)
    .eq("company_id", id)
    .maybeSingle();
  linha.extra = (extra as ExtraDaEmpresa | null) ?? null;
  return paraEmpresa(linha);
}

/**
 * O que é só nosso de TODAS as empresas da organização, por empresa (5 mil no
 * máximo, como as empresas). Uma leitura por página, não uma por empresa.
 */
export async function lerOQueESoNossoDaOrganizacao(
  db: Db,
  organizationId: string,
): Promise<{ porEmpresa: Map<string, ExtraDaEmpresa>; erro: string | null }> {
  const lidas = await lerTodasAsPaginas<ExtraDaEmpresa & { company_id: string }>(
    (de, ate, pedirContagem) =>
      db
        .from("mia_companies_extra")
        .select(COLUNAS_DO_QUE_E_SO_NOSSO, pedirContagem ? { count: "exact" } : undefined)
        .eq("organization_id", organizationId)
        .order("company_id", { ascending: true })
        .range(de, ate),
    { paginasMaximas: PAGINAS_DE_EMPRESAS },
  );
  if (lidas.erro) return { porEmpresa: new Map(), erro: lidas.erro };
  return { porEmpresa: new Map(lidas.linhas.map((x) => [x.company_id, x])), erro: null };
}

/** Junta a cada linha o que é só nosso dela (ou `null`). Muda as linhas no lugar. */
export async function juntarOQueESoNosso(
  db: Db,
  organizationId: string,
  linhas: LinhaDaEmpresa[],
): Promise<string | null> {
  if (linhas.length === 0) return null;
  const { porEmpresa, erro } = await lerOQueESoNossoDaOrganizacao(db, organizationId);
  if (erro) return erro;
  for (const l of linhas) l.extra = porEmpresa.get(l.id) ?? null;
  return null;
}

/** Teto da leitura de todas as empresas de uma organização (5 mil). */
export const PAGINAS_DE_EMPRESAS = 5;

/**
 * Todas as empresas da organização, página a página (o PostgREST corta em 1000
 * calado). `truncado` diz que a lista passou do teto: quem decide "não existe"
 * em cima dela tem de recusar, não criar.
 */
export async function lerTodasAsEmpresas(
  db: Db,
  organizationId: string,
  colunas: string = COLUNAS_DA_EMPRESA_UNICA,
): Promise<{ linhas: LinhaDaEmpresa[]; truncado: boolean; erro: string | null }> {
  const lidas = await lerTodasAsPaginas<LinhaDaEmpresa>(
    (de, ate, pedirContagem) =>
      db
        .from("companies")
        .select(colunas, pedirContagem ? { count: "exact" } : undefined)
        .eq("organization_id", organizationId)
        .order("id", { ascending: true })
        .range(de, ate),
    { paginasMaximas: PAGINAS_DE_EMPRESAS },
  );
  if (lidas.erro) return { linhas: [], truncado: false, erro: lidas.erro };
  // A leitura inteira leva o que é só nosso; a de só o nome, não.
  if (colunas === COLUNAS_DA_EMPRESA_UNICA) {
    const erro = await juntarOQueESoNosso(db, organizationId, lidas.linhas);
    if (erro) return { linhas: [], truncado: false, erro };
  }
  return { linhas: lidas.linhas, truncado: lidas.truncado, erro: null };
}

// ─── a escrita ──────────────────────────────────────────────────────────────

/** Os campos da Receita, como `mapBrasilApiToCompanyFields` os devolve. */
export type CamposDaReceita = Record<string, unknown>;

/** O que `fn_mia_gravar_empresa` aceita. Só as chaves presentes mudam. */
export interface DadosDaEmpresa {
  nome?: string | null;
  razao_social?: string | null;
  cnpj?: string | null;
  telefone?: string | null;
  email?: string | null;
  site?: string | null;
  endereco?: string | null;
  observacoes?: string | null;
  tags?: string[];
  custom_fields?: Record<string, unknown>;
  /** Os campos que a consulta à Receita devolveu (só a TELA consulta). */
  receita?: CamposDaReceita;
  /** A resposta da Receita sem o quadro de sócios, para `brasilapi_raw`. */
  receita_bruta?: Record<string, unknown> | null;
  /**
   * Quem criou, quando quem chama é o SERVIDOR (o autor do token do MCP de
   * plataforma). Com a sessão de uma pessoa, a função usa `auth.uid()` e ignora.
   */
  criado_por?: string | null;
}

export type RecusaDaGravacao =
  | "cnpj_ja_cadastrado"
  | "cnpj_invalido"
  | "empresa_sem_nome"
  | "empresa_nao_encontrada"
  | "insufficient_role"
  | "erro";

export type ResultadoDaGravacao =
  | { ok: true; id: string; criada: boolean }
  | { ok: false; motivo: RecusaDaGravacao; existenteId?: string; detalhe?: string };

const RECUSAS: readonly RecusaDaGravacao[] = [
  "cnpj_ja_cadastrado",
  "cnpj_invalido",
  "empresa_sem_nome",
  "empresa_nao_encontrada",
  "insufficient_role",
];

/** A recusa do banco, pelo código que a função levanta. */
export function recusaDoBanco(erro: { message?: string | null; details?: string | null } | null): {
  motivo: RecusaDaGravacao;
  detalhe?: string;
} {
  const mensagem = erro?.message ?? "";
  const conhecida = RECUSAS.find((r) => mensagem.includes(r));
  return conhecida ? { motivo: conhecida, detalhe: erro?.details ?? undefined } : { motivo: "erro", detalhe: mensagem };
}

/**
 * Cria (`id` nulo) ou edita uma empresa pela porta da 9034. Com o cliente da
 * SESSÃO a função confere o papel; com o de serviço (`auth.uid()` nulo), quem
 * conferiu foi a rota.
 */
export async function gravarEmpresa(
  db: Db,
  organizationId: string,
  id: string | null,
  dados: DadosDaEmpresa,
): Promise<ResultadoDaGravacao> {
  // `undefined` some do JSON; `null` fica (e apaga o campo).
  const p_dados = JSON.parse(JSON.stringify(dados)) as Record<string, unknown>;
  const { data, error } = await db.rpc("fn_mia_gravar_empresa", {
    p_organization_id: organizationId,
    p_empresa_id: id,
    p_dados,
  });
  if (error) {
    const r = recusaDoBanco(error);
    return r.motivo === "cnpj_ja_cadastrado"
      ? { ok: false, motivo: r.motivo, existenteId: r.detalhe }
      : { ok: false, motivo: r.motivo, detalhe: r.detalhe };
  }
  const resposta = (data ?? {}) as { id?: string; criada?: boolean };
  if (!resposta.id) return { ok: false, motivo: "erro", detalhe: "a função não devolveu o id" };
  return { ok: true, id: resposta.id, criada: Boolean(resposta.criada) };
}

// ─── atalhos para quem só precisa do nome ───────────────────────────────────

/** A resposta no formato do PostgREST, para quem já tratava `{ data, error }`. */
interface RespostaDoNome<T> {
  data: T;
  error: { message: string } | null;
}

/**
 * `{ id, nome }` de UMA empresa, no formato de `.maybeSingle()`. É o que as
 * obrigações, a automação e os relatórios liam de `crm_empresas` até a .77.
 */
export async function lerIdENomeDaEmpresa(
  db: Db,
  organizationId: string,
  id: string,
): Promise<RespostaDoNome<{ id: string; nome: string } | null>> {
  const { data, error } = await db
    .from("companies")
    .select(COLUNAS_DO_NOME)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) return { data: null, error: { message: error.message } };
  if (!data) return { data: null, error: null };
  const l = data as unknown as Pick<LinhaDaEmpresa, "id" | "trade_name" | "legal_name" | "normalized_cnpj">;
  return { data: { id: l.id, nome: nomeDaEmpresa(l) }, error: null };
}

/** `{ id, nome }` de várias empresas, no formato de uma lista do PostgREST. */
export async function lerIdsENomesDasEmpresas(
  db: Db,
  organizationId: string,
  ids: readonly string[],
): Promise<RespostaDoNome<Array<{ id: string; nome: string }>>> {
  if (ids.length === 0) return { data: [], error: null };
  const { data, error } = await db
    .from("companies")
    .select(COLUNAS_DO_NOME)
    .eq("organization_id", organizationId)
    .in("id", [...ids]);
  if (error) return { data: [], error: { message: error.message } };
  const linhas = (data ?? []) as unknown as Array<Pick<LinhaDaEmpresa, "id" | "trade_name" | "legal_name" | "normalized_cnpj">>;
  return { data: linhas.map((l) => ({ id: l.id, nome: nomeDaEmpresa(l) })), error: null };
}
