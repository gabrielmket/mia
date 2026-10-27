/**
 * FORK MIA (.90) — os planos com o que é NOSSO ao lado: os módulos, o preço por
 * mensagem do Broadcast, o preço por e-mail (.95, 9110) e o texto do cartão
 * (`mia_plano_modulos`, 9070).
 *
 * `cobranca_planos` é do upstream e não muda; esta leitura junta as duas tabelas
 * pelo id. Plano sem linha nossa é plano sem módulo (e sem preço por mensagem):
 * é o que acontece com o plano criado só pela aba Planos do upstream.
 *
 * Servidor: as duas tabelas são só do `service_role`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ehModuloDoPlano, slugDoPlano, type ModuloDoPlano } from "./catalogo";

export interface PlanoComModulos {
  id: string;
  nome: string;
  /** O "?plano=" do link do cadastro (derivado do nome). */
  slug: string;
  preco_cents: number;
  intervalo: string;
  trial_dias: number;
  max_assentos: number | null;
  max_canais: number | null;
  teto_ia_usd_cents: number | null;
  padrao_no_cadastro: boolean;
  oferecido_ao_cliente: boolean;
  arquivado_em: string | null;
  modulos: ModuloDoPlano[];
  preco_por_mensagem_cents: number | null;
  /** FORK MIA (.95): o preço por e-mail de marketing. `null` = o plano não diz (vale o padrão). */
  preco_por_email_cents: number | null;
  frase: string | null;
  destaque: boolean;
}

interface PlanoDoUpstream {
  id: string;
  nome: string;
  preco_cents: number;
  intervalo: string;
  trial_dias: number;
  max_assentos: number | null;
  max_canais: number | null;
  teto_ia_usd_cents: number | null;
  padrao_no_cadastro: boolean;
  oferecido_ao_cliente: boolean;
  arquivado_em: string | null;
}

export interface LadoDoPlano {
  plano_id: string;
  modulos: string[] | null;
  preco_por_mensagem_cents: number | null;
  /** FORK MIA (.95, 9110). Opcional: a linha montada antes dela (e nos dublês) não o traz. */
  preco_por_email_cents?: number | null;
  frase: string | null;
  destaque: boolean | null;
}

/** As colunas da linha nossa (`mia_plano_modulos`). */
const COLUNAS_DO_LADO =
  "plano_id, modulos, preco_por_mensagem_cents, preco_por_email_cents, frase, destaque";

const COLUNAS_DO_UPSTREAM =
  "id, nome, preco_cents, intervalo, trial_dias, max_assentos, max_canais, teto_ia_usd_cents, padrao_no_cadastro, oferecido_ao_cliente, arquivado_em";

/** Junta uma linha do upstream com a nossa (pura; exportada para os testes). */
export function juntarPlano(p: PlanoDoUpstream, lado: LadoDoPlano | undefined): PlanoComModulos {
  return {
    id: p.id,
    nome: p.nome,
    slug: slugDoPlano(p.nome),
    preco_cents: Number(p.preco_cents),
    intervalo: p.intervalo,
    trial_dias: Number(p.trial_dias),
    max_assentos: p.max_assentos,
    max_canais: p.max_canais,
    teto_ia_usd_cents: p.teto_ia_usd_cents,
    padrao_no_cadastro: p.padrao_no_cadastro === true,
    oferecido_ao_cliente: p.oferecido_ao_cliente !== false,
    arquivado_em: p.arquivado_em,
    modulos: (lado?.modulos ?? []).filter(ehModuloDoPlano),
    preco_por_mensagem_cents:
      lado?.preco_por_mensagem_cents === null || lado?.preco_por_mensagem_cents === undefined
        ? null
        : Number(lado.preco_por_mensagem_cents),
    preco_por_email_cents:
      lado?.preco_por_email_cents === null || lado?.preco_por_email_cents === undefined
        ? null
        : Number(lado.preco_por_email_cents),
    frase: lado?.frase ?? null,
    destaque: lado?.destaque === true,
  };
}

/**
 * Todos os planos da instalação, com os módulos. LANÇA se a leitura falha:
 * quem chama decide uma ação (a página de preços, o cadastro, o MCP) e não pode
 * afirmar "nenhum plano" de um banco que não respondeu.
 */
export async function lerPlanosComModulos(admin: SupabaseClient): Promise<PlanoComModulos[]> {
  const [planos, lados] = await Promise.all([
    admin
      .from("cobranca_planos")
      .select(COLUNAS_DO_UPSTREAM)
      .order("preco_cents", { ascending: true }),
    admin
      .from("mia_plano_modulos")
      .select(COLUNAS_DO_LADO),
  ]);
  if (planos.error)
    throw new Error(`planos: leitura falhou (${planos.error.code ?? "sem_codigo"})`);
  if (lados.error)
    throw new Error(`módulos dos planos: leitura falhou (${lados.error.code ?? "sem_codigo"})`);
  const porPlano = new Map(((lados.data ?? []) as LadoDoPlano[]).map((l) => [l.plano_id, l]));
  return ((planos.data ?? []) as PlanoDoUpstream[]).map((p) => juntarPlano(p, porPlano.get(p.id)));
}

/** Os planos que a empresa escolhe sozinha: ativos e oferecidos (o escondido fica de fora). */
export function planosOferecidos(planos: readonly PlanoComModulos[]): PlanoComModulos[] {
  return planos.filter((p) => p.arquivado_em === null && p.oferecido_ao_cliente);
}

/**
 * O plano do "?plano=" do link: pelo id ou pelo slug do nome, só entre os
 * oferecidos (o escondido não se escolhe por link). Dois oferecidos com o mesmo
 * nome: o de menor preço, a mesma ordem da página. `null` = não achou, e o
 * cadastro fica no padrão.
 */
export function planoDoLink(
  planos: readonly PlanoComModulos[],
  valor: string | null | undefined,
): PlanoComModulos | null {
  const v = (valor ?? "").trim();
  if (!v || v.length > 80) return null;
  const ofertados = planosOferecidos(planos);
  return (
    ofertados.find((p) => p.id === v) ?? ofertados.find((p) => p.slug === slugDoPlano(v)) ?? null
  );
}

/** A linha nossa de um plano. `null` = o plano não tem linha (nenhum módulo). LANÇA na falha. */
export async function lerLadoDoPlano(
  admin: SupabaseClient,
  planoId: string,
): Promise<LadoDoPlano | null> {
  const { data, error } = await admin
    .from("mia_plano_modulos")
    .select(COLUNAS_DO_LADO)
    .eq("plano_id", planoId)
    .maybeSingle();
  if (error) throw new Error(`módulos do plano: leitura falhou (${error.code ?? "sem_codigo"})`);
  return (data as LadoDoPlano | null) ?? null;
}
