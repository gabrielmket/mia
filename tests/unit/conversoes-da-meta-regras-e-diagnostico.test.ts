/**
 * FORK MIA — o que a TELA e o MCP gravam e leem das conversões da Meta: a
 * gravação das regras por etapa (o miolo da ação do upstream, 0524, que o MCP
 * também chama), a chave dos leads de formulário e o diagnóstico. O histórico
 * de envios é o do upstream desde a .72.
 *
 * Tabelas de verdade em memória: o teste mede a linha gravada, e não a resposta.
 * A ida à Meta do diagnóstico é um dublê passado por parâmetro: nada sai.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({ credencial: null as unknown }));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/plataformas-de-anuncio/credenciais", () => ({ lerCredencial: async () => estado.credencial }));

const { audit } = await import("@/lib/audit");
const { definirChaveDeFormulario, lerChaveDeFormulario } = await import("@/lib/conversoes-meta/config");
const { diagnosticarConexaoDaMeta, diagnosticoEmFrases } = await import("@/lib/conversoes-meta/diagnostico");
const { gravarRegrasDeConversaoMeta } = await import("@/lib/conversoes/gravar-regras-meta");
const { rotuloDoEnvioDaMeta } = await import("@/lib/conversoes-meta/rotulo");

const ORG = "0a000000-0000-4000-8000-000000000001";
const OUTRA_ORG = "0a000000-0000-4000-8000-000000000002";
const AUTOR = "0b000000-0000-4000-8000-000000000001";
const FUNIL = "0c000000-0000-4000-8000-000000000001";
const NOVO = "0d000000-0000-4000-8000-000000000001";
const QUALIFICACAO = "0d000000-0000-4000-8000-000000000002";
const GANHO = "0d000000-0000-4000-8000-000000000009";
const PERDIDO = "0d000000-0000-4000-8000-00000000000a";
const DE_FORA = "0d000000-0000-4000-8000-0000000000ff";

const QUEM = { organizationId: ORG, autorUserId: AUTOR, via: "tela" as const };

const etapa = (id: string, name: string, position: number, over: Linha = {}): Linha => ({
  id,
  organization_id: ORG,
  pipeline_id: FUNIL,
  name,
  position,
  is_won: false,
  is_lost: false,
  is_archived: false,
  ...over,
});

function banco(extras: Record<string, Linha[]> = {}) {
  return bancoEmMemoria({
    crm_pipelines: [
      { id: FUNIL, organization_id: ORG, name: "Agendamentos", position: 1, is_archived: false },
      { id: "arquivado", organization_id: ORG, name: "Antigo", position: 2, is_archived: true },
    ],
    crm_stages: [
      etapa(NOVO, "Novo contato", 1),
      etapa(QUALIFICACAO, "Qualificação", 2),
      etapa("arquivada", "Etapa antiga", 3, { is_archived: true }),
      etapa(GANHO, "Fechou tratamento", 8, { is_won: true }),
      etapa(PERDIDO, "Perdido", 9, { is_lost: true }),
      etapa(DE_FORA, "De outra empresa", 1, { organization_id: OUTRA_ORG }),
    ],
    meta_ads_conversion_rules: [],
    mia_conversoes_meta_config: [],
    ad_conversion_dispatches: [],
    ad_platform_connections: [],
    ...extras,
  });
}

beforeEach(() => {
  vi.mocked(audit).mockClear();
  estado.credencial = { ok: false, motivo: "sem_conexao" };
});

describe("a gravação das regras da Meta (o miolo da ação do upstream, compartilhado com o MCP)", () => {
  const QUEM_GRAVA = { organizationId: ORG, autorUserId: AUTOR };

  it("regra LIGADA nasce na tabela do upstream, com a chave `MetaEtapa:<etapa>`", async () => {
    const b = banco();
    const r = await gravarRegrasDeConversaoMeta(b.cliente as never, QUEM_GRAVA, [
      { stage_id: QUALIFICACAO, enabled: true, meta_event: "QualifiedLead" },
    ]);
    expect(r).toEqual({ ok: true, ligadas: 1, desligadas: 0 });
    expect(b.tabela("meta_ads_conversion_rules")).toMatchObject([
      {
        organization_id: ORG,
        stage_id: QUALIFICACAO,
        event_name: `MetaEtapa:${QUALIFICACAO}`,
        meta_event: "QualifiedLead",
        enabled: true,
        updated_by: AUTOR,
      },
    ]);
  });

  it("regra desligada que nunca existiu não vira linha; a que some da lista é DESLIGADA, nunca apagada", async () => {
    const b = banco({
      meta_ads_conversion_rules: [
        { organization_id: ORG, stage_id: NOVO, event_name: `MetaEtapa:${NOVO}`, meta_event: "LeadSubmitted", enabled: true },
      ],
    });
    await gravarRegrasDeConversaoMeta(b.cliente as never, QUEM_GRAVA, [
      { stage_id: QUALIFICACAO, enabled: false, meta_event: "QualifiedLead" },
    ]);
    expect(b.tabela("meta_ads_conversion_rules")).toMatchObject([
      { stage_id: NOVO, event_name: `MetaEtapa:${NOVO}`, enabled: false },
    ]);
  });

  it("⭐ etapa de ganho, de perda ou de OUTRA organização é recusada, e nada é gravado", async () => {
    for (const fechada of [GANHO, PERDIDO, DE_FORA]) {
      const b = banco();
      expect(
        await gravarRegrasDeConversaoMeta(b.cliente as never, QUEM_GRAVA, [
          { stage_id: fechada, enabled: true, meta_event: "QualifiedLead" },
        ]),
      ).toEqual({ ok: false, error: "etapa_invalida" });
      expect(b.tabela("meta_ads_conversion_rules")).toEqual([]);
    }
  });
});

describe("o nome do envio da Meta no livro-razão", () => {
  it("compra, evento de etapa pelo retrato, e o que não é da Meta fica com quem chama", () => {
    expect(rotuloDoEnvioDaMeta("Purchase")).toBe("Compra");
    expect(rotuloDoEnvioDaMeta(`MetaEtapa:${NOVO}`, "LeadSubmitted")).toBe("Lead enviado");
    expect(rotuloDoEnvioDaMeta(`MetaEtapa:${NOVO}`, null)).toBe("Etapa do funil");
    expect(rotuloDoEnvioDaMeta(`Etapa:${NOVO}`)).toBeNull();
    expect(rotuloDoEnvioDaMeta("QualifiedLead")).toBeNull();
  });
});

describe("a chave dos leads de formulário", () => {
  it("ausente é desligada; ligar grava e audita; o mesmo pedido de novo não regrava", async () => {
    const b = banco();
    expect(await lerChaveDeFormulario(b.cliente as never, ORG)).toEqual({ ligada: false, desde: null });

    expect(await definirChaveDeFormulario(b.cliente as never, QUEM, true)).toEqual({ ok: true, desfecho: "atualizou", ligada: true });
    expect(b.tabela("mia_conversoes_meta_config")).toMatchObject([
      { organization_id: ORG, leads_de_formulario: true, atualizada_por: AUTOR },
    ]);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({
      action: "conversoes_meta.leads_de_formulario",
      metadata: { ligada: true },
    });

    const escritas = b.escritas.length;
    expect(await definirChaveDeFormulario(b.cliente as never, QUEM, true)).toEqual({ ok: true, desfecho: "ja_estava", ligada: true });
    expect(b.escritas.length).toBe(escritas);
  });

  it("desligada não diz desde quando", async () => {
    const b = banco({
      mia_conversoes_meta_config: [{ organization_id: ORG, leads_de_formulario: false, leads_de_formulario_desde: "2026-09-01T00:00:00Z" }],
    });
    expect(await lerChaveDeFormulario(b.cliente as never, ORG)).toEqual({ ligada: false, desde: null });
  });
});

describe("o diagnóstico da Meta", () => {
  const AGORA = new Date("2026-10-01T10:35:00Z");
  const CONECTADA = { ok: true, credencial: { datasetId: "900000000000001", accessToken: "token-ficticio", testEventCode: null } };
  const tudoCerto = async () => ({
    token: { estado: "aceito" as const },
    destino: { estado: "encontrado" as const, nome: "Empresa Modelo · Conversões" },
    permissoes: { estado: "lidas" as const, concedidas: ["ads_management"] },
  });
  const envio = (over: Linha): Linha => ({
    organization_id: ORG,
    platform: "meta_ads",
    lead_id: "lead-1",
    event_name: `MetaEtapa:${NOVO}`,
    meta_event_name: "LeadSubmitted",
    status: "sent",
    detail: null,
    attempted_at: "2026-10-01T08:31:00Z",
    crm_leads: { title: "Negócio de teste" },
    ...over,
  });

  it("tudo certo: token, destino, permissão, último envio aceito e nenhuma recusa", async () => {
    estado.credencial = CONECTADA;
    const b = banco({ ad_conversion_dispatches: [envio({})] });
    const d = await diagnosticarConexaoDaMeta(b.cliente as never, ORG, { agora: AGORA, conferir: tudoCerto });
    expect(d.veredito).toBe("em_ordem");
    expect(d.itens.map((i) => [i.chave, i.caso, i.saude])).toEqual([
      ["token", "token_aceito", "ok"],
      ["destino", "destino_encontrado", "ok"],
      ["permissao", "permissao_de_envio", "ok"],
      ["ultimo_envio", "ultimo_envio_aceito", "ok"],
      ["recusados", "sem_recusados", "ok"],
    ]);
    expect(d.itens[1]!.dado).toBe('"Empresa Modelo · Conversões" · 900000000000001');
    expect(d.itens[3]!.ultimo).toEqual({ em: "2026-10-01T08:31:00Z", evento: "Lead enviado", negocio: "Negócio de teste", leadId: "lead-1" });
  });

  it("token vencido: problema, e o que depende dele não é dado como certo", async () => {
    estado.credencial = CONECTADA;
    const d = await diagnosticarConexaoDaMeta(banco().cliente as never, ORG, {
      agora: AGORA,
      conferir: async () => ({
        token: { estado: "recusado", detalhe: "Session has expired" },
        destino: { estado: "nao_conferido", detalhe: "Depende de um token aceito." },
        permissoes: { estado: "nao_conferido", detalhe: "Depende de um token aceito." },
      }),
    });
    expect(d.veredito).toBe("com_problema");
    expect(d.itens.slice(0, 3).map((i) => i.caso)).toEqual(["token_recusado", "destino_nao_conferido", "permissao_nao_conferida"]);
    expect(d.itens[0]!.dado).toBe("Session has expired");
    expect(d.itens.find((i) => i.chave === "ultimo_envio")!.caso).toBe("nenhum_envio_aceito");
  });

  it("sem acesso ao destino é problema; permissão que a Meta não lista é atenção, não vermelho", async () => {
    estado.credencial = CONECTADA;
    const semAcesso = await diagnosticarConexaoDaMeta(banco().cliente as never, ORG, {
      agora: AGORA,
      conferir: async () => ({
        token: { estado: "aceito" },
        destino: { estado: "sem_acesso", detalhe: "Requires permission" },
        permissoes: { estado: "lidas", concedidas: [] },
      }),
    });
    expect(semAcesso.veredito).toBe("com_problema");
    expect(semAcesso.itens[1]!.caso).toBe("destino_sem_acesso");

    const naoListada = await diagnosticarConexaoDaMeta(banco().cliente as never, ORG, {
      agora: AGORA,
      conferir: async () => ({
        token: { estado: "aceito" },
        destino: { estado: "encontrado", nome: null },
        permissoes: { estado: "lidas", concedidas: ["ads_read"] },
      }),
    });
    expect(naoListada.itens[2]).toMatchObject({ caso: "permissao_nao_listada", saude: "atencao", dado: "ads_read" });
    expect(naoListada.veredito).toBe("com_atencao");
  });

  it("⭐ evidência vence inferência: a Meta aceitou um envio nos últimos 7 dias, então o token pode enviar", async () => {
    estado.credencial = CONECTADA;
    const b = banco({ ad_conversion_dispatches: [envio({ attempted_at: "2026-09-28T10:00:00Z" })] });
    const d = await diagnosticarConexaoDaMeta(b.cliente as never, ORG, {
      agora: AGORA,
      conferir: async () => ({
        token: { estado: "aceito" },
        destino: { estado: "encontrado", nome: null },
        permissoes: { estado: "nao_conferido", detalhe: "não suportado" },
      }),
    });
    expect(d.itens[2]!.caso).toBe("permissao_de_envio");
    expect(d.veredito).toBe("em_ordem");
  });

  it("recusas dos últimos 7 dias, agrupadas pelo motivo que a Meta deu; as mais antigas não contam", async () => {
    estado.credencial = CONECTADA;
    const b = banco({
      ad_conversion_dispatches: [
        envio({ status: "error", detail: "token de acesso vencido", attempted_at: "2026-09-30T15:48:00Z" }),
        envio({ status: "error", detail: "token de acesso vencido", attempted_at: "2026-09-29T15:48:00Z", lead_id: "lead-2" }),
        envio({ status: "error", detail: "evento com 12 dias", attempted_at: "2026-09-29T09:05:00Z", lead_id: "lead-3" }),
        envio({ status: "error", detail: "antigo", attempted_at: "2026-09-10T00:00:00Z", lead_id: "lead-4" }),
        envio({ status: "error", detail: "do Google", platform: "google_ads", attempted_at: "2026-09-30T00:00:00Z", lead_id: "lead-5" }),
        envio({ status: "error", detail: "de outra empresa", organization_id: OUTRA_ORG, attempted_at: "2026-09-30T00:00:00Z" }),
      ],
    });
    const d = await diagnosticarConexaoDaMeta(b.cliente as never, ORG, { agora: AGORA, conferir: tudoCerto });
    const recusados = d.itens.find((i) => i.chave === "recusados")!;
    expect(recusados.caso).toBe("com_recusados");
    expect(recusados.recusados).toEqual({
      total: 3,
      motivos: [
        { motivo: "token de acesso vencido", quantos: 2 },
        { motivo: "evento com 12 dias", quantos: 1 },
      ],
    });
  });

  it("sem conexão, ou com o envio pausado: diz isso e NÃO consulta a Meta", async () => {
    const conferir = vi.fn(tudoCerto);
    for (const [motivo, caso] of [
      ["sem_conexao", "sem_conexao"],
      ["conexao_desabilitada", "conexao_pausada"],
      ["credencial_incompleta", "credencial_incompleta"],
      ["cifra_indisponivel", "cifra_indisponivel"],
    ] as const) {
      estado.credencial = { ok: false, motivo };
      const d = await diagnosticarConexaoDaMeta(banco().cliente as never, ORG, { agora: AGORA, conferir });
      expect(d.itens[0]).toMatchObject({ chave: "conexao", caso });
      expect(d.veredito).not.toBe("em_ordem");
    }
    expect(conferir).not.toHaveBeenCalled();
  });

  it("modo de teste ligado aparece como aviso, mesmo com a conexão pausada", async () => {
    estado.credencial = { ok: false, motivo: "conexao_desabilitada" };
    const b = banco({
      ad_platform_connections: [{ organization_id: ORG, platform: "meta_ads", test_event_code: "TESTE12345" }],
    });
    const d = await diagnosticarConexaoDaMeta(b.cliente as never, ORG, { agora: AGORA, conferir: tudoCerto });
    expect(d.itens.at(-1)).toMatchObject({ chave: "modo_de_teste", saude: "atencao" });
  });

  it("⭐ nem o token nem o identificador da conta aparecem nas frases da ferramenta", async () => {
    estado.credencial = CONECTADA;
    const d = await diagnosticarConexaoDaMeta(banco().cliente as never, ORG, { agora: AGORA, conferir: tudoCerto });
    const frases = diagnosticoEmFrases(d);
    expect(JSON.stringify([d, frases])).not.toContain("token-ficticio");
    expect(frases.map((f) => f.titulo)).toEqual([
      "Token válido",
      "Destino de conversões encontrado",
      "Permissão de envio",
      "Nenhum envio aceito até aqui",
      "Eventos recusados nos últimos 7 dias: 0",
    ]);
  });
});
