/**
 * FORK MIA (.88) — AS FERRAMENTAS DO ASSISTENTE: só leitura, e com o cliente da
 * SESSÃO de quem perguntou.
 *
 * É o `CONFIG_TOOL_DEFS` da fase 1 da spec do upstream (#2860), sem as de
 * proposta (fase 2): ler a rotina, as prioridades, os leads, a performance, os
 * números da equipe, o porquê de a IA não ter respondido e a ajuda. As outras
 * quatro não leem nada do CRM: põem um botão na resposta ("Me leva lá", "Pedir
 * à pessoa", "Mandar ao suporte", o rascunho do chamado). NENHUMA escreve:
 * pedir, mandar e abrir chamado são cliques da pessoa, em rotas próprias.
 *
 * ── A regra inegociável ─────────────────────────────────────────────────────
 *
 * Toda leitura usa `ctx.db`, que é o cliente da sessão (o turno recusa outro,
 * `turno.ts`). Este arquivo NÃO importa o cliente de serviço nem o pool do
 * banco, e `tests/unit/assistente-turno-usa-a-sessao.test.ts` reprova quem
 * importar: com o cliente de serviço, o atendente veria os números da equipe
 * que a RLS esconde dele, e o assistente viraria o "modo administrador
 * escondido" que o protótipo promete que não existe.
 *
 * ── O que cada ferramenta devolve ao modelo ─────────────────────────────────
 *
 * Números e nomes, nunca texto de conversa, telefone, e-mail ou documento
 * (salvo `ver_contato` com o pedido explícito da pessoa). As fontes e os
 * contatos lidos são anotados no `coletor`, e a rota grava junto da resposta:
 * o "de onde veio" sai do que as ferramentas DE FATO leram, não do que o modelo
 * diz ter lido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { roleAtLeast, ROTULO_DO_PAPEL, type Role } from "@/lib/auth/types";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";

import { pareceValidacaoDeCampo } from "./chamado";
import { buscarAjuda, type ItemDaBaseDaEmpresa } from "./leituras/ajuda";
import { escopoDoPapel, type PessoaDaEquipe } from "./leituras/comum";
import { lerLeads } from "./leituras/leads";
import { lerPerformance, type PeriodoDaPerformance } from "./leituras/performance";
import { explicarSilencioDaIa } from "./leituras/por-que-a-ia-nao-respondeu";
import { lerRotinaDoDia } from "./leituras/rotina";
import { prioridadesDoDia } from "./prioridades";
import type { TelaConhecida } from "./telas";
import { hrefDoApp, type AcaoDoAssistente, type TelaDaPergunta, type TipoDeChamado } from "./tipos";

export interface ContextoDasFerramentas {
  /** O cliente da SESSÃO de quem perguntou. */
  db: SupabaseClient;
  organizationId: string;
  userId: string;
  papel: Role;
  idioma: string;
  fuso: string;
  agora: Date;
  telas: readonly TelaConhecida[];
  /** A tela em que a pessoa perguntou: a ajuda dela pesa mais no "como uso isso aqui". */
  tela?: TelaDaPergunta | null;
  /** Quem pergunta opera a plataforma (abre as telas do dono da instalação)? */
  daPlataforma?: boolean;
  equipe: readonly PessoaDaEquipe[];
  base: readonly ItemDaBaseDaEmpresa[];
  /** A última recusa do servidor que a tela viu (a "mensagem do sistema"). */
  ultimaRecusa: { mensagem: string | null; codigo: string | null; status: number | null } | null;
}

/** O que o turno junta enquanto as ferramentas rodam. */
export class ColetorDoTurno {
  readonly fontes = new Set<string>();
  readonly contatos = new Set<string>();
  readonly ferramentas: string[] = [];
  readonly acoes: AcaoDoAssistente[] = [];
  semResposta = false;
  foraDaPermissao = false;

  anotar(nome: string, fontes: readonly string[] = [], contatos: readonly string[] = []): void {
    this.ferramentas.push(nome);
    for (const f of fontes) this.fontes.add(f);
    for (const c of contatos) this.contatos.add(c);
  }

  acao(a: AcaoDoAssistente): void {
    if (this.acoes.length >= 6) return;
    const repetida = this.acoes.some(
      (x) =>
        x.tipo === a.tipo &&
        ((x.tipo === "ir" && a.tipo === "ir" && x.href === a.href) ||
          (x.tipo === "pedir" && a.tipo === "pedir" && x.para_user_id === a.para_user_id) ||
          x.tipo === "suporte" ||
          x.tipo === "chamado"),
    );
    if (!repetida) this.acoes.push(a);
  }
}

/** Quem tem o papel pedido, com o nome: a resposta do "quem pode". */
export function quemTemOPapel(equipe: readonly PessoaDaEquipe[], papelMinimo: Role): PessoaDaEquipe[] {
  return equipe
    .filter((p) => roleAtLeast(p.papel, papelMinimo))
    .sort((a, b) => (roleAtLeast(a.papel, "admin") === roleAtLeast(b.papel, "admin") ? 0 : roleAtLeast(a.papel, "admin") ? 1 : -1))
    .slice(0, 4);
}

function recusaDePermissao(ctx: ContextoDasFerramentas, coletor: ColetorDoTurno, papelMinimo: Role, oQue: string) {
  coletor.foraDaPermissao = true;
  const quem = quemTemOPapel(ctx.equipe, papelMinimo).map((p) => ({
    user_id: p.user_id,
    nome: p.nome,
    papel: ROTULO_DO_PAPEL[p.papel],
  }));
  return {
    fora_da_permissao: true,
    o_que: oQue,
    seu_papel: ROTULO_DO_PAPEL[ctx.papel],
    quem_pode: quem,
    orientacao:
      "Diga que a pessoa não tem acesso a isso, diga quem pode pelo nome e ofereça pedir a essa pessoa com oferecer_pedir_a_pessoa.",
  };
}

async function protegido<T>(fn: () => Promise<T>): Promise<T | { erro: string }> {
  try {
    return await fn();
  } catch (e) {
    const sem = e instanceof Error && e.message === "sem_permissao_no_motor";
    return { erro: sem ? "sem_permissao" : "Não consegui ler isso agora. Diga que não deu e sugira tentar de novo em instantes." };
  }
}

/** A tela do "Me leva lá" tem de ser uma porta conhecida que a pessoa abre. */
export function destinoPermitido(telas: readonly TelaConhecida[], href: string): TelaConhecida | null {
  const valido = hrefDoApp(href);
  if (!valido) return null;
  const caminho = valido.split("?")[0]!;
  let melhor: TelaConhecida | null = null;
  for (const t of telas) {
    if (!t.abre) continue;
    if (caminho === t.href || caminho.startsWith(`${t.href}/`)) {
      if (!melhor || t.href.length > melhor.href.length) melhor = t;
    }
  }
  return melhor;
}

const PERIODO = z
  .enum(["mes", "mesp", "7", "30"])
  .optional()
  .describe('"mes" (este mês, padrão), "mesp" (mês passado), "7" ou "30" (últimos dias).');

export function ferramentasDoAssistente(ctx: ContextoDasFerramentas, coletor: ColetorDoTurno): ToolSet {
  const escopo = escopoDoPapel(ctx.papel, ctx.userId);
  const veEquipe = escopo.tipo === "equipe";

  return {
    ver_minha_rotina: tool({
      description:
        "A rotina de HOJE de quem pergunta: compromissos da agenda, tarefas de hoje e atrasadas, conversas com a pessoa e esperando resposta. " +
        "Para gestor e administrador vem a equipe inteira (quem tem mais atrasadas, a Fila, conversas sem dono) e, para o administrador, os números desconectados.",
      inputSchema: z.object({}),
      execute: async () =>
        protegido(async () => {
          const rotina = await lerRotinaDoDia(ctx.db, {
            organizationId: ctx.organizationId,
            escopo,
            fuso: ctx.fuso,
            agora: ctx.agora,
            equipe: ctx.equipe,
            veNumeros: roleAtLeast(ctx.papel, "admin"),
          });
          coletor.anotar("ver_minha_rotina", rotina.fontes, rotina.contatos);
          return rotina;
        }),
    }),

    ver_prioridades: tool({
      description:
        "POR ONDE COMEÇAR hoje: a lista em ordem (algo parado na empresa, cliente esperando, compromisso do dia, atraso, negócios em risco e meta), " +
        "cada item com o caminho da tela (href) para o botão Me leva lá.",
      inputSchema: z.object({}),
      execute: async () =>
        protegido(async () => {
          const rotina = await lerRotinaDoDia(ctx.db, {
            organizationId: ctx.organizationId,
            escopo,
            fuso: ctx.fuso,
            agora: ctx.agora,
            equipe: ctx.equipe,
            veNumeros: roleAtLeast(ctx.papel, "admin"),
          });
          const [leads, performance] = await Promise.all([
            lerLeads(ctx.db, { organizationId: ctx.organizationId, escopo, papel: ctx.papel, agora: ctx.agora, equipe: ctx.equipe }).catch(() => null),
            lerPerformance(ctx.db, {
              organizationId: ctx.organizationId,
              escopo,
              periodo: "mes",
              agora: ctx.agora,
              fuso: ctx.fuso,
              equipe: ctx.equipe,
            }).catch(() => null),
          ]);
          const lista = prioridadesDoDia({ rotina, leads, performance, idioma: ctx.idioma });
          coletor.anotar(
            "ver_prioridades",
            [...rotina.fontes, ...(leads?.fontes ?? []), ...(performance?.fontes ?? [])],
            [...rotina.contatos, ...(leads?.contatos ?? [])],
          );
          return { prioridades: lista, regua: "algo parado na empresa, cliente esperando, compromisso do dia, atraso e meta" };
        }),
    }),

    ver_meus_leads: tool({
      description:
        "Os LEADS (negócios abertos) de quem pergunta: quantos ativos, novos na semana por origem, e os em risco pelo Radar. " +
        "Para gestor e administrador vem a divisão por dono e os sem dono.",
      inputSchema: z.object({}),
      execute: async () =>
        protegido(async () => {
          const leads = await lerLeads(ctx.db, {
            organizationId: ctx.organizationId,
            escopo,
            papel: ctx.papel,
            agora: ctx.agora,
            equipe: ctx.equipe,
          });
          coletor.anotar("ver_meus_leads", leads.fontes, leads.contatos);
          return leads;
        }),
    }),

    ver_minha_performance: tool({
      description:
        "A PERFORMANCE de quem pergunta no período: ganhos (quantidade e valor), perdidos, taxa de ganho e a meta do mês. " +
        "Para gestor e administrador é a da equipe, com cada pessoa. Valores em centavos da moeda informada.",
      inputSchema: z.object({ periodo: PERIODO }),
      execute: async ({ periodo }) =>
        protegido(async () => {
          const p = (periodo ?? "mes") as PeriodoDaPerformance;
          const perf = await lerPerformance(ctx.db, {
            organizationId: ctx.organizationId,
            escopo,
            periodo: p,
            agora: ctx.agora,
            fuso: ctx.fuso,
            equipe: ctx.equipe,
          });
          coletor.anotar("ver_minha_performance", perf.fontes);
          return perf;
        }),
    }),

    ver_numeros_da_equipe: tool({
      description:
        "Os números da EQUIPE (quanto a equipe vendeu, ganhos por pessoa, meta da empresa). Só gestor e administrador veem; " +
        "para os outros papéis volta quem pode ver, e você oferece pedir a essa pessoa.",
      inputSchema: z.object({ periodo: PERIODO }),
      execute: async ({ periodo }) => {
        if (!veEquipe) {
          coletor.anotar("ver_numeros_da_equipe");
          return recusaDePermissao(ctx, coletor, "manager", "os números da equipe");
        }
        return protegido(async () => {
          const perf = await lerPerformance(ctx.db, {
            organizationId: ctx.organizationId,
            escopo,
            periodo: (periodo ?? "mes") as PeriodoDaPerformance,
            agora: ctx.agora,
            fuso: ctx.fuso,
            equipe: ctx.equipe,
          });
          coletor.anotar("ver_numeros_da_equipe", perf.fontes);
          return perf;
        });
      },
    }),

    ver_por_que_a_ia_nao_respondeu: tool({
      description:
        "Por que a IA não respondeu um cliente: procura a conversa pelo NOME do contato entre as que a pessoa vê e lê o registro do que a IA fez " +
        "(conversa com alguém da equipe, número desconectado, agente pausado, fora do horário da IA, pedido para parar, turno que falhou). " +
        "Com mais de um contato com o nome, volta a lista para a pessoa escolher.",
      inputSchema: z.object({
        contato: z.string().trim().min(2).max(80).describe("O nome do contato, como a pessoa disse."),
      }),
      execute: async ({ contato }) =>
        protegido(async () => {
          const r = await explicarSilencioDaIa(ctx.db, {
            organizationId: ctx.organizationId,
            contato,
            fuso: ctx.fuso,
            equipe: ctx.equipe,
          });
          coletor.anotar("ver_por_que_a_ia_nao_respondeu", r.fontes, r.contatos);
          if (r.link_da_conversa) coletor.acao({ tipo: "ir", rotulo: "Abrir conversa", href: r.link_da_conversa });
          if (!r.encontrado && r.opcoes.length === 0) {
            return {
              ...r,
              orientacao:
                "Não encontrei esse contato entre as conversas que a pessoa vê. Diga isso; se a conversa for de outra pessoa da equipe, quem pode ver é a dona da conversa, o gestor ou o administrador.",
            };
          }
          return r;
        }),
    }),

    buscar_ajuda: tool({
      description:
        "Como fazer algo no sistema e onde fica: procura nos manuais do sistema (passo a passo das telas e roteiros que cruzam telas), " +
        "no guia de operação, no mapa das telas e na base da própria empresa (como trabalhamos aqui). Cobre todas as telas do sistema. " +
        "A tela em que a pessoa está pesa mais: \"como uso isso aqui\" traz a ajuda dela primeiro (desta_tela = true). " +
        "Cada achado diz se a pessoa abre a tela e quem pode. Use antes de explicar qualquer passo; nunca invente um caminho. " +
        "Responda pelo primeiro manual; se ele trouxer veja_tambem, cite a outra possibilidade em uma frase (MCP, por exemplo, é duas coisas). " +
        "Só diga que não sabe se nada voltar.",
      inputSchema: z.object({
        pergunta: z.string().trim().min(2).max(300).describe("A dúvida, nas palavras da pessoa."),
      }),
      execute: async ({ pergunta }) => {
        const achados = buscarAjuda({
          pergunta,
          papel: ctx.papel,
          telas: ctx.telas,
          base: ctx.base,
          caminho: ctx.tela?.caminho ?? null,
          daPlataforma: ctx.daPlataforma ?? false,
        });
        coletor.anotar("buscar_ajuda", achados.fontes);
        return achados;
      },
    }),

    ver_contato: tool({
      description:
        "Os dados de UM contato pelo nome, entre os que a pessoa vê. Por padrão só o nome e se ele pediu para parar. " +
        "Telefone e e-mail SÓ com incluir_telefone_e_email = true, e só quando a pessoa pediu esse dado explicitamente nesta pergunta. Documento nunca.",
      inputSchema: z.object({
        nome: z.string().trim().min(2).max(80).describe("O nome do contato."),
        incluir_telefone_e_email: z
          .boolean()
          .describe("true só se a pessoa pediu o telefone ou o e-mail nesta pergunta."),
      }),
      execute: async ({ nome, incluir_telefone_e_email }) =>
        protegido(async () => {
          const termo = nome.replace(/[%_\\(),]/g, " ").trim();
          const { data } = await ctx.db
            .from("contacts")
            .select(incluir_telefone_e_email ? "id, name, display_name, is_blocked, phone_number, email" : "id, name, display_name, is_blocked")
            .eq("organization_id", ctx.organizationId)
            .eq("is_anonymized", false)
            .or(`name.ilike.%${termo}%,display_name.ilike.%${termo}%`)
            .limit(5);
          const linhas = (data ?? []) as unknown as Array<{
            id: string;
            name: string | null;
            display_name: string | null;
            is_blocked: boolean;
            phone_number?: string | null;
            email?: string | null;
          }>;
          coletor.anotar("ver_contato", ["Contatos"], linhas.map((l) => l.id));
          return {
            contatos: linhas.map((l) => ({
              nome: nomeDoContato(l) ?? "Contato sem nome",
              pediu_para_parar: l.is_blocked,
              ...(incluir_telefone_e_email ? { telefone: l.phone_number ?? null, email: l.email ?? null } : {}),
            })),
          };
        }),
    }),

    mostrar_me_leva_la: tool({
      description:
        'Põe o botão "Me leva lá" na resposta, para uma tela que a pessoa abre. Use o href que veio de buscar_ajuda, ver_prioridades ou das outras ferramentas.',
      inputSchema: z.object({
        href: z.string().max(300).describe('O caminho da tela, começando com "/app".'),
        rotulo: z.string().trim().min(2).max(40).optional().describe('O texto do botão (padrão "Me leva lá").'),
      }),
      execute: async ({ href, rotulo }) => {
        const tela = destinoPermitido(ctx.telas, href);
        if (!tela) {
          return { ok: false, motivo: "Essa tela não existe ou a pessoa não a abre. Não ponha o botão; diga quem pode." };
        }
        coletor.acao({ tipo: "ir", rotulo: rotulo ?? "Me leva lá", href: hrefDoApp(href)! });
        return { ok: true, tela: tela.rotulo };
      },
    }),

    oferecer_pedir_a_pessoa: tool({
      description:
        'Põe o botão "Pedir a <nome>" na resposta, quando a pessoa não tem permissão para algo. O clique manda um aviso na Central para quem pode, com o pedido. ' +
        "Use o user_id que veio em quem_pode.",
      inputSchema: z.object({
        para_user_id: z.string().uuid().describe("O user_id de quem pode, como veio em quem_pode."),
        pedido: z.string().trim().min(3).max(300).describe("O que a pessoa quer pedir, em uma frase."),
      }),
      execute: async ({ para_user_id, pedido }) => {
        const pessoa = ctx.equipe.find((p) => p.user_id === para_user_id && p.user_id !== ctx.userId);
        if (!pessoa) return { ok: false, motivo: "Essa pessoa não está na equipe." };
        coletor.acao({ tipo: "pedir", rotulo: `Pedir a ${pessoa.nome.split(/\s+/)[0]}`, para_user_id, para_nome: pessoa.nome, pedido });
        return { ok: true, para: pessoa.nome };
      },
    }),

    registrar_que_nao_sei: tool({
      description:
        "Use quando você NÃO sabe responder (nenhuma ferramenta trouxe a resposta). Marca a pergunta para o administrador melhorar a ajuda e põe o botão " +
        '"Mandar ao suporte", que vira um chamado do tipo Dúvida para a Time Company. Depois diga que não sabe, sem inventar.',
      inputSchema: z.object({
        pergunta: z.string().trim().min(2).max(500).describe("A pergunta que ficou sem resposta."),
      }),
      execute: async ({ pergunta }) => {
        coletor.semResposta = true;
        coletor.anotar("registrar_que_nao_sei");
        coletor.acao({ tipo: "suporte", rotulo: "Mandar ao suporte", pergunta });
        return { ok: true };
      },
    }),

    preparar_chamado: tool({
      description:
        "Prepara o chamado para a Time Company (Erro: algo que deveria funcionar e não funciona; Dúvida: o que você não soube responder; Pedido: função nova ou mudança). " +
        "Antes de um Erro, pergunte o que apareceu na tela se não souber. Volta parece_validacao = true quando a mensagem é só um campo faltando: " +
        "aí explique o campo e ofereça abrir mesmo assim. A pessoa confere e clica para abrir; você não abre sozinho.",
      inputSchema: z.object({
        tipo: z.enum(["erro", "duvida", "pedido"]).describe("erro, duvida ou pedido."),
        resumo: z.string().trim().min(3).max(1000).describe("O que a pessoa disse e o que esperava, em uma ou duas frases."),
        mensagem_do_sistema: z
          .string()
          .trim()
          .max(300)
          .optional()
          .describe("A mensagem que apareceu na tela, se a pessoa disse ou se veio no contexto."),
      }),
      execute: async ({ tipo, resumo, mensagem_do_sistema }) => {
        const mensagem = mensagem_do_sistema ?? ctx.ultimaRecusa?.mensagem ?? null;
        const validacao =
          tipo === "erro" &&
          pareceValidacaoDeCampo({
            mensagem,
            codigo: mensagem_do_sistema ? null : (ctx.ultimaRecusa?.codigo ?? null),
            status: mensagem_do_sistema ? null : (ctx.ultimaRecusa?.status ?? null),
          });
        coletor.anotar("preparar_chamado");
        coletor.acao({
          tipo: "chamado",
          rotulo: "Abrir o chamado",
          rascunho: { tipo: tipo as TipoDeChamado, texto: resumo, mensagem_do_sistema: mensagem, parece_validacao: validacao },
        });
        return {
          ok: true,
          parece_validacao: validacao,
          mensagem_do_sistema: mensagem,
          orientacao: validacao
            ? "Parece só validação de campo. Explique o que faltou preencher e diga que, se quiser, o chamado pode ser aberto mesmo assim pelo botão."
            : "Mostre o que vai no chamado (a tela, a hora, a versão e o navegador entram sozinhos) e diga que a pessoa confere e clica em Abrir o chamado.",
        };
      },
    }),
  };
}
