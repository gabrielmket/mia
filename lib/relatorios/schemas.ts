/**
 * FORK MIA (item 9) — os contratos de entrada que mais de uma rota usa (a lista
 * e a exportação pedem o mesmo grupo). Rotas do Next só exportam handler: o
 * schema compartilhado mora aqui.
 *
 * ⚠️ Módulo PURO.
 */
import { z } from "zod";

import { PERIODOS_DO_MONTADOR } from "./catalogo";
import { configDoRelatorioSchema } from "./config";

const chave = z.string().min(1).max(200);

/** O grupo clicado: a mesma forma na lista da tela e na planilha da lista. */
export const grupoDaListaSchema = {
  chave1: chave.nullish(),
  chave2: chave.nullish(),
  dobrados1: z.array(chave).max(500).nullish(),
  dobrados2: z.array(chave).max(500).nullish(),
  funil: z.boolean().optional(),
};

export const pedidoDaListaSchema = z
  .object({
    config: configDoRelatorioSchema,
    periodo: z.enum(PERIODOS_DO_MONTADOR).nullish(),
    ...grupoDaListaSchema,
    deslocamento: z.number().int().min(0).max(1_000_000).optional(),
    limite: z.number().int().min(1).max(200).optional(),
  })
  .strict();
