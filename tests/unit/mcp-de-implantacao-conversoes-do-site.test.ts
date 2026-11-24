/**
 * FORK MIA (MIA-169) — as ferramentas das CONVERSÕES DO SITE no MCP de
 * plataforma, pelo protocolo, contra tabelas em memória: a seção `site` de
 * plataforma_ver_conversoes, plataforma_garantir_conversoes_do_site,
 * `plataforma: "site"` em plataforma_ligar_conversoes,
 * plataforma_testar_conversoes_do_site e o item no checklist.
 *
 * O que se mede é o banco: o que foi GRAVADO, a REEXECUÇÃO (a segunda chamada
 * não escreve), a recusa que ensina, a trava da demonstração, que só a empresa
 * dona da fonte do cadastro monta, e que nenhuma resposta carrega segredo.
 *
 * ⚠️ NUNCA fala com a Meta nem com o Google: `fetch` é um dublê.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cenarioDaImplantacao, clienteMcp, ORG, TODAS_AS_OPERACOES, type OpcoesDoCenario } from "@/tests/helpers/implantacao-em-memoria";
import type { Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown, credencial: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
vi.mock("@/lib/plataformas-de-anuncio/credenciais", () => ({ lerCredencial: async () => estado.credencial }));
vi.mock("@/lib/plataformas-de-anuncio/google/config", () => ({
  configuracaoDoGoogleAds: () => ({ clientId: "cid", clientSecret: "s", developerToken: "dev", redirectUri: "https://example.test/cb" }),
}));
vi.mock("@/lib/plataformas-de-anuncio/google/token", () => ({
  renovarToken: async () => ({ ok: true, token: { access_token: "token-google-ficticio" } }),
}));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");

const FONTE = "0f000000-0000-4000-8000-0000000000f1";
const FUNIL = "0d000000-0000-4000-8000-0000000000c1";
const E = {
  novo: "0d000000-0000-4000-8000-0000000000e1",
  cadastro: "0d000000-0000-4000-8000-0000000000e2",
  teste: "0d000000-0000-4000-8000-0000000000e3",
  assinante: "0d000000-0000-4000-8000-0000000000e4",
  ganho: "0d000000-0000-4000-8000-0000000000e8",
};
const TOKEN_DO_SITE = "TOKEN-DO-SITE-QUE-NUNCA-SAI";
const CODIGO = "CODIGO-DE-TESTE-77";

async function preparar(opcoes: OpcoesDoCenario & { fonteNaOrg?: boolean } = {}, operacoes: string[] = TODAS_AS_OPERACOES) {
  const cenario = cenarioDaImplantacao(opcoes);
  const t = (nome: string) => cenario.banco.tabela(nome) as Linha[];
  const etapa = (id: string, name: string, position: number, over: Linha = {}): Linha => ({
    id,
    organization_id: ORG,
    pipeline_id: FUNIL,
    name,
    slug: name,
    position,
    is_won: false,
    is_lost: false,
    is_archived: false,
    ...over,
  });
  t("crm_pipelines").push({ id: FUNIL, organization_id: ORG, name: "Vendas", slug: "vendas", position: 1, is_default: false, is_archived: false });
  t("crm_stages").push(
    etapa(E.novo, "Novo contato", 1),
    etapa(E.cadastro, "Cadastro concluído", 2),
    etapa(E.teste, "Em teste", 3),
    etapa(E.assinante, "Assinante", 4),
    etapa(E.ganho, "Reunião agendada", 8, { is_won: true }),
  );
  t("webhook_sources").push({ id: FONTE, organization_id: opcoes.fonteNaOrg === false ? "0a000000-0000-4000-8000-00000000ffff" : ORG });
  estado.cliente = cenario.cliente;
  const mcp = await clienteMcp(criarServidorDePlataforma as never, operacoes);
  return { ...cenario, mcp, tabela: t };
}

const regras = (t: (n: string) => Linha[]) =>
  t("mia_regras_de_conversao_do_site").map((l) => [l.stage_id, l.plataforma, l.evento_meta ?? l.google_acao_id, l.leva_valor, l.enabled]);

const fetch = vi.fn();
beforeEach(() => {
  estado.credencial = { ok: false, motivo: "sem_conexao" };
  vi.stubEnv("CADASTRO_FONTE_DO_CRM", FONTE);
  vi.stubEnv("MIA_META_DATASET_DO_SITE", "900000000000777");
  vi.stubEnv("MIA_META_TOKEN_DO_SITE", TOKEN_DO_SITE);
  vi.stubEnv("META_TEST_EVENT_CODE", CODIGO);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.exemplo.test");
  fetch.mockReset();
  fetch.mockImplementation(async (url: string) =>
    String(url).includes("graph.facebook.com")
      ? new Response(JSON.stringify({ events_received: 1 }), { status: 200 })
      : new Response(JSON.stringify({ results: [{ conversionAction: "customers/1/conversionActions/7000000001" }] }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const PEDIDO = {
  organization_id: ORG,
  funil: "Vendas",
  regras: [
    { etapa: "Cadastro concluído", plataforma: "meta", evento: "CompleteRegistration" },
    { etapa: "Cadastro concluído", plataforma: "google", acao_de_conversao_id: "7915000010" },
    { etapa: "Em teste", plataforma: "meta", evento: "StartTrial" },
    { etapa: "Assinante", plataforma: "meta", evento: "Subscribe" },
    { etapa: "Assinante", plataforma: "meta", evento: "Purchase" },
    { etapa: "Assinante", plataforma: "google", acao_de_conversao_id: "7915000013", leva_valor: true },
  ],
};

describe("plataforma_garantir_conversoes_do_site", () => {
  it("⭐ grava as regras DESLIGADAS, várias por etapa, Purchase e Subscribe com valor; a segunda chamada não escreve", async () => {
    const { mcp, tabela, banco } = await preparar();
    const r = await mcp.chamar("plataforma_garantir_conversoes_do_site", PEDIDO);
    expect(r.erro, r.texto).toBe(false);
    expect(regras(tabela)).toEqual([
      [E.cadastro, "meta_ads", "CompleteRegistration", false, false],
      [E.cadastro, "google_ads", "7915000010", false, false],
      [E.teste, "meta_ads", "StartTrial", false, false],
      [E.assinante, "meta_ads", "Subscribe", true, false],
      [E.assinante, "meta_ads", "Purchase", true, false],
      [E.assinante, "google_ads", "7915000013", true, false],
    ]);
    expect((r.dados.regras as Array<{ desfecho: string }>).every((x) => x.desfecho === "criou")).toBe(true);

    const escritas = banco.escritas.length;
    const deNovo = await mcp.chamar("plataforma_garantir_conversoes_do_site", PEDIDO);
    expect(deNovo.erro, deNovo.texto).toBe(false);
    expect((deNovo.dados.regras as Array<{ desfecho: string }>).every((x) => x.desfecho === "ja_estava")).toBe(true);
    expect(banco.escritas.length).toBe(escritas);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("⭐ recusa que ensina: evento fora dos 4, etapa de ganho, Google sem ação, Purchase sem valor, regra ligada", async () => {
    const { mcp, tabela } = await preparar();
    const chamar = (regras: unknown[]) => mcp.chamar("plataforma_garantir_conversoes_do_site", { organization_id: ORG, funil: "Vendas", regras });

    const fora = await chamar([{ etapa: "Em teste", plataforma: "meta", evento: "LeadSubmitted" }]);
    expect(fora.erro).toBe(true);
    expect(fora.texto).toContain("CompleteRegistration");

    const ganho = await chamar([{ etapa: "Reunião agendada", plataforma: "meta", evento: "Purchase" }]);
    expect(ganho.erro).toBe(true);
    expect(ganho.texto).toContain("ganho");

    const semAcao = await chamar([{ etapa: "Assinante", plataforma: "google" }]);
    expect(semAcao.erro).toBe(true);
    expect(semAcao.texto).toContain("acao_de_conversao_id");

    const semValor = await chamar([{ etapa: "Assinante", plataforma: "meta", evento: "Purchase", leva_valor: false }]);
    expect(semValor.erro).toBe(true);
    expect(semValor.texto).toContain("leva_valor");
    expect(tabela("mia_regras_de_conversao_do_site")).toEqual([]);

    await chamar([{ etapa: "Em teste", plataforma: "meta", evento: "StartTrial" }]);
    tabela("mia_regras_de_conversao_do_site")[0]!.enabled = true;
    const ligada = await chamar([{ etapa: "Em teste", plataforma: "meta", evento: "StartTrial", leva_valor: true }]);
    expect(ligada.erro).toBe(true);
    expect(ligada.texto).toContain("LIGADA");
  });

  it("⭐ só a empresa dona da fonte do cadastro monta: outra empresa e a falta da variável são recusadas", async () => {
    const outra = await preparar({ fonteNaOrg: false });
    const r = await outra.mcp.chamar("plataforma_garantir_conversoes_do_site", PEDIDO);
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("não é a dona da fonte");
    expect(outra.tabela("mia_regras_de_conversao_do_site")).toEqual([]);

    vi.stubEnv("CADASTRO_FONTE_DO_CRM", "");
    const sem = await preparar();
    const r2 = await sem.mcp.chamar("plataforma_garantir_conversoes_do_site", PEDIDO);
    expect(r2.erro).toBe(true);
    expect(r2.texto).toContain("CADASTRO_FONTE_DO_CRM");
  });

  it("é montagem: sem a operação implantar_configuracao, o token não grava", async () => {
    const { mcp, tabela } = await preparar({}, []);
    const r = await mcp.chamar("plataforma_garantir_conversoes_do_site", PEDIDO);
    expect(r.erro).toBe(true);
    expect(tabela("mia_regras_de_conversao_do_site")).toEqual([]);
  });
});

describe("plataforma_ligar_conversoes com `plataforma: \"site\"`", () => {
  it("⭐ liga as regras do site das etapas, avisa do código de teste, e a segunda chamada responde ja_estava", async () => {
    const { mcp, tabela } = await preparar();
    await mcp.chamar("plataforma_garantir_conversoes_do_site", PEDIDO);
    const r = await mcp.chamar("plataforma_ligar_conversoes", { organization_id: ORG, plataforma: "site", funil: "Vendas", etapas: ["Cadastro concluído"], ligada: true });
    expect(r.erro, r.texto).toBe(false);
    expect(regras(tabela).filter((x) => x[4] === true).map((x) => x[2])).toEqual(["CompleteRegistration", "7915000010"]);
    expect(JSON.stringify(r.dados.avisos)).toContain("META_TEST_EVENT_CODE");
    expect(r.texto).not.toContain(TOKEN_DO_SITE);

    const deNovo = await mcp.chamar("plataforma_ligar_conversoes", { organization_id: ORG, plataforma: "site", funil: "Vendas", etapas: ["Cadastro concluído"], ligada: true });
    expect((deNovo.dados.regras as Array<{ desfecho: string }>).every((x) => x.desfecho === "ja_estava")).toBe(true);

    const semRegra = await mcp.chamar("plataforma_ligar_conversoes", { organization_id: ORG, plataforma: "site", funil: "Vendas", etapas: ["Novo contato"], ligada: true });
    expect(semRegra.erro).toBe(true);
    expect(semRegra.texto).toContain("plataforma_garantir_conversoes_do_site");
  });

  it("é colocar_no_ar: só com montagem, o token não liga", async () => {
    const { mcp, tabela } = await preparar({}, ["implantar_configuracao"]);
    await mcp.chamar("plataforma_garantir_conversoes_do_site", PEDIDO);
    const r = await mcp.chamar("plataforma_ligar_conversoes", { organization_id: ORG, plataforma: "site", funil: "Vendas", ligada: true });
    expect(r.erro).toBe(true);
    expect(tabela("mia_regras_de_conversao_do_site").every((l) => l.enabled === false)).toBe(true);
  });
});

describe("plataforma_testar_conversoes_do_site", () => {
  it("⭐ manda a Ana Exemplo à Meta em teste e ao Google só validando, e NÃO grava no livro-razão", async () => {
    estado.credencial = {
      ok: true,
      credencial: { datasetId: "", accessToken: "", testEventCode: null, google: { api: "google_ads", refreshToken: "r", customerId: "1234567890", loginCustomerId: null, conversionActionId: "" } },
    };
    const { mcp, tabela } = await preparar();
    const r = await mcp.chamar("plataforma_testar_conversoes_do_site", { organization_id: ORG, evento: "Purchase", acao_de_conversao_id: "7915000013" });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.meta).toMatchObject({ aceito: true });

    const meta = fetch.mock.calls.find(([u]) => String(u).includes("graph.facebook.com"))!;
    const corpoMeta = JSON.parse(String((meta[1] as RequestInit).body));
    expect(String(meta[0])).toContain("/900000000000777/events");
    expect(corpoMeta.test_event_code).toBe(CODIGO);
    expect(corpoMeta.data[0]).toMatchObject({ event_name: "Purchase", action_source: "website", event_source_url: "https://app.exemplo.test/signup" });
    expect(corpoMeta.data[0].custom_data).toMatchObject({ value: 1, currency: "BRL" });
    // A Ana Exemplo consentiu a medição: o corpo leva o que vem do navegador.
    expect(corpoMeta.data[0].user_data).toMatchObject({
      client_ip_address: "203.0.113.10",
      fbp: "fb.1.1700000000000.1234567890",
      fbc: "fb.1.1700000000000.teste-das-conversoes-do-site",
    });
    expect(corpoMeta.data[0].user_data.client_user_agent).toContain("teste-das-conversoes-do-site");

    const google = fetch.mock.calls.find(([u]) => String(u).includes("googleads.googleapis.com"))!;
    const corpoGoogle = JSON.parse(String((google[1] as RequestInit).body));
    expect(corpoGoogle.validateOnly).toBe(true);
    expect(corpoGoogle.conversions[0].conversionAction).toBe("customers/1234567890/conversionActions/7915000013");

    expect(tabela("ad_conversion_dispatches")).toEqual([]);
    expect(r.texto).not.toContain(TOKEN_DO_SITE);
    expect(r.texto).not.toContain(CODIGO);
  });

  it("⭐ recusa sem o código de teste, e nada sai", async () => {
    vi.stubEnv("META_TEST_EVENT_CODE", "");
    const { mcp } = await preparar();
    const r = await mcp.chamar("plataforma_testar_conversoes_do_site", { organization_id: ORG });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("META_TEST_EVENT_CODE");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("⭐ a empresa de demonstração", () => {
  it("não monta, não liga e não testa conversões do site, e nada sai", async () => {
    const { mcp, tabela } = await preparar({ demonstracao: true });
    for (const [nome, args] of [
      ["plataforma_garantir_conversoes_do_site", PEDIDO],
      ["plataforma_ligar_conversoes", { organization_id: ORG, plataforma: "site", funil: "Vendas", ligada: true }],
      ["plataforma_testar_conversoes_do_site", { organization_id: ORG }],
    ] as const) {
      const r = await mcp.chamar(nome, args);
      expect(r.erro, nome).toBe(true);
      expect(r.texto).toContain("demonstração");
    }
    expect(tabela("mia_regras_de_conversao_do_site")).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("a leitura e o checklist", () => {
  it("plataforma_ver_conversoes ganha a seção `site`, sem segredo; o checklist conta as regras do site", async () => {
    const { mcp, tabela } = await preparar();
    await mcp.chamar("plataforma_garantir_conversoes_do_site", PEDIDO);
    const regra = tabela("mia_regras_de_conversao_do_site")[0]!;
    tabela("ad_conversion_dispatches").push({
      organization_id: ORG,
      lead_id: "0e000000-0000-4000-8000-000000000001",
      platform: "meta_ads",
      event_name: `MetaEtapa:${regra.id}`,
      meta_event_name: "CompleteRegistration",
      status: "skipped",
      reason: "site_sem_credencial",
      detail: null,
      attempted_at: new Date().toISOString(),
    });

    const ver = await mcp.chamar("plataforma_ver_conversoes", { organization_id: ORG });
    expect(ver.erro, ver.texto).toBe(false);
    const site = ver.dados.site as Record<string, unknown>;
    expect(site).toMatchObject({
      empresa_da_fonte_do_cadastro: true,
      credencial_da_meta_do_site: "configurada",
      modo_de_teste: true,
      variaveis_configuradas: { fonte_do_cadastro: true, dataset_do_site: true, token_do_site: true, codigo_de_teste: true },
    });
    expect((site.regras as unknown[]).length).toBe(6);
    expect(site.regras).toContainEqual(expect.objectContaining({ funil: "Vendas", etapa: "Cadastro concluído", plataforma: "meta", evento: "CompleteRegistration", ligada: false }));
    expect(site.ultimos_envios).toEqual([expect.objectContaining({ evento: "Meta · CompleteRegistration", situacao: expect.any(String), motivo: "site_sem_credencial" })]);
    // Sem dado de pessoa nem segredo.
    expect(JSON.stringify(site)).not.toContain("0e000000-0000-4000-8000-000000000001");
    expect(ver.texto).not.toContain(TOKEN_DO_SITE);
    expect(ver.texto).not.toContain(CODIGO);
    expect(ver.texto).not.toContain("900000000000777");

    const imp = await mcp.chamar("plataforma_ver_implantacao", { organization_id: ORG });
    const area = (imp.dados.areas as Array<Record<string, unknown>>).find((a) => a.area === "conversoes")!;
    expect(area.pronto).toContain("0 de 6 regra(s) das conversões do site ligada(s).");
    expect(area.dados).toMatchObject({ regras_do_site: { gravadas: 6, ligadas: 0 } });
  });

  it("na empresa que não é a da fonte, a seção diz isso e o checklist não ganha o item", async () => {
    const { mcp } = await preparar({ fonteNaOrg: false });
    const ver = await mcp.chamar("plataforma_ver_conversoes", { organization_id: ORG });
    expect((ver.dados.site as Record<string, unknown>).empresa_da_fonte_do_cadastro).toBe(false);
    expect((ver.dados.site as Record<string, unknown>).credencial_da_meta_do_site).toBe("não configurada");
    const imp = await mcp.chamar("plataforma_ver_implantacao", { organization_id: ORG });
    const area = (imp.dados.areas as Array<Record<string, unknown>>).find((a) => a.area === "conversoes")!;
    expect(area.dados).not.toHaveProperty("regras_do_site");
  });
});
