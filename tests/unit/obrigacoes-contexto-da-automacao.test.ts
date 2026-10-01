/**
 * FORK MIA — o que o motor de automações recebe quando um gatilho de obrigação
 * dispara: o item vira NEGÓCIO e CONTATO pela mesma herança da tela, para as
 * ações de sempre (mensagem, tarefa, etiqueta, mover de etapa) terem com quem
 * falar, e os textos das ações enxergam `{{obrigacao.nome}}` e companhia.
 */
import { describe, expect, it } from "vitest";

import { renderTemplate } from "@/lib/automation/template";
import { contextoDaObrigacao } from "@/lib/obrigacoes/contexto-da-automacao";
import { diaNoFuso, diaPorExtenso, somarDias } from "@/lib/obrigacoes/datas";
import { MARCACOES_DA_OBRIGACAO } from "@/lib/obrigacoes/gatilhos";
import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";

const ORG = "0a000000-0000-4000-8000-000000000001";
const OUTRA_ORG = "0a000000-0000-4000-8000-000000000002";
const HOJE = diaNoFuso(new Date(), "America/Sao_Paulo");

function obrigacao(over: Linha): Linha {
  return {
    organization_id: ORG,
    nome: "Alvará de funcionamento",
    nome_curto: "Alvará",
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
    recebido_em: somarDias(HOJE, -353),
    valido_ate: somarDias(HOJE, 12),
    renovado_em: null,
    proxima_em: null,
    feita_em: null,
    ciclo: 1,
    arquivado_em: null,
    ...over,
  };
}

function cenario(itens: Linha[], comNegocioAberto = true) {
  const aberto = comNegocioAberto ? "open" : "lost";
  return bancoEmMemoria({
    organizations: [{ id: ORG, timezone: "America/Sao_Paulo" }],
    mia_obrigacoes: itens,
    crm_empresas: [{ id: "E1", organization_id: ORG, nome: "Padaria Trigo Dourado" }],
    contacts: [
      { id: "C-socio", organization_id: ORG, empresa_id: "E1", name: "Rui Prado", is_anonymized: false, is_merged_into: null, principal_na_empresa: false, created_at: "2026-02-01" },
      { id: "C-principal", organization_id: ORG, empresa_id: "E1", name: "Helena Souza", is_anonymized: false, is_merged_into: null, principal_na_empresa: true, created_at: "2026-01-01" },
      { id: "C-solto", organization_id: ORG, empresa_id: null, name: "Jorge Lima", is_anonymized: false, is_merged_into: null, principal_na_empresa: false, created_at: "2026-03-01" },
    ],
    crm_leads: [
      { id: "N-antigo", organization_id: ORG, empresa_id: "E1", contact_id: "C-socio", status: aberto, title: "Gestão mensal", updated_at: "2026-08-01T00:00:00Z" },
      { id: "N-recente", organization_id: ORG, empresa_id: "E1", contact_id: "C-principal", status: aberto, title: "Renovação do contrato", updated_at: "2026-09-20T00:00:00Z" },
      { id: "N-ganho", organization_id: ORG, empresa_id: "E1", contact_id: "C-principal", status: "won", title: "Implantação", updated_at: "2026-09-30T00:00:00Z" },
    ],
  });
}

const evento = (id: string, org = ORG) =>
  ({ id: "ev", organization_id: org, event_type: "obrigacao.documento_vencendo", entity_kind: "mia_obrigacao", entity_id: id, payload: {} }) as never;

describe("o contexto de um gatilho de obrigação", () => {
  it("item da EMPRESA: o negócio aberto mais recente dela e o contato desse negócio", async () => {
    const { cliente } = cenario([obrigacao({ id: "o1", empresa_id: "E1" })]);
    const ctx = await contextoDaObrigacao(cliente as never, evento("o1"));
    expect((ctx.lead as Linha).id).toBe("N-recente");
    expect((ctx.contact as Linha).id).toBe("C-principal");
    expect(ctx.empresa).toMatchObject({ id: "E1", nome: "Padaria Trigo Dourado" });
    expect(ctx.obrigacao).toMatchObject({ id: "o1", nome: "Alvará de funcionamento", nome_curto: "Alvará", situacao: "vencendo", dias: "12" });
  });

  it("item do NEGÓCIO: o próprio negócio, mesmo que haja outro mais recente", async () => {
    const { cliente } = cenario([obrigacao({ id: "o2", lead_id: "N-antigo" })]);
    const ctx = await contextoDaObrigacao(cliente as never, evento("o2"));
    expect((ctx.lead as Linha).id).toBe("N-antigo");
    expect((ctx.contact as Linha).id).toBe("C-socio");
  });

  it("item do CONTATO sem negócio aberto: o contato vem, o negócio fica ausente", async () => {
    const { cliente } = cenario([obrigacao({ id: "o3", contact_id: "C-solto" })]);
    const ctx = await contextoDaObrigacao(cliente as never, evento("o3"));
    expect(ctx.lead).toBeUndefined();
    expect((ctx.contact as Linha).id).toBe("C-solto");
  });

  // O banco em memória só honra a ÚLTIMA ordenação (a data de criação); a
  // preferência pela marca de principal é do PostgREST, que combina as duas.
  it("empresa sem negócio aberto: o contato é uma pessoa da empresa (a principal)", async () => {
    const { cliente } = cenario([obrigacao({ id: "o4", empresa_id: "E1" })], false);
    const ctx = await contextoDaObrigacao(cliente as never, evento("o4"));
    expect(ctx.lead).toBeUndefined();
    expect((ctx.contact as Linha).id).toBe("C-principal");
  });

  it("item de outra organização não entra no contexto de ninguém", async () => {
    const { cliente } = cenario([obrigacao({ id: "o5", organization_id: OUTRA_ORG, empresa_id: "E1" })]);
    expect(await contextoDaObrigacao(cliente as never, evento("o5"))).toEqual({});
  });

  it("⭐ os textos das ações enxergam as marcações da obrigação", async () => {
    const { cliente } = cenario([obrigacao({ id: "o1", empresa_id: "E1" })]);
    const ctx = await contextoDaObrigacao(cliente as never, evento("o1"));
    expect(
      renderTemplate("Olá, {{primeiro_nome}}! O documento {{obrigacao.nome}} vence em {{obrigacao.dias}} dias ({{obrigacao.data}}). Situação: {{obrigacao.situacao}}.", ctx),
    ).toBe(`Olá, Helena! O documento Alvará de funcionamento vence em 12 dias (${diaPorExtenso(somarDias(HOJE, 12))}). Situação: vencendo.`);
    // Toda marcação anunciada na tela de automações resolve para algum texto.
    for (const { marcacao } of MARCACOES_DA_OBRIGACAO) {
      expect(renderTemplate(marcacao, ctx), marcacao).not.toBe("");
    }
  });

  it("atividade recorrente: a data é a próxima; documento pedido: os dias são os do pedido", async () => {
    const { cliente } = cenario([
      obrigacao({ id: "a1", nome: "Relatório mensal", nome_curto: null, categoria: "atividade", lead_id: "N-antigo", recebido_em: null, valido_ate: null, proxima_em: somarDias(HOJE, 4), feita_em: somarDias(HOJE, -26), avisos_dias: [5, 2] }),
      obrigacao({ id: "p1", nome: "Contrato social", lead_id: "N-antigo", recebido_em: null, valido_ate: null, pedido_em: somarDias(HOJE, -6) }),
    ]);
    const atividade = await contextoDaObrigacao(cliente as never, evento("a1"));
    expect(atividade.obrigacao).toMatchObject({ situacao: "pendente", dias: "4", data: diaPorExtenso(somarDias(HOJE, 4)), nome_curto: "Relatório mensal" });
    const pedido = await contextoDaObrigacao(cliente as never, evento("p1"));
    expect(pedido.obrigacao).toMatchObject({ situacao: "pedido", dias: "6", data: "" });
  });
});
