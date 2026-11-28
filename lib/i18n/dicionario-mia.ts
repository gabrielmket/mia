/**
 * FORK MIA (MIA-372) · o ÚNICO ponto onde as frases da MIA entram no
 * dicionário do upstream (`lib/i18n/dicionario.ts`).
 *
 * O dicionário do upstream importa só este arquivo e chama
 * `ligarAsFrasesDaMia(DICIONARIO)` uma vez, logo depois de fechar o objeto
 * dele. Antes da MIA-372 eram 53 marcas `FORK MIA` lá dentro (uma importação
 * por arquivo nosso, os espalhamentos e frases soltas no meio das dele), e o
 * arquivo conflitava em quase toda fusão.
 *
 * Duas regras, as mesmas de antes:
 *
 *   1. FRASE NOVA nossa (`FRASES_DA_MIA`): entra só se o upstream não tiver a
 *      chave. Chave igual do upstream prevalece, como quando os nossos
 *      arquivos eram espalhados ANTES das linhas dele.
 *   2. SOBREPOSIÇÃO (`dicionario-mia-sobreposicoes.ts`): vence a do upstream,
 *      trocando a entrada inteira. Lista curta, cada linha com motivo.
 *
 * Arquivo de frases novo: importe aqui e ponha em `FRASES_DA_MIA`. Nada muda no
 * `dicionario.ts` do upstream. A cerca `tests/unit/dicionario-mia-ligado.test.ts`
 * reprova arquivo `dicionario-mia-*` que não passe por aqui.
 */
import type { Idioma } from "./idiomas";
// (.90): a jornada de assinatura (a cobrança), num arquivo nosso.
import { DICIONARIO_DA_JORNADA_MIA } from "./dicionario-mia-jornada";
import { DICIONARIO_CARTOES_MIA } from "./dicionario-cartoes-mia";
// (9011+): as frases da agenda do Outlook moram num arquivo à parte.
import { DICIONARIO_DA_AGENDA_MICROSOFT } from "./dicionario-mia-agenda-microsoft";
// (9017): as frases das conversões da Meta por etapa, idem.
import { DICIONARIO_DAS_CONVERSOES_DA_META } from "./dicionario-mia-conversoes";
// (9018): documentos e obrigações, no arquivo ao lado.
import { DICIONARIO_OBRIGACOES_MIA } from "./dicionario-obrigacoes-mia";
// as frases nossas da equipe e do convite, idem.
import { DICIONARIO_DA_EQUIPE_MIA } from "./dicionario-mia-equipe";
// as frases novas dos relatórios e das metas, idem.
import { DICIONARIO_RELATORIOS_MIA } from "./dicionario-relatorios-mia";
// (.79): a empresa única (lista, ficha, pessoa em várias empresas), idem.
import { DICIONARIO_EMPRESAS_MIA } from "./dicionario-empresas-mia";
// (item 8): os painéis prontos, a análise do funil e o link do dono, idem.
import { DICIONARIO_DOS_PAINEIS_MIA } from "./dicionario-mia-paineis";
// (item 9): o montador de relatórios, idem.
import { DICIONARIO_DO_MONTADOR_MIA } from "./dicionario-mia-montador";
// (.85): o horário de atendimento da IA, idem.
import { DICIONARIO_DO_HORARIO_DA_IA } from "./dicionario-mia-horario-da-ia";
// (.88): o assistente da MIA, idem.
import { DICIONARIO_DO_ASSISTENTE_MIA } from "./dicionario-mia-assistente";
// (.89): o disparo de e-mail marketing, idem.
import { DICIONARIO_DO_EMAIL_MARKETING } from "./dicionario-mia-email-marketing";
// (.91): os primeiros passos (o segmento, o "o que falta" e as propostas), idem.
import { DICIONARIO_DOS_PRIMEIROS_PASSOS_MIA } from "./dicionario-mia-primeiros-passos";
// (.94): o assistente faz com aprovação (o cartão, a aba Propostas e as peças), idem.
import { DICIONARIO_DO_ASSISTENTE_FAZ_MIA } from "./dicionario-mia-assistente-faz";
// (.93): o "Me mostra como" (as trilhas) e onde os clientes travam, idem.
import { DICIONARIO_DAS_TRILHAS_MIA } from "./dicionario-mia-trilhas";
// (.96): o pagamento no início (o cadastro da entrada paga, o passo Pagamento e a nota), idem.
import { DICIONARIO_DO_PAGAMENTO_MIA } from "./dicionario-mia-pagamento";
// (.98): cupons, parceiros e comissão.
import { DICIONARIO_DOS_CUPONS_MIA } from "./dicionario-mia-cupons";
// (.96, segunda frente): a área de cobrança e o lado da Time, idem.
import { DICIONARIO_DA_AREA_DE_COBRANCA_MIA } from "./dicionario-mia-area-de-cobranca";
// (.97): os contatos em massa (o telefone na importação, o filtro inteiro e a conferência), idem.
import { DICIONARIO_DOS_CONTATOS_EM_MASSA } from "./dicionario-mia-contatos-em-massa";
// (.101): o raio-X do atendimento (Admin, a página de conexão e o link do dono), idem.
import { DICIONARIO_DO_RAIO_X_MIA } from "./dicionario-mia-raio-x";
// (.107): a faixa da IA calada por outra conversa do contato, idem.
import { DICIONARIO_DA_IA_PENDENTE } from "./dicionario-mia-ia-pendente";
// (MIA-44): as quebras do consumo de IA na aba Uso do cliente, idem.
import { DICIONARIO_DO_CONSUMO_DE_IA } from "./dicionario-mia-consumo-de-ia";
// (.108): a nota, a linha do tempo e o aviso da trava de robô, idem.
import { DICIONARIO_DA_TRAVA_DE_ROBO } from "./dicionario-mia-trava-de-robo";
import { DICIONARIO_DA_COEXISTENCIA } from "./dicionario-mia-coexistencia";
// (.109): o produto no negócio (docs/fork/produto-no-negocio.md).
import { DICIONARIO_DO_PRODUTO_NO_NEGOCIO } from "./dicionario-mia-produto-no-negocio";
// (MIA-218): a IA que segue a plataforma (o aviso da chave e o da trava), idem.
import { DICIONARIO_DA_IA_DA_PLATAFORMA } from "./dicionario-mia-ia-da-plataforma";
import { DICIONARIO_AVULSO_MIA } from "./dicionario-mia-avulsas";
import { DICIONARIO_SOBREPOSICOES_MIA } from "./dicionario-mia-sobreposicoes";

type Traducoes = Record<string, Partial<Record<Exclude<Idioma, "pt-BR">, string>>>;

/**
 * As frases novas da MIA, juntas. Entre dois arquivos NOSSOS com a mesma chave,
 * vale o que vem depois nesta lista (a ordem é a em que eles entravam no
 * dicionário antes da MIA-372).
 */
export const FRASES_DA_MIA: Traducoes = {
  ...DICIONARIO_DA_JORNADA_MIA,
  ...DICIONARIO_DA_AGENDA_MICROSOFT,
  ...DICIONARIO_DAS_CONVERSOES_DA_META,
  ...DICIONARIO_DOS_PAINEIS_MIA,
  ...DICIONARIO_DO_MONTADOR_MIA,
  ...DICIONARIO_DO_HORARIO_DA_IA,
  ...DICIONARIO_DO_ASSISTENTE_MIA,
  ...DICIONARIO_DO_EMAIL_MARKETING,
  ...DICIONARIO_DOS_PRIMEIROS_PASSOS_MIA,
  ...DICIONARIO_DO_ASSISTENTE_FAZ_MIA,
  ...DICIONARIO_DAS_TRILHAS_MIA,
  ...DICIONARIO_DO_PAGAMENTO_MIA,
  ...DICIONARIO_DOS_CUPONS_MIA,
  ...DICIONARIO_DA_AREA_DE_COBRANCA_MIA,
  ...DICIONARIO_DOS_CONTATOS_EM_MASSA,
  ...DICIONARIO_DO_RAIO_X_MIA,
  ...DICIONARIO_DA_IA_PENDENTE,
  ...DICIONARIO_DO_CONSUMO_DE_IA,
  ...DICIONARIO_DA_TRAVA_DE_ROBO,
  ...DICIONARIO_DA_COEXISTENCIA,
  ...DICIONARIO_DO_PRODUTO_NO_NEGOCIO,
  ...DICIONARIO_DA_IA_DA_PLATAFORMA,
  // As frases que moravam soltas no meio do dicionário do upstream.
  ...DICIONARIO_AVULSO_MIA,
  // Cartões e fichas, obrigações, equipe, relatórios e empresas: entravam
  // depois das soltas.
  ...DICIONARIO_CARTOES_MIA,
  ...DICIONARIO_OBRIGACOES_MIA,
  ...DICIONARIO_DA_EQUIPE_MIA,
  ...DICIONARIO_RELATORIOS_MIA,
  ...DICIONARIO_EMPRESAS_MIA,
};

/** As que vencem a do upstream (regra 2). */
export const SOBREPOSICOES_DA_MIA: Traducoes = DICIONARIO_SOBREPOSICOES_MIA;

/**
 * Liga as frases da MIA no dicionário do upstream. Muda o objeto recebido e
 * não devolve nada: o `DICIONARIO` exportado continua sendo o mesmo objeto, e
 * quem o importa vê as nossas frases.
 */
export function ligarAsFrasesDaMia(dicionario: Traducoes): void {
  for (const [chave, traducao] of Object.entries(FRASES_DA_MIA)) {
    if (!Object.hasOwn(dicionario, chave)) dicionario[chave] = traducao;
  }
  Object.assign(dicionario, SOBREPOSICOES_DA_MIA);
}
