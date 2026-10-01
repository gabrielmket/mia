/**
 * FORK MIA — OBRIGAÇÕES · OS CINCO GATILHOS DE AUTOMAÇÃO.
 *
 * Os avisos de vencimento não são um motor novo: são cinco gatilhos a mais no
 * QUANDO das automações que já existem, com as ações de sempre no FAÇA
 * (mensagem, tarefa, aviso no grupo, mover de etapa, etiqueta, abrir negócio).
 *
 *   obrigacao.documento_vencendo      X dias antes do "válido até"
 *   obrigacao.documento_vencido       no dia seguinte ao vencimento
 *   obrigacao.documento_nao_enviado   pedido há X dias sem receber
 *   obrigacao.documento_recebido      quando uma pessoa confirma o recebimento
 *   obrigacao.atividade_chegando      X dias antes da próxima data
 *
 * Quatro nascem do RELÓGIO (a varredura `cron/obrigacoes-avisos`, às 9h do fuso
 * da empresa, como a de data do funil) e um nasce de um ato (o recebimento).
 * Os cinco emitem evento DIRIGIDO a uma regra (`rule_id` no payload) e passam
 * pela mesma trava: uma vez por regra, item, ciclo e data medida
 * (`fn_mia_obrigacao_disparar`, migration 9018).
 *
 * ⚠️ Módulo PURO: o schema da API e o editor de regras (que roda no NAVEGADOR)
 * leem a configuração daqui.
 */
import { diasEntre, somarDias, type Dia } from "./datas";
import { aguardando } from "./situacao";
import { chaveDoNome, type ItemParaSituacao } from "./tipos";

export const GATILHO_DOCUMENTO_VENCENDO = "obrigacao.documento_vencendo";
export const GATILHO_DOCUMENTO_VENCIDO = "obrigacao.documento_vencido";
export const GATILHO_DOCUMENTO_NAO_ENVIADO = "obrigacao.documento_nao_enviado";
export const GATILHO_DOCUMENTO_RECEBIDO = "obrigacao.documento_recebido";
export const GATILHO_ATIVIDADE_CHEGANDO = "obrigacao.atividade_chegando";

/** A entidade que os cinco eventos carregam: o próprio item. */
export const ENTIDADE_DA_OBRIGACAO = "mia_obrigacao";

/**
 * O mapa que entra em `ENTIDADE_ESPERADA_POR_GATILHO` (lib/schemas/webhooks.ts)
 * por uma linha: é dele que o Zod, o guard do motor e a assinatura do handler
 * derivam.
 */
export const ENTIDADE_DOS_GATILHOS_DE_OBRIGACAO = {
  "obrigacao.documento_vencendo": "mia_obrigacao",
  "obrigacao.documento_vencido": "mia_obrigacao",
  "obrigacao.documento_nao_enviado": "mia_obrigacao",
  "obrigacao.documento_recebido": "mia_obrigacao",
  "obrigacao.atividade_chegando": "mia_obrigacao",
} as const;

export type GatilhoDeObrigacao = keyof typeof ENTIDADE_DOS_GATILHOS_DE_OBRIGACAO;

export const GATILHOS_DE_OBRIGACAO = Object.keys(ENTIDADE_DOS_GATILHOS_DE_OBRIGACAO) as GatilhoDeObrigacao[];

/** Os que nascem do relógio: é a varredura que os emite. */
export const GATILHOS_DO_RELOGIO: readonly GatilhoDeObrigacao[] = [
  GATILHO_DOCUMENTO_VENCENDO,
  GATILHO_DOCUMENTO_VENCIDO,
  GATILHO_DOCUMENTO_NAO_ENVIADO,
  GATILHO_ATIVIDADE_CHEGANDO,
];

/** Os que pedem um X (dias) na configuração. */
const COM_DIAS: ReadonlySet<string> = new Set([
  GATILHO_DOCUMENTO_VENCENDO,
  GATILHO_DOCUMENTO_NAO_ENVIADO,
  GATILHO_ATIVIDADE_CHEGANDO,
]);

export function ehGatilhoDeObrigacao(evento: unknown): evento is GatilhoDeObrigacao {
  return typeof evento === "string" && evento in ENTIDADE_DOS_GATILHOS_DE_OBRIGACAO;
}

export function gatilhoPedeDias(evento: string): boolean {
  return COM_DIAS.has(evento);
}

export const DIAS_MIN = 1;
export const DIAS_MAX = 3650;

/** O X que cada gatilho sugere quando a regra nasce. */
export const DIAS_SUGERIDOS: Record<string, number> = {
  [GATILHO_DOCUMENTO_VENCENDO]: 30,
  [GATILHO_DOCUMENTO_NAO_ENVIADO]: 5,
  [GATILHO_ATIVIDADE_CHEGANDO]: 15,
};

/** O que a regra guarda em `automation_rules.trigger_config`. */
export interface ConfigDoGatilhoDeObrigacao {
  /** O X. `null` nos gatilhos que não pedem dias (vencido, recebido). */
  dias: number | null;
  /** Só para itens com este nome de tipo. `null` = todos os tipos. */
  tipo: string | null;
}

/**
 * Lê a configuração como ela veio do banco (jsonb) ou da tela.
 *
 * `null` para linha malformada, em vez de estourar: a varredura roda para todas
 * as organizações, e uma regra torta não pode derrubar as irmãs. É também o que
 * o schema da API usa para recusar, na criação, o que nunca dispararia.
 */
export function configDoGatilhoDeObrigacao(evento: string, bruto: unknown): ConfigDoGatilhoDeObrigacao | null {
  if (!ehGatilhoDeObrigacao(evento)) return null;
  const objeto = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const tipoBruto = objeto.tipo;
  const tipo = typeof tipoBruto === "string" && tipoBruto.trim() ? tipoBruto.trim().slice(0, 120) : null;
  if (!gatilhoPedeDias(evento)) return { dias: null, tipo };
  const dias = objeto.dias;
  if (!Number.isInteger(dias)) return null;
  const n = dias as number;
  if (n < DIAS_MIN || n > DIAS_MAX) return null;
  return { dias: n, tipo };
}

/** O filtro por tipo: sem filtro, todo item passa; com filtro, só o do mesmo nome. */
export function passaNoFiltroDeTipo(item: { nome: string }, tipo: string | null): boolean {
  return !tipo || chaveDoNome(item.nome) === chaveDoNome(tipo);
}

/**
 * Quantos dias a varredura ainda alcança um disparo que perdeu a hora (o
 * agendador fora do ar às 9h, o item cadastrado depois da rodada do dia).
 * A trava segura a repetição; a tolerância só recupera o dia perdido.
 */
export const TOLERANCIA_EM_DIAS = 2;

export interface DisparoDoRelogio {
  /** A data MEDIDA (a âncora da trava): o "válido até", o "pedido em" ou a próxima data. */
  ancora: Dia;
  /** O dia em que o gatilho deveria disparar. */
  dia_do_disparo: Dia;
}

/**
 * O disparo que este item deve a esta regra, ou `null`.
 *
 * Não decide a JANELA nem a trava: só diz qual é a data medida e em que dia o
 * gatilho cai. `venceNaJanela` (abaixo) compara com o hoje.
 */
export function disparoDoRelogio(
  item: ItemParaSituacao,
  evento: GatilhoDeObrigacao,
  config: ConfigDoGatilhoDeObrigacao,
): DisparoDoRelogio | null {
  const dias = config.dias ?? 0;
  if (evento === GATILHO_DOCUMENTO_VENCENDO) {
    if (item.categoria !== "documento" || !item.valido_ate) return null;
    return { ancora: item.valido_ate, dia_do_disparo: somarDias(item.valido_ate, -dias) };
  }
  if (evento === GATILHO_DOCUMENTO_VENCIDO) {
    if (item.categoria !== "documento" || !item.valido_ate) return null;
    return { ancora: item.valido_ate, dia_do_disparo: somarDias(item.valido_ate, 1) };
  }
  if (evento === GATILHO_DOCUMENTO_NAO_ENVIADO) {
    // Só enquanto a versão pedida não chegou: recebido, o pedido deixou de valer.
    if (!aguardando(item) || !item.pedido_em) return null;
    return { ancora: item.pedido_em, dia_do_disparo: somarDias(item.pedido_em, dias) };
  }
  if (evento === GATILHO_ATIVIDADE_CHEGANDO) {
    if (item.categoria !== "atividade" || !item.proxima_em) return null;
    return { ancora: item.proxima_em, dia_do_disparo: somarDias(item.proxima_em, -dias) };
  }
  return null;
}

/**
 * O dia do disparo é hoje, ou ficou para trás há no máximo a tolerância?
 *
 * `desde` é o piso: o dia em que o item passou a existir para os avisos
 * (`sem_aviso_antes_de`) e o dia em que a regra foi ligada ou mudada. Disparo
 * anterior ao piso não sai: item migrado de planilha e regra ligada hoje não
 * mandam aviso do passado.
 */
export function venceNaJanela(diaDoDisparo: Dia, hoje: Dia, desde: readonly (Dia | null | undefined)[]): boolean {
  const atraso = diasEntre(diaDoDisparo, hoje);
  if (Number.isNaN(atraso) || atraso < 0 || atraso > TOLERANCIA_EM_DIAS) return false;
  for (const piso of desde) {
    if (piso && diasEntre(piso, diaDoDisparo) < 0) return false;
  }
  return true;
}

/** As frases dos gatilhos, na tela de automações. */
export const ROTULOS_DOS_GATILHOS_DE_OBRIGACAO = {
  "obrigacao.documento_vencendo": "Quando um documento estiver para vencer (X dias antes)",
  "obrigacao.documento_vencido": "Quando um documento vencer (no dia seguinte)",
  "obrigacao.documento_nao_enviado": "Quando um documento pedido não chegar (pedido há X dias)",
  "obrigacao.documento_recebido": "Quando um documento for recebido",
  "obrigacao.atividade_chegando": "Quando uma atividade recorrente estiver chegando (X dias antes)",
} as const satisfies Record<GatilhoDeObrigacao, string>;

/** A explicação de cada um, embaixo do seletor. */
export const EXPLICACAO_DOS_GATILHOS_DE_OBRIGACAO = {
  "obrigacao.documento_vencendo":
    "Dispara X dias antes do \"válido até\" do documento, uma vez por documento e ciclo. Renovou, o aviso volta a valer para a validade nova.",
  "obrigacao.documento_vencido":
    "Dispara no dia seguinte ao vencimento, uma vez por documento e ciclo. O negócio só muda de etapa se a regra tiver a ação de mover.",
  "obrigacao.documento_nao_enviado":
    "Dispara quando o documento foi pedido há X dias e não chegou, uma vez por pedido. Fica segurado enquanto houver um arquivo do cliente esperando a sua confirmação.",
  "obrigacao.documento_recebido":
    "Dispara quando uma pessoa marca o documento como recebido, ou confirma o arquivo que o agente reconheceu na conversa.",
  "obrigacao.atividade_chegando":
    "Dispara X dias antes da próxima data da atividade, uma vez por ciclo. Marcada como feita, a próxima data volta a valer.",
} as const satisfies Record<GatilhoDeObrigacao, string>;

/** O que o payload do evento leva para as condições e para os textos das ações. */
export interface PayloadDoGatilho {
  rule_id: string;
  gatilho: GatilhoDeObrigacao;
  dias: number | null;
  ciclo: number;
  ancora: Dia;
  local_date: Dia;
  nome: string;
  categoria: ItemParaSituacao["categoria"];
}

/** As marcações que as ações aceitam nos textos, com o que cada uma vira. */
export const MARCACOES_DA_OBRIGACAO = [
  { marcacao: "{{obrigacao.nome}}", significa: "o nome do documento ou da atividade" },
  { marcacao: "{{obrigacao.data}}", significa: "a data que importa (o válido até ou a próxima data), em dd/mm/aaaa" },
  { marcacao: "{{obrigacao.situacao}}", significa: "a situação calculada (vencendo, vencido, pedido...)" },
  { marcacao: "{{obrigacao.dias}}", significa: "quantos dias faltam (ou quantos dias se passaram)" },
] as const;
