/**
 * FORK MIA (MIA-256) — O MCP DE PLANOS SEGURO.
 *
 * 1. A auditoria das escritas de plano pelo token de PLATAFORMA chega ao banco:
 *    o id do token vai em `metadata.token_de_plataforma_id` e
 *    `actor_api_token_id` (FK para o token de CLIENTE) fica nulo. Antes, o
 *    insert falhava e só o console sabia.
 * 2. Criar e editar plano grava `metadata.antes` e `metadata.depois`, só com os
 *    campos que mudaram (MCP e painel).
 * 3. Em plano que já existe, campo ausente no pedido mantém o valor gravado; o
 *    padrão só vale na criação.
 * 4. O cupom tem operação própria (`gerir_cupons`).
 * 5. `last_used_ip` do token de plataforma é gravado.
 *
 * Nenhum dado daqui é de cliente real.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  audit: vi.fn(async (_e: Record<string, unknown>) => undefined),
  admin: null as unknown,
}));

vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/cobranca/configuracao", () => ({
  toleranciaDias: async () => 7,
  provedorDaInstalacao: async () => "stripe",
  chaveDoProvedor: async () => null,
}));
vi.mock("@/lib/auth/politica-de-cadastro", () => ({ modoDeCadastro: async () => "com_aprovacao" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin }));

import { FERRAMENTA_POR_NOME, FERRAMENTAS } from "@/lib/mcp-plataforma/ferramentas";
import { validarTokenDePlataforma } from "@/lib/mcp-plataforma/auth";
import { OPERACOES, operacaoPorChave } from "@/lib/mcp-plataforma/operacoes";
import { salvarLadoDoPlano } from "@/lib/planos-mia/garantir-planos";
import { antesEDepois, autoriaDoToken } from "@/lib/planos-mia/rastro";
import { argumentosLivres, bancoLivre, operacaoLivre, type CadeiaLivre } from "@/tests/helpers/banco-livre";

const AUTOR = "00000000-0000-4000-8000-0000000000d2";
const TOKEN = "00000000-0000-4000-8000-0000000000d3";
const PLANO = "00000000-0000-4000-8000-0000000000d7";
const LINHA_DO_PLANO = {
  id: PLANO,
  nome: "Essencial",
  preco_cents: 29700,
  moeda: "BRL",
  intervalo: "mes",
  trial_dias: 7,
  max_assentos: 3,
  max_canais: 1,
  teto_ia_usd_cents: 1500,
  padrao_no_cadastro: false,
  oferecido_ao_cliente: false,
  arquivado_em: null,
};
const LADO_DO_PLANO = {
  plano_id: PLANO,
  modulos: ["disparador"],
  preco_por_mensagem_cents: 12,
  preco_por_email_cents: null,
  frase: "Para começar",
  destaque: true,
};

const responder = (planos: unknown[], lado: unknown = null) => (c: CadeiaLivre) => {
  if (c.tabela === "platform_config") return { data: [{ chave: "MODULO_COBRANCA", valor: "ligado" }] };
  if (c.tabela === "cobranca_planos" && operacaoLivre(c) === "insert") return { data: { id: PLANO } };
  if (c.tabela === "cobranca_planos") return { data: planos };
  if (c.tabela === "mia_plano_modulos" && c.passos.some((x) => x.metodo === "maybeSingle")) return { data: lado };
  if (c.tabela === "mia_plano_modulos") return { data: lado ? [lado] : [] };
  return { data: [] };
};

const banco = (planos: unknown[] = [], lado: unknown = null) =>
  bancoLivre(responder(planos, lado), (nome) => (nome === "fn_mia_modulos_do_plano" ? { data: [] } : {}));

const ctx = (b: ReturnType<typeof bancoLivre>) =>
  ({ admin: b.cliente as never, autorUserId: AUTOR, tokenId: TOKEN, requestId: "req" }) as never;

const chamar = (nome: string, b: ReturnType<typeof bancoLivre>, args: Record<string, unknown>) =>
  FERRAMENTA_POR_NOME.get(nome)!.handler(ctx(b), args);

const escritas = (b: ReturnType<typeof bancoLivre>, tabela: string, op: string) =>
  b.cadeias.filter((c) => c.tabela === tabela && operacaoLivre(c) === op);

const auditorias = (acao: string) =>
  h.audit.mock.calls.map(([e]) => e as Record<string, unknown>).filter((e) => e.action === acao);

beforeEach(() => {
  h.audit.mockClear();
});

describe("antesEDepois: só o que mudou", () => {
  it("guarda o antes e o depois dos campos que mudaram e ignora os de controle", () => {
    expect(
      antesEDepois(
        { nome: "Essencial", trial_dias: 7, max_canais: 1, updated_at: "ontem" },
        { nome: "Essencial", trial_dias: 14, max_canais: null, updated_at: "hoje" },
      ),
    ).toEqual({ antes: { trial_dias: 7, max_canais: 1 }, depois: { trial_dias: 14, max_canais: null } });
  });
  it("na criação o antes é nulo; sem mudança, nada", () => {
    expect(antesEDepois(null, { nome: "Novo", preco_cents: 100 })).toEqual({
      antes: null,
      depois: { nome: "Novo", preco_cents: 100 },
    });
    expect(antesEDepois({ preco_cents: "29700", modulos: ["b", "a"] }, { preco_cents: 29700, modulos: ["a", "b"] })).toBeNull();
  });
  it("o token de plataforma vai na metadata; sem token (painel), nada", () => {
    expect(autoriaDoToken(TOKEN)).toEqual({ token_de_plataforma_id: TOKEN, via: "mcp_de_plataforma" });
    expect(autoriaDoToken(null)).toEqual({});
  });
});

describe("plataforma_garantir_planos · campo ausente mantém o valor no plano que existe", () => {
  it("⭐ esquecer numeros, teste_dias, pessoas, teto, oferecido e os módulos não mexe em nada", async () => {
    const b = banco([LINHA_DO_PLANO], LADO_DO_PLANO);
    const r = (await chamar("plataforma_garantir_planos", b, { planos: [{ nome: "Essencial", preco: 297 }] })) as {
      ok: boolean;
      sem_mudanca: string[];
    };
    expect(r).toMatchObject({ ok: true, sem_mudanca: ["Essencial"] });
    expect(escritas(b, "cobranca_planos", "update")).toHaveLength(0);
    expect(escritas(b, "mia_plano_modulos", "upsert")).toHaveLength(0);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("⭐ só o campo que veio muda, e a auditoria guarda o antes e o depois com o token na metadata", async () => {
    const b = banco([LINHA_DO_PLANO], LADO_DO_PLANO);
    const r = (await chamar("plataforma_garantir_planos", b, {
      planos: [{ nome: "Essencial", preco: 297, teste_dias: 14, numeros: null, frase: "Para crescer" }],
    })) as { ok: boolean; ajustados: string[] };
    expect(r).toMatchObject({ ok: true, ajustados: ["Essencial"] });

    const update = argumentosLivres(escritas(b, "cobranca_planos", "update")[0]!, "update")?.[0] as Record<string, unknown>;
    expect(update).toMatchObject({ trial_dias: 14, max_canais: null });
    for (const campo of ["max_assentos", "teto_ia_usd_cents", "oferecido_ao_cliente", "intervalo", "padrao_no_cadastro"])
      expect(update, campo).not.toHaveProperty(campo);

    const lado = argumentosLivres(escritas(b, "mia_plano_modulos", "upsert")[0]!, "upsert")?.[0] as Record<string, unknown>;
    // O upsert leva a linha inteira, com os módulos e o preço de antes: nada se perde.
    expect(lado).toMatchObject({ modulos: ["disparador"], preco_por_mensagem_cents: 12, destaque: true, frase: "Para crescer" });

    const [plano] = auditorias("cobranca.plano_salvo");
    expect(plano).toMatchObject({
      resourceType: "cobranca_plano",
      resourceId: PLANO,
      actorUserId: AUTOR,
      metadata: {
        antes: { trial_dias: 7, max_canais: 1 },
        depois: { trial_dias: 14, max_canais: null },
        token_de_plataforma_id: TOKEN,
      },
    });
    expect(plano!.actorApiTokenId ?? null).toBeNull();

    const [doLado] = auditorias("planos_mia.planos_garantidos");
    expect(doLado).toMatchObject({
      metadata: { antes: { frase: "Para começar" }, depois: { frase: "Para crescer" }, token_de_plataforma_id: TOKEN },
    });
    expect(doLado!.actorApiTokenId ?? null).toBeNull();
  });

  it("na criação, o ausente vale o padrão (14 dias, mensal, oferecido) e a auditoria tem antes nulo", async () => {
    const b = banco();
    await chamar("plataforma_garantir_planos", b, { planos: [{ nome: "Novo", preco: 97 }] });
    const insert = argumentosLivres(escritas(b, "cobranca_planos", "insert")[0]!, "insert")?.[0] as Record<string, unknown>;
    expect(insert).toMatchObject({ trial_dias: 14, intervalo: "mes", oferecido_ao_cliente: true, max_canais: null });
    const [criado] = auditorias("cobranca.plano_salvo");
    expect(criado).toMatchObject({
      resourceId: PLANO,
      metadata: { criado: true, antes: null, depois: { nome: "Novo", preco_cents: 9700, trial_dias: 14 }, token_de_plataforma_id: TOKEN },
    });
    expect(criado!.actorApiTokenId ?? null).toBeNull();
  });

  it("os pacotes de crédito auditam com o token na metadata, sem actor_api_token_id", async () => {
    const b = banco([LINHA_DO_PLANO], LADO_DO_PLANO);
    await chamar("plataforma_garantir_planos", b, { planos: [{ nome: "Essencial", preco: 297 }], pacotes_de_creditos: [100] });
    const [pacotes] = auditorias("planos_mia.pacotes_garantidos");
    expect(pacotes).toMatchObject({ metadata: { ativos: [10000], token_de_plataforma_id: TOKEN } });
    expect(pacotes!.actorApiTokenId ?? null).toBeNull();
  });

  it("a descrição da ferramenta diz que o ausente mantém o valor", () => {
    const d = FERRAMENTA_POR_NOME.get("plataforma_garantir_planos")!.description;
    expect(d).toMatch(/CAMPO AUSENTE/);
    expect(d).toMatch(/fica como está/);
    expect(d).toMatch(/só vale na CRIAÇÃO/);
  });
});

describe("salvarLadoDoPlano pelo painel (sem token)", () => {
  it("grava o antes e o depois, sem token na metadata", async () => {
    const b = banco([LINHA_DO_PLANO], LADO_DO_PLANO);
    const r = await salvarLadoDoPlano(b.cliente as never, PLANO, { destaque: false }, { userId: AUTOR, requestId: "req" });
    expect(r).toMatchObject({ ok: true, mudou: true });
    const [e] = auditorias("planos_mia.planos_garantidos");
    expect(e!.metadata).toEqual({ antes: { destaque: true }, depois: { destaque: false } });
  });
});

describe("a auditoria de plano pelo token de plataforma nunca usa actor_api_token_id", () => {
  // `actor_api_token_id` é FK para `api_tokens` (o token de CLIENTE): com o id
  // de um token de plataforma, o insert falha e a linha some.
  function arquivos(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? arquivos(p) : p.endsWith(".ts") ? [p] : [];
    });
  }
  it("lib/planos-mia e lib/mcp-plataforma não passam actorApiTokenId", () => {
    const raiz = process.cwd();
    const culpados = [...arquivos(path.join(raiz, "lib/planos-mia")), ...arquivos(path.join(raiz, "lib/mcp-plataforma"))]
      .filter((p) => !p.endsWith(".test.ts"))
      .filter((p) => /actorApiTokenId\s*:/.test(readFileSync(p, "utf8")))
      .map((p) => path.relative(raiz, p));
    expect(culpados).toEqual([]);
  });
});

describe("o cupom em operação própria", () => {
  it("⭐ plataforma_garantir_cupom pede gerir_cupons; garantir_planos segue com gerir_planos", () => {
    expect(FERRAMENTA_POR_NOME.get("plataforma_garantir_cupom")!.operacao).toBe("gerir_cupons");
    expect(FERRAMENTA_POR_NOME.get("plataforma_garantir_planos")!.operacao).toBe("gerir_planos");
    expect(FERRAMENTAS.filter((f) => f.operacao === "gerir_cupons").map((f) => f.name)).toEqual(["plataforma_garantir_cupom"]);
  });
  it("a caixinha nova diz o estrago, e a de planos não fala mais em dar cupom", () => {
    expect(operacaoPorChave("gerir_cupons")?.raio).toMatch(/100%/);
    expect(operacaoPorChave("gerir_planos")?.rotulo).not.toMatch(/cupo/i);
    expect(OPERACOES.filter((o) => o.chave === "gerir_cupons")).toHaveLength(1);
  });
});

describe("last_used_ip do token de plataforma", () => {
  function bancoDoToken() {
    return bancoLivre((c) => {
      if (c.tabela === "platform_api_tokens" && c.passos.some((x) => x.metodo === "maybeSingle"))
        return { data: { id: TOKEN, operacoes: ["gerir_planos"], revoked_at: null, expires_at: null } };
      return { data: null };
    });
  }
  const atualizacao = (b: ReturnType<typeof bancoLivre>) =>
    argumentosLivres(b.cadeias.find((c) => c.tabela === "platform_api_tokens" && operacaoLivre(c) === "update")!, "update")?.[0] as
      | Record<string, unknown>
      | undefined;

  it("⭐ grava o IP de onde veio a chamada junto do last_used_at", async () => {
    const b = bancoDoToken();
    h.admin = b.cliente;
    const t = await validarTokenDePlataforma("Bearer dskp_exemplo", "203.0.113.7");
    expect(t.tokenId).toBe(TOKEN);
    await new Promise((r) => setTimeout(r, 0));
    expect(atualizacao(b)).toMatchObject({ last_used_ip: "203.0.113.7" });
    expect(typeof atualizacao(b)?.last_used_at).toBe("string");
  });
  it("sem IP, não apaga o que estava gravado", async () => {
    const b = bancoDoToken();
    h.admin = b.cliente;
    await validarTokenDePlataforma("Bearer dskp_exemplo");
    await new Promise((r) => setTimeout(r, 0));
    expect(atualizacao(b)).not.toHaveProperty("last_used_ip");
  });
  it("a rota passa o IP já no formato do inet", () => {
    const rota = readFileSync(path.join(process.cwd(), "app/api/mcp/plataforma/route.ts"), "utf8");
    expect(rota).toMatch(/validarTokenDePlataforma\(req\.headers\.get\("authorization"\), ipDoClienteParaInet\(req\.headers\)\)/);
  });
});
