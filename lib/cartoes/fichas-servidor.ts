/**
 * FORK MIA — as FICHAS CONECTADAS: a do contato e a da empresa.
 *
 * O que cada ficha junta, e de onde:
 *
 *   contato → empresa (contacts.empresa_id + cargo/papel/principal, 9013),
 *             negócios (os dele E aqueles em que ele está envolvido),
 *             conversas, resumo da IA (lead_state + lead_checkpoints),
 *             memória da IA (lead_notes), agenda, compras (dele e da empresa)
 *   empresa → pessoas com papel e o principal, negócios (etapa, funil, dono),
 *             números (abertos, total comprado, última interação, mais quente)
 *             e as compras de todas as pessoas dela
 *
 * Servidor, cliente de SESSÃO (RLS do usuário) e `organization_id` à mão em
 * toda consulta. Cada bloco que falha volta vazio: a ficha abre com o resto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { resumirCompras, type ResumoDeCompras } from "@/lib/cartoes/compras";
import { listarComprasDaEmpresa, listarComprasDoContato } from "@/lib/cartoes/compras-servidor";
import type { CompromissoDoCartao } from "@/lib/cartoes/compromisso";
import { resumoDaIa, type ResumoDaIa } from "@/lib/cartoes/cartao-aberto";

type Db = SupabaseClient;

async function seguro<T>(p: PromiseLike<{ data: T | null; error: unknown }>, vazio: T): Promise<T> {
  try {
    const r = await p;
    return r.error ? vazio : (r.data ?? vazio);
  } catch {
    return vazio;
  }
}

export interface NegocioDaFicha {
  id: string;
  titulo: string;
  status: string;
  etapa: string | null;
  funil: string | null;
  valorCents: number | null;
  moeda: string | null;
  donoUserId: string | null;
  donoKind: string | null;
  motivoDaPerda: string | null;
  empresaId: string | null;
  /** O papel da pessoa quando ela está no negócio como ENVOLVIDA (não principal). */
  envolvidoComo: string | null;
  probabilidade: number | null;
}

export interface FichaDoContato {
  empresa: { id: string; nome: string; cnpj: string | null; cargo: string | null; papel: string | null; principal: boolean } | null;
  negocios: NegocioDaFicha[];
  conversas: Array<{ id: string; preview: string | null; ultimaEm: string | null; naoLidas: number; status: string }>;
  estagio: string | null;
  resumo: ResumoDaIa | null;
  memoria: Array<{ id: string; titulo: string; corpo: string; em: string }>;
  agenda: Array<CompromissoDoCartao & { resultado: string | null }>;
  compras: ResumoDeCompras | null;
  /** As compras somadas de TODA a empresa, quando ela tem mais que esta pessoa. */
  comprasDaEmpresa: { quantidade: number; totalCents: number; moeda: string } | null;
}

async function nomesDeEtapasEFunis(db: Db, org: string, stageIds: string[], pipelineIds: string[]) {
  const [etapas, funis] = await Promise.all([
    stageIds.length
      ? seguro(db.from("crm_stages").select("id, name").eq("organization_id", org).in("id", stageIds), [] as Array<{ id: string; name: string }>)
      : Promise.resolve([]),
    pipelineIds.length
      ? seguro(db.from("crm_pipelines").select("id, name").eq("organization_id", org).in("id", pipelineIds), [] as Array<{ id: string; name: string }>)
      : Promise.resolve([]),
  ]);
  return { etapa: new Map(etapas.map((e) => [e.id, e.name])), funil: new Map(funis.map((f) => [f.id, f.name])) };
}

type LinhaDoNegocio = {
  id: string;
  title: string;
  status: string;
  stage_id: string;
  pipeline_id: string;
  value_cents: number | null;
  currency: string | null;
  owner_user_id: string | null;
  owner_kind: string | null;
  lost_reason: string | null;
  empresa_id: string | null;
};
const COLUNAS_DO_NEGOCIO =
  "id, title, status, stage_id, pipeline_id, value_cents, currency, owner_user_id, owner_kind, lost_reason, empresa_id";

async function montarNegocios(db: Db, org: string, linhas: LinhaDoNegocio[], papelDe: Map<string, string | null>) {
  const ids = linhas.map((l) => l.id);
  const [nomes, scores] = await Promise.all([
    nomesDeEtapasEFunis(db, org, [...new Set(linhas.map((l) => l.stage_id))], [...new Set(linhas.map((l) => l.pipeline_id))]),
    ids.length
      ? seguro(
          db.from("crm_lead_scores").select("lead_id, ai_probability").eq("organization_id", org).in("lead_id", ids),
          [] as Array<{ lead_id: string; ai_probability: number | string | null }>,
        )
      : Promise.resolve([]),
  ]);
  const prob = new Map(scores.map((s) => [s.lead_id, s.ai_probability === null ? null : Number(s.ai_probability)]));
  const ordem = (s: string) => (s === "open" ? 0 : s === "won" ? 1 : 2);
  return linhas
    .map<NegocioDaFicha>((l) => ({
      id: l.id,
      titulo: l.title,
      status: l.status,
      etapa: nomes.etapa.get(l.stage_id) ?? null,
      funil: nomes.funil.get(l.pipeline_id) ?? null,
      valorCents: l.value_cents,
      moeda: l.currency,
      donoUserId: l.owner_user_id,
      donoKind: l.owner_kind,
      motivoDaPerda: l.lost_reason,
      empresaId: l.empresa_id,
      envolvidoComo: papelDe.has(l.id) ? (papelDe.get(l.id) ?? "") : null,
      probabilidade: prob.get(l.id) ?? null,
    }))
    .sort((a, b) => ordem(a.status) - ordem(b.status));
}

export async function montarFichaDoContato(db: Db, org: string, contatoId: string, agora = new Date()): Promise<FichaDoContato | null> {
  const contato = await seguro(
    db
      .from("contacts")
      .select("id, empresa_id, cargo, papel_na_empresa, principal_na_empresa, is_anonymized")
      .eq("organization_id", org)
      .eq("id", contatoId)
      .maybeSingle(),
    null as { id: string; empresa_id: string | null; cargo: string | null; papel_na_empresa: string | null; principal_na_empresa: boolean; is_anonymized: boolean } | null,
  );
  if (!contato) return null;
  const anonimo = contato.is_anonymized;

  const [proprios, vinculos, conversas, estado, retratos, notas, agenda, empresa] = await Promise.all([
    seguro(
      db.from("crm_leads").select(COLUNAS_DO_NEGOCIO).eq("organization_id", org).eq("contact_id", contatoId).neq("status", "archived").order("updated_at", { ascending: false }).limit(50),
      [] as LinhaDoNegocio[],
    ),
    seguro(
      db.from("crm_lead_links").select("lead_id, metadata").eq("organization_id", org).eq("target_kind", "contact").eq("target_id", contatoId),
      [] as Array<{ lead_id: string; metadata: Record<string, unknown> | null }>,
    ),
    seguro(
      db
        .from("conversations")
        .select("id, last_message_preview, last_message_at, unread_count_for_assignee, status")
        .eq("organization_id", org)
        .eq("contact_id", contatoId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(10),
      [] as Array<{ id: string; last_message_preview: string | null; last_message_at: string | null; unread_count_for_assignee: number | null; status: string }>,
    ),
    seguro(
      db.from("lead_state").select("stage, qualification, updated_at").eq("organization_id", org).eq("contact_id", contatoId).maybeSingle(),
      null as { stage: string; qualification: unknown; updated_at: string } | null,
    ),
    seguro(
      db
        .from("lead_checkpoints")
        .select("objections, commitments, declaracao, rolling_summary, created_at")
        .eq("organization_id", org)
        .eq("contact_id", contatoId)
        .order("seq", { ascending: false })
        .limit(12),
      [] as Array<{ objections: unknown; commitments: unknown; declaracao: unknown; rolling_summary: string | null; created_at: string }>,
    ),
    seguro(
      db.from("lead_notes").select("id, headline, body, created_at").eq("organization_id", org).eq("contact_id", contatoId).order("created_at", { ascending: false }).limit(30),
      [] as Array<{ id: string; headline: string; body: string; created_at: string }>,
    ),
    seguro(
      db
        .from("calendar_appointments")
        .select("id, title, event_type_id, location_kind, location_details, starts_at, ends_at, time_zone, status")
        .eq("organization_id", org)
        .eq("contact_id", contatoId)
        .order("starts_at", { ascending: false })
        .limit(20),
      [] as Array<{ id: string; title: string; event_type_id: string | null; location_kind: string | null; location_details: string | null; starts_at: string; ends_at: string; time_zone: string; status: string }>,
    ),
    contato.empresa_id
      ? seguro(
          db.from("crm_empresas").select("id, nome, cnpj").eq("organization_id", org).eq("id", contato.empresa_id).maybeSingle(),
          null as { id: string; nome: string; cnpj: string | null } | null,
        )
      : Promise.resolve(null),
  ]);

  // Os negócios em que a pessoa está como ENVOLVIDA, além dos dela.
  const idsProprios = new Set(proprios.map((p) => p.id));
  const idsDeFora = vinculos.map((v) => v.lead_id).filter((id) => !idsProprios.has(id));
  const deFora = idsDeFora.length
    ? await seguro(db.from("crm_leads").select(COLUNAS_DO_NEGOCIO).eq("organization_id", org).in("id", idsDeFora), [] as LinhaDoNegocio[])
    : [];
  const papelDe = new Map(
    vinculos.filter((v) => !idsProprios.has(v.lead_id)).map((v) => [v.lead_id, typeof v.metadata?.papel === "string" ? (v.metadata.papel as string) : null]),
  );
  const negocios = await montarNegocios(db, org, [...proprios, ...deFora], papelDe);

  const tipos = [...new Set(agenda.map((a) => a.event_type_id).filter((t): t is string => !!t))];
  const nomesDosTipos = tipos.length
    ? new Map(
        (await seguro(db.from("calendar_event_types").select("id, name").eq("organization_id", org).in("id", tipos), [] as Array<{ id: string; name: string }>)).map((t) => [t.id, t.name]),
      )
    : new Map<string, string>();

  let compras: ResumoDeCompras | null = null;
  let comprasDaEmpresa: FichaDoContato["comprasDaEmpresa"] = null;
  try {
    compras = resumirCompras(await listarComprasDoContato(db, org, contatoId), agora);
    if (contato.empresa_id) {
      const daEmpresa = resumirCompras(await listarComprasDaEmpresa(db, org, contato.empresa_id), agora);
      if (daEmpresa && daEmpresa.quantidade > (compras?.quantidade ?? 0)) {
        comprasDaEmpresa = { quantidade: daEmpresa.quantidade, totalCents: daEmpresa.totalCents, moeda: daEmpresa.moeda };
      }
    }
  } catch {
    compras = null;
  }

  return {
    empresa: empresa
      ? {
          id: empresa.id,
          nome: empresa.nome,
          cnpj: empresa.cnpj,
          cargo: contato.cargo,
          papel: contato.papel_na_empresa,
          principal: contato.principal_na_empresa,
        }
      : null,
    negocios,
    conversas: conversas.map((c) => ({
      id: c.id,
      preview: anonimo ? null : c.last_message_preview,
      ultimaEm: c.last_message_at,
      naoLidas: c.unread_count_for_assignee ?? 0,
      status: c.status,
    })),
    estagio: estado?.stage ?? null,
    resumo: anonimo ? null : resumoDaIa(estado, retratos),
    memoria: anonimo ? [] : notas.map((n) => ({ id: n.id, titulo: n.headline, corpo: n.body, em: n.created_at })),
    agenda: agenda.map((a) => ({
      id: a.id,
      titulo: a.title,
      tipo: a.event_type_id ? (nomesDosTipos.get(a.event_type_id) ?? null) : null,
      localTipo: a.location_kind,
      localDetalhe: a.location_details,
      inicio: a.starts_at,
      fim: a.ends_at,
      fuso: a.time_zone,
      situacao: a.status,
      leadIds: [],
      resultado: a.status === "completed" || a.status === "no_show" || a.status === "cancelled" ? a.status : null,
    })),
    compras,
    comprasDaEmpresa,
  };
}

// ─── empresa ─────────────────────────────────────────────────────────────────

export interface PessoaDaEmpresa {
  id: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  cargo: string | null;
  papel: string | null;
  principal: boolean;
  conversaId: string | null;
  ultimaAtividade: string | null;
}

export interface FichaDaEmpresa {
  pessoas: PessoaDaEmpresa[];
  negocios: NegocioDaFicha[];
  numeros: {
    abertos: number;
    abertosCents: number;
    moeda: string;
    ultimaInteracao: string | null;
    maisQuente: number | null;
  };
  compras: ResumoDeCompras | null;
}

export async function montarFichaDaEmpresa(db: Db, org: string, empresaId: string, agora = new Date()): Promise<FichaDaEmpresa> {
  const pessoasBrutas = await seguro(
    db
      .from("contacts")
      .select("id, name, display_name, phone_number, email, cargo, papel_na_empresa, principal_na_empresa, last_activity_at, is_anonymized")
      .eq("organization_id", org)
      .eq("empresa_id", empresaId)
      .limit(200),
    [] as Array<{
      id: string;
      name: string | null;
      display_name: string | null;
      phone_number: string | null;
      email: string | null;
      cargo: string | null;
      papel_na_empresa: string | null;
      principal_na_empresa: boolean;
      last_activity_at: string | null;
      is_anonymized: boolean;
    }>,
  );
  const ids = pessoasBrutas.map((p) => p.id);
  const [conversas, daEmpresa, dasPessoas] = await Promise.all([
    ids.length
      ? seguro(
          db.from("conversations").select("id, contact_id").eq("organization_id", org).in("contact_id", ids).order("last_message_at", { ascending: false, nullsFirst: false }),
          [] as Array<{ id: string; contact_id: string }>,
        )
      : Promise.resolve([]),
    seguro(db.from("crm_leads").select(COLUNAS_DO_NEGOCIO).eq("organization_id", org).eq("empresa_id", empresaId).neq("status", "archived"), [] as LinhaDoNegocio[]),
    ids.length
      ? seguro(db.from("crm_leads").select(COLUNAS_DO_NEGOCIO).eq("organization_id", org).in("contact_id", ids).neq("status", "archived"), [] as LinhaDoNegocio[])
      : Promise.resolve([]),
  ]);
  const conversaDe = new Map<string, string>();
  for (const c of conversas) if (!conversaDe.has(c.contact_id)) conversaDe.set(c.contact_id, c.id);

  const unicos = new Map<string, LinhaDoNegocio>();
  for (const n of [...daEmpresa, ...dasPessoas]) unicos.set(n.id, n);
  const negocios = await montarNegocios(db, org, [...unicos.values()], new Map());

  let compras: ResumoDeCompras | null = null;
  try {
    compras = resumirCompras(await listarComprasDaEmpresa(db, org, empresaId), agora);
  } catch {
    compras = null;
  }

  const abertos = negocios.filter((n) => n.status === "open");
  const moedas = new Map<string, number>();
  for (const n of abertos) moedas.set(n.moeda ?? "BRL", (moedas.get(n.moeda ?? "BRL") ?? 0) + 1);
  const moeda = [...moedas.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "BRL";
  const probs = abertos.map((n) => n.probabilidade).filter((p): p is number => typeof p === "number");
  const ultimas = pessoasBrutas.map((p) => p.last_activity_at).filter((d): d is string => !!d).sort();

  return {
    pessoas: pessoasBrutas
      .map((p) => ({
        id: p.id,
        nome: p.is_anonymized ? null : nomeDoContato(p),
        telefone: p.is_anonymized ? null : p.phone_number,
        email: p.is_anonymized ? null : p.email,
        cargo: p.is_anonymized ? null : p.cargo,
        papel: p.papel_na_empresa,
        principal: p.principal_na_empresa,
        conversaId: conversaDe.get(p.id) ?? null,
        ultimaAtividade: p.last_activity_at,
      }))
      .sort((a, b) => Number(b.principal) - Number(a.principal) || (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR")),
    negocios,
    numeros: {
      abertos: abertos.length,
      abertosCents: abertos.filter((n) => (n.moeda ?? "BRL") === moeda).reduce((s, n) => s + (n.valorCents ?? 0), 0),
      moeda,
      ultimaInteracao: ultimas[ultimas.length - 1] ?? null,
      maisQuente: probs.length ? Math.round(Math.max(...probs)) : null,
    },
    compras,
  };
}
