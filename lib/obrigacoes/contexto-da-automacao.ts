/**
 * FORK MIA — OBRIGAÇÕES · o CONTEXTO que o motor de automações recebe.
 *
 * Os cinco gatilhos de obrigação trazem como entidade o próprio item
 * (`mia_obrigacao`). As ações que já existem (mensagem, tarefa, etiqueta, mover
 * de etapa, abrir negócio) falam de NEGÓCIO e de CONTATO: é aqui que o item
 * vira os dois, pela mesma herança da tela.
 *
 *   o negócio   o do item; se o item é da empresa ou do contato, o negócio
 *               ABERTO mais recente dela (ou dele). Sem negócio aberto, fica
 *               ausente, e a ação de "criar ou mover" abre um.
 *   o contato   o do item; senão o do negócio; senão o contato principal da
 *               empresa (ou o primeiro dela).
 *   a obrigação nome, situação calculada, a data que importa e os dias, para
 *               as condições (`obrigacao.nome`) e para os textos das ações
 *               (`{{obrigacao.nome}}`, `{{obrigacao.data}}`).
 *
 * Plugado em `lib/automation/engine.ts` (`buildContext`) por um ramo. Todo
 * acesso carrega o filtro de organização: o cliente é o de serviço.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { EventRow } from "@/lib/event-log/dispatcher";

import { diaNoFuso, diaPorExtenso } from "./datas";
import { ROTULO_DA_SITUACAO, diasAteAData, idadeDoPedido, situacao } from "./situacao";
import { COLUNAS_DA_OBRIGACAO, type Obrigacao } from "./tipos";

export async function contextoDaObrigacao(admin: SupabaseClient, row: EventRow): Promise<Record<string, unknown>> {
  const contexto: Record<string, unknown> = {};
  if (!row.entity_id) return contexto;
  const org = row.organization_id;

  const { data } = await admin
    .from("mia_obrigacoes")
    .select(COLUNAS_DA_OBRIGACAO)
    .eq("organization_id", org)
    .eq("id", row.entity_id)
    .maybeSingle();
  const item = data as unknown as Obrigacao | null;
  if (!item) return contexto;

  const { data: organizacao } = await admin.from("organizations").select("timezone").eq("id", org).maybeSingle();
  const hoje = diaNoFuso(new Date(), (organizacao as { timezone?: string | null } | null)?.timezone ?? null);
  const s = situacao(item, hoje);
  const dias = s === "pedido" ? idadeDoPedido(item, hoje) : diasAteAData(item, hoje);
  contexto.obrigacao = {
    id: item.id,
    nome: item.nome,
    nome_curto: item.nome_curto ?? item.nome,
    categoria: item.categoria,
    situacao: ROTULO_DA_SITUACAO[s],
    data: diaPorExtenso(item.categoria === "atividade" ? item.proxima_em : item.valido_ate),
    dias: dias === null ? "" : String(Math.abs(dias)),
    valido_ate: item.valido_ate,
    proxima_em: item.proxima_em,
    pedido_em: item.pedido_em,
    prazo_em: item.prazo_em,
    recebido_em: item.recebido_em,
    quem_entrega: item.quem_entrega,
    ciclo: item.ciclo,
  };

  // O negócio: o do item, ou o aberto mais recente da empresa (ou do contato).
  let lead: Record<string, unknown> | null = null;
  if (item.lead_id) {
    const r = await admin.from("crm_leads").select("*").eq("organization_id", org).eq("id", item.lead_id).maybeSingle();
    lead = (r.data as Record<string, unknown> | null) ?? null;
  } else {
    const coluna = item.empresa_id ? "empresa_id" : "contact_id";
    const valor = item.empresa_id ?? item.contact_id;
    if (valor) {
      const r = await admin
        .from("crm_leads")
        .select("*")
        .eq("organization_id", org)
        .eq(coluna, valor)
        .eq("status", "open")
        .order("updated_at", { ascending: false })
        .limit(1);
      lead = ((r.data ?? []) as Array<Record<string, unknown>>)[0] ?? null;
    }
  }
  if (lead) contexto.lead = lead;

  // O contato: o do item, o do negócio, ou o principal da empresa.
  let contatoId = item.contact_id ?? ((lead?.contact_id as string | null | undefined) ?? null);
  if (!contatoId && item.empresa_id) {
    const r = await admin
      .from("contacts")
      .select("id")
      .eq("organization_id", org)
      .eq("empresa_id", item.empresa_id)
      .eq("is_anonymized", false)
      .is("is_merged_into", null)
      .order("principal_na_empresa", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1);
    contatoId = ((r.data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
  }
  if (contatoId) {
    const r = await admin.from("contacts").select("*").eq("organization_id", org).eq("id", contatoId).maybeSingle();
    if (r.data) contexto.contact = r.data;
  }

  if (item.empresa_id) {
    const r = await admin.from("crm_empresas").select("id, nome").eq("organization_id", org).eq("id", item.empresa_id).maybeSingle();
    if (r.data) contexto.empresa = r.data;
  }
  return contexto;
}
