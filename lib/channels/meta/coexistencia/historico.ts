/**
 * FORK MIA · coexistência (S2): a LEITURA do campo `history` do webhook da Meta.
 *
 * Função pura, sobre o envelope cru (o `parseMetaWebhook` do upstream ignora
 * este campo de propósito, como ignora o `account_update`). Leitura defensiva,
 * no molde de `chegada-do-cadastro.ts`: campo que não tem a forma esperada é
 * ignorado, nunca lança — a rota responde 200 de qualquer jeito.
 *
 * O que a Meta manda no `history` (webhooks/reference/history, lido em
 * 17/11/2026):
 *
 *   - LOTE: `value.history[]` com `metadata.{phase, chunk_order, progress}`
 *     (inteiros) e `threads[]`; cada thread tem `id` (o telefone do cliente,
 *     omitido quando ele só tem nome de usuário), `context.{wa_id, user_id}` e
 *     `messages[]` com `from`, `id` (wamid), `timestamp`, `type`, o corpo do
 *     tipo e `history_context.status`. Não há `to`: `from` é o número da
 *     empresa quando ela enviou, e o do cliente quando ele enviou.
 *   - MÍDIA À PARTE: mídia dos últimos 14 dias chega no lote como
 *     `media_placeholder`, e o arquivo vem depois num webhook do MESMO campo,
 *     com `value.messages[]` direto (sem `history`), o MESMO `id` da mensagem e
 *     o `type` de verdade (`image`, com `image.id`).
 *   - ERRO: `value.history[].errors[]`; `2593109` = o dono desligou o
 *     compartilhamento do histórico no app.
 *
 * `phase` 0 é de 0 a 1 dia, 1 de 1 a 90, 2 de 90 a 180. Os lotes chegam fora de
 * ordem; `progress` 100 é o fim.
 */

export const CAMPO_DO_HISTORICO = "history";

/** O dono desligou o compartilhamento do histórico no app. */
export const ERRO_HISTORICO_RECUSADO_PELO_DONO = 2593109;

export interface LoteDoHistorico {
  tipo: "lote";
  wabaId: string;
  phoneNumberId: string;
  /** O número da empresa, só dígitos: é o que separa saída de entrada. */
  numeroDaEmpresa: string | null;
  fase: number;
  ordem: number;
  progresso: number | null;
  /** O item cru do `history[]` (o que o worker grava). */
  item: Record<string, unknown>;
}

export interface MidiaDoHistorico {
  tipo: "midia";
  wabaId: string;
  phoneNumberId: string;
  /** wamid da mensagem que chegou como `media_placeholder`. */
  externalId: string;
  /** A mensagem crua (com o `type` de verdade e o id da mídia). */
  mensagem: Record<string, unknown>;
}

export interface ErroDoHistorico {
  tipo: "erro";
  wabaId: string;
  phoneNumberId: string;
  codigo: string;
  titulo: string | null;
}

export type LeituraDoHistorico = LoteDoHistorico | MidiaDoHistorico | ErroDoHistorico;

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function texto(v: unknown): string | null {
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function inteiro(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
}

export function soDigitos(v: unknown): string | null {
  const t = texto(v);
  if (!t) return null;
  const d = t.replace(/\D/g, "");
  return d === "" ? null : d;
}

/**
 * Tudo o que um `change` do campo `history` traz. Outro campo: lista vazia.
 * Sem `phone_number_id` não há a quem amarrar: lista vazia.
 */
export function lerHistorico(
  campo: string,
  wabaId: string,
  value: Record<string, unknown>,
): LeituraDoHistorico[] {
  if (campo !== CAMPO_DO_HISTORICO) return [];
  const metadata = objeto(value.metadata) ?? {};
  const phoneNumberId = texto(metadata.phone_number_id);
  if (!phoneNumberId) return [];
  const numeroDaEmpresa = soDigitos(metadata.display_phone_number);
  const out: LeituraDoHistorico[] = [];

  for (const cru of Array.isArray(value.history) ? value.history : []) {
    const item = objeto(cru);
    if (!item) continue;

    const erros = Array.isArray(item.errors) ? item.errors.map(objeto).filter((e) => e !== null) : [];
    if (erros.length > 0) {
      const primeiro = erros[0]!;
      out.push({
        tipo: "erro",
        wabaId,
        phoneNumberId,
        codigo: (texto(primeiro.code) ?? "desconhecido").slice(0, 40),
        titulo: texto(primeiro.title)?.slice(0, 300) ?? null,
      });
      continue;
    }

    const meta = objeto(item.metadata);
    const fase = inteiro(meta?.phase);
    const ordem = inteiro(meta?.chunk_order);
    // Lote sem fase ou sem ordem não tem chave de reentrega: gravá-lo duas vezes
    // seria contar duas vezes. Fica de fora.
    if (fase === null || fase < 0 || fase > 2 || ordem === null || ordem < 0) continue;
    const progresso = inteiro(meta?.progress);
    out.push({
      tipo: "lote",
      wabaId,
      phoneNumberId,
      numeroDaEmpresa,
      fase,
      ordem,
      progresso: progresso !== null && progresso >= 0 && progresso <= 100 ? progresso : null,
      item,
    });
  }

  // A mídia à parte: `messages[]` direto no `value`, com o id da mensagem.
  for (const cru of Array.isArray(value.messages) ? value.messages : []) {
    const mensagem = objeto(cru);
    const externalId = texto(mensagem?.id);
    if (!mensagem || !externalId) continue;
    out.push({ tipo: "midia", wabaId, phoneNumberId, externalId, mensagem });
  }

  return out;
}

/** A chave de reentrega do lote (`unique (sincronizacao_id, chave)`). */
export function chaveDoLote(l: LoteDoHistorico | MidiaDoHistorico): string {
  return l.tipo === "lote" ? `f${l.fase}:o${l.ordem}` : `midia:${l.externalId}`;
}
