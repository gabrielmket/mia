/**
 * FORK MIA (.88) — o ASSISTENTE DA MIA no MCP de plataforma: as cinco
 * ferramentas, pelo protocolo, contra o banco em memória.
 *
 * A CONTAGEM total mora no teste da entrega mais nova (o e-mail marketing, .89:
 * `mcp-de-implantacao-email-marketing.test.ts`, 83). Aqui ficam as cinco do
 * assistente: 69 + 5 = 74 antes do e-mail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOR, cenarioDaImplantacao, clienteMcp, ORG, TODAS_AS_OPERACOES } from "@/tests/helpers/implantacao-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown, emails: [] as unknown[], pushes: [] as unknown[] }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
vi.mock("@/lib/email/roteador", () => ({
  sendEmail: vi.fn(async (args: unknown) => {
    estado.emails.push(args);
    return { ok: true, via: "smtp" };
  }),
}));
vi.mock("@/lib/branding/saida", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, marcaDaSaida: async () => ({ nome: "MIA", logoUrl: null }) };
});
vi.mock("@/lib/notifications/web_push", () => ({
  enviarPushAoUsuario: vi.fn(async (...args: unknown[]) => {
    estado.pushes.push(args);
    return { sent: 1, gone: 0 };
  }),
}));

const { FERRAMENTAS } = await import("@/lib/mcp-plataforma/ferramentas");
const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");

const OPERACOES = [...TODAS_AS_OPERACOES];
const QUEM_ABRIU = "0b000000-0000-4000-8000-0000000000aa";

function cenario(opcoes: { demonstracao?: boolean } = {}) {
  const c = cenarioDaImplantacao(opcoes);
  c.usuarios.set(QUEM_ABRIU, { email: "atendente@exemplo.invalid", nome: "Atendente Exemplo" });
  estado.cliente = c.cliente;
  return c;
}

beforeEach(() => {
  estado.emails = [];
  estado.pushes = [];
});

describe("a lista", () => {
  it("são 5 as ferramentas do assistente (o total, 83, mora no teste do e-mail marketing)", () => {
    const doAssistente = FERRAMENTAS.filter((f) => /assistente|chamado/.test(f.name)).map((f) => [f.name, f.operacao]);
    expect(Object.fromEntries(doAssistente)).toEqual({
      plataforma_configurar_assistente: "implantar_configuracao",
      plataforma_garantir_conhecimento_do_assistente: "implantar_configuracao",
      plataforma_ver_assistente: null,
      plataforma_ver_chamados: null,
      plataforma_responder_chamado: "responder_chamados",
    });
  });
});

describe("plataforma_configurar_assistente", () => {
  it("grava só o que veio e devolve o antes e o depois", async () => {
    const c = cenario();
    const mcp = await clienteMcp(criarServidorDePlataforma as never, OPERACOES);
    const r = await mcp.chamar("plataforma_configurar_assistente", {
      organization_id: ORG,
      papeis: ["admin", "manager"],
      perguntas_por_pessoa_por_dia: 20,
    });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.configuracao).toEqual({
      ligado: true,
      papeis: ["admin", "manager"],
      perguntas_por_pessoa_por_dia: 20,
      resumo_da_manha_padrao: false,
    });
    const linha = c.banco.tabela("mia_assistente_config")[0]!;
    expect(linha).toMatchObject({ organization_id: ORG, papeis: ["admin", "manager"], perguntas_por_pessoa_por_dia: 20 });

    // Chamar de novo só com o resumo: o resto fica.
    const de_novo = await mcp.chamar("plataforma_configurar_assistente", { organization_id: ORG, resumo_da_manha_padrao: true });
    expect((de_novo.dados.configuracao as Record<string, unknown>).perguntas_por_pessoa_por_dia).toBe(20);
    expect(c.banco.tabela("mia_assistente_config")).toHaveLength(1);
    await mcp.fechar();
  });

  it("sem a operação no token, nada é gravado", async () => {
    const c = cenario();
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const r = await mcp.chamar("plataforma_configurar_assistente", { organization_id: ORG, ligado: false });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain('"implantar_configuracao"');
    expect(c.banco.escritas).toEqual([]);
    await mcp.fechar();
  });
});

describe("plataforma_garantir_conhecimento_do_assistente", () => {
  it("garante por título: a segunda chamada atualiza em vez de duplicar, e remover tira", async () => {
    const c = cenario();
    const mcp = await clienteMcp(criarServidorDePlataforma as never, OPERACOES);
    const primeira = await mcp.chamar("plataforma_garantir_conhecimento_do_assistente", {
      organization_id: ORG,
      itens: [{ titulo: "Aprovação de proposta", texto: "Acima de R$ 10 mil passa pela gestora." }],
    });
    expect(primeira.erro, primeira.texto).toBe(false);
    expect(primeira.dados.criados).toEqual(["Aprovação de proposta"]);

    const segunda = await mcp.chamar("plataforma_garantir_conhecimento_do_assistente", {
      organization_id: ORG,
      itens: [{ titulo: "aprovação de proposta", texto: "Acima de R$ 15 mil passa pela gestora." }],
    });
    expect(segunda.dados.atualizados).toEqual(["aprovação de proposta"]);
    expect(c.banco.tabela("mia_assistente_conhecimento")).toHaveLength(1);

    const tirar = await mcp.chamar("plataforma_garantir_conhecimento_do_assistente", {
      organization_id: ORG,
      remover: ["Aprovação de proposta"],
    });
    expect(tirar.dados.removidos).toHaveLength(1);
    expect(c.banco.tabela("mia_assistente_conhecimento")).toHaveLength(0);
    await mcp.fechar();
  });
});

describe("plataforma_ver_assistente", () => {
  it("devolve a configuração padrão, o uso por papel e as perguntas sem resposta agrupadas", async () => {
    const c = cenario();
    const agora = new Date().toISOString();
    c.banco.tabela("mia_assistente_mensagens").push(
      { id: "m1", organization_id: ORG, user_id: AUTOR, tipo: "pergunta", texto: "Dá para mandar PDF?", sem_resposta: true, created_at: agora },
      { id: "m2", organization_id: ORG, user_id: AUTOR, tipo: "pergunta", texto: "dá para mandar pdf?", sem_resposta: true, created_at: agora },
      { id: "m3", organization_id: ORG, user_id: AUTOR, tipo: "pergunta", texto: "Como está meu dia?", sem_resposta: false, created_at: agora },
    );
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const r = await mcp.chamar("plataforma_ver_assistente", { organization_id: ORG });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.configuracao).toMatchObject({ ligado: true, perguntas_por_pessoa_por_dia: 50, resumo_da_manha_padrao: false, gravada: false });
    expect(r.dados.uso_30_dias).toEqual({ admin: { perguntas: 3, pessoas: 1 } });
    expect(r.dados.sem_resposta).toEqual([{ pergunta: "Dá para mandar PDF?", vezes: 2 }]);
    await mcp.fechar();
  });
});

describe("os chamados do lado da Time", () => {
  function semearChamados(c: ReturnType<typeof cenario>) {
    c.banco.tabela("mia_chamados").push(
      {
        id: "0f000000-0000-4000-8000-000000000001",
        numero: 1042,
        organization_id: ORG,
        user_id: QUEM_ABRIU,
        tipo: "erro",
        texto: "O botão de salvar o negócio não funciona.",
        contexto: { tela: { caminho: "/app/kanban", rotulo: "Funis" }, versao: "1.21.0-mia.88" },
        print_path: null,
        situacao: "novo",
        resposta: null,
        respondido_em: null,
        demonstracao: false,
        conversa_id: null,
        created_at: "2026-10-24T13:00:00Z",
        updated_at: "2026-10-24T13:00:00Z",
      },
      {
        id: "0f000000-0000-4000-8000-000000000002",
        numero: 1043,
        organization_id: ORG,
        user_id: QUEM_ABRIU,
        tipo: "pedido",
        texto: "Chamado da demonstração.",
        contexto: {},
        print_path: null,
        situacao: "novo",
        resposta: null,
        respondido_em: null,
        demonstracao: true,
        conversa_id: null,
        created_at: "2026-10-24T14:00:00Z",
        updated_at: "2026-10-24T14:00:00Z",
      },
    );
  }

  it("ver: só os que saem para a Time (o da demonstração não entra)", async () => {
    const c = cenario();
    semearChamados(c);
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const r = await mcp.chamar("plataforma_ver_chamados", {});
    expect(r.erro, r.texto).toBe(false);
    const numeros = (r.dados.chamados as Array<{ numero: number }>).map((ch) => ch.numero);
    expect(numeros).toEqual([1042]);
    await mcp.fechar();
  });

  it("responder: a resposta chega a quem abriu no assistente, no sino e no e-mail", async () => {
    const c = cenario();
    semearChamados(c);
    const mcp = await clienteMcp(criarServidorDePlataforma as never, OPERACOES);
    const r = await mcp.chamar("plataforma_responder_chamado", {
      organization_id: ORG,
      numero: 1042,
      situacao: "resolvido",
      resposta: "O valor do negócio é obrigatório. Preencha e salve de novo.",
    });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.entregue).toEqual({ assistente: true, sino: true, email: true });

    const chamado = c.banco.tabela("mia_chamados").find((ch) => ch.numero === 1042)!;
    expect(chamado).toMatchObject({ situacao: "resolvido", resposta: "O valor do negócio é obrigatório. Preencha e salve de novo." });
    const mensagem = c.banco.tabela("mia_assistente_mensagens").find((m) => m.tipo === "resposta_do_chamado")!;
    expect(mensagem.user_id).toBe(QUEM_ABRIU);
    expect(String(mensagem.texto)).toContain("#1042");
    const aviso = c.banco.tabela("agent_inbox_items")[0]!;
    expect(aviso).toMatchObject({ organization_id: ORG, para_user_id: QUEM_ABRIU, kind: "other", ref_kind: "mia_chamado" });
    expect(estado.emails).toHaveLength(1);
    expect((estado.emails[0] as { to: string; organizationId: string })).toMatchObject({
      to: "atendente@exemplo.invalid",
      organizationId: ORG,
    });
    await mcp.fechar();
  });

  it("responder: sem a operação própria, recusa antes do handler", async () => {
    const c = cenario();
    semearChamados(c);
    const mcp = await clienteMcp(criarServidorDePlataforma as never, ["implantar_configuracao"]);
    const r = await mcp.chamar("plataforma_responder_chamado", { organization_id: ORG, numero: 1042, situacao: "resolvido", resposta: "x" });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain('"responder_chamados"');
    expect(c.banco.tabela("mia_chamados").find((ch) => ch.numero === 1042)!.situacao).toBe("novo");
    await mcp.fechar();
  });

  it("responder: o chamado da demonstração não é respondido por aqui", async () => {
    const c = cenario();
    semearChamados(c);
    const mcp = await clienteMcp(criarServidorDePlataforma as never, OPERACOES);
    const r = await mcp.chamar("plataforma_responder_chamado", { organization_id: ORG, numero: 1043, situacao: "resolvido", resposta: "x" });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("demonstração");
    expect(estado.emails).toHaveLength(0);
    await mcp.fechar();
  });
});
