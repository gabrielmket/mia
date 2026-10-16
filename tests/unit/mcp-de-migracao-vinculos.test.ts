/**
 * VINCULAR PESSOAS A EMPRESAS pelo MCP de plataforma (`plataforma_vincular_pessoas_a_empresas`, .79).
 *
 * A peça nova da empresa única (protótipo aprovado em 15/10/2026) ganha
 * ferramenta no MCP de plataforma na mesma versão: a pessoa em várias empresas,
 * com papel em cada uma, e vários números que são a mesma pessoa. O que se
 * mede aqui: acha contato e empresa como a importação acha, grava pelas portas
 * da 9034 (as mesmas da tela), `completar` não troca o que já estava, repetir
 * não duplica, e a recusa ensina. A prova das regras no banco de verdade
 * (um principal por empresa, o espelho do cartão) é
 * tests/invariants/empresa-unica.test.ts.
 *
 * DDD 10 (forma de DDD, não existe no Brasil) e `@exemplo.invalid`: nenhum dado
 * é de pessoa real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOR, ORG, OUTRA_ORG, TOKEN, organizacaoDeTeste, type BancoDaMigracao } from "../helpers/banco-da-migracao";

vi.mock("@/lib/audit", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  audit: async () => undefined,
}));

const { vincularPessoasAEmpresas, FERRAMENTA_VINCULAR_PESSOAS_A_EMPRESAS, TETO_DE_VINCULOS } = await import(
  "@/lib/mcp-plataforma/importacao/vinculos"
);

const PADARIA = "00000000-0000-4000-8000-00000000e001";
const OFICINA = "00000000-0000-4000-8000-00000000e002";
const VIZINHA = "00000000-0000-4000-8000-00000000e003";
const ANA = "00000000-0000-4000-8000-00000000c001";
const ANA_2 = "00000000-0000-4000-8000-00000000c002";
const BRUNO = "00000000-0000-4000-8000-00000000c003";
const SEM_NOME = "00000000-0000-4000-8000-00000000c004";

let banco: BancoDaMigracao;
const ctx = () => ({ admin: banco.cliente as never, autorUserId: AUTOR, tokenId: TOKEN, requestId: "req-teste" });
const ligar = (vinculos: unknown[], extra: Record<string, unknown> = {}) =>
  vincularPessoasAEmpresas(ctx(), { organization_id: ORG, origem: "crm-antigo", vinculos, ...extra });
const vinculos = () => banco.tabela("company_people");
const contato = (id: string) => banco.tabela("contacts").find((c) => c.id === id)!;

const empresa = (id: string, nome: string, cnpj: string | null, org = ORG) => ({
  id,
  organization_id: org,
  trade_name: nome,
  legal_name: null,
  cnpj: null,
  normalized_cnpj: cnpj,
  extra: null,
});
const pessoaDeContato = (id: string, telefone: string | null, email: string | null, over: Record<string, unknown> = {}) => ({
  id,
  organization_id: ORG,
  name: "Pessoa de Teste",
  phone_number: telefone,
  email,
  email_normalized: email,
  person_id: null,
  empresa_id: null,
  is_anonymized: false,
  is_merged_into: null,
  ...over,
});

beforeEach(() => {
  banco = organizacaoDeTeste({
    companies: [
      empresa(PADARIA, "Padaria Modelo LTDA", "12345678000190"),
      empresa(OFICINA, "Oficina Exemplo ME", null),
      empresa(VIZINHA, "Empresa Vizinha", "99888777000166", OUTRA_ORG),
    ],
    contacts: [
      pessoaDeContato(ANA, "+5510991110001", "ana@exemplo.invalid"),
      pessoaDeContato(ANA_2, "+5510991110009", null),
      pessoaDeContato(BRUNO, null, "bruno@exemplo.invalid"),
      pessoaDeContato(SEM_NOME, "+5510991110077", null, { is_anonymized: true }),
    ],
  });
});

describe("vincular pessoas a empresas: o caminho feliz", () => {
  it("a mesma pessoa em DUAS empresas, com papel em cada uma; a primeira é a do cartão", async () => {
    const r = await ligar([
      { contato_telefone: "(10) 99111-0001", empresa_cnpj: "12.345.678/0001-90", papel: "Decisor", cargo: "Sócia", principal: true },
      { contato_email: "ANA@exemplo.invalid", empresa_nome: "oficina exemplo", papel: "financeiro", cargo: "Contadora externa" },
    ]);

    expect(r).toMatchObject({ total: 2, criou: 2, recusou: 0 });
    expect(vinculos()).toHaveLength(2);
    const pessoa = contato(ANA).person_id;
    expect(vinculos().find((v) => v.company_id === PADARIA)).toMatchObject({ person_id: pessoa, papel: "decisor", job_title: "Sócia", is_primary: true });
    expect(vinculos().find((v) => v.company_id === OFICINA)).toMatchObject({ person_id: pessoa, papel: "financeiro", is_primary: false });
    // O cartão mostra a primeira; o espelho do contato diz o vínculo dela.
    expect(contato(ANA)).toMatchObject({ empresa_id: PADARIA, cargo: "Sócia", papel_na_empresa: "decisor", principal_na_empresa: true });
    // Pelas portas da 9034, e só elas.
    expect(new Set(banco.chamadasRpc.map((c) => c.nome))).toEqual(new Set(["fn_mia_vincular_pessoa"]));
  });

  it("empresa_do_cartao troca qual aparece no cartão", async () => {
    await ligar([{ contato_id: ANA, empresa_id: PADARIA }]);
    await ligar([{ contato_id: ANA, empresa_id: OFICINA, empresa_do_cartao: true }]);
    expect(contato(ANA).empresa_id).toBe(OFICINA);
    expect(vinculos()).toHaveLength(2);
  });

  it("dois números da mesma pessoa: viram uma pessoa só, e a empresa vale para os dois", async () => {
    await ligar([{ contato_id: ANA, empresa_id: PADARIA, papel: "decisor" }]);
    const r = await ligar([{ contato_telefone: "(10) 99111-0001", outro_numero_telefone: "(10) 99111-0009" }]);

    expect(r).toMatchObject({ atualizou: 1, recusou: 0 });
    expect(contato(ANA_2).person_id).toBe(contato(ANA).person_id);
    expect(contato(ANA_2)).toMatchObject({ empresa_id: PADARIA, papel_na_empresa: "decisor" });
    expect(banco.chamadasRpc.map((c) => c.nome)).toContain("fn_mia_juntar_numeros");

    // Repetir não junta de novo.
    const outra = await ligar([{ contato_telefone: "(10) 99111-0001", outro_numero_telefone: "(10) 99111-0009" }]);
    expect(outra).toMatchObject({ ja_estava: 1 });
  });

  it("um principal por empresa: marcar outro tira o de antes", async () => {
    await ligar([{ contato_id: ANA, empresa_id: PADARIA, principal: true }]);
    await ligar([{ contato_id: BRUNO, empresa_id: PADARIA, principal: true }]);
    const principais = vinculos().filter((v) => v.company_id === PADARIA && v.is_primary);
    expect(principais).toHaveLength(1);
    expect(principais[0]!.person_id).toBe(contato(BRUNO).person_id);
  });
});

describe("vincular pessoas a empresas: repetir e os dois modos", () => {
  it("repetir a mesma chamada não duplica: já estava", async () => {
    const item = { contato_id: ANA, empresa_id: PADARIA, papel: "decisor", cargo: "Sócia" };
    await ligar([item]);
    const r = await ligar([item]);
    expect(r).toMatchObject({ ja_estava: 1, criou: 0 });
    expect(vinculos()).toHaveLength(1);
  });

  it("completar (padrão) só preenche o vazio e avisa o que manteve; atualizar troca", async () => {
    await ligar([{ contato_id: ANA, empresa_id: PADARIA, papel: "decisor" }]);

    const completar = await ligar([{ contato_id: ANA, empresa_id: PADARIA, papel: "usuario", cargo: "Compradora" }]);
    expect(completar).toMatchObject({ atualizou: 1 });
    expect(completar.itens[0]!.avisos?.join(" ")).toContain("papel");
    expect(vinculos()[0]).toMatchObject({ papel: "decisor", job_title: "Compradora" });

    const atualizar = await ligar([{ contato_id: ANA, empresa_id: PADARIA, papel: "usuario" }], { quando_ja_existe: "atualizar" });
    expect(atualizar).toMatchObject({ atualizou: 1 });
    expect(vinculos()[0]).toMatchObject({ papel: "usuario" });
  });
});

describe("vincular pessoas a empresas: a recusa que ensina", () => {
  it("contato que não está na base, empresa que não está na base, empresa de OUTRA organização", async () => {
    const r = await ligar([
      { contato_telefone: "(10) 99111-0555", empresa_id: PADARIA },
      { contato_id: ANA, empresa_nome: "Empresa Que Não Existe" },
      { contato_id: ANA, empresa_id: VIZINHA },
    ]);
    expect(r).toMatchObject({ recusou: 3, criou: 0 });
    const motivos = r.itens.map((i) => i.motivo ?? "").join(" | ");
    expect(motivos).toContain("plataforma_importar_contatos");
    expect(motivos).toContain("plataforma_importar_empresas");
    expect(vinculos()).toHaveLength(0);
  });

  it("papel fora da lista fechada, item sem contato e item sem empresa nem outro número", async () => {
    const r = await ligar([
      { contato_id: ANA, empresa_id: PADARIA, papel: "chefe" },
      { empresa_id: PADARIA },
      { contato_id: ANA },
    ]);
    expect(r).toMatchObject({ recusou: 3 });
    expect(r.itens.map((i) => /campo `([^`]+)`/.exec(i.motivo ?? "")?.[1])).toEqual(["papel", "contato", "empresa"]);
  });

  it("contato anonimizado (LGPD) não recebe vínculo", async () => {
    const r = await ligar([{ contato_id: SEM_NOME, empresa_id: PADARIA }]);
    expect(r).toMatchObject({ recusou: 1 });
    expect(r.itens[0]!.motivo).toContain("ANONIMIZADO");
  });

  it(`teto de ${TETO_DE_VINCULOS} itens por chamada`, async () => {
    const muitos = Array.from({ length: TETO_DE_VINCULOS + 1 }, () => ({ contato_id: ANA, empresa_id: PADARIA }));
    await expect(ligar(muitos)).rejects.toThrow(String(TETO_DE_VINCULOS));
  });
});

describe("a ferramenta no catálogo", () => {
  it("é da operação importar_base, e a descrição diz o que NÃO faz", () => {
    expect(FERRAMENTA_VINCULAR_PESSOAS_A_EMPRESAS.name).toBe("plataforma_vincular_pessoas_a_empresas");
    expect(FERRAMENTA_VINCULAR_PESSOAS_A_EMPRESAS.operacao).toBe("importar_base");
    expect(FERRAMENTA_VINCULAR_PESSOAS_A_EMPRESAS.description).toContain("não envia nada");
    expect(FERRAMENTA_VINCULAR_PESSOAS_A_EMPRESAS.description).toContain("não consulta a Receita");
  });
});
