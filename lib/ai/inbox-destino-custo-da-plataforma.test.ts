/**
 * FORK MIA: o aviso da Central não leva quem não vê custo nem chave de IA a uma
 * tela que o recusa.
 *
 * Neste fork `/app/ai/usage` e `/app/ai/credentials` são da PLATAFORMA
 * (`lib/ai/custo-e-da-plataforma.ts`): admin e gestor do cliente caem em `/403`.
 * O upstream dá ao gestor o botão "Abrir uso de IA" no aviso de orçamento, e ao
 * admin o "Revisar credencial" no de saldo do provedor — os dois, aqui, seriam
 * um convite para a recusa. O padrão do resolvedor continua o do upstream; a
 * rota da Central passa `podeVerCusto(user)`.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolverDestinosDosAvisos } from "./inbox-destino";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

const ORG = "00000000-0000-4000-8000-000000000001";
const CREDENCIAL = "00000000-0000-4000-8000-000000000002";

/** Leitor que enxerga toda linha pedida — a recusa aqui não pode vir da RLS. */
function leitor(): SupabaseClient {
  return {
    from() {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        is: () => chain,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [{ id: CREDENCIAL }], error: null }).then(resolve),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

const orcamento = { kind: "budget_warning", ref_kind: "ai_budget", ref_id: ORG };
const semSaldo = { kind: "other", ref_kind: "ai_provider_credential", ref_id: CREDENCIAL };

describe("Central × custo da plataforma", () => {
  it("admin do cliente, sem ver custo: orçamento e credencial viram orientação, sem botão", async () => {
    const itens = await resolverDestinosDosAvisos(leitor(), ORG, "admin", [orcamento, semSaldo], {
      veCustoEChaveDeIa: false,
    });
    for (const { destination } of itens) {
      expect(destination.estado).toBe("sem_permissao");
      expect("href" in destination).toBe(false);
    }
  });

  it("controle: quem vê custo (a plataforma) recebe os dois botões", async () => {
    const itens = await resolverDestinosDosAvisos(leitor(), ORG, "admin", [orcamento, semSaldo], {
      veCustoEChaveDeIa: true,
    });
    expect(itens.map((i) => ("href" in i.destination ? i.destination.href : null))).toEqual([
      "/app/ai/usage",
      "/app/ai/credentials",
    ]);
  });

  it("sem a opção vale o upstream: o gestor recebe o botão do uso", async () => {
    const [item] = await resolverDestinosDosAvisos(leitor(), ORG, "manager", [orcamento]);
    expect(item?.destination).toMatchObject({ estado: "disponivel", href: "/app/ai/usage" });
  });
});
