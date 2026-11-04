/**
 * FORK MIA (.101) · O RELATÓRIO DO RAIO-X NA TELA, a partir dos dados fictícios
 * fixos (tests/fixtures/raio-x/): o da Time tem o bloco "o que a MIA resolveria"
 * e o custo; o do dono não tem nenhum dos dois (decisão 9). Nos dois, o cliente
 * é o número de ordem, sem telefone nem nome. E o espanhol chega à tela.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RelatorioDaTime, RelatorioDoDono } from "@/components/raio-x/RelatorioDoRaioX";
import { traduzir } from "@/lib/i18n/dicionario";
import { compararComOAnterior } from "@/lib/raio-x/comparacao";
import { dadosParaODono, montarRelatorio } from "@/lib/raio-x/relatorio";

import { FIM_DA_GARAGEM, INICIO_DA_GARAGEM, conversasDaGaragemModelo } from "../fixtures/raio-x/garagem-modelo";

const dados = montarRelatorio({
  empresa: "Garagem Modelo Veículos",
  segmento: "revenda_de_veiculos",
  tipo: "unico",
  periodo: { inicio: INICIO_DA_GARAGEM, fim: FIM_DA_GARAGEM },
  conversas: conversasDaGaragemModelo(),
});
const comparacao = compararComOAnterior(
  { id: "b", criadoEm: "2026-11-04T12:00:00Z", criteriosVersao: dados.criteriosVersao, conversas: dados.numeros.conversas, indicadores: dados.indicadores },
  {
    id: "a",
    criadoEm: "2026-08-05T12:00:00Z",
    criteriosVersao: dados.criteriosVersao,
    conversas: 9,
    indicadores: { ...dados.indicadores, proporcaoSemResposta: 0.4, notaMedia: 4.1 },
  },
);
const pt = (s: string) => s;
const es = (s: string) => traduzir(s, "es");

describe("o relatório da Time", () => {
  const html = renderToStaticMarkup(<RelatorioDaTime dados={dados} comparacao={comparacao} custoCentavos={2140} t={pt} tag="pt-BR" />);

  it("mostra os números, o mapa, os exemplos por número de ordem e a evolução", () => {
    expect(html).toContain("Velocidade da primeira resposta");
    expect(html).toContain("Cliente 0187");
    expect(html).toContain("[nome]");
    expect(html).toContain('data-raio-x-evolucao="proporcaoSemResposta"');
    expect(html).toContain("melhorou");
  });

  it("tem o bloco da MIA e o custo (só para a Time)", () => {
    expect(html).toContain("Para a conversa comercial da Time");
    expect(html).toMatch(/R\$\s?21,40/);
    expect(html).toContain('data-raio-x="parcial"');
  });

  it("não tem telefone nem o nome do cliente", () => {
    expect(html).not.toMatch(/90000-?1101|31900001101/);
    expect(html).not.toContain("Ricardo");
  });
});

describe("o relatório do dono", () => {
  const html = renderToStaticMarkup(<RelatorioDoDono dados={dadosParaODono(dados)} comparacao={comparacao} t={pt} tag="pt-BR" />);

  it("tem a manchete, os pontos, a evolução e a origem", () => {
    expect(html).toContain("Garagem Modelo Veículos: 11 clientes chamaram no WhatsApp.");
    expect(html).toContain("De onde vêm os seus clientes");
    expect(html).toContain('data-raio-x-bloco="evolucao"');
  });

  it("NÃO tem o bloco da MIA, o custo nem os trechos de conversa", () => {
    expect(html).not.toContain("Para a conversa comercial da Time");
    expect(html).not.toContain("o que a MIA");
    expect(html).not.toMatch(/R\$\s?21,40|Custo da análise/);
    expect(html).not.toContain("data-raio-x-exemplo");
  });

  it("em espanhol, a tela sai em espanhol", () => {
    const emEspanhol = renderToStaticMarkup(<RelatorioDoDono dados={dadosParaODono(dados)} comparacao={comparacao} t={es} tag="es" />);
    expect(emEspanhol).toContain("De dónde vienen sus clientes");
    expect(emEspanhol).toContain("clientes escribieron por WhatsApp");
  });
});
