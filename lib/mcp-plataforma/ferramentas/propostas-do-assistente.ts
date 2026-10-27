/**
 * FORK MIA (.91, .94) — as PROPOSTAS DO ASSISTENTE no MCP de plataforma
 * (docs/fork/primeiros-passos.md e docs/fork/assistente.md). Três, e a operação
 * do token segue o estrago:
 *
 *   plataforma_ver_propostas_do_assistente      leitura: as propostas de uma
 *                                               empresa (as três do modelo e as
 *                                               nove do dia a dia), quem pediu,
 *                                               quem aprovou, os pedidos, o
 *                                               desfazer e o que o trava, e a
 *                                               evolução do "o que falta"
 *   plataforma_decidir_proposta_do_assistente   `implantar_configuracao`: a
 *                                               Time aplica ou recusa, pelo
 *                                               MESMO caminho do cartão
 *                                               (`decidirProposta`)
 *   plataforma_desfazer_proposta_do_assistente  `implantar_configuracao` (.94):
 *                                               desfaz pelo MESMO caminho do
 *                                               botão, com as mesmas travas
 *                                               (`desfazerProposta`)
 *
 * O MCP não PROPÕE: propor é do assistente, na conversa da pessoa. E aplicar
 * pelo MCP faz exatamente o que o "Aprovar e aplicar" faz: nada é publicado e
 * nenhuma mensagem sai. Nada da lista do "nunca" (número, cobrança, convite,
 * usuários, chaves, apagar, publicar, mensagem a cliente) passa por aqui.
 */
import { z } from "zod";

import { CATALOGO_DAS_PECAS } from "@/lib/assistente/propostas/catalogo";
import { decidirProposta } from "@/lib/assistente/propostas/decidir";
import { desfazerProposta, travaDoDesfazer } from "@/lib/assistente/propostas/desfazer";
import { regraDeAprovacao } from "@/lib/assistente/propostas/quem-aprova";
import {
  COLUNAS_DA_PROPOSTA,
  SITUACOES_DA_PROPOSTA,
  TIPOS_DE_PROPOSTA,
  type PedidoDaProposta,
  type PropostaLida,
} from "@/lib/assistente/propostas/tipos";
import { lerEvolucao } from "@/lib/assistente/retratos";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

import { Recusa } from "../recusa";
import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORG_DE_EXEMPLO, ORGANIZACAO } from "./comum";

const PROPOSTA = z.string().uuid().describe("O id da proposta, de plataforma_ver_propostas_do_assistente.");

export const FERRAMENTAS_DAS_PROPOSTAS_DO_ASSISTENTE: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_propostas_do_assistente",
    description:
      "As PROPOSTAS que o assistente da MIA preparou numa empresa: as três do modelo do segmento (agente, funil do quadro pronto, follow-up do modelo) e as nove do dia a dia " +
      "(criar e renomear etapa, resposta rápida, etiqueta, tarefa, rascunho de follow-up, item de conhecimento, relatório, meta do mês). " +
      "De cada uma: o que muda, a situação (pendente, aprovada, aplicada, rejeitada, expirada, desfeita), QUEM PEDIU, a quem foi pedida (o pedido com o cartão pronto), " +
      "QUEM APROVOU, quem aprova aquele tipo, a peça que o aplicar criou, se foi desfeita e por quem, e, na aplicada, o que TRAVA o desfazer agora. " +
      "Separa os PEDIDOS que esperam quem aprova. Traz também a evolução do \"o que falta\". " +
      "QUANDO USAR: para acompanhar uma empresa, antes de decidir (plataforma_decidir_proposta_do_assistente) ou de desfazer (plataforma_desfazer_proposta_do_assistente). " +
      "O QUE NÃO FAZ: não mostra o texto do agente proposto nem a conversa de ninguém, e não grava nada.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      situacao: z.enum(SITUACOES_DA_PROPOSTA).optional().describe("Só as de uma situação. Sem ela, as 50 mais novas."),
      tipo: z.enum(TIPOS_DE_PROPOSTA).optional().describe("Só as de um tipo."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, situacao: "aplicada" },
    operacao: null,
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      let q = c.admin
        .from("mia_assistente_propostas")
        .select(`${COLUNAS_DA_PROPOSTA}, pedido`)
        .eq("organization_id", c.orgId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (typeof args.situacao === "string") q = q.eq("situacao", args.situacao);
      if (typeof args.tipo === "string") q = q.eq("tipo", args.tipo);
      const { data, error } = await q;
      if (error) throw new Error(`não consegui ler as propostas: ${error.message}`);
      const linhas = (data ?? []) as Array<PropostaLida & { pedido: unknown }>;
      const nomes = await nomesDosAtendentes(
        linhas.flatMap((p) => [p.criada_por, p.pedida_a, p.aprovada_por, p.rejeitada_por, p.desfeita_por]),
      ).catch(() => new Map<string, string | null>());
      const nome = (id: string | null) => (id ? (nomes.get(id) ?? "alguém da equipe") : null);
      const propostas = await Promise.all(
        linhas.map(async (p) => {
          const { pedido: _pedido, ...linha } = p;
          void _pedido;
          const regra = regraDeAprovacao({ tipo: p.tipo, pedido: p.pedido } as PedidoDaProposta, p.criada_por);
          const trava = p.situacao === "aplicada" ? await travaDoDesfazer(c.admin, c.orgId, p).catch(() => null) : null;
          return {
            ...linha,
            peca: CATALOGO_DAS_PECAS[p.tipo]?.rotulo ?? p.tipo,
            origem: CATALOGO_DAS_PECAS[p.tipo]?.origem === "noventa_e_um" ? ".91" : ".94",
            quem_pediu: nome(p.criada_por),
            pedida_a_nome: nome(p.pedida_a),
            aprovada_por_nome: nome(p.aprovada_por),
            rejeitada_por_nome: nome(p.rejeitada_por),
            desfeita_por_nome: nome(p.desfeita_por),
            quem_aprova: regra.rotulo,
            desfazer: CATALOGO_DAS_PECAS[p.tipo]?.desfazer ?? null,
            ...(p.situacao === "aplicada" ? { da_para_desfazer: !trava, trava_do_desfazer: trava?.motivo ?? null } : {}),
          };
        }),
      );
      const evolucao = await lerEvolucao(c.admin, c.orgId).catch(() => null);
      return {
        propostas,
        pedidos_esperando: propostas.filter((p) => p.situacao === "pendente" && p.pedida_em).map((p) => p.id),
        evolucao_do_que_falta: evolucao,
      };
    },
  },
  {
    name: "plataforma_decidir_proposta_do_assistente",
    description:
      "Decide uma proposta do assistente da MIA, como quem aprova decide no cartão: `aplicar` aprova e cria a peça (as do modelo em RASCUNHO; a etapa, a resposta rápida, a etiqueta, " +
      "a tarefa, o rascunho de follow-up, o item de conhecimento, o relatório ou a meta pela mesma função da tela); `rejeitar` recusa. " +
      "A peça \"só de quem pediu\" (resposta e relatório) continua dela. A ordem é do banco: pendente vira aprovada e só então aplicada; se a peça falhar, " +
      "a proposta continua aprovada com o erro, e chamar de novo retoma. Repetir numa proposta aplicada devolve `ja_estava`. Quem pediu recebe o resultado no sino. " +
      "O QUE NÃO FAZ: não publica nada (publicar o agente ou o follow-up é clique humano), não manda mensagem e não cria proposta.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      proposta_id: PROPOSTA,
      decisao: z.enum(["aplicar", "rejeitar"]).describe('"aplicar" ou "rejeitar".'),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, proposta_id: "00000000-0000-4000-8000-000000000091", decisao: "aplicar" },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const r = await decidirProposta(
        { admin: c.admin, db: c.admin, pelaSessao: false, orgId: c.orgId, userId: c.autorUserId, papel: "admin", requestId: c.requestId, via: "mcp_plataforma" },
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
  {
    name: "plataforma_desfazer_proposta_do_assistente",
    description:
      "DESFAZ uma proposta APLICADA do assistente da MIA, pelo mesmo caminho do botão Desfazer do cartão e com as mesmas travas. Desfazer não é apagar: tira só o que a própria proposta fez, " +
      "e só enquanto nada depende disso (a etapa sem negócio, a etiqueta sem uso, a resposta que ninguém editou, a tarefa não concluída, o rascunho não publicado, o relatório fora de painel, " +
      "a meta que ninguém mudou, o agente nunca publicado, o funil sem negócio, o follow-up que não saiu com o agente; o item de conhecimento sai sempre). " +
      "Travada, devolve `ok: false`, `desfecho: \"travada\"` e a frase do porquê, sem mexer em nada. Repetir numa proposta já desfeita devolve `ja_estava`. Quem pediu recebe o aviso. " +
      "O QUE NÃO FAZ: não apaga o que já estava no sistema, não desfaz proposta pendente ou recusada e não publica nada.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      proposta_id: PROPOSTA,
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, proposta_id: "00000000-0000-4000-8000-000000000092" },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const r = await desfazerProposta(
        {
          db: c.admin,
          admin: c.admin,
          pelaSessao: false,
          orgId: c.orgId,
          userId: c.autorUserId,
          nome: "a Time Company",
          papel: "admin",
          requestId: c.requestId,
          via: "mcp_plataforma",
        },
        String(args.proposta_id),
        { conferirQuem: false },
      );
      if (!r.ok) {
        if (r.codigo === "travada" || r.codigo === "falhou" || r.codigo === "nao_aplicada") {
          return { ok: false, desfecho: r.codigo, mensagem: r.mensagem, proposta: r.proposta ?? null };
        }
        throw new Recusa(r.mensagem);
      }
      return { ok: true, desfecho: r.desfecho, proposta: r.proposta, avisos: r.avisos };
    },
  },
];
