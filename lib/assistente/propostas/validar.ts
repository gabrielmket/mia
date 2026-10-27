/**
 * FORK MIA (.94) — A FORMA DO PEDIDO de cada peça do dia a dia, conferida no
 * servidor antes do aplicar.
 *
 * A linha da proposta nasce pela SESSÃO (RLS da 9100): quem chama o PostgREST
 * direto pode gravar um `pedido` que o assistente nunca prepararia. O aplicar
 * não confia nele: o pedido passa por aqui, e o que não fecha vira recusa, sem
 * tocar em nada. As três peças da .91 seguem conferidas no caminho da
 * implantação, como antes.
 */
import { z } from "zod";

import { PALETA_DE_ETIQUETAS } from "@/lib/tags/cor-da-etiqueta";

import type { PedidoDaProposta, TipoDoDiaADia } from "./tipos";

const uuid = z.string().uuid();
const texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const paraQuem = z.enum(["eu", "equipe"]);

export const ESQUEMAS_DO_DIA_A_DIA: Record<TipoDoDiaADia, z.ZodTypeAny> = {
  etapa_criar: z
    .object({
      funil_id: uuid,
      funil_nome: texto(1, 200),
      nome: texto(2, 80),
      antes_de_id: uuid.nullable(),
      antes_de_nome: texto(1, 200).nullable(),
    })
    .strict(),
  etapa_renomear: z
    .object({ funil_id: uuid, funil_nome: texto(1, 200), etapa_id: uuid, de: texto(1, 200), para: texto(2, 80) })
    .strict(),
  resposta: z
    .object({
      atalho: z.string().regex(/^[^\s/][^\s]{1,39}$/),
      titulo: texto(1, 80),
      texto: texto(3, 4096),
      para: paraQuem,
    })
    .strict(),
  etiqueta: z
    .object({
      nome: texto(2, 60),
      cor: z.string().refine((c) => (PALETA_DE_ETIQUETAS as readonly string[]).includes(c), "cor fora da paleta"),
    })
    .strict(),
  tarefa: z
    .object({
      titulo: texto(3, 255),
      vence_em: z.string().datetime({ offset: true }),
      quando: texto(1, 80),
      para_user_id: uuid,
      para_nome: texto(1, 200),
    })
    .strict(),
  rascunho_de_followup: z
    .object({
      nome: texto(3, 80),
      modelo: texto(1, 80),
      mensagens: z.tuple([texto(1, 1000), texto(1, 1000), texto(1, 1000)]),
      esperas_dias: z.tuple([z.number().int().min(1).max(7), z.number().int().min(1).max(14)]),
    })
    .strict(),
  conhecimento: z
    .object({
      titulo: texto(2, 120),
      pergunta: texto(2, 500),
      resposta: texto(3, 4000),
      material_id: uuid.nullable(),
      material_nome: texto(1, 200),
      agente_nome: texto(1, 200).nullable(),
      agente_usa: z.boolean(),
    })
    .strict(),
  relatorio: z
    .object({
      nome: texto(3, 80),
      agrupar: z.enum(["origem", "etapa", "resp"]),
      periodo: z.enum(["7", "30", "90", "mes", "mesp"]),
      funil_id: uuid.nullable(),
      para: paraQuem,
    })
    .strict(),
  meta: z
    .object({
      mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      valor_cents: z.number().int().positive().max(1e12),
      moeda: z.string().regex(/^[A-Z]{3}$/),
    })
    .strict(),
};

/** O pedido conferido, ou a frase de por que ele não fecha. */
export function conferirPedido(
  tipo: TipoDoDiaADia,
  pedido: unknown,
): { ok: true; proposta: Extract<PedidoDaProposta, { tipo: TipoDoDiaADia }> } | { ok: false; mensagem: string } {
  const lido = ESQUEMAS_DO_DIA_A_DIA[tipo].safeParse(pedido);
  if (!lido.success) return { ok: false, mensagem: "O pedido desta proposta não fecha. Peça de novo ao assistente." };
  return { ok: true, proposta: { tipo, pedido: lido.data } as Extract<PedidoDaProposta, { tipo: TipoDoDiaADia }> };
}
