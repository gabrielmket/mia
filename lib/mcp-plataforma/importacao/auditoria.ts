/**
 * O que vai para a auditoria quando uma ferramenta de importação roda.
 *
 * ── O problema ────────────────────────────────────────────────────────────
 *
 * O servidor do MCP de plataforma grava os ARGUMENTOS de toda escrita na linha
 * `plataforma.mcp_executado`, e faz isso de propósito: "lançou crédito" sem
 * dizer em quem nem quanto não serve a quem audita. Para as ferramentas daqui,
 * os argumentos são a lista de pessoas de um cliente. Gravá-los faria a trilha
 * de auditoria da plataforma virar uma segunda cópia da base de contatos de
 * cada cliente migrado, fora do controle de acesso da organização e fora do
 * alcance da anonimização (LGPD).
 *
 * ── A saída ───────────────────────────────────────────────────────────────
 *
 * Lista BRANCA, e não lista negra: só passam os argumentos que a ferramenta
 * declara como seguros (o id da organização, a origem, o modo). Todo o resto
 * vira contagem ou some. Um argumento novo, criado amanhã, nasce FORA da
 * auditoria até alguém decidir que ele pode entrar: o esquecimento falha para
 * o lado que não vaza.
 */
import type { FerramentaDeImportacao, FerramentaDePlataforma } from "./tipos";

/**
 * Os argumentos como a auditoria os guarda. Ferramenta sem redação declarada
 * (as de administração: criar cliente, lançar crédito) segue gravando tudo.
 */
export function argumentosParaAuditoria(
  ferramenta: FerramentaDePlataforma,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const redigir = (ferramenta as Partial<FerramentaDeImportacao>).redigirParaAuditoria;
  return typeof redigir === "function" ? redigir(args) : args;
}

/**
 * A redação padrão de uma ferramenta de lote.
 *
 * `seguros` são os argumentos que entram como vieram. `listas` são os que
 * entram como contagem. O que não está em nenhum dos dois não entra.
 */
export function redigirLote(
  seguros: readonly string[],
  listas: readonly string[],
): (args: Record<string, unknown>) => Record<string, unknown> {
  return (args) => {
    const saida: Record<string, unknown> = {};
    for (const chave of seguros) {
      const valor = args[chave];
      // Só escalar curto. Um objeto num argumento "seguro" seria a porta dos
      // fundos por onde o dado pessoal voltaria a entrar.
      if (typeof valor === "string") saida[chave] = valor.slice(0, 200);
      else if (typeof valor === "number" || typeof valor === "boolean") saida[chave] = valor;
    }
    for (const chave of listas) {
      const valor = args[chave];
      saida[chave] = { itens: Array.isArray(valor) ? valor.length : 0 };
    }
    return saida;
  };
}
