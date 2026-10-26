/**
 * FORK MIA (.91) — as PROPOSTAS DO ASSISTENTE no MCP de plataforma
 * (docs/fork/primeiros-passos.md). Duas, e a operação do token segue o estrago:
 *
 *   plataforma_ver_propostas_do_assistente     leitura: as propostas de uma
 *                                              empresa (o que muda, a
 *                                              situação, a peça criada) e a
 *                                              evolução do "o que falta"
 *   plataforma_decidir_proposta_do_assistente  `implantar_configuracao`: a
 *                                              Time aplica ou recusa uma
 *                                              proposta, pelo MESMO caminho do
 *                                              cartão (`decidirProposta`)
 *
 * O MCP não PROPÕE: propor é do assistente, na conversa da pessoa. E aplicar
 * pelo MCP faz exatamente o que o "Aprovar e aplicar" faz: a peça nasce em
 * rascunho (agente e follow-up) e nada é publicado.
 */
import { z } from "zod";

import { decidirProposta } from "@/lib/assistente/propostas/decidir";
import { COLUNAS_DA_PROPOSTA, SITUACOES_DA_PROPOSTA } from "@/lib/assistente/propostas/tipos";
import { lerEvolucao } from "@/lib/assistente/retratos";

import { Recusa } from "../recusa";
import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORG_DE_EXEMPLO, ORGANIZACAO } from "./comum";

export const FERRAMENTAS_DAS_PROPOSTAS_DO_ASSISTENTE: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_propostas_do_assistente",
    description:
      "As PROPOSTAS que o assistente da MIA preparou numa empresa (o agente do modelo do segmento, o funil do quadro pronto e o follow-up do modelo): " +
      "o que cada uma muda, a situação (pendente, aprovada, aplicada, rejeitada, expirada), quando foi decidida, a peça que o aplicar criou e, " +
      "para o follow-up, se já saiu junto com o agente publicado. Traz também a evolução do \"o que falta\" (os retratos: ao entrar faltavam N, o último e quando zerou). " +
      "QUANDO USAR: para acompanhar uma empresa que entrou sozinha, antes de decidir uma proposta com plataforma_decidir_proposta_do_assistente. " +
      "O QUE NÃO FAZ: não mostra o texto do agente proposto e não grava nada.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      situacao: z.enum(SITUACOES_DA_PROPOSTA).optional().describe("Só as de uma situação. Sem ela, as 50 mais novas."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, situacao: "pendente" },
    operacao: null,
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      let q = c.admin
        .from("mia_assistente_propostas")
        .select(COLUNAS_DA_PROPOSTA)
        .eq("organization_id", c.orgId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (typeof args.situacao === "string") q = q.eq("situacao", args.situacao);
      const { data, error } = await q;
      if (error) throw new Error(`não consegui ler as propostas: ${error.message}`);
      const evolucao = await lerEvolucao(c.admin, c.orgId).catch(() => null);
      return {
        propostas: (data ?? []) as unknown[],
        evolucao_do_que_falta: evolucao,
      };
    },
  },
  {
    name: "plataforma_decidir_proposta_do_assistente",
    description:
      "Decide uma proposta do assistente da MIA, como a administradora decide no cartão: `aplicar` aprova e cria a peça (o agente em RASCUNHO, " +
      "o funil do quadro pronto no lugar do de e-commerce que veio com a empresa, ou o follow-up em rascunho armado no agente para sair junto quando ele for publicado); " +
      "`rejeitar` recusa. A ordem é do banco: pendente vira aprovada e só então aplicada; se a peça falhar, a proposta continua aprovada com o erro, " +
      "e chamar de novo retoma. Repetir num proposta aplicada devolve `ja_estava`. " +
      "O QUE NÃO FAZ: não publica nada (publicar o agente é clique humano) e não cria proposta.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      proposta_id: z.string().uuid().describe("O id da proposta, de plataforma_ver_propostas_do_assistente."),
      decisao: z.enum(["aplicar", "rejeitar"]).describe('"aplicar" ou "rejeitar".'),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, proposta_id: "00000000-0000-4000-8000-000000000091", decisao: "aplicar" },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const r = await decidirProposta(
        { admin: c.admin, orgId: c.orgId, userId: c.autorUserId, requestId: c.requestId, via: "mcp_plataforma" },
        String(args.proposta_id),
        args.decisao === "rejeitar" ? "rejeitar" : "aplicar",
      );
      if (!r.ok) {
        if (r.codigo === "falhou") {
          return { ok: false, desfecho: "falhou", mensagem: r.mensagem, proposta: r.proposta ?? null };
        }
        throw new Recusa(r.mensagem);
      }
      return { ok: true, desfecho: r.desfecho, proposta: r.proposta, avisos: r.avisos };
    },
  },
];
