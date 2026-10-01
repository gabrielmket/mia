/**
 * O que toda ferramenta de IMPLANTAÇÃO faz antes de qualquer coisa: achar a
 * organização alvo e montar o contexto das operações de `lib/implantacao/`.
 */
import { z } from "zod";

import {
  organizacaoDaImplantacao,
  type Implantacao,
  type OrganizacaoDaImplantacao,
} from "@/lib/implantacao/base";

import type { ContextoDaFerramenta } from "../tipos";

/** O campo que toda ferramenta de implantação recebe. */
export const ORGANIZACAO = z
  .string()
  .uuid()
  .describe(
    "O id do cliente. Vem de plataforma_listar_clientes, ou da resposta de plataforma_criar_cliente. Ex.: 00000000-0000-4000-8000-000000000001.",
  );

/** Id fictício usado nos exemplos de chamada. */
export const ORG_DE_EXEMPLO = "00000000-0000-4000-8000-000000000001";

/**
 * A organização conferida e o contexto das operações.
 *
 * A conferência vem AQUI, antes de qualquer leitura ou escrita: o cliente do
 * banco é o `service_role`, e um id que não existe não esbarra em nada. A
 * recusa diz como achar o id certo.
 */
export async function alvo(
  ctx: ContextoDaFerramenta,
  args: Record<string, unknown>,
): Promise<{ c: Implantacao; org: OrganizacaoDaImplantacao }> {
  const org = await organizacaoDaImplantacao(ctx.admin, String(args.organization_id));
  return {
    c: { admin: ctx.admin, orgId: org.id, autorUserId: ctx.autorUserId, requestId: ctx.requestId },
    org,
  };
}

/** `"HH:MM"` de 24 horas. */
export const HORA = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'use "HH:MM" de 24 horas, ex.: "08:30"');

/** Dia da semana: 0 (domingo) a 6 (sábado). */
export const DIA_DA_SEMANA = z.number().int().min(0).max(6);
