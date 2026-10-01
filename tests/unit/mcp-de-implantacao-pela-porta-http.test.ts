/**
 * FORK MIA — O MCP DE IMPLANTAÇÃO PELA PORTA DE VERDADE: `POST /api/mcp/plataforma`.
 *
 * Os outros testes falam com o servidor por um transporte em memória. Aqui o
 * pedido entra como o Claude Code o manda: HTTP, com o cabeçalho
 * `Authorization: Bearer dskp_...`, passando pela conferência do token e pelo
 * transporte de produção. É o que prova que a troca do servidor (do `McpServer`
 * para o `Server` de baixo nível, que deixou a validação e a recusa nas nossas
 * mãos) não mudou o que o cliente MCP recebe pela rede.
 *
 * O transporte é SEM SESSÃO: cada pedido cria um servidor novo. Então
 * `tools/list` e `tools/call` chegam a um servidor que não viu o `initialize`
 * daquele cliente, e têm de responder mesmo assim. É o caso medido aqui.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { cenarioDaImplantacao, ORG, TODAS_AS_OPERACOES } from "@/tests/helpers/implantacao-em-memoria";
import type { Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));

const { POST } = await import("@/app/api/mcp/plataforma/route");
const { hashDoToken } = await import("@/lib/mcp-plataforma/auth");

// Um token fictício, com a forma de um de verdade. Não abre nada em lugar nenhum.
const BEARER = "dskp_token-ficticio-de-teste";

function preparar(operacoes: string[] = TODAS_AS_OPERACOES) {
  const cenario = cenarioDaImplantacao();
  const token = (cenario.banco.tabela("platform_api_tokens") as Linha[])[0]!;
  Object.assign(token, { token_hash: hashDoToken(BEARER), operacoes, revoked_at: null, expires_at: null });
  estado.cliente = cenario.cliente;
  return { ...cenario, token };
}

async function pedir(corpo: unknown, autorizacao: string | null = `Bearer ${BEARER}`) {
  const resposta = await POST(
    new NextRequest("https://exemplo.invalid/api/mcp/plataforma", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(autorizacao ? { authorization: autorizacao } : {}),
      },
      body: JSON.stringify(corpo),
    }),
  );
  const texto = await resposta.text();
  // O transporte responde em JSON ou em fluxo de eventos (`data: {...}`).
  const bruto = texto.trimStart().startsWith("{")
    ? texto
    : (texto.split("\n").find((l) => l.startsWith("data:")) ?? "data: {}").slice(5);
  return { status: resposta.status, json: JSON.parse(bruto) as Record<string, unknown> };
}

const chamar = (nome: string, args: Record<string, unknown>) =>
  pedir({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: nome, arguments: args } });

beforeEach(() => {
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
});

describe("a porta HTTP do MCP de plataforma", () => {
  it("sem o cabeçalho, ou com token de CLIENTE, a porta não abre e diz por quê", async () => {
    preparar();
    const sem = await pedir({ jsonrpc: "2.0", id: 1, method: "tools/list" }, null);
    expect(sem.status).toBe(401);
    expect(JSON.stringify(sem.json)).toContain("Falta o cabeçalho Authorization");

    const deCliente = await pedir({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "Bearer dsk_token-de-cliente-ficticio");
    expect(deCliente.status).toBe(401);
    expect(JSON.stringify(deCliente.json)).toContain("token de PLATAFORMA");
    // A recusa aponta a porta certa do token de cliente.
    expect(JSON.stringify(deCliente.json)).toContain("/api/mcp.");

    const desconhecido = await pedir({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "Bearer dskp_outro-token-ficticio");
    expect(desconhecido.status).toBe(401);
  });

  it("`initialize` apresenta o servidor, com a capacidade de ferramentas", async () => {
    preparar();
    const r = await pedir({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "teste", version: "0" } },
    });
    expect(r.status).toBe(200);
    const resultado = r.json.result as { serverInfo: { name: string }; capabilities: { tools?: unknown } };
    expect(resultado.serverInfo.name).toBe("mia-plataforma");
    expect(resultado.capabilities.tools).toBeDefined();
  });

  it("`tools/list` devolve as ferramentas com o esquema dos argumentos, num pedido sem `initialize` antes", async () => {
    preparar();
    const r = await pedir({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(r.status).toBe(200);
    const ferramentas = (r.json.result as { tools: Array<{ name: string; description: string; inputSchema: { type: string; properties: Record<string, unknown>; additionalProperties?: boolean } }> }).tools;
    const nomes = ferramentas.map((f) => f.name);
    expect(nomes).toEqual(expect.arrayContaining(["plataforma_ver_implantacao", "plataforma_garantir_funil", "plataforma_garantir_agente", "plataforma_publicar_agente"]));
    const funil = ferramentas.find((f) => f.name === "plataforma_garantir_funil")!;
    expect(funil.inputSchema.type).toBe("object");
    expect(Object.keys(funil.inputSchema.properties)).toEqual(expect.arrayContaining(["organization_id", "nome", "etapas"]));
    // O esquema diz ao cliente que campo desconhecido não passa.
    expect(funil.inputSchema.additionalProperties).toBe(false);
    expect(funil.description).toContain('Exige que o token carregue a operação "implantar_configuracao"');
  });

  it("⭐ uma escrita entra pela porta, grava no banco, e a leitura seguinte a enxerga", async () => {
    const { banco } = preparar();
    const escrita = await chamar("plataforma_garantir_etiquetas", { organization_id: ORG, etiquetas: [{ nome: "Indicação", cor: "#0091ff" }] });
    expect(escrita.status).toBe(200);
    const resultado = escrita.json.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(resultado.isError, resultado.content[0]!.text).not.toBe(true);
    expect(JSON.parse(resultado.content[0]!.text)).toMatchObject({ criadas: 1 });
    expect(((banco.tabela("organizations") as Linha[])[0]!.settings as { tags: unknown[] }).tags).toEqual([{ tag: "Indicação", cor: "#0091ff" }]);

    const leitura = await chamar("plataforma_ver_configuracao", { organization_id: ORG, secoes: ["etiquetas"] });
    const lido = leitura.json.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(lido.isError).not.toBe(true);
    expect(lido.content[0]!.text).toContain("Indicação");
  });

  it("⭐ token SEM a operação: a escrita é recusada pela porta, dizendo qual operação pedir, e nada é gravado", async () => {
    const { banco } = preparar([]);
    const r = await chamar("plataforma_garantir_etiquetas", { organization_id: ORG, etiquetas: [{ nome: "Indicação" }] });
    const resultado = r.json.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(resultado.isError).toBe(true);
    expect(resultado.content[0]!.text).toContain('não tem a operação "implantar_configuracao"');
    expect(banco.escritas.filter((e) => e.tabela === "organizations")).toEqual([]);
    // E a leitura continua livre para o mesmo token.
    const leitura = await chamar("plataforma_ver_implantacao", { organization_id: ORG });
    expect((leitura.json.result as { isError?: boolean }).isError).not.toBe(true);
  });

  it("pedido malformado volta como recusa que ensina, e não como erro de protocolo", async () => {
    preparar();
    const r = await chamar("plataforma_garantir_etiquetas", { organization_id: ORG, etiqueta: [{ nome: "x" }] });
    expect(r.status).toBe(200);
    const resultado = r.json.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(resultado.isError).toBe(true);
    expect(resultado.content[0]!.text).toContain("Campo desconhecido: `etiqueta`");
    expect(resultado.content[0]!.text).toContain("Exemplo");
  });
});
