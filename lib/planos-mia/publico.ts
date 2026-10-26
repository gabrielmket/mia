/**
 * FORK MIA (.90) — O QUE A PÁGINA DE PREÇOS PODE SABER DOS PLANOS.
 *
 * Leitura PÚBLICA (sem sessão), então mora aqui a régua do que sai:
 *   - só os planos OFERECIDOS (ativos e visíveis às empresas): o plano escondido
 *     ("MIA com implantação", o negociado) não aparece;
 *   - com a cobrança desligada, nenhum plano (a página diz "em breve");
 *   - o teto de IA em dólar NUNCA sai: vira "cerca de N conversas"
 *     (`conversasEstimadas`), porque o cliente compra atendimento, não tokens
 *     (`lib/ai/custo-e-da-plataforma.ts`);
 *   - nenhum id de quem editou, nenhuma data de arquivamento, nada de assinante.
 * O mesmo objeto alimenta a página `/precos` e a rota `GET /api/v1/publico/planos`,
 * para o site da iamia poder ler o mesmo que a página mostra.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { moduloLigado } from "@/lib/instalacao/modulos";

import { conversasEstimadas, ROTULO_DO_MODULO_DO_PLANO, type ModuloDoPlano } from "./catalogo";
import { lerPlanosComModulos, planosOferecidos, type PlanoComModulos } from "./leitura";

export interface ModuloPublico {
  chave: ModuloDoPlano;
  nome: string;
  descricao: string;
}

export interface PlanoPublico {
  id: string;
  /** O "?plano=" do cadastro. */
  slug: string;
  nome: string;
  frase: string | null;
  destaque: boolean;
  /** É o plano que o cadastro marca sem escolha (o padrão do upstream). */
  padrao: boolean;
  preco_cents: number;
  intervalo: string;
  /** 0 = entrada paga (a empresa começa quando o primeiro pagamento confirma). */
  trial_dias: number;
  /** `null` = sem limite. */
  pessoas: number | null;
  numeros: number | null;
  /** "Cerca de N conversas atendidas pela IA por mês". `null` = sem limite. */
  conversas_estimadas: number | null;
  modulos: ModuloPublico[];
  /** Só quando o plano tem Broadcast. Em centavos. */
  preco_por_mensagem_cents: number | null;
  /** O caminho do cadastro com o plano marcado (relativo ao endereço do sistema). */
  cadastro: string;
}

/** A projeção pública de um plano (pura; exportada para os testes da régua). */
export function planoPublico(p: PlanoComModulos): PlanoPublico {
  return {
    id: p.id,
    slug: p.slug,
    nome: p.nome,
    frase: p.frase,
    destaque: p.destaque,
    padrao: p.padrao_no_cadastro,
    preco_cents: p.preco_cents,
    intervalo: p.intervalo,
    trial_dias: p.trial_dias,
    pessoas: p.max_assentos,
    numeros: p.max_canais,
    conversas_estimadas: conversasEstimadas(p.teto_ia_usd_cents),
    modulos: p.modulos.map((m) => ({
      chave: m,
      nome: ROTULO_DO_MODULO_DO_PLANO[m].rotulo,
      descricao: ROTULO_DO_MODULO_DO_PLANO[m].descricao,
    })),
    preco_por_mensagem_cents: p.modulos.includes("disparador") ? p.preco_por_mensagem_cents : null,
    cadastro: `/signup?plano=${encodeURIComponent(p.slug || p.id)}`,
  };
}

export interface PlanosPublicos {
  /** A cobrança está ligada nesta instalação (sem ela, a lista vem vazia). */
  disponivel: boolean;
  planos: PlanoPublico[];
}

/**
 * Os planos à venda, do mais barato ao mais caro. LANÇA se a leitura falhar
 * (a rota responde 503; a página mostra "tente de novo"), porque "nenhum plano"
 * de um banco que não respondeu seria uma página de preços vazia por engano.
 */
export async function lerPlanosPublicos(admin: SupabaseClient): Promise<PlanosPublicos> {
  if (!(await moduloLigado(admin, "cobranca"))) return { disponivel: false, planos: [] };
  const planos = planosOferecidos(await lerPlanosComModulos(admin));
  return { disponivel: true, planos: planos.map(planoPublico) };
}
