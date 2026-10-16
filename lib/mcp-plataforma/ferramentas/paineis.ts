/**
 * FORK MIA (item 8, migrations 9030 e 9031) — as ferramentas dos PAINÉIS
 * PRONTOS e do LINK PARA O DONO do negócio.
 *
 * Regra da casa: toda função nova entra no MCP na mesma versão. São quatro:
 *
 *   plataforma_ver_paineis            leitura: os doze painéis de um cliente,
 *                                     com os números calculados no banco
 *   plataforma_ver_links_do_dono      leitura: os links da empresa, com o
 *                                     endereço, a situação e os acessos
 *   plataforma_garantir_link_do_dono  `compartilhar_paineis`: cria o link (ou
 *                                     ajusta o que já existe para a mesma
 *                                     pessoa, no mesmo endereço)
 *   plataforma_revogar_link_do_dono   `compartilhar_paineis`: revoga
 *
 * A conta é a mesma da tela e da página pública (`lib/paineis/calcular.ts` por
 * cima de `fn_mia_relatorio`), e o link é o mesmo da tela (`lib/paineis/link.ts`).
 * Nada aqui envia o link a ninguém: a ferramenta devolve o endereço, e quem
 * manda ao dono é uma pessoa.
 *
 * A empresa de demonstração gera link (decisão do protótipo: "serve para
 * venda"): ele só lê os dados fictícios, e a página avisa que é demonstração.
 */
import { z } from "zod";

import {
  PAINEIS_PRONTOS,
  PERIODOS_DOS_PAINEIS,
  PERIODO_PADRAO,
  type ChaveDoPainel,
  type PeriodoDosPaineis,
} from "@/lib/paineis/catalogo";
import { calcularPaineis } from "@/lib/paineis/calcular";
import {
  alterarLink,
  criarLink,
  LinkRecusado,
  listarLinks,
  revogarLink,
  VALIDADE_PADRAO,
  type ContextoDoLink,
  type LinkDoDono,
  type PeriodoDoLink,
  type ValidadeEmDias,
} from "@/lib/paineis/link";
import { Recusa, recusar } from "@/lib/mcp-plataforma/recusa";

import type { ContextoDaFerramenta, FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

export const OPERACAO_COMPARTILHAR_PAINEIS = "compartilhar_paineis";

const PAINEIS = z
  .array(z.enum(PAINEIS_PRONTOS))
  .min(1)
  .max(PAINEIS_PRONTOS.length)
  .describe(
    `Quais dos doze painéis prontos, na ordem em que aparecem: ${PAINEIS_PRONTOS.join(", ")}. ` +
      "resultado (ganhos, perdidos, taxa e tempo até fechar), meta (meta do mês), funil (quantos chegaram a cada etapa), " +
      "origem (de onde vêm e quantos fecharam), perdas (por que perdemos), atendimento (agente e equipe), resposta (tempo de resposta), " +
      "agenda (marcou, confirmou, veio, faltou), followup (quantos voltaram a responder), anuncios (o que foi informado à Meta e ao Google), " +
      "previsao (quanto deve entrar e quando) e assuntos (as etiquetas das conversas).",
  );

const FUNIL = z
  .string()
  .uuid()
  .nullable()
  .optional()
  .describe("O funil dos painéis de negócio (de plataforma_ver_funis). Ausente ou nulo: o funil principal da empresa.");

function contextoDoLink(ctx: ContextoDaFerramenta, organizationId: string): ContextoDoLink {
  return { organizationId, actorUserId: ctx.autorUserId, requestId: ctx.requestId, via: "mcp_plataforma" };
}

/** O link como a ferramenta devolve: o endereço inteiro, e nada do token à parte. */
function paraResposta(l: LinkDoDono) {
  return {
    id: l.id,
    para_quem: l.paraQuem,
    url: l.url,
    situacao: l.situacao,
    paineis: l.paineis,
    periodo: l.periodo,
    mostrar_valores: l.mostrarValores,
    funil_id: l.pipelineId,
    valido_ate: l.validoAte,
    revogado_em: l.revogadoEm,
    ultimo_acesso: l.ultimoAcesso,
    acessos: l.acessos,
    criado_em: l.criadoEm,
    criado_por: l.criadoPor,
  };
}

function traduzirRecusa(e: unknown): never {
  if (e instanceof LinkRecusado) {
    const dicas: Record<LinkRecusado["motivo"], string> = {
      sem_painel: "Escolha pelo menos um painel em `paineis`.",
      funil_de_outra_empresa: "Esse `funil_id` não é desta empresa. Veja os funis com plataforma_ver_funis.",
      nao_encontrado: "Link não encontrado nesta empresa. Veja os links com plataforma_ver_links_do_dono.",
      revogado: "Esse link foi revogado, e link revogado não volta. Crie outro com plataforma_garantir_link_do_dono.",
      ativo: "O link já está ativo.",
    };
    throw new Recusa(dicas[e.motivo]);
  }
  throw e;
}

export const FERRAMENTAS_DE_PAINEIS: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_paineis",
    description:
      "Os PAINÉIS PRONTOS de um cliente, com os números calculados no banco (todas as linhas do período, no fuso e na moeda da empresa): " +
      "resultado do mês, meta do mês, funil, de onde vêm, por que perdemos, atendimento (agente e equipe), tempo de resposta, agenda, " +
      "follow-up, anúncios, previsão e assuntos. São os mesmos números da tela Painéis e do link para o dono. " +
      "QUANDO USAR: no relatório de implantação (\"os números do primeiro dia\"), para conferir que a meta e o funil ficaram certos, e antes de " +
      "mandar o link ao dono. Valores em CENTAVOS; tempos de resposta em SEGUNDOS; taxas em pontos percentuais (0 a 100). " +
      "Período: 7, 30 ou 90 dias até hoje, ou \"mes\" (este mês até hoje); a meta é sempre a do mês corrente e a previsão olha os negócios abertos hoje. " +
      "O QUE NÃO FAZ: não mostra custo de IA nem gasto com anúncio, e não lista negócio, contato ou pessoa: só números somados.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      periodo: z.enum(PERIODOS_DOS_PAINEIS).optional().describe('7, 30 ou 90 dias até hoje, ou "mes". Padrão: 30.'),
      paineis: PAINEIS.optional().describe("Quais painéis. Ausente: os doze."),
      funil_id: FUNIL,
      mostrar_valores: z
        .boolean()
        .optional()
        .describe("false: nenhum valor em reais (como o link \"só quantidades\"). Padrão: true."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, periodo: "mes", paineis: ["resultado", "meta", "funil"] },
    operacao: null,
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      const calculados = await calcularPaineis(ctx.admin, {
        organizationId: org.id,
        periodo: (args.periodo as PeriodoDosPaineis | undefined) ?? PERIODO_PADRAO,
        paineis: args.paineis as ChaveDoPainel[] | undefined,
        pipelineId: (args.funil_id as string | null | undefined) ?? null,
        valores: (args.mostrar_valores as boolean | undefined) ?? true,
      });
      return {
        empresa: calculados.empresa.nome,
        demonstracao: calculados.empresa.demonstracao,
        fuso: calculados.empresa.fuso,
        moeda: calculados.empresa.moeda,
        periodo: calculados.periodo,
        de: calculados.janela.de,
        ate: calculados.janela.ate,
        funil: calculados.funil ? { id: calculados.funil.id, nome: calculados.funil.nome } : null,
        valores_em_reais: calculados.valores,
        paineis: calculados.paineis.map((p) => ({
          painel: p.chave,
          titulo: p.titulo,
          ...(p.erro ? { erro: p.erro } : {}),
          ...(p.dados ?? {}),
        })),
        ...(calculados.empresa.demonstracao
          ? { aviso: "Empresa de demonstração: os números são dos dados fictícios." }
          : {}),
      };
    },
  },

  {
    name: "plataforma_ver_links_do_dono",
    description:
      "Os LINKS PARA O DONO do negócio de um cliente: para quem é cada um, o endereço, a situação (ativo, vencido, revogado), " +
      "os painéis, o período, se mostra valores em reais, até quando vale, o último acesso e quantos acessos. " +
      "O endereço abre sem usuário nem senha; um link vencido ou revogado abre a página de \"não está disponível\".",
    inputSchema: { organization_id: ORGANIZACAO },
    exemplo: { organization_id: ORG_DE_EXEMPLO },
    operacao: null,
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      const links = await listarLinks(ctx.admin, org.id);
      return { links: links.map(paraResposta), total: links.length };
    },
  },

  {
    name: "plataforma_garantir_link_do_dono",
    description:
      "Cria o LINK PARA O DONO do negócio: um endereço que abre, no celular e sem senha, os painéis prontos escolhidos da empresa, " +
      "com o nome da empresa no topo e só números somados (nenhum nome, telefone ou conversa de cliente sai por ele). " +
      "GARANTIR quer dizer: a chave é `para_quem`. Já existe link ATIVO para a mesma pessoa? Com o mesmo conteúdo responde `ja_estava`; " +
      "com outro conteúdo (painéis, período, valores, funil) é ajustado no MESMO endereço (`atualizou`), e o dono não precisa de link novo. " +
      "Senão, cria (`criou`), válido por `validade_dias` (padrão 90). " +
      "Devolve o endereço (`url`): quem manda ao dono é uma pessoa, a ferramenta não envia nada. " +
      "Na empresa de demonstração o link funciona com os dados fictícios, e a página avisa que é demonstração. " +
      "Para tirar o acesso: plataforma_revogar_link_do_dono (revogado não volta). " +
      "O QUE NÃO FAZ: não envia o link a ninguém (devolve o endereço), não dá login nem acesso ao sistema, e não mostra nome, " +
      "telefone ou conversa de cliente, nem o nome de quem é da equipe.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      para_quem: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .describe('Para quem é o link, só para se organizar (ex.: "Dono da clínica", "Sócio investidor"). Não aparece na página.'),
      paineis: PAINEIS,
      periodo: z
        .enum(["escolhe", ...PERIODOS_DOS_PAINEIS])
        .optional()
        .describe('"escolhe": a pessoa escolhe entre 7, 30, 90 dias e este mês. Ou fixo em "7", "30", "90" ou "mes". Padrão: "escolhe".'),
      mostrar_valores: z
        .boolean()
        .optional()
        .describe("true: mostra valores em reais (faturamento, meta, previsão). false: só quantidades. Padrão: true."),
      funil_id: FUNIL,
      validade_dias: z
        .union([z.literal(30), z.literal(90), z.literal(365)])
        .optional()
        .describe("Por quantos dias o link vale: 30, 90 ou 365. Padrão: 90. Vale só para o link criado agora."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      para_quem: "Dono da clínica",
      paineis: ["resultado", "meta", "funil", "origem", "agenda", "atendimento"],
      periodo: "escolhe",
      mostrar_valores: true,
    },
    operacao: OPERACAO_COMPARTILHAR_PAINEIS,
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      const c = contextoDoLink(ctx, org.id);
      const paraQuem = String(args.para_quem).trim();
      const pedido = {
        paineis: args.paineis as ChaveDoPainel[],
        periodo: ((args.periodo as PeriodoDoLink | undefined) ?? "escolhe") as PeriodoDoLink,
        mostrarValores: (args.mostrar_valores as boolean | undefined) ?? true,
        pipelineId: (args.funil_id as string | null | undefined) ?? null,
      };
      const aviso = org.demonstracao
        ? "Empresa de demonstração: o link mostra os dados fictícios, com o aviso de demonstração na página."
        : null;
      try {
        const existentes = await listarLinks(ctx.admin, org.id);
        const mesmo = existentes.find(
          (l) => l.situacao === "ativo" && l.paraQuem.trim().toLowerCase() === paraQuem.toLowerCase(),
        );
        if (mesmo) {
          const r = await alterarLink(ctx.admin, c, mesmo.id, pedido);
          return { desfecho: r.mudou ? "atualizou" : "ja_estava", link: paraResposta(r.link), ...(aviso ? { aviso } : {}) };
        }
        const link = await criarLink(ctx.admin, c, {
          ...pedido,
          paraQuem,
          validadeDias: ((args.validade_dias as ValidadeEmDias | undefined) ?? VALIDADE_PADRAO) as ValidadeEmDias,
        });
        return { desfecho: "criou", link: paraResposta(link), ...(aviso ? { aviso } : {}) };
      } catch (e) {
        traduzirRecusa(e);
      }
    },
  },

  {
    name: "plataforma_revogar_link_do_dono",
    description:
      "REVOGA um link para o dono do negócio: na hora, quem abrir o endereço vê \"este link não está disponível\". " +
      "Revogado não volta (para dar acesso de novo, crie outro com plataforma_garantir_link_do_dono, que gera outro endereço). " +
      "Informe `link_id` (de plataforma_ver_links_do_dono) ou `para_quem` (revoga os links ATIVOS com esse nome). " +
      "Revogar o que já estava revogado responde `ja_estava`. " +
      "O QUE NÃO FAZ: não apaga o link da lista (ele fica como revogado, para a trilha) e não avisa quem o recebeu.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      link_id: z.string().uuid().optional().describe("O id do link (de plataforma_ver_links_do_dono)."),
      para_quem: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .describe('Revoga os links ativos com este "para quem" (sem diferenciar maiúscula).'),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, para_quem: "Dono da clínica" },
    operacao: OPERACAO_COMPARTILHAR_PAINEIS,
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      const c = contextoDoLink(ctx, org.id);
      if (!args.link_id && !args.para_quem) {
        recusar('Informe `link_id` ou `para_quem`. Ex.: { "para_quem": "Dono da clínica" }');
      }
      try {
        if (args.link_id) {
          const r = await revogarLink(ctx.admin, c, String(args.link_id));
          return { desfecho: r.jaEstava ? "ja_estava" : "revogou", links: [paraResposta(r.link)] };
        }
        const alvoDoNome = String(args.para_quem).trim().toLowerCase();
        const ativos = (await listarLinks(ctx.admin, org.id)).filter(
          (l) => l.situacao === "ativo" && l.paraQuem.trim().toLowerCase() === alvoDoNome,
        );
        if (ativos.length === 0) {
          return { desfecho: "ja_estava", links: [], aviso: "Nenhum link ativo com esse nome." };
        }
        const feitos = [];
        for (const l of ativos) feitos.push((await revogarLink(ctx.admin, c, l.id)).link);
        return { desfecho: "revogou", links: feitos.map(paraResposta) };
      } catch (e) {
        traduzirRecusa(e);
      }
    },
  },
];

