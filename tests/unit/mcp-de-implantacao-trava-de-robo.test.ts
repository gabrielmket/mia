/**
 * FORK MIA (.108) · A TRAVA DE ROBÔ NO MCP DE PLATAFORMA
 * (lib/mcp-plataforma/ferramentas/trava-de-robo.ts; docs/fork/trava-de-robo.md).
 *
 * Três ferramentas: ver é leitura; configurar exige `implantar_configuracao`
 * (vale na hora para todo contato do cliente); desfazer exige `colocar_no_ar`
 * (a IA volta a mandar mensagem para aquele contato). A lista passa a 115.
 *
 * Banco em memória, dado fictício.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ auditados: [] as Array<{ action: string; metadata?: Record<string, unknown> }> }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (e: { action: string; metadata?: Record<string, unknown> }) => {
    h.auditados.push(e);
  }),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));

const { FERRAMENTA_POR_NOME, FERRAMENTAS } = await import("@/lib/mcp-plataforma/ferramentas");
const { operacaoPorChave } = await import("@/lib/mcp-plataforma/operacoes");
const { bancoEmMemoria } = await import("@/tests/helpers/banco-em-memoria");
const { CONFIG_PADRAO_DA_TRAVA } = await import("@/lib/trava-de-robo/config");

const ORG = "0b0c0d0e-1111-4111-8111-000000000108";
const OUTRA_ORG = "0b0c0d0e-1111-4111-8111-000000000208";
const CONV = "0b0c0d0e-2222-4222-8222-000000000108";
const CONTATO = "0b0c0d0e-3333-4333-8333-000000000108";
const REGISTRO = "0b0c0d0e-4444-4444-8444-000000000108";
const LEAD = "0b0c0d0e-5555-4555-8555-000000000108";
const AUTOR = "0b0c0d0e-6666-4666-8666-000000000108";

const NOMES = ["plataforma_ver_travas_de_robo", "plataforma_configurar_trava_de_robo", "plataforma_desfazer_trava_de_robo"];

function banco(extras: Record<string, Array<Record<string, unknown>>> = {}) {
  return bancoEmMemoria({
    organizations: [
      { id: ORG, display_name: "Clínica Exemplo", status: "active", settings: {}, locale: "pt-BR" },
      { id: OUTRA_ORG, display_name: "Loja Exemplo", status: "active", settings: {}, locale: "pt-BR" },
    ],
    contacts: [
      {
        id: CONTATO,
        organization_id: ORG,
        name: "Operadora Exemplo",
        phone_number: "5511900000000",
        force_human: true,
        ai_opt_out: false,
        tags: ["prospeccao", "robô"],
      },
    ],
    conversations: [
      {
        id: CONV,
        organization_id: ORG,
        contact_id: CONTATO,
        status: "closed",
        is_group: false,
        assignee_kind: "ai",
        assigned_to_user_id: null,
        bot_silenced_until: null,
        last_handoff_at: null,
      },
    ],
    crm_leads: [{ id: LEAD, organization_id: ORG, contact_id: CONTATO, pipeline_id: "f", stage_id: "perdido", status: "lost", lost_reason: "Robô ou atendimento automático" }],
    ...extras,
  });
}

const registro = (ajuste: Record<string, unknown> = {}) => ({
  id: REGISTRO,
  organization_id: ORG,
  contact_id: CONTATO,
  conversation_id: CONV,
  job_id: null,
  motivo: "robo",
  sinais: [{ mensagem_id: "0b0c0d0e-7777-4777-8777-000000000001", sinais: ["autodeclaracao"] }],
  mensagens_de_robo: 3,
  respostas_da_ia: 3,
  duracao_segundos: 60,
  negocios_afetados: [LEAD],
  conversa_encerrada: true,
  etiqueta_aplicada: true,
  followups_cancelados: 1,
  falhas: [],
  desfeita_em: null,
  desfeita_por_user_id: null,
  created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  ...ajuste,
});

const ctx = (b: ReturnType<typeof banco>) => ({ admin: b.cliente as never, autorUserId: AUTOR, tokenId: "t", requestId: "r" });
const chamar = (nome: string, b: ReturnType<typeof banco>, args: Record<string, unknown>) =>
  FERRAMENTA_POR_NOME.get(nome)!.handler(ctx(b), args) as Promise<Record<string, unknown>>;

beforeEach(() => {
  h.auditados = [];
});

describe("as três da trava de robô", () => {
  it("estão na lista, e a lista tem 130 (112 da .107 + as três da .108 + as duas do produto no negócio da .109 + a da lista de espera, MIA-18 + a do consumo de IA, MIA-44 + as três da 1.117, MIA-67 + as duas da 1.118, MIA-79 + as duas dos preços da Meta, MIA-99 + as duas da MIA-103 + as duas das conversões do site, MIA-169)", () => {
    for (const n of NOMES) expect(FERRAMENTA_POR_NOME.has(n), n).toBe(true);
    expect(FERRAMENTAS).toHaveLength(130);
  });

  it("ver é leitura; configurar é montagem; desfazer põe a IA de volta no ar", () => {
    expect(FERRAMENTA_POR_NOME.get("plataforma_ver_travas_de_robo")!.operacao).toBeNull();
    expect(FERRAMENTA_POR_NOME.get("plataforma_configurar_trava_de_robo")!.operacao).toBe("implantar_configuracao");
    expect(FERRAMENTA_POR_NOME.get("plataforma_desfazer_trava_de_robo")!.operacao).toBe("colocar_no_ar");
    // O raio de quem marca a caixinha fala da trava.
    expect(operacaoPorChave("implantar_configuracao")!.raio).toMatch(/trava de robô/);
    expect(operacaoPorChave("colocar_no_ar")!.raio).toMatch(/trava de robô/);
  });
});

describe("plataforma_configurar_trava_de_robo", () => {
  it("sem nenhum campo, recusa e diz o que informar", async () => {
    await expect(chamar("plataforma_configurar_trava_de_robo", banco(), { organization_id: ORG })).rejects.toThrow(/ao menos um campo/);
  });

  it("limite fora da faixa é recusado antes de gravar", async () => {
    const b = banco();
    await expect(chamar("plataforma_configurar_trava_de_robo", b, { organization_id: ORG, teto_respostas: 1 })).rejects.toThrow(/teto_respostas/);
    expect(b.escritas).toEqual([]);
  });

  it("grava só o que veio, audita o antes e o depois, e a segunda chamada igual responde ja_estava", async () => {
    const b = banco();
    const r = await chamar("plataforma_configurar_trava_de_robo", b, { organization_id: ORG, ligada: false, teto_respostas: 40 });
    expect(r.ja_estava).toBe(false);
    expect(r.configuracao).toEqual({ ...CONFIG_PADRAO_DA_TRAVA, ligada: false, teto_respostas: 40 });
    expect(b.db.mia_trava_de_robo_config).toHaveLength(1);
    expect(b.db.mia_trava_de_robo_config![0]).toMatchObject({ organization_id: ORG, ligada: false, teto_respostas: 40, janela_minutos: 15, updated_by_user_id: AUTOR });
    expect(h.auditados.map((a) => a.action)).toEqual(["ai.trava_de_robo_configurada"]);

    const de_novo = await chamar("plataforma_configurar_trava_de_robo", b, { organization_id: ORG, ligada: false });
    expect(de_novo.ja_estava).toBe(true);
    expect(h.auditados).toHaveLength(1);
  });

  it("os quatro campos do ritmo de máquina (MIA-210): grava, responde ja_estava na segunda e não mexe no resto", async () => {
    const b = banco();
    const pedido = { ritmo_ligado: false, ritmo_giros: 8, ritmo_latencia_maxima_segundos: 120, ritmo_variacao_segundos: 5 };
    const r = await chamar("plataforma_configurar_trava_de_robo", b, { organization_id: ORG, ...pedido });
    expect(r.ja_estava).toBe(false);
    expect(r.configuracao).toEqual({ ...CONFIG_PADRAO_DA_TRAVA, ...pedido });
    expect(r.antes).toEqual(CONFIG_PADRAO_DA_TRAVA);
    expect(b.db.mia_trava_de_robo_config![0]).toMatchObject({ organization_id: ORG, ligada: true, teto_respostas: 30, ...pedido });

    const de_novo = await chamar("plataforma_configurar_trava_de_robo", b, { organization_id: ORG, ritmo_ligado: false, ritmo_giros: 8 });
    expect(de_novo.ja_estava).toBe(true);
    expect(h.auditados.map((a) => a.action)).toEqual(["ai.trava_de_robo_configurada"]);

    // Só a chave do ritmo muda: é uma escrita nova, e o resto fica.
    const religa = await chamar("plataforma_configurar_trava_de_robo", b, { organization_id: ORG, ritmo_ligado: true });
    expect(religa.ja_estava).toBe(false);
    expect(religa.configuracao).toMatchObject({ ritmo_ligado: true, ritmo_giros: 8, ritmo_variacao_segundos: 5 });
  });

  it.each([
    ["ritmo_giros", 3],
    ["ritmo_giros", 31],
    ["ritmo_latencia_maxima_segundos", 9],
    ["ritmo_latencia_maxima_segundos", 301],
    ["ritmo_variacao_segundos", 1],
    ["ritmo_variacao_segundos", 61],
  ])("o ritmo fora da faixa é recusado antes de gravar, dizendo o campo: %s = %s", async (campo, valor) => {
    const b = banco();
    await expect(chamar("plataforma_configurar_trava_de_robo", b, { organization_id: ORG, [campo]: valor })).rejects.toThrow(new RegExp(String(campo)));
    expect(b.escritas).toEqual([]);
  });

  it("a descrição ensina os campos do ritmo com a faixa, e que `ritmo_ligado` desliga só ele", () => {
    const f = FERRAMENTA_POR_NOME.get("plataforma_configurar_trava_de_robo")!;
    expect(f.description).toMatch(/ritmo_ligado: false/);
    const esquema = f.inputSchema as Record<string, { description?: string }>;
    expect(esquema.ritmo_giros!.description).toMatch(/De 4 a 30\./);
    expect(esquema.ritmo_latencia_maxima_segundos!.description).toMatch(/De 10 a 300\./);
    expect(esquema.ritmo_variacao_segundos!.description).toMatch(/De 2 a 60\./);
    expect(esquema.ritmo_ligado!.description).toMatch(/SÓ ele/);
  });

  it("empresa que não existe é recusada com o caminho para achar o id", async () => {
    await expect(
      chamar("plataforma_configurar_trava_de_robo", banco(), { organization_id: "0b0c0d0e-9999-4999-8999-000000000999", ligada: true }),
    ).rejects.toThrow(/plataforma_listar_clientes/);
  });
});

describe("plataforma_ver_travas_de_robo", () => {
  it("com o cliente: a configuração (o padrão, sem linha) e os registros, com o final do telefone e sem texto de mensagem", async () => {
    const b = banco({ mia_travas_de_robo: [registro()] });
    const r = await chamar("plataforma_ver_travas_de_robo", b, { organization_id: ORG, periodo_dias: 7 });
    expect(r.configuracao).toEqual(CONFIG_PADRAO_DA_TRAVA);
    expect(r.configuracao_gravada).toBe(false);
    expect(r.total).toBe(1);
    const [linha] = r.registros as Array<Record<string, unknown>>;
    expect(linha).toMatchObject({
      id: REGISTRO,
      empresa: "Clínica Exemplo",
      motivo: "robo",
      conversation_id: CONV,
      link_da_conversa: `/app/inbox?id=${CONV}`,
      telefone_final: "0000",
      respostas_da_ia: 3,
      negocios_afetados: [LEAD],
    });
    expect(JSON.stringify(r)).not.toContain("5511900000000");
  });

  it("o registro do ritmo de máquina aparece como teto, com o sinal 'ritmo' e sem texto", async () => {
    const ritmo = registro({
      motivo: "teto",
      sinais: [
        { mensagem_id: "0b0c0d0e-7777-4777-8777-000000000011", sinais: ["ritmo"] },
        { mensagem_id: "0b0c0d0e-7777-4777-8777-000000000012", sinais: ["ritmo"] },
      ],
      mensagens_de_robo: 6,
      respostas_da_ia: 6,
      negocios_afetados: [],
      conversa_encerrada: false,
      etiqueta_aplicada: false,
      followups_cancelados: 0,
    });
    const r = await chamar("plataforma_ver_travas_de_robo", banco({ mia_travas_de_robo: [ritmo] }), { organization_id: ORG, motivo: "teto" });
    const [linha] = r.registros as Array<Record<string, unknown>>;
    expect(linha).toMatchObject({ motivo: "teto", mensagens_de_robo: 6, respostas_da_ia: 6, negocios_afetados: [] });
    expect((linha!.sinais as Array<{ sinais: string[] }>).every((s) => s.sinais.includes("ritmo"))).toBe(true);
    expect(FERRAMENTA_POR_NOME.get("plataforma_ver_travas_de_robo")!.description).toMatch(/sinal `ritmo`/);
  });

  it("sem o cliente, lista os registros de todos; o filtro de motivo e o período valem", async () => {
    const velho = registro({ id: "0b0c0d0e-4444-4444-8444-000000000002", created_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString() });
    const teto = registro({ id: "0b0c0d0e-4444-4444-8444-000000000003", organization_id: OUTRA_ORG, motivo: "teto", contact_id: null, negocios_afetados: [] });
    const b = banco({ mia_travas_de_robo: [registro(), velho, teto] });
    const todos = await chamar("plataforma_ver_travas_de_robo", b, {});
    expect(todos.total).toBe(2);
    expect(todos).not.toHaveProperty("configuracao");
    const soTeto = await chamar("plataforma_ver_travas_de_robo", b, { motivo: "teto" });
    expect((soTeto.registros as Array<Record<string, unknown>>).map((x) => x.empresa)).toEqual(["Loja Exemplo"]);
  });
});

describe("plataforma_desfazer_trava_de_robo", () => {
  it("sem trava de pé na conversa, recusa e aponta onde ver", async () => {
    await expect(chamar("plataforma_desfazer_trava_de_robo", banco(), { organization_id: ORG, conversation_id: CONV })).rejects.toThrow(
      /plataforma_ver_travas_de_robo/,
    );
  });

  it("devolve a IA ao contato e tira a etiqueta, SEM reabrir o negócio nem a conversa", async () => {
    const b = banco({ mia_travas_de_robo: [registro()] });
    const r = await chamar("plataforma_desfazer_trava_de_robo", b, { organization_id: ORG, conversation_id: CONV });
    expect(r).toMatchObject({
      registro_id: REGISTRO,
      ia_retomada: true,
      etiqueta_tirada: true,
      negocios_continuam_perdidos: [LEAD],
      conversa_continua_encerrada: true,
    });
    expect(b.db.contacts![0]).toMatchObject({ force_human: false, tags: ["prospeccao"] });
    expect(b.db.crm_leads![0]).toMatchObject({ status: "lost", stage_id: "perdido" });
    expect(b.db.conversations![0]!.status).toBe("closed");
    expect(b.db.mia_travas_de_robo![0]!.desfeita_em).toBeTruthy();
    expect(b.db.mia_travas_de_robo![0]!.desfeita_por_user_id).toBe(AUTOR);
    expect(h.auditados.map((a) => a.action)).toContain("ai.trava_de_robo_desfeita");
    // Desfeita, não há mais o que desfazer.
    await expect(chamar("plataforma_desfazer_trava_de_robo", b, { organization_id: ORG, conversation_id: CONV })).rejects.toThrow(/não tem trava/);
  });

  it("contato marcado como sempre atendimento humano: recusa e não mexe em nada", async () => {
    const b = banco({ mia_travas_de_robo: [registro()] });
    b.db.contacts![0]!.ai_opt_out = true;
    await expect(chamar("plataforma_desfazer_trava_de_robo", b, { organization_id: ORG, conversation_id: CONV })).rejects.toThrow(
      /sempre atendimento humano/,
    );
    expect(b.db.contacts![0]).toMatchObject({ force_human: true, tags: ["prospeccao", "robô"] });
    expect(b.db.mia_travas_de_robo![0]!.desfeita_em).toBeNull();
  });

  it("a trava de OUTRA empresa não é alcançada", async () => {
    const b = banco({ mia_travas_de_robo: [registro()] });
    await expect(chamar("plataforma_desfazer_trava_de_robo", b, { organization_id: OUTRA_ORG, conversation_id: CONV })).rejects.toThrow(/não tem trava/);
    expect(b.db.contacts![0]!.force_human).toBe(true);
  });
});
