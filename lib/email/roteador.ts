/**
 * QUAL DOS DOIS CAMINHOS DE E-MAIL ATENDE CADA ENVIO.
 *
 * Esta é a peça que faz "os dois caminhos convivem" existir em CÓDIGO, e não só
 * em prosa. Sem ela, acrescentar SMTP significaria trocar oito `import` de
 * `@/lib/email/resend` por `@/lib/email/smtp` — que é substituir, não somar, e
 * quebra em silêncio toda instalação que hoje entrega pela Resend.
 *
 * ── A regra ─────────────────────────────────────────────────────────────────
 *
 *   SMTP configurado  →  o envio sai pelo SMTP.
 *   SMTP ausente      →  o envio sai pela Resend.
 *
 * ── Por que a decisão é por CONFIGURAÇÃO, e nunca por falha ─────────────────
 *
 * O caminho tentador é "tentou SMTP, falhou, tenta a Resend". Ele é pior por
 * dois motivos medíveis:
 *
 *   1. **Entrega em dobro.** Boa parte das falhas de SMTP acontece DEPOIS de o
 *      servidor aceitar a mensagem (recusa do destinatário, greylisting que
 *      responde 4xx e aceita na retentativa). Cair para a Resend ali manda o
 *      mesmo convite duas vezes — e envio em dobro é pior que não-envio.
 *   2. **O erro fica invisível.** Um SMTP mal configurado que sempre cai para a
 *      Resend nunca aparece para quem instalou: a tela diz "enviado", e a conta
 *      do serviço externo continua sendo consumida sem ninguém entender por quê.
 *
 * Com a decisão na configuração, cada envio tem um dono e um erro nomeado: se o
 * SMTP do operador está errado, ele recebe o erro do SMTP, não um sucesso
 * emprestado do outro caminho.
 *
 * ── O que NÃO muda ──────────────────────────────────────────────────────────
 *
 * Instalação sem nenhum dos dois continua devolvendo `not_configured`, que é o
 * que joga o fluxo no caminho bom que já existe: `pending_review` no worker de
 * LGPD (`workers/lgpd-export-worker.ts`) e o link de aceite mostrado na tela do
 * convite. Nenhum chamador precisa saber qual transporte respondeu.
 */
import { getSmtpConfig } from "@/lib/email/config";
import { isEmailConfigured as resendConfigurada, sendEmail as enviarPelaResend } from "@/lib/email/resend";
import { isSmtpConfigured, sendEmail as enviarPorSmtp } from "@/lib/email/smtp";
import { travaDaDemonstracao } from "@/lib/demonstracao/trava";
import { createAdminClient } from "@/lib/supabase/admin";

/** Quem entregou (ou tentou entregar). Vai ao audit, nunca ao destinatário. */
export type TransporteDeEmail = "smtp" | "resend";

/**
 * A união dos dois vocabulários de erro, e de propósito NÃO um denominador
 * comum: `dominio_nao_verificado` (Resend) e `sender_rejected` (SMTP) mandam o
 * operador para lugares diferentes, e achatar os dois em `send_failed` é
 * exatamente o defeito que este repo já pagou uma vez.
 */
export type EmailDeliveryError =
  | "not_configured"
  | "send_failed"
  | "rate_limited"
  | "sender_rejected"
  | "dominio_nao_verificado"
  // FORK MIA (cliente modelo, 9010): a empresa de demonstração não manda e-mail.
  | "organizacao_de_demonstracao";

export interface EmailSendResult {
  ok: boolean;
  id?: string;
  error?: EmailDeliveryError;
  details?: string;
  /** Por onde o envio foi tentado — sem isto, "falhou" não diz onde olhar. */
  via?: TransporteDeEmail;
}

interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  fromName?: string;
  tags?: { name: string; value: string }[];
  /**
   * FORK MIA (cliente modelo, 9010): de qual empresa é o e-mail, quando é de
   * uma. Com ela, o roteador pergunta se a empresa é de demonstração e, se for
   * (ou se não der para confirmar), o e-mail não sai.
   */
  organizationId?: string;
  /**
   * FORK MIA (9020): a ÚNICA exceção à trava acima, e quem a pede é o chamador,
   * pelo nome. Hoje só existe uma: o convite de equipe.
   *
   * A trava existe para nada chegar aos contatos fictícios da demonstração nem a
   * um destino de fora. O convite de equipe não é isso: é o sistema falando com
   * uma pessoa de verdade que quem administra a empresa escolheu, e é o jeito de
   * dar acesso à demonstração a quem ainda não tem login.
   *
   * ⚠️ Quem usa é `issueInvite` (`lib/auth/issue-invite.ts`) e mais ninguém:
   * `tests/unit/convite-de-equipe-na-demonstracao.test.ts` reprova um segundo
   * chamador. A exceção é declarada por quem envia, NUNCA deduzida aqui de
   * `tags` ou do assunto: um e-mail que se parecesse com convite sairia da
   * demonstração sem ninguém ter decidido isso.
   */
  excecaoDaTravaDaDemonstracao?: ExcecaoDaTravaDaDemonstracao;
}

/** As exceções à trava de e-mail da empresa de demonstração. Uma só, e nomeada. */
export type ExcecaoDaTravaDaDemonstracao = "convite_de_equipe";

/**
 * Qual transporte atende agora. `resend` aqui NÃO afirma que a Resend está
 * configurada — afirma que ela é quem responde, inclusive para devolver
 * `not_configured` quando também não estiver.
 */
export async function transporteDeEmail(): Promise<TransporteDeEmail> {
  return isSmtpConfigured(await getSmtpConfig()) ? "smtp" : "resend";
}

/** Existe algum caminho capaz de entregar? Usado por tela, nunca por envio. */
export async function emailConfigurado(): Promise<boolean> {
  return (await transporteDeEmail()) === "smtp" ? true : await resendConfigurada();
}

/**
 * Quem está entregando DE FATO, para a tela poder dizê-lo.
 *
 * Diferente de `transporteDeEmail()`: aqui `resend` só é devolvido quando a
 * Resend está realmente configurada, e `nenhum` existe porque a alternativa
 * seria a tela de SMTP dizer "não está em uso" a uma instalação cujo e-mail
 * funciona pela Resend — verdade sobre o SMTP, e leitura errada sobre o
 * produto.
 */
export async function transporteEmVigor(): Promise<TransporteDeEmail | "nenhum"> {
  if ((await transporteDeEmail()) === "smtp") return "smtp";
  // `await` OBRIGATÓRIO: `isEmailConfigured` virou assíncrona quando a chave da
  // Resend passou a vir do banco (migration 0341). Sem ele a condição testa a
  // PROMESSA, que é sempre verdadeira — e a tela afirmaria "usando Resend" numa
  // instalação sem e-mail nenhum configurado. O compilador pega (TS2801); o
  // desfecho em tela seria silencioso.
  return (await resendConfigurada()) ? "resend" : "nenhum";
}

export async function sendEmail(args: SendArgs): Promise<EmailSendResult> {
  // Os dois campos do fork saem daqui: nenhum transporte os recebe.
  const { organizationId, excecaoDaTravaDaDemonstracao, ...envio } = args;
  // FORK MIA (cliente modelo, 9010): e-mail da empresa de demonstração não sai.
  // Falha fechada — sem confirmar que a empresa é de verdade, também não sai.
  //
  // FORK MIA (9020): menos o convite de equipe, que sai de qualquer empresa. Por
  // isso a pergunta nem é feita para ele: a resposta não mudaria o desfecho, e
  // uma leitura que falhasse ("não confirmado") seguraria um convite que pode
  // sair nos dois casos. A comparação é com o valor exato, e não "tem exceção":
  // um valor que não seja este continua travado.
  if (organizationId && excecaoDaTravaDaDemonstracao !== "convite_de_equipe") {
    const trava = await travaDaDemonstracao(createAdminClient(), organizationId);
    if (trava.travado) return { ok: false, error: "organizacao_de_demonstracao", details: trava.motivo };
  }
  const via = await transporteDeEmail();
  const resultado = via === "smtp" ? await enviarPorSmtp(envio) : await enviarPelaResend(envio);
  return { ...resultado, via };
}
