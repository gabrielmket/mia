/**
 * FORK MIA — as regras puras do cartão fechado: bola, compromisso, fechamento,
 * identidade, canal, tempo. Cada caso nomeia a decisão que ele prende; quem
 * mudar a regra sem mudar a decisão vê o vermelho aqui.
 */
import { describe, expect, it } from "vitest";

import { bolaDaConversa, quemFalouRotulo, rotuloDaBola } from "./bola";
import { canalDoNegocio } from "./canal";
import {
  escolherProximoCompromisso,
  horaCurta,
  ondeDoCompromisso,
  quandoDoCompromisso,
  textoDoProximoCompromisso,
  type CompromissoDoCartao,
} from "./compromisso";
import { fechamentoPrevisto, textoDoFechamento } from "./fechamento";
import { nomeCurto, prefixoDoCartao } from "./identidade";
import { duracaoCurta, duracaoLonga, haQuanto } from "./tempo";

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

describe("tempo", () => {
  it("curta: minutos, horas, dias, meses, anos — e nunca negativo", () => {
    expect(duracaoCurta(30_000)).toBe("agora");
    expect(duracaoCurta(12 * MIN)).toBe("12 min");
    expect(duracaoCurta(3 * HORA)).toBe("3 h");
    expect(duracaoCurta(DIA)).toBe("1 dia");
    expect(duracaoCurta(4 * DIA)).toBe("4 dias");
    expect(duracaoCurta(70 * DIA)).toBe("2 meses");
    expect(duracaoCurta(800 * DIA)).toBe("2 anos");
    expect(duracaoCurta(-5 * MIN)).toBe("agora");
  });

  it("longa: '1 ano e 3 meses' para compras", () => {
    expect(duracaoLonga(8)).toBe("8 dias");
    expect(duracaoLonga(150)).toBe("4 meses");
    expect(duracaoLonga(365 + 92)).toBe("1 ano e 3 meses");
    expect(duracaoLonga(730)).toBe("1 ano e 11 meses");
  });

  it("haQuanto não escreve 'há agora'", () => {
    const agora = new Date("2026-09-30T12:00:00Z");
    expect(haQuanto("2026-09-30T11:48:00Z", agora)).toBe("há 12 min");
    expect(haQuanto("2026-09-30T11:59:40Z", agora)).toBe("agora");
  });
});

describe("com quem está a bola", () => {
  const agora = new Date("2026-09-30T12:00:00Z");

  it("o lead falou por último e ninguém respondeu: a bola é NOSSA", () => {
    const b = bolaDaConversa({
      ultimaEntrada: "2026-09-30T11:48:00Z",
      ultimaSaida: "2026-09-30T10:00:00Z",
      saidaVia: "ai",
      saidaPor: null,
    });
    expect(b).toEqual({ com: "nos", quem: "lead", desde: "2026-09-30T11:48:00Z", porUsuarioId: null });
    expect(rotuloDaBola(b!, { agora })).toBe("Lead há 12 min");
  });

  it("nunca respondemos: a bola é nossa desde a primeira mensagem", () => {
    expect(
      bolaDaConversa({ ultimaEntrada: "2026-09-30T11:00:00Z", ultimaSaida: null, saidaVia: null, saidaPor: null })?.com,
    ).toBe("nos");
  });

  it("a IA respondeu por último: bola do cliente, quem = Agente", () => {
    const b = bolaDaConversa({
      ultimaEntrada: "2026-09-30T10:00:00Z",
      ultimaSaida: "2026-09-30T11:00:00Z",
      saidaVia: "ai",
      saidaPor: null,
    })!;
    expect(b.com).toBe("cliente");
    expect(rotuloDaBola(b, { agora })).toBe("Agente há 1 h");
  });

  it("automação e sistema não são 'Equipe' — ninguém escreveu aquilo", () => {
    for (const via of ["automation", "system"]) {
      const b = bolaDaConversa({
        ultimaEntrada: null,
        ultimaSaida: "2026-09-30T11:00:00Z",
        saidaVia: via,
        saidaPor: null,
      })!;
      expect(b.quem).toBe("automacao");
      expect(quemFalouRotulo(b, {})).toBe("Automação");
    }
  });

  it("pessoa da equipe: 'Você' para quem olha, o primeiro nome para os outros, 'Equipe' sem nome", () => {
    const b = bolaDaConversa({
      ultimaEntrada: null,
      ultimaSaida: "2026-09-26T12:00:00Z",
      saidaVia: "crm",
      saidaPor: "u-juliana",
    })!;
    expect(rotuloDaBola(b, { agora, usuarioAtualId: "u-juliana" })).toBe("Você há 4 dias");
    expect(
      rotuloDaBola(b, { agora, usuarioAtualId: "u-marcos", nomeDoUsuario: () => "Juliana Prado" }),
    ).toBe("Juliana há 4 dias");
    expect(quemFalouRotulo(b, { usuarioAtualId: "u-marcos" })).toBe("Equipe");
  });

  it("sem mensagem nenhuma não há bola", () => {
    expect(bolaDaConversa({ ultimaEntrada: null, ultimaSaida: null, saidaVia: null, saidaPor: null })).toBeNull();
  });
});

describe("próximo compromisso: o quê · onde · quando", () => {
  // quarta, 30/09/2026 12:00 em São Paulo
  const agora = new Date("2026-09-30T15:00:00Z");
  const base: CompromissoDoCartao = {
    id: "a1",
    titulo: "Visita — Mariana",
    tipo: "Visita ao decorado",
    localTipo: "in_person",
    localDetalhe: "Jardim das Flores",
    inicio: "2026-10-03T13:00:00Z", // sáb 03/10 10h em SP
    fim: "2026-10-03T14:00:00Z",
    fuso: "America/Sao_Paulo",
    situacao: "confirmed",
    leadIds: [],
  };

  it("a frase do protótipo", () => {
    expect(textoDoProximoCompromisso(base, agora).texto).toBe(
      "Visita ao decorado · Jardim das Flores · sáb 03/10 10h",
    );
  });

  it("hoje e amanhã pelo nome, no fuso do compromisso", () => {
    expect(quandoDoCompromisso("2026-09-30T19:00:00Z", "America/Sao_Paulo", agora)).toBe("hoje 16h");
    expect(quandoDoCompromisso("2026-10-01T13:30:00Z", "America/Sao_Paulo", agora)).toBe("amanhã 10h30");
    expect(textoDoProximoCompromisso({ ...base, inicio: "2026-09-30T19:00:00Z" }, agora).hoje).toBe(true);
  });

  it("outro ano leva o ano", () => {
    expect(quandoDoCompromisso("2027-01-08T13:00:00Z", "America/Sao_Paulo", agora)).toBe("sex 08/01/2027 10h");
  });

  it("onde: o detalhe; sem ele, o tipo de local que diz onde; 'Presencial' sozinho não", () => {
    expect(ondeDoCompromisso({ localTipo: "phone", localDetalhe: null })).toBe("Telefone");
    expect(ondeDoCompromisso({ localTipo: "in_person", localDetalhe: " " })).toBeNull();
    expect(textoDoProximoCompromisso({ ...base, localDetalhe: null }, agora).texto).toBe(
      "Visita ao decorado · sáb 03/10 10h",
    );
  });

  it("sem tipo, o título que a pessoa escreveu", () => {
    expect(textoDoProximoCompromisso({ ...base, tipo: null }, agora).oQue).toBe("Visita — Mariana");
  });

  it("hora curta", () => {
    expect(horaCurta(10, 0)).toBe("10h");
    expect(horaCurta(9, 5)).toBe("9h05");
  });

  it("escolhe o do negócio; sem ele, o do contato sem negócio; nunca o de OUTRO negócio", () => {
    const deOutro = { ...base, id: "outro", inicio: "2026-10-01T13:00:00Z", fim: "2026-10-01T14:00:00Z", leadIds: ["L2"] };
    const soltoTarde = { ...base, id: "solto", inicio: "2026-10-05T13:00:00Z", fim: "2026-10-05T14:00:00Z" };
    const doNegocio = { ...base, id: "meu", inicio: "2026-10-07T13:00:00Z", fim: "2026-10-07T14:00:00Z", leadIds: ["L1"] };
    expect(escolherProximoCompromisso([deOutro, soltoTarde, doNegocio], "L1", agora)?.id).toBe("meu");
    expect(escolherProximoCompromisso([deOutro, soltoTarde], "L1", agora)?.id).toBe("solto");
    expect(escolherProximoCompromisso([deOutro], "L1", agora)).toBeNull();
  });

  it("cancelado, realizado, falta e o que já terminou não são 'próximo'; o que está acontecendo é", () => {
    const passado = { ...base, id: "p", inicio: "2026-09-29T13:00:00Z", fim: "2026-09-29T14:00:00Z" };
    const cancelado = { ...base, id: "c", situacao: "cancelled" };
    const agoraMesmo = { ...base, id: "n", inicio: "2026-09-30T14:30:00Z", fim: "2026-09-30T15:30:00Z" };
    expect(escolherProximoCompromisso([passado, cancelado], "L1", agora)).toBeNull();
    expect(escolherProximoCompromisso([passado, agoraMesmo, base], "L1", agora)?.id).toBe("n");
  });
});

describe("fechamento previsto", () => {
  const agora = new Date(2026, 8, 30, 12, 0);

  it("a chance da IA vence a da etapa; sem as duas, não inventa zero", () => {
    expect(fechamentoPrevisto({ dataPrevista: "2026-10-31", probabilidadeIa: 78.4, probabilidadeEtapa: 40, aberto: true, agora })).toEqual({
      data: "31/10",
      atrasado: false,
      pct: 78,
      fonte: "ia",
    });
    expect(fechamentoPrevisto({ dataPrevista: null, probabilidadeIa: null, probabilidadeEtapa: 40, aberto: true, agora }).fonte).toBe("etapa");
    const nada = fechamentoPrevisto({ dataPrevista: null, probabilidadeIa: null, probabilidadeEtapa: null, aberto: true, agora });
    expect(nada.pct).toBeNull();
    expect(textoDoFechamento(nada)).toBe("Fechamento previsto sem data · sem chance calculada");
  });

  it("zero calculado é zero, não ausência", () => {
    expect(fechamentoPrevisto({ dataPrevista: null, probabilidadeIa: 0, probabilidadeEtapa: 50, aberto: true, agora }).pct).toBe(0);
  });

  it("data passada com o negócio aberto = atrasado; hoje não é atraso; outro ano leva o ano", () => {
    expect(fechamentoPrevisto({ dataPrevista: "2026-09-29", probabilidadeIa: null, probabilidadeEtapa: null, aberto: true, agora }).atrasado).toBe(true);
    expect(fechamentoPrevisto({ dataPrevista: "2026-09-30", probabilidadeIa: null, probabilidadeEtapa: null, aberto: true, agora }).atrasado).toBe(false);
    expect(fechamentoPrevisto({ dataPrevista: "2026-09-29", probabilidadeIa: null, probabilidadeEtapa: null, aberto: false, agora }).atrasado).toBe(false);
    expect(fechamentoPrevisto({ dataPrevista: "2027-02-10", probabilidadeIa: null, probabilidadeEtapa: null, aberto: true, agora }).data).toBe("10/02/2027");
  });
});

describe("identidade: empresa quando existe, pessoa quando não", () => {
  it("nome curto", () => {
    expect(nomeCurto("Mariana Costa")).toBe("Mariana C.");
    expect(nomeCurto("Renato")).toBe("Renato");
    expect(nomeCurto("  ")).toBeNull();
  });

  it("negócio de empresa leva a empresa; de pessoa, a pessoa", () => {
    expect(prefixoDoCartao({ titulo: "Sala comercial 42 m²", empresa: "Clínica Vida Plena", contato: "Carla Mendes" })).toBe("Clínica Vida Plena");
    expect(prefixoDoCartao({ titulo: "Apto 2 dorm", empresa: null, contato: "Mariana Costa" })).toBe("Mariana C.");
  });

  it("não repete quem o título já diz (o título que nasce da 1ª mensagem é o nome)", () => {
    expect(prefixoDoCartao({ titulo: "Mariana Costa", empresa: null, contato: "Mariana Costa" })).toBeNull();
    expect(prefixoDoCartao({ titulo: "Proposta Clínica Vida Plena", empresa: "Clinica Vida Plena", contato: null })).toBeNull();
    expect(prefixoDoCartao({ titulo: "Qualquer", empresa: null, contato: null })).toBeNull();
  });
});

describe("canal do negócio", () => {
  const lead = (over: Partial<Parameters<typeof canalDoNegocio>[0]> = {}) => ({
    source: "whatsapp",
    source_metadata: {},
    external_id: null,
    tags: [],
    description: null,
    ...over,
  });

  it("campanha vence anúncio", () => {
    expect(
      canalDoNegocio(lead({ source: "campanha", source_metadata: { campaign_name: "Setembro", ad_platform: "meta_ads" } }), null),
    ).toEqual({ sigla: "CAMPANHA", campanha: "Setembro" });
  });

  it("formulário da Meta pela prova do próprio negócio", () => {
    expect(canalDoNegocio(lead({ source: "meta_ads", external_id: "meta-lead:abc", source_metadata: { campaign_name: "Promo" } }), null)).toEqual({
      sigla: "FORM",
      campanha: "Promo",
    });
    expect(canalDoNegocio(lead({ source: "manual", tags: ["Formulario_Meta"] }), null).sigla).toBe("FORM");
  });

  it("clique no anúncio da Meta e do Google, com a campanha do metadata", () => {
    expect(canalDoNegocio(lead({ source: "meta_ads", source_metadata: { ad_title: "Vídeo tour" } }), null)).toEqual({
      sigla: "META",
      campanha: "Vídeo tour",
    });
    expect(canalDoNegocio(lead({ source: "google_ads" }), null).sigla).toBe("GOOGLE");
  });

  it("site e fonte de captação: a UTM decide Google/Meta/indicação", () => {
    expect(canalDoNegocio(lead({ source: "webhook", source_metadata: { utm_campaign: "Aurora" } }), null)).toEqual({
      sigla: "SITE",
      campanha: "Aurora",
    });
    expect(canalDoNegocio(lead({ source: "site", source_metadata: { gclid: "x" } }), null).sigla).toBe("GOOGLE");
    expect(canalDoNegocio(lead({ source: "webhook", source_metadata: { utm_source: "instagram", utm_medium: "paid" } }), null).sigla).toBe("META");
    expect(canalDoNegocio(lead({ source: "webhook", source_metadata: { utm_source: "indicacao" } }), null).sigla).toBe("INDIC");
  });

  it("prospecção leva a campanha da descrição; importação e WhatsApp direto", () => {
    expect(canalDoNegocio(lead({ source: "prospecting", description: "Campanha: Padarias BH" }), null)).toEqual({
      sigla: "ATIVO",
      campanha: "Padarias BH",
    });
    expect(canalDoNegocio(lead({ source: "importacao_planilha" }), null).sigla).toBe("IMPORT");
    expect(canalDoNegocio(lead(), null)).toEqual({ sigla: "DIRETO", campanha: null });
  });

  it("negócio criado à mão cai no 1º toque do contato; sem ele, MANUAL", () => {
    expect(
      canalDoNegocio(lead({ source: "manual" }), { source: "meta_ads", source_metadata: { campaign_name: "Studios" } }),
    ).toEqual({ sigla: "META", campanha: "Studios" });
    expect(canalDoNegocio(lead({ source: "automation" }), { source: "social", source_metadata: {} }).sigla).toBe("SOCIAL");
    expect(canalDoNegocio(lead({ source: "manual" }), { source: "manual", source_metadata: {} }).sigla).toBe("MANUAL");
    expect(canalDoNegocio(lead({ source: "Indicação do Paulo" }), null).sigla).toBe("INDIC");
  });

  it("negócio nascido no WhatsApp NÃO volta a olhar o contato", () => {
    expect(canalDoNegocio(lead({ source: "whatsapp" }), { source: "meta_ads", source_metadata: {} }).sigla).toBe("DIRETO");
  });
});
