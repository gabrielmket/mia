/**
 * FORK MIA (MIA-309) · O TETO DE IA DE UMA EMPRESA (`ai_budgets`) NO MCP DE
 * PLATAFORMA (desenho na MIA-285, seção 5; docs/fork/mcp-de-implantacao.md).
 *
 *   plataforma_definir_teto_de_ia   `definir_teto_de_ia`: teto mensal em centavos de dólar, modo e limiar
 *
 * A leitura do teto mora em `plataforma_ver_consumo_de_ia` (`teto_de_ia`), ao
 * lado do gasto que ele limita.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O PATCH de `/api/v1/ai/budget` pede `requireRole` (membro da empresa) e
 * `podeVerCusto` (admin da plataforma fora de suporte): ninguém tem as duas
 * coisas, e a sessão também não grava a tabela. O freio de emergência por
 * empresa existia e não tinha quem o puxasse.
 *
 * ── A regra é a da rota ─────────────────────────────────────────────────────
 *
 * `decidirMudancaDoTeto` (`lib/ai/budget/mudanca-do-teto.ts`): a escada
 * off → avisar → bloquear, o piso de US$ 1,00 para avisar ou parar, a carência
 * de 72 horas ao armar a parada e o desarme que zera a data. A auditoria tem o
 * mesmo código e o mesmo antes e depois da rota, e afrouxar fecha os avisos de
 * orçamento abertos na Central, como a tela fazia.
 *
 * O teto é dinheiro e decide se a IA do cliente PARA: a operação é própria e
 * fica só no token do Gabriel.
 */
import { z } from "zod";

import { getBudgetStatus } from "@/lib/ai/budget/check";
import {
  COLUNAS_DO_TETO,
  DEGRAU,
  decidirMudancaDoTeto,
  retratarAvisosDoTeto,
  tetoNoMcp,
  type PedidoDoTeto,
  type TetoGravado,
} from "@/lib/ai/budget/mudanca-do-teto";
import { audit } from "@/lib/audit";
import { organizacaoDaImplantacao } from "@/lib/implantacao/base";

import { recusar } from "../recusa";
import type { FerramentaDePlataforma } from "../tipos";
import { ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

/** O que ensinar quando a regra recusa: a frase da rota e o pedido que passa. */
function ensinar(codigo: "invalid_state_transition" | "unprocessable_entity", frase: string): string {
  return codigo === "invalid_state_transition"
    ? `${frase} Pelo MCP: chame primeiro com { "modo": "avisar" } e depois com { "modo": "bloquear" }.`
    : `${frase} Pelo MCP: mande "teto_usd_cents" de pelo menos 100 (US$ 1,00) junto, ou { "modo": "off" }.`;
}

export const FERRAMENTAS_DO_TETO_DE_IA: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_definir_teto_de_ia",
    description:
      "Define o TETO MENSAL DE IA de um cliente (`ai_budgets`, o freio de emergência por empresa): o valor em CENTAVOS DE DÓLAR por mês " +
      "(`teto_usd_cents`, 0 = sem teto), o MODO (`off` = só acompanhar; `avisar` = aviso na Central ao passar do limiar; `bloquear` = a IA PARA de responder " +
      "aos clientes do cliente ao chegar no teto) e o LIMIAR do aviso (`limiar_pct`, de 50 a 99, padrão 80). Manda só o que muda; o resto fica. " +
      "Regras, as mesmas da tela: avisar ou bloquear pedem teto de pelo menos 100 (US$ 1,00); não se vai de `off` direto para `bloquear` (primeiro `avisar`); " +
      "armar `bloquear` só passa a valer 72 horas depois (`comecar_agora: true` renuncia à carência); voltar de `bloquear` desarma na hora e fecha os avisos de orçamento abertos. " +
      "O gasto que conta é o do mês do banco (UTC), a mesma soma de `custo_usd_cents` de plataforma_ver_consumo_de_ia, onde o teto também aparece (`teto_de_ia`). " +
      "Este teto é diferente do teto de IA do PLANO (comercial, só para a chave da instalação): os dois valem. " +
      "Chamar de novo com os mesmos valores responde `ja_estava` e não grava nem audita. Na empresa de demonstração funciona igual (o aviso diz o efeito na demonstração).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      teto_usd_cents: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("O teto do mês em CENTAVOS DE DÓLAR (ex.: 5000 = US$ 50,00). 0 = sem teto (só com modo off)."),
      modo: z
        .enum(["off", "avisar", "bloquear"])
        .optional()
        .describe('"off" só acompanha, "avisar" avisa na Central ao passar do limiar, "bloquear" faz a IA parar no teto (72 h depois de armar).'),
      limiar_pct: z
        .number()
        .int()
        .min(50)
        .max(99)
        .optional()
        .describe("Em que porcentagem do teto sai o aviso, de 50 a 99 (ex.: 80)."),
      comecar_agora: z
        .boolean()
        .optional()
        .describe("Só ao armar `bloquear`: true faz a parada valer já, sem as 72 horas de carência. Sozinho não muda nada."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, teto_usd_cents: 5000, modo: "avisar", limiar_pct: 80 },
    operacao: "definir_teto_de_ia",
    handler: async (ctx, args) => {
      const org = await organizacaoDaImplantacao(ctx.admin, String(args.organization_id));
      const pedido: PedidoDoTeto = {
        ...(typeof args.teto_usd_cents === "number" ? { monthly_limit_cents: args.teto_usd_cents } : {}),
        ...(typeof args.limiar_pct === "number" ? { alarm_threshold_pct: args.limiar_pct } : {}),
        ...(typeof args.modo === "string" ? { enforcement_mode: args.modo as PedidoDoTeto["enforcement_mode"] } : {}),
        ...(typeof args.comecar_agora === "boolean" ? { confirmar_imediato: args.comecar_agora } : {}),
      };
      if (pedido.monthly_limit_cents === undefined && pedido.alarm_threshold_pct === undefined && pedido.enforcement_mode === undefined) {
        recusar(
          'Informe ao menos um campo: "teto_usd_cents", "modo" ou "limiar_pct". ' +
            `Exemplo: { "organization_id": "${ORG_DE_EXEMPLO}", "teto_usd_cents": 5000, "modo": "avisar" }.`,
        );
      }

      const { data: existente, error: erroDeLeitura } = await ctx.admin
        .from("ai_budgets")
        .select(COLUNAS_DO_TETO)
        .eq("organization_id", org.id)
        .maybeSingle();
      if (erroDeLeitura) throw new Error(`não consegui ler o teto de IA: ${erroDeLeitura.message}`);
      const gravado = (existente as TetoGravado | null) ?? null;

      const decisao = decidirMudancaDoTeto(gravado, pedido);
      if (!decisao.ok) recusar(ensinar(decisao.codigo, decisao.mensagem((t) => t)));

      const avisoDaDemonstracao = org.demonstracao
        ? {
            aviso:
              "Empresa de demonstração: o teto vale para a IA usada nas demonstrações. Com `bloquear`, ela para de responder no meio de uma demonstração quando o teto chegar.",
          }
        : {};

      if (decisao.jaEstava) {
        return { empresa: org.display_name, ja_estava: true, teto_de_ia: tetoNoMcp(gravado), ...avisoDaDemonstracao };
      }

      const escrita = gravado
        ? await ctx.admin.from("ai_budgets").update(decisao.patch).eq("organization_id", org.id)
        : await ctx.admin.from("ai_budgets").insert({
            organization_id: org.id,
            // Explícito, e nunca o `DEFAULT 5000` da coluna (a mesma regra da rota).
            monthly_limit_cents: decisao.depois.tetoCents,
            ...decisao.patch,
          });
      if (escrita.error) throw new Error(`não consegui gravar o teto de IA: ${escrita.error.message}`);

      const organizationId = org.id;
      void audit({
        action: decisao.acaoDaAuditoria,
        actorUserId: ctx.autorUserId,
        organizationId,
        resourceType: "ai_budgets",
        resourceId: organizationId,
        requestId: ctx.requestId,
        metadata: { ...decisao.metadataDaAuditoria, via: "mcp_plataforma" },
      });

      // O mesmo laço de retorno da rota: afrouxou (desceu um degrau, ou o gasto
      // ficou abaixo do limiar novo), fecha os avisos de orçamento abertos.
      const status = await getBudgetStatus(organizationId);
      const limiar = status.monthly_limit_cents > 0 ? (status.monthly_limit_cents * status.alarm_threshold_pct) / 100 : Number.POSITIVE_INFINITY;
      const retratados = await retratarAvisosDoTeto({
        admin: ctx.admin,
        orgId: organizationId,
        requestId: ctx.requestId,
        afrouxou: DEGRAU[decisao.depois.modo] < DEGRAU[decisao.antes.modo] || status.current_month_consumed_cents < limiar,
      });

      return {
        empresa: org.display_name,
        ja_estava: false,
        antes: { teto_usd_cents: decisao.antes.tetoCents, modo: decisao.antes.modo, limiar_pct: decisao.antes.limiarPct },
        teto_de_ia: {
          gravado: true,
          teto_usd_cents: decisao.depois.tetoCents,
          limiar_pct: decisao.depois.limiarPct,
          modo: decisao.depois.modo,
          parada_vale_desde:
            decisao.depois.modo === "bloquear" ? (decisao.efetivoEm ?? gravado?.enforcement_effective_at ?? null) : null,
        },
        gasto_do_mes_usd_cents: status.current_month_consumed_cents,
        ia_parada_agora: retratados ? false : status.blocked_now,
        ...(decisao.armando
          ? {
              aviso_da_parada:
                pedido.confirmar_imediato === true
                  ? "A parada vale a partir de agora: no teto, a IA deixa de responder aos clientes deste cliente."
                  : "A parada só vale daqui a 72 horas (`parada_vale_desde`). Até lá, o teto só avisa.",
            }
          : {}),
        ...avisoDaDemonstracao,
      };
    },
  },
];
