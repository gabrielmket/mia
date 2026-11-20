/**
 * FORK MIA (MIA-44) · O CONSUMO DE IA DE UM CLIENTE NUM MÊS, no MCP de
 * plataforma (docs/fork/consumo-de-ia.md). Uma, e só de leitura:
 *
 *   plataforma_ver_consumo_de_ia   o mês em Brasília (ou os últimos N dias), por agente, "Sistema" e finalidade, em US$ e R$
 *
 * Os números são os da aba Uso do cliente (`/api/v1/admin/tenants/[id]/usage`):
 * as duas chamam `lerConsumoDoPeriodo` (`lib/ai/usage/consumo-do-periodo.ts`).
 * FORK MIA (MIA-78): `dias` é a mesma janela dos 7/30/90 dias das duas telas
 * (`periodoDoPedido`: N dias do calendário em Brasília, hoje incluído).
 *
 * FORK MIA (MIA-99): traz também as mensagens que a Meta cobrou no período,
 * cada uma ao preço que valia no instante dela (`lerCustoDeMensagemDoPeriodo`,
 * a mesma leitura do bloco `mensagens_cobradas` da aba Uso).
 *
 * ⚠️ Dinheiro aqui é o preço de CUSTO da plataforma: o MCP de plataforma é da
 * Time, e o número não vai para o cliente (`lib/ai/custo-e-da-plataforma.ts`).
 */
import { z } from "zod";

import {
  DIAS_MAXIMO,
  DIAS_MINIMO,
  falhouOConsumo,
  lerConsumoDoPeriodo,
  mesAtualEAnterior,
  periodoDoPedido,
} from "@/lib/ai/usage/consumo-do-periodo";
import { falhouOCustoDeMensagem, lerCustoDeMensagemDoPeriodo } from "@/lib/channels/meta/custo-do-periodo";
import { organizacaoDaImplantacao } from "@/lib/implantacao/base";

import { recusar } from "../recusa";
import type { FerramentaDePlataforma } from "../tipos";
import { ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

export const FERRAMENTAS_DE_CONSUMO_DE_IA: FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_consumo_de_ia",
    description:
      "Quanto um cliente gastou de IA num MÊS do calendário (no horário de Brasília), ou nos últimos N DIAS (`dias`: os N dias do calendário em Brasília terminados hoje, hoje incluído, a mesma janela dos 7/30/90 dias das telas), com os mesmos números da aba Uso do cliente no painel. " +
      "Traz o total e, separados: cada AGENTE da empresa (os que não gastaram aparecem com zero; `nome: null` é agente que não existe mais), " +
      "a linha SISTEMA (as chamadas sem agente: o resumo depois da conversa, os classificadores, a transcrição) e a quebra por FINALIDADE (`purpose`). " +
      "Cada linha tem chamadas, tokens de entrada e de saída, quantos da entrada vieram do cache (`tokens_do_cache`, parte da entrada), " +
      "o custo em centavos de dólar (`custo_usd_cents`, a mesma soma do teto mensal) e em reais (`custo_brl`, cada dia pela cotação do dia), " +
      "e `sem_preco` (chamadas sem preço registrado, que entram como zero). " +
      "`reais.dias_sem_cotacao` não vazio = o total em real está incompleto (dia sem cotação fica de fora). " +
      "`truncado: true` = o mês passou do teto de leitura e o começo dele ficou de fora. " +
      "O mês do teto do orçamento é o do banco (UTC) e pode diferir deste nas últimas 3 horas do mês. " +
      "`mensagens_cobradas`: as mensagens que a META cobrou no período, por categoria, em centavos de REAL, cada mensagem ao preço que valia no instante dela " +
      "(um reajuste não muda um mês já fechado; num mês em que o preço mudou, a quebra por preço está em `linhas[].precos`). `semPreco` = categorias com mensagem " +
      "sem preço vigente, fora do total. Os mesmos números da aba Uso. Só lê.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      mes: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "mes deve vir como AAAA-MM")
        .optional()
        .describe("O mês, AAAA-MM (ex.: 2026-10). Vence `dias`. Sem `mes` e sem `dias`: o mês corrente em Brasília."),
      dias: z
        .number()
        .int()
        .min(DIAS_MINIMO)
        .max(DIAS_MAXIMO)
        .optional()
        .describe(
          "Os últimos N dias do calendário em Brasília, hoje incluído (ex.: 30 = de 00:00 de 29 dias atrás até agora). A mesma janela de \"30 dias\" das telas de uso. Ignorado quando `mes` vem.",
        ),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, mes: "2026-10" },
    operacao: null,
    handler: async ({ admin }, args) => {
      const org = await organizacaoDaImplantacao(admin, String(args.organization_id));
      // `mes` vence `dias`; sem nenhum dos dois, o mês corrente (como antes).
      const dias = typeof args.dias === "number" ? args.dias : null;
      const mes = typeof args.mes === "string" ? args.mes : dias === null ? mesAtualEAnterior().atual : null;
      const periodo = periodoDoPedido({ mes, dias });
      if (!periodo) recusar("mes deve vir como AAAA-MM, por exemplo 2026-10.");
      const [consumo, mensagensCobradas] = await Promise.all([
        lerConsumoDoPeriodo(admin, org.id, periodo),
        lerCustoDeMensagemDoPeriodo(admin, org.id, periodo),
      ]);
      if (falhouOConsumo(consumo)) throw new Error(`não consegui ler o consumo de IA: ${consumo.erro}`);
      if (falhouOCustoDeMensagem(mensagensCobradas)) {
        throw new Error(`não consegui ler as mensagens cobradas pela Meta: ${mensagensCobradas.erro}`);
      }
      return {
        empresa: org.display_name,
        organization_id: org.id,
        mes: periodo.mes,
        dias: periodo.dias,
        periodo: { tipo: periodo.tipo, inicio: periodo.inicio, fim: periodo.fim, fuso: periodo.fuso },
        total: consumo.total,
        por_agente: consumo.por_agente,
        sistema: consumo.sistema,
        por_finalidade: consumo.por_finalidade,
        reais: consumo.reais,
        truncado: consumo.truncado,
        chamadas_no_banco: consumo.chamadas_no_banco,
        mensagens_cobradas: mensagensCobradas,
      };
    },
  },
];
