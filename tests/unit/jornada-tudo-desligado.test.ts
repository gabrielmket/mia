/**
 * FORK MIA (.90) — TUDO SAI DESLIGADO (docs/fork/jornada-de-assinatura.md).
 *
 * A jornada de assinatura chega à produção com a cobrança desligada e as
 * empresas de hoje isentas (sem linha em `cobranca_assinaturas`). Este arquivo
 * prova, peça por peça, que NADA muda para elas enquanto a chave
 * `MODULO_COBRANCA` não for ligada:
 *   - o módulo liberado à mão continua liberado, e o não liberado continua não;
 *   - Vendas B2B segue a instalação, sem ler assinatura;
 *   - o preço por mensagem é o combinado de sempre (nenhum vem de plano);
 *   - a página de preços e a rota pública dizem "indisponível", sem plano;
 *   - o cadastro não mostra cartões (fica o seletor do upstream, que some sem planos);
 *   - os recados da jornada calam (nem pedido, nem número, nem régua);
 *   - a compra de crédito por Pix não existe.
 * O banco prova o lado dele em tests/invariants/jornada-de-assinatura.test.ts.
 *
 * Nenhum dado daqui é de cliente real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ reportar: vi.fn(async () => true) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/avisos/report-da-plataforma", () => ({ reportar: h.reportar }));

import { podeComprarCreditos } from "@/lib/carteira/compra-pelo-asaas";
import { moduloLiberado, modulosDaOrganizacao } from "@/lib/modulos/liberacao";
import { lerCadastroEmCartoes } from "@/lib/planos-mia/cadastro";
import { crmB2bForaDoPlano } from "@/lib/planos-mia/modulos";
import { precoPorMensagemDaEmpresa } from "@/lib/planos-mia/preco-por-mensagem";
import { lerPlanosPublicos } from "@/lib/planos-mia/publico";
import { mandarRecadosDaJornada } from "@/lib/planos-mia/recados";
import { bancoLivre, type CadeiaLivre } from "@/tests/helpers/banco-livre";

const ORG = "00000000-0000-4000-8000-0000000000a9";

let liberadoAMao: boolean;

/**
 * O banco como ele está hoje: nenhuma chave ligada em `platform_config`, nenhuma
 * assinatura, e a função do plano devolvendo vazio (é o que a 9070 faz com a
 * cobrança desligada, provado no invariante).
 */
function responder(c: CadeiaLivre) {
  if (c.tabela === "platform_config") return { data: [] };
  if (c.tabela === "organization_modules")
    return { data: liberadoAMao ? (c.passos.some((p) => p.metodo === "maybeSingle") ? { id: "lib-1" } : [{ modulo: "disparador" }]) : null };
  if (c.tabela === "cobranca_assinaturas") return { data: null };
  return { data: [] };
}
const banco = () => bancoLivre(responder, (nome) => (nome === "fn_mia_modulos_do_plano" ? { data: [] } : {}));
const tabelasLidas = (b: ReturnType<typeof banco>) => new Set(b.cadeias.map((c) => c.tabela));

beforeEach(() => {
  vi.clearAllMocks();
  liberadoAMao = false;
});

describe("o módulo vendável: a liberação à mão de sempre", () => {
  it("⭐ liberado à mão segue liberado; sem liberação segue recusado", async () => {
    liberadoAMao = true;
    expect(await moduloLiberado(banco().cliente as never, ORG, "disparador")).toBe(true);
    expect([...(await modulosDaOrganizacao(banco().cliente as never, ORG))]).toContain("disparador");
    liberadoAMao = false;
    expect(await moduloLiberado(banco().cliente as never, ORG, "disparador")).toBe(false);
    expect([...(await modulosDaOrganizacao(banco().cliente as never, ORG))]).not.toContain("disparador");
  });

  it("Vendas B2B segue a instalação: sem ler assinatura nem plano", async () => {
    const b = banco();
    expect(await crmB2bForaDoPlano(b.cliente as never, ORG, false)).toBe(false);
    expect(b.cadeias).toEqual([]);
    expect(b.rpcs).toEqual([]);
  });
});

describe("o preço por mensagem: o combinado de sempre", () => {
  it("⭐ com combinado, o combinado; sem combinado, nenhum (o disparo recusa como hoje)", async () => {
    expect(await precoPorMensagemDaEmpresa(banco().cliente as never, ORG, 15)).toEqual({ cents: 15, origem: "combinado" });
    const b = banco();
    expect(await precoPorMensagemDaEmpresa(b.cliente as never, ORG, null)).toEqual({ cents: null, origem: null });
    expect(tabelasLidas(b).has("cobranca_assinaturas")).toBe(false);
  });
});

describe("a vitrine e o cadastro", () => {
  it("⭐ a página de preços e a rota pública: indisponível, sem plano, sem ler os planos", async () => {
    const b = banco();
    expect(await lerPlanosPublicos(b.cliente as never)).toEqual({ disponivel: false, planos: [] });
    expect(tabelasLidas(b).has("cobranca_planos")).toBe(false);
  });

  it("o cadastro sem planos oferecidos não tem cartão nem plano marcado", async () => {
    const b = banco();
    expect(await lerCadastroEmCartoes(b.cliente as never, [], undefined, "essencial")).toEqual({
      cartoes: [],
      planoMarcado: undefined,
      linkSemPlano: false,
    });
    expect(b.cadeias).toEqual([]);
  });
});

describe("os recados e a compra de crédito", () => {
  it("⭐ os recados da jornada calam: nada lido, nada mandado", async () => {
    const b = banco();
    expect(await mandarRecadosDaJornada(b.cliente as never, { completo: true })).toEqual([]);
    expect(h.reportar).not.toHaveBeenCalled();
    // Só a leitura da chave (platform_config e modulos_instalados, lib/instalacao/modulos.ts).
    expect([...tabelasLidas(b)].filter((t) => t !== "platform_config" && t !== "modulos_instalados")).toEqual([]);
  });

  it("a compra de crédito por Pix não existe", async () => {
    expect(await podeComprarCreditos(banco().cliente as never, ORG)).toEqual({ pode: false, motivo: "cobranca_desligada" });
  });
});
