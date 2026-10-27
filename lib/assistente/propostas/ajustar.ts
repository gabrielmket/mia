/**
 * FORK MIA (.94) — AJUSTAR o cartão antes de aprovar (protótipo "ensina e
 * faz", tela 3: "Use Ajustar no cartão do follow-up antes de aprovar").
 *
 * "O que o cartão mostra é exatamente o que vai ser gravado." O ajuste não
 * escreve a peça: ele PREPARA de novo, com o que a pessoa trocou, pela mesma
 * preparação do assistente (com a sessão de quem ajusta), e regrava o pedido
 * e o cartão da proposta, que continua PENDENTE (o gatilho da 9100 só deixa a
 * peça mudar assim). Ajusta quem aprova, e quem pediu enquanto não mandou o
 * pedido.
 *
 * Os campos de cada peça são montados aqui (`camposDeAjuste`) e o cartão só os
 * desenha: a tela não decide nem valida nada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { partesNoFuso } from "@/lib/agenda/fuso";
import { audit } from "@/lib/audit";
import type { Role } from "@/lib/auth/types";
import { NOME_DO_TOM, PALETA_DE_ETIQUETAS } from "@/lib/tags/cor-da-etiqueta";

import type { PessoaDaEquipe } from "../leituras/comum";
import type { Preparacao } from "./preparar";
import {
  OPCOES_DE_ESPERA,
  prepararEtapaNova,
  prepararEtiqueta,
  prepararItemDeConhecimento,
  prepararMeta,
  prepararRascunhoDeFollowup,
  prepararRelatorio,
  prepararRenomearEtapa,
  prepararResposta,
  prepararTarefa,
  ROTULO_DO_AGRUPAMENTO,
  ROTULO_DO_PERIODO,
  type ContextoDaPreparacao,
} from "./preparar-do-dia-a-dia";
import { podeAprovar, regraDeAprovacao } from "./quem-aprova";
import {
  chaveNoBanco,
  COLUNAS_DA_PROPOSTA,
  TIPOS_DO_DIA_A_DIA,
  type CampoDeAjuste,
  type PedidoDaProposta,
  type PedidoDeEtapaNova,
  type PedidoDeEtiqueta,
  type PedidoDeItemDeConhecimento,
  type PedidoDeMeta,
  type PedidoDeRascunhoDeFollowup,
  type PedidoDeRelatorio,
  type PedidoDeRenomearEtapa,
  type PedidoDeResposta,
  type PedidoDeTarefa,
  type PropostaLida,
  type TipoDoDiaADia,
} from "./tipos";

const DOIS = (n: number) => String(n).padStart(2, "0");

/** O instante como hora de parede da empresa, no formato do `datetime-local`. */
export function paredeDoInstante(iso: string, fuso: string): string {
  const p = partesNoFuso(new Date(iso), fuso);
  return `${p.ano}-${DOIS(p.mes)}-${DOIS(p.dia)}T${DOIS(p.hora)}:${DOIS(p.minuto)}`;
}

const ehDoDiaADia = (tipo: string): tipo is TipoDoDiaADia => (TIPOS_DO_DIA_A_DIA as readonly string[]).includes(tipo);

/** Os campos do "Ajustar" de uma proposta pendente. As três da .91 não têm ajuste. */
export async function camposDeAjuste(
  proposta: Pick<PropostaLida, "tipo"> & { pedido: unknown },
  c: { db: SupabaseClient; organizationId: string; fuso: string; equipe: readonly PessoaDaEquipe[] },
): Promise<CampoDeAjuste[]> {
  if (!ehDoDiaADia(proposta.tipo)) return [];
  switch (proposta.tipo) {
    case "etapa_criar": {
      const p = proposta.pedido as PedidoDeEtapaNova;
      const { data } = await c.db
        .from("crm_stages")
        .select("name")
        .eq("organization_id", c.organizationId)
        .eq("pipeline_id", p.funil_id)
        .eq("is_archived", false)
        .order("position", { ascending: true });
      const etapas = ((data ?? []) as Array<{ name: string }>).map((e) => e.name);
      return [
        { campo: "nome", rotulo: "Nome da etapa", tipo: "texto", valor: p.nome },
        {
          campo: "antes_de",
          rotulo: "Fica antes de",
          tipo: "escolha",
          valor: p.antes_de_nome ?? "",
          opcoes: etapas.map((e) => ({ valor: e, rotulo: e })),
        },
      ];
    }
    case "etapa_renomear": {
      const p = proposta.pedido as PedidoDeRenomearEtapa;
      return [{ campo: "para", rotulo: "Novo nome", tipo: "texto", valor: p.para }];
    }
    case "resposta": {
      const p = proposta.pedido as PedidoDeResposta;
      return [
        { campo: "atalho", rotulo: "Atalho", tipo: "texto", valor: `/${p.atalho}` },
        { campo: "texto", rotulo: "Texto", tipo: "area", valor: p.texto },
      ];
    }
    case "etiqueta": {
      const p = proposta.pedido as PedidoDeEtiqueta;
      return [
        { campo: "nome", rotulo: "Nome", tipo: "texto", valor: p.nome },
        {
          campo: "cor",
          rotulo: "Cor",
          tipo: "escolha",
          valor: p.cor,
          opcoes: (PALETA_DE_ETIQUETAS as readonly string[]).map((cor) => ({ valor: cor, rotulo: NOME_DO_TOM[cor] ?? cor })),
        },
      ];
    }
    case "tarefa": {
      const p = proposta.pedido as PedidoDeTarefa;
      return [
        { campo: "titulo", rotulo: "Tarefa", tipo: "texto", valor: p.titulo },
        { campo: "quando", rotulo: "Quando", tipo: "data_hora", valor: paredeDoInstante(p.vence_em, c.fuso) },
        {
          campo: "para",
          rotulo: "Para quem",
          tipo: "escolha",
          valor: p.para_user_id,
          opcoes: c.equipe.filter((x) => x.papel !== "viewer").map((x) => ({ valor: x.user_id, rotulo: x.nome })),
        },
      ];
    }
    case "rascunho_de_followup": {
      const p = proposta.pedido as PedidoDeRascunhoDeFollowup;
      return [
        { campo: "m1", rotulo: "1ª mensagem", tipo: "area", valor: p.mensagens[0] },
        { campo: "m2", rotulo: "2ª mensagem", tipo: "area", valor: p.mensagens[1] },
        { campo: "m3", rotulo: "3ª mensagem", tipo: "area", valor: p.mensagens[2] },
        {
          campo: "esperas",
          rotulo: "Intervalo",
          tipo: "escolha",
          valor: p.esperas_dias.join(","),
          opcoes: OPCOES_DE_ESPERA.map(([a, b]) => ({ valor: `${a},${b}`, rotulo: `${a} ${a === 1 ? "dia" : "dias"} e depois ${b} dias` })),
        },
      ];
    }
    case "conhecimento": {
      const p = proposta.pedido as PedidoDeItemDeConhecimento;
      return [
        { campo: "pergunta", rotulo: "Pergunta", tipo: "texto", valor: p.pergunta },
        { campo: "resposta", rotulo: "Texto", tipo: "area", valor: p.resposta },
      ];
    }
    case "relatorio": {
      const p = proposta.pedido as PedidoDeRelatorio;
      return [
        {
          campo: "agrupar",
          rotulo: "Agrupar por",
          tipo: "escolha",
          valor: p.agrupar,
          opcoes: Object.entries(ROTULO_DO_AGRUPAMENTO).map(([valor, rotulo]) => ({ valor, rotulo })),
        },
        {
          campo: "periodo",
          rotulo: "Período",
          tipo: "escolha",
          valor: p.periodo,
          opcoes: Object.entries(ROTULO_DO_PERIODO).map(([valor, rotulo]) => ({ valor, rotulo })),
        },
        {
          campo: "para",
          rotulo: "Quem vê",
          tipo: "escolha",
          valor: p.para,
          opcoes: [
            { valor: "eu", rotulo: "só quem pediu" },
            { valor: "equipe", rotulo: "toda a equipe" },
          ],
        },
      ];
    }
    case "meta": {
      const p = proposta.pedido as PedidoDeMeta;
      return [{ campo: "valor", rotulo: "Valor", tipo: "numero", valor: String(p.valor_cents / 100) }];
    }
  }
}

/** O valor em reais digitado ("180000", "180.000,50") em centavos. */
export function centavosDoTexto(bruto: string): number | null {
  const limpo = bruto.trim().replace(/[^\d,.-]/g, "");
  if (!limpo) return null;
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normal);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** Prepara de novo, com o pedido de antes e o que mudou. */
async function prepararDeNovo(
  c: ContextoDaPreparacao,
  tipo: TipoDoDiaADia,
  pedido: unknown,
  campos: Readonly<Record<string, string>>,
): Promise<Preparacao> {
  const v = (k: string, antes: string) => (typeof campos[k] === "string" ? campos[k]! : antes);
  switch (tipo) {
    case "etapa_criar": {
      const p = pedido as PedidoDeEtapaNova;
      return prepararEtapaNova(c, { funil: p.funil_id, nome: v("nome", p.nome), antes_de: v("antes_de", p.antes_de_nome ?? "") || null });
    }
    case "etapa_renomear": {
      const p = pedido as PedidoDeRenomearEtapa;
      return prepararRenomearEtapa(c, { funil: p.funil_id, de: p.etapa_id, para: v("para", p.para) });
    }
    case "resposta": {
      const p = pedido as PedidoDeResposta;
      return prepararResposta(c, { atalho: v("atalho", p.atalho), texto: v("texto", p.texto), titulo: p.titulo, para: p.para });
    }
    case "etiqueta": {
      const p = pedido as PedidoDeEtiqueta;
      return prepararEtiqueta(c, { nome: v("nome", p.nome), cor: v("cor", p.cor) });
    }
    case "tarefa": {
      const p = pedido as PedidoDeTarefa;
      return prepararTarefa(c, {
        titulo: v("titulo", p.titulo),
        quando: v("quando", paredeDoInstante(p.vence_em, c.fuso)),
        para_user_id: v("para", p.para_user_id),
      });
    }
    case "rascunho_de_followup": {
      const p = pedido as PedidoDeRascunhoDeFollowup;
      const esperas = v("esperas", p.esperas_dias.join(","))
        .split(",")
        .map((x) => Number(x));
      return prepararRascunhoDeFollowup(c, {
        nome: p.nome,
        mensagens: [v("m1", p.mensagens[0]), v("m2", p.mensagens[1]), v("m3", p.mensagens[2])],
        esperas_dias: esperas,
      });
    }
    case "conhecimento": {
      const p = pedido as PedidoDeItemDeConhecimento;
      return prepararItemDeConhecimento(c, { titulo: p.titulo, pergunta: v("pergunta", p.pergunta), resposta: v("resposta", p.resposta) });
    }
    case "relatorio": {
      const p = pedido as PedidoDeRelatorio;
      const agrupar = v("agrupar", p.agrupar) as PedidoDeRelatorio["agrupar"];
      const periodo = v("periodo", p.periodo) as PedidoDeRelatorio["periodo"];
      const para = v("para", p.para) === "equipe" ? "equipe" : "eu";
      if (!(agrupar in ROTULO_DO_AGRUPAMENTO) || !(periodo in ROTULO_DO_PERIODO)) {
        return { ok: false, motivo: "invalido", mensagem: "Escolha o agrupamento e o período da lista." };
      }
      return prepararRelatorio(c, { nome: p.nome, agrupar, periodo, para });
    }
    case "meta": {
      const p = pedido as PedidoDeMeta;
      const valor = typeof campos.valor === "string" ? centavosDoTexto(campos.valor) : p.valor_cents;
      if (!valor) return { ok: false, motivo: "invalido", mensagem: "Escreva o valor da meta, maior que zero." };
      return prepararMeta(c, { valor_cents: valor, mes: p.mes });
    }
  }
}

export interface QuemAjusta {
  admin: SupabaseClient;
  /** A sessão de quem ajusta: a preparação lê com ela. */
  db: SupabaseClient;
  orgId: string;
  userId: string;
  papel: Role;
  equipe: readonly PessoaDaEquipe[];
  fuso: string;
  agora: Date;
  idioma: string;
  requestId: string;
}

export type DesfechoDoAjuste =
  | { ok: true; proposta: PropostaLida }
  | { ok: false; codigo: "nao_encontrada" | "ja_decidida" | "sem_ajuste" | "sem_permissao" | "invalido" | "igual_a_outra"; mensagem: string };

export async function ajustarProposta(q: QuemAjusta, propostaId: string, campos: Readonly<Record<string, string>>): Promise<DesfechoDoAjuste> {
  const { data } = await q.admin
    .from("mia_assistente_propostas")
    .select(`${COLUNAS_DA_PROPOSTA}, pedido`)
    .eq("organization_id", q.orgId)
    .eq("id", propostaId)
    .maybeSingle();
  const proposta = data as (PropostaLida & { pedido: unknown }) | null;
  if (!proposta) return { ok: false, codigo: "nao_encontrada", mensagem: "Proposta não encontrada nesta empresa." };
  if (proposta.situacao !== "pendente") return { ok: false, codigo: "ja_decidida", mensagem: "Só a proposta pendente é ajustada." };
  if (!ehDoDiaADia(proposta.tipo)) return { ok: false, codigo: "sem_ajuste", mensagem: "Esta peça vem pronta do modelo e não tem ajuste." };
  const regra = regraDeAprovacao({ tipo: proposta.tipo, pedido: proposta.pedido } as PedidoDaProposta, proposta.criada_por);
  const aprova = podeAprovar(regra, { userId: q.userId, papel: q.papel }, proposta.criada_por);
  const ehQuemPediu = proposta.criada_por === q.userId && !proposta.pedida_em;
  if (!aprova && !ehQuemPediu) return { ok: false, codigo: "sem_permissao", mensagem: "Ajusta quem aprova, ou quem pediu antes de mandar o pedido." };

  // A peça continua de quem pediu (a chave "só minha" e o "para mim" são dela).
  const criadaPor = proposta.criada_por ?? q.userId;
  const contexto: ContextoDaPreparacao = {
    db: q.db,
    organizationId: q.orgId,
    userId: criadaPor,
    papel: q.papel,
    equipe: q.equipe,
    fuso: q.fuso,
    agora: q.agora,
    idioma: q.idioma,
  };
  const r = await prepararDeNovo(contexto, proposta.tipo, proposta.pedido, campos);
  if (!r.ok) return { ok: false, codigo: "invalido", mensagem: r.mensagem };

  const { data: gravada, error } = await q.admin
    .from("mia_assistente_propostas")
    .update({
      pedido: r.proposta.pedido,
      titulo: r.proposta.titulo.slice(0, 200),
      mudancas: r.proposta.mudancas,
      chave: chaveNoBanco(proposta.tipo, proposta.criada_por, r.proposta.chave),
      ajustada_por: q.userId,
      ajustada_em: new Date().toISOString(),
    })
    .eq("organization_id", q.orgId)
    .eq("id", propostaId)
    .eq("situacao", "pendente")
    .select(COLUNAS_DA_PROPOSTA);
  if (error) {
    if (error.code === "23505") return { ok: false, codigo: "igual_a_outra", mensagem: "Já há outra proposta igual esperando decisão." };
    throw new Error(`não consegui ajustar a proposta: ${error.message}`);
  }
  const linha = (gravada ?? [])[0] as PropostaLida | undefined;
  if (!linha) return { ok: false, codigo: "ja_decidida", mensagem: "A proposta mudou enquanto você ajustava. Recarregue." };
  void audit({
    action: "assistente.proposta_ajustada",
    actorUserId: q.userId,
    organizationId: q.orgId,
    resourceType: "mia_assistente_propostas",
    resourceId: propostaId,
    requestId: q.requestId,
    metadata: { tipo: proposta.tipo, campos: Object.keys(campos), via_assistente: true },
  });
  return { ok: true, proposta: linha };
}
