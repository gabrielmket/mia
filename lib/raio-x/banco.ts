/**
 * FORK MIA (.101) · O RAIO-X NO BANCO: cadastro, link de conexão, aceite,
 * relatórios, link do dono e encerramento.
 *
 * Todas as tabelas do raio-X são só do servidor (9150): quem chama passa o
 * cliente de serviço (`createAdminClient`) depois de conferir a pessoa
 * (platform admin com MFA nas rotas, token com a operação no MCP, o código do
 * link na página pública). A auditoria é de quem chama.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { leitorDoRaioX } from "@/lib/channels/raio-x/leitor";

import { compararComOAnterior, mesmaEmpresa, type Comparacao } from "./comparacao";
import { prazosDoEncerramento, validadeDoLinkDeConexao, linkDeConexaoVivo } from "./prazos";
import {
  VALIDADE_PADRAO_DO_LINK_DO_DONO,
  VALIDADES_DO_LINK_DO_DONO,
  whatsappParaLer,
  type NovoRaioX,
  type SituacaoDoRaioX,
  type TipoDoRaioX,
  type ValidadeDoLinkDoDono,
} from "./regras";
import type { DadosDoRelatorio } from "./relatorio";
import { hashDoTermo, textoDoTermo, VERSAO_DO_TERMO } from "./termo";
import {
  codigoDaConexao,
  enderecoDaConexao,
  enderecoDoDono,
  hashDoCodigo,
  hashDoTokenDoDono,
  normalizarCodigo,
  normalizarTokenDoDono,
  tokenDoDono,
} from "./tokens";

// ─── As linhas ──────────────────────────────────────────────────────────────

export interface LinhaDoRaioX {
  id: string;
  empresa: string;
  segmento: string;
  whatsapp: string;
  responsavel_nome: string | null;
  responsavel_contato: string | null;
  quem_atende: string;
  periodo_dias: number;
  tipo: TipoDoRaioX;
  abre: string;
  fecha: string;
  sabado_ate: string | null;
  organization_id: string | null;
  teto_centavos: number;
  situacao: SituacaoDoRaioX;
  conexao_versao: number;
  conexao_expira_em: string | null;
  sessao: string | null;
  conectado_em: string | null;
  numero_conectado: string | null;
  ciclo: number;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  competencia: string | null;
  leitura: Record<string, unknown>;
  leitura_concluida_em: string | null;
  analise: Record<string, unknown>;
  trava_ate: string | null;
  ultimo_relatorio_em: string | null;
  desconectar_em: string | null;
  desconectado_em: string | null;
  apagar_conversas_em: string | null;
  conversas_apagadas_em: string | null;
  encerrado_em: string | null;
  criado_por: string | null;
  criado_via: string;
  created_at: string;
  updated_at: string;
}

export const COLUNAS_DO_RAIO_X =
  "id, empresa, segmento, whatsapp, responsavel_nome, responsavel_contato, quem_atende, periodo_dias, tipo, abre, fecha, sabado_ate, organization_id, teto_centavos, situacao, conexao_versao, conexao_expira_em, sessao, conectado_em, numero_conectado, ciclo, periodo_inicio, periodo_fim, competencia, leitura, leitura_concluida_em, analise, trava_ate, ultimo_relatorio_em, desconectar_em, desconectado_em, apagar_conversas_em, conversas_apagadas_em, encerrado_em, criado_por, criado_via, created_at, updated_at";

export interface LinhaDoRelatorio {
  id: string;
  raio_x_id: string;
  sequencia: number;
  periodo_inicio: string;
  periodo_fim: string;
  competencia: string | null;
  situacao: "rascunho" | "revisado";
  criterios_versao: string;
  dados: DadosDoRelatorio;
  comparacao: Comparacao | null;
  anterior_id: string | null;
  parcial: boolean;
  conversas: number;
  custo_usd_centavos: number;
  custo_centavos: number;
  notas_da_time: string | null;
  revisado_por: string | null;
  revisado_em: string | null;
  created_at: string;
}

export const COLUNAS_DO_RELATORIO =
  "id, raio_x_id, sequencia, periodo_inicio, periodo_fim, competencia, situacao, criterios_versao, dados, comparacao, anterior_id, parcial, conversas, custo_usd_centavos, custo_centavos, notas_da_time, revisado_por, revisado_em, created_at";

export interface LinhaDoLinkDoDono {
  id: string;
  relatorio_id: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  acessos: number;
  created_via: string;
  created_at: string;
}

function falhou(contexto: string, erro: { code?: string } | null): never {
  throw new Error(`raio-x: ${contexto} (${erro?.code ?? "sem_codigo"})`);
}

/** O nome da sessão no leitor: `raiox_` + 24 hex do id. Nunca coincide com um canal de empresa. */
export function nomeDaSessao(raioXId: string): string {
  return `raiox_${raioXId.replace(/-/g, "").slice(0, 24)}`;
}

// ─── O cadastro e o link de conexão ─────────────────────────────────────────

export interface RaioXCriado {
  raioX: LinhaDoRaioX;
  codigo: string;
  link: string;
  mensagem: string;
}

/** A mensagem pronta que a Time manda ao dono (o protótipo, tela 2). */
export function mensagemPronta(r: Pick<LinhaDoRaioX, "empresa" | "responsavel_nome">, link: string): string {
  const nome = r.responsavel_nome?.trim() || "tudo bem";
  const saudacao = r.responsavel_nome?.trim() ? `Oi, ${nome}!` : "Oi, tudo bem?";
  return [
    `${saudacao} Como combinamos, vamos fazer o raio-X do atendimento do WhatsApp da ${r.empresa}.`,
    "",
    "É só abrir o link, ler a autorização e conectar pelo seu celular (leva 1 minuto):",
    link,
    "",
    "A gente só lê as conversas, nada é enviado do seu número, e você desconecta quando quiser. O link vale por 48 horas.",
  ].join("\n");
}

export async function criarRaioX(
  admin: SupabaseClient,
  entrada: NovoRaioX,
  ator: string | null,
  via: "tela" | "mcp_plataforma",
  agora: Date = new Date(),
): Promise<RaioXCriado> {
  const id = randomUUID();
  const codigo = codigoDaConexao(id, 1);
  const { data, error } = await admin
    .from("mia_raio_x")
    .insert({
      id,
      empresa: entrada.empresa,
      segmento: entrada.segmento,
      whatsapp: entrada.whatsapp,
      responsavel_nome: entrada.responsavel_nome,
      responsavel_contato: entrada.responsavel_contato,
      quem_atende: entrada.quem_atende,
      periodo_dias: entrada.periodo_dias,
      tipo: entrada.tipo,
      abre: entrada.abre,
      fecha: entrada.fecha,
      sabado_ate: entrada.sabado_ate,
      organization_id: entrada.organization_id,
      teto_centavos: entrada.teto_centavos,
      conexao_codigo_hash: hashDoCodigo(codigo),
      conexao_versao: 1,
      conexao_expira_em: validadeDoLinkDeConexao(agora).toISOString(),
      criado_por: ator,
      criado_via: via,
    })
    .select(COLUNAS_DO_RAIO_X)
    .single();
  if (error || !data) falhou("cadastro não gravou", error);
  const raioX = data as unknown as LinhaDoRaioX;
  const link = enderecoDaConexao(codigo);
  return { raioX, codigo, link, mensagem: mensagemPronta(raioX, link) };
}

/** O código e o link vigentes (para "Copiar o link de novo"). */
export function linkDeConexaoAtual(r: Pick<LinhaDoRaioX, "id" | "conexao_versao">): { codigo: string; link: string } {
  const codigo = codigoDaConexao(r.id, r.conexao_versao);
  return { codigo, link: enderecoDaConexao(codigo) };
}

/** "Gerar outro": muda o código (o anterior deixa de valer) e dá mais 48 horas. */
export async function gerarOutroLinkDeConexao(
  admin: SupabaseClient,
  r: LinhaDoRaioX,
  agora: Date = new Date(),
): Promise<{ ok: true; codigo: string; link: string; mensagem: string; expiraEm: string } | { ok: false; motivo: "ja_conectado" | "encerrado" }> {
  if (r.situacao === "encerrado") return { ok: false, motivo: "encerrado" };
  if (r.conectado_em && !r.desconectado_em) return { ok: false, motivo: "ja_conectado" };
  const versao = r.conexao_versao + 1;
  const codigo = codigoDaConexao(r.id, versao);
  const expiraEm = validadeDoLinkDeConexao(agora).toISOString();
  const { error } = await admin
    .from("mia_raio_x")
    .update({ conexao_versao: versao, conexao_codigo_hash: hashDoCodigo(codigo), conexao_expira_em: expiraEm })
    .eq("id", r.id);
  if (error) falhou("o link novo não gravou", error);
  const link = enderecoDaConexao(codigo);
  return { ok: true, codigo, link, mensagem: mensagemPronta(r, link), expiraEm };
}

export async function lerRaioX(admin: SupabaseClient, id: string): Promise<LinhaDoRaioX | null> {
  const { data, error } = await admin.from("mia_raio_x").select(COLUNAS_DO_RAIO_X).eq("id", id).maybeSingle();
  if (error) falhou("leitura do raio-X", error);
  return (data as unknown as LinhaDoRaioX | null) ?? null;
}

/**
 * O raio-X do código do link público. `null` para código malformado, que não
 * existe ou de raio-X encerrado: a página responde igual a todos.
 */
export async function raioXPeloCodigo(admin: SupabaseClient, bruto: unknown): Promise<LinhaDoRaioX | null> {
  const codigo = normalizarCodigo(bruto);
  if (!codigo) return null;
  const { data, error } = await admin
    .from("mia_raio_x")
    .select(COLUNAS_DO_RAIO_X)
    .eq("conexao_codigo_hash", hashDoCodigo(codigo))
    .maybeSingle();
  if (error) falhou("leitura pelo código", error);
  const r = (data as unknown as LinhaDoRaioX | null) ?? null;
  if (!r || r.situacao === "encerrado") return null;
  return r;
}

/** O link ainda deixa autorizar e parear? (48 h; depois de conectado, só mostra o andamento.) */
export function podeConectar(r: LinhaDoRaioX, agora: Date = new Date()): boolean {
  return (r.situacao === "aguardando" || r.situacao === "conectando") && linkDeConexaoVivo(r.conexao_expira_em, agora);
}

// ─── O aceite ───────────────────────────────────────────────────────────────

export function termoDoRaioX(r: Pick<LinhaDoRaioX, "empresa" | "whatsapp" | "periodo_dias" | "tipo">): string {
  return textoDoTermo({ empresa: r.empresa, whatsapp: r.whatsapp, periodoDias: r.periodo_dias, tipo: r.tipo });
}

/**
 * Grava o aceite (nome, data e hora, versão, texto inteiro e hash) e passa o
 * raio-X para "conectando", com a sessão do leitor nomeada. Repetir o aceite
 * (o dono voltou à página) grava outro: cada aceite é um registro.
 */
export async function registrarAceite(
  admin: SupabaseClient,
  r: LinhaDoRaioX,
  nome: string,
): Promise<{ aceiteId: string; sessao: string }> {
  const texto = termoDoRaioX(r);
  const { data, error } = await admin
    .from("mia_raio_x_aceites")
    .insert({ raio_x_id: r.id, nome: nome.trim(), termo_versao: VERSAO_DO_TERMO, termo_texto: texto, termo_hash: hashDoTermo(texto) })
    .select("id")
    .single();
  if (error || !data) falhou("o aceite não gravou", error);
  const sessao = r.sessao ?? nomeDaSessao(r.id);
  const { error: erroDaSituacao } = await admin
    .from("mia_raio_x")
    .update({ situacao: r.situacao === "aguardando" ? "conectando" : r.situacao, sessao })
    .eq("id", r.id);
  if (erroDaSituacao) falhou("a situação não gravou", erroDaSituacao);
  return { aceiteId: (data as { id: string }).id, sessao };
}

export async function ultimoAceite(
  admin: SupabaseClient,
  raioXId: string,
): Promise<{ nome: string; aceito_em: string; termo_versao: string } | null> {
  const { data, error } = await admin
    .from("mia_raio_x_aceites")
    .select("nome, aceito_em, termo_versao")
    .eq("raio_x_id", raioXId)
    .order("aceito_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) falhou("leitura do aceite", error);
  return (data as { nome: string; aceito_em: string; termo_versao: string } | null) ?? null;
}

// ─── A lista ────────────────────────────────────────────────────────────────

export interface RaioXNaLista {
  id: string;
  empresa: string;
  segmento: string;
  whatsapp: string;
  whatsappParaLer: string;
  tipo: TipoDoRaioX;
  situacao: SituacaoDoRaioX;
  criadoEm: string;
  organizationId: string | null;
  linkVivo: boolean;
  linkExpiraEm: string | null;
  andamento: number | null;
  conversas: number;
  desconectarEm: string | null;
  desconectadoEm: string | null;
  apagarConversasEm: string | null;
  conversasApagadasEm: string | null;
  ultimoRelatorio: { id: string; situacao: "rascunho" | "revisado"; criadoEm: string } | null;
  /** O raio-X anterior da MESMA empresa (decisão 13), se houver. */
  anterior: { id: string; criadoEm: string } | null;
  custoCentavos: number;
}

/** O andamento da leitura em %, ou `null` quando ainda não começou. */
export function andamentoDaLeitura(r: Pick<LinhaDoRaioX, "situacao" | "leitura">): number | null {
  if (r.situacao === "analisando" || r.situacao === "pronto") return 100;
  if (r.situacao !== "lendo") return null;
  const l = r.leitura as { fase?: string; conversas_lidas?: number; total?: number };
  if (l.fase !== "lendo" && l.fase !== "conferindo") return 0;
  const total = Number(l.total) || 0;
  const lidas = Number(l.conversas_lidas) || 0;
  // A conferência é o último trecho.
  if (l.fase === "conferindo") return 95;
  if (total <= 0) return 5;
  return Math.max(1, Math.min(90, Math.round((lidas / total) * 90)));
}

export async function listarRaioX(admin: SupabaseClient, agora: Date = new Date()): Promise<RaioXNaLista[]> {
  const { data, error } = await admin
    .from("mia_raio_x")
    .select(COLUNAS_DO_RAIO_X)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) falhou("a lista não leu", error);
  const linhas = (data ?? []) as unknown as LinhaDoRaioX[];
  const ids = linhas.map((l) => l.id);
  const [relatorios, gastos] = ids.length
    ? await Promise.all([
        admin.from("mia_raio_x_relatorios").select("id, raio_x_id, situacao, created_at, sequencia").in("raio_x_id", ids),
        admin.from("mia_raio_x_gastos").select("raio_x_id, custo_centavos").in("raio_x_id", ids),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (relatorios.error) falhou("relatórios da lista", relatorios.error);
  if (gastos.error) falhou("gastos da lista", gastos.error);
  const ultimoPorRaioX = new Map<string, { id: string; situacao: "rascunho" | "revisado"; criadoEm: string; sequencia: number }>();
  for (const rel of (relatorios.data ?? []) as Array<{ id: string; raio_x_id: string; situacao: "rascunho" | "revisado"; created_at: string; sequencia: number }>) {
    const atual = ultimoPorRaioX.get(rel.raio_x_id);
    if (!atual || rel.sequencia > atual.sequencia) {
      ultimoPorRaioX.set(rel.raio_x_id, { id: rel.id, situacao: rel.situacao, criadoEm: rel.created_at, sequencia: rel.sequencia });
    }
  }
  const custoPorRaioX = new Map<string, number>();
  for (const g of (gastos.data ?? []) as Array<{ raio_x_id: string; custo_centavos: number | string }>) {
    custoPorRaioX.set(g.raio_x_id, (custoPorRaioX.get(g.raio_x_id) ?? 0) + Number(g.custo_centavos));
  }
  return linhas.map((l) => {
    const anterior = linhas
      .filter((o) => o.id !== l.id && o.created_at < l.created_at && mesmaEmpresa(o, l))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const ultimo = ultimoPorRaioX.get(l.id) ?? null;
    const leitura = l.leitura as { conversas_lidas?: number };
    return {
      id: l.id,
      empresa: l.empresa,
      segmento: l.segmento,
      whatsapp: l.whatsapp,
      whatsappParaLer: whatsappParaLer(l.whatsapp),
      tipo: l.tipo,
      situacao: l.situacao,
      criadoEm: l.created_at,
      organizationId: l.organization_id,
      linkVivo: podeConectar(l, agora),
      linkExpiraEm: l.conexao_expira_em,
      andamento: andamentoDaLeitura(l),
      conversas: Number(leitura.conversas_lidas) || 0,
      desconectarEm: l.desconectar_em,
      desconectadoEm: l.desconectado_em,
      apagarConversasEm: l.apagar_conversas_em,
      conversasApagadasEm: l.conversas_apagadas_em,
      ultimoRelatorio: ultimo ? { id: ultimo.id, situacao: ultimo.situacao, criadoEm: ultimo.criadoEm } : null,
      anterior: anterior ? { id: anterior.id, criadoEm: anterior.created_at } : null,
      custoCentavos: Math.round(custoPorRaioX.get(l.id) ?? 0),
    };
  });
}

/** Quanto este raio-X já gastou (real, centavos), no ciclo pedido ou em todos. */
export async function gastoDoRaioX(admin: SupabaseClient, raioXId: string, ciclo?: number): Promise<{ centavos: number; usdCentavos: number }> {
  let q = admin.from("mia_raio_x_gastos").select("custo_centavos, custo_usd_centavos").eq("raio_x_id", raioXId);
  if (ciclo !== undefined) q = q.eq("ciclo", ciclo);
  const { data, error } = await q;
  if (error) falhou("gasto do raio-X", error);
  let centavos = 0;
  let usdCentavos = 0;
  for (const g of (data ?? []) as Array<{ custo_centavos: number | string; custo_usd_centavos: number | string }>) {
    centavos += Number(g.custo_centavos);
    usdCentavos += Number(g.custo_usd_centavos);
  }
  return { centavos, usdCentavos };
}

// ─── Os relatórios ──────────────────────────────────────────────────────────

export async function lerRelatorios(admin: SupabaseClient, raioXId: string): Promise<LinhaDoRelatorio[]> {
  const { data, error } = await admin
    .from("mia_raio_x_relatorios")
    .select(COLUNAS_DO_RELATORIO)
    .eq("raio_x_id", raioXId)
    .order("sequencia", { ascending: false });
  if (error) falhou("relatórios", error);
  return (data ?? []) as unknown as LinhaDoRelatorio[];
}

export async function lerRelatorio(admin: SupabaseClient, relatorioId: string): Promise<LinhaDoRelatorio | null> {
  const { data, error } = await admin.from("mia_raio_x_relatorios").select(COLUNAS_DO_RELATORIO).eq("id", relatorioId).maybeSingle();
  if (error) falhou("relatório", error);
  return (data as unknown as LinhaDoRelatorio | null) ?? null;
}

/**
 * O relatório anterior da MESMA empresa (decisão 13), revisado, para comparar:
 * o do mesmo raio-X (o mensal, mês a mês) ou o de outro raio-X com o mesmo
 * WhatsApp ou a mesma conta da MIA.
 */
export async function relatorioAnterior(
  admin: SupabaseClient,
  r: Pick<LinhaDoRaioX, "id" | "whatsapp" | "organization_id">,
  antesDe: string,
): Promise<LinhaDoRelatorio | null> {
  let filtro = admin.from("mia_raio_x").select("id, whatsapp, organization_id");
  filtro = r.organization_id
    ? filtro.or(`whatsapp.eq.${r.whatsapp},organization_id.eq.${r.organization_id}`)
    : filtro.eq("whatsapp", r.whatsapp);
  const { data: irmaos, error } = await filtro;
  if (error) falhou("raio-X da mesma empresa", error);
  const ids = ((irmaos ?? []) as Array<{ id: string; whatsapp: string; organization_id: string | null }>)
    .filter((o) => mesmaEmpresa(o, r))
    .map((o) => o.id);
  if (!ids.includes(r.id)) ids.push(r.id);
  const { data, error: erroRel } = await admin
    .from("mia_raio_x_relatorios")
    .select(COLUNAS_DO_RELATORIO)
    .in("raio_x_id", ids)
    .eq("situacao", "revisado")
    .lt("created_at", antesDe)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (erroRel) falhou("relatório anterior", erroRel);
  return (data as unknown as LinhaDoRelatorio | null) ?? null;
}

export function compararRelatorios(atual: { id: string; criadoEm: string; dados: DadosDoRelatorio }, anterior: LinhaDoRelatorio): Comparacao {
  return compararComOAnterior(
    { id: atual.id, criadoEm: atual.criadoEm, criteriosVersao: atual.dados.criteriosVersao, conversas: atual.dados.numeros.conversas, indicadores: atual.dados.indicadores },
    {
      id: anterior.id,
      criadoEm: anterior.created_at,
      criteriosVersao: anterior.criterios_versao,
      conversas: anterior.conversas,
      indicadores: anterior.dados.indicadores,
    },
  );
}

/** A Time revisou: o rascunho vira revisado, com quem, quando e as anotações (que o dono não vê). */
export async function revisarRelatorio(
  admin: SupabaseClient,
  relatorioId: string,
  ator: string | null,
  notas: string | null,
): Promise<LinhaDoRelatorio | null> {
  const { data, error } = await admin
    .from("mia_raio_x_relatorios")
    .update({ situacao: "revisado", revisado_por: ator, revisado_em: new Date().toISOString(), notas_da_time: notas?.trim() || null })
    .eq("id", relatorioId)
    .select(COLUNAS_DO_RELATORIO)
    .maybeSingle();
  if (error) falhou("a revisão não gravou", error);
  return (data as unknown as LinhaDoRelatorio | null) ?? null;
}

// ─── O link do dono ─────────────────────────────────────────────────────────

export interface LinkDoDono {
  id: string;
  relatorioId: string;
  url: string;
  validoAte: string;
  revogadoEm: string | null;
  acessos: number;
  ultimoAcesso: string | null;
  situacao: "ativo" | "vencido" | "revogado";
  criadoEm: string;
}

function paraLinkDoDono(l: LinhaDoLinkDoDono, agora: number = Date.now()): LinkDoDono {
  return {
    id: l.id,
    relatorioId: l.relatorio_id,
    url: enderecoDoDono(tokenDoDono(l.id)),
    validoAte: l.expires_at,
    revogadoEm: l.revoked_at,
    acessos: l.acessos,
    ultimoAcesso: l.last_used_at,
    situacao: l.revoked_at ? "revogado" : Date.parse(l.expires_at) > agora ? "ativo" : "vencido",
    criadoEm: l.created_at,
  };
}

export async function lerLinksDoDono(admin: SupabaseClient, relatorioIds: string[]): Promise<LinkDoDono[]> {
  if (relatorioIds.length === 0) return [];
  const { data, error } = await admin
    .from("mia_raio_x_links")
    .select("id, relatorio_id, expires_at, revoked_at, last_used_at, acessos, created_via, created_at")
    .in("relatorio_id", relatorioIds)
    .order("created_at", { ascending: false });
  if (error) falhou("links do dono", error);
  return ((data ?? []) as LinhaDoLinkDoDono[]).map((l) => paraLinkDoDono(l));
}

export function validadeDoLinkDoDono(bruto: unknown): ValidadeDoLinkDoDono {
  const n = Number(bruto);
  return (VALIDADES_DO_LINK_DO_DONO as readonly number[]).includes(n) ? (n as ValidadeDoLinkDoDono) : VALIDADE_PADRAO_DO_LINK_DO_DONO;
}

/** Só o relatório REVISADO gera link do dono (decisão 10). */
export async function criarLinkDoDono(
  admin: SupabaseClient,
  relatorio: Pick<LinhaDoRelatorio, "id" | "situacao">,
  dias: ValidadeDoLinkDoDono,
  ator: string | null,
  via: "tela" | "mcp_plataforma",
): Promise<{ ok: true; link: LinkDoDono } | { ok: false; motivo: "nao_revisado" }> {
  if (relatorio.situacao !== "revisado") return { ok: false, motivo: "nao_revisado" };
  const id = randomUUID();
  const { data, error } = await admin
    .from("mia_raio_x_links")
    .insert({
      id,
      relatorio_id: relatorio.id,
      token_hash: hashDoTokenDoDono(tokenDoDono(id)),
      expires_at: new Date(Date.now() + dias * 86_400_000).toISOString(),
      created_by: ator,
      created_via: via,
    })
    .select("id, relatorio_id, expires_at, revoked_at, last_used_at, acessos, created_via, created_at")
    .single();
  if (error || !data) falhou("o link do dono não gravou", error);
  return { ok: true, link: paraLinkDoDono(data as LinhaDoLinkDoDono) };
}

export async function revogarLinkDoDono(admin: SupabaseClient, linkId: string, ator: string | null): Promise<LinkDoDono | null> {
  const { data, error } = await admin
    .from("mia_raio_x_links")
    .update({ revoked_at: new Date().toISOString(), revoked_by: ator })
    .eq("id", linkId)
    .is("revoked_at", null)
    .select("id, relatorio_id, expires_at, revoked_at, last_used_at, acessos, created_via, created_at")
    .maybeSingle();
  if (error) falhou("a revogação não gravou", error);
  return data ? paraLinkDoDono(data as LinhaDoLinkDoDono) : null;
}

/**
 * O relatório do link público do dono. `null` para token malformado, que não
 * existe, vencido ou revogado: a página responde igual a todos. Conta o acesso.
 */
export async function resolverLinkDoDono(
  admin: SupabaseClient,
  bruto: unknown,
  contar: boolean,
): Promise<{ link: LinkDoDono; relatorio: LinhaDoRelatorio; raioX: LinhaDoRaioX } | null> {
  const token = normalizarTokenDoDono(bruto);
  if (!token) return null;
  const { data, error } = await admin
    .from("mia_raio_x_links")
    .select("id, relatorio_id, expires_at, revoked_at, last_used_at, acessos, created_via, created_at")
    .eq("token_hash", hashDoTokenDoDono(token))
    .maybeSingle();
  if (error || !data) return null;
  const link = paraLinkDoDono(data as LinhaDoLinkDoDono);
  if (link.situacao !== "ativo") return null;
  const relatorio = await lerRelatorio(admin, link.relatorioId);
  if (!relatorio || relatorio.situacao !== "revisado") return null;
  const raioX = await lerRaioX(admin, relatorio.raio_x_id);
  if (!raioX) return null;
  if (contar) await admin.rpc("fn_mia_raio_x_link_acessado", { p_id: link.id });
  return { link, relatorio, raioX };
}

// ─── Desconectar e encerrar ─────────────────────────────────────────────────

export type ResultadoDaDesconexao = { desconectou: boolean; falhaNoLeitor: boolean };

/**
 * Derruba a conexão AGORA: logout no aparelho e a sessão apagada no leitor (com
 * o acervo que ela guardou). As conversas lidas apagam no prazo (30 dias do
 * relatório, ou de agora se não há relatório). O relatório fica.
 *
 * Sem relatório e com leitura em andamento, a leitura para; o que já foi lido
 * vira relatório com o que há (situação "analisando").
 */
export async function desconectarAgora(admin: SupabaseClient, r: LinhaDoRaioX, agora: Date = new Date()): Promise<ResultadoDaDesconexao> {
  let falhaNoLeitor = false;
  if (r.sessao && !r.desconectado_em) {
    const leitor = leitorDoRaioX();
    try {
      if (leitor) await leitor.desconectar(r.sessao);
      else falhaNoLeitor = true;
    } catch {
      falhaNoLeitor = true;
    }
  }
  const apagarEm = r.apagar_conversas_em ?? prazosDoEncerramento(agora).apagarConversasEm.toISOString();
  const proxima: Partial<LinhaDoRaioX> & Record<string, unknown> = {
    desconectado_em: r.desconectado_em ?? agora.toISOString(),
    desconectar_em: null,
    apagar_conversas_em: apagarEm,
    // O link de conexão morre junto: reconectar é outro link.
    conexao_codigo_hash: null,
    conexao_expira_em: null,
  };
  if (r.situacao === "lendo") {
    proxima.situacao = "analisando";
    proxima.leitura_concluida_em = agora.toISOString();
    proxima.periodo_fim = r.periodo_fim ?? agora.toISOString();
  } else if (r.situacao === "aguardando" || r.situacao === "conectando") {
    proxima.situacao = "encerrado";
    proxima.encerrado_em = agora.toISOString();
  }
  const { error } = await admin.from("mia_raio_x").update(proxima).eq("id", r.id);
  if (error) falhou("a desconexão não gravou", error);
  return { desconectou: Boolean(r.sessao && !r.desconectado_em), falhaNoLeitor };
}

/** Encerrar: desconecta, para tudo e agenda a exclusão das conversas. O relatório fica. */
export async function encerrarRaioX(
  admin: SupabaseClient,
  r: LinhaDoRaioX,
  ator: string | null,
  agora: Date = new Date(),
): Promise<ResultadoDaDesconexao & { apagarConversasEm: string }> {
  const desconexao = await desconectarAgora(admin, r, agora);
  const apagarEm = r.apagar_conversas_em ?? prazosDoEncerramento(agora).apagarConversasEm.toISOString();
  const { error } = await admin
    .from("mia_raio_x")
    .update({ situacao: "encerrado", encerrado_em: agora.toISOString(), encerrado_por: ator, apagar_conversas_em: apagarEm })
    .eq("id", r.id);
  if (error) falhou("o encerramento não gravou", error);
  return { ...desconexao, apagarConversasEm: apagarEm };
}

/** Liga (ou solta) a empresa da MIA, quando ela vira cliente. */
export async function ligarEmpresaDaMia(admin: SupabaseClient, raioXId: string, organizationId: string | null): Promise<boolean> {
  if (organizationId) {
    const { data, error } = await admin.from("organizations").select("id").eq("id", organizationId).maybeSingle();
    if (error || !data) return false;
  }
  const { error } = await admin.from("mia_raio_x").update({ organization_id: organizationId }).eq("id", raioXId);
  if (error) falhou("a empresa não ligou", error);
  return true;
}

export async function mudarTeto(admin: SupabaseClient, raioXId: string, tetoCentavos: number): Promise<void> {
  const { error } = await admin.from("mia_raio_x").update({ teto_centavos: tetoCentavos }).eq("id", raioXId);
  if (error) falhou("o teto não gravou", error);
}
