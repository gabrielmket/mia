/**
 * GET/POST /api/v1/metas — a meta do mês e o quanto dela já foi feito.
 *
 * O PROGRESSO não é guardado: é derivado, na leitura, das mesmas linhas que o
 * funil e a agenda já usam (`lib/crm/metas/progresso.ts`). Uma coluna
 * `realizado` ao lado da meta exigiria que todo caminho que fecha uma venda
 * lembrasse de incrementá-la — e no dia em que um caminho esquecesse, a meta
 * passaria a mentir sem ninguém ver.
 *
 * Quem define meta é manager+ (é decisão de gestão); quem acompanha é todo mundo
 * que enxerga o funil. A RLS da tabela já diz isso; aqui a porta repete, porque
 * política de banco não devolve mensagem que gente entende.
 *
 * ── As leituras do mês PAGINAM, e dizem quando não coube ────────────────────
 *
 * O realizado é somado aqui, e o PostgREST corta toda resposta em `max_rows`
 * (1000) sem avisar: o `.limit(10_000)` que estava nas duas leituras nunca
 * trouxe mais de 1000 linhas. Numa casa com mais de 1000 vendas ganhas ou mais
 * de 1000 reuniões no mês, a barra da meta parava num recorte arbitrário. As
 * duas passam pelo laço de `lib/leitura/todas-as-paginas.ts` (o idioma do
 * upstream em `app/api/v1/reports/tags/route.ts`), e o que passar do teto
 * chega à tela como `truncado`.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { logger } from "@/lib/logger";
import { requireRole } from "@/lib/auth/require-role";
import { gravarMeta } from "@/lib/crm/metas/gravar";
import { lerMetasDoMes } from "@/lib/crm/metas/ler-do-mes";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** AAAA-MM: o mês é a unidade da meta comercial. */
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

const criarSchema = z.object({
  periodo: z.string().regex(MES, "use AAAA-MM"),
  metrica: z.enum([
    "reunioes",
    "reunioes_realizadas",
    "receita_total",
    "receita_recorrente",
    "receita_avulsa",
    "receita_originada",
  ]),
  alvo_cents: z.number().int().positive().max(1_000_000_000_000).optional(),
  alvo_quantidade: z.number().int().positive().max(100_000).optional(),
  user_id: z.string().uuid().nullish(),
  agent_id: z.string().uuid().nullish(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "metas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org } = authz;

  const periodo = req.nextUrl.searchParams.get("periodo") ?? new Date().toISOString().slice(0, 7);
  if (!MES.test(periodo)) {
    return fail("validation_failed", t("Período inválido: use AAAA-MM."), 422, { requestId });
  }

  // FORK MIA (.88): a leitura saiu para `lib/crm/metas/ler-do-mes.ts`, a mesma
  // que o assistente da MIA usa para "como está minha meta?" (o número do
  // assistente é o da tela). A resposta é byte a byte a de antes.
  const db = await createClient();
  const leitura = await lerMetasDoMes(db, org.orgId, periodo);
  if (!leitura.ok) return fail("query_failed", leitura.erro, 500, { requestId });
  return ok(leitura.dados, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "metas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org, user } = authz;

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return fail("validation_failed", t("Corpo inválido."), 422, { requestId });
  }
  const parsed = criarSchema.safeParse(corpo);
  if (!parsed.success) {
    return fail("validation_failed", t("Meta inválida."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const dados = parsed.data;

  // As duas regras que o banco também cobra, repetidas aqui para a mensagem ser
  // legível: o CHECK devolveria 23514, que não diz nada a quem está na tela.
  // Marcadas e realizadas se contam em UNIDADES; as de receita, em centavos.
  // O CHECK do banco cobra o mesmo (0246) — aqui é só para a mensagem ser
  // legível em vez de um 23514 cru na tela.
  const ehAtividade =
    dados.metrica === "reunioes" || dados.metrica === "reunioes_realizadas";
  if (ehAtividade && !dados.alvo_quantidade) {
    return fail("validation_failed", t("Meta de reuniões precisa de uma quantidade."), 422, {
      requestId,
    });
  }
  if (!ehAtividade && !dados.alvo_cents) {
    return fail("validation_failed", t("Meta de receita precisa de um valor."), 422, { requestId });
  }
  if (dados.user_id && dados.agent_id) {
    return fail("validation_failed", t("A meta é de uma pessoa OU de um agente, não dos dois."), 422, {
      requestId,
    });
  }

  const db = await createClient();
  // Redefinir a meta do mês é o caminho NORMAL (o número muda no meio do
  // trimestre); criar uma segunda linha para o mesmo par faria a tela mostrar
  // duas metas concorrentes sem dizer qual vale. O upsert mora em
  // `lib/crm/metas/gravar.ts`, o mesmo que a implantação pelo MCP usa (9030).
  const { data, error } = await gravarMeta(db, {
    organizationId: org.orgId,
    periodo: dados.periodo,
    metrica: dados.metrica,
    alvo_cents: dados.alvo_cents ?? null,
    alvo_quantidade: dados.alvo_quantidade ?? null,
    user_id: dados.user_id ?? null,
    agent_id: dados.agent_id ?? null,
    created_by: user.id,
  });

  if (error || !data) {
    /**
     * O MOTIVO CRU VAI PARA O LOG — e essa linha é a lição da 0253.
     *
     * A rota devolvia só "Não consegui gravar a meta." e descartava o `code`.
     * Com isso, um `42P10` que reprovava 100% das gravações desde a 0243
     * sobreviveu em produção: o único lugar onde ele aparecia era um toast, e
     * toast não é log. A mensagem ao operador continua sendo esta — ela não
     * ganha nada com jargão do Postgres —, mas o motivo deixa de morrer.
     */
    logger.error("[metas] gravação recusada pelo banco", {
      request_id: requestId,
      codigo: error?.code ?? null,
      detalhe: error?.message?.slice(0, 300) ?? null,
    });
    return fail("db_error", t("Não consegui gravar a meta."), 500, { requestId });
  }
  return ok(data, { requestId });
}
