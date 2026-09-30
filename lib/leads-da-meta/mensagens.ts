/**
 * FORK MIA — as frases dos leads da Meta que dizem o motivo E o que fazer.
 *
 * Moravam só na tela (`app/app/settings/meta-ads/_formularios.tsx`). Na .62 o
 * aviso aos administradores (`aviso-de-falha.ts`) passou a dizer a mesma coisa
 * na Central e no celular, e duas cópias da mesma frase divergem na primeira
 * correção. Um lugar só; a tela e o aviso importam daqui, e o dicionário
 * (`lib/i18n/dicionario.ts`) tem o espanhol de cada uma.
 *
 * Puro e sem import de servidor: a tela é client component.
 */

/** O que cada motivo do histórico pede de quem lê. Chave = código gravado no banco. */
export const MENSAGEM_DO_MOTIVO: Record<string, string> = {
  sem_conexao: "Nenhum token de anúncios conectado. Cole o token em Configurações › Meta Ads.",
  cifra_indisponivel:
    "A chave de criptografia do servidor não está disponível para ler o token. É configuração do servidor.",
  token_invalido:
    "A Meta recusou o token: ele expirou ou foi revogado. Gere um novo no Gerenciador de Negócios e cole em Configurações › Meta Ads.",
  permissao_insuficiente:
    "O token não tem permissão para ler os leads deste formulário. Confira as permissões acima e, no Gerenciador de Negócios, o Acesso a leads da Página.",
  limite_de_chamadas:
    "A Meta limitou as chamadas por excesso de consultas. A próxima leitura tenta de novo sozinha.",
  campo_invalido:
    "A Meta recusou um campo da consulta. É problema do sistema, não da sua conta: avise quem mantém a instalação.",
  transitorio: "Não foi possível falar com a Meta agora. A próxima leitura tenta de novo sozinha.",
  pagina_nao_e_da_empresa:
    "Esta Página não é desta empresa na plataforma, e a importação dos formulários dela foi desligada aqui. Quem administra a plataforma define de qual empresa é cada Página.",
  pagina_nao_atribuida:
    "A Página deste formulário não está atribuída ao usuário do sistema do token. Atribua a Página no Gerenciador de Negócios.",
  sem_token_da_pagina:
    "O usuário do sistema não tem acesso suficiente à Página. Dê a ele acesso de anúncios e de leads (ou controle total) no Gerenciador de Negócios.",
  sem_funil:
    "O funil ou a etapa de destino deste formulário não existe mais. Escolha outro destino e salve.",
  volume_acima_do_limite:
    "Chegaram mais leads do que uma leitura comporta e a leitura ficou incompleta. Avise quem mantém a instalação.",
  erro_ao_gravar:
    "Os leads chegaram, mas a gravação parou no meio. A próxima leitura tenta de novo sozinha.",
  sem_origem_do_anuncio:
    "A Meta não devolveu a origem do anúncio (campanha, conjunto e anúncio) destes leads. Eles entraram mesmo assim. Para ter a origem, gere o token de novo com a permissão ads_management.",
  recuperacao_cortada:
    "Parte do período pedido tem mais de 90 dias, e a Meta não guarda leads tão antigos.",
};

/**
 * .62 — por que a Página NÃO ficou assinada para o aviso em tempo real. Chave =
 * `tempo_real_motivo` (a classe da recusa da Meta). Toda frase termina dizendo
 * que os leads continuam chegando: o tempo real acelera, a leitura garante.
 */
export const MENSAGEM_DO_TEMPO_REAL: Record<string, string> = {
  permissao_insuficiente:
    "Tempo real desligado: a Meta recusou assinar a Página por falta da permissão pages_manage_metadata no token. Os leads continuam chegando pela leitura a cada 5 minutos. Para ligar, gere o token de novo com essa permissão e clique em Ligar o tempo real.",
  token_invalido:
    "Tempo real desligado: a Meta recusou o token. Os leads também não estão sendo lidos: gere um token novo e cole em Configurações › Meta Ads.",
  limite_de_chamadas:
    "Tempo real ainda não ligado: a Meta limitou as chamadas agora. O sistema tenta de novo sozinho; os leads continuam chegando pela leitura a cada 5 minutos.",
  transitorio:
    "Tempo real ainda não ligado: não foi possível falar com a Meta agora. O sistema tenta de novo sozinho; os leads continuam chegando pela leitura a cada 5 minutos.",
  campo_invalido:
    "Tempo real desligado: a Meta recusou o pedido de assinatura da Página. É problema do sistema: avise quem mantém a instalação. Os leads continuam chegando pela leitura a cada 5 minutos.",
};

/** A frase do tempo real ligado. */
export const TEMPO_REAL_LIGADO =
  "Tempo real ligado: a Meta avisa na hora em que alguém preenche, e o lead entra em segundos. A leitura a cada 5 minutos continua como garantia.";

/** A frase de quem ainda não tentou (formulário de antes da .62): a rotina tenta sozinha. */
export const TEMPO_REAL_PENDENTE =
  "Tempo real ainda não conferido. O sistema tenta ligar na próxima leitura; enquanto isso, os leads chegam pela leitura a cada 5 minutos.";
