/**
 * FORK MIA — as FICHAS CONECTADAS: a do contato e a da empresa.
 *
 * O que cada ficha junta, e de onde:
 *
 *   contato → empresa (a do cartão: contacts.empresa_id + cargo/papel/principal,
 *             o espelho do vínculo), TODAS as empresas dele (company_people,
 *             9034) e os outros números da mesma pessoa (contacts.person_id),
 *             negócios (os dele E aqueles em que ele está envolvido),
 *             conversas, resumo da IA (lead_state + lead_checkpoints),
 *             memória da IA (lead_notes), agenda, compras (dele e da empresa)
 *   empresa → pessoas com papel e o principal (company_people, uma linha por
 *             pessoa com todos os números dela e as outras empresas em que ela
 *             está), negócios (etapa, funil, dono),
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
import { nomeDaEmpresa, type LinhaDaEmpresa } from "@/lib/empresas/fonte-unica";

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

/** Um vínculo da pessoa com uma empresa (company_people), para a ficha do contato. */
export interface EmpresaDoContato {
  id: string;
  nome: string;
  cnpj: string | null;
  cargo: string | null;
  setor: string | null;
  papel: string | null;
  principal: boolean;
  /** É a que aparece no cartão (contacts.empresa_id). */
  noCartao: boolean;
}

export interface FichaDoContato {
  /** A empresa do CARTÃO (a que o quadro e o atendimento mostram). */
  empresa: { id: string; nome: string; cnpj: string | null; cargo: string | null; papel: string | null; principal: boolean } | null;
  /** FORK MIA (.79): TODAS as empresas da pessoa, a do cartão primeiro. */
  empresas: EmpresaDoContato[];
  /** FORK MIA (.79): os outros números da mesma pessoa (cada um com a sua conversa). */
  outrosNumeros: Array<{ id: string; telefone: string | null; nome: string | null }>;
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
      .select("id, person_id, empresa_id, cargo, papel_na_empresa, principal_na_empresa, is_anonymized")
      .eq("organization_id", org)
      .eq("id", contatoId)
      .maybeSingle(),
    null as {
      id: string;
      person_id: string | null;
      empresa_id: string | null;
      cargo: string | null;
      papel_na_empresa: string | null;
      principal_na_empresa: boolean;
      is_anonymized: boolean;
    } | null,
  );
  if (!contato) return null;
  const anonimo = contato.is_anonymized;

  // FORK MIA (.79): os outros números da mesma pessoa e os vínculos dela.
  // Vários números = uma pessoa: a ficha, a empresa e os negócios são um só.
  const [outrosDaPessoa, vinculosDaPessoa] = contato.person_id && !anonimo
    ? await Promise.all([
        seguro(
          db
            .from("contacts")
            .select("id, name, display_name, phone_number")
            .eq("organization_id", org)
            .eq("person_id", contato.person_id)
            .neq("id", contatoId)
            .is("is_merged_into", null)
            .eq("is_anonymized", false)
            .order("created_at", { ascending: true })
            .limit(20),
          [] as Array<{ id: string; name: string | null; display_name: string | null; phone_number: string | null }>,
        ),
        seguro(
          db
            .from("company_people")
            .select("company_id, job_title, department, papel, is_primary, created_at")
            .eq("organization_id", org)
            .eq("person_id", contato.person_id)
            .order("created_at", { ascending: true }),
          [] as Array<{ company_id: string; job_title: string | null; department: string | null; papel: string | null; is_primary: boolean; created_at: string }>,
        ),
      ])
    : [[], []];
  const idsDaPessoa = [contatoId, ...outrosDaPessoa.map((o) => o.id)];

  const [proprios, vinculos, conversas, estado, retratos, notas, agenda, empresasLidas] = await Promise.all([
    seguro(
      db.from("crm_leads").select(COLUNAS_DO_NEGOCIO).eq("organization_id", org).in("contact_id", idsDaPessoa).neq("status", "archived").order("updated_at", { ascending: false }).limit(50),
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
    // A empresa do cartão e as outras empresas da pessoa, do cadastro único.
    (async () => {
      const ids = [...new Set([...(contato.empresa_id ? [contato.empresa_id] : []), ...vinculosDaPessoa.map((v) => v.company_id)])];
      if (ids.length === 0) return new Map<string, { nome: string; cnpj: string | null }>();
      const linhas = await seguro(
        db.from("companies").select("id, trade_name, legal_name, normalized_cnpj").eq("organization_id", org).in("id", ids),
        [] as Array<Pick<LinhaDaEmpresa, "id" | "trade_name" | "legal_name" | "normalized_cnpj">>,
      );
      return new Map(linhas.map((l) => [l.id, { nome: nomeDaEmpresa(l), cnpj: l.normalized_cnpj }]));
    })(),
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

  const doCartao = contato.empresa_id ? empresasLidas.get(contato.empresa_id) : undefined;
  const empresas: EmpresaDoContato[] = vinculosDaPessoa
    .filter((v) => empresasLidas.has(v.company_id))
    .map((v) => ({
      id: v.company_id,
      nome: empresasLidas.get(v.company_id)!.nome,
      cnpj: empresasLidas.get(v.company_id)!.cnpj,
      cargo: anonimo ? null : v.job_title,
      setor: anonimo ? null : v.department,
      papel: v.papel,
      principal: v.is_primary,
      noCartao: v.company_id === contato.empresa_id,
    }))
    .sort((a, b) => Number(b.noCartao) - Number(a.noCartao));

  return {
    empresa:
      contato.empresa_id && doCartao
        ? {
            id: contato.empresa_id,
            nome: doCartao.nome,
            cnpj: doCartao.cnpj,
            cargo: contato.cargo,
            papel: contato.papel_na_empresa,
            principal: contato.principal_na_empresa,
          }
        : null,
    empresas,
    outrosNumeros: outrosDaPessoa.map((o) => ({ id: o.id, telefone: o.phone_number, nome: nomeDoContato(o) })),
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

/**
 * Uma PESSOA da empresa (o vínculo de `company_people`), com todos os números
 * dela. `id` é o do primeiro número vivo: é por ele que a ficha leva ao contato
 * e à conversa.
 */
export interface PessoaDaEmpresa {
  id: string;
  /** A pessoa do upstream (`people`): quem tem vários números aparece uma vez. */
  pessoaId: string;
  nome: string | null;
  telefone: string | null;
  /** Todos os números da pessoa, o primeiro igual a `telefone`. */
  telefones: string[];
  email: string | null;
  cargo: string | null;
  papel: string | null;
  principal: boolean;
  conversaId: string | null;
  ultimaAtividade: string | null;
  /** As OUTRAS empresas em que a mesma pessoa está ("Também está em"). */
  outrasEmpresas: Array<{ id: string; nome: string }>;
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

type ContatoDaPessoa = {
  id: string;
  person_id: string;
  name: string | null;
  display_name: string | null;
  phone_number: string | null;
  email: string | null;
  last_activity_at: string | null;
  is_anonymized: boolean;
  created_at: string;
};

export async function montarFichaDaEmpresa(db: Db, org: string, empresaId: string, agora = new Date()): Promise<FichaDaEmpresa> {
  // FORK MIA (.79, empresa única): as pessoas vêm do vínculo do cadastro único
  // (`company_people`, com o nosso `papel`), e cada uma aparece UMA vez com
  // todos os números dela. Antes era `contacts.empresa_id`: uma pessoa, uma
  // empresa e um número.
  const vinculos = await seguro(
    db
      .from("company_people")
      .select("person_id, job_title, papel, is_primary")
      .eq("organization_id", org)
      .eq("company_id", empresaId)
      .limit(500),
    [] as Array<{ person_id: string; job_title: string | null; papel: string | null; is_primary: boolean }>,
  );
  const idsDasPessoas = vinculos.map((v) => v.person_id);
  const [contatosBrutos, outrosVinculos] = idsDasPessoas.length
    ? await Promise.all([
        seguro(
          db
            .from("contacts")
            .select("id, person_id, name, display_name, phone_number, email, last_activity_at, is_anonymized, created_at")
            .eq("organization_id", org)
            .in("person_id", idsDasPessoas)
            .is("is_merged_into", null)
            .order("created_at", { ascending: true })
            .limit(1000),
          [] as ContatoDaPessoa[],
        ),
        seguro(
          db
            .from("company_people")
            .select("person_id, company_id")
            .eq("organization_id", org)
            .in("person_id", idsDasPessoas)
            .neq("company_id", empresaId),
          [] as Array<{ person_id: string; company_id: string }>,
        ),
      ])
    : [[] as ContatoDaPessoa[], [] as Array<{ person_id: string; company_id: string }>];

  const idsDosContatos = contatosBrutos.map((c) => c.id);
  const idsDasOutras = [...new Set(outrosVinculos.map((v) => v.company_id))];
  const [conversas, daEmpresa, semEmpresaDasPessoas, outrasEmpresas] = await Promise.all([
    idsDosContatos.length
      ? seguro(
          db.from("conversations").select("id, contact_id").eq("organization_id", org).in("contact_id", idsDosContatos).order("last_message_at", { ascending: false, nullsFirst: false }),
          [] as Array<{ id: string; contact_id: string }>,
        )
      : Promise.resolve([] as Array<{ id: string; contact_id: string }>),
    seguro(db.from("crm_leads").select(COLUNAS_DO_NEGOCIO).eq("organization_id", org).eq("empresa_id", empresaId).neq("status", "archived"), [] as LinhaDoNegocio[]),
    // Os negócios SEM empresa das pessoas dela (os de antes de a empresa existir
    // no cadastro). O de outra empresa fica na ficha da outra.
    idsDosContatos.length
      ? seguro(
          db.from("crm_leads").select(COLUNAS_DO_NEGOCIO).eq("organization_id", org).in("contact_id", idsDosContatos).is("empresa_id", null).neq("status", "archived"),
          [] as LinhaDoNegocio[],
        )
      : Promise.resolve([] as LinhaDoNegocio[]),
    idsDasOutras.length
      ? seguro(
          db.from("companies").select("id, trade_name, legal_name, normalized_cnpj").eq("organization_id", org).in("id", idsDasOutras),
          [] as Array<Pick<LinhaDaEmpresa, "id" | "trade_name" | "legal_name" | "normalized_cnpj">>,
        )
      : Promise.resolve([] as Array<Pick<LinhaDaEmpresa, "id" | "trade_name" | "legal_name" | "normalized_cnpj">>),
  ]);
  const conversaDe = new Map<string, string>();
  for (const c of conversas) if (!conversaDe.has(c.contact_id)) conversaDe.set(c.contact_id, c.id);
  const nomeDaOutra = new Map(outrasEmpresas.map((o) => [o.id, nomeDaEmpresa(o)]));

  const unicos = new Map<string, LinhaDoNegocio>();
  for (const n of [...daEmpresa, ...semEmpresaDasPessoas]) unicos.set(n.id, n);
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
  const ultimas = contatosBrutos.map((p) => p.last_activity_at).filter((d): d is string => !!d).sort();

  const pessoas: PessoaDaEmpresa[] = [];
  for (const v of vinculos) {
    const numeros = contatosBrutos.filter((c) => c.person_id === v.person_id);
    const vivos = numeros.filter((c) => !c.is_anonymized);
    const primeiro = vivos[0] ?? numeros[0];
    // Pessoa sem nenhum número (veio da planilha do upstream sem telefone) não
    // tem ficha de contato para abrir: fica de fora desta lista.
    if (!primeiro) continue;
    const anonimo = vivos.length === 0;
    const atividade = numeros.map((c) => c.last_activity_at).filter((d): d is string => !!d).sort();
    pessoas.push({
      id: primeiro.id,
      pessoaId: v.person_id,
      nome: anonimo ? null : nomeDoContato(primeiro),
      telefone: anonimo ? null : primeiro.phone_number,
      telefones: anonimo ? [] : vivos.map((c) => c.phone_number).filter((t): t is string => Boolean(t)),
      email: anonimo ? null : (vivos.find((c) => c.email)?.email ?? null),
      cargo: anonimo ? null : v.job_title,
      papel: v.papel,
      principal: v.is_primary,
      conversaId: numeros.map((c) => conversaDe.get(c.id)).find((c): c is string => Boolean(c)) ?? null,
      ultimaAtividade: atividade[atividade.length - 1] ?? null,
      outrasEmpresas: outrosVinculos
        .filter((o) => o.person_id === v.person_id && nomeDaOutra.has(o.company_id))
        .map((o) => ({ id: o.company_id, nome: nomeDaOutra.get(o.company_id)! })),
    });
  }

  return {
    pessoas: pessoas.sort(
      (a, b) => Number(b.principal) - Number(a.principal) || (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR"),
    ),
    negocios,
    numeros: {
      abertos: abertos.length,
      abertosCents: abertos.filter((n) => (n.moeda ?? "BRL") === moeda).reduce((soma, n) => soma + (n.valorCents ?? 0), 0),
      moeda,
      ultimaInteracao: ultimas[ultimas.length - 1] ?? null,
      maisQuente: probs.length ? Math.round(Math.max(...probs)) : null,
    },
    compras,
  };
}
