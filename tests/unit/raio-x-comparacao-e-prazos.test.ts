/**
 * FORK MIA (.101) · A EVOLUÇÃO ENTRE UM RAIO-X E O ANTERIOR (decisão 13), OS
 * PRAZOS (48 h, 7 e 30 dias, o mensal no dia 1) e O TETO DE CUSTO.
 * lib/raio-x/comparacao.ts, prazos.ts e custo.ts. Dado fictício.
 */
import { describe, expect, it } from "vitest";

import { compararComOAnterior, direcaoDoIndicador, mesmaEmpresa, type Indicadores } from "@/lib/raio-x/comparacao";
import { cabeNoTeto, custoDoAudioUsdCentavos, estimativaDaChamadaUsdCentavos, segundosDoAudio } from "@/lib/raio-x/custo";
import {
  linkDeConexaoVivo,
  prazosDoEncerramento,
  prazosDoRelatorio,
  relatorioMensalDevido,
  validadeDoLinkDeConexao,
  venceu,
} from "@/lib/raio-x/prazos";
import { normalizarWhatsapp, validarNovoRaioX } from "@/lib/raio-x/regras";

const sp = (iso: string) => new Date(`${iso}-03:00`);
const DIA = 86_400_000;

const BASE: Indicadores = {
  medianaPrimeiraRespostaMin: 65,
  medianaComALojaFechadaMin: 250,
  proporcaoSemResposta: 0.21,
  proporcaoSumiuSemRetorno: 0.35,
  proporcaoPediuValorSemReceber: 0.07,
  proporcaoAgendou: 0.12,
  notaMedia: 5.4,
};

describe("a comparação com o anterior", () => {
  const anterior = { id: "a", criadoEm: "2026-08-05T12:00:00Z", criteriosVersao: "2026-11-v1", conversas: 356, indicadores: BASE };
  const atual = {
    id: "b",
    criadoEm: "2026-11-04T12:00:00Z",
    criteriosVersao: "2026-11-v1",
    conversas: 412,
    indicadores: {
      ...BASE,
      medianaPrimeiraRespostaMin: 38,
      medianaComALojaFechadaMin: 200,
      proporcaoSemResposta: 0.15,
      proporcaoSumiuSemRetorno: 0.31,
      proporcaoPediuValorSemReceber: 0.09,
      proporcaoAgendou: 0.16,
      notaMedia: 6.2,
    },
  };

  it("em proporção: 6 melhoraram e 1 piorou (o valor pedido e não recebido)", () => {
    const c = compararComOAnterior(atual, anterior);
    expect([c.melhorou, c.piorou, c.comparaveis]).toEqual([6, 1, 7]);
    expect(c.linhas.find((l) => l.indicador === "proporcaoPediuValorSemReceber")!.direcao).toBe("pior");
    expect([c.conversasAntes, c.conversasAgora]).toEqual([356, 412]);
  });

  it("mais conversas com a MESMA proporção é igual, não pior", () => {
    expect(direcaoDoIndicador("proporcaoSemResposta", 0.15, 0.152)).toBe("igual");
  });

  it("menos de 2 minutos (ou 5%) de diferença no tempo é igual", () => {
    expect(direcaoDoIndicador("medianaPrimeiraRespostaMin", 38, 39)).toBe("igual");
    expect(direcaoDoIndicador("medianaPrimeiraRespostaMin", 38, 20)).toBe("melhor");
  });

  it("critérios diferentes: a nota sai com aviso e sem melhorou/piorou", () => {
    const c = compararComOAnterior({ ...atual, criteriosVersao: "2027-01-v2" }, anterior);
    const nota = c.linhas.find((l) => l.indicador === "notaMedia")!;
    expect(nota).toMatchObject({ direcao: null, aviso: "criterios_diferentes", anterior: 5.4, agora: 6.2 });
    expect(c.criteriosIguais).toBe(false);
    expect(c.comparaveis).toBe(6);
  });

  it("sem dado de um lado, sem direção", () => {
    expect(direcaoDoIndicador("notaMedia", null, 6)).toBeNull();
  });

  it("mesma empresa: mesmo WhatsApp normalizado, ou a mesma conta da MIA", () => {
    expect(mesmaEmpresa({ whatsapp: "5531900001101", organization_id: null }, { whatsapp: "5531900001101", organization_id: null })).toBe(true);
    expect(mesmaEmpresa({ whatsapp: "5531900001101", organization_id: "o" }, { whatsapp: "5531900002202", organization_id: "o" })).toBe(true);
    expect(mesmaEmpresa({ whatsapp: "5531900001101", organization_id: null }, { whatsapp: "5531900002202", organization_id: null })).toBe(false);
  });
});

describe("os prazos", () => {
  const agora = sp("2026-11-04T15:42:00");

  it("o link de conexão vale 48 horas", () => {
    const ate = validadeDoLinkDeConexao(agora);
    expect(ate.getTime() - agora.getTime()).toBe(48 * 3_600_000);
    expect(linkDeConexaoVivo(ate, new Date(ate.getTime() - 1))).toBe(true);
    expect(linkDeConexaoVivo(ate, ate)).toBe(false);
    expect(linkDeConexaoVivo(null, agora)).toBe(false);
  });

  it("diagnóstico único: desconecta em 7 dias e apaga as conversas em 30", () => {
    const p = prazosDoRelatorio("unico", agora);
    expect(p.desconectarEm!.getTime() - agora.getTime()).toBe(7 * DIA);
    expect(p.apagarConversasEm.getTime() - agora.getTime()).toBe(30 * DIA);
  });

  it("mensal: fica conectado; as conversas apagam em 30 dias do mesmo jeito", () => {
    const p = prazosDoRelatorio("mensal", agora);
    expect(p.desconectarEm).toBeNull();
    expect(p.apagarConversasEm.getTime() - agora.getTime()).toBe(30 * DIA);
  });

  it("encerrar antes da hora: apaga em 30 dias a partir de agora", () => {
    expect(prazosDoEncerramento(agora).apagarConversasEm.getTime() - agora.getTime()).toBe(30 * DIA);
  });

  it("venceu: no instante exato já venceu", () => {
    expect(venceu(agora, agora)).toBe(true);
    expect(venceu(new Date(agora.getTime() + 1), agora)).toBe(false);
    expect(venceu(null, agora)).toBe(false);
  });

  it("o relatório mensal é devido no dia 1, sobre o mês anterior, uma vez só", () => {
    const dia1 = sp("2026-12-01T00:10:00");
    const devido = relatorioMensalDevido(sp("2026-11-04T16:00:00"), dia1);
    expect(devido?.competencia).toBe("2026-11-01");
    expect(devido?.inicio.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(devido?.fim.toISOString()).toBe("2026-12-01T03:00:00.000Z");
    // Já gerado neste mês: não é devido de novo.
    expect(relatorioMensalDevido(sp("2026-12-01T00:20:00"), sp("2026-12-01T05:00:00"))).toBeNull();
    // Ainda no mesmo mês do primeiro relatório: não é devido.
    expect(relatorioMensalDevido(sp("2026-11-04T16:00:00"), sp("2026-11-20T10:00:00"))).toBeNull();
    // Sem relatório nenhum, quem manda é a primeira leitura, não o dia 1.
    expect(relatorioMensalDevido(null, dia1)).toBeNull();
  });
});

describe("o teto de custo (padrão R$ 40)", () => {
  it("cabe enquanto o gasto mais a próxima chamada não passa do teto", () => {
    expect(cabeNoTeto(3900, 50, 4000).pode).toBe(true);
    expect(cabeNoTeto(3990, 50, 4000)).toEqual({ pode: false, sobra: 10 });
    expect(cabeNoTeto(4100, 1, 4000)).toEqual({ pode: false, sobra: 0 });
  });

  it("a estimativa da chamada sai da tabela de preço (o modelo sem preço é recusado)", () => {
    // gpt-6-luna: US$ 0,10 / 0,50 por milhão de tokens.
    expect(estimativaDaChamadaUsdCentavos("gpt-6-luna", 1_000_000, 0)).toBeCloseTo(10, 5);
    expect(estimativaDaChamadaUsdCentavos("gpt-6-luna", 0, 1_000_000)).toBeCloseTo(50, 5);
    expect(estimativaDaChamadaUsdCentavos("modelo-que-nao-existe", 1000, 1000)).toBeNull();
  });

  it("o áudio: US$ 0,006 por minuto, duração do aparelho ou estimada pelo tamanho", () => {
    expect(custoDoAudioUsdCentavos(60)).toBeCloseTo(0.6, 5);
    expect(segundosDoAudio(42, 0)).toBe(42);
    expect(segundosDoAudio(null, 60_000)).toBe(30);
  });
});

describe("o cadastro", () => {
  it("o WhatsApp do Brasil ganha o 55; o de fora vem com +", () => {
    expect(normalizarWhatsapp("(31) 90000-1101")).toBe("5531900001101");
    expect(normalizarWhatsapp("+55 31 900000002")).toBe("5531900000002");
    expect(normalizarWhatsapp("+1 415 555 0100")).toBe("14155550100");
    expect(normalizarWhatsapp("abc")).toBeNull();
    expect(normalizarWhatsapp("1234")).toBeNull();
  });

  it("valida, normaliza e diz os campos errados (nunca o valor)", () => {
    const ok = validarNovoRaioX({ empresa: "Garagem Modelo Veículos", segmento: "revenda_de_veiculos", whatsapp: "(31) 90000-1101" });
    expect(ok.ok && ok.valor).toMatchObject({ whatsapp: "5531900001101", periodo_dias: 90, tipo: "unico", teto_centavos: 4000, sabado_ate: "13:00" });
    const ruim = validarNovoRaioX({ empresa: "", segmento: "padaria", whatsapp: "(31) 90000-1101" });
    expect(ruim.ok ? [] : ruim.campos.sort()).toEqual(["empresa", "segmento"]);
    const horario = validarNovoRaioX({ empresa: "X", segmento: "outro", whatsapp: "(31) 90000-1101", abre: "18:00", fecha: "08:00" });
    expect(horario.ok ? [] : horario.campos).toEqual(["fecha"]);
  });
});
