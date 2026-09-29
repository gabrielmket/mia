/**
 * O CATÁLOGO DOS MÓDULOS VENDÁVEIS — e o que cada um destrava.
 *
 * Mora no código, e não no banco, pelo mesmo motivo que o catálogo de navegação
 * mora: o que um módulo destrava é uma lista de ROTAS e TELAS, e essa lista tem
 * de mudar junto com o código que as cria. Uma tabela de catálogo ficaria
 * desatualizada no primeiro módulo que ganhasse uma tela nova, e o sintoma
 * seria a tela aparecer para quem não comprou — em silêncio.
 *
 * ⚠️ O QUE NÃO ESTÁ AQUI CONTINUA LIBERADO PARA TODOS. Este arquivo não é a
 * lista do que o produto faz; é a lista do que se VENDE separado. Acrescentar
 * uma chave aqui TIRA acesso de quem não tem liberação — nunca faça isso com
 * módulo que os clientes já usam sem contratar à parte.
 *
 * FORK MIA — este arquivo se chamava `lib/modulos/catalogo.ts` até a fusão da
 * v1.61, quando o upstream criou um arquivo com o MESMO caminho para outra
 * coisa: o catálogo dos módulos INSTALÁVEIS na instância (honorários, ADR-0002),
 * que o administrador da instalação liga uma vez para todos. Aqui é o que se
 * VENDE por organização. São perguntas diferentes, e o nosso mora ao lado do
 * dele (docs/FORK-MIA.md, regra 1). As migrations 0245 e o baseline-mia ainda
 * citam o caminho antigo nos comentários: são história, ficam como estão.
 */

import {
  CHAVE_DA_MARCA_DA_ORGANIZACAO,
  marcaDaOrganizacaoTravada,
  TELA_DA_MARCA_DA_ORGANIZACAO,
} from "@/lib/branding/marca-da-organizacao-no-fork";

export type ChaveDeModulo = "disparador";

export interface ModuloVendavel {
  chave: ChaveDeModulo;
  /** Como aparece no painel administrativo, para quem libera. */
  rotulo: string;
  /** O que o cliente ganha. Frase de venda, não descrição técnica. */
  descricao: string;
  /**
   * Prefixos de rota da API que o módulo protege. A guarda usa `startsWith`, e
   * por isso o prefixo tem de ser específico: `/api/v1/dis` pegaria rotas que
   * ninguém quis proteger.
   */
  rotas: string[];
  /**
   * Telas que somem do menu sem liberação. São os `href` do catálogo de
   * navegação — se um deles mudar lá e não aqui, a tela volta a aparecer para
   * quem não comprou, e é por isso que existe um teste amarrando os dois.
   */
  telas: string[];
}

export const MODULOS: readonly ModuloVendavel[] = [
  {
    // ⚠️ A CHAVE NÃO ACOMPANHA O NOME, e é de propósito. O produto se chamou
    // "MIA Broadcast" de 16/09 a 29/09 e agora é só "Broadcast", mas a chave
    // `disparador` já está gravada em `organization_modules` para um cliente:
    // renomeá-la deixaria a liberação órfã e tiraria o acesso de quem comprou —
    // em silêncio, que é o pior jeito. Chave é identidade interna; rótulo é o
    // nome do produto. Só o segundo muda (e já mudou duas vezes).
    chave: "disparador",
    rotulo: "Broadcast",
    descricao:
      "Enviar mensagem para uma lista de contatos pela API oficial da Meta, com crédito próprio e cobrança por mensagem.",
    // A carteira faz parte do módulo: crédito só existe para gastar aqui, e
    // mostrar saldo a quem não pode disparar seria vender por acidente.
    rotas: ["/api/v1/carteira", "/api/v1/broadcasts"],
    telas: ["/app/settings/carteira", "/app/broadcast"],
  },
] as const;

const POR_CHAVE = new Map<string, ModuloVendavel>(MODULOS.map((m) => [m.chave, m]));

export function moduloPorChave(chave: string): ModuloVendavel | null {
  return POR_CHAVE.get(chave) ?? null;
}

/**
 * Telas que dependem de uma DECISÃO DA INSTALAÇÃO, e não de venda.
 *
 * Mesmo mecanismo de menu dos módulos (a tela some de quem não tem a chave na
 * lista `modulos`), mas a chave não se compra nem se libera por empresa: quem a
 * põe na lista é `modulosDaOrganizacao`, quando a instalação libera. Fora de
 * `MODULOS` de propósito — o painel de liberação não pode oferecer um botão que
 * não muda nada.
 *
 * Hoje: a marca por empresa, travada na MIA
 * (`lib/branding/marca-da-organizacao-no-fork.ts`).
 */
export const TELAS_DA_INSTALACAO: Readonly<Record<string, typeof CHAVE_DA_MARCA_DA_ORGANIZACAO>> = {
  [TELA_DA_MARCA_DA_ORGANIZACAO]: CHAVE_DA_MARCA_DA_ORGANIZACAO,
};

/** As chaves que a instalação libera agora — entram na lista `modulos` do menu. */
export function liberacoesDaInstalacao(): string[] {
  return marcaDaOrganizacaoTravada() ? [] : [CHAVE_DA_MARCA_DA_ORGANIZACAO];
}

/**
 * Qual módulo protege esta tela? `null` = nenhuma — e nenhuma é o caso da
 * esmagadora maioria das telas, que continuam valendo para todo mundo.
 */
export function moduloDaTela(href: string): ChaveDeModulo | typeof CHAVE_DA_MARCA_DA_ORGANIZACAO | null {
  for (const m of MODULOS) {
    if (m.telas.includes(href)) return m.chave;
  }
  return TELAS_DA_INSTALACAO[href] ?? null;
}

/**
 * Qual módulo protege esta rota de API?
 *
 * Compara por prefixo porque uma rota tem filhos (`/api/v1/carteira/extrato`), e
 * listar cada um daria a mesma lista desatualizada que a tabela de catálogo
 * daria. O prefixo é declarado no módulo, então quem o escolhe sabe o alcance.
 */
export function moduloDaRota(caminho: string): ChaveDeModulo | null {
  for (const m of MODULOS) {
    for (const prefixo of m.rotas) {
      if (caminho === prefixo || caminho.startsWith(prefixo + "/")) return m.chave;
    }
  }
  return null;
}
