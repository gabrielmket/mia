/**
 * FORK MIA — AS FERRAMENTAS DE CONVERSÕES do MCP de plataforma, pelo protocolo,
 * contra tabelas de verdade em memória. Desde a .72 as regras da Meta são as do
 * upstream (`meta_ads_conversion_rules`, 0524), gravadas pela mesma função da
 * tela dele (`lib/conversoes/gravar-regras-meta.ts`).
 *
 * O que se mede é o banco, não a resposta: o que foi GRAVADO, em qual linha; a
 * REEXECUÇÃO (a segunda chamada não escreve nada); a recusa que ensina; a
 * separação entre MONTAR (a regra nasce desligada) e LIGAR (`colocar_no_ar`); e
 * que nenhuma resposta carrega segredo.
 *
 * ⚠️ NUNCA fala com a Meta: `fetch` é um dublê, e o teste conta as chamadas.
 *
 * As exigências comuns a toda ferramenta (descrição, exemplo válido, operação
 * no token, organização inexistente) são medidas para todas de uma vez em
 * `mcp-de-implantacao-ferramentas.test.ts`.
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

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { audit } = await import("@/lib/audit");

const FUNIL = "0d000000-0000-4000-8000-0000000000c1";
const E = {
  novo: "0d000000-0000-4000-8000-0000000000e1",
  qualificacao: "0d000000-0000-4000-8000-0000000000e2",
  agendada: "0d000000-0000-4000-8000-0000000000e3",
  compareceu: "0d000000-0000-4000-8000-0000000000e4",
  ganho: "0d000000-0000-4000-8000-0000000000e8",
  perdido: "0d000000-0000-4000-8000-0000000000e9",
};

const TOKEN_CIFRADO = "TOKEN-CIFRADO-QUE-NUNCA-SAI";

async function preparar(opcoes: OpcoesDoCenario = {}, operacoes: string[] = TODAS_AS_OPERACOES) {
  const cenario = cenarioDaImplantacao(opcoes);
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
  cenario.banco.tabela("crm_pipelines").push({
    id: FUNIL,
    organization_id: ORG,
    name: "Agendamentos",
    slug: "agendamentos",
    position: 1,
    is_default: false,
    is_archived: false,
  });
  cenario.banco.tabela("crm_stages").push(
    etapa(E.novo, "Novo contato", 1),
    etapa(E.qualificacao, "Qualificação", 2),
    etapa(E.agendada, "Avaliação agendada", 3),
    etapa(E.compareceu, "Compareceu", 4),
    etapa(E.ganho, "Fechou tratamento", 8, { is_won: true }),
    etapa(E.perdido, "Perdido", 9, { is_lost: true }),
  );
  estado.cliente = cenario.cliente;
  const mcp = await clienteMcp(criarServidorDePlataforma as never, operacoes);
  return { ...cenario, mcp, tabela: (nome: string) => cenario.banco.tabela(nome) as Linha[] };
}

const idaAMeta = vi.fn();

beforeEach(() => {
  estado.credencial = { ok: false, motivo: "sem_conexao" };
  vi.mocked(audit).mockClear();
  idaAMeta.mockReset();
  vi.stubGlobal("fetch", idaAMeta);
});
afterEach(() => vi.unstubAllGlobals());

const daMeta = (tabela: (n: string) => Linha[]) =>
  tabela("meta_ads_conversion_rules").map((l) => [l.stage_id, l.event_name, l.meta_event, l.enabled]);

// ---------------------------------------------------------------------------

describe("plataforma_ver_conversoes", () => {
  it("é leitura livre, e devolve as conexões SEM segredo, as regras por funil e o recomendado", async () => {
    const { mcp, tabela } = await preparar({}, []);
    tabela("ad_platform_connections").push({
      organization_id: ORG,
      platform: "meta_ads",
      dataset_id: "900000000000001",
      access_token_encrypted: TOKEN_CIFRADO,
      test_event_code: "CODIGO-DE-TESTE-9",
      enabled: true,
    });
    tabela("meta_ads_conversion_rules").push({
      id: "r1",
      organization_id: ORG,
      stage_id: E.agendada,
      event_name: `MetaEtapa:${E.agendada}`,
      meta_event: "LeadSubmitted",
      enabled: true,
      configured_at: "2026-09-25T00:00:00Z",
    });
    tabela("ad_conversion_dispatches").push({
      organization_id: ORG,
      lead_id: "0e000000-0000-4000-8000-000000000001",
      platform: "meta_ads",
      event_name: `MetaEtapa:${E.agendada}`,
      meta_event_name: "LeadSubmitted",
      status: "error",
      reason: "recusado_pela_plataforma",
      detail: "token de acesso vencido",
      value_cents: 15000,
      attempted_at: new Date().toISOString(),
    });

    const r = await mcp.chamar("plataforma_ver_conversoes", { organization_id: ORG });
    expect(r.erro, r.texto).toBe(false);
    expect((r.dados.conexoes as { meta: unknown }).meta).toEqual({
      conectada: true,
      destino_de_conversoes: "900000000000001",
      tem_token: true,
      envio_ligado: true,
      modo_de_teste: true,
    });
    // ⭐ Nem o token (cifrado ou não) nem o código de teste saem.
    expect(r.texto).not.toContain(TOKEN_CIFRADO);
    expect(r.texto).not.toContain("CODIGO-DE-TESTE-9");

    const funil = (r.dados.funis as Array<{ funil: string; etapas: Array<Record<string, unknown>>; etapas_de_ganho: string[] }>).find(
      (f) => f.funil === "Agendamentos",
    )!;
    // O recomendado é o do upstream, pelo nome da etapa (`eventoRecomendadoParaMeta`).
    expect(funil.etapas.map((e) => [e.etapa, e.recomendado_para_a_meta])).toEqual([
      ["Novo contato", null],
      ["Qualificação", "QualifiedLead"],
      ["Avaliação agendada", "LeadSubmitted"],
      ["Compareceu", null],
    ]);
    expect(funil.etapas[2]!.meta).toEqual({ ligada: true, evento: "LeadSubmitted", evento_rotulo: "Lead enviado" });
    expect(funil.etapas_de_ganho).toEqual(["Fechou tratamento"]);
    expect(r.dados.ultimos_envios).toEqual([
      expect.objectContaining({ plataforma: "meta_ads", evento: "Lead enviado", situacao: "Recusado pela plataforma", motivo: "token de acesso vencido" }),
    ]);
    expect(r.dados.recusados_em_7_dias).toBe(1);
    expect((r.dados.eventos_da_meta as unknown[]).length).toBe(5);
  });
});

describe("plataforma_garantir_conversoes_da_meta", () => {
  it("⭐ usar o recomendado grava as regras DESLIGADAS, e a segunda chamada não escreve nada", async () => {
    const { mcp, tabela, banco } = await preparar();
    const r = await mcp.chamar("plataforma_garantir_conversoes_da_meta", {
      organization_id: ORG,
      funil: "Agendamentos",
      usar_recomendado: true,
    });
    expect(r.erro, r.texto).toBe(false);
    // Na tabela do upstream, com a chave que a tela dele daria, e DESLIGADAS.
    expect(daMeta(tabela)).toEqual([
      [E.qualificacao, `MetaEtapa:${E.qualificacao}`, "QualifiedLead", false],
      [E.agendada, `MetaEtapa:${E.agendada}`, "LeadSubmitted", false],
    ]);
    expect((r.dados.etapas as Array<{ etapa: string; desfecho: string | null }>).map((e) => [e.etapa, e.desfecho])).toEqual([
      ["Novo contato", null],
      ["Qualificação", "criou"],
      ["Avaliação agendada", "criou"],
      ["Compareceu", null],
    ]);
    expect(String(r.dados.proximo_passo)).toContain("plataforma_ligar_conversoes");

    const escritas = banco.escritas.length;
    const deNovo = await mcp.chamar("plataforma_garantir_conversoes_da_meta", {
      organization_id: ORG,
      funil: "Agendamentos",
      usar_recomendado: true,
    });
    expect((deNovo.dados.etapas as Array<{ desfecho: string | null }>).map((e) => e.desfecho)).toEqual([
      null,
      "ja_estava",
      "ja_estava",
      null,
    ]);
    expect(banco.escritas.length).toBe(escritas);
  });

  it("`regras` vence o recomendado na etapa citada; o mesmo evento em duas etapas é aceito com aviso", async () => {
    const { mcp, tabela } = await preparar();
    const r = await mcp.chamar("plataforma_garantir_conversoes_da_meta", {
      organization_id: ORG,
      funil: FUNIL,
      usar_recomendado: true,
      regras: [
        { etapa: "Avaliação agendada", evento: "InitiateCheckout" },
        { etapa: "compareceu", evento: "InitiateCheckout" },
      ],
    });
    expect(r.erro, r.texto).toBe(false);
    expect(daMeta(tabela)).toEqual([
      [E.qualificacao, `MetaEtapa:${E.qualificacao}`, "QualifiedLead", false],
      [E.agendada, `MetaEtapa:${E.agendada}`, "InitiateCheckout", false],
      [E.compareceu, `MetaEtapa:${E.compareceu}`, "InitiateCheckout", false],
    ]);
    // Na régua do upstream a chave é a ETAPA: o negócio que passar pelas duas manda o evento duas vezes.
    expect(r.dados.avisos).toEqual([expect.stringContaining("«Avaliação agendada» e «Compareceu»: cada etapa envia o seu")]);
  });

  it("recusas que ensinam: etapa que não existe, etapa de ganho, valor fixo sem valor e pedido vazio", async () => {
    const { mcp, tabela } = await preparar();
    const chamar = (regras: unknown[]) =>
      mcp.chamar("plataforma_garantir_conversoes_da_meta", { organization_id: ORG, funil: "Agendamentos", regras });

    const inexistente = await chamar([{ etapa: "Triagem", evento: "LeadSubmitted" }]);
    expect(inexistente.erro).toBe(true);
    expect(inexistente.texto).toContain("«Triagem»");
    expect(inexistente.texto).toContain("«Qualificação»");

    const ganho = await chamar([{ etapa: "Fechou tratamento", evento: "InitiateCheckout" }]);
    expect(ganho.texto).toContain("Ganho é a compra");

    // O canal e o valor por etapa eram da régua da 9017: a do upstream não os tem.
    const campoAntigo = await chamar([{ etapa: "Qualificação", evento: "QualifiedLead", valor: "valor_fixo" }]);
    expect(campoAntigo.erro).toBe(true);

    // Eventos fora da lista do upstream (os da 9017 também: `Schedule`, `SubmitApplication`).
    for (const evento of ["comprou", "Schedule", "SubmitApplication", "agendou"]) {
      const errado = await chamar([{ etapa: "Qualificação", evento }]);
      expect(errado.erro, evento).toBe(true);
      expect(errado.texto, evento).toContain("LeadSubmitted");
    }

    const vazio = await mcp.chamar("plataforma_garantir_conversoes_da_meta", { organization_id: ORG, funil: "Agendamentos" });
    expect(vazio.texto).toContain("usar_recomendado: true");

    const funilErrado = await mcp.chamar("plataforma_garantir_conversoes_da_meta", { organization_id: ORG, funil: "Vendas", usar_recomendado: true });
    expect(funilErrado.texto).toContain("«Agendamentos»");

    expect(tabela("meta_ads_conversion_rules")).toHaveLength(0);
  });
});

describe("⭐ montar não liga: ligar é `colocar_no_ar`", () => {
  it("o token de quem só monta grava a regra e NÃO consegue ligá-la", async () => {
    const { mcp, tabela } = await preparar({}, ["implantar_configuracao"]);
    await mcp.chamar("plataforma_garantir_conversoes_da_meta", { organization_id: ORG, funil: "Agendamentos", usar_recomendado: true });
    const ligar = await mcp.chamar("plataforma_ligar_conversoes", { organization_id: ORG, plataforma: "meta", funil: "Agendamentos", ligada: true });
    expect(ligar.erro).toBe(true);
    expect(ligar.texto).toContain('"colocar_no_ar"');
    const formularios = await mcp.chamar("plataforma_ligar_leads_de_formulario_da_meta", { organization_id: ORG, ligada: true });
    expect(formularios.texto).toContain('"colocar_no_ar"');
    expect(tabela("meta_ads_conversion_rules").every((l) => l.enabled === false)).toBe(true);
    expect(tabela("mia_conversoes_meta_config")).toHaveLength(0);
  });

  it("ligar vale para as etapas que têm regra, avisa quando a conexão não está pronta, e repetir responde `ja_estava`", async () => {
    const { mcp, tabela, banco } = await preparar();
    await mcp.chamar("plataforma_garantir_conversoes_da_meta", { organization_id: ORG, funil: "Agendamentos", usar_recomendado: true });

    const r = await mcp.chamar("plataforma_ligar_conversoes", { organization_id: ORG, plataforma: "meta", funil: "Agendamentos", ligada: true });
    expect(r.erro, r.texto).toBe(false);
    expect(tabela("meta_ads_conversion_rules").map((l) => l.enabled)).toEqual([true, true]);
    expect((r.dados.etapas as Array<{ etapa: string; desfecho: string }>).map((e) => [e.etapa, e.desfecho])).toEqual([
      ["Qualificação", "atualizou"],
      ["Avaliação agendada", "atualizou"],
    ]);
    expect(vi.mocked(audit).mock.calls.map(([e]) => e.action)).toContain("meta_ads_conversion_rules.updated");
    expect(String(r.dados.aviso)).toContain("nada sai até uma pessoa");
    expect(String(r.dados.vale_a_partir_de)).toContain("a partir de agora");

    const escritas = banco.escritas.length;
    const deNovo = await mcp.chamar("plataforma_ligar_conversoes", { organization_id: ORG, plataforma: "meta", funil: "Agendamentos", ligada: true });
    expect((deNovo.dados.etapas as Array<{ desfecho: string }>).every((e) => e.desfecho === "ja_estava")).toBe(true);
    expect(banco.escritas.length).toBe(escritas);

    // Uma etapa só, pelo nome.
    await mcp.chamar("plataforma_ligar_conversoes", { organization_id: ORG, plataforma: "meta", funil: "Agendamentos", etapas: ["Qualificação"], ligada: false });
    expect(tabela("meta_ads_conversion_rules").map((l) => l.enabled)).toEqual([false, true]);
  });

  it("etapa sem regra não liga: a recusa manda criar antes", async () => {
    const { mcp } = await preparar();
    const semNada = await mcp.chamar("plataforma_ligar_conversoes", { organization_id: ORG, plataforma: "meta", funil: "Agendamentos", ligada: true });
    expect(semNada.erro).toBe(true);
    expect(semNada.texto).toContain("plataforma_garantir_conversoes_da_meta");

    await mcp.chamar("plataforma_garantir_conversoes_da_meta", { organization_id: ORG, funil: "Agendamentos", usar_recomendado: true });
    const semRegra = await mcp.chamar("plataforma_ligar_conversoes", { organization_id: ORG, plataforma: "meta", funil: "Agendamentos", etapas: ["Compareceu"], ligada: true });
    expect(semRegra.texto).toContain("Não há regra da Meta em «Compareceu»");
  });

  it("regra LIGADA não é editada pelo garantir: desliga, ajusta, religa", async () => {
    const { mcp, tabela } = await preparar();
    await mcp.chamar("plataforma_garantir_conversoes_da_meta", { organization_id: ORG, funil: "Agendamentos", usar_recomendado: true });
    await mcp.chamar("plataforma_ligar_conversoes", { organization_id: ORG, plataforma: "meta", funil: "Agendamentos", ligada: true });

    const editar = await mcp.chamar("plataforma_garantir_conversoes_da_meta", {
      organization_id: ORG,
      funil: "Agendamentos",
      regras: [{ etapa: "Qualificação", evento: "InitiateCheckout" }],
    });
    expect(editar.erro).toBe(true);
    expect(editar.texto).toContain("está LIGADA em «Qualificação»");
    expect(editar.texto).toContain("Nada foi gravado");
    expect(tabela("meta_ads_conversion_rules").find((l) => l.stage_id === E.qualificacao)!.meta_event).toBe("QualifiedLead");

    // O mesmo pedido, sem mudança, passa: garantir de novo com a regra ligada é `ja_estava`.
    const igual = await mcp.chamar("plataforma_garantir_conversoes_da_meta", { organization_id: ORG, funil: "Agendamentos", usar_recomendado: true });
    expect(igual.erro, igual.texto).toBe(false);
    expect(tabela("meta_ads_conversion_rules").map((l) => l.enabled)).toEqual([true, true]);
  });
});

describe("as regras do Google Ads, que só a tela gravava", () => {
  const REGRA = { etapa: "Qualificação", nome: "Lead qualificado", acao_de_conversao_id: "7123456789", categoria: "QUALIFIED_LEAD" };

  it("a regra nasce DESLIGADA, com o nome de evento que a tela daria, e repetir não escreve", async () => {
    const { mcp, tabela, banco } = await preparar();
    const r = await mcp.chamar("plataforma_garantir_conversoes_do_google", { organization_id: ORG, funil: "Agendamentos", regras: [REGRA] });
    expect(r.erro, r.texto).toBe(false);
    expect(tabela("google_ads_conversion_rules")).toMatchObject([
      {
        organization_id: ORG,
        stage_id: E.qualificacao,
        event_name: `Etapa:${E.qualificacao}`,
        label: "Lead qualificado",
        google_action_id: "7123456789",
        category: "QUALIFIED_LEAD",
        included_in_conversions: true,
        channel: "todos",
        enabled: false,
      },
    ]);
    expect(r.dados.etapas).toEqual([{ etapa: "Qualificação", desfecho: "criou", ligada: false }]);

    const escritas = banco.escritas.length;
    const deNovo = await mcp.chamar("plataforma_garantir_conversoes_do_google", { organization_id: ORG, funil: "Agendamentos", regras: [REGRA] });
    expect(deNovo.dados.etapas).toEqual([{ etapa: "Qualificação", desfecho: "ja_estava", ligada: false }]);
    expect(banco.escritas.length).toBe(escritas);
  });

  it("ligar passa pela gravação da tela; ligada, a regra não é editada", async () => {
    const { mcp, tabela } = await preparar();
    await mcp.chamar("plataforma_garantir_conversoes_do_google", { organization_id: ORG, funil: "Agendamentos", regras: [REGRA] });
    const ligar = await mcp.chamar("plataforma_ligar_conversoes", { organization_id: ORG, plataforma: "google", funil: "Agendamentos", ligada: true });
    expect(ligar.erro, ligar.texto).toBe(false);
    expect(tabela("google_ads_conversion_rules")[0]).toMatchObject({ enabled: true, event_name: `Etapa:${E.qualificacao}` });
    expect(vi.mocked(audit).mock.calls.map(([e]) => e.action)).toContain("google_ads_conversion_rules.updated");

    const editar = await mcp.chamar("plataforma_garantir_conversoes_do_google", {
      organization_id: ORG,
      funil: "Agendamentos",
      regras: [{ ...REGRA, acao_de_conversao_id: "999" }],
    });
    expect(editar.erro).toBe(true);
    expect(editar.texto).toContain("está LIGADA em «Qualificação»");
    expect(tabela("google_ads_conversion_rules")[0]!.google_action_id).toBe("7123456789");
  });

  it("a ação de conversão é só dígitos, e a recusa diz isso", async () => {
    const { mcp, tabela } = await preparar();
    const r = await mcp.chamar("plataforma_garantir_conversoes_do_google", {
      organization_id: ORG,
      funil: "Agendamentos",
      regras: [{ ...REGRA, acao_de_conversao_id: "AW-123/abc" }],
    });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("só dígitos");
    expect(tabela("google_ads_conversion_rules")).toHaveLength(0);
  });
});

describe("plataforma_ligar_leads_de_formulario_da_meta", () => {
  it("liga, repetir responde `ja_estava`, e desliga", async () => {
    const { mcp, tabela, banco } = await preparar();
    const r = await mcp.chamar("plataforma_ligar_leads_de_formulario_da_meta", { organization_id: ORG, ligada: true });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.desfecho).toBe("atualizou");
    expect(tabela("mia_conversoes_meta_config")).toMatchObject([{ organization_id: ORG, leads_de_formulario: true }]);
    expect(String(r.dados.o_que_passa_a_acontecer)).toContain("Ligar não envia o passado");

    const escritas = banco.escritas.length;
    expect((await mcp.chamar("plataforma_ligar_leads_de_formulario_da_meta", { organization_id: ORG, ligada: true })).dados.desfecho).toBe("ja_estava");
    expect(banco.escritas.length).toBe(escritas);

    await mcp.chamar("plataforma_ligar_leads_de_formulario_da_meta", { organization_id: ORG, ligada: false });
    expect(tabela("mia_conversoes_meta_config")[0]!.leads_de_formulario).toBe(false);
  });
});

describe("plataforma_diagnosticar_conversoes_da_meta", () => {
  it("sem conexão: diz isso, com o que fazer, e não consulta a Meta", async () => {
    const { mcp } = await preparar({}, []);
    const r = await mcp.chamar("plataforma_diagnosticar_conversoes_da_meta", { organization_id: ORG });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.em_ordem).toBe(false);
    expect((r.dados.conferencias as Array<{ titulo: string; saude: string }>)[0]).toMatchObject({
      titulo: "A Meta não está conectada",
      saude: "problema",
    });
    expect(idaAMeta).not.toHaveBeenCalled();
  });

  it("com conexão: três LEITURAS na Meta, o veredito, e o token fora da resposta", async () => {
    const { mcp } = await preparar({}, []);
    estado.credencial = { ok: true, credencial: { datasetId: "900000000000001", accessToken: "token-ficticio-em-claro", testEventCode: null } };
    idaAMeta.mockImplementation(async (url: string) => {
      const corpo = String(url).includes("/permissions")
        ? { data: [{ permission: "ads_management", status: "granted" }] }
        : String(url).includes("900000000000001")
          ? { id: "900000000000001", name: "Destino de teste" }
          : { id: "1" };
      return new Response(JSON.stringify(corpo), { status: 200 });
    });
    const r = await mcp.chamar("plataforma_diagnosticar_conversoes_da_meta", { organization_id: ORG });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.em_ordem).toBe(true);
    expect(r.dados.veredito).toBe("Conexão em ordem: a Meta está recebendo.");
    expect(idaAMeta).toHaveBeenCalledTimes(3);
    expect(idaAMeta.mock.calls.every(([, init]) => (init as RequestInit).method === "GET")).toBe(true);
    expect(r.texto).not.toContain("token-ficticio-em-claro");
  });
});

describe("⭐ a empresa de demonstração", () => {
  it("as regras são gravadas e ligadas, a resposta avisa, e nada vai para a Meta", async () => {
    const { mcp, tabela } = await preparar({ demonstracao: true });
    await mcp.chamar("plataforma_garantir_conversoes_da_meta", { organization_id: ORG, funil: "Agendamentos", usar_recomendado: true });
    const ligar = await mcp.chamar("plataforma_ligar_conversoes", { organization_id: ORG, plataforma: "meta", funil: "Agendamentos", ligada: true });
    expect(ligar.erro, ligar.texto).toBe(false);
    expect(String(ligar.dados.aviso)).toContain("Empresa de demonstração");
    expect(tabela("meta_ads_conversion_rules").every((l) => l.enabled === true)).toBe(true);

    const chave = await mcp.chamar("plataforma_ligar_leads_de_formulario_da_meta", { organization_id: ORG, ligada: true });
    expect(String(chave.dados.aviso)).toContain("nada é enviado");

    const ver = await mcp.chamar("plataforma_ver_conversoes", { organization_id: ORG });
    expect(String(ver.dados.empresa_de_demonstracao)).toContain("nada é enviado");
    expect(idaAMeta).not.toHaveBeenCalled();
  });
});

describe("o checklist", () => {
  it("a área de conversões conta as regras e aponta as ferramentas, sem virar pendência", async () => {
    const { mcp } = await preparar();
    await mcp.chamar("plataforma_garantir_conversoes_da_meta", { organization_id: ORG, funil: "Agendamentos", usar_recomendado: true });
    await mcp.chamar("plataforma_ligar_conversoes", { organization_id: ORG, plataforma: "meta", funil: "Agendamentos", etapas: ["Qualificação"], ligada: true });

    const r = await mcp.chamar("plataforma_ver_implantacao", { organization_id: ORG });
    const area = (r.dados.areas as Array<Record<string, unknown>>).find((a) => a.area === "conversoes")!;
    expect(area.situacao).toBe("pronto");
    expect(area.falta).toEqual([]);
    expect(area.pronto).toEqual(["1 de 2 regra(s) de etapa da Meta ligada(s)."]);
    expect(area.dados).toMatchObject({
      opcional: true,
      regras_da_meta: { gravadas: 2, ligadas: 1 },
      regras_do_google: { gravadas: 0, ligadas: 0 },
      leads_de_formulario_da_meta: false,
    });
    expect(String((area.dados as { como_configurar: string }).como_configurar)).toContain("plataforma_garantir_conversoes_da_meta");
    expect((area.so_pela_tela as Array<{ caminho: string }>)[0]!.caminho).toBe("/app/settings/conversoes");
  });
});
