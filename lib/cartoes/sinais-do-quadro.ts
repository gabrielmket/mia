/**
 * FORK MIA — os sinais do cartão fechado, lidos UMA vez por quadro.
 *
 * Plugado na rota do quadro (`app/api/v1/pipelines/[id]/board/route.ts`) por
 * uma linha, depois das etapas do upstream. Cada sinal vem da área que o grava:
 *
 *   canal ........ crm_leads.source/source_metadata + contacts (1º toque)  → canal.ts
 *   bola ......... conversations.last_inbound_at/last_outbound_at
 *                  + fn_mia_sinais_do_cartao (quem mandou a última saída)  → bola.ts
 *   objeção ...... fn_mia_sinais_do_cartao (retrato do último checkpoint)
 *   compromisso .. calendar_appointments + crm_lead_links (appointment)    → compromisso.ts
 *   tarefas ...... crm_tasks abertas do negócio
 *   compras ...... negócios ganhos + orders do contato/empresa            → compras-servidor.ts
 *   pessoa ....... contacts (cargo) + crm_lead_links (contatos envolvidos)
 *   obrigação .... mia_obrigacoes do negócio, da empresa e do contato      → lib/obrigacoes/sinais.ts
 *
 * ⚠️ NUNCA DERRUBA O QUADRO. Falha de qualquer leitura daqui devolve os
 * cartões como o upstream os entregou (sem `cartao`) e registra no log: os
 * sinais são o acessório, o quadro é o principal. Mesma regra do aviso de
 * ambiguidade da rota (`avisaAmbiguas`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { buscaEmLotesSemTeto } from "@/lib/leitura/em-lotes-sem-teto";
import { buscaEmLotes } from "@/lib/supabase/em-lotes";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import type { Lead } from "@/lib/types/leads";
import type { Stage } from "@/lib/kanban/types";
import { bolaDaConversa } from "@/lib/cartoes/bola";
import { canalDoNegocio } from "@/lib/cartoes/canal";
import { escolherProximoCompromisso, type CompromissoDoCartao } from "@/lib/cartoes/compromisso";
import { contarComprasParaOQuadro } from "@/lib/cartoes/compras-servidor";
import type { SinaisDoCartao } from "@/lib/cartoes/tipos";
import { avisosDeObrigacaoDoQuadro } from "@/lib/obrigacoes/sinais";

type Db = SupabaseClient;

interface LinhaDoContato {
  id: string;
  name: string | null;
  display_name: string | null;
  source: string | null;
  source_metadata: Record<string, unknown> | null;
  cargo?: string | null;
  papel_na_empresa?: string | null;
  is_anonymized: boolean | null;
}

interface LinhaDosSinais {
  contact_id: string;
  objecoes: unknown;
  objecoes_em: string | null;
  ultima_saida_via: string | null;
  ultima_saida_por: string | null;
  ultima_saida_em: string | null;
}

/** A objeção mais recente do retrato (o último elemento que a IA escreveu). */
export function objecaoAberta(objecoes: unknown): string | null {
  if (!Array.isArray(objecoes)) return null;
  for (let i = objecoes.length - 1; i >= 0; i--) {
    const o = objecoes[i];
    if (typeof o === "string" && o.trim()) return o.trim();
  }
  return null;
}

const SITUACOES_ABERTAS_DA_TAREFA = ["pending", "in_progress"];

/**
 * As colunas de contato que este módulo lê. `cargo` é da MIA (0262); o papel na
 * empresa entra com a 9013 — quem lê a coluna antes de ela existir recebe erro
 * do PostgREST, então a lista cresce junto com o schema.
 */
export const COLUNAS_DO_CONTATO_NO_CARTAO =
  "id, name, display_name, source, source_metadata, cargo, papel_na_empresa, is_anonymized";

export interface OpcoesDosSinais {
  /** As etapas do funil: a chance calibrada da etapa entra no "Fechamento previsto". */
  etapas?: Array<Pick<Stage, "id" | "is_won" | "is_lost" | "win_probability">>;
  agora?: Date;
}

export async function comSinaisDoCartao(
  db: Db,
  org: string,
  leads: Lead[],
  opcoes: OpcoesDosSinais = {},
): Promise<Lead[]> {
  if (leads.length === 0) return leads;
  try {
    return await montar(db, org, leads, opcoes.agora ?? new Date(), opcoes.etapas ?? []);
  } catch (err) {
    logger.warn("cartao_sinais_falhou", {
      organization_id: org,
      error: err instanceof Error ? err.message : String(err),
    });
    return leads;
  }
}

async function montar(
  db: Db,
  org: string,
  leads: Lead[],
  agora: Date,
  etapas: NonNullable<OpcoesDosSinais["etapas"]>,
): Promise<Lead[]> {
  // A chance da ETAPA: ganho e perda valem 100 e 0 na regra (lib/leads/previsao.ts);
  // etapa sem calibração fica nula, e a linha diz que não há chance calculada.
  const chanceDaEtapa = new Map(
    etapas.map((e) => [e.id, e.is_won ? 100 : e.is_lost ? 0 : (e.win_probability ?? null)]),
  );
  const leadIds = leads.map((l) => l.id);
  const contatoIds = [...new Set(leads.map((l) => l.contact_id).filter((c): c is string => !!c))];
  const empresaIds = [...new Set(leads.map((l) => l.empresa_id).filter((e): e is string => !!e))];
  const conversaIds = [
    ...new Set(leads.map((l) => l.conversa?.id).filter((c): c is string => !!c)),
  ];
  const agoraIso = agora.toISOString();

  const [contatos, conversas, sinais, agenda, tarefas, envolvidos, compras, obrigacoes] = await Promise.all([
    buscaEmLotes(contatoIds, (lote) =>
      db.from("contacts").select(COLUNAS_DO_CONTATO_NO_CARTAO).eq("organization_id", org).in("id", lote),
    ),
    buscaEmLotes(conversaIds, (lote) =>
      db
        .from("conversations")
        .select("id, last_inbound_at, last_outbound_at")
        .eq("organization_id", org)
        .in("id", lote),
    ),
    buscaEmLotes(contatoIds, (lote) =>
      db.rpc("fn_mia_sinais_do_cartao", { p_org: org, p_contatos: lote }),
    ),
    // As três leituras abaixo têm VÁRIAS linhas por id (compromissos de um
    // contato, tarefas e pessoas de um negócio): um lote de 100 ids pode passar
    // de 1000 linhas, e o PostgREST cortaria ali sem avisar. Por isso vão pelo
    // `buscaEmLotesSemTeto`, que lê cada lote até o fim.
    buscaEmLotesSemTeto(contatoIds, (lote, contagem) =>
      db
        .from("calendar_appointments")
        .select(
          "id, title, event_type_id, location_kind, location_details, starts_at, ends_at, time_zone, status, contact_id",
          contagem,
        )
        .eq("organization_id", org)
        .in("contact_id", lote)
        .gt("ends_at", agoraIso)
        .not("status", "in", "(cancelled,completed,no_show)")
        .order("starts_at", { ascending: true }),
    ),
    buscaEmLotesSemTeto(leadIds, (lote, contagem) =>
      db
        .from("crm_tasks")
        .select("id, lead_id, due_date", contagem)
        .eq("organization_id", org)
        .in("lead_id", lote)
        .in("status", SITUACOES_ABERTAS_DA_TAREFA),
    ),
    buscaEmLotesSemTeto(leadIds, (lote, contagem) =>
      db
        .from("crm_lead_links")
        .select("lead_id, target_id", contagem)
        .eq("organization_id", org)
        .eq("target_kind", "contact")
        .in("lead_id", lote),
    ),
    contarComprasParaOQuadro(db, org, { contatoIds, empresaIds }),
    // Nunca lança: falha na leitura das obrigações devolve o quadro sem aviso.
    avisosDeObrigacaoDoQuadro(db, org, leads, agora),
  ]);
  for (const r of [contatos, conversas, sinais, agenda, tarefas, envolvidos]) {
    if (r.error) throw new Error(r.error.message);
  }

  // Compromissos: o vínculo com o negócio é polimórfico (crm_lead_links,
  // target_kind='appointment'), e o nome do tipo mora em calendar_event_types.
  const linhasDaAgenda = agenda.data as Array<{
    id: string;
    title: string;
    event_type_id: string | null;
    location_kind: string | null;
    location_details: string | null;
    starts_at: string;
    ends_at: string;
    time_zone: string;
    status: string;
    contact_id: string;
  }>;
  const idsDaAgenda = linhasDaAgenda.map((a) => a.id);
  const idsDosTipos = [...new Set(linhasDaAgenda.map((a) => a.event_type_id).filter((t): t is string => !!t))];
  const [vinculos, tipos] = await Promise.all([
    buscaEmLotes(idsDaAgenda, (lote) =>
      db
        .from("crm_lead_links")
        .select("lead_id, target_id")
        .eq("organization_id", org)
        .eq("target_kind", "appointment")
        .in("target_id", lote),
    ),
    buscaEmLotes(idsDosTipos, (lote) =>
      db.from("calendar_event_types").select("id, name").eq("organization_id", org).in("id", lote),
    ),
  ]);
  if (vinculos.error) throw new Error(vinculos.error.message);
  if (tipos.error) throw new Error(tipos.error.message);

  const nomeDoTipo = new Map((tipos.data as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]));
  const leadsDoCompromisso = new Map<string, string[]>();
  for (const v of vinculos.data as Array<{ lead_id: string; target_id: string }>) {
    const lista = leadsDoCompromisso.get(v.target_id) ?? [];
    lista.push(v.lead_id);
    leadsDoCompromisso.set(v.target_id, lista);
  }
  const agendaDoContato = new Map<string, CompromissoDoCartao[]>();
  for (const a of linhasDaAgenda) {
    const lista = agendaDoContato.get(a.contact_id) ?? [];
    lista.push({
      id: a.id,
      titulo: a.title,
      tipo: a.event_type_id ? (nomeDoTipo.get(a.event_type_id) ?? null) : null,
      localTipo: a.location_kind,
      localDetalhe: a.location_details,
      inicio: a.starts_at,
      fim: a.ends_at,
      fuso: a.time_zone,
      situacao: a.status,
      leadIds: leadsDoCompromisso.get(a.id) ?? [],
    });
    agendaDoContato.set(a.contact_id, lista);
  }

  const contatoPorId = new Map((contatos.data as LinhaDoContato[]).map((c) => [c.id, c]));
  const conversaPorId = new Map(
    (conversas.data as Array<{ id: string; last_inbound_at: string | null; last_outbound_at: string | null }>).map(
      (c) => [c.id, c],
    ),
  );
  const sinaisPorContato = new Map((sinais.data as LinhaDosSinais[]).map((s) => [s.contact_id, s]));

  const tarefasDoLead = new Map<string, { atrasadas: number; futuras: number }>();
  for (const t of tarefas.data as Array<{ lead_id: string; due_date: string | null }>) {
    const conta = tarefasDoLead.get(t.lead_id) ?? { atrasadas: 0, futuras: 0 };
    if (t.due_date && new Date(t.due_date).getTime() < agora.getTime()) conta.atrasadas += 1;
    else conta.futuras += 1;
    tarefasDoLead.set(t.lead_id, conta);
  }

  const envolvidosDoLead = new Map<string, Set<string>>();
  for (const e of envolvidos.data as Array<{ lead_id: string; target_id: string }>) {
    const s = envolvidosDoLead.get(e.lead_id) ?? new Set<string>();
    s.add(e.target_id);
    envolvidosDoLead.set(e.lead_id, s);
  }

  return leads.map((lead) => {
    const contato = lead.contact_id ? (contatoPorId.get(lead.contact_id) ?? null) : null;
    const anonimo = contato?.is_anonymized === true;
    const sinal = lead.contact_id ? sinaisPorContato.get(lead.contact_id) : undefined;
    const conversa = lead.conversa?.id ? conversaPorId.get(lead.conversa.id) : undefined;

    const bola = conversa
      ? bolaDaConversa({
          ultimaEntrada: conversa.last_inbound_at,
          ultimaSaida: conversa.last_outbound_at,
          saidaVia: sinal?.ultima_saida_via ?? null,
          saidaPor: sinal?.ultima_saida_por ?? null,
        })
      : null;

    const proximo = lead.contact_id
      ? escolherProximoCompromisso(agendaDoContato.get(lead.contact_id) ?? [], lead.id, agora)
      : null;

    const contagem = lead.empresa_id
      ? compras.porEmpresa.get(lead.empresa_id)
      : lead.contact_id
        ? compras.porContato.get(lead.contact_id)
        : undefined;

    const outros = [...(envolvidosDoLead.get(lead.id) ?? [])].filter((id) => id !== lead.contact_id).length;
    const nome = anonimo ? null : nomeDoContato(contato);

    const cartao: SinaisDoCartao = {
      canal: canalDoNegocio(
        {
          source: lead.source,
          source_metadata: lead.source_metadata,
          external_id: lead.external_id,
          tags: lead.tags,
          description: lead.description,
        },
        contato ? { source: contato.source, source_metadata: contato.source_metadata } : null,
      ),
      bola,
      compromisso: proximo,
      objecao: anonimo ? null : objecaoAberta(sinal?.objecoes),
      tarefasAtrasadas: tarefasDoLead.get(lead.id)?.atrasadas ?? 0,
      temTarefaFutura: (tarefasDoLead.get(lead.id)?.futuras ?? 0) > 0,
      // Só conta como "já comprou" o que é compra de fato; o próprio negócio,
      // aberto, nunca está na conta (a leitura é de `status = 'won'`).
      compras: contagem && contagem.quantidade > 0 ? contagem : null,
      pessoa:
        lead.empresa_id && nome
          ? {
              nome,
              cargo: contato?.cargo?.trim() || null,
              papel: contato?.papel_na_empresa ?? null,
              outros,
            }
          : null,
      contatoNome: nome,
      chanceDaEtapa: chanceDaEtapa.get(lead.stage_id) ?? null,
      obrigacao: obrigacoes.get(lead.id) ?? null,
    };

    return {
      ...lead,
      cartao,
      // A bola também viaja na conversa: é a linha da conversa do cartão
      // (`ConversaSlot`) que a mostra, e ela só recebe `lead.conversa`.
      ...(lead.conversa && bola ? { conversa: { ...lead.conversa, bola } } : {}),
    };
  });
}
