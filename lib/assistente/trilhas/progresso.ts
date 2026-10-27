/**
 * FORK MIA (.93) — O PROGRESSO DE CADA PESSOA NAS TRILHAS (9090), pela sessão.
 *
 * A rota passa o cliente da SESSÃO: a RLS da 9090 deixa a pessoa ler e gravar
 * só a própria linha, e o gatilho `fn_mia_trilha_da_pessoa` põe a hora do banco
 * em `comecou_em` (o "desde" das conferências) e cuida de `lembrada_em`.
 *
 * ⚠️ "Feita" só é gravada DEPOIS que a leitura do sistema conferiu
 * (`conferirPasso` e `conferirObjetivo`): quem chama não marca feita por conta
 * própria. É a regra "nada conta pelo clique em concluir".
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { encaixar, leiturasDaConferencia, TRILHAS, type IdDaTrilha, type Trilha } from "./catalogo";
import {
  configDasTrilhasDaLinha,
  progressoDaLinha,
  type ConfigDasTrilhas,
  type ProgressoDaTrilha,
} from "./estado";
import { lerDoSistema, type ResultadoDaLeitura } from "./leituras";

type Db = Pick<SupabaseClient, "from">;

const COLUNAS = "trilha, situacao, passo, passo_max, comecou_em, pausou_em, feita_em, vezes";

export async function lerConfigDasTrilhas(db: Db, organizationId: string): Promise<ConfigDasTrilhas> {
  const { data, error } = await db
    .from("mia_assistente_trilhas_config")
    .select("me_mostra_como, desligadas, recomendada")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) return configDasTrilhasDaLinha(null);
  return configDasTrilhasDaLinha(data as Record<string, unknown> | null);
}

/** O progresso da pessoa (as linhas dela). */
export async function lerProgressoDaPessoa(db: Db, organizationId: string, userId: string): Promise<ProgressoDaTrilha[]> {
  const { data, error } = await db
    .from("mia_assistente_trilhas")
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .limit(100);
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map(progressoDaLinha)
    .filter((p): p is ProgressoDaTrilha => p !== null);
}

/**
 * As trilhas da EMPRESA que o sistema mostra feitas agora, venha de quem vier.
 * Só as que a empresa vê (as desligadas não são lidas).
 */
export async function trilhasFeitasNaEmpresa(
  db: Db,
  ctx: { organizationId: string; userId: string; desligadas?: readonly IdDaTrilha[] },
): Promise<Set<IdDaTrilha>> {
  const daEmpresa = TRILHAS.filter((t) => t.daEmpresa && !(ctx.desligadas ?? []).includes(t.id));
  const lidas = await Promise.all(
    daEmpresa.map(async (t) => [t.id, (await lerDoSistema(db, t.feita, { ...ctx, desde: null })).ok] as const),
  );
  return new Set(lidas.filter(([, ok]) => ok).map(([id]) => id));
}

async function linhaDaPessoa(db: Db, organizationId: string, userId: string, trilha: IdDaTrilha): Promise<ProgressoDaTrilha | null> {
  const { data, error } = await db
    .from("mia_assistente_trilhas")
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("trilha", trilha)
    .maybeSingle();
  if (error) throw new Error(`não consegui ler a trilha: ${error.message}`);
  return data ? progressoDaLinha(data as Record<string, unknown>) : null;
}

async function gravar(
  db: Db,
  ctx: { organizationId: string; userId: string; trilha: IdDaTrilha },
  mudanca: Record<string, unknown>,
): Promise<ProgressoDaTrilha> {
  const { data, error } = await db
    .from("mia_assistente_trilhas")
    .update(mudanca)
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", ctx.userId)
    .eq("trilha", ctx.trilha)
    .select(COLUNAS)
    .maybeSingle();
  if (error) throw new Error(`não consegui gravar a trilha: ${error.message}`);
  const p = data ? progressoDaLinha(data as Record<string, unknown>) : null;
  if (!p) throw new Error("não consegui gravar a trilha");
  return p;
}

const ultimoPasso = (t: Trilha) => t.passos.length - 1;
const noLimite = (t: Trilha, passo: number) => Math.min(Math.max(0, Math.trunc(passo)), ultimoPasso(t));

/**
 * Começa (ou retoma) a trilha. Retomar mantém o passo de onde parou; começar de
 * novo (`deNovo`, ou a trilha já feita) volta ao passo 0 e conta mais uma vez,
 * e o banco renova o "desde".
 */
export async function comecarTrilha(
  db: Db,
  ctx: { organizationId: string; userId: string; trilha: Trilha; deNovo?: boolean },
): Promise<ProgressoDaTrilha> {
  const chave = { organizationId: ctx.organizationId, userId: ctx.userId, trilha: ctx.trilha.id };
  const atual = await linhaDaPessoa(db, ctx.organizationId, ctx.userId, ctx.trilha.id);
  if (!atual) {
    const { data, error } = await db
      .from("mia_assistente_trilhas")
      .insert({ organization_id: ctx.organizationId, user_id: ctx.userId, trilha: ctx.trilha.id, situacao: "andando", passo: 0, passo_max: 0 })
      .select(COLUNAS)
      .single();
    if (error) throw new Error(`não consegui começar a trilha: ${error.message}`);
    const p = progressoDaLinha(data as Record<string, unknown>);
    if (!p) throw new Error("não consegui começar a trilha");
    return p;
  }
  if (ctx.deNovo || atual.situacao === "feita") {
    return gravar(db, chave, { situacao: "andando", passo: 0, pausou_em: null, feita_em: null, vezes: atual.vezes + 1 });
  }
  return gravar(db, chave, { situacao: "andando", passo: noLimite(ctx.trilha, atual.passo), pausou_em: null });
}

/** O passo em que a pessoa está agora (e o mais longe a que chegou). */
export async function avancarTrilha(
  db: Db,
  ctx: { organizationId: string; userId: string; trilha: Trilha; passo: number },
): Promise<ProgressoDaTrilha> {
  const atual = await linhaDaPessoa(db, ctx.organizationId, ctx.userId, ctx.trilha.id);
  if (!atual) return comecarTrilha(db, ctx);
  if (atual.situacao === "feita") return atual;
  const passo = noLimite(ctx.trilha, ctx.passo);
  return gravar(
    db,
    { organizationId: ctx.organizationId, userId: ctx.userId, trilha: ctx.trilha.id },
    { situacao: "andando", passo, passo_max: Math.max(atual.passo_max, passo), pausou_em: null },
  );
}

export async function pausarTrilha(
  db: Db,
  ctx: { organizationId: string; userId: string; trilha: Trilha; passo: number },
): Promise<ProgressoDaTrilha | null> {
  const atual = await linhaDaPessoa(db, ctx.organizationId, ctx.userId, ctx.trilha.id);
  if (!atual || atual.situacao === "feita") return atual;
  const passo = noLimite(ctx.trilha, ctx.passo);
  return gravar(
    db,
    { organizationId: ctx.organizationId, userId: ctx.userId, trilha: ctx.trilha.id },
    { situacao: "pausada", passo, passo_max: Math.max(atual.passo_max, passo), pausou_em: new Date().toISOString() },
  );
}

/** Soma 1 na contagem de um passo (`perguntas_no_passo` ou `ja_fiz_sem_conferir`). Só número. */
export async function contarNoPasso(
  db: Db,
  ctx: { organizationId: string; userId: string; trilha: Trilha; passo: number; coluna: "perguntas_no_passo" | "ja_fiz_sem_conferir" },
): Promise<void> {
  const { data } = await db
    .from("mia_assistente_trilhas")
    .select(ctx.coluna)
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", ctx.userId)
    .eq("trilha", ctx.trilha.id)
    .maybeSingle();
  if (!data) return;
  const atual = ((data as Record<string, unknown>)[ctx.coluna] ?? {}) as Record<string, unknown>;
  const chave = String(noLimite(ctx.trilha, ctx.passo));
  const contagem: Record<string, number> = {};
  for (const [k, v] of Object.entries(atual)) if (/^\d{1,2}$/.test(k) && Number.isFinite(Number(v))) contagem[k] = Number(v);
  contagem[chave] = Math.min((contagem[chave] ?? 0) + 1, 100_000);
  await db
    .from("mia_assistente_trilhas")
    .update({ [ctx.coluna]: contagem })
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", ctx.userId)
    .eq("trilha", ctx.trilha.id);
}

export interface Conferido {
  ok: boolean;
  vars: Record<string, string>;
  ids: Record<string, string>;
  /** A trilha ficou feita com esta conferência. */
  feita: boolean;
  /** A frase do fim, já com os nomes. */
  fim: string | null;
  progresso: ProgressoDaTrilha | null;
}

function juntar(lidas: readonly ResultadoDaLeitura[]): { ok: boolean; vars: Record<string, string>; ids: Record<string, string> } {
  const certa = lidas.find((l) => l.ok);
  return {
    ok: Boolean(certa),
    vars: Object.assign({}, ...lidas.filter((l) => l.ok).map((l) => l.vars ?? {})),
    ids: Object.assign({}, ...lidas.filter((l) => l.ok).map((l) => l.ids ?? {})),
  };
}

async function marcarFeita(db: Db, ctx: { organizationId: string; userId: string; trilha: Trilha }): Promise<ProgressoDaTrilha> {
  const atual = await linhaDaPessoa(db, ctx.organizationId, ctx.userId, ctx.trilha.id);
  if (!atual) await comecarTrilha(db, ctx);
  return gravar(
    db,
    { organizationId: ctx.organizationId, userId: ctx.userId, trilha: ctx.trilha.id },
    { situacao: "feita", passo: ultimoPasso(ctx.trilha), passo_max: ultimoPasso(ctx.trilha), feita_em: new Date().toISOString(), pausou_em: null },
  );
}

/**
 * Confere as leituras do sistema de UM passo. Se for o último passo, ou se a
 * leitura do objetivo estiver entre elas e conferiu, a trilha fica feita.
 */
export async function conferirPasso(
  db: Db,
  ctx: { organizationId: string; userId: string; trilha: Trilha; passo: number },
): Promise<Conferido> {
  const passo = noLimite(ctx.trilha, ctx.passo);
  const leituras = leiturasDaConferencia(ctx.trilha.passos[passo]!.conferencia);
  const atual = await linhaDaPessoa(db, ctx.organizationId, ctx.userId, ctx.trilha.id);
  const desde = atual?.comecou_em ?? null;
  const lidas = await Promise.all(leituras.map((l) => lerDoSistema(db, l, { organizationId: ctx.organizationId, userId: ctx.userId, desde })));
  const r = juntar(lidas);
  const objetivoConferido = leituras.some((l, i) => l === ctx.trilha.feita && lidas[i]?.ok);
  if (r.ok && (passo === ultimoPasso(ctx.trilha) || objetivoConferido)) {
    const progresso = await marcarFeita(db, ctx);
    return { ...r, feita: true, fim: encaixar(ctx.trilha.fim, r.vars), progresso };
  }
  return { ...r, feita: false, fim: null, progresso: atual };
}

/**
 * "Já fiz por outro caminho": confere o OBJETIVO no sistema. As da empresa olham
 * o estado de agora; as da pessoa, o que apareceu depois que ela começou. Não
 * conferiu: conta no passo (a Time vê onde o "já fiz" não bate).
 */
export async function conferirObjetivo(
  db: Db,
  ctx: { organizationId: string; userId: string; trilha: Trilha; passo: number },
): Promise<Conferido> {
  const atual = await linhaDaPessoa(db, ctx.organizationId, ctx.userId, ctx.trilha.id);
  const desde = ctx.trilha.daEmpresa ? null : (atual?.comecou_em ?? null);
  const lido = await lerDoSistema(db, ctx.trilha.feita, { organizationId: ctx.organizationId, userId: ctx.userId, desde });
  if (lido.ok) {
    const progresso = await marcarFeita(db, ctx);
    return { ok: true, vars: lido.vars ?? {}, ids: lido.ids ?? {}, feita: true, fim: encaixar(ctx.trilha.fim, lido.vars), progresso };
  }
  if (atual) await contarNoPasso(db, { ...ctx, coluna: "ja_fiz_sem_conferir" }).catch(() => undefined);
  return { ok: false, vars: {}, ids: {}, feita: false, fim: null, progresso: atual };
}

/**
 * O "Me mostra como" da empresa (`plataforma_configurar_assistente`). Sem valor
 * no pedido, só lê. Grava só a coluna dele: as trilhas desligadas e a
 * recomendada (de `plataforma_configurar_trilhas`) ficam como estão.
 */
export async function definirMeMostraComo(
  db: Pick<SupabaseClient, "from">,
  entrada: { organizationId: string; valor: unknown; autorUserId: string },
): Promise<{ antes: boolean; depois: boolean }> {
  const antes = (await lerConfigDasTrilhas(db, entrada.organizationId)).meMostraComo;
  if (typeof entrada.valor !== "boolean") return { antes, depois: antes };
  const { error } = await db.from("mia_assistente_trilhas_config").upsert(
    {
      organization_id: entrada.organizationId,
      me_mostra_como: entrada.valor,
      updated_by: entrada.autorUserId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  if (error) throw new Error(`não consegui gravar o "Me mostra como": ${error.message}`);
  return { antes, depois: entrada.valor };
}

/** Pausada há mais disto, sem voltar, conta como abandonada (a mesma régua do painel da Time). */
const DIAS_PARA_ABANDONO = 7;

/**
 * As trilhas de uma empresa em números (`plataforma_ver_assistente`): começadas,
 * feitas, pausadas e abandonadas, no total e por trilha. Sem nome de ninguém.
 */
export async function resumoDasTrilhasDaEmpresa(
  db: Pick<SupabaseClient, "from">,
  organizationId: string,
  agora: Date,
): Promise<{
  comecadas: number;
  feitas: number;
  pausadas: number;
  abandonadas: number;
  por_trilha: Array<{ id: IdDaTrilha; titulo: string; comecaram: number; feitas: number; pausadas: number; abandonadas: number }>;
}> {
  const { data, error } = await db
    .from("mia_assistente_trilhas")
    .select("trilha, situacao, pausou_em")
    .eq("organization_id", organizationId)
    .limit(5000);
  if (error) throw new Error(`não consegui ler as trilhas: ${error.message}`);
  const linhas = (data ?? []) as Array<{ trilha: string; situacao: string; pausou_em: string | null }>;
  const limite = agora.getTime() - DIAS_PARA_ABANDONO * 86_400_000;
  const abandonada = (l: { situacao: string; pausou_em: string | null }) =>
    l.situacao === "pausada" && Boolean(l.pausou_em) && new Date(l.pausou_em!).getTime() < limite;
  const porTrilha = TRILHAS.map((t) => {
    const daTrilha = linhas.filter((l) => l.trilha === t.id);
    return {
      id: t.id,
      titulo: t.titulo,
      comecaram: daTrilha.length,
      feitas: daTrilha.filter((l) => l.situacao === "feita").length,
      pausadas: daTrilha.filter((l) => l.situacao === "pausada").length,
      abandonadas: daTrilha.filter(abandonada).length,
    };
  }).filter((t) => t.comecaram > 0);
  return {
    comecadas: linhas.length,
    feitas: linhas.filter((l) => l.situacao === "feita").length,
    pausadas: linhas.filter((l) => l.situacao === "pausada").length,
    abandonadas: linhas.filter(abandonada).length,
    por_trilha: porTrilha,
  };
}
