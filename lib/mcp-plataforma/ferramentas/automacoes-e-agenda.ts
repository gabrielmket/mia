/**
 * As ferramentas de AUTOMAÇÃO e de AGENDA. As operações moram em
 * `lib/implantacao/automacoes.ts` e `lib/implantacao/agenda.ts`.
 *
 * Em cada área há duas operações do token: criar e ajustar é montagem
 * (`implantar_configuracao`); LIGAR a regra e LIGAR o lembrete fazem o sistema
 * passar a agir sozinho com o cliente final, e são `colocar_no_ar`.
 */
import { z } from "zod";

import { CATEGORIAS_DE_TIPO, LOCAIS_DE_TIPO } from "@/lib/agenda/tipos-de-agendamento";
import {
  definirJornada,
  garantirTiposDeAgendamento,
  ligarLembrete,
  TETO_DE_TIPOS,
  type PedidoDeJornada,
  type PedidoDeLembrete,
  type TipoPedido,
} from "@/lib/implantacao/agenda";
import { garantirAutomacao, ligarAutomacao, type PedidoDeAutomacao } from "@/lib/implantacao/automacoes";
import { garantirPlanosDeTarefa, TETO_DE_PASSOS, TETO_DE_PLANOS, type PlanoPedido } from "@/lib/implantacao/planos-de-tarefa";
import { GATILHOS_OFERECIDOS } from "@/lib/schemas/webhooks";
import { PRIORIDADES_DA_TAREFA } from "@/lib/tarefas/tipos";

import type { FerramentaDePlataforma } from "../tipos";
import { alvo, DIA_DA_SEMANA, HORA, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

/**
 * Os tipos de ação que a ferramenta aceita. É a lista do upstream
 * (`actionSchema`, `lib/schemas/webhooks.ts`) escrita por extenso para a recusa
 * ensinar os nomes; `tests/unit/mcp-de-implantacao-novidades-do-upstream.test.ts`
 * reprova quando o upstream acrescenta uma ação que não está aqui.
 */
export const TIPOS_DE_ACAO = [
  "create_or_move_lead",
  "add_tag",
  "assign_owner",
  "create_task",
  // upstream 1.77 (#1752): aplica um plano de tarefas ao negócio
  "apply_task_plan",
  "start_message_flow",
  "send_whatsapp_message",
  // upstream 1.81 (#2726): o e-mail como saída da regra
  "send_email",
  "send_ai_message",
  "notify_group",
  "call_webhook",
  // upstream 1.74 (#1970): a IA escolhe uma entre as opções da regra
  "ai_decide",
] as const;

export const FERRAMENTAS_DE_AUTOMACAO_E_AGENDA: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_garantir_automacao",
    description:
      "Cria ou ajusta uma REGRA DE AUTOMAÇÃO de um cliente: quando um gatilho acontece (negócio criado, mudou de etapa, foi GANHO, PERDIDO, reaberto ou trocou de responsável, " +
      "mensagem recebida, etiqueta, horário marcado, silêncio...) " +
      "e as condições batem, as ações rodam (mover para uma etapa, pôr etiqueta no negócio ou no contato, criar tarefa, aplicar um plano de tarefas, inscrever em follow-up ou iniciar um fluxo de atendimento, mandar mensagem, mandar e-mail, avisar o grupo, chamar um webhook, " +
      'ou o passo "a IA decide", `ai_decide`, em que a IA escolhe UMA entre 2 e 6 opções montadas na regra, cada uma com uma dessas ações em `config.opcoes[].acao`). ' +
      "O WEBHOOK DE SAÍDA é isto: uma regra com a ação `call_webhook` (ex.: avisar o faturamento quando o negócio é ganho, com o gatilho `lead.won`). " +
      "Nos gatilhos de ganho, perda, reabertura e troca de responsável a regra não pode atribuir responsável nem mover o negócio, nem dentro de um `ai_decide`: a própria mudança dispararia a regra de novo. " +
      "ATENÇÃO: `ai_decide` gasta IA a cada execução e só é aceito com `custo_de_token: true` escrito na config; o freio da empresa inteira está em plataforma_configurar_atendimento. " +
      "`configuracao_do_gatilho.webhook_source_id` faz o gatilho `lead.created` valer só para o negócio que veio daquela fonte de formulário. " +
      "A regra NASCE DESLIGADA e continua desligada: para ela rodar, plataforma_ligar_automacao. " +
      "GARANTIR quer dizer: pode ser chamada de novo sem duplicar. A chave é o NOME da regra. " +
      "Regra LIGADA não é editada por aqui (a mudança valeria no próximo evento): desligue, ajuste e religue. " +
      "COMO MONTAR: os gatilhos, os tipos de ação e o formato de cada `config` estão em plataforma_listar_modelos, seção automacoes. " +
      "Os ids (funil, etapa, número, agente, fluxo, pessoa) vêm de plataforma_ver_funis, plataforma_ver_agentes e plataforma_ver_configuracao, " +
      "e são conferidos contra o cliente: id de outra empresa é recusado. Até 10 condições e 10 ações por regra. " +
      "O QUE NÃO FAZ: não liga a regra, não apaga regra, e não recebe o SEGREDO de um webhook (é credencial: uma pessoa põe pela tela).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      nome: z.string().trim().min(1).max(120).describe("O nome da regra. É a chave para atualizar."),
      gatilho: z.enum(GATILHOS_OFERECIDOS as [string, ...string[]]).describe("O evento que dispara a regra."),
      condicoes: z
        .array(
          z
            .object({
              field: z.string().min(1).max(200).describe('O campo a conferir (ex.: "lead.tags", "contact.name", "event.to_stage_id").'),
              op: z
                .enum(["eq", "neq", "contains"])
                .describe(
                  '"eq" igual, "neq" diferente, "contains" contém. Desde a v1.85 do upstream o "contains" ignora maiúscula, ACENTO e pontuação ("anúncio" casa "anuncio"; "Olá! Vi o anúncio" casa "ola vi o anuncio"); "eq" continua exato.',
                ),
              value: z.string().max(500),
            })
            .strict(),
        )
        .max(10)
        .optional()
        .describe("As condições que precisam bater TODAS. Sem condições, a regra roda em todo evento do gatilho."),
      acoes: z
        .array(
          z
            .object({
              type: z.enum(TIPOS_DE_ACAO).describe("O tipo da ação."),
              config: z.record(z.string(), z.unknown()).describe("A configuração da ação, no formato do tipo."),
            })
            .strict(),
        )
        .min(1)
        .max(10)
        .describe("O que a regra faz, na ordem."),
      configuracao_do_gatilho: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Para os gatilhos de data do funil, de silêncio, de etapa parada e de documentos e obrigações (`obrigacao.*`): o que eles precisam saber (funil, etapa, campo, dias, tipo). " +
            "E, no `lead.created`, `webhook_source_id`: o id de uma fonte de formulário (plataforma_garantir_fonte_de_formulario), para a regra valer só para quem veio dela. " +
            "Os ids de funil, etapa e fonte são conferidos contra o cliente. O formato de cada um está em plataforma_listar_modelos, seção automacoes.",
        ),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      nome: "Etiquetar quem veio de anúncio",
      gatilho: "lead.created",
      condicoes: [{ field: "lead.source", op: "eq", value: "meta_ads" }],
      acoes: [{ type: "add_tag", config: { tags: ["Anúncio"] } }],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return garantirAutomacao(c, pedido as unknown as PedidoDeAutomacao);
    },
  },

  {
    name: "plataforma_garantir_planos_de_tarefa",
    description:
      "Cria ou ajusta os PLANOS DE TAREFA de um cliente: a sequência de tarefas da equipe salva uma vez (ex.: proposta enviada: ligar em 2 dias, mandar o caso de sucesso em 5, cobrar em 10) " +
      "e aplicada a cada negócio por uma regra de automação com a ação `apply_task_plan`, que cria todas as tarefas de uma vez, na ordem, e uma vez só por negócio. É o que a tela Tarefas › Planos grava. " +
      "Cada passo tem título, prazo em dias contados da aplicação, prioridade e responsável (o dono do negócio, ou uma pessoa da equipe pelo e-mail). " +
      "GARANTIR quer dizer: pode ser chamada de novo sem duplicar. A chave é o `id` do plano (o que a automação guarda em `plano_id`) ou, sem `id`, o NOME; plano novo ganha um id a partir do nome, e a resposta o devolve. " +
      `Os passos de um plano citado são a lista COMPLETA dele, na ordem. Planos que o pedido não cita ficam. Até ${TETO_DE_PLANOS} planos por empresa e ${TETO_DE_PASSOS} passos por plano. ` +
      "O QUE NÃO FAZ: não aplica o plano a negócio nenhum (isso é a regra de automação, que nasce desligada), não apaga plano e não fala com o cliente: tarefa é trabalho interno da equipe.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      planos: z
        .array(
          z
            .object({
              id: z.string().trim().min(1).max(64).optional().describe("O id de um plano que já existe (de plataforma_ver_configuracao, seção planos_de_tarefa). Só é preciso para renomear; sem ele, o plano é achado pelo nome."),
              nome: z.string().trim().min(1).max(120).describe('O nome do plano (ex.: "Proposta enviada").'),
              descricao: z.string().trim().max(300).nullable().optional().describe("Para que serve o plano, em uma frase. null apaga."),
              passos: z
                .array(
                  z
                    .object({
                      titulo: z
                        .string()
                        .trim()
                        .min(1)
                        .max(200)
                        .describe("O título da tarefa. Aceita {{lead.title}} e {{contact.name}}, como a tarefa da automação."),
                      descricao: z.string().trim().max(1000).nullable().optional().describe("O detalhe da tarefa, para quem vai fazer."),
                      vence_em_dias: z.number().int().min(0).max(365).describe("Em quantos dias, contados de quando o plano é aplicado, a tarefa vence. 0 = no mesmo dia."),
                      prioridade: z.enum(PRIORIDADES_DA_TAREFA).optional().describe('"low", "medium" (o padrão), "high" ou "urgent".'),
                      responsavel: z
                        .string()
                        .trim()
                        .min(1)
                        .max(200)
                        .optional()
                        .describe('"dono_do_lead" (o padrão: quem é o responsável pelo negócio) ou o e-mail de uma pessoa que JÁ é da equipe.'),
                    })
                    .strict(),
                )
                .min(1)
                .max(TETO_DE_PASSOS)
                .describe("Os passos do plano, na ordem. Lista completa: substitui os passos que o plano tinha."),
            })
            .strict(),
        )
        .min(1)
        .max(TETO_DE_PLANOS)
        .describe("Os planos a criar ou ajustar."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      planos: [
        {
          nome: "Proposta enviada",
          descricao: "O acompanhamento de quem recebeu proposta.",
          passos: [
            { titulo: "Ligar para {{contact.name}} sobre a proposta", vence_em_dias: 2, prioridade: "high" },
            { titulo: "Mandar o caso de sucesso", vence_em_dias: 5 },
            { titulo: "Cobrar a resposta da proposta", vence_em_dias: 10, responsavel: "dono_do_lead" },
          ],
        },
      ],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      return garantirPlanosDeTarefa(c, args.planos as PlanoPedido[]);
    },
  },

  {
    name: "plataforma_ligar_automacao",
    description:
      "LIGA ou desliga uma regra de automação. Ligada, a regra roda sozinha a cada evento do gatilho, e pode mandar mensagem para os clientes da empresa, " +
      "avisar um grupo ou chamar outro sistema. ANTES DE LIGAR: confira o que a regra faz em plataforma_ver_configuracao, seção automacoes. " +
      'Na empresa de demonstração, regra com webhook ou aviso de grupo não liga, inclusive quando a ação está entre as opções do passo "a IA decide": a recusa explica.',
    inputSchema: {
      organization_id: ORGANIZACAO,
      regra: z.string().trim().min(1).max(120).describe("Nome ou id da regra."),
      ligada: z.boolean().describe("true liga, false desliga."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, regra: "Etiquetar quem veio de anúncio", ligada: true },
    operacao: "colocar_no_ar",
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      return ligarAutomacao(c, { regra: String(args.regra), ligada: args.ligada === true }, org.demonstracao);
    },
  },

  {
    name: "plataforma_garantir_tipos_de_agendamento",
    description:
      "Cria ou ajusta os TIPOS DE AGENDAMENTO de um cliente: o que a empresa marca na agenda (consulta, visita, reunião, aula experimental), com a duração, " +
      "o local, as folgas, a antecedência mínima e até quantos dias à frente se agenda. É o que o agente oferece quando alguém quer marcar um horário. " +
      `Até ${TETO_DE_TIPOS} por chamada. GARANTIR quer dizer: pode ser chamada de novo sem duplicar. A chave é o NOME do tipo. ` +
      "Tipo novo nasce; o que já existe tem atualizados só os campos que vieram; igual, nada acontece. Tipos que o pedido não cita ficam. " +
      "Toda organização nasce com três tipos de exemplo: confira em plataforma_ver_configuracao, seção agenda, antes de criar. " +
      "Categorias e locais aceitos: plataforma_listar_modelos, seção agenda. " +
      "`canal_do_lembrete` escolhe o NÚMERO que manda o lembrete do tipo: com 2 ou mais números na empresa, sem ele o lembrete de compromisso marcado sem conversa fica pendente (a resposta avisa). " +
      "O QUE NÃO FAZ: não liga o lembrete (plataforma_ligar_lembrete), não desativa nem reativa tipo, não define a jornada de ninguém (plataforma_definir_jornada), " +
      "não cria tipo com Microsoft Teams e não mexe nos prazos da agenda (esses são pela tela: Configurações › Agenda).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      tipos: z
        .array(
          z
            .object({
              nome: z.string().trim().min(2).max(80).describe("O nome do tipo, como o cliente final o ouve."),
              categoria: z.enum(CATEGORIAS_DE_TIPO),
              duracao_minutos: z.number().int().min(5).max(1440),
              local: z.enum(LOCAIS_DE_TIPO).describe("in_person (presencial), phone, whatsapp, video_link ou google_meet."),
              descricao: z.string().trim().max(500).nullable().optional(),
              detalhes_do_local: z.string().trim().max(300).nullable().optional().describe("O endereço, ou o link da sala."),
              responsavel_padrao: z.string().trim().max(200).nullable().optional().describe("E-mail de uma pessoa que JÁ é da equipe: quem atende este tipo por padrão."),
              exige_confirmacao: z.boolean().optional().describe("true: o horário fica como pedido até uma pessoa confirmar."),
              folga_antes_minutos: z.number().int().min(0).max(720).optional(),
              folga_depois_minutos: z.number().int().min(0).max(720).optional(),
              antecedencia_minima_minutos: z.number().int().min(0).max(43_200).optional().describe("Com quanto tempo de antecedência, no mínimo, se agenda."),
              janela_de_agendamento_dias: z.number().int().min(1).max(365).optional().describe("Até quantos dias à frente se agenda."),
              preco_padrao_cents: z.number().int().min(0).max(100_000_000).nullable().optional().describe("O preço padrão do serviço, em centavos."),
              // .81 — o canal do lembrete (upstream v1.83).
              canal_do_lembrete: z
                .string()
                .trim()
                .min(1)
                .max(120)
                .nullable()
                .optional()
                .describe(
                  "O NÚMERO que manda o lembrete deste tipo: id, nome ou telefone de uma conexão (plataforma_ver_configuracao, seção canais). " +
                    "null = automático (a conversa da reserva, ou o único número). Com 2 ou mais números, sem isto o lembrete de compromisso marcado sem conversa fica pendente.",
                ),
            })
            .strict(),
        )
        .min(1)
        .max(TETO_DE_TIPOS),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      tipos: [{ nome: "Avaliação inicial", categoria: "consulta", duracao_minutos: 40, local: "in_person", antecedencia_minima_minutos: 120 }],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      return garantirTiposDeAgendamento(c, args.tipos as TipoPedido[]);
    },
  },

  {
    name: "plataforma_definir_jornada",
    description:
      "Define a JORNADA de uma pessoa da equipe de um cliente: em que dias e horários ela atende. É a partir da jornada que a agenda oferece horário " +
      "e que o rodízio decide quem está de plantão. Sem jornada publicada, a agenda daquela pessoa não oferece horário nenhum. " +
      "A pessoa precisa JÁ fazer parte da equipe (ter aceitado o convite): veja os e-mails em plataforma_ver_configuracao, seção equipe. " +
      "`janelas` é a lista COMPLETA de janelas (substitui a jornada da pessoa); lista vazia tira a restrição de horário. " +
      "Chamar de novo com o mesmo pedido responde `ja_estava`. " +
      "O QUE NÃO FAZ: não conecta a agenda do Google ou do Outlook da pessoa (é o login dela, pela tela Agenda), e não cria folga ou feriado.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      pessoa: z.string().trim().min(3).max(200).describe("O e-mail (ou o id) de uma pessoa da equipe."),
      fuso: z.string().trim().min(1).max(64).optional().describe("O fuso das janelas. Sem isto, o da empresa."),
      janelas: z
        .array(
          z
            .object({
              dia: DIA_DA_SEMANA.describe("0 (domingo) a 6 (sábado)."),
              inicio: HORA,
              fim: HORA,
            })
            .strict(),
        )
        .max(50)
        .optional()
        .describe('As janelas de atendimento. Ex.: segunda de manhã e à tarde são duas janelas com `dia: 1`.'),
      disponivel: z.boolean().optional().describe("A pessoa está de plantão para receber conversas no rodízio."),
      capacidade: z.number().int().min(1).max(1000).optional().describe("Quantas conversas a pessoa atende ao mesmo tempo."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      pessoa: "recepcao@exemplo.invalid",
      janelas: [
        { dia: 1, inicio: "08:00", fim: "12:00" },
        { dia: 1, inicio: "13:00", fim: "18:00" },
        { dia: 2, inicio: "08:00", fim: "18:00" },
      ],
      disponivel: true,
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return definirJornada(c, org.timezone, pedido as unknown as PedidoDeJornada);
    },
  },

  {
    name: "plataforma_ligar_lembrete",
    description:
      "LIGA ou desliga o LEMBRETE de um tipo de agendamento. Ligado, o sistema MANDA MENSAGEM no WhatsApp de quem tem horário marcado daquele tipo, " +
      "com a antecedência escolhida. Pode haver lembretes extras (por exemplo, um dia antes e de novo três horas antes) e um texto próprio. " +
      "A antecedência vai de 15 minutos a 7 dias. Chamar de novo com o mesmo pedido responde `ja_estava`. " +
      "O lembrete sai pelo número conectado da empresa: sem número, nada é enviado. " +
      "ANTES DE LIGAR: confirme com o humano o texto e a antecedência, porque a mensagem vai para o cliente final. " +
      "O QUE NÃO FAZ: não cria o tipo de agendamento (plataforma_garantir_tipos_de_agendamento) e não manda lembrete de horário que já passou.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      tipo: z.string().trim().min(1).max(120).describe("Nome, identificador curto ou id do tipo de agendamento."),
      ligado: z.boolean().describe("true liga, false desliga."),
      minutos_antes: z.number().int().min(15).max(10_080).optional().describe("Com quantos minutos de antecedência o lembrete principal sai. 1440 = um dia."),
      extras_minutos: z.array(z.number().int().min(15).max(10_080)).max(5).optional().describe("Lembretes adicionais, em minutos antes do horário."),
      mensagem: z.string().max(1000).nullable().optional().describe("O texto do lembrete. null ou vazio volta à frase padrão."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, tipo: "Avaliação inicial", ligado: true, minutos_antes: 1440, extras_minutos: [180] },
    operacao: "colocar_no_ar",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return ligarLembrete(c, pedido as unknown as PedidoDeLembrete);
    },
  },
];
