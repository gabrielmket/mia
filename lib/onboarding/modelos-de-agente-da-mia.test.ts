/**
 * FORK MIA (.91) — os modelos de agente por segmento: cada um aponta para peças
 * que existem (o quadro pronto, o modelo de follow-up, a etapa do gatilho, a
 * demonstração), o texto do agente é um só para a demonstração e para quem
 * entra sozinho, e nenhum fato inventado vai para o cliente novo.
 */
import { describe, expect, it } from "vitest";

import { sementeDoSegmento } from "@/lib/demonstracao/semente/segmentos";
import { modeloPorId } from "@/lib/followup/modelos";
import { PROMPT_TEMPLATES } from "@/lib/schemas/onboarding";

import {
  FRASE_DO_JEITO,
  MODELOS_DE_AGENTE,
  SEGMENTOS_DO_ONBOARDING,
  ehSegmentoDoOnboarding,
  nomeDoAgenteDoModelo,
  pacoteDoSegmento,
  personaDoNome,
  promptDoModelo,
  segmentoDoEstado,
  sugerirSegmento,
} from "./modelos-de-agente-da-mia";
import { PACOTES } from "./pacotes-de-funil";

describe("cada modelo aponta para peças que existem", () => {
  it.each(SEGMENTOS_DO_ONBOARDING)("%s", (segmento) => {
    const m = MODELOS_DE_AGENTE[segmento];
    expect(m.segmento).toBe(segmento);
    // o quadro pronto
    const pacote = PACOTES.find((p) => p.id === m.pacote);
    expect(pacote, `o quadro ${m.pacote}`).toBeDefined();
    expect(pacoteDoSegmento(segmento).id).toBe(m.pacote);
    // o follow-up e, quando o gatilho é por etapa, a etapa do quadro com aquele passo
    const fu = modeloPorId(m.followup.modelo);
    expect(fu, `o follow-up ${m.followup.modelo}`).toBeDefined();
    expect(fu!.pedeEtapa).toBe(m.followup.passo !== null);
    if (m.followup.passo) {
      expect(pacote!.proposta.etapas.some((e) => e.passo === m.followup.passo)).toBe(true);
    }
    // o jeito é um dos três do upstream
    expect(PROMPT_TEMPLATES).toContain(m.jeito);
    // a demonstração do segmento usa o mesmo agente de exemplo
    if (m.demonstracao) {
      const semente = sementeDoSegmento(m.demonstracao);
      expect(semente.agente.nome.startsWith(m.persona)).toBe(true);
      for (const frase of [...m.faz, ...m.naoFaz]) expect(semente.agente.prompt).toContain(frase);
    }
  });
});

describe("o texto do agente", () => {
  it("é um só: quem entra sozinho recebe as mesmas frases da demonstração, sem os fatos dela", () => {
    const daDemonstracao = sementeDoSegmento("industria").agente.prompt;
    const doCliente = promptDoModelo("industria", { persona: "Bento", negocio: "Elétrica Sol" });
    for (const frase of MODELOS_DE_AGENTE.industria.faz) {
      expect(daDemonstracao).toContain(frase);
      expect(doCliente).toContain(frase);
    }
    // os fatos da empresa fictícia ficam só na demonstração
    expect(daDemonstracao).toMatch(/tabela revenda/);
    expect(doCliente).not.toMatch(/12%|1\.500|Indústria Modelo/);
  });

  it("diz quem ele é, onde trabalha e como fala, no tamanho que o agente aceita", () => {
    for (const segmento of SEGMENTOS_DO_ONBOARDING) {
      const texto = promptDoModelo(segmento, {
        persona: "Bia",
        negocio: "Casa Exemplo",
        oQueFaz: "atendimento de bairro",
        jeito: "support_minimal",
      });
      expect(texto).toContain("Seu nome é Bia.");
      expect(texto).toContain("Casa Exemplo (atendimento de bairro)");
      expect(texto).toContain(FRASE_DO_JEITO.support_minimal);
      expect(texto.length).toBeGreaterThan(200);
      expect(texto.length).toBeLessThan(20_000);
    }
  });

  it("sem travessão e sem emoji em nenhum texto que o cliente lê", () => {
    for (const m of Object.values(MODELOS_DE_AGENTE)) {
      const tudo = [m.rotulo, m.curto, m.persona, m.papel, m.cuidaDe, ...m.faz, ...m.naoFaz, ...m.regrasDeExemplo].join(" ");
      expect(tudo).not.toMatch(/[—–]/);
      expect(tudo).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    for (const frase of Object.values(FRASE_DO_JEITO)) expect(frase).not.toMatch(/[—–]/);
  });
});

describe("a leitura do segmento (\"A MIA leu como\")", () => {
  it.each([
    ["Clínica odontológica: avaliação, limpeza e implante.", "clinica"],
    ["consultório de psicologia", "clinica"],
    ["Academia de bairro com musculação e aulas coletivas.", "academia"],
    ["estúdio de pilates", "academia"],
    ["Imobiliária de bairro: venda e aluguel de apartamentos.", "imobiliaria"],
    ["Distribuidora de material elétrico para revendas", "industria"],
    ["fábrica de móveis", "industria"],
    ["Prestação de serviços para pequenas empresas.", "outro"],
    ["", "outro"],
  ] as const)("%s → %s", (texto, esperado) => {
    expect(sugerirSegmento(texto)).toBe(esperado);
  });
});

describe("os nomes", () => {
  it("a equipe vê persona e cargo; o cliente, só a persona", () => {
    expect(nomeDoAgenteDoModelo("clinica")).toBe("Clara · Recepção");
    expect(personaDoNome("Clara · Recepção", "clinica")).toBe("Clara");
    expect(personaDoNome("Bia", "clinica")).toBe("Bia");
    expect(personaDoNome("  ", "academia")).toBe("Duda");
  });

  it("o segmento gravado no estado do passo a passo", () => {
    expect(segmentoDoEstado({ welcome: { segmento: "academia" } })).toBe("academia");
    expect(segmentoDoEstado({ welcome: { segmento: "loja" } })).toBeNull();
    expect(segmentoDoEstado({ welcome: {} })).toBeNull();
    expect(segmentoDoEstado(null)).toBeNull();
    expect(ehSegmentoDoOnboarding("outro")).toBe(true);
  });
});
