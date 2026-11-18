/**
 * FORK MIA — AS NOVIDADES DO UPSTREAM 1.117 AO ALCANCE DO MCP DE PLATAFORMA
 * (MIA-67: o que ficou na lista "Falta no MCP" da fusão de 18/11, MIA-62).
 *
 * O molde é o de `mcp-de-implantacao-novidades-do-upstream-1116.test.ts`: um
 * bloco por novidade, e o que se mede é o BANCO, não a resposta.
 *
 *   - `crm_count_leads` (o MCP da empresa): a capacidade entra no agente pelo
 *     pacote "reter", e `plataforma_contar_negocios` conta pela MESMA porta
 *     (`countLeadsHandler`);
 *   - o token de integração nas rotas de leads e de propostas: o MCP de
 *     plataforma não passa por rota nenhuma delas, só pelos handlers;
 *   - o OAuth do MCP (9390): `plataforma_ver_conexoes_do_mcp` e
 *     `plataforma_revogar_conexao_do_mcp`, com a operação própria.
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia e nomes inventados.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTOR,
  cenarioDaImplantacao,
  clienteMcp,
  FUNIL_SEMEADO,
  ORG,
  OUTRA_ORG,
  TODAS_AS_OPERACOES,
} from "@/tests/helpers/implantacao-em-memoria";
import type { Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
vi.mock("@/lib/ai/embeddings/chave", () => ({ temChaveDeEmbedding: vi.fn(async () => true) }));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { FERRAMENTA_POR_NOME } = await import("@/lib/mcp-plataforma/ferramentas");
const { operacaoPorChave } = await import("@/lib/mcp-plataforma/operacoes");
const { catalogoServido, montarCapacidades } = await import("@/lib/implantacao/capacidades");
const { audit } = await import("@/lib/audit");

async function preparar(operacoes: string[] = TODAS_AS_OPERACOES) {
  const cenario = cenarioDaImplantacao();
  estado.cliente = cenario.cliente;
  const mcp = await clienteMcp(criarServidorDePlataforma as never, operacoes);
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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
});

// ---------------------------------------------------------------------------

describe("crm_count_leads (upstream 1.117) · a capacidade do agente", () => {
  it("está no catálogo da instalação, é de leitura e entra pelo pacote \"reter\"", () => {
    const contar = catalogoServido().find((c) => c.id === "crm_count_leads");
    expect(contar, "crm_count_leads sumiu do catálogo servido").toBeDefined();
    expect(contar!.pacotes).toContain("reter");
    expect(contar!.risco).toBe("seguro");
    expect(montarCapacidades(catalogoServido(), { pacotes: ["reter"] }).tool_ids).toContain("crm_count_leads");
  });

  it("plataforma_listar_modelos ensina a capacidade dentro do pacote \"reter\"", async () => {
    const c = await preparar();
    const r = await c.mcp.chamar("plataforma_listar_modelos", { secoes: ["capacidades_do_agente"] });
    expect(r.erro, r.texto).toBe(false);
    const pacotes = (r.dados.capacidades_do_agente as { pacotes: Array<{ id: string; capacidades: Array<{ id: string; entra_pelo_pacote: boolean }> }> }).pacotes;
    const reter = pacotes.find((p) => p.id === "reter")!;
    expect(reter.capacidades.find((x) => x.id === "crm_count_leads")).toMatchObject({ entra_pelo_pacote: true });
  });

  it("plataforma_garantir_agente com o pacote \"reter\" grava a capacidade no rascunho", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", {
      nome: "Bia",
      prompt: "Você é a Bia, atendente da Clínica Exemplo. Entenda o que a pessoa procura antes de oferecer um horário.",
      pacotes: ["reter"],
    });
    const versao = c.tabela("ai_agent_versions")[0]!;
    expect(versao.status).toBe("draft");
    expect(versao.tool_ids as string[]).toContain("crm_count_leads");
  });
});

// ---------------------------------------------------------------------------

describe("plataforma_contar_negocios · FERRAMENTA NOVA (a porta do crm_count_leads)", () => {
  const ETAPA_PAGO = "0d000000-0000-4000-8000-000000000103";

  function semear(c: Cenario) {
    const etapas = c.tabela("crm_stages").filter((e) => e.pipeline_id === FUNIL_SEMEADO);
    const carrinho = etapas.find((e) => e.slug === "carrinho_abandonado")!.id as string;
    const pago = etapas.find((e) => e.slug === "pago")!.id as string;
    const negocio = (stage_id: string, status: string, org = ORG) => ({
      organization_id: org,
      pipeline_id: FUNIL_SEMEADO,
      stage_id,
      status,
      contact_id: null,
      title: "Negócio fictício",
    });
    c.tabela("crm_leads").push(
      negocio(carrinho, "open"),
      negocio(carrinho, "open"),
      negocio(carrinho, "lost"),
      negocio(pago, "won"),
      // De outra empresa: nunca entra na conta.
      negocio(carrinho, "open", OUTRA_ORG),
    );
    return { carrinho, pago };
  }

  it("⭐ sem filtro: o total e o total por situação, só da empresa pedida, sem escrever nada", async () => {
    const c = await preparar();
    semear(c);
    const antes = c.banco.escritas.length;
    const r = await ok(c, "plataforma_contar_negocios", {});
    expect(r.dados).toMatchObject({ total: 4, por_situacao: { aberto: 2, ganho: 1, perdido: 1 } });
    expect(c.banco.escritas.length).toBe(antes);
    // Só números: nenhum título de negócio sai daqui.
    expect(r.texto).not.toContain("Negócio fictício");
  });

  it("filtra por funil e etapa pelo NOME, e por situação", async () => {
    const c = await preparar();
    const { carrinho } = semear(c);
    const r = await ok(c, "plataforma_contar_negocios", { funil: "Pedidos", etapa: "Carrinho abandonado", situacao: "aberto" });
    expect(r.dados).toMatchObject({
      total: 2,
      filtros: { funil: { id: FUNIL_SEMEADO, nome: "Pedidos" }, etapa: { id: carrinho, nome: "Carrinho abandonado" }, situacao: "aberto" },
    });
    // Com situação, não há o "por situação".
    expect(r.dados).not.toHaveProperty("por_situacao");
    expect((await ok(c, "plataforma_contar_negocios", { etapa: "Pago" })).dados).toMatchObject({ total: 1 });
  });

  it("funil ou etapa que não existe é recusado com o que existe", async () => {
    const c = await preparar();
    semear(c);
    expect(await recusa(c, "plataforma_contar_negocios", { funil: "Funil que não existe" })).toContain("«Pedidos»");
    expect(await recusa(c, "plataforma_contar_negocios", { funil: "Pedidos", etapa: ETAPA_PAGO })).toContain("plataforma_ver_funis");
  });

  it("é leitura livre: o token sem operação nenhuma conta", async () => {
    const c = await preparar([]);
    semear(c);
    expect((await ok(c, "plataforma_contar_negocios", {})).dados).toMatchObject({ total: 4 });
    expect(FERRAMENTA_POR_NOME.get("plataforma_contar_negocios")!.operacao).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("o token de integração nas rotas de leads e de propostas (upstream 1.117)", () => {
  // A 1.117 trocou `requireRole` por `resolveAuthDual` nessas rotas. O MCP de plataforma
  // não passa por nenhuma delas: chama os handlers compartilhados (`_handler.ts`), que
  // ganharam o filtro de organização e o `actorApiTokenId` na trilha. Se um arquivo do
  // MCP passar a importar uma ROTA dessas, a autenticação dela entra no caminho e esta
  // cerca avisa.
  function arquivos(pasta: string): string[] {
    return readdirSync(pasta).flatMap((nome) => {
      const caminho = join(pasta, nome);
      return statSync(caminho).isDirectory() ? arquivos(caminho) : caminho.endsWith(".ts") ? [caminho] : [];
    });
  }

  it("nenhum arquivo do MCP de plataforma importa uma rota de leads ou de propostas", () => {
    const rotas = arquivos(join(process.cwd(), "lib", "mcp-plataforma")).filter((f) =>
      /from "@\/app\/api\/v1\/(leads|proposals)\/(?!_handler")[^"]*"/.test(readFileSync(f, "utf8")),
    );
    expect(rotas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("as conexões OAuth do MCP da empresa (upstream 1.117, 9390) · FERRAMENTAS NOVAS", () => {
  const APLICATIVO = "0f000000-0000-4000-8000-0000000000a1";
  const CONEXAO = "0f000000-0000-4000-8000-0000000000c1";
  const TOKEN_DA_CONEXAO = "0f000000-0000-4000-8000-0000000000d1";
  const CONEXAO_REVOGADA = "0f000000-0000-4000-8000-0000000000c2";
  const TOKEN_REVOGADO = "0f000000-0000-4000-8000-0000000000d2";
  const TOKEN_A_MAO = "0f000000-0000-4000-8000-0000000000d3";

  function semear(c: Cenario) {
    c.tabela("mcp_oauth_clientes").push({
      id: APLICATIVO,
      client_id: "dcc_" + "a".repeat(32),
      nome: "Aplicativo de IA Exemplo",
      redirect_uris: ["https://aplicativo.exemplo.invalid/conector/retorno"],
    });
    c.tabela("api_tokens").push(
      {
        id: TOKEN_DA_CONEXAO,
        organization_id: ORG,
        name: "Aplicativo de IA Exemplo",
        scopes: ["mcp:read", "mcp:write", "role:admin", "aud:mcp"],
        last_used_at: "2026-11-18T10:00:00Z",
        expires_at: "2099-01-01T00:00:00Z",
        revoked_at: null,
      },
      {
        id: TOKEN_REVOGADO,
        organization_id: ORG,
        name: "Aplicativo de IA Exemplo",
        scopes: ["mcp:read", "role:admin", "aud:mcp"],
        last_used_at: null,
        expires_at: "2099-01-01T00:00:00Z",
        revoked_at: "2026-11-10T00:00:00Z",
      },
      // O token colado à mão, da tela de API Tokens: nunca aparece nem é revogado por aqui.
      { id: TOKEN_A_MAO, organization_id: ORG, name: "Integração da loja", scopes: ["leads:read"], last_used_at: null, expires_at: null, revoked_at: null },
    );
    c.tabela("mcp_oauth_concessoes").push(
      {
        id: CONEXAO,
        organization_id: ORG,
        cliente_id: APLICATIVO,
        user_id: AUTOR,
        api_token_id: TOKEN_DA_CONEXAO,
        escopos: ["mcp:read", "mcp:write"],
        refresh_expira_em: "2099-01-01T00:00:00Z",
        renovada_em: "2026-11-18T09:00:00Z",
        revogada_em: null,
        created_at: "2026-11-17T12:00:00Z",
      },
      {
        id: CONEXAO_REVOGADA,
        organization_id: ORG,
        cliente_id: APLICATIVO,
        user_id: AUTOR,
        api_token_id: TOKEN_REVOGADO,
        escopos: ["mcp:read"],
        refresh_expira_em: "2099-01-01T00:00:00Z",
        renovada_em: null,
        // Revogada na tela de API Tokens: a concessão só é marcada na renovação seguinte.
        revogada_em: null,
        created_at: "2026-11-01T12:00:00Z",
      },
    );
  }

  it("⭐ a leitura mostra a conexão ativa com o aplicativo, o acesso e quem autorizou, sem nada do token", async () => {
    const c = await preparar([]);
    semear(c);
    const r = await ok(c, "plataforma_ver_conexoes_do_mcp", {});
    const conexoes = r.dados.conexoes as Linha[];
    expect(conexoes).toHaveLength(1);
    expect(conexoes[0]).toMatchObject({
      conexao_id: CONEXAO,
      aplicativo: "Aplicativo de IA Exemplo",
      endereco_de_retorno: "aplicativo.exemplo.invalid",
      situacao: "ativa",
      acesso: "ler_e_alterar",
      papel_no_crm: "admin",
      autorizada_por: { user_id: AUTOR, nome: "Pessoa Implantadora" },
      nome_na_tela_de_tokens: "Aplicativo de IA Exemplo",
      ultimo_uso_em: "2026-11-18T10:00:00Z",
    });
    expect(r.dados.ativas).toBe(1);
    expect(r.texto).not.toContain("Integração da loja");
    expect(r.texto).not.toMatch(/token_hash|refresh_hash|prefix/);
  });

  it("com `incluir_revogadas`, a revogada na tela aparece como revogada", async () => {
    const c = await preparar([]);
    semear(c);
    const conexoes = (await ok(c, "plataforma_ver_conexoes_do_mcp", { incluir_revogadas: true })).dados.conexoes as Linha[];
    expect(conexoes.map((x) => [x.conexao_id, x.situacao])).toEqual([
      [CONEXAO, "ativa"],
      [CONEXAO_REVOGADA, "revogada"],
    ]);
    expect(conexoes[1]).toMatchObject({ acesso: "ler", revogada_em: "2026-11-10T00:00:00Z" });
  });

  it("empresa sem conexão: lista vazia e o aviso de como se conecta", async () => {
    const c = await preparar([]);
    const r = await ok(c, "plataforma_ver_conexoes_do_mcp", {});
    expect(r.dados.conexoes).toEqual([]);
    expect(String(r.dados.aviso)).toContain("/api/mcp");
  });

  it("⭐ revogar marca o token e a concessão, grava a trilha da tela, e a segunda chamada não escreve", async () => {
    const c = await preparar();
    semear(c);
    const r = await ok(c, "plataforma_revogar_conexao_do_mcp", { conexao_id: CONEXAO });
    expect(r.dados).toMatchObject({ desfecho: "revogou", conexao: { conexao_id: CONEXAO, situacao: "revogada" } });

    const token = c.tabela("api_tokens").find((t) => t.id === TOKEN_DA_CONEXAO)!;
    expect(token.revoked_at).toEqual(expect.any(String));
    expect(token.revoked_by).toBe(AUTOR);
    expect(c.tabela("mcp_oauth_concessoes").find((x) => x.id === CONEXAO)!.revogada_em).toBe(token.revoked_at);
    // O token à mão ficou como estava.
    expect(c.tabela("api_tokens").find((t) => t.id === TOKEN_A_MAO)!.revoked_at).toBeNull();
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "token.revoked", organizationId: ORG, resourceType: "api_token", resourceId: TOKEN_DA_CONEXAO }),
    );

    const antes = c.banco.escritas.length;
    const de_novo = await ok(c, "plataforma_revogar_conexao_do_mcp", { conexao_id: CONEXAO });
    expect(de_novo.dados).toMatchObject({ desfecho: "ja_estava" });
    expect(c.banco.escritas.length).toBe(antes);
    // A revogada na tela também responde `ja_estava`, sem escrever.
    expect((await ok(c, "plataforma_revogar_conexao_do_mcp", { conexao_id: CONEXAO_REVOGADA })).dados).toMatchObject({ desfecho: "ja_estava" });
    expect(c.banco.escritas.length).toBe(antes);
  });

  it("conexão de outra empresa, ou que não existe, é recusada sem escrever e ensina onde achar o id", async () => {
    const c = await preparar();
    semear(c);
    c.tabela("mcp_oauth_concessoes").find((x) => x.id === CONEXAO)!.organization_id = OUTRA_ORG;
    const antes = c.banco.escritas.length;
    expect(await recusa(c, "plataforma_revogar_conexao_do_mcp", { conexao_id: CONEXAO })).toContain("plataforma_ver_conexoes_do_mcp");
    expect(c.banco.escritas.length).toBe(antes);
    expect(c.tabela("api_tokens").find((t) => t.id === TOKEN_DA_CONEXAO)!.revoked_at).toBeNull();
  });

  it("a concessão que aponta para um token sem a marca `aud:mcp` não revoga nada", async () => {
    const c = await preparar();
    semear(c);
    c.tabela("mcp_oauth_concessoes").find((x) => x.id === CONEXAO)!.api_token_id = TOKEN_A_MAO;
    const antes = c.banco.escritas.length;
    expect(await recusa(c, "plataforma_revogar_conexao_do_mcp", { conexao_id: CONEXAO })).toContain("API Tokens");
    expect(c.banco.escritas.length).toBe(antes);
  });

  it("revogar exige a operação própria, com o raio escrito; ver é leitura livre", async () => {
    expect(FERRAMENTA_POR_NOME.get("plataforma_ver_conexoes_do_mcp")!.operacao).toBeNull();
    expect(FERRAMENTA_POR_NOME.get("plataforma_revogar_conexao_do_mcp")!.operacao).toBe("revogar_conexao_do_mcp");
    expect(operacaoPorChave("revogar_conexao_do_mcp")!.raio).toMatch(/QUALQUER cliente/);

    const c = await preparar(TODAS_AS_OPERACOES.filter((o) => o !== "revogar_conexao_do_mcp"));
    semear(c);
    expect(await recusa(c, "plataforma_revogar_conexao_do_mcp", { conexao_id: CONEXAO })).toContain('"revogar_conexao_do_mcp"');
    expect(c.tabela("api_tokens").find((t) => t.id === TOKEN_DA_CONEXAO)!.revoked_at).toBeNull();
  });
});
