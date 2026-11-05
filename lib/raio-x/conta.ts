/**
 * FORK MIA (.102) · A CONTA DA MIA NO RAIO-X DO CLIENTE ATIVO: quem pode, quais
 * números, que período, e o que já vem preenchido da conta (protótipo de
 * 05/11/2026, telas 1 e 2; docs/fork/raio-x-do-atendimento.md, seção 13).
 *
 * ─── Empresa ATIVA (a regra) ────────────────────────────────────────────────
 *
 * A mesma leitura da tela "Empresas do cadastro" e do `plataforma_listar_assinaturas`
 * (`lib/planos-mia/situacao.ts`, `situacaoDaEmpresa`, sobre `cobranca_assinaturas`
 * e o status da organização):
 *
 *   - a organização OPERA (`organizations.status = 'active'`): parada,
 *     suspensa, arquivada ou redigida não entra;
 *   - e a situação na cobrança é EM DIA, EM TESTE ou ISENTA. Isenta é a empresa
 *     sem assinatura no sistema: a implantada pela Time, que paga por fora, é o
 *     cliente de hoje. Em atraso (com ou sem prazo), suspensa e cancelada não
 *     entram: o raio-X é gasto da Time.
 *   - a DEMONSTRAÇÃO (`organizations.demonstracao`) entra se opera, qualquer que
 *     seja a cobrança: é para dar para mostrar (o dado dela é inventado).
 *
 * Só LÊ, com o cliente de serviço, depois de quem chama conferir que é admin de
 * plataforma (a rota) ou que o token tem a operação (o MCP).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerJanelaDeAtendimento } from "@/lib/agent-engine/agent/janela-de-atendimento";
import { ehApiOficial, ehNumeroDeWhatsapp } from "@/lib/channels/raio-x/numeros-da-conta";
import { segmentoDoEstado, type SegmentoDoOnboarding } from "@/lib/onboarding/modelos-de-agente-da-mia";
import { ehOperante } from "@/lib/organizacao/operante";
import { situacaoDaEmpresa, type AssinaturaLida, type SituacaoDaEmpresa } from "@/lib/planos-mia/situacao";

import { COTACAO_DE_RESERVA, estimativaDoRaioX, type EstimativaDoRaioX } from "./custo";
import { meiaNoiteLocal, momentoLocal } from "./horario";
import { normalizarWhatsapp, whatsappParaLer, type PeriodoEmDias, type Segmento } from "./regras";

// ─── Quem é cliente ativo ───────────────────────────────────────────────────

/** As situações da cobrança que contam como cliente ativo (a demonstração entra à parte). */
export const SITUACOES_DE_CLIENTE_ATIVO: readonly SituacaoDaEmpresa[] = ["emdia", "teste", "isenta"];

export interface OrgParaOClienteAtivo {
  status: string;
  suspended_kind: string | null;
  demonstracao?: boolean | null;
}

export interface ClienteAtivo {
  ativo: boolean;
  situacao: SituacaoDaEmpresa | null;
  demonstracao: boolean;
}

/** A regra, PURA: a organização opera e está em dia, em teste ou isenta; ou é demonstração e opera. */
export function ehClienteAtivo(org: OrgParaOClienteAtivo, assinatura: AssinaturaLida | null, agora: Date = new Date()): ClienteAtivo {
  const demonstracao = org.demonstracao === true;
  if (!ehOperante(org.status)) return { ativo: false, situacao: null, demonstracao };
  const situacao = situacaoDaEmpresa(assinatura, { status: org.status, suspended_kind: org.suspended_kind }, agora);
  return { ativo: demonstracao || SITUACOES_DE_CLIENTE_ATIVO.includes(situacao), situacao, demonstracao };
}

const COLUNAS_DA_ASSINATURA = "organization_id, estado, trial_ate, provedor, prazo_extra_ate, cancela_no_fim";

export interface EmpresaAtiva {
  id: string;
  nome: string;
  /** Quando a conta nasceu na MIA ("cliente desde"). */
  clienteDesde: string;
  situacao: SituacaoDaEmpresa | null;
  demonstracao: boolean;
}

function falhou(contexto: string, erro: { code?: string } | null): never {
  throw new Error(`raio-x: ${contexto} (${erro?.code ?? "sem_codigo"})`);
}

/** As empresas que podem ter o raio-X do cliente ativo, pela regra acima. LANÇA na falha. */
export async function listarEmpresasAtivas(admin: SupabaseClient, agora: Date = new Date()): Promise<EmpresaAtiva[]> {
  const [orgs, assinaturas] = await Promise.all([
    admin
      .from("organizations")
      .select("id, display_name, legal_name, created_at, status, suspended_kind, demonstracao")
      .order("display_name", { ascending: true })
      .limit(1000),
    admin.from("cobranca_assinaturas").select(COLUNAS_DA_ASSINATURA).limit(5000),
  ]);
  if (orgs.error) falhou("empresas ilegíveis", orgs.error);
  if (assinaturas.error) falhou("assinaturas ilegíveis", assinaturas.error);
  const porOrg = new Map(
    ((assinaturas.data ?? []) as Array<{ organization_id: string } & Partial<AssinaturaLida>>).map((a) => [a.organization_id, a as AssinaturaLida]),
  );
  return (
    (orgs.data ?? []) as Array<{
      id: string;
      display_name: string | null;
      legal_name: string | null;
      created_at: string;
      status: string;
      suspended_kind: string | null;
      demonstracao: boolean | null;
    }>
  ).flatMap((o) => {
    const c = ehClienteAtivo(o, porOrg.get(o.id) ?? null, agora);
    if (!c.ativo) return [];
    return [{ id: o.id, nome: o.display_name || o.legal_name || o.id, clienteDesde: o.created_at, situacao: c.situacao, demonstracao: c.demonstracao }];
  });
}

/** UMA empresa pela regra (a criação confere de novo: a lista da tela pode estar velha). */
export async function clienteAtivoDaConta(
  admin: SupabaseClient,
  orgId: string,
  agora: Date = new Date(),
): Promise<(ClienteAtivo & { nome: string; clienteDesde: string; onboardingState: unknown }) | null> {
  const [org, assinatura] = await Promise.all([
    admin
      .from("organizations")
      .select("id, display_name, legal_name, created_at, status, suspended_kind, demonstracao, onboarding_state")
      .eq("id", orgId)
      .maybeSingle(),
    admin.from("cobranca_assinaturas").select(COLUNAS_DA_ASSINATURA).eq("organization_id", orgId).maybeSingle(),
  ]);
  if (org.error) falhou("empresa ilegível", org.error);
  if (assinatura.error) falhou("assinatura ilegível", assinatura.error);
  const o = org.data as {
    id: string;
    display_name: string | null;
    legal_name: string | null;
    created_at: string;
    status: string;
    suspended_kind: string | null;
    demonstracao: boolean | null;
    onboarding_state: unknown;
  } | null;
  if (!o) return null;
  return {
    ...ehClienteAtivo(o, (assinatura.data as AssinaturaLida | null) ?? null, agora),
    nome: o.display_name || o.legal_name || o.id,
    clienteDesde: o.created_at,
    onboardingState: o.onboarding_state,
  };
}

// ─── Os números ─────────────────────────────────────────────────────────────

export interface NumeroDaConta {
  id: string;
  rotulo: string;
  /** O telefone comercial em dígitos E.164, ou `null` quando o canal não informa. */
  telefone: string | null;
  oficial: boolean;
  arquivado: boolean;
}

/** Os números de WhatsApp da conta (inclusive a API oficial). Rede social e voz ficam de fora. */
export async function numerosDaConta(admin: SupabaseClient, orgId: string): Promise<NumeroDaConta[]> {
  const { data, error } = await admin
    .from("channel_sessions")
    .select("id, display_name, phone_number, provider, archived_at, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) falhou("números ilegíveis", error);
  return ((data ?? []) as Array<{ id: string; display_name: string | null; phone_number: string | null; provider: string; archived_at: string | null }>)
    .filter((c) => ehNumeroDeWhatsapp(c.provider))
    .map((c) => {
      const telefone = c.phone_number ? normalizarWhatsapp(c.phone_number.startsWith("+") ? c.phone_number : `+${c.phone_number}`) : null;
      const rotulo = (c.display_name?.trim() || (telefone ? whatsappParaLer(telefone) : "Número sem nome")).slice(0, 80);
      return { id: c.id, rotulo, telefone, oficial: ehApiOficial(c.provider), arquivado: c.archived_at !== null };
    });
}

// ─── O período ──────────────────────────────────────────────────────────────

/** A data mais antiga das conversas da conta nesses números, ou `null` (conta sem conversa). */
export async function primeiraConversaDaConta(admin: SupabaseClient, orgId: string, numeros: readonly string[]): Promise<Date | null> {
  if (numeros.length === 0) return null;
  const { data, error } = await admin
    .from("conversations")
    .select("created_at")
    .eq("organization_id", orgId)
    .in("channel_session_id", [...numeros])
    .eq("is_group", false)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) falhou("primeira conversa", error);
  const em = (data as { created_at?: string } | null)?.created_at;
  return em ? new Date(em) : null;
}

function meiaNoiteDoDia(instante: Date, deslocamentoDias: number): Date {
  const [ano, mes, dia] = momentoLocal(instante).data.split("-").map(Number) as [number, number, number];
  const d = new Date(Date.UTC(ano, mes - 1, dia + deslocamentoDias, 12));
  return meiaNoiteLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * O período do raio-X do cliente ativo, PURO: os N dias INTEIROS antes do dia
 * de hoje (no fuso), e nunca antes do dia da primeira conversa da conta. É
 * fixado na criação, para o termo dizer as datas que o dono autoriza
 * ("de 06/09 a 04/11"). `fim` é exclusivo (a meia-noite de hoje).
 */
export function periodoDoClienteAtivo(
  periodoDias: PeriodoEmDias | number,
  agora: Date,
  primeiraConversaEm: Date | null,
): { inicio: Date; fim: Date; limitado: boolean } {
  const fim = meiaNoiteDoDia(agora, 0);
  let inicio = meiaNoiteDoDia(agora, -periodoDias);
  let limitado = false;
  if (primeiraConversaEm && primeiraConversaEm.getTime() > inicio.getTime()) {
    inicio = meiaNoiteDoDia(primeiraConversaEm, 0);
    limitado = true;
  }
  return { inicio, fim, limitado };
}

// ─── O que vem preenchido da conta ──────────────────────────────────────────

/** O segmento do passo "Seu negócio" do onboarding, no vocabulário do raio-X. */
const SEGMENTO_DO_ONBOARDING: Record<SegmentoDoOnboarding, Segmento> = {
  clinica: "clinica_odontologica",
  academia: "academia",
  imobiliaria: "imobiliaria",
  industria: "outro",
  outro: "outro",
};

export function segmentoDaConta(onboardingState: unknown): Segmento | null {
  const s = segmentoDoEstado(onboardingState);
  return s ? SEGMENTO_DO_ONBOARDING[s] : null;
}

export interface HorarioDaConta {
  abre: string;
  fecha: string;
  sabadoAte: string | null;
  /** `true` = veio do horário de funcionamento de um agente publicado da conta; `false` = o padrão do raio-X. */
  daConta: boolean;
}

export const HORARIO_PADRAO: HorarioDaConta = { abre: "08:00", fecha: "18:00", sabadoAte: "13:00", daConta: false };

/**
 * O horário comercial "da conta": o "Só atender em horário de funcionamento"
 * de um agente PUBLICADO (`trigger_config.filters.business_hours`, o leitor do
 * upstream, `lerJanelaDeAtendimento`). Sem ele, o padrão do raio-X. A Time
 * pode mudar só neste raio-X.
 */
export async function horarioDaConta(admin: SupabaseClient, orgId: string): Promise<HorarioDaConta> {
  const { data: agentes } = await admin
    .from("ai_agents")
    .select("published_version_id")
    .eq("organization_id", orgId)
    .not("published_version_id", "is", null)
    .limit(20);
  const ids = ((agentes ?? []) as Array<{ published_version_id: string | null }>).flatMap((a) => (a.published_version_id ? [a.published_version_id] : []));
  if (ids.length === 0) return HORARIO_PADRAO;
  const { data: versoes } = await admin.from("ai_agent_versions").select("trigger_config").in("id", ids);
  for (const v of (versoes ?? []) as Array<{ trigger_config: unknown }>) {
    const janela = lerJanelaDeAtendimento(v.trigger_config);
    if (!janela) continue;
    return { abre: janela.start, fecha: janela.end, sabadoAte: janela.weekdays.includes(6) ? janela.end : null, daConta: true };
  }
  return HORARIO_PADRAO;
}

/** Quem administra a conta: o primeiro administrador (o mesmo de "Empresas do cadastro"). Nome e e-mail, para mandar o link. */
export async function responsavelDaConta(admin: SupabaseClient, orgId: string): Promise<{ nome: string | null; email: string | null } | null> {
  const { data, error } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("role", "admin")
    .is("revoked_at", null)
    .eq("provisional_until_handover", false)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) return null;
  const userId = ((data ?? []) as Array<{ user_id: string }>)[0]?.user_id;
  if (!userId) return null;
  try {
    const { data: u } = await admin.auth.admin.getUserById(userId);
    const meta = (u.user?.user_metadata ?? {}) as Record<string, unknown>;
    return { nome: typeof meta.full_name === "string" && meta.full_name.trim() ? meta.full_name.trim() : null, email: u.user?.email ?? null };
  } catch {
    return null;
  }
}

async function contar(consulta: PromiseLike<{ count: number | null; error: { code?: string } | null }>): Promise<number> {
  const { count, error } = await consulta;
  if (error) falhou("contagem do período", error);
  return count ?? 0;
}

/** Quanto há no período: mensagens por número, conversas e áudios ainda sem transcrição. */
export async function contarNoPeriodo(
  admin: SupabaseClient,
  orgId: string,
  numeros: readonly string[],
  inicio: Date,
  fim: Date,
): Promise<{ mensagensPorNumero: Record<string, number>; conversas: number; audios: number }> {
  const de = inicio.toISOString();
  const ate = fim.toISOString();
  const mensagensPorNumero: Record<string, number> = {};
  await Promise.all(
    numeros.map(async (n) => {
      mensagensPorNumero[n] = await contar(
        admin.from("messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("channel_session_id", n).gte("sent_at", de).lt("sent_at", ate),
      );
    }),
  );
  if (numeros.length === 0) return { mensagensPorNumero, conversas: 0, audios: 0 };
  const [conversas, audios, transcritos] = await Promise.all([
    contar(
      admin
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .in("channel_session_id", [...numeros])
        .eq("is_group", false)
        .gte("last_message_at", de)
        .lt("created_at", ate),
    ),
    contar(
      admin.from("messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId).in("channel_session_id", [...numeros]).eq("type", "audio").gte("sent_at", de).lt("sent_at", ate),
    ),
    contar(
      admin
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .in("channel_session_id", [...numeros])
        .eq("type", "audio")
        .eq("media_derived_status", "ready")
        .gte("sent_at", de)
        .lt("sent_at", ate),
    ),
  ]);
  return { mensagensPorNumero, conversas, audios: Math.max(0, audios - transcritos) };
}

async function cotacao(admin: SupabaseClient): Promise<number> {
  const { data } = await admin.from("platform_fx_rates").select("usd_brl").order("dia", { ascending: false }).limit(1).maybeSingle();
  const v = Number((data as { usd_brl?: number | string } | null)?.usd_brl);
  return Number.isFinite(v) && v > 0.5 && v < 100 ? v : COTACAO_DE_RESERVA;
}

export interface ContaParaORaioX {
  organizationId: string;
  empresa: string;
  clienteDesde: string;
  ativo: ClienteAtivo;
  segmento: Segmento | null;
  horario: HorarioDaConta;
  responsavel: { nome: string | null; email: string | null } | null;
  numeros: Array<NumeroDaConta & { mensagens: number }>;
  periodo: { inicio: string; fim: string; limitado: boolean; primeiraConversaEm: string | null };
  estimativa: EstimativaDoRaioX;
}

/**
 * Tudo o que o "Novo raio-X" do cliente ativo puxa da conta (a tela e o MCP):
 * a regra de ativo, o segmento, o horário, quem administra, os números com as
 * mensagens do período, o período limitado à primeira conversa e a estimativa.
 * `numerosEscolhidos` ausente = todos os números não arquivados.
 */
export async function contaParaORaioX(
  admin: SupabaseClient,
  orgId: string,
  periodoDias: PeriodoEmDias | number,
  agora: Date = new Date(),
  numerosEscolhidos?: readonly string[],
): Promise<ContaParaORaioX | null> {
  const conta = await clienteAtivoDaConta(admin, orgId, agora);
  if (!conta) return null;
  const [numeros, horario, responsavel] = await Promise.all([numerosDaConta(admin, orgId), horarioDaConta(admin, orgId), responsavelDaConta(admin, orgId)]);
  const escolhidos = numerosEscolhidos ? numeros.filter((n) => numerosEscolhidos.includes(n.id)) : numeros.filter((n) => !n.arquivado);
  const ids = escolhidos.map((n) => n.id);
  const primeira = await primeiraConversaDaConta(admin, orgId, ids);
  const periodo = periodoDoClienteAtivo(periodoDias, agora, primeira);
  const todos = numeros.map((n) => n.id);
  const contagem = await contarNoPeriodo(admin, orgId, todos, periodo.inicio, periodo.fim);
  const doEscolhido = ids.length > 0 ? await contarNoPeriodo(admin, orgId, ids, periodo.inicio, periodo.fim) : { conversas: 0, audios: 0 };
  return {
    organizationId: orgId,
    empresa: conta.nome,
    clienteDesde: conta.clienteDesde,
    ativo: { ativo: conta.ativo, situacao: conta.situacao, demonstracao: conta.demonstracao },
    segmento: segmentoDaConta(conta.onboardingState),
    horario,
    responsavel,
    numeros: numeros.map((n) => ({ ...n, mensagens: contagem.mensagensPorNumero[n.id] ?? 0 })),
    periodo: {
      inicio: periodo.inicio.toISOString(),
      fim: periodo.fim.toISOString(),
      limitado: periodo.limitado,
      primeiraConversaEm: primeira ? primeira.toISOString() : null,
    },
    estimativa: estimativaDoRaioX(doEscolhido.conversas, doEscolhido.audios, await cotacao(admin)),
  };
}

// ─── A criação ──────────────────────────────────────────────────────────────

export type RecusaDaConta = "empresa_inexistente" | "empresa_nao_ativa" | "numero_de_outra_empresa" | "numero_sem_telefone" | "sem_conversas";

/**
 * Confere o cadastro do cliente ativo contra a conta, na hora de criar (a lista
 * da tela pode estar velha): a empresa é ativa pela regra; os números são de
 * WhatsApp DESTA conta; um deles tem telefone (vira o `whatsapp` do raio-X, a
 * chave de "mesma empresa"); e há conversa para ler. Fixa o período.
 */
export async function prepararONovoRaioXDaConta(
  admin: SupabaseClient,
  entrada: { organization_id: string | null; numeros: readonly string[]; periodo_dias: number },
  agora: Date = new Date(),
): Promise<
  | {
      ok: true;
      whatsapp: string;
      conta: { numeros: NumeroDaConta[]; periodo: { inicio: Date; fim: Date }; primeiraConversaEm: Date | null };
    }
  | { ok: false; motivo: RecusaDaConta }
> {
  if (!entrada.organization_id) return { ok: false, motivo: "empresa_inexistente" };
  const conta = await clienteAtivoDaConta(admin, entrada.organization_id, agora);
  if (!conta) return { ok: false, motivo: "empresa_inexistente" };
  if (!conta.ativo) return { ok: false, motivo: "empresa_nao_ativa" };
  const todos = await numerosDaConta(admin, entrada.organization_id);
  const escolhidos = entrada.numeros.map((id) => todos.find((n) => n.id === id));
  if (escolhidos.length === 0 || escolhidos.some((n) => n === undefined)) return { ok: false, motivo: "numero_de_outra_empresa" };
  const numeros = escolhidos as NumeroDaConta[];
  const comTelefone = numeros.find((n) => n.telefone);
  if (!comTelefone?.telefone) return { ok: false, motivo: "numero_sem_telefone" };
  const primeira = await primeiraConversaDaConta(admin, entrada.organization_id, numeros.map((n) => n.id));
  if (!primeira) return { ok: false, motivo: "sem_conversas" };
  const periodo = periodoDoClienteAtivo(entrada.periodo_dias, agora, primeira);
  if (periodo.inicio.getTime() >= periodo.fim.getTime()) return { ok: false, motivo: "sem_conversas" };
  return { ok: true, whatsapp: comTelefone.telefone, conta: { numeros, periodo: { inicio: periodo.inicio, fim: periodo.fim }, primeiraConversaEm: primeira } };
}
