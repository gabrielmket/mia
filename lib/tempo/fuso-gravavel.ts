/**
 * FORK MIA (MIA-102): O FUSO QUE PODE SER GRAVADO NA ORGANIZAÇÃO.
 *
 * ─── Por que a gravação confere, e não só quem lê ───────────────────────────
 *
 * Quem LÊ `organizations.timezone` já degrada: `fusoUtilizavel`
 * (`lib/tempo/fusos.ts`) no TypeScript e o `pg_timezone_names` no motor dos
 * relatórios (`fn_mia_relatorio_preparar`, 9166) trocam o fuso vazio ou
 * desconhecido por `America/Sao_Paulo`. Isso evita a tela que não abre, mas
 * não o erro de fundo: a empresa que gravou `America/Sao_Pualo` passa a ver
 * tudo em Brasília sem saber que o fuso dela não valeu. Recusar na entrada,
 * com a frase que diz o que mandar, é o que fecha a porta.
 *
 * ─── Por que o `Intl` sozinho não basta ─────────────────────────────────────
 *
 * O `Intl` (o juiz do TypeScript) aceita mais do que o Postgres (o juiz do
 * motor): `america/manaus` em minúsculas e `+03:00` passam no `Intl` e não
 * estão em `pg_timezone_names`. Gravados, o painel em TypeScript mostraria
 * Manaus e o relatório do banco mostraria Brasília, a mesma venda em dias
 * diferentes. Então o nome tem de passar no `Intl` E ter a forma de um nome
 * da base IANA como o Postgres o guarda: `UTC`, ou regiões separadas por `/`
 * começando em maiúscula (`America/Argentina/Buenos_Aires`, `Etc/GMT+3`).
 *
 * Não é a lista de `FUSOS_OFERECIDOS`: a tela só oferece aquela lista, mas a
 * API e o MCP de implantação aceitam qualquer fuso real (`America/Chihuahua`),
 * e restringir aqui quebraria quem já configura assim.
 */
import { z } from "zod";

import { fusoValido } from "@/lib/tempo/fusos";

/** A frase da recusa. Diz o que mandar, não só que está errado. */
export const MENSAGEM_DO_FUSO_INVALIDO =
  "Fuso horário inválido. Use o nome da região, sem acento (ex.: America/Sao_Paulo, America/Manaus, Europe/Lisbon).";

const FORMA_DO_NOME_IANA = /^(?:UTC|[A-Z][A-Za-z0-9_+-]*(?:\/[A-Z][A-Za-z0-9_+-]*)+)$/;

/** O fuso pode ser gravado em `organizations.timezone`? */
export function fusoGravavel(tz: string): boolean {
  return FORMA_DO_NOME_IANA.test(tz) && fusoValido(tz);
}

/** O campo `timezone` dos schemas que gravam a organização. */
export const fusoGravavelSchema = z.string().min(1).max(64).refine(fusoGravavel, MENSAGEM_DO_FUSO_INVALIDO);
