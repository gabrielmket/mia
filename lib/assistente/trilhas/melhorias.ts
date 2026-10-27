/**
 * FORK MIA (.93) — A LISTA DE MELHORIAS DO PRODUTO (9091; decisão 13: mora na
 * tela da Time, /admin/assistente, com o MCP lendo e escrevendo).
 *
 * O que a Time anota a partir de onde os clientes travam: o tema muito
 * perguntado sem trilha, o passo com a maior queda, a pergunta sem resposta, a
 * proposta muito desfeita. O título é a chave natural (sem diferença de
 * maiúscula nem de espaço nas pontas): anotar de novo ATUALIZA a evidência e a
 * situação, em vez de duplicar. É daqui que o agente de desenvolvimento pega o
 * próximo trabalho, com a evidência junto.
 *
 * O cliente é o de serviço: quem chama conferiu o administrador da plataforma
 * (a rota) ou o token (o MCP).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const SITUACOES_DA_MELHORIA = ["anotada", "em_desenvolvimento", "no_ar"] as const;
export type SituacaoDaMelhoria = (typeof SITUACOES_DA_MELHORIA)[number];
export const ORIGENS_DA_MELHORIA = ["tema", "trilha", "sem_resposta", "proposta", "manual"] as const;
export type OrigemDaMelhoria = (typeof ORIGENS_DA_MELHORIA)[number];

export const ROTULO_DA_SITUACAO_DA_MELHORIA: Record<SituacaoDaMelhoria, string> = {
  anotada: "Anotada",
  em_desenvolvimento: "Em desenvolvimento",
  no_ar: "No ar",
};

export interface Melhoria {
  id: string;
  titulo: string;
  evidencia: string | null;
  origem: OrigemDaMelhoria;
  situacao: SituacaoDaMelhoria;
  created_at: string;
  updated_at: string;
}

type Db = Pick<SupabaseClient, "from">;

const COLUNAS = "id, titulo, evidencia, origem, situacao, created_at, updated_at";
const chave = (titulo: string) => titulo.trim().toLowerCase();

export async function listarMelhorias(db: Db, limite = 200): Promise<Melhoria[]> {
  const { data, error } = await db
    .from("mia_melhorias_do_produto")
    .select(COLUNAS)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(1, limite), 500));
  if (error) throw new Error(`não consegui ler as melhorias: ${error.message}`);
  return (data ?? []) as Melhoria[];
}

export class RecusaDaMelhoria extends Error {}

/**
 * Anota ou atualiza uma melhoria pelo título. Devolve se foi criada,
 * atualizada ou se nada mudou (`igual`).
 */
export async function anotarMelhoria(
  db: Db,
  entrada: {
    titulo: string;
    evidencia?: string | null;
    origem?: OrigemDaMelhoria;
    situacao?: SituacaoDaMelhoria;
    autorUserId: string | null;
  },
): Promise<{ desfecho: "criada" | "atualizada" | "igual"; melhoria: Melhoria }> {
  const titulo = entrada.titulo.replace(/\s+/g, " ").trim();
  if (titulo.length < 3 || titulo.length > 300) throw new RecusaDaMelhoria("O título precisa ter de 3 a 300 letras.");
  const evidencia = entrada.evidencia === undefined ? undefined : entrada.evidencia === null ? null : entrada.evidencia.trim().slice(0, 1000) || null;

  // A chave é o título sem diferença de maiúscula: lê as recentes e compara aqui
  // (o índice único do banco, 9091, segura a corrida).
  const existentes = await listarMelhorias(db, 500);
  const atual = existentes.find((m) => chave(m.titulo) === chave(titulo));
  if (!atual) {
    const { data, error } = await db
      .from("mia_melhorias_do_produto")
      .insert({
        titulo,
        evidencia: evidencia ?? null,
        origem: entrada.origem ?? "manual",
        situacao: entrada.situacao ?? "anotada",
        anotada_por: entrada.autorUserId,
        atualizada_por: entrada.autorUserId,
      })
      .select(COLUNAS)
      .single();
    if (error) throw new Error(`não consegui anotar a melhoria: ${error.message}`);
    return { desfecho: "criada", melhoria: data as Melhoria };
  }
  const mudanca: Record<string, unknown> = {};
  if (evidencia !== undefined && evidencia !== atual.evidencia) mudanca.evidencia = evidencia;
  if (entrada.situacao && entrada.situacao !== atual.situacao) mudanca.situacao = entrada.situacao;
  if (Object.keys(mudanca).length === 0) return { desfecho: "igual", melhoria: atual };
  const { data, error } = await db
    .from("mia_melhorias_do_produto")
    .update({ ...mudanca, atualizada_por: entrada.autorUserId, updated_at: new Date().toISOString() })
    .eq("id", atual.id)
    .select(COLUNAS)
    .single();
  if (error) throw new Error(`não consegui atualizar a melhoria: ${error.message}`);
  return { desfecho: "atualizada", melhoria: data as Melhoria };
}
