/**
 * FORK MIA (.91) — O ASSISTENTE NOS PRIMEIROS PASSOS: a leitura "o que falta"
 * e as três propostas, no turno, com o cliente da SESSÃO.
 *
 *   - gestor e administrador pedem; o turno PREPARA (só lê) e junta a proposta
 *     no coletor, uma por peça; nada da peça é escrito no turno;
 *   - o follow-up depende do agente: sem agente, volta "depende" e nenhuma
 *     proposta de follow-up nasce;
 *   - (.94) o atendente prepara o cartão e o pede ao administrador (ele não
 *     aplica); o "o que falta" continua de gestor em diante; o somente leitura
 *     recebe a recusa com quem pode, e nenhuma proposta;
 *   - o cliente de serviço nunca nasce no turno (a regra da .88);
 *   - o crítico não tem ferramenta: nenhuma ferramenta do turno conecta
 *     número, paga, convida, mexe em chave ou exclui.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sabotagem = vi.hoisted(() => ({ adminCriado: 0 }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    sabotagem.adminCriado += 1;
    throw new Error("o cliente de serviço foi criado dentro do turno");
  },
}));

const { responderNoAssistente } = await import("@/lib/assistente/turno");
const { telasParaOPapel } = await import("@/lib/assistente/telas");

const ORG = "0a000000-0000-4000-8000-000000000091";
const EU = "0b000000-0000-4000-8000-000000000091";
const ADMIN = "0b000000-0000-4000-8000-0000000000ad";

type Linha = Record<string, unknown>;

/** Uma sessão de mentira com linhas por tabela; os filtros não importam aqui, e nada escreve. */
function sessao(tabelas: Record<string, Linha[]>) {
  const escritas: string[] = [];
  const construtor = (tabela: string) => {
    const linhas = tabelas[tabela] ?? [];
    const alvo: Record<string, unknown> = {};
    const proxy: unknown = new Proxy(alvo, {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: linhas, error: null, count: linhas.length }));
        if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: linhas[0] ?? null, error: null });
        if (prop === "insert" || prop === "update" || prop === "upsert" || prop === "delete") {
          return () => {
            escritas.push(tabela);
            return proxy;
          };
        }
        return () => proxy;
      },
    });
    return proxy;
  };
  return {
    escritas,
    db: {
      supabaseKey: "chave-anon-de-teste",
      headers: { "X-Client-Info": "supabase-ssr/sessao" },
      from: (t: string) => construtor(t),
      rpc: async () => ({ data: null, error: null }),
    },
  };
}

const EMPRESA_NOVA: Record<string, Linha[]> = {
  organizations: [
    {
      id: ORG,
      display_name: "Clínica Sorriso",
      legal_name: "Clínica Sorriso",
      slug: "clinica-sorriso",
      status: "active",
      timezone: "America/Sao_Paulo",
      locale: "pt-BR",
      settings: {},
      onboarded_at: null,
      demonstracao: false,
      onboarding_state: { welcome: { segmento: "clinica", o_que_faz: "clínica odontológica" } },
    },
  ],
  ai_agents: [],
  crm_pipelines: [{ id: "f1", name: "Pedidos", slug: "pedidos", is_default: true }],
  crm_stages: [{ pipeline_id: "f1", slug: "carrinho_abandonado" }],
  followup_flow_pointers: [],
};

function entrada(db: unknown, papel: "manager" | "agent" | "admin" | "viewer") {
  return {
    db: db as never,
    organizationId: ORG,
    nomeDaEmpresa: "Clínica Sorriso",
    userId: EU,
    primeiroNome: "Juliana",
    papel,
    idioma: "pt-BR",
    fuso: "America/Sao_Paulo",
    agora: new Date("2026-10-25T12:00:00Z"),
    tela: { caminho: "/onboarding/funil", rotulo: null },
    telas: telasParaOPapel({ papel }),
    equipe: [{ user_id: ADMIN, nome: "Juliana Prado", papel: "admin" as const }],
    historico: [],
    pergunta: "Monta o agente e o funil",
    ultimaRecusa: null,
    cobrancaLigada: false,
  };
}

type Ferramentas = Record<string, { execute?: (a: unknown, o: unknown) => Promise<unknown> }>;

beforeEach(() => {
  sabotagem.adminCriado = 0;
});

describe("as propostas no turno", () => {
  it("o gestor pede o agente e o funil: o turno prepara as duas, sem escrever nada e sem o cliente de serviço", async () => {
    const { db, escritas } = sessao(EMPRESA_NOVA);
    const resultados: Record<string, unknown> = {};
    const modelo = vi.fn(async (pedido: { tools: Ferramentas }) => {
      for (const nome of ["propor_agente_do_modelo", "propor_funil_do_pacote", "propor_followup_do_modelo", "ver_o_que_falta"]) {
        resultados[nome] = await pedido.tools[nome]!.execute?.({}, { toolCallId: nome, messages: [] });
      }
      return { texto: "Preparei as propostas.", callId: null };
    });
    const r = await responderNoAssistente(entrada(db, "manager"), { chamarModelo: modelo as never });

    expect(sabotagem.adminCriado, "o cliente de serviço foi criado no turno").toBe(0);
    expect(escritas, "o turno não escreve: a proposta é gravada pela rota, e a peça só no aplicar").toEqual([]);
    expect(r.propostas.map((p) => p.tipo).sort()).toEqual(["agente", "funil"]);
    const agente = r.propostas.find((p) => p.tipo === "agente")!;
    expect(agente.pedido).toMatchObject({ segmento: "clinica", nome: "Clara · Recepção" });
    expect((agente.pedido as { prompt: string }).prompt).toContain("Clínica Sorriso (clínica odontológica)");
    expect(agente.mudancas.find((m) => m.rotulo === "Fica")?.valor).toMatch(/rascunho/);
    const funil = r.propostas.find((p) => p.tipo === "funil")!;
    expect(funil.pedido).toMatchObject({ pacote: "clinica", nome: "Agendamentos" });
    // o follow-up depende do agente, que ainda não existe
    expect(resultados.propor_followup_do_modelo).toMatchObject({ ok: false, motivo: "depende" });
    // o gestor não aplica: quem aplica é a administradora, pelo nome
    expect(resultados.propor_agente_do_modelo).toMatchObject({ ok: true, quem_aplica: ["Juliana Prado"] });
    expect(r.fontes).toEqual(expect.arrayContaining(["Agentes de IA", "Funis"]));
  });

  it("com o agente já criado, a proposta de agente diz que ele já existe e não nasce", async () => {
    const { db } = sessao({ ...EMPRESA_NOVA, ai_agents: [{ id: "a1", name: "Clara · Recepção", published_version_id: null, is_default: true }] });
    let resultado: unknown = null;
    const modelo = vi.fn(async (pedido: { tools: Ferramentas }) => {
      resultado = await pedido.tools.propor_agente_do_modelo!.execute?.({}, { toolCallId: "x", messages: [] });
      return { texto: "Já existe.", callId: null };
    });
    const r = await responderNoAssistente(entrada(db, "admin"), { chamarModelo: modelo as never });
    expect(resultado).toMatchObject({ ok: false, motivo: "ja_existe" });
    expect(r.propostas).toEqual([]);
  });

  it("(.94) o atendente prepara o cartão para pedir ao administrador; o \"o que falta\" continua fora dele", async () => {
    const { db } = sessao(EMPRESA_NOVA);
    const resultados: Record<string, unknown> = {};
    const modelo = vi.fn(async (pedido: { tools: Ferramentas }) => {
      for (const nome of ["propor_agente_do_modelo", "propor_funil_do_pacote", "ver_o_que_falta"]) {
        resultados[nome] = await pedido.tools[nome]!.execute?.({}, { toolCallId: nome, messages: [] });
      }
      return { texto: "Preparei; quem aplica é o administrador.", callId: null };
    });
    const r = await responderNoAssistente(entrada(db, "agent"), { chamarModelo: modelo as never });
    expect(resultados.propor_agente_do_modelo).toMatchObject({ ok: true, quem_aplica: ["Juliana Prado"] });
    expect(resultados.propor_funil_do_pacote).toMatchObject({ ok: true });
    expect(resultados.ver_o_que_falta).toMatchObject({ fora_da_permissao: true, quem_pode: [{ nome: "Juliana Prado" }] });
    expect(r.propostas.map((p) => p.tipo).sort()).toEqual(["agente", "funil"]);
  });

  it("o somente leitura recebe a recusa com quem pode, e nenhuma proposta nasce", async () => {
    const { db } = sessao(EMPRESA_NOVA);
    const resultados: unknown[] = [];
    const modelo = vi.fn(async (pedido: { tools: Ferramentas }) => {
      for (const nome of ["propor_agente_do_modelo", "propor_funil_do_pacote", "propor_followup_do_modelo"]) {
        resultados.push(await pedido.tools[nome]!.execute?.({}, { toolCallId: nome, messages: [] }));
      }
      return { texto: "Você não tem acesso.", callId: null };
    });
    const r = await responderNoAssistente(entrada(db, "viewer"), { chamarModelo: modelo as never });
    for (const x of resultados) expect(x).toMatchObject({ fora_da_permissao: true, quem_pode: [{ nome: "Juliana Prado" }] });
    expect(r.propostas).toEqual([]);
  });
});

describe("o crítico não tem ferramenta", () => {
  it("nenhuma ferramenta do turno conecta número, paga, convida, mexe em chave ou exclui", async () => {
    const { db } = sessao(EMPRESA_NOVA);
    let nomes: string[] = [];
    const modelo = vi.fn(async (pedido: { tools: Ferramentas }) => {
      nomes = Object.keys(pedido.tools);
      return { texto: "ok", callId: null };
    });
    await responderNoAssistente(entrada(db, "admin"), { chamarModelo: modelo as never });
    expect(nomes).toEqual(expect.arrayContaining(["ver_o_que_falta", "propor_agente_do_modelo", "propor_funil_do_pacote", "propor_followup_do_modelo"]));
    // (o "ver_numeros_da_equipe" da .88 é leitura de números de venda, não de telefone)
    expect(nomes.filter((n) => /conect|^(?!ver_).*numero|canal|pag|cobran|assin|convid|chave|credencial|exclu|apag|publicar/.test(n))).toEqual([]);
  });
});
