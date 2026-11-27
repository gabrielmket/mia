/**
 * A MUDANÇA DO TETO DE IA (`ai_budgets`) — uma regra, duas portas.
 *
 * FORK MIA (MIA-309; desenho na MIA-285, seção 5). A regra nasceu dentro do
 * PATCH de `/api/v1/ai/budget` (upstream) e saiu para cá sem mudar uma vírgula,
 * para o MCP de plataforma (`plataforma_definir_teto_de_ia`) gravar o MESMO
 * teto com a MESMA escada: uma segunda cópia divergiria na primeira fusão.
 *
 * O porquê de cada regra (a escada, o piso, a carência e o desarme que zera a
 * data) continua escrito no cabeçalho da rota e nos comentários abaixo, que
 * vieram de lá.
 *
 * Os dois tetos da instalação, para não confundir:
 *   - o do PLANO (`cobranca_planos.teto_ia_usd_cents`, nosso): comercial, só
 *     para a chamada com a chave da instalação;
 *   - o de `ai_budgets` (do upstream, este): por empresa, com os modos off,
 *     avisar e bloquear. É o freio de emergência.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AuditAction } from "@/lib/audit/actions";

import {
  LIMIAR_PADRAO_PCT,
  PISO_DE_TETO_CENTS,
  normalizarModoDeOrcamento,
  type ModoDeOrcamento,
} from "@/lib/agent-engine/edge/llm/orcamento";
import { logger } from "@/lib/logger";

/** Horas de carência entre armar a parada e ela passar a valer. */
export const CARENCIA_HORAS = 72;

/**
 * O piso escrito como o leitor brasileiro o lê. `toFixed(2)` devolveria
 * "US$ 1.00" — ponto decimal numa frase em português, na única linha que o
 * usuário recebe quando o salvamento é recusado. Mesmo idioma de `emDolares`
 * em `run-model-call.ts`: dólar porque `cost_cents` é USD, vírgula porque a
 * frase é pt-BR.
 */
const PISO_LEGIVEL = `US$ ${(PISO_DE_TETO_CENTS / 100).toLocaleString("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

/** A escada. Comparação por posição — nunca por igualdade de string espalhada. */
export const DEGRAU: Record<ModoDeOrcamento, number> = { off: 0, avisar: 1, bloquear: 2 };

/** Os campos do pedido, sem o `refine` (o MCP monta o schema dele com os mesmos campos). */
export const CAMPOS_DO_PEDIDO_DO_TETO = {
  monthly_limit_cents: z.number().int().min(0).optional(),
  // 50..99 casa o CHECK `ai_budgets_alarm_threshold_pct_check` do banco. O Zod
  // aceitava 1..100: 30 ou 100 passavam aqui, batiam no 23514 e viravam
  // "Erro ao atualizar orçamento." 500 — sem dizer qual campo ofendeu, e com o
  // rollback otimista do hook desfazendo a mudança na tela, o que se lê como
  // "o app engoliu meu clique". Não relaxo o CHECK: a régua mais estrita é a
  // certa; a errada era a visível.
  alarm_threshold_pct: z.number().int().min(50).max(99).optional(),
  enforcement_mode: z.enum(["off", "avisar", "bloquear"]).optional(),
  /** Renuncia à carência ao armar. Sozinho não é mutação — ver o refine. */
  confirmar_imediato: z.boolean().optional(),
};

export const pedidoDoTetoSchema = z
  .object(CAMPOS_DO_PEDIDO_DO_TETO)
  .refine(
    (v) =>
      v.monthly_limit_cents !== undefined ||
      v.alarm_threshold_pct !== undefined ||
      v.enforcement_mode !== undefined,
    { message: "Informe ao menos um campo: teto, limiar ou modo." },
  );

export type PedidoDoTeto = z.infer<typeof pedidoDoTetoSchema>;

/** A linha de `ai_budgets` como a regra a lê. `null` = a empresa ainda não tem linha. */
export interface TetoGravado {
  monthly_limit_cents: number | string | null;
  alarm_threshold_pct: number | string | null;
  enforcement_mode: string | null;
  enforcement_effective_at: string | null;
}

export const COLUNAS_DO_TETO = "monthly_limit_cents, alarm_threshold_pct, enforcement_mode, enforcement_effective_at";

/** Os três campos que a pessoa escolhe, antes ou depois da mudança. */
export interface EstadoDoTeto {
  modo: ModoDeOrcamento;
  tetoCents: number;
  limiarPct: number;
}

export type DecisaoDoTeto =
  | {
      ok: false;
      codigo: "invalid_state_transition" | "unprocessable_entity";
      /** A frase, com o tradutor de quem chama (a rota traduz; o MCP fala português). */
      mensagem: (t: (texto: string) => string) => string;
      details: Record<string, unknown>;
    }
  | {
      ok: true;
      antes: EstadoDoTeto;
      depois: EstadoDoTeto;
      /** O que vai para o `update` (ou para o `insert`, junto do teto). */
      patch: Record<string, unknown>;
      armando: boolean;
      desarmando: boolean;
      efetivoEm: string | null;
      /**
       * O pedido não muda nada: os três campos já são esses e não há parada a
       * armar. A rota grava assim mesmo (como sempre gravou); o MCP responde
       * `ja_estava` sem escrever nem auditar.
       */
      jaEstava: boolean;
      /** `ai.budget_enforcement_armed`, `…_disarmed` ou `ai.budget_limit_changed`. */
      acaoDaAuditoria: AuditAction;
      metadataDaAuditoria: Record<string, unknown>;
    };

/** O estado de antes, como a rota sempre leu: sem linha é "sem teto", modo off, limiar 80. */
export function estadoDoTeto(existente: TetoGravado | null): EstadoDoTeto {
  return {
    modo: normalizarModoDeOrcamento(existente?.enforcement_mode ?? null),
    // Sem linha, o teto de ANTES é 0 ("sem teto") e não o `DEFAULT 5000` da
    // coluna: 5000 é o valor que ninguém escolheu, e tratá-lo como escolha aqui
    // recriaria, na porta de escrita, exatamente a confusão que a 0159 desfez.
    tetoCents: Number(existente?.monthly_limit_cents ?? 0),
    limiarPct: Number(existente?.alarm_threshold_pct ?? LIMIAR_PADRAO_PCT),
  };
}

/**
 * A regra inteira da mudança, sem banco. `agora` entra por parâmetro para a
 * carência ser testável.
 */
export function decidirMudancaDoTeto(
  existente: TetoGravado | null,
  pedido: PedidoDoTeto,
  agora: number = Date.now(),
): DecisaoDoTeto {
  const antes = estadoDoTeto(existente);
  const modoAntes = antes.modo;

  const modoDepois = pedido.enforcement_mode ?? modoAntes;
  const tetoDepois = pedido.monthly_limit_cents ?? antes.tetoCents;
  const limiarDepois = pedido.alarm_threshold_pct ?? antes.limiarPct;

  const armando = modoDepois === "bloquear" && modoAntes !== "bloquear";

  if (armando && modoAntes === "off") {
    // ⚠️ A REGRA É DE ESTADO, NÃO DE TEMPO — e o texto já afirmou o contrário.
    // Ele dizia "deixe-a um tempo em Me avisar", mas o servidor só exige que o
    // modo atual não seja `off`: salvar "Me avisar", reabrir o diálogo e salvar
    // "Parar a IA" leva ~15 segundos, e com "Começar a valer agora" marcado a
    // parada é imediata. Rótulo visível é contrato; prometer uma janela que o
    // código não garante é a classe de defeito que esta entrega existe para
    // matar. Quem garante o tempo é a CARÊNCIA de 72h, e é dela que a frase fala.
    return {
      ok: false,
      codigo: "invalid_state_transition",
      mensagem: (t) =>
        t('Antes de fazer a IA parar no limite, salve "Me avisar" — assim o aviso já ') +
        t("está de pé quando a parada começar a valer, 72 horas depois de você armá-la."),
      details: { de: modoAntes, para: modoDepois, degrau_faltante: "avisar" },
    };
  }

  // ⚠️ O PISO GUARDA `avisar` TAMBÉM, e não só `bloquear`. Quando ele guardava
  // só a parada, `avisar` com teto 0 era alcançável pela tela e pela API — e o
  // efeito não era inofensivo: a CTE `avisa` de `SQL_ORCAMENTO` dispara com
  // `gasto >= teto * limiar / 100`, que com teto 0 é `gasto >= 0`, SEMPRE
  // verdadeiro já na primeira chamada, e a CTE `retrata` exigia `gasto < 0` para
  // fechar. Aviso permanente e falso na Central, no caminho de primeira impressão
  // (organização nova cai em `monthly_limit_cents: 0`, o campo pré-preenche
  // "0.00", e o radio "Me avisar" nasce habilitado). O tell estava no próprio
  // título da opção: "Me avisar ao passar de 80% de US$ 0,00" — avisar de quê?
  // Quem quer acompanhar sem limite escolhe "Só acompanhar" (`off`), que é o
  // estado que existe exatamente para isso.
  if (modoDepois !== "off" && tetoDepois < PISO_DE_TETO_CENTS) {
    return {
      ok: false,
      codigo: "unprocessable_entity",
      mensagem: () =>
        `Para avisar ou parar no limite, o limite precisa ser de pelo menos ${PISO_LEGIVEL} por mês. ` +
        'Se você só quer acompanhar o gasto sem limite, escolha "Só acompanhar".',
      details: { piso_cents: PISO_DE_TETO_CENTS, teto_cents: tetoDepois, modo: modoDepois },
    };
  }

  const patch: Record<string, unknown> = { updated_at: new Date(agora).toISOString() };
  if (pedido.monthly_limit_cents !== undefined) patch.monthly_limit_cents = pedido.monthly_limit_cents;
  if (pedido.alarm_threshold_pct !== undefined) patch.alarm_threshold_pct = pedido.alarm_threshold_pct;
  if (pedido.enforcement_mode !== undefined) patch.enforcement_mode = pedido.enforcement_mode;
  // `enforcement_effective_at` só é escrito na TRANSIÇÃO para `bloquear`. Rearmar
  // devolve a carência inteira (afrouxa, direção certa); mexer no teto de quem já
  // está armado não a devolve — senão bastaria salvar o diálogo para adiar por
  // mais 72h uma parada que já vale.
  const efetivoEm = armando
    ? new Date(agora + (pedido.confirmar_imediato ? 0 : CARENCIA_HORAS * 60 * 60 * 1000)).toISOString()
    : null;
  const desarmando = modoAntes === "bloquear" && modoDepois !== "bloquear";
  if (armando) patch.enforcement_effective_at = efetivoEm;
  // ⚠️ DESARMAR ZERA A DATA. Sem esta linha, uma organização que armou (efetivo
  // em T) e voltou para `off`/`avisar` ficava com um `enforcement_effective_at`
  // NO PASSADO e o modo desarmado: a carência ficava PRÉ-GASTA, e qualquer
  // escritor que pusesse `enforcement_mode='bloquear'` sem tocar na data armaria
  // um bloqueio válido NO ATO, sem as 72h. O comentário da própria coluna diz
  // que `null` é o estado de repouso de uma linha desarmada — a partir do
  // primeiro desarme isso deixava de valer, e nada restaurava o invariante.
  if (desarmando) patch.enforcement_effective_at = null;

  const depois: EstadoDoTeto = { modo: modoDepois, tetoCents: tetoDepois, limiarPct: limiarDepois };
  const jaEstava =
    !armando &&
    !desarmando &&
    depois.modo === antes.modo &&
    depois.tetoCents === antes.tetoCents &&
    depois.limiarPct === antes.limiarPct;

  return {
    ok: true,
    antes,
    depois,
    patch,
    armando,
    desarmando,
    efetivoEm,
    jaEstava,
    // Uma mutação = uma linha. A transição para/de `bloquear` escolhe o código
    // (é a pergunta que alguém vai querer filtrar sozinha: "quem armou/desarmou
    // a parada?"); todo o resto cai em `limit_changed`, e o metadata carrega
    // antes/depois dos três campos em qualquer um dos casos.
    acaoDaAuditoria: armando
      ? "ai.budget_enforcement_armed"
      : desarmando
        ? "ai.budget_enforcement_disarmed"
        : "ai.budget_limit_changed",
    metadataDaAuditoria: {
      enforcement_mode: { antes: modoAntes, depois: modoDepois },
      monthly_limit_cents: { antes: antes.tetoCents, depois: tetoDepois },
      alarm_threshold_pct: { antes: antes.limiarPct, depois: limiarDepois },
      ...(armando ? { enforcement_effective_at: efetivoEm, confirmar_imediato: pedido.confirmar_imediato === true } : {}),
    },
  };
}

/**
 * O LAÇO DE RETORNO (invariante 7) do lado de quem afrouxa.
 *
 * O gate se retrata sozinho na chamada seguinte (a CTE `retrata` de
 * `SQL_ORCAMENTO`) — mas "a chamada seguinte" pode não existir justamente
 * quando ela mais importa: se a IA está parada, ninguém a chama, e o alerta
 * crítico ficaria aceso para sempre. Quem afrouxa fecha os itens na hora, sem
 * cron e sem esperar tráfego.
 *
 * Falhar aqui não desfaz o afrouxamento: o teto já mudou no banco, e devolver
 * erro por causa de um aviso não fechado faria a pessoa clicar de novo achando
 * que nada aconteceu.
 */
export async function retratarAvisosDoTeto(d: {
  admin: SupabaseClient;
  orgId: string;
  requestId: string;
  afrouxou: boolean;
}): Promise<boolean> {
  if (!d.afrouxou) return false;
  const { data, error } = await d.admin
    .from("agent_inbox_items")
    .update({ status: "resolved" })
    .eq("organization_id", d.orgId)
    .in("kind", ["budget_exceeded", "budget_warning"])
    // Só os itens do orçamento da ORG e o legado sem referência (gravado antes
    // de o insert ter ref). O do teto do PLANO não é afrouxado por esta tela.
    .or("ref_kind.is.null,ref_kind.eq.ai_budget")
    .eq("status", "open")
    .select("id");
  if (error) {
    logger.warn("ai-budget: avisos de orçamento não puderam ser retratados", {
      organization_id: d.orgId,
      request_id: d.requestId,
      causa: error.message,
    });
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/** O teto como o MCP de plataforma mostra. */
export interface TetoDeIaNoMcp {
  /** `false` = a empresa nunca teve teto gravado: vale "sem teto", modo off. */
  gravado: boolean;
  /** Centavos de DÓLAR por mês. 0 = sem teto. */
  teto_usd_cents: number;
  limiar_pct: number;
  modo: ModoDeOrcamento;
  /** Quando a parada passa (ou passou) a valer. `null` = não está armada. */
  parada_vale_desde: string | null;
}

/** A linha de `ai_budgets` no formato do MCP. Pura. */
export function tetoNoMcp(existente: TetoGravado | null): TetoDeIaNoMcp {
  const e = estadoDoTeto(existente);
  return {
    gravado: existente !== null,
    teto_usd_cents: e.tetoCents,
    limiar_pct: e.limiarPct,
    modo: e.modo,
    parada_vale_desde: e.modo === "bloquear" ? (existente?.enforcement_effective_at ?? null) : null,
  };
}

/**
 * O teto gravado de uma empresa. `null` = a leitura falhou (não sei), nunca
 * "sem teto": quem lê decide se a IA dela pode parar por isso.
 */
export async function lerTetoDeIa(admin: SupabaseClient, organizationId: string): Promise<TetoDeIaNoMcp | null> {
  try {
    const { data, error } = await admin
      .from("ai_budgets")
      .select(COLUNAS_DO_TETO)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) return null;
    return tetoNoMcp((data as TetoGravado | null) ?? null);
  } catch {
    return null;
  }
}
