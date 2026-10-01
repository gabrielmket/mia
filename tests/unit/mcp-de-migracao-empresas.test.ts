/**
 * IMPORTAR EMPRESAS pelo MCP de plataforma (`plataforma_importar_empresas`).
 *
 * O que se mede aqui: a tabela certa (`crm_empresas`, a das fichas e dos
 * cartões), a deduplicação por CNPJ e por nome, os dois modos de reexecução e a
 * recusa que ensina. Todo dado é fictício.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOR, ORG, OUTRA_ORG, TOKEN, organizacaoDeTeste, type BancoDaMigracao } from "../helpers/banco-da-migracao";

const auditSpy = vi.fn();
vi.mock("@/lib/audit", async (original) => ({
  ...(await original<typeof import("@/lib/audit")>()),
  audit: async (entrada: unknown) => {
    auditSpy(entrada);
  },
}));

const { importarEmpresas, TETO_DE_EMPRESAS, FERRAMENTA_IMPORTAR_EMPRESAS } = await import(
  "@/lib/mcp-plataforma/importacao/empresas"
);

let banco: BancoDaMigracao;
const ctx = () => ({ admin: banco.cliente as never, autorUserId: AUTOR, tokenId: TOKEN });
const importar = (empresas: unknown[], extra: Record<string, unknown> = {}) =>
  importarEmpresas(ctx(), { organization_id: ORG, empresas, ...extra });

beforeEach(() => {
  banco = organizacaoDeTeste();
  auditSpy.mockClear();
});

describe("importar empresas: o caminho feliz", () => {
  it("grava em crm_empresas, com o CNPJ só em dígitos e a autoria de quem criou o token", async () => {
    const r = await importar([
      {
        nome: "Padaria Modelo LTDA",
        cnpj: "12.345.678/0001-90",
        telefone: "(10) 3000-0001",
        email: "contato@padaria.exemplo.invalid",
        etiquetas: ["atacado"],
        campos: { segmento: "alimentação" },
      },
    ]);

    expect(r).toMatchObject({ total: 1, criou: 1, atualizou: 0, ja_estava: 0, recusou: 0 });
    expect(r.organizacao).toEqual({ id: ORG, nome: "Cliente em Migração", demonstracao: false });
    expect(r.nada_foi_enviado).toContain("Nenhuma mensagem foi enviada");
    expect(banco.tabela("crm_empresas")).toHaveLength(1);
    expect(banco.tabela("crm_empresas")[0]).toMatchObject({
      organization_id: ORG,
      nome: "Padaria Modelo LTDA",
      cnpj: "12345678000190",
      tags: ["atacado"],
      custom_fields: { segmento: "alimentação" },
      created_by_user_id: AUTOR,
    });
    // A outra representação de empresa do produto (`companies`, do módulo B2B) não é tocada.
    expect(banco.tabela("companies")).toHaveLength(0);
    // Importar empresa não emite evento nenhum.
    expect(banco.chamadasRpc).toEqual([]);
  });

  it("empresa sem CNPJ entra com o campo NULO, nunca vazio (o índice único trata '' como valor)", async () => {
    await importar([{ nome: "Oficina Exemplo ME" }, { nome: "Clínica Fictícia" }]);
    expect(banco.tabela("crm_empresas").map((e) => e.cnpj)).toEqual([null, null]);
  });
});

describe("importar empresas: reexecução sem duplicar", () => {
  it("a segunda rodada da mesma lista responde 'já estava' e não grava nada", async () => {
    const lista = [
      { nome: "Padaria Modelo LTDA", cnpj: "12.345.678/0001-90", etiquetas: ["atacado"] },
      { nome: "Oficina Exemplo ME", telefone: "(10) 3000-0002" },
    ];
    await importar(lista);
    const escritasAntes = banco.escritas.length;

    const r = await importar(lista);

    expect(r).toMatchObject({ criou: 0, atualizou: 0, ja_estava: 2, recusou: 0 });
    expect(banco.escritas).toHaveLength(escritasAntes);
    expect(banco.tabela("crm_empresas")).toHaveLength(2);
  });

  it("CNPJ com e sem pontuação é a MESMA empresa", async () => {
    await importar([{ nome: "Padaria Modelo LTDA", cnpj: "12.345.678/0001-90" }]);
    const r = await importar([{ nome: "Padaria Modelo (matriz)", cnpj: "12345678000190" }]);

    expect(r.itens[0]).toMatchObject({ desfecho: "ja_estava" });
    expect(banco.tabela("crm_empresas")).toHaveLength(1);
    // O nome diferente não foi aplicado, e a resposta diz como aplicar.
    expect(r.itens[0]!.avisos?.join(" ")).toContain('quando_ja_existe: "atualizar"');
  });

  it("sem CNPJ, casa pelo nome sem diferenciar caixa, acento nem sufixo societário", async () => {
    await importar([{ nome: "Padaria do Zé LTDA" }]);
    const r = await importar([{ nome: "padaria do ze", telefone: "(10) 3000-0003" }]);

    expect(r.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(banco.tabela("crm_empresas")).toHaveLength(1);
    // O nome guardado continua o que já estava; o telefone, que estava vazio, foi preenchido.
    expect(banco.tabela("crm_empresas")[0]).toMatchObject({ nome: "Padaria do Zé LTDA", telefone: "(10) 3000-0003" });
  });

  it("a mesma empresa duas vezes na MESMA lista vira uma ficha só", async () => {
    const r = await importar([
      { nome: "Padaria Modelo LTDA", cnpj: "12.345.678/0001-90" },
      { nome: "Padaria Modelo", cnpj: "12345678000190", site: "https://padaria.exemplo.invalid" },
    ]);
    expect(r.itens.map((i) => i.desfecho)).toEqual(["criou", "atualizou"]);
    expect(banco.tabela("crm_empresas")).toHaveLength(1);
  });

  it("nome igual com CNPJ DIFERENTE é outra empresa (matriz e filial)", async () => {
    await importar([{ nome: "Rede Exemplo", cnpj: "11.111.111/0001-11" }]);
    const r = await importar([{ nome: "Rede Exemplo", cnpj: "11.111.111/0002-00" }]);
    expect(r.itens[0]).toMatchObject({ desfecho: "criou" });
    expect(banco.tabela("crm_empresas")).toHaveLength(2);
  });

  it("o CNPJ que faltava é preenchido; o que já existe NUNCA é trocado, em modo nenhum", async () => {
    await importar([{ nome: "Oficina Exemplo ME" }]);
    const preencheu = await importar([{ nome: "Oficina Exemplo", cnpj: "22.222.222/0001-22" }]);
    expect(preencheu.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(banco.tabela("crm_empresas")[0]!.cnpj).toBe("22222222000122");
    expect(banco.tabela("crm_empresas")).toHaveLength(1);
  });

  it("'completar' só preenche o vazio; 'atualizar' substitui o que veio; etiqueta só soma", async () => {
    await importar([{ nome: "Padaria Modelo LTDA", cnpj: "12345678000190", telefone: "(10) 3000-0001", etiquetas: ["atacado"] }]);

    const completar = await importar([
      { nome: "Padaria Modelo LTDA", cnpj: "12345678000190", telefone: "(10) 3000-9999", site: "https://padaria.exemplo.invalid", etiquetas: ["vip"] },
    ]);
    expect(completar.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(completar.itens[0]!.avisos?.join(" ")).toContain("telefone");
    expect(banco.tabela("crm_empresas")[0]).toMatchObject({
      telefone: "(10) 3000-0001",
      site: "https://padaria.exemplo.invalid",
      tags: ["atacado", "vip"],
    });

    const atualizar = await importar(
      [{ nome: "Padaria Modelo LTDA", cnpj: "12345678000190", telefone: "(10) 3000-9999" }],
      { quando_ja_existe: "atualizar" },
    );
    expect(atualizar.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(banco.tabela("crm_empresas")[0]).toMatchObject({
      telefone: "(10) 3000-9999",
      // O que NÃO veio na lista fica como estava: importar nunca apaga.
      site: "https://padaria.exemplo.invalid",
      tags: ["atacado", "vip"],
    });
  });

  it("empresa fundida (lápide) não é casada: o nome dela volta a ser uma empresa nova", async () => {
    banco.tabela("crm_empresas").push({
      id: "00000000-0000-4000-8000-00000000f001",
      organization_id: ORG,
      nome: "Padaria Antiga",
      cnpj: null,
      mesclada_em: "2026-01-01T00:00:00Z",
      tags: [],
      custom_fields: {},
    });
    const r = await importar([{ nome: "Padaria Antiga" }]);
    expect(r.itens[0]).toMatchObject({ desfecho: "criou" });
  });

  it("a empresa de OUTRA organização com o mesmo CNPJ não é a mesma", async () => {
    banco.tabela("crm_empresas").push({
      id: "00000000-0000-4000-8000-00000000f002",
      organization_id: OUTRA_ORG,
      nome: "Padaria Modelo LTDA",
      cnpj: "12345678000190",
      mesclada_em: null,
      tags: [],
      custom_fields: {},
    });
    const r = await importar([{ nome: "Padaria Modelo LTDA", cnpj: "12.345.678/0001-90" }]);
    expect(r.itens[0]).toMatchObject({ desfecho: "criou" });
    expect(banco.tabela("crm_empresas").filter((e) => e.organization_id === ORG)).toHaveLength(1);
  });
});

describe("importar empresas: a recusa que ensina", () => {
  it("um item ruim no meio não derruba o lote: os bons entram e o ruim volta com posição, campo e exemplo", async () => {
    const r = await importar([
      { nome: "Padaria Modelo LTDA" },
      { nome: "Empresa com CNPJ torto", cnpj: "123" },
      { nome: "Oficina Exemplo ME" },
    ]);

    expect(r).toMatchObject({ total: 3, criou: 2, recusou: 1 });
    expect(r.itens[1]).toMatchObject({ posicao: 2, desfecho: "recusou" });
    expect(r.itens[1]!.motivo).toContain("Item 2");
    expect(r.itens[1]!.motivo).toContain("`cnpj`");
    expect(r.itens[1]!.motivo).toContain("14 dígitos");
    expect(r.itens[1]!.motivo).toContain("Exemplo que passa");
    expect(banco.tabela("crm_empresas").map((e) => e.nome)).toEqual(["Padaria Modelo LTDA", "Oficina Exemplo ME"]);
  });

  it("recusa empresa sem nome, e-mail inválido, item que não é objeto e nome curto demais sem CNPJ", async () => {
    const r = await importar([
      { cnpj: "12.345.678/0001-90" },
      { nome: "Empresa", email: "isto-nao-e-email" },
      "Padaria solta",
      { nome: "AB" },
      { nome: "Etiquetas tortas", etiquetas: "atacado" },
    ]);
    expect(r.recusou).toBe(5);
    expect(r.itens[0]!.motivo).toContain("`nome`");
    expect(r.itens[1]!.motivo).toContain("`email`");
    expect(r.itens[1]!.motivo).toContain("E-mail inválido");
    expect(r.itens[2]!.motivo).toContain("objeto");
    expect(r.itens[3]!.motivo).toContain("curto demais");
    expect(r.itens[4]!.motivo).toContain("`etiquetas`");
    expect(r.itens[4]!.motivo).toContain("lista");
    expect(banco.tabela("crm_empresas")).toHaveLength(0);
  });

  it("organização que não existe: recusa a chamada inteira e diz como achar o id", async () => {
    await expect(
      importarEmpresas(ctx(), { organization_id: "00000000-0000-4000-8000-00000000dead", empresas: [{ nome: "Padaria" }] }),
    ).rejects.toThrow(/plataforma_listar_clientes/);
    await expect(importarEmpresas(ctx(), { organization_id: "cliente-x", empresas: [{ nome: "Padaria" }] })).rejects.toThrow(
      /organization_id/,
    );
    expect(banco.tabela("crm_empresas")).toHaveLength(0);
  });

  it("lista vazia, lista que não é lista e lista acima do teto: recusa antes de gravar, dizendo o que fazer", async () => {
    await expect(importar([])).rejects.toThrow(/pelo menos 1 item/);
    await expect(importarEmpresas(ctx(), { organization_id: ORG, empresas: "Padaria" })).rejects.toThrow(/lista/);
    const demais = Array.from({ length: TETO_DE_EMPRESAS + 1 }, (_, i) => ({ nome: `Empresa ${i}` }));
    await expect(importar(demais)).rejects.toThrow(new RegExp(`teto é ${TETO_DE_EMPRESAS}`));
    await expect(importar(demais)).rejects.toThrow(/Divida a lista/);
    expect(banco.tabela("crm_empresas")).toHaveLength(0);
  });

  it("modo desconhecido é recusado, em vez de valer como 'atualizar'", async () => {
    await expect(importar([{ nome: "Padaria Modelo" }], { quando_ja_existe: "sobrescrever" })).rejects.toThrow(/completar/);
  });
});

describe("importar empresas: o rastro", () => {
  it("uma linha de auditoria por chamada, dentro da organização, com contagens e ids e sem o nome de ninguém", async () => {
    await importar([{ nome: "Padaria Modelo LTDA", cnpj: "12.345.678/0001-90", email: "contato@padaria.exemplo.invalid" }], {
      origem: "RD Station",
    });

    expect(auditSpy).toHaveBeenCalledOnce();
    const linha = auditSpy.mock.lastCall![0] as { action: string; organizationId: string; metadata: Record<string, unknown> };
    expect(linha).toMatchObject({ action: "plataforma.importacao", organizationId: ORG, actorUserId: AUTOR });
    expect(linha.metadata).toMatchObject({
      via: "mcp_plataforma",
      ferramenta: "plataforma_importar_empresas",
      tipo: "empresas",
      origem: "rd_station",
      token_id: TOKEN,
      total: 1,
      criou: 1,
    });
    expect(linha.metadata.ids_criados).toEqual([banco.tabela("crm_empresas")[0]!.id]);
    const texto = JSON.stringify(linha);
    for (const dado of ["Padaria", "12345678000190", "exemplo.invalid"]) expect(texto).not.toContain(dado);
  });

  it("a redação dos argumentos troca a lista pela contagem", () => {
    const redigido = FERRAMENTA_IMPORTAR_EMPRESAS.redigirParaAuditoria({
      organization_id: ORG,
      origem: "rdstation",
      empresas: [{ nome: "Padaria Modelo LTDA", email: "contato@padaria.exemplo.invalid" }],
      campo_que_ninguem_declarou: "Ana Souza",
    });
    expect(redigido).toEqual({ organization_id: ORG, origem: "rdstation", empresas: { itens: 1 } });
  });
});
