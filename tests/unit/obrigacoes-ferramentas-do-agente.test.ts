/**
 * FORK MIA — as duas ferramentas do agente do WhatsApp para documentos e
 * obrigações.
 *
 * A regra que este arquivo guarda: O AGENTE PROPÕE, A PESSOA CONFIRMA. A
 * ferramenta de propor só escreve em `mia_obrigacoes_propostas`; o item
 * (`mia_obrigacoes`) e o histórico (`mia_obrigacoes_ciclos`) ela nem toca. Um
 * "recebido" marcado pelo agente apagaria o pedido e dispararia a automação de
 * documento recebido sem ninguém ter conferido o arquivo.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { catalogEntry } from "@/lib/mcp/tools/catalogo";
import { crmListarObrigacoesPendentes, crmProporRecebimentoDeDocumento } from "@/lib/mcp/tools/obrigacoes";
import { allTools } from "@/lib/mcp/tools";
import type { McpContext } from "@/lib/mcp/types";
import { diaNoFuso, somarDias } from "@/lib/obrigacoes/datas";

type Linha = Record<string, unknown>;

/**
 * Um banco de mentira, do tamanho do que as duas ferramentas usam: filtra por
 * igualdade, `is null`, `in` e o `or` de três pernas; guarda toda ESCRITA, por
 * tabela, para o teste conferir o que foi (e o que não foi) gravado.
 */
function bancoDeMentira(tabelas: Record<string, Linha[]>) {
  const escritas: Array<{ tabela: string; operacao: "insert" | "update" | "delete" | "upsert"; valores: unknown }> = [];

  function construir(tabela: string) {
    const filtros: Array<(l: Linha) => boolean> = [];
    let operacao: "select" | "insert" | "update" = "select";
    let valores: Linha | null = null;
    let limite = Infinity;
    let ordem: { coluna: string; crescente: boolean } | null = null;

    const executar = () => {
      const linhas = (tabelas[tabela] ??= []);
      if (operacao === "insert") {
        linhas.push({ id: `nova-${linhas.length + 1}`, ...valores });
        return { data: null, error: null };
      }
      let achadas = linhas.filter((l) => filtros.every((f) => f(l)));
      if (operacao === "update") {
        for (const l of achadas) Object.assign(l, valores);
        return { data: achadas.map((l) => ({ id: l.id })), error: null };
      }
      if (ordem) {
        const { coluna, crescente } = ordem;
        achadas = [...achadas].sort((a, b) => String(a[coluna]).localeCompare(String(b[coluna])) * (crescente ? 1 : -1));
      }
      return { data: achadas.slice(0, limite), error: null };
    };

    const q = {
      select: () => q,
      eq: (coluna: string, valor: unknown) => (filtros.push((l) => l[coluna] === valor), q),
      is: (coluna: string, valor: unknown) => (filtros.push((l) => (l[coluna] ?? null) === valor), q),
      in: (coluna: string, lista: unknown[]) => (filtros.push((l) => lista.includes(l[coluna])), q),
      or: (expressao: string) => {
        const pernas = expressao.split(/,(?![^(]*\))/).map((perna) => {
          const [coluna, operador, ...resto] = perna.split(".");
          const valor = resto.join(".");
          if (operador === "eq") return (l: Linha) => l[coluna!] === valor;
          const lista = valor.replace(/^\(|\)$/g, "").split(",");
          return (l: Linha) => lista.includes(String(l[coluna!]));
        });
        filtros.push((l) => pernas.some((p) => p(l)));
        return q;
      },
      order: (coluna: string, opcoes?: { ascending?: boolean }) => ((ordem = { coluna, crescente: opcoes?.ascending !== false }), q),
      limit: (n: number) => ((limite = n), q),
      maybeSingle: async () => {
        const { data } = executar();
        return { data: (data as Linha[] | null)?.[0] ?? null, error: null };
      },
      insert: (v: Linha) => {
        operacao = "insert";
        valores = v;
        escritas.push({ tabela, operacao: "insert", valores: v });
        return q;
      },
      update: (v: Linha) => {
        operacao = "update";
        valores = v;
        escritas.push({ tabela, operacao: "update", valores: v });
        return q;
      },
      delete: () => {
        escritas.push({ tabela, operacao: "delete", valores: null });
        return q;
      },
      upsert: (v: Linha) => {
        escritas.push({ tabela, operacao: "upsert", valores: v });
        return q;
      },
      then: (resolver: (r: { data: unknown; error: null }) => unknown) => Promise.resolve(executar()).then(resolver),
    };
    return q;
  }

  return { cliente: { from: (tabela: string) => construir(tabela) }, escritas, tabelas };
}

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "22222222-2222-4222-8222-222222222222";
const CONTATO = "33333333-3333-4333-8333-333333333333";
const OUTRO_CONTATO = "33333333-3333-4333-8333-333333333334";
const EMPRESA = "44444444-4444-4444-8444-444444444444";
const NEGOCIO = "55555555-5555-4555-8555-555555555555";
const CONVERSA = "66666666-6666-4666-8666-666666666666";
const CONVERSA_DO_OUTRO = "66666666-6666-4666-8666-666666666667";
const ALVARA = "77777777-7777-4777-8777-777777777771";
const CONTRATO = "77777777-7777-4777-8777-777777777772";
const RELATORIO = "77777777-7777-4777-8777-777777777773";
const LICENCA = "77777777-7777-4777-8777-777777777774";
const CNH_DO_OUTRO = "77777777-7777-4777-8777-777777777775";
const DE_OUTRA_ORG = "77777777-7777-4777-8777-777777777776";
const AGENTE = "88888888-8888-4888-8888-888888888888";

const HOJE = diaNoFuso(new Date(), "America/Sao_Paulo");

function obrigacao(over: Linha): Linha {
  return {
    organization_id: ORG,
    tipo_id: null,
    nome_curto: null,
    categoria: "documento",
    lead_id: null,
    empresa_id: null,
    contact_id: null,
    quem_entrega: "cliente",
    recorrencia: "anual",
    recorrencia_meses: null,
    validade_meses: 12,
    avisos_dias: [30, 15, 7],
    dias_sem_resposta: 5,
    pedido_em: null,
    prazo_em: null,
    cobrado_em: null,
    recebido_em: null,
    valido_ate: null,
    renovado_em: null,
    proxima_em: null,
    feita_em: null,
    ciclo: 1,
    arquivo_path: null,
    arquivado_em: null,
    ...over,
  };
}

function cenario() {
  return bancoDeMentira({
    organizations: [{ id: ORG, timezone: "America/Sao_Paulo" }],
    contacts: [
      { id: CONTATO, organization_id: ORG, empresa_id: EMPRESA, is_anonymized: false },
      { id: OUTRO_CONTATO, organization_id: ORG, empresa_id: null, is_anonymized: false },
    ],
    crm_leads: [{ id: NEGOCIO, organization_id: ORG, contact_id: CONTATO, empresa_id: EMPRESA, status: "open" }],
    conversations: [
      { id: CONVERSA, organization_id: ORG, contact_id: CONTATO },
      { id: CONVERSA_DO_OUTRO, organization_id: ORG, contact_id: OUTRO_CONTATO },
    ],
    messages: [
      { id: "m-texto", organization_id: ORG, conversation_id: CONVERSA, direction: "inbound", type: "text", body: "segue o alvará", media_mime: null, sent_at: "2026-10-01T12:40:00Z" },
      { id: "m-antiga", organization_id: ORG, conversation_id: CONVERSA, direction: "inbound", type: "image", body: null, media_mime: "image/jpeg", sent_at: "2026-09-20T12:00:00Z" },
      { id: "m-arquivo", organization_id: ORG, conversation_id: CONVERSA, direction: "inbound", type: "document", body: "alvara-2026.pdf", media_mime: "application/pdf", sent_at: "2026-10-01T12:42:00Z" },
      { id: "m-nossa", organization_id: ORG, conversation_id: CONVERSA, direction: "outbound", type: "document", body: "proposta.pdf", media_mime: "application/pdf", sent_at: "2026-10-01T12:50:00Z" },
    ],
    mia_obrigacoes: [
      // Da empresa do contato: vencendo em 12 dias, com a renovação pedida há 5.
      obrigacao({ id: ALVARA, nome: "Alvará de funcionamento", empresa_id: EMPRESA, recebido_em: somarDias(HOJE, -353), valido_ate: somarDias(HOJE, 12), pedido_em: somarDias(HOJE, -5), prazo_em: somarDias(HOJE, 2) }),
      // Do negócio dele: ainda a pedir.
      obrigacao({ id: CONTRATO, nome: "Contrato social", recorrencia: "unica", validade_meses: 0, avisos_dias: [], lead_id: NEGOCIO }),
      // Atividade do negócio, longe da data: não é pendência.
      obrigacao({ id: RELATORIO, nome: "Relatório mensal", categoria: "atividade", quem_entrega: "nos", recorrencia: "mensal", validade_meses: 0, avisos_dias: [5, 2], lead_id: NEGOCIO, proxima_em: somarDias(HOJE, 20), feita_em: somarDias(HOJE, -10) }),
      // Do próprio contato, em dia.
      obrigacao({ id: LICENCA, nome: "Licença sanitária", contact_id: CONTATO, recebido_em: somarDias(HOJE, -100), valido_ate: somarDias(HOJE, 265) }),
      // De outra pessoa, e de outra empresa.
      obrigacao({ id: CNH_DO_OUTRO, nome: "CNH", contact_id: OUTRO_CONTATO, pedido_em: somarDias(HOJE, -2) }),
      obrigacao({ id: DE_OUTRA_ORG, organization_id: OUTRA_ORG, nome: "Alvará de funcionamento", contact_id: CONTATO }),
    ],
    mia_obrigacoes_propostas: [],
    mia_obrigacoes_ciclos: [],
  });
}

function contexto(banco: ReturnType<typeof bancoDeMentira>): McpContext {
  return {
    organizationId: ORG,
    role: "agent",
    actor: { type: "ai_agent", agent_id: AGENTE } as unknown as McpContext["actor"],
    apiTokenId: "token",
    requestId: "req",
    supabase: banco.cliente as unknown as McpContext["supabase"],
  };
}

let banco: ReturnType<typeof bancoDeMentira>;
beforeEach(() => {
  banco = cenario();
});

describe("crm_listar_obrigacoes_pendentes", () => {
  it("é leitura, entra no catálogo do agente e não grava nada", async () => {
    expect(crmListarObrigacoesPendentes.category).toBe("read");
    expect(crmListarObrigacoesPendentes.requiresScope).toBe("mcp:read");
    expect(allTools.map((t) => t.name)).toContain("crm_listar_obrigacoes_pendentes");
    expect(catalogEntry("crm_listar_obrigacoes_pendentes")).toMatchObject({ category: "read", risco: "seguro" });
    await crmListarObrigacoesPendentes.handler({ contact_id: CONTATO }, contexto(banco));
    expect(banco.escritas).toEqual([]);
  });

  it("diz o que está pendente com o cliente: do contato, da empresa dele e dos negócios abertos dele", async () => {
    const r = (await crmListarObrigacoesPendentes.handler({ contact_id: CONTATO }, contexto(banco))) as {
      pendencias: Array<Record<string, unknown>>;
      em_dia: number;
    };
    expect(r.pendencias.map((p) => [p.obrigacao_id, p.situacao, p.ligado_a, p.quem_entrega])).toEqual([
      [ALVARA, "vencendo", "empresa", "cliente"],
      [CONTRATO, "a pedir", "negocio", "cliente"],
    ]);
    // A licença válida e o relatório longe da data não são pendência.
    expect(r.em_dia).toBe(2);
    // Nada de outra pessoa, nem de outra empresa.
    const ids = r.pendencias.map((p) => p.obrigacao_id);
    expect(ids).not.toContain(CNH_DO_OUTRO);
    expect(ids).not.toContain(DE_OUTRA_ORG);
  });

  it("avisa quando já há arquivo esperando a equipe conferir, para o agente não pedir de novo", async () => {
    banco.tabelas.mia_obrigacoes_propostas!.push({ id: "p1", organization_id: ORG, obrigacao_id: ALVARA, situacao: "pendente" });
    const r = (await crmListarObrigacoesPendentes.handler({ contact_id: CONTATO }, contexto(banco))) as {
      pendencias: Array<{ obrigacao_id: string; arquivo_em_conferencia: boolean }>;
    };
    expect(r.pendencias.find((p) => p.obrigacao_id === ALVARA)?.arquivo_em_conferencia).toBe(true);
    expect(r.pendencias.find((p) => p.obrigacao_id === CONTRATO)?.arquivo_em_conferencia).toBe(false);
  });

  it("contato anonimizado ou de outra conta: lista vazia, com o motivo", async () => {
    (banco.tabelas.contacts![0] as Linha).is_anonymized = true;
    const anonimizado = (await crmListarObrigacoesPendentes.handler({ contact_id: CONTATO }, contexto(banco))) as { pendencias: unknown[]; motivo: string };
    expect(anonimizado.pendencias).toEqual([]);
    expect(anonimizado.motivo).toContain("exclusão de dados");
    const estranho = (await crmListarObrigacoesPendentes.handler(
      { contact_id: "99999999-9999-4999-8999-999999999999" },
      contexto(banco),
    )) as { pendencias: unknown[] };
    expect(estranho.pendencias).toEqual([]);
  });
});

describe("crm_propor_recebimento_de_documento", () => {
  const propor = (args: Partial<{ obrigacao_id: string; conversation_id: string; message_id: string; nome_do_arquivo: string }> = {}) =>
    crmProporRecebimentoDeDocumento.handler({ obrigacao_id: ALVARA, conversation_id: CONVERSA, ...args }, contexto(banco)) as Promise<{
      registrada: boolean;
      motivo?: string;
      o_que_dizer?: string;
    }>;

  it("⭐ grava SÓ a proposta: o item e o histórico não são tocados, e o documento não fica recebido", async () => {
    const antes = JSON.stringify(banco.tabelas.mia_obrigacoes);
    const r = await propor();
    expect(r.registrada).toBe(true);
    expect(new Set(banco.escritas.map((e) => e.tabela))).toEqual(new Set(["mia_obrigacoes_propostas"]));
    expect(JSON.stringify(banco.tabelas.mia_obrigacoes)).toBe(antes);
    expect(banco.tabelas.mia_obrigacoes_ciclos).toEqual([]);
    expect(banco.tabelas.mia_obrigacoes_propostas).toHaveLength(1);
    expect(banco.tabelas.mia_obrigacoes_propostas![0]).toMatchObject({
      organization_id: ORG,
      obrigacao_id: ALVARA,
      situacao: "pendente",
      ciclo: 1,
      contact_id: CONTATO,
      conversation_id: CONVERSA,
      // O arquivo mais recente que o CLIENTE mandou: não o texto, não a foto antiga, não o nosso PDF.
      message_id: "m-arquivo",
      arquivo_nome: "alvara-2026.pdf",
      arquivo_mime: "application/pdf",
      proposta_por_agente_id: AGENTE,
    });
  });

  it("a resposta manda o agente dizer que a equipe vai conferir, e nunca que foi aprovado", async () => {
    const r = await propor();
    expect(r.o_que_dizer).toContain("a equipe vai conferir");
    expect(r.o_que_dizer).toContain("quem confirma é uma pessoa");
    expect(crmProporRecebimentoDeDocumento.description).toContain("NÃO marca o documento como recebido");
  });

  it("uma proposta pendente por item: a mais nova substitui a anterior", async () => {
    await propor({ message_id: "m-antiga" });
    await propor();
    expect(banco.tabelas.mia_obrigacoes_propostas).toHaveLength(1);
    expect(banco.tabelas.mia_obrigacoes_propostas![0]).toMatchObject({ message_id: "m-arquivo", situacao: "pendente" });
  });

  it("⭐ só aceita arquivo de quem tem a ver com o item: outro contato não pendura arquivo no documento alheio", async () => {
    const r = await propor({ conversation_id: CONVERSA_DO_OUTRO });
    expect(r.registrada).toBe(false);
    expect(r.motivo).toContain("não é deste contato");
    expect(banco.escritas).toEqual([]);
  });

  it("aceita o item do negócio do contato e o do próprio contato", async () => {
    expect((await propor({ obrigacao_id: CONTRATO })).registrada).toBe(true);
    expect((await propor({ obrigacao_id: LICENCA })).registrada).toBe(true);
  });

  it("recusa atividade recorrente, item de outra conta, conversa sem arquivo do cliente e contato anonimizado", async () => {
    expect((await propor({ obrigacao_id: RELATORIO })).motivo).toContain("atividade recorrente");
    expect((await propor({ obrigacao_id: DE_OUTRA_ORG })).motivo).toContain("não encontrei esse documento");
    banco.tabelas.messages = banco.tabelas.messages!.filter((m) => m.direction === "outbound" || m.type === "text");
    expect((await propor()).motivo).toContain("não encontrei arquivo");
    (banco.tabelas.contacts![0] as Linha).is_anonymized = true;
    expect((await propor()).motivo).toContain("não pode ter documentos");
    expect(banco.escritas).toEqual([]);
  });

  it("o nome do arquivo fica fora da auditoria (pode levar nome de gente)", () => {
    expect(
      crmProporRecebimentoDeDocumento.redigirParaAuditoria?.({
        obrigacao_id: ALVARA,
        conversation_id: CONVERSA,
        nome_do_arquivo: "cnh-fulano-de-tal.pdf",
      }),
    ).toEqual({ obrigacao_id: ALVARA, conversation_id: CONVERSA });
  });

  it("é escrita de atendente, no catálogo com risco declarado", () => {
    expect(crmProporRecebimentoDeDocumento.category).toBe("write");
    expect(crmProporRecebimentoDeDocumento.requiresRole).toBe("agent");
    expect(allTools.map((t) => t.name)).toContain("crm_propor_recebimento_de_documento");
    expect(catalogEntry("crm_propor_recebimento_de_documento")).toMatchObject({ category: "write", risco: "atencao" });
  });
});
