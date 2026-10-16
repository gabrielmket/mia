/**
 * FORK MIA (item 9) — O QUE A IMPLANTAÇÃO DEIXA PRONTO EM CADA SEGMENTO
 * (protótipo, tela 7): os relatórios a mais do segmento, o painel que já nasce
 * montado e o link para o dono PREPARADO (a sugestão de para quem e de quais
 * prontos; quem cria e manda o link é uma pessoa).
 *
 * A MESMA receita serve ao MCP de plataforma (`plataforma_garantir_relatorios`)
 * e à semente das demonstrações (`lib/demonstracao/semente`): o cliente
 * implantado e a demonstração do segmento nascem com o mesmo painel.
 *
 * Os relatórios a mais são os que o motor de conta sabe responder. Onde o
 * protótipo pedia um agrupamento que o banco não tem (região, crédito aprovado
 * por campo personalizado), a receita usa o mais próximo que existe e o diz no
 * nome: nada de relatório que promete o que não conta.
 *
 * ⚠️ Módulo PURO.
 */
import type { ChaveDoPainel } from "@/lib/paineis/catalogo";

import type { Tamanho } from "./catalogo";
import { configPadrao, type ConfigDoRelatorio } from "./config";

export const SEGMENTOS_DE_RELATORIO = ["clinica", "construtora", "industria", "academia", "geral"] as const;
export type SegmentoDeRelatorio = (typeof SEGMENTOS_DE_RELATORIO)[number];

export interface RelatorioDaReceita {
  /** A chave natural (`mia_relatorios.chave`): rodar de novo atualiza em vez de duplicar. */
  chave: string;
  nome: string;
  config: ConfigDoRelatorio;
}

export interface ItemDaReceita {
  /** Um pronto pela chave, ou um relatório da receita pela chave natural dele. */
  pronto?: ChaveDoPainel;
  relatorio?: string;
  tamanho: Tamanho;
}

export interface ReceitaDoSegmento {
  segmento: SegmentoDeRelatorio;
  nome: string;
  painel: { chave: string; nome: string; itens: ItemDaReceita[] };
  relatorios: RelatorioDaReceita[];
  link: { paraQuem: string; paineis: ChaveDoPainel[] };
}

function cfg(base: Pick<ConfigDoRelatorio, "fonte"> & Partial<ConfigDoRelatorio>): ConfigDoRelatorio {
  return { ...configPadrao(base.fonte), ...base };
}

/** O relatório comum a todo segmento: a conversão por origem, com o período anterior. */
const CONVERSAO_POR_ORIGEM: RelatorioDaReceita = {
  chave: "implantacao:conversao-por-origem",
  nome: "Conversão por origem",
  config: cfg({ fonte: "negocios", medida: "conv", dim1: "origem", periodo: "90", comparar: true }),
};

const FATURAMENTO_POR_MES_E_ORIGEM = (chave: string): RelatorioDaReceita => ({
  chave,
  nome: "Faturamento por mês e origem",
  config: cfg({ fonte: "negocios", medida: "soma", dim1: "mes", dim2: "origem", periodo: "90", filtros: { situacao: "ganho" } }),
});

function painel(chave: string, nome: string, destaque: string, agendaNoPainel = true): ReceitaDoSegmento["painel"] {
  return {
    chave,
    nome,
    itens: [
      { pronto: "resultado", tamanho: "P" },
      { pronto: "meta", tamanho: "P" },
      { pronto: "funil", tamanho: "M" },
      { relatorio: destaque, tamanho: "G" },
      { pronto: "perdas", tamanho: "M" },
      { relatorio: CONVERSAO_POR_ORIGEM.chave, tamanho: "M" },
      { pronto: "atendimento", tamanho: "M" },
      ...(agendaNoPainel ? [{ pronto: "agenda" as const, tamanho: "M" as const }] : []),
    ],
  };
}

export const RECEITAS: Record<SegmentoDeRelatorio, ReceitaDoSegmento> = {
  clinica: {
    segmento: "clinica",
    nome: "Clínica",
    relatorios: [
      FATURAMENTO_POR_MES_E_ORIGEM("clinica:faturamento-por-mes-e-origem"),
      {
        chave: "clinica:tempo-ate-fechar-por-tratamento",
        nome: "Tempo até fechar por tratamento",
        config: cfg({ fonte: "negocios", medida: "tfechar", dim1: "produto", periodo: "90" }),
      },
      {
        chave: "clinica:faltas-por-dia",
        nome: "Faltas na agenda por dia",
        config: cfg({ fonte: "agenda", medida: "qtd", dim1: "dia", periodo: "30", filtros: { situacao: "faltou" } }),
      },
      CONVERSAO_POR_ORIGEM,
    ],
    painel: painel("clinica:painel", "Painel comercial", "clinica:faturamento-por-mes-e-origem"),
    link: { paraQuem: "Dono da clínica", paineis: ["resultado", "meta", "funil", "agenda"] },
  },
  construtora: {
    segmento: "construtora",
    nome: "Construtora e imobiliária",
    relatorios: [
      {
        chave: "construtora:vendas-por-empreendimento",
        nome: "Vendas por empreendimento",
        config: cfg({ fonte: "negocios", medida: "qtd", dim1: "produto", periodo: "90", filtros: { situacao: "ganho" } }),
      },
      {
        chave: "construtora:valor-em-negociacao-por-etapa",
        nome: "Valor em negociação por etapa",
        config: cfg({ fonte: "negocios", medida: "soma", dim1: "etapa", periodo: "90", filtros: { situacao: "aberto" } }),
      },
      {
        chave: "construtora:tempo-em-cada-etapa",
        nome: "Tempo em cada etapa (da visita à proposta)",
        config: cfg({ fonte: "negocios", medida: "tetapa", dim1: "etapa", periodo: "90" }),
      },
      CONVERSAO_POR_ORIGEM,
    ],
    painel: painel("construtora:painel", "Painel de vendas", "construtora:vendas-por-empreendimento"),
    link: { paraQuem: "Diretor comercial", paineis: ["resultado", "meta", "funil", "agenda"] },
  },
  industria: {
    segmento: "industria",
    nome: "Indústria B2B",
    relatorios: [
      {
        chave: "industria:pedidos-por-representante",
        nome: "Pedidos por representante",
        config: cfg({ fonte: "negocios", medida: "qtd", dim1: "resp", periodo: "90", filtros: { situacao: "ganho" } }),
      },
      {
        chave: "industria:ticket-medio-por-produto",
        nome: "Ticket médio por produto",
        config: cfg({ fonte: "negocios", medida: "media", dim1: "produto", periodo: "90", filtros: { situacao: "ganho" } }),
      },
      {
        chave: "industria:clientes-novos-no-mes",
        nome: "Clientes novos no mês, por origem",
        config: cfg({ fonte: "contatos", medida: "qtd", dim1: "origem", periodo: "mes" }),
      },
      CONVERSAO_POR_ORIGEM,
    ],
    painel: painel("industria:painel", "Painel comercial B2B", "industria:pedidos-por-representante", false),
    link: { paraQuem: "Sócios", paineis: ["resultado", "meta", "previsao", "origem"] },
  },
  academia: {
    segmento: "academia",
    nome: "Academia",
    relatorios: [
      {
        chave: "academia:matriculas-por-plano",
        nome: "Matrículas por plano",
        config: cfg({ fonte: "negocios", medida: "qtd", dim1: "produto", periodo: "90", filtros: { situacao: "ganho" } }),
      },
      {
        chave: "academia:indicacoes-por-mes",
        nome: "Matrículas que vieram de indicação",
        config: cfg({ fonte: "negocios", medida: "qtd", dim1: "mes", periodo: "90", filtros: { situacao: "ganho", origem: "indicacao" } }),
      },
      {
        chave: "academia:cancelamentos-do-mes",
        nome: "Cancelamentos e desistências do mês",
        config: cfg({ fonte: "negocios", medida: "qtd", dim1: "motivo", periodo: "mes", filtros: { situacao: "perdido" } }),
      },
      CONVERSAO_POR_ORIGEM,
    ],
    painel: painel("academia:painel", "Painel de matrículas", "academia:matriculas-por-plano"),
    link: { paraQuem: "Dono da academia", paineis: ["resultado", "meta", "agenda", "followup"] },
  },
  geral: {
    segmento: "geral",
    nome: "Geral",
    relatorios: [
      FATURAMENTO_POR_MES_E_ORIGEM("geral:faturamento-por-mes-e-origem"),
      {
        chave: "geral:tempo-ate-fechar-por-produto",
        nome: "Tempo até fechar por produto",
        config: cfg({ fonte: "negocios", medida: "tfechar", dim1: "produto", periodo: "90" }),
      },
      {
        chave: "geral:negocios-por-responsavel",
        nome: "Negócios fechados por responsável",
        config: cfg({ fonte: "negocios", medida: "qtd", dim1: "resp", periodo: "90", filtros: { situacao: "ganho" } }),
      },
      CONVERSAO_POR_ORIGEM,
    ],
    painel: painel("geral:painel", "Painel comercial", "geral:faturamento-por-mes-e-origem"),
    link: { paraQuem: "Dono do negócio", paineis: ["resultado", "meta", "funil", "origem"] },
  },
};

/** O segmento da demonstração (`lib/demonstracao/semente`) na receita dos relatórios. */
export function segmentoDaDemonstracao(segmento: string | null | undefined): SegmentoDeRelatorio {
  if (segmento === "clinica-odonto") return "clinica";
  if (segmento === "construtora" || segmento === "industria" || segmento === "academia") return segmento;
  return "geral";
}
