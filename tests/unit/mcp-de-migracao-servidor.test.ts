/**
 * AS FERRAMENTAS DE IMPORTAÇÃO PELA PORTA DE VERDADE: o servidor MCP de
 * plataforma, com um cliente MCP em memória do outro lado.
 *
 * Duas coisas só este caminho mede:
 *
 *  1. a RECUSA POR OPERAÇÃO AUSENTE NO TOKEN. Quem recusa é o servidor, antes
 *     de o handler ser chamado: testar o handler sozinho não prova que um token
 *     só-leitura não importa uma base;
 *  2. o que vai para a AUDITORIA de plataforma. A linha `plataforma.mcp_executado`
 *     grava os argumentos da chamada, e os de uma importação são a lista de
 *     pessoas de um cliente.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOR, ORG, TOKEN, organizacaoDeTeste, type BancoDaMigracao } from "../helpers/banco-da-migracao";

let banco: BancoDaMigracao;

interface LinhaDeAuditoria {
  action: string;
  organizationId?: string;
  metadata: Record<string, unknown>;
}
const auditSpy = vi.fn();
vi.mock("@/lib/audit", async (original) => ({
  ...(await original<typeof import("@/lib/audit")>()),
  audit: async (entrada: unknown) => {
    auditSpy(entrada);
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => banco.cliente }));
vi.mock("@/lib/ai/embeddings/chave", () => ({ temChaveDeEmbedding: async () => true }));
vi.mock("@/lib/organizacao/capacidades", () => ({ capacidadesDaOrganizacao: async () => ["propostas"] }));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");

async function clienteCom(operacoes: string[]) {
  const [doCliente, doServidor] = InMemoryTransport.createLinkedPair();
  await criarServidorDePlataforma({ tokenId: TOKEN, operacoes }, "req-teste").connect(doServidor);
  const cliente = new Client({ name: "teste-de-migracao", version: "1.0.0" });
  await cliente.connect(doCliente);
  return cliente;
}

async function chamar(operacoes: string[], nome: string, argumentos: Record<string, unknown>) {
  const cliente = await clienteCom(operacoes);
  const r = (await cliente.callTool({ name: nome, arguments: argumentos })) as {
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
  };
  await cliente.close();
  return { erro: r.isError === true, texto: r.content.map((c) => c.text).join("\n") };
}

const auditorias = () => auditSpy.mock.calls.map((c) => c[0] as LinhaDeAuditoria);
const daPlataforma = (acao: string) => auditorias().filter((a) => a.action === acao);

const CONTATOS = [
  { nome: "Ana Souza", telefone: "(10) 99111-0001", email: "ana.souza@exemplo.invalid", observacao: "Prefere contato à tarde." },
];

/** Uma chamada bem formada de cada escrita, e a operação que ela exige. */
const ESCRITAS: Array<{ nome: string; operacao: string; outra: string; argumentos: Record<string, unknown>; tabela: string }> = [
  {
    nome: "plataforma_importar_empresas",
    operacao: "importar_base",
    outra: "importar_materiais",
    argumentos: { organization_id: ORG, empresas: [{ nome: "Padaria Modelo LTDA", cnpj: "12.345.678/0001-90" }] },
    tabela: "crm_empresas",
  },
  {
    nome: "plataforma_importar_contatos",
    operacao: "importar_base",
    outra: "importar_materiais",
    argumentos: { organization_id: ORG, origem: "crm-antigo", contatos: CONTATOS },
    tabela: "contacts",
  },
  {
    nome: "plataforma_importar_negocios",
    operacao: "importar_base",
    outra: "importar_materiais",
    argumentos: {
      organization_id: ORG,
      origem: "crm-antigo",
      negocios: [{ id_de_origem: "n-1", titulo: "Pedido da padaria", funil: "Comercial", etapa: "Novo" }],
    },
    tabela: "crm_leads",
  },
  {
    nome: "plataforma_importar_conhecimento",
    operacao: "importar_materiais",
    outra: "importar_base",
    argumentos: {
      organization_id: ORG,
      nome: "Política de troca",
      arquivo_base64: Buffer.from("Troca em 30 dias com a nota fiscal.").toString("base64"),
      nome_do_arquivo: "politica.txt",
    },
    tabela: "ai_knowledge_sources",
  },
  {
    nome: "plataforma_importar_fotos_de_produto",
    operacao: "importar_materiais",
    outra: "importar_base",
    argumentos: { organization_id: ORG, fotos: [{ produto_codigo: "CAM-001", url: "https://exemplo.invalid/camiseta.png" }] },
    tabela: "catalog_products",
  },
  {
    nome: "plataforma_importar_modelo_de_proposta",
    operacao: "importar_materiais",
    outra: "importar_base",
    argumentos: {
      organization_id: ORG,
      nome: "Site institucional",
      arquivo_base64: Buffer.from("Proposta comercial. ".repeat(10)).toString("base64"),
      nome_do_arquivo: "proposta.txt",
    },
    tabela: "proposal_templates",
  },
];

beforeEach(() => {
  banco = organizacaoDeTeste({ platform_api_tokens: [{ id: TOKEN, created_by: AUTOR }] });
  auditSpy.mockClear();
});

describe("recusa por operação ausente no token", () => {
  for (const escrita of ESCRITAS) {
    it(`${escrita.nome}: token só-leitura é recusado ANTES do handler, e a recusa nomeia a operação`, async () => {
      const r = await chamar([], escrita.nome, escrita.argumentos);

      expect(r.erro).toBe(true);
      expect(r.texto).toContain(`não tem a operação "${escrita.operacao}"`);
      expect(r.texto).toContain("Tokens de plataforma");
      // O raio vai junto: quem pede a operação sabe o que está pedindo.
      expect(r.texto).toContain("O que ela permite:");
      // Nada foi lido nem gravado: o handler não rodou.
      expect(banco.escritas).toEqual([]);
      expect(banco.arquivos).toEqual([]);
      expect(daPlataforma("plataforma.mcp_recusado")).toHaveLength(1);
      expect(daPlataforma("plataforma.mcp_recusado")[0]!.metadata).toMatchObject({
        ferramenta: escrita.nome,
        operacao: escrita.operacao,
        token_id: TOKEN,
      });
      expect(daPlataforma("plataforma.mcp_executado")).toHaveLength(0);
    });

    it(`${escrita.nome}: a OUTRA operação de importação não serve, nem as de administração`, async () => {
      const r = await chamar([escrita.outra, "criar_cliente", "liberar_modulo", "lancar_credito", "definir_preco"], escrita.nome, escrita.argumentos);
      expect(r.erro).toBe(true);
      expect(r.texto).toContain(`não tem a operação "${escrita.operacao}"`);
      expect(banco.escritas).toEqual([]);
    });
  }

  it("a recusa de escopo não grava os argumentos (a lista de pessoas) na trilha", async () => {
    await chamar([], "plataforma_importar_contatos", { organization_id: ORG, origem: "crm-antigo", contatos: CONTATOS });
    expect(JSON.stringify(auditorias())).not.toMatch(/Ana|99111|exemplo\.invalid|Prefere/);
  });

  it("plataforma_ver_importacao é leitura: token sem operação nenhuma lê", async () => {
    const r = await chamar([], "plataforma_ver_importacao", { organization_id: ORG });
    expect(r.erro, r.texto).toBe(false);
    expect(JSON.parse(r.texto)).toMatchObject({ organizacao: { id: ORG }, ordem_da_migracao: expect.stringContaining("contatos") });
    // Leitura não é auditada.
    expect(auditorias()).toEqual([]);
  });
});

describe("com a operação no token, a importação roda e a trilha não carrega pessoa", () => {
  it("importar contatos: grava, responde por item e audita só contagens", async () => {
    const r = await chamar(["importar_base"], "plataforma_importar_contatos", {
      organization_id: ORG,
      origem: "crm-antigo",
      contatos: [...CONTATOS, { nome: "Sem identificador" }],
    });

    expect(r.erro, r.texto).toBe(false);
    const resposta = JSON.parse(r.texto);
    expect(resposta).toMatchObject({ total: 2, criou: 1, recusou: 1 });
    expect(resposta.itens[1].motivo).toContain("Item 2");
    expect(banco.tabela("contacts")).toHaveLength(1);
    // O ator gravado é quem criou o token.
    expect(banco.tabela("contacts")[0]).toMatchObject({ created_by_user_id: AUTOR });

    const executado = daPlataforma("plataforma.mcp_executado");
    expect(executado).toHaveLength(1);
    expect(executado[0]!.metadata).toMatchObject({
      ferramenta: "plataforma_importar_contatos",
      operacao: "importar_base",
      token_id: TOKEN,
      // A lista virou contagem.
      argumentos: { organization_id: ORG, origem: "crm-antigo", contatos: { itens: 2 } },
    });
    // Nem a linha da plataforma nem a da organização carregam nome, telefone, e-mail ou observação.
    expect(JSON.stringify(auditorias())).not.toMatch(/Ana|Souza|99111|exemplo\.invalid|Prefere/);
    expect(daPlataforma("plataforma.importacao")[0]).toMatchObject({ organizationId: ORG });
  });

  it("importar conhecimento: o conteúdo em base64 não vai para a trilha", async () => {
    const conteudo = Buffer.from("Troca em 30 dias com a nota fiscal.").toString("base64");
    const r = await chamar(["importar_materiais"], "plataforma_importar_conhecimento", {
      organization_id: ORG,
      nome: "Política de troca",
      arquivo_base64: conteudo,
      nome_do_arquivo: "politica.xlsx",
    });
    // A recusa de tipo chega ao modelo como texto, com a saída.
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("CSV UTF-8");
    expect(JSON.stringify(auditorias())).not.toContain(conteudo);
  });

  it("organização inexistente: a recusa chega ao modelo dizendo como achar o id certo", async () => {
    const r = await chamar(["importar_base"], "plataforma_importar_empresas", {
      organization_id: "00000000-0000-4000-8000-00000000dead",
      empresas: [{ nome: "Padaria Modelo LTDA" }],
    });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("plataforma_listar_clientes");
    expect(banco.escritas).toEqual([]);
  });

  it("um item ruim no meio do lote: a resposta é sucesso, com os bons gravados e o ruim listado", async () => {
    const r = await chamar(["importar_base"], "plataforma_importar_empresas", {
      organization_id: ORG,
      empresas: [{ nome: "Padaria Modelo LTDA" }, { nome: "CNPJ torto", cnpj: "123" }, { nome: "Oficina Exemplo ME" }],
    });
    expect(r.erro, r.texto).toBe(false);
    const resposta = JSON.parse(r.texto);
    expect(resposta.itens.map((i: { desfecho: string }) => i.desfecho)).toEqual(["criou", "recusou", "criou"]);
    expect(banco.tabela("crm_empresas")).toHaveLength(2);
  });
});

describe("o catálogo que o modelo vê", () => {
  it("lista as sete ferramentas, e a descrição de cada escrita diz qual operação o token precisa", async () => {
    const cliente = await clienteCom([]);
    const { tools } = await cliente.listTools();
    await cliente.close();
    const porNome = new Map(tools.map((t) => [t.name, t.description ?? ""]));

    for (const escrita of ESCRITAS) {
      expect(porNome.get(escrita.nome), escrita.nome).toContain(`Exige que o token carregue a operação "${escrita.operacao}"`);
    }
    expect(porNome.get("plataforma_ver_importacao")).toContain("(Leitura.)");
  });
});
