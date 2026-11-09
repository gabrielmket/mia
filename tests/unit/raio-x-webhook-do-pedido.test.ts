/**
 * FORK MIA (.107) · O AVISO DO ASAAS DE UM PEDIDO DO RAIO-X, no webhook que já
 * existe (`app/api/v1/webhooks/cobranca/[provedor]`), SEM quebrar o que ele faz
 * hoje.
 *
 * O cliente do Asaas de uma conta do raio-X não é empresa da MIA: o aviso
 * acorda a releitura dos pedidos DELA (`relerPedidosDaConta`, que confere no
 * Asaas), não emite `cobranca.sinal`, não passa pelo balde dos desconhecidos e
 * fecha a linha. O cliente de uma empresa e o desconhecido seguem como antes
 * (os casos inteiros moram no teste da rota).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { argumentos, bancoFalso, operacao, type BancoFalso, type Cadeia, type Resposta } from "@/tests/helpers/banco-falso-da-cobranca";

const h = vi.hoisted(() => ({
  sinal: { eventoId: "evt_raiox_1", tipo: "PAYMENT_RECEIVED", clienteRef: "cus_raiox_teste" } as { eventoId: string; tipo: string; clienteRef: string | null },
  dona: null as { organization_id: string } | null,
  contaDoCliente: "e9152e90-5555-4000-8000-000000000001" as string | null,
  baldes: [] as string[],
  relidos: [] as string[],
  falhas: 0,
  banco: undefined as unknown as BancoFalso,
}));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: async () => true }));
vi.mock("@/lib/cobranca/configuracao", () => ({ segredoDoWebhook: async () => "token_do_aviso_de_teste" }));
vi.mock("@/lib/cobranca/provedores", () => ({ adaptador: () => ({ verificarWebhook: () => h.sinal }) }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: async (balde: string) => {
    h.baldes.push(balde);
    return { allowed: true };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.banco.cliente }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/raio-x/pedidos", () => ({
  contaDoRaioXPeloClienteDoAsaas: async (_admin: unknown, cliente: string) => (cliente === "cus_raiox_teste" ? h.contaDoCliente : null),
  relerPedidosDaConta: async (_admin: unknown, contaId: string) => {
    h.relidos.push(contaId);
    return { pagos: [], cancelados: [], falhas: h.falhas };
  },
}));

const { POST } = await import("@/app/api/v1/webhooks/cobranca/[provedor]/route");

function responder(c: Cadeia): Resposta {
  if (c.tabela === "webhook_events_log") {
    const op = operacao(c);
    if (op === "insert") return { data: { id: "linha-1", status: "received" } };
    return { data: null };
  }
  if (c.tabela === "cobranca_assinaturas") return { data: h.dona };
  return {};
}

const aviso = () =>
  POST(new NextRequest("http://localhost/api/v1/webhooks/cobranca/asaas", { method: "POST", body: '{"id":"evt_raiox_1"}', headers: { "asaas-access-token": "token_do_aviso_de_teste" } }), {
    params: Promise.resolve({ provedor: "asaas" }),
  });
const doLog = (op: string) => h.banco.cadeias.filter((c) => c.tabela === "webhook_events_log" && operacao(c) === op);
const emits = () => h.banco.rpcs.filter((r) => r.nome === "emit_event");

beforeEach(() => {
  h.sinal = { eventoId: "evt_raiox_1", tipo: "PAYMENT_RECEIVED", clienteRef: "cus_raiox_teste" };
  h.dona = null;
  h.contaDoCliente = "e9152e90-5555-4000-8000-000000000001";
  h.baldes = [];
  h.relidos = [];
  h.falhas = 0;
  h.banco = bancoFalso(responder, () => ({ data: "ev-1" }));
});

describe("o aviso do Asaas de um pedido do raio-X", () => {
  it("⭐ acorda a releitura da conta, não emite o sinal das empresas, não passa pelo balde dos desconhecidos e fecha a linha", async () => {
    const res = await aviso();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({ recebido: true, raio_x: true });
    expect(h.relidos).toEqual(["e9152e90-5555-4000-8000-000000000001"]);
    expect(emits()).toEqual([]);
    expect(h.baldes).toEqual([]);
    expect(argumentos(doLog("insert")[0]!, "insert")?.[0]).toMatchObject({ provider: "asaas", organization_id: null, external_id: "evt_raiox_1" });
    expect(argumentos(doLog("update")[0]!, "update")?.[0]).toMatchObject({ status: "processed" });
  });

  it("a releitura que falhou deixa a linha com erro (a próxima abertura da área relê)", async () => {
    h.falhas = 1;
    expect((await aviso()).status).toBe(200);
    expect(argumentos(doLog("update")[0]!, "update")?.[0]).toMatchObject({ status: "error", error_message: "raio_x_releitura_falhou" });
  });

  it("⭐ sem quebrar o de hoje: o cliente de uma EMPRESA emite o sinal e nem pergunta ao raio-X", async () => {
    h.dona = { organization_id: "cccccccc-0000-4000-8000-000000000001" };
    expect((await aviso()).status).toBe(200);
    expect(emits()).toHaveLength(1);
    expect(h.relidos).toEqual([]);
  });

  it("sem quebrar o de hoje: o desconhecido segue desconhecido (balde e cliente_desconhecido)", async () => {
    h.contaDoCliente = null;
    expect((await aviso()).status).toBe(200);
    expect(h.baldes).toEqual(["cobranca-webhook-desconhecido:asaas"]);
    expect(h.relidos).toEqual([]);
    expect(argumentos(doLog("update")[0]!, "update")?.[0]).toMatchObject({ status: "error", error_message: "cliente_desconhecido" });
  });
});
