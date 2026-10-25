/**
 * FORK MIA (.90) — A ROTINA PULA A EMPRESA CUJO MÓDULO SAIU PELO PLANO
 * (docs/fork/jornada-de-assinatura.md, protótipo de 25/10/2026, tela 4).
 *
 * O motor do Broadcast e o do e-mail marketing perguntam `moduloSaiuPeloPlano`
 * antes de mandar: `true` pausa a campanha com o motivo `modulo_nao_contratado`
 * (os dados ficam). O que se prova:
 *   - TUDO DESLIGADO: com a cobrança desligada a resposta é `false` sem ler
 *     assinatura nem plano, então nada muda para ninguém;
 *   - a isenta, a liberação pela Time e o plano que liga o módulo seguem;
 *   - leitura que falha segue como sempre (não pausa campanha paga por oscilação);
 *   - o worker do Broadcast e o motor do e-mail pausam com o motivo, e sem o
 *     motivo seguem para as paradas de sempre.
 *
 * Nenhum dado daqui é de cliente real.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { argumentosLivres, bancoLivre, operacaoLivre, type CadeiaLivre } from "@/tests/helpers/banco-livre";

const ORG = "00000000-0000-4000-8000-0000000000e9";

// ── o que o worker e o motor importam, dublado ──────────────────────────────
const h = vi.hoisted(() => ({
  saiu: false,
  banco: null as unknown,
  credenciais: vi.fn(async () => null),
}));

vi.mock("@/lib/auth/cron-auth", () => ({ autorizaCron: () => true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.banco }));
vi.mock("@/lib/channels/meta/credenciais-da-org", () => ({ credenciaisDaOrg: h.credenciais }));
vi.mock("@/lib/demonstracao/trava", () => ({ travaDaDemonstracao: async () => ({ travado: false }) }));
vi.mock("@/lib/email/ses", () => ({
  configuracaoDaAmazon: () => ({ configurado: false }),
  enviarPelaAmazon: vi.fn(),
  lerConta: vi.fn(),
}));
vi.mock("@/lib/email-marketing/campanhas", () => ({
  lerCampanha: async () => ({ id: "camp-1", organization_id: ORG, status: "enviando", preco_cents: 5 }),
  nomesDasEmpresas: vi.fn(),
}));
vi.mock("@/lib/planos-mia/modulos", async (original) => {
  const real = await original<typeof import("@/lib/planos-mia/modulos")>();
  return { ...real, moduloSaiuPeloPlano: vi.fn(async () => h.saiu) };
});

import { GET as workerDoBroadcast } from "@/app/api/v1/cron/broadcast-worker/route";
import { rodarUmaCampanha } from "@/lib/email-marketing/motor";
import * as modulos from "@/lib/planos-mia/modulos";

const { moduloSaiuPeloPlano: real } = await vi.importActual<typeof import("@/lib/planos-mia/modulos")>(
  "@/lib/planos-mia/modulos",
);

interface Estado {
  assinatura: { organization_id: string } | null;
  aMao: { id: string } | null;
  doPlano: string[] | null;
  erroNaAssinatura: boolean;
  erroNoPlano: boolean;
}
let e: Estado;

function responder(c: CadeiaLivre) {
  if (c.tabela === "cobranca_assinaturas")
    return e.erroNaAssinatura ? { error: { message: "caiu" } } : { data: e.assinatura };
  if (c.tabela === "organization_modules") return { data: e.aMao };
  if (c.tabela === "broadcasts" && operacaoLivre(c) === "select")
    return {
      data: [
        {
          id: "bc-1",
          organization_id: ORG,
          template_name: "oferta",
          template_language: "pt_BR",
          valores_padrao: {},
          preco_cents: 12,
          status: "enviando",
          agendado_para: null,
          organizations: { status: "active" },
        },
      ],
    };
  return {};
}
const banco = () =>
  bancoLivre(responder, (nome) => {
    if (nome !== "fn_mia_modulos_do_plano") return {};
    return e.erroNoPlano ? { error: { message: "caiu" } } : { data: e.doPlano };
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.saiu = false;
  e = { assinatura: { organization_id: ORG }, aMao: null, doPlano: ["email_marketing"], erroNaAssinatura: false, erroNoPlano: false };
});

describe("moduloSaiuPeloPlano: só diz sim quando tudo foi lido e certo", () => {
  const ligada = { cobrancaLigada: async () => true };

  it("⭐ cobrança desligada: false, sem ler assinatura nem plano (nada muda)", async () => {
    const b = banco();
    expect(await real(b.cliente as never, ORG, "disparador", { cobrancaLigada: async () => false })).toBe(false);
    expect(b.cadeias).toEqual([]);
    expect(b.rpcs).toEqual([]);
  });

  it("o plano sem o módulo: sai", async () => {
    expect(await real(banco().cliente as never, ORG, "disparador", ligada)).toBe(true);
  });

  it("a isenta, a liberação pela Time e o plano que liga: seguem", async () => {
    e.assinatura = null;
    expect(await real(banco().cliente as never, ORG, "disparador", ligada)).toBe(false);
    e.assinatura = { organization_id: ORG };
    e.aMao = { id: "lib-1" };
    expect(await real(banco().cliente as never, ORG, "disparador", ligada)).toBe(false);
    e.aMao = null;
    expect(await real(banco().cliente as never, ORG, "email_marketing", ligada)).toBe(false);
  });

  it("leitura que falha segue como sempre", async () => {
    e.erroNaAssinatura = true;
    expect(await real(banco().cliente as never, ORG, "disparador", ligada)).toBe(false);
    e.erroNaAssinatura = false;
    e.erroNoPlano = true;
    expect(await real(banco().cliente as never, ORG, "disparador", ligada)).toBe(false);
  });
});

describe("o worker do Broadcast", () => {
  const chamar = () => workerDoBroadcast(new NextRequest("http://local.test/api/v1/cron/broadcast-worker"));

  it("⭐ módulo fora do plano: pausa com o motivo e não procura o canal", async () => {
    h.saiu = true;
    const b = banco();
    h.banco = b.cliente;
    const corpo = (await (await chamar()).json()) as { data: { rodou: boolean; motivo: string } };
    expect(corpo.data).toMatchObject({ rodou: false, motivo: "modulo_nao_contratado" });
    expect(vi.mocked(modulos.moduloSaiuPeloPlano)).toHaveBeenCalledWith(b.cliente, ORG, "disparador");
    const pausa = b.cadeias.find((c) => c.tabela === "broadcasts" && operacaoLivre(c) === "update");
    expect(argumentosLivres(pausa!, "update")?.[0]).toMatchObject({ status: "pausada", motivo_da_parada: "modulo_nao_contratado" });
    expect(h.credenciais).not.toHaveBeenCalled();
  });

  it("módulo seguindo: vai para as paradas de sempre (aqui, sem canal)", async () => {
    const b = banco();
    h.banco = b.cliente;
    const corpo = (await (await chamar()).json()) as { data: { motivo: string } };
    expect(corpo.data.motivo).toBe("sem_canal");
    expect(h.credenciais).toHaveBeenCalledWith(ORG);
  });
});

describe("o motor do e-mail marketing", () => {
  const deps = { cotaDaConta: 0, porSegundo: 1, fimDoPrazo: Date.now() + 10_000, cobrancaLigada: async () => true };

  it("⭐ módulo fora do plano: pausa a campanha com o motivo", async () => {
    h.saiu = true;
    const b = banco();
    const r = await rodarUmaCampanha(b.cliente as never, "camp-1", ORG, deps);
    expect(r.parou).toBe("modulo_nao_contratado");
    const pausa = b.cadeias.find((c) => c.tabela === "mia_email_campanhas" && operacaoLivre(c) === "update");
    expect(argumentosLivres(pausa!, "update")?.[0]).toMatchObject({ status: "pausada", motivo_da_pausa: "modulo_nao_contratado" });
  });

  it("módulo seguindo: vai para as paradas de sempre (aqui, a Amazon desligada)", async () => {
    const r = await rodarUmaCampanha(banco().cliente as never, "camp-1", ORG, deps);
    expect(r.parou).toBe("amazon_desligada");
  });
});
