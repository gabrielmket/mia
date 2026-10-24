/**
 * FORK MIA (.88) — O TURNO DO ASSISTENTE LÊ COM O CLIENTE DA SESSÃO, e só com ele.
 *
 * A regra inegociável do assistente da MIA: toda leitura do turno usa o cliente
 * da SESSÃO de quem perguntou, e a RLS e o papel filtram como nas telas. Com o
 * cliente de serviço, o atendente veria os números da equipe que a RLS esconde
 * dele: o "modo administrador escondido" que o protótipo promete não existir.
 *
 * Três provas:
 *
 *   1. SABOTAGEM: o turno chamado com um cliente montado com a chave de serviço
 *      (ou com a marca do `createAdminClient`) é recusado ANTES de qualquer
 *      leitura e antes de chamar o modelo.
 *   2. Pelo efeito: com um cliente de sessão de mentira e um modelo de mentira
 *      que chama TODAS as ferramentas, toda leitura passa pelo cliente de sessão
 *      e o cliente de serviço nunca é criado.
 *   3. Pela fonte: o turno, as ferramentas e as leituras não importam o cliente
 *      de serviço nem o pool do banco.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sabotagem = vi.hoisted(() => ({ adminCriado: 0 }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    sabotagem.adminCriado += 1;
    throw new Error("o cliente de serviço foi criado dentro do turno");
  },
}));

const { ClienteDeServicoNoTurnoError, exigirClienteDeSessao, responderNoAssistente } = await import("@/lib/assistente/turno");
const { telasParaOPapel } = await import("@/lib/assistente/telas");

const ORG = "0a000000-0000-4000-8000-000000000088";
const EU = "0b000000-0000-4000-8000-000000000088";
const CHAVE_DE_SERVICO = "chave-de-servico-de-teste-1234567890";

/** Um cliente de sessão de mentira: aceita qualquer cadeia e anota as tabelas e funções lidas. */
function clienteDeSessaoDeMentira() {
  const lidas: string[] = [];
  const respostaVazia = { data: [], error: null, count: 0 };
  const construtor = (tabela: string): unknown => {
    const alvo: Record<string, unknown> = {};
    const proxy: unknown = new Proxy(alvo, {
      get(_t, prop) {
        if (prop === "then") {
          return (ok: (v: unknown) => unknown) => Promise.resolve(ok(respostaVazia));
        }
        if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: null, error: null });
        return () => proxy;
      },
    });
    lidas.push(tabela);
    return proxy;
  };
  const db = {
    supabaseKey: "chave-anon-de-teste",
    headers: { "X-Client-Info": "supabase-ssr/sessao" },
    from: (tabela: string) => construtor(tabela),
    rpc: async (fn: string) => {
      lidas.push(`rpc:${fn}`);
      return {
        data: {
          grupos: [],
          janela: { periodo: "mes", de: "2026-10-01", ate: "2026-10-31", fuso: "America/Sao_Paulo" },
          moeda: "BRL",
          total: { n: 0, n_ok: 0, valores: {} },
        },
        error: null,
      };
    },
  };
  return { db, lidas };
}

function entrada(db: unknown) {
  return {
    db: db as never,
    organizationId: ORG,
    nomeDaEmpresa: "Empresa Modelo",
    userId: EU,
    primeiroNome: "Juliana",
    papel: "agent" as const,
    idioma: "pt-BR",
    fuso: "America/Sao_Paulo",
    agora: new Date("2026-10-26T12:00:00Z"),
    tela: { caminho: "/app/kanban", rotulo: "Funis" },
    telas: telasParaOPapel({ papel: "agent" }),
    equipe: [{ user_id: "0b000000-0000-4000-8000-0000000000ad", nome: "Bruno Teixeira", papel: "admin" as const }],
    historico: [],
    pergunta: "Como está minha rotina hoje?",
    ultimaRecusa: null,
  };
}

beforeEach(() => {
  sabotagem.adminCriado = 0;
});

describe("sabotagem: o turno recusa o cliente de serviço", () => {
  it("um cliente montado com a chave de serviço é recusado antes de ler e antes do modelo", async () => {
    const deServico = createClient("http://127.0.0.1:1", CHAVE_DE_SERVICO, { auth: { persistSession: false } });
    const modelo = vi.fn();
    await expect(
      responderNoAssistente(entrada(deServico), { chamarModelo: modelo, chaveDeServico: CHAVE_DE_SERVICO }),
    ).rejects.toBeInstanceOf(ClienteDeServicoNoTurnoError);
    expect(modelo).not.toHaveBeenCalled();
  });

  it("a marca do createAdminClient também é recusada, mesmo sem saber a chave", () => {
    const comMarca = createClient("http://127.0.0.1:1", "qualquer", {
      auth: { persistSession: false },
      global: { headers: { "X-Client-Info": "deskcomm-crm/admin" } },
    });
    expect(() => exigirClienteDeSessao(comMarca, "outra-chave")).toThrow(ClienteDeServicoNoTurnoError);
  });

  it("o cliente com a chave anônima (a sessão) passa", () => {
    const sessao = createClient("http://127.0.0.1:1", "chave-anon", { auth: { persistSession: false } });
    expect(() => exigirClienteDeSessao(sessao, CHAVE_DE_SERVICO)).not.toThrow();
  });
});

describe("pelo efeito: toda ferramenta lê pelo cliente de sessão", () => {
  it("o modelo chama TODAS as ferramentas; as leituras passam pela sessão e o cliente de serviço nunca nasce", async () => {
    const { db, lidas } = clienteDeSessaoDeMentira();
    const chamadas: string[] = [];
    const modelo = vi.fn(async (pedido: { tools: Record<string, { execute?: (a: unknown, o: unknown) => Promise<unknown> }> }) => {
      const argumentos: Record<string, unknown> = {
        ver_por_que_a_ia_nao_respondeu: { contato: "Helena" },
        buscar_ajuda: { pergunta: "Como configuro o horário da IA?" },
        ver_contato: { nome: "Helena", incluir_telefone_e_email: false },
        mostrar_me_leva_la: { href: "/app/tasks" },
        oferecer_pedir_a_pessoa: { para_user_id: "0b000000-0000-4000-8000-0000000000ad", pedido: "Ver os números da equipe" },
        registrar_que_nao_sei: { pergunta: "Dá para mandar PDF?" },
        preparar_chamado: { tipo: "erro", resumo: "O botão de salvar não funciona", mensagem_do_sistema: "Informe o valor do negócio" },
      };
      for (const [nome, ferramenta] of Object.entries(pedido.tools)) {
        chamadas.push(nome);
        await ferramenta.execute?.(argumentos[nome] ?? {}, { toolCallId: nome, messages: [] });
      }
      return { texto: "Seu dia: nada pendente.", callId: null };
    });

    const r = await responderNoAssistente(entrada(db), { chamarModelo: modelo as never, chaveDeServico: CHAVE_DE_SERVICO });

    expect(sabotagem.adminCriado, "o cliente de serviço foi criado no turno").toBe(0);
    expect(chamadas).toEqual(
      expect.arrayContaining([
        "ver_minha_rotina",
        "ver_prioridades",
        "ver_meus_leads",
        "ver_minha_performance",
        "ver_numeros_da_equipe",
        "ver_por_que_a_ia_nao_respondeu",
        "buscar_ajuda",
        "ver_contato",
      ]),
    );
    // As leituras do CRM passaram pela sessão.
    for (const tabela of ["crm_tasks", "calendar_appointments", "conversations", "crm_leads", "contacts", "mia_assistente_conhecimento"]) {
      expect(lidas, `${tabela} não foi lida pela sessão`).toContain(tabela);
    }
    expect(lidas).toContain("rpc:fn_mia_relatorio");
    // O atendente não recebe os números da equipe: a ferramenta devolve quem pode.
    expect(r.acoes.some((a) => a.tipo === "suporte")).toBe(true);
    expect(r.acoes.some((a) => a.tipo === "chamado" && a.rascunho.parece_validacao)).toBe(true);
    expect(r.semResposta).toBe(true);
  });

  it("o vendedor que pergunta da equipe recebe a recusa com quem pode, e nenhum número", async () => {
    const { db } = clienteDeSessaoDeMentira();
    let resultado: unknown = null;
    const modelo = vi.fn(async (pedido: { tools: Record<string, { execute?: (a: unknown, o: unknown) => Promise<unknown> }> }) => {
      resultado = await pedido.tools.ver_numeros_da_equipe!.execute?.({}, { toolCallId: "x", messages: [] });
      return { texto: "Você vê só os seus números.", callId: null };
    });
    await responderNoAssistente(entrada(db), { chamarModelo: modelo as never, chaveDeServico: CHAVE_DE_SERVICO });
    expect(resultado).toMatchObject({
      fora_da_permissao: true,
      quem_pode: [{ nome: "Bruno Teixeira", papel: "Administrador" }],
    });
    expect(JSON.stringify(resultado)).not.toMatch(/ganhos|valor_cents|por_pessoa/);
  });
});

describe("pela fonte: o turno não importa o cliente de serviço nem o pool", () => {
  const RAIZ = path.resolve(__dirname, "../..");
  const arquivos = [
    "lib/assistente/turno.ts",
    "lib/assistente/ferramentas.ts",
    "lib/assistente/prompt.ts",
    ...readdirSync(path.join(RAIZ, "lib/assistente/leituras")).map((f) => `lib/assistente/leituras/${f}`),
  ];

  it.each(arquivos)("%s", (arquivo) => {
    const fonte = readFileSync(path.join(RAIZ, arquivo), "utf8");
    const imports = [...fonte.matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports.filter((i) => /supabase\/admin|request-pool|agent-engine\/db|^pg$/.test(i ?? ""))).toEqual([]);
    expect(fonte).not.toMatch(/createAdminClient\s*\(/);
    expect(fonte).not.toMatch(/getRequestPool\s*\(/);
  });
});
