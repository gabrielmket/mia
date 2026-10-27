/**
 * FORK MIA (.88) — as ferramentas do ASSISTENTE DA MIA no MCP de plataforma
 * (docs/fork/assistente.md). Cinco, e a operação do token segue o estrago:
 *
 *   plataforma_configurar_assistente                `implantar_configuracao`: liga
 *                                                   e desliga por empresa e por
 *                                                   papel, o limite do dia, o
 *                                                   resumo da manhã padrão e (.94)
 *                                                   os tipos de proposta e o
 *                                                   "pode pedir"
 *   plataforma_garantir_conhecimento_do_assistente  `implantar_configuracao`: a
 *                                                   base própria, por título
 *   plataforma_ver_assistente                       leitura: uso, perguntas sem
 *                                                   resposta e custo
 *   plataforma_ver_chamados                         leitura: os chamados
 *   plataforma_responder_chamado                    `responder_chamados`: a
 *                                                   resposta chega a quem abriu
 *                                                   no assistente, no sino e no
 *                                                   e-mail
 *
 * O cliente é o de serviço (o do servidor do MCP), e a empresa é conferida por
 * `alvo()` antes de qualquer leitura ou escrita.
 */
import { z } from "zod";

import { listarChamadosDaPlataforma, RecusaDoChamado, responderChamado } from "@/lib/assistente/chamados-da-plataforma";
import { COLUNAS_DA_CONFIG, configDaLinha, LIMITE_MAXIMO_POR_DIA } from "@/lib/assistente/config";
// FORK MIA (.94): os tipos de proposta ligados e o "pode pedir".
import { TIPOS_DE_PROPOSTA } from "@/lib/assistente/propostas/tipos";
import { garantirConhecimento, TETO_DE_ITENS, TETO_DO_TEXTO } from "@/lib/assistente/conhecimento";
import { PAPEIS_DO_ASSISTENTE, SITUACOES_DE_CHAMADO } from "@/lib/assistente/tipos";
// FORK MIA (.93): o "Me mostra como" e as trilhas na leitura do assistente.
import { definirMeMostraComo, resumoDasTrilhasDaEmpresa } from "@/lib/assistente/trilhas/progresso";
import { audit } from "@/lib/audit";

import { Recusa } from "../recusa";
import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORG_DE_EXEMPLO, ORGANIZACAO } from "./comum";

export const OPERACAO_RESPONDER_CHAMADOS = "responder_chamados";

const PAPEL = z.enum(PAPEIS_DO_ASSISTENTE);

function inicioDoMes(agora: Date): string {
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)).toISOString();
}

export const FERRAMENTAS_DO_ASSISTENTE: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_configurar_assistente",
    description:
      "Configura o ASSISTENTE DA MIA de um cliente: o chat que a equipe dele usa dentro do sistema para a rotina do dia, os números e as dúvidas de uso. " +
      "Liga ou desliga a empresa inteira (`ligado`), diz quais papéis usam (`papeis`: viewer, agent, manager, admin), o limite de perguntas por pessoa por dia " +
      "(padrão 50; a IA é da plataforma e o gasto entra no consumo de IA da empresa) e se o resumo da manhã nasce ligado para quem não escolheu (`resumo_da_manha_padrao`, padrão desligado). " +
      "Desde a .94, também os TIPOS DE PROPOSTA que o assistente prepara na empresa (`tipos_de_proposta`: as três do modelo e as nove do dia a dia; null volta a todos) " +
      "e se quem não aprova pode PEDIR a quem aprova com o cartão pronto (`pode_pedir`, padrão ligado). " +
      "Só o que vier no pedido muda; o resto continua. Pode ser chamada de novo sem efeito colateral. " +
      "Desde a .93, `me_mostra_como` liga ou desliga a guia que destaca cada passo na tela (as trilhas; padrão ligado). " +
      "O QUE NÃO FAZ: não escreve a base própria (isso é plataforma_garantir_conhecimento_do_assistente), não muda o resumo de quem já escolheu o seu, " +
      "não liga nem desliga uma trilha só (isso é plataforma_configurar_trilhas) e não liga nada da lista do \"nunca\" (número, cobrança, convite, usuários, chaves, apagar, publicar, mensagem a cliente).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      ligado: z.boolean().optional().describe("Liga (true) ou desliga (false) o assistente na empresa inteira."),
      papeis: z
        .array(PAPEL)
        .max(4)
        .optional()
        .describe('Os papéis que usam o assistente: "viewer", "agent", "manager", "admin". Lista vazia desliga para todos os papéis.'),
      perguntas_por_pessoa_por_dia: z
        .number()
        .int()
        .min(1)
        .max(LIMITE_MAXIMO_POR_DIA)
        .optional()
        .describe(`O limite de perguntas por pessoa por dia, de 1 a ${LIMITE_MAXIMO_POR_DIA}. Padrão 50.`),
      resumo_da_manha_padrao: z
        .boolean()
        .optional()
        .describe("true: o resumo da manhã das 8h nasce ligado para quem não escolheu. Cada pessoa continua podendo desligar o seu."),
      tipos_de_proposta: z
        .array(z.enum(TIPOS_DE_PROPOSTA))
        .max(TIPOS_DE_PROPOSTA.length)
        .nullable()
        .optional()
        .describe(
          'Os tipos de proposta que o assistente prepara na empresa: "agente", "funil", "followup" (os do modelo) e "etapa_criar", "etapa_renomear", "resposta", "etiqueta", "tarefa", "rascunho_de_followup", "conhecimento", "relatorio", "meta". null = todos. Lista vazia = nenhum.',
        ),
      pode_pedir: z
        .boolean()
        .optional()
        .describe("true (padrão): quem não aprova manda o cartão pronto a quem aprova, no assistente e no sino. false: o assistente só diz quem pode."),
      // FORK MIA (.93): o "Me mostra como" (as trilhas que andam na tela; docs/fork/assistente.md, seção 11).
      me_mostra_como: z
        .boolean()
        .optional()
        .describe('O "Me mostra como": a guia que destaca cada passo na tela e confere no sistema. Padrão ligado; desligado, o assistente só explica.'),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      ligado: true,
      papeis: ["admin", "manager", "agent"],
      perguntas_por_pessoa_por_dia: 50,
      resumo_da_manha_padrao: false,
      tipos_de_proposta: null,
      pode_pedir: true,
      me_mostra_como: true,
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const { data: atual } = await c.admin
        .from("mia_assistente_config")
        .select(COLUNAS_DA_CONFIG)
        .eq("organization_id", c.orgId)
        .maybeSingle();
      const antes = configDaLinha(atual as Record<string, unknown> | null);
      const depois = {
        ligado: typeof args.ligado === "boolean" ? args.ligado : antes.ligado,
        papeis: Array.isArray(args.papeis) ? [...new Set(args.papeis as string[])] : antes.papeis,
        perguntas_por_pessoa_por_dia:
          typeof args.perguntas_por_pessoa_por_dia === "number" ? args.perguntas_por_pessoa_por_dia : antes.perguntasPorPessoaPorDia,
        resumo_da_manha_padrao:
          typeof args.resumo_da_manha_padrao === "boolean" ? args.resumo_da_manha_padrao : antes.resumoDaManhaPadrao,
        tipos_de_proposta:
          args.tipos_de_proposta === null
            ? null
            : Array.isArray(args.tipos_de_proposta)
              ? [...new Set(args.tipos_de_proposta as string[])]
              : antes.tiposDePropostas,
        pode_pedir: typeof args.pode_pedir === "boolean" ? args.pode_pedir : antes.podePedir,
      };
      const { error } = await c.admin.from("mia_assistente_config").upsert(
        {
          organization_id: c.orgId,
          ...depois,
          updated_by: c.autorUserId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id" },
      );
      if (error) throw new Error(`não consegui gravar a configuração do assistente: ${error.message}`);
      // FORK MIA (.93): o "Me mostra como" mora na configuração das trilhas (9090).
      const meMostraComo = await definirMeMostraComo(c.admin, { organizationId: c.orgId, valor: args.me_mostra_como, autorUserId: c.autorUserId });
      void audit({
        actorUserId: c.autorUserId,
        action: "assistente.configurado",
        organizationId: c.orgId,
        resourceType: "mia_assistente_config",
        resourceId: c.orgId,
        requestId: c.requestId,
        metadata: { ...depois, me_mostra_como: meMostraComo.depois, via: "mcp_plataforma" },
      });
      return {
        configuracao: depois,
        antes: {
          ligado: antes.ligado,
          papeis: antes.papeis,
          perguntas_por_pessoa_por_dia: antes.perguntasPorPessoaPorDia,
          resumo_da_manha_padrao: antes.resumoDaManhaPadrao,
          tipos_de_proposta: antes.tiposDePropostas,
          pode_pedir: antes.podePedir,
        },
        me_mostra_como: meMostraComo,
      };
    },
  },
  {
    name: "plataforma_garantir_conhecimento_do_assistente",
    description:
      "Grava a BASE PRÓPRIA da empresa no assistente da MIA: o \"como trabalhamos aqui\" que o assistente usa nas respostas à equipe " +
      "(ex.: \"proposta acima de R$ 10 mil passa pela gestora\", \"o horário do suporte é das 8h às 18h\"). " +
      "GARANTIR quer dizer: a chave é o TÍTULO (sem diferença de maiúscula), então chamar de novo atualiza o texto em vez de duplicar. " +
      `Até ${TETO_DE_ITENS} itens por empresa, texto de até ${TETO_DO_TEXTO} caracteres. \`remover\` tira itens pelo título. ` +
      "ATENÇÃO: o que entra aqui toda a equipe da empresa lê pelo assistente; não grave dado pessoal de cliente nem senha. " +
      "O QUE NÃO FAZ: não é o conhecimento do agente que fala com o cliente final (isso é plataforma_garantir_conhecimento).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      itens: z
        .array(
          z
            .object({
              titulo: z.string().trim().min(1).max(120).describe("O título, que é a chave natural."),
              texto: z.string().trim().min(1).max(TETO_DO_TEXTO).describe("O texto que o assistente usa."),
              ativo: z.boolean().optional().describe("false guarda o item sem o assistente usar."),
            })
            .strict(),
        )
        .max(TETO_DE_ITENS)
        .optional()
        .describe("Os itens a criar ou atualizar."),
      remover: z.array(z.string().trim().min(1).max(120)).max(TETO_DE_ITENS).optional().describe("Títulos a tirar da base."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      itens: [{ titulo: "Aprovação de proposta", texto: "Proposta acima de R$ 10 mil passa pela gestora comercial antes de ir ao cliente." }],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const itens = (args.itens as Array<{ titulo: string; texto: string; ativo?: boolean }> | undefined) ?? [];
      const remover = (args.remover as string[] | undefined) ?? [];
      if (itens.length === 0 && remover.length === 0) throw new Recusa("Mande `itens` para gravar ou `remover` para tirar.");
      const resultado = await garantirConhecimento(c.admin, {
        organizationId: c.orgId,
        itens,
        remover,
        autorUserId: c.autorUserId,
        via: "mcp_plataforma",
      });
      void audit({
        actorUserId: c.autorUserId,
        action: "assistente.conhecimento_alterado",
        organizationId: c.orgId,
        resourceType: "mia_assistente_conhecimento",
        resourceId: c.orgId,
        requestId: c.requestId,
        metadata: {
          criados: resultado.criados.length,
          atualizados: resultado.atualizados.length,
          removidos: resultado.removidos.length,
          via: "mcp_plataforma",
        },
      });
      return resultado;
    },
  },
  {
    name: "plataforma_ver_assistente",
    description:
      "O assistente da MIA de um cliente, do lado da plataforma: a configuração (ligado, papéis, limite do dia, resumo da manhã padrão), " +
      "o USO nos últimos 30 dias por papel (perguntas e pessoas), as perguntas que ficaram SEM RESPOSTA (o texto da pergunta e quantas vezes, nunca a conversa), " +
      "as TRILHAS do Me mostra como (começadas, feitas, pausadas e abandonadas, no total e por trilha; desde a .93), " +
      "quantos itens tem a base própria, o CUSTO do assistente no mês (chamadas e centavos, de llm_calls) e (.94) as PROPOSTAS dos últimos 30 dias por tipo: " +
      "preparadas, pedidas a quem aprova, aplicadas, desfeitas, recusadas e vencidas (proposta muito desfeita é proposta ruim). " +
      "QUANDO USAR: para conferir a implantação e para decidir o que escrever na base própria.",
    inputSchema: { organization_id: ORGANIZACAO },
    exemplo: { organization_id: ORG_DE_EXEMPLO },
    operacao: null,
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      const agora = new Date();
      const desde = new Date(agora.getTime() - 30 * 86_400_000).toISOString();
      const [config, perguntas, semResposta, base, vinculos, custo, propostas] = await Promise.all([
        c.admin
          .from("mia_assistente_config")
          .select(COLUNAS_DA_CONFIG)
          .eq("organization_id", c.orgId)
          .maybeSingle(),
        c.admin
          .from("mia_assistente_mensagens")
          .select("user_id")
          .eq("organization_id", c.orgId)
          .eq("tipo", "pergunta")
          .gte("created_at", desde)
          .limit(10_000),
        c.admin
          .from("mia_assistente_mensagens")
          .select("texto, created_at")
          .eq("organization_id", c.orgId)
          .eq("tipo", "pergunta")
          .eq("sem_resposta", true)
          .gte("created_at", desde)
          .order("created_at", { ascending: false })
          .limit(500),
        c.admin.from("mia_assistente_conhecimento").select("id", { count: "exact", head: true }).eq("organization_id", c.orgId),
        c.admin.from("user_organizations").select("user_id, role").eq("organization_id", c.orgId).is("revoked_at", null),
        c.admin
          .from("llm_calls")
          .select("cost_cents")
          .eq("organization_id", c.orgId)
          .eq("purpose", "assistente")
          .gte("created_at", inicioDoMes(agora))
          .limit(20_000),
        // FORK MIA (.94): as propostas dos últimos 30 dias, por tipo e situação.
        c.admin
          .from("mia_assistente_propostas")
          .select("tipo, situacao, pedida_em")
          .eq("organization_id", c.orgId)
          .gte("created_at", desde)
          .limit(5_000),
      ]);
      const papelDe = new Map(((vinculos.data ?? []) as Array<{ user_id: string; role: string }>).map((v) => [v.user_id, v.role]));
      const porPapel: Record<string, { perguntas: number; pessoas: Set<string> }> = {};
      for (const p of (perguntas.data ?? []) as Array<{ user_id: string }>) {
        const papel = papelDe.get(p.user_id) ?? "saiu_da_empresa";
        porPapel[papel] ??= { perguntas: 0, pessoas: new Set() };
        porPapel[papel].perguntas += 1;
        porPapel[papel].pessoas.add(p.user_id);
      }
      const grupos = new Map<string, { pergunta: string; vezes: number }>();
      for (const s of (semResposta.data ?? []) as Array<{ texto: string }>) {
        const chave = s.texto.trim().toLowerCase();
        const g = grupos.get(chave) ?? { pergunta: s.texto.trim(), vezes: 0 };
        g.vezes += 1;
        grupos.set(chave, g);
      }
      const chamadas = (custo.data ?? []) as Array<{ cost_cents: number | string | null }>;
      // FORK MIA (.93): as trilhas do "Me mostra como": começadas, feitas e abandonadas.
      const trilhas = await resumoDasTrilhasDaEmpresa(c.admin, c.orgId, agora).catch(() => null);
      const centavos = chamadas.reduce((soma, l) => soma + (l.cost_cents === null ? 0 : Number(l.cost_cents)), 0);
      return {
        organizacao: { id: org.id, nome: org.display_name, demonstracao: org.demonstracao },
        configuracao: (() => {
          const cfg = configDaLinha(config.data as Record<string, unknown> | null);
          return {
            ligado: cfg.ligado,
            papeis: cfg.papeis,
            perguntas_por_pessoa_por_dia: cfg.perguntasPorPessoaPorDia,
            resumo_da_manha_padrao: cfg.resumoDaManhaPadrao,
            tipos_de_proposta: cfg.tiposDePropostas,
            pode_pedir: cfg.podePedir,
            gravada: cfg.gravada,
          };
        })(),
        propostas_30_dias: (() => {
          const porTipo: Record<string, Record<string, number>> = {};
          for (const p of (propostas.data ?? []) as Array<{ tipo: string; situacao: string; pedida_em: string | null }>) {
            const t = (porTipo[p.tipo] ??= { preparadas: 0, pedidas: 0, aplicadas: 0, desfeitas: 0, recusadas: 0, vencidas: 0, pendentes: 0 });
            t.preparadas = (t.preparadas ?? 0) + 1;
            if (p.pedida_em) t.pedidas = (t.pedidas ?? 0) + 1;
            if (p.situacao === "aplicada" || p.situacao === "desfeita") t.aplicadas = (t.aplicadas ?? 0) + 1;
            if (p.situacao === "desfeita") t.desfeitas = (t.desfeitas ?? 0) + 1;
            if (p.situacao === "rejeitada") t.recusadas = (t.recusadas ?? 0) + 1;
            if (p.situacao === "expirada") t.vencidas = (t.vencidas ?? 0) + 1;
            if (p.situacao === "pendente" || p.situacao === "aprovada") t.pendentes = (t.pendentes ?? 0) + 1;
          }
          return porTipo;
        })(),
        uso_30_dias: Object.fromEntries(
          Object.entries(porPapel).map(([papel, v]) => [papel, { perguntas: v.perguntas, pessoas: v.pessoas.size }]),
        ),
        sem_resposta: [...grupos.values()].sort((a, b) => b.vezes - a.vezes).slice(0, 20),
        base_propria_itens: base.count ?? 0,
        trilhas,
        custo_do_mes: {
          chamadas: chamadas.length,
          centavos_usd: Math.round(centavos * 100) / 100,
          sem_preco: chamadas.filter((l) => l.cost_cents === null).length,
        },
        ...(org.demonstracao ? { aviso: "Empresa de demonstração: os números são dos dados fictícios." } : {}),
      };
    },
  },
  {
    name: "plataforma_ver_chamados",
    description:
      "Os CHAMADOS que as equipes dos clientes abriram pelo assistente da MIA (Erro, Dúvida ou Pedido), com o contexto que o assistente juntou " +
      "(tela, hora, versão do sistema, navegador, mensagem do sistema, se tem print). De UMA empresa (`organization_id`) ou de todas (sem ele). " +
      "Por padrão só os abertos (novo e em análise); `situacao` muda o corte. Os da empresa de demonstração não entram: eles não saem para a Time. " +
      "QUANDO USAR: para a fila de suporte do dia e antes de plataforma_responder_chamado.",
    inputSchema: {
      organization_id: z
        .string()
        .uuid()
        .optional()
        .describe("O id do cliente (de plataforma_listar_clientes). Sem ele, vêm os chamados de todas as empresas."),
      situacao: z
        .enum(["abertos", "novo", "em_analise", "resolvido", "todos"])
        .optional()
        .describe('"abertos" (padrão: novo e em análise), "novo", "em_analise", "resolvido" ou "todos".'),
      limite: z.number().int().min(1).max(200).optional().describe("Quantos devolver (padrão 50, até 200)."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, situacao: "abertos" },
    operacao: null,
    handler: async (ctx, args) => {
      let organizationId: string | null = null;
      if (typeof args.organization_id === "string") {
        const { c } = await alvo(ctx, args);
        organizationId = c.orgId;
      }
      const chamados = await listarChamadosDaPlataforma(ctx.admin, {
        organizationId,
        situacao: (args.situacao as "abertos" | undefined) ?? "abertos",
        limite: (args.limite as number | undefined) ?? 50,
      });
      return {
        total: chamados.length,
        chamados: chamados.map((ch) => ({
          numero: ch.numero,
          empresa: ch.empresa,
          organization_id: ch.organization_id,
          tipo: ch.tipo,
          situacao: ch.situacao,
          quem_abriu: ch.quem_abriu,
          quando: ch.created_at,
          texto: ch.texto,
          contexto: ch.contexto,
          tem_print: ch.tem_print,
          resposta: ch.resposta,
        })),
      };
    },
  },
  {
    name: "plataforma_responder_chamado",
    description:
      "Responde um chamado do assistente da MIA e muda a situação (novo, em_analise, resolvido). Quem abriu recebe a resposta no assistente, " +
      "com um aviso no sino e por e-mail, quando há resposta nova ou quando o chamado é resolvido. " +
      "ATENÇÃO: o texto da resposta chega como está a uma pessoa da equipe do cliente, em nome da Time Company; confira antes de mandar. " +
      "O QUE NÃO FAZ: não abre chamado e não responde chamado da empresa de demonstração.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      numero: z.number().int().min(1).describe("O número do chamado, de plataforma_ver_chamados (ex.: 1042)."),
      situacao: z.enum(SITUACOES_DE_CHAMADO).describe('"novo", "em_analise" ou "resolvido".'),
      resposta: z.string().trim().min(1).max(8000).optional().describe("O texto da resposta para quem abriu."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      numero: 1042,
      situacao: "resolvido",
      resposta: "O valor do negócio é obrigatório. Preencha o valor e salve de novo.",
    },
    operacao: OPERACAO_RESPONDER_CHAMADOS,
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      try {
        const r = await responderChamado(c.admin, {
          numero: args.numero as number,
          organizationId: c.orgId,
          situacao: args.situacao as (typeof SITUACOES_DE_CHAMADO)[number],
          resposta: (args.resposta as string | undefined) ?? null,
          respondidoPor: c.autorUserId,
        });
        void audit({
          actorUserId: c.autorUserId,
          action: "assistente.chamado_respondido",
          organizationId: c.orgId,
          resourceType: "mia_chamados",
          resourceId: null,
          requestId: c.requestId,
          metadata: { numero: r.numero, situacao: r.situacao, entregue: r.entregue, via: "mcp_plataforma" },
        });
        return r;
      } catch (erro) {
        if (erro instanceof RecusaDoChamado) throw new Recusa(erro.message);
        throw erro;
      }
    },
  },
];
