/**
 * FORK MIA (item 8) — os cartões dos painéis desenham o que o motor somou.
 *
 * A mesma grade serve a tela de dentro e a página pública do dono. O que se
 * prova: cada cartão aparece com o título (o da agenda, na palavra do segmento),
 * os números saem formatados, o "sem valores" do link não mostra dinheiro, o
 * cartão recusado diz por quê, e o "Sem …" vazio não vira barra.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { GradeDePaineis, tempoDeEspera } from "@/components/paineis/CartoesDosPaineis";
import type { PaineisCalculados } from "@/lib/paineis/calcular";

afterEach(cleanup);

const t = (texto: string) => texto;
const f = { t, tag: "pt-BR", moeda: "BRL" };

function calculados(valores: boolean): PaineisCalculados {
  return {
    organizationId: "33333333-3333-4333-8333-333333333333",
    empresa: { nome: "Clínica Exemplo", demonstracao: false, fuso: "America/Sao_Paulo", moeda: "BRL" },
    periodo: "30",
    janela: { de: "2026-09-16", ate: "2026-10-15", hoje: "2026-10-15" },
    funil: { id: "f", nome: "Pacientes", vocabulario: { won: "Tratamento fechado", compromisso_plural: "Avaliações" } },
    funis: [{ id: "f", nome: "Pacientes" }],
    valores,
    calculadoEm: "2026-10-15T15:00:00.000Z",
    paineis: [
      {
        chave: "resultado",
        titulo: "Resultado do mês",
        tituloEDado: false,
        pergunta: "Quanto ganhei, quanto perdi e em quanto tempo fecho?",
        restrito: null,
        erro: null,
        dados: { tipo: "resultado", ganhos: 4, perdidos: 3, abertos: 3, taxaDeGanho: 57.1, valorGanho: valores ? 800000 : null, diasAteFechar: 12.5, foraDaMoeda: 0 },
      },
      {
        chave: "agenda",
        titulo: "Avaliações",
        tituloEDado: true,
        pergunta: "Marcou, confirmou, veio ou faltou?",
        restrito: null,
        erro: null,
        dados: { tipo: "agenda", marcadas: 4, confirmadas: 3, realizadas: 1, faltas: 1, desmarcadas: 1, taxaDeFaltas: 50 },
      },
      {
        chave: "origem",
        titulo: "De onde vêm",
        tituloEDado: false,
        pergunta: "Qual canal traz quem fecha?",
        restrito: null,
        erro: null,
        dados: {
          tipo: "origem",
          linhas: [
            { chave: "meta_ads", rotulo: "Anúncio da Meta", traduzir: true, n: 5, fecharam: 2 },
            { chave: "__sem", rotulo: "Sem origem", traduzir: true, n: 0, fecharam: 0 },
          ],
        },
      },
      {
        chave: "anuncios",
        titulo: "Anúncios",
        tituloEDado: false,
        pergunta: "O que foi informado à Meta e ao Google?",
        restrito: "so_gestor",
        erro: null,
        dados: null,
      },
      {
        chave: "resposta",
        titulo: "Tempo de resposta",
        tituloEDado: false,
        pergunta: "Quanto o cliente espera?",
        restrito: null,
        erro: null,
        dados: { tipo: "resposta", agente: 12, equipeMetade: 420, equipeNoveEmDez: 2280, conversas: 3 },
      },
    ],
  };
}

describe("a grade dos painéis", () => {
  it("⭐ títulos, números e a palavra do segmento", () => {
    render(<GradeDePaineis calculados={calculados(true)} f={f} />);
    expect(screen.getByText("Resultado do mês")).toBeTruthy();
    expect(screen.getByText("Avaliações")).toBeTruthy();
    expect(screen.getAllByText("Tratamento fechado").length).toBeGreaterThan(0);
    expect(screen.getByText("57%")).toBeTruthy();
    expect(document.body.textContent).toMatch(/R\$\s?8\.000/);
    expect(screen.getByText("Anúncio da Meta")).toBeTruthy();
    // O "Sem origem" vazio não vira barra no cartão (no motor ele está lá).
    expect(screen.queryByText("Sem origem")).toBeNull();
    expect(screen.getByText("Só gestor e administrador veem o que foi informado aos anúncios.")).toBeTruthy();
    expect(screen.getByText("7 min")).toBeTruthy();
  });

  it("⭐ sem valores (o link 'só quantidades'): nenhum R$ na página", () => {
    render(<GradeDePaineis calculados={calculados(false)} f={f} />);
    expect(document.body.textContent).not.toMatch(/R\$/);
    // O destaque do resultado vira a contagem de ganhos.
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
  });

  it("o tempo de espera em palavras curtas", () => {
    expect(tempoDeEspera(12, t)).toBe("12 s");
    expect(tempoDeEspera(420, t)).toBe("7 min");
    expect(tempoDeEspera(2 * 3600 + 20 * 60, t)).toBe("2 h 20 min");
    expect(tempoDeEspera(3 * 86400, t)).toBe("3 dias");
    expect(tempoDeEspera(null, t)).toBe("—");
  });
});
