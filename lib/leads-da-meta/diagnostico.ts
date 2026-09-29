/**
 * FORK MIA — o que a tela de Formulários da Meta mostra ANTES de importar
 * qualquer coisa: o token tem as permissões? quais Páginas ele alcança? quais
 * formulários cada Página tem? E, quando algo falta, o quê exatamente.
 *
 * Nada aqui escreve. É a leitura que transforma "não funciona" em "falta
 * `leads_retrieval` no token" ou "a Página X não deu acesso a leads".
 */
import {
  PERMISSOES_OBRIGATORIAS,
  PERMISSOES_RECOMENDADAS,
  lerPermissoes,
  listarFormularios,
  listarPaginas,
  type FormularioDaPagina,
} from "@/lib/plataformas-de-anuncio/meta/leads";
import type { FalhaDeLeitura } from "@/lib/plataformas-de-anuncio/types";

/** Páginas lidas por diagnóstico. Um token de agência pode alcançar centenas. */
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
  /** Por que os formulários desta Página não vieram, quando não vieram. */
  erro: FalhaDeLeitura | "sem_token_da_pagina" | null;
  detalhe: string | null;
  formularios: FormularioDaPagina[];
}

export interface Diagnostico {
  permissoes: DiagnosticoDePermissoes;
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

export async function diagnosticar(token: string): Promise<Diagnostico> {
  const [permissoes, paginas] = await Promise.all([lerPermissoes(token), listarPaginas(token)]);

  const diagnosticoDePermissoes: DiagnosticoDePermissoes = permissoes.ok
    ? { verificadas: true, ...permissoesQueFaltam(permissoes.dados) }
    : { verificadas: false, faltandoObrigatorias: [], faltandoRecomendadas: [] };

  if (!paginas.ok) {
    return {
      permissoes: diagnosticoDePermissoes,
      erro: { falha: paginas.falha, detalhe: paginas.detalhe },
      paginas: [],
      paginasCortadas: false,
    };
  }

  const alvo = paginas.dados.slice(0, MAXIMO_DE_PAGINAS);
  const lidas = await Promise.all(
    alvo.map(async (pagina): Promise<PaginaDiagnosticada> => {
      if (!pagina.tokenDaPagina) {
        return {
          id: pagina.id,
          nome: pagina.nome,
          erro: "sem_token_da_pagina",
          detalhe: null,
          formularios: [],
        };
      }
      const forms = await listarFormularios(pagina.tokenDaPagina, pagina.id);
      if (!forms.ok) {
        return {
          id: pagina.id,
          nome: pagina.nome,
          erro: forms.falha,
          detalhe: forms.detalhe,
          formularios: [],
        };
      }
      return {
        id: pagina.id,
        nome: pagina.nome,
        erro: null,
        detalhe: null,
        formularios: forms.dados,
      };
    }),
  );

  return {
    permissoes: diagnosticoDePermissoes,
    erro: null,
    paginas: lidas,
    paginasCortadas: paginas.dados.length > alvo.length,
  };
}
