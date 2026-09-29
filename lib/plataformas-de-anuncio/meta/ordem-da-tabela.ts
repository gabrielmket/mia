/**
 * FORK MIA — ORDENAR E FILTRAR A TABELA DE CAMPANHAS DA META, sem rede e sem tela.
 *
 * A tabela (`app/app/ads/meta/_components/TabelaDeCampanhas.tsx`) é do upstream.
 * A regra de ordem e de filtro mora AQUI, num arquivo nosso e puro, pelo mesmo
 * motivo que `tabela-de-campanhas.ts` é puro: o que pode errar em silêncio
 * (ordenar "R$ 1.000,00" como texto, jogar o "—" para o topo) tem de estar onde
 * um teste unitário alcança sem renderizar nada. O componente só liga os fios.
 *
 * ─── As três regras que a tela promete ─────────────────────────────────────
 *
 * 1. **Número é número.** Dinheiro, porcentagem e contagem já chegam como
 *    `number` em `LinhaDeCampanha` (a formatação "R$"/"%" é só da célula). Por
 *    isso a ordem compara o valor cru: 9 vem antes de 10, e R$ 1.000 depois de
 *    R$ 999 — que é exatamente o que a comparação de TEXTO erraria.
 * 2. **Texto é alfabético, na língua de quem lê.** `Intl.Collator` com
 *    `sensitivity: "base"` e `numeric: true`: "Árvore" junto de "arvore", e
 *    "Campanha 2" antes de "Campanha 10".
 * 3. **"—" vai sempre para o fim**, nas duas direções. Campanha que não
 *    veiculou tem métrica AUSENTE, não zero; se o ausente subisse no
 *    "menor → maior", a primeira tela seria uma coluna inteira de traços e o
 *    número que interessa ficaria escondido embaixo.
 *
 * O desempate é a ordem que a plataforma devolveu (a ordenação é estável), que
 * já põe quem gastou antes de quem não veiculou.
 */
import type { LinhaDeCampanha } from "../types";

/** As 15 colunas da tabela, na ordem em que aparecem. */
export const COLUNAS_DA_TABELA = [
  "nome",
  "status",
  "veiculacao",
  "resultado",
  "custoPorResultado",
  "gasto",
  "impressoes",
  "alcance",
  "cpm",
  "ctr",
  "connectRate",
  "frequencia",
  "cpc",
  "hookRate",
  "thruPlays",
] as const;

export type ColunaDaTabela = (typeof COLUNAS_DA_TABELA)[number];

/** `desc` = maior → menor (Z → A no texto); `asc` = menor → maior (A → Z). */
export type Direcao = "asc" | "desc";

export interface OrdemDaTabela {
  coluna: ColunaDaTabela;
  direcao: Direcao;
}

const COLUNAS_DE_TEXTO: ReadonlySet<ColunaDaTabela> = new Set(["nome", "status", "veiculacao"]);

export function colunaDeTexto(coluna: ColunaDaTabela): boolean {
  return COLUNAS_DE_TEXTO.has(coluna);
}

/**
 * O primeiro clique numa coluna.
 *
 * Número começa do MAIOR: a pergunta que traz alguém a esta tela é "quem gastou
 * mais", "quem trouxe mais resultado" — e o custo alto é o que se quer caçar.
 * Texto começa do A, que é como qualquer lista de nomes se lê.
 */
export function direcaoInicial(coluna: ColunaDaTabela): Direcao {
  return colunaDeTexto(coluna) ? "asc" : "desc";
}

/**
 * O clique no cabeçalho: coluna nova começa na direção dela; a mesma coluna
 * alterna entre as duas direções. Não há terceiro estado "sem ordem" no clique
 * — voltar à ordem da plataforma é um botão à parte, visível só quando há ordem.
 */
export function proximaOrdem(atual: OrdemDaTabela | null, coluna: ColunaDaTabela): OrdemDaTabela {
  if (!atual || atual.coluna !== coluna) return { coluna, direcao: direcaoInicial(coluna) };
  return { coluna, direcao: atual.direcao === "desc" ? "asc" : "desc" };
}

/**
 * O valor que a coluna compara. Status e veiculação comparam o TEXTO que a tela
 * mostra ("Ativa", "Pausada"), não o código da plataforma (`ACTIVE`, `PAUSED`):
 * ordenar pelo código daria uma ordem que ninguém que lê a coluna reconhece.
 */
export function valorDaColuna(
  linha: LinhaDeCampanha,
  coluna: ColunaDaTabela,
  textoDoEstado: (codigo: string) => string = (codigo) => codigo,
): number | string | null {
  switch (coluna) {
    case "nome":
      return linha.nome;
    case "status":
      return linha.status ? textoDoEstado(linha.status) : null;
    case "veiculacao":
      return linha.veiculacao ? textoDoEstado(linha.veiculacao) : null;
    case "resultado":
      return linha.resultado.valor;
    case "custoPorResultado":
      return linha.resultado.custoPorResultado;
    default:
      return linha[coluna];
  }
}

function ausente(valor: number | string | null): boolean {
  if (valor === null) return true;
  if (typeof valor === "number") return !Number.isFinite(valor);
  return valor.trim() === "";
}

export interface OpcoesDeOrdem {
  /** Código de estado da plataforma → texto da tela (o mesmo que a célula mostra). */
  textoDoEstado?: (codigo: string) => string;
  /** Tag BCP 47 de quem lê (`pt-BR`, `es`), para a ordem alfabética. */
  idioma?: string;
}

/**
 * Devolve uma CÓPIA ordenada. `ordem` nulo devolve a ordem da plataforma.
 * Nunca muda o array recebido: ele é o `data` do React Query, compartilhado.
 */
export function ordenarCampanhas(
  linhas: readonly LinhaDeCampanha[],
  ordem: OrdemDaTabela | null,
  opcoes: OpcoesDeOrdem = {},
): LinhaDeCampanha[] {
  if (!ordem) return [...linhas];
  const { coluna, direcao } = ordem;
  const sinal = direcao === "asc" ? 1 : -1;
  const colador = new Intl.Collator(opcoes.idioma ?? "pt-BR", {
    sensitivity: "base",
    numeric: true,
  });

  return linhas
    .map((linha, indice) => ({
      linha,
      indice,
      valor: valorDaColuna(linha, coluna, opcoes.textoDoEstado),
    }))
    .sort((a, b) => {
      const aAusente = ausente(a.valor);
      const bAusente = ausente(b.valor);
      // O ausente vai para o fim ANTES de olhar a direção — é isso que o mantém
      // no fim também no "menor → maior".
      if (aAusente || bAusente) {
        if (aAusente && bAusente) return a.indice - b.indice;
        return aAusente ? 1 : -1;
      }
      const diferenca =
        typeof a.valor === "number" && typeof b.valor === "number"
          ? a.valor - b.valor
          : colador.compare(String(a.valor), String(b.valor));
      return diferenca !== 0 ? diferenca * sinal : a.indice - b.indice;
    })
    .map((item) => item.linha);
}

/**
 * O filtro "só o que teve impressão": impressões > 0.
 *
 * Campanha sem impressão no período é a que NÃO veiculou — as métricas dela são
 * todas "—". Útil esconder quando a conta tem dezenas de campanhas antigas; mas
 * é opcional e desligado por padrão, porque esconder por padrão faria quem
 * acabou de criar uma campanha não encontrá-la e achar que a tela quebrou.
 */
export function soQuemTeveImpressao(linhas: readonly LinhaDeCampanha[]): LinhaDeCampanha[] {
  return linhas.filter((linha) => linha.impressoes !== null && linha.impressoes > 0);
}

// ─── A preferência de cada pessoa ──────────────────────────────────────────

export interface PreferenciaDaTabela {
  ordem: OrdemDaTabela | null;
  soComImpressao: boolean;
}

export const PREFERENCIA_PADRAO: PreferenciaDaTabela = { ordem: null, soComImpressao: false };

/**
 * A chave no armazenamento do navegador. Leva o id de quem está logado: duas
 * pessoas no mesmo computador (recepção de clínica, por exemplo) não herdam a
 * ordem uma da outra.
 */
export function chaveDaPreferencia(usuarioId: string | null | undefined): string {
  return `mia:meta-ads:tabela-de-campanhas:${usuarioId || "anonimo"}`;
}

function ordemValida(valor: unknown): OrdemDaTabela | null {
  if (!valor || typeof valor !== "object") return null;
  const { coluna, direcao } = valor as Record<string, unknown>;
  if (typeof coluna !== "string" || !(COLUNAS_DA_TABELA as readonly string[]).includes(coluna)) {
    return null;
  }
  if (direcao !== "asc" && direcao !== "desc") return null;
  return { coluna: coluna as ColunaDaTabela, direcao };
}

/**
 * Lê a preferência salva. NUNCA lança: armazenamento bloqueado (aba privada),
 * JSON corrompido ou coluna que deixou de existir voltam ao padrão, e a tabela
 * abre na ordem da plataforma — nunca uma tela em branco por causa de um enfeite.
 */
export function lerPreferencia(
  armazenamento: Pick<Storage, "getItem"> | null | undefined,
  chave: string,
): PreferenciaDaTabela {
  try {
    const bruto = armazenamento?.getItem(chave);
    if (!bruto) return PREFERENCIA_PADRAO;
    const dado = JSON.parse(bruto) as Record<string, unknown>;
    return {
      ordem: ordemValida(dado.ordem),
      soComImpressao: dado.soComImpressao === true,
    };
  } catch {
    return PREFERENCIA_PADRAO;
  }
}

/** Grava a preferência. Falha de gravação é silenciosa: a escolha vale nesta visita. */
export function gravarPreferencia(
  armazenamento: Pick<Storage, "setItem"> | null | undefined,
  chave: string,
  preferencia: PreferenciaDaTabela,
): void {
  try {
    armazenamento?.setItem(chave, JSON.stringify(preferencia));
  } catch {
    // Sem armazenamento a escolha continua valendo até recarregar a página.
  }
}
