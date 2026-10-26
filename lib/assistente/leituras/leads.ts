/**
 * FORK MIA (.88) — "COMO ESTÃO MEUS LEADS?": os negócios abertos por dono, os
 * novos da semana por origem e os que estão em risco.
 *
 *   abertos e novos   `crm_leads` com `status = 'open'`, como o quadro do funil.
 *   em risco          o Radar (`carregaRadarDeRisco`), a MESMA função da tela do
 *                     Radar e da ferramenta do agente: crítico e em risco pela
 *                     janela de esfriamento do próprio estágio.
 *
 * O dono do negócio é `owner_user_id`. No escopo `proprio` só entram os da
 * pessoa; no da `equipe`, a divisão por dono.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Role } from "@/lib/auth/types";
import { carregaRadarDeRisco } from "@/lib/leads/radar-de-risco";

import { nomeDaPessoa, type Escopo, type PessoaDaEquipe } from "./comum";

export interface LeadsDaPessoa {
  escopo: Escopo["tipo"];
  abertos: number;
  novos_na_semana: number;
  novos_por_origem: Array<{ origem: string; quantos: number }>;
  em_risco: number;
  criticos: number;
  /** Os primeiros em risco, para o "Ver os 3". Título do negócio e o nome do contato. */
  em_risco_itens: Array<{
    lead_id: string;
    titulo: string;
    contato: string | null;
    horas_parado: number;
    /** As mesmas horas em dias inteiros, para a resposta falar em dias acima de 48 h. */
    dias_parado: number;
    dono: string | null;
  }>;
  /** Só no escopo da equipe. */
  por_dono: Array<{ user_id: string | null; nome: string; abertos: number; em_risco: number }> | null;
  /** Negócios abertos sem dono (só no escopo da equipe). */
  sem_dono: number | null;
  truncado: boolean;
  contatos: string[];
  fontes: string[];
}

const TETO = 2000;

/** O rótulo da origem gravada no negócio (`crm_leads.source`). */
function origemLegivel(source: string | null): string {
  const s = (source ?? "").trim();
  if (!s) return "sem origem";
  const conhecidas: Record<string, string> = {
    manual: "cadastro manual",
    meta_ads: "Meta",
    meta: "Meta",
    facebook: "Meta",
    instagram: "Instagram",
    google_ads: "Google",
    google: "Google",
    whatsapp: "WhatsApp",
    site: "site",
    import: "importação",
    api: "integração",
  };
  return conhecidas[s.toLowerCase()] ?? s;
}

export async function lerLeads(
  db: SupabaseClient,
  entrada: { organizationId: string; escopo: Escopo; papel: Role; agora: Date; equipe: readonly PessoaDaEquipe[] },
): Promise<LeadsDaPessoa> {
  const { organizationId: org, escopo, agora } = entrada;
  const proprio = escopo.tipo === "proprio";

  let consulta = db
    .from("crm_leads")
    .select("id, owner_user_id, created_at, source")
    .eq("organization_id", org)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(TETO);
  if (proprio) consulta = consulta.eq("owner_user_id", escopo.userId);
  const { data } = await consulta;
  const abertos = (data ?? []) as Array<{ id: string; owner_user_id: string | null; created_at: string; source: string | null }>;

  const semanaAtras = new Date(agora.getTime() - 7 * 86_400_000);
  const novos = abertos.filter((l) => new Date(l.created_at) >= semanaAtras);
  const porOrigem = new Map<string, number>();
  for (const l of novos) {
    const o = origemLegivel(l.source);
    porOrigem.set(o, (porOrigem.get(o) ?? 0) + 1);
  }

  const radar = await carregaRadarDeRisco(db, { organizationId: org, humanRole: entrada.papel, limit: 200, now: agora });
  const emRisco = radar.items.filter(
    (i) => (i.risk === "critico" || i.risk === "em_risco") && (!proprio || i.owner_user_id === escopo.userId),
  );

  let porDono: LeadsDaPessoa["por_dono"] = null;
  let semDono: number | null = null;
  if (!proprio) {
    const contagem = new Map<string | null, { abertos: number; em_risco: number }>();
    for (const l of abertos) {
      const c = contagem.get(l.owner_user_id) ?? { abertos: 0, em_risco: 0 };
      c.abertos += 1;
      contagem.set(l.owner_user_id, c);
    }
    for (const i of emRisco) {
      const c = contagem.get(i.owner_user_id) ?? { abertos: 0, em_risco: 0 };
      c.em_risco += 1;
      contagem.set(i.owner_user_id, c);
    }
    semDono = contagem.get(null)?.abertos ?? 0;
    porDono = [...contagem.entries()]
      .filter(([dono]) => dono !== null)
      .sort((a, b) => b[1].abertos - a[1].abertos)
      .slice(0, 12)
      .map(([dono, c]) => ({ user_id: dono, nome: nomeDaPessoa(entrada.equipe, dono) ?? "", ...c }));
  }

  return {
    escopo: escopo.tipo,
    abertos: abertos.length,
    novos_na_semana: novos.length,
    novos_por_origem: [...porOrigem.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([origem, quantos]) => ({ origem, quantos })),
    em_risco: emRisco.length,
    criticos: emRisco.filter((i) => i.risk === "critico").length,
    em_risco_itens: emRisco.slice(0, 5).map((i) => ({
      lead_id: i.id,
      titulo: i.title,
      contato: i.contact_name,
      horas_parado: i.hours_since_activity,
      dias_parado: Math.floor(i.hours_since_activity / 24),
      dono: proprio ? null : nomeDaPessoa(entrada.equipe, i.owner_user_id),
    })),
    por_dono: porDono,
    sem_dono: semDono,
    truncado: abertos.length >= TETO,
    contatos: emRisco.slice(0, 5).map((i) => i.contact_id).filter((c): c is string => typeof c === "string"),
    fontes: ["Funis", "Radar"],
  };
}
