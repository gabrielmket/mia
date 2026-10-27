/**
 * FORK MIA (.96) — O CARTÃO PASSA PELO SERVIDOR SÓ PARA CHEGAR AO ASAAS (decisão
 * 2a do protótipo "Pagamento no início", aprovado em 27/10/2026).
 *
 * Este arquivo REPROVA a versão se o número do cartão ou o código de segurança
 * aparecerem em qualquer registro: log (todo `console.*`, por onde o `logger`
 * sai), Sentry (captura de erro, mensagem e trilha), auditoria, escrita no banco,
 * erro lançado ou resposta devolvida à tela. Os caminhos medidos são os que
 * costumam vazar: o pagamento aprovado, a recusa do banco com a descrição do
 * Asaas ecoando o cartão, o `code` com cara de número, a rede que cai com o corpo
 * na mensagem do erro, a resposta que não é JSON e o cartão gravado na
 * assinatura para as próximas mensalidades.
 *
 * A outra metade (a rota e o passo do pagamento, com o banco dublado) está em
 * `tests/unit/pagamento-inicial-cartao-rota.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ chamadas: [] as unknown[] }));
vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => sentry.chamadas.push(a),
  captureMessage: (...a: unknown[]) => sentry.chamadas.push(a),
  addBreadcrumb: (...a: unknown[]) => sentry.chamadas.push(a),
  withScope: (f: (s: unknown) => void) => f({ setExtra: (...a: unknown[]) => sentry.chamadas.push(a), setTag: () => undefined }),
}));
vi.mock("@/lib/cobranca/provedores/base-de-teste", () => ({ baseDeTesteDaCobranca: () => null }));

import { cartaoNaAssinatura, pagarComCartao, type TitularDoCartao } from "@/lib/asaas-mia/cartao";
import { conferirCartao, type CartaoDigitado } from "@/lib/asaas-mia/cartao-regras";

const NUMERO = "4111111111111111";
const NUMERO_COM_ESPACOS = "4111 1111 1111 1111";
const CVV = "7391";
const CHAVE = ["$aact", "hmlg", "000000000000000000000000000000"].join("_");

const CARTAO: CartaoDigitado = { numero: NUMERO, nome: "FULANA DE TAL", mes: "12", ano: "2031", cvv: CVV };
const TITULAR: TitularDoCartao = {
  nome: "Clínica Exemplo Ltda",
  email: "admin@exemplo.com.br",
  documento: "11222333000181",
  cep: "30130010",
  numeroDoEndereco: "1500",
  complemento: null,
  telefone: "31988880000",
};

/** Tudo o que foi registrado em algum lugar, como texto. */
let registros: string[];
const espioes: Array<ReturnType<typeof vi.spyOn>> = [];

/** Texto de qualquer valor, inclusive a mensagem e a pilha de um erro (que o JSON comum esconde). */
function comoTexto(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, (_k, x: unknown) =>
      x instanceof Error ? { nome: x.name, mensagem: x.message, pilha: x.stack, ...(x as unknown as Record<string, unknown>) } : x,
    ) ?? String(v);
  } catch {
    return String(v);
  }
}

function registrado(...valores: unknown[]): void {
  for (const v of valores) registros.push(comoTexto(v));
}

/** A prova: nenhum registro tem o número (com ou sem espaço) nem o código de segurança. */
function nadaDoCartao(extra: unknown[] = []): void {
  registrado(...extra, ...sentry.chamadas);
  const tudo = registros.join("\n");
  expect(tudo, "o número do cartão apareceu num registro").not.toContain(NUMERO);
  expect(tudo, "o número do cartão apareceu num registro").not.toContain(NUMERO_COM_ESPACOS);
  expect(tudo, "o código de segurança apareceu num registro").not.toMatch(new RegExp(`(?<!\\d)${CVV}(?!\\d)`));
  expect(tudo, "um campo de código de segurança apareceu num registro").not.toMatch(/"(ccv|cvv)"/i);
}

let respostas: Array<(init: RequestInit) => Response | Promise<Response>>;
let enviados: string[];
const fetchFalso = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
  enviados.push(String(init?.body ?? ""));
  const proxima = respostas.shift();
  if (!proxima) return new Response("{}", { status: 200 });
  return proxima(init ?? {});
}) as unknown as typeof fetch;
const deps = { fetch: fetchFalso, lerChave: async () => CHAVE, esperar: async () => undefined, baseDeTeste: null };

beforeEach(() => {
  registros = [];
  enviados = [];
  respostas = [];
  sentry.chamadas = [];
  for (const nivel of ["log", "info", "warn", "error", "debug", "trace"] as const) {
    espioes.push(vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => registrado(...a)));
  }
});
afterEach(() => {
  for (const e of espioes.splice(0)) e.mockRestore();
});

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

describe("o cartão vai ao Asaas e a nenhum outro lugar", () => {
  it("controle: o cartão SAI para o Asaas (sem isto, o resto passaria por não ter enviado nada)", async () => {
    respostas = [() => json({ id: "pay_1", status: "CONFIRMED", creditCard: { creditCardNumber: "1111", creditCardBrand: "VISA", creditCardToken: "tok_1" } })];
    const r = await pagarComCartao({ pagamentoRef: "pay_1", cartao: CARTAO, titular: TITULAR }, deps);
    expect(enviados[0]).toContain(NUMERO);
    expect(enviados[0]).toContain(CVV);
    expect(r).toEqual({ tipo: "pago", final: "1111", bandeira: "VISA", token: "tok_1" });
    nadaDoCartao([r]);
  });

  it("⭐ recusa do banco com a descrição do Asaas ecoando o cartão: nem a descrição nem o cartão saem", async () => {
    respostas = [
      () => json({ errors: [{ code: "invalid_creditCard", description: `Transação não autorizada para o cartão ${NUMERO} cvv ${CVV}` }] }, 400),
    ];
    const r = await pagarComCartao({ pagamentoRef: "pay_1", cartao: CARTAO, titular: TITULAR }, deps);
    expect(r).toEqual({ tipo: "recusado", codigo: "invalid_creditCard" });
    nadaDoCartao([r]);
  });

  it("um `code` com cara de número de cartão vira 'recusado'", async () => {
    respostas = [() => json({ errors: [{ code: NUMERO }] }, 400)];
    const r = await pagarComCartao({ pagamentoRef: "pay_1", cartao: CARTAO, titular: TITULAR }, deps);
    expect(r).toEqual({ tipo: "recusado", codigo: "recusado" });
    nadaDoCartao([r]);
  });

  it("a rede cai com o corpo na mensagem do erro: o erro do fetch não sobe nem é registrado, e o pagamento NÃO é repetido", async () => {
    respostas = [
      (init) => {
        throw new TypeError(`fetch failed: ${String(init.body)}`);
      },
    ];
    const r = await pagarComCartao({ pagamentoRef: "pay_1", cartao: CARTAO, titular: TITULAR }, deps);
    expect(r).toEqual({ tipo: "falhou", codigo: "sem_resposta", transitorio: true });
    expect(enviados).toHaveLength(1);
    nadaDoCartao([r]);
  });

  it("5xx do Asaas: não repete o pagamento (um POST que caiu pode ter cobrado)", async () => {
    respostas = [() => json({ errors: [{ code: "x" }] }, 502), () => json({ id: "pay_1", status: "CONFIRMED" })];
    const r = await pagarComCartao({ pagamentoRef: "pay_1", cartao: CARTAO, titular: TITULAR }, deps);
    expect(r).toMatchObject({ tipo: "falhou", transitorio: true });
    expect(enviados).toHaveLength(1);
    nadaDoCartao([r]);
  });

  it("resposta que não é JSON (com o cartão no meio): a mensagem do JSON.parse não sai", async () => {
    respostas = [() => new Response(`<html>${NUMERO} ${CVV}</html>`, { status: 200 })];
    const r = await pagarComCartao({ pagamentoRef: "pay_1", cartao: CARTAO, titular: TITULAR }, deps);
    expect(r).toMatchObject({ tipo: "falhou", codigo: "resposta_invalida" });
    nadaDoCartao([r]);
  });

  it("o cartão gravado na assinatura (com token ou com o cartão) e a recusa dela também não deixam rastro", async () => {
    respostas = [() => json({ id: "sub_1" }), () => json({ id: "sub_1" })];
    const comToken = await cartaoNaAssinatura({ assinaturaRef: "sub_1", cartao: CARTAO, token: "tok_1", titular: TITULAR, ipRemoto: "200.1.2.3" }, deps);
    expect(comToken).toEqual({ ok: true });
    expect(enviados[0]).not.toContain(NUMERO);

    respostas = [
      () => json({}, 404),
      () => json({ errors: [{ code: "invalid_creditCard", description: `cartão ${NUMERO_COM_ESPACOS}` }] }, 400),
    ];
    const recusado = await cartaoNaAssinatura({ assinaturaRef: "sub_1", cartao: CARTAO, token: null, titular: TITULAR, ipRemoto: null }, deps);
    expect(recusado).toEqual({ ok: false, codigo: "invalid_creditCard" });
    nadaDoCartao([comToken, recusado]);
  });

  it("a conferência da tela recusa sem ecoar o que foi digitado", () => {
    const agora = new Date("2026-10-27T12:00:00Z");
    const ruins = [
      { numero: "4111 1111 1111 1112", nome: "X Y", validade: "12/31", cvv: CVV },
      { numero: NUMERO_COM_ESPACOS, nome: "", validade: "12/31", cvv: CVV },
      { numero: NUMERO_COM_ESPACOS, nome: "X Y", validade: "09/26", cvv: CVV },
      { numero: NUMERO_COM_ESPACOS, nome: "X Y", validade: "12/31", cvv: "12" },
    ];
    const resultados = ruins.map((c) => conferirCartao(c, agora));
    expect(resultados.map((r) => (r.ok ? "ok" : r.motivo))).toEqual(["numero_invalido", "nome_obrigatorio", "validade_invalida", "cvv_invalido"]);
    nadaDoCartao(resultados);
    expect(conferirCartao({ numero: NUMERO_COM_ESPACOS, nome: " Fulana  de Tal ", validade: "12/2031", cvv: CVV }, agora)).toEqual({
      ok: true,
      cartao: { numero: NUMERO, nome: "Fulana de Tal", mes: "12", ano: "2031", cvv: CVV },
    });
  });
});
