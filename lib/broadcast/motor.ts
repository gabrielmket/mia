import type { SupabaseClient } from "@supabase/supabase-js";

import { lerSaldoDaCarteira } from "@/lib/carteira/ler-saldo";
import { deveParar, type QualidadeDoNumero } from "@/lib/broadcast/plano";
import { logger } from "@/lib/logger";

/**
 * O MOTOR DO MIA BROADCAST — manda, cobra, e para quando tem de parar.
 *
 * ── A ordem dos três atos, e por que ela não pode trocar ────────────────────
 *
 *   1. ENVIA (a Meta aceita e devolve um id)
 *   2. MARCA a linha do destinatário como enviada, com o id
 *   3. DEBITA a carteira, apontando para essa linha
 *
 * Debitar ANTES de enviar cobraria pelo que não saiu quando a Meta recusasse.
 * Debitar sem marcar a linha deixaria um débito sem a que mensagem ele se
 * refere. E o débito aponta para o id da LINHA (`ref_id`), não para o id da
 * Meta: a linha existe antes do envio, e é o que permite a retentativa saber
 * que aquela mensagem já foi cobrada.
 *
 * ── A idempotência não é do código, é do banco ──────────────────────────────
 *
 * Se o processo morrer entre 1 e 3, a retentativa tenta debitar de novo — e o
 * índice único `(organization_id, ref_kind, ref_id)` da 0244 recusa. O código
 * TRATA essa recusa como sucesso, porque é o que ela significa: já foi cobrada.
 * Um `try/catch` que engolisse tudo cobriria também os erros de verdade; por
 * isso só o código de violação de unicidade passa.
 *
 * ── Uma mensagem por vez, e não um lote grande ──────────────────────────────
 *
 * Cada volta do laço confere se ainda pode continuar. Um lote de 500 enviado
 * antes de reconferir gastaria crédito que acabou na mensagem 30 — e "parou
 * depois de estourar" é pior que devagar.
 */

/** Violação de unicidade no Postgres. É "já foi cobrada", não erro. */
const JA_COBRADA = "23505";

export interface DestinatarioNaFila {
  id: string;
  phone_e164: string;
  valores: Record<string, string>;
  contact_id: string | null;
}

export interface CampanhaEmCurso {
  id: string;
  organization_id: string;
  template_name: string;
  template_language: string;
  valores_padrao: Record<string, string>;
  preco_cents: number | null;
}

export interface DependenciasDoMotor {
  /** Manda de fato. Devolve o id da Meta, ou LANÇA com o motivo. */
  enviar: (input: {
    organizationId: string;
    to: string;
    name: string;
    language: string;
    values: Record<string, string>;
  }) => Promise<string | null>;
  /**
   * Grava o envio na CONVERSA do contato. Opcional na interface, obrigatório na
   * prática: sem ela o disparo sai, cobra e não existe no inbox — e o agente
   * responde a réplica do cliente sem ver o que a provocou.
   *
   * Recebe os VALORES, não o texto pronto: renderizar exige os componentes do
   * template, e o motor não os conhece — nem deve. Quem os tem é o worker, que
   * já os carregou para enviar. Manter a renderização lá evita que o motor
   * ganhe uma segunda régua de template, que divergiria da Meta na primeira
   * mudança.
   *
   * Nunca lança: quando ela roda, a Meta já aceitou e a carteira já debitou —
   * falhar aqui e marcar `falhou` faria a campanha reenviar e cobrar de novo.
   */
  registrar?: (input: {
    contactId: string | null;
    values: Record<string, string>;
    externalId: string | null;
  }) => Promise<void>;
  /** A nota do número agora. Lida uma vez por rodada, não por mensagem. */
  qualidade: () => Promise<QualidadeDoNumero>;
  /** Espaço entre envios, em ms. */
  espacar?: (ms: number) => Promise<void>;
}

export interface ResultadoDaRodada {
  enviadas: number;
  falhas: number;
  cobradoCents: number;
  parou: "saldo_acabou" | "numero_em_risco" | null;
  /** Sobrou alguém na fila? É o que diz se o cron precisa voltar. */
  restam: number;
}

/**
 * O saldo sai do extrato INTEIRO (`lerSaldoDaCarteira`, paginado). O
 * `.limit(100_000)` que estava aqui trazia no máximo 1000 linhas, o teto do
 * PostgREST: a partir da milésima mensagem cobrada, o motor via saldo que não
 * existia e continuava enviando.
 */
async function saldoAtual(db: SupabaseClient, organizationId: string): Promise<number> {
  return (await lerSaldoDaCarteira(db, organizationId)).saldo_cents;
}

/**
 * Cobra UMA mensagem. Devolve `true` quando o débito ficou de pé (inclusive
 * quando já estava, pela retentativa).
 */
async function cobrar(
  db: SupabaseClient,
  input: { organizationId: string; recipientId: string; precoCents: number; nome: string },
): Promise<boolean> {
  // Cortesia declarada (preço zero) não gera lançamento: uma linha de R$ 0,00
  // por mensagem encheria o extrato do cliente de ruído sem dizer nada.
  if (input.precoCents <= 0) return true;

  const { error } = await db.from("tenant_wallet_ledger").insert({
    organization_id: input.organizationId,
    tipo: "debito",
    amount_cents: input.precoCents,
    ref_kind: "broadcast_message",
    ref_id: input.recipientId,
    note: input.nome,
  });
  if (!error) return true;
  if ((error as { code?: string }).code === JA_COBRADA) return true;

  logger.error("[broadcast] débito falhou", {
    recipient_id: input.recipientId,
    error: error.message,
  });
  return false;
}

/**
 * Manda o que der desta campanha, até o limite da rodada.
 *
 * O limite existe para o cron não segurar o processo por meia hora — a próxima
 * rodada continua de onde parou, e o estado está todo no banco.
 */
export async function rodarCampanha(
  db: SupabaseClient,
  campanha: CampanhaEmCurso,
  deps: DependenciasDoMotor,
  limiteDaRodada = 50,
): Promise<ResultadoDaRodada> {
  const preco = campanha.preco_cents ?? null;
  const qualidade = await deps.qualidade();

  let enviadas = 0;
  let falhas = 0;
  let cobradoCents = 0;
  let parou: ResultadoDaRodada["parou"] = null;

  /**
   * O saldo é lido UMA vez por rodada, e a rodada desconta dele o que ela mesma
   * cobra.
   *
   * Ele era relido a cada mensagem. Enquanto a leitura trazia no máximo 1000
   * linhas isso custava uma ida ao banco; com o extrato lido INTEIRO
   * (`lerSaldoDaCarteira`), uma carteira de 30 mil lançamentos custaria 30 idas
   * por mensagem, 1.500 por rodada, e a rodada passaria do minuto do cron.
   *
   * O desconto local erra para o lado seguro: crédito ou estorno que entre no
   * meio da rodada só é visto na próxima (um minuto depois), e a rodada nunca
   * enxerga MAIS saldo do que havia quando começou.
   */
  let saldoCents = await saldoAtual(db, campanha.organization_id);

  for (let i = 0; i < limiteDaRodada; i += 1) {
    const motivo = deveParar({
      saldoCents,
      precoPorMensagemCents: preco,
      qualidade,
    });
    if (motivo) {
      parou = motivo;
      break;
    }

    const { data: proximo } = await db
      .from("broadcast_recipients")
      .select("id, phone_e164, valores, contact_id")
      .eq("broadcast_id", campanha.id)
      .eq("status", "pendente")
      .limit(1)
      .maybeSingle();
    if (!proximo) break;

    const alvo = proximo as unknown as DestinatarioNaFila;
    // Os valores do destinatário mandam sobre os da campanha: o nome é dele, o
    // resto (empresa, assunto) costuma ser igual para todo mundo.
    const valores = { ...campanha.valores_padrao, ...(alvo.valores ?? {}) };

    try {
      const externalId = await deps.enviar({
        organizationId: campanha.organization_id,
        to: alvo.phone_e164,
        name: campanha.template_name,
        language: campanha.template_language,
        values: valores,
      });

      await db
        .from("broadcast_recipients")
        .update({
          status: "enviada",
          external_id: externalId,
          enviado_em: new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
          preco_cents: preco ?? 0,
        })
        .eq("id", alvo.id);

      /**
       * A conversa recebe o envio DEPOIS de marcado e ANTES de cobrar.
       *
       * Depois de marcado porque `enviada` é o fato que o resto deriva; antes de
       * cobrar não importa para o dinheiro (o `cobrar` é idempotente pelo
       * `ref_id`), mas importa para quem olha: se o processo morrer no meio, é
       * melhor existir a mensagem sem a linha de débito do que o contrário —
       * débito sem mensagem é o extrato que ninguém consegue explicar.
       */
      if (deps.registrar) {
        await deps.registrar({
          contactId: alvo.contact_id ?? null,
          values: valores,
          externalId,
        });
      }

      const ok = await cobrar(db, {
        organizationId: campanha.organization_id,
        recipientId: alvo.id,
        precoCents: preco ?? 0,
        nome: `Disparo: ${campanha.template_name}`,
      });
      if (ok && preco && preco > 0) {
        cobradoCents += preco;
        saldoCents -= preco;
      }
      enviadas += 1;
    } catch (err) {
      // Falha NÃO cobra: o débito só acontece depois do aceite da Meta, e este
      // caminho é justamente o de quem não foi aceito.
      await db
        .from("broadcast_recipients")
        .update({
          status: "falhou",
          erro: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
          atualizado_em: new Date().toISOString(),
        })
        .eq("id", alvo.id);
      falhas += 1;
    }

    if (deps.espacar) await deps.espacar(200);
  }

  const { count } = await db
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", campanha.id)
    .eq("status", "pendente");

  return { enviadas, falhas, cobradoCents, parou, restam: count ?? 0 };
}

/**
 * Devolve o crédito de uma mensagem que foi cobrada e depois falhou.
 *
 * É lançamento novo, e não apagar o débito: extrato que se edita não é extrato,
 * e o cliente precisa VER que cobramos e devolvemos. `ref_id` diferente do
 * débito (sufixo `:estorno`) para os dois caberem no índice único — sem isso o
 * estorno colidiria com o débito que ele está desfazendo.
 */
export async function estornar(
  db: SupabaseClient,
  input: { organizationId: string; recipientId: string; precoCents: number },
): Promise<boolean> {
  if (input.precoCents <= 0) return true;
  const { error } = await db.from("tenant_wallet_ledger").insert({
    organization_id: input.organizationId,
    tipo: "estorno",
    amount_cents: input.precoCents,
    ref_kind: "broadcast_message",
    ref_id: `${input.recipientId}:estorno`,
    note: "Estorno de mensagem que não foi entregue",
  });
  if (!error) return true;
  if ((error as { code?: string }).code === JA_COBRADA) return true;
  logger.error("[broadcast] estorno falhou", {
    recipient_id: input.recipientId,
    error: error.message,
  });
  return false;
}
