/**
 * FORK MIA (9017) — o que a TELA e o MCP gravam e leem das conversões da Meta:
 * as regras por etapa, a chave dos leads de formulário, o diagnóstico e o
 * histórico de envios.
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
const { lerFiltrosDoHistoricoDeEnvios, lerHistoricoDeEnvios, lerPendenciasDeEnvio } = await import(
  "@/lib/conversoes-meta/historico"
);
const { lerFunisDaRegua, listarRegrasDaMeta, salvarRegrasDaMeta } = await import("@/lib/conversoes-meta/regras");

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
    mia_conversoes_meta_regras: [],
    mia_conversoes_meta_config: [],
    ad_conversion_dispatches: [],
    ad_platform_connections: [],
    ...extras,
  });
}

const regra = (stageId: string, over: Record<string, unknown> = {}) => ({
  stageId,
  ligada: false,
  evento: "lead_qualificado" as const,
  canal: "todos" as const,
  modoDoValor: "sem_valor" as const,
  valorFixoCentavos: null as number | null,
  ...over,
});

beforeEach(() => {
  vi.mocked(audit).mockClear();
  estado.credencial = { ok: false, motivo: "sem_conexao" };
});

describe("os funis da régua", () => {
  it("só funil e etapa vivos; ganho e perda ficam de fora, com o nome guardado para a tela dizer por quê", async () => {
    const funis = await lerFunisDaRegua(banco().cliente as never, ORG);
    expect(funis).toEqual([
      {
        id: FUNIL,
        nome: "Agendamentos",
        etapas: [
          { id: NOVO, nome: "Novo contato" },
          { id: QUALIFICACAO, nome: "Qualificação" },
        ],
        ganho: ["Fechou tratamento"],
        perda: ["Perdido"],
      },
    ]);
  });
});

describe("salvar as regras da Meta", () => {
  it("regra nova nasce como veio, na organização de quem pediu, com autoria e auditoria", async () => {
    const b = banco();
    const r = await salvarRegrasDaMeta(b.cliente as never, QUEM, [
      regra(NOVO, { evento: "novo_lead" }),
      regra(QUALIFICACAO, { ligada: true, modoDoValor: "valor_fixo", valorFixoCentavos: 15000 }),
    ]);
    expect(r).toEqual({
      ok: true,
      regras: [
        { stageId: NOVO, desfecho: "criou", ligada: false },
        { stageId: QUALIFICACAO, desfecho: "criou", ligada: true },
      ],
    });
    expect(b.tabela("mia_conversoes_meta_regras").map((l) => [l.organization_id, l.stage_id, l.evento, l.ligada, l.valor_fixo_centavos, l.atualizada_por])).toEqual([
      [ORG, NOVO, "novo_lead", false, null, AUTOR],
      [ORG, QUALIFICACAO, "lead_qualificado", true, 15000, AUTOR],
    ]);
    expect(vi.mocked(audit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({
      action: "conversoes_meta.regras_salvas",
      actorUserId: AUTOR,
      organizationId: ORG,
      metadata: { via: "tela", etapas: 2, ligadas: 1, desligadas: 1 },
    });
  });

  it("⭐ rodar de novo com o mesmo pedido não grava nada e não audita", async () => {
    const b = banco();
    const pedido = [regra(NOVO, { evento: "novo_lead" })];
    await salvarRegrasDaMeta(b.cliente as never, QUEM, pedido);
    const escritas = b.escritas.length;
    vi.mocked(audit).mockClear();

    const deNovo = await salvarRegrasDaMeta(b.cliente as never, QUEM, pedido);
    expect(deNovo).toEqual({ ok: true, regras: [{ stageId: NOVO, desfecho: "ja_estava", ligada: false }] });
    expect(b.escritas.length).toBe(escritas);
    expect(vi.mocked(audit)).not.toHaveBeenCalled();
  });

  it("só a etapa que mudou é regravada, e a que não veio fica como está", async () => {
    const b = banco();
    await salvarRegrasDaMeta(b.cliente as never, QUEM, [regra(NOVO, { evento: "novo_lead" }), regra(QUALIFICACAO)]);
    const r = await salvarRegrasDaMeta(b.cliente as never, QUEM, [regra(QUALIFICACAO, { ligada: true, canal: "whatsapp" })]);
    expect(r).toEqual({ ok: true, regras: [{ stageId: QUALIFICACAO, desfecho: "atualizou", ligada: true }] });
    const regras = await listarRegrasDaMeta(b.cliente as never, ORG);
    expect(regras.map((x) => [x.stageId, x.ligada, x.canal])).toEqual([
      [NOVO, false, "todos"],
      [QUALIFICACAO, true, "whatsapp"],
    ]);
  });

  it("valor fixo só fica gravado no modo de valor fixo", async () => {
    const b = banco();
    await salvarRegrasDaMeta(b.cliente as never, QUEM, [
      regra(NOVO, { modoDoValor: "valor_do_negocio", valorFixoCentavos: 999 }),
    ]);
    expect(b.tabela("mia_conversoes_meta_regras")[0]).toMatchObject({ modo_do_valor: "valor_do_negocio", valor_fixo_centavos: null });
  });

  it("⭐ etapa de ganho, de perda ou de OUTRA organização é recusada, e nada é gravado", async () => {
    for (const ruim of [GANHO, PERDIDO, DE_FORA]) {
      const b = banco();
      const r = await salvarRegrasDaMeta(b.cliente as never, QUEM, [regra(NOVO), regra(ruim)]);
      expect(r).toEqual({ ok: false, erro: "etapa_invalida", etapas: [ruim] });
      expect(b.tabela("mia_conversoes_meta_regras")).toHaveLength(0);
    }
  });

  it("valor fixo sem valor, com zero ou absurdo, e etapa repetida: recusa sem gravar", async () => {
    const b = banco();
    for (const valor of [null, 0, -5, 1.5, 2_000_000_000]) {
      expect(
        await salvarRegrasDaMeta(b.cliente as never, QUEM, [regra(NOVO, { modoDoValor: "valor_fixo", valorFixoCentavos: valor })]),
      ).toEqual({ ok: false, erro: "valor_fixo_invalido", etapas: [NOVO] });
    }
    expect(await salvarRegrasDaMeta(b.cliente as never, QUEM, [regra(NOVO), regra(NOVO)])).toEqual({
      ok: false,
      erro: "etapa_repetida",
    });
    expect(b.tabela("mia_conversoes_meta_regras")).toHaveLength(0);
  });

  it("evento que a lista do código não conhece mais não vira regra na leitura", async () => {
    const b = banco({
      mia_conversoes_meta_regras: [
        { id: "x", organization_id: ORG, stage_id: NOVO, evento: "evento_extinto", canal: "todos", modo_do_valor: "sem_valor", valor_fixo_centavos: null, ligada: true, configurada_em: "2026-09-25T00:00:00Z" },
      ],
    });
    expect(await listarRegrasDaMeta(b.cliente as never, ORG)).toEqual([]);
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
    event_name: "Meta:agendou",
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
    expect(d.itens[3]!.ultimo).toEqual({ em: "2026-10-01T08:31:00Z", evento: "Agendou", negocio: "Negócio de teste", leadId: "lead-1" });
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

describe("o histórico de envios", () => {
  it("os filtros da URL: evento da Meta e as sete situações entram; o resto cai no padrão", () => {
    expect(
      lerFiltrosDoHistoricoDeEnvios({ plataforma: "meta_ads", evento: "Meta:agendou", situacao: "recusado", periodo: "7d" }),
    ).toEqual({ periodo: "7d", situacao: "recusado", evento: "Meta:agendou", plataforma: "meta_ads", busca: "", pagina: 1 });
    expect(lerFiltrosDoHistoricoDeEnvios({ evento: "Etapa:11111111-1111-4111-8111-111111111111", situacao: "sem_clique" })).toMatchObject({
      evento: "Etapa:11111111-1111-4111-8111-111111111111",
      situacao: "sem_clique",
    });
    expect(
      lerFiltrosDoHistoricoDeEnvios({ plataforma: "tiktok", evento: "Meta:'; drop table", situacao: "falha", periodo: "ano", pagina: "-3", busca: "Ana%_(x)" }),
    ).toEqual({ periodo: "30d", situacao: "todas", evento: "", plataforma: "", busca: "Anax", pagina: 1 });
  });

  /** Um dublê que grava cada filtro pedido: a consulta de verdade é provada no Postgres. */
  function consultaGravada(linhas: Linha[]) {
    const chamadas: Array<[string, ...unknown[]]> = [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "gte", "ilike", "in", "or", "order", "limit"]) {
      q[m] = (...args: unknown[]) => (chamadas.push([m, ...args]), q);
    }
    q.range = async (...args: unknown[]) => (chamadas.push(["range", ...args]), { data: linhas, count: linhas.length, error: null });
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: linhas, error: null }).then(ok);
    return { cliente: { from: () => q }, chamadas };
  }

  it("sempre pela organização, e cada situação vira o filtro certo no livro-razão", async () => {
    const base = { periodo: "tudo" as const, evento: "", plataforma: "" as const, busca: "", pagina: 1 };
    const filtrosDe = async (situacao: Parameters<typeof lerHistoricoDeEnvios>[2]["situacao"]) => {
      const c = consultaGravada([]);
      await lerHistoricoDeEnvios(c.cliente as never, ORG, { ...base, situacao });
      expect(c.chamadas).toContainEqual(["eq", "organization_id", ORG]);
      expect(c.chamadas).toContainEqual(["eq", "crm_leads.organization_id", ORG]);
      return c.chamadas.filter(([m, col]) => (m === "eq" && (col === "status" || col === "reason")) || m === "in" || m === "or");
    };
    expect(await filtrosDe("enviado")).toEqual([["eq", "status", "sent"]]);
    expect(await filtrosDe("recusado")).toEqual([["eq", "status", "error"]]);
    expect(await filtrosDe("sem_valor")).toEqual([["eq", "status", "skipped"], ["eq", "reason", "sem_valor"]]);
    expect(await filtrosDe("sem_clique")).toEqual([["eq", "status", "skipped"], ["in", "reason", ["sem_atribuicao", "formulario_desligado"]]]);
    expect(await filtrosDe("anterior_a_regra")).toEqual([["eq", "status", "skipped"], ["in", "reason", ["anterior_a_regra", "anterior_a_chave"]]]);
    // A conexão é "todo o resto", inclusive a linha sem motivo.
    const conexao = await filtrosDe("conexao");
    expect(conexao[0]).toEqual(["eq", "status", "skipped"]);
    expect(String(conexao[1]![1])).toMatch(/^reason\.is\.null,reason\.not\.in\.\(.*sem_valor.*\)$/);
    expect(await filtrosDe("todas")).toEqual([]);
  });

  it("cada linha sai com a situação e com a resposta para \"dá para reenviar?\"", async () => {
    const agora = new Date("2026-10-01T12:00:00Z");
    const linha = (over: Linha): Linha => ({
      id: "1",
      lead_id: "lead-1",
      platform: "meta_ads",
      event_name: "Meta:pediu_orcamento",
      status: "error",
      reason: "recusado_pela_plataforma",
      detail: "token de acesso vencido",
      event_id: "lead-1:Meta:pediu_orcamento",
      remote_request_id: null,
      google_action_id: null,
      value_cents: 29500000,
      currency: "BRL",
      event_occurred_at: "2026-09-30T15:48:00Z",
      attempted_at: "2026-09-30T15:48:00Z",
      crm_leads: { title: "Sala comercial", closed_at: null },
      ...over,
    });
    const c = consultaGravada([
      linha({}),
      // A compra não guarda retrato: o momento dela é o fechamento do negócio.
      linha({ id: "2", event_name: "Purchase", event_occurred_at: null, detail: "evento com 12 dias", attempted_at: "2026-09-29T09:05:00Z", crm_leads: { title: "Casa", closed_at: "2026-09-18T17:30:00Z" } }),
      linha({ id: "3", status: "skipped", reason: "anterior_a_regra", detail: null }),
    ]);
    const { linhas, total } = await lerHistoricoDeEnvios(
      c.cliente as never,
      ORG,
      { periodo: "30d", situacao: "todas", evento: "", plataforma: "meta_ads", busca: "Sala", pagina: 2 },
      agora,
    );
    expect(total).toBe(3);
    expect(linhas.map((l) => [l.id, l.situacao, l.reenvio, l.ocorridoEm])).toEqual([
      ["1", "recusado", { pode: true }, "2026-09-30T15:48:00Z"],
      ["2", "recusado", { pode: false, porque: "passou_de_7_dias" }, "2026-09-18T17:30:00Z"],
      ["3", "anterior_a_regra", { pode: false, porque: "nao_resolve" }, "2026-09-30T15:48:00Z"],
    ]);
    expect(c.chamadas).toContainEqual(["eq", "platform", "meta_ads"]);
    expect(c.chamadas).toContainEqual(["ilike", "crm_leads.title", "%Sala%"]);
    // Página 2 de 50 em 50.
    expect(c.chamadas).toContainEqual(["range", 50, 99]);
  });

  it("as pendências da aba Configuração deixam de fora o que foi decisão das travas", async () => {
    const c = consultaGravada([
      { lead_id: "lead-1", event_name: "Meta:agendou", platform: "meta_ads", status: "skipped", reason: "sem_conexao", detail: null, value_cents: null, attempted_at: "2026-09-30T00:00:00Z", crm_leads: [{ title: "Negócio" }] },
    ]);
    const pendencias = await lerPendenciasDeEnvio(c.cliente as never, ORG);
    expect(pendencias).toEqual([
      { leadId: "lead-1", evento: "Meta:agendou", plataforma: "meta_ads", status: "skipped", motivo: "sem_conexao", detalhe: null, valorCentavos: null, tentadoEm: "2026-09-30T00:00:00Z", tituloDoLead: "Negócio" },
    ]);
    expect(c.chamadas).toContainEqual(["eq", "organization_id", ORG]);
    expect(c.chamadas).toContainEqual(["neq", "status", "sent"]);
    const fora = c.chamadas.find(([m]) => m === "or")!;
    for (const motivo of ["anterior_a_regra", "anterior_a_chave", "formulario_desligado", "sem_atribuicao"]) {
      expect(String(fora[1])).toContain(motivo);
    }
    expect(String(fora[1])).toContain("reason.is.null");
  });
});
