/**
 * FORK MIA (.89) — POST /api/v1/email-marketing/publico: a CONTAGEM de quem
 * recebe um recorte, com os dez motivos de quem fica de fora e os primeiros
 * nomes de cada motivo (a tela abre o motivo e mostra quem é).
 *
 * Só leitura (POST porque o recorte não cabe numa URL). Gestor para cima. Não
 * existe "todos os contatos": sem critério, a resposta diz isso.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok } from "@/lib/api/wrappers";
import { MOTIVOS_DE_EXCLUSAO } from "@/lib/email-marketing/elegibilidade";
import { mascararEmail } from "@/lib/email-marketing/endereco";
import { montarPublico } from "@/lib/email-marketing/publico";
import { recorteSchema } from "@/lib/email-marketing/recorte";
import { RecusaDaCampanha } from "@/lib/email-marketing/recusa";
import { corpoJson, portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";

export const dynamic = "force-dynamic";

const pedidoSchema = z
  .object({
    recorte: recorteSchema,
    base_legal: z.enum(["consent", "legitimate_interest"]).default("consent"),
  })
  .strict();

/** Quantos nomes de cada motivo a tela mostra ao abrir. */
const AMOSTRA = 8;

export async function POST(req: NextRequest): Promise<Response> {
  const porta = await portaDoEmail("manager", { escreve: false });
  if (!porta.ok) return porta.response;
  try {
    const parsed = pedidoSchema.safeParse(await corpoJson(req));
    if (!parsed.success)
      throw new RecusaDaCampanha(
        "validation_failed",
        "Recorte inválido.",
        422,
        parsed.error.flatten(),
      );
    const p = await montarPublico(porta.admin, {
      organizationId: porta.org.orgId,
      recorte: parsed.data.recorte,
      base: parsed.data.base_legal,
    });
    const amostras = Object.fromEntries(
      MOTIVOS_DE_EXCLUSAO.map((m) => [
        m,
        p.linhas
          .filter((l) => l.motivo === m)
          .slice(0, AMOSTRA)
          .map((l) => ({
            nome: l.contato.nome,
            email: l.contato.email ? mascararEmail(l.contato.email) : null,
          })),
      ]),
    );
    return ok(
      {
        sem_criterio: p.semCriterio,
        truncado: p.truncado,
        no_recorte: p.contagem.noRecorte,
        recebem: p.contagem.recebem,
        fora_por_motivo: p.contagem.foraPorMotivo,
        amostras,
      },
      { requestId: porta.requestId },
    );
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
