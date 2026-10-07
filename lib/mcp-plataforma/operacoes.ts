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

// As operações das ferramentas de importação (docs/fork/mcp-de-migracao.md).
// O import vem de `./importacao/operacoes`, e não do índice da pasta, para a
// tela dos tokens não puxar os handlers junto.
import { OPERACOES_DE_IMPORTACAO } from "./importacao/operacoes";

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
  // ── IMPLANTAÇÃO DE CLIENTE (docs/fork/mcp-de-implantacao.md) ─────────────
  //
  // Três chaves, cortadas pelo TAMANHO DO ESTRAGO e não pela área do produto:
  // montar (não fala com ninguém de fora), pôr no ar (passa a falar com o
  // cliente final) e convidar (dá acesso às conversas a um e-mail). Um token de
  // quem só monta não consegue fazer nada conversar com cliente; quem publica é
  // outra caixinha, que pode ir num segundo token ou ficar com uma pessoa.
  {
    chave: "implantar_configuracao",
    rotulo: "Montar a configuração de um cliente",
    raio:
      "Grava dados da empresa, funis e etapas, catálogo e preços, etiquetas, memória, " +
      "conhecimento, agenda, respostas prontas, as regras de conversão DESLIGADAS, o " +
      "roteador de intenção DESLIGADO e os RASCUNHOS de agente, follow-up e " +
      "automação de QUALQUER cliente. Não publica nada, mas atenção: o agente que já " +
      "está no ar lê o catálogo, a memória e o conhecimento na hora. Um preço errado " +
      "gravado por este token vira preço errado dito ao cliente final. Também valem na " +
      "hora a distribuição do atendimento, o nome de quem fala na mensagem, a janela de " +
      "esfriando das etapas e o limiar de sentimento do agente (que decide quando a " +
      "conversa passa para uma pessoa).",
  },
  {
    chave: "colocar_no_ar",
    rotulo: "Pôr no ar o que fala com o cliente final",
    raio:
      "Publica e pausa agente de IA, publica follow-up, liga automação, liga lembrete de " +
      "agenda e submete modelo de mensagem à Meta em QUALQUER cliente. É a operação que faz o sistema começar a " +
      "mandar mensagem para os clientes do cliente: um token vazado põe no ar um agente " +
      "com o texto que ele quiser, falando em nome da empresa. Também liga as regras de " +
      "conversão por etapa e a volta dos leads de formulário: o sistema passa a mandar " +
      "evento com dado dos clientes do cliente para a Meta e o Google Ads. E liga o " +
      "roteador de intenção, que passa a escolher o agente a cada mensagem do número e " +
      "a mover o negócio do cliente para o funil de destino da intenção.",
  },
  {
    chave: "convidar_equipe",
    rotulo: "Convidar pessoas para a equipe de um cliente",
    raio:
      "Manda e-mail de convite, com o papel que o token escolher, para entrar na empresa " +
      "de QUALQUER cliente. Quem aceita passa a ler as conversas e os dados dos clientes " +
      "daquela empresa. É a operação que entrega dado de terceiro, e a mais difícil de " +
      "desfazer: um token vazado convida um e-mail de fora como administrador.",
  },
  // O fluxo de convite que justificava a ausência desta operação foi atravessado
  // com o cuidado que a tela tem: papel conferido, expiração do convite e linha em
  // `team_invites` (que a tela lista e revoga), gravada antes de o e-mail sair.
  // Desde a 9020 o convite funciona também na empresa de demonstração. Ver
  // `lib/implantacao/equipe.ts`.
  ...OPERACOES_DE_IMPORTACAO,
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
