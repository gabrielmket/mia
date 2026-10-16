/**
 * FORK MIA (item 9, migrations 9040 a 9042) — as ferramentas do MONTADOR DE
 * RELATÓRIOS no MCP de plataforma.
 *
 * Regra da casa: toda função nova entra no MCP na mesma versão. São duas:
 *
 *   plataforma_garantir_relatorios  `implantar_configuracao`: liga os doze
 *                                   prontos ao funil do cliente, cria os
 *                                   relatórios do segmento e monta o painel
 *                                   do segmento, compartilhados com a equipe.
 *                                   Rodar de novo não duplica.
 *   plataforma_ver_relatorios       leitura: os prontos (e o funil a que estão
 *                                   ligados), os relatórios e os painéis da
 *                                   equipe e, se pedido, os números de cada
 *                                   relatório do painel.
 *
 * A conta é a mesma da tela (`lib/relatorios/servidor.ts` por cima de
 * `fn_mia_relatorio`), com o cliente de serviço e a organização conferida por
 * `alvo`. O relatório "só para mim" de uma pessoa NÃO aparece aqui, como não
 * aparece para ninguém (decisão do protótipo): a ferramenta diz só quantos são.
 */
import { z } from "zod";

import { garantirMetaDoMes } from "@/lib/implantacao/empresa";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { CHAVE_OUTROS, CHAVE_SEM, PERIODOS_DOS_PAINEIS, type PeriodoDosPaineis } from "@/lib/paineis/catalogo";
import { modeloDoGrafico, textoDoRotulo } from "@/lib/relatorios/apresentar";
import { FONTES_DO_MONTADOR, MEDIDAS_DO_MONTADOR } from "@/lib/relatorios/catalogo";
import { identificaPessoa, visualizacaoQueVale } from "@/lib/relatorios/config";
import { garantirRelatorios, GarantiaRecusada } from "@/lib/relatorios/garantir";
import { configsDoPainel } from "@/lib/relatorios/link";
import { RELATORIOS_PRONTOS } from "@/lib/relatorios/prontos";
import { RECEITAS, SEGMENTOS_DE_RELATORIO, type SegmentoDeRelatorio } from "@/lib/relatorios/segmentos";
import { calcularRelatorio, funisDosRelatorios, listarPaineis, listarRelatorios } from "@/lib/relatorios/servidor";

import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

const SEGMENTO = z
  .enum(SEGMENTOS_DE_RELATORIO)
  .describe(
    "O segmento do cliente, que decide os relatórios a mais e o painel: " +
      SEGMENTOS_DE_RELATORIO.map((s) => `${s} (${RECEITAS[s].painel.nome}: ${RECEITAS[s].relatorios.map((r) => r.nome).join(", ")})`).join("; ") +
      ". Use geral quando nenhum outro servir.",
  );

/** O número de uma medida como o MCP devolve: o bruto do banco e a unidade dele. */
function unidade(formato: string): string {
  return formato === "r" ? "centavos" : formato === "%" ? "pontos percentuais (0 a 100)" : formato === "t" ? "segundos" : formato === "d" ? "dias" : "quantidade";
}

export const FERRAMENTAS_DE_RELATORIOS: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_garantir_relatorios",
    description:
      "Deixa o MONTADOR DE RELATÓRIOS pronto num cliente, sem ninguém clicar: (1) liga os doze relatórios PRONTOS ao funil do cliente " +
      "(o principal, ou `funil_id`), (2) cria os relatórios a mais do SEGMENTO (três, mais a conversão por origem), compartilhados com a equipe, " +
      "e (3) monta o painel do segmento com oito relatórios (resultado do mês, meta do mês, funil, o relatório de destaque do segmento, " +
      "por que perdemos, conversão por origem, atendimento e agenda), compartilhado. Opcional: `meta_do_mes`, a mesma de plataforma_configurar_empresa, " +
      "que vira a linha da meta no gráfico. GARANTIR quer dizer: cria o que falta e não duplica. Rodar de novo responde `ja_estava`, ou `atualizou` " +
      "se a receita mudou; no painel só COMPLETA o que faltar (o relatório que o cliente pôs fica; o tamanho e a ordem que ele mudou ficam). " +
      "Devolve também o link para o dono SUGERIDO (para quem e quais prontos): quem cria o link é plataforma_garantir_link_do_dono, e quem o manda é uma pessoa. " +
      "QUANDO USAR: no passo dos números do primeiro dia da implantação, depois do funil (plataforma_garantir_funil) e da meta. " +
      "O QUE NÃO FAZ: não cria o link para o dono, não mexe nos relatórios que a equipe montou e não apaga nada.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      segmento: SEGMENTO,
      funil_id: z
        .string()
        .uuid()
        .nullable()
        .optional()
        .describe("O funil a que os prontos se ligam (de plataforma_ver_funis). Ausente: o funil principal da empresa."),
      painel: z.string().trim().min(1).max(80).optional().describe("O nome do painel. Ausente: o nome do segmento (ex.: \"Painel comercial\")."),
      compartilhar_com_a_equipe: z
        .boolean()
        .optional()
        .describe("true (padrão): os relatórios e o painel aparecem para toda a equipe. false: ficam só de quem criou o token."),
      meta_do_mes: z
        .object({
          valor_cents: z.number().int().positive().describe("A meta de faturamento do mês, em centavos (ex.: 10000000 para R$ 100.000,00)."),
          mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe("AAAA-MM. Ausente: o mês corrente no fuso da empresa."),
        })
        .optional()
        .describe("A meta do mês da empresa inteira (a mesma de plataforma_configurar_empresa)."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, segmento: "clinica", meta_do_mes: { valor_cents: 10000000 } },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      let meta: { mes: string; valor_cents: number; desfecho: "criou" | "ja_estava" } | null = null;
      if (args.meta_do_mes) {
        const r = await garantirMetaDoMes(c, org.timezone ?? "America/Sao_Paulo", args.meta_do_mes as { valor_cents: number; mes?: string });
        meta = { mes: r.mes, valor_cents: r.valor_cents, desfecho: r.mudou ? "criou" : "ja_estava" };
      }
      try {
        const r = await garantirRelatorios(ctx.admin, {
          organizationId: org.id,
          autorUserId: ctx.autorUserId,
          requestId: ctx.requestId,
          segmento: args.segmento as SegmentoDeRelatorio,
          funilId: (args.funil_id as string | null | undefined) ?? null,
          nomeDoPainel: (args.painel as string | undefined) ?? null,
          compartilhar: (args.compartilhar_com_a_equipe as boolean | undefined) ?? true,
        });
        return {
          segmento: r.segmento,
          prontos: { quantos: RELATORIOS_PRONTOS.length, funil: r.funil },
          relatorios: r.relatorios.map((x) => ({ id: x.id, nome: x.nome, desfecho: x.desfecho })),
          painel: { id: r.painel.id, nome: r.painel.nome, desfecho: r.painel.desfecho, relatorios: r.painel.itens, novos: r.painel.itensNovos },
          ...(meta ? { meta_do_mes: meta } : {}),
          link_para_o_dono_sugerido: { para_quem: r.link.paraQuem, paineis: r.link.paineis, como_criar: "plataforma_garantir_link_do_dono" },
          ...(org.demonstracao ? { aviso: "Empresa de demonstração: os relatórios mostram os dados fictícios." } : {}),
        };
      } catch (e) {
        if (e instanceof GarantiaRecusada) throw new Recusa(e.message);
        throw e;
      }
    },
  },

  {
    name: "plataforma_ver_relatorios",
    description:
      "O MONTADOR DE RELATÓRIOS de um cliente: os doze relatórios prontos (e o funil a que estão ligados), os relatórios e os painéis " +
      "COMPARTILHADOS com a equipe (ou criados pela implantação), com o que cada um mede e agrupa, e quantos relatórios e painéis são só de " +
      "quem criou (esses não são listados: o 'só para mim' não aparece para ninguém). Com `numeros: true`, calcula cada relatório dos painéis " +
      "no banco (todas as linhas do período, no fuso e na moeda da empresa) e devolve o total e os maiores grupos: são os números do primeiro " +
      "dia para o relatório de implantação. Valores em CENTAVOS, tempos de resposta em SEGUNDOS, taxas em pontos percentuais. " +
      "O QUE NÃO FAZ: não lista negócio, contato ou pessoa (só números somados) e não mostra custo de IA nem gasto com anúncio.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      numeros: z.boolean().optional().describe("true: calcula cada relatório dos painéis. Padrão: false (só a configuração)."),
      periodo: z.enum(PERIODOS_DOS_PAINEIS).optional().describe('O período do cálculo: 7, 30 ou 90 dias, ou "mes". Padrão: 30.'),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, numeros: true, periodo: "30" },
    operacao: null,
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      const [{ padrao }, relatorios, paineis] = await Promise.all([
        funisDosRelatorios(ctx.admin, org.id),
        listarRelatorios(ctx.admin, org.id),
        listarPaineis(ctx.admin, org.id),
      ]);
      const daEquipe = (x: { compartilhado: boolean; criadoVia: string }) => x.compartilhado || x.criadoVia !== "tela";
      const visiveis = relatorios.filter(daEquipe);
      const paineisVisiveis = paineis.filter(daEquipe);
      const periodo = ((args.periodo as PeriodoDosPaineis | undefined) ?? "30") as PeriodoDosPaineis;
      const descrever = (c: { fonte: keyof typeof FONTES_DO_MONTADOR; medida: keyof typeof MEDIDAS_DO_MONTADOR; dim1: string | null; dim2: string | null; filtros: Record<string, unknown>; periodo: string; visualizacao: string }) => ({
        fonte: c.fonte,
        medida: c.medida,
        agrupa_por: [c.dim1, c.dim2].filter(Boolean),
        filtros: c.filtros,
        periodo: c.periodo,
        visualizacao: c.visualizacao,
      });

      const saidaDosPaineis = await Promise.all(
        paineisVisiveis.map(async (p) => {
          const configs = await configsDoPainel(ctx.admin, org.id, p, padrao?.compromissos);
          const itens = await Promise.all(
            p.itens.map(async (item, i) => {
              const c = configs[i];
              if (!c) return { tamanho: item.tamanho, relatorio: null, aviso: "relatório só de quem criou" };
              const base = {
                titulo: c.titulo,
                tamanho: item.tamanho,
                periodo_proprio: item.periodoProprio,
                fica_fora_do_link_do_dono: identificaPessoa(c.config),
                ...descrever(c.config),
              };
              if (!args.numeros) return base;
              try {
                const calc = await calcularRelatorio(ctx.admin, ctx.admin, {
                  organizationId: org.id,
                  config: c.config,
                  valores: true,
                  funilPadrao: padrao,
                  periodo: item.periodoProprio ? null : periodo,
                });
                const m = modeloDoGrafico(calc.resposta, calc.config.medida, calc.nomes);
                return {
                  ...base,
                  visualizacao: visualizacaoQueVale(calc.config, calc.resposta),
                  de: calc.resposta.janela.de,
                  ate: calc.resposta.janela.ate,
                  registros: m.total.n,
                  total: m.total.valor,
                  unidade: unidade(m.formato),
                  maiores_grupos: m.grupos
                    .filter((g) => g.n > 0 && g.chave !== CHAVE_SEM && g.chave !== CHAVE_OUTROS)
                    .slice(0, 5)
                    .map((g) => ({ grupo: textoDoRotulo(g.rotulo, (s) => s), valor: g.valor, registros: g.n })),
                  ...(calc.resposta.meta ? { meta: calc.resposta.meta } : {}),
                };
              } catch (e) {
                return { ...base, erro: e instanceof Error ? e.message : String(e) };
              }
            }),
          );
          return { id: p.id, nome: p.nome, periodo: p.periodo, compartilhado: p.compartilhado, criado_por: p.criadoVia, relatorios: itens };
        }),
      );

      return {
        empresa: org.display_name ?? null,
        prontos: {
          funil: padrao ? { id: padrao.id, nome: padrao.nome } : null,
          relatorios: RELATORIOS_PRONTOS.map((p) => ({ chave: p.chave, nome: p.nome, pergunta: p.pergunta, ...descrever(p.config) })),
        },
        relatorios: visiveis.map((r) => ({
          id: r.id,
          nome: r.nome,
          compartilhado: r.compartilhado,
          criado_por: r.criadoVia,
          ...(r.prontoDe ? { copia_do_pronto: r.prontoDe } : {}),
          ...descrever(r.config),
        })),
        relatorios_so_de_quem_criou: relatorios.length - visiveis.length,
        paineis: saidaDosPaineis,
        paineis_so_de_quem_criou: paineis.length - paineisVisiveis.length,
        ...(args.numeros ? { periodo } : {}),
        ...(org.demonstracao ? { aviso: "Empresa de demonstração: os números são dos dados fictícios." } : {}),
      };
    },
  },
];
