/**
 * FORK MIA — OS SERVIDORES MCP POR AGENTE (upstream 9095) AO ALCANCE DO MCP DE
 * PLATAFORMA: o campo `servidores_mcp` de `plataforma_garantir_agente` e a
 * lista `servidores_mcp` de cada agente em `plataforma_ver_agentes`.
 *
 * O molde é o de `mcp-de-implantacao-novidades-do-upstream-1107.test.ts`: o que
 * se mede é o BANCO, e a resposta só no que ela promete (o segredo não volta,
 * o passo humano vem como item `com_o_humano`). A rede do OAuth (descoberta e
 * registro automático) é trocada por funções de mentira: nenhuma chamada sai.
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia, endereços em
 * `example.com` e chaves inventadas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cenarioDaImplantacao,
  clienteMcp,
  ORG,
  TODAS_AS_OPERACOES,
  type OpcoesDoCenario,
} from "@/tests/helpers/implantacao-em-memoria";
import type { Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => {
  // Antes de qualquer import: `lib/env.ts` lê a chave que cifra a chave do servidor.
  process.env.AI_CRED_AES_KEY = "iBc1Z2gYaAH4rEHs1dHQ2dvNQ6t4OfrdE1/Y6OSvtZY=";
  return { cliente: null as unknown, comRegistroAutomatico: true };
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
vi.mock("@/lib/ai/embeddings/chave", () => ({ temChaveDeEmbedding: vi.fn(async () => true) }));
vi.mock("@/lib/branding/saida", () => ({ marcaDaSaida: vi.fn(async () => ({ nome: "Marca Exemplo" })) }));
// A rede do OAuth: a descoberta devolve metadados fictícios; o registro
// automático devolve um client_id fictício. Nenhuma chamada sai.
vi.mock("@/lib/mcp/servidor-externo/do-agente/oauth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  descobrir: vi.fn(async (endpoint: string) => ({
    recurso: endpoint,
    emissor: "https://login.example.com",
    authorization_endpoint: "https://login.example.com/authorize",
    token_endpoint: "https://login.example.com/token",
    ...(estado.comRegistroAutomatico ? { registration_endpoint: "https://login.example.com/register" } : {}),
    revocation_endpoint: "https://login.example.com/revoke",
    escopos_suportados: ["pedidos:ler"],
    metodosDeAutenticacaoNoToken: ["none"],
  })),
  registrarCliente: vi.fn(async () => "cliente-dinamico-ficticio"),
}));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { audit } = await import("@/lib/audit");
const { registrarCliente } = await import("@/lib/mcp/servidor-externo/do-agente/oauth");

async function preparar(opcoes: OpcoesDoCenario & { semModulo?: boolean } = {}) {
  const cenario = cenarioDaImplantacao(opcoes);
  // O módulo opcional nasce DESLIGADO; quem opera a plataforma o liga (aqui, o teste).
  if (!opcoes.semModulo) {
    (cenario.banco.tabela("platform_config") as Linha[]).push({ chave: "MODULO_MCP_POR_AGENTE", valor: "ligado" });
  }
  estado.cliente = cenario.cliente;
  const mcp = await clienteMcp(criarServidorDePlataforma as never, TODAS_AS_OPERACOES);
  return { ...cenario, mcp, tabela: (nome: string) => cenario.banco.tabela(nome) as Linha[] };
}
type Cenario = Awaited<ReturnType<typeof preparar>>;

async function ok(c: Cenario, nome: string, args: Record<string, unknown>) {
  const r = await c.mcp.chamar(nome, { organization_id: ORG, ...args });
  expect(r.erro, `${nome}: ${r.texto}`).toBe(false);
  return r;
}

async function recusa(c: Cenario, nome: string, args: Record<string, unknown>) {
  const r = await c.mcp.chamar(nome, { organization_id: ORG, ...args });
  expect(r.erro, `${nome} deveria recusar: ${r.texto}`).toBe(true);
  return r.texto;
}

const auditoria = () => JSON.stringify(vi.mocked(audit).mock.calls.map(([e]) => e));
const servidores = (c: Cenario) => c.tabela("ai_agent_mcp_servers");
const toolIds = (c: Cenario) => c.tabela("ai_agent_versions")[0]!.tool_ids as string[];

const PROMPT = "Você é a Bia, atendente da Loja Exemplo. Entenda o que a pessoa procura antes de oferecer um produto.";
const CHAVE = "chave-ficticia-de-pedidos-4321";
const PEDIDOS = {
  nome: "Pedidos",
  endereco: "https://pedidos.example.com/mcp",
  autenticacao: "chave_estatica",
  chave: CHAVE,
  ferramentas: [{ nome: "consultar_pedido" }, { nome: "abrir_troca", leitura: false }],
};

beforeEach(() => {
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
  vi.mocked(audit).mockClear();
  vi.mocked(registrarCliente).mockClear();
  estado.comRegistroAutomatico = true;
});

describe("plataforma_garantir_agente · CAMPO NOVO `servidores_mcp` (upstream 9095) · a régua de entrada", () => {
  it("módulo opcional desligado: recusa antes de qualquer escrita, e não liga o módulo", async () => {
    const c = await preparar({ semModulo: true });
    const texto = await recusa(c, "plataforma_garantir_agente", { nome: "Bia", prompt: PROMPT, servidores_mcp: [PEDIDOS] });
    expect(texto).toContain("DESLIGADO");
    expect(c.tabela("ai_agents")).toEqual([]);
    expect(servidores(c)).toEqual([]);
    expect(c.tabela("platform_config")).toEqual([]);
  });

  it("⭐ DEMONSTRAÇÃO: ligar servidor é recusado antes do banco", async () => {
    const c = await preparar({ demonstracao: true });
    expect(await recusa(c, "plataforma_garantir_agente", { nome: "Bia", prompt: PROMPT, servidores_mcp: [PEDIDOS] })).toContain("empresa de demonstração");
    expect(c.tabela("ai_agents")).toEqual([]);
  });

  it("endereço de rede interna, servidor novo sem `autenticacao` e chave estática sem chave são recusados com a frase que ensina", async () => {
    const c = await preparar();
    expect(
      await recusa(c, "plataforma_garantir_agente", { nome: "Bia", prompt: PROMPT, servidores_mcp: [{ ...PEDIDOS, endereco: "http://127.0.0.1:8080/mcp" }] }),
    ).toContain("recusado por segurança");
    expect(
      await recusa(c, "plataforma_garantir_agente", { nome: "Bia", prompt: PROMPT, servidores_mcp: [{ nome: "Pedidos", endereco: PEDIDOS.endereco }] }),
    ).toContain("informe `endereco` e `autenticacao`");
    expect(
      await recusa(c, "plataforma_garantir_agente", { nome: "Bia", prompt: PROMPT, servidores_mcp: [{ ...PEDIDOS, chave: undefined }] }),
    ).toContain("precisa de `chave`");
    expect(c.tabela("ai_agents")).toEqual([]);
    expect(servidores(c)).toEqual([]);
  });
});

describe("plataforma_garantir_agente · `servidores_mcp` com chave estática: liga, troca e tira pelo nome", () => {
  it("liga: o cadastro com a chave CIFRADA, as ferramentas no rascunho; a chave não volta, nem na leitura nem na trilha", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_garantir_agente", { nome: "Bia", prompt: PROMPT, servidores_mcp: [PEDIDOS] });

    const linha = servidores(c)[0]!;
    expect(linha).toMatchObject({ nome: "Pedidos", slug: "pedidos", modo_autenticacao: "chave_estatica", chave_last4: "4321", ativo: true });
    expect(linha.agent_id).toBe(c.tabela("ai_agents")[0]!.id);
    expect(linha.chave_encrypted).toBeTruthy();
    expect(JSON.stringify(linha)).not.toContain(CHAVE);
    expect(toolIds(c)).toEqual(
      expect.arrayContaining([`mcp_externo:${linha.id}:leitura:consultar_pedido`, `mcp_externo:${linha.id}:escrita:abrir_troca`]),
    );
    expect(r.dados.servidores_mcp).toMatchObject([{ nome: "Pedidos", desfecho: "criou", servidor: { host: "pedidos.example.com", chave: { configurada: true, termina_em: "4321" } } }]);
    expect(r.texto).not.toContain(CHAVE);
    // A auditoria da tela (com a FORMA) e a da execução do MCP (com os argumentos redigidos).
    expect(auditoria()).toContain("agent.mcp_servidor_salvo");
    expect(auditoria()).toContain("plataforma.mcp_executado");
    expect(auditoria()).not.toContain(CHAVE);
    expect(auditoria()).not.toContain("/mcp");

    const lido = await ok(c, "plataforma_ver_agentes", { agente: "Bia" });
    expect(lido.texto).not.toContain(CHAVE);
    const agente = (lido.dados.agentes as Linha[])[0]!;
    expect(agente.servidores_mcp).toMatchObject([
      {
        nome: "Pedidos",
        host: "pedidos.example.com",
        autenticacao: "chave_estatica",
        chave: { configurada: true, termina_em: "4321" },
        ferramentas: [
          { nome: "consultar_pedido", leitura: true },
          { nome: "abrir_troca", leitura: false },
        ],
      },
    ]);
    expect(lido.dados.servidores_mcp_por_agente).toEqual({ modulo_ligado: true });
  });

  it("o pedido repetido responde `ja_estava` e não escreve nada", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", { nome: "Bia", prompt: PROMPT, servidores_mcp: [PEDIDOS] });
    const antes = c.banco.escritas.length;
    const r = await ok(c, "plataforma_garantir_agente", { nome: "Bia", servidores_mcp: [PEDIDOS] });
    expect(r.dados).toMatchObject({ agente: { desfecho: "ja_estava" }, versao: { desfecho: "ja_estava" }, servidores_mcp: [{ desfecho: "ja_estava" }] });
    expect(c.banco.escritas.length).toBe(antes);
  });

  it("troca: só o que veio muda (a chave nova, as ferramentas); o servidor da EMPRESA não apaga as do servidor do agente", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", { nome: "Bia", prompt: PROMPT, servidores_mcp: [PEDIDOS] });
    const id = servidores(c)[0]!.id as string;

    const r = await ok(c, "plataforma_garantir_agente", { nome: "Bia", servidores_mcp: [{ nome: "pedidos", chave: "chave-ficticia-nova-8765" }] });
    expect(r.dados).toMatchObject({ agente: { desfecho: "atualizou" }, servidores_mcp: [{ desfecho: "atualizou", servidor: { chave: { termina_em: "8765" } } }] });
    expect(servidores(c)[0]).toMatchObject({ id, endpoint: PEDIDOS.endereco, chave_last4: "8765" });
    // As ferramentas não vieram: ficam como estavam.
    expect(toolIds(c)).toContain(`mcp_externo:${id}:escrita:abrir_troca`);

    await ok(c, "plataforma_garantir_agente", { nome: "Bia", servidores_mcp: [{ nome: "Pedidos", ferramentas: [{ nome: "consultar_pedido" }] }] });
    expect(toolIds(c).filter((t) => t.startsWith(`mcp_externo:${id}:`))).toEqual([`mcp_externo:${id}:leitura:consultar_pedido`]);

    // .81: a lista do servidor da empresa troca SÓ as dela.
    await ok(c, "plataforma_garantir_agente", { nome: "Bia", servidor_mcp_externo: { ferramentas: [{ nome: "consultar_estoque" }] } });
    expect(toolIds(c)).toEqual(expect.arrayContaining(["mcp_externo:leitura:consultar_estoque", `mcp_externo:${id}:leitura:consultar_pedido`]));
  });

  it("tira: `apagar: true` remove o servidor; repetir responde `ja_estava`", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", { nome: "Bia", prompt: PROMPT, servidores_mcp: [PEDIDOS] });
    const r = await ok(c, "plataforma_garantir_agente", { nome: "Bia", servidores_mcp: [{ nome: "Pedidos", apagar: true }] });
    expect(r.dados).toMatchObject({ servidores_mcp: [{ nome: "Pedidos", desfecho: "apagou" }] });
    expect(servidores(c)).toEqual([]);
    expect(auditoria()).toContain("agent.mcp_servidor_removido");

    const de_novo = await ok(c, "plataforma_garantir_agente", { nome: "Bia", servidores_mcp: [{ nome: "Pedidos", apagar: true }] });
    expect(de_novo.dados).toMatchObject({ agente: { desfecho: "ja_estava" }, servidores_mcp: [{ desfecho: "ja_estava" }] });
  });
});

describe("plataforma_garantir_agente · `servidores_mcp` com OAuth por contato: o passo humano volta como `com_o_humano`", () => {
  const OAUTH = { nome: "Conta do cliente", endereco: "https://conta.example.com/mcp", autenticacao: "oauth_por_contato", escopos: ["pedidos:ler"] };
  const SEGREDO = "segredo-ficticio-do-cliente-oauth";

  it("com registro automático: o cliente é registrado com o endereço de retorno DESTE servidor; a autorização de cada contato fica com o humano", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_garantir_agente", { nome: "Bia", prompt: PROMPT, servidores_mcp: [OAUTH] });
    const linha = servidores(c)[0]!;
    expect(linha).toMatchObject({ modo_autenticacao: "oauth_por_contato", oauth_client_id: "cliente-dinamico-ficticio", escopos_pedidos: ["pedidos:ler"] });
    expect(linha.oauth_client_secret_encrypted ?? null).toBeNull();
    expect(vi.mocked(registrarCliente).mock.calls[0]![1]).toMatchObject({ redirectUri: expect.stringContaining(`/api/v1/mcp-oauth/callback/${linha.id}`) });
    expect(r.dados.servidores_mcp).toMatchObject([{ desfecho: "criou", servidor: { oauth: { registro_automatico: true, client_secret: null } } }]);
    expect(r.dados.com_o_humano).toMatchObject([{ servidor: "Conta do cliente", quem: "cada contato, na conversa" }]);
  });

  it("sem registro automático: NADA é gravado e volta o registro à mão; a chamada com o client_id usa o MESMO endereço de retorno", async () => {
    estado.comRegistroAutomatico = false;
    const c = await preparar();
    const r = await ok(c, "plataforma_garantir_agente", { nome: "Bia", prompt: PROMPT, servidores_mcp: [OAUTH] });
    expect(servidores(c)).toEqual([]);
    expect(registrarCliente).not.toHaveBeenCalled();
    expect(r.dados.servidores_mcp).toMatchObject([{ nome: "Conta do cliente", desfecho: "com_o_humano", servidor: null }]);
    const passo = (r.dados.com_o_humano as Linha[])[0]!;
    expect(passo).toMatchObject({ quem: "uma pessoa da empresa" });
    const retorno = /https?:\/\/\S+\/api\/v1\/mcp-oauth\/callback\/[0-9a-f-]{36}/.exec(String(passo.como))![0];

    const r2 = await ok(c, "plataforma_garantir_agente", {
      nome: "Bia",
      servidores_mcp: [{ ...OAUTH, oauth_client_id: "cliente-registrado-a-mao", oauth_client_secret: SEGREDO }],
    });
    const linha = servidores(c)[0]!;
    expect(retorno).toBe(`${retorno.split("/api/")[0]}/api/v1/mcp-oauth/callback/${linha.id}`);
    expect(linha).toMatchObject({ oauth_client_id: "cliente-registrado-a-mao" });
    expect(linha.oauth_client_secret_encrypted).toBeTruthy();
    expect(r2.dados.servidores_mcp).toMatchObject([{ desfecho: "criou", servidor: { oauth: { client_id: "cliente-registrado-a-mao", client_secret: "configurado", endereco_de_retorno: retorno } } }]);
    expect(r2.texto).not.toContain(SEGREDO);
    expect(auditoria()).not.toContain(SEGREDO);
    expect((await ok(c, "plataforma_ver_agentes", { agente: "Bia" })).texto).not.toContain(SEGREDO);

    // O mesmo pedido de novo: nada muda.
    const r3 = await ok(c, "plataforma_garantir_agente", {
      nome: "Bia",
      servidores_mcp: [{ ...OAUTH, oauth_client_id: "cliente-registrado-a-mao", oauth_client_secret: SEGREDO }],
    });
    expect(r3.dados).toMatchObject({ servidores_mcp: [{ desfecho: "ja_estava" }] });
  });
});
