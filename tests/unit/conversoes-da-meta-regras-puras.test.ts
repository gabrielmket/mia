/**
 * FORK MIA (9017) — AS REGRAS PURAS DAS CONVERSÕES DA META POR ETAPA.
 *
 * O vocabulário (eventos, canais, valor), o recomendado pelo nome da etapa, a
 * sequência "como a Meta vai enxergar o funil", a situação de cada envio e a
 * regra de quando o "Reenviar" resolve. Tudo sem banco e sem rede: são os
 * módulos que a tela (cliente), o consumidor e a ferramenta do MCP leem.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  aplicarRecomendado,
  chaveDoEventoNoLivro,
  CHAVES_DOS_EVENTOS_DA_META,
  ehEventoDaMetaNoLivro,
  eventoNoLivro,
  eventoRecomendado,
  EVENTOS_DA_META,
  passosDoFunil,
  regraInicial,
  rotuloDoEventoDaMetaNoLivro,
  valorDoEvento,
  type RegraDaEtapa,
} from "@/lib/conversoes-meta/eventos";
import {
  MOTIVO_DA_META_LEGIVEL,
  reenvioDoEnvio,
  ROTULO_DA_SITUACAO,
  SITUACOES_DE_ENVIO,
  situacaoDoEnvio,
} from "@/lib/conversoes-meta/situacao";
import { ehEventoDeEtapa } from "@/lib/conversoes/regras-google";

const RAIZ = process.cwd();

describe("os eventos, num lugar só", () => {
  it("são os cinco do protótipo, com o nome técnico que a documentação da Meta confirmou", () => {
    expect(EVENTOS_DA_META.map((e) => [e.chave, e.nomeTecnico, e.naListaDaMensagem])).toEqual([
      ["novo_lead", "LeadSubmitted", true],
      ["lead_qualificado", "QualifiedLead", true],
      ["agendou", "Schedule", false],
      ["pediu_orcamento", "SubmitApplication", false],
      ["iniciou_compra", "InitiateCheckout", true],
    ]);
  });

  it("o CHECK da migration repete exatamente as chaves do código", () => {
    const sql = readFileSync(
      path.join(RAIZ, "supabase/migrations-mia/20261002090000_9017_conversoes_da_meta_por_etapa.sql"),
      "utf8",
    );
    const lista = /check \(evento in \(([^)]+)\)\)/.exec(sql)?.[1] ?? "";
    expect(lista.split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([...CHAVES_DOS_EVENTOS_DA_META]);
  });

  it("o nome técnico não está escrito em nenhum outro arquivo de produção", () => {
    // A lista mora num lugar só. Um segundo `"SubmitApplication"` espalhado por
    // um transporte ou por uma tela trocaria de nome num lugar e não no outro.
    const fora = [
      "lib/conversoes-meta/etapa.handler.ts",
      "lib/plataformas-de-anuncio/meta/eventos-do-funil.ts",
      "lib/implantacao/conversoes.ts",
      "app/app/settings/conversoes/_regrasMeta.tsx",
    ];
    for (const arquivo of fora) {
      const codigo = readFileSync(path.join(RAIZ, arquivo), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const e of EVENTOS_DA_META) {
        expect(codigo.includes(`"${e.nomeTecnico}"`), `${arquivo} escreve ${e.nomeTecnico} à mão`).toBe(false);
      }
    }
  });
});

describe("a chave do livro-razão", () => {
  it("é por EVENTO (e não por etapa): é o que faz o repetido não duplicar", () => {
    expect(eventoNoLivro("agendou")).toBe("Meta:agendou");
    expect(chaveDoEventoNoLivro("Meta:agendou")).toBe("agendou");
    expect(ehEventoDaMetaNoLivro("Meta:lead_qualificado")).toBe(true);
  });

  it("não se confunde com os eventos do Google nem com a compra", () => {
    for (const nome of ["Purchase", "QualifiedLead", "Etapa:11111111-1111-4111-8111-111111111111", "", null, 7]) {
      expect(ehEventoDaMetaNoLivro(nome), String(nome)).toBe(false);
      expect(chaveDoEventoNoLivro(nome)).toBeNull();
    }
    // E o consumidor de etapa do Google não reconhece os nossos como dele.
    for (const e of EVENTOS_DA_META) expect(ehEventoDeEtapa(eventoNoLivro(e.chave))).toBe(false);
  });

  it("evento que a lista não conhece mais não vira chave", () => {
    expect(ehEventoDaMetaNoLivro("Meta:evento_extinto")).toBe(true);
    expect(chaveDoEventoNoLivro("Meta:evento_extinto")).toBeNull();
  });

  it("o rótulo: a compra e os eventos de etapa têm nome; o que é do Google devolve nulo", () => {
    expect(rotuloDoEventoDaMetaNoLivro("Purchase")).toBe("Compra");
    expect(rotuloDoEventoDaMetaNoLivro("Meta:pediu_orcamento")).toBe("Pediu orçamento ou proposta");
    expect(rotuloDoEventoDaMetaNoLivro("QualifiedLead")).toBeNull();
  });
});

describe("usar o recomendado", () => {
  it("pelo lugar e pelo nome da etapa", () => {
    expect(eventoRecomendado("Qualquer nome", true)).toBe("novo_lead");
    expect(eventoRecomendado("Qualificação", false)).toBe("lead_qualificado");
    expect(eventoRecomendado("Avaliação agendada", false)).toBe("agendou");
    expect(eventoRecomendado("Visita ao decorado", false)).toBe("agendou");
    expect(eventoRecomendado("Reunião marcada", false)).toBe("agendou");
    expect(eventoRecomendado("Proposta enviada", false)).toBe("pediu_orcamento");
    expect(eventoRecomendado("Orçamento enviado", false)).toBe("pediu_orcamento");
    expect(eventoRecomendado("Compareceu", false)).toBeNull();
  });

  it("\"Iniciou a compra\" nunca é recomendado", () => {
    for (const nome of ["Negociação", "Fechamento", "Checkout", "Documentação", "Pagamento"]) {
      expect(eventoRecomendado(nome, false)).not.toBe("iniciou_compra");
    }
  });

  it("liga a etapa recomendada, zera o valor quando troca de evento e desliga a que não tem recomendação", () => {
    const comValor: RegraDaEtapa = {
      ligada: false,
      evento: "iniciou_compra",
      canal: "whatsapp",
      modoDoValor: "valor_fixo",
      valorFixoCentavos: 15000,
    };
    expect(aplicarRecomendado(comValor, "Avaliação agendada", false)).toEqual({
      ligada: true,
      evento: "agendou",
      canal: "whatsapp", // o canal fica como estava
      modoDoValor: "sem_valor",
      valorFixoCentavos: null,
    });
    // O evento já era o recomendado: só liga, e o valor configurado fica.
    const jaCerto: RegraDaEtapa = { ...comValor, evento: "agendou" };
    expect(aplicarRecomendado(jaCerto, "Avaliação agendada", false)).toEqual({ ...jaCerto, ligada: true });
    expect(aplicarRecomendado({ ...comValor, ligada: true }, "Compareceu", false).ligada).toBe(false);
  });

  it("a regra nasce desligada, para todos os canais e SEM valor", () => {
    expect(regraInicial("Novo contato", 0)).toEqual({
      ligada: false,
      evento: "novo_lead",
      canal: "todos",
      modoDoValor: "sem_valor",
      valorFixoCentavos: null,
    });
  });
});

describe("o valor do evento de etapa", () => {
  it("sem valor, valor fixo e valor do negócio", () => {
    expect(valorDoEvento({ modoDoValor: "sem_valor", valorFixoCentavos: null }, 990000)).toBeNull();
    expect(valorDoEvento({ modoDoValor: "valor_fixo", valorFixoCentavos: 15000 }, 990000)).toBe(15000);
    expect(valorDoEvento({ modoDoValor: "valor_do_negocio", valorFixoCentavos: null }, 990000)).toBe(990000);
  });

  it("valor do negócio num negócio sem valor: o evento sai SEM valor, nunca com zero", () => {
    expect(valorDoEvento({ modoDoValor: "valor_do_negocio", valorFixoCentavos: null }, null)).toBeNull();
    expect(valorDoEvento({ modoDoValor: "valor_do_negocio", valorFixoCentavos: null }, 0)).toBeNull();
    expect(valorDoEvento({ modoDoValor: "valor_fixo", valorFixoCentavos: 0 }, 100)).toBeNull();
  });
});

describe("como a Meta vai enxergar o funil", () => {
  const etapas = [
    { id: "a", nome: "Novo contato" },
    { id: "b", nome: "Qualificação" },
    { id: "c", nome: "Avaliação agendada" },
    { id: "d", nome: "Compareceu" },
  ];
  const regra = (over: Partial<RegraDaEtapa>): RegraDaEtapa => ({
    ligada: true,
    evento: "lead_qualificado",
    canal: "todos",
    modoDoValor: "sem_valor",
    valorFixoCentavos: null,
    ...over,
  });

  it("só as etapas ligadas, na ordem do funil", () => {
    const passos = passosDoFunil(etapas, {
      a: regra({ evento: "novo_lead" }),
      b: regra({ ligada: false }),
      c: regra({ evento: "agendou", canal: "whatsapp", modoDoValor: "valor_fixo", valorFixoCentavos: 15000 }),
    });
    expect(passos.map((p) => [p.etapa, p.evento, p.repetido])).toEqual([
      ["Novo contato", "novo_lead", false],
      ["Avaliação agendada", "agendou", false],
    ]);
  });

  it("o mesmo evento em duas etapas: a segunda é marcada como repetida (a tela avisa, não bloqueia)", () => {
    const passos = passosDoFunil(etapas, { b: regra({}), d: regra({}) });
    expect(passos.map((p) => [p.etapa, p.repetido])).toEqual([
      ["Qualificação", false],
      ["Compareceu", true],
    ]);
  });
});

describe("a situação de cada envio", () => {
  it("as seis do protótipo, mais a conexão", () => {
    expect([...SITUACOES_DE_ENVIO]).toEqual([
      "enviado",
      "aguardando",
      "recusado",
      "sem_clique",
      "sem_valor",
      "anterior_a_regra",
      "conexao",
    ]);
    expect(ROTULO_DA_SITUACAO.sem_clique).toBe("Não enviado · sem clique de anúncio");
    expect(ROTULO_DA_SITUACAO.sem_valor).toBe("Não enviado · sem valor");
    expect(ROTULO_DA_SITUACAO.anterior_a_regra).toBe("Não enviado · anterior à regra");
  });

  it("cada par status e motivo cai numa situação só", () => {
    const casos: Array<[string, string | null, string]> = [
      ["sent", null, "enviado"],
      ["error", "recusado_pela_plataforma", "recusado"],
      ["skipped", "aguardando_processamento", "aguardando"],
      ["skipped", "nova_tentativa_agendada", "aguardando"],
      ["skipped", "reprocessamento_solicitado", "aguardando"],
      ["skipped", "processamento_demorado", "aguardando"],
      ["skipped", "formulario_desligado", "sem_clique"],
      ["skipped", "sem_atribuicao", "sem_clique"],
      ["skipped", "sem_valor", "sem_valor"],
      ["skipped", "anterior_a_regra", "anterior_a_regra"],
      ["skipped", "anterior_a_chave", "anterior_a_regra"],
      ["skipped", "sem_conexao", "conexao"],
      ["skipped", "conexao_desabilitada", "conexao"],
      ["skipped", "credencial_incompleta", "conexao"],
      ["skipped", "evento_de_teste", "conexao"],
      ["skipped", null, "conexao"],
    ];
    for (const [status, motivo, esperado] of casos) {
      expect(situacaoDoEnvio(status, motivo), `${status}/${motivo}`).toBe(esperado);
    }
  });

  it("os motivos novos têm frase para quem opera", () => {
    for (const motivo of ["formulario_desligado", "anterior_a_regra", "anterior_a_chave"]) {
      expect(MOTIVO_DA_META_LEGIVEL[motivo]?.length ?? 0, motivo).toBeGreaterThan(20);
    }
  });
});

describe("o Reenviar só aparece onde resolve", () => {
  const agora = new Date("2026-10-01T12:00:00Z");
  const envio = (over: Record<string, unknown>) => ({
    plataforma: "meta_ads",
    status: "error",
    motivo: "recusado_pela_plataforma" as string | null,
    ocorridoEm: "2026-09-30T12:00:00Z" as string | null,
    tentadoEm: "2026-09-30T12:00:01Z",
    ...over,
  });

  it("recusado, sem valor e conexão: reenvia", () => {
    expect(reenvioDoEnvio(envio({}), agora)).toEqual({ pode: true });
    expect(reenvioDoEnvio(envio({ status: "skipped", motivo: "sem_valor" }), agora)).toEqual({ pode: true });
    expect(reenvioDoEnvio(envio({ status: "skipped", motivo: "conexao_desabilitada" }), agora)).toEqual({ pode: true });
  });

  it("evento da Meta com mais de 7 dias: não há reenvio que resolva, e a tela diz", () => {
    expect(reenvioDoEnvio(envio({ ocorridoEm: "2026-09-18T17:30:00Z" }), agora)).toEqual({
      pode: false,
      porque: "passou_de_7_dias",
    });
    // Sem o retrato (linha antiga), vale a última tentativa.
    expect(reenvioDoEnvio(envio({ ocorridoEm: null, tentadoEm: "2026-09-20T00:00:00Z" }), agora)).toEqual({
      pode: false,
      porque: "passou_de_7_dias",
    });
    // O Google não tem esse teto curto.
    expect(reenvioDoEnvio(envio({ plataforma: "google_ads", ocorridoEm: "2026-09-01T00:00:00Z" }), agora)).toEqual({
      pode: true,
    });
  });

  it("enviado, na fila, sem clique e anterior à regra: sem botão", () => {
    expect(reenvioDoEnvio(envio({ status: "sent", motivo: null }), agora)).toEqual({ pode: false, porque: "ja_enviado" });
    expect(reenvioDoEnvio(envio({ status: "skipped", motivo: "nova_tentativa_agendada" }), agora)).toEqual({
      pode: false,
      porque: "na_fila",
    });
    for (const motivo of ["formulario_desligado", "anterior_a_regra", "anterior_a_chave"]) {
      expect(reenvioDoEnvio(envio({ status: "skipped", motivo }), agora)).toEqual({ pode: false, porque: "nao_resolve" });
    }
  });

  it("a plataforma não concluiu em 24h: conferir de novo é o que a mensagem pede", () => {
    expect(
      reenvioDoEnvio(envio({ plataforma: "google_ads", status: "skipped", motivo: "processamento_demorado" }), agora),
    ).toEqual({ pode: true });
  });
});
