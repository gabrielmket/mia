/**
 * FORK MIA (MIA-18) — A LISTA DE ESPERA E O LUGAR COM CAPACIDADE DA AGENDA AO
 * ALCANCE DO MCP DE PLATAFORMA (upstream 1.105: 9235 e 9224).
 *
 * O molde é o de `mcp-de-implantacao-novidades-do-upstream-1107.test.ts`: um
 * bloco por novidade, e o que se mede é o BANCO, não a resposta.
 *
 *  - a lista de espera é módulo de TABELA (`modulos_instalados`) e os prazos são
 *    da EMPRESA (`settings.lista_de_espera`). Sem o módulo, a ferramenta recusa
 *    com "módulo não instalado" e não instala; com ele, grava pela régua da
 *    rota da tela, e o pedido repetido responde `ja_estava`;
 *  - o lugar (recurso `kind='space'`) só é LIDO: gravar passa por uma porta que
 *    exige gerente membro da empresa (ver `docs/fork/mcp-de-implantacao.md`).
 *
 * Nenhum dado daqui é de cliente real: empresa fictícia e nomes inventados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cenarioDaImplantacao,
  clienteMcp,
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
const { FERRAMENTAS } = await import("@/lib/mcp-plataforma/ferramentas");
const { audit } = await import("@/lib/audit");

/** As linhas de auditoria de DOMÍNIO (o servidor grava também `plataforma.mcp_executado` em toda chamada). */
const auditoriasDaEspera = () =>
  vi.mocked(audit).mock.calls.filter(([linha]) => (linha as { action?: string }).action === "agenda.lista_de_espera_configurada");

async function preparar(operacoes: string[] = TODAS_AS_OPERACOES) {
  const cenario = cenarioDaImplantacao();
  estado.cliente = cenario.cliente;
  const mcp = await clienteMcp(criarServidorDePlataforma as never, operacoes);
  return { ...cenario, mcp, tabela: (nome: string) => cenario.banco.tabela(nome) as Linha[] };
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

const settings = (c: Cenario) => c.tabela("organizations").find((o) => o.id === ORG)!.settings as Linha;
const instalarModulo = (c: Cenario) => c.tabela("modulos_instalados").push({ modulo: "lista_de_espera", estado: "ativo" });
const lerAgenda = async (c: Cenario) => (await ok(c, "plataforma_ver_configuracao", { secoes: ["agenda"] })).dados.agenda as Linha;

const PRAZOS = { prazo_maximo_minutos: 120, margem_antes_minutos: 60, prazo_minimo_minutos: 15 };

beforeEach(() => vi.clearAllMocks());

describe("plataforma_configurar_lista_de_espera · FERRAMENTA NOVA (upstream 1.105, 9235, módulo opcional)", () => {
  it("é colocar_no_ar: ligar faz o sistema oferecer vaga pelo WhatsApp; o token que só monta não liga", async () => {
    expect(FERRAMENTAS.find((f) => f.name === "plataforma_configurar_lista_de_espera")?.operacao).toBe("colocar_no_ar");
    const c = await preparar(["implantar_configuracao"]);
    instalarModulo(c);
    expect(await recusa(c, "plataforma_configurar_lista_de_espera", { ligada: true, ...PRAZOS })).toBeTruthy();
    expect(settings(c).lista_de_espera).toBeUndefined();
  });

  it("⭐ sem o módulo instalado: recusa com \"módulo não instalado\", não grava e NÃO instala", async () => {
    const c = await preparar();
    const texto = await recusa(c, "plataforma_configurar_lista_de_espera", { ligada: true, ...PRAZOS });
    expect(texto).toContain("módulo não instalado");
    expect(texto).toContain("Admin › Módulos");
    expect(settings(c).lista_de_espera).toBeUndefined();
    expect(c.tabela("modulos_instalados")).toHaveLength(0);
    expect(c.banco.chamadasRpc.map((r) => r.nome)).not.toContain("fn_modulo_instalar");

    // A leitura diz o mesmo: o módulo não está, e nada liga.
    expect(((await lerAgenda(c)).lista_de_espera as Linha)).toEqual({ modulo_instalado: false, ligada: false, prazos: null });
  });

  it("com o módulo: liga pela régua da rota (sem padrão), a leitura mostra, repetir responde ja_estava, desligar mantém os prazos", async () => {
    const c = await preparar();
    instalarModulo(c);

    // Desligar o que nunca foi ligado: já está, e nada é gravado.
    const nunca = await ok(c, "plataforma_configurar_lista_de_espera", { ligada: false });
    expect(nunca.dados.desfecho).toBe("ja_estava");
    expect(settings(c).lista_de_espera).toBeUndefined();

    // Ligar pela primeira vez sem os três prazos: a tela pede o mesmo.
    expect(await recusa(c, "plataforma_configurar_lista_de_espera", { ligada: true, prazo_maximo_minutos: 120 })).toContain(
      "escolha os três prazos",
    );
    expect(settings(c).lista_de_espera).toBeUndefined();

    const r = await ok(c, "plataforma_configurar_lista_de_espera", { ligada: true, ...PRAZOS });
    expect(settings(c).lista_de_espera).toEqual({ ativa: true, ...PRAZOS });
    expect(r.dados.desfecho).toBe("criou");
    expect(auditoriasDaEspera()).toHaveLength(1);
    expect(auditoriasDaEspera()[0]![0]).toMatchObject({ organizationId: ORG, resourceId: ORG, metadata: { ativa: true, via: "mcp_plataforma" } });

    expect((await lerAgenda(c)).lista_de_espera).toEqual({ modulo_instalado: true, ligada: true, prazos: PRAZOS });

    vi.mocked(audit).mockClear();
    const de_novo = await ok(c, "plataforma_configurar_lista_de_espera", { ligada: true, ...PRAZOS });
    expect(de_novo.dados.desfecho).toBe("ja_estava");
    expect(auditoriasDaEspera()).toHaveLength(0);

    const desligou = await ok(c, "plataforma_configurar_lista_de_espera", { ligada: false });
    expect(desligou.dados.desfecho).toBe("atualizou");
    expect(settings(c).lista_de_espera).toEqual({ ativa: false, ...PRAZOS });
    expect(((await lerAgenda(c)).lista_de_espera as Linha).ligada).toBe(false);
  });

  it("o prazo mínimo acima do máximo é recusado, como na tela, e nada muda", async () => {
    const c = await preparar();
    instalarModulo(c);
    await ok(c, "plataforma_configurar_lista_de_espera", { ligada: true, ...PRAZOS });
    expect(
      await recusa(c, "plataforma_configurar_lista_de_espera", { ligada: true, ...PRAZOS, prazo_minimo_minutos: 300 }),
    ).toContain("O prazo mínimo não pode passar do máximo");
    expect(settings(c).lista_de_espera).toEqual({ ativa: true, ...PRAZOS });
  });
});

describe("plataforma_ver_configuracao, seção agenda · LEITURA NOVA dos lugares com capacidade (upstream 1.105, 9224)", () => {
  it("cada serviço devolve os lugares (kind='space') com área e capacidade de pessoas; o recurso comum não é lugar", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_tipos_de_agendamento", {
      tipos: [{ nome: "Jantar no salão", categoria: "outro", duracao_minutos: 120, local: "in_person", servico_em_rascunho: true }],
    });
    const tipo = c.tabela("calendar_event_types").find((t) => t.name === "Jantar no salão")!;
    const MESA = "0f000000-0000-4000-8000-0000000000a1";
    const VARANDA = "0f000000-0000-4000-8000-0000000000a2";
    const PROJETOR = "0f000000-0000-4000-8000-0000000000a3";
    c.tabela("calendar_resources").push(
      { id: MESA, organization_id: ORG, name: "Mesa 4", capacity: 4, kind: "space", sector: "Salão", is_active: true },
      { id: VARANDA, organization_id: ORG, name: "Mesa da varanda", capacity: 6, kind: "space", sector: null, is_active: false },
      { id: PROJETOR, organization_id: ORG, name: "Projetor", capacity: 1, kind: "resource", sector: null, is_active: true },
    );
    for (const resource_id of [MESA, VARANDA, PROJETOR]) {
      c.tabela("calendar_service_resources").push({ organization_id: ORG, event_type_id: tipo.id, resource_id, units: 1 });
    }

    const lido = ((await lerAgenda(c)).tipos as Linha[]).find((t) => t.nome === "Jantar no salão")!;
    expect((lido.servico as Linha).lugares).toEqual([
      { id: MESA, nome: "Mesa 4", area: "Salão", capacidade_de_pessoas: 4, ativo: true },
      { id: VARANDA, nome: "Mesa da varanda", area: null, capacidade_de_pessoas: 6, ativo: false },
    ]);
  });

  it("serviço sem lugar devolve a lista vazia; tipo que não é serviço segue com servico null", async () => {
    const c = await preparar();
    await ok(c, "plataforma_garantir_tipos_de_agendamento", {
      tipos: [
        { nome: "Aula em grupo", categoria: "outro", duracao_minutos: 60, local: "in_person", servico_em_rascunho: true },
        { nome: "Conversa inicial", categoria: "consulta", duracao_minutos: 30, local: "video_link" },
      ],
    });
    const tipos = (await lerAgenda(c)).tipos as Linha[];
    expect((tipos.find((t) => t.nome === "Aula em grupo")!.servico as Linha).lugares).toEqual([]);
    expect(tipos.find((t) => t.nome === "Conversa inicial")!.servico).toBeNull();
  });
});
