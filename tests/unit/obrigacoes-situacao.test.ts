/**
 * FORK MIA — a situação de uma obrigação é CALCULADA pelas datas.
 *
 * A tabela abaixo é a do protótipo aprovado (01/10/2026): os 21 itens de
 * exemplo, com as datas de lá e o "hoje" de lá. O que o protótipo mostrava em
 * cada linha é o que estas funções têm de devolver: se a conta mudar, a tela, o
 * aviso da automação, a ferramenta do agente e o MCP mudam juntos, e este teste
 * é quem avisa.
 */
import { describe, expect, it } from "vitest";

import { somarDias } from "@/lib/obrigacoes/datas";
import { modelosDoSegmento, MODELOS_DE_TIPO } from "@/lib/obrigacoes/catalogo";
import {
  acoesDoItem,
  aguardando,
  avisoDoCartao,
  contarObrigacoes,
  emDia,
  maiorAviso,
  porUrgencia,
  semResposta,
  situacao,
  textoDaRecorrencia,
  textoDaSituacao,
  textoDoAviso,
  textoDosAvisos,
  tomDaSituacao,
  urgencia,
  venceEm,
  type Situacao,
  type TipoDeUrgencia,
} from "@/lib/obrigacoes/situacao";
import type { ItemParaSituacao } from "@/lib/obrigacoes/tipos";

const HOJE = "2026-10-01";
const t = (texto: string) => texto;

type Item = ItemParaSituacao & { id: string; nome: string; nome_curto: string | null };

/** "14/10/2025" → "2025-10-14": as datas ficam como estão escritas no protótipo. */
function dia(br: string | undefined): string | null {
  if (!br) return null;
  const [d, m, a] = br.split("/");
  return `${a}-${m}-${d}`;
}

function item(
  id: string,
  nome: string,
  datas: { recebidoEm?: string; validade?: string; pedidoEm?: string; prazo?: string; proxima?: string; feitaEm?: string } = {},
): Item {
  const modelo = MODELOS_DE_TIPO.find((m) => m.nome === nome);
  if (!modelo) throw new Error(`o protótipo não tem o tipo ${nome}`);
  return {
    id,
    nome,
    nome_curto: modelo.nome_curto,
    categoria: modelo.categoria,
    recorrencia: modelo.recorrencia,
    recorrencia_meses: modelo.recorrencia_meses,
    validade_meses: modelo.validade_meses,
    avisos_dias: modelo.avisos_dias,
    dias_sem_resposta: 5,
    pedido_em: dia(datas.pedidoEm),
    prazo_em: dia(datas.prazo),
    cobrado_em: null,
    recebido_em: dia(datas.recebidoEm),
    valido_ate: dia(datas.validade),
    renovado_em: null,
    proxima_em: dia(datas.proxima),
    feita_em: dia(datas.feitaEm),
  };
}

const ITENS: Item[] = [
  item("o1", "Alvará de funcionamento", { recebidoEm: "14/10/2025", validade: "13/10/2026", pedidoEm: "26/09/2026", prazo: "06/10/2026" }),
  item("o2", "Licença sanitária", { recebidoEm: "22/03/2026", validade: "20/03/2027" }),
  item("o3", "Certificado digital", { recebidoEm: "03/11/2025", validade: "02/11/2026" }),
  item("o4", "Relatório mensal", { proxima: "05/10/2026", feitaEm: "04/09/2026" }),
  item("o5", "Contrato social", { pedidoEm: "26/09/2026", prazo: "03/10/2026" }),
  item("o6", "Certificado digital", { recebidoEm: "19/10/2025", validade: "18/10/2026" }),
  item("o7", "Licença sanitária", { recebidoEm: "08/10/2025", validade: "06/10/2026" }),
  item("o8", "AVCB (vistoria dos bombeiros)", { recebidoEm: "16/08/2025", validade: "15/08/2028" }),
  item("o9", "Alvará de funcionamento", { recebidoEm: "02/11/2025", validade: "31/10/2026" }),
  item("o10", "Relatório mensal", { proxima: "08/10/2026", feitaEm: "08/09/2026" }),
  item("o11", "Reunião trimestral", { proxima: "12/11/2026", feitaEm: "12/08/2026" }),
  item("o12", "Alvará de funcionamento", { recebidoEm: "30/09/2025", validade: "28/09/2026", pedidoEm: "14/09/2026", prazo: "25/09/2026" }),
  item("o13", "Renovação anual do contrato", { proxima: "15/11/2026", feitaEm: "14/11/2025" }),
  item("o14", "AVCB (vistoria dos bombeiros)", { recebidoEm: "01/11/2023", validade: "30/10/2026" }),
  item("o15", "CNH", { recebidoEm: "10/03/2024", validade: "05/03/2029" }),
  item("o16", "Alvará de funcionamento", { pedidoEm: "22/09/2026", prazo: "29/09/2026" }),
  item("o17", "Contrato social", { recebidoEm: "23/09/2026" }),
  item("o18", "Licença sanitária"),
  item("o19", "Alvará de funcionamento", { recebidoEm: "24/06/2026", validade: "22/06/2027" }),
  item("o20", "AVCB (vistoria dos bombeiros)", { recebidoEm: "15/01/2025", validade: "14/01/2028" }),
  item("o21", "Relatório mensal", { proxima: "20/10/2026", feitaEm: "18/09/2026" }),
];

const o = (id: string) => ITENS.find((x) => x.id === id)!;

/** O que o protótipo mostra em cada linha, com o hoje em 01/10/2026. */
const ESPERADO: Array<[id: string, situacao: Situacao, urgencia: TipoDeUrgencia | null, texto: string]> = [
  ["o1", "vencendo", "vencendo", "vence em 12 dias · 13/10/2026 · renovação pedida há 5 dias"],
  ["o2", "valido", null, "válido até 20/03/2027"],
  ["o3", "valido", null, "válido até 02/11/2026"],
  ["o4", "pendente", "vencendo", "em 4 dias · 05/10/2026"],
  ["o5", "pedido", "sem_resposta", "pedido há 5 dias · prazo 03/10/2026"],
  ["o6", "vencendo", "vencendo", "vence em 17 dias · 18/10/2026"],
  ["o7", "vencendo", "vencendo", "vence em 5 dias · 06/10/2026"],
  ["o8", "valido", null, "válido até 15/08/2028"],
  ["o9", "vencendo", "vencendo", "vence em 30 dias · 31/10/2026"],
  ["o10", "feita", null, "feita em 08/09/2026 · próxima em 08/10/2026"],
  ["o11", "feita", null, "feita em 12/08/2026 · próxima em 12/11/2026"],
  ["o12", "vencido", "vencido", "venceu há 3 dias · 28/09/2026 · renovação pedida há 17 dias"],
  ["o13", "pendente", "vencendo", "em 45 dias · 15/11/2026"],
  ["o14", "vencendo", "vencendo", "vence em 29 dias · 30/10/2026"],
  ["o15", "valido", null, "válido até 05/03/2029"],
  ["o16", "pedido", "sem_resposta", "pedido há 9 dias · prazo 29/09/2026"],
  ["o17", "recebido", null, "recebido em 23/09/2026 · sem validade"],
  ["o18", "a_pedir", null, "ainda não foi pedido"],
  ["o19", "valido", null, "válido até 22/06/2027"],
  ["o20", "valido", null, "válido até 14/01/2028"],
  ["o21", "feita", null, "feita em 18/09/2026 · próxima em 20/10/2026"],
];

describe("a tabela de casos do protótipo aprovado (hoje = 01/10/2026)", () => {
  it("cobre os 21 itens de exemplo", () => {
    expect(ESPERADO.map((linha) => linha[0])).toEqual(ITENS.map((x) => x.id));
  });

  it.each(ESPERADO)("%s está %s", (id, esperada, urg, texto) => {
    expect(situacao(o(id), HOJE)).toBe(esperada);
    expect(urgencia(o(id), HOJE).tipo).toBe(urg);
    expect(textoDaSituacao(o(id), HOJE, t)).toBe(texto);
  });

  it("os quatro contadores do topo da lista", () => {
    expect(contarObrigacoes(ITENS, HOJE)).toEqual({
      vencidos: 1,
      vencendo_em_30_dias: 6,
      pedidos_sem_resposta: 4,
      em_dia: 10,
      total: 21,
    });
  });

  it("a lista vai do mais urgente para o menos: vencido, o que vence antes, pedido sem resposta, a pedir, em dia", () => {
    expect(porUrgencia(ITENS, HOJE).map((x) => x.id)).toEqual([
      "o12", "o4", "o7", "o1", "o6", "o14", "o9", "o13", "o16", "o5", "o18",
      "o10", "o21", "o3", "o11", "o2", "o19", "o20", "o8", "o15", "o17",
    ]);
  });

  it("vencendo em N dias conta o documento pela validade e a atividade só quando está pendente", () => {
    // o10 é atividade a 7 dias, mas o aviso dela é de 5: ainda "feita".
    expect(venceEm(o("o10"), 30, HOJE)).toBe(false);
    expect(venceEm(o("o4"), 7, HOJE)).toBe(true);
    // o3 vence em 32 dias: fora dos 30, dentro dos 60.
    expect(venceEm(o("o3"), 30, HOJE)).toBe(false);
    expect(venceEm(o("o3"), 60, HOJE)).toBe(true);
    // Vencido não é "vencendo".
    expect(venceEm(o("o12"), 60, HOJE)).toBe(false);
  });

  it("o tom do selo acompanha a situação", () => {
    expect(tomDaSituacao(o("o12"), HOJE)).toBe("perigo");
    expect(tomDaSituacao(o("o1"), HOJE)).toBe("alerta");
    expect(tomDaSituacao(o("o5"), HOJE)).toBe("info");
    expect(tomDaSituacao(o("o2"), HOJE)).toBe("ok");
    expect(tomDaSituacao(o("o18"), HOJE)).toBe("neutro");
    expect(tomDaSituacao(o("o4"), HOJE)).toBe("alerta");
    expect(tomDaSituacao(o("o10"), HOJE)).toBe("ok");
  });
});

describe("o aviso do cartão fechado: um só, o mais urgente", () => {
  it("escolhe o item mais urgente entre os do negócio e os herdados", () => {
    // Padaria: o alvará da empresa vence em 12 dias, mas o relatório do negócio é em 4.
    const aviso = avisoDoCartao([o("o1"), o("o2"), o("o3"), o("o4"), o("o6")], HOJE);
    expect(aviso).toEqual({ tipo: "vencendo", nome: "Relatório mensal", categoria: "atividade", dias: 4 });
    expect(textoDoAviso(aviso!, t)).toBe("Relatório mensal em 4 dias");
  });

  it("vencido passa na frente de tudo, e usa o nome curto do tipo", () => {
    const aviso = avisoDoCartao([o("o14"), o("o12"), o("o13")], HOJE);
    expect(aviso).toEqual({ tipo: "vencido", nome: "Alvará", categoria: "documento", dias: -3 });
    expect(textoDoAviso(aviso!, t)).toBe("Alvará venceu há 3 dias");
  });

  it("pedido sem resposta diz há quantos dias foi pedido", () => {
    const aviso = avisoDoCartao([o("o16"), o("o17"), o("o18")], HOJE);
    expect(aviso).toEqual({ tipo: "sem_resposta", nome: "Alvará", categoria: "documento", dias: 9 });
    expect(textoDoAviso(aviso!, t)).toBe("Alvará: pedido há 9 dias, sem resposta");
  });

  it("com tudo em dia, o cartão não mostra nada", () => {
    expect(avisoDoCartao([o("o19"), o("o20"), o("o21")], HOJE)).toBeNull();
    expect(avisoDoCartao([], HOJE)).toBeNull();
  });

  it("as frases de um dia só", () => {
    const base = { nome: "Alvará", categoria: "documento" as const };
    expect(textoDoAviso({ ...base, tipo: "vencido", dias: -1 }, t)).toBe("Alvará venceu ontem");
    expect(textoDoAviso({ ...base, tipo: "vencendo", dias: 0 }, t)).toBe("Alvará vence hoje");
    expect(textoDoAviso({ ...base, tipo: "vencendo", dias: 1 }, t)).toBe("Alvará vence em 1 dia");
    const atividade = { nome: "Relatório mensal", categoria: "atividade" as const };
    expect(textoDoAviso({ ...atividade, tipo: "vencendo", dias: 0 }, t)).toBe("Relatório mensal é hoje");
    expect(textoDoAviso({ ...atividade, tipo: "vencido", dias: -2 }, t)).toBe("Relatório mensal em atraso há 2 dias");
  });
});

describe("dia a dia: a situação muda sozinha conforme o calendário anda", () => {
  it("documento com validade: válido, vencendo a partir do maior aviso, vencido no dia seguinte", () => {
    const alvara = { ...o("o19"), valido_ate: "2026-12-31" };
    expect(maiorAviso(alvara)).toBe(30);
    for (let n = -45; n <= 5; n += 1) {
      const hoje = somarDias("2026-12-31", n);
      const esperada: Situacao = n > 0 ? "vencido" : n >= -30 ? "vencendo" : "valido";
      expect(situacao(alvara, hoje), `a ${-n} dias do vencimento`).toBe(esperada);
      expect(emDia(alvara, hoje)).toBe(esperada === "valido");
    }
    expect(textoDaSituacao(alvara, "2026-12-31", t)).toBe("vence hoje · 31/12/2026");
    expect(textoDaSituacao(alvara, "2027-01-01", t)).toBe("venceu ontem · 31/12/2026");
    expect(textoDaSituacao(alvara, "2026-12-30", t)).toBe("vence em 1 dia · 31/12/2026");
  });

  it("o AVCB entra em vencendo aos 60 dias, que é o maior aviso dele", () => {
    const avcb = { ...o("o8"), valido_ate: "2026-12-31" };
    expect(situacao(avcb, somarDias("2026-12-31", -61))).toBe("valido");
    expect(situacao(avcb, somarDias("2026-12-31", -60))).toBe("vencendo");
  });

  it("item sem aviso nenhum ainda passa por vencendo, 30 dias antes", () => {
    const semAviso = { ...o("o19"), avisos_dias: [], valido_ate: "2026-12-31" };
    expect(situacao(semAviso, "2026-11-30")).toBe("valido");
    expect(situacao(semAviso, "2026-12-01")).toBe("vencendo");
  });

  it("documento pedido: vira pedido sem resposta no dia do X do item", () => {
    const pedido = { ...o("o18"), pedido_em: "2026-10-01", prazo_em: "2026-10-08" };
    for (let n = 0; n <= 8; n += 1) {
      const hoje = somarDias("2026-10-01", n);
      expect(situacao(pedido, hoje)).toBe("pedido");
      expect(semResposta(pedido, hoje), `pedido há ${n} dias`).toBe(n >= 5);
      expect(urgencia(pedido, hoje).tipo).toBe(n >= 5 ? "sem_resposta" : null);
    }
    expect(textoDaSituacao(pedido, "2026-10-01", t)).toBe("pedido hoje · prazo 08/10/2026");
    expect(textoDaSituacao(pedido, "2026-10-02", t)).toBe("pedido há 1 dia · prazo 08/10/2026");
  });

  it("o X de pedido sem resposta é do item", () => {
    const pedido = { ...o("o18"), pedido_em: "2026-10-01", dias_sem_resposta: 2 };
    expect(semResposta(pedido, "2026-10-02")).toBe(false);
    expect(semResposta(pedido, "2026-10-03")).toBe(true);
  });

  it("atividade recorrente: feita, pendente a partir do maior aviso, em atraso depois da data", () => {
    const relatorio = { ...o("o4"), proxima_em: "2026-11-10", feita_em: "2026-10-10" };
    for (let n = -12; n <= 3; n += 1) {
      const hoje = somarDias("2026-11-10", n);
      expect(situacao(relatorio, hoje), `a ${-n} dias da data`).toBe(n >= -5 ? "pendente" : "feita");
      expect(urgencia(relatorio, hoje).tipo).toBe(n > 0 ? "vencido" : n >= -5 ? "vencendo" : null);
    }
    expect(textoDaSituacao(relatorio, "2026-11-10", t)).toBe("é hoje · 10/11/2026");
    expect(textoDaSituacao(relatorio, "2026-11-12", t)).toBe("em atraso há 2 dias · 10/11/2026");
  });

  it("atividade que nunca foi feita é pendente mesmo longe da data", () => {
    const nova = { ...o("o4"), proxima_em: "2027-03-01", feita_em: null };
    expect(situacao(nova, HOJE)).toBe("pendente");
    // Longe da data ela não pede atenção: não vira aviso no cartão.
    expect(urgencia(nova, HOJE).tipo).toBeNull();
  });

  it("atividade que não se repete e já foi feita fica feita", () => {
    const unica = { ...o("o4"), recorrencia: "unica" as const, proxima_em: null, feita_em: "2026-09-30" };
    expect(situacao(unica, HOJE)).toBe("feita");
    expect(textoDaSituacao(unica, HOJE, t)).toBe("feita em 30/09/2026 · não se repete");
    expect(acoesDoItem(unica, HOJE)).toEqual([]);
  });

  it("documento renovado diz quando foi renovado", () => {
    const renovado = { ...o("o19"), renovado_em: "2026-06-24" };
    expect(textoDaSituacao(renovado, HOJE, t)).toBe("válido até 22/06/2027 · renovado em 24/06/2026");
  });

  it("cobrança de hoje aparece na frase", () => {
    const cobrado = { ...o("o16"), cobrado_em: HOJE };
    expect(textoDaSituacao(cobrado, HOJE, t)).toBe("pedido há 9 dias · prazo 29/09/2026 · cobrado hoje");
  });
});

describe("aguardando: o documento foi pedido e a versão pedida não chegou", () => {
  it("pedido depois do último recebimento é renovação em aberto", () => {
    expect(aguardando(o("o1"))).toBe(true);
    expect(aguardando(o("o5"))).toBe(true);
  });

  it("recebido no dia do pedido, ou depois, fecha o pedido", () => {
    expect(aguardando({ ...o("o1"), recebido_em: "2026-09-26" })).toBe(false);
    expect(aguardando({ ...o("o1"), recebido_em: "2026-09-30" })).toBe(false);
  });

  it("atividade nunca está aguardando documento", () => {
    expect(aguardando({ ...o("o4"), pedido_em: "2026-09-01" })).toBe(false);
  });
});

describe("os botões do item, pela situação", () => {
  const rotulos = (x: ItemParaSituacao, hoje = HOJE) => acoesDoItem(x, hoje).map((b) => `${b.rotulo}${b.primaria ? "*" : ""}`);

  it("a pedir: marcar pedido (em destaque) e marcar recebido", () => {
    expect(rotulos(o("o18"))).toEqual(["Marcar pedido*", "Marcar recebido"]);
  });

  it("pedido: marcar recebido (em destaque) e pedir de novo", () => {
    expect(rotulos(o("o5"))).toEqual(["Marcar recebido*", "Pedir de novo"]);
  });

  it("pedido hoje, ou cobrado hoje: não oferece pedir de novo no mesmo dia", () => {
    expect(rotulos({ ...o("o18"), pedido_em: HOJE })).toEqual(["Marcar recebido*"]);
    expect(rotulos({ ...o("o5"), cobrado_em: HOJE })).toEqual(["Marcar recebido*"]);
  });

  it("vencendo sem pedido: marcar recebido e pedir o renovado", () => {
    expect(rotulos(o("o6"))).toEqual(["Marcar recebido*", "Pedir o renovado"]);
  });

  it("vencido com renovação pedida: marcar recebido e pedir de novo", () => {
    expect(rotulos(o("o12"))).toEqual(["Marcar recebido*", "Pedir de novo"]);
  });

  it("válido e recebido: só receber versão nova, sem destaque", () => {
    expect(rotulos(o("o2"))).toEqual(["Receber versão nova"]);
    expect(rotulos(o("o17"))).toEqual(["Receber versão nova"]);
  });

  it("atividade: marcar feita, em destaque só quando pede atenção", () => {
    expect(rotulos(o("o4"))).toEqual(["Marcar feita*"]);
    expect(rotulos(o("o10"))).toEqual(["Marcar feita"]);
  });
});

describe("as frases de recorrência e de avisos", () => {
  it("recorrência", () => {
    expect(textoDaRecorrencia({ recorrencia: "mensal", recorrencia_meses: null }, t)).toBe("Mensal");
    expect(textoDaRecorrencia({ recorrencia: "anual", recorrencia_meses: null }, t)).toBe("Anual");
    expect(textoDaRecorrencia({ recorrencia: "n_meses", recorrencia_meses: 6 }, t)).toBe("A cada 6 meses");
    expect(textoDaRecorrencia({ recorrencia: "unica", recorrencia_meses: null }, t)).toBe("Única");
  });

  it("avisos", () => {
    expect(textoDosAvisos([30, 15, 7], t)).toBe("30, 15 e 7 dias antes");
    expect(textoDosAvisos([45], t)).toBe("45 dias antes");
    expect(textoDosAvisos([], t)).toBe("sem aviso");
  });

  it("o modelo de Serviços B2B é o do protótipo", () => {
    expect(modelosDoSegmento("servicos_b2b").map((m) => m.nome)).toEqual([
      "Alvará de funcionamento",
      "AVCB (vistoria dos bombeiros)",
      "Licença sanitária",
      "Certificado digital",
      "Contrato social",
      "Renovação anual do contrato",
      "Relatório mensal",
      "Reunião trimestral",
    ]);
  });
});
