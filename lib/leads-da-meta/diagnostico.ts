/**
 * FORK MIA — o que a tela de Formulários da Meta mostra ANTES de importar
 * qualquer coisa: o token tem as permissões? quais Páginas DA EMPRESA ele
 * alcança? quais formulários cada uma tem? E, quando algo falta, o quê exatamente.
 *
 * Nada aqui escreve. É a leitura que transforma "não funciona" em "falta
 * `leads_retrieval` no token" ou "a Página X não deu acesso a leads".
 *
 * .61: a lista é a das Páginas atribuídas à empresa (`paginas.ts`, migration
 * 9004), nunca a do token. O token da agência alcança Páginas de vários
 * clientes, e a .60 mostrava todas a todos.
 */
import {
  PERMISSOES_OBRIGATORIAS,
  PERMISSOES_RECOMENDADAS,
  lerPermissoes,
  listarFormularios,
  type FormularioDaPagina,
} from "@/lib/plataformas-de-anuncio/meta/leads";
import type { FalhaDeLeitura } from "@/lib/plataformas-de-anuncio/types";

import type { AcessoAsPaginas, OrigemDoAcesso, PaginaAtribuida } from "./paginas";

/** Páginas lidas por diagnóstico. Uma empresa tem poucas; o teto protege a cota da Meta. */
const MAXIMO_DE_PAGINAS = 30;

export interface DiagnosticoDePermissoes {
  /** A Meta respondeu `me/permissions`? Sem isso, a falta não foi medida. */
  verificadas: boolean;
  faltandoObrigatorias: string[];
  faltandoRecomendadas: string[];
}

export interface PaginaDiagnosticada {
  id: string;
  nome: string;
  /** Qual token alcançou a Página. `null` = nenhum. */
  origem: OrigemDoAcesso | null;
  /**
   * Por que os formulários desta Página não vieram, quando não vieram.
   * `pagina_nao_atribuida`: a Página é da empresa, mas nenhum token a alcança
   * (falta atribuí-la ao usuário do sistema no Gerenciador de Negócios).
   */
  erro: FalhaDeLeitura | "sem_token_da_pagina" | "pagina_nao_atribuida" | null;
  detalhe: string | null;
  formularios: FormularioDaPagina[];
}

export interface Diagnostico {
  permissoes: DiagnosticoDePermissoes;
  /**
   * De quem é o token cujas permissões aparecem: o da própria empresa ou o da
   * plataforma. Muda o que a tela manda fazer quando falta permissão.
   */
  origem: OrigemDoAcesso | null;
  /** Falha ao listar as Páginas (o token inteiro foi recusado, por exemplo). */
  erro: { falha: FalhaDeLeitura; detalhe: string } | null;
  paginas: PaginaDiagnosticada[];
  /** Havia mais Páginas do que o diagnóstico lê de uma vez. */
  paginasCortadas: boolean;
}

/** As permissões que faltam, dado o que a Meta diz que foi concedido. Pura. */
export function permissoesQueFaltam(
  concedidas: readonly string[],
): Omit<DiagnosticoDePermissoes, "verificadas"> {
  const tem = new Set(concedidas);
  return {
    faltandoObrigatorias: PERMISSOES_OBRIGATORIAS.filter((p) => !tem.has(p)),
    faltandoRecomendadas: PERMISSOES_RECOMENDADAS.filter((p) => !tem.has(p)),
  };
}

/** O diagnóstico de uma empresa sem Página atribuída: nada a perguntar à Meta. */
export const DIAGNOSTICO_SEM_PAGINAS: Diagnostico = {
  permissoes: { verificadas: false, faltandoObrigatorias: [], faltandoRecomendadas: [] },
  origem: null,
  erro: null,
  paginas: [],
  paginasCortadas: false,
};

export async function diagnosticar(
  atribuidas: readonly PaginaAtribuida[],
  acesso: Extract<AcessoAsPaginas, { ok: true }>,
): Promise<Diagnostico> {
  const { token, origem } = acesso.tokenDasPermissoes;
  const permissoes = await lerPermissoes(token);
  const diagnosticoDePermissoes: DiagnosticoDePermissoes = permissoes.ok
    ? { verificadas: true, ...permissoesQueFaltam(permissoes.dados) }
    : { verificadas: false, faltandoObrigatorias: [], faltandoRecomendadas: [] };

  const alvo = atribuidas.slice(0, MAXIMO_DE_PAGINAS);
  const lidas = await Promise.all(
    alvo.map(async (atribuida): Promise<PaginaDiagnosticada> => {
      const pagina = acesso.paginas.get(atribuida.page_id);
      const nome = pagina?.nome ?? atribuida.page_name ?? atribuida.page_id;
      if (!pagina) {
        return {
          id: atribuida.page_id,
          nome,
          origem: null,
          erro: "pagina_nao_atribuida",
          detalhe: null,
          formularios: [],
        };
      }
      if (!pagina.tokenDaPagina) {
        return {
          id: pagina.id,
          nome,
          origem: pagina.origem,
          erro: "sem_token_da_pagina",
          detalhe: null,
          formularios: [],
        };
      }
      const forms = await listarFormularios(pagina.tokenDaPagina, pagina.id);
      if (!forms.ok) {
        return {
          id: pagina.id,
          nome,
          origem: pagina.origem,
          erro: forms.falha,
          detalhe: forms.detalhe,
          formularios: [],
        };
      }
      return {
        id: pagina.id,
        nome,
        origem: pagina.origem,
        erro: null,
        detalhe: null,
        formularios: forms.dados,
      };
    }),
  );

  return {
    permissoes: diagnosticoDePermissoes,
    origem,
    // Nenhuma Página achada E uma listagem recusada: a recusa é a explicação.
    erro: acesso.paginas.size === 0 ? acesso.falhaParcial : null,
    paginas: lidas,
    paginasCortadas: atribuidas.length > alvo.length,
  };
}
