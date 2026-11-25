/**
 * FORK MIA (S3) · A COEXISTÊNCIA DO WHATSAPP NO MCP DE PLATAFORMA
 * (lib/mcp-plataforma/ferramentas/coexistencia.ts; docs/fork/coexistencia.md).
 *
 * Três ferramentas: ver a chave e os números é leitura; ligar a chave mostra o
 * botão ao cliente (não conecta nada sozinha); ver
 * a sincronização é leitura. A lista passa a 121.
 *
 * Ligar a chave exige `colocar_no_ar` (e não `implantar_configuracao`): é a régua
 * das ferramentas que "ligam" algo (`mcp-de-implantacao-ferramentas.test.ts`), e
 * com a chave a empresa conecta pela API o número do app, por onde a IA passa a
 * atender.
 *
 * Banco em memória, dado fictício: Academia Alfa, +55 31 900000002.
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

const ALFA = "0b0c0d0e-1111-4111-8111-000000009164";
const PARADA = "0b0c0d0e-1111-4111-8111-000000009165";
const DEMO = "0b0c0d0e-1111-4111-8111-000000009166";
const SESSAO = "0b0c0d0e-2222-4222-8222-000000009164";
const CICLO = "0b0c0d0e-3333-4333-8333-000000009164";
const AUTOR = "0b0c0d0e-6666-4666-8666-000000009164";

const NOMES = ["plataforma_ver_coexistencia", "plataforma_ligar_coexistencia", "plataforma_ver_sincronizacao_do_app"];

function banco(extras: Record<string, Array<Record<string, unknown>>> = {}) {
  return bancoEmMemoria({
    organizations: [
      { id: ALFA, display_name: "Academia Alfa", status: "active", settings: {}, locale: "pt-BR", demonstracao: false },
      { id: PARADA, display_name: "Academia Beta", status: "suspended", settings: {}, locale: "pt-BR", demonstracao: false },
      { id: DEMO, display_name: "Vita Odonto", status: "active", settings: {}, locale: "pt-BR", demonstracao: true },
    ],
    mia_coexistencia_da_empresa: [],
    mia_coexistencia_conexoes: [],
    mia_coexistencia_sincronizacoes: [],
    channel_sessions: [{ id: SESSAO, organization_id: ALFA, phone_number: "+5531900000002" }],
    ...extras,
  });
}

const conectado = () => ({
  mia_coexistencia_conexoes: [
    {
      id: CICLO,
      organization_id: ALFA,
      channel_session_id: SESSAO,
      waba_id: "waba-9164",
      phone_number_id: "pn-9164",
      estado: "no_ar",
      aberta_por: "conexao_pelo_app",
      conectada_em: "2026-11-17T14:32:00.000Z",
      fora_do_ar_motivo: null,
      fora_do_ar_em: null,
      voltou_em: null,
    },
  ],
  mia_coexistencia_sincronizacoes: [
    {
      id: "0b0c0d0e-4444-4444-8444-000000000001",
      organization_id: ALFA,
      conexao_id: CICLO,
      tipo: "historico",
      estado: "em_andamento",
      pedida_em: "2026-11-17T14:32:05.000Z",
      respondida_em: "2026-11-17T14:32:06.000Z",
      concluida_em: null,
      request_id: "req-historico",
      erro_codigo: null,
      erro_titulo: null,
      progresso: 62,
      fase: 1,
      contatos_recebidos: 0,
      conversas_recebidas: 58,
      mensagens_recebidas: 1906,
      mensagens_existentes: 3,
      midias_guardadas: 12,
      lotes_com_falha: 0,
    },
    {
      id: "0b0c0d0e-4444-4444-8444-000000000002",
      organization_id: ALFA,
      conexao_id: CICLO,
      tipo: "contatos",
      estado: "em_andamento",
      pedida_em: "2026-11-17T14:32:04.000Z",
      respondida_em: "2026-11-17T14:32:05.000Z",
      concluida_em: null,
      request_id: "req-contatos",
      erro_codigo: null,
      erro_titulo: null,
      progresso: null,
      fase: null,
      contatos_recebidos: 214,
      conversas_recebidas: 0,
      mensagens_recebidas: 0,
      mensagens_existentes: 0,
      midias_guardadas: 0,
      lotes_com_falha: 0,
    },
  ],
});

const ctx = (b: ReturnType<typeof banco>) => ({ admin: b.cliente as never, autorUserId: AUTOR, tokenId: "t", requestId: "r" });
const chamar = (nome: string, b: ReturnType<typeof banco>, args: Record<string, unknown>) =>
  FERRAMENTA_POR_NOME.get(nome)!.handler(ctx(b), args) as Promise<Record<string, unknown>>;

beforeEach(() => {
  h.auditados = [];
});

describe("as três da coexistência", () => {
  it("estão na lista, e a lista tem 134 (128 até as duas da MIA-103 + as duas das conversões do site, MIA-169 + as três da coexistência + o ranking do consumo de IA, MIA-136)", () => {
    for (const n of NOMES) expect(FERRAMENTA_POR_NOME.has(n), n).toBe(true);
    expect(FERRAMENTAS).toHaveLength(134);
  });

  it("ver é leitura; ligar exige colocar_no_ar, e o raio da caixinha fala da coexistência", () => {
    expect(FERRAMENTA_POR_NOME.get("plataforma_ver_coexistencia")!.operacao).toBeNull();
    expect(FERRAMENTA_POR_NOME.get("plataforma_ver_sincronizacao_do_app")!.operacao).toBeNull();
    expect(FERRAMENTA_POR_NOME.get("plataforma_ligar_coexistencia")!.operacao).toBe("colocar_no_ar");
    expect(operacaoPorChave("colocar_no_ar")!.raio).toMatch(/coexistência/);
  });
});

describe("plataforma_ligar_coexistencia", () => {
  it("liga, grava quem ligou, audita, e a segunda chamada igual responde ja_estava sem auditar de novo", async () => {
    const b = banco();
    const r = await chamar("plataforma_ligar_coexistencia", b, { organization_id: ALFA, ligada: true });
    expect(r).toMatchObject({ empresa: "Academia Alfa", ligada: true, ja_estava: false });
    expect(b.db.mia_coexistencia_da_empresa).toHaveLength(1);
    expect(b.db.mia_coexistencia_da_empresa![0]).toMatchObject({ organization_id: ALFA, ligada: true, mudada_por: AUTOR });
    expect(h.auditados.map((a) => a.action)).toEqual(["platform.coexistencia_alterada"]);

    const de_novo = await chamar("plataforma_ligar_coexistencia", b, { organization_id: ALFA, ligada: true });
    expect(de_novo.ja_estava).toBe(true);
    expect(h.auditados).toHaveLength(1);
  });

  it("desligar com número conectado: desliga e avisa que o número continua", async () => {
    const b = banco({ mia_coexistencia_da_empresa: [{ organization_id: ALFA, ligada: true, mudada_por: null, mudada_em: "2026-11-17T14:20:00.000Z" }], ...conectado() });
    const r = await chamar("plataforma_ligar_coexistencia", b, { organization_id: ALFA, ligada: false });
    expect(r).toMatchObject({ ligada: false, ja_estava: false, numeros_que_continuam: ["+5531900000002"] });
    expect(String(r.aviso)).toMatch(/continuam conectados/);
  });

  it("empresa que não opera: recusa e diz o que fazer, sem gravar", async () => {
    const b = banco();
    await expect(chamar("plataforma_ligar_coexistencia", b, { organization_id: PARADA, ligada: true })).rejects.toThrow(/reative a empresa/);
    expect(b.db.mia_coexistencia_da_empresa).toEqual([]);
  });

  it("empresa de demonstração: recusa (a 9010 não deixa nascer canal vivo nela)", async () => {
    const b = banco();
    await expect(chamar("plataforma_ligar_coexistencia", b, { organization_id: DEMO, ligada: true })).rejects.toThrow(/demonstração/);
    expect(b.db.mia_coexistencia_da_empresa).toEqual([]);
  });

  it("empresa que não existe: recusa com o caminho para achar o id", async () => {
    await expect(
      chamar("plataforma_ligar_coexistencia", banco(), { organization_id: "0b0c0d0e-9999-4999-8999-000000000999", ligada: true }),
    ).rejects.toThrow(/plataforma_listar_clientes/);
  });
});

describe("as leituras", () => {
  it("ver a coexistência: sem linha é desligada, e a falta do app da Meta é dita", async () => {
    const r = await chamar("plataforma_ver_coexistencia", banco(), { organization_id: ALFA });
    expect(r).toMatchObject({ empresa: "Academia Alfa", ligada: false, numeros_pelo_app: [] });
    expect(typeof r.janela_configurada).toBe("boolean");
  });

  it("S4: ver a coexistência mostra o número fora do ar (motivo, quem iniciou) e o de volta", async () => {
    const fora = conectado();
    Object.assign(fora.mia_coexistencia_conexoes[0]!, {
      estado: "fora_do_ar",
      fora_do_ar_motivo: "PRIMARY_INACTIVITY",
      fora_do_ar_iniciado_por: "SYSTEM",
      fora_do_ar_em: "2026-11-18T09:40:00.000Z",
      ultimo_evento_em: "2026-11-18T09:40:00.000Z",
    });
    const r = await chamar("plataforma_ver_coexistencia", banco(fora), { organization_id: ALFA });
    expect((r.numeros_pelo_app as unknown[])[0]).toMatchObject({
      numero: "+5531900000002",
      estado: "fora_do_ar",
      situacao: "fora_do_ar",
      fora_do_ar_motivo: "PRIMARY_INACTIVITY",
      fora_do_ar_iniciado_por: "SYSTEM",
      fora_do_ar_em: "2026-11-18T09:40:00.000Z",
      voltou_em: null,
    });

    const volta = conectado();
    Object.assign(volta.mia_coexistencia_conexoes[0]!, {
      estado: "no_ar",
      fora_do_ar_motivo: "PRIMARY_INACTIVITY",
      fora_do_ar_em: "2026-11-18T09:40:00.000Z",
      voltou_em: "2026-11-19T10:12:00.000Z",
      ultimo_evento_em: "2026-11-19T10:12:00.000Z",
    });
    const r2 = await chamar("plataforma_ver_coexistencia", banco(volta), { organization_id: ALFA });
    expect((r2.numeros_pelo_app as unknown[])[0]).toMatchObject({
      estado: "no_ar",
      situacao: "de_volta",
      voltou_em: "2026-11-19T10:12:00.000Z",
      ultimo_aviso_da_meta_em: "2026-11-19T10:12:00.000Z",
    });
  });

  it("ver a sincronização: os dois pedidos na ordem, só contagens", async () => {
    const r = await chamar("plataforma_ver_sincronizacao_do_app", banco(conectado()), { organization_id: ALFA });
    const [numero] = r.numeros as Array<Record<string, unknown>>;
    expect(numero).toMatchObject({ numero: "+5531900000002", estado: "no_ar", prazo_da_sincronizacao: "2026-11-18T14:32:00.000Z" });
    const pedidos = numero!.pedidos as Array<Record<string, unknown>>;
    expect(pedidos.map((p) => p.tipo)).toEqual(["contatos", "historico"]);
    expect(pedidos[1]).toMatchObject({ estado: "em_andamento", progresso: 62, fase: 1, conversas_recebidas: 58, mensagens_recebidas: 1906 });
    expect(pedidos[0]).toMatchObject({ contatos_recebidos: 214, request_id: "req-contatos" });
  });
});
