/**
 * O CATÁLOGO DAS OPERAÇÕES DE PLATAFORMA — e o raio de cada uma (item E6).
 *
 * ── O problema que este arquivo resolve antes de existir código ───────────
 *
 * O MCP de hoje é POR ORGANIZAÇÃO: o token carrega um `organizationId` e um
 * papel, e todo erro dele acontece dentro de um cliente. Um token de
 * PLATAFORMA erra em todos — e mora num arquivo de configuração que qualquer
 * sessão carrega.
 *
 * A resposta não é "não fazer": implantar cliente hoje é tela por tela, e o que
 * se repete em toda implantação é sempre a mesma meia dúzia de atos. A resposta
 * é que ESCREVER seja nomeado, um ato por vez, e que LER seja livre.
 *
 * ── Por que no código, e não numa tabela ──────────────────────────────────
 *
 * Mesma razão do catálogo de módulos e do de navegação: o que uma operação FAZ
 * muda junto com o código que a executa. Uma tabela de catálogo envelheceria em
 * silêncio, e o sintoma seria um token autorizado a uma operação que já não é
 * mais aquela.
 */

/** Uma escrita que um token de plataforma pode receber, nominalmente. */
export interface OperacaoDePlataforma {
  /** O que vai gravado em `platform_api_tokens.operacoes`. */
  chave: string;
  /** Como aparece na tela de quem concede. */
  rotulo: string;
  /**
   * O ESTRAGO possível, em uma frase, escrito para quem vai marcar a caixinha.
   *
   * Não é a descrição da funcionalidade: é a resposta para "e se este token
   * vazar?". Quem concede acesso precisa ler isso, não "cria uma organização".
   */
  raio: string;
}

export const OPERACOES: readonly OperacaoDePlataforma[] = [
  {
    chave: "criar_cliente",
    rotulo: "Criar organização",
    raio:
      "Cria clientes novos na instalação. Um token vazado enche a lista de " +
      "organizações — e cada uma nasce com o dono que ele indicar.",
  },
  {
    chave: "liberar_modulo",
    rotulo: "Liberar ou tirar módulo",
    raio:
      "Liga e desliga módulo vendido em QUALQUER cliente. Desligar tira a tela " +
      "de quem pagou; ligar entrega o que não foi contratado.",
  },
  {
    chave: "lancar_credito",
    rotulo: "Lançar crédito na carteira",
    raio:
      "Põe e tira saldo de disparo de qualquer cliente. É dinheiro: crédito " +
      "lançado por engano vira mensagem enviada que ninguém pagou.",
  },
  {
    chave: "definir_preco",
    rotulo: "Definir preço por mensagem",
    raio:
      "Muda quanto cada mensagem custa ao cliente. Um valor errado aqui não " +
      "quebra nada na hora — aparece na fatura do mês, já cobrado.",
  },
  // ⚠️ `convidar_pessoa` NÃO está aqui, e a ausência é deliberada. Ela daria
  // acesso às conversas de um cliente a um e-mail qualquer: é a operação que
  // entrega dado de TERCEIRO, e a mais difícil de desfazer. Entra quando o
  // fluxo de convite for atravessado com o mesmo cuidado que a tela tem hoje
  // (papel, expiração, aviso ao dono) — não como um atalho a mais nesta lista.
] as const;

const POR_CHAVE = new Map(OPERACOES.map((o) => [o.chave, o]));

export function operacaoPorChave(chave: string): OperacaoDePlataforma | null {
  return POR_CHAVE.get(chave) ?? null;
}

/**
 * Este token pode executar esta escrita?
 *
 * ⚠️ Lista BRANCA, e sem caso especial de "tudo". Um `if (operacoes.includes
 * ("*"))` aqui seria o atalho que todo mundo usa no primeiro token, e a partir
 * dele a lista deixaria de significar coisa alguma.
 *
 * Operação desconhecida devolve `false`: um token que carrega uma chave que o
 * código não reconhece mais (renomeada, removida) não herda permissão por
 * dúvida.
 */
export function podeExecutar(operacoes: readonly string[], chave: string): boolean {
  if (!POR_CHAVE.has(chave)) return false;
  return operacoes.includes(chave);
}

/** As chaves que o código conhece — para a tela oferecer e o schema validar. */
export const CHAVES_DE_OPERACAO: readonly string[] = OPERACOES.map((o) => o.chave);
