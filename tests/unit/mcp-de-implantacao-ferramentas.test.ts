/**
 * FORK MIA — O CATÁLOGO do MCP de implantação e o SERVIDOR que o serve.
 *
 * Duas coisas são medidas aqui, e nenhuma toca em área de produto (isso é
 * `mcp-de-implantacao-operacoes.test.ts`):
 *
 * 1. A LISTA: cada ferramenta nova diz o que faz para um modelo que nunca viu o
 *    sistema, carrega um exemplo que PASSA no próprio schema, e exige a
 *    operação certa. Exemplo que deixa de valer reprova aqui, em vez de ensinar
 *    errado na recusa.
 *
 * 2. O SERVIDOR, pelo protocolo (um cliente MCP em memória, como o Claude Code
 *    faria): `tools/list` devolve tudo, escrita sem a operação no token é
 *    recusada ANTES do handler, e a recusa de validação é em português, com o
 *    campo, o que era esperado e um exemplo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { cenarioDaImplantacao, clienteMcp, ORG, TODAS_AS_OPERACOES } from "@/tests/helpers/implantacao-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));

const { FERRAMENTAS } = await import("@/lib/mcp-plataforma/ferramentas");
const { OPERACOES, CHAVES_DE_OPERACAO } = await import("@/lib/mcp-plataforma/operacoes");
const { AREAS_DO_CHECKLIST } = await import("@/lib/mcp-plataforma/checklist/areas");
const { criarServidorDePlataforma, esquemaDosArgumentos, resumoParaAuditoria: argumentosParaAuditoria } = await import(
  "@/lib/mcp-plataforma/servidor"
);
const { audit } = await import("@/lib/audit");

/** As oito com que o MCP de plataforma nasceu; o resto é a implantação. */
const DE_ANTES = new Set([
  "plataforma_listar_clientes",
  "plataforma_ver_cliente",
  "plataforma_listar_modulos",
  "plataforma_ver_saude",
  "plataforma_criar_cliente",
  "plataforma_liberar_modulo",
  "plataforma_lancar_credito",
  "plataforma_definir_preco",
]);
// As ferramentas de IMPORTAÇÃO (migração de outro CRM) têm a bateria própria, com as
// mesmas exigências de descrição, exemplo e recusa: `tests/unit/mcp-de-migracao-*.test.ts`.
// Aqui ficam as da implantação.
const NOVAS = FERRAMENTAS.filter((f) => !DE_ANTES.has(f.name) && !f.name.includes("_importa"));

beforeEach(() => {
  estado.cliente = cenarioDaImplantacao().cliente;
  vi.mocked(audit).mockClear();
});

describe("a lista de ferramentas", () => {
  it("as oito de antes continuam lá, e a implantação entrou", () => {
    const nomes = FERRAMENTAS.map((f) => f.name);
    for (const nome of DE_ANTES) expect(nomes, `sumiu ${nome}`).toContain(nome);
    expect(NOVAS.length).toBeGreaterThanOrEqual(20);
    // A que o implantador chama no começo e no fim.
    expect(nomes).toContain("plataforma_ver_implantacao");
  });

  it("toda ferramenta nova carrega um EXEMPLO que passa no próprio schema", () => {
    for (const f of NOVAS) {
      expect(f.exemplo, `${f.name} sem exemplo de chamada`).toBeDefined();
      const lido = z.strictObject(f.inputSchema).safeParse(f.exemplo);
      expect(
        lido.success,
        `o exemplo de ${f.name} não passa no schema dela: ${lido.success ? "" : JSON.stringify(lido.error.issues)}`,
      ).toBe(true);
    }
  });

  it("toda descrição é escrita para quem nunca viu o sistema", () => {
    for (const f of NOVAS) {
      expect(f.description.length, `${f.name} com descrição curta demais`).toBeGreaterThan(200);
      // Travessão vira ruído em quem lê pela tela do Claude Code; a casa usa ponto e dois-pontos.
      expect(f.description, `${f.name} usa travessão na descrição`).not.toContain("—");
    }
    for (const f of NOVAS.filter((x) => x.operacao !== null)) {
      expect(
        /O QUE NÃO FAZ|NÃO CONFUNDA|ATENÇÃO|ANTES DE/.test(f.description),
        `${f.name} (escrita) não diz o que NÃO faz nem o que conferir antes`,
      ).toBe(true);
    }
  });

  it("todo campo de toda ferramenta nova tem descrição, menos os que o nome já explica", () => {
    for (const f of NOVAS) {
      const semDescricao = Object.entries(f.inputSchema)
        .filter(([, campo]) => !(campo as { description?: string }).description)
        .map(([nome]) => nome);
      // `modo` e `visibilidade` são explicados, com cada valor, na descrição da ferramenta.
      const toleradas = new Set(["marca", "categoria", "pais", "razao_social", "modo", "visibilidade", "conversa_fica_com_quem_atendeu", "tipos", "pessoas", "respostas"]);
      expect(
        semDescricao.filter((n) => !toleradas.has(n)),
        `${f.name}: campo sem descrição para o modelo`,
      ).toEqual([]);
    }
  });

  it("as ferramentas que recebem organização a declaram como `organization_id`", () => {
    const semOrganizacao = NOVAS.filter((f) => !("organization_id" in f.inputSchema)).map((f) => f.name);
    // Só o catálogo de modelos não depende de cliente. E as demonstrações, que são
    // achadas pelo SEGMENTO: a empresa delas é a semente que cria (docs/fork/cliente-modelo.md).
    expect(semOrganizacao).toEqual([
      "plataforma_listar_modelos",
      "plataforma_listar_demonstracoes",
      "plataforma_criar_demonstracao",
      "plataforma_reaplicar_demonstracao",
    ]);
  });

  it("o JSON Schema de todas sai inteiro, como objeto, com os campos obrigatórios", () => {
    for (const f of FERRAMENTAS) {
      const esquema = esquemaDosArgumentos(f) as { type: string; properties?: Record<string, unknown> };
      expect(esquema.type).toBe("object");
      expect(Object.keys(esquema.properties ?? {}).sort()).toEqual(Object.keys(f.inputSchema).sort());
    }
  });
});

describe("as operações do token", () => {
  it("as três da implantação existem, com o raio escrito para quem marca a caixinha", () => {
    for (const chave of ["implantar_configuracao", "colocar_no_ar", "convidar_equipe"]) {
      const op = OPERACOES.find((o) => o.chave === chave);
      expect(op, `falta a operação ${chave}`).toBeDefined();
      expect(op!.raio).toMatch(/QUALQUER cliente/);
    }
  });

  it("MONTAR não põe nada no ar: publicar, ligar e submeter exigem `colocar_no_ar`", () => {
    const doAr = FERRAMENTAS.filter((f) => /publicar|pausar|ligar|submeter/.test(f.name)).map((f) => [f.name, f.operacao]);
    expect(doAr.length).toBeGreaterThanOrEqual(6);
    for (const [nome, operacao] of doAr) expect(operacao, `${nome} deveria exigir colocar_no_ar`).toBe("colocar_no_ar");
    // E nenhuma ferramenta de montagem carrega um desses verbos.
    const deMontagem = FERRAMENTAS.filter((f) => f.operacao === "implantar_configuracao").map((f) => f.name);
    expect(deMontagem.filter((n) => /publicar|pausar|ligar|submeter|convidar/.test(n))).toEqual([]);
  });

  it("convidar tem chave própria: quem só monta não manda e-mail nem dá acesso", () => {
    expect(FERRAMENTAS.find((f) => f.name === "plataforma_convidar_pessoas")?.operacao).toBe("convidar_equipe");
    expect(FERRAMENTAS.filter((f) => f.operacao === "convidar_equipe").map((f) => f.name)).toEqual([
      "plataforma_convidar_pessoas",
    ]);
  });

  it("toda chave de operação cabe na coluna do token sem migration (é texto livre, conferido no código)", () => {
    for (const chave of CHAVES_DE_OPERACAO) expect(chave).toMatch(/^[a-z_]{3,40}$/);
  });
});

describe("o checklist é uma lista de áreas", () => {
  it("cada área tem chave única, título e uma função que avalia", () => {
    const chaves = AREAS_DO_CHECKLIST.map((a) => a.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
    for (const a of AREAS_DO_CHECKLIST) {
      expect(a.titulo.length).toBeGreaterThan(3);
      expect(typeof a.avaliar).toBe("function");
    }
    // As áreas que o pedido de implantação nomeia.
    for (const esperada of ["empresa", "funis", "produtos", "etiquetas", "memoria", "agentes", "conhecimento", "followups", "automacoes", "agenda", "equipe", "canais", "conversoes", "modulos"]) {
      expect(chaves, `falta a área ${esperada}`).toContain(esperada);
    }
  });
});

describe("o servidor, pelo protocolo", () => {
  it("tools/list devolve todas, com o aviso de leitura ou de escrita na descrição", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const lista = await mcp.listar();
    expect(lista.map((t) => t.name).sort()).toEqual(FERRAMENTAS.map((f) => f.name).sort());
    const funil = lista.find((t) => t.name === "plataforma_garantir_funil")!;
    expect(funil.description).toContain('Exige que o token carregue a operação "implantar_configuracao"');
    expect(lista.find((t) => t.name === "plataforma_ver_implantacao")!.description).toContain("(Leitura.)");
    expect((funil.inputSchema as { required?: string[] }).required).toEqual(
      expect.arrayContaining(["organization_id", "nome", "etapas"]),
    );
    await mcp.fechar();
  });

  it("token SEM a operação: a escrita é recusada antes do handler, e a recusa nomeia a operação e o raio", async () => {
    const cenario = cenarioDaImplantacao();
    estado.cliente = cenario.cliente;
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);

    for (const f of NOVAS.filter((x) => x.operacao !== null)) {
      const r = await mcp.chamar(f.name, f.exemplo);
      expect(r.erro, `${f.name} executou sem a operação no token`).toBe(true);
      expect(r.texto).toContain(`Este token não tem a operação "${f.operacao}"`);
      expect(r.texto).toContain("Admin › Tokens de plataforma");
      expect(r.texto).toContain("O que ela permite:");
    }
    // Nada foi gravado em tabela nenhuma.
    expect(cenario.banco.escritas).toEqual([]);
    expect(vi.mocked(audit).mock.calls.every(([e]) => e.action === "plataforma.mcp_recusado")).toBe(true);
    await mcp.fechar();
  });

  it("token com UMA operação executa só as ferramentas dela", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, ["implantar_configuracao"]);
    const publicar = await mcp.chamar("plataforma_publicar_agente", { organization_id: ORG, agente: "Bia" });
    expect(publicar.erro).toBe(true);
    expect(publicar.texto).toContain('"colocar_no_ar"');
    const convidar = await mcp.chamar("plataforma_convidar_pessoas", {
      organization_id: ORG,
      pessoas: [{ email: "alguem@exemplo.invalid", papel: "agent" }],
    });
    expect(convidar.erro).toBe(true);
    expect(convidar.texto).toContain('"convidar_equipe"');
    await mcp.fechar();
  });

  it("LER é livre: o checklist responde com token sem operação nenhuma", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const r = await mcp.chamar("plataforma_ver_implantacao", { organization_id: ORG });
    expect(r.erro, r.texto).toBe(false);
    expect((r.dados.organizacao as { id: string }).id).toBe(ORG);
    await mcp.fechar();
  });

  it("organização que não existe: recusa que diz como achar o id certo, em TODA ferramenta que recebe organização", async () => {
    const cenario = cenarioDaImplantacao();
    estado.cliente = cenario.cliente;
    // "importar_base" entra aqui por causa de plataforma_garantir_obrigacoes: é
    // ferramenta de lote (migra a planilha de vencimentos), e sem a operação a
    // recusa seria a do token, antes de a organização ser conferida.
    const mcp = await clienteMcp(criarServidorDePlataforma as never, [...TODAS_AS_OPERACOES, "importar_base"]);
    const inexistente = "0a000000-0000-4000-8000-00000000dead";

    for (const f of NOVAS.filter((x) => "organization_id" in x.inputSchema)) {
      const r = await mcp.chamar(f.name, { ...f.exemplo, organization_id: inexistente });
      expect(r.erro, `${f.name} respondeu sucesso para uma organização que não existe`).toBe(true);
      expect(r.texto, f.name).toContain(`Não existe organização com o id ${inexistente}`);
      expect(r.texto).toContain("plataforma_listar_clientes");
    }
    expect(cenario.banco.escritas, "gravou algo para uma organização inexistente").toEqual([]);
    await mcp.fechar();
  });

  it("recusa de validação ENSINA: campo, o que era esperado, a descrição do campo e um exemplo", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, TODAS_AS_OPERACOES);

    const semEtapas = await mcp.chamar("plataforma_garantir_funil", { organization_id: ORG, nome: "Vendas" });
    expect(semEtapas.erro).toBe(true);
    expect(semEtapas.texto).toContain("não passou na conferência dos argumentos. Nada foi gravado.");
    expect(semEtapas.texto).toContain("`etapas` é obrigatório (esperado: lista)");
    expect(semEtapas.texto).toContain("O que é este campo:");
    expect(semEtapas.texto).toContain("Exemplo de chamada válida:");
    expect(semEtapas.texto).toContain('"passo": "won"');
    // Nada do vocabulário do validador vaza.
    expect(semEtapas.texto).not.toMatch(/Invalid input|invalid_type|expected string/);

    const campoErrado = await mcp.chamar("plataforma_garantir_funil", {
      organization_id: ORG,
      nome: "Vendas",
      etapa: [],
      etapas: [
        { nome: "Novo", passo: "novo" },
        { nome: "Ganho", passo: "won" },
      ],
    });
    expect(campoErrado.erro).toBe(true);
    expect(campoErrado.texto).toContain("Campo desconhecido: `etapa`");
    expect(campoErrado.texto).toContain('`etapas[0].passo` aceita só: "new", "contacted"');

    const tipoErrado = await mcp.chamar("plataforma_garantir_produtos", { organization_id: "abc", produtos: "lista" });
    expect(tipoErrado.texto).toContain("`organization_id` precisa ser um id no formato");
    expect(tipoErrado.texto).toContain("`produtos` deveria ser lista e chegou texto");

    const lote = await mcp.chamar("plataforma_garantir_produtos", {
      organization_id: ORG,
      produtos: Array.from({ length: 201 }, (_, i) => ({ nome: `Produto ${i}`, preco_cents: 100 })),
    });
    expect(lote.texto).toContain("aceita no máximo 200 itens por chamada. Divida em mais de uma chamada.");
    await mcp.fechar();
  });

  it("ferramenta que não existe: a recusa manda listar", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, TODAS_AS_OPERACOES);
    const r = await mcp.chamar("plataforma_criar_funil", {});
    expect(r.erro).toBe(true);
    expect(r.texto).toContain('Não existe a ferramenta "plataforma_criar_funil"');
    await mcp.fechar();
  });

  it("a escrita é auditada com o token e os argumentos; a leitura não é", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, TODAS_AS_OPERACOES);
    await mcp.chamar("plataforma_ver_implantacao", { organization_id: ORG });
    expect(vi.mocked(audit).mock.calls.filter(([e]) => e.action === "plataforma.mcp_executado")).toEqual([]);

    await mcp.chamar("plataforma_garantir_etiquetas", { organization_id: ORG, etiquetas: [{ nome: "Indicação", cor: "#0091ff" }] });
    const linha = vi.mocked(audit).mock.calls.map(([e]) => e).find((e) => e.action === "plataforma.mcp_executado");
    expect(linha).toMatchObject({
      actingAsPlatformAdmin: true,
      bypassedRls: true,
      metadata: {
        ferramenta: "plataforma_garantir_etiquetas",
        operacao: "implantar_configuracao",
        argumentos: { organization_id: ORG, etiquetas: [{ nome: "Indicação", cor: "#0091ff" }] },
      },
    });
    expect((linha!.metadata as { token_id: string }).token_id).toBeTruthy();
    await mcp.fechar();
  });
});

describe("os argumentos na auditoria", () => {
  it("o que é curto vai inteiro; texto longo vira o começo e o tamanho; lista longa vira os primeiros e a contagem", () => {
    const prompt = "x".repeat(5000);
    const resumo = argumentosParaAuditoria({
      nome: "Bia",
      prompt,
      produtos: Array.from({ length: 200 }, (_, i) => ({ codigo: `P${i}` })),
    }) as { nome: string; prompt: { inicio: string; caracteres: number }; produtos: { primeiros: unknown[]; total: number } };
    expect(resumo.nome).toBe("Bia");
    expect(resumo.prompt.caracteres).toBe(5000);
    expect(resumo.prompt.inicio).toHaveLength(200);
    expect(resumo.produtos.total).toBe(200);
    expect(resumo.produtos.primeiros).toHaveLength(25);
    // A linha de auditoria cabe: um prompt de 5.000 e 200 produtos viram menos de 2 mil caracteres.
    expect(JSON.stringify(resumo).length).toBeLessThan(2000);
  });
});
