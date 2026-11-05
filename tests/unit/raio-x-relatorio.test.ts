/**
 * FORK MIA (.101) · O RELATÓRIO MONTADO A PARTIR DE DADOS FICTÍCIOS FIXOS
 * (lib/raio-x/relatorio.ts, com as conversas de tests/fixtures/raio-x/).
 *
 * O que se prova: os números do relógio e do modelo chegam ao relatório; "sem
 * resposta" é do relógio mesmo quando o modelo diz outra coisa; o relatório não
 * guarda telefone nem nome; o link do dono não leva o bloco da MIA; o teto
 * marca o relatório como parcial.
 */
import { describe, expect, it } from "vitest";

import { dadosParaODono, montarRelatorio } from "@/lib/raio-x/relatorio";
import { CRITERIOS_VERSAO } from "@/lib/raio-x/segmentos";

import { FIM_DA_GARAGEM, INICIO_DA_GARAGEM, conversasDaGaragemModelo } from "../fixtures/raio-x/garagem-modelo";

const dados = montarRelatorio({
  empresa: "Garagem Modelo Veículos",
  segmento: "revenda_de_veiculos",
  tipo: "unico",
  periodo: { inicio: INICIO_DA_GARAGEM, fim: FIM_DA_GARAGEM },
  conversas: conversasDaGaragemModelo(),
});

describe("os números", () => {
  it("conta só as conversas em que o cliente escreveu (a campanha da loja fica fora)", () => {
    expect(dados.numeros.conversas).toBe(11);
    expect(dados.numeros.audios).toBe(1);
  });

  it("o relógio: uma sem resposta, uma em aberto (menos de 24 h), e o sumiço sem retorno", () => {
    expect(dados.tempo.semResposta).toBe(2);
    expect(dados.tempo.emAberto).toBe(1);
    expect(dados.mia.semResposta).toBe(2);
    expect(dados.tempo.sumicosSemRetorno).toBeGreaterThanOrEqual(1);
  });

  it("a origem: o clique no anúncio vale mais que a leitura do modelo", () => {
    const anuncio = dados.origem.find((o) => o.chave === "anuncio_meta");
    expect(anuncio?.conversas).toBe(3);
    expect(dados.anuncio).toMatchObject({ conversas: 3, semResposta: 1 });
  });

  it("os desfechos têm o rótulo do segmento e o tom", () => {
    const agendou = dados.desfechos.find((d) => d.chave === "agendou");
    expect(agendou).toMatchObject({ rotulo: "Agendou visita", conversas: 2, tom: "ok" });
    expect(dados.desfechos.find((d) => d.chave === "sem_resposta")?.tom).toBe("danger");
  });

  it("a nota: rapidez do relógio, as outras do modelo, e a versão dos critérios", () => {
    expect(dados.criteriosVersao).toBe(CRITERIOS_VERSAO);
    expect(dados.notas.analisadas).toBe(9);
    expect(dados.notas.porCriterio.rapidez).not.toBeNull();
    expect(dados.notas.media).toBeGreaterThan(0);
    expect(dados.notas.media).toBeLessThanOrEqual(10);
  });

  it("os indicadores da comparação estão em proporção", () => {
    expect(dados.indicadores.proporcaoPediuValorSemReceber).toBeCloseTo(2 / 9, 5);
    expect(dados.indicadores.proporcaoAgendou).toBeCloseTo(2 / 9, 5);
  });

  it("o teto: conversa fora do teto deixa o relatório parcial e é contada", () => {
    expect(dados.analise).toEqual({ analisadas: 9, foraDoTeto: 1, parcial: true });
  });
});

describe("os exemplos e a privacidade", () => {
  it("até 5 boas e 5 ruins, por número de ordem", () => {
    expect(dados.exemplos.bons.length).toBeGreaterThan(0);
    expect(dados.exemplos.bons.length).toBeLessThanOrEqual(5);
    expect(dados.exemplos.ruins.length).toBeGreaterThan(0);
    expect(dados.exemplos.ruins.length).toBeLessThanOrEqual(5);
    expect(dados.exemplos.ruins.map((e) => e.ordem)).toContain("0187");
  });

  it("o relatório guardado não tem telefone nem o nome do cliente", () => {
    const texto = JSON.stringify(dados);
    expect(texto).not.toMatch(/90000-?1101|31900001101|\+55/);
    expect(texto).not.toMatch(/Ricardo/);
    const ex = dados.exemplos.ruins.find((e) => e.ordem === "0187")!;
    expect(ex.baloes[0]!.texto).toContain("[nome]");
    expect(ex.baloes.some((b) => b.texto.includes("[telefone]"))).toBe(true);
  });

  it("o link do dono não leva o bloco da MIA", () => {
    const dono = dadosParaODono(dados);
    expect("mia" in dono).toBe(false);
    expect(dono.semRespostaOuRetorno).toBe(dados.semRespostaOuRetorno);
  });
});

describe("as recomendações", () => {
  it("saem em código + valores, em ordem de peso", () => {
    expect(dados.recomendacoes.length).toBeGreaterThan(0);
    const pesos = dados.recomendacoes.map((r) => r.peso);
    expect([...pesos].sort((a, b) => b - a)).toEqual(pesos);
    for (const r of dados.recomendacoes) expect(typeof r.codigo).toBe("string");
  });
});
