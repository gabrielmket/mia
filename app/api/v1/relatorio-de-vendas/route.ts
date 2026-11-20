/**
 * GET /api/v1/relatorio-de-vendas?periodo=AAAA-MM — o que a fotografia do funil
 * não responde.
 *
 * A tela de Desempenho mostra quantos negócios estão em cada etapa AGORA. Isso
 * é útil e é uma fotografia: não diz por que perdemos, quanto tempo leva para
 * fechar, nem se o mês está melhor ou pior que os anteriores.
 *
 * Tudo aqui é DERIVADO das mesmas linhas de `crm_leads` que o funil usa — não
 * há tabela de relatório, e por isso não há relatório que envelhece.
 *
 * Auth: manager+. Receita, ciclo e motivo de perda são leitura de gestão.
 *
 * ── A leitura PAGINA, e diz quando não coube ────────────────────────────────
 *
 * A conta é feita aqui (as funções puras de `lib/crm/relatorio/vendas.ts`), e
 * por isso a leitura não pode parar na linha 1000: o PostgREST corta toda
 * resposta em `max_rows` sem avisar, e o `.limit(50_000)` que estava aqui nunca
 * trouxe mais de 1000 negócios. Numa casa com mais de 1000 fechamentos em seis
 * meses, a taxa de ganho, o ciclo, os motivos e a série saíam de um recorte
 * arbitrário, com cara de total. O idioma é o do upstream em
 * `app/api/v1/reports/tags/route.ts`, pelo laço de
 * `lib/leitura/todas-as-paginas.ts`.
 *
 * Por que paginar e não somar no banco: mediana, mês no fuso de quem opera e a
 * régua "em qual funil vencer é receita" já estão escritas e testadas em
 * TypeScript, e são as MESMAS do módulo de metas. Uma função no banco seria a
 * segunda régua de receita do produto.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { janelaDoMes, mesNoFuso } from "@/lib/crm/metas/fuso";
import {
  cicloDeVenda,
  historico,
  motivosDePerda,
  taxaDeGanho,
  type LeadDoRelatorio,
} from "@/lib/crm/relatorio/vendas";
import { traduzir } from "@/lib/i18n/dicionario";
import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";
import { createClient } from "@/lib/supabase/server";
import { fusoUtilizavel } from "@/lib/tempo/fusos";
// FORK MIA (.109): os dois quadros do produto no negócio e o funil sem valor
// recorrente contando como avulso (docs/fork/produto-no-negocio.md).
import { palavraGravada } from "@/lib/produto-no-negocio/funil";
import { contarComoAvulso, funisSemRecorrente } from "@/lib/produto-no-negocio/metas";
import { tempoAteFechar, vendidosNoMes, type VendaDoMes } from "@/lib/produto-no-negocio/relatorio";
import { lerItensDosNegocios } from "@/lib/produto-no-negocio/servidor";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Quantos meses a série mostra. Seis cabem numa tela e mostram sazonalidade. */
const MESES_DA_SERIE = 6;
/**
 * O teto da leitura: 50 páginas de 1000, os 50 mil negócios fechados que o
 * `.limit(50_000)` antigo declarava e nunca entregou. Acima disso a resposta
 * sai `truncado` e a tela avisa.
 */
const PAGINAS_MAXIMAS = 50;
const COLUNAS_DO_NEGOCIO =
  "id, status, pipeline_id, value_cents, revenue_kind, recurring_months, recurring_value_cents, lost_reason, created_at, closed_at";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "relatorio_de_vendas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org } = authz;

  const periodo = req.nextUrl.searchParams.get("periodo") ?? new Date().toISOString().slice(0, 7);
  if (!MES.test(periodo)) {
    return fail("validation_failed", t("Período inválido: use AAAA-MM."), 422, { requestId });
  }

  const db = await createClient();

  const { data: orgRow } = await db
    .from("organizations")
    .select("timezone")
    .eq("id", org.orgId)
    .maybeSingle();
  // MIA-102: vazio OU inválido vale Brasília, como no Desempenho e no motor dos
  // relatórios montados. Era `|| FUSO_PADRAO` (UTC, de `lib/crm/metas/fuso`): a
  // empresa sem fuso fechava o mês às 21h de Brasília, e o fuso inválido
  // derrubava `janelaDoMes` (o `Intl` lança).
  const fuso = fusoUtilizavel(orgRow?.timezone as string | null);

  /**
   * A janela cobre a SÉRIE inteira, não só o mês pedido: a evolução precisa dos
   * meses anteriores, e uma segunda consulta por mês seria seis idas ao banco
   * para responder uma pergunta.
   */
  const partes = periodo.split("-");
  const inicioDaSerie = janelaDoMes(
    `${new Date(Date.UTC(Number(partes[0]), Number(partes[1]) - 1 - (MESES_DA_SERIE - 1), 1))
      .toISOString()
      .slice(0, 7)}`,
    fuso,
  ).inicio;
  const fimDoMes = janelaDoMes(periodo, fuso).fim;

  // Do fechamento mais NOVO para o mais antigo: se a leitura for cortada, o mês
  // pedido (o último da série) continua inteiro e o que fica de fora é o começo
  // da série. `id` desempata, porque paginar por `range` só é correto sobre uma
  // ordem única.
  const [leadsRes, funisRes] = await Promise.all([
    lerTodasAsPaginas<LeadDoRelatorio & { id: string }>(
      (de, ate, pedirContagem) =>
        db
          .from("crm_leads")
          .select(COLUNAS_DO_NEGOCIO, pedirContagem ? { count: "exact" } : undefined)
          .eq("organization_id", org.orgId)
          .not("closed_at", "is", null)
          .gte("closed_at", inicioDaSerie)
          .lt("closed_at", fimDoMes)
          .order("closed_at", { ascending: false })
          .order("id", { ascending: false })
          .range(de, ate),
      { paginasMaximas: PAGINAS_MAXIMAS },
    ),
    db.from("crm_pipelines").select("id, settings, vocabulary").eq("organization_id", org.orgId),
  ]);
  if (leadsRes.erro) return fail("query_failed", leadsRes.erro, 500, { requestId });

  // A MESMA régua do módulo de metas: ganhar num funil de SDR não é receita.
  const declararam = (funisRes.data ?? []).some(
    (f) => (f.settings as { vitoria_e_receita?: boolean } | null)?.vitoria_e_receita === false,
  );
  const funisDeReceita = declararam
    ? new Set(
        (funisRes.data ?? [])
          .filter(
            (f) => (f.settings as { vitoria_e_receita?: boolean } | null)?.vitoria_e_receita !== false,
          )
          .map((f) => f.id as string),
      )
    : null;

  // FORK MIA (.109): no funil com "Mostrar valor recorrente" desligado a venda é avulsa.
  const leads = contarComoAvulso(
    leadsRes.linhas,
    funisSemRecorrente(funisRes.data as Array<{ id: string; settings: unknown }> | null),
  );
  const produtoNoNegocio = await quadrosDoProduto(db, org.orgId, leads, periodo, fuso, funisDeReceita, funisRes.data);

  return ok(
    {
      periodo,
      fuso,
      taxa_de_ganho: taxaDeGanho(leads, periodo, fuso, funisDeReceita),
      ciclo_de_venda: cicloDeVenda(leads, periodo, fuso, funisDeReceita),
      motivos_de_perda: motivosDePerda(leads, periodo, fuso),
      historico: historico(leads, periodo, MESES_DA_SERIE, fuso, funisDeReceita),
      // FORK MIA (.109): vendidos no mês e tempo até fechar, por produto. Nulo
      // quando a leitura dos itens falhou: a tela some com os dois quadros.
      produto_no_negocio: produtoNoNegocio,
      // O período passou do teto de leitura: os números contam só os negócios
      // fechados mais recentes, e a tela tem de dizer.
      truncado: leadsRes.truncado,
    },
    { requestId },
  );
}

/**
 * FORK MIA (.109) · os dois quadros do produto no negócio: as vendas do mês (a
 * MESMA régua da receita: ganhas no mês, nos funis em que vencer é receita) e os
 * itens de cada uma. A palavra é a dos funis dessas vendas quando todos usam a
 * mesma; senão, o padrão do sistema (a tela traduz). Nunca derruba o relatório.
 */
async function quadrosDoProduto(
  db: Awaited<ReturnType<typeof createClient>>,
  org: string,
  leads: ReadonlyArray<LeadDoRelatorio & { id: string }>,
  periodo: string,
  fuso: string,
  funisDeReceita: ReadonlySet<string> | null,
  funis: ReadonlyArray<{ id: unknown; vocabulary?: unknown }> | null,
) {
  const doMes = leads.filter(
    (l) =>
      l.status === "won" &&
      (funisDeReceita === null || funisDeReceita.has(l.pipeline_id)) &&
      mesNoFuso(l.closed_at, fuso) === periodo.slice(0, 7),
  );
  try {
    const itens = await lerItensDosNegocios(db, org, doMes.map((l) => l.id), { nomeNoCatalogo: true });
    const vendas: VendaDoMes[] = doMes.map((l) => ({
      leadId: l.id,
      valueCents: l.value_cents === null ? null : Number(l.value_cents),
      recurringValueCents:
        l.recurring_value_cents === null || l.recurring_value_cents === undefined ? null : Number(l.recurring_value_cents),
      createdAt: l.created_at,
      closedAt: l.closed_at,
      itens: itens.get(l.id) ?? [],
    }));
    const usados = new Set(doMes.map((l) => l.pipeline_id));
    const palavras = new Set(
      (funis ?? []).filter((f) => usados.has(String(f.id))).map((f) => palavraGravada(f.vocabulary)),
    );
    const palavra = palavras.size === 1 ? ([...palavras][0] ?? null) : null;
    return { palavra, vendidos: vendidosNoMes(vendas), tempo: tempoAteFechar(vendas) };
  } catch (err) {
    logger.warn("relatorio_de_vendas_itens_falhou", {
      organization_id: org,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
