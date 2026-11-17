/**
 * FORK MIA — O LEMBRETE DA AGENDA POR MODELO APROVADO (upstream 1.100, 9092) E O
 * MODELO DO AVISO À EQUIPE (9094, 9099) AO ALCANCE DO MCP DE PLATAFORMA.
 *
 * O molde é o de `mcp-de-implantacao-novidades-do-upstream-1107.test.ts`: o que
 * se mede é o BANCO, não a resposta. Três coisas:
 *   - a seção nova `modelos_aprovados` de `plataforma_ver_configuracao` lista só
 *     os APROVADOS, por número, com idioma, categoria e variáveis;
 *   - `modelo_do_lembrete` de `plataforma_garantir_tipos_de_agendamento` grava
 *     `reminder_meta_template_id`, recusa o não aprovado, o de outro número e o
 *     de variável que o lembrete não preenche, e repetir responde `ja_estava`;
 *   - o modelo do aviso à equipe é só leitura (a porta exige sessão com as duas
 *     etapas), e a leitura diz qual está escolhido.
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia e nomes inventados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cenarioDaImplantacao,
  clienteMcp,
  NUMERO,
  ORG,
  TODAS_AS_OPERACOES,
} from "@/tests/helpers/implantacao-em-memoria";
import type { Linha } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));
vi.mock("@/lib/ai/embeddings/chave", () => ({ temChaveDeEmbedding: vi.fn(async () => true) }));

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");

const OUTRO_NUMERO = "0e000000-0000-4000-8000-000000000002";
const corpo = (texto: string) => [{ type: "BODY", text: texto }];

const MODELOS = {
  lembrete: "0f000000-0000-4000-8000-000000000001",
  aviso: "0f000000-0000-4000-8000-000000000002",
  pendente: "0f000000-0000-4000-8000-000000000003",
  doOutro: "0f000000-0000-4000-8000-000000000004",
  nomeado: "0f000000-0000-4000-8000-000000000005",
};

function modelo(id: string, name: string, extra: Partial<Linha>): Linha {
  return {
    id,
    organization_id: ORG,
    name,
    language: "pt_BR",
    status: "APPROVED",
    category: "UTILITY",
    channel_session_id: NUMERO,
    waba_id: null,
    parameter_format: "POSITIONAL",
    components: corpo("Olá, {{1}}."),
    rejected_reason: null,
    ...extra,
  };
}

async function preparar() {
  const cenario = cenarioDaImplantacao({ comNumero: true });
  estado.cliente = cenario.cliente;
  const tabela = (nome: string) => cenario.banco.tabela(nome) as Linha[];
  tabela("channel_sessions").push({
    ...tabela("channel_sessions")[0]!,
    id: OUTRO_NUMERO,
    display_name: "Comercial",
    phone_number: "+5500900000002",
  });
  tabela("meta_templates").push(
    modelo(MODELOS.lembrete, "lembrete_de_horario", { components: corpo("Olá, {{1}}! Seu horário é {{2}}: {{3}}.") }),
    modelo(MODELOS.aviso, "aviso_da_equipe", { components: corpo("Novo aviso: {{1}}") }),
    modelo(MODELOS.pendente, "lembrete_em_analise", { status: "PENDING" }),
    modelo(MODELOS.doOutro, "lembrete_do_comercial", { channel_session_id: OUTRO_NUMERO }),
    modelo(MODELOS.nomeado, "lembrete_nomeado", { parameter_format: "NAMED", components: corpo("Olá, {{nome}}.") }),
  );
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

beforeEach(() => vi.clearAllMocks());

describe("plataforma_ver_configuracao · SEÇÃO NOVA `modelos_aprovados` (upstream 1.100)", () => {
  it("lista só os aprovados, por número, com idioma, categoria, variáveis e para que servem", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_ver_configuracao", { secoes: ["modelos_aprovados"] });
    const secao = r.dados.modelos_aprovados as Linha;
    const numeros = secao.numeros as Array<{ numero: Linha; modelos: Linha[] }>;

    const recepcao = numeros.find((n) => n.numero.id === NUMERO)!;
    const nomes = recepcao.modelos.map((m) => m.nome);
    expect(nomes).toEqual(expect.arrayContaining(["lembrete_de_horario", "aviso_da_equipe", "lembrete_nomeado"]));
    expect(nomes).not.toContain("lembrete_em_analise");
    expect(nomes).not.toContain("lembrete_do_comercial");

    const lembrete = recepcao.modelos.find((m) => m.nome === "lembrete_de_horario")!;
    expect(lembrete).toMatchObject({ idioma: "pt_BR", categoria: "UTILITY", serve_ao_lembrete: true, serve_ao_aviso_da_equipe: false });
    expect((lembrete.variaveis as Linha[]).map((v) => v.chave)).toEqual(["1", "2", "3"]);
    expect(recepcao.modelos.find((m) => m.nome === "aviso_da_equipe")).toMatchObject({ serve_ao_aviso_da_equipe: true });
    expect(recepcao.modelos.find((m) => m.nome === "lembrete_nomeado")).toMatchObject({ serve_ao_lembrete: false });

    const comercial = numeros.find((n) => n.numero.id === OUTRO_NUMERO)!;
    expect(comercial.modelos.map((m) => m.nome)).toEqual(["lembrete_do_comercial"]);

    // Sem aviso configurado, a leitura diz onde se escolhe.
    expect(secao.aviso_da_equipe).toMatchObject({ modelo: null, onde_escolher: expect.stringContaining("/app/ai/cases/avisos") });
  });

  it("o modelo escolhido no aviso à equipe aparece na leitura (só leitura: a porta pede as duas etapas)", async () => {
    const c = await preparar();
    c.tabela("config_aviso_de_caso").push({ organization_id: ORG, channel_session_id: NUMERO, modelo_id: MODELOS.aviso, ligado: true });
    const r = await ok(c, "plataforma_ver_configuracao", { secoes: ["modelos_aprovados"] });
    expect((r.dados.modelos_aprovados as Linha).aviso_da_equipe).toMatchObject({
      numero_id: NUMERO,
      modelo: { id: MODELOS.aviso, nome: "aviso_da_equipe", idioma: "pt_BR" },
      modelo_serve: true,
    });
  });
});

describe("plataforma_garantir_tipos_de_agendamento · CAMPO NOVO `modelo_do_lembrete` (upstream 1.100, 9092)", () => {
  const TIPO = { nome: "Avaliação inicial", categoria: "consulta", duracao_minutos: 40, local: "in_person", canal_do_lembrete: NUMERO };
  const doTipo = (c: Cenario) => c.tabela("calendar_event_types").find((t) => t.name === TIPO.nome)!;

  it("grava pelo nome, a leitura da seção agenda devolve o modelo, repetir responde ja_estava e null tira", async () => {
    const c = await preparar();
    const r = await ok(c, "plataforma_garantir_tipos_de_agendamento", { tipos: [{ ...TIPO, modelo_do_lembrete: "lembrete_de_horario" }] });
    expect(doTipo(c).reminder_meta_template_id).toBe(MODELOS.lembrete);
    // O tipo novo nasce com o lembrete desligado: a resposta avisa que o modelo só vale ligado.
    expect(JSON.stringify(r.dados)).toContain("plataforma_ligar_lembrete");

    const lido = await ok(c, "plataforma_ver_configuracao", { secoes: ["agenda"] });
    const tipo = ((lido.dados.agenda as Linha).tipos as Linha[]).find((t) => t.nome === TIPO.nome)!;
    expect(tipo.modelo_do_lembrete).toMatchObject({ id: MODELOS.lembrete, nome: "lembrete_de_horario", idioma: "pt_BR", serve: true });

    const de_novo = await ok(c, "plataforma_garantir_tipos_de_agendamento", { tipos: [{ ...TIPO, modelo_do_lembrete: MODELOS.lembrete }] });
    expect(JSON.stringify(de_novo.dados)).toContain("ja_estava");

    const tirado = await ok(c, "plataforma_garantir_tipos_de_agendamento", { tipos: [{ ...TIPO, modelo_do_lembrete: null }] });
    expect(JSON.stringify(tirado.dados)).toContain("modelo do lembrete");
    expect(doTipo(c).reminder_meta_template_id).toBeNull();
  });

  it("recusa, com o que fazer, o não aprovado, o de outro número, o de variável que o lembrete não preenche e o que não existe", async () => {
    const c = await preparar();
    const pedir = (modelo_do_lembrete: string) =>
      recusa(c, "plataforma_garantir_tipos_de_agendamento", { tipos: [{ ...TIPO, modelo_do_lembrete }] });

    expect(await pedir("lembrete_em_analise")).toContain("APROVADO");
    expect(await pedir("lembrete_do_comercial")).toMatch(/é do número «Comercial».*sai pelo número «Recepção»/);
    expect(await pedir("lembrete_nomeado")).toContain("{{1}} a {{4}}");
    expect(await pedir("modelo_que_nao_existe")).toContain("seção modelos_aprovados");
    // Nada foi gravado: o tipo nem chegou a nascer.
    expect(c.tabela("calendar_event_types").find((t) => t.name === TIPO.nome)).toBeUndefined();
  });

  it("o modelo do outro número passa quando o canal do lembrete do MESMO pedido é o dono dele", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_tipos_de_agendamento", {
      tipos: [{ ...TIPO, canal_do_lembrete: OUTRO_NUMERO, modelo_do_lembrete: "lembrete_do_comercial" }],
    });
    expect(doTipo(c)).toMatchObject({ reminder_channel_session_id: OUTRO_NUMERO, reminder_meta_template_id: MODELOS.doOutro });
  });
});
