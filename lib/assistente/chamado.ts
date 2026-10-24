/**
 * FORK MIA (.88) — o chamado para a Time Company: o que se confere ANTES de
 * abrir, e o contexto que o assistente junta sozinho. Puro.
 *
 * Regra "Erros e pedidos" do protótipo: antes de abrir um Erro, o assistente
 * confere se não é só um campo faltando. A mensagem vermelha "Informe o valor do
 * negócio" não é defeito do sistema: é o formulário pedindo o que falta, e um
 * chamado ali gasta o tempo da Time e deixa a pessoa esperando uma resposta que
 * ela mesma tinha.
 */

/** As frases que o sistema usa quando é só validação de campo. */
const PADROES_DE_VALIDACAO: readonly RegExp[] = [
  /\b(informe|preencha|selecione|escolha|digite|indique|adicione)\b/i,
  /\b(obrigat[oó]ri[oa]s?|inv[aá]lid[oa]s?|incompleto|em branco|vazio)\b/i,
  /\b(precisa (ter|de|ser)|deve (ter|ser)|m[ií]nimo|m[aá]ximo|formato)\b/i,
  /\b(required|invalid|must be|is required)\b/i,
];

/** Os códigos de recusa do servidor que são validação, e não falha. */
const CODIGOS_DE_VALIDACAO = new Set(["validation_failed", "invalid_request", "bad_request"]);

export function pareceValidacaoDeCampo(entrada: {
  mensagem?: string | null;
  codigo?: string | null;
  status?: number | null;
}): boolean {
  if (entrada.codigo && CODIGOS_DE_VALIDACAO.has(entrada.codigo)) return true;
  if (entrada.status === 422) return true;
  const m = (entrada.mensagem ?? "").trim();
  if (!m) return false;
  return PADROES_DE_VALIDACAO.some((p) => p.test(m));
}

/** O navegador em português de gente: "Chrome no Windows". Nunca a string inteira. */
export function navegadorLegivel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (!ua) return "desconhecido";
  const navegador = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "outro navegador";
  const sistema = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iOS/.test(ua)
        ? "iPhone"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "outro sistema";
  return `${navegador} no ${sistema}`;
}

/** Tira do texto o que parece telefone, e-mail ou documento antes de ir para o chamado. */
export function semDadoPessoal(texto: string): string {
  return texto
    .replace(/[^\s@,;:()<>]+@[^\s@,;:()<>]+\.[A-Za-z]{2,}/g, "[e-mail]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[documento]")
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[documento]")
    .replace(/(\+?\d[\d\s().-]{8,}\d)/g, "[telefone]");
}
