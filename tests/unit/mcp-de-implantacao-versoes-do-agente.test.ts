/**
 * FORK MIA (MIA-358) — `plataforma_ver_versoes_do_agente` e
 * `plataforma_reverter_agente`, pelo protocolo, contra tabelas em memória.
 *
 * O que se mede é o banco: a versão nova copiada e publicada, o ponteiro do
 * agente, a trilha (`ai_agent.reverted` com a versão de antes e a de depois) e,
 * na reexecução e nas recusas, que nada foi gravado.
 *
 * A Academia Alfa e a Academia Beta são fictícias. O token de plataforma não é
 * de uma empresa: "o token da Alfa" é a chamada com `organization_id` da Alfa,
 * e o agente da Beta não pode ser alcançado por ela.
 */
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTOR,
  cenarioDaImplantacao,
  clienteMcp,
  NUMERO,
  ORG,
  OUTRA_ORG,
  TODAS_AS_OPERACOES,
} from "@/tests/helpers/implantacao-em-memoria";
import type { Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({ trilha: [] as Array<Record<string, unknown>>, cliente: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
// A auditoria vai para a tabela em memória: é de lá que a leitura tira "quem publicou".
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (e: Record<string, unknown>) => {
    estado.trilha.push({
      id: randomUUID(),
      organization_id: e.organizationId ?? null,
      actor_user_id: e.actorUserId ?? null,
      actor_api_token_id: e.actorApiTokenId ?? null,
      action: e.action,
      resource_type: e.resourceType ?? null,
      resource_id: e.resourceId ?? null,
      request_id: e.requestId ?? null,
      metadata: e.metadata ?? {},
      created_at: new Date(Date.now() + estado.trilha.length).toISOString(),
    });
  }),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
vi.mock("@/lib/ai/embeddings/chave", () => ({ temChaveDeEmbedding: vi.fn(async () => true) }));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { audit } = await import("@/lib/audit");

const PROMPT = "Você é o Leo, atendente da Academia Alfa. Entenda o objetivo da pessoa antes de oferecer um plano.";
const AGENTE_DA_BETA = "0f000000-0000-4000-8000-0000000000b1";

beforeEach(() => {
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
  estado.trilha = [];
  vi.mocked(audit).mockClear();
});

async function preparar() {
  const cenario = cenarioDaImplantacao({ comNumero: true });
  const tabela = (nome: string) => cenario.banco.tabela(nome) as Linha[];
  tabela("organizations")[0]!.display_name = "Academia Alfa";
  // A Academia Beta, com um agente no ar, para provar que a Alfa não a alcança.
  tabela("organizations").push({ ...tabela("organizations")[0]!, id: OUTRA_ORG, display_name: "Academia Beta", slug: "academia-beta" });
  tabela("ai_agents").push({
    id: AGENTE_DA_BETA,
    organization_id: OUTRA_ORG,
    name: "Leo",
    kind: "mcp_agent",
    priority: 0,
    is_active: true,
    is_default: false,
    published_version_id: null,
    paused_at: null,
    archived_at: null,
    config: {},
    created_at: "2026-01-01T00:00:00Z",
  });
  // A trilha é a tabela que o mock da auditoria alimenta.
  const trilha = tabela("api_audit_log");
  estado.trilha = trilha as Array<Record<string, unknown>>;
  estado.cliente = cenario.cliente;
  const mcp = await clienteMcp(criarServidorDePlataforma as never, TODAS_AS_OPERACOES);
  const versoes = () =>
    tabela("ai_agent_versions")
      .filter((v) => v.organization_id === ORG)
      .sort((a, b) => Number(a.version_number) - Number(b.version_number));
  return { ...cenario, mcp, tabela, versoes };
}

/** O Leo da Alfa com a v1, a v2 e a v3 publicadas uma depois da outra (a v3 no ar). */
async function comTresVersoes() {
  const c = await preparar();
  for (const sufixo of ["", " Seja breve.", " Ofereça sempre o plano anual."]) {
    const r = await c.mcp.chamar("plataforma_garantir_agente", { organization_id: ORG, nome: "Leo", prompt: `${PROMPT}${sufixo}`, pacotes: ["vender"] });
    expect(r.erro, r.texto).toBe(false);
    const p = await c.mcp.chamar("plataforma_publicar_agente", { organization_id: ORG, agente: "Leo" });
    expect(p.erro, p.texto).toBe(false);
  }
  expect(c.versoes().map((v) => [v.version_number, v.status])).toEqual([
    [1, "superseded"],
    [2, "superseded"],
    [3, "published"],
  ]);
  return c;
}

describe("plataforma_ver_versoes_do_agente", () => {
  it("lista as versões com número, situação, quando e quem publicou, sem o prompt inteiro", async () => {
    const { mcp } = await comTresVersoes();
    // Um rascunho novo (v4), para a situação `rascunho` aparecer.
    await mcp.chamar("plataforma_garantir_agente", { organization_id: ORG, nome: "Leo", prompt: `${PROMPT} Rascunho.` });

    const r = await mcp.chamar("plataforma_ver_versoes_do_agente", { organization_id: ORG, agente: "Leo" });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados).toMatchObject({ agente: { nome: "Leo", pausado: false }, versao_publicada: 3, total_de_versoes: 4 });
    const lista = r.dados.versoes as Array<Record<string, unknown>>;
    expect(lista.map((v) => [v.numero, v.situacao])).toEqual([
      [4, "rascunho"],
      [3, "publicada"],
      [2, "antiga"],
      [1, "antiga"],
    ]);
    const v3 = lista.find((v) => v.numero === 3)!;
    expect(v3.publicada_em).toBeTruthy();
    expect(v3.publicada_por).toMatchObject({ por: "mcp_de_plataforma", pessoa: { id: AUTOR, email: "implantador@exemplo.invalid" } });
    expect(v3.diferente_da_publicada).toBeNull();
    expect(lista.find((v) => v.numero === 2)!.diferente_da_publicada).toEqual(["prompt"]);
    // O rascunho nunca foi publicado.
    expect(lista.find((v) => v.numero === 4)!.publicada_por).toBeNull();
    // Sem o prompt na lista: só o tamanho.
    expect(r.texto).not.toContain("Ofereça sempre o plano anual");
    expect(v3.tamanho_do_prompt).toBe(`${PROMPT} Ofereça sempre o plano anual.`.length);
  });

  it("`limite` corta nas mais novas e avisa quantas há", async () => {
    const { mcp } = await comTresVersoes();
    const r = await mcp.chamar("plataforma_ver_versoes_do_agente", { organization_id: ORG, agente: "Leo", limite: 2 });
    expect((r.dados.versoes as Array<{ numero: number }>).map((v) => v.numero)).toEqual([3, 2]);
    expect((r.dados.avisos as string[]).join(" ")).toContain("Mostrando as 2 versões mais novas de 3");
  });

  it("o agente da Academia Beta não é alcançado pela Alfa", async () => {
    const { mcp } = await comTresVersoes();
    const r = await mcp.chamar("plataforma_ver_versoes_do_agente", { organization_id: ORG, agente: AGENTE_DA_BETA });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain(`Não achei o agente «${AGENTE_DA_BETA}» nesta organização`);
  });
});

describe("plataforma_reverter_agente", () => {
  it("a Academia Alfa volta da v3 para a v2: versão nova (v4) com o conteúdo da v2, publicada, e a trilha com a de antes e a de depois", async () => {
    const { mcp, tabela, versoes } = await comTresVersoes();
    const [v1, v2, v3] = versoes();
    vi.mocked(audit).mockClear();

    const r = await mcp.chamar("plataforma_reverter_agente", { organization_id: ORG, agente: "Leo", para_versao: 2 });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados).toMatchObject({
      agente: { nome: "Leo" },
      desfecho: "reverteu",
      copiada_da_versao: 2,
      versao_publicada: { numero: 4 },
      versao_anterior: { id: v3!.id, numero: 3 },
      mudancas: ["prompt"],
    });

    const depois = versoes();
    expect(depois.map((v) => [v.version_number, v.status])).toEqual([
      [1, "superseded"],
      [2, "superseded"],
      [3, "superseded"],
      [4, "published"],
    ]);
    const v4 = depois[3]!;
    expect(v4).toMatchObject({ system_prompt: v2!.system_prompt, tool_ids: v2!.tool_ids, channel_session_id: NUMERO, created_by: AUTOR });
    // A IA da cópia é a atual do agente (a da plataforma), não a da versão antiga.
    expect(v4).toMatchObject({ provider: "openai", model: "modelo-da-plataforma" });
    expect(tabela("ai_agents").find((a) => a.organization_id === ORG)!.published_version_id).toBe(v4.id);
    expect((r.dados.versao_publicada as { id: string }).id).toBe(v4.id);
    expect(v1!.status).toBe("superseded");

    // A auditoria: quem criou o token, pelo MCP de plataforma, com a versão de antes e a de depois.
    const revertido = (vi.mocked(audit).mock.calls as unknown as Array<[Record<string, unknown>]>)
      .map(([e]) => e)
      .find((e) => e.action === "ai_agent.reverted");
    expect(revertido).toMatchObject({
      actorUserId: AUTOR,
      actorApiTokenId: null,
      organizationId: ORG,
      resourceType: "ai_agent",
      metadata: { from_version_id: v2!.id, new_version_id: v4.id, previous_version_id: v3!.id, via: "mcp_plataforma" },
    });

    // E a leitura diz que a v4 é cópia da v2, publicada pelo MCP de plataforma.
    const lida = await mcp.chamar("plataforma_ver_versoes_do_agente", { organization_id: ORG, agente: "Leo" });
    const v4lida = (lida.dados.versoes as Array<Record<string, unknown>>).find((v) => v.numero === 4)!;
    expect(v4lida).toMatchObject({ situacao: "publicada", copia_da_versao: 2, publicada_por: { por: "mcp_de_plataforma" } });
  });

  it("REEXECUÇÃO: voltar de novo para a v2 responde `ja_estava` e não grava nada", async () => {
    const { mcp, banco, versoes } = await comTresVersoes();
    await mcp.chamar("plataforma_reverter_agente", { organization_id: ORG, agente: "Leo", para_versao: 2 });
    const antes = banco.escritas.length;
    const r = await mcp.chamar("plataforma_reverter_agente", { organization_id: ORG, agente: "Leo", para_versao: 2 });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados).toMatchObject({ desfecho: "ja_estava", copiada_da_versao: 2, versao_publicada: { numero: 4 }, mudancas: [] });
    expect(versoes()).toHaveLength(4);
    // A trilha da própria chamada (`plataforma.mcp_executado`) não conta: o que se mede são o agente e as versões.
    const noAgente = banco.escritas.slice(antes).filter((e) => e.tabela === "ai_agents" || e.tabela === "ai_agent_versions");
    expect(noAgente, "a reexecução escreveu no agente").toEqual([]);
  });

  it("o agente da Academia Beta pedido com a organização da Alfa é recusado, sem gravar nada", async () => {
    const { mcp, tabela, versoes } = await comTresVersoes();
    const r = await mcp.chamar("plataforma_reverter_agente", { organization_id: ORG, agente: AGENTE_DA_BETA, para_versao: 1 });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain(`Não achei o agente «${AGENTE_DA_BETA}» nesta organização`);
    expect(r.texto).toContain("«Leo»");
    expect(versoes()).toHaveLength(3);
    expect(tabela("ai_agent_versions").filter((v) => v.organization_id === OUTRA_ORG)).toHaveLength(0);
  });

  it("versão que não existe é recusada dizendo quais existem", async () => {
    const { mcp, versoes, tabela } = await comTresVersoes();
    const publicada = tabela("ai_agents").find((a) => a.organization_id === ORG)!.published_version_id;
    const r = await mcp.chamar("plataforma_reverter_agente", { organization_id: ORG, agente: "Leo", para_versao: 9 });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("não tem a versão 9");
    expect(r.texto).toContain("v3, v2, v1");
    expect(r.texto).toContain("plataforma_ver_versoes_do_agente");
    expect(versoes()).toHaveLength(3);
    expect(tabela("ai_agents").find((a) => a.organization_id === ORG)!.published_version_id).toBe(publicada);
  });

  it("rascunho não é versão anterior: recusa que manda publicar pelo caminho certo", async () => {
    const { mcp, versoes } = await comTresVersoes();
    await mcp.chamar("plataforma_garantir_agente", { organization_id: ORG, nome: "Leo", prompt: `${PROMPT} Rascunho.` });
    const r = await mcp.chamar("plataforma_reverter_agente", { organization_id: ORG, agente: "Leo", para_versao: 4 });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("é um RASCUNHO");
    expect(r.texto).toContain("plataforma_publicar_agente");
    expect(versoes()).toHaveLength(4);
  });

  it("com um rascunho aberto, volta e avisa que o rascunho ficou para trás", async () => {
    const { mcp } = await comTresVersoes();
    await mcp.chamar("plataforma_garantir_agente", { organization_id: ORG, nome: "Leo", prompt: `${PROMPT} Rascunho.` });
    const r = await mcp.chamar("plataforma_reverter_agente", { organization_id: ORG, agente: "Leo", para_versao: 1 });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados).toMatchObject({ desfecho: "reverteu", versao_publicada: { numero: 5 } });
    expect((r.dados.avisos as string[]).join(" ")).toContain("O rascunho v4");
  });

  it("agente sem versão publicada: não há o que desfazer", async () => {
    const { mcp, versoes } = await preparar();
    await mcp.chamar("plataforma_garantir_agente", { organization_id: ORG, nome: "Leo", prompt: PROMPT, pacotes: ["vender"] });
    const r = await mcp.chamar("plataforma_reverter_agente", { organization_id: ORG, agente: "Leo", para_versao: 1 });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("não tem versão publicada");
    expect(versoes()).toHaveLength(1);
  });

  it("token sem `colocar_no_ar` não reverte; ver as versões é leitura livre", async () => {
    const c = await comTresVersoes();
    const soMonta = await clienteMcp(criarServidorDePlataforma as never, ["implantar_configuracao"]);
    const r = await soMonta.chamar("plataforma_reverter_agente", { organization_id: ORG, agente: "Leo", para_versao: 2 });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("colocar_no_ar");
    expect(c.versoes()).toHaveLength(3);
    const semNada = await clienteMcp(criarServidorDePlataforma as never, []);
    const lida = await semNada.chamar("plataforma_ver_versoes_do_agente", { organization_id: ORG, agente: "Leo" });
    expect(lida.erro, lida.texto).toBe(false);
  });
});
