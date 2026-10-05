/**
 * FORK MIA (.62) — QUAL PERGUNTA DO FORMULÁRIO É O TELEFONE, O NOME E O E-MAIL.
 *
 * ─── O defeito ─────────────────────────────────────────────────────────────
 *
 * O mapeador da fonte de webhook (`mapInboundPayload`) acha o telefone pela
 * CHAVE exata: `phone_number`, `telefone`, `celular`... Formulário que usa o
 * campo padrão da Meta passa. O da Construtora Delta não: o celular é uma pergunta criada
 * por eles, e a chave que a Meta devolve é `celular:_(ddd_+_número)`. O lead
 * entrava sem telefone, o contato nascia só com o nome, e a IA não tinha para
 * quem mandar a primeira mensagem.
 *
 * ─── A regra, em duas camadas ──────────────────────────────────────────────
 *
 *   1. automático: o campo padrão da Meta, senão a pergunta cuja chave ou texto
 *      fala em celular, telefone, WhatsApp ou fone (nome e e-mail, idem);
 *   2. manual: quando o automático erra, o administrador escolhe a pergunta na
 *      configuração do formulário. A escolha vence.
 *
 * Este arquivo é PURO e sem import de servidor: a tela o usa para mostrar o que
 * o automático escolheria, antes de qualquer lead chegar. A conferência do VALOR
 * (a resposta parece telefone?) mora em `mapear.ts`, que roda no servidor.
 */

export type PapelDoCampo = "telefone" | "nome" | "email";

export const PAPEIS_DO_CAMPO: readonly PapelDoCampo[] = ["telefone", "nome", "email"];

/** A escolha de cada papel: a CHAVE da pergunta na Meta, ou `null` (automático). */
export type EscolhaDosCampos = Partial<Record<PapelDoCampo, string | null>>;

/**
 * Os campos padrão da Meta, na ordem de preferência. `first_name`/`last_name`
 * não entram: `payloadParaMapear` já os junta em `full_name`.
 */
export const CAMPOS_PADRAO: Record<PapelDoCampo, readonly string[]> = {
  telefone: ["phone_number", "work_phone_number"],
  nome: ["full_name"],
  email: ["email", "work_email"],
};

/** Minúsculas, sem acento, e tudo que não é letra ou número vira espaço. */
export function normalizarPergunta(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A palavra que denuncia o papel da pergunta. */
const PISTA: Record<PapelDoCampo, RegExp> = {
  telefone: /\b(celular|telefone|fone|whatsapp|whats|zap|phone|tel)\b/,
  nome: /\b(nome|name)\b/,
  email: /\b(e ?mail)\b/,
};

/**
 * O que parece nome e não é o nome DA PESSOA: "nome da empresa", "nome do pet".
 * Errar para o lado de não achar é o certo aqui: sem nome o lead entra com o
 * telefone de título, e o administrador escolhe a pergunta; com o nome errado,
 * o card nasce chamado "Padaria Central".
 */
const NAO_E_O_NOME =
  /\b(empresa|company|negocio|loja|marca|fantasia|razao|social|pet|filho|filha|crianca|usuario|user|sobrenome|responsavel|indicou|indicacao)\b/;

/** A pergunta (pela chave ou pelo texto) tem cara deste papel? */
export function perguntaPareceDoPapel(
  papel: PapelDoCampo,
  chave: string,
  rotulo?: string | null,
): boolean {
  for (const texto of [chave, rotulo ?? ""]) {
    const n = normalizarPergunta(texto);
    if (!n) continue;
    if (!PISTA[papel].test(n)) continue;
    if (papel === "nome" && NAO_E_O_NOME.test(n)) continue;
    return true;
  }
  return false;
}

/**
 * As chaves candidatas a um papel, em ordem: a escolha manual, os campos
 * padrão, e as perguntas próprias com a pista. `chaves` é a lista de chaves
 * disponíveis (do lead ou do formulário); `perguntas` dá o texto de cada uma.
 */
export function candidatasDoPapel(
  papel: PapelDoCampo,
  chaves: readonly string[],
  perguntas: Record<string, string>,
  escolha: EscolhaDosCampos = {},
): string[] {
  const disponiveis = new Set(chaves);
  const saida: string[] = [];
  const pegar = (k: string | null | undefined) => {
    if (k && disponiveis.has(k) && !saida.includes(k)) saida.push(k);
  };
  pegar(escolha[papel]);
  for (const k of CAMPOS_PADRAO[papel]) pegar(k);
  for (const k of chaves) {
    if (perguntaPareceDoPapel(papel, k, perguntas[k])) pegar(k);
  }
  return saida;
}

/**
 * O que o automático escolheria para cada papel, só pelas perguntas do
 * formulário (sem lead nenhum). É o que a tela mostra ao lado de "Automático".
 */
export function sugestaoPelasPerguntas(
  perguntas: Record<string, string>,
): Record<PapelDoCampo, string | null> {
  const chaves = Object.keys(perguntas);
  return {
    telefone: candidatasDoPapel("telefone", chaves, perguntas)[0] ?? null,
    nome: candidatasDoPapel("nome", chaves, perguntas)[0] ?? null,
    email: candidatasDoPapel("email", chaves, perguntas)[0] ?? null,
  };
}
