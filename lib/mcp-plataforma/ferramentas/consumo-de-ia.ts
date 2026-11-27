/**
 * FORK MIA (MIA-44) · O CONSUMO DE IA DE UM CLIENTE NUM MÊS, no MCP de
 * plataforma (docs/fork/consumo-de-ia.md). Duas, e só de leitura:
 *
 *   plataforma_ver_consumo_de_ia            o mês em Brasília (ou os últimos N dias), por agente, "Sistema" e finalidade, em US$ e R$
 *   plataforma_ver_ranking_de_consumo_de_ia a plataforma inteira no mesmo período: as empresas em ordem de custo (MIA-136)
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
  lerRankingDoConsumo,
  mesAtualEAnterior,
  periodoDoPedido,
} from "@/lib/ai/usage/consumo-do-periodo";
import { falhouOCustoDeMensagem, lerCustoDeMensagemDoPeriodo } from "@/lib/channels/meta/custo-do-periodo";
// FORK MIA (MIA-309): o teto de IA da empresa ao lado do gasto que ele limita.
import { lerTetoDeIa } from "@/lib/ai/budget/mudanca-do-teto";
import { organizacaoDaImplantacao } from "@/lib/implantacao/base";

import { recusar } from "../recusa";
import type { FerramentaDePlataforma } from "../tipos";
import { ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

/** O mês, igual nas duas ferramentas. */
const MES = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "mes deve vir como AAAA-MM")
  .optional()
  .describe("O mês, AAAA-MM (ex.: 2026-10). Vence `dias`. Sem `mes` e sem `dias`: o mês corrente em Brasília.");

/** Os últimos N dias, iguais nas duas ferramentas. */
const DIAS = z
  .number()
  .int()
  .min(DIAS_MINIMO)
  .max(DIAS_MAXIMO)
  .optional()
  .describe(
    "Os últimos N dias do calendário em Brasília, hoje incluído (ex.: 30 = de 00:00 de 29 dias atrás até agora). A mesma janela de \"30 dias\" das telas de uso. Ignorado quando `mes` vem.",
  );

/** O período pedido: `mes` vence `dias`; sem nenhum dos dois, o mês corrente em Brasília. */
function periodoDosArgumentos(args: Record<string, unknown>) {
  const dias = typeof args.dias === "number" ? args.dias : null;
  const mes = typeof args.mes === "string" ? args.mes : dias === null ? mesAtualEAnterior().atual : null;
  const periodo = periodoDoPedido({ mes, dias });
  if (!periodo) recusar("mes deve vir como AAAA-MM, por exemplo 2026-10.");
  return periodo;
}

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
      "A soma dos agentes com o Sistema, e a das finalidades, FECHA com o total, em US$ e em R$ (o total manda e as linhas se ajustam, no máximo um centavo). " +
      "`reais.dias_sem_cotacao` não vazio = o total em real está incompleto (dia sem cotação fica de fora). " +
      "`truncado: true` = o mês passou do teto de leitura e o começo dele ficou de fora. " +
      "O mês do teto do orçamento é o do banco (UTC) e pode diferir deste nas últimas 3 horas do mês. " +
      "`mensagens_cobradas`: as mensagens que a META cobrou no período, por categoria, em centavos de REAL, cada mensagem ao preço que valia no instante dela " +
      "(um reajuste não muda um mês já fechado; num mês em que o preço mudou, a quebra por preço está em `linhas[].precos`). `semPreco` = categorias com mensagem " +
      "sem preço vigente, fora do total. Os mesmos números da aba Uso. " +
      "`teto_de_ia` (MIA-309): o teto mensal da empresa em `ai_budgets` (o freio de emergência), com `teto_usd_cents` (0 = sem teto), `modo` (`off`, `avisar`, `bloquear`), " +
      "`limiar_pct` do aviso, `parada_vale_desde` (a parada armada passa a valer nessa hora; `null` = não armada) e `gravado: false` quando a empresa nunca teve teto; " +
      "`null` = a leitura falhou. O teto compara com o gasto do mês do banco (UTC). Para mudar: plataforma_definir_teto_de_ia. Só lê.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      mes: MES,
      dias: DIAS,
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, mes: "2026-10" },
    operacao: null,
    handler: async ({ admin }, args) => {
      const org = await organizacaoDaImplantacao(admin, String(args.organization_id));
      const periodo = periodoDosArgumentos(args);
      const [consumo, mensagensCobradas, tetoDeIa] = await Promise.all([
        lerConsumoDoPeriodo(admin, org.id, periodo),
        lerCustoDeMensagemDoPeriodo(admin, org.id, periodo),
        lerTetoDeIa(admin, org.id),
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
        teto_de_ia: tetoDeIa,
      };
    },
  },
  {
    name: "plataforma_ver_ranking_de_consumo_de_ia",
    description:
      "O consumo de IA da PLATAFORMA inteira num MÊS do calendário (no horário de Brasília), ou nos últimos N DIAS (`dias`, a mesma janela das telas): " +
      "as empresas em ordem de custo, da mais cara para a mais barata, a visão da tela geral de uso do painel (`/admin/usage`), no mesmo período e na mesma ordem por custo. " +
      "As empresas de DEMONSTRAÇÃO ficam de fora, como na tela geral; as que não gastaram aparecem com zero, no fim. " +
      "Cada empresa traz `posicao`, o id, o nome, chamadas, tokens de entrada e de saída, `tokens_do_cache` (parte da entrada), " +
      "`custo_usd_cents` (centavos de dólar, a mesma soma do teto mensal), `custo_brl` (reais, cada dia pela cotação do dia) e `sem_preco`. " +
      "`total` é a plataforma: a soma das empresas FECHA com ele, em US$ e em R$ (o total manda; uma empresa pode ficar um centavo longe do total da aba Uso dela). " +
      "A ordem é pelo custo em dólar, depois chamadas de IA, depois o nome. O DESEMPATE difere da tela geral, que desempata por mensagens: no custo igual (as que não gastaram, por exemplo), a ordem pode não ser a da tela. `limite` corta a lista de empresas, não o total. " +
      "O detalhe por agente, Sistema e finalidade de uma empresa está em plataforma_ver_consumo_de_ia. " +
      "`reais.dias_sem_cotacao` não vazio = o R$ está incompleto; `truncado: true` = alguma empresa passou do teto de leitura. " +
      "O mês do teto do orçamento é o do banco (UTC) e pode diferir deste nas últimas 3 horas do mês. Só lê.",
    inputSchema: {
      mes: MES,
      dias: DIAS,
      limite: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Quantas empresas devolver, as mais caras primeiro (ex.: 10). Sem `limite`, todas. O total é sempre o da plataforma."),
    },
    exemplo: { mes: "2026-10", limite: 10 },
    operacao: null,
    handler: async ({ admin }, args) => {
      const periodo = periodoDosArgumentos(args);
      const ranking = await lerRankingDoConsumo(admin, periodo);
      if (falhouOConsumo(ranking)) throw new Error(`não consegui ler o consumo de IA da plataforma: ${ranking.erro}`);
      const limite = typeof args.limite === "number" ? args.limite : null;
      return {
        mes: periodo.mes,
        dias: periodo.dias,
        periodo: { tipo: periodo.tipo, inicio: periodo.inicio, fim: periodo.fim, fuso: periodo.fuso },
        total: ranking.total,
        empresas_no_total: ranking.empresas.length,
        empresas: limite === null ? ranking.empresas : ranking.empresas.slice(0, limite),
        reais: ranking.reais,
        truncado: ranking.truncado,
        chamadas_no_banco: ranking.chamadas_no_banco,
      };
    },
  },
];
