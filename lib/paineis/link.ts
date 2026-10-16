/**
 * FORK MIA (9031) — O LINK DOS PAINÉIS PARA O DONO DO NEGÓCIO.
 *
 * ── Por que existe ────────────────────────────────────────────────────────
 *
 * O dono da clínica, da construtora, da academia quer ver "como foi o mês" sem
 * login e sem aprender o CRM. O link abre os painéis prontos escolhidos, no
 * celular, com a marca da empresa dele e só números somados (protótipo
 * aprovado em 15/10/2026, telas 7 e 8).
 *
 * ── O token ───────────────────────────────────────────────────────────────
 *
 * 24 caracteres do base32 de Crockford em minúsculas (sem `i`, `l`, `o`, `u`),
 * 120 bits, DERIVADOS do id da linha por HMAC-SHA256 com o segredo do servidor.
 * Derivado, e não sorteado e guardado, por dois motivos do protótipo:
 *
 *  - "Copiar link" funciona a qualquer hora, para quem administra, sem guardar
 *    o token em lugar nenhum (nem cifrado);
 *  - "Renovar" mantém o MESMO endereço (o dono não precisa trocar o favorito).
 *
 * No banco fica só o HASH do token (outro HMAC, com outro rótulo), na coluna
 * `token_hash`, com índice único: é por ele que a página pública acha a linha.
 * Quem lê o banco sem o segredo não chega ao token; quem tem o segredo já tem
 * o servidor inteiro. Trocar o segredo (`INTERNAL_SECRET`) invalida todos os
 * links, como já invalida os convites.
 *
 * Com 120 bits, varrer endereço é inútil mesmo sem o teto por IP da página.
 *
 * ── O que a página pública garante (e onde) ───────────────────────────────
 *
 *  - resposta IGUAL para token malformado, inexistente, vencido, revogado ou de
 *    empresa parada: `resolverLink` devolve `null` para todos, e a página
 *    responde 404 com a mesma frase;
 *  - só números somados: os doze prontos não agrupam por pessoa
 *    (`lib/paineis/calcular.ts`);
 *  - nada de custo de IA nem gasto com anúncio (os doze não medem isso);
 *  - cada abertura é contada (`fn_mia_paineis_link_acessado`) e auditada sem
 *    identificar a pessoa (nem IP nem navegador são gravados).
 *
 * ── Quem cria, lista, copia e revoga ──────────────────────────────────────
 *
 * Gestor e administrador da empresa (rotas de `/api/v1/paineis/links`) e a
 * plataforma (MCP, operação `compartilhar_paineis`). A empresa de demonstração
 * também gera link: ele só LÊ dados fictícios, e a página avisa que é
 * demonstração (decisão do protótipo: "serve para venda").
 *
 * ── Revogar é para sempre ─────────────────────────────────────────────────
 *
 * "Renovar" estende a validade de um link VENCIDO, no mesmo endereço. Um link
 * REVOGADO não volta: revogar é a resposta para "esse endereço foi parar onde
 * não devia", e devolvê-lo no mesmo endereço reabriria o vazamento. Para dar
 * acesso de novo, cria-se outro link (a tela oferece "Criar outro igual").
 */
import { createHmac, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { ehOperante } from "@/lib/organizacao/operante";
import { env } from "@/lib/env";

import {
  ehChaveDoPainel,
  ehPeriodoDoLink,
  VALIDADE_PADRAO,
  type ChaveDoPainel,
  type PeriodoDoLink,
  type PeriodoDosPaineis,
  type ValidadeEmDias,
} from "./catalogo";

/** Base32 de Crockford, minúsculo: nada que se confunda lido no celular. */
export const ALFABETO_DO_TOKEN = "0123456789abcdefghjkmnpqrstvwxyz";
export const TAMANHO_DO_TOKEN = 24;
export const CAMINHO_DO_LINK = "/painel/";

// As validades e o período do link moram no catálogo (módulo puro): a tela do
// navegador os importa sem trazer `node:crypto` e a auditoria junto.
export { VALIDADES_EM_DIAS, VALIDADE_PADRAO, ehPeriodoDoLink } from "./catalogo";
export type { PeriodoDoLink, ValidadeEmDias } from "./catalogo";

/** O teto de tentativas da página pública, por IP (o do rastreio). */
export const LIMITE_DA_PAGINA = { porMinuto: 30 } as const;

const FORMA_DO_TOKEN = new RegExp(`^[${ALFABETO_DO_TOKEN}]{${TAMANHO_DO_TOKEN}}$`);

/**
 * O segredo dos dois HMAC. `INTERNAL_SECRET` é obrigatório em produção
 * (`lib/env.ts`); fora dela, um valor de desenvolvimento, para teste e máquina
 * local funcionarem sem configurar nada.
 */
function segredo(): string {
  const s = process.env.INTERNAL_SECRET;
  if (s && s.trim()) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("INTERNAL_SECRET ausente: o link do dono não pode ser assinado");
  }
  return "dev-fallback-paineis";
}

function base32(bytes: Buffer, tamanho: number): string {
  let bits = 0;
  let valor = 0;
  let saida = "";
  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5 && saida.length < tamanho) {
      saida += ALFABETO_DO_TOKEN.charAt((valor >>> (bits - 5)) & 31);
      bits -= 5;
    }
    if (saida.length >= tamanho) break;
  }
  return saida;
}

/** O token do link de id `id`. Sempre o mesmo para o mesmo id (e o mesmo segredo). */
export function tokenDoLink(id: string): string {
  const mac = createHmac("sha256", segredo()).update(`paineis-do-dono:token:v1:${id}`).digest();
  return base32(mac, TAMANHO_DO_TOKEN);
}

/** O hash que vai para `token_hash`: 64 hex, a única forma que a coluna aceita. */
export function hashDoToken(token: string): string {
  return createHmac("sha256", segredo()).update(`paineis-do-dono:busca:v1:${token}`).digest("hex");
}

/** O token como veio na URL, ou `null` quando não tem a forma de um token. */
export function normalizarToken(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const token = bruto.trim().toLowerCase();
  return FORMA_DO_TOKEN.test(token) ? token : null;
}

export function enderecoDoLink(token: string): string {
  return `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}${CAMINHO_DO_LINK}${token}`;
}

// ─── A linha ────────────────────────────────────────────────────────────────

export type SituacaoDoLink = "ativo" | "vencido" | "revogado";

export interface LinhaDoLink {
  id: string;
  organization_id: string;
  para_quem: string;
  paineis: string[];
  periodo: string;
  mostrar_valores: boolean;
  pipeline_id: string | null;
  /** FORK MIA (9042): o painel do montador que o link mostra; nulo = os prontos de `paineis`. */
  painel_id?: string | null;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  acessos: number;
  created_by: string | null;
  created_via: string;
  created_at: string;
}

export interface LinkDoDono {
  id: string;
  paraQuem: string;
  paineis: ChaveDoPainel[];
  periodo: PeriodoDoLink;
  mostrarValores: boolean;
  pipelineId: string | null;
  /** O painel do montador (9042); nulo = os prontos. */
  painelId: string | null;
  validoAte: string;
  revogadoEm: string | null;
  ultimoAcesso: string | null;
  acessos: number;
  criadoEm: string;
  criadoPor: "tela" | "mcp_plataforma";
  situacao: SituacaoDoLink;
  /** O endereço inteiro. Vale para o vencido (mostra a página de indisponível). */
  url: string;
}

const COLUNAS =
  "id, organization_id, para_quem, paineis, periodo, mostrar_valores, pipeline_id, painel_id, expires_at, revoked_at, last_used_at, acessos, created_by, created_via, created_at";

export function situacaoDoLink(
  linha: Pick<LinhaDoLink, "revoked_at" | "expires_at">,
  agora: number = Date.now(),
): SituacaoDoLink {
  if (linha.revoked_at) return "revogado";
  return Date.parse(linha.expires_at) > agora ? "ativo" : "vencido";
}

export function paraLink(linha: LinhaDoLink, agora: number = Date.now()): LinkDoDono {
  return {
    id: linha.id,
    paraQuem: linha.para_quem,
    paineis: linha.paineis.filter(ehChaveDoPainel),
    periodo: ehPeriodoDoLink(linha.periodo) ? linha.periodo : "escolhe",
    mostrarValores: linha.mostrar_valores,
    pipelineId: linha.pipeline_id,
    painelId: linha.painel_id ?? null,
    validoAte: linha.expires_at,
    revogadoEm: linha.revoked_at,
    ultimoAcesso: linha.last_used_at,
    acessos: linha.acessos,
    criadoEm: linha.created_at,
    criadoPor: linha.created_via === "mcp_plataforma" ? "mcp_plataforma" : "tela",
    situacao: situacaoDoLink(linha, agora),
    url: enderecoDoLink(tokenDoLink(linha.id)),
  };
}

// ─── Criar ──────────────────────────────────────────────────────────────────

export interface PedidoDeLink {
  paraQuem: string;
  paineis: readonly ChaveDoPainel[];
  /**
   * FORK MIA (9042): o painel do montador. Com ele, `paineis` vai vazio: o link
   * mostra os relatórios do painel (menos os que identificam pessoa da equipe).
   */
  painelId?: string | null;
  periodo: PeriodoDoLink;
  mostrarValores: boolean;
  pipelineId?: string | null;
  validadeDias?: ValidadeEmDias;
}

export interface ContextoDoLink {
  /** Da fonte confiável (a sessão, o token de plataforma), nunca do corpo. */
  organizationId: string;
  actorUserId: string;
  requestId: string;
  via: "tela" | "mcp_plataforma";
}

export class LinkRecusado extends Error {
  constructor(
    readonly motivo: "sem_painel" | "funil_de_outra_empresa" | "painel_de_outra_empresa" | "nao_encontrado" | "revogado" | "ativo",
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "LinkRecusado";
  }
}

function paineisSemRepeticao(paineis: readonly ChaveDoPainel[]): ChaveDoPainel[] {
  return paineis.filter((p, i) => ehChaveDoPainel(p) && paineis.indexOf(p) === i);
}

export async function criarLink(
  admin: SupabaseClient,
  ctx: ContextoDoLink,
  pedido: PedidoDeLink,
): Promise<LinkDoDono> {
  const painelId = pedido.painelId ?? null;
  const paineis = painelId ? [] : paineisSemRepeticao(pedido.paineis);
  if (!painelId && paineis.length === 0) throw new LinkRecusado("sem_painel", "Escolha pelo menos um painel.");
  if (painelId) {
    const { data: painel, error } = await admin
      .from("mia_paineis_usuario")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", painelId)
      .maybeSingle();
    if (error) throw new Error(`não consegui conferir o painel: ${error.message}`);
    if (!painel) throw new LinkRecusado("painel_de_outra_empresa", "Esse painel não é desta empresa.");
  }
  const pipelineId = pedido.pipelineId ?? null;
  if (pipelineId) {
    const { data: funil, error } = await admin
      .from("crm_pipelines")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", pipelineId)
      .maybeSingle();
    if (error) throw new Error(`não consegui conferir o funil: ${error.message}`);
    if (!funil) throw new LinkRecusado("funil_de_outra_empresa", "Esse funil não é desta empresa.");
  }
  const validade = pedido.validadeDias ?? VALIDADE_PADRAO;
  const id = randomUUID();
  const { data, error } = await admin
    .from("mia_paineis_links")
    .insert({
      id,
      organization_id: ctx.organizationId,
      para_quem: pedido.paraQuem.trim().slice(0, 120),
      paineis,
      periodo: pedido.periodo,
      mostrar_valores: pedido.mostrarValores,
      pipeline_id: pipelineId,
      painel_id: painelId,
      token_hash: hashDoToken(tokenDoLink(id)),
      expires_at: new Date(Date.now() + validade * 86_400_000).toISOString(),
      created_by: ctx.actorUserId,
      created_via: ctx.via,
    })
    .select(COLUNAS)
    .single();
  if (error || !data) throw new Error(`não consegui gravar o link: ${error?.message ?? "sem linha"}`);

  await audit({
    action: "paineis.link_criado",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    resourceType: "mia_paineis_links",
    resourceId: id,
    requestId: ctx.requestId,
    // Sem o token e sem o hash: a trilha diz quem criou, o que mostra e até quando.
    metadata: {
      paineis,
      painel_id: painelId,
      periodo: pedido.periodo,
      mostrar_valores: pedido.mostrarValores,
      validade_dias: validade,
      via: ctx.via,
    },
  });
  return paraLink(data as unknown as LinhaDoLink);
}

// ─── Listar ─────────────────────────────────────────────────────────────────

export async function listarLinks(admin: SupabaseClient, organizationId: string): Promise<LinkDoDono[]> {
  const { data, error } = await admin
    .from("mia_paineis_links")
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`não consegui ler os links: ${error.message}`);
  const agora = Date.now();
  return ((data ?? []) as unknown as LinhaDoLink[]).map((l) => paraLink(l, agora));
}

export async function lerLink(
  admin: SupabaseClient,
  organizationId: string,
  linkId: string,
): Promise<LinkDoDono | null> {
  const { data, error } = await admin
    .from("mia_paineis_links")
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .eq("id", linkId)
    .maybeSingle();
  if (error) throw new Error(`não consegui ler o link: ${error.message}`);
  return data ? paraLink(data as unknown as LinhaDoLink) : null;
}

// ─── Alterar ────────────────────────────────────────────────────────────────

/**
 * Troca o que um link VIVO mostra (painéis, período, valores, funil), no mesmo
 * endereço e com a mesma validade. É o "garantir" do MCP: pedir de novo o link
 * de "Dono da clínica" com outros painéis ajusta o link que já existe, em vez
 * de mandar um endereço novo ao dono.
 */
export async function alterarLink(
  admin: SupabaseClient,
  ctx: ContextoDoLink,
  linkId: string,
  pedido: Omit<PedidoDeLink, "paraQuem" | "validadeDias">,
): Promise<{ link: LinkDoDono; mudou: boolean }> {
  const atual = await lerLink(admin, ctx.organizationId, linkId);
  if (!atual) throw new LinkRecusado("nao_encontrado", "Link não encontrado.");
  if (atual.situacao === "revogado") {
    throw new LinkRecusado("revogado", "Link revogado não volta: crie outro.");
  }
  const paineis = paineisSemRepeticao(pedido.paineis);
  if (paineis.length === 0) throw new LinkRecusado("sem_painel", "Escolha pelo menos um painel.");
  const pipelineId = pedido.pipelineId ?? null;
  const igual =
    atual.paineis.length === paineis.length &&
    atual.paineis.every((p, i) => p === paineis[i]) &&
    atual.periodo === pedido.periodo &&
    atual.mostrarValores === pedido.mostrarValores &&
    atual.pipelineId === pipelineId;
  if (igual) return { link: atual, mudou: false };
  if (pipelineId) {
    const { data: funil, error } = await admin
      .from("crm_pipelines")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", pipelineId)
      .maybeSingle();
    if (error) throw new Error(`não consegui conferir o funil: ${error.message}`);
    if (!funil) throw new LinkRecusado("funil_de_outra_empresa", "Esse funil não é desta empresa.");
  }
  const { data, error } = await admin
    .from("mia_paineis_links")
    .update({
      paineis,
      periodo: pedido.periodo,
      mostrar_valores: pedido.mostrarValores,
      pipeline_id: pipelineId,
    })
    .eq("organization_id", ctx.organizationId)
    .eq("id", linkId)
    .is("revoked_at", null)
    .select(COLUNAS)
    .maybeSingle();
  if (error) throw new Error(`não consegui alterar o link: ${error.message}`);
  if (!data) throw new LinkRecusado("revogado", "O link foi revogado enquanto isso. Crie outro.");
  await audit({
    action: "paineis.link_alterado",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    resourceType: "mia_paineis_links",
    resourceId: linkId,
    requestId: ctx.requestId,
    metadata: { paineis, periodo: pedido.periodo, mostrar_valores: pedido.mostrarValores, via: ctx.via },
  });
  return { link: paraLink(data as unknown as LinhaDoLink), mudou: true };
}

// ─── Revogar e renovar ──────────────────────────────────────────────────────

/** Revoga. Revogar de novo responde o link como está (`jaEstava: true`). */
export async function revogarLink(
  admin: SupabaseClient,
  ctx: ContextoDoLink,
  linkId: string,
): Promise<{ link: LinkDoDono; jaEstava: boolean }> {
  const atual = await lerLink(admin, ctx.organizationId, linkId);
  if (!atual) throw new LinkRecusado("nao_encontrado", "Link não encontrado.");
  if (atual.revogadoEm) return { link: atual, jaEstava: true };
  const { data, error } = await admin
    .from("mia_paineis_links")
    .update({ revoked_at: new Date().toISOString(), revoked_by: ctx.actorUserId })
    .eq("organization_id", ctx.organizationId)
    .eq("id", linkId)
    .is("revoked_at", null)
    .select(COLUNAS)
    .maybeSingle();
  if (error) throw new Error(`não consegui revogar o link: ${error.message}`);
  if (!data) {
    const depois = await lerLink(admin, ctx.organizationId, linkId);
    if (!depois) throw new LinkRecusado("nao_encontrado", "Link não encontrado.");
    return { link: depois, jaEstava: true };
  }
  await audit({
    action: "paineis.link_revogado",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    resourceType: "mia_paineis_links",
    resourceId: linkId,
    requestId: ctx.requestId,
    metadata: { via: ctx.via, acessos: atual.acessos },
  });
  return { link: paraLink(data as unknown as LinhaDoLink), jaEstava: false };
}

/** Renova o VENCIDO por mais `validadeDias`, no mesmo endereço. Revogado não volta. */
export async function renovarLink(
  admin: SupabaseClient,
  ctx: ContextoDoLink,
  linkId: string,
  validadeDias: ValidadeEmDias = VALIDADE_PADRAO,
): Promise<LinkDoDono> {
  const atual = await lerLink(admin, ctx.organizationId, linkId);
  if (!atual) throw new LinkRecusado("nao_encontrado", "Link não encontrado.");
  if (atual.situacao === "revogado") {
    throw new LinkRecusado(
      "revogado",
      "Link revogado não volta: crie outro, com os mesmos painéis, se quiser dar acesso de novo.",
    );
  }
  const validoAte = new Date(Date.now() + validadeDias * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("mia_paineis_links")
    .update({ expires_at: validoAte })
    .eq("organization_id", ctx.organizationId)
    .eq("id", linkId)
    .is("revoked_at", null)
    .select(COLUNAS)
    .maybeSingle();
  if (error) throw new Error(`não consegui renovar o link: ${error.message}`);
  if (!data) throw new LinkRecusado("revogado", "O link foi revogado enquanto isso. Crie outro.");
  await audit({
    action: "paineis.link_renovado",
    actorUserId: ctx.actorUserId,
    organizationId: ctx.organizationId,
    resourceType: "mia_paineis_links",
    resourceId: linkId,
    requestId: ctx.requestId,
    metadata: { via: ctx.via, validade_dias: validadeDias, estava: atual.situacao },
  });
  return paraLink(data as unknown as LinhaDoLink);
}

// ─── A página pública ───────────────────────────────────────────────────────

export interface LinkResolvido {
  link: LinkDoDono;
  organizationId: string;
}

/**
 * O link vivo dono deste token, de empresa operante, ou `null`.
 *
 * `null` para tudo que não serve, sem distinguir: token malformado, que não
 * existe, vencido, revogado, de empresa suspensa. Quem está varrendo endereços
 * não aprende nada com a resposta. Erro do banco também vira `null`: é a mesma
 * página, e a pessoa tenta de novo.
 *
 * Só LÊ: abrir o link não muda nada além do contador (`registrarAcesso`), que
 * a página chama depois de decidir que vai mostrar dado.
 */
export async function resolverLink(admin: SupabaseClient, bruto: unknown): Promise<LinkResolvido | null> {
  const token = normalizarToken(bruto);
  if (!token) return null;
  const { data, error } = await admin
    .from("mia_paineis_links")
    .select(COLUNAS)
    .eq("token_hash", hashDoToken(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (error || !data) return null;
  const linha = data as unknown as LinhaDoLink;
  if (situacaoDoLink(linha) !== "ativo") return null;
  // O token tem de ser o DESTA linha: o hash bate, e a derivação também.
  if (tokenDoLink(linha.id) !== token) return null;
  const { data: org, error: erroOrg } = await admin
    .from("organizations")
    .select("status")
    .eq("id", linha.organization_id)
    .maybeSingle();
  if (erroOrg || !org || !ehOperante((org as { status?: string }).status)) return null;
  return { link: paraLink(linha), organizationId: linha.organization_id };
}

/** Conta a abertura e audita, sem identificar quem abriu. Falha aqui não tira a página do ar. */
export async function registrarAcesso(
  admin: SupabaseClient,
  resolvido: LinkResolvido,
  periodo: PeriodoDosPaineis,
): Promise<void> {
  try {
    await admin.rpc("fn_mia_paineis_link_acessado", { p_id: resolvido.link.id });
  } catch {
    // O contador é informação, não portão.
  }
  await audit({
    action: "paineis.link_acessado",
    organizationId: resolvido.organizationId,
    resourceType: "mia_paineis_links",
    resourceId: resolvido.link.id,
    requestId: randomUUID(),
    // Sem IP e sem navegador, de propósito: "cada abertura fica registrada,
    // sem identificar a pessoa" (protótipo, tela 7).
    metadata: { periodo },
  });
}

/**
 * A prévia do WhatsApp, do Facebook, do Slack, do Telegram e afins. Ela abre o
 * link sozinha para montar o cartão: não conta como acesso, e não recebe dado
 * nenhum (nem o nome da empresa).
 */
export function ehVisitaDePrevia(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return /whatsapp|facebookexternalhit|facebot|slackbot|telegrambot|twitterbot|linkedinbot|discordbot|skypeuripreview|googlebot|bingbot|applebot|embedly|vkshare|pinterest|redditbot|preview/i.test(
    userAgent,
  );
}
