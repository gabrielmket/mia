/**
 * FORK MIA — OBRIGAÇÕES · o CATÁLOGO de tipos de uma empresa, no banco.
 *
 * O catálogo é por funil (`pipeline_id`) ou da empresa inteira (nulo). A tela
 * de configuração do funil e a ferramenta `plataforma_garantir_tipos_de_obrigacao`
 * chamam `garantirTipos`: um caminho só, com reexecução segura. A chave é o
 * NOME dentro do funil (sem diferenciar maiúsculas e acentos); tipo novo entra,
 * o que mudou é atualizado, o igual fica como está, e o que o pedido não cita
 * continua lá.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { modelosDoSegmento, type SegmentoDeObrigacao } from "./catalogo";
import { ErroDeObrigacao } from "./operacoes";
import {
  CATEGORIAS,
  COLUNAS_DO_TIPO,
  DIAS_SEM_RESPOSTA_PADRAO,
  LIGA_A,
  QUEM_ENTREGA,
  RECORRENCIAS,
  chaveDoNome,
  normalizarAvisos,
  type Categoria,
  type LigaA,
  type QuemEntrega,
  type Recorrencia,
  type TipoDeObrigacao,
} from "./tipos";

type Db = SupabaseClient;

/** Quantos tipos um funil aceita. Acima disso a lista do formulário deixa de ser lista. */
export const TETO_DE_TIPOS_POR_FUNIL = 60;

export interface EntradaDeTipo {
  nome: string;
  nome_curto?: string | null;
  categoria: Categoria;
  quem_entrega?: QuemEntrega;
  recorrencia?: Recorrencia;
  recorrencia_meses?: number | null;
  validade_meses?: number;
  avisos_dias?: readonly number[];
  dias_sem_resposta?: number;
  liga_a?: LigaA;
  pede_arquivo?: boolean;
  segmento?: string | null;
}

export type DesfechoDoTipo = "criou" | "atualizou" | "ja_estava";

export async function lerTipos(db: Db, org: string): Promise<TipoDeObrigacao[]> {
  const { data, error } = await db
    .from("mia_obrigacoes_tipos")
    .select(COLUNAS_DO_TIPO)
    .eq("organization_id", org)
    .is("arquivado_em", null)
    .order("posicao", { ascending: true })
    .order("nome", { ascending: true });
  if (error) throw new ErroDeObrigacao("interno", `Não consegui ler o catálogo de tipos: ${error.message}`);
  return (data ?? []) as unknown as TipoDeObrigacao[];
}

function pertence<T extends string>(lista: readonly T[], valor: unknown): valor is T {
  return (lista as readonly string[]).includes(String(valor));
}

/** A linha de um tipo como o banco a aceita, ou a recusa que diz o campo. */
export function montarTipo(entrada: EntradaDeTipo, posicao: number): Omit<TipoDeObrigacao, "id" | "pipeline_id"> {
  const nome = typeof entrada.nome === "string" ? entrada.nome.trim().slice(0, 120) : "";
  if (!nome) throw new ErroDeObrigacao("validacao", "Todo tipo precisa de um nome.");
  if (!pertence(CATEGORIAS, entrada.categoria)) {
    throw new ErroDeObrigacao("validacao", `Tipo "${nome}": a categoria é "documento" ou "atividade".`);
  }
  const recorrencia = entrada.recorrencia === undefined ? "unica" : entrada.recorrencia;
  if (!pertence(RECORRENCIAS, recorrencia)) {
    throw new ErroDeObrigacao("validacao", `Tipo "${nome}": a recorrência é "unica", "mensal", "anual" ou "n_meses".`);
  }
  let meses: number | null = null;
  if (recorrencia === "n_meses") {
    const n = Number(entrada.recorrencia_meses);
    if (!Number.isInteger(n) || n < 1 || n > 240) {
      throw new ErroDeObrigacao("validacao", `Tipo "${nome}": com recorrência "n_meses", informe recorrencia_meses de 1 a 240.`);
    }
    meses = n;
  }
  const quem = entrada.quem_entrega === undefined ? (entrada.categoria === "atividade" ? "nos" : "cliente") : entrada.quem_entrega;
  if (!pertence(QUEM_ENTREGA, quem)) {
    throw new ErroDeObrigacao("validacao", `Tipo "${nome}": quem entrega é "cliente" ou "nos".`);
  }
  const liga = entrada.liga_a === undefined ? "negocio" : entrada.liga_a;
  if (!pertence(LIGA_A, liga)) {
    throw new ErroDeObrigacao("validacao", `Tipo "${nome}": liga_a é "negocio", "empresa" ou "contato".`);
  }
  const validade = Number(entrada.validade_meses ?? 0);
  if (!Number.isInteger(validade) || validade < 0 || validade > 600) {
    throw new ErroDeObrigacao("validacao", `Tipo "${nome}": validade_meses vai de 0 (sem validade) a 600.`);
  }
  const semResposta = Number(entrada.dias_sem_resposta ?? DIAS_SEM_RESPOSTA_PADRAO);
  if (!Number.isInteger(semResposta) || semResposta < 1 || semResposta > 365) {
    throw new ErroDeObrigacao("validacao", `Tipo "${nome}": dias_sem_resposta vai de 1 a 365.`);
  }
  return {
    nome,
    nome_curto: typeof entrada.nome_curto === "string" && entrada.nome_curto.trim() ? entrada.nome_curto.trim().slice(0, 60) : null,
    categoria: entrada.categoria,
    quem_entrega: quem,
    recorrencia,
    recorrencia_meses: meses,
    validade_meses: entrada.categoria === "atividade" ? 0 : validade,
    avisos_dias: normalizarAvisos(entrada.avisos_dias ?? [30, 15, 7]),
    dias_sem_resposta: semResposta,
    liga_a: liga,
    pede_arquivo: entrada.pede_arquivo ?? entrada.categoria === "documento",
    segmento: typeof entrada.segmento === "string" && entrada.segmento.trim() ? entrada.segmento.trim().slice(0, 60) : null,
    posicao,
  };
}

const CAMPOS_COMPARADOS = [
  "nome",
  "nome_curto",
  "categoria",
  "quem_entrega",
  "recorrencia",
  "recorrencia_meses",
  "validade_meses",
  "avisos_dias",
  "dias_sem_resposta",
  "liga_a",
  "pede_arquivo",
] as const;

function mudou(atual: TipoDeObrigacao, novo: Omit<TipoDeObrigacao, "id" | "pipeline_id">): string[] {
  return CAMPOS_COMPARADOS.filter((campo) => JSON.stringify(atual[campo]) !== JSON.stringify(novo[campo]));
}

async function conferirFunil(db: Db, org: string, pipelineId: string | null): Promise<void> {
  if (!pipelineId) return;
  const { data, error } = await db.from("crm_pipelines").select("id").eq("organization_id", org).eq("id", pipelineId).maybeSingle();
  if (error) throw new ErroDeObrigacao("interno", `Não consegui conferir o funil: ${error.message}`);
  if (!data) throw new ErroDeObrigacao("nao_encontrado", "Não encontrei este funil nesta empresa.");
}

/**
 * Garante os tipos de um funil (ou da empresa inteira, com `pipelineId` nulo).
 * Devolve o que aconteceu com cada um.
 */
export async function garantirTipos(
  db: Db,
  alvo: { org: string; ator: string | null; pipelineId: string | null },
  entradas: readonly EntradaDeTipo[],
): Promise<Array<{ id: string; nome: string; desfecho: DesfechoDoTipo; mudancas: string[] }>> {
  await conferirFunil(db, alvo.org, alvo.pipelineId);
  const existentes = (await lerTipos(db, alvo.org)).filter((t) => t.pipeline_id === alvo.pipelineId);
  const porChave = new Map(existentes.map((t) => [chaveDoNome(t.nome), t]));
  const vistas = new Set<string>();
  const saida: Array<{ id: string; nome: string; desfecho: DesfechoDoTipo; mudancas: string[] }> = [];
  let proxima = existentes.reduce((maior, t) => Math.max(maior, t.posicao), -1) + 1;

  for (const entrada of entradas) {
    const linha = montarTipo(entrada, proxima);
    const chave = chaveDoNome(linha.nome);
    if (vistas.has(chave)) {
      throw new ErroDeObrigacao("validacao", `O tipo "${linha.nome}" aparece duas vezes na lista. Cada nome entra uma vez por funil.`);
    }
    vistas.add(chave);
    const atual = porChave.get(chave);
    if (!atual) {
      if (existentes.length + saida.filter((s) => s.desfecho === "criou").length >= TETO_DE_TIPOS_POR_FUNIL) {
        throw new ErroDeObrigacao("validacao", `Um funil aceita até ${TETO_DE_TIPOS_POR_FUNIL} tipos de obrigação.`);
      }
      const { data, error } = await db
        .from("mia_obrigacoes_tipos")
        .insert({ ...linha, organization_id: alvo.org, pipeline_id: alvo.pipelineId, created_by_user_id: alvo.ator })
        .select("id")
        .single();
      if (error || !data) throw new ErroDeObrigacao("interno", `Não consegui criar o tipo "${linha.nome}": ${error?.message ?? "sem linha"}`);
      saida.push({ id: (data as { id: string }).id, nome: linha.nome, desfecho: "criou", mudancas: [] });
      proxima += 1;
      continue;
    }
    const mudancas = mudou(atual, { ...linha, posicao: atual.posicao, segmento: atual.segmento });
    if (mudancas.length === 0) {
      saida.push({ id: atual.id, nome: atual.nome, desfecho: "ja_estava", mudancas: [] });
      continue;
    }
    const { posicao: _posicao, segmento: _segmento, ...patch } = linha;
    const { error } = await db
      .from("mia_obrigacoes_tipos")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("organization_id", alvo.org)
      .eq("id", atual.id);
    if (error) throw new ErroDeObrigacao("interno", `Não consegui atualizar o tipo "${linha.nome}": ${error.message}`);
    saida.push({ id: atual.id, nome: linha.nome, desfecho: "atualizou", mudancas });
  }
  return saida;
}

/** "Usar o modelo do segmento": os tipos do segmento entram no funil; os que já existem pelo nome ficam como estão. */
export async function aplicarModeloDoSegmento(
  db: Db,
  alvo: { org: string; ator: string | null; pipelineId: string | null },
  segmento: SegmentoDeObrigacao,
): Promise<Array<{ id: string; nome: string; desfecho: DesfechoDoTipo; mudancas: string[] }>> {
  await conferirFunil(db, alvo.org, alvo.pipelineId);
  const existentes = new Set(
    (await lerTipos(db, alvo.org)).filter((t) => t.pipeline_id === alvo.pipelineId).map((t) => chaveDoNome(t.nome)),
  );
  // Só os que faltam: aplicar o modelo de novo não desfaz o ajuste que a empresa fez num tipo.
  const novos = modelosDoSegmento(segmento).filter((m) => !existentes.has(chaveDoNome(m.nome)));
  const criados = await garantirTipos(
    db,
    alvo,
    novos.map((m) => ({ ...m, segmento })),
  );
  const jaEstavam = modelosDoSegmento(segmento)
    .filter((m) => existentes.has(chaveDoNome(m.nome)))
    .map((m) => ({ id: "", nome: m.nome, desfecho: "ja_estava" as const, mudancas: [] }));
  return [...criados, ...jaEstavam];
}

/** Tira o tipo do catálogo. Os itens que nasceram dele continuam: o item guarda as próprias regras. */
export async function arquivarTipo(db: Db, org: string, tipoId: string): Promise<{ nome: string }> {
  const { data, error } = await db
    .from("mia_obrigacoes_tipos")
    .update({ arquivado_em: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("organization_id", org)
    .eq("id", tipoId)
    .is("arquivado_em", null)
    .select("nome")
    .maybeSingle();
  if (error) throw new ErroDeObrigacao("interno", `Não consegui tirar o tipo: ${error.message}`);
  if (!data) throw new ErroDeObrigacao("nao_encontrado", "Tipo não encontrado.");
  return data as { nome: string };
}
