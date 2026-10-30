/**
 * FORK MIA (.97) · REIMPORTAR A PLANILHA COMPLETA QUEM JÁ ESTÁ NA BASE.
 *
 * ── De onde isto vem ──────────────────────────────────────────────────────
 *
 * A planilha de 565 contatos entrou sem nenhum telefone (`phone` não era um
 * cabeçalho conhecido). Consertado o cabeçalho, reimportar o mesmo arquivo ainda
 * não adiantava: a rota tratava como duplicado quem já existia pelo e-mail, e os
 * 332 ficavam sem o número para sempre, a menos de apagar e importar de novo.
 *
 * ── A regra ───────────────────────────────────────────────────────────────
 *
 * Só se preenche o que está VAZIO, e só com o que não é de outra pessoa:
 *
 *  - quem existe pelo e-mail e não tem telefone ganha o telefone da linha;
 *  - quem existe pelo telefone e não tem e-mail ganha o e-mail da linha;
 *  - telefone e e-mail que já existem nunca são trocados. O telefone é a
 *    identidade da pessoa no WhatsApp, e trocar por planilha ligaria a conversa
 *    de alguém ao cadastro de outro (a mesma regra de `mudancasDoContato`, em
 *    lib/mcp-plataforma/importacao/contatos.ts);
 *  - se o telefone é de um contato e o e-mail de outro, nada muda: podem ser a
 *    mesma pessoa cadastrada duas vezes, e isso quem resolve é a tela de
 *    Duplicados, não uma planilha;
 *  - contato anonimizado não é tocado (LGPD).
 *
 * Módulo PURO: a rota lê o banco e grava; aqui só se decide.
 */
import { phoneLookupVariants } from "@/lib/channels/phone-variants";

/** O que a importação precisa saber de um contato que já está na base. */
export interface ContatoNaBase {
  id: string;
  phone_number: string | null;
  email_normalized: string | null;
  is_anonymized?: boolean | null;
}

/** As colunas da leitura. Ficam aqui para a rota e a decisão não divergirem. */
export const COLUNAS_DO_CONTATO_NA_BASE = "id, phone_number, email_normalized, is_anonymized";

/**
 * Quem já está na base e quem esta planilha já gravou.
 *
 * O mesmo número com e sem o nono dígito é a mesma pessoa
 * (`phoneLookupVariants`), e o e-mail não diferencia maiúsculas.
 */
export class ContatosConhecidos {
  private readonly porTelefone = new Map<string, ContatoNaBase>();
  private readonly porEmail = new Map<string, ContatoNaBase>();

  lembrar(contato: ContatoNaBase): void {
    if (contato.phone_number) {
      for (const v of phoneLookupVariants(contato.phone_number)) this.porTelefone.set(v, contato);
    }
    if (contato.email_normalized) this.porEmail.set(contato.email_normalized.toLowerCase(), contato);
  }

  doTelefone(telefone: string): ContatoNaBase | null {
    for (const v of phoneLookupVariants(telefone)) {
      const achado = this.porTelefone.get(v);
      if (achado) return achado;
    }
    return null;
  }

  doEmail(email: string): ContatoNaBase | null {
    return this.porEmail.get(email.toLowerCase()) ?? null;
  }
}

export type MotivoDoAviso =
  /** O telefone da linha é de um contato e o e-mail, de outro. */
  | "telefone_e_email_de_contatos_diferentes"
  /** O contato achado pelo e-mail já tem outro telefone. */
  | "ja_tem_outro_telefone"
  /** O contato achado pelo telefone já tem outro e-mail. */
  | "ja_tem_outro_email";

export type DesfechoDaLinha =
  | { tipo: "criar" }
  | {
      tipo: "completar";
      contato: ContatoNaBase;
      campos: { phone_number?: string; email?: string };
      aviso?: MotivoDoAviso;
    }
  | { tipo: "duplicado"; aviso?: MotivoDoAviso };

/** O que fazer com uma linha, dado quem já é conhecido. */
export function decidirLinha(
  linha: { phone?: string; email?: string },
  conhecidos: ContatosConhecidos,
): DesfechoDaLinha {
  const peloTelefone = linha.phone ? conhecidos.doTelefone(linha.phone) : null;
  const peloEmail = linha.email ? conhecidos.doEmail(linha.email) : null;

  if (!peloTelefone && !peloEmail) return { tipo: "criar" };
  if (peloTelefone && peloEmail && peloTelefone.id !== peloEmail.id) {
    return { tipo: "duplicado", aviso: "telefone_e_email_de_contatos_diferentes" };
  }

  const contato = (peloTelefone ?? peloEmail)!;
  if (contato.is_anonymized) return { tipo: "duplicado" };

  const campos: { phone_number?: string; email?: string } = {};
  let aviso: MotivoDoAviso | undefined;

  if (linha.phone && !peloTelefone) {
    if (contato.phone_number) aviso = "ja_tem_outro_telefone";
    else campos.phone_number = linha.phone;
  }
  if (linha.email && !peloEmail) {
    if (contato.email_normalized) aviso ??= "ja_tem_outro_email";
    else campos.email = linha.email;
  }

  if (Object.keys(campos).length === 0) {
    return aviso ? { tipo: "duplicado", aviso } : { tipo: "duplicado" };
  }
  return aviso ? { tipo: "completar", contato, campos, aviso } : { tipo: "completar", contato, campos };
}

/**
 * A frase de cada aviso, em português: é a chave de tradução. Um literal por
 * ramo, para a catraca do espanhol achar no código.
 */
export function fraseDoAviso(motivo: MotivoDoAviso, t: (texto: string) => string): string {
  switch (motivo) {
    case "telefone_e_email_de_contatos_diferentes":
      return t("O telefone é de um contato e o e-mail é de outro. Nada foi mudado: confira em Duplicados.");
    case "ja_tem_outro_telefone":
      return t("O contato deste e-mail já tem outro telefone, e ele foi mantido.");
    case "ja_tem_outro_email":
      return t("O contato deste telefone já tem outro e-mail, e ele foi mantido.");
  }
}
