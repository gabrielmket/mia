/**
 * FORK MIA (.89) — OS RESULTADOS de uma campanha, o clique medido, a abertura
 * estimada, e o que fazer com quem clicou.
 *
 *   enviados    o que a Amazon aceitou (e foi cobrado)
 *   entregues   o que chegou à caixa
 *   aberturas   SEMPRE estimativa, e só de quem consentiu com o aviso de medição
 *   cliques     uma vez por pessoa por link, sem o clique de robô
 *
 * Quem clicou vira segmento (a próxima campanha, para quem clicou nesta),
 * tarefa (para o responsável de cada contato) ou negócio (na etapa escolhida,
 * pulando quem já tem negócio aberto no funil).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { criarTarefaInterna } from "@/lib/tarefas/criar-tarefa";

import { cliquesDoPrimeiroMinutoSaoDeRobo, ehAgenteDeRobo } from "./cliques";
import { pct } from "./ritmo";
import { verificarToken } from "./token";

async function quantas(
  consulta: PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const { count, error } = await consulta;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export interface ResultadosDaCampanha {
  enviados: number;
  entregues: number;
  medidas: number;
  aberturas: number;
  cliquesUnicos: number;
  cliquesTotais: number;
  descadastros: number;
  rejeicoesPermanentes: number;
  rejeicoesTemporarias: number;
  reclamacoes: number;
  pendentes: number;
  pulados: number;
  falhas: number;
  cobradoCents: number;
  rejeicaoPct: number;
  reclamacaoPct: number;
  links: Array<{ id: string; rotulo: string; url: string; pessoas: number; cliques: number }>;
}

export async function resultadosDaCampanha(
  db: SupabaseClient,
  orgId: string,
  campanhaId: string,
): Promise<ResultadosDaCampanha> {
  const base = () =>
    db
      .from("mia_email_destinatarios")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("campanha_id", campanhaId);
  const [
    enviados,
    entregues,
    medidas,
    aberturas,
    cliquesUnicos,
    descadastros,
    rejPerm,
    rejTemp,
    reclamacoes,
    pendentes,
    pulados,
    falhas,
  ] = await Promise.all([
    quantas(base().in("status", ["enviado", "entregue", "rejeitado", "reclamacao"])),
    quantas(base().in("status", ["entregue", "reclamacao"])),
    quantas(base().eq("medir_abertura", true).in("status", ["entregue", "reclamacao"])),
    quantas(base().eq("medir_abertura", true).not("primeira_abertura_em", "is", null)),
    quantas(base().not("primeiro_clique_em", "is", null)),
    quantas(base().not("descadastrado_em", "is", null)),
    quantas(base().eq("status", "rejeitado").eq("rejeicao_tipo", "permanente")),
    quantas(base().eq("status", "rejeitado").eq("rejeicao_tipo", "temporaria")),
    quantas(base().eq("status", "reclamacao")),
    quantas(base().in("status", ["pendente", "enviando"])),
    quantas(base().eq("status", "pulado")),
    quantas(base().eq("status", "falhou")),
  ]);
  const { data: links } = await db
    .from("mia_email_links")
    .select("id, ordem, url, rotulo")
    .eq("organization_id", orgId)
    .eq("campanha_id", campanhaId)
    .order("ordem");
  const porLink = await Promise.all(
    ((links ?? []) as Array<{ id: string; url: string; rotulo: string | null }>).map(async (l) => {
      const { data } = await db
        .from("mia_email_cliques")
        .select("destinatario_id")
        .eq("organization_id", orgId)
        .eq("link_id", l.id)
        .eq("robo", false)
        .limit(50_000);
      const linhas = (data ?? []) as Array<{ destinatario_id: string }>;
      return {
        id: l.id,
        rotulo: l.rotulo ?? l.url,
        url: l.url,
        pessoas: new Set(linhas.map((x) => x.destinatario_id)).size,
        cliques: linhas.length,
      };
    }),
  );
  let cobrado = 0;
  for (let de = 0; ; de += 1000) {
    const { data } = await db
      .from("mia_email_destinatarios")
      .select("cobrado_cents")
      .eq("organization_id", orgId)
      .eq("campanha_id", campanhaId)
      .eq("cobrado", true)
      .range(de, de + 999);
    const lote = (data ?? []) as Array<{ cobrado_cents: number | null }>;
    cobrado += lote.reduce((s, x) => s + Number(x.cobrado_cents ?? 0), 0);
    if (lote.length < 1000) break;
  }
  return {
    enviados,
    entregues,
    medidas,
    aberturas,
    cliquesUnicos,
    cliquesTotais: porLink.reduce((s, l) => s + l.cliques, 0),
    descadastros,
    rejeicoesPermanentes: rejPerm,
    rejeicoesTemporarias: rejTemp,
    reclamacoes,
    pendentes,
    pulados,
    falhas,
    cobradoCents: cobrado,
    rejeicaoPct: pct(rejPerm + rejTemp, enviados),
    reclamacaoPct: pct(reclamacoes, entregues),
    links: porLink,
  };
}

/** A abertura: só conta em quem tem `medir_abertura` (consentiu com o aviso). */
export async function registrarAbertura(
  db: SupabaseClient,
  token: string,
  userAgent: string | null,
): Promise<void> {
  const t = verificarToken(token);
  if (!t || t.k !== "d") return;
  const { data } = await db
    .from("mia_email_destinatarios")
    .select("id, medir_abertura, primeira_abertura_em, aberturas, status")
    .eq("organization_id", t.o)
    .eq("id", t.r)
    .maybeSingle();
  const d = data as {
    id: string;
    medir_abertura: boolean;
    primeira_abertura_em: string | null;
    aberturas: number;
    status: string;
  } | null;
  if (!d || !d.medir_abertura) return;
  // O proxy de imagem do Gmail abre por quem lê, e conta; robô de filtro, não.
  if (ehAgenteDeRobo(userAgent) && !/googleimageproxy/i.test(userAgent ?? "")) return;
  await db
    .from("mia_email_destinatarios")
    .update({
      aberturas: (d.aberturas ?? 0) + 1,
      ...(d.primeira_abertura_em ? {} : { primeira_abertura_em: new Date().toISOString() }),
    })
    .eq("organization_id", t.o)
    .eq("id", d.id);
}

/**
 * O clique: grava, marca o robô, e devolve o destino. Token inválido devolve
 * `null` (a rota mostra "link indisponível", nunca um redirecionamento aberto).
 */
export async function registrarClique(
  db: SupabaseClient,
  token: string,
  userAgent: string | null,
  agora = new Date(),
): Promise<string | null> {
  const t = verificarToken(token);
  if (!t || t.k !== "c" || !t.l) return null;
  const { data: link } = await db
    .from("mia_email_links")
    .select("id, campanha_id, url")
    .eq("organization_id", t.o)
    .eq("id", t.l)
    .maybeSingle();
  const l = link as { id: string; campanha_id: string; url: string } | null;
  if (!l) return null;
  const { data: dest } = await db
    .from("mia_email_destinatarios")
    .select("id, campanha_id, entregue_em, enviado_em, primeiro_clique_em")
    .eq("organization_id", t.o)
    .eq("id", t.r)
    .maybeSingle();
  const d = dest as {
    id: string;
    campanha_id: string;
    entregue_em: string | null;
    enviado_em: string | null;
    primeiro_clique_em: string | null;
  } | null;
  // O link é da campanha do destinatário, senão o token foi montado à mão.
  if (!d || d.campanha_id !== l.campanha_id) return l.url;
  const roboPeloAgente = ehAgenteDeRobo(userAgent);
  await db
    .from("mia_email_cliques")
    .insert({
      organization_id: t.o,
      destinatario_id: d.id,
      link_id: l.id,
      clicado_em: agora.toISOString(),
      robo: roboPeloAgente,
    });
  const entregue = d.entregue_em ?? d.enviado_em;
  // O padrão do robô de segurança: todos os links no primeiro minuto depois de entregue.
  const { data: doMinuto } = await db
    .from("mia_email_cliques")
    .select("id, link_id, clicado_em")
    .eq("organization_id", t.o)
    .eq("destinatario_id", d.id);
  const cliques = (
    (doMinuto ?? []) as Array<{ id: string; link_id: string; clicado_em: string }>
  ).map((c) => ({ ...c, linkId: c.link_id, clicadoEm: c.clicado_em }));
  const { count: totalDeLinks } = await db
    .from("mia_email_links")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", t.o)
    .eq("campanha_id", l.campanha_id);
  const roboDoMinuto = cliquesDoPrimeiroMinutoSaoDeRobo({
    cliques,
    totalDeLinks: totalDeLinks ?? 0,
    entregueEm: entregue,
  });
  if (roboDoMinuto && entregue) {
    const fim = Date.parse(entregue) + 60_000;
    const ids = cliques.filter((c) => Date.parse(c.clicadoEm) <= fim).map((c) => c.id);
    if (ids.length)
      await db
        .from("mia_email_cliques")
        .update({ robo: true })
        .eq("organization_id", t.o)
        .in("id", ids);
  }
  if (!roboPeloAgente && !roboDoMinuto && !d.primeiro_clique_em) {
    await db
      .from("mia_email_destinatarios")
      .update({ primeiro_clique_em: agora.toISOString() })
      .eq("organization_id", t.o)
      .eq("id", d.id);
  }
  if (
    roboDoMinuto &&
    d.primeiro_clique_em &&
    entregue &&
    Date.parse(d.primeiro_clique_em) <= Date.parse(entregue) + 60_000
  ) {
    // O "primeiro clique" era do robô: sai, até um clique de gente chegar.
    await db
      .from("mia_email_destinatarios")
      .update({ primeiro_clique_em: null })
      .eq("organization_id", t.o)
      .eq("id", d.id);
  }
  return l.url;
}

export interface QuemClicou {
  destinatarioId: string;
  contactId: string;
  nome: string | null;
  email: string | null;
  link: string | null;
  responsavelId: string | null;
}

/** As pessoas que clicaram (sem robô), com o primeiro link que clicaram. */
export async function quemClicou(
  db: SupabaseClient,
  orgId: string,
  campanhaId: string,
  limite = 5000,
): Promise<QuemClicou[]> {
  const { data, error } = await db
    .from("mia_email_destinatarios")
    .select("id, contact_id, email")
    .eq("organization_id", orgId)
    .eq("campanha_id", campanhaId)
    .not("primeiro_clique_em", "is", null)
    .not("contact_id", "is", null)
    .limit(limite);
  if (error) throw new Error(`quem clicou: ${error.message}`);
  const dests = (data ?? []) as Array<{ id: string; contact_id: string; email: string | null }>;
  if (dests.length === 0) return [];
  const saida: QuemClicou[] = [];
  for (let i = 0; i < dests.length; i += 150) {
    const lote = dests.slice(i, i + 150);
    const [{ data: contatos }, { data: cliques }] = await Promise.all([
      db
        .from("contacts")
        .select("id, name, display_name, carteira_user_id")
        .eq("organization_id", orgId)
        .in(
          "id",
          lote.map((d) => d.contact_id),
        ),
      db
        .from("mia_email_cliques")
        .select("destinatario_id, link_id, clicado_em")
        .eq("organization_id", orgId)
        .eq("robo", false)
        .in(
          "destinatario_id",
          lote.map((d) => d.id),
        )
        .order("clicado_em", { ascending: true }),
    ]);
    const porContato = new Map(
      (
        (contatos ?? []) as Array<{
          id: string;
          name: string | null;
          display_name: string | null;
          carteira_user_id: string | null;
        }>
      ).map((c) => [c.id, c]),
    );
    const primeiroLink = new Map<string, string>();
    for (const c of (cliques ?? []) as Array<{ destinatario_id: string; link_id: string }>) {
      if (!primeiroLink.has(c.destinatario_id)) primeiroLink.set(c.destinatario_id, c.link_id);
    }
    for (const d of lote) {
      const c = porContato.get(d.contact_id);
      saida.push({
        destinatarioId: d.id,
        contactId: d.contact_id,
        nome: nomeDoContato(c),
        email: d.email,
        link: primeiroLink.get(d.id) ?? null,
        responsavelId: c?.carteira_user_id ?? null,
      });
    }
  }
  return saida;
}

export interface ResultadoDaAcao {
  criados: number;
  pulados: number;
  semResponsavel: number;
}

/** Uma tarefa para o responsável de cada contato que clicou (ou para quem pediu). */
export async function tarefasParaQuemClicou(
  db: SupabaseClient,
  entrada: {
    organizationId: string;
    campanhaId: string;
    campanhaNome: string;
    titulo: string;
    venceEmDias: number;
    paraQuem: "responsavel" | { usuario_id: string };
    autorId: string;
    requestId?: string;
  },
): Promise<ResultadoDaAcao> {
  const pessoas = await quemClicou(db, entrada.organizationId, entrada.campanhaId);
  const { data: links } = await db
    .from("mia_email_links")
    .select("id, rotulo, url")
    .eq("organization_id", entrada.organizationId)
    .eq("campanha_id", entrada.campanhaId);
  const rotulo = new Map(
    ((links ?? []) as Array<{ id: string; rotulo: string | null; url: string }>).map((l) => [
      l.id,
      `${l.rotulo ?? ""} (${l.url})`.trim(),
    ]),
  );
  const r: ResultadoDaAcao = { criados: 0, pulados: 0, semResponsavel: 0 };
  for (const p of pessoas) {
    const usuario =
      entrada.paraQuem === "responsavel"
        ? (p.responsavelId ?? entrada.autorId)
        : entrada.paraQuem.usuario_id;
    if (entrada.paraQuem === "responsavel" && !p.responsavelId) r.semResponsavel += 1;
    const t = await criarTarefaInterna(db, {
      organizationId: entrada.organizationId,
      titulo: entrada.titulo,
      venceEmDias: entrada.venceEmDias,
      atribuirA: { usuario_id: usuario },
      prioridade: "medium",
      contactId: p.contactId,
      descricao: `Clicou no e-mail "${entrada.campanhaNome}"${p.link ? `: ${rotulo.get(p.link) ?? ""}` : ""}.`,
      origem: "email_marketing:quem_clicou",
      requestId: entrada.requestId,
    });
    if (t.ok) r.criados += 1;
    else r.pulados += 1;
  }
  return r;
}

/** Um negócio na etapa escolhida para quem clicou, pulando quem já tem negócio aberto no funil. */
export async function negociosParaQuemClicou(
  db: SupabaseClient,
  entrada: {
    organizationId: string;
    campanhaId: string;
    campanhaNome: string;
    pipelineId: string;
    stageId: string;
    autorId: string;
  },
): Promise<ResultadoDaAcao> {
  const { data: etapa } = await db
    .from("crm_stages")
    .select("id, pipeline_id")
    .eq("organization_id", entrada.organizationId)
    .eq("id", entrada.stageId)
    .maybeSingle();
  if (!etapa || (etapa as { pipeline_id: string }).pipeline_id !== entrada.pipelineId) {
    throw new Error("a etapa não é deste funil");
  }
  const pessoas = await quemClicou(db, entrada.organizationId, entrada.campanhaId);
  const r: ResultadoDaAcao = { criados: 0, pulados: 0, semResponsavel: 0 };
  for (let i = 0; i < pessoas.length; i += 150) {
    const lote = pessoas.slice(i, i + 150);
    const { data: abertos } = await db
      .from("crm_leads")
      .select("contact_id")
      .eq("organization_id", entrada.organizationId)
      .eq("pipeline_id", entrada.pipelineId)
      .eq("status", "open")
      .in(
        "contact_id",
        lote.map((p) => p.contactId),
      );
    const comAberto = new Set(
      ((abertos ?? []) as Array<{ contact_id: string }>).map((a) => a.contact_id),
    );
    const novos = lote.filter((p) => !comAberto.has(p.contactId));
    r.pulados += lote.length - novos.length;
    if (novos.length === 0) continue;
    const { error } = await db.from("crm_leads").insert(
      novos.map((p) => ({
        organization_id: entrada.organizationId,
        pipeline_id: entrada.pipelineId,
        stage_id: entrada.stageId,
        contact_id: p.contactId,
        title: `${p.nome ?? "Contato"} · ${entrada.campanhaNome}`.slice(0, 200),
        source: "email_marketing",
        source_metadata: { campanha_de_email: entrada.campanhaId },
        created_by_user_id: entrada.autorId,
      })),
    );
    if (error) throw new Error(`não consegui criar os negócios: ${error.message}`);
    r.criados += novos.length;
  }
  return r;
}
