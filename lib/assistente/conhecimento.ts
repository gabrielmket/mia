/**
 * FORK MIA (.88) — A BASE PRÓPRIA DA EMPRESA ("como trabalhamos aqui"): garantir
 * por título, sem duplicar.
 *
 * Um só caminho de escrita para as duas portas: a tela do administrador (cliente
 * da SESSÃO: a RLS da 9050 só deixa o administrador escrever) e o MCP de
 * plataforma (cliente de serviço, organização do token). O título é a chave
 * natural, sem diferença de maiúscula e espaço, como o índice único do banco.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const TETO_DE_ITENS = 30;
export const TETO_DO_TEXTO = 2000;

export interface ItemParaGarantir {
  titulo: string;
  texto: string;
  ativo?: boolean;
}

export interface ResultadoDaGarantia {
  criados: string[];
  atualizados: string[];
  iguais: string[];
  removidos: string[];
  recusados: Array<{ titulo: string; motivo: string }>;
}

export function chaveDoTitulo(titulo: string): string {
  return titulo.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function garantirConhecimento(
  db: SupabaseClient,
  entrada: {
    organizationId: string;
    itens: readonly ItemParaGarantir[];
    remover?: readonly string[];
    autorUserId: string | null;
    via: "tela" | "mcp_plataforma";
  },
): Promise<ResultadoDaGarantia> {
  const resultado: ResultadoDaGarantia = { criados: [], atualizados: [], iguais: [], removidos: [], recusados: [] };
  const { data, error } = await db
    .from("mia_assistente_conhecimento")
    .select("id, titulo, texto, ativo")
    .eq("organization_id", entrada.organizationId)
    .limit(200);
  if (error) throw new Error(`não consegui ler a base da empresa: ${error.message}`);
  const existentes = (data ?? []) as Array<{ id: string; titulo: string; texto: string; ativo: boolean }>;
  const porChave = new Map(existentes.map((e) => [chaveDoTitulo(e.titulo), e]));
  let total = existentes.length;
  const agora = new Date().toISOString();

  for (const titulo of entrada.remover ?? []) {
    const alvo = porChave.get(chaveDoTitulo(titulo));
    if (!alvo) continue;
    const { error: erro } = await db
      .from("mia_assistente_conhecimento")
      .delete()
      .eq("organization_id", entrada.organizationId)
      .eq("id", alvo.id);
    if (erro) resultado.recusados.push({ titulo, motivo: erro.message });
    else {
      resultado.removidos.push(alvo.titulo);
      porChave.delete(chaveDoTitulo(titulo));
      total -= 1;
    }
  }

  for (const item of entrada.itens) {
    const titulo = item.titulo.trim();
    const texto = item.texto.trim();
    if (titulo.length < 1 || titulo.length > 120) {
      resultado.recusados.push({ titulo, motivo: "O título precisa ter de 1 a 120 caracteres." });
      continue;
    }
    if (texto.length < 1 || texto.length > TETO_DO_TEXTO) {
      resultado.recusados.push({ titulo, motivo: `O texto precisa ter de 1 a ${TETO_DO_TEXTO} caracteres.` });
      continue;
    }
    const ativo = item.ativo ?? true;
    const existente = porChave.get(chaveDoTitulo(titulo));
    if (existente) {
      if (existente.texto === texto && existente.ativo === ativo && existente.titulo === titulo) {
        resultado.iguais.push(titulo);
        continue;
      }
      const { error: erro } = await db
        .from("mia_assistente_conhecimento")
        .update({ titulo, texto, ativo, updated_by: entrada.autorUserId, updated_at: agora })
        .eq("organization_id", entrada.organizationId)
        .eq("id", existente.id);
      if (erro) resultado.recusados.push({ titulo, motivo: erro.message });
      else resultado.atualizados.push(titulo);
      continue;
    }
    if (total >= TETO_DE_ITENS) {
      resultado.recusados.push({ titulo, motivo: `A base da empresa cabe até ${TETO_DE_ITENS} itens.` });
      continue;
    }
    const { data: criado, error: erro } = await db
      .from("mia_assistente_conhecimento")
      .insert({
        organization_id: entrada.organizationId,
        titulo,
        texto,
        ativo,
        criado_via: entrada.via,
        created_by: entrada.autorUserId,
        updated_by: entrada.autorUserId,
      })
      .select("id, titulo, texto, ativo")
      .single();
    if (erro || !criado) resultado.recusados.push({ titulo, motivo: erro?.message ?? "não gravou" });
    else {
      resultado.criados.push(titulo);
      porChave.set(chaveDoTitulo(titulo), criado as { id: string; titulo: string; texto: string; ativo: boolean });
      total += 1;
    }
  }
  return resultado;
}
