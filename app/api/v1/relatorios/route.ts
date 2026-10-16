/**
 * FORK MIA (item 9) — GET/POST /api/v1/relatorios
 *
 *  - GET: os doze relatórios PRONTOS (referência da plataforma, `lib/relatorios/prontos.ts`)
 *    e os relatórios que a pessoa vê (os dela e os compartilhados com a equipe; a RLS
 *    da 9040 decide), com quem criou e se a pessoa pode editar.
 *  - POST: cria um relatório, ou a CÓPIA de um pronto (`pronto_de`) ou de outro
 *    relatório (`copiado_de`). Todo membro cria os próprios; compartilhar na criação
 *    é de gestor e administrador (o banco recusa os outros com 42501).
 *
 * Cliente da SESSÃO: a organização é a do cookie validado, nunca do corpo.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { PAINEIS_PRONTOS } from "@/lib/paineis/catalogo";
import { podeCompartilhar, podeEditar } from "@/lib/relatorios/acesso";
import { configDoRelatorioSchema, type ConfigDoRelatorio } from "@/lib/relatorios/config";
import { idsDePessoa, nomesDaEquipe } from "@/lib/relatorios/equipe";
import { RELATORIOS_PRONTOS } from "@/lib/relatorios/prontos";
import { contextoDaRota, lerCorpo, respostaDaRecusa } from "@/lib/relatorios/rota";
import { criarRelatorio, listarRelatorios } from "@/lib/relatorios/servidor";

export const dynamic = "force-dynamic";

const criarSchema = z
  .object({
    nome: z.string().trim().min(1).max(80),
    config: configDoRelatorioSchema,
    compartilhado: z.boolean().optional(),
    pronto_de: z.enum(PAINEIS_PRONTOS).nullish(),
    copiado_de: z.string().uuid().nullish(),
  })
  .strict();

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const r = await contextoDaRota(requestId);
  if (!r.ok) return r.response;
  const { ctx } = r;
  try {
    const relatorios = await listarRelatorios(ctx.db, ctx.quem.organizationId);
    const nomes = ctx.admin
      ? await nomesDaEquipe(ctx.admin, ctx.quem.organizationId, idsDePessoa(relatorios.map((x) => x.criadoPor)))
      : {};
    return ok(
      {
        prontos: RELATORIOS_PRONTOS,
        relatorios: relatorios.map((x) => ({
          ...x,
          criadoPorNome: x.criadoPor ? (nomes[x.criadoPor] ?? null) : null,
          meu: x.criadoPor === ctx.quem.userId,
          podeEditar: podeEditar(x, { userId: ctx.quem.userId ?? "", role: ctx.role }),
        })),
        podeCompartilhar: podeCompartilhar(ctx.role),
        funilPadrao: ctx.funilPadrao,
      },
      { requestId },
    );
  } catch (e) {
    return respostaDaRecusa(e, ctx.t, requestId);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const r = await contextoDaRota(requestId);
  if (!r.ok) return r.response;
  const { ctx } = r;
  const corpo = await lerCorpo(req, criarSchema, ctx.t, requestId);
  if (!corpo.ok) return corpo.response;
  const d = corpo.dados;
  if (d.compartilhado && !podeCompartilhar(ctx.role)) {
    return fail("forbidden", ctx.t("Só gestor e administrador compartilham com a equipe."), 403, { requestId });
  }
  try {
    const relatorio = await criarRelatorio(ctx.db, ctx.quem, {
      nome: d.nome,
      config: d.config as ConfigDoRelatorio,
      compartilhado: d.compartilhado ?? false,
      prontoDe: d.pronto_de ?? null,
      copiadoDe: d.copiado_de ?? null,
    });
    return ok({ relatorio }, { requestId, status: 201 });
  } catch (e) {
    return respostaDaRecusa(e, ctx.t, requestId);
  }
}
