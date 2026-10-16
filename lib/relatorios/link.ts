/**
 * FORK MIA (9042) — O PAINEL DO USUÁRIO NO LINK DO DONO.
 *
 * "Gerar link para o dono" no painel do montador (protótipo, tela 5) usa o
 * molde da 9031 inteiro (token derivado, hash no banco, validade, revogação,
 * contador sem identificar quem abre). O que muda é o que a página mostra: os
 * relatórios DESTE painel, na ordem e no tamanho dele, calculados com o
 * cliente de serviço e a organização DA LINHA DO LINK.
 *
 * Decisão do protótipo ("O que fica para depois"): relatório por responsável
 * fica fora do link, porque identifica pessoas da equipe. Aqui, fica fora todo
 * relatório que AGRUPA ou FILTRA por pessoa (responsável, profissional, quem
 * marcou, quem atendeu): o filtro "só a Larissa" identifica a Larissa tanto
 * quanto o agrupamento. A página diz quantos ficaram de fora, sem dizer quais.
 *
 * Só números somados: a página não oferece a lista por trás do número.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PeriodoDosPaineis } from "@/lib/paineis/catalogo";
import type { RespostaDoMotor } from "@/lib/paineis/motor";

import { modeloDoGrafico, type ModeloDoGrafico } from "./apresentar";
import type { Tamanho, Visualizacao } from "./catalogo";
import { configDaLinha, identificaPessoa, visualizacaoQueVale, type ConfigDoRelatorio } from "./config";
import { nomeDoPronto, relatorioPronto } from "./prontos";
import { calcularRelatorio, funisDosRelatorios, lerPainel, type Painel } from "./servidor";

export interface ItemDoLink {
  id: string;
  titulo: string;
  /** O título é rótulo do produto (um pronto): a página traduz. */
  traduzir: boolean;
  tamanho: Tamanho;
  vis: Visualizacao;
  modelo: ModeloDoGrafico | null;
  erro: boolean;
}

export interface PainelDoLink {
  nome: string;
  itens: ItemDoLink[];
  /** Quantos relatórios do painel ficaram fora por identificarem pessoa da equipe. */
  deFora: number;
  calculadoEm: string;
}

/** As configurações dos itens de um painel, com o título de cada um. */
export async function configsDoPainel(
  db: SupabaseClient,
  organizationId: string,
  painel: Painel,
  compromissos: string | null | undefined,
): Promise<Array<{ itemId: string; titulo: string; traduzir: boolean; config: ConfigDoRelatorio; tamanho: Tamanho; periodoProprio: boolean } | null>> {
  const ids = painel.itens.map((i) => i.relatorioId).filter((x): x is string => Boolean(x));
  const salvos = new Map<string, { nome: string; config: ConfigDoRelatorio }>();
  if (ids.length > 0) {
    const { data } = await db
      .from("mia_relatorios")
      .select("id, nome, fonte, medida, dim1, dim2, filtros, periodo, de, ate, comparar, visualizacao")
      .eq("organization_id", organizationId)
      .in("id", ids);
    for (const l of (data ?? []) as Array<Record<string, unknown>>) {
      salvos.set(l.id as string, { nome: l.nome as string, config: configDaLinha(l as never) });
    }
  }
  return painel.itens.map((i) => {
    if (i.pronto) {
      const p = relatorioPronto(i.pronto);
      if (!p) return null;
      const comPalavra = p.chave === "agenda" && Boolean(compromissos);
      return {
        itemId: i.id,
        titulo: nomeDoPronto(p, compromissos, (s) => s),
        traduzir: !comPalavra,
        config: p.config,
        tamanho: i.tamanho,
        periodoProprio: i.periodoProprio,
      };
    }
    const r = i.relatorioId ? salvos.get(i.relatorioId) : undefined;
    return r ? { itemId: i.id, titulo: r.nome, traduzir: false, config: r.config, tamanho: i.tamanho, periodoProprio: i.periodoProprio } : null;
  });
}

/**
 * O painel do link, calculado. `admin` é o cliente de serviço; a organização
 * vem da linha do link (`resolverLink`), nunca da URL.
 */
export async function calcularPainelDoDono(
  admin: SupabaseClient,
  opcoes: { organizationId: string; painelId: string; periodo: PeriodoDosPaineis; valores: boolean },
): Promise<PainelDoLink | null> {
  const painel = await lerPainel(admin, opcoes.organizationId, opcoes.painelId);
  if (!painel) return null;
  const { padrao } = await funisDosRelatorios(admin, opcoes.organizationId);
  const configs = await configsDoPainel(admin, opcoes.organizationId, painel, padrao?.compromissos);
  let deFora = 0;
  const vivos = configs.filter((c): c is NonNullable<typeof c> => {
    if (!c) return false;
    if (identificaPessoa(c.config)) {
      deFora++;
      return false;
    }
    return true;
  });
  const itens = await Promise.all(
    vivos.map(async (c): Promise<ItemDoLink> => {
      try {
        const calc = await calcularRelatorio(admin, null, {
          organizationId: opcoes.organizationId,
          config: c.config,
          valores: opcoes.valores,
          funilPadrao: padrao,
          periodo: c.periodoProprio ? null : opcoes.periodo,
        });
        const resposta: RespostaDoMotor = calc.resposta;
        return {
          id: c.itemId,
          titulo: c.titulo,
          traduzir: c.traduzir,
          tamanho: c.tamanho,
          vis: visualizacaoQueVale(calc.config, resposta),
          modelo: modeloDoGrafico(resposta, calc.config.medida, {}),
          erro: false,
        };
      } catch {
        return { id: c.itemId, titulo: c.titulo, traduzir: c.traduzir, tamanho: c.tamanho, vis: "barras", modelo: null, erro: true };
      }
    }),
  );
  return { nome: painel.nome, itens, deFora, calculadoEm: new Date().toISOString() };
}
