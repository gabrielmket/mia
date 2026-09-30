// @vitest-environment node
/**
 * FORK MIA — A MARCA É DA PLATAFORMA; A DA EMPRESA FICA TRAVADA.
 *
 * Pedido do dono (29/09/2026): "no sistema só a MINHA logo aparece; o cliente
 * não pode colocar a dele". A trava é `MARCA_DA_ORGANIZACAO=travada`, que o
 * `docker-compose.easypanel.yml` grava — e este arquivo prova as quatro frentes:
 *
 *  1. a LEITURA ignora o que a empresa tiver gravado (a trava de verdade: vale
 *     mesmo para quem gravou pelo banco ou pela RPC), sem apagar o dado;
 *  2. a server action e a rota do logo RECUSAM, sem tocar no banco;
 *  3. a tela sai do menu e do hub de quem é do tenant;
 *  4. a MIA vai ao ar com a trava ligada.
 *
 * Cada frente tem o CONTROLE com a variável vazia: sem ela o produto é o do
 * upstream, e é esse o estado em que as e2e dele (marca-logo, logo-moldura)
 * continuam provando a feature dele no CI do fork.
 *
 *     npx vitest run tests/unit/marca-da-organizacao-travada-no-fork.test.ts
 */
import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  selectDaOrganizacao: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: async () => ({
    id: "11111111-1111-4111-8111-111111111111",
    is_platform_admin: false,
    support: null,
  }),
  resolveActiveOrg: async () => ({ orgId: "22222222-2222-4222-8222-222222222222", role: "admin" }),
  mfaEmDivida: async () => false,
}));
vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: async () => null,
  supportWriteError: () => null,
}));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/branding/instalacao", () => ({ invalidarMarcaDaInstalacao: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({
        eq: () => {
          mocks.selectDaOrganizacao();
          return { maybeSingle: async () => ({ data: { settings: { branding: {} } } }) };
        },
      }),
    }),
    storage: { from: () => ({ upload: mocks.upload, remove: vi.fn() }) },
  }),
}));

import { updateMarcaDaOrganizacao } from "@/app/actions/settings/updateMarcaDaOrganizacao";
import { POST as POST_LOGO } from "@/app/api/v1/marca/logo/route";
import { marcaDaOrganizacaoTravada } from "@/lib/branding/marca-da-organizacao-no-fork";
import {
  marcaDaOrganizacaoDeSettings,
  resolverMarcaDaOrganizacao,
} from "@/lib/branding/organizacao";
import { modulosDaOrganizacao } from "@/lib/modulos/liberacao";
import { hubSections } from "@/lib/navigation/registry";
import { marcaDaOrganizacaoParaPdf } from "@/lib/propostas/marca-da-organizacao-para-pdf";

const TELA = "/app/settings/marca";

/** O que o admin de uma empresa gravou — inclusive o logo — e a instalação por baixo. */
const SETTINGS_COM_MARCA = {
  visibility_mode: "own",
  branding: {
    app_name: "Clínica do Cliente",
    accent_hex: "#e11d48",
    logo_path: "org/22222222-2222-4222-8222-222222222222/logo.png",
  },
};
const INSTALACAO = {
  app_name: "MIA",
  logo_url: "https://cdn.exemplo/mia.png",
  logo_path: null,
  accent_hex: "#1651a0",
};
const AMBIENTE = { APP_NAME: "MIA", APP_LOGO_URL: "", APP_ACCENT_HEX: "" };

function travar() {
  vi.stubEnv("MARCA_DA_ORGANIZACAO", "travada");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
  mocks.upload.mockResolvedValue({ error: null });
  vi.stubEnv("MARCA_DA_ORGANIZACAO", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("a chave da trava", () => {
  it("só `travada` trava; vazio, `liberada` e lixo seguem o upstream", () => {
    expect(marcaDaOrganizacaoTravada({ MARCA_DA_ORGANIZACAO: "travada" })).toBe(true);
    expect(marcaDaOrganizacaoTravada({ MARCA_DA_ORGANIZACAO: " TRAVADA " })).toBe(true);
    expect(marcaDaOrganizacaoTravada({})).toBe(false);
    expect(marcaDaOrganizacaoTravada({ MARCA_DA_ORGANIZACAO: "liberada" })).toBe(false);
    expect(marcaDaOrganizacaoTravada({ MARCA_DA_ORGANIZACAO: "sim" })).toBe(false);
  });
});

describe("1. a leitura ignora a marca da empresa", () => {
  it("⭐ travada: vale a da instalação — nome, cor e logo — mesmo com marca gravada", () => {
    travar();
    expect(marcaDaOrganizacaoDeSettings(SETTINGS_COM_MARCA)).toBeNull();
    const marca = resolverMarcaDaOrganizacao(SETTINGS_COM_MARCA, INSTALACAO, AMBIENTE);
    expect(marca.name).toBe("MIA");
    expect(marca.origens).toMatchObject({ nome: "banco", logoUrl: "banco", cor: "banco" });
    expect(marca.logoUrl).toBe("https://cdn.exemplo/mia.png");
    expect(marca.cor?.semente).toBe("#1651a0");
  });

  it("o controle: liberada, a empresa vence campo a campo (o upstream)", () => {
    const marca = resolverMarcaDaOrganizacao(SETTINGS_COM_MARCA, INSTALACAO, AMBIENTE);
    expect(marca.name).toBe("Clínica do Cliente");
    expect(marca.origens.nome).toBe("organizacao");
    expect(marca.origens.cor).toBe("organizacao");
  });

  it("o PDF da proposta também deixa de levar a marca da empresa", async () => {
    travar();
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { settings: SETTINGS_COM_MARCA } }) }),
        }),
      }),
    };
    await expect(marcaDaOrganizacaoParaPdf(db as never, "org")).resolves.toEqual({
      appName: null,
      accentHex: null,
      logoUrl: null,
    });
  });
});

describe("2. a escrita recusa sem tocar no banco", () => {
  it("⭐ a server action devolve `marca_da_plataforma` e não chama a RPC", async () => {
    travar();
    const r = await updateMarcaDaOrganizacao({ app_name: "Outra", accent_hex: "#000000" });
    expect(r).toEqual({ ok: false, error: "marca_da_plataforma" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("o controle: liberada, a mesma chamada grava pela RPC", async () => {
    const r = await updateMarcaDaOrganizacao({ app_name: "Outra", accent_hex: "#000000" });
    expect(r).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("fn_definir_marca_da_organizacao", expect.anything());
  });

  it("⭐ a rota do logo recusa o escopo da EMPRESA com o porquê, antes de subir arquivo", async () => {
    travar();
    const form = new FormData();
    form.set("escopo", "organizacao");
    form.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "l.png", { type: "image/png" }));
    const res = await POST_LOGO(
      new NextRequest("http://x/api/v1/marca/logo", { method: "POST", body: form }),
    );
    expect(res.status).toBe(403);
    const corpo = (await res.json()) as { error: { message: string } };
    expect(corpo.error.message).toMatch(/definida pela plataforma/);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("3. a tela sai do menu e do hub do tenant", () => {
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ is: async () => ({ data: [], error: null }) }) }),
    }),
  };
  const telasDoHub = (modulos: string[], plataforma = false) =>
    hubSections("organizacao", plataforma, "admin", undefined, modulos).flatMap((s) =>
      s.items.map((i) => i.href),
    );

  it("⭐ travada: o admin da empresa não vê a tela de marca", async () => {
    travar();
    const modulos = [...(await modulosDaOrganizacao(db as never, "org"))];
    expect(telasDoHub(modulos)).not.toContain(TELA);
    // As vizinhas continuam lá — a trava tira UMA porta, não o hub.
    expect(telasDoHub(modulos)).toContain("/app/settings/tenant");
  });

  it("o controle: liberada, a tela volta ao hub", async () => {
    const modulos = [...(await modulosDaOrganizacao(db as never, "org"))];
    expect(telasDoHub(modulos)).toContain(TELA);
  });

  it("quem administra a PLATAFORMA continua achando a tela (e lê o porquê nela)", async () => {
    travar();
    const modulos = [...(await modulosDaOrganizacao(db as never, "org"))];
    expect(telasDoHub(modulos, true)).toContain(TELA);
  });
});

describe("4. a MIA vai ao ar com a trava ligada", () => {
  it("o compose do EasyPanel grava `travada` no app e no worker, sem interpolação", () => {
    const compose = readFileSync("docker-compose.easypanel.yml", "utf8");
    const bloco = (servico: string) => {
      const inicio = compose.indexOf(`\n  ${servico}:\n`);
      const resto = compose.slice(inicio + 1);
      const fim = resto.search(/\n {2}[a-z][a-z-]*:\n/);
      return fim === -1 ? resto : resto.slice(0, fim);
    };
    for (const servico of ["app", "worker"]) {
      expect(bloco(servico), `serviço ${servico}`).toMatch(/\n {6}MARCA_DA_ORGANIZACAO: travada\n/);
    }
  });
});
