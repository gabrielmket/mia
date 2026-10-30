import { z } from "zod";

import {
  CardDeCobranca,
  type AssinaturaDoCard,
  type PlanoDoCard,
} from "@/components/admin/tenants/CardDeCobranca";
import { provedorDaInstalacao } from "@/lib/cobranca/configuracao";
import { exigeDocumento, sugestaoDoCadastro } from "@/lib/cobranca/documento";
import type { ProvedorDeCobranca } from "@/lib/cobranca/vocabulario";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";
// FORK MIA (.98): o cupom e o parceiro na ficha (docs/fork/cupons-e-parceiros.md).
import { CupomEParceiroDoTenant } from "@/components/admin/tenants/CupomEParceiroDoTenant";
import { lerCupomEParceiroDaEmpresa } from "@/lib/cupons/na-ficha";
import { lerParceiros } from "@/lib/parceiros/banco";

import { TenantOverviewClient } from "./_client";

interface TenantDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function TenantDetailPage({ params }: TenantDetailPageProps) {
  const { id } = await params;
  const cobranca = await lerCobrancaDoTenant(id);
  return (
    <div className="space-y-6">
      <TenantOverviewClient id={id} cobrancaLigada={cobranca !== null} />
      {cobranca && <CardDeCobranca orgId={id} {...cobranca} />}
      {cobranca && <CupomEParceiro orgId={id} />}
    </div>
  );
}

/** FORK MIA (.98): o card do cupom e do parceiro, só com a cobrança ligada. */
async function CupomEParceiro({ orgId }: { orgId: string }) {
  const admin = createAdminClient();
  const [dados, parceiros] = await Promise.all([lerCupomEParceiroDaEmpresa(admin, orgId), lerParceiros(admin)]);
  return (
    <CupomEParceiroDoTenant
      orgId={orgId}
      dados={dados}
      parceiros={parceiros.filter((p) => !p.anonimizado_em).map((p) => ({ id: p.id, nome: p.nome }))}
    />
  );
}

/**
 * O card Cobrança (spec da cobrança §9). `null` = a chave está desligada: a
 * página fica como sempre foi. Leitura que falha LANÇA: o card não mostra
 * "isenta" de uma empresa cuja assinatura ninguém leu. O platform admin é
 * conferido pelo layout desta rota.
 */
async function lerCobrancaDoTenant(orgId: string) {
  // Id que não é uuid daria 22P02 no PostgREST e esta página LANÇARIA (500);
  // sem card, o TenantOverviewClient já mostra "não foi possível carregar".
  if (!z.string().uuid().safeParse(orgId).success) return null;
  const admin = createAdminClient();
  if (!(await moduloLigado(admin, "cobranca"))) return null;
  const [planos, assinatura, org, daInstalacao] = await Promise.all([
    admin.from("cobranca_planos").select("id, nome, arquivado_em").order("nome"),
    admin
      .from("cobranca_assinaturas")
      .select("plano_id, estado, trial_ate, prazo_extra_ate, provedor, plano_agendado_id, proximo_vencimento, provedor_cliente_id")
      .eq("organization_id", orgId)
      .maybeSingle(),
    admin.from("organizations").select("status, suspended_kind, settings, cnpj").eq("id", orgId).maybeSingle(),
    provedorDaInstalacao(),
  ]);
  if (planos.error || assinatura.error || org.error) {
    throw new Error(`cobrança do tenant: leitura falhou (${planos.error?.code ?? assinatura.error?.code ?? org.error?.code})`);
  }
  const rotulo = (org.data?.settings as { plan?: unknown } | null)?.plan;
  // O id do cliente no provedor decide só se o documento é pedido; não vai ao componente de cliente.
  const { provedor_cliente_id: clienteNoProvedor, ...semIdDoProvedor } = assinatura.data ?? { provedor_cliente_id: null };
  return {
    planos: (planos.data ?? []) as PlanoDoCard[],
    assinatura: (assinatura.data ? semIdDoProvedor : null) as AssinaturaDoCard | null,
    pedeDocumento: exigeDocumento(
      ((assinatura.data?.provedor ?? daInstalacao) as ProvedorDeCobranca | null),
      clienteNoProvedor !== null,
    ),
    documentoDoCadastro: sugestaoDoCadastro(org.data?.cnpj ?? null),
    suspensaPorCobranca: org.data?.status === "suspended" && org.data?.suspended_kind === "cobranca",
    rotuloAntigo: typeof rotulo === "string" && rotulo !== "" ? rotulo : null,
  };
}
