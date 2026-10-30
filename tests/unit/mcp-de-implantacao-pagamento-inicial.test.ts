/**
 * FORK MIA (.96) · o passo "Pagamento" do início no MCP de plataforma
 * (docs/fork/mcp-de-implantacao.md, "O pagamento no início (.96)"). O que se prova:
 *   - nenhuma ferramenta nova: a lista segue com 99;
 *   - `plataforma_listar_clientes` filtra quem espera o primeiro pagamento e devolve
 *     a forma, a situação, o modo e desde quando;
 *   - `plataforma_ver_cliente` mostra o passo com o documento MASCARADO e, do
 *     cartão, só o final e a bandeira; a empresa sem o passo devolve `null`.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/cobranca/configuracao", () => ({ toleranciaDias: async () => 7, provedorDaInstalacao: async () => "asaas", chaveDoProvedor: async () => null }));
vi.mock("@/lib/carteira/ler-saldo", () => ({ lerSaldoDaCarteira: async () => ({ saldo_cents: 0, truncado: false, erro: null }) }));
vi.mock("@/lib/implantacao/agente", () => ({ lerCamadaClinica: async () => null }));
vi.mock("@/lib/planos-mia/empresas-do-cadastro", () => ({ lerDetalheDaEmpresa: async () => null }));

import { FERRAMENTAS, FERRAMENTA_POR_NOME } from "@/lib/mcp-plataforma/ferramentas";
import { bancoLivre, filtroLivre, type CadeiaLivre } from "@/tests/helpers/banco-livre";

const ESPERA = "00000000-0000-4000-8000-0000000000e1";
const PAGOU = "00000000-0000-4000-8000-0000000000e2";

function responder(c: CadeiaLivre) {
  if (c.tabela === "platform_config") return { data: [{ chave: "MODULO_COBRANCA", valor: "ligado" }] };
  if (c.tabela === "modulos_instalados") return { data: [] };
  if (c.tabela === "cobranca_assinaturas") {
    if (c.passos.some((p) => p.metodo === "eq" && p.args[0] === "pagamento_inicial_pendente")) {
      return { data: [{ organization_id: ESPERA, created_at: "2026-10-28T12:00:00Z" }] };
    }
    const org = filtroLivre(c, "eq", "organization_id");
    return {
      data:
        org === ESPERA
          ? { plano_id: "p1", estado: "trial", pagamento_inicial_pendente: true, provedor: "asaas", provedor_cliente_id: "cus_1", provedor_assinatura_id: "sub_1", checkout_sessao_id: "pay_1", proximo_vencimento: null, trial_ate: "2026-10-28T12:00:00Z" }
          : null,
    };
  }
  if (c.tabela === "mia_pagamento_inicial") {
    const linha = {
      organization_id: ESPERA,
      modo: "entrada_paga",
      situacao: "recusado",
      forma: "cartao",
      pagamento_ref: "pay_1",
      assinatura_ref: "sub_1",
      plano_id: "p1",
      valor_cents: 59700,
      vence_em: "2026-10-28",
      gerada_em: "2026-10-28T12:05:00Z",
      cartao_final: "1111",
      cartao_bandeira: "VISA",
      cartao_recusas: 2,
      cartao_recusado_em: "2026-10-28T12:06:00Z",
      cartao_recorrente: null,
      cobrancas_refeitas: 0,
      pix_copia_e_cola: null,
      boleto_linha: null,
      primeira_cobranca_em: null,
      pago_em: null,
      forma_paga: null,
      lembrete_enviado_em: null,
    };
    if (c.passos.some((p) => p.metodo === "in")) return { data: [linha] };
    return { data: filtroLivre(c, "eq", "organization_id") === ESPERA ? linha : null };
  }
  if (c.tabela === "mia_dados_fiscais") {
    return {
      data:
        filtroLivre(c, "eq", "organization_id") === ESPERA
          ? { tipo: "pj", documento: "11222333000181", razao_social: "Clínica Exemplo Ltda", cidade: "Belo Horizonte", uf: "MG", asaas_sincronizado_em: "2026-10-28T12:04:00Z" }
          : null,
    };
  }
  if (c.tabela === "cobranca_planos") return { data: { id: "p1", nome: "Profissional", preco_cents: 59700, intervalo: "mes", trial_dias: 0, max_assentos: 8, max_canais: 2 } };
  if (c.tabela === "organizations") {
    const id = filtroLivre(c, "eq", "id");
    if (id) return { data: { id, display_name: "Empresa", status: "suspended", onboarded_at: null, settings: {} } };
    return { data: [{ id: ESPERA, display_name: "Clínica que espera", status: "suspended", created_at: "2026-10-28T12:00:00Z" }] };
  }
  return { data: [] };
}

const ctx = (banco: ReturnType<typeof bancoLivre>) => ({ admin: banco.cliente as never, autorUserId: "a", tokenId: "t", requestId: "r", escopos: [] });

describe("o passo do pagamento no MCP de plataforma", () => {
  // FORK MIA (.97): 100 com `plataforma_etiquetar_contatos`; o passo do pagamento não somou nenhuma.
  it("nenhuma ferramenta nova: a lista segue com 100", () => {
    expect(FERRAMENTAS).toHaveLength(100);
  });

  it("⭐ listar_clientes com o filtro: só quem espera o primeiro pagamento, com a forma e a situação", async () => {
    const banco = bancoLivre(responder);
    const r = (await FERRAMENTA_POR_NOME.get("plataforma_listar_clientes")!.handler(ctx(banco) as never, {
      situacao_do_pagamento: "aguardando_primeiro_pagamento",
    })) as { clientes: Array<{ id: string; pagamento_inicial: Record<string, unknown> }> };
    expect(r.clientes).toHaveLength(1);
    expect(r.clientes[0]).toMatchObject({
      id: ESPERA,
      pagamento_inicial: { forma: "cartao", situacao: "recusado", modo: "entrada_paga", desde: "2026-10-28T12:05:00Z", fim_do_teste: false },
    });
    const listagem = banco.cadeias.find((c) => c.tabela === "organizations")!;
    expect(listagem.passos.find((p) => p.metodo === "in")?.args).toEqual(["id", [ESPERA]]);
  });

  it("⭐ ver_cliente: o passo inteiro, o documento mascarado e, do cartão, só o final e a bandeira", async () => {
    const banco = bancoLivre(responder);
    const r = (await FERRAMENTA_POR_NOME.get("plataforma_ver_cliente")!.handler(ctx(banco) as never, { organization_id: ESPERA })) as {
      pagamento_inicial: Record<string, unknown>;
    };
    expect(r.pagamento_inicial).toMatchObject({
      modo: "entrada_paga",
      espera_o_primeiro_pagamento: true,
      situacao: "recusado",
      forma_escolhida: "cartao",
      cobranca_no_asaas: "pay_1",
      cartao: { final: "1111", bandeira: "VISA", recusas: 2 },
      dados_fiscais: { tipo: "pj", documento: "11.***.***/0001-81", razao_social: "Clínica Exemplo Ltda", no_asaas: true },
    });
    expect(JSON.stringify(r.pagamento_inicial)).not.toContain("11222333000181");
  });

  it("a empresa sem o passo (isenta, implantada pela Time) devolve null", async () => {
    const r = (await FERRAMENTA_POR_NOME.get("plataforma_ver_cliente")!.handler(ctx(bancoLivre(responder)) as never, { organization_id: PAGOU })) as {
      pagamento_inicial: unknown;
    };
    expect(r.pagamento_inicial).toBeNull();
  });
});
