/**
 * FORK MIA — as duas ferramentas do agente do WhatsApp para DOCUMENTOS E
 * OBRIGAÇÕES (docs/fork/obrigacoes.md).
 *
 * ─── A regra que manda no desenho: O AGENTE PROPÕE, A PESSOA CONFIRMA ──────
 *
 * `crm_listar_obrigacoes_pendentes` é leitura: o agente fica sabendo o que está
 * pendente com o cliente (documento a pedir, pedido e não entregue, vencendo ou
 * vencido, atividade recorrente chegando) para poder lembrar ou pedir na
 * conversa.
 *
 * `crm_propor_recebimento_de_documento` grava uma PROPOSTA: "o cliente mandou
 * um arquivo; é o alvará pedido?". Ela aparece no Foco do cartão aberto e na
 * ficha, com "Sim, marcar recebido" e "Não é". O agente NUNCA marca recebido:
 * reconhecer um documento pela conversa erra (foto errada, documento de outra
 * pessoa, versão vencida), e um "recebido" errado apaga o pedido, zera a
 * cobrança e dispara a automação de documento recebido. Quem responde por isso
 * é uma pessoa.
 *
 * ─── Por que a proposta só aceita arquivo de quem tem a ver com o item ─────
 *
 * A conversa é de um contato, e o item é de um negócio, de uma empresa ou de
 * um contato. A proposta só nasce quando os dois se encontram: o item é do
 * próprio contato, de um negócio dele, ou da empresa dele. Sem essa conferência
 * um agente confuso penduraria o arquivo de um cliente no documento de outro.
 *
 * O cliente do banco é o de serviço: toda consulta carrega o filtro de
 * organização.
 */
import { z } from "zod";

import { diaNoFuso, diaPorExtenso } from "@/lib/obrigacoes/datas";
import { grupoNoContato } from "@/lib/obrigacoes/heranca";
import { ROTULO_DA_SITUACAO, emDia, porUrgencia, situacao, urgencia } from "@/lib/obrigacoes/situacao";
import { COLUNAS_DA_OBRIGACAO, type Obrigacao } from "@/lib/obrigacoes/tipos";

import type { McpContext, McpToolDefinition } from "../types";

/** Os tipos de mensagem que carregam um arquivo que pode ser documento. */
const TIPOS_COM_ARQUIVO = ["document", "image"];

async function hojeDaOrganizacao(ctx: McpContext): Promise<string> {
  const { data } = await ctx.supabase.from("organizations").select("timezone").eq("id", ctx.organizationId).maybeSingle();
  return diaNoFuso(new Date(), (data as { timezone?: string | null } | null)?.timezone ?? null);
}

interface ContatoDoAgente {
  id: string;
  empresa_id: string | null;
  is_anonymized: boolean;
}

async function lerContato(ctx: McpContext, contactId: string): Promise<ContatoDoAgente | null> {
  const { data } = await ctx.supabase
    .from("contacts")
    .select("id, empresa_id, is_anonymized")
    .eq("organization_id", ctx.organizationId)
    .eq("id", contactId)
    .maybeSingle();
  return (data as ContatoDoAgente | null) ?? null;
}

/** Os itens que têm a ver com o contato: os dele, os da empresa dele e os dos negócios abertos dele. */
async function itensDoContato(ctx: McpContext, contato: ContatoDoAgente): Promise<{ itens: Obrigacao[]; negocios: Set<string> }> {
  const { data: leads } = await ctx.supabase
    .from("crm_leads")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("contact_id", contato.id)
    .eq("status", "open")
    .limit(50);
  const negocios = new Set(((leads ?? []) as Array<{ id: string }>).map((l) => l.id));

  const filtros = [`contact_id.eq.${contato.id}`];
  if (contato.empresa_id) filtros.push(`empresa_id.eq.${contato.empresa_id}`);
  if (negocios.size > 0) filtros.push(`lead_id.in.(${[...negocios].join(",")})`);
  const { data } = await ctx.supabase
    .from("mia_obrigacoes")
    .select(COLUNAS_DA_OBRIGACAO)
    .eq("organization_id", ctx.organizationId)
    .is("arquivado_em", null)
    .or(filtros.join(","))
    .limit(200);
  return { itens: (data ?? []) as unknown as Obrigacao[], negocios };
}

const formaDaLista = {
  contact_id: z.string().uuid().describe("O contato da conversa."),
};

export const crmListarObrigacoesPendentes: McpToolDefinition<typeof formaDaLista> = {
  name: "crm_listar_obrigacoes_pendentes",
  description:
    "Lista os DOCUMENTOS E OBRIGAÇÕES pendentes do cliente: documento ainda não pedido, pedido e não entregue, " +
    "vencendo ou vencido, e atividade recorrente chegando ou em atraso. Inclui o que é do próprio contato, da " +
    "empresa dele e dos negócios abertos dele. Use para saber o que pedir ou lembrar na conversa, e para achar o " +
    "`obrigacao_id` antes de propor que um arquivo recebido é um documento pedido. `quem_entrega: \"cliente\"` é o " +
    "que o cliente precisa mandar; `\"nos\"` é o que a empresa deve ao cliente. Não mostre os ids ao cliente.",
  inputSchema: formaDaLista,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const contato = await lerContato(ctx, input.contact_id);
    if (!contato) return { pendencias: [], motivo: "não encontrei esse contato nesta conta." };
    if (contato.is_anonymized) {
      return { pendencias: [], motivo: "esse contato exerceu o direito de exclusão de dados; não há documentos dele." };
    }
    const hoje = await hojeDaOrganizacao(ctx);
    const { itens } = await itensDoContato(ctx, contato);
    const pendentes = porUrgencia(
      itens.filter((i) => !emDia(i, hoje) && (i.categoria === "documento" || urgencia(i, hoje).tipo !== null)),
      hoje,
    );

    const { data: propostas } = pendentes.length
      ? await ctx.supabase
          .from("mia_obrigacoes_propostas")
          .select("obrigacao_id")
          .eq("organization_id", ctx.organizationId)
          .eq("situacao", "pendente")
          .in(
            "obrigacao_id",
            pendentes.map((i) => i.id),
          )
      : { data: [] };
    const comProposta = new Set(((propostas ?? []) as Array<{ obrigacao_id: string }>).map((p) => p.obrigacao_id));

    return {
      hoje: diaPorExtenso(hoje),
      pendencias: pendentes.map((i) => ({
        obrigacao_id: i.id,
        nome: i.nome,
        tipo: i.categoria,
        situacao: ROTULO_DA_SITUACAO[situacao(i, hoje)],
        quem_entrega: i.quem_entrega,
        ligado_a: grupoNoContato(i, contato) ?? "negocio",
        pedido_em: i.pedido_em,
        prazo_para_entregar: i.prazo_em,
        valido_ate: i.valido_ate,
        proxima_data: i.proxima_em,
        // Já há um arquivo esperando a equipe conferir: não peça de novo.
        arquivo_em_conferencia: comProposta.has(i.id),
      })),
      em_dia: itens.length - pendentes.length,
    };
  },
};

const formaDaProposta = {
  obrigacao_id: z.string().uuid().describe("O documento pedido, de crm_listar_obrigacoes_pendentes."),
  conversation_id: z.string().uuid().describe("A conversa em que o arquivo chegou."),
  message_id: z
    .string()
    .uuid()
    .optional()
    .describe("A mensagem que trouxe o arquivo. Sem isto, vale o arquivo mais recente que o cliente mandou na conversa."),
  nome_do_arquivo: z
    .string()
    .max(160)
    .optional()
    .describe("O nome do arquivo, se o cliente tiver mandado com nome."),
};

export const crmProporRecebimentoDeDocumento: McpToolDefinition<typeof formaDaProposta> = {
  name: "crm_propor_recebimento_de_documento",
  description:
    "Registra uma PROPOSTA de que o arquivo que o cliente mandou na conversa é um documento pedido (o `obrigacao_id` " +
    "vem de crm_listar_obrigacoes_pendentes). NÃO marca o documento como recebido: a proposta aparece para a equipe, " +
    "que confirma ou diz que não é. Use quando o cliente manda um arquivo e há um documento pedido que combina com " +
    "ele. Depois de propor, diga ao cliente que o arquivo foi recebido e que a equipe vai conferir; NUNCA diga que o " +
    "documento foi aprovado ou que está tudo certo. Só funciona para arquivo do próprio contato do item, do negócio " +
    "dele ou da empresa dele.",
  inputSchema: formaDaProposta,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  // O nome do arquivo pode carregar nome de gente ("cnh-fulano.pdf"): fica fora da auditoria.
  redigirParaAuditoria: ({ nome_do_arquivo: _nome, ...resto }) => resto,
  handler: async (input, ctx) => {
    const org = ctx.organizationId;
    const { data: itemBruto } = await ctx.supabase
      .from("mia_obrigacoes")
      .select(COLUNAS_DA_OBRIGACAO)
      .eq("organization_id", org)
      .eq("id", input.obrigacao_id)
      .maybeSingle();
    const item = itemBruto as unknown as Obrigacao | null;
    if (!item || item.arquivado_em) {
      return { registrada: false, motivo: "não encontrei esse documento. Consulte crm_listar_obrigacoes_pendentes." };
    }
    if (item.categoria !== "documento") {
      return { registrada: false, motivo: "esse item é uma atividade recorrente, não um documento: não recebe arquivo." };
    }

    const { data: conversa } = await ctx.supabase
      .from("conversations")
      .select("id, contact_id")
      .eq("organization_id", org)
      .eq("id", input.conversation_id)
      .maybeSingle();
    const contatoId = (conversa as { contact_id?: string | null } | null)?.contact_id ?? null;
    if (!conversa || !contatoId) {
      return { registrada: false, motivo: "não encontrei essa conversa nesta conta." };
    }
    const contato = await lerContato(ctx, contatoId);
    if (!contato || contato.is_anonymized) {
      return { registrada: false, motivo: "o contato desta conversa não pode ter documentos registrados." };
    }

    // O arquivo só entra em item que tem a ver com quem mandou.
    let pertence = item.contact_id === contato.id || (item.empresa_id !== null && item.empresa_id === contato.empresa_id);
    if (!pertence && item.lead_id) {
      const { data: lead } = await ctx.supabase
        .from("crm_leads")
        .select("id, contact_id, empresa_id")
        .eq("organization_id", org)
        .eq("id", item.lead_id)
        .maybeSingle();
      const l = lead as { contact_id: string | null; empresa_id: string | null } | null;
      pertence = Boolean(l && (l.contact_id === contato.id || (l.empresa_id !== null && l.empresa_id === contato.empresa_id)));
    }
    if (!pertence) {
      return {
        registrada: false,
        motivo: "esse documento não é deste contato, nem de um negócio ou da empresa dele. Confira o item em crm_listar_obrigacoes_pendentes.",
      };
    }

    // A mensagem: a indicada, ou o arquivo mais recente que o cliente mandou.
    let consulta = ctx.supabase
      .from("messages")
      .select("id, type, body, media_mime, sent_at")
      .eq("organization_id", org)
      .eq("conversation_id", input.conversation_id)
      .eq("direction", "inbound")
      .in("type", TIPOS_COM_ARQUIVO);
    if (input.message_id) consulta = consulta.eq("id", input.message_id);
    const { data: mensagens } = await consulta.order("sent_at", { ascending: false }).limit(1);
    const mensagem = ((mensagens ?? []) as Array<{ id: string; type: string; body: string | null; media_mime: string | null }>)[0];
    if (!mensagem) {
      return {
        registrada: false,
        motivo: "não encontrei arquivo (documento ou imagem) recebido do cliente nesta conversa.",
      };
    }

    const nome =
      input.nome_do_arquivo?.trim() ||
      // O WhatsApp manda o nome do documento como legenda; legenda longa é texto, não nome.
      (mensagem.type === "document" && mensagem.body && mensagem.body.trim().length <= 120 ? mensagem.body.trim() : null);
    const proposta = {
      ciclo: item.ciclo,
      contact_id: contato.id,
      conversation_id: input.conversation_id,
      message_id: mensagem.id,
      arquivo_nome: nome,
      arquivo_mime: mensagem.media_mime,
      // O agente de `ai_agents`, e não o id do turno: é quem a equipe reconhece.
      proposta_por_agente_id: ctx.actor.type === "ai_agent" ? (ctx.actor.agent_id ?? null) : null,
      created_at: new Date().toISOString(),
    };

    // Uma proposta pendente por item: a mais nova substitui a anterior.
    const { data: atualizada, error: erroAoAtualizar } = await ctx.supabase
      .from("mia_obrigacoes_propostas")
      .update(proposta)
      .eq("organization_id", org)
      .eq("obrigacao_id", item.id)
      .eq("situacao", "pendente")
      .select("id");
    if (erroAoAtualizar) return { registrada: false, motivo: "não consegui registrar a proposta agora." };
    if (((atualizada ?? []) as unknown[]).length === 0) {
      const { error } = await ctx.supabase
        .from("mia_obrigacoes_propostas")
        .insert({ ...proposta, organization_id: org, obrigacao_id: item.id, situacao: "pendente" });
      if (error) return { registrada: false, motivo: "não consegui registrar a proposta agora." };
    }

    return {
      registrada: true,
      documento: item.nome,
      // O que o modelo faz em seguida, dito na resposta para não depender do prompt.
      o_que_dizer:
        "Avise que o arquivo foi recebido e que a equipe vai conferir. Não diga que o documento foi aprovado: quem confirma é uma pessoa.",
    };
  },
};
