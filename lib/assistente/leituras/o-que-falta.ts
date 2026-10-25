/**
 * FORK MIA (.91) — A LEITURA "O QUE FALTA": o checklist do MCP, com o acesso de
 * quem pergunta.
 *
 * É a fase 3 do desenho do upstream (#2860, a auditoria da empresa) com a
 * fonte que já existe: as áreas de `plataforma_ver_implantacao`
 * (`lib/mcp-plataforma/checklist/`), avaliadas com o cliente que chega aqui, e
 * o rótulo do cliente (`rotulo-do-cliente.ts`). Não há uma segunda régua.
 *
 * ── O cliente é o de quem chama ─────────────────────────────────────────────
 *
 * No turno do assistente e nas rotas do "o que falta", o cliente é o da SESSÃO
 * (a regra da .88: o assistente vê o que a pessoa vê). A RLS de cada tabela
 * filtra como nas telas, e uma área que o papel não lê fica "não medida": os
 * itens dela saem do rótulo em vez de virarem um "falta" que não é verdade.
 * Este arquivo não importa o cliente de serviço (`assistente-turno-usa-a-sessao`
 * reprova). A única coisa da INSTALAÇÃO que a sessão não lê, a chave da
 * cobrança, chega pronta de quem chama.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Role } from "@/lib/auth/types";
import { organizacaoDaImplantacao, type OrganizacaoDaImplantacao } from "@/lib/implantacao/base";
import { areasPelaChave, avaliarAreas } from "@/lib/mcp-plataforma/checklist/avaliar";
import {
  AREAS_DO_ROTULO_DO_CLIENTE,
  rotuloDoCliente,
  type RotuloDoCliente,
} from "@/lib/mcp-plataforma/checklist/rotulo-do-cliente";

export interface OQueFaltaLido {
  rotulo: RotuloDoCliente;
  organizacao: Pick<OrganizacaoDaImplantacao, "id" | "display_name" | "onboarded_at" | "demonstracao">;
  /** O estado do passo a passo, para o critério de quem vê. */
  onboardingState: unknown;
}

/** Os follow-ups que uma proposta aplicada armou para sair junto com o agente. */
export async function followupsQueSaemComOAgente(db: SupabaseClient, organizationId: string): Promise<string[]> {
  const { data, error } = await db
    .from("mia_assistente_propostas")
    .select("resultado")
    .eq("organization_id", organizationId)
    .eq("tipo", "followup")
    .eq("situacao", "aplicada")
    .is("saiu_com_o_agente_em", null)
    .limit(20);
  if (error) return [];
  return ((data ?? []) as Array<{ resultado: { fluxo_id?: unknown } | null }>)
    .map((l) => l.resultado?.fluxo_id)
    .filter((id): id is string => typeof id === "string");
}

export async function lerOQueFalta(
  db: SupabaseClient,
  entrada: { organizationId: string; papel: Role; cobrancaLigada: boolean; requestId?: string },
): Promise<OQueFaltaLido> {
  const org = await organizacaoDaImplantacao(db, entrada.organizationId);
  const [areas, saemJunto, estado] = await Promise.all([
    avaliarAreas(
      {
        admin: db,
        autorUserId: "",
        tokenId: "",
        requestId: entrada.requestId ?? "",
        instalacao: { cobrancaLigada: entrada.cobrancaLigada },
      },
      org,
      areasPelaChave(AREAS_DO_ROTULO_DO_CLIENTE),
    ),
    followupsQueSaemComOAgente(db, org.id),
    db.from("organizations").select("onboarding_state").eq("id", org.id).maybeSingle(),
  ]);
  return {
    rotulo: rotuloDoCliente(areas, { papel: entrada.papel, followupsQueSaemComOAgente: saemJunto }),
    organizacao: { id: org.id, display_name: org.display_name, onboarded_at: org.onboarded_at, demonstracao: org.demonstracao },
    onboardingState: (estado.data as { onboarding_state?: unknown } | null)?.onboarding_state ?? null,
  };
}
