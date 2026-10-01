/**
 * FORK MIA — OBRIGAÇÕES · as OPERAÇÕES.
 *
 * O que a tela, o MCP de plataforma e a ferramenta do agente fazem com um item:
 * adicionar, editar, marcar pedido (e pedir de novo), receber (com arquivo),
 * marcar feita, arquivar, e confirmar ou recusar a proposta do agente. Um
 * caminho só para os três: um segundo jeito de receber um documento divergiria
 * deste no primeiro conserto.
 *
 * ── Quem decide as datas ──────────────────────────────────────────────────
 *
 * As contas são de `ciclo.ts` (puro, o mesmo que a tela usa para a prévia).
 * Fechar um ciclo é uma transação no banco (`fn_mia_obrigacao_fechar_ciclo`,
 * migration 9018): o ciclo que termina vai para o histórico e o item segue com
 * as datas novas, ou nada muda.
 *
 * ── O cliente do banco ────────────────────────────────────────────────────
 *
 * As rotas passam o cliente da SESSÃO (a RLS decide: `agent` em diante, e só o
 * que a pessoa enxerga). O MCP passa o de serviço. Nos dois casos toda consulta
 * carrega o filtro de organização na mão.
 *
 * Este módulo NÃO audita nem emite aviso: quem chama é quem sabe quem é o ator
 * (a rota audita; o MCP tem a trilha dele) e se o ato deve ou não acordar uma
 * automação (a importação não acorda).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ArquivoGuardado } from "./arquivo";
import { aoPedir, datasAoAdicionar, proximaDataDaAtividade, receberRenova } from "./ciclo";
import { comoDia, type Dia } from "./datas";
import { lerObrigacao } from "./leitura";
import {
  AVISOS_PADRAO,
  CATEGORIAS,
  COLUNAS_DA_OBRIGACAO,
  DIAS_SEM_RESPOSTA_PADRAO,
  QUEM_ENTREGA,
  RECORRENCIAS,
  normalizarAvisos,
  type Categoria,
  type Obrigacao,
  type QuemEntrega,
  type Recorrencia,
} from "./tipos";

type Db = SupabaseClient;

export type CodigoDoErro = "validacao" | "nao_encontrado" | "conflito" | "interno";

/** Uma recusa com a frase que a pessoa (ou o agente implantador) lê. */
export class ErroDeObrigacao extends Error {
  constructor(
    readonly codigo: CodigoDoErro,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDeObrigacao";
  }
}

export interface ContextoDaOperacao {
  db: Db;
  org: string;
  /** Quem faz: o usuário da sessão, ou quem criou o token do MCP. */
  ator: string | null;
  /** O "hoje" do fuso da empresa. */
  hoje: Dia;
}

/** O que o formulário de adicionar (e o MCP) entrega. */
export interface EntradaDeObrigacao {
  nome: string;
  nome_curto?: string | null;
  tipo_id?: string | null;
  categoria: Categoria;
  lead_id?: string | null;
  empresa_id?: string | null;
  contact_id?: string | null;
  quem_entrega?: QuemEntrega;
  recorrencia?: Recorrencia;
  recorrencia_meses?: number | null;
  validade_meses?: number;
  avisos_dias?: readonly number[];
  dias_sem_resposta?: number;
  pedido_em?: Dia | null;
  prazo_em?: Dia | null;
  recebido_em?: Dia | null;
  valido_ate?: Dia | null;
  proxima_em?: Dia | null;
  feita_em?: Dia | null;
  responsavel_user_id?: string | null;
  observacao?: string | null;
  origem?: string;
  chave_natural?: string | null;
}

function inteiroEntre(valor: unknown, minimo: number, maximo: number, padrao: number): number {
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isInteger(n)) return padrao;
  return Math.min(maximo, Math.max(minimo, n));
}

function textoOuNulo(valor: unknown, teto: number): string | null {
  if (typeof valor !== "string") return null;
  const aparado = valor.trim();
  return aparado ? aparado.slice(0, teto) : null;
}

/** A recorrência como o banco a aceita: `n_meses` com o N, as outras sem. */
function recorrenciaValida(recorrencia: unknown, meses: unknown): { recorrencia: Recorrencia; recorrencia_meses: number | null } {
  const r = (RECORRENCIAS as readonly string[]).includes(String(recorrencia)) ? (recorrencia as Recorrencia) : "unica";
  if (r !== "n_meses") return { recorrencia: r, recorrencia_meses: null };
  const n = typeof meses === "number" ? meses : Number(meses);
  if (!Number.isInteger(n) || n < 1 || n > 240) {
    throw new ErroDeObrigacao("validacao", "Na recorrência \"a cada N meses\", informe N de 1 a 240.");
  }
  return { recorrencia: r, recorrencia_meses: n };
}

async function conferirVinculos(
  ctx: ContextoDaOperacao,
  vinculos: { lead_id: string | null; empresa_id: string | null; contact_id: string | null },
): Promise<void> {
  if (!vinculos.lead_id && !vinculos.empresa_id && !vinculos.contact_id) {
    throw new ErroDeObrigacao(
      "validacao",
      "Ligue o item a um negócio, a uma empresa ou a um contato (pelo menos um).",
    );
  }
  const conferir = async (tabela: string, id: string | null, oQue: string) => {
    if (!id) return;
    const { data, error } = await ctx.db.from(tabela).select("id").eq("organization_id", ctx.org).eq("id", id).maybeSingle();
    if (error) throw new ErroDeObrigacao("interno", `Não consegui conferir ${oQue}: ${error.message}`);
    if (!data) throw new ErroDeObrigacao("nao_encontrado", `Não encontrei ${oQue} nesta empresa.`);
  };
  await Promise.all([
    conferir("crm_leads", vinculos.lead_id, "o negócio"),
    conferir("crm_empresas", vinculos.empresa_id, "a empresa"),
    conferir("contacts", vinculos.contact_id, "o contato"),
  ]);
}

/** A linha pronta para o banco, a partir do que o formulário entregou. */
export function montarLinha(entrada: EntradaDeObrigacao, hoje: Dia): Record<string, unknown> {
  const nome = textoOuNulo(entrada.nome, 120);
  if (!nome) throw new ErroDeObrigacao("validacao", "Dê um nome ao item.");
  if (!(CATEGORIAS as readonly string[]).includes(entrada.categoria)) {
    throw new ErroDeObrigacao("validacao", "O item é um documento ou uma atividade recorrente.");
  }
  const quem = (QUEM_ENTREGA as readonly string[]).includes(String(entrada.quem_entrega))
    ? (entrada.quem_entrega as QuemEntrega)
    : entrada.categoria === "atividade"
      ? "nos"
      : "cliente";
  const rec = recorrenciaValida(entrada.recorrencia, entrada.recorrencia_meses);
  const validade = inteiroEntre(entrada.validade_meses, 0, 600, 0);

  for (const [campo, valor] of Object.entries({
    pedido_em: entrada.pedido_em,
    prazo_em: entrada.prazo_em,
    recebido_em: entrada.recebido_em,
    valido_ate: entrada.valido_ate,
    proxima_em: entrada.proxima_em,
    feita_em: entrada.feita_em,
  })) {
    if (valor !== undefined && valor !== null && valor !== "" && !comoDia(valor)) {
      throw new ErroDeObrigacao("validacao", `A data de "${campo}" não existe no calendário. Use AAAA-MM-DD.`);
    }
  }
  const datas = datasAoAdicionar(
    {
      categoria: entrada.categoria,
      recorrencia: rec.recorrencia,
      recorrencia_meses: rec.recorrencia_meses,
      validade_meses: validade,
      pedido_em: comoDia(entrada.pedido_em),
      prazo_em: comoDia(entrada.prazo_em),
      recebido_em: comoDia(entrada.recebido_em),
      valido_ate: comoDia(entrada.valido_ate),
      proxima_em: comoDia(entrada.proxima_em),
      feita_em: comoDia(entrada.feita_em),
    },
    hoje,
  );

  return {
    tipo_id: entrada.tipo_id ?? null,
    nome,
    nome_curto: textoOuNulo(entrada.nome_curto, 60),
    categoria: entrada.categoria,
    lead_id: entrada.lead_id ?? null,
    empresa_id: entrada.empresa_id ?? null,
    contact_id: entrada.contact_id ?? null,
    quem_entrega: quem,
    ...rec,
    validade_meses: entrada.categoria === "atividade" ? 0 : validade,
    avisos_dias: entrada.avisos_dias === undefined ? [...AVISOS_PADRAO] : normalizarAvisos(entrada.avisos_dias),
    dias_sem_resposta: inteiroEntre(entrada.dias_sem_resposta, 1, 365, DIAS_SEM_RESPOSTA_PADRAO),
    ...datas,
    responsavel_user_id: entrada.responsavel_user_id ?? null,
    observacao: textoOuNulo(entrada.observacao, 2000),
    origem: textoOuNulo(entrada.origem, 80) ?? "tela",
    chave_natural: textoOuNulo(entrada.chave_natural, 300),
    // O item nasce hoje para os avisos: nada com data de disparo anterior sai.
    sem_aviso_antes_de: hoje,
  };
}

export async function adicionarObrigacao(ctx: ContextoDaOperacao, entrada: EntradaDeObrigacao): Promise<Obrigacao> {
  const linha = montarLinha(entrada, ctx.hoje);
  await conferirVinculos(ctx, {
    lead_id: (linha.lead_id as string | null) ?? null,
    empresa_id: (linha.empresa_id as string | null) ?? null,
    contact_id: (linha.contact_id as string | null) ?? null,
  });
  const { data, error } = await ctx.db
    .from("mia_obrigacoes")
    .insert({ ...linha, organization_id: ctx.org, created_by_user_id: ctx.ator, updated_by_user_id: ctx.ator })
    .select(COLUNAS_DA_OBRIGACAO)
    .single();
  if (error || !data) throw new ErroDeObrigacao("interno", `Não consegui adicionar o item: ${error?.message ?? "sem linha"}`);
  return data as unknown as Obrigacao;
}

/** Os campos que a edição aceita. Datas de ciclo mudam pelos botões, não por aqui, exceto correção. */
export interface EdicaoDeObrigacao {
  nome?: string;
  nome_curto?: string | null;
  quem_entrega?: QuemEntrega;
  recorrencia?: Recorrencia;
  recorrencia_meses?: number | null;
  validade_meses?: number;
  avisos_dias?: readonly number[];
  dias_sem_resposta?: number;
  responsavel_user_id?: string | null;
  observacao?: string | null;
  /** Correção de data: quem digitou o "válido até" errado conserta sem abrir ciclo novo. */
  prazo_em?: Dia | null;
  valido_ate?: Dia | null;
  proxima_em?: Dia | null;
  lead_id?: string | null;
  empresa_id?: string | null;
  contact_id?: string | null;
}

async function exigir(ctx: ContextoDaOperacao, id: string): Promise<Obrigacao> {
  const item = await lerObrigacao(ctx.db, ctx.org, id);
  if (!item || item.arquivado_em) throw new ErroDeObrigacao("nao_encontrado", "Item não encontrado.");
  return item;
}

async function gravar(ctx: ContextoDaOperacao, id: string, patch: Record<string, unknown>): Promise<Obrigacao> {
  const { data, error } = await ctx.db
    .from("mia_obrigacoes")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by_user_id: ctx.ator })
    .eq("organization_id", ctx.org)
    .eq("id", id)
    .select(COLUNAS_DA_OBRIGACAO)
    .maybeSingle();
  if (error) throw new ErroDeObrigacao("interno", `Não consegui gravar o item: ${error.message}`);
  // Zero linhas com item que existe: a RLS não deixou (papel abaixo de agente, ou negócio que a pessoa não vê).
  if (!data) throw new ErroDeObrigacao("nao_encontrado", "Item não encontrado, ou você não pode alterá-lo.");
  return data as unknown as Obrigacao;
}

export async function editarObrigacao(
  ctx: ContextoDaOperacao,
  id: string,
  edicao: EdicaoDeObrigacao,
): Promise<{ item: Obrigacao; campos: string[] }> {
  const atual = await exigir(ctx, id);
  const patch: Record<string, unknown> = {};

  if (edicao.nome !== undefined) {
    const nome = textoOuNulo(edicao.nome, 120);
    if (!nome) throw new ErroDeObrigacao("validacao", "Dê um nome ao item.");
    patch.nome = nome;
  }
  if (edicao.nome_curto !== undefined) patch.nome_curto = textoOuNulo(edicao.nome_curto, 60);
  if (edicao.quem_entrega !== undefined) {
    if (!(QUEM_ENTREGA as readonly string[]).includes(edicao.quem_entrega)) {
      throw new ErroDeObrigacao("validacao", "Quem entrega é o cliente ou nós.");
    }
    patch.quem_entrega = edicao.quem_entrega;
  }
  if (edicao.recorrencia !== undefined || edicao.recorrencia_meses !== undefined) {
    Object.assign(
      patch,
      recorrenciaValida(edicao.recorrencia ?? atual.recorrencia, edicao.recorrencia_meses ?? atual.recorrencia_meses),
    );
  }
  if (edicao.validade_meses !== undefined && atual.categoria === "documento") {
    patch.validade_meses = inteiroEntre(edicao.validade_meses, 0, 600, atual.validade_meses);
  }
  if (edicao.avisos_dias !== undefined) patch.avisos_dias = normalizarAvisos(edicao.avisos_dias);
  if (edicao.dias_sem_resposta !== undefined) {
    patch.dias_sem_resposta = inteiroEntre(edicao.dias_sem_resposta, 1, 365, atual.dias_sem_resposta);
  }
  if (edicao.responsavel_user_id !== undefined) patch.responsavel_user_id = edicao.responsavel_user_id;
  if (edicao.observacao !== undefined) patch.observacao = textoOuNulo(edicao.observacao, 2000);

  const dataCorrigida = (campo: "prazo_em" | "valido_ate" | "proxima_em", categoria: Categoria) => {
    const valor = edicao[campo];
    if (valor === undefined) return;
    if (atual.categoria !== categoria) {
      throw new ErroDeObrigacao("validacao", `"${campo}" não existe neste tipo de item.`);
    }
    if (valor !== null && !comoDia(valor)) {
      throw new ErroDeObrigacao("validacao", `A data de "${campo}" não existe no calendário. Use AAAA-MM-DD.`);
    }
    patch[campo] = valor === null ? null : comoDia(valor);
  };
  dataCorrigida("prazo_em", "documento");
  dataCorrigida("valido_ate", "documento");
  dataCorrigida("proxima_em", "atividade");

  if (edicao.lead_id !== undefined || edicao.empresa_id !== undefined || edicao.contact_id !== undefined) {
    const vinculos = {
      lead_id: edicao.lead_id === undefined ? atual.lead_id : edicao.lead_id,
      empresa_id: edicao.empresa_id === undefined ? atual.empresa_id : edicao.empresa_id,
      contact_id: edicao.contact_id === undefined ? atual.contact_id : edicao.contact_id,
    };
    await conferirVinculos(ctx, vinculos);
    Object.assign(patch, vinculos);
  }

  const campos = Object.keys(patch);
  if (campos.length === 0) return { item: atual, campos };
  return { item: await gravar(ctx, id, patch), campos };
}

/** "Marcar pedido" e "Pedir de novo". Devolve o item e o que foi feito. */
export async function pedirObrigacao(
  ctx: ContextoDaOperacao,
  id: string,
): Promise<{ item: Obrigacao; modo: "pedido" | "renovacao_pedida" | "pedido_de_novo" }> {
  const atual = await exigir(ctx, id);
  if (atual.categoria !== "documento") {
    throw new ErroDeObrigacao("validacao", "Só documento é pedido. Atividade recorrente é marcada como feita.");
  }
  const { modo, ...patch } = aoPedir(atual, ctx.hoje);
  return { item: await gravar(ctx, id, patch), modo };
}

function traduzirErroDoCiclo(erro: { message: string; code?: string }): never {
  if (erro.code === "40001" || /mia_obrigacao_mudou/.test(erro.message)) {
    throw new ErroDeObrigacao(
      "conflito",
      "Este item já foi atualizado por outra pessoa. Abra de novo para ver como ficou.",
    );
  }
  if (erro.code === "P0002" || /mia_obrigacao_nao_encontrada/.test(erro.message)) {
    throw new ErroDeObrigacao("nao_encontrado", "Item não encontrado, ou você não pode alterá-lo.");
  }
  throw new ErroDeObrigacao("interno", `Não consegui fechar o ciclo: ${erro.message}`);
}

/**
 * Receber o documento (ou a versão nova dele).
 *
 * `valido_ate` nulo num tipo com validade padrão fica nulo: quem sugere a data
 * é a tela (`validadeSugerida`), e a pessoa pode apagar. Sem data, o item fica
 * "recebido · sem validade" e sai dos avisos de vencimento.
 */
export async function receberObrigacao(
  ctx: ContextoDaOperacao,
  id: string,
  entrada: { valido_ate: Dia | null; arquivo: ArquivoGuardado | null; proposta_id?: string | null; dia?: Dia | null },
): Promise<{ item: Obrigacao; renovou: boolean }> {
  const atual = await exigir(ctx, id);
  if (atual.categoria !== "documento") {
    throw new ErroDeObrigacao("validacao", "Só documento é recebido. Atividade recorrente é marcada como feita.");
  }
  if (entrada.valido_ate !== null && !comoDia(entrada.valido_ate)) {
    throw new ErroDeObrigacao("validacao", "A data de \"válido até\" não existe no calendário. Use AAAA-MM-DD.");
  }
  const dia = comoDia(entrada.dia) ?? ctx.hoje;
  const renovou = receberRenova(atual);
  const { error } = await ctx.db.rpc("fn_mia_obrigacao_fechar_ciclo", {
    p_obrigacao: id,
    p_ciclo_esperado: atual.ciclo,
    p_como: "recebido",
    p_dia: dia,
    p_valido_ate: entrada.valido_ate,
    p_proxima_em: null,
    p_arquivo: entrada.arquivo
      ? { path: entrada.arquivo.path, nome: entrada.arquivo.nome, mime: entrada.arquivo.mime, bytes: String(entrada.arquivo.bytes) }
      : null,
    p_ator: ctx.ator,
    p_proposta: entrada.proposta_id ?? null,
  });
  if (error) traduzirErroDoCiclo(error);
  return { item: await exigir(ctx, id), renovou };
}

/** Marcar a atividade como feita: o próximo ciclo nasce sozinho. */
export async function marcarFeita(
  ctx: ContextoDaOperacao,
  id: string,
  entrada: { dia?: Dia | null } = {},
): Promise<{ item: Obrigacao; proxima_em: Dia | null }> {
  const atual = await exigir(ctx, id);
  if (atual.categoria !== "atividade") {
    throw new ErroDeObrigacao("validacao", "Só atividade recorrente é marcada como feita. Documento é recebido.");
  }
  if (!atual.proxima_em) {
    throw new ErroDeObrigacao("validacao", "Esta atividade já foi feita e não se repete.");
  }
  const proxima = proximaDataDaAtividade(atual, ctx.hoje);
  const { error } = await ctx.db.rpc("fn_mia_obrigacao_fechar_ciclo", {
    p_obrigacao: id,
    p_ciclo_esperado: atual.ciclo,
    p_como: "feita",
    p_dia: comoDia(entrada.dia) ?? ctx.hoje,
    p_valido_ate: null,
    p_proxima_em: proxima,
    p_arquivo: null,
    p_ator: ctx.ator,
    p_proposta: null,
  });
  if (error) traduzirErroDoCiclo(error);
  return { item: await exigir(ctx, id), proxima_em: proxima };
}

/**
 * Anexa (ou troca) o arquivo do ciclo em vigor, sem abrir ciclo novo: é o
 * arquivo que faltou na hora de adicionar ou de receber. O arquivo anterior do
 * mesmo ciclo vai para a fila de remoção (gatilho da migration 9018).
 */
export async function anexarArquivo(ctx: ContextoDaOperacao, id: string, arquivo: ArquivoGuardado): Promise<Obrigacao> {
  const atual = await exigir(ctx, id);
  if (atual.categoria !== "documento") {
    throw new ErroDeObrigacao("validacao", "Só documento guarda arquivo.");
  }
  return gravar(ctx, id, {
    arquivo_path: arquivo.path,
    arquivo_nome: arquivo.nome,
    arquivo_mime: arquivo.mime,
    arquivo_bytes: arquivo.bytes,
  });
}

/** Tira o item das listas, sem apagar: o histórico e o arquivo ficam. */
export async function arquivarObrigacao(ctx: ContextoDaOperacao, id: string): Promise<Obrigacao> {
  await exigir(ctx, id);
  return gravar(ctx, id, { arquivado_em: new Date().toISOString() });
}

/** A proposta do agente que espera decisão, com o item dela. */
export async function lerPropostaPendente(
  ctx: ContextoDaOperacao,
  propostaId: string,
): Promise<{ id: string; obrigacao_id: string; message_id: string | null; arquivo_nome: string | null }> {
  const { data, error } = await ctx.db
    .from("mia_obrigacoes_propostas")
    .select("id, obrigacao_id, message_id, arquivo_nome, situacao")
    .eq("organization_id", ctx.org)
    .eq("id", propostaId)
    .maybeSingle();
  if (error) throw new ErroDeObrigacao("interno", `Não consegui ler a proposta: ${error.message}`);
  const linha = data as { id: string; obrigacao_id: string; message_id: string | null; arquivo_nome: string | null; situacao: string } | null;
  if (!linha) throw new ErroDeObrigacao("nao_encontrado", "Proposta não encontrada.");
  if (linha.situacao !== "pendente") {
    throw new ErroDeObrigacao("conflito", "Esta proposta já foi decidida por outra pessoa.");
  }
  return linha;
}

/** "Não é": o arquivo fica só na conversa e o item continua pendente. */
export async function recusarProposta(ctx: ContextoDaOperacao, propostaId: string): Promise<{ obrigacao_id: string }> {
  const proposta = await lerPropostaPendente(ctx, propostaId);
  const { data, error } = await ctx.db
    .from("mia_obrigacoes_propostas")
    .update({ situacao: "recusada", decidida_em: new Date().toISOString(), decidida_por_user_id: ctx.ator })
    .eq("organization_id", ctx.org)
    .eq("id", propostaId)
    .eq("situacao", "pendente")
    .select("id");
  if (error) throw new ErroDeObrigacao("interno", `Não consegui recusar a proposta: ${error.message}`);
  if (((data ?? []) as unknown[]).length === 0) {
    throw new ErroDeObrigacao("conflito", "Esta proposta já foi decidida por outra pessoa.");
  }
  return { obrigacao_id: proposta.obrigacao_id };
}
