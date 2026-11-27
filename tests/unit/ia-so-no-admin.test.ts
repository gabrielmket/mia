/**
 * FORK MIA (MIA-262) — PROVEDOR, MODELO, CHAVE, CONSUMO E CUSTO SÓ NO ADMIN.
 *
 * Pedido de 25/11/2026: o cliente deixa de ver e de mexer na IA; isso fica com
 * a plataforma. Estes casos prendem as funções que limpam a resposta
 * (`lib/ai/custo-e-da-plataforma.ts`), o aviso de orçamento da Central
 * (`lib/ai/aviso-de-orcamento-ao-cliente.ts`) e, papel por papel, quem passa em
 * cada portão:
 *
 *   papel                         vê custo e consumo   escolhe a IA   mexe na chave
 *   dono / admin da empresa       não                  não            não
 *   gerente / membro da empresa   não                  não            não
 *   agência em suporte (edição)   não                  não            não
 *   plataforma em suporte, edição não                  sim            não
 *   admin da plataforma           sim                  sim            sim
 */
import { describe, expect, it } from "vitest";

import { avisoDeOrcamentoAoCliente } from "@/lib/ai/aviso-de-orcamento-ao-cliente";
import {
  CAMPOS_DO_PRECO,
  podeConfigurarChaveDeIa,
  podeVerCusto,
  semCampos,
  semCustoNaAuditoria,
  semIaDaPlataforma,
} from "@/lib/ai/custo-e-da-plataforma";
import { escolheIa } from "@/lib/ai/trava-da-ia";
import { NAV_CATALOG, type NavMetadata } from "@/lib/navigation/catalogo";
import { canSee } from "@/lib/navigation/interface";

const SESSAO = { status: "active", organization_id: "org-1", agency_id: null } as const;
const PAPEIS = {
  "dono da empresa": { is_platform_admin: false, platform_admin_scope: null, support: null },
  "membro da empresa": { is_platform_admin: false, platform_admin_scope: null, support: null },
  "agência em suporte com edição": {
    is_platform_admin: false,
    platform_admin_scope: null,
    support: { ...SESSAO, access_mode: "full", agency_id: "agencia-1" },
  },
  "plataforma em suporte com edição": {
    is_platform_admin: true,
    platform_admin_scope: "full",
    support: { ...SESSAO, access_mode: "full" },
  },
  "admin da plataforma": { is_platform_admin: true, platform_admin_scope: "full", support: null },
} as const;
type Papel = keyof typeof PAPEIS;
const usuario = (p: Papel) => PAPEIS[p] as never;

describe("quem passa em cada portão da IA", () => {
  const esperado: Record<Papel, [boolean, boolean, boolean]> = {
    "dono da empresa": [false, false, false],
    "membro da empresa": [false, false, false],
    "agência em suporte com edição": [false, false, false],
    "plataforma em suporte com edição": [false, true, false],
    "admin da plataforma": [true, true, true],
  };
  it.each(Object.keys(PAPEIS) as Papel[])("%s", (papel) => {
    const u = usuario(papel);
    expect([podeVerCusto(u), escolheIa(u), podeConfigurarChaveDeIa(u)]).toEqual(esperado[papel]);
  });
});

describe("semIaDaPlataforma: o que sai da resposta", () => {
  const execucao = {
    id: "e1",
    status: "erro",
    latency_ms: 900,
    error_code: "provider_error",
    provider: "openai",
    provedorRotulo: "OpenAI",
    model: "modelo-x",
    input_tokens: 46_000,
    output_tokens: 400,
    cost_cents: 9.68,
    error_message: "texto cru do provedor com o id do modelo",
    http_status: 429,
  };

  it("para quem não vê: provedor, modelo, tokens, custo e o erro cru viram nulo; o resto fica", () => {
    const [limpa] = semIaDaPlataforma([execucao], false);
    expect(limpa).toEqual({
      id: "e1",
      status: "erro",
      latency_ms: 900,
      error_code: "provider_error",
      provider: null,
      provedorRotulo: null,
      model: null,
      input_tokens: null,
      output_tokens: null,
      cost_cents: null,
      error_message: null,
      http_status: null,
    });
  });

  it("nulo, e não zero: zero seria 'não gastou nada'", () => {
    const [limpa] = semIaDaPlataforma([execucao], false);
    expect(limpa?.cost_cents).not.toBe(0);
    expect(limpa?.input_tokens).not.toBe(0);
  });

  it("para a plataforma, nada sai; e a lista original nunca é tocada", () => {
    expect(semIaDaPlataforma([execucao], true)).toEqual([execucao]);
    semIaDaPlataforma([execucao], false);
    expect(execucao.cost_cents).toBe(9.68);
  });

  it("campo que a linha não tem não é criado", () => {
    expect(semCampos({ id: "a" }, ["provider"])).toEqual({ id: "a" });
  });

  it("o preço do catálogo sai sozinho, e o resto do modelo fica (a janela de contexto serve ao editor)", () => {
    const modelo = {
      model_id: "m",
      context_window: 128_000,
      input_price_per_million_cents: 15,
      output_price_per_million_cents: 60,
    };
    expect(semIaDaPlataforma([modelo], false, CAMPOS_DO_PRECO)).toEqual([
      { model_id: "m", context_window: 128_000, input_price_per_million_cents: null, output_price_per_million_cents: null },
    ]);
  });
});

describe("semCustoNaAuditoria: o evento fica, o dólar da IA sai", () => {
  const evento = {
    id: "a1",
    action: "channel.historico_analysis_started",
    metadata: {
      clientes_na_rodada: 50,
      estimativa_cents: 120,
      gasto_ate_aqui_cents: 30,
      gasto_do_mes_cents: 900,
      teto_mensal_cents: 5000,
    },
  };

  it("para a empresa, as quatro chaves de custo saem e a contagem fica", () => {
    expect(semCustoNaAuditoria([evento], false)[0]?.metadata).toEqual({ clientes_na_rodada: 50 });
  });

  it("o dinheiro do CLIENTE (preço de disparo) não é tocado", () => {
    const disparo = { id: "a2", metadata: { preco_cents: 12 } };
    expect(semCustoNaAuditoria([disparo], false)).toEqual([disparo]);
  });

  it("para a plataforma, o evento vem inteiro", () => {
    expect(semCustoNaAuditoria([evento], true)).toEqual([evento]);
  });
});

describe("o aviso de orçamento na Central, para quem não vê custo", () => {
  const parada = {
    kind: "budget_exceeded",
    ref_kind: "ai_budget",
    title: "O limite de gasto com IA foi atingido",
    body: "O gasto de IA deste mês chegou a US$ 50,00 de um limite de US$ 50,00 (100%)…",
  };
  const aviso = { ...parada, kind: "budget_warning", body: "Veja quanto já foi gasto…" };

  it("a parada vira o aviso do plano, sem dólar e sem mandar a uma tela que dá 403", () => {
    const lido = avisoDeOrcamentoAoCliente(parada, false, "pt-BR");
    expect(lido.title).toBe("O uso de IA do plano acabou");
    expect(lido.body).not.toMatch(/US\$|Uso de IA › Orçamento/);
  });

  it("o aviso de 80% diz só que a IA continua", () => {
    const lido = avisoDeOrcamentoAoCliente(aviso, false, "pt-BR");
    expect(lido.body).toBe("A IA continua respondendo normalmente — isto é o aviso, não a parada.");
    expect(lido.title).not.toMatch(/gasto/);
  });

  it("em espanhol também sai sem dólar", () => {
    expect(avisoDeOrcamentoAoCliente(parada, false, "es").body).not.toMatch(/US\$/);
    expect(avisoDeOrcamentoAoCliente(aviso, false, "es").body).toMatch(/La IA sigue/);
  });

  it("a plataforma lê o aviso como foi gravado; o do teto do plano passa intacto", () => {
    expect(avisoDeOrcamentoAoCliente(parada, true, "pt-BR")).toBe(parada);
    const doPlano = { ...parada, ref_kind: "plano" };
    expect(avisoDeOrcamentoAoCliente(doPlano, false, "pt-BR")).toBe(doPlano);
  });
});

describe("a porta Provedores é da plataforma", () => {
  const catalogo: readonly NavMetadata[] = NAV_CATALOG;
  const provedores = catalogo.find((d) => d.href === "/app/ai/providers");

  it("existe no catálogo e é só da plataforma", () => {
    expect(provedores?.somentePlataforma).toBe(true);
  });

  it("o admin da empresa não vê a porta; a plataforma vê", () => {
    expect(canSee(provedores!, false, "admin")).toBe(false);
    expect(canSee(provedores!, true, null)).toBe(true);
  });
});
