/**
 * FORK MIA (.89) — AS LEITURAS do disparo de e-mail, num lugar só.
 *
 * A tela, as rotas, o worker e o MCP de plataforma leem a configuração, o
 * domínio, os remetentes, o preço e a supressão por aqui: quatro cópias da
 * mesma leitura divergiriam no dia em que uma aprendesse o padrão novo.
 *
 * Quem chama passa o cliente de serviço (`createAdminClient`) DEPOIS de conferir
 * papel e empresa: toda consulta filtra `organization_id` explicitamente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { remetenteDaOrganizacaoDeSettings } from "@/lib/email/remetente-da-organizacao";
import { configuracaoDaAmazon, type ConfiguracaoDaAmazon } from "@/lib/email/ses";
import { moduloLiberado } from "@/lib/modulos/liberacao";
import { fusoUtilizavel } from "@/lib/tempo/fusos";

import { rodapeCompleto, type RodapeDoEmail } from "./blocos";
import {
  dominioVerificado,
  registrosQueFaltam,
  type IdDoRegistro,
  type SituacaoDosRegistros,
} from "./dominio";
import type { MotivoDaSupressao } from "./elegibilidade";
import {
  CONFIGURACAO_PADRAO,
  MODULO_EMAIL_MARKETING,
  PRECO_PADRAO_POR_EMAIL_CENTS,
} from "./regras";

type Db = Pick<SupabaseClient, "from" | "rpc">;

export interface EmpresaDoEmail {
  id: string;
  nome: string;
  razaoSocial: string;
  cnpj: string | null;
  fuso: string;
  privacidadeUrl: string | null;
  demonstracao: boolean;
  status: string;
  settings: Record<string, unknown>;
}

export async function lerEmpresa(db: Db, orgId: string): Promise<EmpresaDoEmail> {
  const { data, error } = await db
    .from("organizations")
    .select(
      "id, display_name, legal_name, cnpj, timezone, privacy_policy_url, demonstracao, status, settings",
    )
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw new Error(`não consegui ler a empresa: ${error.message}`);
  if (!data) throw new Error("empresa não encontrada");
  const o = data as Record<string, unknown>;
  const nomeDaOrg = typeof o.display_name === "string" ? o.display_name : "";
  return {
    id: String(o.id),
    nome: nomeDaOrg,
    razaoSocial: String(o.legal_name ?? ""),
    cnpj: (o.cnpj as string | null) ?? null,
    fuso: fusoUtilizavel(o.timezone as string | null),
    privacidadeUrl: (o.privacy_policy_url as string | null) ?? null,
    demonstracao: o.demonstracao === true,
    status: String(o.status ?? "active"),
    settings: (o.settings && typeof o.settings === "object" ? o.settings : {}) as Record<
      string,
      unknown
    >,
  };
}

export interface ConfiguracaoDoEmail {
  /** Há linha gravada? Sem ela valem os padrões abaixo. */
  gravada: boolean;
  responderPara: string | null;
  rodape: {
    razaoSocial: string;
    cnpj: string;
    endereco: string;
    motivo: string;
    privacidadeUrl: string;
    usarPrivacidadePadrao: boolean;
  };
  ritmoPorHora: number;
  janelaInicio: number;
  janelaFim: number;
  soDiasUteis: boolean;
}

/**
 * A configuração com os padrões já aplicados: o "responder para" vem da marca da
 * empresa (upstream v1.88, #3287), a razão social, o CNPJ e a política de
 * privacidade vêm do cadastro da empresa. O que a empresa gravou vence.
 */
export async function lerConfiguracao(
  db: Db,
  empresa: EmpresaDoEmail,
): Promise<ConfiguracaoDoEmail> {
  const { data, error } = await db
    .from("mia_email_config")
    .select("*")
    .eq("organization_id", empresa.id)
    .maybeSingle();
  if (error) throw new Error(`não consegui ler a configuração do e-mail: ${error.message}`);
  const c = (data ?? null) as Record<string, unknown> | null;
  const daMarca = remetenteDaOrganizacaoDeSettings(empresa.settings);
  const texto = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    gravada: !!c,
    responderPara: (c?.responder_para as string | null) ?? daMarca.replyTo ?? null,
    rodape: {
      razaoSocial: texto(c?.rodape_razao_social) || empresa.razaoSocial,
      cnpj: texto(c?.rodape_cnpj) || empresa.cnpj || "",
      endereco: texto(c?.rodape_endereco),
      motivo: texto(c?.rodape_motivo),
      privacidadeUrl: texto(c?.rodape_privacidade_url) || empresa.privacidadeUrl || "",
      usarPrivacidadePadrao: c?.rodape_usar_privacidade_padrao === true,
    },
    ritmoPorHora: Number(c?.ritmo_por_hora ?? CONFIGURACAO_PADRAO.ritmoPorHora),
    janelaInicio: Number(c?.janela_inicio ?? CONFIGURACAO_PADRAO.janelaInicio),
    janelaFim: Number(c?.janela_fim ?? CONFIGURACAO_PADRAO.janelaFim),
    soDiasUteis: c ? c.so_dias_uteis !== false : CONFIGURACAO_PADRAO.soDiasUteis,
  };
}

/**
 * O rodapé que sai no e-mail. Sem página própria e com o texto padrão adotado,
 * a privacidade aponta para a página de preferências (`linkDaPrivacidadePadrao`).
 */
export function rodapeDoEnvio(
  config: ConfiguracaoDoEmail,
  linkDaPrivacidadePadrao: string | null,
): RodapeDoEmail {
  const r = config.rodape;
  return {
    razaoSocial: r.razaoSocial,
    cnpj: r.cnpj,
    endereco: r.endereco,
    motivo: r.motivo,
    privacidadeUrl: r.privacidadeUrl || (r.usarPrivacidadePadrao ? linkDaPrivacidadePadrao : null),
  };
}

export function rodapeDaConfiguracaoCompleto(config: ConfiguracaoDoEmail): boolean {
  return rodapeCompleto(rodapeDoEnvio(config, "https://padrao.invalid/privacidade"));
}

export interface DominioDoEmail {
  id: string;
  dominio: string;
  subdominioDeRetorno: string;
  regiao: string;
  dkimTokens: string[];
  registros: SituacaoDosRegistros;
  verificado: boolean;
  faltam: IdDoRegistro[];
  verificadoEm: string | null;
  conferidoEm: string | null;
  erro: string | null;
  identidadeCriadaEm: string | null;
  degrau: number;
  ultimoDiaDeEnvio: string | null;
}

export async function lerDominio(db: Db, orgId: string): Promise<DominioDoEmail | null> {
  const { data, error } = await db
    .from("mia_email_dominios")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`não consegui ler o domínio: ${error.message}`);
  if (!data) return null;
  const d = data as Record<string, unknown>;
  const registros = (
    d.registros && typeof d.registros === "object" ? d.registros : {}
  ) as SituacaoDosRegistros;
  return {
    id: String(d.id),
    dominio: String(d.dominio),
    subdominioDeRetorno: String(d.subdominio_de_retorno ?? "envio"),
    regiao: String(d.regiao ?? "sa-east-1"),
    dkimTokens: Array.isArray(d.dkim_tokens) ? (d.dkim_tokens as string[]) : [],
    registros,
    verificado: dominioVerificado(registros) && !!d.verificado_em,
    faltam: registrosQueFaltam(registros),
    verificadoEm: (d.verificado_em as string | null) ?? null,
    conferidoEm: (d.conferido_em as string | null) ?? null,
    erro: (d.erro_da_conferencia as string | null) ?? null,
    identidadeCriadaEm: (d.identidade_criada_em as string | null) ?? null,
    degrau: Number(d.aquecimento_degrau ?? 0),
    ultimoDiaDeEnvio: (d.aquecimento_ultimo_dia as string | null) ?? null,
  };
}

export interface RemetenteDoEmail {
  id: string;
  nome: string;
  local: string;
  padrao: boolean;
}

export async function lerRemetentes(db: Db, orgId: string): Promise<RemetenteDoEmail[]> {
  const { data, error } = await db
    .from("mia_email_remetentes")
    .select("id, nome_exibicao, local, padrao, arquivado_em, created_at")
    .eq("organization_id", orgId)
    .is("arquivado_em", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`não consegui ler os remetentes: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    nome: String(r.nome_exibicao),
    local: String(r.local),
    padrao: r.padrao === true,
  }));
}

/** O preço por e-mail desta empresa, em centavos. Sem preço gravado, o padrão (R$ 0,02). */
export async function lerPrecoPorEmail(
  db: Db,
  orgId: string,
): Promise<{ cents: number; padrao: boolean }> {
  const { data, error } = await db
    .from("tenant_broadcast_pricing")
    .select("preco_por_email_cents")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`não consegui ler o preço por e-mail: ${error.message}`);
  const v = (data as { preco_por_email_cents?: number | null } | null)?.preco_por_email_cents;
  return v === null || v === undefined
    ? { cents: PRECO_PADRAO_POR_EMAIL_CENTS, padrao: true }
    : { cents: Number(v), padrao: false };
}

/** Todas as supressões de e-mail da empresa: hash → motivo. Paginado (sem teto de 1000). */
export async function lerSupressoesDeEmail(
  db: Db,
  orgId: string,
): Promise<Map<string, MotivoDaSupressao>> {
  const mapa = new Map<string, MotivoDaSupressao>();
  let cursor: string | null = null;
  for (let guarda = 0; guarda < 500; guarda += 1) {
    let consulta = db
      .from("campaign_suppressions")
      .select("id, recipient_address_hash, motivo")
      .eq("organization_id", orgId)
      .eq("tipo_de_endereco", "email")
      .order("id", { ascending: true })
      .limit(1000);
    if (cursor) consulta = consulta.gt("id", cursor);
    const { data, error } = await consulta;
    if (error) throw new Error(`não consegui ler a lista de supressão: ${error.message}`);
    const linhas = (data ?? []) as Array<{
      id: string;
      recipient_address_hash: string;
      motivo: string | null;
    }>;
    if (linhas.length === 0) break;
    for (const l of linhas)
      mapa.set(l.recipient_address_hash, (l.motivo as MotivoDaSupressao | null) ?? "manual");
    cursor = linhas[linhas.length - 1]!.id;
  }
  return mapa;
}

export interface EstadoDoModulo {
  contratado: boolean;
  amazon: ConfiguracaoDaAmazon;
  dominio: DominioDoEmail | null;
  remetentePadrao: RemetenteDoEmail | null;
  rodapeCompleto: boolean;
  /** Tudo pronto para uma campanha sair (a campanha ainda confere o resto). */
  prontoParaEnviar: boolean;
  /** O que falta, em frases (a tela e o MCP mostram). */
  pendencias: string[];
}

export async function estadoDoModulo(db: Db, orgId: string): Promise<EstadoDoModulo> {
  const empresa = await lerEmpresa(db, orgId);
  const [contratado, dominio, remetentes, config] = await Promise.all([
    moduloLiberado(db as SupabaseClient, orgId, MODULO_EMAIL_MARKETING),
    lerDominio(db, orgId),
    lerRemetentes(db, orgId),
    lerConfiguracao(db, empresa),
  ]);
  const amazon = configuracaoDaAmazon();
  const remetentePadrao = remetentes.find((r) => r.padrao) ?? remetentes[0] ?? null;
  const rodapeOk = rodapeDaConfiguracaoCompleto(config);
  const pendencias: string[] = [];
  if (!contratado)
    pendencias.push("O módulo de e-mail marketing não está contratado para esta empresa.");
  if (!amazon.configurado)
    pendencias.push(`Falta configurar a Amazon no servidor: ${amazon.falta.join(", ")}.`);
  if (!dominio) pendencias.push("Falta cadastrar o domínio do remetente.");
  else if (!dominio.verificado)
    pendencias.push(`O domínio ${dominio.dominio} ainda não está verificado.`);
  if (!remetentePadrao) pendencias.push("Falta cadastrar um remetente.");
  if (!rodapeOk)
    pendencias.push(
      "O rodapé está incompleto (razão social, CNPJ, endereço, motivo e privacidade).",
    );
  return {
    contratado,
    amazon,
    dominio,
    remetentePadrao,
    rodapeCompleto: rodapeOk,
    prontoParaEnviar: pendencias.length === 0,
    pendencias,
  };
}
