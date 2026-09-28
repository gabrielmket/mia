/**
 * O PLANO DO DISPARO — decidido antes de a primeira mensagem sair.
 *
 * Tudo aqui é puro: recebe números e devolve decisão. O motor (que fala com
 * banco e com a Meta) usa estas funções e não reimplementa nenhuma — porque é
 * exatamente este pedaço que decide quanto o cliente paga, e regra de dinheiro
 * escrita duas vezes diverge na primeira correção.
 */

import { podeDisparar, type VeredictoDaTrava } from "@/lib/carteira/saldo";

/** Como a Meta chama a nota de qualidade de um número. */
export type QualidadeDoNumero = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";

export interface DestinatarioPlanejado {
  contactId: string | null;
  phoneE164: string;
  /** Valores por POSIÇÃO: {"1": "Gabriel"}. */
  valores: Record<string, string>;
}

/**
 * Tira da lista quem não pode receber, e diz POR QUÊ cada um saiu.
 *
 * O motivo importa: uma lista de 4.000 que vira 3.100 sem explicação faz o
 * operador achar que o sistema perdeu gente. Com o motivo, ele vê que 900
 * estavam sem telefone ou repetidos — e isso é informação sobre a base dele.
 */
export interface Peneira {
  enviar: DestinatarioPlanejado[];
  semTelefone: number;
  repetidos: number;
  semConsentimento: number;
}

export interface ContatoParaDisparo {
  id: string;
  phone_number: string | null;
  /** O nome que o operador escolheu — vence o do perfil (`nomeDoContato`). */
  name?: string | null;
  display_name?: string | null;
  /** Bloqueado no atendimento — não recebe nada, nem disparo. */
  is_blocked?: boolean | null;
  /**
   * A RECUSA REGISTRADA. É `declined_at` e não a ausência de `granted_at`, e a
   * diferença é a instalação inteira: todo contato NASCE sem `granted_at`, então
   * barrar por ausência barraria também "ninguém nunca perguntou" — que é o
   * estado de quase toda a base. O argumento completo está em
   * `lib/automation/guarda-do-contato.ts`, e esta é a MESMA régua: duas réguas
   * de consentimento no mesmo produto divergem na primeira correção.
   */
  consent?: { marketing?: { declined_at?: string | null } | null } | null;
}

/**
 * Monta a lista final.
 *
 * ⚠️ A recusa é filtro DURO e fica aqui, não numa condição da tela: quem pediu
 * para não receber e recebe de novo denuncia, e denúncia derruba o número
 * inteiro — não só aquela mensagem. É a regra mais barata de respeitar e a mais
 * cara de esquecer.
 *
 * O repetido sai porque o mesmo telefone duas vezes cobra duas vezes e manda a
 * mesma mensagem duas vezes para a mesma pessoa. O banco também recusa (índice
 * único da 0247), mas descobrir na hora do INSERT deixaria metade da lista
 * gravada e metade não.
 */
export function peneirar(
  contatos: readonly ContatoParaDisparo[],
  valoresPorContato: (c: ContatoParaDisparo) => Record<string, string>,
): Peneira {
  const vistos = new Set<string>();
  const enviar: DestinatarioPlanejado[] = [];
  let semTelefone = 0;
  let repetidos = 0;
  let semConsentimento = 0;

  for (const c of contatos) {
    const fone = (c.phone_number ?? "").replace(/\D/g, "");
    if (!fone) {
      semTelefone += 1;
      continue;
    }
    if (c.is_blocked || c.consent?.marketing?.declined_at) {
      semConsentimento += 1;
      continue;
    }
    if (vistos.has(fone)) {
      repetidos += 1;
      continue;
    }
    vistos.add(fone);
    enviar.push({ contactId: c.id, phoneE164: fone, valores: valoresPorContato(c) });
  }

  return { enviar, semTelefone, repetidos, semConsentimento };
}

export type MotivoDaRecusa =
  | "sem_preco_acordado"
  | "saldo_insuficiente"
  | "template_nao_aprovado"
  | "sem_canal"
  | "numero_em_risco"
  | "lista_vazia";

export interface VeredictoDoDisparo {
  pode: boolean;
  motivo: MotivoDaRecusa | null;
  /** Repassa o que a trava de saldo apurou, para a tela dizer quanto falta. */
  trava: VeredictoDaTrava | null;
}

/**
 * Pode começar?
 *
 * A ordem das checagens não é arbitrária — vai da mais barata de corrigir para
 * a mais cara, para o operador resolver uma coisa de cada vez sabendo qual é a
 * próxima.
 *
 * ⚠️ `RED` recusa e `YELLOW` PASSA. Número em vermelho já está a um passo de
 * ser desligado pela Meta, e disparar nele é acelerar o fim; amarelo é aviso, e
 * barrar o disparo no amarelo transformaria o produto em algo que para sozinho
 * na véspera da campanha — o operador desliga a trava e aí ela não protege
 * mais nada. A trava que se respeita é a que só barra quando é grave.
 */
export function podeComecar(input: {
  destinatarios: number;
  saldoCents: number;
  precoPorMensagemCents: number | null;
  templateAprovado: boolean;
  temCanal: boolean;
  qualidade: QualidadeDoNumero;
}): VeredictoDoDisparo {
  if (input.destinatarios <= 0) return { pode: false, motivo: "lista_vazia", trava: null };
  if (!input.temCanal) return { pode: false, motivo: "sem_canal", trava: null };
  if (!input.templateAprovado) {
    return { pode: false, motivo: "template_nao_aprovado", trava: null };
  }
  if (input.qualidade === "RED") return { pode: false, motivo: "numero_em_risco", trava: null };

  const trava = podeDisparar({
    saldoCents: input.saldoCents,
    precoPorMensagemCents: input.precoPorMensagemCents,
    destinatarios: input.destinatarios,
  });
  if (!trava.pode) {
    return {
      pode: false,
      motivo: trava.motivo === "sem_preco_acordado" ? "sem_preco_acordado" : "saldo_insuficiente",
      trava,
    };
  }
  return { pode: true, motivo: null, trava };
}

/**
 * Deve PARAR no meio?
 *
 * Diferente de `podeComecar`: aqui já saiu mensagem, já houve cobrança, e parar
 * tem custo próprio — metade da lista recebeu e a outra metade não. Só para
 * pelos dois motivos que pioram sozinhos e não voltam: crédito acabou e número
 * caiu para vermelho.
 *
 * `null` = segue.
 */
export function deveParar(input: {
  saldoCents: number;
  precoPorMensagemCents: number | null;
  qualidade: QualidadeDoNumero;
}): "saldo_acabou" | "numero_em_risco" | null {
  if (input.qualidade === "RED") return "numero_em_risco";
  const preco = input.precoPorMensagemCents;
  if (preco === null) return "saldo_acabou";
  // Não cabe nem MAIS UMA: parar aqui é o que impede o saldo negativo.
  if (preco > 0 && input.saldoCents < preco) return "saldo_acabou";
  return null;
}
