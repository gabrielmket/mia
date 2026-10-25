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
      "conversa passa para uma pessoa). Também valem na hora: o bloqueio de afirmação " +
      "clínica de todos os agentes, o freio do passo \"a IA decide\" das automações, a " +
      "limpeza automática de mídia antiga (ligada, apaga mídia velha sem volta), os " +
      "planos de tarefa, as perguntas e a autorização de IA de uma fonte de formulário, a " +
      "coluna do cliente no banco externo, os dias da prospecção e guardar o histórico " +
      "de um número; e a pausa agendada, que cala um número (ou todos) por até 24 horas. " +
      "E os relatórios e o painel do segmento (montador de relatórios), compartilhados com a " +
      "equipe do cliente: toda a equipe passa a ver aqueles números, cada um só com o que já vê no CRM. " +
      // FORK MIA (.88): o assistente da MIA.
      "E o assistente da MIA: ligar e desligar por empresa e por papel, o limite de perguntas por dia e a base " +
      "própria, que toda a equipe do cliente passa a ler nas respostas do assistente.",
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
  //
  // FORK MIA (9031): o link dos painéis para o dono do negócio. Chave própria,
  // e não `convidar_equipe` nem `implantar_configuracao`, porque o estrago é
  // outro: não dá login a ninguém e não fala com o cliente final, mas abre os
  // NÚMEROS da empresa (faturamento, funil, metas) a quem tiver o endereço.
  {
    chave: "compartilhar_paineis",
    rotulo: "Criar e revogar o link dos painéis para o dono",
    raio:
      "Cria e revoga, em QUALQUER cliente, o endereço sem senha que mostra os painéis prontos da empresa " +
      "(resultado, meta, funil, atendimento, agenda, anúncios) a quem o tiver. Nenhum nome, telefone ou " +
      "conversa de cliente sai por ele, mas o faturamento e a meta saem, se o link mostrar valores: um token " +
      "vazado gera um link dos números de qualquer empresa, e quem o receber vê até a validade acabar ou " +
      "alguém revogar.",
  },
  // FORK MIA (.88): responder os chamados do assistente da MIA. Chave própria,
  // e não `implantar_configuracao`, porque o estrago é outro: não muda a
  // configuração de ninguém, mas FALA, em nome da Time Company, com a equipe do
  // cliente (no assistente, no sino e por e-mail).
  {
    chave: "responder_chamados",
    rotulo: "Responder os chamados do assistente",
    raio:
      "Responde e muda a situação dos chamados que as equipes de QUALQUER cliente abriram pelo assistente da MIA. " +
      "A resposta chega a quem abriu no assistente, no sino e por e-mail, em nome da Time Company: um token vazado " +
      "manda a qualquer pessoa que abriu chamado o texto que quiser, e marca como resolvido o que não foi.",
  },
  ...OPERACOES_DE_IMPORTACAO,
  // FORK MIA (.89): o disparo de e-mail marketing (docs/fork/email-marketing.md).
  // Duas chaves próprias, porque o estrago é outro: uma LIBERA envio para pessoas
  // (o aceite importado), a outra manda e-mail com o domínio do cliente (o teste).
  // Disparar a campanha não tem chave: é só pela tela, assinado por uma pessoa.
  {
    chave: "importar_consentimentos",
    rotulo: "Importar aceites de e-mail marketing",
    raio:
      "Grava, em QUALQUER cliente, que uma lista de pessoas aceitou receber e-mail marketing (com data, origem e evidência). " +
      "Aceite gravado libera o envio: um token vazado faz a empresa mandar e-mail para quem nunca pediu, em nome dela, e a " +
      "prova do aceite passa a ser o que o token escreveu. Descadastro não volta por aqui.",
  },
  {
    chave: "criar_campanha_de_email",
    rotulo: "Criar campanha de e-mail em rascunho e mandar o teste",
    raio:
      "Cria e edita rascunhos de campanha de e-mail em QUALQUER cliente e manda o TESTE (até 5 endereços por vez, só da equipe " +
      "daquele cliente ou de quem criou o token) pelo domínio verificado da empresa, com [TESTE] no assunto. Não dispara a " +
      "campanha: o envio é só pela tela, com a declaração da base legal assinada por uma pessoa da empresa.",
  },
  // FORK MIA (.90): a cobrança da jornada de assinatura (docs/fork/jornada-de-assinatura.md).
  // Três chaves, pelo estrago: mexer no que TODOS pagam (os planos), no que UMA
  // empresa paga (atribuir, link, prazo, isenção) e em QUEM ENTRA (os pedidos).
  {
    chave: "gerir_planos",
    rotulo: "Criar e ajustar os planos e os pacotes de crédito",
    raio:
      "Cria e ajusta os planos de QUALQUER cliente novo: preço, teste, limites, teto de IA, os módulos que cada plano liga, o preço do Broadcast, qual é o " +
      "do cadastro e quais aparecem na página de preços; e os pacotes de crédito por Pix. Ligar módulo num plano liga para todas as empresas dele na hora. " +
      "Um token vazado põe um plano de R$ 5 como padrão do cadastro ou dá Broadcast a quem não pagou por ele. Plano já assinado não muda de preço nem perde módulo.",
  },
  {
    chave: "gerir_cobranca",
    rotulo: "Atribuir plano, gerar link, dar prazo e isentar",
    raio:
      "Atribui e troca o plano de QUALQUER empresa (inclusive o escondido, negociado), gera o link de pagamento dela, dá prazo de até 60 dias e torna isenta " +
      "(não paga e não tem limites). Um token vazado isenta todo mundo ou põe uma empresa num plano que ela não contratou. Não marca nada como pago.",
  },
  {
    chave: "decidir_cadastro",
    rotulo: "Aprovar e recusar pedidos de cadastro",
    raio:
      "Aprova pedidos de cadastro (a empresa nasce e quem pediu vira administrador dela, com o teste começando) e recusa com o motivo, que vai por e-mail " +
      "a quem pediu. Um token vazado deixa entrar quem a Time não conferiu, gastando IA da plataforma no teste.",
  },
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
