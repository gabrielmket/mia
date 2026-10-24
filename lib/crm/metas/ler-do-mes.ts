/**
 * A META DO MÊS E O QUANTO DELA JÁ FOI FEITO — a leitura, num lugar só.
 *
 * Era o corpo do `GET /api/v1/metas`. Saiu da rota na .88 (FORK MIA) porque o
 * assistente da MIA responde "como está minha meta?" e a regra do protótipo é
 * dura: o número do assistente é o MESMO da tela. Duas leituras da meta
 * divergiriam no primeiro ajuste de uma delas (o fuso do mês, o funil que não
 * conta receita, o teto de linhas). Agora a tela e o assistente chamam isto.
 *
 * O cliente é o de quem chama, e a rota e o assistente passam o da SESSÃO: a
 * meta e o realizado saem com a RLS de quem lê, como sempre saíram.
 *
 * O PROGRESSO não é guardado: é derivado, na leitura, das mesmas linhas que o
 * funil e a agenda já usam (`./progresso.ts`). As leituras do mês PAGINAM e
 * dizem quando não coube (`truncado`): o PostgREST corta toda resposta em 1000
 * linhas sem avisar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";

import { FUSO_PADRAO, janelaDoMes } from "./fuso";
import {
  progressoDaMeta,
  resumoDasReunioes,
  resumoDoMes,
  type LeadFechadoComPrazo,
  type Meta,
  type ProgressoDaMeta,
  type ReuniaoMarcada,
  type ResumoDasReunioes,
  type ResumoDoMes,
} from "./progresso";

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

export interface MetasDoMes {
  periodo: string;
  metas: ProgressoDaMeta[];
  resumo: ResumoDoMes;
  reunioes: ResumoDasReunioes;
  fuso: string;
  funis_que_contam_receita: string[] | null;
  reunioes_no_mes: number;
  truncado: boolean;
}

export type LeituraDasMetas = { ok: true; dados: MetasDoMes } | { ok: false; erro: string };

export async function lerMetasDoMes(
  db: SupabaseClient,
  organizationId: string,
  periodo: string,
): Promise<LeituraDasMetas> {
  const dia1 = `${periodo}-01`;

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
    .eq("id", organizationId)
    .maybeSingle();
  const fuso = (orgRow?.timezone as string | null) || FUSO_PADRAO;
  const janela = janelaDoMes(periodo, fuso);
  const fim = janela.fim;

  const [metasRes, leadsRes, reunioesRes] = await Promise.all([
    db
      .from("sales_targets")
      .select("id, periodo, metrica, alvo_cents, alvo_quantidade, user_id, agent_id")
      .eq("organization_id", organizationId)
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
          .eq("organization_id", organizationId)
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
          .eq("organization_id", organizationId)
          .gte("created_at", janela.inicio)
          .lt("created_at", fim)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(de, ate),
      { paginasMaximas: PAGINAS_MAXIMAS },
    ),
  ]);

  if (metasRes.error) return { ok: false, erro: metasRes.error.message };
  // Uma página que falha no meio não pode virar "zero vendas no mês": com a
  // leitura em várias idas, o erro de uma delas responde erro em vez de um
  // realizado pela metade.
  if (leadsRes.erro) return { ok: false, erro: leadsRes.erro };
  if (reunioesRes.erro) return { ok: false, erro: reunioesRes.erro };

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
    .eq("organization_id", organizationId);
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

  return {
    ok: true,
    dados: {
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
  };
}
