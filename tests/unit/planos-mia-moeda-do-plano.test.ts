/**
 * FORK MIA — A MOEDA DO PLANO PELO MCP (upstream, migration 9332; MIA-59).
 *
 * `plataforma_garantir_planos` passa a aceitar `moeda` (BRL, USD, EUR) só na
 * CRIAÇÃO, com a régua de `POST /api/v1/admin/cobranca/planos`: o Asaas cobra
 * só em real, e o plano criado não troca de moeda. `plataforma_ver_cobranca`
 * devolve a moeda de cada plano.
 *
 * Nenhum dado daqui é de cliente real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ provedor: "stripe" as "stripe" | "asaas" }));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/cobranca/configuracao", () => ({
  toleranciaDias: async () => 7,
  provedorDaInstalacao: async () => estado.provedor,
  chaveDoProvedor: async () => null,
}));
vi.mock("@/lib/auth/politica-de-cadastro", () => ({ modoDeCadastro: async () => "com_aprovacao" }));

import { FERRAMENTA_POR_NOME } from "@/lib/mcp-plataforma/ferramentas";
import { argumentosLivres, bancoLivre, operacaoLivre, type CadeiaLivre } from "@/tests/helpers/banco-livre";

const AUTOR = "00000000-0000-4000-8000-0000000000d2";
const PLANO = "00000000-0000-4000-8000-0000000000d7";
const LINHA_DO_PLANO = {
  id: PLANO, nome: "Global", preco_cents: 9900, moeda: "USD", intervalo: "mes", trial_dias: 14, max_assentos: null,
  max_canais: null, teto_ia_usd_cents: null, padrao_no_cadastro: false, oferecido_ao_cliente: true, arquivado_em: null,
};

const responder = (planos: unknown[], cobrancaLigada = true) => (c: CadeiaLivre) => {
  if (c.tabela === "platform_config") return { data: cobrancaLigada ? [{ chave: "MODULO_COBRANCA", valor: "ligado" }] : [] };
  if (c.tabela === "cobranca_planos" && operacaoLivre(c) === "insert") return { data: { id: PLANO } };
  if (c.tabela === "cobranca_planos") return { data: planos };
  if (c.tabela === "mia_plano_modulos" && c.passos.some((x) => x.metodo === "maybeSingle")) return { data: null };
  return { data: [] };
};

function banco(planos: unknown[] = []) {
  return bancoLivre(responder(planos), (nome) => (nome === "fn_mia_modulos_do_plano" ? { data: [] } : {}));
}

const chamar = (nome: string, b: ReturnType<typeof bancoLivre>, args: Record<string, unknown>) =>
  FERRAMENTA_POR_NOME.get(nome)!.handler({ admin: b.cliente as never, autorUserId: AUTOR, tokenId: "tok", requestId: "req" } as never, args);

const insercao = (b: ReturnType<typeof bancoLivre>) =>
  b.cadeias.find((c) => c.tabela === "cobranca_planos" && operacaoLivre(c) === "insert");

beforeEach(() => {
  estado.provedor = "stripe";
});

describe("plataforma_garantir_planos · CAMPO NOVO `moeda` (9332)", () => {
  it("⭐ com a Stripe, o plano em dólar nasce com a moeda; sem o campo, a coluna fica com o padrão do banco", async () => {
    const b = banco();
    const r = (await chamar("plataforma_garantir_planos", b, { planos: [{ nome: "Global", preco: 99, moeda: "USD" }] })) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(argumentosLivres(insercao(b)!, "insert")?.[0]).toMatchObject({ nome: "Global", preco_cents: 9900, moeda: "USD" });

    const semMoeda = banco();
    await chamar("plataforma_garantir_planos", semMoeda, { planos: [{ nome: "Essencial", preco: 297 }] });
    expect(argumentosLivres(insercao(semMoeda)!, "insert")?.[0]).not.toHaveProperty("moeda");
  });

  it("com o Asaas, fora do real é recusado com o caminho, sem gravar", async () => {
    estado.provedor = "asaas";
    const b = banco();
    const r = (await chamar("plataforma_garantir_planos", b, { planos: [{ nome: "Global", preco: 99, moeda: "EUR" }] })) as {
      ok: boolean;
      recusas: Array<{ motivo: string }>;
    };
    expect(r.ok).toBe(false);
    expect(r.recusas[0]!.motivo).toContain("conecte a Stripe");
    expect(insercao(b)).toBeUndefined();
  });

  it("plano que já existe não troca de moeda; pedir a mesma moeda segue normal", async () => {
    const b = banco([LINHA_DO_PLANO]);
    const r = (await chamar("plataforma_garantir_planos", b, { planos: [{ nome: "Global", preco: 99, moeda: "BRL" }] })) as {
      ok: boolean;
      recusas: Array<{ motivo: string }>;
    };
    expect(r.ok).toBe(false);
    expect(r.recusas[0]!.motivo).toContain("a moeda não muda depois de criado");

    const igual = (await chamar("plataforma_garantir_planos", banco([LINHA_DO_PLANO]), {
      planos: [{ nome: "Global", preco: 99, moeda: "USD" }],
    })) as { ok: boolean; sem_mudanca: string[] };
    expect(igual).toMatchObject({ ok: true, sem_mudanca: ["Global"] });
  });

  it("plataforma_ver_cobranca devolve a moeda de cada plano (a linha antiga, sem a coluna, é BRL)", async () => {
    // Com o módulo desligado a leitura não consulta o provedor: os planos vêm do mesmo jeito.
    const semColuna = { ...LINHA_DO_PLANO, id: "00000000-0000-4000-8000-0000000000d8", nome: "Antigo", moeda: undefined };
    const r = (await chamar("plataforma_ver_cobranca", bancoLivre(responder([LINHA_DO_PLANO, semColuna], false)), {})) as { planos: Array<Record<string, unknown>> };
    expect(r.planos.find((p) => p.nome === "Global")).toMatchObject({ preco: 99, moeda: "USD" });
    expect(r.planos.find((p) => p.nome === "Antigo")).toMatchObject({ moeda: "BRL" });
  });
});
