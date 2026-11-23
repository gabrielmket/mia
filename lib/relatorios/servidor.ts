/**
 * FORK MIA (item 9) — O MONTADOR DE RELATÓRIOS do lado do servidor: guardar,
 * ler, calcular, abrir a lista por trás do número e exportar.
 *
 * ── Qual cliente, e por quê ───────────────────────────────────────────────
 *
 * A TELA passa o cliente da SESSÃO (`createClient`): as tabelas da 9040 têm
 * RLS (o próprio e o compartilhado; só gestor compartilha; o compartilhado,
 * só quem criou e o administrador editam), e o motor é `security invoker`
 * (cada um vê o que já vê no CRM). Nenhuma regra de "quem pode" é refeita
 * aqui: o banco recusa, e esta camada só traduz a recusa numa frase.
 *
 * O MCP de plataforma e a página pública do link passam o cliente de SERVIÇO,
 * com a organização resolvida no servidor (o token de plataforma, a linha do
 * link) — nunca do corpo do pedido.
 *
 * O nome das pessoas da equipe vem do Auth pelo cliente de serviço
 * (`nomesDaEquipe`), filtrado pela organização.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { CHAVE_OUTROS, type ChaveDoPainel } from "@/lib/paineis/catalogo";
import { consultarMotor, RecusaDoMotor, type RespostaDoMotor } from "@/lib/paineis/motor";

import { modeloDoGrafico, rotuloDaChave, rotuloDaMedida, type Formato, type Rotulo } from "./apresentar";
import { PERIODOS_DO_PAINEL, TETO_DA_PLANILHA, type Dimensao, type PeriodoDoMontador, type PeriodoDoPainel, type Tamanho } from "./catalogo";
import { colunasDaConfig, configDaLinha, normalizarConfig, pedidoDoRelatorio, filtrosParaOMotor, visualizacaoQueVale, type ConfigDoRelatorio, type LinhaDeConfig } from "./config";
import { idsDePessoa, nomesDaEquipe } from "./equipe";
import { csvDaLista, csvDoRelatorio, nomeDoArquivo, type Separador } from "./csv";
import { colunasDaLista, type RespostaDaLista } from "./lista";

// ─── Os tipos ───────────────────────────────────────────────────────────────

export interface Relatorio {
  id: string;
  nome: string;
  config: ConfigDoRelatorio;
  compartilhado: boolean;
  prontoDe: string | null;
  copiadoDe: string | null;
  criadoPor: string | null;
  criadoVia: string;
  atualizadoEm: string;
  criadoEm: string;
}

interface LinhaDoRelatorio extends LinhaDeConfig {
  id: string;
  nome: string;
  compartilhado: boolean;
  pronto_de: string | null;
  copiado_de: string | null;
  created_by: string | null;
  criado_via: string;
  updated_at: string;
  created_at: string;
}

const COLUNAS_DO_RELATORIO =
  "id, nome, fonte, medida, dim1, dim2, filtros, periodo, de, ate, comparar, visualizacao, compartilhado, pronto_de, copiado_de, created_by, criado_via, updated_at, created_at";

function paraRelatorio(l: LinhaDoRelatorio): Relatorio {
  return {
    id: l.id,
    nome: l.nome,
    config: configDaLinha(l),
    compartilhado: l.compartilhado,
    prontoDe: l.pronto_de,
    copiadoDe: l.copiado_de,
    criadoPor: l.created_by,
    criadoVia: l.criado_via,
    atualizadoEm: l.updated_at,
    criadoEm: l.created_at,
  };
}

export interface ItemDoPainel {
  id: string;
  relatorioId: string | null;
  pronto: ChaveDoPainel | null;
  tamanho: Tamanho;
  periodoProprio: boolean;
  posicao: number;
}

export interface Painel {
  id: string;
  nome: string;
  periodo: PeriodoDoPainel;
  compartilhado: boolean;
  criadoPor: string | null;
  criadoVia: string;
  atualizadoEm: string;
  itens: ItemDoPainel[];
}

interface LinhaDoPainel {
  id: string;
  nome: string;
  periodo: string;
  compartilhado: boolean;
  created_by: string | null;
  criado_via: string;
  updated_at: string;
}

interface LinhaDoItem {
  id: string;
  painel_id: string;
  relatorio_id: string | null;
  pronto: string | null;
  tamanho: string;
  periodo_proprio: boolean;
  posicao: number | string;
}

const COLUNAS_DO_PAINEL = "id, nome, periodo, compartilhado, created_by, criado_via, updated_at";
const COLUNAS_DO_ITEM = "id, painel_id, relatorio_id, pronto, tamanho, periodo_proprio, posicao";

function paraItem(l: LinhaDoItem): ItemDoPainel {
  return {
    id: l.id,
    relatorioId: l.relatorio_id,
    pronto: (l.pronto as ChaveDoPainel | null) ?? null,
    tamanho: (["P", "M", "G"].includes(l.tamanho) ? l.tamanho : "M") as Tamanho,
    periodoProprio: l.periodo_proprio,
    posicao: Number(l.posicao),
  };
}

function paraPainel(l: LinhaDoPainel, itens: LinhaDoItem[]): Painel {
  return {
    id: l.id,
    nome: l.nome,
    periodo: ((PERIODOS_DO_PAINEL as readonly string[]).includes(l.periodo) ? l.periodo : "30") as PeriodoDoPainel,
    compartilhado: l.compartilhado,
    criadoPor: l.created_by,
    criadoVia: l.criado_via,
    atualizadoEm: l.updated_at,
    itens: itens
      .filter((i) => i.painel_id === l.id)
      .map(paraItem)
      .sort((a, b) => a.posicao - b.posicao),
  };
}

/** Quem age: a pessoa da sessão ou quem criou o token de plataforma. */
export interface QuemAge {
  organizationId: string;
  userId: string | null;
  requestId: string;
  via: "tela" | "mcp_plataforma";
}

/** A recusa legível. `sem_permissao` vem do banco (42501); `nao_encontrado`, de zero linhas. */
export class RelatorioRecusado extends Error {
  constructor(
    readonly motivo: "sem_permissao" | "nao_encontrado" | "invalido",
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "RelatorioRecusado";
  }
}

function recusaDoBanco(error: { code?: string; message: string }, contexto: string): never {
  if (error.code === "42501") {
    throw new RelatorioRecusado(
      "sem_permissao",
      error.message.includes("compartilhar") ? "Só gestor e administrador compartilham com a equipe." : "Você não pode mexer neste item.",
    );
  }
  if (error.code === "23514" || error.code === "22023") {
    throw new RelatorioRecusado("invalido", "Essa configuração não cabe no relatório.");
  }
  if (error.code === "23505") {
    throw new RelatorioRecusado("invalido", "Esse relatório já está neste painel.");
  }
  throw new Error(`${contexto}: ${error.message}`);
}

// ─── Os relatórios ──────────────────────────────────────────────────────────

/** Os relatórios que a pessoa vê: os dela e os compartilhados (a RLS decide). */
export async function listarRelatorios(db: SupabaseClient, organizationId: string): Promise<Relatorio[]> {
  const { data, error } = await db
    .from("mia_relatorios")
    .select(COLUNAS_DO_RELATORIO)
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) recusaDoBanco(error, "não li os relatórios");
  return ((data ?? []) as unknown as LinhaDoRelatorio[]).map(paraRelatorio);
}

export async function lerRelatorio(db: SupabaseClient, organizationId: string, id: string): Promise<Relatorio | null> {
  const { data, error } = await db
    .from("mia_relatorios")
    .select(COLUNAS_DO_RELATORIO)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) recusaDoBanco(error, "não li o relatório");
  return data ? paraRelatorio(data as unknown as LinhaDoRelatorio) : null;
}

export interface NovoRelatorio {
  nome: string;
  config: ConfigDoRelatorio;
  compartilhado?: boolean;
  prontoDe?: string | null;
  copiadoDe?: string | null;
  /** A chave natural de quem garante (MCP, semente). */
  chave?: string | null;
}

export async function criarRelatorio(db: SupabaseClient, quem: QuemAge, novo: NovoRelatorio): Promise<Relatorio> {
  const { data, error } = await db
    .from("mia_relatorios")
    .insert({
      organization_id: quem.organizationId,
      nome: novo.nome.trim().slice(0, 80),
      ...colunasDaConfig(novo.config),
      compartilhado: novo.compartilhado ?? false,
      pronto_de: novo.prontoDe ?? null,
      copiado_de: novo.copiadoDe ?? null,
      chave: novo.chave ?? null,
      criado_via: quem.via,
      // Na sessão o gatilho troca pelo `auth.uid()`; no MCP vale o ator do token.
      created_by: quem.userId,
    })
    .select(COLUNAS_DO_RELATORIO)
    .single();
  if (error || !data) recusaDoBanco(error ?? { message: "sem linha" }, "não gravei o relatório");
  const r = paraRelatorio(data as unknown as LinhaDoRelatorio);
  await audit({
    action: "relatorios.criado",
    actorUserId: quem.userId,
    organizationId: quem.organizationId,
    resourceType: "mia_relatorios",
    resourceId: r.id,
    requestId: quem.requestId,
    metadata: {
      fonte: r.config.fonte,
      medida: r.config.medida,
      compartilhado: r.compartilhado,
      pronto_de: r.prontoDe,
      copiado_de: r.copiadoDe,
      via: quem.via,
    },
  });
  return r;
}

export interface MudancaNoRelatorio {
  nome?: string;
  config?: ConfigDoRelatorio;
  compartilhado?: boolean;
}

/**
 * Altera. Sem `.select()` na mesma escrita: o administrador que deixa de
 * compartilhar o relatório de outra pessoa não o enxerga mais depois, e o
 * `returning` falharia na leitura. Zero linhas = não pode ou não existe.
 */
export async function alterarRelatorio(
  db: SupabaseClient,
  quem: QuemAge,
  id: string,
  mudanca: MudancaNoRelatorio,
): Promise<Relatorio | null> {
  const antes = await lerRelatorio(db, quem.organizationId, id);
  if (!antes) throw new RelatorioRecusado("nao_encontrado", "Relatório não encontrado.");
  const campos: Record<string, unknown> = {};
  if (mudanca.nome !== undefined) campos.nome = mudanca.nome.trim().slice(0, 80);
  if (mudanca.config) Object.assign(campos, colunasDaConfig(mudanca.config));
  if (mudanca.compartilhado !== undefined) campos.compartilhado = mudanca.compartilhado;
  if (Object.keys(campos).length === 0) return antes;
  const { error, count } = await db
    .from("mia_relatorios")
    .update(campos, { count: "exact" })
    .eq("organization_id", quem.organizationId)
    .eq("id", id);
  if (error) recusaDoBanco(error, "não alterei o relatório");
  if (!count) {
    throw new RelatorioRecusado(
      "sem_permissao",
      "Só quem criou e o administrador mexem num relatório compartilhado. Copie para mexer.",
    );
  }
  const compartilhou = mudanca.compartilhado !== undefined && mudanca.compartilhado !== antes.compartilhado;
  await audit({
    action: compartilhou ? "relatorios.compartilhado" : "relatorios.alterado",
    actorUserId: quem.userId,
    organizationId: quem.organizationId,
    resourceType: "mia_relatorios",
    resourceId: id,
    requestId: quem.requestId,
    metadata: { campos: Object.keys(campos), compartilhado: mudanca.compartilhado ?? antes.compartilhado, via: quem.via },
  });
  return lerRelatorio(db, quem.organizationId, id);
}

export async function apagarRelatorio(db: SupabaseClient, quem: QuemAge, id: string): Promise<void> {
  const { error, count } = await db
    .from("mia_relatorios")
    .delete({ count: "exact" })
    .eq("organization_id", quem.organizationId)
    .eq("id", id);
  if (error) recusaDoBanco(error, "não apaguei o relatório");
  if (!count) {
    throw new RelatorioRecusado("sem_permissao", "Só quem criou e o administrador apagam um relatório compartilhado.");
  }
  await audit({
    action: "relatorios.apagado",
    actorUserId: quem.userId,
    organizationId: quem.organizationId,
    resourceType: "mia_relatorios",
    resourceId: id,
    requestId: quem.requestId,
    metadata: { via: quem.via },
  });
}

// ─── Os painéis ─────────────────────────────────────────────────────────────

export async function listarPaineis(db: SupabaseClient, organizationId: string): Promise<Painel[]> {
  const { data, error } = await db
    .from("mia_paineis_usuario")
    .select(COLUNAS_DO_PAINEL)
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) recusaDoBanco(error, "não li os painéis");
  const paineis = (data ?? []) as unknown as LinhaDoPainel[];
  if (paineis.length === 0) return [];
  const { data: itens, error: e2 } = await db
    .from("mia_paineis_usuario_itens")
    .select(COLUNAS_DO_ITEM)
    .eq("organization_id", organizationId)
    .in(
      "painel_id",
      paineis.map((p) => p.id),
    );
  if (e2) recusaDoBanco(e2, "não li os itens dos painéis");
  return paineis.map((p) => paraPainel(p, (itens ?? []) as unknown as LinhaDoItem[]));
}

export async function lerPainel(db: SupabaseClient, organizationId: string, id: string): Promise<Painel | null> {
  const { data, error } = await db
    .from("mia_paineis_usuario")
    .select(COLUNAS_DO_PAINEL)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) recusaDoBanco(error, "não li o painel");
  if (!data) return null;
  const { data: itens, error: e2 } = await db
    .from("mia_paineis_usuario_itens")
    .select(COLUNAS_DO_ITEM)
    .eq("organization_id", organizationId)
    .eq("painel_id", id)
    .order("posicao", { ascending: true });
  if (e2) recusaDoBanco(e2, "não li os itens do painel");
  return paraPainel(data as unknown as LinhaDoPainel, (itens ?? []) as unknown as LinhaDoItem[]);
}

export async function criarPainel(
  db: SupabaseClient,
  quem: QuemAge,
  novo: { nome: string; periodo?: PeriodoDoPainel; compartilhado?: boolean; chave?: string | null },
): Promise<Painel> {
  const { data, error } = await db
    .from("mia_paineis_usuario")
    .insert({
      organization_id: quem.organizationId,
      nome: novo.nome.trim().slice(0, 80),
      periodo: novo.periodo ?? "30",
      compartilhado: novo.compartilhado ?? false,
      chave: novo.chave ?? null,
      criado_via: quem.via,
      created_by: quem.userId,
    })
    .select(COLUNAS_DO_PAINEL)
    .single();
  if (error || !data) recusaDoBanco(error ?? { message: "sem linha" }, "não gravei o painel");
  const p = paraPainel(data as unknown as LinhaDoPainel, []);
  await audit({
    action: "relatorios.painel_criado",
    actorUserId: quem.userId,
    organizationId: quem.organizationId,
    resourceType: "mia_paineis_usuario",
    resourceId: p.id,
    requestId: quem.requestId,
    metadata: { compartilhado: p.compartilhado, via: quem.via },
  });
  return p;
}

export async function alterarPainel(
  db: SupabaseClient,
  quem: QuemAge,
  id: string,
  mudanca: { nome?: string; periodo?: PeriodoDoPainel; compartilhado?: boolean },
): Promise<Painel | null> {
  const campos: Record<string, unknown> = {};
  if (mudanca.nome !== undefined) campos.nome = mudanca.nome.trim().slice(0, 80);
  if (mudanca.periodo !== undefined) campos.periodo = mudanca.periodo;
  if (mudanca.compartilhado !== undefined) campos.compartilhado = mudanca.compartilhado;
  if (Object.keys(campos).length > 0) {
    const { error, count } = await db
      .from("mia_paineis_usuario")
      .update(campos, { count: "exact" })
      .eq("organization_id", quem.organizationId)
      .eq("id", id);
    if (error) recusaDoBanco(error, "não alterei o painel");
    if (!count) throw new RelatorioRecusado("sem_permissao", "Só quem criou e o administrador mexem num painel compartilhado.");
    await audit({
      action: mudanca.compartilhado !== undefined ? "relatorios.compartilhado" : "relatorios.painel_alterado",
      actorUserId: quem.userId,
      organizationId: quem.organizationId,
      resourceType: "mia_paineis_usuario",
      resourceId: id,
      requestId: quem.requestId,
      metadata: { campos: Object.keys(campos), via: quem.via },
    });
  }
  return lerPainel(db, quem.organizationId, id);
}

export async function apagarPainel(db: SupabaseClient, quem: QuemAge, id: string): Promise<void> {
  const { error, count } = await db
    .from("mia_paineis_usuario")
    .delete({ count: "exact" })
    .eq("organization_id", quem.organizationId)
    .eq("id", id);
  if (error) recusaDoBanco(error, "não apaguei o painel");
  if (!count) throw new RelatorioRecusado("sem_permissao", "Só quem criou e o administrador apagam um painel compartilhado.");
  await audit({
    action: "relatorios.painel_apagado",
    actorUserId: quem.userId,
    organizationId: quem.organizationId,
    resourceType: "mia_paineis_usuario",
    resourceId: id,
    requestId: quem.requestId,
    metadata: { via: quem.via },
  });
}

/** Põe um relatório (salvo ou pronto) no fim do painel. */
export async function adicionarAoPainel(
  db: SupabaseClient,
  quem: QuemAge,
  painelId: string,
  alvo: { relatorioId?: string | null; pronto?: ChaveDoPainel | null; tamanho?: Tamanho; periodoProprio?: boolean },
): Promise<ItemDoPainel> {
  const { data: ultimo } = await db
    .from("mia_paineis_usuario_itens")
    .select("posicao")
    .eq("organization_id", quem.organizationId)
    .eq("painel_id", painelId)
    .order("posicao", { ascending: false })
    .limit(1)
    .maybeSingle();
  const posicao = ultimo ? Number((ultimo as { posicao: number | string }).posicao) + 1 : 1;
  const { data, error } = await db
    .from("mia_paineis_usuario_itens")
    .insert({
      organization_id: quem.organizationId,
      painel_id: painelId,
      relatorio_id: alvo.relatorioId ?? null,
      pronto: alvo.relatorioId ? null : (alvo.pronto ?? null),
      tamanho: alvo.tamanho ?? "M",
      periodo_proprio: alvo.periodoProprio ?? false,
      posicao,
    })
    .select(COLUNAS_DO_ITEM)
    .single();
  if (error || !data) recusaDoBanco(error ?? { message: "sem linha" }, "não pus o relatório no painel");
  await audit({
    action: "relatorios.painel_alterado",
    actorUserId: quem.userId,
    organizationId: quem.organizationId,
    resourceType: "mia_paineis_usuario",
    resourceId: painelId,
    requestId: quem.requestId,
    metadata: { acao: "adicionou", relatorio_id: alvo.relatorioId ?? null, pronto: alvo.pronto ?? null, via: quem.via },
  });
  return paraItem(data as unknown as LinhaDoItem);
}

/** Muda tamanho, período próprio ou posição de um item. */
export async function alterarItem(
  db: SupabaseClient,
  quem: QuemAge,
  painelId: string,
  itemId: string,
  mudanca: { tamanho?: Tamanho; periodoProprio?: boolean; posicao?: number },
): Promise<void> {
  const campos: Record<string, unknown> = {};
  if (mudanca.tamanho) campos.tamanho = mudanca.tamanho;
  if (mudanca.periodoProprio !== undefined) campos.periodo_proprio = mudanca.periodoProprio;
  if (mudanca.posicao !== undefined && Number.isFinite(mudanca.posicao)) campos.posicao = mudanca.posicao;
  if (Object.keys(campos).length === 0) return;
  const { error, count } = await db
    .from("mia_paineis_usuario_itens")
    .update(campos, { count: "exact" })
    .eq("organization_id", quem.organizationId)
    .eq("painel_id", painelId)
    .eq("id", itemId);
  if (error) recusaDoBanco(error, "não alterei o item do painel");
  if (!count) throw new RelatorioRecusado("sem_permissao", "Só quem criou e o administrador mexem num painel compartilhado.");
}

export async function removerDoPainel(db: SupabaseClient, quem: QuemAge, painelId: string, itemId: string): Promise<void> {
  const { error, count } = await db
    .from("mia_paineis_usuario_itens")
    .delete({ count: "exact" })
    .eq("organization_id", quem.organizationId)
    .eq("painel_id", painelId)
    .eq("id", itemId);
  if (error) recusaDoBanco(error, "não tirei o relatório do painel");
  if (!count) throw new RelatorioRecusado("sem_permissao", "Só quem criou e o administrador mexem num painel compartilhado.");
  await audit({
    action: "relatorios.painel_alterado",
    actorUserId: quem.userId,
    organizationId: quem.organizationId,
    resourceType: "mia_paineis_usuario",
    resourceId: painelId,
    requestId: quem.requestId,
    metadata: { acao: "tirou", item_id: itemId, via: quem.via },
  });
}

// ─── O funil dos relatórios ─────────────────────────────────────────────────

export interface FunilDaEmpresa {
  id: string;
  nome: string;
  /** Como o segmento chama o compromisso da agenda, no plural ("Avaliações"): o vocabulário do funil. */
  compromissos?: string | null;
}

/** Os funis vivos da empresa e o dos relatórios (o ligado pela implantação, ou o principal). */
export async function funisDosRelatorios(
  db: SupabaseClient,
  organizationId: string,
): Promise<{ funis: FunilDaEmpresa[]; padrao: FunilDaEmpresa | null }> {
  const [funis, pref] = await Promise.all([
    db
      .from("crm_pipelines")
      .select("id, name, is_default, is_archived, position, vocabulary")
      .eq("organization_id", organizationId)
      .order("position", { ascending: true }),
    db.from("mia_relatorios_da_empresa").select("pipeline_id").eq("organization_id", organizationId).maybeSingle(),
  ]);
  if (funis.error) throw new Error(`não li os funis: ${funis.error.message}`);
  const vivos = ((funis.data ?? []) as Array<{ id: string; name: string; is_default: boolean; is_archived: boolean; vocabulary: unknown }>).filter(
    (f) => !f.is_archived,
  );
  const ligado = (pref.data as { pipeline_id: string | null } | null)?.pipeline_id ?? null;
  const escolhido = vivos.find((f) => f.id === ligado) ?? vivos.find((f) => f.is_default) ?? vivos[0] ?? null;
  return {
    funis: vivos.map((f) => ({ id: f.id, nome: f.name })),
    padrao: escolhido
      ? {
          id: escolhido.id,
          nome: escolhido.name,
          compromissos:
            typeof (escolhido.vocabulary as Record<string, unknown> | null)?.compromisso_plural === "string"
              ? ((escolhido.vocabulary as Record<string, string>).compromisso_plural ?? null)
              : null,
        }
      : null,
  };
}

// ─── O cálculo ──────────────────────────────────────────────────────────────

export interface Calculado {
  config: ConfigDoRelatorio;
  resposta: RespostaDoMotor;
  /** id → nome de quem aparece como grupo ou série (resp, prof). */
  nomes: Record<string, string>;
  calculadoEm: string;
}

/**
 * Calcula um relatório. `periodo` troca o do relatório (o período do painel).
 * `admin` (cliente de serviço) resolve os nomes da equipe; sem ele, os grupos
 * de pessoa ficam sem nome.
 */
export async function calcularRelatorio(
  db: Pick<SupabaseClient, "rpc">,
  admin: SupabaseClient | null,
  opcoes: {
    organizationId: string;
    config: ConfigDoRelatorio;
    valores: boolean;
    funilPadrao: FunilDaEmpresa | null;
    periodo?: PeriodoDoMontador | null;
    agora?: string | null;
  },
): Promise<Calculado> {
  const { config } = normalizarConfig(opcoes.config, { valores: opcoes.valores, funilPadrao: opcoes.funilPadrao });
  const resposta = await consultarMotor(
    db,
    pedidoDoRelatorio(config, {
      organizationId: opcoes.organizationId,
      valores: opcoes.valores,
      agora: opcoes.agora ?? null,
      periodo: opcoes.periodo ?? null,
    }),
  );
  const pessoas = ["resp", "prof"];
  const chaves: string[] = [];
  if (resposta.dim1 && pessoas.includes(resposta.dim1)) chaves.push(...resposta.grupos.map((g) => g.chave));
  if (resposta.dim2 && pessoas.includes(resposta.dim2)) chaves.push(...(resposta.series ?? []).map((s) => s.chave));
  const nomes = admin ? await nomesDaEquipe(admin, opcoes.organizationId, idsDePessoa(chaves)) : {};
  return { config, resposta, nomes, calculadoEm: new Date().toISOString() };
}

export interface PedidoDeLista {
  organizationId: string;
  config: ConfigDoRelatorio;
  valores: boolean;
  funilPadrao: FunilDaEmpresa | null;
  /** O grupo clicado (`__tudo` ou nulo = tudo; `__outros` = os dobrados). */
  chave1?: string | null;
  chave2?: string | null;
  dobrados1?: string[] | null;
  dobrados2?: string[] | null;
  /** A etapa do funil desenhado: quem chegou até ela. */
  funil?: boolean;
  limite?: number;
  deslocamento?: number;
  periodo?: PeriodoDoMontador | null;
  agora?: string | null;
}

/** A lista por trás de um número, com o nome de quem é da equipe em cada linha. */
export async function listaPorTras(
  db: Pick<SupabaseClient, "rpc">,
  admin: SupabaseClient | null,
  p: PedidoDeLista,
): Promise<{ lista: RespostaDaLista; nomes: Record<string, string> }> {
  const { config } = normalizarConfig(p.config, { valores: p.valores, funilPadrao: p.funilPadrao });
  const pedido = pedidoDoRelatorio(config, {
    organizationId: p.organizationId,
    valores: p.valores,
    periodo: p.periodo ?? null,
  });
  const vis = visualizacaoQueVale(config);
  const { data, error } = await db.rpc("fn_mia_relatorio_lista", {
    p_org: p.organizationId,
    p_fonte: config.fonte,
    p_medidas: [...pedido.medidas],
    p_dim1: pedido.dim1 ?? null,
    p_dim2: pedido.dim2 ?? null,
    p_filtros: filtrosParaOMotor(config),
    p_periodo: pedido.periodo,
    p_de: pedido.de ?? null,
    p_ate: pedido.ate ?? null,
    p_chave1: p.chave1 && p.chave1 !== "__tudo" ? p.chave1 : null,
    p_chave2: p.chave2 ?? null,
    p_dobrados1: p.chave1 === CHAVE_OUTROS ? (p.dobrados1 ?? []) : null,
    p_dobrados2: p.chave2 === CHAVE_OUTROS ? (p.dobrados2 ?? []) : null,
    p_funil: Boolean(p.funil && vis === "funil"),
    p_limite: p.limite ?? 50,
    p_deslocamento: p.deslocamento ?? 0,
    p_valores: p.valores,
    p_agora: p.agora ?? null,
  });
  if (error) throw new RecusaDoMotor((error as { code?: string }).code ?? null, error.message);
  const lista = data as RespostaDaLista;
  const ids = idsDePessoa(
    lista.linhas.flatMap((l) => [l.dims.resp, l.dims.prof, l.detalhe.pessoa].map((v) => (typeof v === "string" ? v : null))),
  );
  const nomes = admin ? await nomesDaEquipe(admin, p.organizationId, ids) : {};
  return { lista, nomes };
}

// ─── Os valores de um filtro ────────────────────────────────────────────────

export interface ValorPossivel {
  chave: string;
  rotulo: Rotulo;
  n: number;
}

/**
 * O que dá para escolher num filtro: os valores que existem no período do
 * relatório, com quantos registros cada um tem ("Meta · 41"), contados pelo
 * MESMO motor (com os outros filtros aplicados, menos este). O funil é a lista
 * dos funis da empresa.
 */
export async function valoresDoFiltro(
  db: Pick<SupabaseClient, "rpc" | "from">,
  admin: SupabaseClient | null,
  p: { organizationId: string; config: ConfigDoRelatorio; filtro: Dimensao; funilPadrao: FunilDaEmpresa | null },
): Promise<ValorPossivel[]> {
  if (p.filtro === "funil") {
    const { funis } = await funisDosRelatorios(db as SupabaseClient, p.organizationId);
    return funis.map((f) => ({ chave: f.id, rotulo: { texto: f.nome, traduzir: false }, n: 0 }));
  }
  const { [p.filtro]: _fora, ...outros } = p.config.filtros;
  const config: ConfigDoRelatorio = { ...p.config, filtros: outros, medida: "qtd", dim2: null, comparar: false, visualizacao: "barras" };
  const funil = (outros.funil as string | undefined) ?? (p.filtro === "etapa" ? p.funilPadrao?.id : undefined);
  const resposta = await consultarMotor(db, {
    organizationId: p.organizationId,
    fonte: config.fonte,
    medidas: ["qtd"],
    dim1: p.filtro,
    dim2: null,
    filtros: { ...filtrosParaOMotor(config), ...(funil ? { funil } : {}) },
    periodo: config.periodo,
    de: config.periodo === "pers" ? config.de : null,
    ate: config.periodo === "pers" ? config.ate : null,
    valores: false,
  });
  const nomes =
    admin && (p.filtro === "resp" || p.filtro === "prof")
      ? await nomesDaEquipe(admin, p.organizationId, idsDePessoa(resposta.grupos.map((g) => g.chave)))
      : {};
  return resposta.grupos
    .filter((g) => !g.outros && (g.n > 0 || g.sem))
    .map((g) => ({ chave: g.chave, rotulo: rotuloDaChave(config.fonte, p.filtro, g.chave, g.rotulo, nomes), n: g.n }));
}

// ─── A exportação ───────────────────────────────────────────────────────────

export interface PedidoDeExportacao {
  tipo: "relatorio" | "lista";
  nome: string;
  relatorioId: string | null;
  pronto: string | null;
  config: ConfigDoRelatorio;
  valores: boolean;
  funilPadrao: FunilDaEmpresa | null;
  sep: Separador;
  /** A lista: o grupo clicado e o rótulo dele (para o registro). */
  chave1?: string | null;
  chave2?: string | null;
  dobrados1?: string[] | null;
  dobrados2?: string[] | null;
  funil?: boolean;
  grupo?: string | null;
  empresa: string;
  fuso: string;
  f: Formato;
}

/**
 * Monta a planilha e REGISTRA a exportação ("quem, quando, o quê"). O registro
 * é gravado pela sessão de quem exporta: a RLS da 9040 só deixa gestor e
 * administrador gravarem, e só com o próprio id. Sem o registro, a planilha
 * não sai.
 */
export async function exportarPlanilha(
  db: SupabaseClient,
  admin: SupabaseClient | null,
  quem: QuemAge,
  p: PedidoDeExportacao,
): Promise<{ arquivo: string; texto: string; linhas: number; cortada: boolean }> {
  let texto: string;
  let linhas: number;
  let cortada = false;
  if (p.tipo === "relatorio") {
    const c = await calcularRelatorio(db, admin, {
      organizationId: quem.organizationId,
      config: p.config,
      valores: p.valores,
      funilPadrao: p.funilPadrao,
    });
    const modelo = modeloDoGrafico(c.resposta, c.config.medida, c.nomes);
    const csv = csvDoRelatorio(modelo, { sep: p.sep, f: p.f, rotuloDaMedida: rotuloDaMedida(c.config.medida, c.config.fonte, p.f.t) });
    texto = csv.texto;
    linhas = csv.linhas;
  } else {
    const { lista, nomes } = await listaPorTras(db, admin, {
      organizationId: quem.organizationId,
      config: p.config,
      valores: p.valores,
      funilPadrao: p.funilPadrao,
      chave1: p.chave1 ?? null,
      chave2: p.chave2 ?? null,
      dobrados1: p.dobrados1 ?? null,
      dobrados2: p.dobrados2 ?? null,
      funil: p.funil ?? false,
      limite: TETO_DA_PLANILHA,
      deslocamento: 0,
    });
    cortada = lista.n > lista.linhas.length;
    const csv = csvDaLista(colunasDaLista(p.config.fonte, { valores: p.valores, tela: false }), lista.linhas, {
      sep: p.sep,
      moeda: lista.moeda,
      ctx: { nomes, fuso: p.fuso, t: p.f.t },
    });
    texto = csv.texto;
    linhas = csv.linhas;
  }
  const { error } = await db.from("mia_relatorios_exportacoes").insert({
    organization_id: quem.organizationId,
    user_id: quem.userId,
    tipo: p.tipo,
    relatorio_id: p.relatorioId,
    pronto: p.pronto,
    relatorio_nome: p.nome.trim().slice(0, 200) || "Relatório",
    grupo: p.tipo === "lista" ? (p.grupo ?? null)?.slice(0, 200) ?? null : null,
    fonte: p.config.fonte,
    linhas,
    separador: p.sep,
    criado_via: quem.via,
  });
  if (error) recusaDoBanco(error, "não registrei a exportação");
  await audit({
    action: "relatorios.exportado",
    actorUserId: quem.userId,
    organizationId: quem.organizationId,
    resourceType: "mia_relatorios",
    resourceId: p.relatorioId,
    requestId: quem.requestId,
    metadata: { tipo: p.tipo, fonte: p.config.fonte, pronto: p.pronto, linhas, cortada, via: quem.via },
  });
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: p.fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return {
    arquivo: nomeDoArquivo({ empresa: p.empresa, relatorio: p.nome, grupo: p.tipo === "lista" ? p.grupo : null, hoje }),
    texto,
    linhas,
    cortada,
  };
}

export interface Exportacao {
  id: string;
  userId: string | null;
  tipo: "relatorio" | "lista";
  relatorioNome: string;
  grupo: string | null;
  linhas: number;
  criadoEm: string;
}

/** O registro das exportações (gestor e administrador; a RLS confere). */
export async function listarExportacoes(db: SupabaseClient, organizationId: string): Promise<Exportacao[]> {
  const { data, error } = await db
    .from("mia_relatorios_exportacoes")
    .select("id, user_id, tipo, relatorio_nome, grupo, linhas, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) recusaDoBanco(error, "não li o registro das exportações");
  return ((data ?? []) as Array<{ id: string; user_id: string | null; tipo: string; relatorio_nome: string; grupo: string | null; linhas: number; created_at: string }>).map(
    (l) => ({
      id: l.id,
      userId: l.user_id,
      tipo: l.tipo === "lista" ? "lista" : "relatorio",
      relatorioNome: l.relatorio_nome,
      grupo: l.grupo,
      linhas: l.linhas,
      criadoEm: l.created_at,
    }),
  );
}
