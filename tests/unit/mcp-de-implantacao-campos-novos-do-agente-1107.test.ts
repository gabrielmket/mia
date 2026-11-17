/**
 * FORK MIA — os CAMPOS NOVOS DO AGENTE que vieram do upstream 1.101 a 1.107 ao
 * alcance de `plataforma_garantir_agente` (MIA-15): a pausa mínima entre
 * respostas (9101), as skills por agente (9107), a visão de foto (9108) e as
 * etiquetas pelas quais cada skill entra (9230).
 *
 * O molde é o de `mcp-de-implantacao-novidades-do-upstream-1107.test.ts`: um
 * bloco por campo, e o que se mede é o BANCO, não a resposta. Para cada campo:
 * grava, o pedido repetido responde `ja_estava`, fora da faixa da tela é
 * recusado, e a leitura (`plataforma_ver_agentes`) devolve o valor.
 *
 * As etiquetas da skill passam pelas primitivas do `PUT /api/v1/ai/skills/[name]`
 * (`insertSkillVersion` e `setSkillPointer`, que falam SQL cru pelo pool): aqui
 * elas gravam nas tabelas do banco em memória, com o mesmo efeito.
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia e nomes inventados.
 */
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cenarioDaImplantacao,
  clienteMcp,
  ORG,
  TODAS_AS_OPERACOES,
} from "@/tests/helpers/implantacao-em-memoria";
import type * as Skills from "@/lib/agent-engine/agent/skills";
import type * as ArquivosDoPacote from "@/lib/ai/skills/package-files";
import type { Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown, tabela: null as null | ((nome: string) => Linha[]) }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
vi.mock("@/lib/ai/embeddings/chave", () => ({ temChaveDeEmbedding: vi.fn(async () => true) }));
vi.mock("@/lib/ai/skills/db", () => ({ getSkillsPool: () => ({ query: vi.fn() }) }));
vi.mock("@/lib/ai/skills/package-files", async (original) => ({
  ...(await original<typeof ArquivosDoPacote>()),
  copiarArquivosDoPacote: vi.fn(async () => undefined),
}));
vi.mock("@/lib/agent-engine/agent/skills", async (original) => {
  const real = await original<typeof Skills>();
  return {
    ...real,
    // A MESMA régua (corpo e matcher), gravando no banco em memória.
    insertSkillVersion: vi.fn(async (_db: unknown, i: Parameters<typeof real.insertSkillVersion>[1]) => {
      real.validateSkillBody(i.body);
      const linha = {
        id: randomUUID(),
        organization_id: i.tenantId,
        name: i.name,
        description: i.description,
        body: i.body,
        matcher: real.skillMatcherSchema.parse(i.matcher),
        manifest: i.manifest ?? [],
        forked_from_version_id: i.forkedFromVersionId ?? null,
        created_at: new Date(),
      };
      estado.tabela!("skill_versions").push(linha);
      return linha;
    }),
    setSkillPointer: vi.fn(async (_db: unknown, i: { tenantId: string | null; name: string; versionId: string }) => {
      const p = estado.tabela!("skill_pointers").find((x) => x.organization_id === i.tenantId && x.name === i.name);
      if (p) p.version_id = i.versionId;
      else estado.tabela!("skill_pointers").push({ organization_id: i.tenantId, name: i.name, version_id: i.versionId });
    }),
  };
});

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { insertSkillVersion } = await import("@/lib/agent-engine/agent/skills");
const { copiarArquivosDoPacote } = await import("@/lib/ai/skills/package-files");
const { audit } = await import("@/lib/audit");

const AGENTE = {
  nome: "Assistente",
  prompt: "Você é a assistente da Clínica Exemplo. Entenda o que a pessoa procura antes de oferecer um horário.",
  pacotes: ["vender"],
};

/** Uma skill instalada na empresa, uma de plataforma, e o vocabulário de etiquetas. */
function semearSkills(tabela: (nome: string) => Linha[]) {
  const skill = (organizacao: string | null, nome: string, extra: Linha = {}) => {
    const id = randomUUID();
    tabela("skill_versions").push({
      id,
      organization_id: organizacao,
      name: nome,
      description: `Quando a conversa é sobre ${nome}.`,
      body: `Conduza a conversa de ${nome} com calma.`,
      matcher: { any_keywords: [nome] },
      manifest: [],
      forked_from_version_id: null,
      ...extra,
    });
    tabela("skill_pointers").push({ organization_id: organizacao, name: nome, version_id: id });
    return id;
  };
  skill(ORG, "clareamento");
  skill(ORG, "implante", { manifest: [{ path: "references/tabela.md", size: 10, sha256: "x", kind: "reference" }] });
  skill(null, "objecoes-de-preco");
  // A de OUTRA empresa não aparece, nem se marca.
  skill(randomUUID(), "de-outra-empresa");
  tabela("organizations")[0]!.settings = { tags: [{ tag: "Odonto", cor: "#00655a" }, "Prospecção"] };
}

async function preparar() {
  const cenario = cenarioDaImplantacao();
  estado.cliente = cenario.cliente;
  const tabela = (nome: string) => cenario.banco.tabela(nome) as Linha[];
  estado.tabela = tabela;
  semearSkills(tabela);
  const mcp = await clienteMcp(criarServidorDePlataforma as never, TODAS_AS_OPERACOES);
  return { ...cenario, mcp, tabela };
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

const versao = (c: Cenario) => c.tabela("ai_agent_versions").at(-1)!;
const desfechoDaVersao = (r: { dados: Record<string, unknown> }) => (r.dados.versao as Linha).desfecho;
async function lido(c: Cenario) {
  const r = await ok(c, "plataforma_ver_agentes", { agente: "Assistente" });
  return { agente: (r.dados.agentes as Linha[])[0]!, dados: r.dados };
}

beforeEach(() => vi.clearAllMocks());

describe("plataforma_garantir_agente · CAMPO NOVO `pausa_entre_respostas_segundos` (upstream 1.101, 9101)", () => {
  it("⭐ grava em ms no rascunho, repetir é `ja_estava`, a leitura devolve em segundos, null tira", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", AGENTE);
    expect(versao(c).reply_min_interval_ms ?? null).toBeNull();
    expect((await lido(c)).agente.pausa_entre_respostas_segundos).toBeNull();

    const r = await ok(c, "plataforma_garantir_agente", { nome: "Assistente", pausa_entre_respostas_segundos: 45 });
    expect(versao(c).reply_min_interval_ms).toBe(45_000);
    expect(JSON.stringify(r.dados)).toContain("pausa entre respostas");
    expect((await lido(c)).agente.pausa_entre_respostas_segundos).toBe(45);

    const de_novo = await ok(c, "plataforma_garantir_agente", { nome: "Assistente", pausa_entre_respostas_segundos: 45 });
    expect(desfechoDaVersao(de_novo)).toBe("ja_estava");

    await ok(c, "plataforma_garantir_agente", { nome: "Assistente", pausa_entre_respostas_segundos: null });
    expect(versao(c).reply_min_interval_ms).toBeNull();
  });

  it("fora da faixa da tela (0 a 600 segundos) é recusado e nada é gravado", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", { ...AGENTE, pausa_entre_respostas_segundos: 600 });
    expect(versao(c).reply_min_interval_ms).toBe(600_000);
    expect(await recusa(c, "plataforma_garantir_agente", { nome: "Assistente", pausa_entre_respostas_segundos: 601 })).toBeTruthy();
    expect(await recusa(c, "plataforma_garantir_agente", { nome: "Assistente", pausa_entre_respostas_segundos: -1 })).toBeTruthy();
    expect(await recusa(c, "plataforma_garantir_agente", { nome: "Assistente", pausa_entre_respostas_segundos: 1.5 })).toBeTruthy();
    expect(versao(c).reply_min_interval_ms).toBe(600_000);
  });
});

describe("plataforma_garantir_agente · CAMPO NOVO `ver_fotos_do_cliente` (upstream 1.107, 9108)", () => {
  it("⭐ nasce LIGADO como na tela; desligar grava; repetir é `ja_estava`; a leitura devolve; valor que não é sim/não é recusado", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", AGENTE);
    expect(versao(c).image_vision_enabled).toBe(true);
    expect((await lido(c)).agente.ver_fotos_do_cliente).toBe(true);

    const r = await ok(c, "plataforma_garantir_agente", { nome: "Assistente", ver_fotos_do_cliente: false });
    expect(versao(c).image_vision_enabled).toBe(false);
    expect(JSON.stringify(r.dados)).toContain("ver as fotos do cliente");
    expect((await lido(c)).agente.ver_fotos_do_cliente).toBe(false);

    const de_novo = await ok(c, "plataforma_garantir_agente", { nome: "Assistente", ver_fotos_do_cliente: false });
    expect(desfechoDaVersao(de_novo)).toBe("ja_estava");

    expect(await recusa(c, "plataforma_garantir_agente", { nome: "Assistente", ver_fotos_do_cliente: "não" })).toBeTruthy();
    expect(versao(c).image_vision_enabled).toBe(false);
  });
});

describe("plataforma_garantir_agente · CAMPO NOVO `skills` (upstream 1.107, 9107)", () => {
  it("⭐ grava a lista (da empresa e de plataforma), repetir é `ja_estava`, [] = nenhuma, null = todas; a leitura devolve", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", AGENTE);
    expect(versao(c).skill_names).toBeNull();
    const antes = await lido(c);
    expect(antes.agente.skills).toBeNull();
    expect((antes.dados.skills_da_empresa as Linha[]).map((s) => [s.nome, s.de])).toEqual([
      ["clareamento", "empresa"],
      ["implante", "empresa"],
      ["objecoes-de-preco", "plataforma"],
    ]);

    await ok(c, "plataforma_garantir_agente", { nome: "Assistente", skills: ["clareamento", "objecoes-de-preco", "clareamento"] });
    expect(versao(c).skill_names).toEqual(["clareamento", "objecoes-de-preco"]);
    expect((await lido(c)).agente.skills).toEqual(["clareamento", "objecoes-de-preco"]);

    const de_novo = await ok(c, "plataforma_garantir_agente", { nome: "Assistente", skills: ["clareamento", "objecoes-de-preco"] });
    expect(desfechoDaVersao(de_novo)).toBe("ja_estava");

    await ok(c, "plataforma_garantir_agente", { nome: "Assistente", skills: [] });
    expect(versao(c).skill_names).toEqual([]);
    await ok(c, "plataforma_garantir_agente", { nome: "Assistente", skills: null });
    expect(versao(c).skill_names).toBeNull();
  });

  it("a skill que não existe (ou é de outra empresa) é recusada com a lista do que existe, e nada é gravado", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", AGENTE);
    for (const nome of ["nao-existe", "de-outra-empresa"]) {
      const texto = await recusa(c, "plataforma_garantir_agente", { nome: "Assistente", skills: ["clareamento", nome] });
      expect(texto).toContain(`«${nome}»`);
      expect(texto).toContain("«clareamento»");
    }
    expect(versao(c).skill_names).toBeNull();
  });
});

describe("plataforma_garantir_agente · CAMPO NOVO `skills_por_etiqueta` (upstream 1.107, 9230)", () => {
  const skillAtual = (c: Cenario, nome: string) => {
    const p = c.tabela("skill_pointers").find((x) => x.organization_id === ORG && x.name === nome)!;
    return c.tabela("skill_versions").find((v) => v.id === p.version_id)!;
  };

  it("⭐ grava as etiquetas na skill por uma VERSÃO NOVA (como a tela), na grafia do vocabulário; repetir é `ja_estava`; a leitura devolve", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", AGENTE);
    const original = skillAtual(c, "clareamento");

    const r = await ok(c, "plataforma_garantir_agente", {
      nome: "Assistente",
      skills_por_etiqueta: [{ skill: "clareamento", etiquetas: ["odonto", "PROSPECÇÃO"] }],
    });
    const nova = skillAtual(c, "clareamento");
    expect(nova.id).not.toBe(original.id);
    expect(nova.matcher).toEqual({ any_keywords: ["clareamento"], any_tags: ["Odonto", "Prospecção"] });
    expect(nova.body).toBe(original.body);
    expect(nova.description).toBe(original.description);
    // A versão antiga fica (é imutável), e a linha de auditoria é a da tela.
    expect(c.tabela("skill_versions").some((v) => v.id === original.id)).toBe(true);
    expect(vi.mocked(audit)).toHaveBeenCalledWith(expect.objectContaining({ action: "ai.skill_saved", resourceId: nova.id }));
    expect(r.dados.skills_por_etiqueta).toEqual([{ skill: "clareamento", etiquetas: ["Odonto", "Prospecção"], desfecho: "atualizou" }]);
    expect(JSON.stringify(r.dados.avisos)).toContain("TODO agente que usa a skill");

    const leitura = await lido(c);
    expect((leitura.dados.skills_da_empresa as Linha[]).find((s) => s.nome === "clareamento")!.etiquetas).toEqual(["Odonto", "Prospecção"]);

    vi.mocked(insertSkillVersion).mockClear();
    const de_novo = await ok(c, "plataforma_garantir_agente", {
      nome: "Assistente",
      skills_por_etiqueta: [{ skill: "clareamento", etiquetas: ["Prospecção", "Odonto"] }],
    });
    expect((de_novo.dados.skills_por_etiqueta as Linha[])[0]!.desfecho).toBe("ja_estava");
    expect(insertSkillVersion).not.toHaveBeenCalled();

    // [] tira as etiquetas: a skill volta a ser como a que nunca teve.
    await ok(c, "plataforma_garantir_agente", { nome: "Assistente", skills_por_etiqueta: [{ skill: "clareamento", etiquetas: [] }] });
    expect(skillAtual(c, "clareamento").matcher).toEqual({ any_keywords: ["clareamento"] });
  });

  it("⭐ a etiqueta que NÃO existe na empresa é recusada antes de qualquer escrita (nem o rascunho muda)", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", AGENTE);
    const versoesAntes = c.tabela("ai_agent_versions").map((v) => ({ ...v }));
    const original = skillAtual(c, "clareamento");

    const texto = await recusa(c, "plataforma_garantir_agente", {
      nome: "Assistente",
      ver_fotos_do_cliente: false,
      skills_por_etiqueta: [{ skill: "clareamento", etiquetas: ["Odonto", "Ortodontia"] }],
    });
    expect(texto).toContain("«Ortodontia»");
    expect(texto).toContain("plataforma_garantir_etiquetas");
    expect(skillAtual(c, "clareamento").id).toBe(original.id);
    expect(c.tabela("ai_agent_versions")).toEqual(versoesAntes);
    expect(insertSkillVersion).not.toHaveBeenCalled();
  });

  it("recusa a skill de plataforma (não se edita), a que não existe, a repetida e mais etiquetas que o teto", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", AGENTE);
    expect(
      await recusa(c, "plataforma_garantir_agente", {
        nome: "Assistente",
        skills_por_etiqueta: [{ skill: "objecoes-de-preco", etiquetas: ["Odonto"] }],
      }),
    ).toContain("PLATAFORMA");
    expect(
      await recusa(c, "plataforma_garantir_agente", { nome: "Assistente", skills_por_etiqueta: [{ skill: "nao-existe", etiquetas: ["Odonto"] }] }),
    ).toContain("«nao-existe»");
    expect(
      await recusa(c, "plataforma_garantir_agente", {
        nome: "Assistente",
        skills_por_etiqueta: [
          { skill: "clareamento", etiquetas: ["Odonto"] },
          { skill: "clareamento", etiquetas: [] },
        ],
      }),
    ).toContain("duas vezes");
    expect(
      await recusa(c, "plataforma_garantir_agente", {
        nome: "Assistente",
        skills_por_etiqueta: [{ skill: "clareamento", etiquetas: Array.from({ length: 21 }, (_, i) => `e${i}`) }],
      }),
    ).toBeTruthy();
    expect(insertSkillVersion).not.toHaveBeenCalled();
  });

  it("a skill de pacote herda o manifesto e copia os arquivos antes de mover o ponteiro, como o PUT da tela", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", AGENTE);
    const original = skillAtual(c, "implante");
    await ok(c, "plataforma_garantir_agente", { nome: "Assistente", skills_por_etiqueta: [{ skill: "implante", etiquetas: ["Odonto"] }] });
    const nova = skillAtual(c, "implante");
    expect(nova.manifest).toEqual(original.manifest);
    expect(copiarArquivosDoPacote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, name: "implante", deVersionId: original.id, paraVersionId: nova.id }),
    );
  });

  it("avisa quando a skill etiquetada não está na lista própria de skills do agente", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_agente", { ...AGENTE, skills: ["implante"] });
    const r = await ok(c, "plataforma_garantir_agente", {
      nome: "Assistente",
      skills_por_etiqueta: [{ skill: "clareamento", etiquetas: ["Odonto"] }],
    });
    expect(JSON.stringify(r.dados.avisos)).toContain("«clareamento» não está nas `skills` deste agente");
  });
});
