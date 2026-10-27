/**
 * FORK MIA (.93) — O "ME MOSTRA COMO" E ONDE OS CLIENTES TRAVAM no MCP de
 * plataforma (docs/fork/assistente.md, seção 11). Toda função nova entra no MCP
 * na mesma versão. Quatro ferramentas, e a operação do token segue o estrago:
 *
 *   plataforma_ver_trilhas                   leitura: o catálogo das trilhas e
 *                                            o progresso de uma empresa por pessoa
 *   plataforma_configurar_trilhas            `implantar_configuracao`: liga e
 *                                            desliga trilhas, escolhe a recomendada
 *                                            no Início, recomeça o progresso
 *   plataforma_ver_onde_os_clientes_travam   leitura: o painel da Time, de todas
 *                                            as empresas, e a lista de melhorias
 *   plataforma_anotar_melhoria_do_produto    `responder_chamados`: a lista de
 *                                            melhorias do produto (é a Time
 *                                            falando do produto, não montagem)
 *
 * O QUE O MCP NÃO FAZ: não marca trilha como feita (feita vem do estado do
 * sistema), não lê a conversa de ninguém com o assistente (só números juntados
 * e as perguntas sem resposta) e não toca em nada da lista do "nunca".
 *
 * O cliente é o de serviço (o do servidor do MCP), e a empresa é conferida por
 * `alvo()` antes de qualquer leitura ou escrita.
 */
import { z } from "zod";

import { IDS_DAS_TRILHAS, TRILHAS, type IdDaTrilha } from "@/lib/assistente/trilhas/catalogo";
import { situacoesDasTrilhas, trilhaRecomendada } from "@/lib/assistente/trilhas/estado";
import { anotarMelhoria, listarMelhorias, ORIGENS_DA_MELHORIA, RecusaDaMelhoria, SITUACOES_DA_MELHORIA } from "@/lib/assistente/trilhas/melhorias";
import { ondeOsClientesTravam, SEGMENTOS_DO_PAINEL, type PeriodoDoPainel, type SegmentoDoPainel } from "@/lib/assistente/trilhas/onde-travam";
import { lerConfigDasTrilhas, trilhasFeitasNaEmpresa } from "@/lib/assistente/trilhas/progresso";
import { audit } from "@/lib/audit";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

import { Recusa } from "../recusa";
import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORG_DE_EXEMPLO, ORGANIZACAO } from "./comum";
import { OPERACAO_RESPONDER_CHAMADOS } from "./assistente";

const TRILHA = z.enum(IDS_DAS_TRILHAS);

interface LinhaDoProgresso {
  user_id: string;
  trilha: string;
  situacao: string;
  passo: number;
  comecou_em: string | null;
  pausou_em: string | null;
  feita_em: string | null;
}

export const FERRAMENTAS_DAS_TRILHAS_DO_ASSISTENTE: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_trilhas",
    description:
      "As TRILHAS do \"Me mostra como\" do assistente da MIA numa empresa: o catálogo (cada trilha com os passos, o que cada passo confere no " +
      "sistema e o papel que faz) e o PROGRESSO por pessoa: feita, pausada em qual passo, desde quando. As de pôr de pé (ligar o número, montar o " +
      "agente, o horário da IA, convidar a equipe) são da empresa e vêm com `feita_na_empresa`, lida no sistema agora. Devolve também a configuração " +
      "(\"Me mostra como\" ligado, trilhas desligadas) e a recomendada no Início. Sem o texto de conversa nenhuma. " +
      "QUANDO USAR: para ver onde a equipe de um cliente parou e antes de plataforma_configurar_trilhas.",
    inputSchema: { organization_id: ORGANIZACAO },
    exemplo: { organization_id: ORG_DE_EXEMPLO },
    operacao: null,
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      const config = await lerConfigDasTrilhas(c.admin, c.orgId);
      const [feitasNaEmpresa, linhas] = await Promise.all([
        trilhasFeitasNaEmpresa(c.admin, { organizationId: c.orgId, userId: c.autorUserId, desligadas: config.desligadas }),
        c.admin
          .from("mia_assistente_trilhas")
          .select("user_id, trilha, situacao, passo, comecou_em, pausou_em, feita_em")
          .eq("organization_id", c.orgId)
          .limit(5000),
      ]);
      if (linhas.error) throw new Error(`não consegui ler o progresso: ${linhas.error.message}`);
      const progresso = (linhas.data ?? []) as LinhaDoProgresso[];
      const nomes = await nomesDosAtendentes(progresso.map((l) => l.user_id));
      const recomendada =
        trilhaRecomendada(
          situacoesDasTrilhas({ papel: "admin", progresso: [], feitasNaEmpresa, modulos: new Set(["disparador", "email_marketing"]), config }),
          config,
        ) ?? null;
      return {
        organizacao: { id: org.id, nome: org.display_name, demonstracao: org.demonstracao },
        configuracao: {
          me_mostra_como: config.meMostraComo,
          desligadas: config.desligadas,
          recomendada_escolhida: config.recomendada,
          gravada: config.gravada,
        },
        recomendada_no_inicio: recomendada,
        trilhas: TRILHAS.map((t) => ({
          id: t.id,
          titulo: t.titulo,
          guia_curto: t.curto === true,
          da_empresa: t.daEmpresa,
          papel_minimo: t.papel,
          desligada: config.desligadas.includes(t.id),
          ...(t.daEmpresa ? { feita_na_empresa: feitasNaEmpresa.has(t.id) } : {}),
          pronto_quando: t.pronto,
          passos: t.passos.map((p, i) => ({ passo: i + 1, texto: p.texto, confere: p.confere, so_a_pessoa: p.soVoce === true })),
          pessoas: progresso
            .filter((l) => l.trilha === t.id)
            .map((l) => ({
              nome: (nomes.get(l.user_id) ?? "").trim() || "Pessoa sem nome",
              situacao: l.situacao,
              passo: Math.min(Number(l.passo) || 0, t.passos.length - 1) + 1,
              de: t.passos.length,
              desde: l.situacao === "pausada" ? l.pausou_em : l.situacao === "feita" ? l.feita_em : l.comecou_em,
            })),
        })),
        ...(org.demonstracao ? { aviso: "Empresa de demonstração: plataforma_reaplicar_demonstracao recomeça as trilhas de todos." } : {}),
      };
    },
  },
  {
    name: "plataforma_configurar_trilhas",
    description:
      "Configura as TRILHAS do \"Me mostra como\" numa empresa: `desligar` e `ligar` trilhas pelo id (as desligadas somem da lista da empresa), " +
      "`recomendada` (a trilha que o Início e o assistente recomendam; null volta à régua padrão: a pausada da pessoa ou a primeira que falta) e " +
      "`recomecar_progresso` (\"todas\" apaga o progresso de todo mundo na empresa; um e-mail, o de uma pessoa: útil na demonstração). " +
      "Só o que vier no pedido muda. Chamar de novo não tem efeito novo. " +
      "O QUE NÃO FAZ: não marca trilha como feita (feita vem do estado do sistema) e não liga o \"Me mostra como\" inteiro (isso é " +
      "plataforma_configurar_assistente, `me_mostra_como`).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      desligar: z.array(TRILHA).max(20).optional().describe('Ids das trilhas a desligar. Ex.: ["broadcast", "email"].'),
      ligar: z.array(TRILHA).max(20).optional().describe("Ids das trilhas a ligar de novo."),
      recomendada: TRILHA.nullable().optional().describe('A trilha recomendada no Início (ex.: "numero"), ou null para a régua padrão.'),
      recomecar_progresso: z
        .union([z.literal("todas"), z.string().trim().email()])
        .optional()
        .describe('"todas" apaga o progresso de toda a empresa; um e-mail, o de uma pessoa da equipe.'),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, desligar: ["email"], recomendada: "numero", recomecar_progresso: "todas" },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const desligar = (args.desligar as IdDaTrilha[] | undefined) ?? [];
      const ligar = (args.ligar as IdDaTrilha[] | undefined) ?? [];
      const temRecomendada = Object.prototype.hasOwnProperty.call(args, "recomendada") && args.recomendada !== undefined;
      const recomecar = args.recomecar_progresso as string | undefined;
      if (desligar.length === 0 && ligar.length === 0 && !temRecomendada && !recomecar) {
        throw new Recusa("Mande `desligar`, `ligar`, `recomendada` ou `recomecar_progresso`.");
      }
      if (desligar.some((d) => ligar.includes(d))) throw new Recusa("A mesma trilha não pode estar em `desligar` e em `ligar`.");

      const antes = await lerConfigDasTrilhas(c.admin, c.orgId);
      const desligadas = [...new Set([...antes.desligadas.filter((d) => !ligar.includes(d)), ...desligar])];
      const recomendada = temRecomendada ? ((args.recomendada as IdDaTrilha | null) ?? null) : antes.recomendada;
      if (recomendada && desligadas.includes(recomendada)) throw new Recusa(`A trilha "${recomendada}" está desligada: ligue antes de recomendar.`);

      if (desligar.length > 0 || ligar.length > 0 || temRecomendada) {
        const { error } = await c.admin.from("mia_assistente_trilhas_config").upsert(
          {
            organization_id: c.orgId,
            me_mostra_como: antes.meMostraComo,
            desligadas,
            recomendada,
            updated_by: c.autorUserId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id" },
        );
        if (error) throw new Error(`não consegui gravar as trilhas: ${error.message}`);
      }

      let recomecadas = 0;
      if (recomecar) {
        let consulta = c.admin.from("mia_assistente_trilhas").delete().eq("organization_id", c.orgId);
        if (recomecar !== "todas") {
          const userId = await pessoaPorEmail(c.admin, c.orgId, recomecar);
          if (!userId) throw new Recusa(`Ninguém da equipe desta empresa tem o e-mail ${recomecar}.`);
          consulta = consulta.eq("user_id", userId);
        }
        const { data, error } = await consulta.select("id");
        if (error) throw new Error(`não consegui recomeçar o progresso: ${error.message}`);
        recomecadas = (data ?? []).length;
      }

      void audit({
        actorUserId: c.autorUserId,
        action: "assistente.trilhas_configuradas",
        organizationId: c.orgId,
        resourceType: "mia_assistente_trilhas_config",
        resourceId: c.orgId,
        requestId: c.requestId,
        metadata: { desligadas, recomendada, recomecar: recomecar ? (recomecar === "todas" ? "todas" : "uma_pessoa") : null, recomecadas, via: "mcp_plataforma" },
      });
      return {
        configuracao: { me_mostra_como: antes.meMostraComo, desligadas, recomendada },
        antes: { desligadas: antes.desligadas, recomendada: antes.recomendada },
        ...(recomecar ? { progresso_recomecado: recomecadas } : {}),
      };
    },
  },
  {
    name: "plataforma_ver_onde_os_clientes_travam",
    description:
      "ONDE OS CLIENTES TRAVAM com o assistente da MIA, de TODAS as empresas (o painel da Time em /admin/assistente): os temas mais " +
      "perguntados (pelo manual que responderia, com quantas perguntas, quantas empresas e se já existe trilha ou guia curto), em que passo " +
      "cada trilha para (% de quem começou que chegou a cada passo, a maior queda, as perguntas feitas durante cada passo e os \"Já fiz\" " +
      "que não conferiram), as trilhas abandonadas (pausadas há mais de 7 dias), as propostas desfeitas por tipo e as perguntas SEM RESPOSTA " +
      "(só o texto, sem quem perguntou; e-mail, telefone e documento mascarados). Por período (7, 30 ou 90 dias) e segmento. Traz também a " +
      "lista de melhorias do produto. As empresas de demonstração não entram. " +
      "QUANDO USAR: para decidir o que melhorar no produto, antes de plataforma_anotar_melhoria_do_produto.",
    inputSchema: {
      periodo_dias: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional().describe("7, 30 (padrão) ou 90 dias."),
      segmento: z
        .enum(SEGMENTOS_DO_PAINEL as unknown as [string, ...string[]])
        .optional()
        .describe('"todos" (padrão), "clinica", "academia", "imobiliaria", "industria" ou "outro".'),
    },
    exemplo: { periodo_dias: 30, segmento: "clinica" },
    operacao: null,
    handler: async (ctx, args) => {
      const [painel, melhorias] = await Promise.all([
        ondeOsClientesTravam(ctx.admin, {
          periodoDias: ((args.periodo_dias as number | undefined) ?? 30) as PeriodoDoPainel,
          segmento: ((args.segmento as string | undefined) ?? "todos") as SegmentoDoPainel,
        }),
        listarMelhorias(ctx.admin, 100),
      ]);
      return {
        ...painel,
        melhorias: melhorias.map((m) => ({ titulo: m.titulo, evidencia: m.evidencia, origem: m.origem, situacao: m.situacao, anotada_em: m.created_at })),
      };
    },
  },
  {
    name: "plataforma_anotar_melhoria_do_produto",
    description:
      "Anota ou atualiza uma MELHORIA DO PRODUTO na lista da Time (o fim de /admin/assistente): `titulo`, `evidencia` (os números que a " +
      "sustentam, ex.: \"Ligar o primeiro número, passo 4: 38 pontos de queda em 30 dias\") e `situacao` (anotada, em_desenvolvimento ou " +
      "no_ar). O TÍTULO é a chave (sem diferença de maiúscula): chamar de novo com o mesmo título atualiza a evidência e a situação em vez de " +
      "duplicar. ATENÇÃO: escreva só número juntado e o tema; nunca nome de cliente, de pessoa ou texto de conversa. " +
      "O QUE NÃO FAZ: não abre chamado e não fala com cliente.",
    inputSchema: {
      titulo: z.string().trim().min(3).max(300).describe("O que melhorar, em uma frase. É a chave da lista."),
      evidencia: z.string().trim().max(1000).optional().describe("Os números que sustentam a melhoria."),
      situacao: z.enum(SITUACOES_DA_MELHORIA).optional().describe('"anotada" (padrão ao criar), "em_desenvolvimento" ou "no_ar".'),
      origem: z.enum(ORIGENS_DA_MELHORIA).optional().describe('De onde veio: "tema", "trilha", "sem_resposta", "proposta" ou "manual" (padrão).'),
    },
    exemplo: {
      titulo: "Trilha do número: mostrar onde fica \"Aparelhos conectados\" no iPhone e no Android",
      evidencia: "Ligar o primeiro número, passo 4: 38 pontos de queda em 30 dias",
      situacao: "em_desenvolvimento",
    },
    operacao: OPERACAO_RESPONDER_CHAMADOS,
    handler: async (ctx, args) => {
      try {
        const r = await anotarMelhoria(ctx.admin, {
          titulo: args.titulo as string,
          evidencia: args.evidencia as string | undefined,
          situacao: args.situacao as (typeof SITUACOES_DA_MELHORIA)[number] | undefined,
          origem: args.origem as (typeof ORIGENS_DA_MELHORIA)[number] | undefined,
          autorUserId: ctx.autorUserId,
        });
        if (r.desfecho !== "igual") {
          void audit({
            actorUserId: ctx.autorUserId,
            action: "assistente.melhoria_anotada",
            organizationId: null,
            resourceType: "mia_melhorias_do_produto",
            resourceId: r.melhoria.id,
            requestId: ctx.requestId,
            metadata: { desfecho: r.desfecho, situacao: r.melhoria.situacao, origem: r.melhoria.origem, via: "mcp_plataforma" },
          });
        }
        return {
          ok: true,
          desfecho: r.desfecho,
          titulo: r.melhoria.titulo,
          situacao: r.melhoria.situacao,
          anotada_em: r.melhoria.created_at?.slice(0, 10) ?? null,
        };
      } catch (erro) {
        if (erro instanceof RecusaDaMelhoria) throw new Recusa(erro.message);
        throw erro;
      }
    },
  },
];

/** O id de uma pessoa da equipe pelo e-mail (o e-mail mora no Auth, lido pessoa a pessoa). */
async function pessoaPorEmail(
  admin: Parameters<FerramentaDePlataforma["handler"]>[0]["admin"],
  orgId: string,
  email: string,
): Promise<string | null> {
  const { data, error } = await admin.from("user_organizations").select("user_id").eq("organization_id", orgId).is("revoked_at", null).limit(500);
  if (error) throw new Error(`não consegui ler a equipe: ${error.message}`);
  const procurado = email.trim().toLowerCase();
  for (const membro of (data ?? []) as Array<{ user_id: string }>) {
    const { data: achado } = await admin.auth.admin.getUserById(membro.user_id);
    if (achado?.user?.email?.trim().toLowerCase() === procurado) return membro.user_id;
  }
  return null;
}
