/**
 * FORK MIA (.61) — DE QUAL EMPRESA É CADA PÁGINA DA META, e com qual token ler.
 *
 * ─── O defeito da .60 ──────────────────────────────────────────────────────
 *
 * O token que existe é o da agência: o usuário do sistema do Gerenciador da Time
 * Company, que alcança as Páginas de vários clientes. A .60 listava tudo o que o
 * token alcança, então a empresa X via (e podia importar) a Página da empresa Y.
 *
 * ─── A regra ───────────────────────────────────────────────────────────────
 *
 * Cada Página tem UM dono em `mia_paginas_da_meta` (migration 9004), atribuído
 * pelo dono da plataforma em /admin/paginas-da-meta. Tudo aqui parte da lista de
 * Páginas DA EMPRESA, nunca da lista do token: o token só serve para achar o
 * token de cada Página que já é dela. Página que o token alcança e não é da
 * empresa não entra no mapa, e o que não está no mapa não é lido.
 *
 * O banco garante a mesma coisa do outro lado (gatilhos da 9004): formulário
 * ativo de Página que não é da empresa não existe.
 *
 * ─── Com qual token ────────────────────────────────────────────────────────
 *
 *   1. o da PRÓPRIA empresa (Configurações › Meta Ads), quando existe;
 *   2. o da PLATAFORMA: a conexão de Meta Ads da empresa escolhida em
 *      `mia_meta_conexao_da_plataforma` (hoje a Time Company). É o que deixa um
 *      cliente sem token próprio ler as Páginas dele, e só as dele.
 *
 * A própria vem primeiro porque é a que o cliente controla. Uma Página que o
 * token próprio não alcança ainda pode ser alcançada pelo da plataforma.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  existeConexaoDeLeitura,
  lerCredencialDeLeitura,
  type MotivoSemLeitura,
} from "@/lib/plataformas-de-anuncio/credenciais-de-leitura";
import { listarPaginas, type PaginaDoToken } from "@/lib/plataformas-de-anuncio/meta/leads";
import type { FalhaDeLeitura } from "@/lib/plataformas-de-anuncio/types";

/** De onde veio o token que alcançou a Página. */
export type OrigemDoAcesso = "propria" | "plataforma";

export interface PaginaAtribuida {
  page_id: string;
  page_name: string | null;
}

export interface PaginaAlcancada extends PaginaDoToken {
  origem: OrigemDoAcesso;
}

export type AcessoAsPaginas =
  | {
      ok: true;
      /** SÓ Páginas atribuídas à empresa, cada uma com o token dela. */
      paginas: Map<string, PaginaAlcancada>;
      /** O token cujas permissões a tela mostra: o próprio, senão o da plataforma. */
      tokenDasPermissoes: { token: string; origem: OrigemDoAcesso };
      /** Uma listagem falhou, mas outra deu certo: o que sobrou vale, com a ressalva. */
      falhaParcial: { falha: FalhaDeLeitura; detalhe: string } | null;
    }
  | { ok: false; motivo: MotivoSemLeitura | FalhaDeLeitura; detalhe: string | null };

/** As Páginas atribuídas à empresa. Lança se a leitura falhar: ninguém decide no escuro. */
export async function paginasDaEmpresa(
  admin: SupabaseClient,
  organizationId: string,
): Promise<PaginaAtribuida[]> {
  const { data, error } = await admin
    .from("mia_paginas_da_meta")
    .select("page_id, page_name")
    .eq("organization_id", organizationId)
    .order("page_name", { ascending: true });
  if (error) throw new Error(`leitura das Páginas da empresa falhou: ${error.message}`);
  return (data ?? []) as PaginaAtribuida[];
}

/** A empresa que empresta a conexão da plataforma. `null` = nenhuma escolhida. */
export async function empresaDaConexaoDaPlataforma(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin
    .from("mia_meta_conexao_da_plataforma")
    .select("organizacao_da_conexao")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`leitura da conexão da plataforma falhou: ${error.message}`);
  return ((data as { organizacao_da_conexao?: string | null } | null)?.organizacao_da_conexao ??
    null) as string | null;
}

/**
 * Existe algum token para ler as Páginas desta empresa? Sem decifrar nada: a
 * tela só precisa saber se mostra o quadro ou o convite a conectar.
 */
export async function existeAcessoDeLeitura(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ conectada: boolean; origem: OrigemDoAcesso | null }> {
  const propria = await existeConexaoDeLeitura(admin, organizationId, "meta_ads");
  if (propria.conectada) return { conectada: true, origem: "propria" };
  const daPlataforma = await empresaDaConexaoDaPlataforma(admin);
  if (!daPlataforma || daPlataforma === organizationId) return { conectada: false, origem: null };
  const emprestada = await existeConexaoDeLeitura(admin, daPlataforma, "meta_ads");
  return emprestada.conectada
    ? { conectada: true, origem: "plataforma" }
    : { conectada: false, origem: null };
}

/**
 * O token de cada Página ATRIBUÍDA à empresa, procurado primeiro no token dela e
 * depois no da plataforma. O que não é da empresa nunca entra no mapa.
 */
export async function acessoAsPaginas(
  admin: SupabaseClient,
  organizationId: string,
  atribuidas: readonly PaginaAtribuida[],
): Promise<AcessoAsPaginas> {
  const tokens: Array<{ token: string; origem: OrigemDoAcesso }> = [];
  let motivoSemToken: MotivoSemLeitura = "sem_conexao";

  const propria = await lerCredencialDeLeitura(admin, organizationId, "meta_ads");
  if (propria.ok) tokens.push({ token: propria.credencial.accessToken, origem: "propria" });
  else if (propria.motivo === "cifra_indisponivel") motivoSemToken = "cifra_indisponivel";

  const daPlataforma = await empresaDaConexaoDaPlataforma(admin);
  if (daPlataforma && daPlataforma !== organizationId) {
    const emprestada = await lerCredencialDeLeitura(admin, daPlataforma, "meta_ads");
    if (emprestada.ok) {
      tokens.push({ token: emprestada.credencial.accessToken, origem: "plataforma" });
    } else if (emprestada.motivo === "cifra_indisponivel") {
      motivoSemToken = "cifra_indisponivel";
    }
  }

  if (tokens.length === 0) return { ok: false, motivo: motivoSemToken, detalhe: null };

  const daEmpresa = new Set(atribuidas.map((p) => p.page_id));
  const paginas = new Map<string, PaginaAlcancada>();
  let primeiraFalha: { falha: FalhaDeLeitura; detalhe: string } | null = null;
  let algumaListou = false;

  for (const { token, origem } of tokens) {
    // Todas já achadas: o token seguinte nem é consultado (cota da Meta).
    if (daEmpresa.size > 0 && paginas.size === daEmpresa.size) break;
    const lidas = await listarPaginas(token);
    if (!lidas.ok) {
      primeiraFalha ??= { falha: lidas.falha, detalhe: lidas.detalhe };
      continue;
    }
    algumaListou = true;
    for (const pagina of lidas.dados) {
      // O filtro que a .60 não tinha: o token alcança, a empresa não é dona, fica de fora.
      if (!daEmpresa.has(pagina.id) || paginas.has(pagina.id)) continue;
      paginas.set(pagina.id, { ...pagina, origem });
    }
  }

  if (!algumaListou && primeiraFalha) {
    return { ok: false, motivo: primeiraFalha.falha, detalhe: primeiraFalha.detalhe };
  }

  return {
    ok: true,
    paginas,
    tokenDasPermissoes: tokens[0]!,
    falhaParcial: primeiraFalha,
  };
}
