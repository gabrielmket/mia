/**
 * FORK MIA (9020) — o convite que o banco NÃO gravou tem nome.
 *
 * ── O defeito que isto fecha ──────────────────────────────────────────────
 *
 * `emitirConvite` (`lib/team/convites.ts`) mandava o e-mail, auditava
 * `member.invited` e SÓ ENTÃO gravava a linha em `team_invites`. Quando a
 * gravação falhava, o erro cru do banco subia até a rota, que respondia "Erro
 * interno" sem dizer o quê, e ficavam para trás uma auditoria de convite
 * emitido e, no pior caso, um e-mail com um link que funciona para um convite
 * que a tela de Equipe não lista e ninguém consegue revogar (o aceite segue em
 * frente quando não acha a linha, ver `lib/auth/aplicar-convite.ts`).
 *
 * Foi assim que apareceu: em 07/10/2026 a trava da empresa de demonstração
 * recusava a linha do convite (retirada na migration 9020), e convidar alguém
 * pela tela respondia 500 com a auditoria já gravada.
 *
 * ── O que mudou ───────────────────────────────────────────────────────────
 *
 * A linha passou a ser gravada ANTES do e-mail e da auditoria. Se ela não
 * nasce, nada saiu e nada foi auditado, e quem chamou recebe este erro, que diz
 * de quem era o convite e o que o banco respondeu. A rota e a ferramenta do MCP
 * o transformam num item de falha do lote, com frase, em vez de derrubar o lote
 * inteiro com um 500.
 *
 * Mora num arquivo nosso para `lib/team/convites.ts`, que é do upstream, mudar
 * o mínimo.
 */

/** O `reason` que a rota devolve em `failed`, e a tela traduz em frase. */
export const MOTIVO_CONVITE_NAO_GRAVADO = "convite_nao_gravado" as const;

/** O que o PostgREST/pg devolve quando a escrita falha. */
interface ErroDoBanco {
  code?: string | null;
  message?: string | null;
}

export class ConviteNaoGravadoError extends Error {
  /** De quem era o convite. */
  readonly email: string;
  /** O SQLSTATE (ou o código do PostgREST), quando o banco disse um. */
  readonly codigoDoBanco: string | null;

  constructor(email: string, causa: ErroDoBanco | null | undefined) {
    super(
      `convite de ${email} não foi gravado: ${causa?.message ?? "o banco não devolveu a linha"}` +
        (causa?.code ? ` (${causa.code})` : ""),
    );
    this.name = "ConviteNaoGravadoError";
    this.email = email;
    this.codigoDoBanco = causa?.code ?? null;
  }
}
