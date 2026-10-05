/**
 * FORK MIA (.62) — o telefone perguntado numa pergunta PRÓPRIA do formulário.
 *
 * O caso real: o formulário da Construtora Delta não usa o campo padrão `phone_number`
 * da Meta; o celular é uma pergunta criada por eles, e a chave que a Meta
 * devolve é `celular:_(ddd_+_número)`. O mapeador da fonte de webhook só acha
 * telefone por chave exata, e o lead entrava sem telefone.
 *
 * O que se prova, sem rede nem banco (`campos-do-formulario.ts` + `mapear.ts`,
 * e o `mapInboundPayload` de verdade no fim):
 *
 *   1. a pergunta própria que fala em celular, telefone, WhatsApp ou fone é
 *      reconhecida, pela chave ou pelo texto;
 *   2. a resposta vira E.164 brasileiro com o nono dígito, como o resto do
 *      sistema grava (`normalizePhoneBR` + `canonicalPhoneBR`);
 *   3. resposta que não é telefone não vira telefone, e o sistema tenta a
 *      próxima pergunta;
 *   4. a escolha manual vence o automático, e a escolha com resposta inválida
 *      cai no automático em vez de deixar o contato sem telefone;
 *   5. nome e e-mail em pergunta própria, sem confundir "nome da empresa".
 */
import { describe, expect, it } from "vitest";

import {
  perguntaPareceDoPapel,
  sugestaoPelasPerguntas,
} from "@/lib/leads-da-meta/campos-do-formulario";
import {
  limparTelefone,
  prepararParaMapear,
  telefoneDaResposta,
  type LeadDaMeta,
} from "@/lib/leads-da-meta/mapear";
import { mapInboundPayload } from "@/lib/webhooks/inbound";

function lead(campos: Record<string, string>): LeadDaMeta {
  return {
    leadgenId: "900001",
    criadoEm: null,
    formId: "f1",
    adId: null,
    adName: null,
    adsetId: null,
    adsetName: null,
    campaignId: null,
    campaignName: null,
    organico: null,
    plataforma: null,
    campos: Object.entries(campos).map(([chave, valor]) => ({ chave, valor })),
  };
}

/** O caminho inteiro que `gravarLeadDaMeta` faz: preparar e mapear. */
function mapear(
  campos: Record<string, string>,
  perguntas: Record<string, string> = {},
  escolha: Parameters<typeof prepararParaMapear>[2] = {},
) {
  const p = prepararParaMapear(lead(campos), perguntas, escolha);
  return { ...mapInboundPayload(p.payload, p.mapa), usados: p.campos };
}

const PERGUNTAS_DA_CONSTRUTORA = {
  full_name: "Nome completo",
  "celular:_(ddd_+_número)": "Celular (DDD + número)",
  "qual_o_seu_interesse?": "Qual o seu interesse?",
};

describe("a pergunta própria é reconhecida", () => {
  it("pela chave da Construtora Delta, com acento, dois-pontos e parênteses", () => {
    expect(perguntaPareceDoPapel("telefone", "celular:_(ddd_+_número)")).toBe(true);
  });

  it("pelo texto, quando a chave não diz nada", () => {
    expect(perguntaPareceDoPapel("telefone", "pergunta_3", "Qual o seu WhatsApp?")).toBe(true);
    expect(perguntaPareceDoPapel("telefone", "p4", "Telefone para contato")).toBe(true);
    expect(perguntaPareceDoPapel("telefone", "p5", "Fone")).toBe(true);
  });

  it("e não confunde pergunta que não é telefone", () => {
    expect(
      perguntaPareceDoPapel("telefone", "qual_o_seu_interesse?", "Qual o seu interesse?"),
    ).toBe(false);
    expect(perguntaPareceDoPapel("telefone", "telefonia", "Você trabalha com telefonia?")).toBe(
      false,
    );
  });

  it("a tela mostra o que o automático escolheria, antes de qualquer lead", () => {
    expect(sugestaoPelasPerguntas(PERGUNTAS_DA_CONSTRUTORA)).toEqual({
      telefone: "celular:_(ddd_+_número)",
      nome: "full_name",
      email: null,
    });
  });
});

describe("a resposta vira E.164 brasileiro, com o nono dígito", () => {
  it.each([
    ["(11) 98765-4321", "+5511987654321"],
    ["11987654321", "+5511987654321"],
    ["011 98765-4321", "+5511987654321"],
    ["+55 11 98765-4321", "+5511987654321"],
    ["5511987654321", "+5511987654321"],
    // Celular antigo, sem o nono dígito: o sistema grava COM ele, como no resto.
    ["(31) 8765-4321", "+5531987654321"],
  ])("%s → %s", (digitado, esperado) => {
    expect(telefoneDaResposta(digitado)).toBe(esperado);
  });

  it("o que não tem DDD e número não é telefone", () => {
    expect(telefoneDaResposta("98765-4321")).toBeNull();
    expect(telefoneDaResposta("de manhã")).toBeNull();
    expect(telefoneDaResposta("")).toBeNull();
  });

  it("o zero da frente sai; o `+` de quem digitou o país fica", () => {
    expect(limparTelefone("011 98765-4321")).toBe("11987654321");
    expect(limparTelefone("+55 (11) 98765-4321")).toBe("+55 (11) 98765-4321");
  });
});

describe("o lead da Construtora Delta chega com telefone", () => {
  it("o celular da pergunta própria vira o telefone do contato", () => {
    const m = mapear(
      {
        full_name: "Ana Souza",
        "celular:_(ddd_+_número)": "(11) 98765-4321",
        "qual_o_seu_interesse?": "2 quartos",
      },
      PERGUNTAS_DA_CONSTRUTORA,
    );
    expect(m.phone).toBe("+5511987654321");
    expect(m.name).toBe("Ana Souza");
    // A resposta do celular foi consumida; a outra pergunta continua nos campos.
    expect(m.custom_fields).toEqual({ "qual_o_seu_interesse?": "2 quartos" });
    expect(m.usados.telefone).toBe("celular:_(ddd_+_número)");
  });

  it("resposta que não é telefone é pulada, e a próxima pergunta serve", () => {
    const m = mapear(
      {
        "melhor_horário_para_ligar_no_seu_telefone?": "de manhã",
        "whatsapp:": "31 99999-0001",
      },
      {
        "melhor_horário_para_ligar_no_seu_telefone?": "Melhor horário para ligar no seu telefone?",
        "whatsapp:": "WhatsApp",
      },
    );
    expect(m.phone).toBe("+5531999990001");
    expect(m.custom_fields).toEqual({ "melhor_horário_para_ligar_no_seu_telefone?": "de manhã" });
  });

  it("o formulário com o campo padrão continua como era", () => {
    const m = mapear({
      full_name: "Bia",
      phone_number: "+5531999990002",
      email: "bia@exemplo.com",
    });
    expect(m).toMatchObject({ name: "Bia", phone: "+5531999990002", email: "bia@exemplo.com" });
  });
});

describe("a escolha manual", () => {
  const perguntas = {
    phone_number: "Telefone",
    celular_do_responsável: "Celular do responsável",
  };
  const respostas = {
    phone_number: "+5531999990003",
    celular_do_responsável: "(31) 99999-0004",
  };

  it("vence o campo padrão quando o administrador escolheu outra pergunta", () => {
    const m = mapear(respostas, perguntas, { telefone: "celular_do_responsável" });
    expect(m.phone).toBe("+5531999990004");
  });

  it("sem escolha, o campo padrão da Meta vem primeiro", () => {
    expect(mapear(respostas, perguntas).phone).toBe("+5531999990003");
  });

  it("escolha com resposta que não é telefone cai no automático", () => {
    const m = mapear({ ...respostas, celular_do_responsável: "não tenho" }, perguntas, {
      telefone: "celular_do_responsável",
    });
    expect(m.phone).toBe("+5531999990003");
  });
});

describe("nome e e-mail em pergunta própria", () => {
  it("'Qual é o seu nome?' é o nome; 'Nome da empresa' não é", () => {
    const m = mapear(
      {
        nome_da_empresa: "Padaria Central",
        "qual_é_o_seu_nome?": "Carlos",
        "seu_e-mail": "carlos@exemplo.com",
        celular: "31999990005",
      },
      {
        nome_da_empresa: "Nome da empresa",
        "qual_é_o_seu_nome?": "Qual é o seu nome?",
        "seu_e-mail": "Seu e-mail",
        celular: "Celular",
      },
    );
    expect(m).toMatchObject({
      name: "Carlos",
      email: "carlos@exemplo.com",
      phone: "+5531999990005",
    });
    expect(m.custom_fields).toEqual({ nome_da_empresa: "Padaria Central" });
  });

  it("e-mail escolhido com resposta inválida não vira e-mail", () => {
    const m = mapear(
      { full_name: "Duda", contato: "sem email" },
      { contato: "Seu e-mail" },
      {
        email: "contato",
      },
    );
    expect(m.usados.email).toBeNull();
  });
});
