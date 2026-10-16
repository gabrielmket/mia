/**
 * FORK MIA (item 9) — GARANTIR os relatórios e o painel do segmento num
 * cliente (`plataforma_garantir_relatorios`, MCP de plataforma).
 *
 * "Garantir" quer dizer: cria o que falta e não duplica (protótipo, tela 7).
 *  - liga os relatórios PRONTOS ao funil do cliente (`mia_relatorios_da_empresa`);
 *  - cria os relatórios da receita do segmento (`lib/relatorios/segmentos.ts`),
 *    compartilhados com a equipe, pela chave natural (`mia_relatorios.chave`):
 *    rodar de novo devolve `ja_estava`, ou `atualizou` se a receita mudou;
 *  - monta o painel do segmento, compartilhado, e só COMPLETA o que faltar: um
 *    relatório que o cliente tirou do painel volta; um que ele pôs fica; o
 *    tamanho e a ordem que ele mudou ficam.
 *
 * Cliente de SERVIÇO, com a organização já conferida (`alvo`, do MCP). O dono
 * gravado é quem criou o token (a pessoa que responde por ele), e a origem é
 * `mcp_plataforma`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";

import { colunasDaConfig, configDaLinha, type ConfigDoRelatorio, type LinhaDeConfig } from "./config";
import { RECEITAS, type ReceitaDoSegmento, type SegmentoDeRelatorio } from "./segmentos";

export type Desfecho = "criou" | "atualizou" | "ja_estava";

export interface ResultadoDaGarantia {
  segmento: SegmentoDeRelatorio;
  funil: { id: string; nome: string } | null;
  relatorios: Array<{ chave: string; id: string; nome: string; desfecho: Desfecho }>;
  painel: { id: string; nome: string; desfecho: Desfecho; itensNovos: number; itens: number };
  link: ReceitaDoSegmento["link"];
}

export interface PedidoDeGarantia {
  organizationId: string;
  autorUserId: string;
  requestId: string;
  segmento: SegmentoDeRelatorio;
  /** O funil dos prontos. Nulo: o principal da empresa. */
  funilId?: string | null;
  /** O nome do painel (o da receita, se ausente). */
  nomeDoPainel?: string | null;
  compartilhar?: boolean;
  /** `demonstracao` na semente; `mcp_plataforma` no MCP. */
  via?: "mcp_plataforma" | "demonstracao";
}

function mesmaConfig(a: ConfigDoRelatorio, b: ConfigDoRelatorio): boolean {
  return JSON.stringify(colunasDaConfig(a)) === JSON.stringify(colunasDaConfig(b));
}

export class GarantiaRecusada extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "GarantiaRecusada";
  }
}

export async function garantirRelatorios(admin: SupabaseClient, p: PedidoDeGarantia): Promise<ResultadoDaGarantia> {
  const receita = RECEITAS[p.segmento];
  const via = p.via ?? "mcp_plataforma";
  const compartilhar = p.compartilhar ?? true;

  // ── o funil dos prontos ──
  const { data: funis, error: e1 } = await admin
    .from("crm_pipelines")
    .select("id, name, is_default, is_archived, position")
    .eq("organization_id", p.organizationId)
    .order("position", { ascending: true });
  if (e1) throw new Error(`não li os funis: ${e1.message}`);
  const vivos = ((funis ?? []) as Array<{ id: string; name: string; is_default: boolean; is_archived: boolean }>).filter((f) => !f.is_archived);
  let funil = vivos.find((f) => f.is_default) ?? vivos[0] ?? null;
  if (p.funilId) {
    const pedido = vivos.find((f) => f.id === p.funilId);
    if (!pedido) throw new GarantiaRecusada("Esse `funil_id` não é um funil ativo desta empresa. Veja os funis com plataforma_ver_funis.");
    funil = pedido;
  }
  if (funil) {
    const { error } = await admin
      .from("mia_relatorios_da_empresa")
      .upsert({ organization_id: p.organizationId, pipeline_id: funil.id, updated_by: p.autorUserId }, { onConflict: "organization_id" });
    if (error) throw new Error(`não liguei os prontos ao funil: ${error.message}`);
  }

  // ── os relatórios da receita ──
  const chaves = receita.relatorios.map((r) => r.chave);
  const { data: existentes, error: e2 } = await admin
    .from("mia_relatorios")
    .select("id, chave, nome, fonte, medida, dim1, dim2, filtros, periodo, de, ate, comparar, visualizacao, compartilhado")
    .eq("organization_id", p.organizationId)
    .in("chave", chaves);
  if (e2) throw new Error(`não li os relatórios: ${e2.message}`);
  const porChave = new Map(((existentes ?? []) as Array<LinhaDeConfig & { id: string; chave: string; nome: string; compartilhado: boolean }>).map((l) => [l.chave, l]));
  const relatorios: ResultadoDaGarantia["relatorios"] = [];
  for (const r of receita.relatorios) {
    const atual = porChave.get(r.chave);
    if (!atual) {
      const { data, error } = await admin
        .from("mia_relatorios")
        .insert({
          organization_id: p.organizationId,
          nome: r.nome,
          ...colunasDaConfig(r.config),
          compartilhado: compartilhar,
          chave: r.chave,
          criado_via: via,
          created_by: p.autorUserId,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`não criei o relatório ${r.nome}: ${error?.message ?? "sem linha"}`);
      relatorios.push({ chave: r.chave, id: (data as { id: string }).id, nome: r.nome, desfecho: "criou" });
      continue;
    }
    const igual = atual.nome === r.nome && mesmaConfig(configDaLinha(atual), r.config) && atual.compartilhado === compartilhar;
    if (!igual) {
      const { error } = await admin
        .from("mia_relatorios")
        .update({ nome: r.nome, ...colunasDaConfig(r.config), compartilhado: compartilhar })
        .eq("organization_id", p.organizationId)
        .eq("id", atual.id);
      if (error) throw new Error(`não atualizei o relatório ${r.nome}: ${error.message}`);
    }
    relatorios.push({ chave: r.chave, id: atual.id, nome: r.nome, desfecho: igual ? "ja_estava" : "atualizou" });
  }
  const idDaChave = new Map(relatorios.map((r) => [r.chave, r.id]));

  // ── o painel ──
  const nomeDoPainel = (p.nomeDoPainel ?? "").trim() || receita.painel.nome;
  const { data: painelAtual, error: e3 } = await admin
    .from("mia_paineis_usuario")
    .select("id, nome, compartilhado")
    .eq("organization_id", p.organizationId)
    .eq("chave", receita.painel.chave)
    .maybeSingle();
  if (e3) throw new Error(`não li o painel: ${e3.message}`);
  let painelId: string;
  let desfechoDoPainel: Desfecho;
  if (!painelAtual) {
    const { data, error } = await admin
      .from("mia_paineis_usuario")
      .insert({
        organization_id: p.organizationId,
        nome: nomeDoPainel,
        periodo: "30",
        compartilhado: compartilhar,
        chave: receita.painel.chave,
        criado_via: via,
        created_by: p.autorUserId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`não criei o painel: ${error?.message ?? "sem linha"}`);
    painelId = (data as { id: string }).id;
    desfechoDoPainel = "criou";
  } else {
    const atual = painelAtual as { id: string; nome: string; compartilhado: boolean };
    painelId = atual.id;
    const igual = atual.nome === nomeDoPainel && atual.compartilhado === compartilhar;
    if (!igual) {
      const { error } = await admin
        .from("mia_paineis_usuario")
        .update({ nome: nomeDoPainel, compartilhado: compartilhar })
        .eq("organization_id", p.organizationId)
        .eq("id", painelId);
      if (error) throw new Error(`não atualizei o painel: ${error.message}`);
    }
    desfechoDoPainel = igual ? "ja_estava" : "atualizou";
  }

  const { data: itens, error: e4 } = await admin
    .from("mia_paineis_usuario_itens")
    .select("relatorio_id, pronto, posicao")
    .eq("organization_id", p.organizationId)
    .eq("painel_id", painelId);
  if (e4) throw new Error(`não li os itens do painel: ${e4.message}`);
  const presentes = (itens ?? []) as Array<{ relatorio_id: string | null; pronto: string | null; posicao: number | string }>;
  let ultima = presentes.reduce((m, i) => Math.max(m, Number(i.posicao)), 0);
  const novos: Array<Record<string, unknown>> = [];
  for (const item of receita.painel.itens) {
    const relatorioId = item.relatorio ? (idDaChave.get(item.relatorio) ?? null) : null;
    const ja = presentes.some((x) => (relatorioId ? x.relatorio_id === relatorioId : x.pronto === item.pronto));
    if (ja || (!relatorioId && !item.pronto)) continue;
    ultima += 1;
    novos.push({
      organization_id: p.organizationId,
      painel_id: painelId,
      relatorio_id: relatorioId,
      pronto: relatorioId ? null : item.pronto,
      tamanho: item.tamanho,
      posicao: ultima,
    });
  }
  if (novos.length > 0) {
    const { error } = await admin.from("mia_paineis_usuario_itens").insert(novos);
    if (error) throw new Error(`não montei o painel: ${error.message}`);
    if (desfechoDoPainel === "ja_estava") desfechoDoPainel = "atualizou";
  }

  await audit({
    action: "relatorios.garantidos",
    actorUserId: p.autorUserId,
    organizationId: p.organizationId,
    resourceType: "mia_paineis_usuario",
    resourceId: painelId,
    requestId: p.requestId,
    metadata: {
      segmento: p.segmento,
      funil_id: funil?.id ?? null,
      relatorios: relatorios.map((r) => ({ chave: r.chave, desfecho: r.desfecho })),
      painel: desfechoDoPainel,
      itens_novos: novos.length,
      via,
    },
  });

  return {
    segmento: p.segmento,
    funil: funil ? { id: funil.id, nome: funil.name } : null,
    relatorios,
    painel: { id: painelId, nome: nomeDoPainel, desfecho: desfechoDoPainel, itensNovos: novos.length, itens: presentes.length + novos.length },
    link: receita.link,
  };
}
