/**
 * IMPORTAR MATERIAIS pelo MCP de plataforma: arquivo de conhecimento, fotos de
 * produto e modelo de proposta, e o download que os três compartilham.
 *
 * Três coisas se medem aqui:
 *
 *  1. o DOWNLOAD usa as guardas contra SSRF que o produto já tem (as dos
 *     webhooks de saída), inclusive no redirecionamento;
 *  2. cada material entra pelas regras da TELA (tipo, tamanho, caminho) e pode
 *     ser repetido sem duplicar;
 *  3. os números que a importação copiou das rotas (tetos, tipos por extensão)
 *     continuam batendo com elas: é a catraca do fim do arquivo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOR, ORG, TOKEN, organizacaoDeTeste, type BancoDaMigracao } from "../helpers/banco-da-migracao";

let banco: BancoDaMigracao;

const auditSpy = vi.fn();
vi.mock("@/lib/audit", async (original) => ({
  ...(await original<typeof import("@/lib/audit")>()),
  audit: async (entrada: unknown) => {
    auditSpy(entrada);
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => banco.cliente }));

// O DNS de mentira: nome → endereço. O julgamento do endereço é o DE VERDADE
// (`ipEhEspecial`), só a resolução é trocada, para o teste não depender de rede.
const DNS: Record<string, string> = {
  "arquivos.exemplo.invalid": "203.0.114.10",
  "cdn.exemplo.invalid": "203.0.114.11",
  "interno.exemplo.invalid": "10.0.0.7",
};
vi.mock("@/lib/automation/outbound-ip", async (original) => {
  const real = await original<typeof import("@/lib/automation/outbound-ip")>();
  return {
    ...real,
    assertDestinoResolvidoSeguro: async (hostname: string) => {
      const endereco = DNS[hostname];
      if (!endereco) return real.assertDestinoResolvidoSeguro(hostname);
      if (real.ipEhEspecial(endereco)) throw new Error("unsafe_url:private_ip");
    },
  };
});

const extrairSpy = vi.fn(async (_caminho: string, _ext?: string) => ({ texto: "conteúdo", extensao: "md" }));
vi.mock("@/lib/ai/rag/ingest/documento", async (original) => ({
  ...(await original<typeof import("@/lib/ai/rag/ingest/documento")>()),
  extrairTextoDoArquivo: (caminho: string, ext?: string) => extrairSpy(caminho, ext),
}));
const temChave = vi.fn(async () => true);
vi.mock("@/lib/ai/embeddings/chave", () => ({ temChaveDeEmbedding: () => temChave() }));

const capacidades = vi.fn(async () => ["propostas"]);
vi.mock("@/lib/organizacao/capacidades", () => ({ capacidadesDaOrganizacao: () => capacidades() }));
const gerarModelo = vi.fn();
vi.mock("@/lib/propostas/modelos/importar", () => ({ gerarModeloDoTexto: (e: unknown) => gerarModelo(e) }));
vi.mock("@/lib/ai/skills/db", () => ({ getSkillsPool: () => ({}) }));
vi.mock("@/lib/agent-engine/edge/llm/credentials", () => ({ llmEdgeConfigFromEnv: () => ({}) }));
const extrairPdf = vi.fn(async (_b: Buffer) => "texto do pdf ".repeat(20));
vi.mock("@/lib/ai/rag/extractors/pdf", async (original) => ({
  ...(await original<typeof import("@/lib/ai/rag/extractors/pdf")>()),
  extractPdfText: (b: Buffer) => extrairPdf(b),
}));

const { baixarArquivoPublico, obterArquivo, TETO_DO_BASE64 } = await import("@/lib/mcp-plataforma/importacao/download");
const { importarConhecimento, TAMANHO_MAXIMO_DO_DOCUMENTO, MIME_POR_EXTENSAO, FERRAMENTA_IMPORTAR_CONHECIMENTO } = await import(
  "@/lib/mcp-plataforma/importacao/conhecimento"
);
const { importarFotosDeProduto, caminhoDaFoto, TETO_DE_FOTOS_POR_CHAMADA } = await import(
  "@/lib/mcp-plataforma/importacao/fotos-de-produto"
);
const { importarModeloDeProposta, TAMANHO_MAXIMO_DA_PROPOSTA } = await import(
  "@/lib/mcp-plataforma/importacao/modelos-de-proposta"
);
const { ErroDeExtracao, BUCKET_DE_CONHECIMENTO } = await import("@/lib/ai/rag/ingest/documento");
const { BUCKET_DAS_FOTOS, fotoPertenceAoProduto, MAXIMO_DE_FOTOS, TAMANHO_MAXIMO_DA_FOTO } = await import("@/lib/catalogo/fotos");
const { LlmBudgetExceededError } = await import("@/lib/agent-engine/edge/llm/run-model-call");

const ctx = () => ({ admin: banco.cliente as never, autorUserId: AUTOR, tokenId: TOKEN });

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6]);

/** Um `fetch` de mentira: endereço → resposta. Registra o que foi pedido. */
const pedidos: string[] = [];
function servir(respostas: Record<string, () => Response>) {
  vi.stubGlobal("fetch", async (alvo: URL | string, opcoes?: { redirect?: string }) => {
    const endereco = String(alvo);
    pedidos.push(endereco);
    // A importação NUNCA deixa o `fetch` seguir redirecionamento sozinho.
    expect(opcoes?.redirect).toBe("manual");
    const resposta = respostas[endereco];
    if (!resposta) return new Response("não achei", { status: 404 });
    return resposta();
  });
}
const arquivo = (bytes: Uint8Array | string, tipo: string, extra: Record<string, string> = {}) => () =>
  new Response(bytes as BodyInit, { status: 200, headers: { "content-type": tipo, ...extra } });
const redireciona = (para: string) => () => new Response(null, { status: 302, headers: { location: para } });

beforeEach(() => {
  banco = organizacaoDeTeste({
    catalog_products: [
      { id: "00000000-0000-4000-8000-00000000f301", organization_id: ORG, codigo: "CAM-001", nome: "Camiseta Azul", fotos: [], ativo: true },
      { id: "00000000-0000-4000-8000-00000000f302", organization_id: ORG, codigo: "CAN-001", nome: "Caneca", fotos: [], ativo: true },
      { id: "00000000-0000-4000-8000-00000000f303", organization_id: ORG, codigo: "CAN-002", nome: "Caneca", fotos: [], ativo: true },
    ],
  });
  auditSpy.mockClear();
  extrairSpy.mockClear();
  extrairSpy.mockImplementation(async () => ({ texto: "conteúdo", extensao: "md" }));
  temChave.mockReset().mockResolvedValue(true);
  capacidades.mockReset().mockResolvedValue(["propostas"]);
  gerarModelo.mockReset();
  extrairPdf.mockClear();
  pedidos.length = 0;
  vi.unstubAllGlobals();
});

// ── o download ────────────────────────────────────────────────────────────

describe("o download de um material: a proteção contra SSRF é a do produto", () => {
  it("recusa o que não é https, o endereço interno e o IP privado ANTES de qualquer pedido", async () => {
    servir({});
    const recusados = [
      "http://arquivos.exemplo.invalid/a.pdf",
      "ftp://arquivos.exemplo.invalid/a.pdf",
      "https://localhost/a.pdf",
      "https://127.0.0.1/a.pdf",
      "https://10.0.0.5/a.pdf",
      "https://192.168.1.10/a.pdf",
      // O serviço de metadados da nuvem, que entrega credencial de instância.
      "https://169.254.169.254/latest/meta-data/",
      "https://[::1]/a.pdf",
      // Faixa que o guard TEXTUAL não conhece e o que resolve o endereço pega.
      "https://198.51.100.7/a.pdf",
      "isto não é endereço",
    ];
    for (const endereco of recusados) {
      await expect(baixarArquivoPublico(endereco, 1024, "arquivo_url"), endereco).rejects.toThrow(/arquivo_url/);
    }
    expect(pedidos, "nenhum pedido saiu do servidor").toEqual([]);
  });

  it("recusa o nome público que RESOLVE para endereço interno", async () => {
    servir({});
    await expect(baixarArquivoPublico("https://interno.exemplo.invalid/a.pdf", 1024, "arquivo_url")).rejects.toThrow(
      /endereço interno ou privado/,
    );
    expect(pedidos).toEqual([]);
  });

  it("o redirecionamento passa pelas MESMAS guardas: público que manda para interno é recusado", async () => {
    servir({ "https://arquivos.exemplo.invalid/a.pdf": redireciona("https://169.254.169.254/latest/meta-data/") });
    await expect(baixarArquivoPublico("https://arquivos.exemplo.invalid/a.pdf", 1024, "arquivo_url")).rejects.toThrow(
      /interno/,
    );
    // Só o primeiro endereço foi pedido; o interno nunca.
    expect(pedidos).toEqual(["https://arquivos.exemplo.invalid/a.pdf"]);
  });

  it("segue o redirecionamento para outro endereço público, e pega o nome do arquivo", async () => {
    servir({
      "https://arquivos.exemplo.invalid/baixar?id=7": redireciona("https://cdn.exemplo.invalid/pasta/politica%20de%20troca.pdf"),
      "https://cdn.exemplo.invalid/pasta/politica%20de%20troca.pdf": arquivo("%PDF-1.4 conteúdo", "application/pdf; charset=binary"),
    });
    const baixado = await baixarArquivoPublico("https://arquivos.exemplo.invalid/baixar?id=7", 1024, "arquivo_url");
    expect(baixado).toMatchObject({ nome: "politica de troca.pdf", tipo: "application/pdf", veio: "endereco" });
    expect(pedidos).toHaveLength(2);
  });

  it("recusa redirecionamento sem fim, resposta que não é 200 e arquivo vazio", async () => {
    servir({
      "https://arquivos.exemplo.invalid/a": redireciona("https://arquivos.exemplo.invalid/a"),
      "https://arquivos.exemplo.invalid/privado.pdf": () => new Response("login", { status: 403 }),
      "https://arquivos.exemplo.invalid/vazio.pdf": arquivo("", "application/pdf"),
    });
    await expect(baixarArquivoPublico("https://arquivos.exemplo.invalid/a", 1024, "arquivo_url")).rejects.toThrow(/redireciona vezes demais/);
    await expect(baixarArquivoPublico("https://arquivos.exemplo.invalid/privado.pdf", 1024, "arquivo_url")).rejects.toThrow(/respondeu 403/);
    await expect(baixarArquivoPublico("https://arquivos.exemplo.invalid/vazio.pdf", 1024, "arquivo_url")).rejects.toThrow(/vazio/);
  });

  it("o teto de tamanho vale pelo que foi DECLARADO e pelo que foi LIDO", async () => {
    servir({
      "https://arquivos.exemplo.invalid/declarado.pdf": arquivo("x", "application/pdf", { "content-length": "5000" }),
      "https://arquivos.exemplo.invalid/mentiu.pdf": arquivo("x".repeat(3000), "application/pdf"),
    });
    await expect(baixarArquivoPublico("https://arquivos.exemplo.invalid/declarado.pdf", 1024, "arquivo_url")).rejects.toThrow(/teto/);
    await expect(baixarArquivoPublico("https://arquivos.exemplo.invalid/mentiu.pdf", 1024, "arquivo_url")).rejects.toThrow(/teto/);
  });

  it("base64: exige o nome do arquivo, recusa o que não é base64 e o que passa do teto declarado", async () => {
    const md = Buffer.from("# Política de troca\n\nTroca em 30 dias.").toString("base64");
    const ok = await obterArquivo({ arquivo_base64: md, nome_do_arquivo: "politica.md" }, TAMANHO_MAXIMO_DO_DOCUMENTO);
    expect(ok).toMatchObject({ nome: "politica.md", veio: "base64" });
    expect(ok.bytes.toString("utf8")).toContain("Troca em 30 dias");

    // Com o prefixo `data:` também vale.
    const comPrefixo = await obterArquivo(
      { arquivo_base64: `data:text/markdown;base64,${md}`, nome_do_arquivo: "politica.md" },
      TAMANHO_MAXIMO_DO_DOCUMENTO,
    );
    expect(comPrefixo.bytes.toString("utf8")).toContain("Troca em 30 dias");

    await expect(obterArquivo({ arquivo_base64: md }, 1024)).rejects.toThrow(/nome_do_arquivo/);
    await expect(obterArquivo({ arquivo_base64: "isto não é base64!!", nome_do_arquivo: "a.md" }, 1024)).rejects.toThrow(/base64 válido/);
    const grande = Buffer.alloc(TETO_DO_BASE64 + 1, 65).toString("base64");
    await expect(obterArquivo({ arquivo_base64: grande, nome_do_arquivo: "a.txt" }, TAMANHO_MAXIMO_DO_DOCUMENTO)).rejects.toThrow(
      /arquivo_url/,
    );
    await expect(obterArquivo({}, 1024)).rejects.toThrow(/Falta o arquivo/);
    await expect(
      obterArquivo({ arquivo_base64: md, arquivo_url: "https://arquivos.exemplo.invalid/a.md", nome_do_arquivo: "a.md" }, 1024),
    ).rejects.toThrow(/não os dois/);
  });
});

// ── conhecimento ──────────────────────────────────────────────────────────

describe("importar conhecimento: um arquivo para a base que o agente lê", () => {
  const POLITICA = Buffer.from("# Política de troca\n\nTroca em 30 dias com a nota fiscal.").toString("base64");
  const importar = (extra: Record<string, unknown> = {}) =>
    importarConhecimento(ctx(), {
      organization_id: ORG,
      nome: "Política de troca",
      arquivo_base64: POLITICA,
      nome_do_arquivo: "politica-de-troca.md",
      ...extra,
    });

  it("guarda o arquivo no bucket da tela, cadastra o documento e pede a indexação como a tela pede", async () => {
    const r = await importar();

    expect(r).toMatchObject({ desfecho: "criou", nome: "Política de troca", indexacao_habilitada: true });
    expect(r.situacao_da_indexacao).toContain("na fila");
    expect(r.nada_foi_enviado).toContain("Nenhuma mensagem foi enviada");

    expect(banco.arquivos).toHaveLength(1);
    expect(banco.arquivos[0]).toMatchObject({ bucket: BUCKET_DE_CONHECIMENTO, contentType: "text/markdown" });
    expect(banco.arquivos[0]!.caminho).toMatch(new RegExp(`^${ORG}/[0-9a-f-]{36}\\.md$`));
    // A conferência de que o arquivo é legível roda sobre o que foi guardado.
    expect(extrairSpy).toHaveBeenCalledWith(banco.arquivos[0]!.caminho, "md");

    const fonte = banco.tabela("ai_knowledge_sources")[0]!;
    expect(fonte).toMatchObject({
      organization_id: ORG,
      source_type: "documento",
      name: "Política de troca",
      status: "ready",
      is_active: true,
    });
    expect(fonte.source_metadata).toMatchObject({
      filename: "politica-de-troca.md",
      blob_path: banco.arquivos[0]!.caminho,
      ext: "md",
      uploaded_by: AUTOR,
      origem: "mcp_plataforma",
    });
    expect(String((fonte.source_metadata as { sha256: string }).sha256)).toMatch(/^[0-9a-f]{64}$/);

    // O MESMO evento da tela: é ele que acorda o indexador.
    expect(banco.chamadasRpc).toEqual([
      {
        nome: "emit_event",
        args: {
          p_event_type: "knowledge_source.updated",
          p_entity_kind: "ai_knowledge_source",
          p_entity_id: fonte.id,
          p_payload: { knowledge_source_id: fonte.id, agent_id: null, source_type: "documento" },
          p_organization_id: ORG,
        },
      },
    ]);
  });

  it("repetir com o mesmo nome e o mesmo conteúdo responde 'já estava': sem arquivo, sem linha e sem evento novos", async () => {
    await importar();
    const r = await importar({ nome: "  política de TROCA " });
    expect(r).toMatchObject({ desfecho: "ja_estava", id: banco.tabela("ai_knowledge_sources")[0]!.id });
    expect(banco.arquivos).toHaveLength(1);
    expect(banco.tabela("ai_knowledge_sources")).toHaveLength(1);
    expect(banco.chamadasRpc).toHaveLength(1);
  });

  it("mesmo nome com OUTRO conteúdo é recusado: a importação não troca o conteúdo de um material", async () => {
    await importar();
    await expect(importar({ arquivo_base64: Buffer.from("Agora a troca é em 7 dias.").toString("base64") })).rejects.toThrow(
      /OUTRO conteúdo/,
    );
    expect(banco.arquivos).toHaveLength(1);
    expect(banco.tabela("ai_knowledge_sources")).toHaveLength(1);
  });

  it("sem chave de indexação no cliente, a resposta DIZ que o material fica parado", async () => {
    temChave.mockResolvedValue(false);
    const r = await importar();
    expect(r.indexacao_habilitada).toBe(false);
    expect(r.situacao_da_indexacao).toContain("parada");
  });

  it("por endereço: o tipo declarado resolve a extensão quando o endereço não a traz", async () => {
    servir({ "https://arquivos.exemplo.invalid/baixar?id=9": arquivo("%PDF-1.4 conteúdo", "application/pdf") });
    const r = await importarConhecimento(ctx(), {
      organization_id: ORG,
      nome: "Catálogo",
      arquivo_url: "https://arquivos.exemplo.invalid/baixar?id=9",
    });
    expect(r.desfecho).toBe("criou");
    expect(banco.arquivos[0]).toMatchObject({ contentType: "application/pdf" });
    expect(banco.arquivos[0]!.caminho).toMatch(/\.pdf$/);
    // O ENDEREÇO não é guardado: pode carregar um token de acesso.
    expect(JSON.stringify(banco.tabela("ai_knowledge_sources")[0])).not.toContain("arquivos.exemplo.invalid");
  });

  it("página da web, Excel e tipo desconhecido são recusados com o caminho de saída", async () => {
    servir({
      "https://arquivos.exemplo.invalid/sobre": arquivo("<html><body>Quem somos</body></html>", "text/html; charset=utf-8"),
    });
    await expect(
      importarConhecimento(ctx(), { organization_id: ORG, nome: "Site", arquivo_url: "https://arquivos.exemplo.invalid/sobre" }),
    ).rejects.toThrow(/PÁGINA da web/);
    await expect(importar({ nome_do_arquivo: "tabela.xlsx" })).rejects.toThrow(/CSV UTF-8/);
    await expect(importar({ nome_do_arquivo: "foto.png" })).rejects.toThrow(/PDF, Markdown/);
    expect(banco.arquivos).toHaveLength(0);
    expect(banco.tabela("ai_knowledge_sources")).toHaveLength(0);
  });

  it("arquivo ilegível (PDF só de imagem) é recusado na hora, e o que foi guardado é apagado", async () => {
    extrairSpy.mockRejectedValueOnce(new ErroDeExtracao("não consegui extrair texto deste PDF."));
    await expect(importar({ nome_do_arquivo: "escaneado.pdf" })).rejects.toThrow(/não pôde ser lido.*extrair texto/);
    expect(banco.arquivos).toHaveLength(0);
    expect(banco.tabela("ai_knowledge_sources")).toHaveLength(0);
    expect(banco.chamadasRpc).toEqual([]);
  });

  it("a linha não entrou: o arquivo guardado não fica órfão no bucket", async () => {
    banco.falharNaProximaEscrita("ai_knowledge_sources", { message: "falha simulada" });
    await expect(importar()).rejects.toThrow(/não consegui registrar/);
    expect(banco.arquivos).toHaveLength(0);
  });

  it("organização inexistente e nome ausente: recusa antes de baixar ou guardar", async () => {
    await expect(importar({ organization_id: "00000000-0000-4000-8000-00000000dead" })).rejects.toThrow(/plataforma_listar_clientes/);
    await expect(importar({ nome: "" })).rejects.toThrow(/`nome` é obrigatório/);
    await expect(importar({ nome: "x" })).rejects.toThrow(/2 a 120/);
    expect(banco.arquivos).toHaveLength(0);
  });

  it("a auditoria e a redação não carregam o conteúdo nem o endereço do arquivo", async () => {
    await importar();
    const linha = auditSpy.mock.lastCall![0] as { action: string; metadata: Record<string, unknown> };
    expect(linha).toMatchObject({ action: "plataforma.importacao", organizationId: ORG });
    expect(linha.metadata).toMatchObject({ tipo: "conhecimento", extensao: "md", veio: "base64", criou: 1 });
    expect(JSON.stringify(linha)).not.toContain("Troca em 30 dias");

    const redigido = FERRAMENTA_IMPORTAR_CONHECIMENTO.redigirParaAuditoria({
      organization_id: ORG,
      nome: "Política de troca",
      nome_do_arquivo: "politica.md",
      arquivo_base64: POLITICA,
      arquivo_url: "https://arquivos.exemplo.invalid/a.md?token=segredo",
    });
    expect(redigido).toEqual({ organization_id: ORG, nome: "Política de troca", nome_do_arquivo: "politica.md" });
  });
});

// ── fotos de produto ──────────────────────────────────────────────────────

describe("importar fotos de produto", () => {
  const importar = (fotos: unknown[]) => importarFotosDeProduto(ctx(), { organization_id: ORG, fotos });
  const produto = (codigo: string) => banco.tabela("catalog_products").find((p) => p.codigo === codigo)!;

  it("baixa a foto, confere o formato pelo conteúdo e a põe no produto achado pelo código", async () => {
    servir({ "https://arquivos.exemplo.invalid/fotos/camiseta.png": arquivo(PNG, "application/octet-stream") });

    const r = await importar([{ produto_codigo: "cam-001", url: "https://arquivos.exemplo.invalid/fotos/camiseta.png" }]);

    expect(r, JSON.stringify(r.itens)).toMatchObject({ total: 1, criou: 1 });
    expect(r.itens[0]).toMatchObject({ id: produto("CAM-001").id });
    const fotos = produto("CAM-001").fotos as string[];
    expect(fotos).toHaveLength(1);
    // O caminho tem a forma exata que o produto exige de uma foto dele.
    expect(fotoPertenceAoProduto(fotos[0]!, ORG, String(produto("CAM-001").id))).toBe(true);
    expect(fotos[0]).toBe(caminhoDaFoto(ORG, String(produto("CAM-001").id), PNG, "png"));
    expect(banco.arquivos[0]).toMatchObject({ bucket: BUCKET_DAS_FOTOS, caminho: fotos[0], contentType: "image/png" });
    // A mesma linha de auditoria da tela.
    expect(auditSpy.mock.calls.map((c) => (c[0] as { action: string }).action)).toEqual([
      "catalog_product.photo_added",
      "plataforma.importacao",
    ]);
  });

  it("repetir a mesma imagem no mesmo produto responde 'já estava' e não sobe nada", async () => {
    servir({ "https://arquivos.exemplo.invalid/fotos/camiseta.png": arquivo(PNG, "image/png") });
    const item = { produto_codigo: "CAM-001", url: "https://arquivos.exemplo.invalid/fotos/camiseta.png" };
    await importar([item]);
    const r = await importar([item]);
    expect(r.itens[0]).toMatchObject({ desfecho: "ja_estava" });
    expect(produto("CAM-001").fotos).toHaveLength(1);
    expect(banco.arquivos).toHaveLength(1);
  });

  it("acha o produto pelo nome; nome repetido é recusado pedindo o código; produto que não existe não é criado", async () => {
    servir({ "https://arquivos.exemplo.invalid/f.jpg": arquivo(JPG, "image/jpeg") });
    const r = await importar([
      { produto_nome: "camiseta azul", url: "https://arquivos.exemplo.invalid/f.jpg" },
      { produto_nome: "Caneca", url: "https://arquivos.exemplo.invalid/f.jpg" },
      { produto_codigo: "NAO-EXISTE", url: "https://arquivos.exemplo.invalid/f.jpg" },
      { url: "https://arquivos.exemplo.invalid/f.jpg" },
      { produto_codigo: "CAM-001" },
    ]);
    expect(r.itens.map((i) => i.desfecho)).toEqual(["criou", "recusou", "recusou", "recusou", "recusou"]);
    expect(r.itens[1]!.motivo).toContain('"CAN-001", "CAN-002"');
    expect(r.itens[2]!.motivo).toContain("não cria produto");
    expect(r.itens[3]!.motivo).toContain("`produto_codigo`");
    expect(r.itens[4]!.motivo).toContain("`url`");
    expect(banco.tabela("catalog_products")).toHaveLength(3);
    expect((produto("CAM-001").fotos as string[])[0]).toMatch(/\.jpg$/);
  });

  it("recusa o que não é JPG nem PNG, o endereço interno e a sexta foto; um item ruim não derruba os outros", async () => {
    servir({
      "https://arquivos.exemplo.invalid/ok.png": arquivo(PNG, "image/png"),
      "https://arquivos.exemplo.invalid/logo.svg": arquivo("<svg xmlns='http://www.w3.org/2000/svg'/>", "image/png"),
    });
    produto("CAN-001").fotos = Array.from({ length: MAXIMO_DE_FOTOS }, (_, i) => `${ORG}/x/foto-${i}.png`);

    const r = await importar([
      { produto_codigo: "CAM-001", url: "https://arquivos.exemplo.invalid/logo.svg" },
      { produto_codigo: "CAM-001", url: "https://10.0.0.5/foto.png" },
      { produto_codigo: "CAN-001", url: "https://arquivos.exemplo.invalid/ok.png" },
      { produto_codigo: "CAM-001", url: "https://arquivos.exemplo.invalid/ok.png" },
    ]);

    expect(r.itens.map((i) => i.desfecho)).toEqual(["recusou", "recusou", "recusou", "criou"]);
    expect(r.itens[0]!.motivo).toContain("JPG nem PNG");
    expect(r.itens[1]!.motivo).toContain("interno");
    expect(r.itens[2]!.motivo).toContain(`já tem ${MAXIMO_DE_FOTOS} fotos`);
    expect(produto("CAM-001").fotos).toHaveLength(1);
  });

  it("a linha do produto não aceitou a foto: o arquivo não fica órfão no bucket", async () => {
    servir({ "https://arquivos.exemplo.invalid/ok.png": arquivo(PNG, "image/png") });
    banco.falharNaProximaEscrita("catalog_products", { message: "falha simulada" });
    const r = await importar([{ produto_codigo: "CAM-001", url: "https://arquivos.exemplo.invalid/ok.png" }]);
    expect(r.itens[0]).toMatchObject({ desfecho: "recusou" });
    expect(banco.arquivos).toHaveLength(0);
    expect(produto("CAM-001").fotos).toEqual([]);
  });

  it("organização inexistente e lista acima do teto: recusa a chamada inteira", async () => {
    await expect(
      importarFotosDeProduto(ctx(), { organization_id: "00000000-0000-4000-8000-00000000dead", fotos: [{ produto_codigo: "X", url: "https://a" }] }),
    ).rejects.toThrow(/plataforma_listar_clientes/);
    const demais = Array.from({ length: TETO_DE_FOTOS_POR_CHAMADA + 1 }, () => ({ produto_codigo: "CAM-001", url: "https://a" }));
    await expect(importar(demais)).rejects.toThrow(new RegExp(`teto é ${TETO_DE_FOTOS_POR_CHAMADA}`));
  });
});

// ── modelo de proposta ────────────────────────────────────────────────────

describe("importar modelo de proposta", () => {
  const SECOES = [
    { id: "apresentacao", title: "Apresentação", titleEs: null, body: "Proposta para {{client.company_or_name}}.", bodyEs: null, required: true, conditional: false },
    { id: "investimento", title: "Investimento", titleEs: null, body: "Total: {{investment.total_formatted}}.", bodyEs: null, required: true, conditional: false },
  ];
  const PROPOSTA = Buffer.from("Proposta comercial da empresa. ".repeat(10)).toString("base64");
  const importar = (extra: Record<string, unknown> = {}) =>
    importarModeloDeProposta(ctx(), {
      organization_id: ORG,
      nome: "Site institucional",
      arquivo_base64: PROPOSTA,
      nome_do_arquivo: "proposta.txt",
      ...extra,
    });

  beforeEach(() => {
    gerarModelo.mockResolvedValue({ nome: "Nome sugerido pela IA", sections: SECOES, sectionOrder: SECOES.map((s) => s.id) });
  });

  it("lê o arquivo, pede o modelo à IA, valida e grava a versão 1 com o nome que quem migra escolheu", async () => {
    const r = await importar({ descricao: "Para sites de até dez páginas." });

    expect(r).toMatchObject({ desfecho: "criou", slug: "empresa_site_institucional", nome: "Site institucional", secoes: 2 });
    expect(gerarModelo).toHaveBeenCalledOnce();
    expect(gerarModelo.mock.lastCall![0]).toMatchObject({ tenantId: ORG });
    expect(banco.tabela("proposal_templates")).toHaveLength(1);
    expect(banco.tabela("proposal_templates")[0]).toMatchObject({
      organization_id: ORG,
      slug: "empresa_site_institucional",
      version: 1,
      base_slug: null,
      nome: "Site institucional",
      descricao: "Para sites de até dez páginas.",
      is_active: true,
      section_order: ["apresentacao", "investimento"],
    });
    // As três linhas: as duas da tela (importou, salvou) e a da importação.
    expect(auditSpy.mock.calls.map((c) => (c[0] as { action: string }).action)).toEqual([
      "proposal_template.imported",
      "proposal_template.saved",
      "plataforma.importacao",
    ]);
  });

  it("repetir com o mesmo nome responde 'já estava' SEM chamar a IA de novo", async () => {
    await importar();
    const r = await importar({ nome: "site INSTITUCIONAL" });
    expect(r).toMatchObject({ desfecho: "ja_estava", slug: "empresa_site_institucional" });
    expect(gerarModelo).toHaveBeenCalledOnce();
    expect(banco.tabela("proposal_templates")).toHaveLength(1);
  });

  it("com as Propostas desligadas no cliente, recusa antes de ler o arquivo e de gastar IA", async () => {
    capacidades.mockResolvedValue([]);
    await expect(importar()).rejects.toThrow(/Propostas estão desligadas/);
    expect(gerarModelo).not.toHaveBeenCalled();
  });

  it("Word, tipo que não é texto, arquivo sem texto e PDF escaneado são recusados com a saída", async () => {
    await expect(importar({ nome_do_arquivo: "proposta.docx" })).rejects.toThrow(/Salvar como.*PDF/);
    await expect(importar({ nome_do_arquivo: "tabela.csv" })).rejects.toThrow(/PDF, Markdown/);
    await expect(importar({ arquivo_base64: Buffer.from("curto").toString("base64") })).rejects.toThrow(/Não encontrei texto/);
    const { PdfExtractError } = await import("@/lib/ai/rag/extractors/pdf");
    extrairPdf.mockRejectedValueOnce(new PdfExtractError("sem texto"));
    await expect(importar({ nome_do_arquivo: "escaneado.pdf" })).rejects.toThrow(/PDF escaneado/);
    expect(gerarModelo).not.toHaveBeenCalled();
    expect(banco.tabela("proposal_templates")).toHaveLength(0);
  });

  it("modelo que a IA montou torto não é gravado, e a recusa diz o que há de errado", async () => {
    gerarModelo.mockResolvedValue({
      nome: "x",
      sections: [{ ...SECOES[0]!, body: "Olá {{client.name" }],
      sectionOrder: ["apresentacao"],
    });
    await expect(importar()).rejects.toThrow(/variável sem fechar/);
    expect(banco.tabela("proposal_templates")).toHaveLength(0);
  });

  it("IA indisponível ou sem orçamento vira recusa legível, não erro cru", async () => {
    gerarModelo.mockRejectedValue(new LlmBudgetExceededError());
    await expect(importar()).rejects.toThrow(/não está disponível para este cliente/);
    gerarModelo.mockResolvedValue(null);
    await expect(importar()).rejects.toThrow(/não conseguiu dividir/);
    expect(banco.tabela("proposal_templates")).toHaveLength(0);
  });

  it("organização inexistente e nome fora do tamanho: recusa a chamada", async () => {
    await expect(importar({ organization_id: "00000000-0000-4000-8000-00000000dead" })).rejects.toThrow(/plataforma_listar_clientes/);
    await expect(importar({ nome: "x" })).rejects.toThrow(/2 a 80/);
    await expect(importar({ nome: "y".repeat(81) })).rejects.toThrow(/2 a 80/);
  });
});

// ── a catraca: os números copiados das rotas continuam batendo ────────────

describe("os tetos e os tipos da importação são os MESMOS das rotas da tela", () => {
  const ler = (caminho: string) => readFileSync(join(process.cwd(), caminho), "utf8");

  it("conhecimento: teto de 20 MB e o tipo por extensão de `sources/upload`", () => {
    const rota = ler("app/api/v1/ai/knowledge/sources/upload/route.ts");
    expect(TAMANHO_MAXIMO_DO_DOCUMENTO).toBe(20 * 1024 * 1024);
    expect(rota, "o teto da rota mudou: acerte TAMANHO_MAXIMO_DO_DOCUMENTO").toContain("const TAMANHO_MAXIMO = 20 * 1024 * 1024;");
    for (const [extensao, tipo] of Object.entries(MIME_POR_EXTENSAO)) {
      expect(rota, `o tipo de .${extensao} mudou na rota: acerte MIME_POR_EXTENSAO`).toContain(`${extensao}: "${tipo}"`);
    }
    // A linha que a rota grava e o evento que ela emite: os mesmos da ferramenta.
    for (const trecho of ['source_type: "documento"', 'status: "ready"', '"knowledge_source.updated"', "uploaded_by", "blob_path"]) {
      expect(rota, `a rota de upload deixou de ter \`${trecho}\`: confira importacao/conhecimento.ts`).toContain(trecho);
    }
  });

  it("modelo de proposta: teto de 5 MB de `proposal-templates/importar`", () => {
    const rota = ler("app/api/v1/settings/proposal-templates/importar/route.ts");
    expect(TAMANHO_MAXIMO_DA_PROPOSTA).toBe(5 * 1024 * 1024);
    expect(rota, "o teto da rota mudou: acerte TAMANHO_MAXIMO_DA_PROPOSTA").toContain("const TAMANHO_MAXIMO = 5 * 1024 * 1024;");
    expect(rota).toContain("gerarModeloDoTexto");
    expect(ler("app/api/v1/settings/proposal-templates/route.ts")).toContain("slugDaEmpresa(nome)");
  });

  it("fotos: os tetos vêm de `lib/catalogo/fotos`, o mesmo módulo da rota", () => {
    expect(TAMANHO_MAXIMO_DA_FOTO).toBe(5 * 1024 * 1024);
    expect(MAXIMO_DE_FOTOS).toBe(5);
    const ferramenta = ler("lib/mcp-plataforma/importacao/fotos-de-produto.ts");
    const rota = ler("app/api/v1/products/[id]/fotos/route.ts");
    for (const nome of ["farejarTipo", "extensaoDe", "MAXIMO_DE_FOTOS", "TAMANHO_MAXIMO_DA_FOTO", "BUCKET_DAS_FOTOS"]) {
      expect(ferramenta).toContain(nome);
      expect(rota).toContain(nome);
    }
  });

  it("o download usa as duas guardas dos webhooks de saída, e nunca segue redirecionamento sozinho", () => {
    const download = ler("lib/mcp-plataforma/importacao/download.ts");
    expect(download).toContain('from "@/lib/automation/outbound-url"');
    expect(download).toContain('from "@/lib/automation/outbound-ip"');
    expect(download).toContain('redirect: "manual"');
    expect(download).not.toMatch(/redirect:\s*"follow"/);
  });
});
