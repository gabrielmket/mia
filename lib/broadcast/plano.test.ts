import { describe, expect, it } from "vitest";

import { deveParar, peneirar, podeComecar } from "@/lib/broadcast/plano";

/**
 * AS DECISÕES QUE CUSTAM DINHEIRO OU O NÚMERO.
 *
 * Cada caso aqui existe por um desfecho concreto: cobrar duas vezes, mandar
 * para quem pediu para sair, começar uma lista que não cabe, ou queimar um
 * número que já estava em vermelho. São os quatro jeitos de o MIA Broadcast
 * causar prejuízo de verdade.
 *
 *     npx vitest run lib/broadcast/plano.test.ts
 */

const valores = () => ({ "1": "Fulano" });

describe("a peneira da lista", () => {
  it("tira quem pediu para SAIR — é a regra que segura bloqueio", () => {
    const r = peneirar(
      [
        { id: "a", phone_number: "5531999990000" },
        { id: "b", phone_number: "5531999991111", is_blocked: true },
        {
          id: "c",
          phone_number: "5531999992222",
          consent: { marketing: { declined_at: "2026-09-01T00:00:00Z" } },
        },
      ],
      valores,
    );
    expect(
      r.enviar.map((d) => d.contactId),
      "quem pediu para não receber recebeu de novo: denúncia derruba o número inteiro, não só a mensagem",
    ).toEqual(["a"]);
    expect(r.semConsentimento, "bloqueado e recusa registrada contam os dois").toBe(2);
  });

  it("tira o contato PESSOAL (upstream 0563), e conta à parte", () => {
    const r = peneirar(
      [
        { id: "a", phone_number: "5531999990000" },
        { id: "mae", phone_number: "5531999993333", is_personal: true },
        // Controle: a marca desligada não tira ninguém.
        { id: "b", phone_number: "5531999994444", is_personal: false },
      ],
      valores,
    );
    expect(r.enviar.map((d) => d.contactId), "disparo comercial chegou a um contato pessoal").toEqual(["a", "b"]);
    expect(r.pessoais).toBe(1);
    expect(r.semConsentimento).toBe(0);
  });

  it("tira o telefone REPETIDO — cobraria duas vezes e mandaria duas vezes", () => {
    const r = peneirar(
      [
        { id: "a", phone_number: "5531999990000" },
        { id: "b", phone_number: "55 31 99999-0000" },
      ],
      valores,
    );
    expect(r.enviar).toHaveLength(1);
    expect(r.repetidos, "a mesma pessoa duas vezes na mesma campanha").toBe(1);
  });

  it("tira quem não tem telefone, e CONTA — lista que encolhe sem explicação parece defeito", () => {
    const r = peneirar(
      [
        { id: "a", phone_number: null },
        { id: "b", phone_number: "" },
        { id: "c", phone_number: "5531999992222" },
      ],
      valores,
    );
    expect(r.enviar).toHaveLength(1);
    expect(r.semTelefone).toBe(2);
  });
});

describe("pode começar?", () => {
  const base = {
    destinatarios: 100,
    saldoCents: 100_000,
    precoPorMensagemCents: 12,
    templateAprovado: true,
    temCanal: true,
    qualidade: "GREEN" as const,
  };

  it("com tudo em ordem, começa", () => {
    expect(podeComecar(base).pode).toBe(true);
  });

  it("lista vazia não começa — e o motivo diz isso, não 'saldo'", () => {
    const r = podeComecar({ ...base, destinatarios: 0 });
    expect(r.motivo).toBe("lista_vazia");
  });

  it("template não aprovado não começa — a Meta recusaria uma por uma, cobrando o tempo", () => {
    expect(podeComecar({ ...base, templateAprovado: false }).motivo).toBe("template_nao_aprovado");
  });

  it("número em VERMELHO não começa", () => {
    expect(
      podeComecar({ ...base, qualidade: "RED" }).motivo,
      "disparar em número vermelho acelera o desligamento pela Meta",
    ).toBe("numero_em_risco");
  });

  it("número AMARELO começa — a trava que se respeita é a que só barra o grave", () => {
    expect(
      podeComecar({ ...base, qualidade: "YELLOW" }).pode,
      "barrar no amarelo faz o operador desligar a trava, e aí ela não protege mais nada",
    ).toBe(true);
  });

  it("saldo que não cobre a lista não começa, e diz quanto falta", () => {
    const r = podeComecar({ ...base, saldoCents: 500, destinatarios: 100 });
    expect(r.motivo).toBe("saldo_insuficiente");
    expect(r.trava?.falta_cents, "sem o quanto falta, não dá para recarregar o valor certo").toBe(
      100 * 12 - 500,
    );
  });

  it("sem preço acordado não começa — e o motivo é OUTRO que saldo", () => {
    expect(podeComecar({ ...base, precoPorMensagemCents: null }).motivo).toBe("sem_preco_acordado");
  });
});

describe("deve parar no meio?", () => {
  it("segue enquanto couber mais uma", () => {
    expect(deveParar({ saldoCents: 12, precoPorMensagemCents: 12, qualidade: "GREEN" })).toBeNull();
  });

  it("para quando não cabe nem mais uma — é o que impede saldo negativo", () => {
    expect(deveParar({ saldoCents: 11, precoPorMensagemCents: 12, qualidade: "GREEN" })).toBe(
      "saldo_acabou",
    );
  });

  it("para se o número cair para VERMELHO no meio do disparo", () => {
    expect(deveParar({ saldoCents: 100_000, precoPorMensagemCents: 12, qualidade: "RED" })).toBe(
      "numero_em_risco",
    );
  });

  it("preço que sumiu no meio para o disparo em vez de mandar de graça", () => {
    expect(deveParar({ saldoCents: 100_000, precoPorMensagemCents: null, qualidade: "GREEN" })).toBe(
      "saldo_acabou",
    );
  });

  it("cortesia (preço zero) NÃO para por saldo — não há o que acabar", () => {
    expect(deveParar({ saldoCents: 0, precoPorMensagemCents: 0, qualidade: "GREEN" })).toBeNull();
  });
});
