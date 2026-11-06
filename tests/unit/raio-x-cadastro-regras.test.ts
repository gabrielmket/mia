/**
 * FORK MIA (.106) · O CADASTRO DO RAIO-X GRÁTIS: as regras puras
 * (`lib/raio-x/cadastro.ts`) e a entrada sem senha (`lib/raio-x/acesso.ts`).
 *
 *  1. a VALIDAÇÃO do formulário do site: cada campo, os padrões, a recusa pelos
 *     CAMPOS (nunca o valor) e o que vem a mais;
 *  2. a ARMADILHA `site`: preenchida, recusa sem olhar o resto;
 *  3. o `retorno_erro`: só o site (https://iamia.com.br e www) ou a página do
 *     sistema, e o `?erro=` que volta;
 *  4. o CÓDIGO de 6 números: forma, hash (nunca o código), amarrado à conta;
 *  5. o COOKIE da área: assinado, com validade, e adulterado não vale;
 *  6. a ORIGEM dos POST da área.
 *
 * Dados fictícios.
 */
import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  process.env.INTERNAL_SECRET = "segredo-do-teste-do-raio-x";
  return {};
});
void env;

import {
  assinarSessao,
  codigoConfere,
  gerarCodigoDeAcesso,
  hashDoCodigoDeAcesso,
  lerSessao,
  normalizarCodigoDeAcesso,
  veioDoProprioApp,
} from "@/lib/raio-x/acesso";
import { aceitou, camposDoErro, enderecoDoErro, retornoDeErroPermitido, validarCadastro } from "@/lib/raio-x/cadastro";

const CERTO = {
  nome: "Ricardo Exemplo",
  email: "Ricardo@GaragemModelo.com.br",
  telefone: "(31) 90000-2202",
  whatsapp: "(31) 90000-1101",
  empresa: "Garagem Modelo Veículos",
  segmento: "revenda_de_veiculos",
  quem_atende: "humano",
  abre: "08:00",
  fecha: "18:00",
  sabado_ate: "13:00",
  aceite: "sim",
  site: "",
  utm_source: "instagram",
  utm_campaign: "raio-x-novembro",
  gclid: "gclid-de-teste",
  origem: "site",
  retorno_erro: "https://iamia.com.br/raio-x",
};

describe("a validação do cadastro", () => {
  it("o certo passa, normalizado: e-mail minúsculo, os dois WhatsApp em dígitos, a origem guardada", () => {
    const r = validarCadastro(CERTO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor).toMatchObject({
      nome: "Ricardo Exemplo",
      email: "ricardo@garagemmodelo.com.br",
      telefone: "5531900002202",
      whatsapp: "5531900001101",
      segmento: "revenda_de_veiculos",
      quem_atende: "humano",
      sabado_ate: "13:00",
      retornoErro: "https://iamia.com.br/raio-x",
    });
    expect(r.valor.origem).toEqual({ utm_source: "instagram", utm_campaign: "raio-x-novembro", gclid: "gclid-de-teste", origem: "site" });
  });

  it("os dois números podem ser o mesmo", () => {
    expect(validarCadastro({ ...CERTO, telefone: CERTO.whatsapp }).ok).toBe(true);
  });

  it("os padrões: quem atende humano, 08:00 às 18:00, sábado vazio = não abre", () => {
    const { quem_atende: _q, abre: _a, fecha: _f, sabado_ate: _s, ...sem } = CERTO;
    const r = validarCadastro(sem);
    expect(r.ok && r.valor).toMatchObject({ quem_atende: "humano", abre: "08:00", fecha: "18:00", sabado_ate: null });
  });

  it("⭐ a recusa diz os CAMPOS, todos de uma vez, e nunca o valor", () => {
    const r = validarCadastro({ ...CERTO, nome: "Ricardo", email: "ricardo-arroba", telefone: "abc", whatsapp: "123", segmento: "padaria", quem_atende: "polvo", fecha: "07:00", aceite: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.campos).toEqual(["nome", "email", "telefone", "whatsapp", "segmento", "quem_atende", "fecha", "aceite"]);
    expect(r.armadilha).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/ricardo-arroba|padaria/);
  });

  it("o aceite vale 'sim', true e a caixa sem value ('on'); vazio ou 'não' recusa", () => {
    expect([aceitou("sim"), aceitou(true), aceitou("on"), aceitou("true")]).toEqual([true, true, true, true]);
    expect([aceitou(""), aceitou("nao"), aceitou(undefined), aceitou(false)]).toEqual([false, false, false, false]);
  });

  it("o sábado tem de fechar depois de abrir", () => {
    const r = validarCadastro({ ...CERTO, sabado_ate: "07:30" });
    expect(!r.ok && r.campos).toEqual(["sabado_ate"]);
  });

  it("campo a mais é ignorado e a origem é cortada (sem quebra de linha)", () => {
    const r = validarCadastro({ ...CERTO, qualquer: "coisa", utm_content: `linha1\nlinha2${"x".repeat(300)}` });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.origem.utm_content).toHaveLength(200);
    expect(r.valor.origem.utm_content).not.toMatch(/\n/);
  });
});

describe("a armadilha", () => {
  it("⭐ o campo `site` preenchido recusa sem olhar o resto (é robô)", () => {
    const r = validarCadastro({ ...CERTO, site: "https://spam.invalid" });
    expect(r).toEqual({ ok: false, campos: ["site"], armadilha: true, retornoErro: "https://iamia.com.br/raio-x" });
    // Mesmo com o resto todo errado, a resposta é a da armadilha.
    expect(validarCadastro({ site: "x" })).toMatchObject({ ok: false, campos: ["site"], armadilha: true });
  });
});

describe("para onde o erro volta", () => {
  it("só o site (https, iamia.com.br ou www) e a página do sistema", () => {
    expect(retornoDeErroPermitido("https://iamia.com.br/raio-x?utm_source=ig")).toBe("https://iamia.com.br/raio-x?utm_source=ig");
    expect(retornoDeErroPermitido("https://www.iamia.com.br/")).toBe("https://www.iamia.com.br/");
    expect(retornoDeErroPermitido("/raio-x/gratis")).toBe("/raio-x/gratis");
    for (const ruim of ["http://iamia.com.br/raio-x", "https://iamia.com.br.golpe.invalid/", "https://golpe.invalid/?iamia.com.br", "https://user:x@iamia.com.br/", "//iamia.com.br/", "/login", "javascript:alert(1)"]) {
      expect(retornoDeErroPermitido(ruim), ruim).toBeNull();
    }
  });

  it("o ?erro= leva os campos, e a página do sistema os lê de volta", () => {
    expect(enderecoDoErro("https://iamia.com.br/raio-x?utm_source=ig", ["nome", "aceite"])).toBe("https://iamia.com.br/raio-x?utm_source=ig&erro=nome%2Caceite");
    expect(enderecoDoErro("/raio-x/gratis", ["email"])).toBe("/raio-x/gratis?erro=email");
    expect(camposDoErro("nome,aceite,inventado,nome")).toEqual(["nome", "aceite"]);
  });
});

describe("o código de 6 números", () => {
  it("seis números ao acaso, com zero à esquerda, e o digitado com espaço vale", () => {
    for (let i = 0; i < 50; i += 1) expect(gerarCodigoDeAcesso()).toMatch(/^\d{6}$/);
    expect(normalizarCodigoDeAcesso("482 913")).toBe("482913");
    expect(normalizarCodigoDeAcesso("48291")).toBeNull();
    expect(normalizarCodigoDeAcesso("abcdef")).toBeNull();
  });

  it("⭐ o banco guarda o hash, nunca o código, e o hash é amarrado à conta", () => {
    const conta = "e9152e90-5555-4000-8000-000000000001";
    const outra = "e9152e90-5555-4000-8000-000000000002";
    const h = hashDoCodigoDeAcesso(conta, "482913");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("482913");
    expect(codigoConfere(h, conta, "482913")).toBe(true);
    expect(codigoConfere(h, conta, "482914")).toBe(false);
    expect(codigoConfere(h, outra, "482913")).toBe(false);
  });
});

describe("o cookie da área", () => {
  const CONTA = "e9152e90-5555-4000-8000-000000000001";
  const T0 = new Date("2026-11-06T15:00:00Z");

  it("assinado, com a conta e 30 dias de validade", () => {
    const s = assinarSessao(CONTA, T0);
    expect(s.valor).toMatch(/^v1\.[0-9a-f-]{36}\.\d+\.[0-9a-f]{64}$/);
    expect(s.expiraEm.getTime() - T0.getTime()).toBe(30 * 86_400_000);
    expect(lerSessao(s.valor, new Date(T0.getTime() + 29 * 86_400_000))).toBe(CONTA);
  });

  it("⭐ vencido, adulterado (outra conta, outra validade, outra assinatura) ou lixo não vale", () => {
    const s = assinarSessao(CONTA, T0);
    expect(lerSessao(s.valor, new Date(T0.getTime() + 31 * 86_400_000))).toBeNull();
    const [v, , exp, mac] = s.valor.split(".");
    expect(lerSessao(`${v}.e9152e90-5555-4000-8000-000000000002.${exp}.${mac}`, T0)).toBeNull();
    expect(lerSessao(`${v}.${CONTA}.${Number(exp) + 86_400}.${mac}`, T0)).toBeNull();
    expect(lerSessao(`${v}.${CONTA}.${exp}.${"0".repeat(64)}`, T0)).toBeNull();
    expect(lerSessao(`v2.${CONTA}.${exp}.${mac}`, T0)).toBeNull();
    for (const lixo of [null, undefined, "", "abc", "v1.x.y.z"]) expect(lerSessao(lixo, T0)).toBeNull();
  });

  it("os POST da área: só com o Origin (ou o Referer) do próprio app", () => {
    const app = "https://app.iamia.com.br";
    expect(veioDoProprioApp(new Headers({ origin: app }), app)).toBe(true);
    expect(veioDoProprioApp(new Headers({ referer: `${app}/raio-x/minha-area` }), app)).toBe(true);
    expect(veioDoProprioApp(new Headers({ origin: "https://golpe.invalid" }), app)).toBe(false);
    expect(veioDoProprioApp(new Headers({ origin: "https://iamia.com.br" }), app)).toBe(false);
    expect(veioDoProprioApp(new Headers({}), app)).toBe(false);
  });
});
