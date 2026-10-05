/**
 * FORK MIA — OBRIGAÇÕES · quem TRANSFORMA DATA EM ACONTECIMENTO.
 *
 * Um documento vencer não é evento de ninguém: a data mora no item e o dia em
 * que ela chega passa em silêncio. Quem percebe é o relógio, na varredura
 * `app/api/v1/cron/obrigacoes-avisos` (de hora em hora; age na empresa cujo
 * relógio de parede marca 9h, como a varredura de data do funil do upstream).
 * O que este módulo faz é DIZER ao motor de automações que aconteceu; o que
 * fazer com isso é da regra que a empresa configurou.
 *
 * ── As quatro garantias ───────────────────────────────────────────────────
 *
 * 1. SÓ QUEM PEDIU. A varredura começa pelas REGRAS ativas dos gatilhos de
 *    obrigação: empresa sem regra não é varrida.
 * 2. UMA VEZ POR ITEM E CICLO. A trava é a linha de `mia_obrigacoes_avisos`
 *    (regra + item + gatilho + ciclo + data medida), gravada na mesma transação
 *    do evento (`fn_mia_obrigacao_disparar`). Renovou o documento, o ciclo sobe
 *    e o aviso volta a valer; corrigiu a data, vale para a data nova.
 * 3. NADA DO PASSADO. O disparo só sai se o dia dele não é anterior ao dia em
 *    que o item passou a existir (`sem_aviso_antes_de`) nem ao dia em que a
 *    regra foi ligada ou mudada. Planilha migrada e regra ligada hoje não
 *    mandam aviso atrasado.
 * 4. "NÃO ENVIADO" ESPERA A CONFIRMAÇÃO. Se o cliente já mandou um arquivo e a
 *    proposta do agente espera uma pessoa, a trava nasce SEGURADA, sem evento.
 *    Recusada a proposta, o aviso sai na rodada seguinte; recebido o documento,
 *    a linha segurada é descartada.
 *
 * O evento é DIRIGIDO a uma regra (`rule_id` no payload): duas regras do mesmo
 * gatilho com X diferentes (30 e 7 dias antes) não disparam juntas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { eHoraDaVarredura, fusoDaOrganizacao, TAMANHO_DO_LOTE, TETO_POR_ORGANIZACAO } from "@/lib/automation/cron-de-data";
import { logger } from "@/lib/logger";
import { ehOperante } from "@/lib/organizacao/operante";

import { diaNoFuso, somarDias, type Dia } from "./datas";
import {
  GATILHO_DOCUMENTO_NAO_ENVIADO,
  GATILHO_DOCUMENTO_RECEBIDO,
  GATILHO_DOCUMENTO_VENCENDO,
  GATILHO_DOCUMENTO_VENCIDO,
  GATILHOS_DO_RELOGIO,
  TOLERANCIA_EM_DIAS,
  configDoGatilhoDeObrigacao,
  disparoDoRelogio,
  passaNoFiltroDeTipo,
  venceNaJanela,
  type ConfigDoGatilhoDeObrigacao,
  type GatilhoDeObrigacao,
} from "./gatilhos";
import { aguardando } from "./situacao";
import { COLUNAS_DA_OBRIGACAO, type Obrigacao } from "./tipos";

type Admin = SupabaseClient;

interface RegraDeObrigacao {
  id: string;
  organization_id: string;
  trigger_event: string;
  trigger_config: unknown;
  updated_at: string | null;
}

function payloadDo(item: Obrigacao, gatilho: GatilhoDeObrigacao, config: ConfigDoGatilhoDeObrigacao, ancora: Dia, hoje: Dia) {
  return {
    gatilho,
    dias: config.dias,
    ciclo: item.ciclo,
    ancora,
    local_date: hoje,
    nome: item.nome,
    categoria: item.categoria,
    lead_id: item.lead_id,
    empresa_id: item.empresa_id,
    contact_id: item.contact_id,
  };
}

async function disparar(
  admin: Admin,
  alvo: { org: string; item: Obrigacao; regraId: string; gatilho: GatilhoDeObrigacao; ancora: Dia; payload: Record<string, unknown>; segurar?: boolean },
): Promise<{ evento: string | null; erro: string | null }> {
  const { data, error } = await admin.rpc("fn_mia_obrigacao_disparar", {
    p_organization_id: alvo.org,
    p_obrigacao: alvo.item.id,
    p_regra: alvo.regraId,
    p_gatilho: alvo.gatilho,
    p_ciclo: alvo.item.ciclo,
    p_ancora: alvo.ancora,
    p_payload: alvo.payload,
    p_segurar: alvo.segurar === true,
  });
  if (error) return { evento: null, erro: error.message };
  return { evento: typeof data === "string" ? data : null, erro: null };
}

/**
 * "Documento recebido": avisa as regras ativas da empresa que este documento
 * chegou. Chamado pela rota depois que uma PESSOA marcou recebido ou confirmou
 * a proposta do agente. A importação pelo MCP não chama: dado migrado não acorda
 * automação.
 *
 * Devolve quantas regras foram avisadas. Falha de leitura vira zero e log: o
 * recebimento já foi gravado, e o aviso é o acessório.
 */
export async function avisarDocumentoRecebido(admin: Admin, org: string, item: Obrigacao, hoje: Dia): Promise<number> {
  const { data: regras, error } = await admin
    .from("automation_rules")
    .select("id, organization_id, trigger_event, trigger_config, updated_at")
    .eq("organization_id", org)
    .eq("trigger_event", GATILHO_DOCUMENTO_RECEBIDO)
    .eq("is_active", true);
  if (error) {
    logger.warn("[obrigacoes] regras de documento recebido não lidas", { organization_id: org, error: error.message });
    return 0;
  }
  let avisadas = 0;
  for (const regra of (regras ?? []) as RegraDeObrigacao[]) {
    const config = configDoGatilhoDeObrigacao(GATILHO_DOCUMENTO_RECEBIDO, regra.trigger_config);
    if (!config || !passaNoFiltroDeTipo(item, config.tipo)) continue;
    const ancora = item.recebido_em ?? hoje;
    const r = await disparar(admin, {
      org,
      item,
      regraId: regra.id,
      gatilho: GATILHO_DOCUMENTO_RECEBIDO,
      ancora,
      payload: payloadDo(item, GATILHO_DOCUMENTO_RECEBIDO, config, ancora, hoje),
    });
    if (r.erro) {
      logger.warn("[obrigacoes] aviso de documento recebido não emitido", { organization_id: org, rule_id: regra.id, error: r.erro });
      continue;
    }
    if (r.evento) avisadas += 1;
  }
  return avisadas;
}

/** A coluna de data que cada gatilho do relógio mede, e a faixa que a rodada de hoje alcança. */
function faixaDoGatilho(gatilho: GatilhoDeObrigacao, dias: number, hoje: Dia): { coluna: string; de: Dia; ate: Dia; categoria: "documento" | "atividade" } {
  if (gatilho === GATILHO_DOCUMENTO_VENCENDO) {
    return { coluna: "valido_ate", de: somarDias(hoje, dias - TOLERANCIA_EM_DIAS), ate: somarDias(hoje, dias), categoria: "documento" };
  }
  if (gatilho === GATILHO_DOCUMENTO_VENCIDO) {
    return { coluna: "valido_ate", de: somarDias(hoje, -1 - TOLERANCIA_EM_DIAS), ate: somarDias(hoje, -1), categoria: "documento" };
  }
  if (gatilho === GATILHO_DOCUMENTO_NAO_ENVIADO) {
    return { coluna: "pedido_em", de: somarDias(hoje, -dias - TOLERANCIA_EM_DIAS), ate: somarDias(hoje, -dias), categoria: "documento" };
  }
  return { coluna: "proxima_em", de: somarDias(hoje, dias - TOLERANCIA_EM_DIAS), ate: somarDias(hoje, dias), categoria: "atividade" };
}

async function idsComPropostaPendente(admin: Admin, org: string, ids: readonly string[]): Promise<Set<string>> {
  const pendentes = new Set<string>();
  for (let i = 0; i < ids.length; i += TAMANHO_DO_LOTE) {
    const { data } = await admin
      .from("mia_obrigacoes_propostas")
      .select("obrigacao_id")
      .eq("organization_id", org)
      .eq("situacao", "pendente")
      .in("obrigacao_id", ids.slice(i, i + TAMANHO_DO_LOTE));
    for (const linha of (data ?? []) as Array<{ obrigacao_id: string }>) pendentes.add(linha.obrigacao_id);
  }
  return pendentes;
}

export interface ResultadoDaVarredura {
  organizacoes: number;
  regras: number;
  examinados: number;
  emitidos: number;
  segurados: number;
  pulados: Record<string, number>;
}

export interface OpcoesDaVarredura {
  /** Só para teste e para a simulação: ignora a hora marcada. */
  aQualquerHora?: boolean;
}

/**
 * A rodada da varredura. Devolve as contagens; quem audita é a rota, e só
 * quando houve efeito.
 */
export async function varrerAvisosDeObrigacao(admin: Admin, agora: Date, opcoes: OpcoesDaVarredura = {}): Promise<ResultadoDaVarredura> {
  const resultado: ResultadoDaVarredura = { organizacoes: 0, regras: 0, examinados: 0, emitidos: 0, segurados: 0, pulados: {} };
  const pular = (motivo: string, quantos = 1) => {
    resultado.pulados[motivo] = (resultado.pulados[motivo] ?? 0) + quantos;
  };

  const { data: regras, error: erroRegras } = await admin
    .from("automation_rules")
    .select("id, organization_id, trigger_event, trigger_config, updated_at")
    .in("trigger_event", [...GATILHOS_DO_RELOGIO])
    .eq("is_active", true);
  if (erroRegras) throw new Error(`consulta de regras falhou: ${erroRegras.message}`);
  const todas = (regras ?? []) as RegraDeObrigacao[];
  resultado.regras = todas.length;
  if (todas.length === 0) return resultado;

  const orgIds = [...new Set(todas.map((r) => r.organization_id))];
  const organizacoes: Array<{ id: string; timezone: string | null; status: string | null }> = [];
  for (let i = 0; i < orgIds.length; i += TAMANHO_DO_LOTE) {
    const { data } = await admin
      .from("organizations")
      .select("id, timezone, status")
      .in("id", orgIds.slice(i, i + TAMANHO_DO_LOTE));
    organizacoes.push(...((data ?? []) as typeof organizacoes));
  }

  for (const organizacao of organizacoes) {
    // Empresa parada (suspensa, redigida, arquivada) não recebe aviso: ninguém
    // atenderia a resposta. A régua é a do upstream (1.70, lib/organizacao/operante.ts).
    if (!ehOperante(organizacao.status)) {
      pular("organizacao_parada");
      continue;
    }
    const org = organizacao.id;
    const fuso = fusoDaOrganizacao(organizacao.timezone);
    let hoje: Dia;
    try {
      // `eHoraDaVarredura` lança em fuso inexistente, de propósito: uma empresa
      // com o campo digitado errado não derruba a varredura das outras.
      if (!opcoes.aQualquerHora && !eHoraDaVarredura(agora, fuso)) continue;
      hoje = diaNoFuso(agora, fuso);
    } catch {
      pular("fuso_invalido");
      continue;
    }
    resultado.organizacoes += 1;

    for (const regra of todas) {
      if (regra.organization_id !== org) continue;
      const gatilho = regra.trigger_event as GatilhoDeObrigacao;
      const config = configDoGatilhoDeObrigacao(gatilho, regra.trigger_config);
      if (!config) {
        pular("config_invalida");
        continue;
      }
      const diaDaRegra = regra.updated_at ? diaNoFuso(new Date(regra.updated_at), fuso) : null;
      const faixa = faixaDoGatilho(gatilho, config.dias ?? 0, hoje);

      const { data: candidatos, error } = await admin
        .from("mia_obrigacoes")
        .select(COLUNAS_DA_OBRIGACAO)
        .eq("organization_id", org)
        .eq("categoria", faixa.categoria)
        .is("arquivado_em", null)
        .gte(faixa.coluna, faixa.de)
        .lte(faixa.coluna, faixa.ate)
        .order(faixa.coluna, { ascending: true })
        .limit(TETO_POR_ORGANIZACAO);
      if (error) {
        logger.error("[obrigacoes-avisos] consulta de itens falhou", { organization_id: org, rule_id: regra.id, error: error.message });
        pular("consulta_falhou");
        continue;
      }

      const naJanela: Array<{ item: Obrigacao; ancora: Dia }> = [];
      for (const item of (candidatos ?? []) as unknown as Obrigacao[]) {
        if (!passaNoFiltroDeTipo(item, config.tipo)) continue;
        const disparo = disparoDoRelogio(item, gatilho, config);
        if (!disparo) continue;
        if (!venceNaJanela(disparo.dia_do_disparo, hoje, [item.sem_aviso_antes_de, diaDaRegra])) continue;
        naJanela.push({ item, ancora: disparo.ancora });
      }
      resultado.examinados += naJanela.length;

      const comProposta =
        gatilho === GATILHO_DOCUMENTO_NAO_ENVIADO
          ? await idsComPropostaPendente(admin, org, naJanela.map((c) => c.item.id))
          : new Set<string>();

      for (const { item, ancora } of naJanela) {
        const segurar = comProposta.has(item.id);
        const r = await disparar(admin, {
          org,
          item,
          regraId: regra.id,
          gatilho,
          ancora,
          payload: payloadDo(item, gatilho, config, ancora, hoje),
          segurar,
        });
        if (r.erro) {
          logger.error("[obrigacoes-avisos] disparo falhou", { organization_id: org, rule_id: regra.id, obrigacao_id: item.id, error: r.erro });
          pular("emissao_falhou");
        } else if (r.evento) {
          resultado.emitidos += 1;
        } else if (segurar) {
          resultado.segurados += 1;
        } else {
          pular("ja_emitido");
        }
      }

      if (gatilho === GATILHO_DOCUMENTO_NAO_ENVIADO) {
        resultado.emitidos += await soltarSegurados(admin, org, regra, config, hoje, pular);
      }
    }
  }

  return resultado;
}

/**
 * Os avisos SEGURADOS desta regra: sai o que não tem mais proposta pendente e
 * continua esperando o documento; é descartado o que deixou de fazer sentido
 * (documento recebido, pedido refeito, item arquivado).
 */
async function soltarSegurados(
  admin: Admin,
  org: string,
  regra: RegraDeObrigacao,
  config: ConfigDoGatilhoDeObrigacao,
  hoje: Dia,
  pular: (motivo: string, quantos?: number) => void,
): Promise<number> {
  const { data: segurados } = await admin
    .from("mia_obrigacoes_avisos")
    .select("id, obrigacao_id, ciclo, ancora")
    .eq("organization_id", org)
    .eq("regra_id", regra.id)
    .eq("gatilho", GATILHO_DOCUMENTO_NAO_ENVIADO)
    .eq("segurado", true)
    .limit(TETO_POR_ORGANIZACAO);
  const linhas = (segurados ?? []) as Array<{ id: string; obrigacao_id: string; ciclo: number; ancora: Dia }>;
  if (linhas.length === 0) return 0;

  const pendentes = await idsComPropostaPendente(admin, org, linhas.map((l) => l.obrigacao_id));
  let soltos = 0;
  for (const linha of linhas) {
    if (pendentes.has(linha.obrigacao_id)) continue;
    const { data } = await admin
      .from("mia_obrigacoes")
      .select(COLUNAS_DA_OBRIGACAO)
      .eq("organization_id", org)
      .eq("id", linha.obrigacao_id)
      .maybeSingle();
    const item = data as unknown as Obrigacao | null;
    const aindaVale =
      item !== null && !item.arquivado_em && aguardando(item) && item.ciclo === linha.ciclo && item.pedido_em === linha.ancora;
    if (!aindaVale) {
      await admin.from("mia_obrigacoes_avisos").delete().eq("organization_id", org).eq("id", linha.id).eq("segurado", true);
      pular("segurado_descartado");
      continue;
    }
    const r = await disparar(admin, {
      org,
      item,
      regraId: regra.id,
      gatilho: GATILHO_DOCUMENTO_NAO_ENVIADO,
      ancora: linha.ancora,
      payload: payloadDo(item, GATILHO_DOCUMENTO_NAO_ENVIADO, config, linha.ancora, hoje),
    });
    if (r.evento) soltos += 1;
    else if (r.erro) pular("emissao_falhou");
  }
  return soltos;
}

/** Um item que uma regra alcançaria HOJE, para o "simular" da tela de automações. */
export interface ItemDaSimulacao {
  id: string;
  nome: string;
  categoria: Obrigacao["categoria"];
  /** `hoje` dispara nesta rodada; `segurado` espera a confirmação de um arquivo. */
  quando: "hoje" | "segurado";
}

/**
 * O que uma regra (ainda não salva, ou salva) faria hoje com os itens da
 * empresa. Não grava nada e não emite nada: é a mesma conta da varredura, sem a
 * trava. "Documento recebido" não tem o que simular: nasce de um ato.
 */
export function simularRegra(
  itens: readonly Obrigacao[],
  gatilho: GatilhoDeObrigacao,
  config: ConfigDoGatilhoDeObrigacao,
  hoje: Dia,
  comPropostaPendente: ReadonlySet<string>,
): ItemDaSimulacao[] {
  if (gatilho === GATILHO_DOCUMENTO_RECEBIDO) return [];
  const saida: ItemDaSimulacao[] = [];
  for (const item of itens) {
    if (item.arquivado_em || !passaNoFiltroDeTipo(item, config.tipo)) continue;
    const disparo = disparoDoRelogio(item, gatilho, config);
    if (!disparo || disparo.dia_do_disparo !== hoje) continue;
    const segurado = gatilho === GATILHO_DOCUMENTO_NAO_ENVIADO && comPropostaPendente.has(item.id);
    saida.push({ id: item.id, nome: item.nome, categoria: item.categoria, quando: segurado ? "segurado" : "hoje" });
  }
  return saida;
}

