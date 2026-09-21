import { describe, expect, it } from "vitest";

import { lerChegada } from "./chegada-do-cadastro";

/**
 * A CONTA QUE CHEGA PELO LOGIN NÃO PODE SER AMARRADA NO ESCURO.
 *
 * Este arquivo lê o aviso da Meta de que um cliente terminou o cadastro
 * incorporado. Ele NÃO decide de quem a conta é — e essa recusa é a feature:
 * o link é da instalação, não do tenant, então dois clientes que entrem na
 * mesma tarde chegam indistinguíveis aqui. Amarrar o número errado ao tenant
 * errado faz a conversa de um cliente sair pelo número de outro.
 *
 * O que ele precisa acertar é o resto: reconhecer o evento certo, tolerar as
 * duas formas que a Meta usa, e recusar payload sem a chave natural.
 *
 *     npx vitest run lib/channels/meta/chegada-do-cadastro.test.ts
 */

describe("o aviso de que o cliente terminou o cadastro", () => {
  it("lê a conta e o número quando vêm em `phone_numbers[]`", () => {
    const c = lerChegada("account_update", "WABA-DA-ENTRY", {
      business_name: "Padaria do Zé",
      phone_numbers: [{ id: "PN-1", display_phone_number: "+55 31 99999-8888" }],
    });

    expect(c?.wabaId).toBe("WABA-DA-ENTRY");
    expect(c?.businessName).toBe("Padaria do Zé");
    expect(c?.phoneNumberId).toBe("PN-1");
    expect(c?.phoneNumber).toBe("+55 31 99999-8888");
  });

  it("lê a forma PLANA, que é como o outro evento chega", () => {
    const c = lerChegada("partner_added", "", {
      waba_id: "WABA-9",
      phone_number_id: "PN-9",
      display_phone_number: "+55 11 90000-0000",
    });

    expect(
      c?.wabaId,
      "só uma das duas formas foi tratada: o evento que chega na outra some sem rastro, e o cliente espera um número que ninguém viu chegar",
    ).toBe("WABA-9");
    expect(c?.phoneNumberId).toBe("PN-9");
  });

  it("IGNORA campo que não é chegada — mensagem e status passam por aqui", () => {
    expect(lerChegada("messages", "WABA-1", { messages: [] })).toBeNull();
    expect(lerChegada("message_template_status_update", "WABA-1", {})).toBeNull();
  });

  it("RECUSA aviso sem WABA — seria uma linha que o operador vê e não consegue amarrar", () => {
    expect(lerChegada("account_update", "", { business_name: "Sem conta" })).toBeNull();
  });

  it("guarda o payload CRU junto, porque a Meta muda esse formato sem avisar", () => {
    const valor = { waba_id: "W", campo_que_ainda_nao_existe: 42 };
    const c = lerChegada("account_update", "", valor);
    expect(
      c?.payload,
      "sem o payload inteiro, o dado que a gente ainda não sabe ler se perde — e a única saída vira pedir ao cliente que refaça o cadastro",
    ).toEqual(valor);
  });

  it("aguenta conta sem número — a Meta às vezes avisa a conta antes", () => {
    const c = lerChegada("account_update", "W-1", { business_name: "Só a conta" });
    expect(c?.wabaId).toBe("W-1");
    expect(
      c?.phoneNumberId,
      "descartar a chegada por falta do número perderia o aviso; a linha fica e a próxima notificação a completa",
    ).toBeNull();
  });
});

/**
 * O PAYLOAD REAL, o que a produção mandou de verdade.
 *
 * Os casos acima foram escritos a partir da documentação. Em 21/09/2026, às
 * 16:02, a primeira conta chegou — e não tinha nenhuma das formas previstas.
 * O id verdadeiro estava aninhado em `waba_info`, e a leitura caiu no
 * `entry.id` do envelope, gravando um id que não existe na Meta. O operador
 * ficou com uma conta "esperando" que ele não conseguia amarrar nem conferir.
 *
 * Este bloco fixa o formato medido. Ele não substitui os de cima: os dois
 * convivem porque a Meta manda os dois.
 */
describe("o formato que a Meta mandou de verdade (21/09/2026)", () => {
  const PAYLOAD_MEDIDO = {
    event: "PARTNER_ADDED",
    waba_info: {
      waba_id: "1581083259892231",
      owner_business_id: "439722284553697",
    },
  };

  it("lê o id de dentro de waba_info, e não o do envelope", () => {
    const chegada = lerChegada("partner_added", "1286133054811827", PAYLOAD_MEDIDO);

    expect(chegada).not.toBeNull();
    // O id do envelope é justamente o que estava sendo gravado errado.
    expect(chegada?.wabaId).toBe("1581083259892231");
    expect(chegada?.wabaId).not.toBe("1286133054811827");
  });

  it("guarda o portfólio do cliente, a única pista de dono que este evento traz", () => {
    expect(lerChegada("partner_added", "x", PAYLOAD_MEDIDO)?.ownerBusinessId).toBe(
      "439722284553697",
    );
  });

  it("admite que não veio número — é o que obriga a buscar na Graph antes de amarrar", () => {
    const chegada = lerChegada("partner_added", "x", PAYLOAD_MEDIDO);
    expect(chegada?.phoneNumberId).toBeNull();
    expect(chegada?.phoneNumber).toBeNull();
  });

  it("continua caindo no envelope quando o evento não tem waba_info", () => {
    // `account_update` traz o id no próprio envelope, e ali o fallback está certo.
    expect(lerChegada("account_update", "1607115514160063", { event: "VERIFIED" })?.wabaId).toBe(
      "1607115514160063",
    );
  });
});
