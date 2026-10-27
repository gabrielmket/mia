/**
 * FORK MIA (.95) · A ENTRADA PAGA AINDA NÃO PAGA NÃO É "CONTA SUSPENSA"
 * (teste do Gabriel em produção, 27/10/2026; lib/planos-mia/entrada-paga.ts).
 *
 * Quem cria a conta num plano de entrada paga (0 dia de teste) nasce suspensa
 * até o primeiro pagamento, pela regra do upstream. O que se prova aqui, nos
 * dois casos (a entrada paga e o atraso de quem já pagou), para os dois avisos:
 *   - "suspensa": a entrada paga não recebe nada (nem e-mail, nem Central); o
 *     atraso recebe o de sempre;
 *   - a liberação: a entrada paga recebe "Pagamento confirmado: a sua conta está
 *     liberada" com o botão Entrar; o atraso recebe o "tudo voltou a funcionar".
 *
 * Nenhum dado daqui é de cliente real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/cobranca/emails", () => ({ enviarAvisoAosAdmins: vi.fn() }));
vi.mock("@/lib/cobranca/configuracao", () => ({ toleranciaDias: async () => 7 }));

import { textoDoAviso } from "@/lib/cobranca/avisos";
import { aplicarRegua, type DependenciasDaCobranca } from "@/lib/cobranca/sincronizar";
import {
  calaOAvisoDaEntradaPaga,
  ehLiberacaoDaEntradaPaga,
  MOTIVO_DA_ENTRADA_PAGA,
  textoDaLiberacaoDaEntradaPaga,
} from "@/lib/planos-mia/entrada-paga";
import { bancoLivre, operacaoLivre, type CadeiaLivre } from "@/tests/helpers/banco-livre";

const ORG = "00000000-0000-4000-8000-0000000000e5";
const AGORA = new Date("2026-10-27T15:00:00Z");
const HORA = 3_600_000;
const ha = (horas: number) => new Date(AGORA.getTime() - horas * HORA).toISOString();

interface Mundo {
  linha: Record<string, unknown>;
  org: Record<string, unknown>;
}
let m: Mundo;
const enviarAviso = vi.fn();

/** A empresa recém-criada num plano de entrada paga: suspensa pelo gatilho, sem pagamento. */
function entradaPaga(): Mundo {
  return {
    linha: {
      organization_id: ORG, plano_id: "plano-entrada", plano_agendado_id: null, estado: "trial",
      trial_ate: ha(1), provedor: null, provedor_cliente_id: null, provedor_assinatura_id: null,
      vencida_desde: null, proximo_vencimento: null, cancela_no_fim: false, prazo_extra_ate: null,
      ultimo_aviso: null, ultimo_aviso_em: null, relida_em: null, link_de_pagamento: null,
      assinaturas_vivas: 0, pagamento_inicial_pendente: true, updated_at: ha(1),
    },
    org: {
      status: "suspended", suspended_kind: "cobranca", suspended_reason: MOTIVO_DA_ENTRADA_PAGA,
      locale: "pt-BR", timezone: "America/Sao_Paulo",
    },
  };
}

/** A empresa que já pagou, atrasou e foi suspensa pela régua, com o último aviso há mais de 7 dias. */
function atraso(): Mundo {
  return {
    linha: {
      ...entradaPaga().linha,
      estado: "em_atraso", trial_ate: ha(24 * 90), vencida_desde: ha(24 * 20),
      ultimo_aviso: "suspensa", ultimo_aviso_em: ha(24 * 7 + 1), pagamento_inicial_pendente: false,
      provedor: "asaas", provedor_assinatura_id: "sub_1", assinaturas_vivas: 1, relida_em: ha(0.1),
    },
    org: { ...entradaPaga().org, suspended_reason: "Falta de pagamento" },
  };
}

function responder(c: CadeiaLivre) {
  if (c.tabela === "organizations") return { data: m.org };
  if (c.tabela === "cobranca_assinaturas") {
    return operacaoLivre(c) === "select" ? { data: m.linha } : { data: { organization_id: ORG } };
  }
  return { data: null };
}

const banco = () =>
  bancoLivre(responder, (nome) => {
    if (nome === "fn_cobranca_registrar_aviso") return { data: true };
    return { data: { changed: true } };
  });

const deps = (): DependenciasDaCobranca => ({
  agora: () => AGORA,
  tolerancia: async () => 7,
  enviarAviso,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("o aviso de 'suspensa'", () => {
  it("⭐ entrada paga sem o primeiro pagamento: nenhum aviso, nem e-mail nem Central", async () => {
    m = entradaPaga();
    const b = banco();
    expect(await aplicarRegua(b.cliente as never, ORG, deps())).toBe("nada");
    expect(b.rpcs.map((r) => r.nome)).not.toContain("fn_cobranca_registrar_aviso");
    expect(enviarAviso).not.toHaveBeenCalled();
    // A régua do upstream segue: o teste vencido vira dívida (a data fica gravada).
    expect(b.cadeias.some((c) => c.tabela === "cobranca_assinaturas" && operacaoLivre(c) === "update")).toBe(true);
  });

  it("⭐ atraso de quem já pagou: o lembrete de 'suspensa' de sempre, na Central e por e-mail", async () => {
    m = atraso();
    const b = banco();
    expect(await aplicarRegua(b.cliente as never, ORG, deps())).toBe("avisar");
    const registro = b.rpcs.find((r) => r.nome === "fn_cobranca_registrar_aviso");
    expect(registro?.args).toMatchObject({ p_aviso: "suspensa", p_titulo: "Conta suspensa por falta de pagamento" });
    expect(enviarAviso).toHaveBeenCalledTimes(1);
    expect(enviarAviso.mock.calls[0]![2]).toMatchObject({ titulo: "Conta suspensa por falta de pagamento" });
  });
});

describe("o aviso da liberação", () => {
  it("⭐ primeiro pagamento da entrada paga: 'Pagamento confirmado', com o botão Entrar", async () => {
    m = entradaPaga();
    // A releitura do upstream já desligou a pendência e marcou a assinatura ativa.
    m.linha = { ...m.linha, estado: "ativa", pagamento_inicial_pendente: false, provedor: "asaas", relida_em: ha(0.1) };
    const b = banco();
    expect(await aplicarRegua(b.cliente as never, ORG, deps())).toBe("reativar");
    expect(enviarAviso).toHaveBeenCalledTimes(1);
    const [, , texto, link, botao] = enviarAviso.mock.calls[0]!;
    expect(texto).toMatchObject({ titulo: "Pagamento confirmado: a sua conta está liberada", severidade: "info" });
    expect(JSON.stringify(texto)).not.toMatch(/voltou a funcionar|durante a suspensão/);
    expect(link).toBeNull();
    expect(botao).toEqual({ rotulo: "Entrar", caminho: "/app" });
  });

  it("⭐ liberação depois de um atraso: o texto de sempre, sem botão próprio", async () => {
    m = atraso();
    m.linha = { ...m.linha, estado: "ativa", provedor: "asaas", relida_em: ha(0.1) };
    const b = banco();
    expect(await aplicarRegua(b.cliente as never, ORG, deps())).toBe("reativar");
    const [, , texto, , botao] = enviarAviso.mock.calls[0]!;
    expect(texto).toEqual(textoDoAviso("liberada", { data: null, origem: "atraso", idioma: "pt-BR", fuso: null }));
    expect(botao).toBeUndefined();
  });
});

describe("as regras puras e o espanhol", () => {
  it("cala só o 'suspensa' com a entrada pendente", () => {
    expect(calaOAvisoDaEntradaPaga("suspensa", true)).toBe(true);
    expect(calaOAvisoDaEntradaPaga("suspensa", false)).toBe(false);
    expect(calaOAvisoDaEntradaPaga("suspende_em_breve", true)).toBe(false);
    expect(calaOAvisoDaEntradaPaga("suspensa", null)).toBe(false);
  });

  it("a liberação é a da entrada paga pelo motivo que o gatilho do upstream grava", () => {
    expect(ehLiberacaoDaEntradaPaga("Aguardando o primeiro pagamento")).toBe(true);
    expect(ehLiberacaoDaEntradaPaga("Falta de pagamento")).toBe(false);
    expect(ehLiberacaoDaEntradaPaga(null)).toBe(false);
  });

  it("o motivo é o mesmo texto do gatilho do upstream (0679)", async () => {
    const { readFileSync } = await import("node:fs");
    const baseline = readFileSync("supabase/baseline.sql", "utf8");
    expect(baseline).toContain(`fn_suspender_organizacao(new.id, 'cobranca', '${MOTIVO_DA_ENTRADA_PAGA}', null)`);
  });

  it("o texto da liberação sai no espanhol da empresa", () => {
    expect(textoDaLiberacaoDaEntradaPaga("es")).toEqual({
      titulo: "Pago confirmado: tu cuenta está habilitada",
      corpo: "Recibimos el primer pago. Entra para empezar a usarla.",
      severidade: "info",
    });
  });
});
