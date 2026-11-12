/**
 * FORK MIA (.108) · A TRAVA DE ROBÔ NO MCP DE PLATAFORMA (docs/fork/trava-de-robo.md).
 *
 * Três ferramentas, e a operação do token segue o tamanho do estrago:
 *
 *   plataforma_ver_travas_de_robo       leitura: a configuração e os registros do período
 *   plataforma_configurar_trava_de_robo `implantar_configuracao`: liga, desliga e ajusta os
 *                                       limites, e vale na hora para todo contato do cliente
 *   plataforma_desfazer_trava_de_robo   `colocar_no_ar`: devolve a IA ao contato, que volta a
 *                                       receber mensagem automática
 *
 * Toda a regra mora em `lib/trava-de-robo/`; aqui só a forma do pedido.
 */
import { z } from "zod";

import { FAIXAS_DA_TRAVA, pedidoDeConfigDaTravaSchema, lerConfigDaTrava } from "@/lib/trava-de-robo/config";
import { configurarTrava, desfazerTrava, listarTravas } from "@/lib/trava-de-robo/registros";
import { organizacaoDaImplantacao } from "@/lib/implantacao/base";

import { recusar } from "../recusa";
import type { FerramentaDePlataforma } from "../tipos";
import { ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

const faixa = (chave: keyof typeof FAIXAS_DA_TRAVA) => `${FAIXAS_DA_TRAVA[chave][0]} a ${FAIXAS_DA_TRAVA[chave][1]}`;

function limite(chave: keyof typeof FAIXAS_DA_TRAVA, texto: string) {
  const [min, max] = FAIXAS_DA_TRAVA[chave];
  return z.number().int().min(min).max(max).optional().describe(`${texto} De ${faixa(chave)}.`);
}

export const FERRAMENTAS_DA_TRAVA_DE_ROBO: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_travas_de_robo",
    description:
      "Mostra a TRAVA DE ROBÔ: a configuração de um cliente e os registros de cada vez que ela agiu no período. " +
      "A trava fica no começo de cada turno da IA e age em dois casos, sem chamar o modelo e sem mandar nada ao contato: " +
      "(1) motivo `robo`: do outro lado da conversa há um ROBÔ (3 mensagens automáticas em 15 minutos, cada uma depois de uma resposta da IA; " +
      "o sinal é a mensagem que se declara automática, o mesmo texto repetido pela 3ª vez em 2 horas, ou texto longo chegando rápido demais para alguém digitar). " +
      "Aí a IA fica calada para o contato, ele ganha a etiqueta \"robô\", os follow-ups dele são cancelados, cada negócio aberto vira PERDIDO com o motivo " +
      "\"Robô ou atendimento automático\" e a conversa é encerrada. (2) motivo `teto`: a IA respondeu 30 vezes em 60 minutos na mesma conversa; a IA pausa só " +
      "naquela conversa, sem perder negócio e sem encerrar, e a equipe recebe o aviso na Central. " +
      "Cada registro traz a empresa, a conversa (com o link do Inbox), os 4 últimos dígitos do telefone do contato, os sinais que casaram (só o nome do sinal e o id da " +
      "mensagem, nunca o texto), quantas respostas a IA deu na janela, os negócios afetados, o que falhou e se alguém já desfez. " +
      "Sem `organization_id`, lista os registros de TODOS os clientes (sem a configuração). Para devolver a IA a um contato travado: plataforma_desfazer_trava_de_robo.",
    inputSchema: {
      organization_id: z
        .string()
        .uuid()
        .optional()
        .describe(
          "O id do cliente (de plataforma_listar_clientes): traz a configuração dele e só os registros dele. Sem ele, os registros de todos os clientes.",
        ),
      periodo_dias: z.number().int().min(1).max(90).optional().describe("Quantos dias para trás (padrão 7, até 90)."),
      motivo: z.enum(["robo", "teto"]).optional().describe("Só os registros deste motivo: robo (o laço com outro robô) ou teto (respostas demais)."),
      limite: z.number().int().min(1).max(200).optional().describe("Quantos registros, os mais novos primeiro (padrão 50, até 200)."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, periodo_dias: 7 },
    operacao: null,
    handler: async (ctx, args) => {
      const orgId = typeof args.organization_id === "string" ? args.organization_id : null;
      const org = orgId ? await organizacaoDaImplantacao(ctx.admin, orgId) : null;
      const dias = typeof args.periodo_dias === "number" ? args.periodo_dias : 7;
      const registros = await listarTravas(ctx.admin, {
        organizationId: org?.id ?? null,
        desde: new Date(Date.now() - dias * 24 * 60 * 60 * 1000),
        motivo: args.motivo === "robo" || args.motivo === "teto" ? args.motivo : null,
        limite: typeof args.limite === "number" ? args.limite : 50,
      });
      const config = org ? await lerConfigDaTrava(ctx.admin, org.id) : null;
      return {
        ...(org
          ? {
              empresa: org.display_name,
              configuracao: config?.config ?? null,
              configuracao_gravada: config?.gravada ?? false,
            }
          : {}),
        periodo_dias: dias,
        total: registros.length,
        registros: registros.map((r) => ({
          id: r.id,
          empresa: r.empresa,
          organization_id: r.organization_id,
          motivo: r.motivo,
          quando: r.created_at,
          conversation_id: r.conversation_id,
          link_da_conversa: r.link_da_conversa,
          contact_id: r.contact_id,
          telefone_final: r.telefone_final,
          sinais: r.sinais,
          mensagens_de_robo: r.mensagens_de_robo,
          respostas_da_ia: r.respostas_da_ia,
          duracao_segundos: r.duracao_segundos,
          negocios_afetados: r.negocios_afetados,
          conversa_encerrada: r.conversa_encerrada,
          etiqueta_aplicada: r.etiqueta_aplicada,
          followups_cancelados: r.followups_cancelados,
          falhas: r.falhas,
          desfeita_em: r.desfeita_em,
        })),
      };
    },
  },

  {
    name: "plataforma_configurar_trava_de_robo",
    description:
      "LIGA, DESLIGA ou AJUSTA os limites da TRAVA DE ROBÔ de um cliente. Só o que vier no pedido muda; o resto fica como está (o padrão é LIGADA, " +
      "3 mensagens de robô em 15 minutos, repetição pela 3ª vez em 120 minutos, 80 caracteres a mais de 15 por segundo, teto de 30 respostas da IA em 60 minutos). " +
      "Vale na hora, para todo contato do cliente, no próximo turno da IA. Chamar de novo com os mesmos valores responde `ja_estava`. " +
      "ATENÇÃO: desligar (`ligada: false`) desliga as DUAS proteções, a do robô e a do teto; com ela desligada, a IA responde outro robô sem parar e gasta IA até alguém " +
      "perceber. Limite mais frouxo (mais mensagens para disparar, teto mais alto) tem o mesmo efeito mais devagar. " +
      "O QUE NÃO FAZ: não devolve a IA a quem já foi travado (plataforma_desfazer_trava_de_robo) e não reabre negócio nem conversa.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      ligada: z.boolean().optional().describe("true liga (o padrão), false desliga as duas proteções."),
      janela_minutos: limite("janela_minutos", "A janela em que as mensagens de robô são contadas, em minutos (padrão 15)."),
      mensagens_para_disparar: limite(
        "mensagens_para_disparar",
        "Quantas mensagens de robô, cada uma depois de uma resposta da IA, disparam a trava (padrão 3).",
      ),
      repeticao_janela_minutos: limite("repeticao_janela_minutos", "Até quantos minutos para trás o texto repetido é procurado (padrão 120)."),
      repeticoes_anteriores: limite(
        "repeticoes_anteriores",
        "Quantas vezes o mesmo texto já tinha chegado para a próxima contar como robô (padrão 2: a 3ª ocorrência conta).",
      ),
      velocidade_minimo_de_caracteres: limite(
        "velocidade_minimo_de_caracteres",
        "O texto rápido demais só conta deste tamanho para cima, em caracteres (padrão 80).",
      ),
      velocidade_caracteres_por_segundo: limite(
        "velocidade_caracteres_por_segundo",
        "Acima de quantos caracteres por segundo, depois de uma mensagem nossa, ninguém digita (padrão 15).",
      ),
      teto_respostas: limite("teto_respostas", "O teto de respostas (turnos) da IA na mesma conversa (padrão 30)."),
      teto_janela_minutos: limite("teto_janela_minutos", "A janela do teto, em minutos (padrão 60)."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, ligada: true, teto_respostas: 40 },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const org = await organizacaoDaImplantacao(ctx.admin, String(args.organization_id));
      const { organization_id: _org, ...resto } = args;
      const pedido = pedidoDeConfigDaTravaSchema.safeParse(resto);
      if (!pedido.success) recusar(`Pedido inválido: ${pedido.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}.`);
      if (Object.keys(pedido.data).length === 0) {
        recusar("Informe ao menos um campo: ligada ou um dos limites. Para só ver a configuração, use plataforma_ver_travas_de_robo.");
      }
      const r = await configurarTrava(ctx.admin, {
        organizationId: org.id,
        pedido: pedido.data,
        autorUserId: ctx.autorUserId,
        requestId: ctx.requestId,
      });
      return { empresa: org.display_name, configuracao: r.config, antes: r.antes, ja_estava: r.ja_estava };
    },
  },

  {
    name: "plataforma_desfazer_trava_de_robo",
    description:
      "DESFAZ a trava de robô de UMA conversa: a IA volta a atender o contato e a etiqueta \"robô\" sai do contato. É a mesma devolução do botão " +
      "\"Devolver ao automático\" da conversa (solta a trava do contato e o silêncio da conversa), mais tirar a etiqueta e marcar o registro como desfeito. " +
      "QUANDO USAR: a trava agiu com uma pessoa do outro lado (veja os sinais em plataforma_ver_travas_de_robo). Serve também para o teto de respostas. " +
      "A mensagem que ficou sem resposta não é respondida agora: a IA responde a próxima mensagem do contato, e a contagem da trava recomeça do zero. " +
      "ATENÇÃO: a partir daqui o sistema volta a mandar mensagem automática para esse contato. " +
      "O QUE NÃO FAZ: não reabre o negócio (ele continua perdido; reabrir é pela tela, em \"Retomar\" no negócio) e não reabre a conversa encerrada. " +
      "Recusa quando a conversa não tem trava de pé e quando o contato está marcado como \"sempre atendimento humano\".",
    inputSchema: {
      organization_id: ORGANIZACAO,
      conversation_id: z
        .string()
        .uuid()
        .describe("A conversa travada, de plataforma_ver_travas_de_robo (campo conversation_id). Ex.: 00000000-0000-4000-8000-000000000002."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, conversation_id: "00000000-0000-4000-8000-000000000002" },
    operacao: "colocar_no_ar",
    handler: async (ctx, args) => {
      const org = await organizacaoDaImplantacao(ctx.admin, String(args.organization_id));
      const r = await desfazerTrava(ctx.admin, {
        organizationId: org.id,
        conversationId: String(args.conversation_id),
        autorUserId: ctx.autorUserId,
        requestId: ctx.requestId,
      });
      return { empresa: org.display_name, ...r };
    },
  },
];
