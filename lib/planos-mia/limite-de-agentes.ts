/**
 * FORK MIA (MIA-250 D) — O PLANO DIZ QUANTOS AGENTES DE IA A EMPRESA CRIA.
 * Desenho na MIA-258; docs/fork/jornada-de-assinatura.md.
 *
 * Quem RECUSA é o banco: `trg_mia_trava_agentes_do_plano` (migration 9174)
 * levanta SQLSTATE `PT402` com a mensagem `limite_do_plano:agentes:<teto>`, a
 * mesma forma dos gatilhos de pessoas e números do upstream. Assim pega todo
 * caminho que cria agente, inclusive o SQL cru de `create-draft.ts` e qualquer
 * um que o upstream trouxer. Este módulo só TRADUZ a recusa (409
 * `plan_limit_reached` com a frase que diz o número e o caminho) e MEDE o uso
 * para a troca e a atribuição de plano.
 *
 * ⚠️ A leitura é pela MENSAGEM, e não pelo SQLSTATE, pela mesma razão de
 * `lib/cobranca/limites.ts`: o código não sobrevive a todos os caminhos (o `pg`
 * do `create-draft.ts`, a mensagem repassada por `duplicate.ts`).
 *
 * O teto vem do PLANO (`mia_plano_modulos.max_agentes`), nunca do código. Nulo
 * em todo plano = nada muda para ninguém.
 *
 * `lib/cobranca/limites.ts` e `fn_limite_do_plano` são do upstream e não mudam.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

const LIMITE_DE_AGENTES = /limite_do_plano:agentes:(\d+)/;

/** O teto que o gatilho recusou, lido da mensagem (ou do texto). `null` = não é esta recusa. */
export function lerLimiteDeAgentesEstourado(erro: unknown): number | null {
  const texto =
    typeof erro === "string" ? erro : (erro as { message?: unknown } | null | undefined)?.message;
  const achado = typeof texto === "string" ? LIMITE_DE_AGENTES.exec(texto) : null;
  return achado ? Number(achado[1]) : null;
}

/** As frases do cliente (seção 8 do desenho). PROPOSTA até a MIA-249 ligar um teto. */
export const FRASE_DO_LIMITE_DE_AGENTES = {
  um: "Seu plano permite 1 agente de IA e ele já foi criado. Arquive um agente em Agentes de IA ou troque de plano em Configurações › Plano e cobrança.",
  varios:
    "Seu plano permite {n} agentes de IA e todos já foram criados. Arquive um agente em Agentes de IA ou troque de plano em Configurações › Plano e cobrança.",
} as const;

export function mensagemDoLimiteDeAgentes(limite: number, idioma: Idioma): string {
  const frase = limite === 1 ? FRASE_DO_LIMITE_DE_AGENTES.um : FRASE_DO_LIMITE_DE_AGENTES.varios;
  return traduzir(frase, idioma).replace("{n}", String(limite));
}

export interface LimiteDeAgentesTraduzido {
  code: "plan_limit_reached";
  message: string;
  details: { recurso: "agentes"; limite: number };
}

/** A recusa do gatilho em 409 `plan_limit_reached`; `null` quando o erro é outro. */
export function traduzirLimiteDeAgentes(erro: unknown, idioma: Idioma): LimiteDeAgentesTraduzido | null {
  const limite = lerLimiteDeAgentesEstourado(erro);
  if (limite === null) return null;
  return {
    code: "plan_limit_reached",
    message: mensagemDoLimiteDeAgentes(limite, idioma),
    details: { recurso: "agentes", limite },
  };
}

/**
 * A recusa que ENSINA, para o MCP de plataforma (`plataforma_garantir_agente`).
 * Quem lê é quem implanta: diz o que não aconteceu e os três caminhos.
 */
export function recusaDoLimiteDeAgentesNoMcp(limite: number): string {
  const quantos =
    limite === 1
      ? "O plano da empresa permite 1 agente de IA e ele já foi criado."
      : `O plano da empresa permite ${limite} agentes de IA e todos já foram criados.`;
  return (
    `${quantos} Nada foi criado. Arquive um agente pela tela Agentes de IA da empresa, ` +
    "aumente o teto do plano em plataforma_garantir_planos (campo agentes) ou troque o plano da empresa."
  );
}

/**
 * Os agentes que OCUPAM vaga: a MESMA régua do gatilho (todo agente não
 * arquivado, de qualquer tipo e estado; versão e roteador são outras tabelas).
 * `limite-de-agentes.test.ts` confere os dois lados. LANÇA na falha.
 */
export async function lerAgentesEmUso(db: SupabaseClient, organizationId: string): Promise<number> {
  const { count, error } = await db
    .from("ai_agents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("archived_at", null);
  if (error) throw new Error(`agentes em uso: leitura falhou (${error.code ?? "sem_codigo"})`);
  return count ?? 0;
}

/** O teto de UM plano (a troca mede contra o plano escolhido). `null` = sem limite. LANÇA na falha. */
export async function lerLimiteDeAgentes(db: SupabaseClient, planoId: string): Promise<number | null> {
  const { data, error } = await db
    .from("mia_plano_modulos")
    .select("max_agentes")
    .eq("plano_id", planoId)
    .maybeSingle();
  if (error) throw new Error(`teto de agentes: leitura falhou (${error.code ?? "sem_codigo"})`);
  const v = (data as { max_agentes?: number | string | null } | null)?.max_agentes;
  return v === null || v === undefined ? null : Number(v);
}

/**
 * O teto que VALE para a empresa agora (`fn_mia_limite_de_agentes`): nulo com a
 * cobrança desligada, na isenta, no plano sem linha nossa ou sem teto. LANÇA.
 */
export async function lerLimiteDeAgentesDaEmpresa(
  db: SupabaseClient,
  organizationId: string,
): Promise<number | null> {
  const { data, error } = await db.rpc("fn_mia_limite_de_agentes", { p_org: organizationId });
  if (error) throw new Error(`fn_mia_limite_de_agentes: ${error.code ?? "sem_sqlstate"} ${error.message}`);
  return typeof data === "number" ? data : data === null || data === undefined ? null : Number(data);
}

/** Quantos passam do teto. 0 = cabe. `null` no teto = sem limite. Puro. */
export function excedenteDeAgentes(emUso: number, limite: number | null): number {
  return limite !== null && emUso > limite ? emUso - limite : 0;
}

/**
 * O excedente de agentes da empresa contra um PLANO (troca e atribuição), no
 * formato do `excedenteDoPlano` do upstream: `{ agentes: n }` só quando passa;
 * `{}` quando cabe ou o plano não tem teto (aí nem conta). LANÇA na falha.
 */
export async function excedenteDeAgentesNoPlano(
  db: SupabaseClient,
  organizationId: string,
  planoId: string,
): Promise<{ agentes?: number }> {
  const limite = await lerLimiteDeAgentes(db, planoId);
  if (limite === null) return {};
  const x = excedenteDeAgentes(await lerAgentesEmUso(db, organizationId), limite);
  return x > 0 ? { agentes: x } : {};
}

/**
 * A linha "Agentes de IA: X de N" do painel Plano e cobrança. `null` quando a
 * empresa não tem teto (cobrança desligada, isenta, plano sem teto): aí a linha
 * NÃO aparece, de propósito, até a MIA-249 fechar o texto. Leitura que falha
 * também devolve `null`: a linha some, o painel não cai.
 */
export async function agentesDoPainel(
  db: SupabaseClient,
  organizationId: string,
): Promise<{ emUso: number; limite: number } | null> {
  try {
    const limite = await lerLimiteDeAgentesDaEmpresa(db, organizationId);
    if (limite === null) return null;
    return { emUso: await lerAgentesEmUso(db, organizationId), limite };
  } catch {
    return null;
  }
}

/**
 * O retrato para `plataforma_ver_agentes`: quantos ocupam vaga e o teto do plano
 * (`null` = sem limite). Leitura que falha não derruba a dos agentes: diz que não leu.
 */
export async function retratoDoLimiteDeAgentes(
  db: SupabaseClient,
  organizationId: string,
): Promise<{ em_uso: number; limite_do_plano: number | null } | { nao_lido: string }> {
  try {
    const [emUso, limite] = await Promise.all([
      lerAgentesEmUso(db, organizationId),
      lerLimiteDeAgentesDaEmpresa(db, organizationId),
    ]);
    return { em_uso: emUso, limite_do_plano: limite };
  } catch (e) {
    return { nao_lido: e instanceof Error ? e.message : "erro desconhecido" };
  }
}
