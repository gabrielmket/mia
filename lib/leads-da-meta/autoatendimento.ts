/**
 * FORK MIA (.64) — A EMPRESA COM CONTA PRÓPRIA DA META ESCOLHE AS PÁGINAS DELA.
 *
 * ─── O pedido ──────────────────────────────────────────────────────────────
 *
 * Até a .63 a empresa só via as Páginas que o dono da plataforma atribuía
 * (`mia_paginas_da_meta`, 9004), MESMO quando ela tinha conectado a própria
 * conta da Meta. O Gabriel: "quando o cliente conectar a conta dele, ele que tem
 * que definir qual página abrir ou se vai ter mais de uma página para puxar o
 * formulário".
 *
 * ─── Quem escolhe ──────────────────────────────────────────────────────────
 *
 *   · empresa COM conexão própria (Configurações › Meta Ads): ela mesma. A aba
 *     lista as Páginas que o token DELA alcança; marcar = assumir a Página
 *     (origem `conta_propria`, migration 9008), desmarcar = soltar;
 *   · empresa SEM conexão própria (lê pela conexão emprestada da plataforma):
 *     como na .61, só o dono da plataforma atribui.
 *
 * ─── A conta da agência colada na empresa não é "conta própria" ────────────
 *
 * O motivo inteiro da 9004 é que o token da AGÊNCIA alcança as Páginas de todos
 * os clientes. Se esse mesmo token (ou outro token do mesmo usuário do sistema)
 * for colado em Configurações › Meta Ads de um cliente — para a tabela de
 * campanhas dele funcionar, por exemplo —, "listar o que o token dela alcança"
 * voltaria a mostrar a um cliente as Páginas dos outros. Então, antes de abrir a
 * escolha, a identidade do token da empresa (`me` na Meta) é comparada com a do
 * token da plataforma: iguais, a empresa segue no modo da plataforma.
 *
 * Sem conseguir comparar (a Meta fora do ar, token recusado), a escolha NÃO
 * abre: falha fechado, com o motivo na tela. A empresa que empresta a conexão
 * (a da própria agência) é conta própria por definição.
 *
 * ─── O banco garante o resto ───────────────────────────────────────────────
 *
 * Uma Página, um dono (9004); assumir nunca toma a Página de outra empresa e só
 * vale com conexão própria (9008, gatilho). A resposta à empresa diz que a
 * Página "já está ligada a outra empresa", nunca qual.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  lerCredencialDeLeitura,
  type MotivoSemLeitura,
} from "@/lib/plataformas-de-anuncio/credenciais-de-leitura";
import { lerIdentidade, type PaginaDoToken } from "@/lib/plataformas-de-anuncio/meta/leads";
import type { FalhaDeLeitura } from "@/lib/plataformas-de-anuncio/types";

import { empresaDaConexaoDaPlataforma } from "./paginas";

/** De onde veio o dono da Página (coluna `origem`, migration 9008). */
export type OrigemDoDono = "plataforma" | "conta_propria";

export type ModoDasPaginas =
  /** A empresa escolhe, com o token dela. */
  | { modo: "conta_propria"; token: string }
  /** Quem atribui é a plataforma. */
  | { modo: "plataforma"; motivo: "sem_conexao_propria" | "conta_da_plataforma" }
  /** Não deu para saber: a escolha não abre (falha fechado). */
  | { modo: "indefinido"; falha: MotivoSemLeitura | FalhaDeLeitura; detalhe: string | null };

/**
 * Quem escolhe as Páginas desta empresa. Decifra o token (só no servidor) e,
 * quando há conexão emprestada, pergunta à Meta de quem são os dois tokens.
 */
export async function modoDasPaginas(
  admin: SupabaseClient,
  organizationId: string,
): Promise<ModoDasPaginas> {
  const propria = await lerCredencialDeLeitura(admin, organizationId, "meta_ads");
  if (!propria.ok) {
    return propria.motivo === "sem_conexao"
      ? { modo: "plataforma", motivo: "sem_conexao_propria" }
      : { modo: "indefinido", falha: propria.motivo, detalhe: null };
  }
  const token = propria.credencial.accessToken;

  const daPlataforma = await empresaDaConexaoDaPlataforma(admin);
  // A própria empresa da agência, ou nenhuma conexão emprestada: nada a comparar.
  if (!daPlataforma || daPlataforma === organizationId) return { modo: "conta_propria", token };

  const emprestada = await lerCredencialDeLeitura(admin, daPlataforma, "meta_ads");
  // A plataforma sem token legível: não há o que confundir com o da empresa.
  if (!emprestada.ok) return { modo: "conta_propria", token };
  if (emprestada.credencial.accessToken === token) {
    return { modo: "plataforma", motivo: "conta_da_plataforma" };
  }

  const [minha, dela] = await Promise.all([
    lerIdentidade(token),
    lerIdentidade(emprestada.credencial.accessToken),
  ]);
  if (!minha.ok) return { modo: "indefinido", falha: minha.falha, detalhe: minha.detalhe };
  if (!dela.ok) return { modo: "indefinido", falha: dela.falha, detalhe: dela.detalhe };
  if (minha.dados === dela.dados) return { modo: "plataforma", motivo: "conta_da_plataforma" };
  return { modo: "conta_propria", token };
}

/** Como cada Página aparece na escolha. */
export type EstadoNaEscolha = "desta_empresa" | "livre" | "de_outra_empresa";

export interface PaginaParaEscolher {
  id: string;
  nome: string;
  estado: EstadoNaEscolha;
  /** Só para `desta_empresa`: quem a pôs aqui. Nunca diz nada da outra empresa. */
  origem: OrigemDoDono | null;
  /** O token desta empresa alcança a Página agora? */
  alcancada: boolean;
}

/** A resposta de GET /api/v1/leads-da-meta/paginas/escolha. */
export interface EscolhaDasPaginas {
  /** Quem escolhe as Páginas desta empresa. */
  modo: "conta_propria" | "plataforma" | "indefinido";
  /** Só no modo `plataforma`: por que a empresa não escolhe. */
  motivo: "sem_conexao_propria" | "conta_da_plataforma" | null;
  /** A Meta recusou (ou não respondeu) a leitura: a frase sai deste código. */
  erro: { falha: string; detalhe: string } | null;
  paginas: PaginaParaEscolher[];
}

export interface DonoDaPagina {
  page_id: string;
  organization_id: string;
  origem: OrigemDoDono | null;
  page_name: string | null;
}

const ORDEM_DO_ESTADO: Record<EstadoNaEscolha, number> = {
  desta_empresa: 0,
  livre: 1,
  de_outra_empresa: 2,
};

/**
 * A lista da escolha, pura: as Páginas que o token da empresa alcança, cada
 * uma com o estado dela, mais as Páginas da empresa que o token não alcança
 * (para ela poder soltar). Da outra empresa, só o fato de ter dono.
 */
export function montarEscolha(
  organizationId: string,
  alcancadas: readonly Pick<PaginaDoToken, "id" | "nome">[],
  donos: readonly DonoDaPagina[],
): PaginaParaEscolher[] {
  const donoDe = new Map(donos.map((d) => [d.page_id, d]));
  const lista: PaginaParaEscolher[] = [];
  const vistas = new Set<string>();

  for (const p of alcancadas) {
    if (vistas.has(p.id)) continue;
    vistas.add(p.id);
    const dono = donoDe.get(p.id);
    if (!dono) {
      lista.push({ id: p.id, nome: p.nome, estado: "livre", origem: null, alcancada: true });
    } else if (dono.organization_id === organizationId) {
      lista.push({
        id: p.id,
        nome: p.nome,
        estado: "desta_empresa",
        origem: dono.origem ?? "plataforma",
        alcancada: true,
      });
    } else {
      lista.push({
        id: p.id,
        nome: p.nome,
        estado: "de_outra_empresa",
        origem: null,
        alcancada: true,
      });
    }
  }

  for (const d of donos) {
    if (d.organization_id !== organizationId || vistas.has(d.page_id)) continue;
    vistas.add(d.page_id);
    lista.push({
      id: d.page_id,
      nome: d.page_name ?? d.page_id,
      estado: "desta_empresa",
      origem: d.origem ?? "plataforma",
      alcancada: false,
    });
  }

  return lista.sort(
    (a, b) =>
      ORDEM_DO_ESTADO[a.estado] - ORDEM_DO_ESTADO[b.estado] ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  );
}

/**
 * Os donos que importam para a escolha: das Páginas que o token alcança (de
 * qualquer empresa, pelo service role) e todas as desta empresa. Lança se a
 * leitura falhar: ninguém escolhe no escuro.
 */
export async function donosParaAEscolha(
  admin: SupabaseClient,
  organizationId: string,
  idsAlcancados: readonly string[],
): Promise<DonoDaPagina[]> {
  const colunas = "page_id, organization_id, origem, page_name";
  const [daEmpresa, alcancados] = await Promise.all([
    admin.from("mia_paginas_da_meta").select(colunas).eq("organization_id", organizationId),
    idsAlcancados.length > 0
      ? admin
          .from("mia_paginas_da_meta")
          .select(colunas)
          .in("page_id", [...idsAlcancados])
      : Promise.resolve({ data: [], error: null }),
  ]);
  const erro = daEmpresa.error ?? alcancados.error;
  if (erro) throw new Error(`leitura dos donos das Páginas falhou: ${erro.message}`);
  return [
    ...((daEmpresa.data ?? []) as DonoDaPagina[]),
    ...((alcancados.data ?? []) as DonoDaPagina[]),
  ];
}
