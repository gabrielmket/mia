/**
 * FORK MIA (.90) — os dados do card Cobrança do upstream
 * (`components/admin/tenants/CardDeCobranca.tsx`) para a tela das empresas do
 * cadastro. O card é REUSADO como está (gerar link, tornar isenta, dar prazo,
 * trocar plano): as ações são as rotas do dono (`/api/v1/admin/tenants/[id]/assinatura/**`).
 *
 * ESPELHO de `lerCobrancaDoTenant` (`app/admin/(protected)/tenants/[id]/page.tsx`),
 * que é local àquela página. Se o upstream mudar aquela leitura, esta muda junto
 * (a lista dos espelhos está em docs/fork/jornada-de-assinatura.md, seção 6).
 * `null` = a cobrança está desligada. LANÇA na falha.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AssinaturaDoCard, PlanoDoCard } from "@/components/admin/tenants/CardDeCobranca";
import { provedorDaInstalacao } from "@/lib/cobranca/configuracao";
import { exigeDocumento, sugestaoDoCadastro } from "@/lib/cobranca/documento";
import type { ProvedorDeCobranca } from "@/lib/cobranca/vocabulario";
import { moduloLigado } from "@/lib/instalacao/modulos";

export interface DadosDoCardDeCobranca {
  planos: PlanoDoCard[];
  assinatura: AssinaturaDoCard | null;
  pedeDocumento: boolean;
  documentoDoCadastro: string | null;
  suspensaPorCobranca: boolean;
  rotuloAntigo: string | null;
}

export async function lerCardDeCobranca(
  admin: SupabaseClient,
  orgId: string,
): Promise<DadosDoCardDeCobranca | null> {
  if (!(await moduloLigado(admin, "cobranca"))) return null;
  const [planos, assinatura, org, daInstalacao] = await Promise.all([
    admin.from("cobranca_planos").select("id, nome, arquivado_em").order("nome"),
    admin
      .from("cobranca_assinaturas")
      .select(
        "plano_id, estado, trial_ate, prazo_extra_ate, provedor, plano_agendado_id, proximo_vencimento, provedor_cliente_id",
      )
      .eq("organization_id", orgId)
      .maybeSingle(),
    admin
      .from("organizations")
      .select("status, suspended_kind, settings, cnpj")
      .eq("id", orgId)
      .maybeSingle(),
    provedorDaInstalacao(),
  ]);
  if (planos.error || assinatura.error || org.error) {
    throw new Error(
      `card de cobrança: leitura falhou (${planos.error?.code ?? assinatura.error?.code ?? org.error?.code})`,
    );
  }
  const rotulo = (org.data?.settings as { plan?: unknown } | null)?.plan;
  const { provedor_cliente_id: clienteNoProvedor, ...semIdDoProvedor } = (assinatura.data ?? {
    provedor_cliente_id: null,
  }) as Record<string, unknown> & {
    provedor_cliente_id: string | null;
  };
  return {
    planos: (planos.data ?? []) as PlanoDoCard[],
    assinatura: (assinatura.data ? semIdDoProvedor : null) as AssinaturaDoCard | null,
    pedeDocumento: exigeDocumento(
      ((assinatura.data as { provedor?: string } | null)?.provedor ??
        daInstalacao) as ProvedorDeCobranca | null,
      clienteNoProvedor !== null,
    ),
    documentoDoCadastro: sugestaoDoCadastro(
      (org.data as { cnpj?: string | null } | null)?.cnpj ?? null,
    ),
    suspensaPorCobranca:
      (org.data as { status?: string } | null)?.status === "suspended" &&
      (org.data as { suspended_kind?: string | null } | null)?.suspended_kind === "cobranca",
    rotuloAntigo: typeof rotulo === "string" && rotulo !== "" ? rotulo : null,
  };
}
