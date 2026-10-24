/**
 * FORK MIA (.88) — "COMO FAÇO?" e "ONDE FICA?": as três fontes do suporte de uso.
 *
 *   1. o mapa das telas (`NAV_CATALOG`, por `telas.ts`): o "onde fica";
 *   2. os manuais do sistema (`manuais.ts`): o "como faço";
 *   3. a base própria da empresa (`mia_assistente_conhecimento`, 9050): o
 *      "como trabalhamos aqui", que o administrador escreve.
 *
 * Cada achado diz se a pessoa ABRE a tela. Quando não abre, o assistente
 * explica e diz quem pode (regra "Pergunta fora da permissão"), em vez de
 * levar a pessoa a um 403.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { roleAtLeast, type Role } from "@/lib/auth/types";

import { MANUAIS } from "../manuais";
import { buscarTelas, palavras, pontuar, quemAbre, type TelaConhecida } from "../telas";

export interface ItemDaBaseDaEmpresa {
  titulo: string;
  texto: string;
}

export interface AchadosDaAjuda {
  manuais: Array<{
    titulo: string;
    passos: string[];
    observacao: string | null;
    tela: string;
    href: string;
    voce_pode: boolean;
    quem_pode: string;
  }>;
  telas: Array<{ rotulo: string; descricao: string; href: string; voce_abre: boolean; quem_abre: string }>;
  base_da_empresa: ItemDaBaseDaEmpresa[];
  nada_encontrado: boolean;
  fontes: string[];
}

/** A base própria inteira da empresa (o que está ativo), pela sessão. */
export async function lerBaseDaEmpresa(
  db: SupabaseClient,
  organizationId: string,
): Promise<ItemDaBaseDaEmpresa[]> {
  const { data } = await db
    .from("mia_assistente_conhecimento")
    .select("titulo, texto")
    .eq("organization_id", organizationId)
    .eq("ativo", true)
    .order("titulo", { ascending: true })
    .limit(60);
  return ((data ?? []) as ItemDaBaseDaEmpresa[]).map((i) => ({ titulo: i.titulo, texto: i.texto }));
}

export function buscarAjuda(entrada: {
  pergunta: string;
  papel: Role;
  telas: readonly TelaConhecida[];
  base: readonly ItemDaBaseDaEmpresa[];
}): AchadosDaAjuda {
  const busca = palavras(entrada.pergunta);
  const rotuloDaTela = (href: string) => entrada.telas.find((t) => t.href === href)?.rotulo ?? href;

  const manuais = MANUAIS.map((m) => ({
    m,
    pontos: pontuar(busca, `${m.titulo} ${m.titulo} ${m.palavras.join(" ")}`),
  }))
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, 3)
    .map(({ m }) => ({
      titulo: m.titulo,
      passos: m.passos,
      observacao: m.observacao ?? null,
      tela: rotuloDaTela(m.href),
      href: m.href,
      voce_pode: roleAtLeast(entrada.papel, m.papelMinimo),
      quem_pode: quemAbre(m.papelMinimo),
    }));

  const telas = buscarTelas(entrada.telas, entrada.pergunta, 4).map((t) => ({
    rotulo: t.rotulo,
    descricao: t.descricao,
    href: t.href,
    voce_abre: t.abre,
    quem_abre: quemAbre(t.papelMinimo),
  }));

  const base = entrada.base
    .map((b) => ({ b, pontos: pontuar(busca, `${b.titulo} ${b.titulo} ${b.texto}`) }))
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, 3)
    .map((x) => x.b);

  const fontes: string[] = [];
  if (manuais.length > 0) fontes.push("Manual do sistema");
  if (telas.length > 0) fontes.push("Mapa das telas");
  if (base.length > 0) fontes.push("Como trabalhamos aqui");

  return {
    manuais,
    telas,
    base_da_empresa: base,
    nada_encontrado: manuais.length === 0 && telas.length === 0 && base.length === 0,
    fontes,
  };
}
