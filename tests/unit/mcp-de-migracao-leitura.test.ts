/**
 * VER A IMPORTAÇÃO (`plataforma_ver_importacao`) e as ÁREAS que alimentam o
 * checklist da implantação (`AREAS_DE_IMPORTACAO`).
 *
 * O que se mede: os números certos por organização, o que cada área diz que
 * está pronto, o que falta e o que é só pela tela, e que a resposta não carrega
 * nome, telefone nem e-mail de contato.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOR, ORG, OUTRA_ORG, TOKEN, organizacaoDeTeste, type BancoDaMigracao, type Linha } from "../helpers/banco-da-migracao";

let banco: BancoDaMigracao;

const temChave = vi.fn(async () => true);
vi.mock("@/lib/ai/embeddings/chave", () => ({ temChaveDeEmbedding: () => temChave() }));
const capacidades = vi.fn(async () => ["propostas"]);
vi.mock("@/lib/organizacao/capacidades", () => ({ capacidadesDaOrganizacao: () => capacidades() }));

const { verImportacao, AREAS_DE_IMPORTACAO, FERRAMENTA_VER_IMPORTACAO } = await import("@/lib/mcp-plataforma/importacao/leitura");

const ctx = () => ({ admin: banco.cliente as never, autorUserId: AUTOR, tokenId: TOKEN, requestId: "req-teste" });

interface Retrato {
  organizacao: { id: string };
  areas: Array<{ chave: string; rotulo: string; pronto: string[]; falta: string[]; so_pela_tela: string[]; numeros: Record<string, unknown> }>;
  ultimos_trabalhos_de_importacao: Array<Record<string, unknown>>;
  automacoes_por_tempo_ativas: { regras: Array<Record<string, unknown>>; aviso: string };
}
const ver = async () => (await verImportacao(ctx(), { organization_id: ORG })) as Retrato;
const area = (r: Retrato, chave: string) => r.areas.find((a) => a.chave === chave)!;

/** Datas relativas a agora: a lista de trabalhos só olha os últimos 90 dias. */
const haDias = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();

let seq = 0;
function contato(extra: Linha): Linha {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    organization_id: ORG,
    kind: "person",
    is_anonymized: false,
    is_merged_into: null,
    is_blocked: false,
    phone_number: null,
    email: null,
    email_normalized: null,
    empresa_id: null,
    source: "manual",
    source_metadata: {},
    created_at: `2026-01-${String(seq).padStart(2, "0")}T00:00:00Z`,
    last_activity_at: null,
    ...extra,
  };
}

beforeEach(() => {
  seq = 0;
  temChave.mockReset().mockResolvedValue(true);
  capacidades.mockReset().mockResolvedValue(["propostas"]);
  banco = organizacaoDeTeste({
    contacts: [
      contato({ name: "Ana Souza", phone_number: "+5510991110001", source: "importacao:crm-antigo", empresa_id: "e1" }),
      // a mesma pessoa, gravada pelo WhatsApp sem o nono dígito: duplicata suspeita
      contato({ display_name: "Ana", phone_number: "+551091110001", source: "whatsapp" }),
      contato({ name: "Bruno Lima", email: "bruno.lima@exemplo.invalid", email_normalized: "bruno.lima@exemplo.invalid", source: "importacao:crm-antigo" }),
      contato({ name: "Carla Dias", phone_number: "+5510992220002", is_blocked: true, source: "importacao:crm-antigo" }),
      contato({ name: "Sem nada", source: "manual" }),
      // fora da conta: fundido, anonimizado, registro técnico de grupo e outra organização
      contato({ name: "Fundido", phone_number: "+5510995550005", is_merged_into: "x" }),
      contato({ name: "Anonimizado", is_anonymized: true }),
      contato({ name: "Grupo", kind: "whatsapp_group" }),
      contato({ name: "Vizinho", organization_id: OUTRA_ORG, phone_number: "+5510996660006" }),
    ],
    crm_empresas: [
      { id: "e1", organization_id: ORG, nome: "Padaria Modelo LTDA", cnpj: "12345678000190", mesclada_em: null },
      { id: "e2", organization_id: ORG, nome: "Oficina Exemplo ME", cnpj: null, mesclada_em: null },
      { id: "e3", organization_id: ORG, nome: "Lápide", cnpj: null, mesclada_em: "2026-01-01T00:00:00Z" },
      { id: "e4", organization_id: OUTRA_ORG, nome: "Empresa vizinha", cnpj: null, mesclada_em: null },
    ],
    crm_leads: [
      { id: "l1", organization_id: ORG, status: "open", source: "importacao:crm-antigo", external_id: "n-1" },
      { id: "l2", organization_id: ORG, status: "won", source: "importacao:crm-antigo", external_id: "n-2" },
      { id: "l3", organization_id: ORG, status: "lost", source: "importacao:crm-antigo", external_id: "n-3" },
      { id: "l4", organization_id: ORG, status: "won", source: "importacao:planilha", external_id: "7" },
      { id: "l5", organization_id: ORG, status: "open", source: "whatsapp", external_id: null },
      { id: "l6", organization_id: OUTRA_ORG, status: "open", source: "importacao:crm-antigo", external_id: "n-1" },
    ],
    ai_knowledge_sources: [
      { id: "k1", organization_id: ORG, name: "Política de troca", source_type: "documento", is_active: true, last_index_status: "success", chunks_count: 12, created_at: "2026-02-01" },
      { id: "k2", organization_id: ORG, name: "Tabela de preços", source_type: "documento", is_active: true, last_index_status: "failed", last_index_error: "PDF só de imagem", chunks_count: 0, created_at: "2026-02-02" },
      { id: "k3", organization_id: ORG, name: "Manual", source_type: "documento", is_active: true, last_index_status: null, chunks_count: 0, created_at: "2026-02-03" },
      { id: "k4", organization_id: ORG, name: "Arquivado", source_type: "faq", is_active: false, last_index_status: "success", chunks_count: 3, created_at: "2026-02-04" },
    ],
    catalog_products: [
      { id: "p1", organization_id: ORG, codigo: "CAM-001", nome: "Camiseta Azul", ativo: true, fotos: [`${ORG}/p1/a.png`] },
      { id: "p2", organization_id: ORG, codigo: "CAN-001", nome: "Caneca", ativo: true, fotos: [] },
      { id: "p3", organization_id: ORG, codigo: "OLD-001", nome: "Fora de linha", ativo: false, fotos: [] },
    ],
    proposal_templates: [{ id: "t1", organization_id: ORG, slug: "empresa_site", is_active: true }],
    api_audit_log: [
      {
        id: "a1",
        organization_id: ORG,
        action: "plataforma.importacao",
        resource_type: "contatos",
        created_at: haDias(1),
        metadata: { via: "mcp_plataforma", tipo: "contatos", origem: "crm-antigo", token_id: TOKEN, total: 3, criou: 3, ids_criados: ["c1", "c2", "c3"] },
      },
      {
        id: "a2",
        organization_id: ORG,
        action: "contacts.imported",
        resource_type: "contact",
        created_at: haDias(2),
        metadata: { actor_type: "user", total_linhas: 40, imported: 38, skipped_duplicates: 2, erros: 0 },
      },
      { id: "a3", organization_id: ORG, action: "lead.created", created_at: haDias(1), metadata: { title: "Negócio de Ana Souza" } },
      { id: "a4", organization_id: OUTRA_ORG, action: "plataforma.importacao", created_at: haDias(1), metadata: { via: "mcp_plataforma", total: 9 } },
      // Importação antiga demais: fica fora da lista.
      { id: "a5", organization_id: ORG, action: "contacts.imported", created_at: haDias(200), metadata: { total_linhas: 7, imported: 7 } },
    ],
    automation_rules: [
      { id: "r1", organization_id: ORG, name: "Cobrar parado", trigger_event: "lead.stage_stale", is_active: true, actions: [{ type: "send_whatsapp_message" }] },
      { id: "r2", organization_id: ORG, name: "Etiqueta de novo", trigger_event: "lead.created", is_active: true, actions: [{ type: "add_tag" }] },
      { id: "r3", organization_id: ORG, name: "Silêncio (pausada)", trigger_event: "lead.silent_for", is_active: false, actions: [{ type: "send_whatsapp_message" }] },
    ],
  });
});

describe("plataforma_ver_importacao: o retrato da base", () => {
  it("é LEITURA: não exige operação no token", () => {
    expect(FERRAMENTA_VER_IMPORTACAO.operacao).toBeNull();
    expect(FERRAMENTA_VER_IMPORTACAO.name).toBe("plataforma_ver_importacao");
  });

  it("conta os contatos vivos da organização: total, sem telefone, bloqueados, com empresa e importados", async () => {
    const n = area(await ver(), "contatos").numeros;
    expect(n).toMatchObject({
      total: 5,
      sem_telefone: 2,
      sem_telefone_e_sem_email: 1,
      bloqueados: 1,
      com_empresa: 1,
      importados: 3,
    });
  });

  it("acha a duplicata do nono dígito, e a devolve como ids, sem nome nem telefone", async () => {
    const r = await ver();
    const duplicatas = area(r, "contatos").numeros.duplicatas_suspeitas as {
      grupos: number;
      contatos_envolvidos: number;
      varreu_tudo: boolean;
      amostra: Array<{ motivos: string[]; ids: string[] }>;
    };
    expect(duplicatas).toMatchObject({ grupos: 1, contatos_envolvidos: 2, varreu_tudo: true });
    expect(duplicatas.amostra[0]!.motivos).toEqual(["telefone"]);
    expect(duplicatas.amostra[0]!.ids).toHaveLength(2);
    expect(area(r, "contatos").falta.join(" ")).toContain("parecem a mesma pessoa");
    expect(area(r, "contatos").so_pela_tela.join(" ")).toContain("Duplicados");
  });

  it("conta as empresas vivas e as sem CNPJ", async () => {
    const a = area(await ver(), "empresas");
    expect(a.numeros).toEqual({ total: 2, sem_cnpj: 1 });
    expect(a.falta.join(" ")).toContain("sem CNPJ");
  });

  it("conta os negócios importados POR ORIGEM, com abertos, ganhos e perdidos", async () => {
    const a = area(await ver(), "negocios");
    expect(a.numeros).toMatchObject({ total: 5, abertos: 2, ganhos: 2, perdidos: 1 });
    expect(a.numeros.importados_por_origem).toEqual([
      { origem: "crm-antigo", total: 3, abertos: 1, ganhos: 1, perdidos: 1 },
      { origem: "planilha", total: 1, abertos: 0, ganhos: 1, perdidos: 0 },
    ]);
    expect(a.pronto.join(" ")).toContain('"crm-antigo"');
  });

  it("mostra cada material ativo com a situação da indexação", async () => {
    const a = area(await ver(), "conhecimento");
    expect(a.numeros).toMatchObject({ total: 3, indexadas: 1, com_falha: 1, aguardando: 1, indexacao_habilitada: true });
    const fontes = a.numeros.fontes as Array<Record<string, unknown>>;
    expect(fontes.find((f) => f.nome === "Tabela de preços")).toMatchObject({ situacao: "failed", erro: "PDF só de imagem" });
    expect(fontes.find((f) => f.nome === "Manual")).toMatchObject({ situacao: "aguardando" });
    expect(a.falta.join(" ")).toContain("falha de indexação");
  });

  it("sem chave de indexação, diz que os materiais estão PARADOS", async () => {
    temChave.mockResolvedValue(false);
    expect(area(await ver(), "conhecimento").falta.join(" ")).toContain("PARADOS");
  });

  it("conta os produtos ATIVOS sem foto e dá a amostra por código", async () => {
    const a = area(await ver(), "fotos_de_produto");
    expect(a.numeros).toMatchObject({ produtos: 2, sem_foto: 1, amostra_sem_foto: [{ codigo: "CAN-001", nome: "Caneca" }] });
    expect(a.falta.join(" ")).toContain("plataforma_importar_fotos_de_produto");
  });

  it("modelos de proposta: diz quando as Propostas estão desligadas no cliente", async () => {
    expect(area(await ver(), "modelos_de_proposta").numeros).toEqual({ propostas_ligadas: true, modelos_proprios: 1 });
    capacidades.mockResolvedValue([]);
    const desligada = area(await ver(), "modelos_de_proposta");
    expect(desligada.numeros.propostas_ligadas).toBe(false);
    expect(desligada.so_pela_tela.join(" ")).toContain("desligadas");
  });

  it("lista os últimos trabalhos de importação, da tela e por MCP, só com números", async () => {
    const trabalhos = (await ver()).ultimos_trabalhos_de_importacao;
    expect(trabalhos).toHaveLength(2);
    expect(trabalhos[0]).toMatchObject({
      acao: "plataforma.importacao",
      por: "mcp_de_plataforma",
      tipo: "contatos",
      origem: "crm-antigo",
      resultado: { total: 3, criou: 3 },
    });
    // A lista de ids e o id do token não saem na resposta.
    expect(JSON.stringify(trabalhos[0])).not.toContain("ids_criados");
    expect(JSON.stringify(trabalhos[0])).not.toContain(TOKEN);
    expect(trabalhos[1]).toMatchObject({ acao: "contacts.imported", por: "tela", resultado: { total_linhas: 40, imported: 38 } });
  });

  it("avisa das automações por TEMPO que estão ativas, porque elas alcançam o que for importado", async () => {
    const r = await ver();
    expect(r.automacoes_por_tempo_ativas.regras).toEqual([
      { id: "r1", nome: "Cobrar parado", gatilho: "lead.stage_stale", acoes: ["send_whatsapp_message"] },
    ]);
    expect(r.automacoes_por_tempo_ativas.aviso).toContain("Importar não dispara nada");
  });

  it("a resposta inteira não carrega nome, telefone nem e-mail de contato", async () => {
    const texto = JSON.stringify(await ver());
    for (const dado of ["Ana", "Souza", "Bruno", "Carla", "99111", "9111-0001", "bruno.lima", "Negócio de"]) {
      expect(texto, `a resposta carrega "${dado}"`).not.toContain(dado);
    }
  });

  it("organização inexistente: recusa dizendo como achar o id", async () => {
    await expect(verImportacao(ctx(), { organization_id: "00000000-0000-4000-8000-00000000dead" })).rejects.toThrow(
      /plataforma_listar_clientes/,
    );
  });
});

describe("AREAS_DE_IMPORTACAO: o que o checklist da implantação recebe", () => {
  it("são seis áreas, na ordem da migração, cada uma com chave, rótulo e a função de situação", () => {
    expect(AREAS_DE_IMPORTACAO.map((a) => a.chave)).toEqual([
      "empresas",
      "contatos",
      "negocios",
      "conhecimento",
      "fotos_de_produto",
      "modelos_de_proposta",
    ]);
    for (const a of AREAS_DE_IMPORTACAO) {
      expect(a.rotulo.length).toBeGreaterThan(3);
      expect(typeof a.situacao).toBe("function");
    }
  });

  it("cada área responde sozinha: pronto, falta e só pela tela", async () => {
    for (const a of AREAS_DE_IMPORTACAO) {
      const situacao = await a.situacao(ctx(), ORG);
      expect(situacao.chave).toBe(a.chave);
      expect(situacao.rotulo).toBe(a.rotulo);
      expect(Array.isArray(situacao.pronto)).toBe(true);
      expect(Array.isArray(situacao.falta)).toBe(true);
      expect(situacao.so_pela_tela.length, `${a.chave} não diz o que é só pela tela`).toBeGreaterThan(0);
      expect(typeof situacao.numeros).toBe("object");
    }
  });

  it("numa organização vazia, cada área diz o que FALTA e com qual ferramenta se resolve", async () => {
    banco = organizacaoDeTeste();
    const faltas = Object.fromEntries(
      await Promise.all(AREAS_DE_IMPORTACAO.map(async (a) => [a.chave, (await a.situacao(ctx(), ORG)).falta.join(" ")] as const)),
    );
    expect(faltas.empresas).toContain("plataforma_importar_empresas");
    expect(faltas.contatos).toContain("plataforma_importar_contatos");
    expect(faltas.negocios).toContain("plataforma_importar_negocios");
    expect(faltas.conhecimento).toContain("plataforma_importar_conhecimento");
    expect(faltas.modelos_de_proposta).toContain("plataforma_importar_modelo_de_proposta");
  });
});
