/**
 * FORK MIA — OBRIGAÇÕES · A SITUAÇÃO É CALCULADA PELAS DATAS, NUNCA DIGITADA.
 *
 * Este é o lugar ÚNICO em que "a pedir", "pedido", "recebido", "válido",
 * "vencendo", "vencido", "pendente" e "feita" são decididos. A tela, a rota, a
 * varredura das automações, a ferramenta do agente e o MCP de plataforma chamam
 * estas funções: se cada um refizesse a conta, o cartão diria "vencendo" e o
 * aviso sairia como "válido".
 *
 * É a porta fiel das funções do protótipo aprovado pelo Gabriel (01/10/2026):
 * `sit`, `urg`, `sitTexto`, `avisoDe`, `acoesItem`, `venceEm`, `emDia`,
 * `semResposta`. Os nomes daqui dizem de qual função cada uma veio.
 *
 *   Documento:  a pedir → pedido → recebido → válido → vencendo → vencido
 *               ("renovado" é a marca do ciclo novo, não uma situação)
 *   Atividade:  pendente → feita (e o próximo ciclo nasce sozinho)
 *
 * ⚠️ Módulo PURO. Não importa cliente de banco, auditoria, sessão nem nada que
 * chegue a `next/headers`: componente `"use client"` importa daqui, e um import
 * de servidor nesta linha derrubaria o build sem o `tsc` avisar.
 */
import { diaPorExtenso, diasEntre, type Dia } from "./datas";
import type { Categoria, ItemParaSituacao, Recorrencia } from "./tipos";

export const SITUACOES_DO_DOCUMENTO = ["a_pedir", "pedido", "recebido", "valido", "vencendo", "vencido"] as const;
export const SITUACOES_DA_ATIVIDADE = ["pendente", "feita"] as const;
export const SITUACOES = [...SITUACOES_DO_DOCUMENTO, ...SITUACOES_DA_ATIVIDADE] as const;
export type Situacao = (typeof SITUACOES)[number];

export const ROTULO_DA_SITUACAO = {
  a_pedir: "a pedir",
  pedido: "pedido",
  recebido: "recebido",
  valido: "válido",
  vencendo: "vencendo",
  vencido: "vencido",
  pendente: "pendente",
  feita: "feita",
} as const satisfies Record<Situacao, string>;

/** O que pede atenção agora. `null` = nada a fazer. */
export type TipoDeUrgencia = "vencido" | "vencendo" | "sem_resposta";

export interface Urgencia {
  tipo: TipoDeUrgencia | null;
  /** Quanto menor, mais urgente: é a ordem da lista. */
  ordem: number;
}

type Traduzir = (texto: string) => string;

/** De quantos em quantos meses o item se repete. 0 = não se repete. */
export function mesesDaRecorrencia(item: { recorrencia: Recorrencia; recorrencia_meses: number | null }): number {
  if (item.recorrencia === "mensal") return 1;
  if (item.recorrencia === "anual") return 12;
  if (item.recorrencia === "n_meses") return Number(item.recorrencia_meses) || 0;
  return 0;
}

/**
 * A maior antecedência de aviso: é onde "vencendo" (e "pendente") começa.
 * Item sem aviso nenhum usa 30 dias, para o documento com validade não ir de
 * "válido" direto a "vencido" sem nunca ter ficado "vencendo".
 */
export function maiorAviso(item: Pick<ItemParaSituacao, "avisos_dias">): number {
  return item.avisos_dias.length > 0 ? Math.max(...item.avisos_dias) : 30;
}

/** Dias até a data que importa (o "válido até" ou a próxima data). Negativo = já passou. */
export function diasAteAData(item: ItemParaSituacao, hoje: Dia): number | null {
  const data = item.categoria === "atividade" ? item.proxima_em : item.valido_ate;
  return data ? diasEntre(hoje, data) : null;
}

/** O documento foi pedido e a versão pedida ainda não chegou. */
export function aguardando(item: ItemParaSituacao): boolean {
  if (item.categoria !== "documento" || !item.pedido_em) return false;
  return !item.recebido_em || diasEntre(item.recebido_em, item.pedido_em) > 0;
}

/** Há quantos dias o pedido foi feito. */
export function idadeDoPedido(item: ItemParaSituacao, hoje: Dia): number {
  return item.pedido_em ? diasEntre(item.pedido_em, hoje) : 0;
}

/** Pedido há X dias (o X do item) e nada chegou. */
export function semResposta(item: ItemParaSituacao, hoje: Dia): boolean {
  return aguardando(item) && idadeDoPedido(item, hoje) >= (item.dias_sem_resposta || 5);
}

/** A situação do item HOJE. */
export function situacao(item: ItemParaSituacao, hoje: Dia): Situacao {
  if (item.categoria === "atividade") {
    if (!item.proxima_em) return "feita";
    if (diasEntre(hoje, item.proxima_em) <= maiorAviso(item)) return "pendente";
    return item.feita_em ? "feita" : "pendente";
  }
  if (item.valido_ate) {
    const n = diasEntre(hoje, item.valido_ate);
    if (n < 0) return "vencido";
    return n <= maiorAviso(item) ? "vencendo" : "valido";
  }
  if (item.recebido_em) return "recebido";
  return item.pedido_em ? "pedido" : "a_pedir";
}

/** Está tudo certo com o item: válido, recebido (sem validade) ou feita. */
export function emDia(item: ItemParaSituacao, hoje: Dia): boolean {
  const s = situacao(item, hoje);
  return s === "valido" || s === "recebido" || s === "feita";
}

/** A data que importa cai dentro dos próximos `dias` (e ainda não passou). */
export function venceEm(item: ItemParaSituacao, dias: number, hoje: Dia): boolean {
  const a = diasAteAData(item, hoje);
  if (a === null || a < 0 || a > dias) return false;
  return item.categoria === "documento" || situacao(item, hoje) === "pendente";
}

/** O que pede atenção, e em que ordem. Vencido primeiro, depois o que vence antes. */
export function urgencia(item: ItemParaSituacao, hoje: Dia): Urgencia {
  const s = situacao(item, hoje);
  const a = diasAteAData(item, hoje);
  if (item.categoria === "atividade") {
    if (a === null) return { tipo: null, ordem: 9000 };
    if (a < 0) return { tipo: "vencido", ordem: -10000 + a };
    if (a <= maiorAviso(item)) return { tipo: "vencendo", ordem: a };
    return { tipo: null, ordem: 2000 + a };
  }
  if (s === "vencido") return { tipo: "vencido", ordem: -10000 + (a ?? 0) };
  if (s === "vencendo") return { tipo: "vencendo", ordem: a ?? 0 };
  if (s === "pedido") {
    const i = idadeDoPedido(item, hoje);
    return semResposta(item, hoje) ? { tipo: "sem_resposta", ordem: 500 - i } : { tipo: null, ordem: 700 - i };
  }
  if (s === "a_pedir") return { tipo: null, ordem: 800 };
  return { tipo: null, ordem: a === null ? 9000 : 2000 + a };
}

/** O tom do selo da situação, no vocabulário de cor do sistema. */
export type Tom = "ok" | "alerta" | "perigo" | "info" | "neutro";

export function tomDaSituacao(item: ItemParaSituacao, hoje: Dia): Tom {
  const s = situacao(item, hoje);
  if (item.categoria === "atividade") {
    if (s === "feita") return "ok";
    const a = diasAteAData(item, hoje) ?? 0;
    return a < 0 ? "perigo" : a <= maiorAviso(item) ? "alerta" : "neutro";
  }
  const tons = {
    a_pedir: "neutro",
    pedido: "info",
    recebido: "ok",
    valido: "ok",
    vencendo: "alerta",
    vencido: "perigo",
    pendente: "neutro",
    feita: "ok",
  } as const satisfies Record<Situacao, Tom>;
  return tons[s];
}

/** "1 dia", "12 dias". */
export function emDias(n: number, t: Traduzir): string {
  return `${n} ${n === 1 ? t("dia") : t("dias")}`;
}

/** A frase ao lado do selo: a data que importa, dita do jeito que a pessoa fala. */
export function textoDaSituacao(item: ItemParaSituacao, hoje: Dia, t: Traduzir): string {
  const s = situacao(item, hoje);
  const a = diasAteAData(item, hoje);

  if (item.categoria === "atividade") {
    if (a === null) {
      return item.feita_em
        ? `${t("feita em")} ${diaPorExtenso(item.feita_em)} · ${t("não se repete")}`
        : t("não se repete");
    }
    const quando = diaPorExtenso(item.proxima_em);
    if (a < 0) return `${t("em atraso há")} ${emDias(-a, t)} · ${quando}`;
    if (s === "pendente") return `${a === 0 ? t("é hoje") : `${t("em")} ${emDias(a, t)}`} · ${quando}`;
    return `${t("feita em")} ${diaPorExtenso(item.feita_em)} · ${t("próxima em")} ${quando}`;
  }

  let texto: string;
  if (s === "vencido") {
    texto = `${a === -1 ? t("venceu ontem") : `${t("venceu há")} ${emDias(-(a ?? 0), t)}`} · ${diaPorExtenso(item.valido_ate)}`;
  } else if (s === "vencendo") {
    texto = `${a === 0 ? t("vence hoje") : `${t("vence em")} ${emDias(a ?? 0, t)}`} · ${diaPorExtenso(item.valido_ate)}`;
  } else if (s === "valido") {
    texto =
      `${t("válido até")} ${diaPorExtenso(item.valido_ate)}` +
      (item.renovado_em ? ` · ${t("renovado em")} ${diaPorExtenso(item.renovado_em)}` : "");
  } else if (s === "recebido") {
    texto = `${t("recebido em")} ${diaPorExtenso(item.recebido_em)} · ${t("sem validade")}`;
  } else if (s === "pedido") {
    const i = idadeDoPedido(item, hoje);
    texto =
      (i <= 0 ? t("pedido hoje") : `${t("pedido há")} ${emDias(i, t)}`) +
      (item.prazo_em ? ` · ${t("prazo")} ${diaPorExtenso(item.prazo_em)}` : "");
  } else {
    texto = t("ainda não foi pedido");
  }

  if ((s === "vencido" || s === "vencendo") && aguardando(item)) {
    const i = idadeDoPedido(item, hoje);
    texto += ` · ${t("renovação pedida")} ${i <= 0 ? t("hoje") : t("há {tempo}").replace("{tempo}", emDias(i, t))}`;
  }
  if (aguardando(item) && item.cobrado_em === hoje) texto += ` · ${t("cobrado hoje")}`;
  return texto;
}

/** O que o cartão fechado mostra: o item mais urgente, em números. */
export interface AvisoDoCartao {
  tipo: TipoDeUrgencia;
  /** O nome curto do item ("Alvará"). */
  nome: string;
  categoria: Categoria;
  /** Dias até a data (negativo = já passou); no pedido sem resposta, há quantos dias foi pedido. */
  dias: number;
}

/**
 * O aviso do cartão fechado: UM, o mais urgente. `null` com tudo em dia: o
 * cartão não mostra nada.
 */
export function avisoDoCartao(
  itens: ReadonlyArray<ItemParaSituacao & { nome: string; nome_curto: string | null }>,
  hoje: Dia,
): AvisoDoCartao | null {
  let melhor: { item: (typeof itens)[number]; u: Urgencia } | null = null;
  for (const item of itens) {
    const u = urgencia(item, hoje);
    if (!u.tipo) continue;
    if (!melhor || u.ordem < melhor.u.ordem) melhor = { item, u };
  }
  if (!melhor || !melhor.u.tipo) return null;
  const { item, u } = melhor;
  const tipo = u.tipo as TipoDeUrgencia;
  return {
    tipo,
    nome: item.nome_curto?.trim() || item.nome,
    categoria: item.categoria,
    dias: tipo === "sem_resposta" ? idadeDoPedido(item, hoje) : (diasAteAData(item, hoje) ?? 0),
  };
}

/** "Alvará venceu há 3 dias", "Relatório mensal em 4 dias", "Contrato social: pedido há 6 dias, sem resposta". */
export function textoDoAviso(aviso: AvisoDoCartao, t: Traduzir): string {
  const { nome, dias: a } = aviso;
  if (aviso.tipo === "vencido") {
    if (aviso.categoria === "atividade") return `${nome} ${t("em atraso há")} ${emDias(-a, t)}`;
    return `${nome} ${a === -1 ? t("venceu ontem") : `${t("venceu há")} ${emDias(-a, t)}`}`;
  }
  if (aviso.tipo === "vencendo") {
    if (aviso.categoria === "atividade") return `${nome} ${a === 0 ? t("é hoje") : `${t("em")} ${emDias(a, t)}`}`;
    return `${nome} ${a === 0 ? t("vence hoje") : `${t("vence em")} ${emDias(a, t)}`}`;
  }
  return `${nome}: ${t("pedido há")} ${emDias(a, t)}, ${t("sem resposta")}`;
}

/** O que dá para fazer com o item agora. */
export type AcaoDoItem = "feita" | "pedir" | "receber";

export interface BotaoDoItem {
  acao: AcaoDoItem;
  rotulo: string;
  /** O botão que a tela destaca. */
  primaria: boolean;
}

/**
 * Os botões do item, pela situação.
 *
 * Os rótulos ficam em português aqui: quem desenha passa cada um por `t()`. As
 * frases são fechadas (`ROTULOS_DOS_BOTOES`), para a cerca de espanhol
 * alcançar todas.
 */
export const ROTULOS_DOS_BOTOES = {
  marcar_feita: "Marcar feita",
  marcar_pedido: "Marcar pedido",
  marcar_recebido: "Marcar recebido",
  receber_versao_nova: "Receber versão nova",
  pedir_de_novo: "Pedir de novo",
  pedir_o_renovado: "Pedir o renovado",
} as const;

export function acoesDoItem(item: ItemParaSituacao, hoje: Dia): BotaoDoItem[] {
  const s = situacao(item, hoje);
  if (item.categoria === "atividade") {
    if (!item.proxima_em) return [];
    return [{ acao: "feita", rotulo: ROTULOS_DOS_BOTOES.marcar_feita, primaria: urgencia(item, hoje).tipo !== null }];
  }
  if (s === "a_pedir") {
    return [
      { acao: "pedir", rotulo: ROTULOS_DOS_BOTOES.marcar_pedido, primaria: true },
      { acao: "receber", rotulo: ROTULOS_DOS_BOTOES.marcar_recebido, primaria: false },
    ];
  }
  if (s === "valido" || s === "recebido") {
    return [{ acao: "receber", rotulo: ROTULOS_DOS_BOTOES.receber_versao_nova, primaria: false }];
  }
  const botoes: BotaoDoItem[] = [{ acao: "receber", rotulo: ROTULOS_DOS_BOTOES.marcar_recebido, primaria: true }];
  const espera = aguardando(item);
  // Quem já pediu (ou cobrou) hoje não ganha o botão de pedir de novo no mesmo dia.
  const jaHoje = espera && (item.cobrado_em === hoje || idadeDoPedido(item, hoje) <= 0);
  if (!jaHoje) {
    botoes.push({
      acao: "pedir",
      rotulo: espera ? ROTULOS_DOS_BOTOES.pedir_de_novo : ROTULOS_DOS_BOTOES.pedir_o_renovado,
      primaria: false,
    });
  }
  return botoes;
}

/** Os quatro números do topo da lista. */
export interface ContadoresDaLista {
  vencidos: number;
  vencendo_em_30_dias: number;
  pedidos_sem_resposta: number;
  em_dia: number;
  total: number;
}

export function contarObrigacoes(itens: readonly ItemParaSituacao[], hoje: Dia): ContadoresDaLista {
  return {
    vencidos: itens.filter((x) => urgencia(x, hoje).tipo === "vencido").length,
    vencendo_em_30_dias: itens.filter((x) => venceEm(x, 30, hoje)).length,
    pedidos_sem_resposta: itens.filter((x) => semResposta(x, hoje)).length,
    em_dia: itens.filter((x) => emDia(x, hoje)).length,
    total: itens.length,
  };
}

/** Do mais urgente para o menos: a ordem da lista, do Foco e das seções. */
export function porUrgencia<T extends ItemParaSituacao>(itens: readonly T[], hoje: Dia): T[] {
  return [...itens]
    .map((item, i) => ({ item, i, o: urgencia(item, hoje).ordem }))
    .sort((a, b) => a.o - b.o || a.i - b.i)
    .map((x) => x.item);
}

/** "Mensal", "Anual", "A cada 6 meses", "Única". */
export function textoDaRecorrencia(
  item: { recorrencia: Recorrencia; recorrencia_meses: number | null },
  t: Traduzir,
): string {
  if (item.recorrencia === "mensal") return t("Mensal");
  if (item.recorrencia === "anual") return t("Anual");
  if (item.recorrencia === "n_meses") return `${t("A cada")} ${item.recorrencia_meses ?? 0} ${t("meses")}`;
  return t("Única");
}

/** "30, 15 e 7 dias antes", "sem aviso". */
export function textoDosAvisos(avisos: readonly number[], t: Traduzir): string {
  if (avisos.length === 0) return t("sem aviso");
  if (avisos.length === 1) return `${avisos[0]} ${t("dias antes")}`;
  return `${avisos.slice(0, -1).join(", ")} ${t("e")} ${avisos[avisos.length - 1]} ${t("dias antes")}`;
}
