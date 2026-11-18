/**
 * FORK MIA (MIA-44) · O CONSUMO DE IA DE UM CLIENTE NUM MÊS, no MCP de
 * plataforma (docs/fork/consumo-de-ia.md). Uma, e só de leitura:
 *
 *   plataforma_ver_consumo_de_ia   o mês em Brasília, por agente, "Sistema" e finalidade, em US$ e R$
 *
 * Os números são os da aba Uso do cliente (`/api/v1/admin/tenants/[id]/usage`):
 * as duas chamam `lerConsumoDoPeriodo` (`lib/ai/usage/consumo-do-periodo.ts`).
 *
 * ⚠️ Dinheiro aqui é o preço de CUSTO da plataforma: o MCP de plataforma é da
 * Time, e o número não vai para o cliente (`lib/ai/custo-e-da-plataforma.ts`).
 */
import { z } from "zod";

import {
  falhouOConsumo,
  lerConsumoDoPeriodo,
  mesAtualEAnterior,
  periodoDoPedido,
} from "@/lib/ai/usage/consumo-do-periodo";
import { organizacaoDaImplantacao } from "@/lib/implantacao/base";

import { recusar } from "../recusa";
import type { FerramentaDePlataforma } from "../tipos";
import { ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

export const FERRAMENTAS_DE_CONSUMO_DE_IA: FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_consumo_de_ia",
    description:
      "Quanto um cliente gastou de IA num MÊS do calendário (no horário de Brasília), com os mesmos números da aba Uso do cliente no painel. " +
      "Traz o total e, separados: cada AGENTE da empresa (os que não gastaram aparecem com zero; `nome: null` é agente que não existe mais), " +
      "a linha SISTEMA (as chamadas sem agente: o resumo depois da conversa, os classificadores, a transcrição) e a quebra por FINALIDADE (`purpose`). " +
      "Cada linha tem chamadas, tokens de entrada e de saída, quantos da entrada vieram do cache (`tokens_do_cache`, parte da entrada), " +
      "o custo em centavos de dólar (`custo_usd_cents`, a mesma soma do teto mensal) e em reais (`custo_brl`, cada dia pela cotação do dia), " +
      "e `sem_preco` (chamadas sem preço registrado, que entram como zero). " +
      "`reais.dias_sem_cotacao` não vazio = o total em real está incompleto (dia sem cotação fica de fora). " +
      "`truncado: true` = o mês passou do teto de leitura e o começo dele ficou de fora. " +
      "O mês do teto do orçamento é o do banco (UTC) e pode diferir deste nas últimas 3 horas do mês. Só lê.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      mes: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "mes deve vir como AAAA-MM")
        .optional()
        .describe("O mês, AAAA-MM (ex.: 2026-10). Ausente: o mês corrente em Brasília."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, mes: "2026-10" },
    operacao: null,
    handler: async ({ admin }, args) => {
      const org = await organizacaoDaImplantacao(admin, String(args.organization_id));
      const mes = typeof args.mes === "string" ? args.mes : mesAtualEAnterior().atual;
      const periodo = periodoDoPedido({ mes });
      if (!periodo) recusar("mes deve vir como AAAA-MM, por exemplo 2026-10.");
      const consumo = await lerConsumoDoPeriodo(admin, org.id, periodo);
      if (falhouOConsumo(consumo)) throw new Error(`não consegui ler o consumo de IA: ${consumo.erro}`);
      return {
        empresa: org.display_name,
        organization_id: org.id,
        mes: periodo.mes,
        periodo: { inicio: periodo.inicio, fim: periodo.fim, fuso: periodo.fuso },
        total: consumo.total,
        por_agente: consumo.por_agente,
        sistema: consumo.sistema,
        por_finalidade: consumo.por_finalidade,
        reais: consumo.reais,
        truncado: consumo.truncado,
        chamadas_no_banco: consumo.chamadas_no_banco,
      };
    },
  },
];
