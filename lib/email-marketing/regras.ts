/**
 * FORK MIA (.89) — AS REGRAS DO DISPARO DE E-MAIL, num lugar só.
 *
 * Cada número daqui é uma decisão do protótipo aprovado em 24/10/2026
 * (Projeto sistema MIA/Produto/Prototipo-disparo-de-email-2026-10-24.html, tela
 * "Regras e decisões"). Mudar um deles é mudar uma decisão de produto, e o teste
 * `tests/unit/email-marketing-regras.test.ts` fixa os valores.
 */

/** A chave do módulo vendável em `organization_modules`. */
export const MODULO_EMAIL_MARKETING = "email_marketing" as const;

/**
 * O aquecimento do domínio: o teto de cada dia DE ENVIO (dia sem envio não
 * conta). Depois do 14º degrau vale a cota da conta na Amazon.
 */
export const DEGRAUS_DO_AQUECIMENTO = [
  200, 400, 700, 1000, 1500, 2000, 3000, 4000, 5000, 6500, 8000, 10000, 15000, 20000,
] as const;

/** O degrau só sobe se o dia anterior teve rejeição ABAIXO disto (em %)... */
export const AQUECIMENTO_REJEICAO_MAXIMA_PCT = 2;
/** ...e reclamação abaixo disto (em %). Senão, o degrau se repete. */
export const AQUECIMENTO_RECLAMACAO_MAXIMA_PCT = 0.1;

/** A trava de saúde: a campanha pausa sozinha com rejeição a partir disto (em %)... */
export const TRAVA_REJEICAO_PCT = 4;
/** ...ou reclamação a partir disto (em %)... */
export const TRAVA_RECLAMACAO_PCT = 0.08;
/** ...contadas só a partir deste número de entregues: um caso isolado não para tudo. */
export const TRAVA_MINIMO_DE_ENTREGUES = 300;

/** Os limites da Amazon, mostrados no medidor ao lado das travas. */
export const LIMITE_DA_AMAZON_REJEICAO_PCT = 5;
export const LIMITE_DA_AMAZON_RECLAMACAO_PCT = 0.1;

/** R$ 0,02 por e-mail aceito pela Amazon, o padrão (ajustável por empresa). */
export const PRECO_PADRAO_POR_EMAIL_CENTS = 2;

/** Os ritmos oferecidos, em e-mails por hora. */
export const RITMOS_POR_HORA = [100, 200, 300, 500, 1000] as const;

/** As janelas oferecidas, em horas cheias no fuso da empresa. */
export const JANELAS_DE_ENVIO: ReadonlyArray<readonly [number, number]> = [
  [8, 19],
  [9, 18],
  [7, 21],
];

export const CONFIGURACAO_PADRAO = {
  ritmoPorHora: 300,
  janelaInicio: 8,
  janelaFim: 19,
  soDiasUteis: true,
} as const;

/** O teste vai para no máximo estes endereços, com esta marca no assunto. */
export const MAXIMO_DE_ENDERECOS_NO_TESTE = 5;
export const MARCA_DO_TESTE = "[TESTE]";

/** A partir daqui o celular corta o assunto (aviso, não trava). */
export const ASSUNTO_RECOMENDADO = 60;
export const PRE_CABECALHO_RECOMENDADO = 90;
/** O Gmail corta o e-mail acima disto (aviso, não trava). */
export const CORTE_DO_GMAIL_KB = 102;

/** Interesse legítimo vale só para quem comprou nos últimos 24 meses. */
export const MESES_DE_CLIENTE_PARA_INTERESSE_LEGITIMO = 24;

/** O clique dentro deste tempo depois da entrega é suspeito de robô de segurança. */
export const JANELA_DO_ROBO_SEGUNDOS = 60;

/** Rejeição temporária em tantas campanhas SEGUIDAS vira permanente. */
export const REJEICOES_TEMPORARIAS_SEGUIDAS = 3;

/** O teto de uma rodada do worker (o cron volta em um minuto). */
export const TETO_DA_RODADA = 120;

/** Envio preso em "enviando" há mais que isto vira falha (nunca reenvio). */
export const MINUTOS_ATE_ENVIO_PRESO = 15;

/** Bases legais, no vocabulário das Campanhas do upstream (`campaigns.base_legal`). */
export const BASES_LEGAIS = ["consent", "legitimate_interest"] as const;
export type BaseLegal = (typeof BASES_LEGAIS)[number];

/** Os estados de uma campanha de e-mail. */
export const STATUS_DA_CAMPANHA_DE_EMAIL = [
  "rascunho",
  "agendada",
  "enviando",
  "pausada",
  "concluida",
  "cancelada",
] as const;
export type StatusDaCampanhaDeEmail = (typeof STATUS_DA_CAMPANHA_DE_EMAIL)[number];

/** Quem faz o quê (protótipo, decisão "Quem faz o quê"). */
export const PAPEL_QUE_CONFIGURA = "admin" as const;
export const PAPEL_QUE_ENVIA = "manager" as const;
export const PAPEL_QUE_REGISTRA_CONSENTIMENTO = "agent" as const;

/**
 * Provedores de e-mail gratuitos: não servem de remetente. O domínio tem de ser
 * da empresa, verificado por ela — e o Gmail recusa quem se passa por ele.
 */
export const PROVEDORES_GRATUITOS = [
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.com.br",
  "outlook.com",
  "outlook.com.br",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.com.br",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "bol.com.br",
  "uol.com.br",
  "terra.com.br",
  "ig.com.br",
  "zipmail.com.br",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "mail.com",
  "zoho.com",
  "yandex.com",
] as const;
