/**
 * O CHECKLIST DA IMPLANTAÇÃO — a forma de uma ÁREA.
 *
 * `plataforma_ver_implantacao` não conhece área nenhuma: ele percorre a lista
 * `AREAS_DO_CHECKLIST` (`./areas.ts`) e junta o que cada uma responde. Uma área
 * nova (contatos importados, por exemplo) entra acrescentando UMA linha naquela
 * lista, sem tocar em quem monta o checklist.
 *
 * Cada área responde três perguntas, e só três:
 *
 *   pronto        o que já está de pé, em frases com número
 *   falta         o que o AGENTE implantador ainda pode fazer, com a
 *                 ferramenta que resolve
 *   so_pela_tela  o que só uma PESSOA faz, com o caminho da tela e o porquê
 */
import type { OrganizacaoDaImplantacao } from "@/lib/implantacao/base";

import type { ContextoDaFerramenta } from "../tipos";

/** Algo que o agente implantador resolve chamando uma ferramenta. */
export interface Pendencia {
  o_que: string;
  /** A ferramenta (e o parâmetro que importa) que resolve. */
  como: string;
}

/** Algo que só uma pessoa faz, pela tela. */
export interface PelaTela {
  o_que: string;
  /** `pendente` trava a implantação; `opcional` é escolha do cliente; `feito` já está de pé. */
  situacao: "pendente" | "opcional" | "feito";
  /** O nome da tela, como aparece no menu. */
  tela: string;
  /** O endereço da tela dentro do produto. */
  caminho: string;
  /** Quem faz: alguém da empresa do cliente, ou quem opera a plataforma. */
  quem: "cliente" | "plataforma";
  por_que: string;
}

export interface ResultadoDaArea {
  pronto: string[];
  falta: Pendencia[];
  so_pela_tela: PelaTela[];
  /** Os números crus, para o agente decidir sem reler texto. */
  dados?: Record<string, unknown>;
}

export interface AreaDoChecklist {
  /** Identificador estável da área (ex.: "funis"). */
  chave: string;
  titulo: string;
  avaliar: (ctx: ContextoDaFerramenta, org: OrganizacaoDaImplantacao) => Promise<ResultadoDaArea>;
}
