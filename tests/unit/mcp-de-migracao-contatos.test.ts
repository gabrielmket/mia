/**
 * IMPORTAR CONTATOS pelo MCP de plataforma (`plataforma_importar_contatos`).
 *
 * As regras que precisam estar certas, uma a uma: o telefone brasileiro (o
 * mesmo número com e sem o nono dígito, com e sem +55, com máscara, é a MESMA
 * pessoa), a deduplicação por e-mail, a recusa de quem não tem identificador,
 * o opt-out que nunca é desfeito e o SILÊNCIO (nenhum evento, nenhuma conversa).
 *
 * Os telefones usam o DDD 10, que não existe no Brasil mas tem a forma de um
 * DDD e por isso exercita a regra do nono dígito; os e-mails são
 * `@exemplo.invalid`. Nenhum dado é de pessoa real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOR, ORG, OUTRA_ORG, TOKEN, VENDEDORA, organizacaoDeTeste, type BancoDaMigracao } from "../helpers/banco-da-migracao";

const auditSpy = vi.fn();
vi.mock("@/lib/audit", async (original) => ({
  ...(await original<typeof import("@/lib/audit")>()),
  audit: async (entrada: unknown) => {
    auditSpy(entrada);
  },
}));

const { importarContatos, lerContato, TETO_DE_CONTATOS, TETO_DE_ETIQUETAS, FERRAMENTA_IMPORTAR_CONTATOS, mancheteDaObservacao } =
  await import("@/lib/mcp-plataforma/importacao/contatos");

let banco: BancoDaMigracao;
const ctx = () => ({ admin: banco.cliente as never, autorUserId: AUTOR, tokenId: TOKEN, requestId: "req-teste" });
const importar = (contatos: unknown[], extra: Record<string, unknown> = {}) =>
  importarContatos(ctx(), { organization_id: ORG, origem: "crm-antigo", contatos, ...extra });
const contatos = () => banco.tabela("contacts").filter((c) => c.organization_id === ORG);

beforeEach(() => {
  banco = organizacaoDeTeste();
  auditSpy.mockClear();
});

describe("importar contatos: o caminho feliz", () => {
  it("grava o contato com tudo o que veio, e marca de onde veio", async () => {
    // FORK MIA (.79, empresa única): a empresa é a do cadastro único (`companies`).
    banco.tabela("companies").push({
      id: "00000000-0000-4000-8000-00000000f010",
      organization_id: ORG,
      trade_name: "Padaria Modelo LTDA",
      legal_name: null,
      normalized_cnpj: "12345678000190",
    });

    const r = await importar([
      {
        nome: "Ana Souza",
        telefone: "(10) 99111-0001",
        email: "Ana.Souza@Exemplo.invalid",
        etiquetas: ["Cliente Antigo", "atacado", "ATACADO"],
        canal: "indicação",
        campos: { cidade: "Cidade Exemplo" },
        observacao: "Prefere contato à tarde.",
        empresa: { cnpj: "12.345.678/0001-90", cargo: "Compradora", setor: "Compras", papel: "Decisor", principal: true },
        consentimento_marketing: "concedido",
        consentimento_em: "14/03/2026",
        id_de_origem: "c-1",
      },
    ]);

    expect(r).toMatchObject({ total: 1, criou: 1, recusou: 0 });
    expect(r.nada_foi_enviado).toContain("Nenhuma mensagem foi enviada");
    expect(contatos()).toHaveLength(1);
    const ana = contatos()[0]!;
    expect(ana).toMatchObject({
      name: "Ana Souza",
      // Celular brasileiro é guardado em E.164 e COM o nono dígito.
      phone_number: "+5510991110001",
      email: "Ana.Souza@Exemplo.invalid",
      // A mesma normalização de etiqueta da tela: minúsculas, sem repetir.
      tags: ["cliente antigo", "atacado"],
      custom_fields: { cidade: "Cidade Exemplo" },
      source: "importacao:crm-antigo",
      empresa_id: "00000000-0000-4000-8000-00000000f010",
      cargo: "Compradora",
      setor: "Compras",
      papel_na_empresa: "decisor",
      principal_na_empresa: true,
      is_blocked: false,
      created_by_user_id: AUTOR,
    });
    expect(ana.source_metadata).toMatchObject({ importacao: { origem: "crm-antigo", id_de_origem: "c-1", canal: "indicação" } });
    expect((ana.consent as { marketing: Record<string, unknown> }).marketing).toMatchObject({
      source: "importacao:crm-antigo",
    });
    expect(String((ana.consent as { marketing: { granted_at: string } }).marketing.granted_at)).toContain("2026-03-14");

    // A observação vira nota do contato, com a origem na manchete.
    expect(banco.tabela("lead_notes")).toHaveLength(1);
    expect(banco.tabela("lead_notes")[0]).toMatchObject({
      organization_id: ORG,
      contact_id: ana.id,
      headline: mancheteDaObservacao("crm-antigo"),
      body: "Prefere contato à tarde.",
    });
  });

  it("contato só com e-mail entra; sem informação de consentimento, a coluna fica com o padrão do banco", async () => {
    const r = await importar([{ nome: "Bruno Lima", email: "bruno.lima@exemplo.invalid" }]);
    expect(r.criou).toBe(1);
    expect(contatos()[0]).toMatchObject({ phone_number: null, email: "bruno.lima@exemplo.invalid" });
    expect((contatos()[0]!.consent as { marketing: Record<string, unknown> }).marketing).toEqual({
      granted_at: null,
      source: null,
      version: null,
    });
  });
});

describe("importar contatos: NADA é disparado", () => {
  it("criar e atualizar contatos não emite evento nenhum, não abre conversa e não cria tarefa", async () => {
    await importar([
      { nome: "Ana Souza", telefone: "(10) 99111-0001", etiquetas: ["vip"] },
      { nome: "Bruno Lima", email: "bruno.lima@exemplo.invalid" },
    ]);
    // A segunda rodada ACRESCENTA etiqueta: pela tela, isso emite `contact.tag_added`,
    // que é gatilho de automação. Pela importação, não emite.
    const r = await importar([{ telefone: "(10) 99111-0001", etiquetas: ["promo"] }]);
    expect(r.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(contatos()[0]!.tags).toEqual(["vip", "promo"]);

    expect(banco.chamadasRpc, "nenhum emit_event").toEqual([]);
    for (const tabela of ["conversations", "messages", "event_log", "followup_enrollments", "crm_tasks", "automation_rule_runs"]) {
      expect(banco.tabela(tabela), tabela).toHaveLength(0);
    }
  });
});

describe("deduplicação por telefone: o mesmo número é a mesma pessoa", () => {
  // Todas as grafias abaixo são o MESMO celular: +55 10 9 9111-0001.
  const GRAFIAS = [
    "(10) 99111-0001",
    "10991110001",
    "+5510991110001",
    "+55 10 99111-0001",
    "55 (10) 99111-0001",
    // sem o nono dígito
    "(10) 9111-0001",
    "1091110001",
    "+55 10 9111-0001",
    "551091110001",
  ];

  for (const grafia of GRAFIAS) {
    it(`"${grafia}" casa com o contato já gravado, em vez de criar outro`, async () => {
      await importar([{ nome: "Ana Souza", telefone: "(10) 99111-0001" }]);
      const r = await importar([{ nome: "Ana Souza", telefone: grafia }]);
      expect(r.itens[0], JSON.stringify(r.itens[0])).toMatchObject({ desfecho: "ja_estava" });
      expect(contatos()).toHaveLength(1);
    });
  }

  it("o contato que o WhatsApp gravou SEM o nono dígito é reconhecido pela lista que traz o número com o 9", async () => {
    // É o caso real: o `wa_id` do inbound chega com 12 dígitos.
    banco.tabela("contacts").push({
      id: "00000000-0000-4000-8000-00000000f020",
      organization_id: ORG,
      name: null,
      display_name: "Ana",
      email: null,
      email_normalized: null,
      phone_number: "+551091110001",
      tags: [],
      custom_fields: {},
      consent: {},
      is_blocked: false,
      is_anonymized: false,
      is_merged_into: null,
      empresa_id: null,
      principal_na_empresa: false,
      source: "whatsapp",
    });

    const r = await importar([{ nome: "Ana Souza", telefone: "(10) 99111-0001", email: "ana.souza@exemplo.invalid" }]);

    expect(r.itens[0]).toMatchObject({ desfecho: "atualizou", id: "00000000-0000-4000-8000-00000000f020" });
    expect(contatos()).toHaveLength(1);
    expect(contatos()[0]).toMatchObject({
      name: "Ana Souza",
      email: "ana.souza@exemplo.invalid",
      // O telefone de quem já tem um não é mexido, e a origem continua a primeira.
      phone_number: "+551091110001",
      source: "whatsapp",
    });
  });

  it("o mesmo número duas vezes na MESMA lista, com e sem o 9, vira um contato só", async () => {
    const r = await importar([
      { nome: "Ana Souza", telefone: "(10) 99111-0001" },
      { nome: "Ana S.", telefone: "(10) 9111-0001", etiquetas: ["retorno"] },
    ]);
    expect(r.itens.map((i) => i.desfecho)).toEqual(["criou", "atualizou"]);
    expect(contatos()).toHaveLength(1);
    expect(contatos()[0]).toMatchObject({ name: "Ana Souza", tags: ["retorno"] });
  });

  it("telefone FIXO não ganha nono dígito: dois fixos parecidos são duas pessoas", async () => {
    const r = await importar([
      { nome: "Loja A", telefone: "(10) 3234-5678" },
      { nome: "Loja B", telefone: "(10) 9 3234-5678" },
    ]);
    expect(r.itens.map((i) => i.desfecho)).toEqual(["criou", "criou"]);
  });

  it("o mesmo telefone em OUTRA organização não é o mesmo contato", async () => {
    banco.tabela("contacts").push({
      id: "00000000-0000-4000-8000-00000000f021",
      organization_id: OUTRA_ORG,
      phone_number: "+5510991110001",
      is_merged_into: null,
      is_anonymized: false,
      tags: [],
      custom_fields: {},
    });
    const r = await importar([{ nome: "Ana Souza", telefone: "(10) 99111-0001" }]);
    expect(r.itens[0]).toMatchObject({ desfecho: "criou" });
    expect(banco.tabela("contacts").find((c) => c.organization_id === OUTRA_ORG)).not.toHaveProperty("name");
  });
});

describe("deduplicação por e-mail", () => {
  it("e-mail em caixa diferente é o mesmo contato", async () => {
    await importar([{ nome: "Bruno Lima", email: "bruno.lima@exemplo.invalid" }]);
    const r = await importar([{ nome: "Bruno Lima", email: "  BRUNO.LIMA@EXEMPLO.INVALID " }]);
    expect(r.itens[0]).toMatchObject({ desfecho: "ja_estava" });
    expect(contatos()).toHaveLength(1);
  });

  it("quem entrou só com e-mail ganha o telefone quando a lista o traz", async () => {
    await importar([{ nome: "Bruno Lima", email: "bruno.lima@exemplo.invalid" }]);
    const r = await importar([{ email: "bruno.lima@exemplo.invalid", telefone: "(10) 99222-0002" }]);
    expect(r.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(contatos()).toHaveLength(1);
    expect(contatos()[0]!.phone_number).toBe("+5510992220002");
  });

  it("telefone de um contato e e-mail de OUTRO: não funde, não rouba o e-mail e avisa a duplicata", async () => {
    await importar([
      { nome: "Ana Souza", telefone: "(10) 99111-0001" },
      { nome: "Ana (cadastro antigo)", email: "ana.souza@exemplo.invalid" },
    ]);
    const r = await importar([{ nome: "Ana Souza", telefone: "(10) 99111-0001", email: "ana.souza@exemplo.invalid" }]);

    expect(contatos()).toHaveLength(2);
    expect(contatos()[0]!.email ?? null).toBeNull();
    expect(r.itens[0]!.avisos?.join(" ")).toContain("OUTRO contato");
    expect(r.itens[0]!.avisos?.join(" ")).toContain("Duplicados");
  });
});

describe("importar contatos: a recusa que ensina", () => {
  it("sem telefone válido E sem e-mail é recusado, dizendo o que era esperado e um exemplo", async () => {
    const r = await importar([
      { nome: "Sem nada" },
      { nome: "Telefone torto", telefone: "123" },
      { nome: "E-mail torto", email: "isto-nao-e-email" },
    ]);
    expect(r.recusou).toBe(3);
    expect(r.itens[0]!.motivo).toMatch(/Item 1, campo `telefone`.*telefone válido ou de um e-mail/);
    expect(r.itens[1]!.motivo).toContain("Item 2, campo `telefone`");
    expect(r.itens[1]!.motivo).toContain("DDD + número");
    expect(r.itens[1]!.motivo).toContain("Exemplo que passa");
    expect(r.itens[2]!.motivo).toContain("Item 3, campo `email`");
    expect(contatos()).toHaveLength(0);
  });

  it("telefone inválido com e-mail válido NÃO recusa: entra pelo e-mail e avisa", async () => {
    const r = await importar([{ nome: "Bruno Lima", telefone: "123", email: "bruno.lima@exemplo.invalid" }]);
    expect(r.itens[0]).toMatchObject({ desfecho: "criou" });
    expect(r.itens[0]!.avisos?.join(" ")).toContain("telefone não é um número válido");
    expect(contatos()[0]).toMatchObject({ phone_number: null });
  });

  it("um item ruim no meio não derruba o lote", async () => {
    const r = await importar([
      { nome: "Ana Souza", telefone: "(10) 99111-0001" },
      { nome: "Sem identificador" },
      { nome: "Bruno Lima", email: "bruno.lima@exemplo.invalid" },
    ]);
    expect(r).toMatchObject({ total: 3, criou: 2, recusou: 1 });
    expect(r.itens.map((i) => i.posicao)).toEqual([1, 2, 3]);
    expect(contatos().map((c) => c.name)).toEqual(["Ana Souza", "Bruno Lima"]);
  });

  it("recusa papel fora do vocabulário, consentimento desconhecido, data torta e campos que não são objeto", () => {
    const base = { nome: "Ana", telefone: "(10) 99111-0001" };
    const casos: Array<[Record<string, unknown>, string, RegExp]> = [
      [{ empresa: { nome: "Padaria", papel: "chefe" } }, "empresa.papel", /decisor, financeiro, usuario, influenciador, outro/],
      [{ consentimento_marketing: "talvez" }, "consentimento_marketing", /"concedido" ou "recusado"/],
      [{ consentimento_em: "31/02/2026" }, "consentimento_em", /data/],
      [{ campos: ["a", "b"] }, "campos", /objeto/],
      [{ etiquetas: "vip" }, "etiquetas", /lista/],
      [{ opt_out: "talvez" }, "opt_out", /verdadeiro ou falso/],
      [{ empresa: "Padaria Modelo" }, "empresa", /objeto/],
      [{ nome: "x".repeat(201) }, "nome", /no máximo 200 caracteres/],
    ];
    for (const [extra, campo, esperado] of casos) {
      const lido = lerContato({ ...base, ...extra });
      expect(lido.ok, JSON.stringify(extra)).toBe(false);
      if (!lido.ok) {
        expect(lido.campo).toBe(campo);
        expect(lido.esperado).toMatch(esperado);
      }
    }
  });

  it("mais etiquetas que o teto: o contato entra e a resposta diz que sobrou", async () => {
    const etiquetas = Array.from({ length: TETO_DE_ETIQUETAS + 3 }, (_, i) => `etiqueta ${i}`);
    const r = await importar([{ nome: "Ana Souza", telefone: "(10) 99111-0001", etiquetas }]);
    expect(r.itens[0]).toMatchObject({ desfecho: "criou" });
    expect(r.itens[0]!.avisos?.join(" ")).toContain(`teto é ${TETO_DE_ETIQUETAS}`);
    expect(contatos()[0]!.tags).toHaveLength(TETO_DE_ETIQUETAS);
  });

  it("organização inexistente, origem ausente, lista vazia e lista acima do teto: recusa a chamada inteira", async () => {
    const um = [{ nome: "Ana Souza", telefone: "(10) 99111-0001" }];
    await expect(
      importarContatos(ctx(), { organization_id: "00000000-0000-4000-8000-00000000dead", origem: "crm", contatos: um }),
    ).rejects.toThrow(/plataforma_listar_clientes/);
    await expect(importarContatos(ctx(), { organization_id: ORG, contatos: um })).rejects.toThrow(/`origem` é obrigatória/);
    await expect(importar([])).rejects.toThrow(/pelo menos 1 item/);
    const demais = Array.from({ length: TETO_DE_CONTATOS + 1 }, (_, i) => ({ email: `pessoa${i}@exemplo.invalid` }));
    await expect(importar(demais)).rejects.toThrow(new RegExp(`teto é ${TETO_DE_CONTATOS}`));
    expect(contatos()).toHaveLength(0);
  });

  it("contato anonimizado a pedido do titular não é reimportado", async () => {
    banco.tabela("contacts").push({
      id: "00000000-0000-4000-8000-00000000f030",
      organization_id: ORG,
      phone_number: "+5510991110001",
      is_anonymized: true,
      is_merged_into: null,
      tags: [],
      custom_fields: {},
    });
    const r = await importar([{ nome: "Ana Souza", telefone: "(10) 99111-0001" }]);
    expect(r.itens[0]).toMatchObject({ desfecho: "recusou" });
    expect(r.itens[0]!.motivo).toContain("ANONIMIZADO");
    expect(banco.tabela("contacts")[0]).not.toHaveProperty("name");
  });
});

describe("opt-out e consentimento", () => {
  it("quem veio como opt-out entra BLOQUEADO para todo envio", async () => {
    await importar([{ nome: "Carla Dias", telefone: "(10) 99222-0002", opt_out: true }]);
    expect(contatos()[0]).toMatchObject({ is_blocked: true, blocked_reason: "opt_out_importado" });
    expect(contatos()[0]!.blocked_at).toBeTruthy();
  });

  it("quem já existe e veio como opt-out passa a bloqueado", async () => {
    await importar([{ nome: "Carla Dias", telefone: "(10) 99222-0002" }]);
    const r = await importar([{ telefone: "(10) 99222-0002", opt_out: true }]);
    expect(r.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(contatos()[0]).toMatchObject({ is_blocked: true });
  });

  it("quem está bloqueado NUNCA é desbloqueado pela importação, nem no modo 'atualizar'", async () => {
    await importar([{ nome: "Carla Dias", telefone: "(10) 99222-0002", opt_out: true }]);
    for (const modo of ["completar", "atualizar"]) {
      const r = await importar([{ nome: "Carla Dias", telefone: "(10) 99222-0002", opt_out: false }], { quando_ja_existe: modo });
      expect(contatos()[0], modo).toMatchObject({ is_blocked: true, blocked_reason: "opt_out_importado" });
      expect(r.itens[0]!.avisos?.join(" "), modo).toContain("continua bloqueado");
    }
  });

  it("a recusa de marketing é gravada como fato, e uma concessão posterior não passa por cima dela", async () => {
    await importar([{ nome: "Davi Rocha", telefone: "(10) 99333-0003", consentimento_marketing: "recusado" }]);
    const marketing = () => (contatos()[0]!.consent as { marketing: Record<string, unknown> }).marketing;
    expect(marketing().declined_at).toBeTruthy();
    expect(marketing().granted_at).toBeNull();

    const r = await importar([{ telefone: "(10) 99333-0003", consentimento_marketing: "concedido" }], {
      quando_ja_existe: "atualizar",
    });
    expect(marketing().declined_at).toBeTruthy();
    expect(marketing().granted_at).toBeNull();
    expect(r.itens[0]!.avisos?.join(" ")).toContain("RECUSOU");
  });

  it("a recusa vale mesmo sobre quem tinha concedido", async () => {
    await importar([{ nome: "Davi Rocha", telefone: "(10) 99333-0003", consentimento_marketing: "concedido" }]);
    await importar([{ telefone: "(10) 99333-0003", consentimento_marketing: "recusado" }]);
    const marketing = (contatos()[0]!.consent as { marketing: Record<string, unknown> }).marketing;
    expect(marketing.declined_at).toBeTruthy();
    expect(marketing.granted_at).toBeNull();
  });

  it("gravar marketing não apaga as outras finalidades de consentimento", async () => {
    banco.tabela("contacts").push({
      id: "00000000-0000-4000-8000-00000000f040",
      organization_id: ORG,
      phone_number: "+5510993330003",
      is_anonymized: false,
      is_merged_into: null,
      is_blocked: false,
      tags: [],
      custom_fields: {},
      consent: { transactional: { granted_at: "2026-01-01T00:00:00Z", source: "tela", version: null } },
    });
    await importar([{ telefone: "(10) 99333-0003", consentimento_marketing: "concedido" }]);
    const consent = contatos()[0]!.consent as Record<string, Record<string, unknown>>;
    expect(consent.transactional!.granted_at).toBe("2026-01-01T00:00:00Z");
    expect(consent.marketing!.granted_at).toBeTruthy();
  });
});

describe("os dois modos de reexecução", () => {
  it("'completar' só preenche o vazio; 'atualizar' substitui o que veio; nada é apagado", async () => {
    await importar([{ nome: "Ana Souza", telefone: "(10) 99111-0001", campos: { cidade: "Cidade Exemplo" }, etiquetas: ["vip"] }]);

    const completar = await importar([
      { nome: "Ana S. Oliveira", telefone: "(10) 99111-0001", email: "ana.souza@exemplo.invalid", campos: { cidade: "Outra", bairro: "Centro" } },
    ]);
    expect(completar.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(completar.itens[0]!.avisos?.join(" ")).toMatch(/nome.*campos\.cidade/);
    expect(contatos()[0]).toMatchObject({
      name: "Ana Souza",
      email: "ana.souza@exemplo.invalid",
      custom_fields: { cidade: "Cidade Exemplo", bairro: "Centro" },
    });

    const atualizar = await importar([{ nome: "Ana S. Oliveira", telefone: "(10) 99111-0001", campos: { cidade: "Outra" } }], {
      quando_ja_existe: "atualizar",
    });
    expect(atualizar.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(contatos()[0]).toMatchObject({
      name: "Ana S. Oliveira",
      // O que não veio na lista fica como estava.
      email: "ana.souza@exemplo.invalid",
      custom_fields: { cidade: "Outra", bairro: "Centro" },
      tags: ["vip"],
    });
  });

  it("a observação não empilha: a mesma nota é reconhecida, e só 'atualizar' troca o texto", async () => {
    await importar([{ nome: "Ana Souza", telefone: "(10) 99111-0001", observacao: "Prefere contato à tarde." }]);
    const igual = await importar([{ telefone: "(10) 99111-0001", observacao: "Prefere contato à tarde." }]);
    expect(igual.itens[0]).toMatchObject({ desfecho: "ja_estava" });

    const outra = await importar([{ telefone: "(10) 99111-0001", observacao: "Agora prefere de manhã." }]);
    expect(outra.itens[0]).toMatchObject({ desfecho: "ja_estava" });
    expect(outra.itens[0]!.avisos?.join(" ")).toContain("observação");
    expect(banco.tabela("lead_notes")).toHaveLength(1);
    expect(banco.tabela("lead_notes")[0]!.body).toBe("Prefere contato à tarde.");

    const trocou = await importar([{ telefone: "(10) 99111-0001", observacao: "Agora prefere de manhã." }], {
      quando_ja_existe: "atualizar",
    });
    expect(trocou.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(banco.tabela("lead_notes")).toHaveLength(1);
    expect(banco.tabela("lead_notes")[0]!.body).toBe("Agora prefere de manhã.");
  });

  it("a empresa que não está na base não é criada: o contato entra sem vínculo, e a reexecução liga", async () => {
    const primeiro = await importar([{ nome: "Elisa Prado", telefone: "(10) 99444-0004", empresa: { nome: "Oficina Exemplo" } }]);
    expect(primeiro.itens[0]).toMatchObject({ desfecho: "criou" });
    expect(primeiro.itens[0]!.avisos?.join(" ")).toContain("plataforma_importar_empresas");
    expect(banco.tabela("companies")).toHaveLength(0);
    expect(contatos()[0]!.empresa_id).toBeNull();

    banco.tabela("companies").push({
      id: "00000000-0000-4000-8000-00000000f050",
      organization_id: ORG,
      trade_name: "Oficina Exemplo ME",
      legal_name: null,
      normalized_cnpj: null,
    });
    const segundo = await importar([{ nome: "Elisa Prado", telefone: "(10) 99444-0004", empresa: { nome: "Oficina Exemplo" } }]);
    expect(segundo.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(contatos()[0]!.empresa_id).toBe("00000000-0000-4000-8000-00000000f050");
  });
});

describe("importar contatos: o rastro", () => {
  it("a auditoria da chamada tem contagens e ids, e nenhum nome, telefone ou e-mail", async () => {
    await importar([
      { nome: "Ana Souza", telefone: "(10) 99111-0001", email: "ana.souza@exemplo.invalid", observacao: "Prefere a tarde." },
      { nome: "Sem identificador" },
    ]);
    expect(auditSpy).toHaveBeenCalledOnce();
    const linha = auditSpy.mock.lastCall![0] as { action: string; metadata: Record<string, unknown> };
    expect(linha).toMatchObject({ action: "plataforma.importacao", organizationId: ORG });
    expect(linha.metadata).toMatchObject({ tipo: "contatos", origem: "crm-antigo", total: 2, criou: 1, recusou: 1 });
    const texto = JSON.stringify(linha);
    for (const dado of ["Ana", "Souza", "99111", "exemplo.invalid", "Prefere"]) expect(texto).not.toContain(dado);
  });

  it("a redação dos argumentos troca a lista de pessoas pela contagem", () => {
    const redigido = FERRAMENTA_IMPORTAR_CONTATOS.redigirParaAuditoria({
      organization_id: ORG,
      origem: "crm-antigo",
      quando_ja_existe: "completar",
      contatos: [{ nome: "Ana Souza", telefone: "(10) 99111-0001" }, { nome: "Bruno Lima" }],
    });
    expect(redigido).toEqual({ organization_id: ORG, origem: "crm-antigo", quando_ja_existe: "completar", contatos: { itens: 2 } });
  });
});

describe("importar contatos: o dono do contato, o vendedor responsável (upstream 1.79, gravado pela 9022)", () => {
  const FUNCAO = "fn_mia_definir_dono_do_contato_pela_plataforma";

  /**
   * A função do banco (9022) com o efeito que ela tem no Postgres: o trio do dono
   * e a adoção dos negócios abertos sem dono. A prova contra o Postgres de
   * verdade é `tests/invariants/dono-do-contato-pela-plataforma.test.ts`.
   */
  function comAFuncaoDoBanco(erro?: string) {
    for (const vinculo of banco.tabela("user_organizations")) vinculo.accepted_at = "2026-01-01T00:00:00Z";
    const chamadas: Array<Record<string, unknown>> = [];
    const original = banco.cliente.rpc;
    // O dublê devolve sempre sucesso vazio; esta função do banco também recusa e devolve o dono.
    banco.cliente.rpc = (async (nome: string, args: Record<string, unknown> = {}) => {
      if (nome !== FUNCAO) return original(nome, args);
      chamadas.push(args);
      if (erro) return { data: null, error: { message: erro } };
      const contato = banco.tabela("contacts").find((c) => c.id === args.p_contact && c.organization_id === args.p_org)!;
      Object.assign(contato, { carteira_user_id: args.p_dono, carteira_origem: args.p_origem, carteira_definida_em: "2026-10-14T00:00:00Z" });
      return { data: args.p_dono, error: null };
    }) as unknown as typeof banco.cliente.rpc;
    return chamadas;
  }
  const ANA = { nome: "Ana Souza", telefone: "(10) 99111-0001" };

  it("contato novo com vendedor: grava pela função do fork, com o token como ator e a origem `importacao`, e deixa a auditoria da tela", async () => {
    const chamadas = comAFuncaoDoBanco();
    const r = await importar([{ ...ANA, vendedor_responsavel: "Vendedora@Exemplo.invalid" }]);
    expect(r).toMatchObject({ criou: 1, recusou: 0 });
    const ana = contatos()[0]!;
    expect(chamadas).toEqual([{ p_org: ORG, p_token: TOKEN, p_contact: ana.id, p_dono: VENDEDORA, p_origem: "importacao" }]);
    expect(ana).toMatchObject({ carteira_user_id: VENDEDORA, carteira_origem: "importacao" });
    const linha = auditSpy.mock.calls.map(([e]) => e as { action: string; metadata: Record<string, unknown> }).find((e) => e.action === "contact.carteira_changed")!;
    expect(linha.metadata).toMatchObject({ antes: null, depois: VENDEDORA, origem: "importacao" });
    // A linha leva ids, nunca o nome, o telefone ou o e-mail da pessoa.
    for (const dado of ["Ana", "99111", "exemplo.invalid"]) expect(JSON.stringify(linha)).not.toContain(dado);

    const de_novo = await importar([{ ...ANA, vendedor_responsavel: "vendedora@exemplo.invalid" }]);
    expect(de_novo.itens[0]).toMatchObject({ desfecho: "ja_estava" });
    expect(chamadas, "a reexecução chamou a função de novo").toHaveLength(1);
  });

  it("o dono que já existe fica em `completar`, com o aviso; `atualizar` troca", async () => {
    const chamadas = comAFuncaoDoBanco();
    await importar([{ ...ANA, vendedor_responsavel: "autor.do.token@exemplo.invalid" }]);
    const completar = await importar([{ ...ANA, vendedor_responsavel: "vendedora@exemplo.invalid" }]);
    expect(completar.itens[0]).toMatchObject({ desfecho: "ja_estava" });
    expect((completar.itens[0]!.avisos as string[]).join(" ")).toContain("já tem outro vendedor responsável");
    expect(contatos()[0]!.carteira_user_id).toBe(AUTOR);

    const atualizar = await importar([{ ...ANA, vendedor_responsavel: "vendedora@exemplo.invalid" }], { quando_ja_existe: "atualizar" });
    expect(atualizar.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(contatos()[0]!.carteira_user_id).toBe(VENDEDORA);
    expect(chamadas).toHaveLength(2);
  });

  it("quem só lê, quem não é da equipe e quem não aceitou o convite não são dono: o contato entra sem dono, e o aviso diz por quê", async () => {
    const chamadas = comAFuncaoDoBanco();
    banco.tabela("user_organizations").find((v) => v.user_id === VENDEDORA)!.accepted_at = null;
    const r = await importar([
      { ...ANA, vendedor_responsavel: "leitor@exemplo.invalid" },
      { nome: "Bruno Lima", telefone: "(10) 99222-0002", vendedor_responsavel: "alguem@exemplo.invalid" },
      { nome: "Carla Dias", telefone: "(10) 99333-0003", vendedor_responsavel: "vendedora@exemplo.invalid" },
    ]);
    expect(r).toMatchObject({ criou: 3, recusou: 0 });
    for (const item of r.itens) expect((item.avisos as string[]).join(" ")).toContain("o contato ficou sem dono");
    expect(chamadas).toEqual([]);
    expect(contatos().every((c) => !c.carteira_user_id)).toBe(true);
  });

  it("o banco recusa o token como ator: o contato entra, e o aviso diz o que o banco respondeu", async () => {
    comAFuncaoDoBanco("dono_sem_token_de_plataforma");
    const r = await importar([{ ...ANA, vendedor_responsavel: "vendedora@exemplo.invalid" }]);
    expect(r).toMatchObject({ criou: 1 });
    expect((r.itens[0]!.avisos as string[]).join(" ")).toContain("o banco recusou o token desta chamada como ator");
  });

  it("o campo é lido na conferência do item", () => {
    const lido = lerContato({ ...ANA, vendedor_responsavel: " vendedora@exemplo.invalid " });
    expect(lido).toMatchObject({ ok: true, contato: { vendedor_responsavel: "vendedora@exemplo.invalid" } });
  });
});
