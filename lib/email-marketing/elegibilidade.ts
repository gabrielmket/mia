/**
 * FORK MIA (.89) — QUEM PODE RECEBER o e-mail marketing: os DEZ motivos de
 * ficar de fora, puros e testados (`tests/unit/email-marketing-elegibilidade.test.ts`).
 *
 * ── Uma regra, três consumidores ─────────────────────────────────────────────
 *
 * A MESMA função monta a contagem da tela (quantos recebem e por que os outros
 * não), grava os destinatários na confirmação e roda DE NOVO antes de cada
 * e-mail sair: quem se descadastrou depois do agendamento não recebe.
 *
 * ── A ordem é a do motivo que a pessoa lê ────────────────────────────────────
 *
 * Quem pediu para sair aparece como "descadastrou", não como "sem consentimento",
 * mesmo que as duas coisas sejam verdade: trocar isso na tela seria mentir sobre
 * o motivo. A ordem é a do protótipo aprovado:
 *
 *   descadastro · reclamacao · manual · outros · sem_email · email_invalido ·
 *   rejeicao · sem_consentimento · nao_cliente · duplicado
 *
 * "outros" são os vetos que o CRM já tem e que as Campanhas do upstream
 * respeitam (`lib/campanhas/elegibilidade.ts`): pediu para parar no WhatsApp
 * (`is_blocked`), recusou marketing (`consent.marketing.declined_at`), contato
 * pessoal ou anonimizado. O e-mail não cria régua concorrente: soma às que existem.
 */
import type { BaseLegal } from "./regras";

export const MOTIVOS_DE_EXCLUSAO = [
  "descadastro",
  "reclamacao",
  "manual",
  "outros",
  "sem_email",
  "email_invalido",
  "rejeicao",
  "sem_consentimento",
  "nao_cliente",
  "duplicado",
] as const;

export type MotivoDeExclusao = (typeof MOTIVOS_DE_EXCLUSAO)[number];

/** O rótulo de cada motivo, na voz da tela (chave do dicionário). */
export const ROTULO_DO_MOTIVO: Record<MotivoDeExclusao, string> = {
  descadastro: "Descadastrou do e-mail",
  reclamacao: "Marcou como spam",
  manual: "Pediu à equipe para sair",
  outros: "Outros vetos do CRM",
  sem_email: "Sem e-mail no cadastro",
  email_invalido: "E-mail inválido",
  rejeicao: "Rejeição permanente",
  sem_consentimento: "Sem consentimento registrado",
  nao_cliente: "Não é cliente",
  duplicado: "E-mail repetido",
};

/** Por que cada motivo tira a pessoa da lista (chave do dicionário). */
export const PORQUE_DO_MOTIVO: Record<MotivoDeExclusao, string> = {
  descadastro:
    "Pediu para sair pelo link do rodapé, pelo botão do Gmail ou pela página de preferências.",
  reclamacao: "Reclamação que o provedor devolve. Nunca mais recebe.",
  manual: "Recusa registrada à mão, com quem registrou e quando.",
  outros:
    "Pediu para parar no WhatsApp, recusou marketing, contato pessoal ou anonimizado. São as regras das Campanhas.",
  sem_email: "Não há endereço para mandar.",
  email_invalido:
    "O endereço não tem forma de e-mail ou o domínio não recebe e-mail. A conferência roda antes do envio.",
  rejeicao: "Um envio anterior voltou porque o endereço não existe.",
  sem_consentimento: "Nunca aceitou receber e-mail de marketing, ou o aceite não está no sistema.",
  nao_cliente: "Interesse legítimo vale só para quem comprou nos últimos 24 meses.",
  duplicado: "Mesmo endereço de outro contato da lista: recebe uma vez só.",
};

/** O que se sabe de um contato na hora de decidir. Nada além disto importa. */
export interface ContatoParaEmail {
  contactId: string;
  email: string | null;
  /** `contacts.is_blocked`: pediu para parar (opt-out canônico do WhatsApp). */
  bloqueado: boolean;
  pessoal: boolean;
  anonimizado: boolean;
  /** `consent.marketing.declined_at`: recusa REGISTRADA de contato comercial. */
  recusouMarketing: boolean;
  /** `consent.email_marketing` vigente: aceite sem recusa depois. */
  consentiuEmail: boolean;
  /** Comprou nos últimos 24 meses (negócio ganho ou pedido pago). */
  clienteRecente: boolean;
}

/** O motivo da supressão por hash, como `campaign_suppressions.motivo`. */
export type MotivoDaSupressao = "descadastro" | "rejeicao" | "reclamacao" | "manual" | "importada";

export interface ContextoDaElegibilidade {
  base: BaseLegal;
  /** hash do e-mail → motivo da supressão. */
  suprimidos: ReadonlyMap<string, MotivoDaSupressao>;
  hashDoEmail: (email: string) => string;
  /** O endereço tem forma de e-mail? */
  temForma: (email: string) => boolean;
  /** O domínio recebe e-mail? `true` também quando não deu para saber (o envio confere de novo). */
  dominioRecebe: (email: string) => boolean;
}

/**
 * O motivo por que ESTE contato fica de fora, ou `null` (recebe). O duplicado
 * não é daqui: depende da lista inteira (ver `classificar`).
 */
export function motivoDeExclusao(
  c: ContatoParaEmail,
  ctx: ContextoDaElegibilidade,
): MotivoDeExclusao | null {
  const email = (c.email ?? "").trim();
  const suprimido = email ? ctx.suprimidos.get(ctx.hashDoEmail(email)) : undefined;
  // A importada é descadastro trazido da ferramenta anterior: a pessoa pediu.
  if (suprimido === "descadastro" || suprimido === "importada") return "descadastro";
  if (suprimido === "reclamacao") return "reclamacao";
  if (suprimido === "manual") return "manual";
  if (c.bloqueado || c.recusouMarketing || c.pessoal || c.anonimizado) return "outros";
  if (!email) return "sem_email";
  if (!ctx.temForma(email) || !ctx.dominioRecebe(email)) return "email_invalido";
  if (suprimido === "rejeicao") return "rejeicao";
  if (ctx.base === "consent" && !c.consentiuEmail) return "sem_consentimento";
  if (ctx.base === "legitimate_interest" && !c.clienteRecente) return "nao_cliente";
  return null;
}

export interface LinhaClassificada<C extends ContatoParaEmail = ContatoParaEmail> {
  contato: C;
  motivo: MotivoDeExclusao | null;
}

/**
 * Classifica a lista inteira, na ordem estável do recorte: o primeiro contato de
 * um endereço recebe, os outros ficam como `duplicado`.
 */
export function classificar<C extends ContatoParaEmail>(
  contatos: readonly C[],
  ctx: ContextoDaElegibilidade,
): LinhaClassificada<C>[] {
  const vistos = new Set<string>();
  return contatos.map((contato) => {
    let motivo = motivoDeExclusao(contato, ctx);
    if (!motivo) {
      const chave = ctx.hashDoEmail(contato.email!);
      if (vistos.has(chave)) motivo = "duplicado";
      else vistos.add(chave);
    }
    return { contato, motivo };
  });
}

export interface ContagemDoPublico {
  noRecorte: number;
  recebem: number;
  foraPorMotivo: Record<MotivoDeExclusao, number>;
}

export function contar(linhas: readonly LinhaClassificada[]): ContagemDoPublico {
  const foraPorMotivo = Object.fromEntries(MOTIVOS_DE_EXCLUSAO.map((m) => [m, 0])) as Record<
    MotivoDeExclusao,
    number
  >;
  let recebem = 0;
  for (const l of linhas) {
    if (l.motivo) foraPorMotivo[l.motivo] += 1;
    else recebem += 1;
  }
  return { noRecorte: linhas.length, recebem, foraPorMotivo };
}
