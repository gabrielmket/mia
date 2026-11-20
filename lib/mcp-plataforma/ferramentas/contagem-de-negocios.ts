/**
 * FORK MIA (upstream 1.117, MIA-67): `plataforma_contar_negocios`, a contagem
 * dos negócios de um cliente sem abrir nenhum.
 *
 * O upstream trouxe `crm_count_leads` para o MCP de dentro (o da empresa) com a
 * porta `countLeadsHandler` (`app/api/v1/leads/_handler.ts`): só números, a
 * mesma régua de visibilidade da listagem (o negócio de contato pessoal não
 * conta). A implantação precisa da mesma pergunta ("quantos negócios a
 * importação deixou em cada etapa?", "a demonstração ficou com o funil cheio?")
 * e chama a MESMA porta, para os números fecharem com o quadro e com o que o
 * agente da empresa responde. Nada aqui lê nome, telefone ou título.
 */
import { z } from "zod";

import { countLeadsHandler } from "@/app/api/v1/leads/_handler";
import { acharPorNomeOuId } from "@/lib/implantacao/base";

import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

/** A situação como o implantador fala, e como o banco grava. */
const SITUACAO = { aberto: "open", ganho: "won", perdido: "lost" } as const;
type Situacao = keyof typeof SITUACAO;

export const FERRAMENTAS_DA_CONTAGEM_DE_NEGOCIOS: FerramentaDePlataforma[] = [
  {
    name: "plataforma_contar_negocios",
    description:
      "Conta os negócios (oportunidades do funil) de um cliente e devolve SÓ números: o total e, sem filtro de situação, o total por situação " +
      "(aberto, ganho, perdido). Filtra por `funil`, `etapa` e `situacao`. É a mesma conta da ferramenta `crm_count_leads` do MCP da empresa e do quadro: " +
      "o negócio de contato marcado como pessoal não entra. " +
      "QUANDO USAR: depois de uma importação de negócios, para conferir quantos ficaram em cada etapa, e para ver se a empresa de demonstração ficou com o funil cheio. " +
      "O QUE NÃO FAZ: não lista os negócios nem devolve nome, título ou valor (para isso, a pessoa abre o quadro); não conta contatos.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      funil: z.string().trim().min(1).max(120).optional().describe("Nome ou id de um funil (de plataforma_ver_funis). Sem isto, conta todos os funis."),
      etapa: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .describe("Nome ou id de uma etapa. Com `funil`, procura só nele; sem, o nome precisa ser único na empresa."),
      situacao: z
        .enum(Object.keys(SITUACAO) as [Situacao, ...Situacao[]])
        .optional()
        .describe('"aberto", "ganho" ou "perdido". Sem isto, a resposta traz o total e o total por situação.'),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, funil: "Vendas", situacao: "aberto" },
    operacao: null,
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);

      let funil: { id: string; name: string } | null = null;
      if (typeof args.funil === "string") {
        const { data, error } = await c.admin.from("crm_pipelines").select("id, name").eq("organization_id", c.orgId);
        if (error) throw new Error(`não consegui ler os funis: ${error.message}`);
        funil = acharPorNomeOuId((data ?? []) as Array<{ id: string; name: string }>, args.funil, (f) => f.name, {
          singular: "o funil",
          comoListar: "Os funis saem de plataforma_ver_funis.",
        });
      }

      let etapa: { id: string; name: string; pipeline_id: string } | null = null;
      if (typeof args.etapa === "string") {
        let q = c.admin.from("crm_stages").select("id, name, pipeline_id").eq("organization_id", c.orgId);
        if (funil) q = q.eq("pipeline_id", funil.id);
        const { data, error } = await q;
        if (error) throw new Error(`não consegui ler as etapas: ${error.message}`);
        etapa = acharPorNomeOuId(
          (data ?? []) as Array<{ id: string; name: string; pipeline_id: string }>,
          args.etapa,
          (e) => e.name,
          {
            singular: "a etapa",
            comoListar: funil
              ? `As etapas do funil «${funil.name}» saem de plataforma_ver_funis.`
              : "Informe também `funil`, ou veja as etapas em plataforma_ver_funis.",
          },
        );
      }

      const situacao = typeof args.situacao === "string" ? (args.situacao as Situacao) : undefined;
      const contagem = await countLeadsHandler(
        c.admin,
        {
          organization_id: c.orgId,
          actor: { type: "user", id: ctx.autorUserId, role: "admin" },
          requestId: ctx.requestId,
        },
        {
          ...(funil ? { pipeline_id: funil.id } : {}),
          ...(etapa ? { stage_id: etapa.id } : {}),
          ...(situacao ? { status: SITUACAO[situacao] } : {}),
        },
      );

      return {
        filtros: {
          funil: funil ? { id: funil.id, nome: funil.name } : null,
          etapa: etapa ? { id: etapa.id, nome: etapa.name } : null,
          situacao: situacao ?? null,
        },
        total: contagem.total,
        ...(contagem.by_status
          ? {
              por_situacao: {
                aberto: contagem.by_status.open,
                ganho: contagem.by_status.won,
                perdido: contagem.by_status.lost,
              },
            }
          : {}),
      };
    },
  },
];
