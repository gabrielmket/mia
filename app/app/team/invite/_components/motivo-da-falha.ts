/**
 * O `reason` de `failed` em POST /api/v1/team/invite (`app/api/v1/team/invite/route.ts`)
 * é código estável de contrato de API — `tests/e2e/invite-lifecycle.spec.ts` faz
 * `reason === "already_member"` — não frase para tela. Esta é a única tradução
 * de código para frase; o card não conhece os códigos.
 *
 * A frase é chave de `t()`: pt-BR aqui, espanhol em `lib/i18n/dicionario.ts`.
 */
const MOTIVOS_DE_FALHA: Record<string, string> = {
  already_member: "Já é membro desta organização.",
  // FORK MIA (9020): o banco não gravou a linha do convite. Nada saiu para este
  // e-mail (`lib/team/convite-nao-gravado.ts`); o espanhol mora em
  // `lib/i18n/dicionario-mia-equipe.ts`.
  convite_nao_gravado: "Não foi possível registrar este convite, e nenhum e-mail foi enviado. Tente de novo em instantes.",
};

/** Código sem tradução conhecida: devolve o próprio código, nunca some da tela. */
export function descreverMotivoDaFalha(reason: string): string {
  return MOTIVOS_DE_FALHA[reason] ?? reason;
}
