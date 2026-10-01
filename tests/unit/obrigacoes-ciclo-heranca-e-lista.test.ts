/**
 * FORK MIA — obrigações: o que cada botão faz com as datas (o próximo ciclo
 * nasce sozinho), em que grupo o item aparece em cada tela (a herança) e os
 * filtros da lista geral.
 */
import { describe, expect, it } from "vitest";

import {
  aoPedir,
  datasAoAdicionar,
  proximaDataDaAtividade,
  receberRenova,
  textoDoProximoCiclo,
  validadeSugerida,
} from "@/lib/obrigacoes/ciclo";
import { comoDia, diaCurto, diaNoFuso, diaPorExtenso, diasEntre, diaValido, somarDias, somarMeses } from "@/lib/obrigacoes/datas";
import { donoDoItem, grupoNaEmpresa, grupoNoContato, grupoNoNegocio } from "@/lib/obrigacoes/heranca";
import {
  aoClicarNoContador,
  CONTADORES_DA_LISTA,
  contadorLigado,
  FILTROS_ZERADOS,
  passaNaLista,
  type FiltrosDaLista,
} from "@/lib/obrigacoes/lista";
import { chaveDoNome, normalizarAvisos, type ItemParaSituacao } from "@/lib/obrigacoes/tipos";

const HOJE = "2026-10-01";
const t = (texto: string) => texto;

function documento(datas: Partial<ItemParaSituacao> = {}): ItemParaSituacao {
  return {
    categoria: "documento",
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
    ...datas,
  };
}

function atividade(datas: Partial<ItemParaSituacao> = {}): ItemParaSituacao {
  return documento({ categoria: "atividade", recorrencia: "mensal", validade_meses: 0, avisos_dias: [5, 2], ...datas });
}

describe("as contas de dia", () => {
  it("só aceita dia que existe no calendário", () => {
    expect(diaValido("2026-02-28")).toBe(true);
    expect(diaValido("2026-02-30")).toBe(false);
    expect(diaValido("2028-02-29")).toBe(true);
    expect(diaValido("2027-02-29")).toBe(false);
    expect(diaValido("01/10/2026")).toBe(false);
    expect(comoDia("2026-10-01T12:00:00Z")).toBe("2026-10-01");
    expect(comoDia("")).toBeNull();
    expect(comoDia(20261001)).toBeNull();
  });

  it("conta dias sem depender de horário de verão nem de fuso", () => {
    expect(diasEntre("2026-10-01", "2026-10-13")).toBe(12);
    expect(diasEntre("2026-10-01", "2026-09-28")).toBe(-3);
    expect(diasEntre("2026-10-01", "2028-08-15")).toBe(684);
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("somar meses não pula de mês", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2027-01-31", 13)).toBe("2028-02-29");
    expect(somarMeses("2026-10-13", 12)).toBe("2027-10-13");
    expect(somarMeses("2026-08-31", 6)).toBe("2027-02-28");
    expect(somarMeses("2026-11-30", 3)).toBe("2027-02-28");
  });

  it("escreve a data como a pessoa lê", () => {
    expect(diaPorExtenso("2026-10-13")).toBe("13/10/2026");
    expect(diaCurto("2026-10-13")).toBe("13/10");
    expect(diaPorExtenso(null)).toBe("");
  });

  it("o hoje é o do fuso da empresa, e fuso torto não derruba ninguém", () => {
    const noite = new Date("2026-10-02T01:30:00Z");
    expect(diaNoFuso(noite, "America/Sao_Paulo")).toBe("2026-10-01");
    expect(diaNoFuso(noite, "UTC")).toBe("2026-10-02");
    expect(diaNoFuso(noite, "Marte/Olimpo")).toBe("2026-10-02");
    expect(diaNoFuso(noite, null)).toBe("2026-10-02");
  });
});

describe("marcar pedido", () => {
  it("põe prazo de 7 dias", () => {
    expect(aoPedir(documento(), HOJE)).toEqual({ modo: "pedido", pedido_em: HOJE, prazo_em: "2026-10-08", cobrado_em: null });
  });

  it("com recebimento anterior, é renovação pedida", () => {
    const item = documento({ recebido_em: "2025-10-14", valido_ate: "2026-10-13" });
    expect(aoPedir(item, HOJE)).toMatchObject({ modo: "renovacao_pedida", pedido_em: HOJE, prazo_em: "2026-10-08" });
  });

  it("com pedido em aberto é cobrança: a data do pedido não muda", () => {
    const item = documento({ pedido_em: "2026-09-26" });
    expect(aoPedir(item, HOJE)).toEqual({ modo: "pedido_de_novo", cobrado_em: HOJE });
  });
});

describe("receber", () => {
  it("sugere a validade anterior mais um período quando o item se repete", () => {
    const item = documento({ recebido_em: "2025-10-14", valido_ate: "2026-10-13" });
    expect(validadeSugerida(item, HOJE)).toBe("2027-10-13");
    expect(receberRenova(item)).toBe(true);
  });

  it("no primeiro recebimento, sugere hoje mais a validade padrão do tipo", () => {
    const item = documento({ pedido_em: "2026-09-22" });
    expect(validadeSugerida(item, HOJE)).toBe("2027-10-01");
    expect(receberRenova(item)).toBe(false);
  });

  it("tipo sem validade não sugere data: o item fica recebido, sem validade", () => {
    const item = documento({ recorrencia: "unica", validade_meses: 0, avisos_dias: [] });
    expect(validadeSugerida(item, HOJE)).toBeNull();
    expect(textoDoProximoCiclo(item, null, t)).toBe(
      "Sem \"válido até\", o item fica como recebido e não entra nos avisos de vencimento.",
    );
  });

  it("a prévia diz quando vence, quando sai o primeiro aviso e que o ciclo atual vai para o histórico", () => {
    const item = documento({ recebido_em: "2025-10-14", valido_ate: "2026-10-13" });
    expect(textoDoProximoCiclo(item, "2027-10-13", t)).toBe(
      "Próximo ciclo: vence em 13/10/2027. Primeiro aviso em 13/09/2027 (30 dias antes). O ciclo atual vai para o histórico do item.",
    );
  });

  it("a prévia de um item sem aviso diz que ele não avisa", () => {
    const item = documento({ recorrencia: "unica", avisos_dias: [] });
    expect(textoDoProximoCiclo(item, "2027-01-10", t)).toBe("Vence em 10/01/2027. Este item está sem aviso de vencimento.");
  });
});

describe("marcar feita", () => {
  it("a próxima data nasce sozinha, um período depois da data prevista", () => {
    expect(proximaDataDaAtividade(atividade({ proxima_em: "2026-10-05" }), HOJE)).toBe("2026-11-05");
    expect(proximaDataDaAtividade(atividade({ recorrencia: "anual", proxima_em: "2026-11-15" }), HOJE)).toBe("2027-11-15");
    expect(
      proximaDataDaAtividade(atividade({ recorrencia: "n_meses", recorrencia_meses: 3, proxima_em: "2026-11-30" }), HOJE),
    ).toBe("2027-02-28");
  });

  it("a que não se repete não ganha próxima data", () => {
    expect(proximaDataDaAtividade(atividade({ recorrencia: "unica", proxima_em: "2026-10-05" }), HOJE)).toBeNull();
  });
});

describe("as datas de um item que nasce", () => {
  it("documento recebido sem válido até: calcula pela validade padrão", () => {
    expect(
      datasAoAdicionar(
        { categoria: "documento", recorrencia: "anual", recorrencia_meses: null, validade_meses: 12, recebido_em: "2026-03-22" },
        HOJE,
      ),
    ).toEqual({ pedido_em: null, prazo_em: null, recebido_em: "2026-03-22", valido_ate: "2027-03-22", proxima_em: null, feita_em: null });
  });

  it("documento sem validade padrão e sem data fica sem válido até", () => {
    const datas = datasAoAdicionar(
      { categoria: "documento", recorrencia: "unica", recorrencia_meses: null, validade_meses: 0, recebido_em: "2026-09-23" },
      HOJE,
    );
    expect(datas.valido_ate).toBeNull();
  });

  it("documento sem data nenhuma nasce a pedir", () => {
    const datas = datasAoAdicionar(
      { categoria: "documento", recorrencia: "anual", recorrencia_meses: null, validade_meses: 12 },
      HOJE,
    );
    expect(datas).toEqual({ pedido_em: null, prazo_em: null, recebido_em: null, valido_ate: null, proxima_em: null, feita_em: null });
  });

  it("atividade sem próxima data nasce para daqui a um período, e nunca leva data de documento", () => {
    const datas = datasAoAdicionar(
      { categoria: "atividade", recorrencia: "mensal", recorrencia_meses: null, validade_meses: 0, valido_ate: "2027-01-01" },
      HOJE,
    );
    expect(datas).toEqual({ pedido_em: null, prazo_em: null, recebido_em: null, valido_ate: null, proxima_em: "2026-11-01", feita_em: null });
  });
});

describe("a herança: um registro só, visto de três lugares", () => {
  const negocio = { id: "neg-1", empresa_id: "emp-1", contact_id: "cont-1" };
  const daEmpresa = { lead_id: null, empresa_id: "emp-1", contact_id: null };
  const doContato = { lead_id: null, empresa_id: null, contact_id: "cont-1" };
  const doNegocio = { lead_id: "neg-1", empresa_id: null, contact_id: null };
  const deOutro = { lead_id: "neg-9", empresa_id: "emp-9", contact_id: "cont-9" };

  it("no cartão do negócio: o que é dele, o que é da empresa dele e o que é do contato dele", () => {
    expect(grupoNoNegocio(doNegocio, negocio)).toBe("negocio");
    expect(grupoNoNegocio(daEmpresa, negocio)).toBe("empresa");
    expect(grupoNoNegocio(doContato, negocio)).toBe("contato");
    expect(grupoNoNegocio(deOutro, negocio)).toBeNull();
  });

  it("item de outro negócio da mesma empresa não aparece neste negócio", () => {
    expect(grupoNoNegocio({ lead_id: "neg-2", empresa_id: null, contact_id: null }, negocio)).toBeNull();
  });

  it("negócio sem empresa e sem contato só mostra o que é dele", () => {
    const solto = { id: "neg-1", empresa_id: null, contact_id: null };
    expect(grupoNoNegocio({ lead_id: null, empresa_id: null, contact_id: "cont-1" }, solto)).toBeNull();
    expect(grupoNoNegocio(doNegocio, solto)).toBe("negocio");
  });

  it("na ficha da empresa: dela, dos contatos dela e dos negócios dela", () => {
    const empresa = { id: "emp-1", contatos: new Set(["cont-1"]), negocios: new Set(["neg-1"]) };
    expect(grupoNaEmpresa(daEmpresa, empresa)).toBe("empresa");
    expect(grupoNaEmpresa(doContato, empresa)).toBe("contato");
    expect(grupoNaEmpresa(doNegocio, empresa)).toBe("negocio");
    expect(grupoNaEmpresa(deOutro, empresa)).toBeNull();
  });

  it("na ficha do contato: dele e da empresa dele", () => {
    const contato = { id: "cont-1", empresa_id: "emp-1" };
    expect(grupoNoContato(doContato, contato)).toBe("contato");
    expect(grupoNoContato(daEmpresa, contato)).toBe("empresa");
    expect(grupoNoContato(doNegocio, contato)).toBeNull();
  });

  it("o dono, para a lista geral: negócio, depois empresa, depois contato", () => {
    expect(donoDoItem({ lead_id: "n", empresa_id: "e", contact_id: "c" })).toBe("negocio");
    expect(donoDoItem(daEmpresa)).toBe("empresa");
    expect(donoDoItem(doContato)).toBe("contato");
  });
});

describe("os filtros da lista geral", () => {
  const base = { nome: "Alvará de funcionamento", responsavel_user_id: "u1", lead_id: null, empresa_id: "e1", contact_id: null };
  const vencido = { ...base, ...documento({ recebido_em: "2025-09-30", valido_ate: "2026-09-28" }) };
  const vencendo = { ...base, ...documento({ recebido_em: "2025-10-14", valido_ate: "2026-10-13" }) };
  const valido = { ...base, responsavel_user_id: "u2", ...documento({ recebido_em: "2026-06-24", valido_ate: "2027-06-22" }) };
  const semResposta = { ...base, nome: "Contrato social", lead_id: "n1", empresa_id: null, ...documento({ pedido_em: "2026-09-22" }) };
  const relatorio = { ...base, nome: "Relatório mensal", lead_id: "n1", empresa_id: null, ...atividade({ proxima_em: "2026-10-05", feita_em: "2026-09-04" }) };
  const todos = [vencido, vencendo, valido, semResposta, relatorio];
  const com = (f: Partial<FiltrosDaLista>) => todos.filter((x) => passaNaLista(x, { ...FILTROS_ZERADOS, ...f }, HOJE));

  it("sem filtro, passa tudo", () => {
    expect(com({})).toHaveLength(5);
  });

  it("por situação, por tipo, por responsável e por a quem está ligado", () => {
    expect(com({ situacao: "vencido" })).toEqual([vencido]);
    expect(com({ tipo: "documento" })).toEqual([vencido, vencendo, valido, semResposta]);
    expect(com({ tipo: "atividade" })).toEqual([relatorio]);
    expect(com({ tipo: "Contrato social" })).toEqual([semResposta]);
    expect(com({ responsavel: "u2" })).toEqual([valido]);
    expect(com({ ligado: "negocio" })).toEqual([semResposta, relatorio]);
    expect(com({ ligado: "empresa" })).toEqual([vencido, vencendo, valido]);
    expect(com({ ligado: "contato" })).toEqual([]);
  });

  it("por prazo", () => {
    expect(com({ prazo: "vencidos" })).toEqual([vencido]);
    expect(com({ prazo: "7" })).toEqual([relatorio]);
    expect(com({ prazo: "15" })).toEqual([vencendo, relatorio]);
  });

  it("os dois contadores que não são prazo", () => {
    expect(com({ rapido: "sem_resposta" })).toEqual([semResposta]);
    expect(com({ rapido: "em_dia" })).toEqual([valido]);
  });

  it("clicar num contador liga só ele; clicar de novo, desliga", () => {
    expect(CONTADORES_DA_LISTA.map((c) => c.chave)).toEqual(["vencidos", "vencendo_em_30_dias", "pedidos_sem_resposta", "em_dia"]);
    const comFiltro: FiltrosDaLista = { ...FILTROS_ZERADOS, responsavel: "u1" };
    for (const { chave } of CONTADORES_DA_LISTA) {
      const ligado = aoClicarNoContador(chave, comFiltro);
      expect(contadorLigado(chave, ligado)).toBe(true);
      expect(ligado.responsavel).toBe("todos");
      for (const outro of CONTADORES_DA_LISTA) {
        if (outro.chave !== chave) expect(contadorLigado(outro.chave, ligado)).toBe(false);
      }
      expect(aoClicarNoContador(chave, ligado)).toEqual(FILTROS_ZERADOS);
    }
  });
});

describe("o nome e os avisos, como entram no banco", () => {
  it("a chave do nome ignora caixa, acento e espaço sobrando", () => {
    expect(chaveDoNome("  Alvará de  Funcionamento ")).toBe(chaveDoNome("alvara de funcionamento"));
    expect(chaveDoNome("Licença sanitária")).not.toBe(chaveDoNome("Licença ambiental"));
  });

  it("os avisos ficam do maior para o menor, sem repetição, no máximo três", () => {
    expect(normalizarAvisos([7, 30, 15, 30])).toEqual([30, 15, 7]);
    expect(normalizarAvisos([60, 45, 30, 15, 7])).toHaveLength(3);
    expect(normalizarAvisos([])).toEqual([]);
    expect(normalizarAvisos([0, -3, 10])).toEqual([10]);
  });
});
