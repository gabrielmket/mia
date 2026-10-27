/**
 * FORK MIA (.94) — O ASSISTENTE FAZ COM APROVAÇÃO (protótipo "ensina e faz",
 * aprovado em 26/10/2026, telas 3 a 5). A cerca da frente:
 *
 *   - o catálogo: nove peças novas e as três da .91, cada uma com onde mora,
 *     a tela do "Ver na tela" (uma porta do app), até quando desfaz e o caminho;
 *   - quem aprova o quê: a tabela da tela 5, pessoa a pessoa (o administrador
 *     Bruno, a gestora Marina e a atendente Carla, da Empresa Modelo);
 *   - a lista fechada do "nunca": nenhuma ferramenta do assistente escreve
 *     nada dela, e toda ferramenta é de um tipo conhecido (ler, levar à tela,
 *     pedir, chamado ou propor);
 *   - a empresa desliga um tipo e a ferramenta some; o somente leitura não
 *     propõe;
 *   - a preparação de cada peça, com a SESSÃO e o banco em memória: o cartão,
 *     a chave da peça e o "já existe";
 *   - a forma do pedido: o que não fecha é recusado antes do aplicar;
 *   - as travas do desfazer, uma por peça;
 *   - a fonte: as preparações e as ferramentas não importam o cliente de serviço.
 *
 * Nenhum dado daqui é de cliente: a Empresa Modelo é fictícia.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("o cliente de serviço nasceu onde não devia");
  },
}));

import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";

const { CATALOGO_DAS_PECAS } = await import("@/lib/assistente/propostas/catalogo");
const { TIPOS_DA_NOVENTA_E_UM, TIPOS_DE_PROPOSTA, TIPOS_DO_DIA_A_DIA } = await import("@/lib/assistente/propostas/tipos");
const { aQuemPedir, podeAprovar, podePropor, regraDeAprovacao } = await import("@/lib/assistente/propostas/quem-aprova");
const { LISTA_DO_NUNCA, VERBOS_DO_NUNCA } = await import("@/lib/assistente/nunca");
const { conferirPedido } = await import("@/lib/assistente/propostas/validar");
const { travaDoDesfazer } = await import("@/lib/assistente/propostas/desfazer");
const preparar = await import("@/lib/assistente/propostas/preparar-do-dia-a-dia");
const { ColetorDoTurno, ferramentasDoAssistente } = await import("@/lib/assistente/ferramentas");
const { telasParaOPapel } = await import("@/lib/assistente/telas");
const { hrefDoApp } = await import("@/lib/assistente/tipos");
const { NAV_CATALOG } = await import("@/lib/navigation/catalogo");

type Role = "admin" | "manager" | "agent" | "viewer";

const ORG = "0a000000-0000-4000-8000-000000000094";
const BRUNO = "0b000000-0000-4000-8000-0000000000b1";
const MARINA = "0b000000-0000-4000-8000-0000000000b2";
const CARLA = "0b000000-0000-4000-8000-0000000000b3";
const JULIANA = "0b000000-0000-4000-8000-0000000000b4";
const EQUIPE = [
  { user_id: BRUNO, nome: "Bruno Teixeira", papel: "admin" as const },
  { user_id: MARINA, nome: "Marina Souza", papel: "manager" as const },
  { user_id: CARLA, nome: "Carla Mendes", papel: "agent" as const },
  { user_id: JULIANA, nome: "Juliana Prado", papel: "agent" as const },
];
const PAPEL: Record<string, Role> = { [BRUNO]: "admin", [MARINA]: "manager", [CARLA]: "agent" };
const FUNIL = "0c000000-0000-4000-8000-000000000001";
const AGORA = new Date("2026-10-26T13:00:00Z"); // segunda, 10h em São Paulo

function etapas(): Linha[] {
  return ["Novo contato", "Já respondi", "Quer agendar", "Consulta marcada", "Não vai marcar"].map((name, i) => ({
    id: `0d000000-0000-4000-8000-00000000000${i}`,
    organization_id: ORG,
    pipeline_id: FUNIL,
    name,
    position: (i + 1) * 1000,
    is_won: name === "Consulta marcada",
    is_lost: name === "Não vai marcar",
    is_archived: false,
  }));
}

function empresa(extra: Record<string, Linha[]> = {}) {
  return bancoEmMemoria({
    organizations: [
      {
        id: ORG,
        display_name: "Empresa Modelo",
        currency: "BRL",
        settings: { tags: [{ tag: "Convênio", cor: "#ab4aba" }, "Paciente antigo"] },
        onboarding_state: { welcome: { segmento: "clinica", o_que_faz: "clínica odontológica" } },
      },
    ],
    crm_pipelines: [{ id: FUNIL, organization_id: ORG, name: "Agendamentos", is_default: true, is_archived: false, created_at: "2026-10-25" }],
    crm_stages: etapas(),
    message_templates: [{ id: "t1", organization_id: ORG, title: "Boas-vindas", shortcut: "boasvindas", owner_user_id: null }],
    ...extra,
  });
}

function contexto(db: unknown, userId = MARINA) {
  return {
    db: db as never,
    organizationId: ORG,
    userId,
    papel: PAPEL[userId] ?? "agent",
    equipe: EQUIPE,
    fuso: "America/Sao_Paulo",
    agora: AGORA,
    idioma: "pt-BR",
  };
}

describe("o catálogo das peças (tela 3)", () => {
  it("nove novas e as três da .91, cada uma com onde mora, a tela, até quando desfaz e o caminho", () => {
    expect(TIPOS_DO_DIA_A_DIA).toHaveLength(9);
    expect(TIPOS_DA_NOVENTA_E_UM).toEqual(["agente", "funil", "followup"]);
    expect(Object.keys(CATALOGO_DAS_PECAS).sort()).toEqual([...TIPOS_DE_PROPOSTA].sort());
    const portas = new Set(NAV_CATALOG.map((n) => n.href));
    for (const tipo of TIPOS_DE_PROPOSTA) {
      const p = CATALOGO_DAS_PECAS[tipo];
      expect(p.rotulo.length, tipo).toBeGreaterThan(3);
      expect(p.desfazer.length, tipo).toBeGreaterThan(5);
      expect(hrefDoApp(p.href), tipo).toBe(p.href);
      expect(portas.has(p.href), `${tipo}: ${p.href} não é porta do app`).toBe(true);
      expect(p.origem).toBe((TIPOS_DA_NOVENTA_E_UM as readonly string[]).includes(tipo) ? "noventa_e_um" : "nova");
    }
  });

  it("textos sem travessão", () => {
    for (const p of Object.values(CATALOGO_DAS_PECAS)) {
      expect(JSON.stringify(p)).not.toMatch(/—|–/);
    }
    for (const n of LISTA_DO_NUNCA) expect(JSON.stringify(n)).not.toMatch(/—|–/);
  });
});

describe("quem aprova o quê (tela 5): aprova quem pode fazer o mesmo na tela", () => {
  /** "s" aprova; "p" pede; "n" nem propõe. */
  function quem(tipo: (typeof TIPOS_DE_PROPOSTA)[number], pedido: Record<string, unknown>, pessoa: string, criadaPor = pessoa): "s" | "p" | "n" {
    if (!podePropor(tipo, PAPEL[pessoa])) return "n";
    const regra = regraDeAprovacao({ tipo, pedido } as never, criadaPor);
    return podeAprovar(regra, { userId: pessoa, papel: PAPEL[pessoa] }, criadaPor) ? "s" : "p";
  }
  const linha = (tipo: (typeof TIPOS_DE_PROPOSTA)[number], pedido: (pessoa: string) => Record<string, unknown> = () => ({})) =>
    [BRUNO, MARINA, CARLA].map((p) => quem(tipo, pedido(p), p)).join("");

  it("a tabela, pessoa a pessoa (Bruno, Marina, Carla)", () => {
    expect(linha("etapa_criar")).toBe("ssp");
    expect(linha("etapa_renomear")).toBe("ssp");
    expect(linha("resposta", () => ({ para: "eu" }))).toBe("sss");
    expect(linha("resposta", () => ({ para: "equipe" }))).toBe("ssp");
    expect(linha("etiqueta")).toBe("ssp");
    expect(linha("tarefa", (p) => ({ para_user_id: p }))).toBe("sss");
    expect(linha("tarefa", () => ({ para_user_id: JULIANA }))).toBe("ssp");
    expect(linha("rascunho_de_followup")).toBe("ssp");
    expect(linha("conhecimento")).toBe("ssp");
    expect(linha("relatorio", () => ({ para: "eu" }))).toBe("sss");
    expect(linha("relatorio", () => ({ para: "equipe" }))).toBe("ssp");
    // as exceções, mais fechadas que a tela (decisão 2)
    expect(linha("meta")).toBe("spn");
    for (const t of TIPOS_DA_NOVENTA_E_UM) expect(linha(t)).toBe("spp");
  });

  it("a peça só de quem pediu é só dela; a tarefa para si, ela ou a gestora", () => {
    const resposta = regraDeAprovacao({ tipo: "resposta", pedido: { para: "eu" } } as never, CARLA);
    expect(podeAprovar(resposta, { userId: MARINA, papel: "manager" }, CARLA)).toBe(false);
    const tarefa = regraDeAprovacao({ tipo: "tarefa", pedido: { para_user_id: CARLA } } as never, CARLA);
    expect(podeAprovar(tarefa, { userId: MARINA, papel: "manager" }, CARLA)).toBe(true);
    expect(podeAprovar(tarefa, { userId: JULIANA, papel: "agent" }, CARLA)).toBe(false);
  });

  it("a quem pedir: a etapa vai à gestora, a meta ao administrador; ninguém pede a si mesmo", () => {
    const etapa = aQuemPedir(regraDeAprovacao({ tipo: "etapa_criar", pedido: {} } as never, CARLA), EQUIPE, CARLA);
    expect(etapa.map((p) => p.nome)).toEqual(["Marina Souza", "Bruno Teixeira"]);
    const meta = aQuemPedir(regraDeAprovacao({ tipo: "meta", pedido: {} } as never, MARINA), EQUIPE, MARINA);
    expect(meta.map((p) => p.nome)).toEqual(["Bruno Teixeira"]);
    expect(aQuemPedir(regraDeAprovacao({ tipo: "resposta", pedido: { para: "eu" } } as never, CARLA), EQUIPE, CARLA)).toEqual([]);
  });

  it("o somente leitura não propõe nada", () => {
    for (const t of TIPOS_DE_PROPOSTA) expect(podePropor(t, "viewer"), t).toBe(false);
  });
});

function ferramentas(papel: Role, tipos: readonly string[] | null = null) {
  const db = empresa().cliente;
  return Object.keys(
    ferramentasDoAssistente(
      {
        db: db as never,
        organizationId: ORG,
        userId: papel === "admin" ? BRUNO : papel === "manager" ? MARINA : CARLA,
        papel,
        idioma: "pt-BR",
        fuso: "America/Sao_Paulo",
        agora: AGORA,
        telas: telasParaOPapel({ papel }),
        equipe: EQUIPE,
        base: [],
        ultimaRecusa: null,
        tiposDePropostas: tipos as never,
      },
      new ColetorDoTurno(),
    ),
  );
}

describe("a lista fechada do nunca (tela 4)", () => {
  it("oito pedidos em sete grupos, cada um com o porquê e a tela", () => {
    expect(LISTA_DO_NUNCA).toHaveLength(8);
    expect(new Set(LISTA_DO_NUNCA.map((n) => n.grupo)).size).toBe(7);
    for (const n of LISTA_DO_NUNCA) {
      expect(hrefDoApp(n.href), n.id).toBe(n.href);
      expect(n.porque.length, n.id).toBeGreaterThan(30);
    }
  });

  it("⭐ toda ferramenta é de um tipo conhecido, e nenhuma proposta escreve o que a lista proíbe", () => {
    const nomes = ferramentas("admin");
    const tipos = /^(ver_|buscar_ajuda$|mostrar_me_leva_la$|oferecer_pedir_a_pessoa$|registrar_que_nao_sei$|preparar_chamado$|propor_)/;
    expect(nomes.filter((n) => !tipos.test(n)), "ferramenta de um tipo novo: confira a lista do nunca").toEqual([]);
    const propor = nomes.filter((n) => n.startsWith("propor_"));
    expect(propor).toHaveLength(12);
    for (const n of propor) {
      for (const verbo of VERBOS_DO_NUNCA) expect(n, `${n} tem "${verbo}" no nome`).not.toContain(verbo);
    }
  });

  it("a empresa desliga um tipo e a ferramenta dele some; o somente leitura não recebe nenhuma do dia a dia", () => {
    const so = ferramentas("admin", ["etapa_criar"]);
    expect(so).toContain("propor_etapa_do_funil");
    expect(so).not.toContain("propor_meta_do_mes");
    expect(so).not.toContain("propor_resposta_rapida");
    expect(ferramentas("viewer").filter((n) => n.startsWith("propor_") && !/modelo|pacote/.test(n))).toEqual([]);
  });

  it("o system diz a lista do nunca e a regra de quem aprova", async () => {
    const { REGRAS_DO_FAZ } = await import("@/lib/assistente/regras-do-faz");
    for (const n of LISTA_DO_NUNCA) expect(REGRAS_DO_FAZ).toContain(n.grupo);
    expect(REGRAS_DO_FAZ).toMatch(/Aprova quem pode fazer a mesma coisa na tela/);
    expect(REGRAS_DO_FAZ).not.toMatch(/—|–/);
  });
});

describe("preparar: o cartão nasce da leitura, sem gravar nada", () => {
  it("etapa nova: antes de outra, o antes e o depois, a chave; a repetida já existe", async () => {
    const b = empresa();
    const r = await preparar.prepararEtapaNova(contexto(b.cliente), { nome: "Pediu orçamento", antes_de: "Quer agendar" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposta.titulo).toBe('Criar a etapa "Pediu orçamento" antes de "Quer agendar"');
    expect(r.proposta.mudancas.find((m) => m.rotulo === "Depois")?.valor).toBe(
      "Novo contato · Já respondi · Pediu orçamento · Quer agendar · Consulta marcada · Não vai marcar",
    );
    expect(r.proposta.chave).toBe(`${FUNIL}:pediu orcamento`);
    expect(b.escritas).toEqual([]);
    const sem = await preparar.prepararEtapaNova(contexto(b.cliente), { nome: "Retorno" });
    expect(sem.ok && sem.proposta.pedido).toMatchObject({ antes_de_nome: "Consulta marcada" });
    const repetida = await preparar.prepararEtapaNova(contexto(b.cliente), { nome: "quer  agendar" });
    expect(repetida).toMatchObject({ ok: false, motivo: "ja_existe" });
  });

  it("renomear: o nome de agora e o novo; o mesmo nome não vira cartão", async () => {
    const b = empresa();
    const r = await preparar.prepararRenomearEtapa(contexto(b.cliente), { de: "Já respondi", para: "Em conversa" });
    expect(r.ok && r.proposta.mudancas).toContainEqual({ rotulo: "Etapa", valor: "Já respondi → Em conversa" });
    expect(await preparar.prepararRenomearEtapa(contexto(b.cliente), { de: "Já respondi", para: "já respondi" })).toMatchObject({ ok: false });
  });

  it("resposta rápida: o atalho limpo, de quem pede (atendente) ou da equipe (gestora); a repetida já existe", async () => {
    const b = empresa();
    const daCarla = await preparar.prepararResposta(contexto(b.cliente, CARLA), { atalho: "/Endereco", texto: "Estamos na Rua das Acácias, 120." });
    expect(daCarla.ok && daCarla.proposta.pedido).toMatchObject({ atalho: "endereco", para: "eu" });
    expect(daCarla.ok && daCarla.proposta.chave).toBe(`eu:${CARLA}:endereco`);
    const daMarina = await preparar.prepararResposta(contexto(b.cliente, MARINA), { atalho: "endereco", texto: "Estamos na Rua das Acácias, 120." });
    expect(daMarina.ok && daMarina.proposta.pedido).toMatchObject({ para: "equipe" });
    expect(await preparar.prepararResposta(contexto(b.cliente), { atalho: "/boasvindas", texto: "Oi!!" })).toMatchObject({ ok: false, motivo: "ja_existe" });
  });

  it("etiqueta: a cor pelo nome, da paleta; a que já existe no vocabulário não vira cartão", async () => {
    const b = empresa();
    const r = await preparar.prepararEtiqueta(contexto(b.cliente), { nome: "Indicação", cor: "verde" });
    expect(r.ok && r.proposta.pedido).toEqual({ nome: "Indicação", cor: "#00655a" });
    expect(await preparar.prepararEtiqueta(contexto(b.cliente), { nome: "paciente antigo" })).toMatchObject({ ok: false, motivo: "ja_existe" });
  });

  it("tarefa: a hora da empresa vira o instante; hora passada e pessoa de fora são recusadas", async () => {
    const b = empresa();
    const r = await preparar.prepararTarefa(contexto(b.cliente, CARLA), { titulo: "Ligar para o Rogério sobre a limpeza", quando: "2026-10-27T10:00" });
    expect(r.ok && r.proposta.pedido).toMatchObject({ vence_em: "2026-10-27T13:00:00.000Z", quando: "amanhã, 10h", para_user_id: CARLA });
    expect(await preparar.prepararTarefa(contexto(b.cliente, CARLA), { titulo: "Ligar", quando: "2026-10-20T10:00" })).toMatchObject({ ok: false });
    expect(
      await preparar.prepararTarefa(contexto(b.cliente, CARLA), { titulo: "Ligar de novo", quando: "2026-10-27T10:00", para_user_id: "0b000000-0000-4000-8000-0000000000ff" }),
    ).toMatchObject({ ok: false });
  });

  it("rascunho de follow-up: a escada é de três mensagens, sobre o modelo de retomada do segmento", async () => {
    const b = empresa();
    expect(await preparar.prepararRascunhoDeFollowup(contexto(b.cliente), { nome: "Orçamento · retomar", mensagens: ["Oi", "Ainda quer?"] })).toMatchObject({
      ok: false,
    });
    const r = await preparar.prepararRascunhoDeFollowup(contexto(b.cliente), {
      nome: "Orçamento · retomar quem pediu e sumiu",
      mensagens: ["Oi, {nome}! Ficou alguma dúvida?", "Ainda dá tempo esta semana.", "Fico à disposição."],
      esperas_dias: [1, 3],
    });
    expect(r.ok && r.proposta.pedido).toMatchObject({ modelo: "clinica-consulta-retomada", esperas_dias: [1, 3] });
  });

  it("item de conhecimento: entra no material que o agente no ar já lê, e o cartão diz isso", async () => {
    const b = empresa({
      ai_agents: [{ id: "ag1", organization_id: ORG, name: "Clara · Recepção", is_default: true, published_version_id: "v1", archived_at: null }],
      ai_agent_versions: [{ id: "v1", organization_id: ORG, knowledge_source_ids: ["m1"] }],
      ai_knowledge_sources: [{ id: "m1", organization_id: ORG, name: "Perguntas da clínica", source_type: "faq", is_active: true }],
      ai_faq_items: [{ organization_id: ORG, knowledge_source_id: "m1", question: "Qual o endereço?" }],
    });
    const r = await preparar.prepararItemDeConhecimento(contexto(b.cliente), { titulo: "Estacionamento", resposta: "Temos estacionamento conveniado ao lado." });
    expect(r.ok && r.proposta.pedido).toMatchObject({ material_id: "m1", agente_usa: true, agente_nome: "Clara · Recepção" });
    const semAgente = await preparar.prepararItemDeConhecimento(contexto(empresa().cliente), { titulo: "Estacionamento", resposta: "Temos estacionamento." });
    expect(semAgente.ok && semAgente.proposta.pedido).toMatchObject({ material_id: null, agente_usa: false, material_nome: "Respostas do dia a dia" });
  });

  it("relatório: só de quem pede por padrão; o de nome repetido já existe", async () => {
    const b = empresa({ mia_relatorios: [{ id: "r1", organization_id: ORG, nome: "Vendas por pessoa da equipe" }] });
    const r = await preparar.prepararRelatorio(contexto(b.cliente, CARLA), { nome: "Leads por origem em outubro", agrupar: "origem" });
    expect(r.ok && r.proposta.pedido).toMatchObject({ para: "eu", periodo: "mes", funil_id: null });
    expect(await preparar.prepararRelatorio(contexto(b.cliente), { nome: "vendas por pessoa da equipe", agrupar: "resp" })).toMatchObject({
      ok: false,
      motivo: "ja_existe",
    });
  });

  it("meta do mês: a atendente não pede; a gestora prepara com o antes; mês passado não", async () => {
    const b = empresa({
      sales_targets: [{ organization_id: ORG, periodo: "2026-10-01", metrica: "receita_total", user_id: null, agent_id: null, alvo_cents: 15_000_000 }],
    });
    expect(await preparar.prepararMeta(contexto(b.cliente, CARLA), { valor_cents: 18_000_000, mes: "2026-11" })).toMatchObject({ ok: false });
    const r = await preparar.prepararMeta(contexto(b.cliente, MARINA), { valor_cents: 18_000_000, mes: "2026-11" });
    expect(r.ok && r.proposta.titulo).toMatch(/^Definir a meta de novembro em R\$\s?180\.000/);
    expect(r.ok && r.proposta.mudancas[0]!.valor).toMatch(/novembro sem meta \(a de outubro foi R\$\s?150\.000\)/);
    expect(await preparar.prepararMeta(contexto(b.cliente, MARINA), { valor_cents: 1_000, mes: "2026-09" })).toMatchObject({ ok: false });
  });
});

describe("a forma do pedido é conferida antes do aplicar", () => {
  it("o pedido preparado passa; o forjado pela sessão é recusado", async () => {
    const r = await preparar.prepararEtiqueta(contexto(empresa().cliente), { nome: "Indicação", cor: "roxo" });
    expect(r.ok && conferirPedido("etiqueta", r.proposta.pedido).ok).toBe(true);
    expect(conferirPedido("etiqueta", { nome: "Indicação", cor: "#123456" }).ok).toBe(false);
    expect(conferirPedido("tarefa", { titulo: "Ligar", vence_em: "amanhã", quando: "amanhã", para_user_id: "x", para_nome: "x" }).ok).toBe(false);
    expect(conferirPedido("meta", { mes: "2026-11", valor_cents: -1, moeda: "BRL" }).ok).toBe(false);
    expect(conferirPedido("resposta", { atalho: "endereco", titulo: "Endereço", texto: "Rua das Acácias, 120.", para: "eu", extra: 1 }).ok).toBe(false);
  });
});

describe("as travas do desfazer: a trava é o uso, sem prazo (decisão 4)", () => {
  const aplicada = (tipo: string, resultado: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ({ tipo, resultado, saiu_com_o_agente_em: null, ...extra }) as never;

  it("etapa com negócio trava; vazia, não", async () => {
    const etapa = "0d000000-0000-4000-8000-000000000009";
    const livre = empresa().cliente;
    expect(await travaDoDesfazer(livre as never, ORG, aplicada("etapa_criar", { etapa_id: etapa, funil_id: FUNIL }))).toBeNull();
    const ocupada = empresa({ crm_leads: [{ id: "l1", organization_id: ORG, stage_id: etapa }] }).cliente;
    expect((await travaDoDesfazer(ocupada as never, ORG, aplicada("etapa_criar", { etapa_id: etapa, funil_id: FUNIL })))?.motivo).toMatch(
      /^1 negócio já está nesta etapa/,
    );
  });

  it("renomeada de novo pela tela trava", async () => {
    const id = "0d000000-0000-4000-8000-000000000001";
    const b = empresa().cliente;
    expect(await travaDoDesfazer(b as never, ORG, aplicada("etapa_renomear", { etapa_id: id, de: "Antes", para: "Já respondi" }))).toBeNull();
    expect((await travaDoDesfazer(b as never, ORG, aplicada("etapa_renomear", { etapa_id: id, de: "Antes", para: "Em conversa" })))?.motivo).toMatch(
      /mudou o nome de novo/,
    );
  });

  it("resposta editada, tarefa concluída, relatório em painel, meta mudada e rascunho publicado travam", async () => {
    const b = empresa({
      message_templates: [{ id: "t9", organization_id: ORG, updated_at: "2026-10-26T15:00:00Z" }],
      crm_tasks: [{ id: "k1", organization_id: ORG, status: "done" }],
      mia_paineis_usuario_itens: [{ id: "i1", organization_id: ORG, relatorio_id: "r1" }],
      sales_targets: [{ organization_id: ORG, periodo: "2026-11-01", metrica: "receita_total", user_id: null, agent_id: null, alvo_cents: 20_000_000 }],
      followup_flow_pointers: [{ id: "f1", organization_id: ORG, status: "active", active_version_id: "fv1" }],
    }).cliente as never;
    expect((await travaDoDesfazer(b, ORG, aplicada("resposta", { resposta_id: "t9", atualizada_em: "2026-10-26T13:00:00Z" })))?.motivo).toMatch(/editou/);
    expect((await travaDoDesfazer(b, ORG, aplicada("tarefa", { tarefa_id: "k1" })))?.motivo).toMatch(/concluída/);
    expect((await travaDoDesfazer(b, ORG, aplicada("relatorio", { relatorio_id: "r1" })))?.motivo).toMatch(/painel/);
    expect((await travaDoDesfazer(b, ORG, aplicada("meta", { mes: "2026-11", valor_cents: 18_000_000 })))?.motivo).toMatch(/mudou a meta/);
    expect((await travaDoDesfazer(b, ORG, aplicada("rascunho_de_followup", { fluxo_id: "f1" })))?.motivo).toMatch(/publicado/);
  });

  it("o follow-up do modelo que já saiu com o agente trava (decisão 6)", async () => {
    const b = empresa().cliente as never;
    const trava = await travaDoDesfazer(b, ORG, aplicada("followup", { fluxo_id: "f2" }, { saiu_com_o_agente_em: "2026-10-26T12:00:00Z" }));
    expect(trava?.motivo).toMatch(/saiu junto com o agente/);
  });

  it("o funil do quadro pronto com negócio trava (decisão 6)", async () => {
    const b = empresa({ crm_leads: [{ id: "l1", organization_id: ORG, pipeline_id: FUNIL }] }).cliente as never;
    expect((await travaDoDesfazer(b, ORG, aplicada("funil", { funil_id: FUNIL })))?.motivo).toMatch(/entrou neste funil/);
  });
});

describe("a fonte: as preparações e as ferramentas do dia a dia não importam o cliente de serviço", () => {
  const RAIZ = path.resolve(__dirname, "../..");
  it.each([
    "lib/assistente/propostas/preparar-do-dia-a-dia.ts",
    "lib/assistente/propostas/ferramentas-do-dia-a-dia.ts",
    "lib/assistente/propostas/quem-aprova.ts",
    "lib/assistente/propostas/catalogo.ts",
    "lib/assistente/nunca.ts",
    "lib/assistente/regras-do-faz.ts",
  ])("%s", (arquivo) => {
    const fonte = readFileSync(path.join(RAIZ, arquivo), "utf8");
    const imports = [...fonte.matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports.filter((i) => /supabase\/admin|request-pool|agent-engine\/db|^pg$/.test(i ?? ""))).toEqual([]);
    expect(fonte).not.toMatch(/createAdminClient\s*\(/);
  });
});
