/**
 * FORK MIA (9017) — AS AÇÕES DA TELA das conversões da Meta
 * (`app/actions/settings/conversoesDaMeta.ts`): o portão de cada uma, e que a
 * organização vem SEMPRE da sessão, nunca do que o navegador mandou.
 *
 * O miolo (o que é gravado, as recusas de etapa) é medido em
 * `conversoes-da-meta-regras-e-diagnostico.test.ts`; aqui é o portão.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria } from "@/tests/helpers/banco-em-memoria";

const mock = vi.hoisted(() => ({
  user: vi.fn(),
  org: vi.fn(),
  mfa: vi.fn(),
  support: vi.fn(),
  admin: vi.fn(),
  audit: vi.fn(),
  revalidar: vi.fn(),
  diagnosticar: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: mock.user,
  resolveActiveOrg: mock.org,
  mfaEmDivida: mock.mfa,
}));
vi.mock("@/lib/impersonate/support", () => ({ supportWriteError: mock.support }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mock.admin }));
vi.mock("@/lib/audit", () => ({ audit: mock.audit }));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidar }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-request-id": "req-teste" }) }));
vi.mock("@/lib/conversoes-meta/diagnostico", () => ({ diagnosticarConexaoDaMeta: mock.diagnosticar }));

const {
  definirLeadsDeFormularioDaMeta,
  reenviarConversaoDaMeta,
  salvarRegrasDeConversaoMeta,
  testarConexaoDaMeta,
} = await import("@/app/actions/settings/conversoesDaMeta");

const ORG = "0a000000-0000-4000-8000-000000000001";
const ETAPA = "0d000000-0000-4000-8000-000000000001";
const LEAD = "0e000000-0000-4000-8000-000000000001";

const regra = (over: Record<string, unknown> = {}) => ({
  stage_id: ETAPA,
  ligada: true,
  evento: "lead_qualificado" as const,
  canal: "todos" as const,
  modo_do_valor: "sem_valor" as const,
  valor_fixo_centavos: null as number | null,
  ...over,
});

let banco: ReturnType<typeof bancoEmMemoria>;
let reenvioAgendado: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  reenvioAgendado = true;
  banco = bancoEmMemoria(
    {
      crm_stages: [{ id: ETAPA, organization_id: ORG, is_won: false, is_lost: false }],
      mia_conversoes_meta_regras: [],
      mia_conversoes_meta_config: [],
    },
    { fn_mia_solicitar_reenvio_conversao_meta: () => ({ data: reenvioAgendado, error: null }) },
  );
  mock.user.mockResolvedValue({ id: "pessoa", is_platform_admin: false });
  mock.org.mockResolvedValue({ orgId: ORG, role: "admin" });
  mock.support.mockReturnValue(false);
  mock.mfa.mockResolvedValue(false);
  mock.admin.mockReturnValue(banco.cliente);
  mock.diagnosticar.mockResolvedValue({ itens: [], veredito: "em_ordem", testadoEm: "2026-10-01T00:00:00Z" });
});

/** As três ações que ESCREVEM passam pelo mesmo portão. */
const ESCRITAS: Array<[string, () => Promise<{ ok: boolean; error?: string }>]> = [
  ["salvar regras", () => salvarRegrasDeConversaoMeta([regra()])],
  ["ligar a volta dos leads de formulário", () => definirLeadsDeFormularioDaMeta(true)],
  ["reenviar", () => reenviarConversaoDaMeta(LEAD, "Meta:agendou")],
];

describe("o portão das escritas", () => {
  for (const [nome, chamar] of ESCRITAS) {
    it(`${nome}: sem sessão, suporte em modo leitura, papel abaixo de administrador e segundo fator em dívida são recusados`, async () => {
      mock.user.mockResolvedValueOnce(null);
      expect(await chamar()).toEqual({ ok: false, error: "unauthenticated" });

      mock.support.mockReturnValueOnce(true);
      expect(await chamar()).toEqual({ ok: false, error: "forbidden_role" });

      mock.org.mockResolvedValueOnce(null);
      expect(await chamar()).toEqual({ ok: false, error: "forbidden_tenant" });

      for (const papel of ["viewer", "agent", "manager"]) {
        mock.org.mockResolvedValueOnce({ orgId: ORG, role: papel });
        expect(await chamar(), papel).toEqual({ ok: false, error: "forbidden_role" });
      }

      mock.mfa.mockResolvedValueOnce(true);
      expect(await chamar()).toEqual({ ok: false, error: "mfa_required" });

      expect(banco.escritas).toEqual([]);
      expect(banco.chamadasRpc).toEqual([]);
      expect(mock.audit).not.toHaveBeenCalled();
    });
  }

  it("o administrador da plataforma passa pelo papel, menos quando está acompanhando um cliente", async () => {
    mock.user.mockResolvedValue({ id: "plataforma", is_platform_admin: true });
    mock.org.mockResolvedValue({ orgId: ORG, role: "viewer" });
    expect(await definirLeadsDeFormularioDaMeta(true)).toEqual({ ok: true });

    mock.user.mockResolvedValue({ id: "plataforma", is_platform_admin: true, support: { somenteLeitura: false } });
    expect(await definirLeadsDeFormularioDaMeta(false)).toEqual({ ok: false, error: "forbidden_role" });
  });
});

describe("salvar as regras", () => {
  it("grava na organização da SESSÃO, com quem clicou como autor, e revalida a tela", async () => {
    expect(await salvarRegrasDeConversaoMeta([regra({ modo_do_valor: "valor_fixo", valor_fixo_centavos: 15000 })])).toEqual({
      ok: true,
    });
    expect(banco.tabela("mia_conversoes_meta_regras")).toMatchObject([
      { organization_id: ORG, stage_id: ETAPA, evento: "lead_qualificado", ligada: true, valor_fixo_centavos: 15000, atualizada_por: "pessoa" },
    ]);
    expect(mock.audit.mock.calls[0]![0]).toMatchObject({
      action: "conversoes_meta.regras_salvas",
      organizationId: ORG,
      requestId: "req-teste",
      metadata: { via: "tela" },
    });
    expect(mock.revalidar).toHaveBeenCalledWith("/app/settings/conversoes");
  });

  it("o que o navegador manda é conferido: etapa que não é id, evento fora da lista e valor fixo sem valor", async () => {
    for (const ruim of [
      regra({ stage_id: "etapa-1" }),
      regra({ evento: "comprou_tudo" }),
      regra({ canal: "sms" }),
      regra({ modo_do_valor: "valor_fixo", valor_fixo_centavos: null }),
      regra({ modo_do_valor: "valor_fixo", valor_fixo_centavos: 0 }),
      regra({ organization_id: "0a000000-0000-4000-8000-000000000002" }),
    ]) {
      const r = await salvarRegrasDeConversaoMeta([ruim as never]);
      // Campo a mais (a organização de outra empresa) é ignorado pelo esquema, e a gravação sai na da sessão.
      if (r.ok) {
        expect(banco.tabela("mia_conversoes_meta_regras").every((l) => l.organization_id === ORG)).toBe(true);
      } else {
        expect(r.error).toBe("validation_failed");
      }
    }
    expect(await salvarRegrasDeConversaoMeta([regra(), regra()])).toEqual({ ok: false, error: "validation_failed" });
  });

  it("etapa de outra empresa (ou fechada) é recusada pela mesma função que o MCP usa", async () => {
    const r = await salvarRegrasDeConversaoMeta([regra({ stage_id: "0d000000-0000-4000-8000-0000000000ff" })]);
    expect(r).toEqual({ ok: false, error: "etapa_invalida" });
    expect(banco.tabela("mia_conversoes_meta_regras")).toHaveLength(0);
  });
});

describe("o teste de conexão", () => {
  it("é leitura: exige o papel, e não a guarda de escrita nem o segundo fator", async () => {
    mock.support.mockReturnValue(true);
    mock.mfa.mockResolvedValue(true);
    expect(await testarConexaoDaMeta()).toMatchObject({ ok: true, diagnostico: { veredito: "em_ordem" } });
    expect(mock.diagnosticar).toHaveBeenCalledWith(banco.cliente, ORG);

    mock.org.mockResolvedValueOnce({ orgId: ORG, role: "manager" });
    expect(await testarConexaoDaMeta()).toEqual({ ok: false, error: "forbidden_role" });
    expect(mock.audit).not.toHaveBeenCalled();
  });

  it("banco fora: a tela recebe \"não consegui ler\", e não um diagnóstico inventado", async () => {
    mock.diagnosticar.mockRejectedValueOnce(new Error("banco fora"));
    expect(await testarConexaoDaMeta()).toEqual({ ok: false, error: "leitura_indisponivel" });
  });
});

describe("o reenvio de um evento de etapa", () => {
  it("chama a função do banco com a organização da sessão, e audita quando agendou", async () => {
    expect(await reenviarConversaoDaMeta(LEAD, "Meta:agendou")).toEqual({ ok: true, agendado: true });
    expect(banco.chamadasRpc).toEqual([
      { nome: "fn_mia_solicitar_reenvio_conversao_meta", args: { p_org: ORG, p_lead: LEAD, p_event: "Meta:agendou" } },
    ]);
    expect(mock.audit.mock.calls[0]![0]).toMatchObject({
      action: "conversoes_meta.reenvio_solicitado",
      resourceId: LEAD,
      metadata: { event_name: "Meta:agendou" },
    });
  });

  it("o banco decidiu que não há o que reenviar: não é erro, e não audita", async () => {
    reenvioAgendado = false;
    expect(await reenviarConversaoDaMeta(LEAD, "Meta:agendou")).toEqual({ ok: true, agendado: false });
    expect(mock.audit).not.toHaveBeenCalled();
  });

  it("só evento de etapa da Meta entra por aqui: a compra e os do Google têm a rota do upstream", async () => {
    for (const evento of ["Purchase", "QualifiedLead", "Etapa:11111111-1111-4111-8111-111111111111", "Meta:AGENDOU", ""]) {
      expect(await reenviarConversaoDaMeta(LEAD, evento), evento).toEqual({ ok: false, error: "validation_failed" });
    }
    expect(await reenviarConversaoDaMeta("lead-1", "Meta:agendou")).toEqual({ ok: false, error: "validation_failed" });
    expect(banco.chamadasRpc).toEqual([]);
  });
});
