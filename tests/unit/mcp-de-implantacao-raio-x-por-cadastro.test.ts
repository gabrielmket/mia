/**
 * FORK MIA (.106) · O RAIO-X GRÁTIS POR CADASTRO NO MCP DE PLATAFORMA.
 *
 *  - `plataforma_ver_raio_x` mostra a ORIGEM, a CONTA de quem se cadastrou (o
 *    e-mail e o WhatsApp da pessoa MASCARADOS) e os PEDIDOS de nova análise;
 *  - a sexta ferramenta do raio-X, `plataforma_precos_do_raio_x` (operação
 *    `gerir_raio_x`), vê e define o preço da nova análise, e audita;
 *  - a lista tem 112.
 *
 * Banco em memória, dado fictício.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.INTERNAL_SECRET = "segredo-do-teste-do-raio-x";
  return { auditados: [] as Array<{ action: string; metadata?: Record<string, unknown> }> };
});
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (e: { action: string; metadata?: Record<string, unknown> }) => {
    h.auditados.push(e);
  }),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));

const { FERRAMENTA_POR_NOME, FERRAMENTAS } = await import("@/lib/mcp-plataforma/ferramentas");
const { bancoEmMemoria } = await import("@/tests/helpers/banco-em-memoria");

const T0 = "2026-11-06T15:00:00.000Z";
const RX = "e9152e90-2222-4000-8000-0000000106d1";
const CONTA = "e9152e90-5555-4000-8000-0000000106d1";

function raioX(): Record<string, unknown> {
  return {
    id: RX,
    fonte: "conexao",
    empresa: "Garagem Modelo Veículos",
    segmento: "revenda_de_veiculos",
    whatsapp: "5531900001101",
    responsavel_nome: "Ricardo Exemplo",
    responsavel_contato: "ricardo@garagemmodelo.com.br",
    quem_atende: "humano",
    periodo_dias: 30,
    tipo: "unico",
    abre: "08:00:00",
    fecha: "18:00:00",
    sabado_ate: "13:00:00",
    organization_id: null,
    teto_centavos: 1000,
    situacao: "pronto",
    conexao_versao: 1,
    conexao_expira_em: T0,
    sessao: null,
    conectado_em: T0,
    numero_conectado: "5531900001101",
    ciclo: 1,
    periodo_inicio: T0,
    periodo_fim: T0,
    competencia: null,
    leitura: {},
    leitura_concluida_em: T0,
    analise: {},
    trava_ate: null,
    ultimo_relatorio_em: T0,
    desconectar_em: null,
    desconectado_em: T0,
    apagar_conversas_em: null,
    conversas_apagadas_em: null,
    encerrado_em: null,
    criado_por: null,
    criado_via: "cadastro",
    created_at: T0,
    updated_at: T0,
    origem: "cadastro",
    gratis: true,
    conta_id: CONTA,
    sem_historico_em: null,
    entregue_em: T0,
  };
}

function banco() {
  return bancoEmMemoria({
    mia_raio_x: [raioX()],
    mia_raio_x_contas: [{ id: CONTA, email: "ricardo@garagemmodelo.com.br", nome: "Ricardo Exemplo", telefone: "5531900002202", crm_lead_id: null, crm_enviado_em: null, crm_erro: "sem_fonte", asaas_cliente_id: null, ultimo_acesso_em: null, created_at: T0 }],
    mia_raio_x_pedidos: [{ id: "e9152e90-6666-4000-8000-0000000106d1", conta_id: CONTA, anterior_id: RX, raio_x_id: null, whatsapp: "5531900001101", tipo: "mensal", valor_centavos: null, situacao: "interesse", asaas_cobranca_id: null, asaas_assinatura_id: null, link_pagamento: null, erro: null, pago_em: null, cancelado_em: null, created_at: T0 }],
  });
}

const ctx = (b: ReturnType<typeof banco>) => ({ admin: b.cliente as never, autorUserId: "e9152e90-1111-4000-8000-00000000000a", tokenId: "t", requestId: "r", escopos: [] });

beforeEach(() => {
  h.auditados = [];
});

describe("o raio-X por cadastro no MCP", () => {
  it("a lista tem 112, e a sexta do raio-X é a dos preços, com gerir_raio_x", () => {
    expect(FERRAMENTAS).toHaveLength(112);
    expect(FERRAMENTA_POR_NOME.get("plataforma_precos_do_raio_x")!.operacao).toBe("gerir_raio_x");
    expect(FERRAMENTA_POR_NOME.get("plataforma_precos_do_raio_x")!.description).toMatch(/INTERESSE/);
    expect(FERRAMENTA_POR_NOME.get("plataforma_ver_raio_x")!.description).toMatch(/ORIGEM/);
  });

  it("⭐ ver, com o id: a origem, a conta MASCARADA e os pedidos", async () => {
    const b = banco();
    const r = (await FERRAMENTA_POR_NOME.get("plataforma_ver_raio_x")!.handler(ctx(b), { raio_x_id: RX })) as Record<string, unknown>;
    expect(r.origem).toBe("cadastro_gratis");
    expect(r.conta).toMatchObject({ nome: "Ricardo Exemplo", lead_no_crm_da_time: { erro: "sem_fonte" } });
    const conta = r.conta as { email: string; whatsapp: string };
    expect(conta.email).not.toBe("ricardo@garagemmodelo.com.br");
    expect(conta.whatsapp).not.toContain("90000-2202");
    expect(conta.whatsapp).toContain("2202");
    expect(r.pedidos).toEqual([expect.objectContaining({ tipo: "mensal", situacao: "interesse", reais: null })]);
    expect(r.relatorio_entregue_em).toBe(T0);
  });

  it("ver, a lista: a origem, a conta mascarada e os preços (vazios)", async () => {
    const r = (await FERRAMENTA_POR_NOME.get("plataforma_ver_raio_x")!.handler(ctx(banco()), {})) as { raio_x: Array<Record<string, unknown>>; precos_da_nova_analise: unknown[] };
    expect(r.precos_da_nova_analise).toEqual([]);
    expect(r.raio_x[0]).toMatchObject({ origem: "cadastro_gratis", conta: { nome: "Ricardo Exemplo" } });
    expect(JSON.stringify(r.raio_x)).not.toContain("ricardo@garagemmodelo.com.br");
  });

  it("⭐ os preços: sem tipo só mostra; com tipo define (e audita); null tira", async () => {
    const b = banco();
    const precos = FERRAMENTA_POR_NOME.get("plataforma_precos_do_raio_x")!;
    expect(await precos.handler(ctx(b), {})).toEqual({
      precos: [
        { tipo: "avulsa", reais: null, valor_centavos: null, vendendo: false },
        { tipo: "mensal", reais: null, valor_centavos: null, vendendo: false },
      ],
    });
    const definido = (await precos.handler(ctx(b), { tipo: "avulsa", valor_centavos: 7900 })) as { precos: Array<Record<string, unknown>> };
    expect(definido.precos[0]).toMatchObject({ tipo: "avulsa", valor_centavos: 7900, vendendo: true });
    expect(b.db.mia_raio_x_precos).toEqual([expect.objectContaining({ tipo: "avulsa", valor_centavos: 7900, ativo: true })]);
    expect(h.auditados.map((a) => a.action)).toEqual(["raio_x.precos_alterados"]);
    await precos.handler(ctx(b), { tipo: "avulsa", valor_centavos: null });
    expect(b.db.mia_raio_x_precos).toEqual([]);
    await expect(precos.handler(ctx(b), { tipo: "mensal" })).rejects.toThrow(/valor_centavos/);
  });
});
