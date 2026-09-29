/**
 * FORK MIA — o lead da Meta traduzido para o CRM, sem rede nem banco
 * (`lib/leads-da-meta/mapear.ts`). O que pode errar calado: a janela de leitura
 * (perder lead na borda ou pedir além dos 90 dias), o nome em duas partes, e a
 * origem do anúncio indo para o campo errado.
 */
import { describe, expect, it } from "vitest";

import {
  JANELA_MAXIMA_MS,
  SOBREPOSICAO_MS,
  atribuicaoDoLead,
  chaveDoLead,
  comRotulos,
  dataDaMeta,
  emailAceito,
  externalIdDoLead,
  janelaDeLeitura,
  lerLeadCru,
  payloadParaMapear,
} from "@/lib/leads-da-meta/mapear";

const AGORA = new Date("2026-09-29T15:00:00.000Z");
const DIA = 24 * 60 * 60 * 1000;

describe("a data da Meta", () => {
  it("aceita o fuso sem dois-pontos que a Graph manda", () => {
    expect(dataDaMeta("2026-09-29T12:34:56+0000")?.toISOString()).toBe("2026-09-29T12:34:56.000Z");
    expect(dataDaMeta("2026-09-29T09:34:56-0300")?.toISOString()).toBe("2026-09-29T12:34:56.000Z");
  });
  it("lixo e ausência viram nulo, nunca Invalid Date", () => {
    expect(dataDaMeta("ontem")).toBeNull();
    expect(dataDaMeta(undefined)).toBeNull();
  });
});

describe("a janela de leitura", () => {
  it("primeira leitura volta os dias de recuperação, mais a sobreposição", () => {
    const j = janelaDeLeitura({ lidoAte: null, diasDeRecuperacao: 3, agora: AGORA });
    expect(j.de.getTime()).toBe(AGORA.getTime() - 3 * DIA - SOBREPOSICAO_MS);
    expect(j.ate.getTime()).toBe(AGORA.getTime());
    expect(j.alcancaOPresente).toBe(true);
  });

  it("depois da primeira, lê da marca menos 15 minutos até agora", () => {
    const marca = new Date(AGORA.getTime() - 5 * 60_000);
    const j = janelaDeLeitura({ lidoAte: marca, diasDeRecuperacao: 7, agora: AGORA });
    expect(j.de.getTime()).toBe(marca.getTime() - SOBREPOSICAO_MS);
    expect(j.ate.getTime()).toBe(AGORA.getTime());
  });

  it("nunca pede mais que 7 dias de uma vez: a recuperação anda em passos", () => {
    const j = janelaDeLeitura({ lidoAte: null, diasDeRecuperacao: 30, agora: AGORA });
    expect(j.ate.getTime() - j.de.getTime()).toBe(JANELA_MAXIMA_MS);
    expect(j.alcancaOPresente).toBe(false);
  });

  it("nunca antes dos 90 dias da Meta, e diz que cortou", () => {
    const marcaVelha = new Date(AGORA.getTime() - 200 * DIA);
    const j = janelaDeLeitura({ lidoAte: marcaVelha, diasDeRecuperacao: 7, agora: AGORA });
    expect(j.de.getTime()).toBe(AGORA.getTime() - 90 * DIA);
    expect(j.recuperacaoCortada).toBe(true);
  });

  it("zero dias = só o que chegar daqui para a frente (com a sobreposição)", () => {
    const j = janelaDeLeitura({ lidoAte: null, diasDeRecuperacao: 0, agora: AGORA });
    expect(j.de.getTime()).toBe(AGORA.getTime() - SOBREPOSICAO_MS);
    expect(j.recuperacaoCortada).toBe(false);
  });

  it("uma marca no futuro (relógio adiantado) não produz janela invertida", () => {
    const futuro = new Date(AGORA.getTime() + DIA);
    const j = janelaDeLeitura({ lidoAte: futuro, diasDeRecuperacao: 7, agora: AGORA });
    expect(j.de.getTime()).toBeLessThanOrEqual(j.ate.getTime());
  });
});

describe("o lead como chega", () => {
  it("junta múltipla escolha e descarta pergunta sem resposta", () => {
    const lead = lerLeadCru({
      id: "123",
      created_time: "2026-09-29T12:00:00+0000",
      field_data: [
        { name: "interesses", values: ["clareamento", "implante"] },
        { name: "vazio", values: [] },
        { name: "full_name", values: ["Ana Souza"] },
      ],
    });
    expect(lead?.campos).toEqual([
      { chave: "interesses", valor: "clareamento, implante" },
      { chave: "full_name", valor: "Ana Souza" },
    ]);
  });

  it("sem id não há como deduplicar: descartado", () => {
    expect(lerLeadCru({ field_data: [] })).toBeNull();
  });

  it("nome em duas partes vira full_name; e-mail do trabalho só na falta do pessoal", () => {
    const lead = lerLeadCru({
      id: "1",
      field_data: [
        { name: "first_name", values: ["Ana"] },
        { name: "last_name", values: ["Souza"] },
        { name: "work_email", values: ["ana@empresa.com"] },
      ],
    })!;
    expect(payloadParaMapear(lead)).toEqual({ full_name: "Ana Souza", email: "ana@empresa.com" });
  });

  it("os campos guardados levam a pergunta como a pessoa leu", () => {
    expect(
      comRotulos(
        { "qual_seu_interesse?": "implante", city: "BH" },
        { "qual_seu_interesse?": "Qual seu interesse?" },
      ),
    ).toEqual({ "Qual seu interesse?": "implante", Cidade: "BH" });
  });
});

describe("a origem do anúncio", () => {
  const lead = lerLeadCru({
    id: "987654321",
    created_time: "2026-09-29T12:00:00+0000",
    ad_id: "a1",
    ad_name: "Anúncio 1",
    adset_id: "s1",
    adset_name: "Conjunto 1",
    campaign_id: "c1",
    campaign_name: "Campanha 1",
    is_organic: false,
    platform: "ig",
  })!;

  it("carrega anúncio, conjunto, campanha, formulário e Página", () => {
    const meta = atribuicaoDoLead(lead, {
      formId: "f1",
      formName: "Form",
      pageId: "p1",
      pageName: "Página",
    });
    expect(meta).toMatchObject({
      ad_platform: "meta_ads",
      ad_id: "a1",
      ad_name: "Anúncio 1",
      adset_id: "s1",
      adset_name: "Conjunto 1",
      campaign_id: "c1",
      campaign_name: "Campanha 1",
      meta_form_id: "f1",
      meta_page_id: "p1",
      meta_lead_id: "987654321",
      meta_lead_plataforma: "ig",
    });
  });

  it("NÃO preenche ad_source_id — ele sai para a Meta como clique do WhatsApp", () => {
    const meta = atribuicaoDoLead(lead, {
      formId: "f1",
      formName: null,
      pageId: "p1",
      pageName: null,
    });
    expect(meta).not.toHaveProperty("ad_source_id");
  });
});

describe("a chave do lead", () => {
  it("é estável e não contém o id cru", () => {
    expect(chaveDoLead("987654321")).toBe(chaveDoLead("987654321"));
    expect(chaveDoLead("987654321")).not.toContain("987654321");
    expect(externalIdDoLead("987654321")).toMatch(/^meta-lead:[0-9a-f]{40}$/);
    expect(externalIdDoLead("987654321")).not.toContain("987654321");
  });
});

describe("o e-mail que o banco aceitaria", () => {
  it("segue a regra do CHECK de contacts", () => {
    expect(emailAceito("ana@x.com")).toBe("ana@x.com");
    expect(emailAceito("ana arroba x")).toBeNull();
    expect(emailAceito(null)).toBeNull();
  });
});
