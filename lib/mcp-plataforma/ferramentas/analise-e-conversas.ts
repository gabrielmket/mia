/**
 * FORK MIA (MIA-103) · O FUNIL E AS CONVERSAS DO MÊS DE UM CLIENTE, no MCP de
 * plataforma. Duas, as duas só de leitura (mapa do sistema, 2.2 e 2.3):
 *
 *   plataforma_ver_analise_do_funil   a Análise do funil da tela
 *                                     `/app/paineis/funil`: passagem etapa a
 *                                     etapa, dias até fechar, origem, a
 *                                     contra-métrica e as duas parcelas do período
 *   plataforma_ver_conversas_do_mes   as conversas de um mês por quem respondeu
 *                                     (agente, equipe, sem resposta), com o
 *                                     tempo da primeira resposta
 *
 * A conta é a mesma da tela e do montador. O funil sai de
 * `lib/metrics/funil.ts` pela mesma sequência da rota `/api/v1/metrics/funil`
 * (`lib/implantacao/analise-do-funil.ts`, um espelho conferido pela impressão da
 * rota). As conversas saem do motor dos relatórios (`fn_mia_relatorio`, fonte
 * "conversas", agrupada por "quem"), o mesmo dos painéis "Atendimento: agente
 * e equipe" e "Tempo de resposta" e do relatório montado na tela.
 *
 * Cada leitura filtra a organização pedida, conferida por `alvo` antes de
 * qualquer consulta. O mês é o do calendário no fuso da empresa.
 */
import { z } from "zod";

import { lerAnaliseDoFunil } from "@/lib/implantacao/analise-do-funil";
import { recusar } from "@/lib/mcp-plataforma/recusa";
import { ROTULO_DE_QUEM_ATENDEU, ROTULO_DO_CANAL } from "@/lib/paineis/catalogo";
import { consultarMotor, grupo, numero } from "@/lib/paineis/motor";
import { dataNoFuso, janelaDoRelatorio } from "@/lib/relatorios/janela";
import { fusoUtilizavel } from "@/lib/tempo/fusos";

import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

/** Os três de "quem respondeu", na ordem em que a resposta os lista. */
export const QUEM_RESPONDEU = ["agente", "equipe", "sem_resposta"] as const;

/** As janelas da tela da Análise do funil. */
export const DIAS_DA_ANALISE = [7, 30, 90] as const;

const MES = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "mes deve vir como AAAA-MM, por exemplo 2026-10");

/** O último dia civil de um `AAAA-MM`. */
function ultimoDia(mes: string): string {
  const [ano, m] = mes.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10);
}

/**
 * O mês pedido, conferido contra o mês corrente no fuso da empresa. Mês que
 * ainda não começou é recusado: a resposta seria um zero que parece medição.
 */
function mesConferido(mes: string, fuso: string, agora: Date): { mes: string; corrente: boolean } {
  const atual = dataNoFuso(agora, fuso).slice(0, 7);
  if (mes > atual) {
    recusar(`O mês ${mes} ainda não começou no fuso da empresa (${fuso}): o mês corrente é ${atual}. Peça ${atual} ou um mês anterior.`);
  }
  return { mes, corrente: mes === atual };
}

export const FERRAMENTAS_DA_ANALISE_E_DAS_CONVERSAS: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_analise_do_funil",
    description:
      "A ANÁLISE DO FUNIL de um cliente, com os mesmos números da tela Painéis > Análise do funil: (1) a passagem etapa a etapa de cada funil " +
      "(`conversao.etapas`: quantos ENTRARAM na etapa na janela, quantos PASSARAM para a seguinte, a taxa de 0 a 1 e nula sem amostra, os desvios e " +
      "quem já estava na etapa antes da janela); (2) os dias até fechar dos GANHOS (`dias_ate_fechar`: mediana, quartis e amostra, por funil); " +
      "(3) a origem dos negócios por situação, com o valor POR MOEDA, em centavos (`origem.linhas`); (4) a contra-métrica (turnos até o desfecho e " +
      "opt-outs, de fn_atrito_metrics) e (5) as duas parcelas do período (`valores_do_periodo`: vendido único e recorrência nova mensal, nunca somadas). " +
      "Janela: os últimos 7, 30 ou 90 dias até agora (`dias`, como os botões da tela; padrão 30) ou um MÊS do calendário no fuso da empresa (`mes`). " +
      "`truncado: true` = a janela passou do teto de leitura e os números são um piso. " +
      "QUANDO USAR: para responder onde os negócios de um cliente param, quanto tempo levam para fechar e de onde vêm os que fecham. " +
      "O QUE NÃO FAZ: não lista negócio nem contato (só números somados), não mostra custo de IA e não escreve nada.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      dias: z
        .union([z.literal(7), z.literal(30), z.literal(90)])
        .optional()
        .describe("Os últimos 7, 30 ou 90 dias até agora, como os botões da tela. Padrão: 30. Ignorado quando `mes` vem."),
      mes: MES.optional().describe(
        "Um mês do calendário, AAAA-MM (ex.: 2026-10), do dia 1º à meia-noite do último dia no fuso da empresa; o mês corrente vai até agora. Vence `dias`.",
      ),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, mes: "2026-10" },
    operacao: null,
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      const fuso = fusoUtilizavel(org.timezone);
      const agora = new Date();

      let janela: { from: string; to: string };
      let periodo: { tipo: "mes"; mes: string; de: string; ate: string } | { tipo: "dias"; dias: number };
      if (typeof args.mes === "string") {
        const { mes, corrente } = mesConferido(args.mes, fuso, agora);
        const civil = janelaDoRelatorio(`${mes}-01`, ultimoDia(mes), fuso);
        janela = { from: civil.from, to: corrente ? agora.toISOString() : civil.to };
        periodo = { tipo: "mes", mes, de: civil.de, ate: corrente ? dataNoFuso(agora, fuso) : civil.ate };
      } else {
        const dias = typeof args.dias === "number" ? args.dias : 30;
        janela = { from: new Date(agora.getTime() - dias * 86_400_000).toISOString(), to: agora.toISOString() };
        periodo = { tipo: "dias", dias };
      }

      const analise = await lerAnaliseDoFunil(ctx.admin, org.id, janela, org.currency);
      return {
        empresa: org.display_name,
        organization_id: org.id,
        demonstracao: org.demonstracao,
        fuso,
        periodo,
        ...analise,
        ...(org.demonstracao ? { aviso: "Empresa de demonstração: os números são dos dados fictícios." } : {}),
      };
    },
  },

  {
    name: "plataforma_ver_conversas_do_mes",
    description:
      "As CONVERSAS de um cliente num MÊS do calendário (no fuso da empresa), por QUEM RESPONDEU, com a mesma conta dos painéis \"Atendimento: agente e " +
      "equipe\" e \"Tempo de resposta\" e do montador de relatórios (fonte Atendimento): `agente` = só o agente de IA respondeu; `equipe` = uma pessoa da equipe respondeu " +
      "(mesmo que o agente tenha respondido antes); `sem_resposta` = ninguém respondeu. Cada conversa do WhatsApp, do Instagram ou do Facebook conta pelo " +
      "dia em que o cliente escreveu no mês. Traz o total, os três grupos (sempre os três, com zero quando não houve), a taxa de resolvidas pelo agente " +
      "em pontos percentuais (0 a 100) e o tempo até a primeira resposta do agente e da equipe em SEGUNDOS (`metade_esperou_ate` e `nove_em_dez_esperaram_ate`). " +
      "Com `por_canal: true`, os mesmos três grupos dentro de cada canal. Sem `mes`: o mês corrente, até hoje. " +
      "QUANDO USAR: para responder quantas conversas um cliente teve num mês e quanto o agente atendeu sozinho. " +
      "O QUE NÃO FAZ: não lista conversa, contato nem pessoa da equipe (só números somados) e não escreve nada.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      mes: MES.optional().describe("O mês, AAAA-MM (ex.: 2026-10). Ausente: o mês corrente no fuso da empresa, até hoje."),
      por_canal: z
        .boolean()
        .optional()
        .describe("true: os três grupos também dentro de cada canal (WhatsApp, Instagram, Facebook). Padrão: false."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, mes: "2026-10", por_canal: true },
    operacao: null,
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      const fuso = fusoUtilizavel(org.timezone);
      const pedido = typeof args.mes === "string" ? mesConferido(args.mes, fuso, new Date()) : null;
      // O mês corrente é o "Este mês" da tela (até hoje); o mês passado inteiro, o personalizado.
      const fechado = pedido && !pedido.corrente ? pedido.mes : null;
      const porCanal = args.por_canal === true;

      const r = await consultarMotor(ctx.admin, {
        organizationId: org.id,
        fonte: "conversas",
        medidas: ["qtd", "resolv", "tresp", "tresp90"],
        dim1: "quem",
        dim2: porCanal ? "canal" : null,
        periodo: fechado ? "pers" : "mes",
        de: fechado ? `${fechado}-01` : null,
        ate: fechado ? ultimoDia(fechado) : null,
        valores: false,
      });

      const tempo = (chave: "agente" | "equipe") => {
        const g = grupo(r, chave);
        return { metade_esperou_ate: numero(g, "tresp"), nove_em_dez_esperaram_ate: numero(g, "tresp90") };
      };

      return {
        empresa: org.display_name,
        organization_id: org.id,
        demonstracao: org.demonstracao,
        fuso: r.janela.fuso,
        mes: (r.janela.de ?? "").slice(0, 7) || null,
        de: r.janela.de,
        ate: r.janela.ate,
        conversas: r.total.n,
        por_quem: QUEM_RESPONDEU.map((chave) => ({
          quem: chave,
          rotulo: ROTULO_DE_QUEM_ATENDEU[chave],
          conversas: grupo(r, chave)?.n ?? 0,
        })),
        resolvidas_pelo_agente_pct: numero(r.total, "resolv"),
        primeira_resposta_em_segundos: { agente: tempo("agente"), equipe: tempo("equipe") },
        ...(porCanal
          ? {
              por_canal: (r.series ?? []).map((s) => ({
                canal: s.chave,
                rotulo: ROTULO_DO_CANAL[s.chave] ?? s.rotulo ?? s.chave,
                conversas: s.n,
                ...Object.fromEntries(QUEM_RESPONDEU.map((q) => [q, grupo(r, q)?.series?.[s.chave]?.n ?? 0])),
              })),
            }
          : {}),
        regra: "Cada conversa conta pelo dia em que o cliente escreveu no mês, no fuso da empresa.",
        ...(org.demonstracao ? { aviso: "Empresa de demonstração: os números são dos dados fictícios." } : {}),
      };
    },
  },
];
