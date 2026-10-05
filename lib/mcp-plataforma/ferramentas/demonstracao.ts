/**
 * As ferramentas das EMPRESAS DE DEMONSTRAÇÃO do MCP de plataforma
 * (docs/fork/cliente-modelo.md).
 *
 * Três ferramentas, e a operação do token segue o tamanho do estrago:
 *
 *   plataforma_listar_demonstracoes     leitura
 *   plataforma_criar_demonstracao       `criar_cliente`: nasce uma organização
 *                                       nova na instalação
 *   plataforma_reaplicar_demonstracao   `implantar_configuracao`: regrava os dados
 *                                       fictícios de uma demonstração que já
 *                                       existe (renova as datas)
 *
 * Criar e reaplicar são duas ferramentas, e não uma com a operação decidida
 * dentro do handler, porque a guarda do servidor confere a operação ANTES do
 * handler (`servidor.ts`): uma ferramenta que escolhesse a própria operação
 * seria uma ferramenta conferindo a própria permissão.
 *
 * ── Por onde a semente é gravada ──────────────────────────────────────────
 *
 * Pela MESMA função do terminal (`aplicarSemente`, `lib/demonstracao/semente/`),
 * conectada ao Postgres pelo `SUPABASE_DB_URL` do app (o pool do motor de
 * agentes). A semente é SQL com transação, `do $$` e `on conflict`: não cabe no
 * PostgREST. Medido no banco de teste: uma demonstração inteira grava em poucos
 * segundos, bem dentro do teto da rota (`maxDuration` de 300 s), então a
 * chamada é síncrona e a resposta já traz as contagens. Sem `SUPABASE_DB_URL`
 * no app, a recusa ensina o caminho do terminal (`--sql`).
 *
 * Nada aqui envia coisa alguma: a empresa nasce com a trava da migration 9010
 * (`organizations.demonstracao`), e a semente grava o histórico como já
 * entregue e marca como consumidos os eventos que ela mesma emitiu.
 */
import { z } from "zod";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { aplicarSemente, idDaDemonstracao, type ResumoDaSemente } from "@/lib/demonstracao/semente/aplicar";
import { sementeDoSegmento, todasAsSementes } from "@/lib/demonstracao/semente/segmentos";
import { SEGMENTOS_DE_DEMONSTRACAO, type SegmentoDeDemonstracao } from "@/lib/demonstracao/semente/tipos";

import { recusar } from "../recusa";
import type { ContextoDaFerramenta, FerramentaDePlataforma } from "../tipos";

/** As tabelas que a listagem conta, com o nome que a resposta usa. */
const CONTAGENS = {
  negocios: "crm_leads",
  contatos: "contacts",
  conversas: "conversations",
  compromissos: "calendar_appointments",
  tarefas: "crm_tasks",
  obrigacoes: "mia_obrigacoes",
  produtos: "catalog_products",
  followups: "followup_flow_pointers",
} as const;

const SEGMENTO = z
  .enum(SEGMENTOS_DE_DEMONSTRACAO)
  .describe(
    "Qual demonstração: construtora (construtora e imobiliária), clinica-odonto (clínica odontológica), industria " +
      "(fábrica que vende para revendas e profissionais), academia, ou bancada (a Empresa Modelo, com todos os segmentos " +
      "misturados, que serve para testar e não para mostrar a cliente).",
  );

const EMAILS_DE_ACESSO = z
  .array(z.string().trim().toLowerCase().email().max(254))
  .max(20)
  .optional()
  .describe(
    "E-mails de pessoas que JÁ têm login nesta instalação e devem entrar como admin da demonstração (quem vai apresentar). " +
      "Quem criou o token entra sempre. E-mail sem login vira aviso na resposta, não erro, e nenhum convite é mandado.",
  );

interface OrganizacaoAchada {
  id: string;
  slug: string;
  display_name: string;
  demonstracao: boolean;
  created_at: string;
  settings: Record<string, unknown> | null;
}

/** De qual semente a empresa veio e quando ela foi aplicada (gravado pela própria semente). */
function aplicadaEm(org: OrganizacaoAchada): string | null {
  const marca = (org.settings ?? {}).semente_de_demonstracao as { aplicada_em?: unknown } | undefined;
  return typeof marca?.aplicada_em === "string" ? marca.aplicada_em : null;
}

async function acharPeloSlug(ctx: ContextoDaFerramenta, slug: string): Promise<OrganizacaoAchada | null> {
  const { data, error } = await ctx.admin
    .from("organizations")
    .select("id, slug, display_name, demonstracao, created_at, settings")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`não consegui procurar a demonstração: ${error.message}`);
  return (data as OrganizacaoAchada | null) ?? null;
}

async function contar(ctx: ContextoDaFerramenta, organizacaoId: string): Promise<Record<string, number>> {
  const pares = await Promise.all(
    Object.entries(CONTAGENS).map(async ([nome, tabela]) => {
      const { data, count, error } = await ctx.admin
        .from(tabela)
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizacaoId);
      if (error) throw new Error(`não consegui contar ${nome} da demonstração: ${error.message}`);
      // `head: true` devolve só a contagem; um cliente que ignore a opção devolve as linhas.
      return [nome, count ?? (Array.isArray(data) ? data.length : 0)] as const;
    }),
  );
  return Object.fromEntries(pares);
}

/** A demonstração do segmento, se existir; recusa quando o slug é de uma empresa que não é ela. */
async function demonstracaoExistente(
  ctx: ContextoDaFerramenta,
  segmento: SegmentoDeDemonstracao,
): Promise<OrganizacaoAchada | null> {
  const s = sementeDoSegmento(segmento);
  const org = await acharPeloSlug(ctx, s.slug);
  if (!org) return null;
  if (org.id !== idDaDemonstracao(segmento)) {
    recusar(
      `O endereço "${s.slug}" já é de outra organização (${org.display_name}, id ${org.id}), que não é a demonstração ` +
        `"${s.nome}". A semente não toma o lugar de uma empresa que não é dela, então nada foi gravado. ` +
        "Confira em plataforma_listar_clientes de quem é essa organização antes de qualquer coisa.",
    );
  }
  if (!org.demonstracao) {
    recusar(
      `A organização "${org.display_name}" (id ${org.id}) é a demonstração "${s.nome}", mas está DESMARCADA ` +
        "(organizations.demonstracao = false): alguém tirou a trava para reaproveitar a empresa. Com a trava fora, os " +
        "dados fictícios poderiam sair para fora, então a semente não grava nada aí. Quem desmarcou decide: marcar de novo " +
        "(update public.organizations set demonstracao = true, com os destinos de fora desligados) ou deixar como está.",
    );
  }
  return org;
}

/** O Postgres do app; sem ele, a recusa ensina o caminho do terminal. */
function poolDaSemente(segmento: SegmentoDeDemonstracao): ReturnType<typeof getRequestPool> {
  try {
    return getRequestPool();
  } catch {
    recusar(
      "Esta instalação não tem SUPABASE_DB_URL no ambiente do app, então o MCP não alcança o Postgres para gravar a " +
        "semente (ela é SQL com transação, que o PostgREST não executa). Nada foi gravado. O caminho sem o app é o terminal: " +
        `npx tsx scripts/cliente-modelo.ts --segmento ${segmento} --sql ${segmento}.sql, e aplicar o arquivo pelo /pg/query ` +
        "do postgres-meta (docs/fork/cliente-modelo.md).",
    );
  }
}

/** Grava a semente pelo Postgres do app, numa transação só. */
async function gravarSemente(
  ctx: ContextoDaFerramenta,
  segmento: SegmentoDeDemonstracao,
  emails: readonly string[],
): Promise<ResumoDaSemente & { duracao_ms: number }> {
  const pool = poolDaSemente(segmento);
  const inicio = Date.now();
  const cliente = await pool.connect();
  try {
    const resumo = await aplicarSemente(cliente, {
      segmento,
      emailsDeAcesso: emails,
      idsDeAcesso: [ctx.autorUserId],
    });
    return { ...resumo, duracao_ms: Date.now() - inicio };
  } finally {
    cliente.release();
  }
}

function emailsDe(args: Record<string, unknown>): string[] {
  return Array.isArray(args.emails_de_acesso) ? (args.emails_de_acesso as string[]) : [];
}

const AVISO_DE_TRAVA =
  "Nada sai de uma empresa de demonstração: mensagem, follow-up, automação, conversão, convite, aviso e agenda de fora são " +
  "recusados no banco (migration 9010). Testar o agente pela tela chama a IA de verdade e gasta saldo real.";

export const FERRAMENTAS_DE_DEMONSTRACAO: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_listar_demonstracoes",
    description:
      "Lista as EMPRESAS DE DEMONSTRAÇÃO desta instalação: uma por segmento (construtora, clínica odontológica, indústria e " +
      "academia) e a bancada de teste (a Empresa Modelo). Para cada segmento diz se a empresa já existe, o id, quando a " +
      "semente foi aplicada pela última vez e quantos negócios, contatos, conversas, compromissos, tarefas, obrigações, " +
      "produtos e follow-ups ela tem; e lista à parte qualquer outra organização marcada como demonstração que não veio de " +
      "uma semente. Use antes de apresentar a um cliente: se a última aplicação foi há dias, as datas da agenda e dos " +
      "vencimentos já envelheceram, e plataforma_reaplicar_demonstracao as renova. São dados fictícios, não clientes.",
    inputSchema: {},
    operacao: null,
    exemplo: {},
    handler: async (ctx) => {
      const { data, error } = await ctx.admin
        .from("organizations")
        .select("id, slug, display_name, demonstracao, created_at, settings")
        .eq("demonstracao", true)
        .order("created_at", { ascending: true });
      if (error) throw new Error(`não consegui listar as demonstrações: ${error.message}`);
      const marcadas = (data ?? []) as OrganizacaoAchada[];

      const demonstracoes = await Promise.all(
        todasAsSementes().map(async (s) => {
          const id = idDaDemonstracao(s.segmento);
          const org = marcadas.find((o) => o.id === id) ?? null;
          return {
            segmento: s.segmento,
            rotulo: s.rotulo,
            nome: s.nome,
            o_que_mostra: s.oQueMostra,
            existe: org !== null,
            organization_id: org?.id ?? null,
            slug: s.slug,
            aplicada_em: org ? aplicadaEm(org) : null,
            contagens: org ? await contar(ctx, org.id) : null,
            proximo_passo: org
              ? "Para renovar as datas antes de apresentar: plataforma_reaplicar_demonstracao."
              : "Ainda não existe: plataforma_criar_demonstracao a cria (operação criar_cliente).",
          };
        }),
      );
      const ids = new Set(todasAsSementes().map((s) => idDaDemonstracao(s.segmento)));
      const outras = marcadas
        .filter((o) => !ids.has(o.id))
        .map((o) => ({ organization_id: o.id, nome: o.display_name, slug: o.slug, criada_em: o.created_at }));
      return { demonstracoes, outras_marcadas_como_demonstracao: outras, trava: AVISO_DE_TRAVA };
    },
  },
  {
    name: "plataforma_criar_demonstracao",
    description:
      "Cria a EMPRESA DE DEMONSTRAÇÃO de um segmento, inteira, com dados fictícios que parecem o negócio do cliente que vai " +
      "vê-la: funis com campos e probabilidades, negócios em todas as etapas com valores, contatos e empresas, conversas com " +
      "a IA, tarefas, agenda passada e futura, documentos e obrigações, os quatro follow-ups do segmento publicados, produtos " +
      "e um agente de IA com persona do segmento (sem versão publicada). A empresa nasce com a trava de demonstração e quem " +
      "criou o token entra como admin, junto com os `emails_de_acesso`. Grava numa transação só: ou a empresa inteira fica " +
      "de pé, ou nada muda. Reexecução segura: se a demonstração do segmento já existe, a chamada não grava nada e devolve a " +
      "que existe. ANTES DE chamar, veja plataforma_listar_demonstracoes. O QUE NÃO FAZ: não renova uma demonstração que já " +
      "existe (isso é plataforma_reaplicar_demonstracao, operação implantar_configuracao), não manda convite nem e-mail, não " +
      "conecta número de WhatsApp e não publica o agente. " +
      AVISO_DE_TRAVA,
    inputSchema: { segmento: SEGMENTO, emails_de_acesso: EMAILS_DE_ACESSO },
    operacao: "criar_cliente",
    exemplo: { segmento: "industria", emails_de_acesso: ["quem-apresenta@exemplo.invalid"] },
    handler: async (ctx, args) => {
      const segmento = args.segmento as SegmentoDeDemonstracao;
      const s = sementeDoSegmento(segmento);
      const existente = await demonstracaoExistente(ctx, segmento);
      if (existente) {
        return {
          desfecho: "ja_estava",
          segmento,
          organization_id: existente.id,
          nome: existente.display_name,
          aplicada_em: aplicadaEm(existente),
          recado:
            `A "${s.nome}" já existe nesta instalação, e nada foi gravado. Para renovar as datas (agenda, vencimentos, ` +
            "follow-ups), chame plataforma_reaplicar_demonstracao com o mesmo segmento (operação implantar_configuracao).",
        };
      }
      const resumo = await gravarSemente(ctx, segmento, emailsDe(args));
      return {
        desfecho: "criou",
        segmento,
        organization_id: resumo.organizacaoId,
        nome: s.nome,
        o_que_mostra: s.oQueMostra,
        contagens: resumo.contagens,
        avisos: resumo.avisos,
        duracao_ms: resumo.duracao_ms,
        proximo_passo:
          "Entre pelo seletor de empresas com o login de quem tem acesso. Antes de cada apresentação, renove as datas com " +
          "plataforma_reaplicar_demonstracao.",
      };
    },
  },
  {
    name: "plataforma_reaplicar_demonstracao",
    description:
      "Reaplica a semente numa EMPRESA DE DEMONSTRAÇÃO que já existe: regrava os dados fictícios do segmento e RENOVA AS " +
      "DATAS, para a demonstração voltar ao estado que ela ilustra (o compromisso de amanhã volta a ser de amanhã, o " +
      "documento vencido volta a estar vencido há três dias, os follow-ups voltam a esperar a próxima mensagem). Use antes " +
      "de cada apresentação. Reexecução segura: cada linha tem id estável, então rodar de novo não duplica nada; o que alguém " +
      "acrescentou à mão na demonstração continua lá, e o que a semente gravou volta ao original. Quem criou o token e os " +
      "`emails_de_acesso` entram como admin. ATENÇÃO: só regrava empresa que é a demonstração do segmento e está marcada " +
      "como demonstração. O QUE NÃO FAZ: não cria a empresa (isso é plataforma_criar_demonstracao, operação criar_cliente), " +
      "não apaga o que foi criado à mão, não manda convite e não publica nada. " +
      AVISO_DE_TRAVA,
    inputSchema: { segmento: SEGMENTO, emails_de_acesso: EMAILS_DE_ACESSO },
    operacao: "implantar_configuracao",
    exemplo: { segmento: "academia" },
    handler: async (ctx, args) => {
      const segmento = args.segmento as SegmentoDeDemonstracao;
      const s = sementeDoSegmento(segmento);
      const existente = await demonstracaoExistente(ctx, segmento);
      if (!existente) {
        recusar(
          `A "${s.nome}" ainda não existe nesta instalação, e reaplicar não cria empresa. Nada foi gravado. Crie com ` +
            `plataforma_criar_demonstracao e o segmento "${segmento}" (o token precisa da operação criar_cliente).`,
        );
      }
      const antes = aplicadaEm(existente);
      const resumo = await gravarSemente(ctx, segmento, emailsDe(args));
      return {
        desfecho: "renovou",
        segmento,
        organization_id: resumo.organizacaoId,
        nome: s.nome,
        aplicada_antes_em: antes,
        contagens: resumo.contagens,
        avisos: resumo.avisos,
        duracao_ms: resumo.duracao_ms,
      };
    },
  },
];
