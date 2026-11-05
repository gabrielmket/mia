/**
 * FORK MIA (.102) · AS REGRAS PURAS DO RAIO-X DO CLIENTE ATIVO
 * (docs/fork/raio-x-do-atendimento.md, seção 13; protótipo de 05/11/2026).
 *
 *  - quem respondeu, pelo `messages.sent_via` (a direção separa o cliente);
 *  - a tabela "quem respondeu primeiro", por conversa, com a mediana em segundos
 *    e o que chegou com a loja fechada;
 *  - as faixas da espera depois da passagem (até 15 min, 15 min a 2 h, mais de
 *    2 h, ninguém assumiu) e "alguém assumiu" = reconhecimento OU mensagem de
 *    uma pessoa, o que vier primeiro;
 *  - o funil das conversas passadas;
 *  - o aceite: nome completo (nome e sobrenome) e e-mail num formato válido;
 *  - o termo "cliente ativo" v1, o cadastro da fonte nova e a comparação "novo".
 *
 * Dado fictício (Garagem Modelo Veículos, (31) 90000-xxxx).
 */
import { describe, expect, it } from "vitest";

import { ehEmailValido, ehNomeCompleto, fraseDaRecusaDoAceite, validarAceite } from "@/lib/raio-x/aceite";
import { compararComOAnterior, type Indicadores } from "@/lib/raio-x/comparacao";
import { proximaAbertura } from "@/lib/raio-x/horario";
import { agregarMetricas, medirConversa, type MensagemParaMedir } from "@/lib/raio-x/metricas";
import {
  assumidaEm,
  faixaDaEspera,
  medirPassagem,
  resumirFunil,
  resumirPassagens,
  type PassagemMedida,
} from "@/lib/raio-x/passagem";
import { ehPessoa, medirQuemRespondeu, quemEnviou } from "@/lib/raio-x/quem-respondeu";
import type { HorarioComercial } from "@/lib/raio-x/regras";
import { validarNovoRaioX } from "@/lib/raio-x/regras";
import { textoDoTermoDoClienteAtivo, VERSAO_DO_TERMO_CLIENTE_ATIVO } from "@/lib/raio-x/termo";

const sp = (iso: string) => new Date(`${iso}-03:00`).getTime();
const SEG = 1000;
const MIN = 60_000;
const HORA = 3_600_000;
const HORARIO: HorarioComercial = { abre: 8 * 60, fecha: 18 * 60, sabadoAte: 12 * 60 };
const FIM = sp("2026-11-05T00:00:00");
const ORG = "e9151e91-0000-4000-8000-00000000000a";
const NUMERO = "e9151e91-5555-4000-8000-000000000101";

describe("quem mandou, pelo sent_via", () => {
  it("a direção separa o cliente: a ingestão carimba external_device nos dois sentidos", () => {
    expect(quemEnviou("inbound", "external_device")).toBe("cliente");
    expect(quemEnviou("outbound", "external_device")).toBe("celular");
  });

  it("ai = IA; user e crm = equipe pela MIA; automation e system = automação", () => {
    expect(quemEnviou("outbound", "ai")).toBe("ia");
    expect(quemEnviou("outbound", "user")).toBe("equipe");
    expect(quemEnviou("outbound", "crm")).toBe("equipe");
    expect(quemEnviou("outbound", "automation")).toBe("automacao");
    expect(quemEnviou("outbound", "system")).toBe("automacao");
  });

  it("pessoa é a equipe pela MIA ou o celular; a IA e a automação não", () => {
    expect([ehPessoa("equipe"), ehPessoa("celular"), ehPessoa("ia"), ehPessoa("automacao"), ehPessoa("cliente")]).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe("quem respondeu primeiro, por conversa", () => {
  const c = (iso: string): MensagemParaMedir => ({ daLoja: false, em: sp(iso) });
  const l = (iso: string, quem: "ia" | "equipe" | "celular" | "automacao", mais = 0): MensagemParaMedir => ({
    daLoja: true,
    em: sp(iso) + mais,
    quem,
  });
  // Terça 03/11: 10h (aberta) e 22h (fechada); sábado 31/10 às 20h (fechada).
  const conversas = [
    [c("2026-11-03T22:00:00"), l("2026-11-03T22:00:00", "ia", 9 * SEG)],
    [c("2026-11-03T22:10:00"), l("2026-11-03T22:10:00", "ia", 11 * SEG), l("2026-11-04T09:00:00", "equipe")],
    [c("2026-11-03T10:00:00"), l("2026-11-03T10:14:00", "equipe")],
    [c("2026-11-03T10:30:00"), l("2026-11-03T11:11:00", "celular")],
    [c("2026-10-31T20:00:00")],
  ].map((msgs) => medirConversa(msgs, HORARIO, FIM));

  it("a primeira resposta do primeiro episódio diz quem respondeu", () => {
    expect(conversas[1]!.episodios[0]!.primeiraRespostaQuem).toBe("ia");
    expect(conversas[3]!.episodios[0]!.primeiraRespostaQuem).toBe("celular");
  });

  it("IA, equipe e celular, a mediana em SEGUNDOS e o que chegou com a loja fechada", () => {
    const q = medirQuemRespondeu(conversas);
    expect([q.conversas, q.respondidas, q.semResposta, q.emAberto, q.chegaramComALojaFechada]).toEqual([5, 4, 1, 0, 3]);
    expect(q.linhas).toEqual([
      { quem: "ia", conversas: 2, medianaSeg: 10, foraDoHorario: 2 },
      { quem: "equipe", conversas: 1, medianaSeg: 14 * 60, foraDoHorario: 0 },
      { quem: "celular", conversas: 1, medianaSeg: 41 * 60, foraDoHorario: 0 },
    ]);
  });

  it("respondido com a loja fechada: a IA antes de abrir conta; a equipe na abertura, não", () => {
    expect(conversas[0]!.episodios[0]!.respondidoComALojaFechada).toBe(true);
    const naAbertura = medirConversa([c("2026-11-03T22:00:00"), l("2026-11-04T08:05:00", "equipe")], HORARIO, FIM);
    expect(naAbertura.episodios[0]!.respondidoComALojaFechada).toBe(false);
    const a = agregarMetricas([conversas[0]!, naAbertura]);
    expect(a.proporcaoRespondidoComALojaFechada).toBe(0.5);
    expect(a.medianaPrimeiraRespostaSeg).not.toBeNull();
  });

  it("a próxima abertura: sábado depois do meio-dia pula o domingo e abre segunda às 8h", () => {
    expect(proximaAbertura(sp("2026-10-31T12:30:00"), HORARIO)).toBe(sp("2026-11-02T08:00:00"));
    expect(proximaAbertura(sp("2026-11-03T07:00:00"), HORARIO)).toBe(sp("2026-11-03T08:00:00"));
    expect(proximaAbertura(sp("2026-11-06T19:00:00"), { ...HORARIO, sabadoAte: null })).toBe(sp("2026-11-09T08:00:00"));
  });
});

describe("a espera depois da passagem para um vendedor", () => {
  it("as faixas: até 15 min, 15 min a 2 h, mais de 2 h e ninguém (com 2 h no relógio)", () => {
    expect(faixaDaEspera(15 * MIN, 10 * HORA)).toBe("ate_15_min");
    expect(faixaDaEspera(15 * MIN + 1, 10 * HORA)).toBe("de_15_min_a_2_h");
    expect(faixaDaEspera(2 * HORA, 10 * HORA)).toBe("de_15_min_a_2_h");
    expect(faixaDaEspera(2 * HORA + 1, 10 * HORA)).toBe("mais_de_2_h");
    expect(faixaDaEspera(null, 2 * HORA)).toBe("ninguem");
    // Menos de 2 horas sem ninguém até o fim do período: em aberto, fora das faixas.
    expect(faixaDaEspera(null, 2 * HORA - 1)).toBe("em_aberto");
  });

  it("alguém assumiu = o reconhecimento ou a mensagem de uma pessoa, o que vier primeiro", () => {
    const p = { em: sp("2026-10-31T20:00:00"), reconhecidaEm: sp("2026-11-01T09:00:00") };
    expect(assumidaEm(p, [sp("2026-11-01T08:40:00")])).toBe(sp("2026-11-01T08:40:00"));
    expect(assumidaEm(p, [])).toBe(sp("2026-11-01T09:00:00"));
    // A mensagem de ANTES da passagem não conta.
    expect(assumidaEm({ ...p, reconhecidaEm: null }, [sp("2026-10-31T19:00:00")])).toBeNull();
  });

  it("o resumo: faixas, lentas com a loja fechada e as medianas aberta e fechada", () => {
    const fim = sp("2026-11-05T00:00:00");
    const medidas: PassagemMedida[] = [
      medirPassagem({ em: sp("2026-11-03T10:00:00"), reconhecidaEm: null }, [sp("2026-11-03T10:10:00")], fim, true),
      medirPassagem({ em: sp("2026-11-03T11:00:00"), reconhecidaEm: sp("2026-11-03T11:30:00") }, [], fim, true),
      medirPassagem({ em: sp("2026-10-31T20:00:00"), reconhecidaEm: null }, [sp("2026-11-01T09:05:00")], fim, false),
      medirPassagem({ em: sp("2026-11-01T21:00:00"), reconhecidaEm: null }, [], fim, false),
    ];
    const r = resumirPassagens(medidas);
    expect(r.faixas).toEqual({ ate_15_min: 1, de_15_min_a_2_h: 1, mais_de_2_h: 1, ninguem: 1 });
    expect([r.conversas, r.lentas, r.lentasComALojaFechada, r.emAberto]).toEqual([4, 2, 2, 0]);
    expect(r.medianaComALojaAbertaMin).toBe(20);
    expect(r.medianaComALojaFechadaMin).toBe(13 * 60 + 5);
  });

  it("no que virou: das passadas, negócio, visita, venda; e das lentas, quantas viraram visita", () => {
    const rapida = medirPassagem({ em: sp("2026-11-03T10:00:00"), reconhecidaEm: null }, [sp("2026-11-03T10:05:00")], FIM, true);
    const lenta = medirPassagem({ em: sp("2026-11-01T21:00:00"), reconhecidaEm: null }, [], FIM, false);
    const f = resumirFunil([
      { passagem: rapida, funil: { negocio: true, visita: true, venda: true } },
      { passagem: lenta, funil: { negocio: true, visita: false, venda: false } },
      { passagem: null, funil: { negocio: true, visita: true, venda: false } },
    ]);
    expect([f.passadas, f.negocio, f.visita, f.venda, f.lentas, f.lentasComVisita]).toEqual([2, 2, 1, 1, 1, 0]);
    expect(f.todas).toEqual({ conversas: 3, negocio: 3, visita: 2, venda: 1 });
  });
});

describe("o aceite pede nome completo e e-mail, nas duas fontes", () => {
  it("nome completo é nome e sobrenome", () => {
    expect(ehNomeCompleto("Dono Modelo da Silva")).toBe(true);
    expect(ehNomeCompleto("  Ana   Exemplo ")).toBe(true);
    expect(ehNomeCompleto("João D'Ávila")).toBe(true);
    expect(ehNomeCompleto("Dono")).toBe(false);
    expect(ehNomeCompleto("D S")).toBe(false);
    expect(ehNomeCompleto("12 34")).toBe(false);
    expect(ehNomeCompleto(null)).toBe(false);
  });

  it("o e-mail num formato válido", () => {
    expect(ehEmailValido("dono@garagemmodelo.com.br")).toBe(true);
    expect(ehEmailValido(" Dono@GaragemModelo.com ")).toBe(true);
    expect(ehEmailValido("dono@garagemmodelo")).toBe(false);
    expect(ehEmailValido("dono garagem@modelo.com")).toBe(false);
    expect(ehEmailValido("@modelo.com")).toBe(false);
  });

  it("valida o corpo, limpa os valores e diz os CAMPOS que faltam", () => {
    expect(validarAceite({ nome: " Dono  Modelo ", email: "DONO@garagemmodelo.com.br", aceito: true })).toEqual({
      ok: true,
      nome: "Dono Modelo",
      email: "dono@garagemmodelo.com.br",
    });
    const ruim = validarAceite({ nome: "Dono", email: "x", aceito: false });
    expect(ruim.ok ? [] : ruim.campos).toEqual(["nome", "email", "aceito"]);
    expect(fraseDaRecusaDoAceite(["nome", "email"])).toBe("Escreva o nome e o sobrenome e confira o e-mail.");
  });
});

describe("o termo \"cliente ativo\" v1 e o cadastro da fonte nova", () => {
  it("o texto do protótipo, com a empresa, os números e o período", () => {
    const texto = textoDoTermoDoClienteAtivo({
      empresa: "Garagem Modelo Veículos",
      numeros: ["Vendas", "Pós-venda"],
      inicio: "06/09",
      fim: "04/11",
      tipo: "unico",
    });
    expect(VERSAO_DO_TERMO_CLIENTE_ATIVO).toBe("cliente_ativo_v1");
    expect(texto).toContain(
      "Eu, responsável pela conta Garagem Modelo Veículos na MIA, autorizo a Time Company a analisar as conversas de WhatsApp dos números Vendas e Pós-venda já registradas na MIA, de 06/09 a 04/11, só para medir o atendimento e gerar o relatório do raio-X.",
    );
    expect(texto).toContain("Nenhuma mensagem é enviada em meu nome.");
    expect(texto).toContain("Posso cancelar esta autorização falando com a Time Company.");
  });

  it("um número só e o mensal mudam a frase", () => {
    const texto = textoDoTermoDoClienteAtivo({ empresa: "Academia Modelo Fit", numeros: ["Recepção"], inicio: "01/10", fim: "31/10", tipo: "mensal" });
    expect(texto).toContain("do número Recepção já registradas na MIA, de 01/10 a 31/10 e, no acompanhamento mensal");
  });

  it("a fonte da MIA pede a conta e os números; o WhatsApp sai deles", () => {
    const ok = validarNovoRaioX({ fonte: "conversas_da_mia", empresa: "Garagem Modelo Veículos", segmento: "revenda_de_veiculos", organization_id: ORG, numeros: [NUMERO, NUMERO] });
    expect(ok.ok && ok.valor).toMatchObject({ fonte: "conversas_da_mia", whatsapp: null, numeros: [NUMERO], tipo: "unico" });
    const ruim = validarNovoRaioX({ fonte: "conversas_da_mia", empresa: "Garagem Modelo Veículos", segmento: "revenda_de_veiculos" });
    expect(ruim.ok ? [] : ruim.campos).toEqual(["organization_id", "numeros"]);
  });

  it("a conexão segue pedindo o WhatsApp, como na .101", () => {
    const semNumero = validarNovoRaioX({ empresa: "Clínica Sorriso Modelo", segmento: "clinica_odontologica" });
    expect(semNumero.ok ? [] : semNumero.campos).toEqual(["whatsapp"]);
    const ok = validarNovoRaioX({ empresa: "Clínica Sorriso Modelo", segmento: "clinica_odontologica", whatsapp: "(31) 90000-1101" });
    expect(ok.ok && ok.valor).toMatchObject({ fonte: "conexao", whatsapp: "5531900001101", numeros: [] });
  });
});

describe("o antes e depois", () => {
  const v1: Indicadores = {
    medianaPrimeiraRespostaMin: 47,
    medianaComALojaFechadaMin: 600,
    proporcaoSemResposta: 0.15,
    proporcaoSumiuSemRetorno: 0.31,
    proporcaoPediuValorSemReceber: 0.1,
    proporcaoAgendou: 0.04,
    notaMedia: 4.1,
  };
  it("a espera depois da passagem sai como NOVO contra o raio-X por conexão; o tempo em segundos compara", () => {
    const c = compararComOAnterior(
      {
        id: "agora",
        criadoEm: "2026-11-05T12:00:00Z",
        criteriosVersao: "2026-11-v1",
        conversas: 638,
        indicadores: { ...v1, medianaPrimeiraRespostaMin: 0.15, proporcaoSemResposta: 0.06, proporcaoAgendou: 0.064, notaMedia: 7.4, medianaEsperaDaPassagemMin: 22 },
        fonte: "conversas_da_mia",
        periodo: { inicio: "2026-09-06T03:00:00Z", fim: "2026-11-05T03:00:00Z" },
      },
      { id: "antes", criadoEm: "2026-08-15T12:00:00Z", criteriosVersao: "2026-11-v1", conversas: 412, indicadores: v1, fonte: "conexao" },
    );
    const linha = (k: string) => c.linhas.find((l) => l.indicador === k)!;
    expect(linha("medianaEsperaDaPassagemMin")).toMatchObject({ anterior: null, agora: 22, direcao: null, aviso: "novo" });
    expect(linha("medianaPrimeiraRespostaMin").direcao).toBe("melhor");
    expect(linha("proporcaoSemRespostaOuRetorno").direcao).toBeNull();
    expect([c.fonte, c.anteriorFonte]).toEqual(["conversas_da_mia", "conexao"]);
    expect(c.agoraPeriodo?.inicio).toBe("2026-09-06T03:00:00Z");
  });
});
