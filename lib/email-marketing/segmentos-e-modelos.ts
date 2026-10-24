/**
 * FORK MIA (.89) — OS SEGMENTOS SALVOS e os MODELOS DE CAMPANHA.
 *
 * Segmento guarda o FILTRO e a base legal, nunca a lista: a conta refaz na hora
 * de usar. Serve ao e-mail e ao WhatsApp.
 *
 * Modelo é o ponto de partida de uma campanha em blocos, por segmento de
 * negócio, como os modelos de follow-up (`docs/fork/...followup`): "Geral" serve
 * a qualquer empresa e os outros só trocam o exemplo. Nenhum fala jargão de um
 * nicho só. A campanha COPIA o modelo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { blocosSchema, type BlocoDoEmail } from "./blocos";
import { recorteSchema, temCriterio, type RecorteDoEmail } from "./recorte";
import { RecusaDaCampanha } from "./recusa";
import type { BaseLegal } from "./regras";

export const segmentoSchema = z
  .object({
    nome: z.string().trim().min(1).max(120),
    recorte: recorteSchema,
    base_legal: z.enum(["consent", "legitimate_interest"]).default("consent"),
    lia_ref: z.string().trim().max(120).nullable().optional(),
  })
  .strict();

export interface Segmento {
  id: string;
  nome: string;
  recorte: RecorteDoEmail;
  base_legal: BaseLegal;
  lia_ref: string | null;
  criado_por: string | null;
  created_at: string;
}

export async function listarSegmentos(db: SupabaseClient, orgId: string): Promise<Segmento[]> {
  const { data, error } = await db
    .from("mia_segmentos")
    .select("id, nome, recorte, base_legal, lia_ref, criado_por, created_at")
    .eq("organization_id", orgId)
    .is("arquivado_em", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`segmentos: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((s) => ({
    ...(s as unknown as Segmento),
    recorte: recorteSchema.safeParse(s.recorte).success
      ? recorteSchema.parse(s.recorte)
      : recorteSchema.parse({}),
  }));
}

/** Garante o segmento pelo NOME: cria, atualiza ou diz que já estava. */
export async function garantirSegmento(
  db: SupabaseClient,
  orgId: string,
  dados: z.infer<typeof segmentoSchema>,
  autorId: string | null,
): Promise<{ id: string; desfecho: "criou" | "atualizou" | "ja_estava" }> {
  if (!temCriterio(dados.recorte)) {
    throw new RecusaDaCampanha(
      "sem_criterio",
      'Escolha pelo menos um critério: não existe "todos os contatos".',
    );
  }
  if (dados.base_legal === "legitimate_interest" && !(dados.lia_ref ?? "").trim()) {
    throw new RecusaDaCampanha("lia", "Interesse legítimo pede a referência da avaliação (LIA).");
  }
  const existentes = await listarSegmentos(db, orgId);
  const atual = existentes.find((s) => s.nome.toLowerCase() === dados.nome.toLowerCase());
  const linha = {
    nome: dados.nome,
    recorte: dados.recorte,
    base_legal: dados.base_legal,
    lia_ref: dados.lia_ref ?? null,
  };
  if (atual) {
    const igual =
      JSON.stringify(atual.recorte) === JSON.stringify(dados.recorte) &&
      atual.base_legal === dados.base_legal &&
      (atual.lia_ref ?? null) === (dados.lia_ref ?? null);
    if (igual) return { id: atual.id, desfecho: "ja_estava" };
    const { error } = await db
      .from("mia_segmentos")
      .update(linha)
      .eq("organization_id", orgId)
      .eq("id", atual.id);
    if (error) throw new Error(`não consegui atualizar o segmento: ${error.message}`);
    return { id: atual.id, desfecho: "atualizou" };
  }
  const { data, error } = await db
    .from("mia_segmentos")
    .insert({ organization_id: orgId, ...linha, criado_por: autorId })
    .select("id")
    .single();
  if (error || !data)
    throw new Error(`não consegui salvar o segmento: ${error?.message ?? "sem linha"}`);
  return { id: (data as { id: string }).id, desfecho: "criou" };
}

export async function arquivarSegmento(
  db: SupabaseClient,
  orgId: string,
  id: string,
): Promise<void> {
  const { error } = await db
    .from("mia_segmentos")
    .update({ arquivado_em: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`não consegui arquivar o segmento: ${error.message}`);
}

// ─── os modelos ─────────────────────────────────────────────────────────────

export const SEGMENTOS_DE_NEGOCIO = [
  "geral",
  "saude",
  "varejo",
  "servicos",
  "imoveis",
  "educacao",
] as const;
export type SegmentoDeNegocio = (typeof SEGMENTOS_DE_NEGOCIO)[number];

export interface ModeloDoCatalogo {
  chave: string;
  nome: string;
  segmento: SegmentoDeNegocio;
  assunto: string;
  pre_cabecalho: string;
  blocos: BlocoDoEmail[];
}

type SemId<T> = T extends unknown ? Omit<T, "id"> : never;
const b = (id: string, resto: SemId<BlocoDoEmail>): BlocoDoEmail =>
  ({ id, ...resto }) as BlocoDoEmail;

/** O catálogo de modelos, no código: muda junto com os blocos que ele usa. */
export const CATALOGO_DE_MODELOS: readonly ModeloDoCatalogo[] = [
  {
    chave: "novidades-do-mes",
    nome: "Novidades do mês",
    segmento: "geral",
    assunto: "{{saudacao}}, {{primeiro_nome}}: as novidades do mês",
    pre_cabecalho: "O que mudou por aqui, em dois minutos de leitura",
    blocos: [
      b("t1", { tipo: "titulo", texto: "As novidades do mês" }),
      b("x1", {
        tipo: "texto",
        texto:
          "Oi, {{primeiro_nome}}! Separamos o que mudou por aqui neste mês e pode interessar a você.",
      }),
      b("x2", {
        tipo: "texto",
        texto: "Escreva aqui a primeira novidade, em duas ou três frases.",
      }),
      b("k1", {
        tipo: "botao",
        texto: "Ver as novidades",
        url: "https://exemplo.com.br/novidades",
      }),
      b("d1", { tipo: "divisor" }),
      b("x3", { tipo: "texto", texto: "Ficou alguma dúvida? É só responder este e-mail." }),
    ],
  },
  {
    chave: "oferta-para-clientes",
    nome: "Oferta para quem já é cliente",
    segmento: "geral",
    assunto: "{{primeiro_nome}}, uma condição para quem já é cliente",
    pre_cabecalho: "Válida por tempo limitado",
    blocos: [
      b("t1", { tipo: "titulo", texto: "Uma condição para quem já é cliente" }),
      b("x1", {
        tipo: "texto",
        texto:
          "Oi, {{primeiro_nome}}! Como você já é cliente, preparamos uma condição especial. Descreva aqui a oferta e até quando vale.",
      }),
      b("k1", { tipo: "botao", texto: "Quero aproveitar", url: "https://exemplo.com.br/oferta" }),
    ],
  },
  {
    chave: "convite-para-evento",
    nome: "Convite para evento",
    segmento: "geral",
    assunto: "Você está convidado, {{primeiro_nome}}",
    pre_cabecalho: "Data, horário e como confirmar",
    blocos: [
      b("t1", { tipo: "titulo", texto: "Você está convidado" }),
      b("x1", {
        tipo: "texto",
        texto:
          "Oi, {{primeiro_nome}}! Vamos fazer um encontro e gostaríamos da sua presença. Escreva aqui o dia, o horário e o endereço.",
      }),
      b("k1", { tipo: "botao", texto: "Confirmar presença", url: "https://exemplo.com.br/evento" }),
    ],
  },
  {
    chave: "retorno-de-cuidado",
    nome: "Lembrete de retorno",
    segmento: "saude",
    assunto: "{{primeiro_nome}}, está na hora do seu retorno",
    pre_cabecalho: "Agende pelo link, no horário que for melhor para você",
    blocos: [
      b("t1", { tipo: "titulo", texto: "Está na hora do seu retorno" }),
      b("x1", {
        tipo: "texto",
        texto:
          "Oi, {{primeiro_nome}}! Faz um tempo desde o seu último atendimento. Que tal agendar o retorno?",
      }),
      b("k1", { tipo: "botao", texto: "Agendar retorno", url: "https://exemplo.com.br/agendar" }),
    ],
  },
  {
    chave: "colecao-nova",
    nome: "Chegou coleção nova",
    segmento: "varejo",
    assunto: "Chegou coleção nova, {{primeiro_nome}}",
    pre_cabecalho: "Veja antes de todo mundo",
    blocos: [
      b("i1", { tipo: "imagem", url: "", alt: "Foto da coleção nova" }),
      b("t1", { tipo: "titulo", texto: "Chegou coleção nova" }),
      b("x1", {
        tipo: "texto",
        texto:
          "Oi, {{primeiro_nome}}! As peças novas acabaram de chegar. Veja antes de todo mundo.",
      }),
      b("k1", { tipo: "botao", texto: "Ver a coleção", url: "https://exemplo.com.br/colecao" }),
    ],
  },
  {
    chave: "revisao-do-servico",
    nome: "Hora da revisão",
    segmento: "servicos",
    assunto: "{{primeiro_nome}}, vamos revisar o seu serviço?",
    pre_cabecalho: "Uma conversa rápida para ver se está tudo certo",
    blocos: [
      b("t1", { tipo: "titulo", texto: "Vamos revisar o seu serviço?" }),
      b("x1", {
        tipo: "texto",
        texto:
          "Oi, {{primeiro_nome}}! Passou um tempo desde que começamos. Uma conversa rápida ajuda a ver se está tudo como você precisa.",
      }),
      b("k1", {
        tipo: "botao",
        texto: "Marcar a conversa",
        url: "https://exemplo.com.br/conversa",
      }),
    ],
  },
  {
    chave: "lancamento-de-imovel",
    nome: "Lançamento",
    segmento: "imoveis",
    assunto: "{{primeiro_nome}}, um lançamento que combina com o que você procura",
    pre_cabecalho: "Plantas, valores e como visitar",
    blocos: [
      b("i1", { tipo: "imagem", url: "", alt: "Fachada do empreendimento" }),
      b("t1", { tipo: "titulo", texto: "Um lançamento que combina com você" }),
      b("x1", {
        tipo: "texto",
        texto:
          "Oi, {{primeiro_nome}}! Escreva aqui o bairro, as plantas e as condições do lançamento.",
      }),
      b("k1", { tipo: "botao", texto: "Agendar uma visita", url: "https://exemplo.com.br/visita" }),
    ],
  },
  {
    chave: "matriculas-abertas",
    nome: "Matrículas abertas",
    segmento: "educacao",
    assunto: "As matrículas abriram, {{primeiro_nome}}",
    pre_cabecalho: "Turmas, horários e como garantir a vaga",
    blocos: [
      b("t1", { tipo: "titulo", texto: "As matrículas abriram" }),
      b("x1", {
        tipo: "texto",
        texto:
          "Oi, {{primeiro_nome}}! As vagas para a próxima turma estão abertas. Escreva aqui as turmas e os horários.",
      }),
      b("k1", { tipo: "botao", texto: "Garantir a vaga", url: "https://exemplo.com.br/matricula" }),
    ],
  },
];

export const modeloSchema = z
  .object({
    chave: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    nome: z.string().trim().min(1).max(120),
    segmento_de_negocio: z.string().trim().max(40).nullable().optional(),
    assunto: z.string().max(200).default(""),
    pre_cabecalho: z.string().max(200).default(""),
    blocos: blocosSchema,
  })
  .strict();

/** Garante modelos na empresa: os do catálogo (por segmento) e os escritos à parte. */
export async function garantirModelos(
  db: SupabaseClient,
  orgId: string,
  entrada: {
    segmentos?: readonly SegmentoDeNegocio[];
    modelos?: ReadonlyArray<z.infer<typeof modeloSchema>>;
  },
  autorId: string | null,
): Promise<Array<{ chave: string; desfecho: "criou" | "atualizou" | "ja_estava" }>> {
  const doCatalogo = CATALOGO_DE_MODELOS.filter((m) =>
    (entrada.segmentos ?? []).includes(m.segmento),
  ).map((m) => ({
    chave: m.chave,
    nome: m.nome,
    segmento_de_negocio: m.segmento,
    assunto: m.assunto,
    pre_cabecalho: m.pre_cabecalho,
    blocos: m.blocos,
  }));
  const todos = [...doCatalogo, ...(entrada.modelos ?? [])];
  const { data: existentes } = await db
    .from("mia_email_modelos")
    .select("id, chave, nome, assunto, pre_cabecalho, blocos")
    .eq("organization_id", orgId);
  const porChave = new Map(
    ((existentes ?? []) as Array<Record<string, unknown>>).map((m) => [String(m.chave), m]),
  );
  const saida: Array<{ chave: string; desfecho: "criou" | "atualizou" | "ja_estava" }> = [];
  for (const m of todos) {
    const atual = porChave.get(m.chave);
    const linha = {
      nome: m.nome,
      segmento_de_negocio: m.segmento_de_negocio ?? null,
      assunto: m.assunto,
      pre_cabecalho: m.pre_cabecalho,
      blocos: m.blocos,
    };
    if (atual) {
      const igual =
        atual.nome === m.nome &&
        atual.assunto === m.assunto &&
        atual.pre_cabecalho === m.pre_cabecalho &&
        JSON.stringify(atual.blocos) === JSON.stringify(m.blocos);
      if (igual) {
        saida.push({ chave: m.chave, desfecho: "ja_estava" });
        continue;
      }
      const { error } = await db
        .from("mia_email_modelos")
        .update(linha)
        .eq("organization_id", orgId)
        .eq("id", String(atual.id));
      if (error) throw new Error(`modelo ${m.chave}: ${error.message}`);
      saida.push({ chave: m.chave, desfecho: "atualizou" });
      continue;
    }
    const { error } = await db
      .from("mia_email_modelos")
      .insert({ organization_id: orgId, chave: m.chave, ...linha, created_by: autorId });
    if (error) throw new Error(`modelo ${m.chave}: ${error.message}`);
    saida.push({ chave: m.chave, desfecho: "criou" });
  }
  return saida;
}

export async function listarModelos(
  db: SupabaseClient,
  orgId: string,
): Promise<Array<{ chave: string; nome: string; segmento_de_negocio: string | null }>> {
  const { data, error } = await db
    .from("mia_email_modelos")
    .select("chave, nome, segmento_de_negocio")
    .eq("organization_id", orgId)
    .order("nome");
  if (error) throw new Error(`modelos: ${error.message}`);
  return (data ?? []) as Array<{ chave: string; nome: string; segmento_de_negocio: string | null }>;
}
