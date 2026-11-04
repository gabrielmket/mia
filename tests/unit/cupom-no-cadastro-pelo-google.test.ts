/**
 * FORK MIA (.99) · O CUPOM DO NAVEGADOR VALE NO CADASTRO PELO GOOGLE.
 *
 * Quem chega por `/precos?cupom=CODIGO` guarda o cupom no navegador por 30 dias
 * (cookie `mia_cupom`). No cadastro por e-mail a action o põe em
 * `mia_cupom_do_cadastro`, e o gatilho adiado da 9130 o aplica, com o parceiro,
 * quando a empresa nasce. No "Entrar com Google" o cupom se perdia: a empresa
 * nascia sem ele, e o parceiro ficava sem a comissão.
 *
 * O OAuth do Google não roda no e2e, então a prova é a parte que aplica: a volta
 * (`app/auth/callback/route.ts`) com o banco em memória. O que importa:
 *
 *   - o cupom que vale no plano padrão (o plano da empresa do Google) está em
 *     `mia_cupom_do_cadastro` ANTES de a empresa nascer (a 9130 lê a passagem no
 *     fim da transação que cria a empresa), no cadastro aberto e no com aprovação;
 *   - quem já tem empresa, quem entra por convite e quem chega sem o cookie não
 *     ganham passagem nenhuma (controle negativo);
 *   - o cupom que não vale (fora do plano, pausado, inexistente) e a cobrança
 *     desligada não guardam nada, e nada disso muda o destino nem lança.
 *
 * O resto é da 9130, provado em `tests/invariants/cupons-e-parceiros.test.ts`.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { decidirConviteDoSignup } from "@/lib/auth/convite-no-signup";
import { modoDeCadastro } from "@/lib/auth/politica-de-cadastro";
import { ensureTenantForUser, vinculoAtivo } from "@/lib/auth/provision";
import { guardarCupomDaEntradaComGoogle } from "@/lib/cupons/entrada-com-google";
import { createClient } from "@/lib/supabase/server";

import { bancoEmMemoria, type Linha } from "../helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({
  cobrancaLigada: true,
  db: null as null | { cliente: unknown; db: Record<string, Array<Record<string, unknown>>> },
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.db?.cliente }));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: async () => estado.cobrancaLigada }));
vi.mock("@/lib/auth/dispositivo-confiavel", () => ({ reconhecerDispositivoConfiavel: vi.fn(async () => false) }));
vi.mock("@/lib/auth/aplicar-convite", () => ({ aplicarConvite: vi.fn(async () => ({ ok: true, membershipId: "m1", mudou: true })) }));
vi.mock("@/lib/auth/convite-no-signup", () => ({ decidirConviteDoSignup: vi.fn() }));
vi.mock("@/lib/auth/provision", () => ({ ensureTenantForUser: vi.fn(), vinculoAtivo: vi.fn() }));
vi.mock("@/lib/auth/politica-de-cadastro", () => ({ modoDeCadastro: vi.fn() }));
vi.mock("@/lib/auth/vinculo-revogado", () => ({ acessoFoiRevogado: vi.fn(async () => false) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/branding/saida", () => ({ marcaDaSaida: vi.fn(async () => ({ nome: "Central de Teste" })) }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "http://localhost:3000" } }));

const USUARIO = { id: "11111111-1111-4111-8111-111111111111", email: "dona@exemplo.test" };
const PADRAO = "22222222-2222-4222-8222-222222222222";
const OUTRO = "33333333-3333-4333-8333-333333333333";
const PARCEIRO = "44444444-4444-4444-8444-444444444444";
const AGORA = new Date("2026-11-03T15:00:00Z");

const cupom = (m: Partial<Linha> = {}): Linha => ({
  id: "c0000000-0000-4000-8000-000000000001",
  codigo: "PARCEIRO10",
  beneficio: "pct",
  valor: 10,
  meses: 3,
  setup_tipo: "nenhum",
  setup_valor: 0,
  planos: [PADRAO],
  vale_ate: null,
  limite_de_usos: null,
  parceiro_id: PARCEIRO,
  comissao_pct: null,
  ativo: true,
  ...m,
});

function montarBanco(cupons: Linha[] = [cupom()]) {
  const b = bancoEmMemoria({
    cobranca_planos: [
      { id: PADRAO, nome: "Essencial", preco_cents: 29_700, intervalo: "mes", trial_dias: 14, oferecido_ao_cliente: true, arquivado_em: null, padrao_no_cadastro: true },
      { id: OUTRO, nome: "Profissional", preco_cents: 59_700, intervalo: "mes", trial_dias: 0, oferecido_ao_cliente: true, arquivado_em: null, padrao_no_cadastro: false },
    ],
    mia_cupons: cupons,
    mia_cupom_da_empresa: [],
    mia_cupom_do_cadastro: [],
  });
  estado.db = b as never;
  return b;
}

/** O que estava na passagem do cadastro no instante em que a empresa nasceu. */
let passagemQuandoAEmpresaNasceu: Linha[] | null = null;

function volta(cookie?: string) {
  return new NextRequest("http://localhost:3000/auth/callback?code=abc", cookie ? { headers: { cookie } } : undefined);
}

async function rota() {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      exchangeCodeForSession: vi.fn(async () => ({ data: { user: USUARIO, session: { access_token: "jwt" } }, error: null })),
      mfa: { listFactors: vi.fn(async () => ({ data: { totp: [] } })) },
    },
  } as never);
  return (await import("@/app/auth/callback/route")).GET;
}

const passagem = () => (estado.db?.db.mia_cupom_do_cadastro ?? []) as Linha[];

beforeEach(() => {
  vi.clearAllMocks();
  estado.cobrancaLigada = true;
  passagemQuandoAEmpresaNasceu = null;
  montarBanco();
  vi.mocked(vinculoAtivo).mockResolvedValue(null);
  vi.mocked(modoDeCadastro).mockResolvedValue("aberto");
  vi.mocked(decidirConviteDoSignup).mockReturnValue({ tipo: "provisionar" } as ReturnType<typeof decidirConviteDoSignup>);
  vi.mocked(ensureTenantForUser).mockImplementation(async () => {
    passagemQuandoAEmpresaNasceu = passagem().map((l) => ({ ...l }));
    return { provisioned: true } as never;
  });
});

describe("a volta do Google guarda o cupom do navegador antes de a empresa nascer", () => {
  it("⭐ cadastro aberto: o cupom está na passagem quando a empresa nasce", async () => {
    const GET = await rota();
    const res = await GET(volta("mia_cupom=PARCEIRO10"));

    expect(vi.mocked(ensureTenantForUser)).toHaveBeenCalledWith(USUARIO, { source: "signup" });
    expect(passagemQuandoAEmpresaNasceu).toEqual([expect.objectContaining({ user_id: USUARIO.id, codigo: "PARCEIRO10" })]);
    // O destino não muda por causa do cupom.
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain("/onboarding/welcome");
  });

  it("cadastro com aprovação: a passagem fica esperando a Time aprovar (a empresa nasce lá)", async () => {
    vi.mocked(modoDeCadastro).mockResolvedValue("com_aprovacao");
    const GET = await rota();
    const res = await GET(volta("mia_cupom=PARCEIRO10"));

    expect(vi.mocked(ensureTenantForUser)).not.toHaveBeenCalled();
    expect(passagem()).toEqual([expect.objectContaining({ user_id: USUARIO.id, codigo: "PARCEIRO10" })]);
    expect(await res.text()).toContain("/get-started");
  });

  it("o código chega como o navegador o guardou (escapado, minúsculo) e é normalizado", async () => {
    const GET = await rota();
    await GET(volta(`mia_cupom=${encodeURIComponent(" parceiro10 ")}`));
    expect(passagemQuandoAEmpresaNasceu).toEqual([expect.objectContaining({ codigo: "PARCEIRO10" })]);
  });

  it("controle negativo: sem o cookie, quem já tem empresa e quem entra por convite não ganham passagem", async () => {
    const GET = await rota();
    await GET(volta());
    expect(passagemQuandoAEmpresaNasceu).toEqual([]);
    expect(passagem()).toEqual([]);
    vi.mocked(ensureTenantForUser).mockClear();

    vi.mocked(vinculoAtivo).mockResolvedValue("org-existente");
    await GET(volta("mia_cupom=PARCEIRO10"));
    expect(passagem()).toEqual([]);

    vi.mocked(vinculoAtivo).mockResolvedValue(null);
    vi.mocked(decidirConviteDoSignup).mockReturnValue({
      tipo: "convite",
      token: "tok",
      payload: { invite_id: "i1", email: USUARIO.email, organization_id: "o1", role: "manager", exp: 0 },
    } as ReturnType<typeof decidirConviteDoSignup>);
    await GET(volta("mia_cupom=PARCEIRO10"));
    expect(passagem()).toEqual([]);
    expect(vi.mocked(ensureTenantForUser)).not.toHaveBeenCalled();
  });

  it("o cupom que não vale no plano padrão não é guardado, e a empresa nasce do mesmo jeito", async () => {
    montarBanco([cupom({ planos: [OUTRO] })]);
    const GET = await rota();
    const res = await GET(volta("mia_cupom=PARCEIRO10"));
    expect(passagemQuandoAEmpresaNasceu).toEqual([]);
    expect(vi.mocked(ensureTenantForUser)).toHaveBeenCalledTimes(1);
    expect(await res.text()).toContain("/onboarding/welcome");
  });
});

describe("guardarCupomDaEntradaComGoogle: a régua do cadastro por e-mail, sem a frase", () => {
  it("bom no plano padrão: guarda", async () => {
    const b = montarBanco();
    expect(await guardarCupomDaEntradaComGoogle(b.cliente as never, USUARIO.id, "PARCEIRO10", AGORA)).toBe("guardado");
    expect(b.db.mia_cupom_do_cadastro).toEqual([expect.objectContaining({ user_id: USUARIO.id, codigo: "PARCEIRO10" })]);
  });

  it("pausado, vencido, inexistente ou fora do plano padrão: não vale e não guarda", async () => {
    for (const cupons of [[cupom({ ativo: false })], [cupom({ vale_ate: "2026-10-01" })], [], [cupom({ planos: [OUTRO] })]]) {
      const b = montarBanco(cupons);
      expect(await guardarCupomDaEntradaComGoogle(b.cliente as never, USUARIO.id, "PARCEIRO10", AGORA)).toBe("nao_vale");
      expect(b.db.mia_cupom_do_cadastro).toEqual([]);
    }
  });

  it("sem cookie, com cobrança desligada ou com o banco fora: nada é guardado e nada lança", async () => {
    const b = montarBanco();
    expect(await guardarCupomDaEntradaComGoogle(b.cliente as never, USUARIO.id, undefined, AGORA)).toBe("sem_cupom");
    expect(await guardarCupomDaEntradaComGoogle(b.cliente as never, USUARIO.id, "  ", AGORA)).toBe("sem_cupom");
    estado.cobrancaLigada = false;
    expect(await guardarCupomDaEntradaComGoogle(b.cliente as never, USUARIO.id, "PARCEIRO10", AGORA)).toBe("sem_cupom");
    estado.cobrancaLigada = true;
    const fora = {
      from: () => {
        throw new Error("banco fora");
      },
    };
    expect(await guardarCupomDaEntradaComGoogle(fora as never, USUARIO.id, "PARCEIRO10", AGORA)).toBe("nao_guardado");
    expect(b.db.mia_cupom_do_cadastro).toEqual([]);
  });
});
