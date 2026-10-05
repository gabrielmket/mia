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
import {
  progressoDaMeta,
  resumoDasReunioes,
  resumoDoMes,
  type LeadFechadoComPrazo,
  type Meta,
  type ReuniaoMarcada,
} from "@/lib/crm/metas/progresso";
import { FUSO_PADRAO, janelaDoMes } from "@/lib/crm/metas/fuso";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** AAAA-MM: o mês é a unidade da meta comercial. */
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * O teto de cada leitura do mês: 10 páginas de 1000, as 10 mil linhas que o
 * `.limit(10_000)` antigo declarava e nunca entregou. Acima disso a resposta
 * sai `truncado` e a tela avisa.
 */
const PAGINAS_MAXIMAS = 10;

interface VendaGanhaLida {
  status: string;
  value_cents: number | string | null;
  revenue_kind: string | null;
  recurring_months: number | null;
  owner_user_id: string | null;
  originated_by_user_id: string | null;
  closed_at: string | null;
  pipeline_id: string;
}

interface ReuniaoLida {
  created_by_user_id: string | null;
  created_by_agent_id: string | null;
  created_at: string;
  status: string;
}

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

function primeiroDia(periodo: string): string {
  return `${periodo}-01`;
}

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

  const db = await createClient();
  const dia1 = primeiroDia(periodo);

  /**
   * O mês fecha no fuso de QUEM OPERA, não em Greenwich.
   *
   * Em UTC, o mês de uma empresa em São Paulo terminava às 21h do último dia: a
   * venda fechada às 22h do dia 30 caía em outubro e a reunião marcada à noite
   * sumia do mês em que aconteceu. O total do ano não muda — por isso ninguém
   * notava — e o erro aparecia na conferência de comissão, um mês depois.
   */
  const { data: orgRow } = await db
    .from("organizations")
    .select("timezone")
    .eq("id", org.orgId)
    .maybeSingle();
  const fuso = (orgRow?.timezone as string | null) || FUSO_PADRAO;
  const janela = janelaDoMes(periodo, fuso);
  const fim = janela.fim;

  const [metasRes, leadsRes, reunioesRes] = await Promise.all([
    db
      .from("sales_targets")
      .select("id, periodo, metrica, alvo_cents, alvo_quantidade, user_id, agent_id")
      .eq("organization_id", org.orgId)
      .eq("periodo", dia1),
    // Da mais NOVA para a mais antiga, com `id` de desempate: paginar por
    // `range` só é correto sobre uma ordem única, e, se a leitura for cortada,
    // o que sobra é o fim do mês, que é o que quem acompanha a meta está olhando.
    lerTodasAsPaginas<VendaGanhaLida>(
      (de, ate, pedirContagem) =>
        db
          .from("crm_leads")
          .select(
            "status, value_cents, revenue_kind, recurring_months, owner_user_id, originated_by_user_id, closed_at, pipeline_id",
            pedirContagem ? { count: "exact" } : undefined,
          )
          .eq("organization_id", org.orgId)
          .eq("status", "won")
          .gte("closed_at", janela.inicio)
          .lt("closed_at", fim)
          .order("closed_at", { ascending: false })
          .order("id", { ascending: false })
          .range(de, ate),
      { paginasMaximas: PAGINAS_MAXIMAS },
    ),
    lerTodasAsPaginas<ReuniaoLida>(
      (de, ate, pedirContagem) =>
        db
          .from("calendar_appointments")
          .select(
            "created_by_user_id, created_by_agent_id, created_at, status",
            pedirContagem ? { count: "exact" } : undefined,
          )
          .eq("organization_id", org.orgId)
          .gte("created_at", janela.inicio)
          .lt("created_at", fim)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(de, ate),
      { paginasMaximas: PAGINAS_MAXIMAS },
    ),
  ]);

  if (metasRes.error) return fail("query_failed", metasRes.error.message, 500, { requestId });
  // Uma página que falha no meio não pode virar "zero vendas no mês": com a
  // leitura em várias idas, o erro de uma delas responde 500 em vez de um
  // realizado pela metade.
  if (leadsRes.erro) return fail("query_failed", leadsRes.erro, 500, { requestId });
  if (reunioesRes.erro) return fail("query_failed", reunioesRes.erro, 500, { requestId });

  /**
   * Em QUAIS funis vencer é receita.
   *
   * Sem nenhuma declaração, `null` — e aí tudo conta, que é o certo para quem
   * tem um funil só. Basta UM funil declarar `vitoria_e_receita: false` para a
   * régua passar a valer, e aí os outros precisam estar na lista: por isso o
   * conjunto é montado com todos os que NÃO se declararam fora.
   */
  const { data: funis } = await db
    .from("crm_pipelines")
    .select("id, settings")
    .eq("organization_id", org.orgId);
  const declararam = (funis ?? []).some(
    (f) => (f.settings as { vitoria_e_receita?: boolean } | null)?.vitoria_e_receita === false,
  );
  const funisDeReceita = declararam
    ? new Set(
        (funis ?? [])
          .filter(
            (f) => (f.settings as { vitoria_e_receita?: boolean } | null)?.vitoria_e_receita !== false,
          )
          .map((f) => f.id as string),
      )
    : null;

  const leads: LeadFechadoComPrazo[] = leadsRes.linhas.map((l) => ({
    status: l.status,
    value_cents: l.value_cents === null ? null : Number(l.value_cents),
    revenue_kind: (l.revenue_kind as "recorrente" | "avulso" | null) ?? null,
    recurring_months: l.recurring_months ?? null,
    owner_user_id: l.owner_user_id ?? null,
    originated_by_user_id: l.originated_by_user_id ?? null,
    closed_at: l.closed_at ?? null,
    pipeline_id: l.pipeline_id,
  }));

  // Reunião CANCELADA não conta como marcada: a meta do SDR mede compromisso de
  // pé, e contar cancelamento premiaria quem marca por marcar.
  const reunioes: ReuniaoMarcada[] = reunioesRes.linhas
    .filter((r) => r.status !== "cancelled")
    .map((r) => ({
      marcada_por_user_id: r.created_by_user_id ?? null,
      marcada_por_agent_id: r.created_by_agent_id ?? null,
      created_at: r.created_at,
      status: r.status,
    }));

  const metas = (metasRes.data ?? []) as unknown as Meta[];

  return ok(
    {
      periodo,
      metas: metas.map((m) => progressoDaMeta(m, leads, reunioes, funisDeReceita, fuso)),
      resumo: resumoDoMes(leads, dia1, funisDeReceita, fuso),
      // Marcar e comparecer são medidas diferentes. O desfecho já era gravado
      // (a Agenda tem "Realizado"/"Faltou" e o agente registra sozinho) e não
      // era somado em lugar nenhum.
      reunioes: resumoDasReunioes(reunioes, dia1, fuso),
      // A tela precisa poder dizer "mês fechado no fuso de São Paulo" em vez de
      // deixar o leitor supor que é o mês dele.
      fuso,
      // A tela precisa poder dizer "receita só do comercial" em vez de deixar o
      // número parecer o total da casa.
      funis_que_contam_receita: funisDeReceita ? [...funisDeReceita] : null,
      reunioes_no_mes: reunioes.length,
      // Alguma das duas leituras passou do teto: os números contam só as vendas
      // e as reuniões mais recentes do mês, e a tela tem de dizer.
      truncado: leadsRes.truncado || reunioesRes.truncado,
    },
    { requestId },
  );
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
  const { data, error } = await db
    .from("sales_targets")
    .upsert(
      {
        organization_id: org.orgId,
        periodo: primeiroDia(dados.periodo),
        metrica: dados.metrica,
        alvo_cents: ehAtividade ? null : (dados.alvo_cents ?? null),
        alvo_quantidade: ehAtividade ? (dados.alvo_quantidade ?? null) : null,
        user_id: dados.user_id ?? null,
        agent_id: dados.agent_id ?? null,
        created_by: user.id,
      },
      // Redefinir a meta do mês é o caminho NORMAL (o número muda no meio do
      // trimestre); criar uma segunda linha para o mesmo par faria a tela
      // mostrar duas metas concorrentes sem dizer qual vale.
      { onConflict: "organization_id,periodo,metrica,user_id,agent_id" },
    )
    .select("id, periodo, metrica, alvo_cents, alvo_quantidade, user_id, agent_id")
    .single();

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
