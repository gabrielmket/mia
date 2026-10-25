/**
 * FORK MIA (.90) — AS EMPRESAS QUE ENTRARAM SOZINHAS, o lado da Time
 * (Admin › Empresas do cadastro; protótipo, tela 5). Também é a fonte do MCP
 * (`plataforma_listar_assinaturas`, `plataforma_ver_assinatura`,
 * `plataforma_listar_pedidos_de_cadastro`).
 *
 * Só LÊ, com o cliente de serviço, depois de quem chama conferir que é admin de
 * plataforma. Junta: a origem (`mia_origem_da_empresa`, 9071), a assinatura e o
 * plano do upstream, a situação e o próximo passo da régua (`situacao.ts`), os
 * primeiros passos do `/onboarding` do upstream (`lib/onboarding/passos.ts`),
 * os pedidos esperando aprovação (`registration_requests`, com o plano e o que
 * a empresa faz que vieram do cadastro) e os números oficiais esperando ligação
 * (o cadastro incorporado, `meta_onboardings` sem empresa). A empresa de
 * demonstração fica de fora: não é cliente.
 *
 * Nada de dado do cliente final: só a empresa, o plano e quem a administra
 * (e-mail mascarado).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { toleranciaDias } from "@/lib/cobranca/configuracao";
import { env } from "@/lib/env";
import { maskEmail, maskPhone } from "@/lib/lgpd/mask";
import { passosVisiveis } from "@/lib/onboarding/passos";
import type { OnboardingState } from "@/lib/schemas/onboarding";

import { lerPlanosComModulos, type PlanoComModulos } from "./leitura";
import { origemDosModulos, type OrigemDoModulo } from "./modulos";
import {
  proximoDaRegua,
  reguaDaEmpresa,
  situacaoDaEmpresa,
  type AssinaturaLida,
  type PontoDaRegua,
  type ProximoPasso,
  type SituacaoDaEmpresa,
} from "./situacao";

const TETO_DA_LISTA = 500;

export interface LinhaDaEmpresa {
  id: string;
  nome: string;
  entrou: string;
  origem: "cadastro" | "implantacao" | null;
  plano: { id: string; nome: string; preco_cents: number; intervalo: string } | null;
  plano_agendado: { nome: string; em: string | null } | null;
  situacao: SituacaoDaEmpresa;
  teste_ate: string | null;
  proximo: ProximoPasso;
  passos: { feitos: number; de: number };
  /** A cobrança que o upstream já deixou pronta (o link da fatura em aberto). */
  link_de_pagamento: string | null;
}

export interface PedidoDeCadastro {
  id: string;
  empresa: string;
  email: string | null;
  plano: string | null;
  o_que_faz: string | null;
  criado_em: string;
}

export interface NumeroEsperando {
  id: string;
  conta: string | null;
  waba: string;
  numero: string | null;
  chegou: string;
}

const COLUNAS_DA_ASSINATURA =
  "organization_id, plano_id, plano_agendado_id, estado, trial_ate, vencida_desde, proximo_vencimento, prazo_extra_ate, cancela_no_fim, assinaturas_vivas, ultimo_aviso, ultimo_aviso_em, provedor, pagamento_inicial_pendente, link_de_pagamento";

/** Os primeiros passos feitos de verdade (pulado não conta), contra os visíveis nesta instalação. */
export function passosFeitos(state: OnboardingState | null | undefined): {
  feitos: number;
  de: number;
} {
  const visiveis = passosVisiveis({ lojaLigada: env.NUVEMSHOP_ENABLED === true });
  const s = (state ?? {}) as OnboardingState;
  return {
    feitos: visiveis.filter((p) => p.cumprido(s) && !p.pulado(s)).length,
    de: visiveis.length,
  };
}

function linhaDe(
  org: {
    id: string;
    display_name: string | null;
    created_at: string;
    status: string;
    suspended_kind: string | null;
    onboarding_state: unknown;
  },
  a: AssinaturaLida | null,
  origem: "cadastro" | "implantacao" | null,
  planos: Map<string, PlanoComModulos>,
  agora: Date,
  tolerancia: number,
): LinhaDaEmpresa {
  const plano = a ? (planos.get(a.plano_id) ?? null) : null;
  const agendado = a?.plano_agendado_id ? (planos.get(a.plano_agendado_id) ?? null) : null;
  const orgLida = { status: org.status, suspended_kind: org.suspended_kind };
  return {
    id: org.id,
    nome: org.display_name ?? "",
    entrou: org.created_at,
    origem,
    plano: plano
      ? {
          id: plano.id,
          nome: plano.nome,
          preco_cents: plano.preco_cents,
          intervalo: plano.intervalo,
        }
      : null,
    plano_agendado: agendado ? { nome: agendado.nome, em: a?.proximo_vencimento ?? null } : null,
    situacao: situacaoDaEmpresa(a, orgLida, agora),
    teste_ate: a?.trial_ate ?? null,
    proximo: proximoDaRegua(a, orgLida, agora, tolerancia),
    passos: passosFeitos(org.onboarding_state as OnboardingState | null),
    link_de_pagamento: a?.link_de_pagamento ?? null,
  };
}

/** Todas as empresas (menos a demonstração), com a situação. LANÇA na falha. */
export async function lerEmpresasDoCadastro(
  admin: SupabaseClient,
  agora: Date = new Date(),
): Promise<LinhaDaEmpresa[]> {
  const [orgs, assinaturas, origens, planos, tolerancia] = await Promise.all([
    admin
      .from("organizations")
      .select(
        "id, display_name, created_at, status, suspended_kind, onboarding_state, demonstracao",
      )
      .order("created_at", { ascending: false })
      .limit(TETO_DA_LISTA),
    admin.from("cobranca_assinaturas").select(COLUNAS_DA_ASSINATURA).limit(5000),
    admin.from("mia_origem_da_empresa").select("organization_id, origem").limit(5000),
    lerPlanosComModulos(admin),
    toleranciaDias(),
  ]);
  if (orgs.error) throw new Error(`empresas: leitura falhou (${orgs.error.code ?? "sem_codigo"})`);
  if (assinaturas.error)
    throw new Error(`assinaturas: leitura falhou (${assinaturas.error.code ?? "sem_codigo"})`);
  if (origens.error)
    throw new Error(`origens: leitura falhou (${origens.error.code ?? "sem_codigo"})`);
  const porOrg = new Map(
    ((assinaturas.data ?? []) as Array<AssinaturaLida & { organization_id: string }>).map((a) => [
      a.organization_id,
      a,
    ]),
  );
  const origemDe = new Map(
    (
      (origens.data ?? []) as Array<{ organization_id: string; origem: "cadastro" | "implantacao" }>
    ).map((o) => [o.organization_id, o.origem]),
  );
  const planosPorId = new Map(planos.map((p) => [p.id, p]));
  return (
    (orgs.data ?? []) as Array<{
      id: string;
      display_name: string | null;
      created_at: string;
      status: string;
      suspended_kind: string | null;
      onboarding_state: unknown;
      demonstracao: boolean | null;
    }>
  )
    .filter((o) => o.demonstracao !== true && o.status !== "archived" && o.status !== "redacted")
    .map((o) =>
      linhaDe(
        o,
        porOrg.get(o.id) ?? null,
        origemDe.get(o.id) ?? null,
        planosPorId,
        agora,
        tolerancia,
      ),
    );
}

export interface NumerosDoTopo {
  aguardando: number;
  em_teste: number;
  em_dia: number;
  receita_mensal_cents: number;
  em_atraso: number;
  suspensas: number;
  testes_que_acabaram: number;
  viraram_assinatura: number;
}

/** Os números do topo, sobre a lista que a tela mostra (com ou sem as implantadas). Pura. */
export function numerosDoTopo(
  linhas: readonly LinhaDaEmpresa[],
  aguardando: number,
  agora: Date = new Date(),
): NumerosDoTopo {
  const conta = (s: SituacaoDaEmpresa | SituacaoDaEmpresa[]) =>
    linhas.filter((l) => (Array.isArray(s) ? s.includes(l.situacao) : l.situacao === s)).length;
  const acabaram = linhas.filter(
    (l) =>
      l.teste_ate !== null && Date.parse(l.teste_ate) <= agora.getTime() && l.situacao !== "isenta",
  );
  return {
    aguardando,
    em_teste: conta("teste"),
    em_dia: conta("emdia"),
    receita_mensal_cents: linhas
      .filter((l) => (l.situacao === "emdia" || l.situacao === "cancelada") && l.plano)
      .reduce(
        (soma, l) =>
          soma +
          (l.plano!.intervalo === "ano"
            ? Math.round(l.plano!.preco_cents / 12)
            : l.plano!.preco_cents),
        0,
      ),
    em_atraso: conta(["atraso", "prazo"]),
    suspensas: conta("suspensa"),
    testes_que_acabaram: acabaram.length,
    viraram_assinatura: acabaram.filter((l) => l.situacao === "emdia" || l.situacao === "cancelada")
      .length,
  };
}

/** Os pedidos esperando aprovação, com o plano e o que a empresa faz. LANÇA na falha. */
export async function lerPedidosDeCadastro(admin: SupabaseClient): Promise<PedidoDeCadastro[]> {
  const [pedidos, planos] = await Promise.all([
    admin
      .from("registration_requests")
      .select("id, user_id, requested_organization_name, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(100),
    lerPlanosComModulos(admin),
  ]);
  if (pedidos.error)
    throw new Error(`pedidos: leitura falhou (${pedidos.error.code ?? "sem_codigo"})`);
  const nomeDoPlano = new Map(planos.map((p) => [p.id, p.nome]));
  const padrao = planos.find((p) => p.padrao_no_cadastro && p.arquivado_em === null) ?? null;
  return Promise.all(
    (
      (pedidos.data ?? []) as Array<{
        id: string;
        user_id: string;
        requested_organization_name: string;
        created_at: string;
      }>
    ).map(async (p) => {
      const { data } = await admin.auth.admin.getUserById(p.user_id);
      const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
      const planoId = typeof meta.cobranca_plan_id === "string" ? meta.cobranca_plan_id : null;
      const oQueFaz =
        typeof meta.mia_o_que_faz === "string" ? meta.mia_o_que_faz.slice(0, 200) : null;
      return {
        id: p.id,
        empresa: p.requested_organization_name,
        email: maskEmail(data.user?.email ?? null),
        // Sem escolha, a empresa nasce no padrão (o gatilho 0679 decide na aprovação).
        plano: planoId ? (nomeDoPlano.get(planoId) ?? null) : (padrao?.nome ?? null),
        o_que_faz: oQueFaz,
        criado_em: p.created_at,
      };
    }),
  );
}

/** Os números oficiais que entraram pelo Facebook e ainda não estão ligados a uma empresa. LANÇA na falha. */
export async function lerNumerosEsperando(admin: SupabaseClient): Promise<NumeroEsperando[]> {
  const { data, error } = await admin
    .from("meta_onboardings")
    .select("id, waba_id, business_name, phone_number, organization_id, created_at")
    .is("organization_id", null)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error)
    throw new Error(`cadastro incorporado: leitura falhou (${error.code ?? "sem_codigo"})`);
  return (
    (data ?? []) as Array<{
      id: string;
      waba_id: string;
      business_name: string | null;
      phone_number: string | null;
      created_at: string;
    }>
  ).map((n) => ({
    id: n.id,
    conta: n.business_name,
    waba: n.waba_id.length > 8 ? `${n.waba_id.slice(0, 4)}•••${n.waba_id.slice(-4)}` : n.waba_id,
    numero: maskPhone(n.phone_number),
    chegou: n.created_at,
  }));
}

export interface DetalheDaEmpresa extends LinhaDaEmpresa {
  administra: { nome: string | null; email: string | null } | null;
  modulos: OrigemDoModulo[];
  regua: PontoDaRegua[];
}

/** Uma empresa, com a régua e os módulos com a origem. `null` = não existe. LANÇA na falha. */
export async function lerDetalheDaEmpresa(
  admin: SupabaseClient,
  orgId: string,
  agora: Date = new Date(),
): Promise<DetalheDaEmpresa | null> {
  const [org, assinatura, origem, planos, tolerancia, admins] = await Promise.all([
    admin
      .from("organizations")
      .select("id, display_name, created_at, status, suspended_kind, onboarding_state")
      .eq("id", orgId)
      .maybeSingle(),
    admin
      .from("cobranca_assinaturas")
      .select(COLUNAS_DA_ASSINATURA)
      .eq("organization_id", orgId)
      .maybeSingle(),
    admin.from("mia_origem_da_empresa").select("origem").eq("organization_id", orgId).maybeSingle(),
    lerPlanosComModulos(admin),
    toleranciaDias(),
    admin
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("role", "admin")
      .is("revoked_at", null)
      .eq("provisional_until_handover", false)
      .order("created_at")
      .limit(1),
  ]);
  if (org.error || assinatura.error || origem.error || admins.error)
    throw new Error("empresa: leitura falhou");
  if (!org.data) return null;
  const o = org.data as {
    id: string;
    display_name: string | null;
    created_at: string;
    status: string;
    suspended_kind: string | null;
    onboarding_state: unknown;
  };
  const a = (assinatura.data as AssinaturaLida | null) ?? null;
  const linha = linhaDe(
    o,
    a,
    (origem.data as { origem?: "cadastro" | "implantacao" } | null)?.origem ?? null,
    new Map(planos.map((p) => [p.id, p])),
    agora,
    tolerancia,
  );
  const primeiro = ((admins.data ?? []) as Array<{ user_id: string }>)[0]?.user_id ?? null;
  let administra: DetalheDaEmpresa["administra"] = null;
  if (primeiro) {
    const { data } = await admin.auth.admin.getUserById(primeiro);
    const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    administra = {
      nome: typeof meta.full_name === "string" ? meta.full_name : null,
      email: maskEmail(data.user?.email ?? null),
    };
  }
  return {
    ...linha,
    administra,
    modulos: await origemDosModulos(admin, orgId),
    regua: reguaDaEmpresa(
      a,
      { status: o.status, suspended_kind: o.suspended_kind },
      agora,
      tolerancia,
      o.created_at,
    ),
  };
}
