/**
 * FORK MIA (.91) — OS PRIMEIROS PASSOS no MCP de plataforma, pelo protocolo,
 * contra o banco em memória:
 *
 *   - `plataforma_ver_implantacao` devolve o RÓTULO DO CLIENTE (o "o que
 *     falta" que a empresa nova vê e o assistente lê), da mesma régua das
 *     áreas, e as áreas novas (primeiros passos, plano e cobrança);
 *   - o caminho inteiro de uma proposta: preparar (o que o assistente faz,
 *     sem gravar a peça), decidir pelo MCP (`plataforma_decidir_proposta_do_
 *     assistente`) e ver a peça nascer em rascunho;
 *   - o follow-up proposto sai JUNTO com o agente publicado, e só com ele;
 *   - as duas ferramentas novas (a contagem total, 94, mora no teste da cobrança).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cenarioDaImplantacao, clienteMcp, NUMERO, ORG, TODAS_AS_OPERACOES } from "@/tests/helpers/implantacao-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditForOrganizations: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => true,
  hashEmail: (e: string) => e,
}));

const { FERRAMENTAS } = await import("@/lib/mcp-plataforma/ferramentas");
const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { prepararAgenteDoModelo, prepararFollowupDoModelo, prepararFunilDoPacote } = await import("@/lib/assistente/propostas/preparar");
const { publishAgentVersion } = await import("@/lib/ai/agents/publish");

type Linha = Record<string, unknown>;

function cenario(opcoes: { comNumero?: boolean; segmento?: string } = {}) {
  const c = cenarioDaImplantacao({ comNumero: opcoes.comNumero });
  const org = c.banco.tabela("organizations")[0] as Linha;
  org.onboarding_state = opcoes.segmento
    ? { welcome: { accepted_at: "2026-10-25T10:00:00Z", timezone: "America/Sao_Paulo", display_name: "Clínica Exemplo", segmento: opcoes.segmento } }
    : {};
  estado.cliente = c.cliente;
  return c;
}

/** Grava a proposta pendente como a rota do chat grava (o que o assistente preparou). */
function gravarPendente(c: ReturnType<typeof cenario>, proposta: { tipo: string; titulo: string; mudancas: unknown; pedido: unknown }): string {
  const id = crypto.randomUUID();
  (c.banco.tabela("mia_assistente_propostas") as Linha[]).push({
    id,
    organization_id: ORG,
    conversa_id: null,
    criada_por: null,
    tipo: proposta.tipo,
    risco: "atencao",
    titulo: proposta.titulo,
    mudancas: proposta.mudancas,
    pedido: proposta.pedido,
    situacao: "pendente",
    aprovada_por: null,
    aprovada_em: null,
    aplicada_por: null,
    aplicada_em: null,
    rejeitada_por: null,
    rejeitada_em: null,
    resultado: null,
    erro: null,
    saiu_com_o_agente_em: null,
    expira_em: new Date(Date.now() + 86_400_000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return id;
}

beforeEach(() => {
  vi.clearAllMocks();
  // a chave da plataforma (a régua do botão Publicar confere que ela existe)
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

describe("a lista: as três das propostas", () => {
  it("ver (leitura livre), decidir e, desde a .94, desfazer (implantar_configuracao)", () => {
    const novas = FERRAMENTAS.filter((f) => /propostas?_do_assistente/.test(f.name)).map((f) => [f.name, f.operacao]);
    expect(Object.fromEntries(novas)).toEqual({
      plataforma_ver_propostas_do_assistente: null,
      plataforma_decidir_proposta_do_assistente: "implantar_configuracao",
      plataforma_desfazer_proposta_do_assistente: "implantar_configuracao",
    });
  });
});

describe("plataforma_ver_implantacao: o rótulo do cliente", () => {
  it("empresa nova no passo a passo: o que o assistente prepara, o que só a pessoa faz, e o que não se aplica", async () => {
    cenario({ segmento: "clinica" });
    const mcp = await clienteMcp(criarServidorDePlataforma as never, [...TODAS_AS_OPERACOES]);
    const r = await mcp.chamar("plataforma_ver_implantacao", { organization_id: ORG });
    expect(r.erro, r.texto).toBe(false);
    const rotulo = r.dados.rotulo_do_cliente as {
      aparece_no_inicio: boolean;
      segmento: string;
      itens: Array<{ item: string; coluna: string; quem_faz?: string; o_assistente_prepara?: string; depende_de?: string }>;
      nao_se_aplica: string[];
      faltam: number;
    };
    expect(rotulo.aparece_no_inicio).toBe(true);
    expect(rotulo.segmento).toBe("clinica");
    const porItem = Object.fromEntries(rotulo.itens.map((i) => [i.item, i]));
    expect(porItem.agente).toMatchObject({ coluna: "posso_completar", o_assistente_prepara: "agente" });
    expect(porItem.funil).toMatchObject({ coluna: "posso_completar", o_assistente_prepara: "funil" });
    expect(porItem.followup).toMatchObject({ coluna: "posso_completar", depende_de: expect.stringContaining("Depende do agente") });
    expect(porItem.whatsapp).toMatchObject({ coluna: "preciso_confirmar" });
    expect(porItem.equipe).toMatchObject({ coluna: "preciso_confirmar" });
    // a cobrança está desligada na instalação de teste: o plano não se aplica
    expect(rotulo.nao_se_aplica.some((n) => /Plano e cobrança/.test(n))).toBe(true);
    expect(rotulo.nao_se_aplica.some((n) => /Base importada/.test(n))).toBe(true);
    expect(rotulo.faltam).toBeGreaterThan(3);
    // as áreas novas do checklist
    const areas = (r.dados.areas as Array<{ area: string }>).map((a) => a.area);
    expect(areas).toEqual(expect.arrayContaining(["primeiros_passos", "plano_e_cobranca"]));
    await mcp.fechar();
  });

  it("o número oficial que espera a Time aparece com quem faz: Time Company", async () => {
    const c = cenario({ segmento: "clinica" });
    const org = c.banco.tabela("organizations")[0] as Linha;
    org.onboarding_state = {
      ...(org.onboarding_state as object),
      whatsapp: { status: "esperando_a_time", skipped: true, entrou_com_facebook_em: "2026-10-25T12:00:00Z" },
    };
    const mcp = await clienteMcp(criarServidorDePlataforma as never, [...TODAS_AS_OPERACOES]);
    const r = await mcp.chamar("plataforma_ver_implantacao", { organization_id: ORG });
    const itens = (r.dados.rotulo_do_cliente as { itens: Array<{ item: string; quem_faz?: string; titulo: string }> }).itens;
    expect(itens.find((i) => i.item === "whatsapp")).toMatchObject({ quem_faz: "Time Company", titulo: "Ligar o número oficial à empresa" });
    // e a Time vê no "com o humano" do checklist, com quem faz: a plataforma
    const comOHumano = r.dados.com_o_humano as Array<{ area: string; quem: string }>;
    expect(comOHumano.some((p) => p.area === "primeiros_passos" && p.quem === "plataforma")).toBe(true);
    await mcp.fechar();
  });

  it("a empresa implantada pela Time (sem o segmento do passo a passo desta versão, já concluída) não aparece no Início", async () => {
    const c = cenario();
    (c.banco.tabela("organizations")[0] as Linha).onboarded_at = "2026-09-01T00:00:00Z";
    const mcp = await clienteMcp(criarServidorDePlataforma as never, [...TODAS_AS_OPERACOES]);
    const r = await mcp.chamar("plataforma_ver_implantacao", { organization_id: ORG });
    expect((r.dados.rotulo_do_cliente as { aparece_no_inicio: boolean; por_que: string })).toMatchObject({
      aparece_no_inicio: false,
      por_que: "sem_o_passo_a_passo_desta_versao",
    });
    await mcp.fechar();
  });
});

describe("uma proposta do começo ao fim", () => {
  it("o funil: preparar não grava a peça; aplicar pelo MCP adota o quadro de e-commerce e marca a proposta", async () => {
    const c = cenario({ segmento: "clinica" });
    const preparo = await prepararFunilDoPacote(c.cliente as never, ORG);
    expect(preparo.ok).toBe(true);
    if (!preparo.ok) return;
    // nada mudou no funil só por preparar
    expect((c.banco.tabela("crm_pipelines")[0] as Linha).name).toBe("Pedidos");
    const id = gravarPendente(c, preparo.proposta);

    const mcp = await clienteMcp(criarServidorDePlataforma as never, [...TODAS_AS_OPERACOES]);
    const r = await mcp.chamar("plataforma_decidir_proposta_do_assistente", { organization_id: ORG, proposta_id: id, decisao: "aplicar" });
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados.desfecho).toBe("aplicada");
    const funil = c.banco.tabela("crm_pipelines")[0] as Linha;
    expect(funil.name).toBe("Agendamentos");
    const proposta = (c.banco.tabela("mia_assistente_propostas") as Linha[]).find((p) => p.id === id)!;
    expect(proposta).toMatchObject({ situacao: "aplicada" });
    expect(proposta.aprovada_em).toBeTruthy();
    // ainda no passo a passo: o passo "Onde ele organiza" fica feito
    expect(((c.banco.tabela("organizations")[0] as Linha).onboarding_state as { funil?: unknown }).funil).toBeTruthy();

    // de novo: devolve o que já estava, sem criar outra peça
    const de_novo = await mcp.chamar("plataforma_decidir_proposta_do_assistente", { organization_id: ORG, proposta_id: id, decisao: "aplicar" });
    expect(de_novo.dados.desfecho).toBe("ja_estava");
    // e recusar a aplicada é recusado
    const recusar = await mcp.chamar("plataforma_decidir_proposta_do_assistente", { organization_id: ORG, proposta_id: id, decisao: "rejeitar" });
    expect(recusar.erro).toBe(true);
    await mcp.fechar();
  });

  it("recusar a pendente não cria nada", async () => {
    const c = cenario({ segmento: "academia" });
    const preparo = await prepararAgenteDoModelo(c.cliente as never, ORG);
    if (!preparo.ok) throw new Error("devia preparar");
    const id = gravarPendente(c, preparo.proposta);
    const mcp = await clienteMcp(criarServidorDePlataforma as never, [...TODAS_AS_OPERACOES]);
    const r = await mcp.chamar("plataforma_decidir_proposta_do_assistente", { organization_id: ORG, proposta_id: id, decisao: "rejeitar" });
    expect(r.dados.desfecho).toBe("rejeitada");
    expect(c.banco.tabela("ai_agents")).toHaveLength(0);
    await mcp.fechar();
  });

  it("sem a operação no token, nada é decidido", async () => {
    const c = cenario({ segmento: "clinica" });
    const preparo = await prepararFunilDoPacote(c.cliente as never, ORG);
    if (!preparo.ok) throw new Error("devia preparar");
    const id = gravarPendente(c, preparo.proposta);
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const r = await mcp.chamar("plataforma_decidir_proposta_do_assistente", { organization_id: ORG, proposta_id: id, decisao: "aplicar" });
    expect(r.erro).toBe(true);
    expect((c.banco.tabela("mia_assistente_propostas") as Linha[])[0]!.situacao).toBe("pendente");
    await mcp.fechar();
  });

  it("o agente e o follow-up: o agente nasce RASCUNHO e padrão; o follow-up em rascunho, armado, e sai JUNTO com o agente publicado", async () => {
    const c = cenario({ segmento: "clinica", comNumero: true });
    const mcp = await clienteMcp(criarServidorDePlataforma as never, [...TODAS_AS_OPERACOES]);

    const agente = await prepararAgenteDoModelo(c.cliente as never, ORG);
    if (!agente.ok) throw new Error("devia preparar o agente");
    expect(agente.proposta.pedido).toMatchObject({ nome: "Clara · Recepção" });
    const idAgente = gravarPendente(c, agente.proposta);
    const ra = await mcp.chamar("plataforma_decidir_proposta_do_assistente", { organization_id: ORG, proposta_id: idAgente, decisao: "aplicar" });
    expect(ra.erro, ra.texto).toBe(false);
    const linhaDoAgente = (c.banco.tabela("ai_agents") as Linha[])[0]!;
    expect(linhaDoAgente).toMatchObject({ name: "Clara · Recepção", is_default: true });
    expect(linhaDoAgente.published_version_id ?? null, "o agente proposto nasce em rascunho").toBeNull();

    // o follow-up depende do agente: agora ele existe
    const fu = await prepararFollowupDoModelo(c.cliente as never, ORG);
    if (!fu.ok) throw new Error(`devia preparar o follow-up: ${JSON.stringify(fu)}`);
    const idFu = gravarPendente(c, fu.proposta);
    const rf = await mcp.chamar("plataforma_decidir_proposta_do_assistente", { organization_id: ORG, proposta_id: idFu, decisao: "aplicar" });
    expect(rf.erro, rf.texto).toBe(false);
    const fluxo = (c.banco.tabela("followup_flow_pointers") as Linha[])[0]!;
    expect(fluxo.status).not.toBe("active");
    const propostaFu = (c.banco.tabela("mia_assistente_propostas") as Linha[]).find((p) => p.id === idFu)!;
    expect(propostaFu.saiu_com_o_agente_em).toBeNull();

    // a pessoa publica o agente (o clique humano): o follow-up armado sai junto
    const rp = await mcp.chamar("plataforma_publicar_agente", { organization_id: ORG, agente: String(linhaDoAgente.id), numero: NUMERO });
    expect(rp.erro, rp.texto).toBe(false);
    expect((c.banco.tabela("followup_flow_pointers") as Linha[])[0]!.status).toBe("active");
    expect(propostaFu.saiu_com_o_agente_em).toBeTruthy();
    await mcp.fechar();
  });

  it("publicar sem quem publicou (caminho automático) não solta o follow-up", async () => {
    const c = cenario({ segmento: "clinica", comNumero: true });
    const proposta = { id: "p1", organization_id: ORG, tipo: "followup", situacao: "aplicada", saiu_com_o_agente_em: null, resultado: { agente_id: "a1", fluxo_id: "f1" } };
    (c.banco.tabela("mia_assistente_propostas") as Linha[]).push(proposta);
    const { publicarFollowupsQueSaemComOAgente } = await import("@/lib/assistente/propostas/sai-com-o-agente");
    const r = await publicarFollowupsQueSaemComOAgente(c.cliente as never, { orgId: ORG, agentId: "a1", versionId: "v1", actorUserId: null });
    expect(r.publicados).toEqual([]);
    expect(proposta.saiu_com_o_agente_em).toBeNull();
    void publishAgentVersion;
  });
});
