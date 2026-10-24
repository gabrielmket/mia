/**
 * FORK MIA (.89) — OS TEXTOS PADRÃO de consentimento e de privacidade do e-mail
 * marketing.
 *
 * ⚠️ RASCUNHO PARA REVISÃO JURÍDICA. Os dois textos abaixo foram escritos para o
 * produto funcionar desde o primeiro dia e ainda NÃO passaram por advogado. A
 * tela mostra a marca "rascunho para revisão jurídica" ao lado de cada um, e a
 * empresa pode trocar o de consentimento por uma versão própria
 * (`mia_email_textos_de_consentimento`) e o de privacidade pelo endereço da
 * política dela. Quem revisa: o Gabriel, com o jurídico (docs/fork/email-marketing.md).
 *
 * `{empresa}` é trocado pelo nome de exibição da empresa na hora de mostrar.
 */

export const RASCUNHO_PARA_REVISAO_JURIDICA = true;

/** A marca que acompanha os dois textos na tela, enquanto ninguém os revisar. */
export const MARCA_DE_RASCUNHO = "Rascunho para revisão jurídica";

/** A versão padrão do texto de consentimento, COM o aviso de medição. */
export const VERSAO_PADRAO_DO_CONSENTIMENTO = "padrao-v1";

export const TEXTO_PADRAO_DO_CONSENTIMENTO =
  "Quero receber por e-mail novidades, ofertas e convites da {empresa}. " +
  "Sei que posso cancelar quando quiser, pelo link que vem em todo e-mail, sem custo e sem precisar explicar o motivo. " +
  "Estou ciente de que a {empresa} mede se o e-mail foi aberto e em quais links eu cliquei, para melhorar as mensagens.";

/** A versão sem o aviso de medição (o e-mail sai sem o pixel de abertura). */
export const VERSAO_PADRAO_SEM_MEDICAO = "padrao-v1-sem-medicao";

export const TEXTO_PADRAO_SEM_MEDICAO =
  "Quero receber por e-mail novidades, ofertas e convites da {empresa}. " +
  "Sei que posso cancelar quando quiser, pelo link que vem em todo e-mail, sem custo e sem precisar explicar o motivo.";

/**
 * O aviso de privacidade do e-mail marketing, mostrado na página de preferências
 * quando a empresa não tem página própria e escolheu usar o padrão.
 */
export const TEXTO_PADRAO_DE_PRIVACIDADE = [
  "Como a {empresa} usa o seu e-mail",
  "Usamos o seu endereço de e-mail para mandar novidades, ofertas e convites da {empresa}, com base no seu consentimento ou, se você é nosso cliente, no nosso interesse legítimo de manter contato sobre o que você já comprou.",
  "Quando você aceitou a medição, registramos se o e-mail foi aberto e em quais links você clicou. Essa medição é uma estimativa: alguns programas de e-mail abrem as imagens sozinhos e outros as bloqueiam.",
  "Os e-mails são enviados por um serviço de envio contratado pela {empresa}, que só os usa para entregar a mensagem.",
  "Você pode sair da lista a qualquer momento, pelo link de descadastro de qualquer e-mail ou por esta página. Pedidos, agendamentos e atendimento continuam chegando normalmente.",
  "Guardamos o registro do seu aceite ou da sua recusa (data, origem e texto) enquanto a {empresa} mantiver o cadastro, para poder provar que respeitou a sua escolha. Se você pedir a exclusão dos seus dados, o seu endereço deixa de ser legível e fica guardado só um código que impede que ele volte a receber.",
  "Para exercer os seus direitos previstos na Lei Geral de Proteção de Dados (acesso, correção, exclusão, revogação do consentimento), fale com a {empresa} pelos canais de atendimento.",
] as const;

/** Troca `{empresa}` pelo nome. Sem nome, "a empresa". */
export function comEmpresa(texto: string, empresa: string | null | undefined): string {
  const nome = (empresa ?? "").trim() || "a empresa";
  return texto.replaceAll("{empresa}", nome);
}

export interface VersaoDoTexto {
  versao: string;
  texto: string;
  incluiAvisoDeMedicao: boolean;
  rascunhoJuridico: boolean;
}

/** As versões que existem sempre, mesmo sem nenhuma linha da empresa. */
export function versoesPadrao(): VersaoDoTexto[] {
  return [
    {
      versao: VERSAO_PADRAO_DO_CONSENTIMENTO,
      texto: TEXTO_PADRAO_DO_CONSENTIMENTO,
      incluiAvisoDeMedicao: true,
      rascunhoJuridico: RASCUNHO_PARA_REVISAO_JURIDICA,
    },
    {
      versao: VERSAO_PADRAO_SEM_MEDICAO,
      texto: TEXTO_PADRAO_SEM_MEDICAO,
      incluiAvisoDeMedicao: false,
      rascunhoJuridico: RASCUNHO_PARA_REVISAO_JURIDICA,
    },
  ];
}
