/**
 * FORK MIA (.94) · AS NOVE FERRAMENTAS DO "FAZ COM APROVAÇÃO" (protótipo
 * "ensina e faz", tela 3). Cada uma PREPARA o cartão de uma peça, lendo com a
 * SESSÃO de quem pergunta, e não grava nada: a rota grava a linha pendente, e a
 * peça nasce no "Aprovar e aplicar" de quem pode.
 *
 * Só entram as que a empresa deixou ligadas (`mia_assistente_config`,
 * `tipos_de_proposta`). O somente leitura não propõe; a meta, só gestor em
 * diante. Quem não aprova recebe o cartão com o "Pedir a <nome>".
 *
 * Para a lista do "nunca" (número e canal, cobrança e plano, convite, usuários
 * e papéis, chaves e tokens, apagar, publicar agente, mensagem a cliente) NÃO
 * existe ferramenta, aqui nem em lugar nenhum (`nunca.ts`, e a cerca
 * `assistente-faz-com-aprovacao` reprova quem criar uma).
 *
 * Este arquivo não importa o cliente de serviço.
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { roleAtLeast, type Role } from "@/lib/auth/types";

import type { PessoaDaEquipe } from "../leituras/comum";
import type { TelaConhecida } from "../telas";
import { hrefDoApp, type AcaoDoAssistente } from "../tipos";
import type { Preparacao } from "./preparar";
import {
  prepararEtapaNova,
  prepararEtiqueta,
  prepararItemDeConhecimento,
  prepararMeta,
  prepararRascunhoDeFollowup,
  prepararRelatorio,
  prepararRenomearEtapa,
  prepararResposta,
  prepararTarefa,
  type ContextoDaPreparacao,
} from "./preparar-do-dia-a-dia";
import { aQuemPedir, podeAprovar, podePropor, regraDeAprovacao } from "./quem-aprova";
import type { PedidoDaProposta, PropostaDoTurno, TipoDeProposta, TipoDoDiaADia } from "./tipos";

/** O que as ferramentas do dia a dia precisam do contexto do turno. */
export interface ContextoDoDiaADia {
  db: ContextoDaPreparacao["db"];
  organizationId: string;
  userId: string;
  papel: Role;
  idioma: string;
  fuso: string;
  agora: Date;
  telas: readonly TelaConhecida[];
  equipe: readonly PessoaDaEquipe[];
  /** Os tipos ligados na empresa; `null`/ausente = todos. */
  tiposDePropostas?: readonly TipoDeProposta[] | null;
}

/** O pedaço do coletor do turno que estas ferramentas usam. */
export interface ColetorDoDiaADia {
  anotar(nome: string, fontes?: readonly string[], contatos?: readonly string[]): void;
  proposta(p: PropostaDoTurno): void;
  acao(a: AcaoDoAssistente): void;
  foraDaPermissao: boolean;
}

export function tipoLigado(ctx: Pick<ContextoDoDiaADia, "tiposDePropostas">, tipo: TipoDeProposta): boolean {
  return !ctx.tiposDePropostas || ctx.tiposDePropostas.includes(tipo);
}

/** As fontes do "de onde veio" de cada preparação. */
export const FONTES_DO_DIA_A_DIA: Record<TipoDoDiaADia, readonly string[]> = {
  etapa_criar: ["Etapas do funil"],
  etapa_renomear: ["Etapas do funil"],
  resposta: ["Respostas rápidas"],
  etiqueta: ["Etiquetas"],
  tarefa: ["Tarefas", "Equipe"],
  rascunho_de_followup: ["Follow-ups", "Modelos de follow-up"],
  conhecimento: ["Conhecimento", "Agentes de IA"],
  relatorio: ["Relatórios"],
  meta: ["Metas"],
};

/** O "Me leva lá" só para tela que a pessoa abre (o mesmo corte de `destinoPermitido`). */
function telaQueAbre(telas: readonly TelaConhecida[], href: string): boolean {
  const valido = hrefDoApp(href);
  if (!valido) return false;
  const caminho = valido.split("?")[0]!;
  return telas.some((t) => t.abre && (caminho === t.href || caminho.startsWith(`${t.href}/`)));
}

async function propor(
  ctx: ContextoDoDiaADia,
  coletor: ColetorDoDiaADia,
  nome: string,
  tipo: TipoDoDiaADia,
  preparar: (c: ContextoDaPreparacao) => Promise<Preparacao>,
) {
  coletor.anotar(nome, FONTES_DO_DIA_A_DIA[tipo]);
  if (!podePropor(tipo, ctx.papel)) {
    coletor.foraDaPermissao = true;
    return {
      fora_da_permissao: true,
      orientacao:
        tipo === "meta"
          ? "Diga que a meta da equipe não aparece para o papel da pessoa pelo assistente, então você não prepara; quem vê e decide é o administrador."
          : "Diga que a conta somente leitura não pede mudanças pelo assistente.",
    };
  }
  try {
    const r = await preparar({
      db: ctx.db,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      papel: ctx.papel,
      equipe: ctx.equipe,
      fuso: ctx.fuso,
      agora: ctx.agora,
      idioma: ctx.idioma,
    });
    if (!r.ok) {
      if (r.href && telaQueAbre(ctx.telas, r.href)) coletor.acao({ tipo: "ir", rotulo: "Me leva lá", href: hrefDoApp(r.href)! });
      return {
        ok: false,
        motivo: r.motivo,
        mensagem: r.mensagem,
        orientacao:
          r.motivo === "ja_existe"
            ? "Diga o que já existe e onde mexer, sem preparar outra proposta."
            : "Diga em uma frase por que não deu, com a mensagem, e pergunte o que a pessoa quer.",
      };
    }
    coletor.proposta(r.proposta);
    const regra = regraDeAprovacao({ tipo, pedido: r.proposta.pedido } as PedidoDaProposta, ctx.userId);
    const aprova = podeAprovar(regra, { userId: ctx.userId, papel: ctx.papel }, ctx.userId);
    const quem = aQuemPedir(regra, ctx.equipe, ctx.userId).map((p) => p.nome);
    return {
      ok: true,
      proposta: { titulo: r.proposta.titulo, o_que_muda: r.proposta.mudancas },
      quem_aprova: regra.rotulo,
      voce_aprova: aprova,
      ...(aprova ? {} : { pedir_a: quem }),
      orientacao: aprova
        ? "Diga em uma ou duas frases que preparou o cartão, que nada muda até a pessoa clicar em Aprovar e aplicar, e que depois o Desfazer fica no cartão."
        : `Diga que preparou o cartão e que quem aprova é ${quem[0] ?? "quem administra"} (${regra.rotulo}); a pessoa pode clicar em "Pedir a" no cartão, que vai pronto e o resultado volta para ela. Não ofereça aplicar.`,
    };
  } catch {
    return { erro: "Não consegui preparar agora. Diga que não deu e sugira tentar de novo em instantes." };
  }
}

const PARA = z.enum(["eu", "equipe"]);

export function ferramentasDoDiaADia(ctx: ContextoDoDiaADia, coletor: ColetorDoDiaADia): ToolSet {
  const todas: Record<TipoDoDiaADia, [string, ToolSet[string]]> = {
    etapa_criar: [
      "propor_etapa_do_funil",
      tool({
        description:
          "PREPARA o cartão de CRIAR UMA ETAPA num funil, antes de outra etapa (ex.: \"Pediu orçamento\" antes de \"Quer agendar\"). Nada muda agora: aprova quem cria etapa na tela (gestor ou administrador). " +
          "Três etapas são três cartões: chame uma vez por etapa.",
        inputSchema: z.object({
          nome: z.string().trim().min(2).max(80).describe("O nome da etapa nova."),
          antes_de: z.string().trim().max(80).optional().describe("O nome da etapa que fica DEPOIS da nova. Sem ele, ela entra antes da etapa de ganho."),
          funil: z.string().trim().max(120).optional().describe("O nome do funil. Sem ele, o funil padrão."),
        }),
        execute: async (a) => propor(ctx, coletor, "propor_etapa_do_funil", "etapa_criar", (c) => prepararEtapaNova(c, a)),
      }),
    ],
    etapa_renomear: [
      "propor_renomear_etapa",
      tool({
        description:
          "PREPARA o cartão de RENOMEAR UMA ETAPA de um funil. As automações e o agente que usam a etapa seguem funcionando (olham a etapa, não o nome). Aprova gestor ou administrador.",
        inputSchema: z.object({
          de: z.string().trim().min(1).max(80).describe("O nome de agora."),
          para: z.string().trim().min(2).max(80).describe("O nome novo."),
          funil: z.string().trim().max(120).optional().describe("O nome do funil. Sem ele, o funil padrão."),
        }),
        execute: async (a) => propor(ctx, coletor, "propor_renomear_etapa", "etapa_renomear", (c) => prepararRenomearEtapa(c, a)),
      }),
    ],
    resposta: [
      "propor_resposta_rapida",
      tool({
        description:
          "PREPARA o cartão de uma RESPOSTA RÁPIDA (o texto que a equipe insere na conversa pelo atalho, ex.: /endereco). Ela não sai para ninguém sozinha. " +
          '`para`: "eu" (só de quem pede; a própria pessoa aprova) ou "equipe" (de todos; gestor ou administrador aprova). Sem `para`, a do atendente é dele e a do gestor é da equipe.',
        inputSchema: z.object({
          atalho: z.string().trim().min(2).max(41).describe('O atalho, com ou sem a barra: "/endereco".'),
          texto: z.string().trim().min(3).max(4096).describe("O texto que entra na conversa."),
          titulo: z.string().trim().max(80).optional().describe("Como aparece na lista. Sem ele, o atalho."),
          para: PARA.optional(),
        }),
        execute: async (a) => propor(ctx, coletor, "propor_resposta_rapida", "resposta", (c) => prepararResposta(c, a)),
      }),
    ],
    etiqueta: [
      "propor_etiqueta",
      tool({
        description:
          "PREPARA o cartão de uma ETIQUETA nova no vocabulário da empresa, com a cor. Aprova gestor ou administrador. Pôr a etiqueta em contatos não é aqui: é pela tela.",
        inputSchema: z.object({
          nome: z.string().trim().min(2).max(60).describe("O nome da etiqueta."),
          cor: z
            .string()
            .trim()
            .max(20)
            .optional()
            .describe("A cor pelo nome: amarelo, âmbar, vermelho, verde, azul, índigo, roxo ou cinza. Sem ela, uma que ainda não está em uso."),
        }),
        execute: async (a) => propor(ctx, coletor, "propor_etiqueta", "etiqueta", (c) => prepararEtiqueta(c, a)),
      }),
    ],
    tarefa: [
      "propor_tarefa",
      tool({
        description:
          "PREPARA o cartão de uma TAREFA, com dia e hora. Para a própria pessoa, ela mesma aprova; para outra pessoa da equipe, aprova gestor ou administrador. " +
          "Não ponha telefone nem e-mail no título.",
        inputSchema: z.object({
          titulo: z.string().trim().min(3).max(255).describe('O que fazer, ex.: "Ligar para o Rogério sobre a limpeza".'),
          quando: z
            .string()
            .trim()
            .max(40)
            .describe('Dia e hora, na hora da empresa, como "2026-10-27T10:00". Calcule "amanhã às 10h" a partir de agora.'),
          para_user_id: z.string().uuid().optional().describe("Para outra pessoa da equipe (o user_id da equipe). Sem ele, para quem pede."),
        }),
        execute: async (a) => propor(ctx, coletor, "propor_tarefa", "tarefa", (c) => prepararTarefa(c, a)),
      }),
    ],
    rascunho_de_followup: [
      "propor_rascunho_de_followup",
      tool({
        description:
          "PREPARA o cartão de um FOLLOW-UP em RASCUNHO, com as mensagens escritas: começa depois de 24 h sem resposta e é uma escada de TRÊS mensagens (a 2ª e a 3ª só saem se a pessoa não responder). " +
          "Nasce em rascunho: nenhuma mensagem sai até alguém publicar na tela. Aprova gestor ou administrador. Para o follow-up PRONTO do modelo do segmento, use propor_followup_do_modelo.",
        inputSchema: z.object({
          nome: z.string().trim().min(3).max(80).describe('O nome do fluxo, ex.: "Orçamento · retomar quem pediu e sumiu".'),
          mensagens: z.array(z.string().trim().min(1).max(1000)).length(3).describe("As três mensagens, na ordem. Para o nome da pessoa, use {{primeiro_nome}}."),
          esperas_dias: z
            .array(z.number().int().min(1).max(14))
            .length(2)
            .optional()
            .describe("Os dias entre a 1ª e a 2ª e entre a 2ª e a 3ª. Padrão [2, 4]."),
        }),
        execute: async (a) => propor(ctx, coletor, "propor_rascunho_de_followup", "rascunho_de_followup", (c) => prepararRascunhoDeFollowup(c, a)),
      }),
    ],
    conhecimento: [
      "propor_item_de_conhecimento",
      tool({
        description:
          "PREPARA o cartão de pôr um ITEM NO CONHECIMENTO que o agente consulta para responder o cliente (ex.: o estacionamento, o endereço, um convênio). " +
          "Entra LIGADO: o cartão avisa se o agente no ar passa a usar na próxima conversa. Aprova gestor ou administrador. Não é a base do assistente (\"como trabalhamos aqui\").",
        inputSchema: z.object({
          titulo: z.string().trim().min(2).max(120).describe('O assunto, ex.: "Estacionamento".'),
          texto: z.string().trim().min(3).max(4000).describe("O que o agente deve saber, escrito para o cliente ler."),
          pergunta: z.string().trim().max(500).optional().describe('Como o cliente pergunta, ex.: "Tem estacionamento?". Sem ela, o título.'),
        }),
        execute: async (a) =>
          propor(ctx, coletor, "propor_item_de_conhecimento", "conhecimento", (c) =>
            prepararItemDeConhecimento(c, { titulo: a.titulo, resposta: a.texto, pergunta: a.pergunta ?? null }),
          ),
      }),
    ],
    relatorio: [
      "propor_relatorio",
      tool({
        description:
          "PREPARA o cartão de um RELATÓRIO salvo: os negócios agrupados por origem, etapa ou pessoa da equipe, num período. " +
          '`para`: "eu" (só de quem pede; ela mesma aprova) ou "equipe" (de todos; gestor ou administrador aprova). Padrão "eu".',
        inputSchema: z.object({
          nome: z.string().trim().min(3).max(80).describe('O nome, ex.: "Leads por origem em outubro".'),
          agrupar: z.enum(["origem", "etapa", "resp"]).describe('"origem", "etapa" ou "resp" (pessoa da equipe).'),
          periodo: z.enum(["7", "30", "90", "mes", "mesp"]).optional().describe('"mes" (padrão), "mesp", "7", "30" ou "90".'),
          para: PARA.optional(),
        }),
        execute: async (a) => propor(ctx, coletor, "propor_relatorio", "relatorio", (c) => prepararRelatorio(c, a)),
      }),
    ],
    meta: [
      "propor_meta_do_mes",
      tool({
        description:
          "PREPARA o cartão de definir a META DO MÊS da empresa (a receita dos ganhos), que a equipe vê em Desempenho e no resumo da manhã. " +
          "Pelo assistente, só o administrador aprova. O atendente não pede meta.",
        inputSchema: z.object({
          valor: z.number().positive().max(1e10).describe("O valor na moeda da empresa, em unidades (180000 para R$ 180 mil)."),
          mes: z.string().trim().max(7).optional().describe('O mês, "AAAA-MM". Sem ele, o mês de agora.'),
        }),
        execute: async (a) =>
          propor(ctx, coletor, "propor_meta_do_mes", "meta", (c) => prepararMeta(c, { valor_cents: Math.round(a.valor * 100), mes: a.mes ?? null })),
      }),
    ],
  };
  if (!roleAtLeast(ctx.papel, "agent")) return {};
  const ferramentas: ToolSet = {};
  for (const [tipo, [nome, t]] of Object.entries(todas) as Array<[TipoDoDiaADia, [string, ToolSet[string]]]>) {
    if (tipoLigado(ctx, tipo)) ferramentas[nome] = t;
  }
  return ferramentas;
}
