/**
 * FORK MIA (item 9) — A LISTA POR TRÁS DO NÚMERO: as colunas de cada fonte.
 *
 * "Todo número abre" (protótipo, tela 4): barra, fatia, ponto, etapa ou célula
 * mostram a lista do que foi contado, com o mesmo filtro e o mesmo período. A
 * conta é do banco (`fn_mia_relatorio_lista`, 9041); aqui mora só o que cada
 * coluna mostra de cada linha, para a tela e para a planilha dizerem o mesmo.
 *
 * Telefone e produto do negócio saem só na planilha (a tela já é estreita); a
 * coluna de valor some para quem não vê valor (decisão "Valor em reais").
 *
 * ⚠️ Módulo PURO.
 */
import type { Dimensao, Fonte } from "@/lib/paineis/catalogo";

import { rotuloDaChave, dataCurta, tempoDeEspera, type Rotulo } from "./apresentar";

/** Uma linha da lista, como o banco devolve. */
export interface LinhaDaLista {
  registro: string;
  momento: string | null;
  dims: Record<string, unknown>;
  rotulos: Record<string, unknown>;
  valor_cents: number | null;
  moeda: string | null;
  sit: string | null;
  x1: number | null;
  x2: number | null;
  ok: boolean | null;
  detalhe: {
    titulo?: string | null;
    contato?: string | null;
    telefone?: string | null;
    etapa?: string | null;
    funil?: string | null;
    pessoa?: string | null;
    link?: string | null;
  };
}

export interface RespostaDaLista {
  fonte: Fonte;
  janela: { de: string | null; ate: string | null; fuso: string };
  moeda: string;
  valores: boolean;
  medidas: string[];
  n: number;
  total: { n: number; n_ok: number; valores: Record<string, number | null> };
  limite: number;
  deslocamento: number;
  linhas: LinhaDaLista[];
}

export interface ContextoDaLista {
  nomes: Readonly<Record<string, string>>;
  fuso: string;
  t: (s: string) => string;
}

/** O valor de uma célula: texto, número (a planilha põe vírgula) ou dinheiro em centavos. */
export type Celula =
  | { tipo: "texto"; texto: string }
  | { tipo: "numero"; valor: number | null; sufixo?: string }
  | { tipo: "dinheiro"; centavos: number | null; moeda: string };

export interface ColunaDaLista {
  titulo: string;
  /** Mostra na tela (as outras saem só na planilha). */
  tela: boolean;
  /** É dinheiro: some para quem não vê valor. */
  valor: boolean;
  celula: (l: LinhaDaLista, ctx: ContextoDaLista) => Celula;
}

const texto = (s: string | null | undefined): Celula => ({ tipo: "texto", texto: s ?? "" });

function rotulo(r: Rotulo, ctx: ContextoDaLista): string {
  return r.traduzir ? ctx.t(r.texto) : r.texto;
}

function chaveTexto(l: LinhaDaLista, dim: string): string | null {
  const v = l.dims[dim];
  return typeof v === "string" && v.trim() ? v : null;
}

function lista(l: LinhaDaLista, dim: string): string[] {
  const v = l.dims[dim];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}

/** O rótulo da chave de um agrupamento numa linha (com "Sem …" quando falta). */
function dimTexto(fonte: Fonte, dim: Dimensao, l: LinhaDaLista, ctx: ContextoDaLista): string {
  const chave = chaveTexto(l, dim) ?? "__sem";
  const doBanco = typeof l.rotulos[dim] === "string" ? (l.rotulos[dim] as string) : null;
  return rotulo(rotuloDaChave(fonte, dim, chave, doBanco, ctx.nomes), ctx);
}

const dataDoMomento = (l: LinhaDaLista, ctx: ContextoDaLista) => texto(dataCurta(l.momento, ctx.fuso));

const contato: ColunaDaLista = { titulo: "Contato", tela: true, valor: false, celula: (l) => texto(l.detalhe.contato) };
const telefone: ColunaDaLista = { titulo: "Telefone", tela: false, valor: false, celula: (l) => texto(l.detalhe.telefone) };

export const COLUNAS_DA_LISTA: Record<Fonte, ColunaDaLista[]> = {
  negocios: [
    { titulo: "Negócio", tela: true, valor: false, celula: (l) => texto(l.detalhe.titulo) },
    contato,
    telefone,
    { titulo: "Produto", tela: false, valor: false, celula: (l) => texto(lista(l, "produto").join(", ")) },
    { titulo: "Etapa", tela: true, valor: false, celula: (l) => texto(l.detalhe.etapa ?? (typeof l.rotulos.etapa === "string" ? l.rotulos.etapa : "")) },
    { titulo: "Situação", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("negocios", "situacao", l, ctx)) },
    { titulo: "Valor", tela: true, valor: true, celula: (l) => ({ tipo: "dinheiro", centavos: l.valor_cents, moeda: l.moeda ?? "BRL" }) },
    { titulo: "Responsável", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("negocios", "resp", l, ctx)) },
    { titulo: "Origem", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("negocios", "origem", l, ctx)) },
    {
      titulo: "Data",
      tela: true,
      valor: false,
      celula: (l, ctx) => {
        const quando = dataCurta(l.momento, ctx.fuso);
        const como = l.sit === "ganho" ? ctx.t("Ganhou em") : l.sit === "perdido" ? ctx.t("Perdeu em") : ctx.t("Entrou em");
        return texto(quando ? `${como} ${quando}` : "");
      },
    },
  ],
  conversas: [
    contato,
    telefone,
    { titulo: "Canal", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("conversas", "canal", l, ctx)) },
    { titulo: "Quem atendeu", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("conversas", "resp", l, ctx)) },
    { titulo: "Agente ou equipe", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("conversas", "quem", l, ctx)) },
    { titulo: "Assunto", tela: true, valor: false, celula: (l) => texto(lista(l, "etiqueta").join(", ")) },
    {
      titulo: "1ª resposta",
      tela: true,
      valor: false,
      celula: (l, ctx) => (l.x1 === null ? texto(ctx.t("sem resposta")) : texto(tempoDeEspera(l.x1, ctx.t))),
    },
    { titulo: "Data", tela: true, valor: false, celula: dataDoMomento },
  ],
  contatos: [
    contato,
    telefone,
    { titulo: "Origem", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("contatos", "origem", l, ctx)) },
    { titulo: "Canal", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("contatos", "canal", l, ctx)) },
    { titulo: "Etiquetas", tela: true, valor: false, celula: (l) => texto(lista(l, "etiqueta").join(", ")) },
    { titulo: "Dono do contato", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("contatos", "resp", l, ctx)) },
    { titulo: "Entrou em", tela: true, valor: false, celula: dataDoMomento },
  ],
  agenda: [
    { titulo: "Compromisso", tela: true, valor: false, celula: (l) => texto(l.detalhe.titulo) },
    contato,
    telefone,
    { titulo: "Tipo", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("agenda", "tipo", l, ctx)) },
    { titulo: "Situação", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("agenda", "situacao", l, ctx)) },
    { titulo: "Profissional", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("agenda", "prof", l, ctx)) },
    { titulo: "Quem marcou", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("agenda", "resp", l, ctx)) },
    { titulo: "Dia", tela: true, valor: false, celula: dataDoMomento },
  ],
  followup: [
    contato,
    telefone,
    { titulo: "Régua", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("followup", "fluxo", l, ctx)) },
    { titulo: "Resultado", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("followup", "resultado", l, ctx)) },
    { titulo: "Dono do contato", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("followup", "resp", l, ctx)) },
    { titulo: "Entrou na régua em", tela: true, valor: false, celula: dataDoMomento },
  ],
  obrigacoes: [
    { titulo: "Documento ou atividade", tela: true, valor: false, celula: (l) => texto(l.detalhe.titulo) },
    contato,
    { titulo: "Situação", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("obrigacoes", "situacao", l, ctx)) },
    { titulo: "Responsável", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("obrigacoes", "resp", l, ctx)) },
    { titulo: "Vence em", tela: true, valor: false, celula: dataDoMomento },
  ],
  anuncios: [
    { titulo: "Plataforma", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("anuncios", "plataforma", l, ctx)) },
    { titulo: "Evento", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("anuncios", "evento", l, ctx)) },
    { titulo: "Campanha", tela: true, valor: false, celula: (l, ctx) => texto(dimTexto("anuncios", "campanha", l, ctx)) },
    { titulo: "Aceito", tela: true, valor: false, celula: (l, ctx) => texto(l.ok ? ctx.t("Aceito") : ctx.t("Recusado")) },
    { titulo: "Dia", tela: true, valor: false, celula: dataDoMomento },
  ],
};

/** As colunas que valem para quem olha (sem a de valor, para quem não vê valor). */
export function colunasDaLista(fonte: Fonte, opcoes: { valores: boolean; tela: boolean }): ColunaDaLista[] {
  return COLUNAS_DA_LISTA[fonte].filter((c) => (opcoes.valores || !c.valor) && (!opcoes.tela || c.tela));
}
