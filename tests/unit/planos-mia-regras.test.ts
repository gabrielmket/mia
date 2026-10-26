/**
 * FORK MIA (.90) — as regras PURAS da jornada de assinatura
 * (docs/fork/jornada-de-assinatura.md): a estimativa de conversas, o "?plano="
 * da página, a IA em %, a vitrine pública sem dólar, a situação e a régua
 * prevista, os recados no zap da Time e o que sai numa descida de plano.
 * O lado do banco (a pergunta do módulo, as travas, a origem) está em
 * tests/invariants/jornada-de-assinatura.test.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  conversasEstimadas,
  MODULOS_DO_PLANO,
  percentualDaIa,
  ROTULO_DO_MODULO_DO_PLANO,
  slugDoPlano,
} from "@/lib/planos-mia/catalogo";
import { mudancasDoLado } from "@/lib/planos-mia/garantir-planos";
import { juntarPlano, planoDoLink, planosOferecidos, type PlanoComModulos } from "@/lib/planos-mia/leitura";
import { ligadosNaInstalacaoParaAEmpresa, rotuloDaOrigem } from "@/lib/planos-mia/modulos";
import { planoPublico } from "@/lib/planos-mia/publico";
import { recadosPendentes } from "@/lib/planos-mia/recados";
import { modulosQueSaem, textoDaMudanca } from "@/lib/planos-mia/seguir-o-plano";
import {
  previsaoDaSuspensao,
  proximoDaRegua,
  reguaDaEmpresa,
  situacaoDaEmpresa,
  type AssinaturaLida,
} from "@/lib/planos-mia/situacao";

const RAIZ = process.cwd();
const DIA = 86_400_000;
const AGORA = new Date("2026-10-25T13:30:00Z");

function plano(p: Partial<PlanoComModulos> & { id: string; nome: string }): PlanoComModulos {
  return juntarPlano(
    {
      id: p.id,
      nome: p.nome,
      preco_cents: p.preco_cents ?? 29700,
      intervalo: p.intervalo ?? "mes",
      trial_dias: p.trial_dias ?? 14,
      max_assentos: p.max_assentos ?? 3,
      max_canais: p.max_canais ?? 1,
      teto_ia_usd_cents: p.teto_ia_usd_cents === undefined ? 1500 : p.teto_ia_usd_cents,
      padrao_no_cadastro: p.padrao_no_cadastro ?? false,
      oferecido_ao_cliente: p.oferecido_ao_cliente ?? true,
      arquivado_em: p.arquivado_em ?? null,
    },
    {
      plano_id: p.id,
      modulos: p.modulos ?? [],
      preco_por_mensagem_cents: p.preco_por_mensagem_cents ?? null,
      frase: p.frase ?? null,
      destaque: p.destaque ?? false,
    },
  );
}

describe("o catálogo dos módulos do plano é o par do CHECK da 9070", () => {
  it("as três chaves, na mesma ordem do protótipo, e o CHECK do banco com as mesmas", () => {
    expect([...MODULOS_DO_PLANO]).toEqual(["disparador", "email_marketing", "crm_b2b"]);
    const sql = readFileSync(path.join(RAIZ, "supabase/migrations-mia/20261025104713_9070_plano_libera_modulo.sql"), "utf8");
    const check = /check \(modulos <@ array\[([^\]]+)\]::text\[\]\)/.exec(sql)?.[1] ?? "";
    expect(check.split(",").map((x) => x.trim().replace(/'/g, ""))).toEqual([...MODULOS_DO_PLANO]);
    for (const m of MODULOS_DO_PLANO) expect(ROTULO_DO_MODULO_DO_PLANO[m].rotulo.length).toBeGreaterThan(0);
  });
});

describe("a estimativa de conversas (a fórmula do protótipo)", () => {
  it("US$ 15, 40 e 75 viram cerca de 300, 850 e 1.550 conversas", () => {
    expect(conversasEstimadas(1500)).toBe(300);
    expect(conversasEstimadas(4000)).toBe(850);
    expect(conversasEstimadas(7500)).toBe(1550);
  });
  it("sem teto, sem limite (null)", () => {
    expect(conversasEstimadas(null)).toBeNull();
  });
});

describe("a IA em % do incluído", () => {
  it("arredonda, nunca negativo, e sem teto não há porcentagem", () => {
    expect(percentualDaIa(120, 500)).toBe(24);
    expect(percentualDaIa(425, 500)).toBe(85);
    expect(percentualDaIa(0, 500)).toBe(0);
    expect(percentualDaIa(100, null)).toBeNull();
  });
});

describe("o ?plano= do link da página de preços", () => {
  const planos = [
    plano({ id: "11111111-1111-4111-8111-111111111111", nome: "Essencial" }),
    plano({ id: "22222222-2222-4222-8222-222222222222", nome: "Profissional", preco_cents: 59700 }),
    plano({ id: "33333333-3333-4333-8333-333333333333", nome: "MIA com implantação", oferecido_ao_cliente: false }),
    plano({ id: "44444444-4444-4444-8444-444444444444", nome: "Antigo", arquivado_em: "2026-10-01T00:00:00Z" }),
  ];
  it("o slug tira acento e espaço", () => {
    expect(slugDoPlano("MIA com implantação")).toBe("mia-com-implantacao");
    expect(slugDoPlano("  Profissional ")).toBe("profissional");
  });
  it("acha pelo id ou pelo slug, só entre os oferecidos e ativos", () => {
    expect(planoDoLink(planos, "profissional")?.nome).toBe("Profissional");
    expect(planoDoLink(planos, "Profissional")?.nome).toBe("Profissional");
    expect(planoDoLink(planos, "11111111-1111-4111-8111-111111111111")?.nome).toBe("Essencial");
    // O escondido não se escolhe por link, e o arquivado não existe mais.
    expect(planoDoLink(planos, "mia-com-implantacao")).toBeNull();
    expect(planoDoLink(planos, "antigo")).toBeNull();
    expect(planoDoLink(planos, "")).toBeNull();
    expect(planosOferecidos(planos).map((p) => p.nome)).toEqual(["Essencial", "Profissional"]);
  });
});

describe("a vitrine pública nunca leva o dólar do teto", () => {
  it("planoPublico tem conversas estimadas e nenhum campo de teto ou de dólar", () => {
    const p = planoPublico(
      plano({ id: "22222222-2222-4222-8222-222222222222", nome: "Profissional", teto_ia_usd_cents: 4000, modulos: ["disparador"], preco_por_mensagem_cents: 12 }),
    );
    expect(p.conversas_estimadas).toBe(850);
    expect(Object.keys(p).some((k) => /teto|usd|dolar/i.test(k))).toBe(false);
    expect(JSON.stringify(p)).not.toMatch(/4000|US\$/);
    expect(p.cadastro).toBe("/signup?plano=profissional");
    expect(p.preco_por_mensagem_cents).toBe(12);
  });
  it("sem Broadcast no plano, o preço por mensagem não sai", () => {
    const p = planoPublico(plano({ id: "1", nome: "Essencial", modulos: [], preco_por_mensagem_cents: 12 }));
    expect(p.preco_por_mensagem_cents).toBeNull();
  });
});

describe("a origem do módulo e o menu da instalação", () => {
  it("pelo plano, pela Time, ou os dois", () => {
    expect(rotuloDaOrigem({ pelo_plano: true, pela_time: false })).toBe("pelo plano");
    expect(rotuloDaOrigem({ pelo_plano: false, pela_time: true })).toBe("pela Time");
    expect(rotuloDaOrigem({ pelo_plano: true, pela_time: true })).toBe("pelo plano e pela Time");
  });
  it("Vendas B2B só sai do menu quando a empresa está fora do plano; senão é a lista de sempre", () => {
    const ligados = ["crm_b2b", "cobranca", "propostas"] as const;
    expect(ligadosNaInstalacaoParaAEmpresa(ligados, false)).toEqual([...ligados]);
    expect(ligadosNaInstalacaoParaAEmpresa(ligados, true)).toEqual(["cobranca", "propostas"]);
  });
});

describe("o que sai numa descida de plano, e o que fica", () => {
  it("sai o que o plano atual liga e o agendado não; a liberação à mão fica", () => {
    expect(modulosQueSaem(["disparador", "email_marketing"], [], new Set())).toEqual(["disparador", "email_marketing"]);
    expect(modulosQueSaem(["disparador", "email_marketing"], ["disparador"], new Set(["email_marketing"]))).toEqual([]);
    expect(modulosQueSaem(["disparador"], ["disparador", "crm_b2b"], new Set())).toEqual([]);
  });
  it("o aviso da mudança fala do módulo e do plano, nos dois idiomas", () => {
    const pt = textoDaMudanca({ modulo: "disparador", acao: "ligou" }, "Profissional", "pt-BR");
    expect(pt.titulo).toBe("Broadcast ligado pelo plano Profissional");
    const es = textoDaMudanca({ modulo: "disparador", acao: "desligou" }, null, "es");
    expect(es.titulo).toBe("Broadcast desactivado: salió del plan");
    expect(es.corpo).toContain("los datos quedan guardados");
  });
});

describe("o lado nosso do plano: só o que muda vai para o banco", () => {
  const atual = { modulos: ["disparador" as const], preco_por_mensagem_cents: 12, frase: null, destaque: false };
  it("igual não grava nada", () => {
    expect(mudancasDoLado(atual, { modulos: ["disparador"], preco_por_mensagem_cents: 12 })).toBeNull();
  });
  it("acrescentar módulo e mudar a frase vão juntos; a ordem dos módulos não importa", () => {
    expect(mudancasDoLado(atual, { modulos: ["email_marketing", "disparador"], frase: "Para crescer" })).toEqual({
      modulos: ["disparador", "email_marketing"],
      frase: "Para crescer",
    });
  });
  it("sem linha ainda, qualquer módulo é mudança", () => {
    expect(mudancasDoLado(null, { modulos: ["crm_b2b"] })).toEqual({ modulos: ["crm_b2b"] });
  });
});

function assinatura(a: Partial<AssinaturaLida>): AssinaturaLida {
  return {
    plano_id: "p",
    plano_agendado_id: null,
    estado: "trial",
    trial_ate: null,
    vencida_desde: null,
    proximo_vencimento: null,
    prazo_extra_ate: null,
    cancela_no_fim: false,
    assinaturas_vivas: 0,
    ultimo_aviso: null,
    ultimo_aviso_em: null,
    provedor: null,
    pagamento_inicial_pendente: false,
    link_de_pagamento: null,
    ...a,
  };
}
const ATIVA = { status: "active", suspended_kind: null };
const iso = (ms: number) => new Date(ms).toISOString();

describe("a situação de cada empresa", () => {
  it("sem assinatura é isenta (as empresas de hoje)", () => {
    expect(situacaoDaEmpresa(null, ATIVA, AGORA)).toBe("isenta");
    expect(proximoDaRegua(null, ATIVA, AGORA, 7).tipo).toBe("sem_cobranca");
    expect(reguaDaEmpresa(null, ATIVA, AGORA, 7, null)).toEqual([]);
  });
  it("teste, teste vencido sem provedor (vira atraso), em dia, com prazo, suspensa e cancelada", () => {
    const t = AGORA.getTime();
    expect(situacaoDaEmpresa(assinatura({ trial_ate: iso(t + 5 * DIA) }), ATIVA, AGORA)).toBe("teste");
    expect(situacaoDaEmpresa(assinatura({ trial_ate: iso(t - DIA) }), ATIVA, AGORA)).toBe("atraso");
    expect(situacaoDaEmpresa(assinatura({ estado: "ativa" }), ATIVA, AGORA)).toBe("emdia");
    expect(situacaoDaEmpresa(assinatura({ estado: "em_atraso", prazo_extra_ate: iso(t + DIA) }), ATIVA, AGORA)).toBe("prazo");
    expect(situacaoDaEmpresa(assinatura({ estado: "em_atraso" }), { status: "suspended", suspended_kind: "cobranca" }, AGORA)).toBe("suspensa");
    expect(situacaoDaEmpresa(assinatura({ estado: "ativa", cancela_no_fim: true }), ATIVA, AGORA)).toBe("cancelada");
  });
});

describe("o próximo passo da régua (as regras do upstream)", () => {
  const t = AGORA.getTime();
  it("no teste: o aviso de 3 dias antes; perto do fim, o fim do teste", () => {
    expect(proximoDaRegua(assinatura({ trial_ate: iso(t + 10 * DIA) }), ATIVA, AGORA, 7)).toMatchObject({ tipo: "aviso_3_dias", em: iso(t + 7 * DIA) });
    expect(proximoDaRegua(assinatura({ trial_ate: iso(t + DIA), ultimo_aviso: "trial_acabando" }), ATIVA, AGORA, 7).tipo).toBe("fim_do_teste");
    expect(proximoDaRegua(assinatura({ trial_ate: iso(t + DIA), assinaturas_vivas: 1, provedor: "asaas" }), ATIVA, AGORA, 7).tipo).toBe(
      "primeira_fatura",
    );
  });
  it("teste vencido sem cobrança em jogo: o aviso final na hora e a suspensão 48 h depois (sem tolerância)", () => {
    const fim = t - DIA;
    const p = previsaoDaSuspensao(assinatura({ estado: "em_atraso", trial_ate: iso(fim), vencida_desde: iso(fim) }), AGORA, 7);
    expect(p.avisoFinalEm).toBe(t);
    expect(p.suspensaoEm).toBe(t + 2 * DIA);
  });
  it("fatura vencida com provedor: aviso final na tolerância menos 2 dias e suspensão na tolerância", () => {
    const venceu = t;
    const a = assinatura({ estado: "em_atraso", vencida_desde: iso(venceu), provedor: "asaas", assinaturas_vivas: 1, trial_ate: iso(t - 30 * DIA) });
    const p = previsaoDaSuspensao(a, AGORA, 7);
    expect(p.avisoFinalEm).toBe(venceu + 5 * DIA);
    expect(p.suspensaoEm).toBe(venceu + 7 * DIA);
    expect(proximoDaRegua(a, ATIVA, AGORA, 7)).toMatchObject({ tipo: "aviso_final", suspensao_em: iso(venceu + 7 * DIA) });
  });
  it("a tolerância nunca fica abaixo do piso de 5 dias", () => {
    const a = assinatura({ estado: "em_atraso", vencida_desde: iso(t), provedor: "asaas", assinaturas_vivas: 1, trial_ate: iso(t - 30 * DIA) });
    expect(previsaoDaSuspensao(a, AGORA, 1).suspensaoEm).toBe(t + 5 * DIA);
  });
});

describe("os recados no zap da Time", () => {
  const t = AGORA.getTime();
  const empresa = (e: Partial<Parameters<typeof recadosPendentes>[0]["empresas"][number]>) => ({
    id: "org-1",
    nome: "Empresa Alfa",
    origem: "cadastro" as const,
    situacao: "teste",
    teste_ate: null,
    proximo: { tipo: "fim_do_teste", suspensao_em: null },
    ...e,
  });
  it("pedido novo com o plano e número esperando, cada um com chave própria", () => {
    const r = recadosPendentes({
      pedidos: [{ id: "ped-1", empresa: "Mercado Beta", plano: "Essencial" }],
      numeros: [{ id: "num-1", conta: "Studio Gama" }],
      empresas: [],
      agora: AGORA,
    });
    expect(r.map((x) => x.chave)).toEqual(["jornada:zap:pedido:ped-1", "jornada:zap:numero:num-1"]);
    expect(r[0]!.texto).toContain("Mercado Beta (Essencial)");
  });
  it("o teste que acaba amanhã sem assinatura avisa; o que acaba em 3 dias ainda não", () => {
    const r = recadosPendentes({
      pedidos: [],
      numeros: [],
      empresas: [empresa({ id: "a", teste_ate: iso(t + 20 * 3_600_000) }), empresa({ id: "b", teste_ate: iso(t + 3 * DIA) })],
      agora: AGORA,
    });
    expect(r.map((x) => x.chave)).toEqual([`jornada:zap:teste_acaba:a:${iso(t + 20 * 3_600_000).slice(0, 10)}`]);
  });
  it("a véspera da suspensão só para quem entrou sozinho", () => {
    const amanha = iso(t + 10 * 3_600_000);
    const r = recadosPendentes({
      pedidos: [],
      numeros: [],
      empresas: [
        empresa({ id: "s1", situacao: "atraso", proximo: { tipo: "suspensao", suspensao_em: amanha } }),
        empresa({ id: "s2", origem: "implantacao", situacao: "atraso", proximo: { tipo: "suspensao", suspensao_em: amanha } }),
      ],
      agora: AGORA,
    });
    expect(r.map((x) => x.chave)).toEqual([`jornada:zap:suspende:s1:${amanha.slice(0, 10)}`]);
  });
  it("só o nome da empresa e o que fazer: nenhum e-mail, telefone ou nome de pessoa", () => {
    const r = recadosPendentes({
      pedidos: [{ id: "p", empresa: "Mercado Beta", plano: null }],
      numeros: [{ id: "n", conta: null }],
      empresas: [empresa({ teste_ate: iso(t + 3_600_000) })],
      agora: AGORA,
    });
    for (const x of r) expect(x.texto).not.toMatch(/@|\+55|\d{4}-\d{4}/);
  });
});
