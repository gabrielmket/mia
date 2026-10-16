/**
 * FORK MIA (.79, item 8) — as quatro ferramentas dos PAINÉIS PRONTOS e do LINK
 * PARA O DONO, e a META DO MÊS em `plataforma_configurar_empresa`, pelo
 * servidor de plataforma inteiro (tools/list, a guarda da operação, a
 * conferência dos argumentos, o handler e a resposta).
 *
 * O banco é o de memória (`tests/helpers/implantacao-em-memoria.ts`); o motor de
 * conta (`fn_mia_relatorio`) responde aqui com números fixos, porque a conta de
 * verdade é do Postgres e é provada em
 * `tests/invariants/motor-de-conta-dos-relatorios.test.ts`. O que este arquivo
 * mede é o caminho da ferramenta: o que ela pede ao motor, como lê a resposta,
 * o que grava na tabela do link e o que a auditoria recebe.
 *
 * Nenhum dado de cliente real: empresa fictícia do cenário.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cenarioDaImplantacao, clienteMcp, ORG, OUTRA_ORG } from "@/tests/helpers/implantacao-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { FERRAMENTAS } = await import("@/lib/mcp-plataforma/ferramentas");
const { OPERACOES } = await import("@/lib/mcp-plataforma/operacoes");
const { audit } = await import("@/lib/audit");
const { hashDoToken, tokenDoLink } = await import("@/lib/paineis/link");

const COMPARTILHAR = ["compartilhar_paineis"];

let cenario: ReturnType<typeof cenarioDaImplantacao>;
const pedidosAoMotor: Array<Record<string, unknown>> = [];

/** O que o motor devolveria, com os números fixos de cada fonte. */
function respostaDoMotor(args: Record<string, unknown>) {
  const valores = args.p_valores !== false;
  const base = {
    fonte: args.p_fonte,
    medidas: args.p_medidas,
    dim1: args.p_dim1,
    dim2: args.p_dim2,
    filtros: args.p_filtros,
    janela: { periodo: args.p_periodo, de: "2026-09-16", ate: "2026-10-15", inicio: null, fim: null, fuso: "America/Sao_Paulo", hoje: "2026-10-15", futuro: false, dias: 30 },
    moeda: "BRL",
    valores,
    fora_da_moeda: 0,
    series: null,
    dobrados: [],
    funil: null,
    meta: null,
    anterior: null,
  };
  const grupo = (chave: string, n: number, extra: Record<string, unknown> = {}) => ({
    chave,
    rotulo: null,
    ordem: null,
    sem: chave === "__sem",
    outros: false,
    n,
    n_ok: 0,
    valores: { qtd: n },
    ...extra,
  });
  if (args.p_fonte === "negocios" && args.p_dim1 === "situacao") {
    return {
      ...base,
      total: { n: 10, n_ok: 4, valores: { qtd: 10, soma: valores ? 900000 : null, tfechar: 12.5 } },
      grupos: [
        grupo("aberto", 3),
        { ...grupo("ganho", 4), valores: { qtd: 4, soma: valores ? 800000 : null, tfechar: 12.5 } },
        grupo("perdido", 3),
      ],
    };
  }
  if (args.p_fonte === "negocios" && (args.p_filtros as Record<string, unknown>)?.situacao === "ganho") {
    return {
      ...base,
      total: { n: 4, n_ok: 4, valores: { soma: valores ? 800000 : null } },
      grupos: [],
      meta: { alvo_cents: valores ? 1000000 : null, proporcional: false, meses_sem_meta: 0, fracao: 0.8, corrido: 0.5 },
    };
  }
  return { ...base, total: { n: 0, n_ok: 0, valores: {} }, grupos: [] };
}

beforeEach(() => {
  cenario = cenarioDaImplantacao();
  pedidosAoMotor.length = 0;
  const rpcDoCenario = cenario.cliente.rpc;
  cenario.cliente.rpc = async (nome: string, args: unknown) => {
    if (nome === "fn_mia_relatorio") {
      pedidosAoMotor.push(args as Record<string, unknown>);
      return { data: respostaDoMotor(args as Record<string, unknown>), error: null };
    }
    return rpcDoCenario(nome, args);
  };
  estado.cliente = cenario.cliente;
  vi.mocked(audit).mockClear();
});

function acoesAuditadas(): string[] {
  return vi.mocked(audit).mock.calls.map((c) => (c[0] as { action: string }).action);
}

describe("a lista: 64 ferramentas, as quatro do item 8", () => {
  it("as quatro estão lá, a leitura é livre e a escrita pede `compartilhar_paineis`", () => {
    expect(FERRAMENTAS).toHaveLength(64);
    const operacao = (nome: string) => FERRAMENTAS.find((f) => f.name === nome)?.operacao;
    expect(operacao("plataforma_ver_paineis")).toBeNull();
    expect(operacao("plataforma_ver_links_do_dono")).toBeNull();
    expect(operacao("plataforma_garantir_link_do_dono")).toBe("compartilhar_paineis");
    expect(operacao("plataforma_revogar_link_do_dono")).toBe("compartilhar_paineis");
  });

  it("a caixinha nova existe, com o raio escrito para quem a marca", () => {
    const op = OPERACOES.find((o) => o.chave === "compartilhar_paineis");
    expect(op).toBeDefined();
    expect(op!.raio).toMatch(/QUALQUER cliente/);
    expect(op!.raio).toMatch(/sem senha/);
  });

  it("token sem a caixinha: o link é recusado antes do handler, e nada é gravado", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, ["implantar_configuracao"]);
    const r = await mcp.chamar("plataforma_garantir_link_do_dono", {
      organization_id: ORG,
      para_quem: "Dono",
      paineis: ["resultado"],
    });
    await mcp.fechar();
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("compartilhar_paineis");
    expect(cenario.banco.tabela("mia_paineis_links")).toHaveLength(0);
  });
});

describe("plataforma_garantir_link_do_dono", () => {
  it("⭐ cria; o mesmo pedido responde ja_estava; outro conteúdo ajusta no MESMO endereço", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, COMPARTILHAR);
    const primeiro = await mcp.chamar("plataforma_garantir_link_do_dono", {
      organization_id: ORG,
      para_quem: "Dono da clínica",
      paineis: ["resultado", "meta", "funil"],
      mostrar_valores: false,
    });
    expect(primeiro.erro).toBe(false);
    expect(primeiro.dados.desfecho).toBe("criou");
    const link = primeiro.dados.link as Record<string, unknown>;
    expect(link.situacao).toBe("ativo");
    expect(link.periodo).toBe("escolhe");
    expect(link.mostrar_valores).toBe(false);

    const linhas = cenario.banco.tabela("mia_paineis_links");
    expect(linhas).toHaveLength(1);
    const linha = linhas[0]!;
    // O token não é gravado: só o hash dele, e o endereço é o token derivado do id.
    const token = tokenDoLink(String(linha.id));
    expect(linha.token_hash).toBe(hashDoToken(token));
    expect(JSON.stringify(linha)).not.toContain(token);
    expect(String(link.url).endsWith(`/painel/${token}`)).toBe(true);
    expect(linha.organization_id).toBe(ORG);
    expect(linha.created_via).toBe("mcp_plataforma");
    // 90 dias por padrão.
    const dias = (Date.parse(String(linha.expires_at)) - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(89);
    expect(dias).toBeLessThan(91);

    const igual = await mcp.chamar("plataforma_garantir_link_do_dono", {
      organization_id: ORG,
      para_quem: "dono da CLÍNICA",
      paineis: ["resultado", "meta", "funil"],
      mostrar_valores: false,
    });
    expect(igual.dados.desfecho).toBe("ja_estava");

    const outro = await mcp.chamar("plataforma_garantir_link_do_dono", {
      organization_id: ORG,
      para_quem: "Dono da clínica",
      paineis: ["resultado", "agenda"],
      periodo: "mes",
    });
    await mcp.fechar();
    expect(outro.dados.desfecho).toBe("atualizou");
    expect((outro.dados.link as Record<string, unknown>).url).toBe(link.url);
    expect(cenario.banco.tabela("mia_paineis_links")).toHaveLength(1);
    expect(cenario.banco.tabela("mia_paineis_links")[0]!.paineis).toEqual(["resultado", "agenda"]);

    expect(acoesAuditadas().filter((a) => a.startsWith("paineis."))).toEqual([
      "paineis.link_criado",
      "paineis.link_alterado",
    ]);
  });

  it("funil de outra empresa é recusado com a frase, e nada é gravado", async () => {
    cenario.banco.tabela("crm_pipelines").push({
      id: "0d000000-0000-4000-8000-0000000000ff",
      organization_id: OUTRA_ORG,
      name: "Vizinho",
      is_default: true,
      is_archived: false,
      position: 1000,
      vocabulary: {},
      settings: {},
    });
    const mcp = await clienteMcp(criarServidorDePlataforma as never, COMPARTILHAR);
    const r = await mcp.chamar("plataforma_garantir_link_do_dono", {
      organization_id: ORG,
      para_quem: "Dono",
      paineis: ["funil"],
      funil_id: "0d000000-0000-4000-8000-0000000000ff",
    });
    await mcp.fechar();
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("não é desta empresa");
    expect(cenario.banco.tabela("mia_paineis_links")).toHaveLength(0);
  });

  it("painel que não existe é recusado na conferência dos argumentos, com a lista", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, COMPARTILHAR);
    const r = await mcp.chamar("plataforma_garantir_link_do_dono", {
      organization_id: ORG,
      para_quem: "Dono",
      paineis: ["custo_da_ia"],
    });
    await mcp.fechar();
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("paineis");
    expect(cenario.banco.tabela("mia_paineis_links")).toHaveLength(0);
  });

  it("na empresa de demonstração cria, e a resposta avisa que são dados fictícios", async () => {
    cenario = cenarioDaImplantacao({ demonstracao: true });
    estado.cliente = cenario.cliente;
    const mcp = await clienteMcp(criarServidorDePlataforma as never, COMPARTILHAR);
    const r = await mcp.chamar("plataforma_garantir_link_do_dono", {
      organization_id: ORG,
      para_quem: "Venda da demonstração",
      paineis: ["resultado"],
    });
    await mcp.fechar();
    expect(r.dados.desfecho).toBe("criou");
    expect(String(r.dados.aviso)).toContain("demonstração");
  });
});

describe("plataforma_revogar_link_do_dono e plataforma_ver_links_do_dono", () => {
  it("⭐ revoga pelo nome; de novo responde ja_estava; garantir depois cria OUTRO endereço", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, COMPARTILHAR);
    const criado = await mcp.chamar("plataforma_garantir_link_do_dono", {
      organization_id: ORG,
      para_quem: "Sócio",
      paineis: ["resultado"],
    });
    const urlAntiga = (criado.dados.link as Record<string, unknown>).url;

    const revogado = await mcp.chamar("plataforma_revogar_link_do_dono", { organization_id: ORG, para_quem: "sócio" });
    expect(revogado.dados.desfecho).toBe("revogou");
    expect(cenario.banco.tabela("mia_paineis_links")[0]!.revoked_at).toBeTruthy();

    const deNovo = await mcp.chamar("plataforma_revogar_link_do_dono", { organization_id: ORG, para_quem: "Sócio" });
    expect(deNovo.dados.desfecho).toBe("ja_estava");

    const outro = await mcp.chamar("plataforma_garantir_link_do_dono", {
      organization_id: ORG,
      para_quem: "Sócio",
      paineis: ["resultado"],
    });
    expect(outro.dados.desfecho).toBe("criou");
    expect((outro.dados.link as Record<string, unknown>).url).not.toBe(urlAntiga);

    const lista = await mcp.chamar("plataforma_ver_links_do_dono", { organization_id: ORG });
    await mcp.fechar();
    expect(lista.dados.total).toBe(2);
    const situacoes = (lista.dados.links as Array<Record<string, unknown>>).map((l) => l.situacao).sort();
    expect(situacoes).toEqual(["ativo", "revogado"]);
    expect(acoesAuditadas()).toContain("paineis.link_revogado");
  });

  it("sem link_id nem para_quem: a recusa ensina", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, COMPARTILHAR);
    const r = await mcp.chamar("plataforma_revogar_link_do_dono", { organization_id: ORG });
    await mcp.fechar();
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("para_quem");
  });
});

describe("plataforma_ver_paineis", () => {
  it("⭐ lê os números do motor, da organização pedida, e sem valores quando pedido", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const r = await mcp.chamar("plataforma_ver_paineis", {
      organization_id: ORG,
      periodo: "mes",
      paineis: ["resultado", "meta"],
      mostrar_valores: false,
    });
    await mcp.fechar();
    expect(r.erro).toBe(false);
    expect(pedidosAoMotor.length).toBe(2);
    for (const p of pedidosAoMotor) {
      expect(p.p_org).toBe(ORG);
      expect(p.p_valores).toBe(false);
    }
    const paineis = r.dados.paineis as Array<Record<string, unknown>>;
    const resultado = paineis.find((p) => p.painel === "resultado")!;
    expect(resultado.ganhos).toBe(4);
    expect(resultado.perdidos).toBe(3);
    expect(resultado.taxaDeGanho).toBeCloseTo(57.1, 1);
    expect(resultado.valorGanho).toBeNull();
    const meta = paineis.find((p) => p.painel === "meta")!;
    expect(meta.temMeta).toBe(true);
    expect(meta.alvo).toBeNull();
    expect(meta.fracao).toBe(0.8);
    // Nada de custo de IA nem de nome: o painel só carrega números.
    expect(r.texto).not.toMatch(/custo|usd|token/i);
  });
});

describe("plataforma_configurar_empresa · meta do mês", () => {
  it("⭐ grava a meta da empresa inteira; a mesma responde ja_estava; outra atualiza", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, ["implantar_configuracao"]);
    const r = await mcp.chamar("plataforma_configurar_empresa", {
      organization_id: ORG,
      meta_do_mes: { valor_cents: 10_000_000, mes: "2026-10" },
    });
    expect(r.erro).toBe(false);
    expect(r.dados.desfecho).toBe("atualizou");
    const metas = cenario.banco.tabela("sales_targets");
    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({
      organization_id: ORG,
      periodo: "2026-10-01",
      metrica: "receita_total",
      alvo_cents: 10_000_000,
      user_id: null,
      agent_id: null,
    });

    const igual = await mcp.chamar("plataforma_configurar_empresa", {
      organization_id: ORG,
      meta_do_mes: { valor_cents: 10_000_000, mes: "2026-10" },
    });
    expect(igual.dados.desfecho).toBe("ja_estava");

    const ruim = await mcp.chamar("plataforma_configurar_empresa", {
      organization_id: ORG,
      meta_do_mes: { valor_cents: 10_000_000, mes: "outubro" },
    });
    await mcp.fechar();
    expect(ruim.erro).toBe(true);
    expect(ruim.texto).toContain("AAAA-MM");
  });
});
