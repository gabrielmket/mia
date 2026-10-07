/**
 * FORK MIA — CADA FERRAMENTA de implantação, pelo protocolo, contra tabelas de
 * verdade em memória.
 *
 * Para cada área: o caminho feliz (o que foi GRAVADO, em qual linha), a
 * REEXECUÇÃO (a segunda chamada não duplica e responde "já estava"), a recusa
 * que ensina, e a empresa de demonstração onde ela se aplica. A recusa por
 * operação ausente no token e por organização inexistente é medida para todas
 * de uma vez em `mcp-de-implantacao-ferramentas.test.ts`.
 *
 * O que se mede é o banco, não a resposta: uma ferramenta que respondesse
 * "criou" sem gravar passaria num teste que só lesse o texto.
 *
 * A prova contra o Postgres de verdade (as funções do banco, as constraints e
 * os gatilhos) mora em `tests/invariants/mcp-de-implantacao-ponta-a-ponta.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTOR,
  cenarioDaImplantacao,
  clienteMcp,
  FUNIL_SEMEADO,
  NUMERO,
  ORG,
  OUTRA_ORG,
  TODAS_AS_OPERACOES,
  type OpcoesDoCenario,
} from "@/tests/helpers/implantacao-em-memoria";
import type { Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown }));
const convite = vi.hoisted(() => ({ emailSai: true }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
// A chave que indexa o conhecimento é da plataforma; aqui ela existe.
vi.mock("@/lib/ai/embeddings/chave", () => ({ temChaveDeEmbedding: vi.fn(async () => true) }));
// O e-mail do convite: o que sai daqui é o que o teste mede, sem tocar em servidor de e-mail.
// `emitirConvite` chama duas vezes (9020): com `dispatch: false` só confere e assina,
// e a segunda, depois de a linha existir, é a que manda o e-mail. O dublê responde igual.
vi.mock("@/lib/auth/issue-invite", () => ({
  issueInvite: vi.fn(async (input: { email: string; inviteId: string; dispatch?: boolean }) => {
    const envia = input.dispatch !== false;
    return {
      email: input.email,
      invite_id: input.inviteId,
      expires_at: "2099-01-01T00:00:00.000Z",
      email_dispatched: envia && convite.emailSai,
      email_error: envia && !convite.emailSai ? "not_configured" : undefined,
      accept_url: "https://exemplo.invalid/team/accept-invite/ficticio",
    };
  }),
}));
// A Meta: nenhuma chamada sai de um teste. Os dublês contam se foram chamados.
vi.mock("@/lib/channels/meta/criar-template", () => ({
  criarTemplate: vi.fn(async () => ({ criado: true, id: "modelo-ficticio", status: "PENDING", category: "UTILITY" })),
}));
vi.mock("@/lib/channels/meta/credenciais-da-org", () => ({
  credenciaisDaOrg: vi.fn(async () => ({ wabaId: "conta-oficial-ficticia", phoneNumberId: "1", token: "t", graphVersion: "v0", origem: "org" })),
}));
vi.mock("@/lib/channels/meta/template-sync", () => ({ syncTemplates: vi.fn(async () => ({})) }));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { issueInvite } = await import("@/lib/auth/issue-invite");
const { criarTemplate } = await import("@/lib/channels/meta/criar-template");
const { audit } = await import("@/lib/audit");

/** As chamadas a `issueInvite` que MANDAM o e-mail (as de `dispatch: false` só assinam). */
function enviosDeConvite() {
  return vi
    .mocked(issueInvite)
    .mock.calls.map(([pedido]) => pedido)
    .filter((pedido) => pedido.dispatch !== false);
}

async function preparar(opcoes: OpcoesDoCenario = {}) {
  const cenario = cenarioDaImplantacao(opcoes);
  estado.cliente = cenario.cliente;
  const mcp = await clienteMcp(criarServidorDePlataforma as never, TODAS_AS_OPERACOES);
  return { ...cenario, mcp, tabela: (nome: string) => cenario.banco.tabela(nome) as Linha[] };
}

const ETAPAS_DA_CLINICA = [
  { nome: "Novo contato", passo: "new" },
  { nome: "Já respondi", passo: "contacted" },
  { nome: "Entendendo o caso", passo: "qualifying", probabilidade: 20 },
  { nome: "Quer agendar", passo: "qualified", probabilidade: 50 },
  { nome: "Escolhendo horário", passo: "negotiating", probabilidade: 80, prazo_esperado_horas: 48, cor: "#12A594" },
  { nome: "Consulta marcada", passo: "won" },
  { nome: "Não vai marcar", passo: "lost" },
];

const PROMPT = "Você é a Bia, atendente da Clínica Exemplo. Entenda o que a pessoa procura antes de oferecer um horário.";

beforeEach(() => {
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
  convite.emailSai = true;
  vi.mocked(issueInvite).mockClear();
  vi.mocked(criarTemplate).mockClear();
  vi.mocked(audit).mockClear();
});

// ---------------------------------------------------------------------------

describe("plataforma_configurar_empresa", () => {
  it("grava só o que veio, e a segunda chamada igual não escreve nada", async () => {
    const { mcp, tabela, banco } = await preparar();
    const r = await mcp.chamar("plataforma_configurar_empresa", {
      organization_id: ORG,
      nome: "Clínica Exemplo Centro",
      fuso: "America/Manaus",
      modo_de_venda: "b2c",
    });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.desfecho).toBe("atualizou");
    expect(r.dados.mudancas).toEqual(["nome", "fuso", "modo de venda"]);
    const org = tabela("organizations")[0]!;
    expect(org).toMatchObject({ display_name: "Clínica Exemplo Centro", timezone: "America/Manaus", legal_name: "Clínica Exemplo LTDA" });
    expect((org.settings as Linha).modo_de_venda).toBe("b2c");

    const antes = banco.escritas.length;
    const de_novo = await mcp.chamar("plataforma_configurar_empresa", {
      organization_id: ORG,
      nome: "Clínica Exemplo Centro",
      fuso: "America/Manaus",
      modo_de_venda: "b2c",
    });
    expect(de_novo.dados.desfecho).toBe("ja_estava");
    expect(banco.escritas.length, "a segunda chamada escreveu no banco").toBe(antes);
  });

  it("o salvamento comum NÃO toca em `settings` (é a regra da tela: só quando o modo de venda muda)", async () => {
    const { mcp, banco } = await preparar();
    await mcp.chamar("plataforma_configurar_empresa", { organization_id: ORG, nome: "Outro Nome" });
    const escrita = banco.escritas.find((e) => e.tabela === "organizations")!;
    expect(Object.keys(escrita.payload as Linha)).toEqual(["display_name"]);
  });

  it("fuso que não existe é recusado com exemplo, e nada é gravado", async () => {
    const { mcp, banco } = await preparar();
    const r = await mcp.chamar("plataforma_configurar_empresa", { organization_id: ORG, fuso: "America/São Paulo" });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("não é um fuso horário válido");
    expect(r.texto).toContain('"America/Sao_Paulo"');
    expect(banco.escritas).toEqual([]);
  });

  it("sem campo nenhum: a recusa diz o que mandar", async () => {
    const { mcp } = await preparar();
    const r = await mcp.chamar("plataforma_configurar_empresa", { organization_id: ORG });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("Informe ao menos um campo");
  });
});

describe("plataforma_configurar_atendimento", () => {
  it("liga o rodízio e restringe a visibilidade, preservando as outras chaves de settings", async () => {
    const { mcp, tabela } = await preparar();
    tabela("organizations")[0]!.settings = { llm: { provider: "openai" }, tags: ["vip"] };
    const r = await mcp.chamar("plataforma_configurar_atendimento", {
      organization_id: ORG,
      modo: "round_robin",
      visibilidade: "own",
      devolver_para_a_ia_apos_minutos: 60,
    });
    expect(r.erro, r.texto).toBe(false);
    const settings = tabela("organizations")[0]!.settings as Linha;
    expect(settings.llm).toEqual({ provider: "openai" });
    expect(settings.tags).toEqual(["vip"]);
    expect(settings.visibility_mode).toBe("own");
    expect(settings.routing).toMatchObject({ mode: "round_robin", handoff_return_after_minutes: 60 });

    const de_novo = await mcp.chamar("plataforma_configurar_atendimento", { organization_id: ORG, modo: "round_robin" });
    expect(de_novo.dados.desfecho).toBe("ja_estava");
  });
});

// ---------------------------------------------------------------------------

describe("plataforma_garantir_funil", () => {
  it("ADOTA o funil de e-commerce que nasce com a organização: mesmo id, nome e etapas do cliente", async () => {
    const { mcp, tabela } = await preparar();
    const r = await mcp.chamar("plataforma_garantir_funil", {
      organization_id: ORG,
      nome: "Agendamentos",
      adotar_funil_padrao: true,
      etapas: ETAPAS_DA_CLINICA,
    });
    expect(r.erro, r.texto).toBe(false);
    const funil = r.dados.funil as Linha;
    expect(funil).toMatchObject({ id: FUNIL_SEMEADO, nome: "Agendamentos", desfecho: "atualizou", adotou_o_funil_padrao: true, padrao: true });

    expect(tabela("crm_pipelines")).toHaveLength(1);
    expect(tabela("crm_pipelines")[0]).toMatchObject({ name: "Agendamentos", slug: "agendamentos", is_default: true });
    const etapas = tabela("crm_stages").sort((a, b) => Number(a.position) - Number(b.position));
    expect(etapas.map((e) => e.name)).toEqual(ETAPAS_DA_CLINICA.map((e) => e.nome));
    // Nenhuma etapa de e-commerce sobrou.
    expect(etapas.some((e) => e.slug === "carrinho_abandonado")).toBe(false);
    // O passo do agente em cada etapa, e ganho/perda derivados do passo.
    expect(etapas.map((e) => e.agent_stage_hint)).toEqual(["new", "contacted", "qualifying", "qualified", "negotiating", "won", "lost"]);
    expect(etapas.filter((e) => e.is_won).map((e) => e.name)).toEqual(["Consulta marcada"]);
    expect(etapas.filter((e) => e.is_lost).map((e) => e.name)).toEqual(["Não vai marcar"]);
    // Probabilidade, prazo e cor.
    const negociando = etapas.find((e) => e.name === "Escolhendo horário")!;
    expect(negociando).toMatchObject({ win_probability: 80, expected_duration_hours: 48, color: "#12a594" });
  });

  it("REEXECUÇÃO: o mesmo pedido de novo não cria funil nem etapa, e nada é escrito", async () => {
    const { mcp, tabela, banco } = await preparar();
    const pedido = { organization_id: ORG, nome: "Agendamentos", adotar_funil_padrao: true, etapas: ETAPAS_DA_CLINICA };
    await mcp.chamar("plataforma_garantir_funil", pedido);
    const idsAntes = tabela("crm_stages").map((e) => e.id).sort();
    const escritasAntes = banco.escritas.length;

    const r = await mcp.chamar("plataforma_garantir_funil", pedido);
    expect(r.erro, r.texto).toBe(false);
    expect((r.dados.funil as Linha).desfecho).toBe("ja_estava");
    expect((r.dados.etapas as Linha[]).map((e) => e.desfecho)).toEqual(Array(7).fill("ja_estava"));
    expect(tabela("crm_pipelines")).toHaveLength(1);
    expect(tabela("crm_stages").map((e) => e.id).sort(), "as etapas mudaram de id").toEqual(idsAntes);
    expect(banco.escritas.length, "a segunda chamada escreveu no banco").toBe(escritasAntes);
  });

  it("funil em uso: acrescenta a etapa nova, ajusta o que mudou e NÃO troca o id das que ficam", async () => {
    const { mcp, tabela } = await preparar();
    await mcp.chamar("plataforma_garantir_funil", { organization_id: ORG, nome: "Agendamentos", adotar_funil_padrao: true, etapas: ETAPAS_DA_CLINICA });
    const idDe = (nome: string) => tabela("crm_stages").find((e) => e.name === nome)!.id;
    const idAntes = idDe("Quer agendar");

    const novas = [
      ...ETAPAS_DA_CLINICA.slice(0, 4),
      { nome: "Aguardando exames", passo: null },
      { nome: "Escolhendo horário", passo: "negotiating", probabilidade: 90 },
      ...ETAPAS_DA_CLINICA.slice(5),
    ];
    const r = await mcp.chamar("plataforma_garantir_funil", { organization_id: ORG, nome: "Agendamentos", etapas: novas });
    expect(r.erro, r.texto).toBe(false);
    const porNome = Object.fromEntries((r.dados.etapas as Linha[]).map((e) => [e.nome, e]));
    expect(porNome["Aguardando exames"]).toMatchObject({ desfecho: "criou" });
    expect(porNome["Escolhendo horário"]).toMatchObject({ desfecho: "atualizou" });
    expect((porNome["Escolhendo horário"] as { mudancas: string[] }).mudancas).toContain("probabilidade");
    expect(porNome["Novo contato"]).toMatchObject({ desfecho: "atualizou", mudancas: ["ordem"] });
    expect(idDe("Quer agendar"), "a etapa que ficou mudou de id").toBe(idAntes);
    // A ordem do quadro é a do pedido.
    const ordem = tabela("crm_stages").filter((e) => !e.is_archived).sort((a, b) => Number(a.position) - Number(b.position)).map((e) => e.name);
    expect(ordem).toEqual(novas.map((e) => e.nome));
  });

  it("etapa que o pedido NÃO cita fica no quadro, e a resposta avisa; arquivar é pedido explícito", async () => {
    const { mcp, tabela } = await preparar();
    await mcp.chamar("plataforma_garantir_funil", { organization_id: ORG, nome: "Agendamentos", adotar_funil_padrao: true, etapas: ETAPAS_DA_CLINICA });
    const menos = ETAPAS_DA_CLINICA.filter((e) => e.nome !== "Já respondi");

    const r = await mcp.chamar("plataforma_garantir_funil", { organization_id: ORG, nome: "Agendamentos", etapas: menos });
    expect(r.dados.etapas_fora_da_lista).toEqual([expect.objectContaining({ nome: "Já respondi", arquivada: false })]);
    expect((r.dados.avisos as string[]).join(" ")).toContain("arquivar_etapas_fora_da_lista");
    expect(tabela("crm_stages").find((e) => e.name === "Já respondi")!.is_archived).toBe(false);

    const arquivando = await mcp.chamar("plataforma_garantir_funil", {
      organization_id: ORG,
      nome: "Agendamentos",
      etapas: menos,
      arquivar_etapas_fora_da_lista: true,
    });
    expect(arquivando.dados.etapas_fora_da_lista).toEqual([expect.objectContaining({ nome: "Já respondi", arquivada: true })]);
    expect(tabela("crm_stages").find((e) => e.name === "Já respondi")!.is_archived).toBe(true);
  });

  it("sem `adotar_funil_padrao`, cria um SEGUNDO funil e deixa o padrão como está", async () => {
    const { mcp, tabela } = await preparar();
    const r = await mcp.chamar("plataforma_garantir_funil", { organization_id: ORG, nome: "Pós-venda", etapas: ETAPAS_DA_CLINICA });
    expect((r.dados.funil as Linha).desfecho).toBe("criou");
    expect(tabela("crm_pipelines").map((f) => f.name).sort()).toEqual(["Pedidos", "Pós-venda"]);
    expect(tabela("crm_pipelines").find((f) => f.name === "Pós-venda")!.is_default).toBe(false);
    // O semeado segue inteiro.
    expect(tabela("crm_stages").filter((e) => e.pipeline_id === FUNIL_SEMEADO)).toHaveLength(8);
  });

  it("campos e motivos: acrescenta os do pedido, atualiza pela chave e preserva os que já existem", async () => {
    const { mcp, tabela } = await preparar();
    tabela("crm_pipelines")[0]!.settings = { fields: [{ key: "origem", label: "Origem", type: "text" }], lost_reasons: ["Sem interesse"] };
    const pedido = {
      organization_id: ORG,
      nome: "Agendamentos",
      adotar_funil_padrao: true,
      etapas: ETAPAS_DA_CLINICA,
      campos: [
        { key: "procedimento", label: "Procedimento", type: "select", options: [{ value: "limpeza", label: "Limpeza" }], obrigatorio_em: { etapas: ["Quer agendar"], ao_ganhar: true } },
      ],
      motivos_de_perda: ["Achou caro", { label: "Sem interesse", categoria: "Cliente" }],
    };
    const r = await mcp.chamar("plataforma_garantir_funil", pedido);
    expect(r.erro, r.texto).toBe(false);
    const settings = tabela("crm_pipelines")[0]!.settings as { fields: Linha[]; lost_reasons: unknown[] };
    expect(settings.fields.map((f) => f.key)).toEqual(["origem", "procedimento"]);
    // O nome da etapa virou o id dela.
    const etapa = tabela("crm_stages").find((e) => e.name === "Quer agendar")!;
    expect((settings.fields[1]!.obrigatorio_em as Linha).etapas).toEqual([etapa.id]);
    expect(settings.lost_reasons).toEqual([{ label: "Sem interesse", categoria: "Cliente" }, "Achou caro"]);

    const de_novo = await mcp.chamar("plataforma_garantir_funil", pedido);
    expect((de_novo.dados.configuracao as Linha).desfecho).toBe("ja_estava");
  });

  it("recusas que ensinam: sem etapa de ganho, passo repetido, e campo obrigatório em etapa que não existe", async () => {
    const { mcp, banco } = await preparar();
    const semGanho = await mcp.chamar("plataforma_garantir_funil", {
      organization_id: ORG,
      nome: "Vendas",
      etapas: [{ nome: "Novo", passo: "new" }, { nome: "Perdeu", passo: "lost" }],
    });
    expect(semGanho.erro).toBe(true);
    expect(semGanho.texto).toContain('`passo: "won"`');

    const repetido = await mcp.chamar("plataforma_garantir_funil", {
      organization_id: ORG,
      nome: "Vendas",
      etapas: [{ nome: "A", passo: "new" }, { nome: "B", passo: "new" }, { nome: "Ganhou", passo: "won" }, { nome: "Perdeu", passo: "lost" }],
    });
    expect(repetido.texto).toContain("declaram o mesmo passo");
    expect(banco.escritas, "recusa de validação gravou algo").toEqual([]);

    const etapaErrada = await mcp.chamar("plataforma_garantir_funil", {
      organization_id: ORG,
      nome: "Vendas",
      etapas: ETAPAS_DA_CLINICA,
      campos: [{ key: "x", label: "X", type: "text", obrigatorio_em: { etapas: ["Etapa que não existe"] } }],
    });
    expect(etapaErrada.texto).toContain("este funil não tem uma etapa com esse nome");
  });

  it("adotar funil padrão que JÁ TEM negócio é recusado, e a recusa diz a saída", async () => {
    const { mcp, tabela } = await preparar();
    tabela("crm_leads").push({ id: "n1", organization_id: ORG, pipeline_id: FUNIL_SEMEADO });
    const r = await mcp.chamar("plataforma_garantir_funil", { organization_id: ORG, nome: "Agendamentos", adotar_funil_padrao: true, etapas: ETAPAS_DA_CLINICA });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("já tem 1 negócio(s)");
    expect(r.texto).toContain("SEM `adotar_funil_padrao`");
    expect(tabela("crm_pipelines")[0]!.name).toBe("Pedidos");
  });
});

// ---------------------------------------------------------------------------

describe("plataforma_garantir_produtos", () => {
  const PRODUTOS = [
    { codigo: "PLANO-MENSAL", nome: "Plano mensal", descricao: "Acesso livre.", preco_cents: 14990, categoria: "Planos" },
    { codigo: "AVALIACAO", nome: "Avaliação inicial", preco: "R$ 80,00" },
    { nome: "Aula avulsa", preco_cents: 3500, quantidade: 10 },
  ];

  it("importa o lote, com a moeda da empresa e o desfecho item a item", async () => {
    const { mcp, tabela } = await preparar();
    const r = await mcp.chamar("plataforma_garantir_produtos", { organization_id: ORG, produtos: PRODUTOS });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados).toMatchObject({ total: 3, criados: 3, atualizados: 0, ja_estavam: 0, recusados: 0 });
    const catalogo = tabela("catalog_products");
    expect(catalogo).toHaveLength(3);
    expect(catalogo.every((p) => p.organization_id === ORG && p.moeda === "BRL" && p.origem === "implantacao")).toBe(true);
    expect(catalogo.find((p) => p.codigo === "AVALIACAO")).toMatchObject({ preco_cents: 8000, controla_estoque: false });
    // Sem código, o nome vira a identidade; com quantidade, passa a controlar estoque.
    expect(catalogo.find((p) => p.codigo === "Aula avulsa")).toMatchObject({ controla_estoque: true, quantidade: 10 });
  });

  it("REEXECUÇÃO: o mesmo lote de novo não duplica; mudar um preço atualiza SÓ aquele produto e SÓ aquele campo", async () => {
    const { mcp, tabela, banco } = await preparar();
    await mcp.chamar("plataforma_garantir_produtos", { organization_id: ORG, produtos: PRODUTOS });
    const antes = banco.escritas.length;

    const igual = await mcp.chamar("plataforma_garantir_produtos", { organization_id: ORG, produtos: PRODUTOS });
    expect(igual.dados).toMatchObject({ criados: 0, atualizados: 0, ja_estavam: 3 });
    expect(tabela("catalog_products")).toHaveLength(3);
    expect(banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);

    const mudou = await mcp.chamar("plataforma_garantir_produtos", {
      organization_id: ORG,
      produtos: [{ codigo: "PLANO-MENSAL", nome: "Plano mensal", preco_cents: 15990 }, PRODUTOS[1]],
    });
    expect(mudou.dados).toMatchObject({ atualizados: 1, ja_estavam: 1 });
    expect((mudou.dados.itens as Linha[])[0]).toMatchObject({ desfecho: "atualizou", mudancas: ["preço"] });
    const plano = tabela("catalog_products").find((p) => p.codigo === "PLANO-MENSAL")!;
    // A descrição que o item não trouxe continua lá.
    expect(plano).toMatchObject({ preco_cents: 15990, descricao: "Acesso livre." });
    expect(Object.keys(banco.escritas.at(-1)!.payload as Linha)).toEqual(["preco_cents"]);
  });

  it("item com problema é recusado COM MOTIVO e não derruba os outros", async () => {
    const { mcp, tabela } = await preparar();
    const r = await mcp.chamar("plataforma_garantir_produtos", {
      organization_id: ORG,
      produtos: [
        { codigo: "A1", nome: "Item bom", preco_cents: 1000 },
        { codigo: "A2", nome: "Sem preço" },
        { codigo: "A3", nome: "Preço ilegível", preco: "de 89,90 por 49,90" },
        { codigo: "a1", nome: "Mesmo código em outra caixa", preco_cents: 500 },
        { nome: "X", preco_cents: 100 },
      ],
    });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados).toMatchObject({ criados: 1, recusados: 4 });
    const itens = r.dados.itens as Array<{ posicao: number; desfecho: string; motivo?: string }>;
    expect(itens.map((i) => i.desfecho)).toEqual(["criou", "recusado", "recusado", "recusado", "recusado"]);
    expect(itens[1]!.motivo).toContain("falta o preço");
    expect(itens[2]!.motivo).toContain("preço não reconhecido");
    expect(itens[3]!.motivo).toContain("código repetido nesta chamada");
    expect(itens[4]!.motivo).toContain("nome");
    expect(tabela("catalog_products").map((p) => p.codigo)).toEqual(["A1"]);
  });

  it("código que só difere na caixa de um produto JÁ no catálogo é recusado (o agente os veria como um só, com dois preços)", async () => {
    const { mcp, tabela } = await preparar();
    await mcp.chamar("plataforma_garantir_produtos", { organization_id: ORG, produtos: [{ codigo: "IP15", nome: "Aparelho", preco_cents: 100 }] });
    const r = await mcp.chamar("plataforma_garantir_produtos", { organization_id: ORG, produtos: [{ codigo: "ip15", nome: "Aparelho", preco_cents: 200 }] });
    expect((r.dados.itens as Linha[])[0]).toMatchObject({ desfecho: "recusado" });
    expect(String((r.dados.itens as Linha[])[0]!.motivo)).toContain('já está no catálogo escrito "IP15"');
    expect(tabela("catalog_products")).toHaveLength(1);
  });

  it("não alcança o catálogo de OUTRA organização com o mesmo código", async () => {
    const { mcp, tabela } = await preparar();
    tabela("catalog_products").push({ id: "p-alheio", organization_id: OUTRA_ORG, codigo: "PLANO-MENSAL", nome: "Alheio", preco_cents: 1, moeda: "BRL" });
    const r = await mcp.chamar("plataforma_garantir_produtos", { organization_id: ORG, produtos: [PRODUTOS[0]] });
    expect(r.dados).toMatchObject({ criados: 1 });
    expect(tabela("catalog_products").find((p) => p.id === "p-alheio")).toMatchObject({ nome: "Alheio", preco_cents: 1 });
  });
});

// ---------------------------------------------------------------------------

describe("plataforma_garantir_etiquetas", () => {
  it("põe as etiquetas no vocabulário, com a cor normalizada, preservando o que já havia", async () => {
    const { mcp, tabela } = await preparar();
    tabela("organizations")[0]!.settings = { tags: ["vip"], visibility_mode: "own" };
    const r = await mcp.chamar("plataforma_garantir_etiquetas", {
      organization_id: ORG,
      etiquetas: [{ nome: "Plano anual", cor: "#12A594" }, { nome: "VIP", cor: "#0091ff" }],
    });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados).toMatchObject({ criadas: 1, atualizadas: 1, ja_estavam: 0 });
    const settings = tabela("organizations")[0]!.settings as Linha;
    expect(settings.tags).toEqual([{ tag: "vip", cor: "#0091ff" }, { tag: "Plano anual", cor: "#12a594" }]);
    // A chave que a RLS lê não foi tocada.
    expect(settings.visibility_mode).toBe("own");

    const de_novo = await mcp.chamar("plataforma_garantir_etiquetas", {
      organization_id: ORG,
      etiquetas: [{ nome: "Plano anual", cor: "#12a594" }, { nome: "vip" }],
    });
    expect(de_novo.dados).toMatchObject({ criadas: 0, atualizadas: 0, ja_estavam: 2 });
    expect((tabela("organizations")[0]!.settings as { tags: unknown[] }).tags).toHaveLength(2);
  });

  it("cor inválida e etiqueta repetida são recusadas com exemplo", async () => {
    const { mcp, banco } = await preparar();
    const cor = await mcp.chamar("plataforma_garantir_etiquetas", { organization_id: ORG, etiquetas: [{ nome: "Urgente", cor: "vermelho" }] });
    expect(cor.erro).toBe(true);
    expect(cor.texto).toContain('formato #rrggbb (ex.: "#12a594")');
    const repetida = await mcp.chamar("plataforma_garantir_etiquetas", { organization_id: ORG, etiquetas: [{ nome: "Urgente" }, { nome: "urgente" }] });
    expect(repetida.texto).toContain("aparece duas vezes");
    expect(banco.escritas).toEqual([]);
  });
});

describe("plataforma_gravar_memoria", () => {
  it("publica as regras da casa e grava as anotações; repetir não cria versão nem anotação nova", async () => {
    const { mcp, tabela } = await preparar();
    const pedido = {
      organization_id: ORG,
      documento: "Nunca prometa desconto acima de 10%.",
      anotacoes: [{ titulo: "Estacionamento", corpo: "Convênio ao lado, uma hora grátis." }],
    };
    const r = await mcp.chamar("plataforma_gravar_memoria", pedido);
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.documento).toEqual({ desfecho: "criou", versao: 1 });
    expect(tabela("org_memory_versions")).toHaveLength(1);
    expect(tabela("org_memory_versions")[0]).toMatchObject({ organization_id: ORG, content: pedido.documento, created_by: AUTOR });
    expect(tabela("org_memory_pointers")[0]!.version_id).toBe(tabela("org_memory_versions")[0]!.id);
    expect(tabela("org_memory_entries")[0]).toMatchObject({ source: "manual", status: "active", created_by: AUTOR });

    const de_novo = await mcp.chamar("plataforma_gravar_memoria", pedido);
    expect(de_novo.dados.documento).toEqual({ desfecho: "ja_estava", versao: 1 });
    expect((de_novo.dados.anotacoes as Linha[])[0]!.desfecho).toBe("ja_estava");
    expect(tabela("org_memory_versions")).toHaveLength(1);
    expect(tabela("org_memory_entries")).toHaveLength(1);
  });

  it("texto novo vira a versão 2; anotação com corpo novo arquiva a antiga em vez de sobrescrever", async () => {
    const { mcp, tabela } = await preparar();
    await mcp.chamar("plataforma_gravar_memoria", { organization_id: ORG, documento: "Regra um.", anotacoes: [{ titulo: "Horário", corpo: "Das 8h às 18h." }] });
    const r = await mcp.chamar("plataforma_gravar_memoria", { organization_id: ORG, documento: "Regra um e dois.", anotacoes: [{ titulo: "Horário", corpo: "Das 8h às 20h." }] });
    expect(r.dados.documento).toEqual({ desfecho: "atualizou", versao: 2 });
    expect(tabela("org_memory_versions")).toHaveLength(2);
    const anotacoes = tabela("org_memory_entries");
    expect(anotacoes.map((a) => [a.body, a.status])).toEqual([["Das 8h às 18h.", "archived"], ["Das 8h às 20h.", "active"]]);
  });

  it("sem documento e sem anotação: a recusa diz o que mandar", async () => {
    const { mcp } = await preparar();
    const r = await mcp.chamar("plataforma_gravar_memoria", { organization_id: ORG });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("Informe `documento`");
  });
});

// ---------------------------------------------------------------------------

describe("plataforma_garantir_conhecimento", () => {
  const FAQ = {
    organization_id: ORG,
    nome: "Perguntas frequentes",
    tipo: "faq",
    perguntas: [{ pergunta: "Atendem aos sábados?", resposta: "Sim, das 8h às 13h." }],
  };

  it("cadastra o FAQ, grava as perguntas e pede a indexação", async () => {
    const { mcp, tabela, banco } = await preparar();
    const r = await mcp.chamar("plataforma_garantir_conhecimento", FAQ);
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.material).toMatchObject({ nome: "Perguntas frequentes", tipo: "faq", desfecho: "criou" });
    expect(r.dados.indexacao_habilitada).toBe(true);
    expect(tabela("ai_knowledge_sources")[0]).toMatchObject({ organization_id: ORG, source_type: "faq", is_active: true, status: "ready" });
    expect(tabela("ai_faq_items")).toHaveLength(1);
    expect(banco.chamadasRpc.map((c) => c.nome)).toContain("emit_event");
  });

  it("REEXECUÇÃO igual não mexe; com outras perguntas, TROCA os itens no mesmo material (o id não muda)", async () => {
    const { mcp, tabela } = await preparar();
    const criado = await mcp.chamar("plataforma_garantir_conhecimento", FAQ);
    const id = (criado.dados.material as Linha).id;

    const igual = await mcp.chamar("plataforma_garantir_conhecimento", FAQ);
    expect((igual.dados.material as Linha).desfecho).toBe("ja_estava");
    expect(tabela("ai_knowledge_sources")).toHaveLength(1);

    const outro = await mcp.chamar("plataforma_garantir_conhecimento", {
      ...FAQ,
      perguntas: [...FAQ.perguntas, { pergunta: "Aceitam convênio?", resposta: "Não." }],
    });
    expect(outro.dados.material).toMatchObject({ id, desfecho: "atualizou" });
    expect(tabela("ai_knowledge_sources")).toHaveLength(1);
    expect(tabela("ai_faq_items").map((i) => i.question)).toEqual(["Atendem aos sábados?", "Aceitam convênio?"]);
  });

  it("documento: o mesmo texto de novo é `ja_estava`; outro texto é recusado com a saída", async () => {
    const { mcp, tabela } = await preparar();
    const doc = { organization_id: ORG, nome: "Política de cancelamento", tipo: "documento", texto: "Cancelamentos com 24 horas de antecedência." };
    expect((await mcp.chamar("plataforma_garantir_conhecimento", doc)).dados.material).toMatchObject({ desfecho: "criou" });
    expect((await mcp.chamar("plataforma_garantir_conhecimento", doc)).dados.material).toMatchObject({ desfecho: "ja_estava" });
    const outro = await mcp.chamar("plataforma_garantir_conhecimento", { ...doc, texto: "Cancelamentos com 48 horas." });
    expect(outro.erro).toBe(true);
    expect(outro.texto).toContain("um documento não é editado no lugar");
    expect(outro.texto).toContain("prefira o tipo faq");
    expect(tabela("ai_knowledge_sources")).toHaveLength(1);
  });

  it("FAQ sem perguntas é recusado com o formato", async () => {
    const { mcp } = await preparar();
    const r = await mcp.chamar("plataforma_garantir_conhecimento", { organization_id: ORG, nome: "Vazio", tipo: "faq" });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain('"pergunta": "..."');
  });
});

// ---------------------------------------------------------------------------

describe("plataforma_garantir_agente, plataforma_publicar_agente e plataforma_pausar_agente", () => {
  async function comFunil(opcoes: OpcoesDoCenario = {}) {
    const c = await preparar(opcoes);
    await c.mcp.chamar("plataforma_garantir_funil", { organization_id: ORG, nome: "Agendamentos", adotar_funil_padrao: true, etapas: ETAPAS_DA_CLINICA });
    return c;
  }
  const BIA = { organization_id: ORG, nome: "Bia", prompt: PROMPT, pacotes: ["vender"], funis: ["Agendamentos"] };

  it("cria o agente com a versão 1 em RASCUNHO, a IA da PLATAFORMA e o funil autorizado pelo nome", async () => {
    const { mcp, tabela } = await comFunil();
    const r = await mcp.chamar("plataforma_garantir_agente", BIA);
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.agente).toMatchObject({ nome: "Bia", desfecho: "criou" });
    expect(r.dados.versao).toMatchObject({ numero: 1, situacao: "rascunho", desfecho: "criou" });
    expect(r.dados.no_ar).toBe(false);

    const agente = tabela("ai_agents")[0]!;
    expect(agente).toMatchObject({ organization_id: ORG, kind: "mcp_agent", is_default: false, created_by: AUTOR });
    expect(agente.published_version_id ?? null).toBeNull();
    const versao = tabela("ai_agent_versions")[0]!;
    expect(versao).toMatchObject({
      status: "draft",
      system_prompt: PROMPT,
      // A IA não veio do pedido: é o par da plataforma, com "a chave desta instalação".
      provider: "openai",
      model: "modelo-da-plataforma",
      credential_id: null,
      channel_session_id: null,
      pipeline_ids: [FUNIL_SEMEADO],
    });
    expect((versao.tool_ids as string[]).length).toBeGreaterThan(0);
    // Sem número conectado, quem resolve é uma pessoa, na tela.
    expect(r.dados.falta_para_publicar).toEqual([expect.objectContaining({ codigo: "sem_numero", quem_resolve: "humano_na_tela" })]);
  });

  it("REEXECUÇÃO: o mesmo pedido de novo não cria agente nem versão", async () => {
    const { mcp, tabela, banco } = await comFunil();
    await mcp.chamar("plataforma_garantir_agente", BIA);
    const antes = banco.escritas.length;
    const r = await mcp.chamar("plataforma_garantir_agente", BIA);
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.agente).toMatchObject({ desfecho: "ja_estava" });
    expect(r.dados.versao).toMatchObject({ numero: 1, desfecho: "ja_estava", mudancas: [] });
    expect(tabela("ai_agents")).toHaveLength(1);
    expect(tabela("ai_agent_versions")).toHaveLength(1);
    expect(banco.escritas.length, "a reexecução escreveu no banco").toBe(antes);
  });

  it("mudar só o prompt atualiza o RASCUNHO que existe, sem criar versão e sem tocar no resto", async () => {
    const { mcp, tabela } = await comFunil();
    await mcp.chamar("plataforma_garantir_agente", BIA);
    const capacidades = tabela("ai_agent_versions")[0]!.tool_ids;
    const r = await mcp.chamar("plataforma_garantir_agente", { organization_id: ORG, nome: "Bia", prompt: `${PROMPT} Seja breve.` });
    expect(r.dados.versao).toMatchObject({ numero: 1, desfecho: "atualizou", mudancas: ["prompt"] });
    expect(tabela("ai_agent_versions")).toHaveLength(1);
    expect(tabela("ai_agent_versions")[0]).toMatchObject({ system_prompt: `${PROMPT} Seja breve.`, tool_ids: capacidades, pipeline_ids: [FUNIL_SEMEADO] });
  });

  it("a ferramenta NÃO aceita provedor, modelo nem chave: são campos desconhecidos", async () => {
    const { mcp, tabela } = await comFunil();
    for (const campo of ["provider", "model", "credential_id", "modelo", "chave"]) {
      const r = await mcp.chamar("plataforma_garantir_agente", { ...BIA, [campo]: "qualquer-coisa" });
      expect(r.erro, campo).toBe(true);
      expect(r.texto).toContain(`Campo desconhecido: \`${campo}\``);
    }
    expect(tabela("ai_agents")).toHaveLength(0);
  });

  it("funil, pacote e capacidade que não existem são recusados dizendo o que existe", async () => {
    const { mcp, tabela } = await comFunil();
    const funil = await mcp.chamar("plataforma_garantir_agente", { ...BIA, funis: ["Funil fantasma"] });
    expect(funil.erro).toBe(true);
    expect(funil.texto).toContain("Não achei o funil «Funil fantasma»");
    expect(funil.texto).toContain("«Agendamentos»");
    const capacidade = await mcp.chamar("plataforma_garantir_agente", { ...BIA, capacidades: ["crm_capacidade_inventada"] });
    expect(capacidade.texto).toContain("não existe ou não é oferecida");
    const semPrompt = await mcp.chamar("plataforma_garantir_agente", { organization_id: ORG, nome: "Sem prompt" });
    expect(semPrompt.texto).toContain("Agente novo precisa de `prompt`");
    expect(tabela("ai_agents")).toHaveLength(0);
  });

  it("publicar SEM número conectado: recusa que diz que agora é com uma pessoa, e em qual tela", async () => {
    const { mcp, tabela } = await comFunil();
    await mcp.chamar("plataforma_garantir_agente", BIA);
    const r = await mcp.chamar("plataforma_publicar_agente", { organization_id: ORG, agente: "Bia" });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("ainda não pode ir ao ar");
    expect(r.texto).toContain("Quem resolve: humano na tela");
    expect(r.texto).toContain("/app/connections");
    expect(tabela("ai_agents")[0]!.published_version_id ?? null).toBeNull();
  });

  it("com o número conectado: publica, escolhe o único número sozinho, e repetir responde `ja_estava`", async () => {
    const { mcp, tabela } = await comFunil({ comNumero: true });
    await mcp.chamar("plataforma_garantir_agente", BIA);
    const r = await mcp.chamar("plataforma_publicar_agente", { organization_id: ORG, agente: "Bia" });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados).toMatchObject({ desfecho: "publicou", numero: { id: NUMERO, nome: "Recepção" } });
    const versao = tabela("ai_agent_versions")[0]!;
    expect(versao).toMatchObject({ status: "published", channel_session_id: NUMERO });
    expect(tabela("ai_agents")[0]!.published_version_id).toBe(versao.id);
    expect(tabela("event_log")[0]).toMatchObject({ event_type: "ai_agent.published", entity_kind: "ai_agent", organization_id: ORG });

    const de_novo = await mcp.chamar("plataforma_publicar_agente", { organization_id: ORG, agente: "Bia" });
    expect(de_novo.dados.desfecho).toBe("ja_estava");
    expect(tabela("ai_agent_versions")).toHaveLength(1);
  });

  it("alterar um agente NO AR cria um rascunho novo (v2): a versão publicada não é editada, e o aviso diz que falta publicar", async () => {
    const { mcp, tabela } = await comFunil({ comNumero: true });
    await mcp.chamar("plataforma_garantir_agente", BIA);
    await mcp.chamar("plataforma_publicar_agente", { organization_id: ORG, agente: "Bia" });

    const r = await mcp.chamar("plataforma_garantir_agente", { organization_id: ORG, nome: "Bia", prompt: `${PROMPT} Seja breve.` });
    expect(r.dados.versao).toMatchObject({ numero: 2, situacao: "rascunho", desfecho: "atualizou" });
    expect(r.dados.no_ar).toBe(true);
    expect((r.dados.avisos as string[]).join(" ")).toContain("só passa a valer depois de plataforma_publicar_agente");
    const versoes = tabela("ai_agent_versions").sort((a, b) => Number(a.version_number) - Number(b.version_number));
    expect(versoes.map((v) => [v.version_number, v.status, v.system_prompt === PROMPT])).toEqual([[1, "published", true], [2, "draft", false]]);
    // O rascunho novo herda o número, as capacidades e o funil da versão no ar.
    expect(versoes[1]).toMatchObject({ channel_session_id: NUMERO, tool_ids: versoes[0]!.tool_ids, pipeline_ids: [FUNIL_SEMEADO] });

    const publicada = await mcp.chamar("plataforma_publicar_agente", { organization_id: ORG, agente: "Bia" });
    expect(publicada.dados.desfecho).toBe("publicou");
    expect(tabela("ai_agent_versions").map((v) => v.status).sort()).toEqual(["published", "superseded"]);
  });

  it("pausar cala o agente sem despublicar; retomar volta; repetir responde `ja_estava`", async () => {
    const { mcp, tabela } = await comFunil({ comNumero: true });
    await mcp.chamar("plataforma_garantir_agente", BIA);
    await mcp.chamar("plataforma_publicar_agente", { organization_id: ORG, agente: "Bia" });
    const publicada = tabela("ai_agents")[0]!.published_version_id;

    const pausa = await mcp.chamar("plataforma_pausar_agente", { organization_id: ORG, agente: "Bia", pausar: true });
    expect(pausa.dados).toMatchObject({ pausado: true, desfecho: "atualizou" });
    expect(tabela("ai_agents")[0]!.paused_at).toBeTruthy();
    expect(tabela("ai_agents")[0]!.published_version_id).toBe(publicada);
    expect((await mcp.chamar("plataforma_pausar_agente", { organization_id: ORG, agente: "Bia", pausar: true })).dados.desfecho).toBe("ja_estava");

    const volta = await mcp.chamar("plataforma_pausar_agente", { organization_id: ORG, agente: "Bia", pausar: false });
    expect(volta.dados).toMatchObject({ pausado: false, desfecho: "atualizou" });
    expect(tabela("ai_agents")[0]!.paused_at).toBeNull();
  });

  it("instalação SEM chave do provedor de IA: a pendência é da plataforma, não do cliente", async () => {
    delete process.env.OPENAI_API_KEY;
    const { mcp } = await comFunil({ comNumero: true });
    const r = await mcp.chamar("plataforma_garantir_agente", { ...BIA, numero: "Recepção" });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.falta_para_publicar).toEqual([expect.objectContaining({ quem_resolve: "plataforma" })]);
    const publicar = await mcp.chamar("plataforma_publicar_agente", { organization_id: ORG, agente: "Bia" });
    expect(publicar.erro).toBe(true);
    expect(publicar.texto).toContain("Quem resolve: plataforma");
    expect(publicar.texto).toContain("Não é configuração do cliente");
  });
});

// ---------------------------------------------------------------------------

describe("plataforma_garantir_followup e plataforma_publicar_followup", () => {
  it("instala o modelo como RASCUNHO, com os textos do modelo, e repetir não duplica", async () => {
    const { mcp, tabela } = await preparar();
    const r = await mcp.chamar("plataforma_garantir_followup", { organization_id: ORG, modelo: "geral-retomada" });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.fluxo).toMatchObject({ desfecho: "criou" });
    const fluxo = tabela("followup_flow_pointers")[0]!;
    expect(fluxo).toMatchObject({ organization_id: ORG, name: "Retomada · voltar a quem parou de responder" });
    expect((fluxo.draft_graph as { nodes: unknown[] }).nodes.length).toBeGreaterThan(3);
    expect((r.dados.avisos as string[]).join(" ")).toContain("RASCUNHO");

    const de_novo = await mcp.chamar("plataforma_garantir_followup", { organization_id: ORG, modelo: "geral-retomada" });
    expect((de_novo.dados.fluxo as Linha).desfecho).toBe("ja_estava");
    expect(tabela("followup_flow_pointers")).toHaveLength(1);
  });

  it("ajusta o texto de uma mensagem pelo id do nó, e só aquele nó muda", async () => {
    const { mcp, tabela } = await preparar();
    await mcp.chamar("plataforma_garantir_followup", { organization_id: ORG, modelo: "geral-retomada" });
    const antes = JSON.stringify((tabela("followup_flow_pointers")[0]!.draft_graph as { nodes: Array<{ id: string }> }).nodes.filter((n) => n.id !== "msg-1"));

    const r = await mcp.chamar("plataforma_garantir_followup", {
      organization_id: ORG,
      nome: "Retomada · voltar a quem parou de responder",
      textos: [{ no: "msg-1", texto: "Oi! Ficou alguma dúvida?" }],
    });
    expect(r.dados.fluxo).toMatchObject({ desfecho: "atualizou", mudancas: ["texto de msg-1"] });
    const nos = (tabela("followup_flow_pointers")[0]!.draft_graph as { nodes: Array<{ id: string; config: { body?: string } }> }).nodes;
    expect(nos.find((n) => n.id === "msg-1")!.config.body).toBe("Oi! Ficou alguma dúvida?");
    expect(JSON.stringify(nos.filter((n) => n.id !== "msg-1"))).toBe(antes);

    const noErrado = await mcp.chamar("plataforma_garantir_followup", {
      organization_id: ORG,
      nome: "Retomada · voltar a quem parou de responder",
      textos: [{ no: "msg-99", texto: "x" }],
    });
    expect(noErrado.erro).toBe(true);
    expect(noErrado.texto).toContain("Os nós são:");
  });

  it("publica com a validação da tela; repetir não cria versão; desligar tira do ar", async () => {
    const { mcp, tabela } = await preparar();
    await mcp.chamar("plataforma_garantir_followup", { organization_id: ORG, modelo: "geral-retomada" });
    const r = await mcp.chamar("plataforma_publicar_followup", { organization_id: ORG, fluxo: "Retomada · voltar a quem parou de responder" });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.desfecho).toBe("publicou");
    expect(tabela("followup_flow_pointers")[0]!.status).toBe("active");
    expect(tabela("followup_flow_versions")).toHaveLength(1);
    // Publicado e não armado em agente nenhum: a resposta avisa.
    expect((r.dados.avisos as string[]).join(" ")).toContain("nenhum agente PUBLICADO o tem armado");

    const de_novo = await mcp.chamar("plataforma_publicar_followup", { organization_id: ORG, fluxo: "Retomada · voltar a quem parou de responder" });
    expect(de_novo.dados.desfecho).toBe("ja_estava");
    expect(tabela("followup_flow_versions")).toHaveLength(1);

    const desligar = await mcp.chamar("plataforma_publicar_followup", { organization_id: ORG, fluxo: "Retomada · voltar a quem parou de responder", ativo: false });
    expect(desligar.dados.desfecho).toBe("desligou");
    expect(tabela("followup_flow_pointers")[0]!.status).toBe("disabled");
  });

  it("modelo que não existe e fluxo sem modelo são recusados dizendo o que existe", async () => {
    const { mcp } = await preparar();
    const modelo = await mcp.chamar("plataforma_garantir_followup", { organization_id: ORG, modelo: "modelo-inventado" });
    expect(modelo.erro).toBe(true);
    expect(modelo.texto).toContain("geral-retomada");
    const semModelo = await mcp.chamar("plataforma_garantir_followup", { organization_id: ORG, nome: "Fluxo que não existe" });
    expect(semModelo.texto).toContain("o pedido não trouxe `modelo`");
  });
});

// ---------------------------------------------------------------------------

describe("plataforma_garantir_automacao e plataforma_ligar_automacao", () => {
  const REGRA = {
    organization_id: ORG,
    nome: "Etiquetar quem veio de anúncio",
    gatilho: "lead.created",
    condicoes: [{ field: "lead.source", op: "eq", value: "meta_ads" }],
    acoes: [{ type: "add_tag", config: { tags: ["Anúncio"] } }],
  };

  it("a regra nasce sem `is_active` (o banco a cria DESLIGADA), e repetir não duplica", async () => {
    const { mcp, tabela, banco } = await preparar();
    const r = await mcp.chamar("plataforma_garantir_automacao", REGRA);
    expect(r.erro, r.texto).toBe(false);
    expect((r.dados.regra as Linha).desfecho).toBe("criou");
    const escrita = banco.escritas.find((e) => e.tabela === "automation_rules")!;
    expect(escrita.payload).toMatchObject({ organization_id: ORG, created_by_user_id: AUTOR, name: REGRA.nome, trigger_event: "lead.created" });
    expect(escrita.payload, "o insert não pode ligar a regra").not.toHaveProperty("is_active");

    tabela("automation_rules")[0]!.is_active = false;
    const de_novo = await mcp.chamar("plataforma_garantir_automacao", REGRA);
    expect((de_novo.dados.regra as Linha).desfecho).toBe("ja_estava");
    expect(tabela("automation_rules")).toHaveLength(1);
  });

  it("ligar grava `is_active` com a autoria; regra LIGADA não é editada pela montagem", async () => {
    const { mcp, tabela } = await preparar();
    await mcp.chamar("plataforma_garantir_automacao", REGRA);
    tabela("automation_rules")[0]!.is_active = false;

    const ligar = await mcp.chamar("plataforma_ligar_automacao", { organization_id: ORG, regra: REGRA.nome, ligada: true });
    expect(ligar.dados).toMatchObject({ desfecho: "atualizou", regra: { ligada: true } });
    expect(tabela("automation_rules")[0]).toMatchObject({ is_active: true, last_change_actor_kind: "user" });
    expect((await mcp.chamar("plataforma_ligar_automacao", { organization_id: ORG, regra: REGRA.nome, ligada: true })).dados.desfecho).toBe("ja_estava");

    const editar = await mcp.chamar("plataforma_garantir_automacao", { ...REGRA, acoes: [{ type: "add_tag", config: { tags: ["Outra"] } }] });
    expect(editar.erro).toBe(true);
    expect(editar.texto).toContain("está LIGADA");
    expect(editar.texto).toContain("plataforma_ligar_automacao");
    expect(tabela("automation_rules")[0]!.actions).toEqual(REGRA.acoes);
  });

  it("id de OUTRA organização numa ação é recusado; segredo de webhook não entra por aqui", async () => {
    const { mcp, tabela } = await preparar();
    tabela("crm_pipelines").push({ id: "0f000000-0000-4000-8000-000000000009", organization_id: OUTRA_ORG, name: "Alheio", slug: "alheio", is_archived: false });
    const alheio = await mcp.chamar("plataforma_garantir_automacao", {
      ...REGRA,
      acoes: [{ type: "create_or_move_lead", config: { pipeline_id: "0f000000-0000-4000-8000-000000000009", stage_id: "0f000000-0000-4000-8000-000000000008" } }],
    });
    expect(alheio.erro).toBe(true);
    expect(alheio.texto).toContain("não existe funil com o id");
    const segredo = await mcp.chamar("plataforma_garantir_automacao", {
      ...REGRA,
      acoes: [{ type: "call_webhook", config: { url: "https://exemplo.invalid/gancho", secret: "segredo-ficticio" } }],
    });
    expect(segredo.erro).toBe(true);
    expect(segredo.texto).toContain("o segredo do webhook é credencial");
    expect(tabela("automation_rules")).toHaveLength(0);
  });

  it("ação malformada: a recusa aponta o campo e manda ver o formato", async () => {
    const { mcp } = await preparar();
    const r = await mcp.chamar("plataforma_garantir_automacao", { ...REGRA, acoes: [{ type: "add_tag", config: { tags: [] } }] });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("acoes.0.config.tags");
    expect(r.texto).toContain("plataforma_listar_modelos, seção automacoes");
  });
});

// ---------------------------------------------------------------------------

describe("a agenda: tipos, jornada e lembrete", () => {
  const TIPO = { nome: "Avaliação inicial", categoria: "consulta", duracao_minutos: 40, local: "in_person" };

  it("cria o tipo com o slug do nome e o lembrete DESLIGADO; repetir não duplica; mudar a duração atualiza só ela", async () => {
    const { mcp, tabela, banco } = await preparar();
    const r = await mcp.chamar("plataforma_garantir_tipos_de_agendamento", { organization_id: ORG, tipos: [TIPO] });
    expect(r.erro, r.texto).toBe(false);
    expect((r.dados.tipos as Linha[])[0]).toMatchObject({ slug: "avaliacao-inicial", desfecho: "criou" });
    const insert = banco.escritas.find((e) => e.tabela === "calendar_event_types")!;
    expect(insert.payload, "tipo novo não pode nascer com lembrete ligado").not.toHaveProperty("reminder_enabled");

    expect(((await mcp.chamar("plataforma_garantir_tipos_de_agendamento", { organization_id: ORG, tipos: [TIPO] })).dados.tipos as Linha[])[0]!.desfecho).toBe("ja_estava");
    const mudou = await mcp.chamar("plataforma_garantir_tipos_de_agendamento", { organization_id: ORG, tipos: [{ ...TIPO, duracao_minutos: 50 }] });
    expect((mudou.dados.tipos as Linha[])[0]).toMatchObject({ desfecho: "atualizou", mudancas: ["duração"] });
    expect(tabela("calendar_event_types")).toHaveLength(1);
    expect(tabela("calendar_event_types")[0]).toMatchObject({ duration_minutes: 50, slug: "avaliacao-inicial" });
  });

  it("o lembrete é OUTRA ferramenta (pôr no ar), e a faixa de antecedência é a da tela", async () => {
    const { mcp, tabela } = await preparar();
    await mcp.chamar("plataforma_garantir_tipos_de_agendamento", { organization_id: ORG, tipos: [TIPO] });
    const r = await mcp.chamar("plataforma_ligar_lembrete", { organization_id: ORG, tipo: "Avaliação inicial", ligado: true, minutos_antes: 1440, extras_minutos: [180] });
    expect(r.erro, r.texto).toBe(false);
    expect(tabela("calendar_event_types")[0]).toMatchObject({ reminder_enabled: true, reminder_minutes_before: 1440, reminder_extra_offsets_minutes: [180] });
    expect((await mcp.chamar("plataforma_ligar_lembrete", { organization_id: ORG, tipo: "avaliacao-inicial", ligado: true, minutos_antes: 1440, extras_minutos: [180] })).dados.desfecho).toBe("ja_estava");

    const curto = await mcp.chamar("plataforma_ligar_lembrete", { organization_id: ORG, tipo: "Avaliação inicial", ligado: true, minutos_antes: 5 });
    expect(curto.erro).toBe(true);
    expect(curto.texto).toContain("`minutos_antes` precisa ser no mínimo 15");
  });

  it("a jornada é da PESSOA da equipe, pelo e-mail; quem não é da equipe é recusado dizendo quem é", async () => {
    const { mcp, tabela } = await preparar();
    const pedido = {
      organization_id: ORG,
      pessoa: "implantador@exemplo.invalid",
      janelas: [{ dia: 1, inicio: "08:00", fim: "12:00" }, { dia: 1, inicio: "13:00", fim: "18:00" }],
      disponivel: true,
    };
    const r = await mcp.chamar("plataforma_definir_jornada", pedido);
    expect(r.erro, r.texto).toBe(false);
    expect(tabela("attendant_availability")[0]).toMatchObject({
      organization_id: ORG,
      user_id: AUTOR,
      is_available: true,
      // Sem `fuso` no pedido, vale o da empresa.
      schedule: { timezone: "America/Sao_Paulo", windows: [{ dow: 1, start: "08:00", end: "12:00" }, { dow: 1, start: "13:00", end: "18:00" }] },
    });
    expect((await mcp.chamar("plataforma_definir_jornada", pedido)).dados.desfecho).toBe("ja_estava");
    expect(tabela("attendant_availability")).toHaveLength(1);

    const estranho = await mcp.chamar("plataforma_definir_jornada", { ...pedido, pessoa: "quem@exemplo.invalid" });
    expect(estranho.erro).toBe(true);
    expect(estranho.texto).toContain("não faz parte da equipe");
    expect(estranho.texto).toContain("implantador@exemplo.invalid");

    const invertida = await mcp.chamar("plataforma_definir_jornada", { ...pedido, janelas: [{ dia: 1, inicio: "18:00", fim: "08:00" }] });
    expect(invertida.erro).toBe(true);
    expect(invertida.texto).toContain("com o fim depois do início");
  });
});

// ---------------------------------------------------------------------------

describe("plataforma_convidar_pessoas", () => {
  const PEDIDO = { organization_id: ORG, pessoas: [{ email: "Dona@Exemplo.invalid", papel: "admin" }, { email: "recepcao@exemplo.invalid", papel: "agent" }] };

  it("convida com o papel, grava a linha que a tela lista e manda o e-mail UMA vez por pessoa", async () => {
    const { mcp, tabela } = await preparar();
    const r = await mcp.chamar("plataforma_convidar_pessoas", PEDIDO);
    expect(r.erro, r.texto).toBe(false);
    expect((r.dados.convites as Linha[]).map((c) => [c.email, c.papel, c.desfecho, c.email_enviado])).toEqual([
      ["dona@exemplo.invalid", "admin", "convidou", true],
      ["recepcao@exemplo.invalid", "agent", "convidou", true],
    ]);
    expect(tabela("team_invites").map((c) => [c.email, c.role, c.organization_id, c.invited_by])).toEqual([
      ["dona@exemplo.invalid", "admin", ORG, AUTOR],
      ["recepcao@exemplo.invalid", "agent", ORG, AUTOR],
    ]);
    expect(enviosDeConvite()).toHaveLength(2);
    expect(enviosDeConvite()[0]).toMatchObject({ organizationId: ORG, orgName: "Clínica Exemplo", inviterId: AUTOR });
    // A linha diz que o e-mail saiu, e guarda o prazo que o token carrega.
    expect(tabela("team_invites").map((c) => [c.email_dispatched, c.expires_at])).toEqual([
      [true, "2099-01-01T00:00:00.000Z"],
      [true, "2099-01-01T00:00:00.000Z"],
    ]);
  });

  it("REEXECUÇÃO: não manda e-mail de novo; quem já é da equipe é pulado; `reenviar` reenvia", async () => {
    const { mcp, tabela } = await preparar();
    await mcp.chamar("plataforma_convidar_pessoas", PEDIDO);
    for (const c of tabela("team_invites")) Object.assign(c, { accepted_at: null, revoked_at: null });
    vi.mocked(issueInvite).mockClear();

    const r = await mcp.chamar("plataforma_convidar_pessoas", {
      organization_id: ORG,
      pessoas: [...PEDIDO.pessoas, { email: "implantador@exemplo.invalid", papel: "admin" }],
    });
    expect((r.dados.convites as Linha[]).map((c) => c.desfecho)).toEqual(["ja_convidado", "ja_convidado", "ja_e_membro"]);
    expect(vi.mocked(issueInvite), "a reexecução mandou e-mail").not.toHaveBeenCalled();
    expect(tabela("team_invites")).toHaveLength(2);

    const reenviar = await mcp.chamar("plataforma_convidar_pessoas", { organization_id: ORG, pessoas: [PEDIDO.pessoas[1]], reenviar: true });
    expect((reenviar.dados.convites as Linha[])[0]!.desfecho).toBe("reenviou");
    expect(enviosDeConvite()).toHaveLength(1);
    expect(tabela("team_invites")).toHaveLength(2);
  });

  it("instalação sem e-mail: o convite nasce, e a resposta avisa que o link está na tela", async () => {
    convite.emailSai = false;
    const { mcp } = await preparar();
    const r = await mcp.chamar("plataforma_convidar_pessoas", { organization_id: ORG, pessoas: [PEDIDO.pessoas[1]] });
    expect((r.dados.convites as Linha[])[0]).toMatchObject({ desfecho: "convidou", email_enviado: false });
    expect((r.dados.avisos as string[]).join(" ")).toContain("/app/team");
  });

  it("⭐ EMPRESA DE DEMONSTRAÇÃO (9020): o convite FUNCIONA, com a linha, o e-mail e o aviso de onde foi", async () => {
    // Até a 9020 este caso provava a recusa, com a frase da trava. O convite
    // não é saída para contato: fala com uma pessoa de verdade que quem
    // administra escolheu, e é o jeito de dar acesso à demonstração.
    const { mcp, tabela } = await preparar({ demonstracao: true });
    const r = await mcp.chamar("plataforma_convidar_pessoas", PEDIDO);
    expect(r.erro, r.texto).toBe(false);
    expect((r.dados.convites as Linha[]).map((c) => [c.email, c.papel, c.desfecho, c.email_enviado])).toEqual([
      ["dona@exemplo.invalid", "admin", "convidou", true],
      ["recepcao@exemplo.invalid", "agent", "convidou", true],
    ]);
    expect(tabela("team_invites").map((c) => [c.email, c.role, c.organization_id, c.email_dispatched])).toEqual([
      ["dona@exemplo.invalid", "admin", ORG, true],
      ["recepcao@exemplo.invalid", "agent", ORG, true],
    ]);
    expect(enviosDeConvite()).toHaveLength(2);
    // A resposta diz que é a demonstração, e que o convite é só o convite.
    const avisos = (r.dados.avisos as string[]).join(" ");
    expect(avisos).toContain("empresa de demonstração");
    expect(avisos).toContain("mensagem, automação, conversão e aviso continuam travados");
    expect(r.texto).not.toContain("nenhuma mensagem, e-mail ou aviso sai daqui");
  });

  it("CONTROLE: na empresa de verdade a resposta não fala de demonstração", async () => {
    const { mcp } = await preparar();
    const r = await mcp.chamar("plataforma_convidar_pessoas", PEDIDO);
    expect((r.dados.avisos as string[]).join(" ")).not.toContain("demonstração");
  });

  it("⭐ convite que o banco NÃO grava: `nao_gravou`, sem e-mail, e as outras pessoas seguem", async () => {
    const { mcp, tabela, cliente } = await preparar();
    // O banco recusa a linha de UMA pessoa, como um gatilho ou uma constraint recusaria.
    const deVerdade = cliente.from.bind(cliente);
    cliente.from = ((nome: string) => {
      const consulta = deVerdade(nome) as Record<string, unknown>;
      if (nome !== "team_invites") return consulta;
      const inserir = consulta.insert as (p: Linha) => unknown;
      consulta.insert = (p: Linha) =>
        p.email === "dona@exemplo.invalid"
          ? { select: () => ({ single: async () => ({ data: null, error: { code: "42501", message: "recusado pelo banco" } }) }) }
          : inserir(p);
      return consulta;
    }) as typeof cliente.from;

    const r = await mcp.chamar("plataforma_convidar_pessoas", PEDIDO);
    expect(r.erro, r.texto).toBe(false);
    expect((r.dados.convites as Linha[]).map((c) => [c.email, c.desfecho])).toEqual([
      ["dona@exemplo.invalid", "nao_gravou"],
      ["recepcao@exemplo.invalid", "convidou"],
    ]);
    const avisos = (r.dados.avisos as string[]).join(" ");
    expect(avisos).toContain("O convite de dona@exemplo.invalid NÃO foi criado");
    expect(avisos).toContain("42501");
    // Nada saiu para quem não tem linha: nem e-mail, nem linha. A outra pessoa foi convidada.
    expect(enviosDeConvite().map((p) => p.email)).toEqual(["recepcao@exemplo.invalid"]);
    expect(tabela("team_invites").map((c) => c.email)).toEqual(["recepcao@exemplo.invalid"]);
  });

  it("papel que não existe é recusado com os papéis aceitos", async () => {
    const { mcp } = await preparar();
    const r = await mcp.chamar("plataforma_convidar_pessoas", { organization_id: ORG, pessoas: [{ email: "x@exemplo.invalid", papel: "dono" }] });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain('`pessoas[0].papel` aceita só: "viewer", "agent", "manager", "admin"');
  });
});

// ---------------------------------------------------------------------------

describe("mensagens prontas", () => {
  it("resposta pronta nasce compartilhada (sem dono), e repetir não duplica", async () => {
    const { mcp, tabela } = await preparar();
    const pedido = { organization_id: ORG, respostas: [{ titulo: "Endereço", texto: "Rua das Flores, 100.", atalho: "endereco" }] };
    const r = await mcp.chamar("plataforma_garantir_respostas_prontas", pedido);
    expect(r.erro, r.texto).toBe(false);
    expect(tabela("message_templates")[0]).toMatchObject({ organization_id: ORG, owner_user_id: null, title: "Endereço", shortcut: "endereco", created_by_user_id: AUTOR });
    expect((await mcp.chamar("plataforma_garantir_respostas_prontas", pedido)).dados).toMatchObject({ criadas: 0, ja_estavam: 1 });
    const mudou = await mcp.chamar("plataforma_garantir_respostas_prontas", { organization_id: ORG, respostas: [{ titulo: "endereço", texto: "Rua das Flores, 200." }] });
    expect(mudou.dados).toMatchObject({ atualizadas: 1 });
    expect(tabela("message_templates")).toHaveLength(1);
    expect(tabela("message_templates")[0]).toMatchObject({ body: "Rua das Flores, 200.", shortcut: "endereco" });
  });

  const MODELO = {
    organization_id: ORG,
    nome: "lembrete_de_avaliacao",
    categoria: "UTILITY",
    texto: "Olá, {{1}}! Sua avaliação é amanhã.",
    exemplos: ["Maria"],
  };

  it("modelo oficial SEM número oficial conectado: recusa que explica, e NENHUMA chamada sai para a Meta", async () => {
    const { mcp } = await preparar({ comNumero: true });
    const r = await mcp.chamar("plataforma_submeter_modelo_whatsapp", MODELO);
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("não tem o número OFICIAL do WhatsApp conectado");
    expect(r.texto).toContain("/app/connections");
    expect(vi.mocked(criarTemplate)).not.toHaveBeenCalled();
  });

  it("⭐ EMPRESA DE DEMONSTRAÇÃO: não submete modelo, mesmo que houvesse canal", async () => {
    const { mcp } = await preparar({ demonstracao: true, comNumero: true, numeroOficial: true });
    const r = await mcp.chamar("plataforma_submeter_modelo_whatsapp", MODELO);
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("Esta é a empresa de demonstração");
    expect(vi.mocked(criarTemplate)).not.toHaveBeenCalled();
  });

  it("com o número oficial: submete uma vez; modelo que já existe na conta não é reenviado", async () => {
    const { mcp, tabela } = await preparar({ comNumero: true, numeroOficial: true });
    const r = await mcp.chamar("plataforma_submeter_modelo_whatsapp", MODELO);
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados).toMatchObject({ desfecho: "submeteu", modelo: { situacao: "PENDING" } });
    expect(vi.mocked(criarTemplate)).toHaveBeenCalledTimes(1);

    // O espelho local, como a sincronização o deixaria.
    tabela("meta_templates").push({ id: "m1", organization_id: ORG, name: MODELO.nome, language: "pt_BR", status: "PENDING", category: "UTILITY", rejected_reason: null });
    const de_novo = await mcp.chamar("plataforma_submeter_modelo_whatsapp", MODELO);
    expect(de_novo.dados).toMatchObject({ desfecho: "ja_existia" });
    expect(vi.mocked(criarTemplate)).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------

describe("plataforma_ver_implantacao: o checklist, antes e depois", () => {
  it("organização recém-criada: aponta o funil de e-commerce, o que falta e o que é com o humano", async () => {
    const { mcp } = await preparar();
    const r = await mcp.chamar("plataforma_ver_implantacao", { organization_id: ORG });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.resumo).toMatchObject({ pode_atender: false, agentes_no_ar: 0, numeros_conectados: 0, areas_nao_medidas: [] });
    const areas = Object.fromEntries((r.dados.areas as Array<{ area: string }>).map((a) => [a.area, a as Linha]));
    expect(areas.funis!.situacao).toBe("falta");
    expect(JSON.stringify(areas.funis!.falta)).toContain("adotar_funil_padrao: true");
    expect(areas.agentes!.situacao).toBe("falta");
    expect(areas.canais!.situacao).toBe("com_o_humano");
    const doHumano = r.dados.com_o_humano as Array<{ area: string; caminho: string; quem: string }>;
    expect(doHumano.find((p) => p.area === "canais")).toMatchObject({ caminho: "/app/connections", quem: "cliente" });
    // A fila do que o agente implantador ainda faz, com a ferramenta de cada item.
    const passos = (r.dados.proximos_passos as Array<{ area: string; como: string }>).map((p) => p.area);
    expect(passos).toEqual(expect.arrayContaining(["funis", "produtos", "etiquetas", "memoria", "conhecimento", "agentes", "followups"]));
  });

  it("depois do roteiro inteiro, com o número conectado: pode atender, e as áreas montadas saem do `falta`", async () => {
    const { mcp } = await preparar({ comNumero: true });
    const ok = async (nome: string, args: Record<string, unknown>) => {
      const r = await mcp.chamar(nome, { organization_id: ORG, ...args });
      expect(r.erro, `${nome}: ${r.texto}`).toBe(false);
      return r;
    };
    await ok("plataforma_configurar_empresa", { modo_de_venda: "b2c", cnpj: "00.000.000/0001-00" });
    await ok("plataforma_garantir_funil", { nome: "Agendamentos", adotar_funil_padrao: true, etapas: ETAPAS_DA_CLINICA });
    await ok("plataforma_garantir_produtos", { produtos: [{ codigo: "AVAL", nome: "Avaliação", descricao: "Primeira consulta.", preco_cents: 8000 }] });
    await ok("plataforma_garantir_etiquetas", { etiquetas: [{ nome: "Indicação", cor: "#0091ff" }] });
    await ok("plataforma_gravar_memoria", { documento: "Nunca prometa desconto acima de 10%." });
    await ok("plataforma_garantir_conhecimento", { nome: "Perguntas frequentes", tipo: "faq", perguntas: [{ pergunta: "Abre sábado?", resposta: "Sim." }] });
    await ok("plataforma_garantir_followup", { modelo: "geral-retomada" });
    await ok("plataforma_garantir_agente", {
      nome: "Bia",
      prompt: PROMPT,
      pacotes: ["vender"],
      funis: ["Agendamentos"],
      materiais: ["Perguntas frequentes"],
      followups: { fluxos: ["Retomada · voltar a quem parou de responder"] },
    });
    await ok("plataforma_publicar_followup", { fluxo: "Retomada · voltar a quem parou de responder" });
    await ok("plataforma_publicar_agente", { agente: "Bia" });
    await ok("plataforma_garantir_tipos_de_agendamento", { tipos: [{ nome: "Avaliação inicial", categoria: "consulta", duracao_minutos: 40, local: "in_person" }] });
    await ok("plataforma_definir_jornada", { pessoa: "implantador@exemplo.invalid", janelas: [{ dia: 1, inicio: "08:00", fim: "18:00" }] });
    await ok("plataforma_convidar_pessoas", { pessoas: [{ email: "dona@exemplo.invalid", papel: "admin" }] });
    await ok("plataforma_garantir_respostas_prontas", { respostas: [{ titulo: "Endereço", texto: "Rua das Flores, 100." }] });

    const r = await ok("plataforma_ver_implantacao", {});
    expect(r.dados.resumo).toMatchObject({ pode_atender: true, agentes_no_ar: 1, numeros_conectados: 1, areas_nao_medidas: [] });
    const areas = Object.fromEntries((r.dados.areas as Array<{ area: string }>).map((a) => [a.area, a as Linha]));
    for (const montada of ["empresa", "canais", "funis", "produtos", "etiquetas", "memoria", "conhecimento", "agentes", "followups", "agenda", "equipe", "mensagens"]) {
      expect(areas[montada]!.situacao, `${montada}: ${JSON.stringify(areas[montada]!.falta)}`).toBe("pronto");
    }
    expect(r.dados.com_o_humano).toEqual([]);
  });
});
