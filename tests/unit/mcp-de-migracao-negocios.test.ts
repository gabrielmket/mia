/**
 * IMPORTAR NEGÓCIOS pelo MCP de plataforma (`plataforma_importar_negocios`).
 *
 * O negócio passa pelo `createLeadHandler` DE VERDADE (o caminho da tela), com
 * um banco em memória que imita os índices únicos e o gatilho que decide a
 * situação pela etapa. O que se mede: a chave de reexecução (`origem` +
 * `id_de_origem`), a recusa que ensina para funil e etapa que não existem, e o
 * SILÊNCIO: nenhum `lead.created`, nenhum `lead.stage_changed`, nenhum
 * `lead.won`, nenhuma tarefa, inclusive para negócio importado como ganho.
 *
 * A prova contra um Postgres de verdade (gatilhos e fila de eventos reais) é o
 * invariante `tests/invariants/mcp-de-migracao-importa-em-silencio.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTOR,
  ETAPA_GANHO,
  ETAPA_NOVO,
  ETAPA_PERDIDO,
  ETAPA_PROPOSTA,
  FUNIL,
  ORG,
  TOKEN,
  VENDEDORA,
  organizacaoDeTeste,
  type BancoDaMigracao,
} from "../helpers/banco-da-migracao";

let banco: BancoDaMigracao;

const auditSpy = vi.fn();
vi.mock("@/lib/audit", async (original) => ({
  ...(await original<typeof import("@/lib/audit")>()),
  audit: async (entrada: unknown) => {
    auditSpy(entrada);
  },
}));
// O `createAdminClient()` de dentro do handler (evento, dono, origem do
// atendimento) fala com o MESMO banco: se a importação emitisse evento, ele
// apareceria em `banco.chamadasRpc`.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => banco.cliente }));

const { importarNegocios, lerNegocio, TETO_DE_NEGOCIOS, FERRAMENTA_IMPORTAR_NEGOCIOS } = await import(
  "@/lib/mcp-plataforma/importacao/negocios"
);
const { createLeadHandler } = await import("@/app/api/v1/leads/_handler");

const ctx = () => ({ admin: banco.cliente as never, autorUserId: AUTOR, tokenId: TOKEN });
const importar = (negocios: unknown[], extra: Record<string, unknown> = {}) =>
  importarNegocios(ctx(), { organization_id: ORG, origem: "crm-antigo", negocios, ...extra });
const leads = () => banco.tabela("crm_leads");
const eventos = () => banco.chamadasRpc.filter((c) => c.nome === "emit_event").map((c) => c.args.p_event_type);

const ABERTO = { id_de_origem: "n-1", titulo: "Pedido da padaria", funil: "Comercial", etapa: "Proposta enviada" };

beforeEach(() => {
  banco = organizacaoDeTeste();
  auditSpy.mockClear();
});

describe("importar negócios: o caminho feliz", () => {
  it("o negócio aberto nasce na etapa pedida, com valor, dono, contato, empresa, etiquetas, campos e a nota de histórico", async () => {
    banco.tabela("contacts").push({
      id: "00000000-0000-4000-8000-00000000f101",
      organization_id: ORG,
      name: "Ana Souza",
      phone_number: "+5510991110001",
      is_merged_into: null,
      is_anonymized: false,
    });
    banco.tabela("crm_empresas").push({
      id: "00000000-0000-4000-8000-00000000f102",
      organization_id: ORG,
      nome: "Padaria Modelo LTDA",
      cnpj: "12345678000190",
      mesclada_em: null,
    });

    const r = await importar([
      {
        ...ABERTO,
        valor: 12500.5,
        dono_email: "Vendedora@Exemplo.invalid",
        // sem o nono dígito: é o mesmo contato
        contato_telefone: "(10) 9111-0001",
        empresa_cnpj: "12.345.678/0001-90",
        etiquetas: ["quente"],
        campos: { "Prazo de entrega": "junho" },
        criado_em: "2026-03-14",
        previsao_de_fechamento: "30/11/2026",
        canal: "indicação",
        nota: "No sistema antigo: pediu três versões do orçamento.",
      },
    ]);

    expect(r, JSON.stringify(r.itens)).toMatchObject({ total: 1, criou: 1, recusou: 0 });
    expect(r.nada_foi_enviado).toContain("nenhuma conversão foi registrada");
    expect(leads()).toHaveLength(1);
    const lead = leads()[0]!;
    expect(lead).toMatchObject({
      organization_id: ORG,
      pipeline_id: FUNIL,
      stage_id: ETAPA_PROPOSTA,
      title: "Pedido da padaria",
      status: "open",
      value_cents: 1250050,
      currency: "BRL",
      owner_user_id: VENDEDORA,
      contact_id: "00000000-0000-4000-8000-00000000f101",
      empresa_id: "00000000-0000-4000-8000-00000000f102",
      tags: ["quente"],
      // O campo veio pelo NOME ("Prazo de entrega") e foi gravado na chave do funil.
      custom_fields: { prazo: "junho" },
      expected_close_date: "2026-11-30",
      // A chave de reexecução, no lugar que o banco já garante único.
      source: "importacao:crm-antigo",
      external_id: "n-1",
      created_by_user_id: AUTOR,
    });
    expect(lead.source_metadata).toMatchObject({
      importacao: { origem: "crm-antigo", id_de_origem: "n-1", canal: "indicação" },
    });
    // Negócio ABERTO não leva a data de criação de origem na coluna: ela fica guardada.
    expect(String((lead.source_metadata as { importacao: { criado_em: string } }).importacao.criado_em)).toContain("2026-03-14");
    expect(String(lead.created_at)).not.toContain("2026-03-14");

    const notas = banco.tabela("crm_lead_activities");
    expect(notas).toHaveLength(1);
    expect(notas[0]).toMatchObject({
      lead_id: lead.id,
      type: "note",
      // O texto vai no payload; o `reason`, que a tela mostra em todo lugar, não carrega conteúdo.
      reason: "Nota interna",
      payload: { texto: "No sistema antigo: pediu três versões do orçamento.", fixada: false, importada_de: "crm-antigo" },
      performed_by_user_id: AUTOR,
    });
  });

  it("negócio GANHO nasce na etapa de ganho, com as datas de origem", async () => {
    const r = await importar([
      { id_de_origem: "n-2", titulo: "Plano anual", funil: "Comercial", situacao: "ganho", valor: "4.800,00", criado_em: "2026-02-01", fechado_em: "10/03/2026" },
    ]);
    expect(r.itens[0], JSON.stringify(r.itens[0])).toMatchObject({ desfecho: "criou" });
    expect(leads()[0]).toMatchObject({ stage_id: ETAPA_GANHO, status: "won", value_cents: 480000 });
    expect(String(leads()[0]!.created_at)).toContain("2026-02-01");
    expect(String(leads()[0]!.closed_at)).toContain("2026-03-10");
  });

  it("negócio PERDIDO vai para a etapa de perda; a etapa aberta informada vira 'onde morreu' e o motivo é o do funil", async () => {
    const r = await importar([
      {
        id_de_origem: "n-3",
        titulo: "Reforma da oficina",
        funil: "Comercial",
        etapa: "Proposta enviada",
        situacao: "perdido",
        motivo_de_perda: "foi para o concorrente",
        fechado_em: "2026-01-20",
      },
    ]);
    expect(r.itens[0], JSON.stringify(r.itens[0])).toMatchObject({ desfecho: "criou" });
    expect(leads()[0]).toMatchObject({
      stage_id: ETAPA_PERDIDO,
      status: "lost",
      lost_from_stage_id: ETAPA_PROPOSTA,
      // O rótulo como o funil o cadastrou, achado sem diferenciar caixa.
      lost_reason: "Foi para o concorrente",
    });
    // Sem `criado_em`, a criação fica igual ao fechamento (o negócio não fecha antes de existir).
    expect(String(leads()[0]!.created_at)).toContain("2026-01-20");
  });

  it("motivo de perda que o funil não conhece entra como 'Outro motivo', e o texto original fica na nota", async () => {
    const r = await importar([
      { id_de_origem: "n-4", titulo: "Consulta", funil: "Comercial", situacao: "perdido", motivo_de_perda: "Sumiu depois da visita" },
    ]);
    expect(leads()[0]).toMatchObject({ status: "lost", lost_reason: "other" });
    expect(r.itens[0]!.avisos?.join(" ")).toContain("Outro motivo");
    expect(banco.tabela("crm_lead_activities")[0]!.payload).toMatchObject({
      texto: "Motivo de perda no sistema de origem: Sumiu depois da visita",
    });
  });

  it("motivo canônico é reconhecido pela chave e pelo rótulo em português", async () => {
    await importar([
      { id_de_origem: "n-5", titulo: "Pelo rótulo", funil: "Comercial", situacao: "perdido", motivo_de_perda: "Sem resposta do cliente" },
      { id_de_origem: "n-6", titulo: "Pela chave", funil: "Comercial", situacao: "perdido", motivo_de_perda: "other" },
    ]);
    expect(leads().map((l) => l.lost_reason)).toEqual(["no_response", "other"]);
  });
});

describe("importar negócios: NADA é disparado", () => {
  it("negócio aberto, ganho e perdido: nenhum evento, nenhuma tarefa, nenhuma conversão", async () => {
    const r = await importar([
      ABERTO,
      { id_de_origem: "n-2", titulo: "Plano anual", funil: "Comercial", situacao: "ganho", valor: 4800 },
      { id_de_origem: "n-3", titulo: "Reforma", funil: "Comercial", situacao: "perdido", motivo_de_perda: "Sem orçamento" },
    ]);
    expect(r.criou).toBe(3);
    // Nem `lead.created`, nem `lead.stage_changed`, nem `lead.won`: a fila fica vazia.
    expect(eventos()).toEqual([]);
    for (const tabela of ["crm_tasks", "ad_conversion_dispatches", "messages", "followup_enrollments", "automation_rule_runs"]) {
      expect(banco.tabela(tabela), tabela).toHaveLength(0);
    }
  });

  it("CONTROLE: o MESMO handler, sem a marca de importação, emite `lead.created`", async () => {
    // Sem este caso, "nenhum evento" acima poderia ser o dublê engolindo o evento.
    await createLeadHandler(
      banco.cliente as never,
      { organization_id: ORG, actor: { type: "user", id: AUTOR, role: "admin" }, requestId: "controle" },
      { pipeline_id: FUNIL, stage_id: ETAPA_NOVO, title: "Negócio criado pela tela", tags: [], source: "manual" },
    );
    expect(eventos()).toEqual(["lead.created"]);
  });

  it("a reexecução não emite `lead.updated` nem `lead.tag_added`, mesmo acrescentando etiqueta", async () => {
    await importar([{ ...ABERTO, etiquetas: ["quente"] }]);
    const r = await importar([{ ...ABERTO, etiquetas: ["quente", "retorno"] }]);
    expect(r.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(leads()[0]!.tags).toEqual(["quente", "retorno"]);
    expect(eventos()).toEqual([]);
  });
});

describe("importar negócios: reexecução pela chave do CRM de origem", () => {
  it("a segunda rodada da mesma lista responde 'já estava' e não grava nada", async () => {
    const lista = [
      { ...ABERTO, valor: 1500, etiquetas: ["quente"], nota: "Nota de histórico." },
      { id_de_origem: "n-2", titulo: "Plano anual", funil: "Comercial", situacao: "ganho", valor: 4800, fechado_em: "2026-03-10" },
    ];
    await importar(lista);
    const escritasAntes = banco.escritas.length;

    const r = await importar(lista);

    expect(r, JSON.stringify(r.itens)).toMatchObject({ criou: 0, atualizou: 0, ja_estava: 2, recusou: 0 });
    expect(banco.escritas).toHaveLength(escritasAntes);
    expect(leads()).toHaveLength(2);
    // A nota de histórico não é regravada.
    expect(banco.tabela("crm_lead_activities")).toHaveLength(1);
  });

  it("o mesmo `id_de_origem` com OUTRA origem é outro negócio", async () => {
    await importar([ABERTO]);
    const r = await importar([ABERTO], { origem: "outro-crm" });
    expect(r.itens[0]).toMatchObject({ desfecho: "criou" });
    expect(leads().map((l) => l.source)).toEqual(["importacao:crm-antigo", "importacao:outro-crm"]);
  });

  it("a origem é normalizada: 'CRM Antigo' e 'crm_antigo' são a mesma", async () => {
    await importar([ABERTO], { origem: "CRM Antigo" });
    const r = await importar([ABERTO], { origem: "crm_antigo" });
    expect(r.itens[0]).toMatchObject({ desfecho: "ja_estava" });
    expect(leads()).toHaveLength(1);
  });

  it("'completar' só preenche o vazio; 'atualizar' substitui título e valor", async () => {
    await importar([{ ...ABERTO, valor: 1000 }]);

    const completar = await importar([{ ...ABERTO, titulo: "Pedido da padaria (revisado)", valor: 2000, descricao: "Entrega em junho." }]);
    expect(completar.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(completar.itens[0]!.avisos?.join(" ")).toMatch(/titulo, valor/);
    expect(leads()[0]).toMatchObject({ title: "Pedido da padaria", value_cents: 100000, description: "Entrega em junho." });

    const atualizar = await importar([{ ...ABERTO, titulo: "Pedido da padaria (revisado)", valor: 2000 }], {
      quando_ja_existe: "atualizar",
    });
    expect(atualizar.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(leads()[0]).toMatchObject({ title: "Pedido da padaria (revisado)", value_cents: 200000, description: "Entrega em junho." });
    // A edição é auditada como a da tela: só os NOMES dos campos.
    const edicao = auditSpy.mock.calls.map((c) => c[0] as { action: string; metadata: Record<string, unknown> }).filter((a) => a.action === "lead.updated");
    expect(edicao.at(-1)!.metadata).toMatchObject({ via: "importacao", fields: ["title", "value_cents"] });
  });

  it("etapa, situação e dono de um negócio que já existe NÃO são mexidos: a resposta avisa", async () => {
    await importar([ABERTO]);
    const r = await importar(
      [{ ...ABERTO, situacao: "ganho", dono_email: "vendedora@exemplo.invalid" }],
      { quando_ja_existe: "atualizar" },
    );
    expect(r.itens[0]).toMatchObject({ desfecho: "ja_estava" });
    expect(r.itens[0]!.avisos?.join(" ")).toContain("não foi movido");
    expect(leads()[0]).toMatchObject({ stage_id: ETAPA_PROPOSTA, status: "open", owner_user_id: null });
    expect(eventos()).toEqual([]);
  });

  it("o contato que faltava na primeira rodada é ligado na segunda; o que já estava ligado não é trocado", async () => {
    const primeira = await importar([{ ...ABERTO, contato_email: "ana.souza@exemplo.invalid" }]);
    expect(primeira.itens[0]!.avisos?.join(" ")).toContain("plataforma_importar_contatos");
    expect(leads()[0]!.contact_id).toBeNull();

    banco.tabela("contacts").push({
      id: "00000000-0000-4000-8000-00000000f201",
      organization_id: ORG,
      email: "ana.souza@exemplo.invalid",
      email_normalized: "ana.souza@exemplo.invalid",
      is_merged_into: null,
      is_anonymized: false,
      created_at: "2026-01-01T00:00:00Z",
    });
    const segunda = await importar([{ ...ABERTO, contato_email: "ANA.SOUZA@exemplo.invalid" }]);
    expect(segunda.itens[0]).toMatchObject({ desfecho: "atualizou" });
    expect(leads()[0]!.contact_id).toBe("00000000-0000-4000-8000-00000000f201");
  });
});

describe("importar negócios: a recusa que ensina", () => {
  it("funil que não existe: recusa dizendo quais existem, e não cria funil", async () => {
    const r = await importar([{ ...ABERTO, funil: "Vendas B2B" }]);
    expect(r.itens[0]).toMatchObject({ posicao: 1, desfecho: "recusou" });
    expect(r.itens[0]!.motivo).toContain("Item 1, campo `funil`");
    expect(r.itens[0]!.motivo).toContain('"Vendas B2B"');
    expect(r.itens[0]!.motivo).toContain('Os funis são: "Comercial"');
    expect(r.itens[0]!.motivo).toContain("não cria funil nem etapa");
    expect(banco.tabela("crm_pipelines")).toHaveLength(1);
    expect(leads()).toHaveLength(0);
  });

  it("etapa que não existe: recusa listando as etapas do funil, por tipo", async () => {
    const r = await importar([{ ...ABERTO, etapa: "Em negociação" }]);
    expect(r.itens[0]!.motivo).toContain("campo `etapa`");
    expect(r.itens[0]!.motivo).toContain('abertas: "Novo", "Proposta enviada"');
    expect(r.itens[0]!.motivo).toContain('de ganho: "Ganho"');
    expect(r.itens[0]!.motivo).toContain('de perda: "Perdido"');
    expect(banco.tabela("crm_stages")).toHaveLength(4);
    expect(leads()).toHaveLength(0);
  });

  it("funil e etapa casam pelo nome sem diferenciar caixa nem acento", async () => {
    const r = await importar([{ ...ABERTO, funil: "COMERCIAL", etapa: "proposta  enviada" }]);
    expect(r.itens[0], JSON.stringify(r.itens[0])).toMatchObject({ desfecho: "criou" });
  });

  it("situação que contradiz a etapa é recusada, com a saída", async () => {
    const r = await importar([
      { ...ABERTO, id_de_origem: "a", etapa: "Ganho" },
      { ...ABERTO, id_de_origem: "b", etapa: "Ganho", situacao: "perdido" },
      { ...ABERTO, id_de_origem: "c", etapa: undefined },
    ]);
    expect(r.recusou).toBe(3);
    expect(r.itens[0]!.motivo).toContain('situacao: "ganho"');
    expect(r.itens[1]!.motivo).toContain("é de ganho, e o negócio veio como perdido");
    expect(r.itens[2]!.motivo).toContain("negócio aberto precisa da etapa");
  });

  it("um item ruim no meio não derruba o lote", async () => {
    const r = await importar([
      ABERTO,
      { id_de_origem: "n-2", titulo: "Sem funil" },
      { id_de_origem: "n-3", titulo: "Plano anual", funil: "Comercial", situacao: "ganho" },
    ]);
    expect(r).toMatchObject({ total: 3, criou: 2, recusou: 1 });
    expect(r.itens[1]!.motivo).toContain("Item 2, campo `funil`");
    expect(leads()).toHaveLength(2);
  });

  it("recusa o que não dá para ler: sem id de origem, sem título, valor torto, data torta, situação desconhecida", () => {
    const casos: Array<[Record<string, unknown>, string, RegExp]> = [
      [{ id_de_origem: undefined }, "id_de_origem", /reexecução/],
      [{ titulo: "" }, "titulo", /título/],
      [{ titulo: "x" }, "titulo", /pelo menos 2/],
      [{ valor: "R$ 5.499,00 (promo)" }, "valor", /não é em centavos/i],
      [{ valor: -10 }, "valor", /unidade da moeda/],
      [{ moeda: "reais" }, "moeda", /três letras/],
      [{ criado_em: "ontem" }, "criado_em", /data/],
      [{ criado_em: "2099-01-01" }, "criado_em", /futuro/],
      [{ criado_em: "2026-03-01", fechado_em: "2026-02-01" }, "fechado_em", /anterior à criação/],
      [{ situacao: "congelado" }, "situacao", /"aberto", "ganho" ou "perdido"/],
      [{ etiquetas: "quente" }, "etiquetas", /lista/],
      [{ campos: "prazo=junho" }, "campos", /objeto/],
      [{ descricao: "x".repeat(2001) }, "descricao", /no máximo 2000/],
    ];
    for (const [extra, campo, esperado] of casos) {
      const lido = lerNegocio({ ...ABERTO, ...extra });
      expect(lido.ok, JSON.stringify(extra)).toBe(false);
      if (!lido.ok) {
        expect(lido.campo, JSON.stringify(extra)).toBe(campo);
        expect(lido.esperado).toMatch(esperado);
      }
    }
    expect(lerNegocio("negócio solto").ok).toBe(false);
  });

  it("dono que não é da equipe (ou só lê): o negócio entra sem responsável, e a resposta diz por quê", async () => {
    const r = await importar([
      { ...ABERTO, id_de_origem: "a", dono_email: "fulano@fora.exemplo.invalid" },
      { ...ABERTO, id_de_origem: "b", dono_email: "leitor@exemplo.invalid" },
    ]);
    expect(r.criou).toBe(2);
    expect(leads().map((l) => l.owner_user_id)).toEqual([null, null]);
    expect(r.itens[0]!.avisos?.join(" ")).toContain("sem responsável");
  });

  it("campo que o funil não tem é gravado e avisado", async () => {
    const r = await importar([{ ...ABERTO, campos: { prazo: "junho", cor_favorita: "azul" } }]);
    expect(leads()[0]!.custom_fields).toEqual({ prazo: "junho", cor_favorita: "azul" });
    expect(r.itens[0]!.avisos?.join(" ")).toContain('"cor_favorita"');
  });

  it("organização inexistente, origem ausente, lista vazia e lista acima do teto: recusa a chamada inteira", async () => {
    await expect(
      importarNegocios(ctx(), { organization_id: "00000000-0000-4000-8000-00000000dead", origem: "crm", negocios: [ABERTO] }),
    ).rejects.toThrow(/plataforma_listar_clientes/);
    await expect(importarNegocios(ctx(), { organization_id: ORG, negocios: [ABERTO] })).rejects.toThrow(/`origem` é obrigatória/);
    await expect(importar([])).rejects.toThrow(/pelo menos 1 item/);
    const demais = Array.from({ length: TETO_DE_NEGOCIOS + 1 }, (_, i) => ({ ...ABERTO, id_de_origem: `n-${i}` }));
    await expect(importar(demais)).rejects.toThrow(new RegExp(`teto é ${TETO_DE_NEGOCIOS}`));
    expect(leads()).toHaveLength(0);
  });

  it("funil sem etapa de ganho: recusa o negócio ganho dizendo o que falta", async () => {
    banco.tabela("crm_stages").find((e) => e.id === ETAPA_GANHO)!.is_archived = true;
    const r = await importar([{ id_de_origem: "n-9", titulo: "Plano anual", funil: "Comercial", situacao: "ganho" }]);
    expect(r.itens[0]).toMatchObject({ desfecho: "recusou" });
    expect(r.itens[0]!.motivo).toContain("não tem etapa de ganho");
  });
});

describe("importar negócios: o rastro", () => {
  it("a linha da importação tem contagens e ids; nenhum título, telefone ou e-mail", async () => {
    await importar([{ ...ABERTO, contato_telefone: "(10) 99111-0001", dono_email: "vendedora@exemplo.invalid", nota: "Cliente exigente." }]);
    const linha = auditSpy.mock.calls
      .map((c) => c[0] as { action: string; metadata: Record<string, unknown> })
      .find((a) => a.action === "plataforma.importacao")!;
    expect(linha.metadata).toMatchObject({ tipo: "negocios", origem: "crm-antigo", total: 1, criou: 1 });
    expect(linha.metadata.ids_criados).toEqual([leads()[0]!.id]);
    const texto = JSON.stringify(linha);
    for (const dado of ["Pedido da padaria", "99111", "exemplo.invalid", "exigente"]) expect(texto).not.toContain(dado);
  });

  it("a redação dos argumentos troca a lista pela contagem", () => {
    const redigido = FERRAMENTA_IMPORTAR_NEGOCIOS.redigirParaAuditoria({
      organization_id: ORG,
      origem: "crm-antigo",
      negocios: [{ ...ABERTO, contato_telefone: "(10) 99111-0001" }],
    });
    expect(redigido).toEqual({ organization_id: ORG, origem: "crm-antigo", negocios: { itens: 1 } });
  });
});
