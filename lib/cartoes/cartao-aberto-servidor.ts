/**
 * FORK MIA — a leitura do CARTÃO ABERTO, numa ida ao servidor.
 *
 * Servidor, com o cliente de SESSÃO (a RLS do usuário vale) e `organization_id`
 * filtrado à mão em toda consulta. A única leitura com o cliente de serviço é a
 * das conversões enviadas (`ad_conversion_dispatches` não tem policy de sessão:
 * é livro-razão da plataforma) — e ela recebe a organização resolvida do
 * cookie, nunca do corpo, e filtra por ela e pelo negócio que a RLS já provou
 * ser da organização.
 *
 * Nenhuma leitura aqui é obrigatória para a tela abrir: cada bloco que falha
 * volta vazio, e o cartão aberto mostra o resto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { origemDoContato } from "@/lib/leads/origem-do-contato";
import { canalDoNegocio } from "@/lib/cartoes/canal";
import { resumirCompras } from "@/lib/cartoes/compras";
import { listarComprasDaEmpresa, listarComprasDoContato } from "@/lib/cartoes/compras-servidor";
import type { CompromissoDoCartao } from "@/lib/cartoes/compromisso";
import { diasPorEtapa, trocasDasAtividades } from "@/lib/cartoes/etapas";
import {
  resumoDaIa,
  semCodigosDeRastreio,
  situacaoDaConversao,
  type CartaoAberto,
  type OrigemPorPlataforma,
  type PessoaDoNegocio,
} from "@/lib/cartoes/cartao-aberto";
import { UTM_SOURCES_DA_META } from "@/lib/conversoes/leitura-da-atribuicao";
import { rotuloDoEnvioDaMeta } from "@/lib/conversoes-meta/rotulo";

type Db = SupabaseClient;

/** O vínculo "contato envolvido neste negócio" em `crm_lead_links`. */
export const VINCULO_DE_ENVOLVIDO = "envolvido";

interface LinhaDoNegocio {
  id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
  empresa_id: string | null;
  created_at: string;
  closed_at: string | null;
  source: string | null;
  source_metadata: Record<string, unknown> | null;
  external_id: string | null;
  tags: string[] | null;
  description: string | null;
}

async function seguro<T>(p: PromiseLike<{ data: T | null; error: unknown }>, vazio: T): Promise<T> {
  try {
    const r = await p;
    return r.error ? vazio : (r.data ?? vazio);
  } catch {
    return vazio;
  }
}

export async function montarCartaoAberto(
  db: Db,
  admin: Db | null,
  org: string,
  leadId: string,
  agora: Date = new Date(),
): Promise<CartaoAberto | null> {
  const { data: bruto, error } = await db
    .from("crm_leads")
    .select(
      "id, pipeline_id, stage_id, contact_id, empresa_id, created_at, closed_at, source, source_metadata, external_id, tags, description",
    )
    .eq("organization_id", org)
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!bruto) return null;
  const lead = bruto as LinhaDoNegocio;
  const contatoId = lead.contact_id;

  const [etapas, trocas, estado, retratos, contato, envolvidos, outros, primeira, agenda, conversoes] =
    await Promise.all([
      seguro(
        db
          .from("crm_stages")
          .select("id, name, position, is_won, is_lost")
          .eq("organization_id", org)
          .eq("pipeline_id", lead.pipeline_id)
          .eq("is_archived", false)
          .order("position"),
        [] as Array<{ id: string; name: string; position: number; is_won: boolean; is_lost: boolean }>,
      ),
      seguro(
        db
          .from("crm_lead_activities")
          .select("type, performed_at, payload")
          .eq("organization_id", org)
          .eq("lead_id", leadId)
          .eq("type", "stage_changed")
          .order("performed_at", { ascending: true })
          .limit(500),
        [] as Array<{ type: string; performed_at: string; payload: Record<string, unknown> | null }>,
      ),
      contatoId
        ? seguro(
            db
              .from("lead_state")
              .select("stage, qualification, updated_at")
              .eq("organization_id", org)
              .eq("contact_id", contatoId)
              .maybeSingle(),
            null as { stage: string; qualification: unknown; updated_at: string } | null,
          )
        : Promise.resolve(null),
      contatoId
        ? seguro(
            db
              .from("lead_checkpoints")
              .select("objections, commitments, declaracao, rolling_summary, created_at")
              .eq("organization_id", org)
              .eq("contact_id", contatoId)
              .order("seq", { ascending: false })
              .limit(12),
            [] as Array<{ objections: unknown; commitments: unknown; declaracao: unknown; rolling_summary: string | null; created_at: string }>,
          )
        : Promise.resolve([]),
      contatoId
        ? seguro(
            db
              .from("contacts")
              .select("id, name, display_name, phone_number, source, source_metadata, cargo, empresa_id, is_anonymized, created_at")
              .eq("organization_id", org)
              .eq("id", contatoId)
              .maybeSingle(),
            null as {
              id: string;
              name: string | null;
              display_name: string | null;
              phone_number: string | null;
              source: string | null;
              source_metadata: Record<string, unknown> | null;
              cargo: string | null;
              empresa_id: string | null;
              is_anonymized: boolean;
              created_at: string;
            } | null,
          )
        : Promise.resolve(null),
      seguro(
        db
          .from("crm_lead_links")
          .select("target_id, metadata")
          .eq("organization_id", org)
          .eq("lead_id", leadId)
          .eq("target_kind", "contact"),
        [] as Array<{ target_id: string; metadata: Record<string, unknown> | null }>,
      ),
      contatoId
        ? seguro(
            db
              .from("crm_leads")
              .select("id, title, status, stage_id, value_cents, currency, lost_reason")
              .eq("organization_id", org)
              .eq("contact_id", contatoId)
              .neq("id", leadId)
              .neq("status", "archived")
              .order("updated_at", { ascending: false })
              .limit(20),
            [] as Array<{ id: string; title: string; status: string; stage_id: string; value_cents: number | null; currency: string | null; lost_reason: string | null }>,
          )
        : Promise.resolve([]),
      contatoId
        ? seguro(
            db
              .from("messages")
              .select("body, sent_at")
              .eq("organization_id", org)
              .eq("contact_id", contatoId)
              .eq("direction", "inbound")
              .order("sent_at", { ascending: true })
              .limit(1)
              .maybeSingle(),
            null as { body: string | null; sent_at: string } | null,
          )
        : Promise.resolve(null),
      contatoId
        ? seguro(
            db
              .from("calendar_appointments")
              .select(
                "id, title, event_type_id, location_kind, location_details, starts_at, ends_at, time_zone, status",
              )
              .eq("organization_id", org)
              .eq("contact_id", contatoId)
              .order("starts_at", { ascending: false })
              .limit(20),
            [] as Array<{
              id: string;
              title: string;
              event_type_id: string | null;
              location_kind: string | null;
              location_details: string | null;
              starts_at: string;
              ends_at: string;
              time_zone: string;
              status: string;
            }>,
          )
        : Promise.resolve([]),
      admin
        ? seguro(
            admin
              .from("ad_conversion_dispatches")
              .select("platform, event_name, meta_event_name, status, reason, attempted_at, event_occurred_at, value_cents, currency, detail")
              .eq("organization_id", org)
              .eq("lead_id", leadId)
              .order("attempted_at", { ascending: false }),
            [] as Array<{
              platform: string;
              event_name: string;
              meta_event_name: string | null;
              status: string;
              reason: string | null;
              attempted_at: string | null;
              event_occurred_at: string | null;
              value_cents: number | null;
              currency: string | null;
              detail: string | null;
            }>,
          )
        : Promise.resolve([]),
    ]);

  // ─── etapas ────────────────────────────────────────────────────────────────
  const barra = diasPorEtapa({
    etapas: etapas.map((e) => ({ id: e.id, nome: e.name, posicao: e.position })),
    etapaAtualId: lead.stage_id,
    criadoEm: lead.created_at,
    encerradoEm: lead.closed_at,
    trocas: trocasDasAtividades(trocas),
    agora,
  });
  const nomeDaEtapa = new Map(etapas.map((e) => [e.id, e.name]));
  // Os outros negócios da pessoa podem estar em outro funil.
  const etapasDeFora = [...new Set(outros.map((o) => o.stage_id))].filter((id) => !nomeDaEtapa.has(id));
  if (etapasDeFora.length > 0) {
    const deFora = await seguro(
      db.from("crm_stages").select("id, name").eq("organization_id", org).in("id", etapasDeFora),
      [] as Array<{ id: string; name: string }>,
    );
    for (const e of deFora) nomeDaEtapa.set(e.id, e.name);
  }

  // ─── pessoas (principal + envolvidas) ──────────────────────────────────────
  const idsEnvolvidos = envolvidos.map((e) => e.target_id).filter((id) => id !== contatoId);
  const idsDasPessoas = [...new Set([...(contatoId ? [contatoId] : []), ...idsEnvolvidos])];
  const [pessoasBrutas, conversasDasPessoas] = await Promise.all([
    idsEnvolvidos.length > 0
      ? seguro(
          db
            .from("contacts")
            .select("id, name, display_name, phone_number, cargo, is_anonymized")
            .eq("organization_id", org)
            .in("id", idsEnvolvidos),
          [] as Array<{ id: string; name: string | null; display_name: string | null; phone_number: string | null; cargo: string | null; is_anonymized: boolean }>,
        )
      : Promise.resolve([]),
    idsDasPessoas.length > 0
      ? seguro(
          db
            .from("conversations")
            .select("id, contact_id")
            .eq("organization_id", org)
            .in("contact_id", idsDasPessoas)
            .order("last_message_at", { ascending: false, nullsFirst: false }),
          [] as Array<{ id: string; contact_id: string }>,
        )
      : Promise.resolve([]),
  ]);
  const conversaDe = new Map<string, string>();
  for (const c of conversasDasPessoas) if (!conversaDe.has(c.contact_id)) conversaDe.set(c.contact_id, c.id);
  const papelNoNegocio = new Map(
    envolvidos.map((e) => [e.target_id, typeof e.metadata?.papel === "string" ? (e.metadata.papel as string) : null]),
  );

  const pessoas: PessoaDoNegocio[] = [];
  if (contato) {
    pessoas.push({
      contatoId: contato.id,
      nome: contato.is_anonymized ? null : nomeDoContato(contato),
      telefone: contato.is_anonymized ? null : contato.phone_number,
      cargo: contato.is_anonymized ? null : contato.cargo,
      papel: papelNoNegocio.get(contato.id) ?? null,
      principal: true,
      conversaId: conversaDe.get(contato.id) ?? null,
    });
  }
  for (const p of pessoasBrutas) {
    pessoas.push({
      contatoId: p.id,
      nome: p.is_anonymized ? null : nomeDoContato(p),
      telefone: p.is_anonymized ? null : p.phone_number,
      cargo: p.is_anonymized ? null : p.cargo,
      papel: papelNoNegocio.get(p.id) ?? null,
      principal: false,
      conversaId: conversaDe.get(p.id) ?? null,
    });
  }

  // ─── empresa ───────────────────────────────────────────────────────────────
  const idDaEmpresa = lead.empresa_id ?? contato?.empresa_id ?? null;
  const empresaBruta = idDaEmpresa
    ? await seguro(
        db
          .from("crm_empresas")
          .select("id, nome, cnpj, telefone, site")
          .eq("organization_id", org)
          .eq("id", idDaEmpresa)
          .maybeSingle(),
        null as { id: string; nome: string; cnpj: string | null; telefone: string | null; site: string | null } | null,
      )
    : null;
  const empresa = lead.empresa_id ? empresaBruta : null;
  const empresaDoContato =
    !lead.empresa_id && empresaBruta ? { id: empresaBruta.id, nome: empresaBruta.nome } : null;

  // ─── compras ───────────────────────────────────────────────────────────────
  let compras: CartaoAberto["compras"] = null;
  try {
    const lista = lead.empresa_id
      ? await listarComprasDaEmpresa(db, org, lead.empresa_id)
      : contatoId
        ? await listarComprasDoContato(db, org, contatoId)
        : [];
    compras = resumirCompras(lista, agora);
  } catch {
    compras = null;
  }

  // ─── origem ────────────────────────────────────────────────────────────────
  const metaDoLead = lead.source_metadata ?? {};
  const metaDoContato = contato?.source_metadata ?? {};
  const niveis = origemDoContato({ ...metaDoContato, ...metaDoLead }, lead.source ?? "manual");
  const idDoAnuncio = typeof metaDoContato.ad_id === "string" && metaDoContato.ad_id.trim() !== "";
  const clique =
    (typeof metaDoContato.ad_source_id === "string" && metaDoContato.ad_source_id.trim() !== "") ||
    (typeof metaDoLead.ad_source_id === "string" && metaDoLead.ad_source_id.trim() !== "");
  const primeiroToqueEm =
    (typeof metaDoContato.ad_captured_at === "string" && metaDoContato.ad_captured_at) ||
    (typeof metaDoContato.origem_capturada_em === "string" && metaDoContato.origem_capturada_em) ||
    contato?.created_at ||
    null;

  const conversoesDoNegocio = conversoes.map((c) => {
    // As duas réguas por etapa são do upstream: `Etapa:<uuid>` (Google, 0436) e
    // `MetaEtapa:<uuid>` (Meta, 0524). O nome da etapa vem do funil deste negócio.
    const etapa = c.event_name.startsWith("MetaEtapa:")
      ? c.event_name.slice("MetaEtapa:".length)
      : c.event_name.startsWith("Etapa:")
        ? c.event_name.slice("Etapa:".length)
        : null;
    const evento = etapa ? `Etapa: ${nomeDaEtapa.get(etapa) ?? "—"}` : c.event_name;
    return {
      plataforma: c.platform,
      evento,
      situacao: situacaoDaConversao(c.status, c.reason),
      motivo: c.reason,
      quando: c.status === "sent" ? (c.attempted_at ?? c.event_occurred_at) : c.attempted_at,
      // O nome que a pessoa reconhece: a compra e o evento de etapa da Meta (o
      // retrato do que saiu, `meta_event_name`) têm rótulo próprio; a etapa do
      // Google já vem com o nome da etapa.
      rotulo:
        rotuloDoEnvioDaMeta(c.event_name, c.meta_event_name) ??
        (c.event_name === "QualifiedLead" ? "Lead qualificado" : evento),
      valorCentavos: typeof c.value_cents === "number" && c.value_cents > 0 ? c.value_cents : null,
      moeda: c.currency ?? null,
      detalhe: c.status === "error" ? (c.detail ?? null) : null,
    };
  });

  // De qual plataforma este negócio veio. É a mesma leitura do consumidor das
  // conversões: o clique mora na origem do CONTATO; o formulário, no negócio.
  const plataformaDoClique =
    typeof metaDoContato.ad_source_id === "string" && metaDoContato.ad_source_id.trim() !== ""
      ? metaDoContato.ad_platform
      : null;
  // A página com UTM da Meta (upstream 1.70, #2076): quem chegou pelo site
  // vindo de anúncio da Meta também é informado à Meta, pelo telefone.
  const pelaPaginaDaMeta =
    plataformaDoClique === null &&
    metaDoContato.ad_platform === "site" &&
    typeof metaDoContato.utm_source === "string" &&
    UTM_SOURCES_DA_META.has(metaDoContato.utm_source.trim().toLowerCase());
  const origemPorPlataforma: OrigemPorPlataforma = {
    meta_ads:
      plataformaDoClique === "meta_ads"
        ? "clique"
        : pelaPaginaDaMeta
          ? "pagina"
          : typeof metaDoLead.meta_lead_id === "string" && metaDoLead.meta_lead_id.trim() !== ""
            ? "formulario"
            : null,
    google_ads: plataformaDoClique === "google_ads" ? "clique" : null,
  };

  const anonimo = contato?.is_anonymized === true;
  const primeiraMensagem =
    !anonimo && primeira?.body ? { texto: semCodigosDeRastreio(primeira.body), em: primeira.sent_at } : null;

  // ─── agenda ────────────────────────────────────────────────────────────────
  const idsDaAgenda = agenda.map((a) => a.id);
  const idsDosTipos = [...new Set(agenda.map((a) => a.event_type_id).filter((t): t is string => !!t))];
  const [vinculos, tipos] = await Promise.all([
    idsDaAgenda.length > 0
      ? seguro(
          db
            .from("crm_lead_links")
            .select("lead_id, target_id")
            .eq("organization_id", org)
            .eq("target_kind", "appointment")
            .in("target_id", idsDaAgenda),
          [] as Array<{ lead_id: string; target_id: string }>,
        )
      : Promise.resolve([]),
    idsDosTipos.length > 0
      ? seguro(
          db.from("calendar_event_types").select("id, name").eq("organization_id", org).in("id", idsDosTipos),
          [] as Array<{ id: string; name: string }>,
        )
      : Promise.resolve([]),
  ]);
  const nomeDoTipo = new Map(tipos.map((t) => [t.id, t.name]));
  const leadsDoCompromisso = new Map<string, string[]>();
  for (const v of vinculos) {
    const lista = leadsDoCompromisso.get(v.target_id) ?? [];
    lista.push(v.lead_id);
    leadsDoCompromisso.set(v.target_id, lista);
  }
  const doNegocio: Array<CompromissoDoCartao & { resultado: string | null }> = agenda
    .map((a) => ({
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
      resultado: a.status === "completed" || a.status === "no_show" || a.status === "cancelled" ? a.status : null,
    }))
    // O do negócio, ou o do contato que não é de outro negócio (a mesma régua do cartão fechado).
    .filter((a) => a.leadIds.length === 0 || a.leadIds.includes(leadId));

  return {
    etapas: barra,
    resumo: anonimo ? null : resumoDaIa(estado, retratos),
    origem: {
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
      campanha: niveis.campanha,
      conjunto: niveis.conjunto,
      anuncio: niveis.anuncio,
      anuncioSemNome: idDoAnuncio && !niveis.campanha,
      primeiraMensagem,
      primeiroToque: primeiroToqueEm ? { em: primeiroToqueEm } : null,
      conversoes: conversoesDoNegocio,
      semClique: !clique,
      origemPorPlataforma,
    },
    pessoas,
    outrosNegocios: outros.map((o) => ({
      id: o.id,
      titulo: o.title,
      status: o.status,
      etapa: nomeDaEtapa.get(o.stage_id) ?? null,
      valorCents: o.value_cents,
      moeda: o.currency,
      motivoDaPerda: o.lost_reason,
    })),
    empresa,
    empresaDoContato,
    compras,
    agenda: doNegocio,
  };
}
