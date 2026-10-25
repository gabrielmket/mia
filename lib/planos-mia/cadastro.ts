/**
 * FORK MIA (.90) — os planos do CADASTRO em cartões, e o "?plano=" da página.
 *
 * O upstream já escolhe plano no cadastro (v1.84): um seletor com nome, preço e
 * teste, marcado no padrão (`lib/cobranca/cadastro.ts`). Aqui só se ACRESCENTA
 * o que a pessoa precisa para escolher: limites, módulos e "cerca de N
 * conversas" — nunca o teto em dólar — e o plano que veio marcado do link da
 * página de preços. Quem decide o que vale continua sendo o upstream: a lista
 * é a dele (os oferecidos), a recusa é da action e, por baixo, do gatilho 0679.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PlanoDoCadastro } from "@/lib/cobranca/cadastro";

import { conversasEstimadas, type ModuloDoPlano } from "./catalogo";
import { lerPlanosComModulos, planoDoLink, type PlanoComModulos } from "./leitura";

export interface CartaoDoPlano {
  id: string;
  nome: string;
  frase: string | null;
  destaque: boolean;
  padrao: boolean;
  preco_cents: number;
  intervalo: string;
  trial_dias: number;
  pessoas: number | null;
  numeros: number | null;
  conversas: number | null;
  modulos: ModuloDoPlano[];
}

export function cartaoDe(p: PlanoComModulos): CartaoDoPlano {
  return {
    id: p.id,
    nome: p.nome,
    frase: p.frase,
    destaque: p.destaque,
    padrao: p.padrao_no_cadastro,
    preco_cents: p.preco_cents,
    intervalo: p.intervalo,
    trial_dias: p.trial_dias,
    pessoas: p.max_assentos,
    numeros: p.max_canais,
    conversas: conversasEstimadas(p.teto_ia_usd_cents),
    modulos: p.modulos,
  };
}

export interface CadastroEmCartoes {
  cartoes: CartaoDoPlano[];
  /** O plano que vem marcado: o do link, se ele é oferecido; senão o do upstream. */
  planoMarcado: string | undefined;
  /** O link trouxe um plano que não está mais à venda (a tela avisa e marca o padrão). */
  linkSemPlano: boolean;
}

/**
 * Os cartões dos planos que o upstream oferece no cadastro, na ordem dele.
 * Leitura que falha devolve nenhum cartão: a tela cai no seletor do upstream,
 * que continua funcionando (é ele que a action confere).
 */
export async function lerCadastroEmCartoes(
  admin: SupabaseClient,
  oferecidos: readonly PlanoDoCadastro[],
  planoInicialDoUpstream: string | undefined,
  planoDoLinkPedido: string | null | undefined,
): Promise<CadastroEmCartoes> {
  if (oferecidos.length === 0)
    return { cartoes: [], planoMarcado: planoInicialDoUpstream, linkSemPlano: false };
  let planos: PlanoComModulos[];
  try {
    planos = await lerPlanosComModulos(admin);
  } catch {
    return { cartoes: [], planoMarcado: planoInicialDoUpstream, linkSemPlano: false };
  }
  const porId = new Map(planos.map((p) => [p.id, p]));
  const cartoes = oferecidos.flatMap((o) => {
    const p = porId.get(o.id);
    return p ? [cartaoDe(p)] : [];
  });
  const doLink = planoDoLink(planos, planoDoLinkPedido);
  const valeOLink = doLink !== null && cartoes.some((c) => c.id === doLink.id);
  return {
    cartoes,
    planoMarcado: valeOLink ? doLink.id : planoInicialDoUpstream,
    linkSemPlano: Boolean(planoDoLinkPedido) && !valeOLink,
  };
}
