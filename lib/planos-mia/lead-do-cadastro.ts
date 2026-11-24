/**
 * FORK MIA (MIA-168) · TODO CADASTRO DO /SIGNUP VIRA LEAD NO CRM DA TIME E ANDA
 * NO FUNIL "MIA - SDR" (docs/fork/jornada-de-assinatura.md, "O lead do cadastro").
 *
 * A entrada é a mesma do Raio-X: a fonte de formulário "App · cadastro" da org
 * da Time (`CADASTRO_FONTE_DO_CRM` = o id dela), chamada por dentro pelo núcleo
 * comum `lib/time/captacao-na-time.ts`. O `external_id` é um por conta
 * (`mia-cadastro-<user_id>`): no envio do formulário a empresa ainda não existe.
 *
 * Quatro momentos, cada um com a sua porta:
 *   1. o envio do /signup (`app/actions/auth/signUp.ts`): a linha em
 *      `mia_cadastro_na_time` (9169) e o lead em "Novo contato", pela fonte;
 *   2. o e-mail confirmado, a empresa nasceu: "Cadastro concluído";
 *   3. a empresa nasceu no teste: "Em teste" (os dois pelo consumidor
 *      `lead-do-cadastro.handler.ts`, do evento `mia.cadastro.empresa_nasceu`);
 *   4. o primeiro pagamento confirmado: "Assinante", com o valor em BRL
 *      (`informarPagamentoATime`, no consumidor `cobranca.sinal` e na rodada).
 * O card anda pela mesma porta do kanban (`moveLeadHandler`), que emite o
 * `lead.stage_changed` das automações e do motor de conversões. A idempotência
 * são as colunas `*_em`: marcado, não move de novo. Etapa faltando no funil não
 * marca o momento (fica `crm_erro = sem_etapa:<nome>` e a rodada tenta de novo).
 *
 * Nunca lança: o cadastro e a cobrança não dependem do CRM. Empresa de
 * implantação, isenta ou de demonstração não entra. Conta existente e convite
 * não chegam aqui (quem chama confere).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DependenciasDoAsaasDaMia } from "@/lib/asaas-mia/api";
import { asaasDaMia } from "@/lib/asaas-mia/cobrancas";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";
import {
  enviarAFonteDaTime,
  idDaFonte,
  orgDaFonte,
  type DependenciasDaCaptacao,
  type MotivoSemLead,
} from "@/lib/time/captacao-na-time";

import { CAMPOS_DA_ORIGEM, origemSaneada, type OrigemDoCadastro } from "./origem-do-cadastro";

export const VARIAVEL_DA_FONTE = "CADASTRO_FONTE_DO_CRM";
export const ORIGEM_DO_LEAD = "cadastro-mia";
const MODULO = "cadastro_mia";

/** As etapas do funil, pelo nome (configuradas por `plataforma_garantir_funil`). */
export const ETAPAS_DO_CADASTRO = {
  cadastroConcluido: "Cadastro concluído",
  emTeste: "Em teste",
  assinante: "Assinante",
} as const;

export type Consentimento = "medicao" | "necessario";

const TABELA = "mia_cadastro_na_time";

/** O id externo do negócio: um por conta, para o mesmo cadastro cair no mesmo card. */
export function idExternoDoCadastro(userId: string): string {
  return `mia-cadastro-${userId}`;
}

/** O valor do cookie `mia_consentimento` do site, ou nulo. Fora de `medicao`/`necessario`, nulo. */
export function consentimentoDoCookie(bruto: string | null | undefined): Consentimento | null {
  const v = (bruto ?? "").trim().toLowerCase();
  return v === "medicao" || v === "necessario" ? v : null;
}

/** Telefone em E.164 a partir do digitado (Brasil quando vierem 10 ou 11 dígitos). */
export function telefoneDoCadastro(bruto: string | null | undefined): string | null {
  const digitos = (bruto ?? "").replace(/\D/g, "");
  if (digitos.length === 10 || digitos.length === 11) return `+55${digitos}`;
  if (digitos.length >= 12 && digitos.length <= 15) return `+${digitos}`;
  return null;
}

/** A página sem a query nem o fragmento (os ids de clique vão nas colunas próprias). */
export function paginaSemQuery(bruta: string | null | undefined): string | null {
  if (!bruta) return null;
  try {
    const u = new URL(bruta);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.origin}${u.pathname}`.slice(0, 500);
  } catch {
    return null;
  }
}

/** O que o cadastro manda e guarda. Nome e telefone só existem na entrada paga. */
export interface DadosDoCadastro {
  userId: string;
  email: string;
  empresa: string;
  nome?: string | null;
  telefone?: string | null;
  plano?: string | null;
  cupom?: string | null;
  origem?: OrigemDoCadastro;
  fbp?: string | null;
  fbc?: string | null;
  consentimento?: Consentimento | null;
}

/**
 * O corpo do envio, como um formulário mandaria (as chaves que a fonte mapeia).
 * `fbp` e `fbc` só vão com `consentimento = medicao`.
 */
export function corpoDoCadastro(d: DadosDoCadastro): Record<string, string> {
  const corpo: Record<string, string> = {
    external_id: idExternoDoCadastro(d.userId),
    email: d.email,
    empresa: d.empresa,
    origem: ORIGEM_DO_LEAD,
  };
  if (d.nome?.trim()) corpo.nome = d.nome.trim();
  const telefone = telefoneDoCadastro(d.telefone);
  if (telefone) corpo.telefone = telefone;
  if (d.plano?.trim()) corpo.plano = d.plano.trim();
  if (d.cupom?.trim()) corpo.cupom = d.cupom.trim();
  const origem = origemSaneada(d.origem ?? {});
  for (const campo of CAMPOS_DA_ORIGEM) if (origem[campo]) corpo[campo] = origem[campo]!;
  if (d.consentimento === "medicao") {
    if (d.fbp?.trim()) corpo.fbp = d.fbp.trim();
    if (d.fbc?.trim()) corpo.fbc = d.fbc.trim();
  }
  if (d.consentimento) corpo.consentimento_cookies = d.consentimento;
  return corpo;
}

export interface DependenciasDoLeadDoCadastro extends DependenciasDaCaptacao {
  asaas?: DependenciasDoAsaasDaMia;
  agora?: () => Date;
  /** Para o teste: as portas do kanban (sem elas, as de `app/api/v1/leads/_handler`). */
  portas?: PortasDoCard;
}

export interface PortasDoCard {
  mover: (orgId: string, fonteId: string, leadId: string, etapaId: string) => Promise<void>;
  valor: (orgId: string, fonteId: string, leadId: string, valorCents: number) => Promise<void>;
}

async function portasDoKanban(cliente: SupabaseClient): Promise<PortasDoCard> {
  const { moveLeadHandler, updateLeadHandler } = await import("@/app/api/v1/leads/_handler");
  // O ator é a FONTE (como na rota de captação): o card entrou por ela e anda por ela.
  // Não um `api_token` com nome: o audit grava o id dele numa coluna uuid.
  const ctx = (orgId: string, fonteId: string, leadId: string) => ({
    organization_id: orgId,
    actor: { type: "webhook_source" as const, id: fonteId },
    requestId: `${MODULO}:${leadId}`,
  });
  return {
    mover: async (orgId, fonteId, leadId, etapaId) => {
      await moveLeadHandler(cliente, ctx(orgId, fonteId, leadId), leadId, { to_stage_id: etapaId });
    },
    valor: async (orgId, fonteId, leadId, valorCents) => {
      await updateLeadHandler(cliente, ctx(orgId, fonteId, leadId), leadId, { value_cents: valorCents, currency: "BRL" });
    },
  };
}

async function portas(cliente: SupabaseClient, deps: DependenciasDoLeadDoCadastro): Promise<PortasDoCard> {
  return deps.portas ?? portasDoKanban(cliente);
}

const agoraDe = (deps: DependenciasDoLeadDoCadastro) => (deps.agora ?? (() => new Date()))();

/** A linha do cadastro, como os momentos a leem. */
export interface LinhaDoCadastro {
  id: string;
  user_id: string;
  organization_id: string | null;
  lead_id: string | null;
  empresa_cliente_id: string | null;
  fbp: string | null;
  fbc: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  consentimento: Consentimento | null;
  origem: Record<string, unknown> | null;
  crm_erro: string | null;
  cadastro_concluido_em: string | null;
  teste_comecou_em: string | null;
  pagamento_confirmado_em: string | null;
  valor_cents: number | null;
  pedido_id: string | null;
  capturado_em: string;
}

const COLUNAS =
  "id, user_id, organization_id, lead_id, empresa_cliente_id, fbp, fbc, gclid, gbraid, wbraid, consentimento, origem, crm_erro, cadastro_concluido_em, teste_comecou_em, pagamento_confirmado_em, valor_cents, pedido_id, capturado_em";

async function marcar(cliente: SupabaseClient, linhaId: string, valores: Record<string, unknown>): Promise<boolean> {
  const { error } = await cliente.from(TABELA).update(valores).eq("id", linhaId);
  if (error) logger.warn("[cadastro-na-time] a linha não gravou", { linhaId, codigo: error.code ?? "sem_codigo" });
  return !error;
}

function logDaFalha(motivo: MotivoSemLead, contexto: Record<string, unknown>): void {
  if (motivo === "sem_fonte") logger.warn(`[cadastro-na-time] ${VARIAVEL_DA_FONTE} não configurada: o cadastro não virou lead no CRM da Time`, contexto);
  else if (motivo === "fonte_inexistente") logger.warn("[cadastro-na-time] a fonte do CRM da Time não existe ou está desligada", contexto);
  else if (motivo === "recusado") logger.warn("[cadastro-na-time] a fonte do CRM da Time recusou o cadastro", contexto);
  else logger.warn("[cadastro-na-time] o lead no CRM da Time falhou", contexto);
}

/** Manda o corpo à fonte e grava o lead (ou o erro) na linha. Nunca lança. */
async function enviarELigar(
  cliente: SupabaseClient,
  linhaId: string,
  dados: DadosDoCadastro,
  deps: DependenciasDoLeadDoCadastro,
  referer: string | null,
): Promise<{ ok: true; leadId: string; organizationId: string } | { ok: false; motivo: MotivoSemLead }> {
  const r = await enviarAFonteDaTime(
    cliente,
    { variavel: VARIAVEL_DA_FONTE, corpo: corpoDoCadastro(dados), userAgent: "mia-cadastro/1", referer },
    deps,
  );
  if (r.ok) {
    await marcar(cliente, linhaId, { organization_id: r.organizationId, lead_id: r.leadId, crm_erro: null });
    return r;
  }
  logDaFalha(r.motivo, { userId: dados.userId, ...(r.status ? { status: r.status } : {}), ...(r.detalhe ? { detail: r.detalhe } : {}) });
  await marcar(cliente, linhaId, { crm_erro: r.motivo });
  return { ok: false, motivo: r.motivo };
}

// ─── 1. O envio do /signup ──────────────────────────────────────────────────

export interface EntradaDoEnvio extends DadosDoCadastro {
  ip?: string | null;
  navegador?: string | null;
  pagina?: string | null;
}

export type ResultadoDoEnvio = { ok: true; leadId: string } | { ok: false; motivo: MotivoSemLead | "linha" };

/**
 * A conta NOVA (quem chama confere: sem convite e com `identities`) vira a
 * linha da `mia_cadastro_na_time` e o lead em "Novo contato". Nunca lança.
 */
export async function registrarCadastroNaTime(
  cliente: SupabaseClient,
  entrada: EntradaDoEnvio,
  deps: DependenciasDoLeadDoCadastro = {},
): Promise<ResultadoDoEnvio> {
  try {
    const medicao = entrada.consentimento === "medicao";
    const origem = origemSaneada(entrada.origem ?? {});
    const { gclid, gbraid, wbraid, ...resto } = origem;
    const { error } = await cliente
      .from(TABELA)
      .upsert(
        {
          user_id: entrada.userId,
          ip: entrada.ip ?? null,
          navegador: entrada.navegador ? entrada.navegador.slice(0, 512) : null,
          fbp: medicao && entrada.fbp ? entrada.fbp.slice(0, 300) : null,
          fbc: medicao && entrada.fbc ? entrada.fbc.slice(0, 300) : null,
          gclid: gclid ?? null,
          gbraid: gbraid ?? null,
          wbraid: wbraid ?? null,
          consentimento: entrada.consentimento ?? null,
          pagina: paginaSemQuery(entrada.pagina),
          // Os utm_* e o fbclid, mais o plano e o cupom: o que refaz o lead
          // quando a fonte faltou agora (o consumidor do nascimento tenta de novo).
          origem: {
            ...resto,
            ...(entrada.plano ? { plano: entrada.plano.slice(0, 120) } : {}),
            ...(entrada.cupom ? { cupom: entrada.cupom.slice(0, 40) } : {}),
          },
        },
        // O mesmo usuário de novo (pediu o e-mail outra vez): a linha é a de antes.
        { onConflict: "user_id", ignoreDuplicates: true },
      );
    if (error) {
      logger.warn("[cadastro-na-time] a linha do cadastro não gravou", { userId: entrada.userId, codigo: error.code ?? "sem_codigo" });
      return { ok: false, motivo: "linha" };
    }
    const { data } = await cliente.from(TABELA).select("id, lead_id").eq("user_id", entrada.userId).maybeSingle();
    if (!data) return { ok: false, motivo: "linha" };
    const linha = data as { id: string; lead_id: string | null };
    if (linha.lead_id) return { ok: true, leadId: linha.lead_id };
    const r = await enviarELigar(cliente, linha.id, entrada, deps, paginaSemQuery(entrada.pagina));
    return r.ok ? { ok: true, leadId: r.leadId } : r;
  } catch (erro) {
    logger.warn("[cadastro-na-time] o cadastro não virou lead", { userId: entrada.userId, detail: erro instanceof Error ? erro.message : "erro" });
    return { ok: false, motivo: "falhou" };
  }
}

// ─── O card anda ────────────────────────────────────────────────────────────

type ResultadoDoMovimento = { ok: true } | { ok: false; erro: string };

/** A etapa pelo nome no funil do lead (sem diferença de maiúscula e espaço). */
function mesmoNome(a: string, b: string): boolean {
  const n = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  return n(a) === n(b);
}

async function moverPara(
  cliente: SupabaseClient,
  alvo: { orgId: string; leadId: string; fonteId: string },
  etapa: string,
  p: PortasDoCard,
): Promise<ResultadoDoMovimento> {
  try {
    const { data: lead, error } = await cliente
      .from("crm_leads")
      .select("id, pipeline_id, stage_id")
      .eq("organization_id", alvo.orgId)
      .eq("id", alvo.leadId)
      .maybeSingle();
    if (error) return { ok: false, erro: "falhou" };
    if (!lead) return { ok: false, erro: "lead_inexistente" };
    const l = lead as { pipeline_id: string; stage_id: string | null };
    const { data: etapas, error: erroDasEtapas } = await cliente
      .from("crm_stages")
      .select("id, name")
      .eq("organization_id", alvo.orgId)
      .eq("pipeline_id", l.pipeline_id);
    if (erroDasEtapas) return { ok: false, erro: "falhou" };
    const destino = ((etapas ?? []) as Array<{ id: string; name: string }>).find((s) => mesmoNome(s.name, etapa));
    if (!destino) {
      logger.warn("[cadastro-na-time] a etapa não existe no funil do lead", { etapa, leadId: alvo.leadId });
      return { ok: false, erro: `sem_etapa:${etapa}` };
    }
    if (l.stage_id !== destino.id) await p.mover(alvo.orgId, alvo.fonteId, alvo.leadId, destino.id);
    return { ok: true };
  } catch (erro) {
    logger.warn("[cadastro-na-time] o card não andou", { etapa, leadId: alvo.leadId, detail: erro instanceof Error ? erro.message : "erro" });
    return { ok: false, erro: "falhou" };
  }
}

async function notar(cliente: SupabaseClient, alvo: { orgId: string; leadId: string; fonteId: string }, nota: string, sourceId: string | null): Promise<void> {
  try {
    await emitLeadActivity(cliente, {
      organizationId: alvo.orgId,
      leadId: alvo.leadId,
      type: "note",
      sourceModule: MODULO,
      sourceId,
      actor: { type: "webhook_source", id: alvo.fonteId },
      reason: nota.slice(0, 500),
    });
  } catch (erro) {
    logger.warn("[cadastro-na-time] a nota do lead falhou", { leadId: alvo.leadId, detail: erro instanceof Error ? erro.message : "erro" });
  }
}

// ─── 2 e 3. A empresa nasceu ────────────────────────────────────────────────

interface EmpresaDoCliente {
  id: string;
  nome: string;
  criadaPor: string | null;
  demonstracao: boolean;
}

interface AssinaturaDaEmpresa {
  estado: string;
  trial_ate: string | null;
  pagamento_inicial_pendente: boolean | null;
  provedor: string | null;
  provedor_assinatura_id: string | null;
  plano_id: string | null;
}

async function lerEmpresa(cliente: SupabaseClient, orgId: string): Promise<EmpresaDoCliente | null> {
  const { data, error } = await cliente.from("organizations").select("id, display_name, created_by, demonstracao").eq("id", orgId).maybeSingle();
  if (error) throw new Error(`empresa ilegível (${error.code ?? "sem_codigo"})`);
  if (!data) return null;
  const o = data as { id: string; display_name: string | null; created_by: string | null; demonstracao?: boolean | null };
  return { id: o.id, nome: o.display_name ?? "", criadaPor: o.created_by, demonstracao: o.demonstracao === true };
}

async function lerAssinatura(cliente: SupabaseClient, orgId: string): Promise<AssinaturaDaEmpresa | null> {
  const { data, error } = await cliente
    .from("cobranca_assinaturas")
    .select("estado, trial_ate, pagamento_inicial_pendente, provedor, provedor_assinatura_id, plano_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`assinatura ilegível (${error.code ?? "sem_codigo"})`);
  return (data as AssinaturaDaEmpresa | null) ?? null;
}

/** No teste de verdade: `trial`, com prazo à frente e sem o primeiro pagamento pendente. */
export function nasceuNoTeste(a: AssinaturaDaEmpresa | null, agora: Date): boolean {
  if (!a || a.estado !== "trial" || a.pagamento_inicial_pendente === true || !a.trial_ate) return false;
  return Date.parse(a.trial_ate) > agora.getTime();
}

export type ResultadoDoNascimento =
  | { status: "ok"; momentos: string[] }
  | { status: "fora"; motivo: "sem_empresa" | "implantacao" | "demonstracao" | "isenta" | "sem_dono" }
  | { status: "pendente"; motivo: string };

async function linhaDoUsuario(cliente: SupabaseClient, userId: string): Promise<LinhaDoCadastro | null> {
  const { data, error } = await cliente.from(TABELA).select(COLUNAS).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`linha ilegível (${error.code ?? "sem_codigo"})`);
  return (data as LinhaDoCadastro | null) ?? null;
}

/** O cadastro pelo Google não passa pelo `signUp`: a linha nasce aqui, sem IP, navegador nem cookies. */
async function garantirLinha(cliente: SupabaseClient, userId: string): Promise<LinhaDoCadastro | null> {
  const existente = await linhaDoUsuario(cliente, userId);
  if (existente) return existente;
  const { error } = await cliente.from(TABELA).upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) throw new Error(`linha não gravou (${error.code ?? "sem_codigo"})`);
  return linhaDoUsuario(cliente, userId);
}

async function emailDoUsuario(cliente: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data } = await cliente.auth.admin.getUserById(userId);
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

/** O lead que faltou no envio (sem a variável, sem a fonte, recusa): refeito com o que a linha guardou. */
async function garantirLeadDaLinha(
  cliente: SupabaseClient,
  linha: LinhaDoCadastro,
  empresa: EmpresaDoCliente,
  deps: DependenciasDoLeadDoCadastro,
): Promise<{ ok: true; leadId: string; organizationId: string } | { ok: false; motivo: MotivoSemLead }> {
  if (linha.lead_id && linha.organization_id) return { ok: true, leadId: linha.lead_id, organizationId: linha.organization_id };
  const email = await emailDoUsuario(cliente, linha.user_id);
  if (!email) {
    await marcar(cliente, linha.id, { crm_erro: "falhou" });
    return { ok: false, motivo: "falhou" };
  }
  const guardada = (linha.origem ?? {}) as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === "string" ? v : null);
  return enviarELigar(
    cliente,
    linha.id,
    {
      userId: linha.user_id,
      email,
      empresa: empresa.nome,
      plano: texto(guardada.plano),
      cupom: texto(guardada.cupom),
      // Os utm_* e o fbclid moram em `origem`; os ids de clique do Google, nas colunas.
      origem: origemSaneada({ ...guardada, gclid: linha.gclid, gbraid: linha.gbraid, wbraid: linha.wbraid }),
      fbp: linha.fbp,
      fbc: linha.fbc,
      consentimento: linha.consentimento,
    },
    deps,
    null,
  );
}

/**
 * A empresa do cadastro nasceu (o e-mail foi confirmado, ou o pedido aprovado):
 * o card vai a "Cadastro concluído" e, se nasceu no teste, a "Em teste". Nunca
 * lança; `pendente` é o que a rodada tenta de novo.
 */
export async function aoNascerAEmpresa(
  cliente: SupabaseClient,
  orgId: string,
  deps: DependenciasDoLeadDoCadastro = {},
): Promise<ResultadoDoNascimento> {
  try {
    const empresa = await lerEmpresa(cliente, orgId);
    if (!empresa) return { status: "fora", motivo: "sem_empresa" };
    // A origem é relida AGORA: o MCP de implantação grava `implantacao` depois do insert.
    const { data: origem } = await cliente.from("mia_origem_da_empresa").select("origem").eq("organization_id", orgId).maybeSingle();
    if ((origem as { origem?: string } | null)?.origem !== "cadastro") return { status: "fora", motivo: "implantacao" };
    if (empresa.demonstracao) return { status: "fora", motivo: "demonstracao" };
    if (!empresa.criadaPor) return { status: "fora", motivo: "sem_dono" };
    const assinatura = await lerAssinatura(cliente, orgId);
    if (!assinatura) return { status: "fora", motivo: "isenta" };

    const linha = await garantirLinha(cliente, empresa.criadaPor);
    if (!linha) return { status: "pendente", motivo: "linha" };
    // Uma empresa por cadastro: a primeira que a pessoa abriu é a do lead.
    if (linha.empresa_cliente_id && linha.empresa_cliente_id !== orgId) return { status: "fora", motivo: "sem_empresa" };
    if (!linha.empresa_cliente_id) {
      const ok = await marcar(cliente, linha.id, { empresa_cliente_id: orgId });
      if (!ok) return { status: "pendente", motivo: "linha" };
    }

    const lead = await garantirLeadDaLinha(cliente, linha, empresa, deps);
    if (!lead.ok) return { status: "pendente", motivo: lead.motivo };
    const fonteId = idDaFonte(VARIAVEL_DA_FONTE, deps);
    if (!fonteId) return { status: "pendente", motivo: "sem_fonte" };
    const alvo = { orgId: lead.organizationId, leadId: lead.leadId, fonteId };
    const p = await portas(cliente, deps);
    const momentos: string[] = [];

    if (!linha.cadastro_concluido_em) {
      const movido = await moverPara(cliente, alvo, ETAPAS_DO_CADASTRO.cadastroConcluido, p);
      if (!movido.ok) {
        await marcar(cliente, linha.id, { crm_erro: movido.erro });
        return { status: "pendente", motivo: movido.erro };
      }
      await marcar(cliente, linha.id, { cadastro_concluido_em: agoraDe(deps).toISOString(), crm_erro: null });
      await notar(cliente, alvo, "Cadastro concluído: o e-mail foi confirmado e a empresa nasceu na MIA.", orgId);
      momentos.push("cadastro_concluido");
    }

    if (!linha.teste_comecou_em && nasceuNoTeste(assinatura, agoraDe(deps))) {
      const movido = await moverPara(cliente, alvo, ETAPAS_DO_CADASTRO.emTeste, p);
      if (!movido.ok) {
        await marcar(cliente, linha.id, { crm_erro: movido.erro });
        return { status: "pendente", motivo: movido.erro };
      }
      await marcar(cliente, linha.id, { teste_comecou_em: agoraDe(deps).toISOString(), crm_erro: null });
      const ate = assinatura.trial_ate ? ` até ${assinatura.trial_ate.slice(0, 10)}` : "";
      await notar(cliente, alvo, `Em teste: a empresa começou o teste grátis${ate}.`, orgId);
      momentos.push("teste_comecou");
    }
    return { status: "ok", momentos };
  } catch (erro) {
    logger.warn("[cadastro-na-time] o nascimento da empresa não andou no funil", { orgId, detail: erro instanceof Error ? erro.message : "erro" });
    return { status: "pendente", motivo: "falhou" };
  }
}

// ─── 4. O primeiro pagamento ────────────────────────────────────────────────

/** O primeiro pagamento confirmado no Asaas: a cobrança da entrada paga, senão a primeira paga da assinatura. */
export async function primeiroPagamento(
  cliente: SupabaseClient,
  orgId: string,
  assinatura: AssinaturaDaEmpresa | null,
  deps: DependenciasDoLeadDoCadastro = {},
): Promise<{ ref: string; valorCents: number } | null> {
  const asaas = asaasDaMia(deps.asaas);
  const { data: inicial } = await cliente.from("mia_pagamento_inicial").select("pagamento_ref").eq("organization_id", orgId).maybeSingle();
  const ref = (inicial as { pagamento_ref?: string | null } | null)?.pagamento_ref ?? null;
  if (ref) {
    const c = await asaas.lerCobranca(ref);
    if (c.situacao === "paga" && c.valorCents > 0) return { ref: c.ref, valorCents: c.valorCents };
  }
  if (assinatura?.provedor === "asaas" && assinatura.provedor_assinatura_id) {
    const pagas = (await asaas.listarCobrancasDaAssinatura(assinatura.provedor_assinatura_id))
      .filter((c) => c.situacao === "paga" && c.valorCents > 0)
      .sort((a, b) => (a.pagaEm ?? a.vencimento).localeCompare(b.pagaEm ?? b.vencimento));
    if (pagas[0]) return { ref: pagas[0].ref, valorCents: pagas[0].valorCents };
  }
  return null;
}

export type ResultadoDoPagamento =
  | { status: "ok"; valorCents: number }
  | { status: "ja_informado" }
  | { status: "fora"; motivo: string }
  | { status: "pendente"; motivo: string };

/** Só lê o Asaas quando a assinatura pode ter pago (evita uma chamada por aviso de toda empresa). */
function podeTerPago(a: AssinaturaDaEmpresa | null): boolean {
  if (!a) return false;
  if (a.estado === "ativa" || a.estado === "em_atraso") return true;
  return Boolean(a.provedor_assinatura_id);
}

/**
 * O primeiro pagamento da empresa do cadastro: o valor vai ao negócio (BRL) e o
 * card a "Assinante". Idempotente por `pagamento_confirmado_em`. Sem conseguir
 * ler o valor, não marca (a rodada tenta de novo): nunca vai a Assinante sem
 * valor. Nunca lança.
 */
export async function informarPagamentoATime(
  cliente: SupabaseClient,
  orgId: string,
  deps: DependenciasDoLeadDoCadastro = {},
): Promise<ResultadoDoPagamento> {
  try {
    const { data, error } = await cliente.from(TABELA).select(COLUNAS).eq("empresa_cliente_id", orgId).maybeSingle();
    if (error) return { status: "pendente", motivo: "linha" };
    // Sem linha: não é empresa do cadastro (ou o nascimento ainda não passou; a rodada cura).
    if (!data) return { status: "fora", motivo: "sem_cadastro" };
    let linha = data as LinhaDoCadastro;
    if (linha.pagamento_confirmado_em) return { status: "ja_informado" };

    const assinatura = await lerAssinatura(cliente, orgId);
    if (!podeTerPago(assinatura)) return { status: "fora", motivo: "sem_pagamento" };

    // O pagamento chegou antes do consumidor do nascimento: os momentos anteriores primeiro.
    if (!linha.cadastro_concluido_em || !linha.lead_id) {
      const nasc = await aoNascerAEmpresa(cliente, orgId, deps);
      if (nasc.status !== "ok") return nasc.status === "fora" ? { status: "fora", motivo: nasc.motivo } : { status: "pendente", motivo: nasc.motivo };
      const relida = await linhaDoUsuario(cliente, linha.user_id);
      if (!relida?.lead_id || !relida.organization_id) return { status: "pendente", motivo: "sem_lead" };
      linha = relida;
    }
    const fonteId = idDaFonte(VARIAVEL_DA_FONTE, deps);
    if (!fonteId || !linha.lead_id || !linha.organization_id) return { status: "pendente", motivo: "sem_fonte" };
    const org = await orgDaFonte(cliente, VARIAVEL_DA_FONTE, deps);
    if (!org.ok) {
      await marcar(cliente, linha.id, { crm_erro: org.motivo });
      return { status: "pendente", motivo: org.motivo };
    }

    let pago: { ref: string; valorCents: number } | null = null;
    try {
      pago = await primeiroPagamento(cliente, orgId, assinatura, deps);
    } catch (erro) {
      logger.warn("[cadastro-na-time] o valor do pagamento não foi lido", { orgId, detail: erro instanceof Error ? erro.message : "erro" });
      return { status: "pendente", motivo: "valor_ilegivel" };
    }
    if (!pago) return { status: "pendente", motivo: "sem_valor" };

    const alvo = { orgId: linha.organization_id, leadId: linha.lead_id, fonteId };
    const p = await portas(cliente, deps);
    // O valor ANTES de mover: quem escuta a chegada em "Assinante" já lê o negócio com ele.
    try {
      await p.valor(alvo.orgId, fonteId, alvo.leadId, pago.valorCents);
    } catch (erro) {
      logger.warn("[cadastro-na-time] o valor do negócio não gravou", { leadId: alvo.leadId, detail: erro instanceof Error ? erro.message : "erro" });
      await marcar(cliente, linha.id, { crm_erro: "falhou" });
      return { status: "pendente", motivo: "falhou" };
    }
    // O pedido e o valor gravados antes do movimento (o motor de conversões lê o `pedido_id`).
    await marcar(cliente, linha.id, { pedido_id: pago.ref.slice(0, 100), valor_cents: pago.valorCents });
    const movido = await moverPara(cliente, alvo, ETAPAS_DO_CADASTRO.assinante, p);
    if (!movido.ok) {
      await marcar(cliente, linha.id, { crm_erro: movido.erro });
      return { status: "pendente", motivo: movido.erro };
    }
    await marcar(cliente, linha.id, { pagamento_confirmado_em: agoraDe(deps).toISOString(), crm_erro: null });
    const reais = (pago.valorCents / 100).toFixed(2).replace(".", ",");
    await notar(cliente, alvo, `Assinante: o primeiro pagamento foi confirmado (R$ ${reais}).`, orgId);
    return { status: "ok", valorCents: pago.valorCents };
  } catch (erro) {
    logger.warn("[cadastro-na-time] o pagamento não andou no funil", { orgId, detail: erro instanceof Error ? erro.message : "erro" });
    return { status: "pendente", motivo: "falhou" };
  }
}

// ─── A rodada (cura e limpeza) ──────────────────────────────────────────────

export interface ResumoDoCadastroNaTime {
  nascimentosCurados: number;
  pagamentosInformados: number;
  limpas: number;
}

/**
 * Na rodada horária da jornada (`lib/planos-mia/rodada.ts`): cura o nascimento
 * cujo evento se perdeu (e o cadastro pelo Google), informa o pagamento cujo
 * aviso se perdeu e roda a limpeza da LGPD. Nunca lança.
 */
export async function rodadaDoCadastroNaTime(
  cliente: SupabaseClient,
  agora: Date = new Date(),
  deps: DependenciasDoLeadDoCadastro = {},
): Promise<ResumoDoCadastroNaTime> {
  const resumo: ResumoDoCadastroNaTime = { nascimentosCurados: 0, pagamentosInformados: 0, limpas: 0 };
  const d = { ...deps, agora: deps.agora ?? (() => agora) };
  try {
    // A limpeza não depende da fonte: é a primeira, e sempre roda.
    const { data: limpas, error: erroDaLimpeza } = await cliente.rpc("fn_mia_cadastro_na_time_limpar");
    if (erroDaLimpeza) logger.warn("[cadastro-na-time] a limpeza falhou", { codigo: erroDaLimpeza.code ?? "sem_codigo" });
    else resumo.limpas = typeof limpas === "number" ? limpas : 0;

    if (!idDaFonte(VARIAVEL_DA_FONTE, d)) return resumo;
    const semana = new Date(agora.getTime() - 7 * 86_400_000).toISOString();

    // As empresas do cadastro dos últimos 7 dias sem "Cadastro concluído".
    const { data: nascidas } = await cliente
      .from("mia_origem_da_empresa")
      .select("organization_id")
      .eq("origem", "cadastro")
      .gte("registrada_em", semana)
      .limit(200);
    const ids = ((nascidas ?? []) as Array<{ organization_id: string }>).map((n) => n.organization_id);
    if (ids.length > 0) {
      const { data: feitas } = await cliente.from(TABELA).select("empresa_cliente_id").in("empresa_cliente_id", ids).not("cadastro_concluido_em", "is", null);
      const prontas = new Set(((feitas ?? []) as Array<{ empresa_cliente_id: string }>).map((f) => f.empresa_cliente_id));
      for (const id of ids.filter((i) => !prontas.has(i)).slice(0, 50)) {
        const r = await aoNascerAEmpresa(cliente, id, d);
        if (r.status === "ok" && r.momentos.length > 0) resumo.nascimentosCurados++;
      }
    }

    // O primeiro pagamento ainda não informado, dentro da janela da linha.
    const { data: abertas } = await cliente
      .from(TABELA)
      .select("empresa_cliente_id")
      .not("empresa_cliente_id", "is", null)
      .not("lead_id", "is", null)
      .is("pagamento_confirmado_em", null)
      .gt("guardar_ate", agora.toISOString())
      .order("capturado_em", { ascending: false })
      .limit(50);
    for (const a of (abertas ?? []) as Array<{ empresa_cliente_id: string }>) {
      const r = await informarPagamentoATime(cliente, a.empresa_cliente_id, d);
      if (r.status === "ok") resumo.pagamentosInformados++;
    }
  } catch (erro) {
    logger.warn("[cadastro-na-time] a rodada falhou", { detail: erro instanceof Error ? erro.message : "erro" });
  }
  return resumo;
}

// ─── A leitura do MCP ───────────────────────────────────────────────────────

export interface LeadNaTime {
  configurado: boolean;
  lead_id: string | null;
  organization_id: string | null;
  erro: string | null;
  cadastro_em: string;
  cadastro_concluido_em: string | null;
  teste_comecou_em: string | null;
  pagamento_confirmado_em: string | null;
  valor: number | null;
  moeda: "BRL" | null;
}

export function leadNaTimeParaOMcp(linha: LinhaDoCadastro | null, configurado: boolean): LeadNaTime | null {
  if (!linha) return null;
  return {
    configurado,
    lead_id: linha.lead_id,
    organization_id: linha.organization_id,
    erro: linha.crm_erro,
    cadastro_em: linha.capturado_em,
    cadastro_concluido_em: linha.cadastro_concluido_em,
    teste_comecou_em: linha.teste_comecou_em,
    pagamento_confirmado_em: linha.pagamento_confirmado_em,
    valor: linha.valor_cents === null ? null : linha.valor_cents / 100,
    moeda: linha.valor_cents === null ? null : "BRL",
  };
}

/** O lead na Time da empresa do cliente (`plataforma_ver_assinatura`). Nunca lança. */
export async function lerLeadNaTimeDaEmpresa(cliente: SupabaseClient, orgId: string): Promise<LeadNaTime | null> {
  try {
    const { data } = await cliente.from(TABELA).select(COLUNAS).eq("empresa_cliente_id", orgId).maybeSingle();
    return leadNaTimeParaOMcp((data as LinhaDoCadastro | null) ?? null, idDaFonte(VARIAVEL_DA_FONTE) !== null);
  } catch {
    return null;
  }
}

/** O lead na Time de cada conta (`plataforma_listar_pedidos_de_cadastro`). Nunca lança. */
export async function lerLeadsNaTimeDosUsuarios(cliente: SupabaseClient, userIds: readonly string[]): Promise<Map<string, LeadNaTime>> {
  const mapa = new Map<string, LeadNaTime>();
  if (userIds.length === 0) return mapa;
  try {
    const configurado = idDaFonte(VARIAVEL_DA_FONTE) !== null;
    const { data } = await cliente.from(TABELA).select(COLUNAS).in("user_id", [...userIds]);
    for (const l of (data ?? []) as LinhaDoCadastro[]) {
      const lido = leadNaTimeParaOMcp(l, configurado);
      if (lido) mapa.set(l.user_id, lido);
    }
  } catch {
    // sem a leitura, os pedidos aparecem sem o lead
  }
  return mapa;
}

/** Os últimos cadastros sem lead ou com erro (o painel do MCP). Só ids, datas e o erro. Nunca lança. */
export async function lerCadastrosComErro(cliente: SupabaseClient, limite = 20): Promise<{ configurado: boolean; cadastros: Array<LeadNaTime & { empresa_cliente_id: string | null }> }> {
  const configurado = idDaFonte(VARIAVEL_DA_FONTE) !== null;
  try {
    const { data } = await cliente
      .from(TABELA)
      .select(COLUNAS)
      .not("crm_erro", "is", null)
      .order("capturado_em", { ascending: false })
      .limit(limite);
    return {
      configurado,
      cadastros: ((data ?? []) as LinhaDoCadastro[]).map((l) => ({ ...leadNaTimeParaOMcp(l, configurado)!, empresa_cliente_id: l.empresa_cliente_id })),
    };
  } catch {
    return { configurado, cadastros: [] };
  }
}
