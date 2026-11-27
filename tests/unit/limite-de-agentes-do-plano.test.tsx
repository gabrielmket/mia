/**
 * FORK MIA (MIA-250 D) — O PLANO DIZ QUANTOS AGENTES DE IA A EMPRESA CRIA.
 * Desenho na MIA-258 (seções 3 a 11); docs/fork/jornada-de-assinatura.md.
 *
 * Quem recusa é o banco (migration 9174, provado em
 * tests/invariants/limite-de-agentes-do-plano.test.ts). Aqui: a tradução da
 * recusa, a régua do servidor igual à do gatilho, a troca e a atribuição de
 * plano com o excedente de agentes, o campo `agentes` no MCP e no admin, e a
 * linha do painel que só aparece com teto.
 *
 * Nenhum dado daqui é de cliente real: "Academia Alfa" é fictícia.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/cobranca/configuracao", () => ({ toleranciaDias: async () => 7, provedorDaInstalacao: async () => "asaas", chaveDoProvedor: async () => null }));
vi.mock("@/lib/auth/politica-de-cadastro", () => ({ modoDeCadastro: async () => "com_aprovacao" }));

import { FRASE_DO_EXCEDENTE, oQueRemover } from "@/components/admin/tenants/CardDeCobranca";
import { PainelDaAssinatura } from "@/components/cobranca/PainelDaAssinatura";
import { tetoDeAgentesDoCampo } from "@/components/planos-mia/ModulosDosPlanos";
import { ApiError } from "@/lib/api/types";
import { trocarPlanoDaOrg } from "@/lib/cobranca/troca";
import type { DadosDoPainel } from "@/lib/cobranca/painel";
import { traduzir } from "@/lib/i18n/dicionario";
import { DICIONARIO_DO_LIMITE_DE_AGENTES } from "@/lib/i18n/dicionario-mia-limite-de-agentes";
import { FERRAMENTA_POR_NOME } from "@/lib/mcp-plataforma/ferramentas";
import { atribuirOuTrocarPlano } from "@/lib/planos-mia/acoes-do-dono";
import { mudancasDoLado } from "@/lib/planos-mia/garantir-planos";
import { juntarPlano } from "@/lib/planos-mia/leitura";
import {
  FRASE_DO_LIMITE_DE_AGENTES,
  agentesDoPainel,
  excedenteDeAgentes,
  excedenteDeAgentesNoPlano,
  lerAgentesEmUso,
  lerLimiteDeAgentesEstourado,
  recusaDoLimiteDeAgentesNoMcp,
  retratoDoLimiteDeAgentes,
  traduzirLimiteDeAgentes,
} from "@/lib/planos-mia/limite-de-agentes";
import { bancoFalso, valorDoFiltro, type Cadeia } from "@/tests/helpers/banco-falso-da-cobranca";
import { argumentosLivres, bancoLivre, filtroLivre, operacaoLivre, type CadeiaLivre } from "@/tests/helpers/banco-livre";

afterEach(cleanup);

const RAIZ = process.cwd();
const MIGRATION = "supabase/migrations-mia/20261127120000_9174_limite_de_agentes_por_plano.sql";
const ORG = "00000000-0000-4000-8000-0000000000a1"; // Academia Alfa (fictícia)
const AUTOR = "00000000-0000-4000-8000-0000000000a2";
/** A mensagem exata que o Postgres entrega para o gatilho da 9174 com teto 2. */
const DO_BANCO = { code: "PT402", message: "limite_do_plano:agentes:2" };

// ---------------------------------------------------------------------------
// 1. a tradução da recusa
// ---------------------------------------------------------------------------

describe("a recusa do banco vira 409 plan_limit_reached com a frase do plano", () => {
  it("⭐ lê o teto na MENSAGEM: erro do PostgREST, erro do pg, texto solto", () => {
    expect(lerLimiteDeAgentesEstourado(DO_BANCO)).toBe(2);
    expect(lerLimiteDeAgentesEstourado(new Error("insert falhou: limite_do_plano:agentes:15"))).toBe(15);
    expect(lerLimiteDeAgentesEstourado("limite_do_plano:agentes:1")).toBe(1);
  });

  it("não confunde com as outras recusas (pessoas, números, nome repetido) nem com nada", () => {
    expect(lerLimiteDeAgentesEstourado({ code: "PT402", message: "limite_do_plano:canais:1" })).toBeNull();
    expect(lerLimiteDeAgentesEstourado({ code: "PT402", message: "limite_do_plano:assentos:3" })).toBeNull();
    expect(lerLimiteDeAgentesEstourado({ code: "23505", message: "duplicate key value violates unique constraint" })).toBeNull();
    expect(lerLimiteDeAgentesEstourado(null)).toBeNull();
    expect(lerLimiteDeAgentesEstourado(undefined)).toBeNull();
    expect(traduzirLimiteDeAgentes({ message: "outra coisa" }, "pt-BR")).toBeNull();
  });

  it("⭐ a frase para 1 e para N, com o número e os dois caminhos", () => {
    expect(traduzirLimiteDeAgentes({ message: "limite_do_plano:agentes:1" }, "pt-BR")).toEqual({
      code: "plan_limit_reached",
      message:
        "Seu plano permite 1 agente de IA e ele já foi criado. Arquive um agente em Agentes de IA ou troque de plano em Configurações › Plano e cobrança.",
      details: { recurso: "agentes", limite: 1 },
    });
    expect(traduzirLimiteDeAgentes(DO_BANCO, "pt-BR")?.message).toBe(
      "Seu plano permite 2 agentes de IA e todos já foram criados. Arquive um agente em Agentes de IA ou troque de plano em Configurações › Plano e cobrança.",
    );
  });

  it("a frase da recusa é a da constante, para 1 e para N", () => {
    expect(traduzirLimiteDeAgentes({ message: "limite_do_plano:agentes:1" }, "pt-BR")!.message).toBe(FRASE_DO_LIMITE_DE_AGENTES.um);
    expect(traduzirLimiteDeAgentes({ message: "limite_do_plano:agentes:9" }, "pt-BR")!.message).toBe(FRASE_DO_LIMITE_DE_AGENTES.varios.replace("{n}", "9"));
  });

  it("em espanhol pelo dicionário (sem sobrar o {n}); o inglês fica pronto no arquivo nosso", () => {
    const es = traduzirLimiteDeAgentes(DO_BANCO, "es")!.message;
    expect(es).toBe(
      "Tu plan permite 2 agentes de IA y todos ya fueron creados. Archiva un agente en Agentes de IA o cambia de plan en Configuración › Plan y facturación.",
    );
    // Hoje o produto serve pt-BR e es (lib/i18n/idiomas.ts); o `en` entra quando o idioma for ligado.
    for (const frase of [...Object.values(FRASE_DO_LIMITE_DE_AGENTES), FRASE_DO_EXCEDENTE.agentes]) {
      expect(traduzir(frase, "es"), frase).not.toBe(frase);
      expect(DICIONARIO_DO_LIMITE_DE_AGENTES[frase]?.en, frase).toBeTruthy();
    }
  });

  it("a recusa do MCP diz o que não aconteceu e os três caminhos", () => {
    const n = recusaDoLimiteDeAgentesNoMcp(3);
    expect(n).toContain("permite 3 agentes de IA e todos já foram criados. Nada foi criado.");
    expect(n).toContain("plataforma_garantir_planos (campo agentes)");
    expect(n).toContain("troque o plano da empresa");
    expect(recusaDoLimiteDeAgentesNoMcp(1)).toContain("permite 1 agente de IA e ele já foi criado.");
  });
});

// ---------------------------------------------------------------------------
// 2. o contrato com o banco e a régua igual à do gatilho
// ---------------------------------------------------------------------------

describe("o gatilho da 9174 e a régua do servidor contam igual", () => {
  const sql = readFileSync(path.join(RAIZ, MIGRATION), "utf8");

  it("⭐ a mensagem que o servidor lê é a que o gatilho escreve, com o PT402", () => {
    expect(sql).toContain("raise exception 'limite_do_plano:agentes:%', v_limite");
    expect(sql).toContain("errcode = 'PT402'");
    expect(lerLimiteDeAgentesEstourado("limite_do_plano:agentes:7")).toBe(7);
  });

  it("o gatilho pega insert, desarquivar e trocar de empresa, com a trava 2283", () => {
    expect(sql).toMatch(/create trigger trg_mia_trava_agentes_do_plano\s+before insert or update of archived_at, organization_id\s+on public\.ai_agents/);
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtextextended\(new\.organization_id::text, 2283\)\)/);
  });

  it("⭐ a contagem do gatilho é todo agente não arquivado, sem filtro de tipo nem de estado; lerAgentesEmUso também", async () => {
    const contagem = /select count\(\*\) into v_em_uso\s+from public\.ai_agents a\s+where ([\s\S]*?);/.exec(sql)?.[1] ?? "";
    expect(contagem.replace(/\s+/g, " ").trim()).toBe(
      "a.organization_id = new.organization_id and a.archived_at is null and a.id <> new.id",
    );
    const b = bancoLivre(() => ({ count: 4 }));
    expect(await lerAgentesEmUso(b.cliente as never, ORG)).toBe(4);
    const c = b.cadeias[0]!;
    expect(c.tabela).toBe("ai_agents");
    // Os mesmos dois filtros, e nenhum outro (kind, is_active, paused_at...).
    expect(c.passos.filter((p) => !["select"].includes(p.metodo)).map((p) => [p.metodo, ...p.args])).toEqual([
      ["eq", "organization_id", ORG],
      ["is", "archived_at", null],
    ]);
  });

  it("o teto nasce no plano: a coluna aceita nulo ou 1 a 1000", () => {
    expect(sql).toContain("check (max_agentes is null or max_agentes between 1 and 1000)");
    expect(sql).not.toMatch(/fn_limite_do_plano\s*\(/i);
    expect(sql).not.toMatch(/alter table public\.cobranca_planos/i);
  });
});

describe("as contas puras", () => {
  it("excedente: só o que passa; sem teto, nada", () => {
    expect(excedenteDeAgentes(3, 1)).toBe(2);
    expect(excedenteDeAgentes(1, 1)).toBe(0);
    expect(excedenteDeAgentes(0, 5)).toBe(0);
    expect(excedenteDeAgentes(40, null)).toBe(0);
  });

  it("o campo do admin: vazio é sem limite; fora de 1 a 1000 é inválido", () => {
    expect(tetoDeAgentesDoCampo("")).toBeNull();
    expect(tetoDeAgentesDoCampo("  ")).toBeNull();
    expect(tetoDeAgentesDoCampo("3")).toBe(3);
    for (const ruim of ["0", "1001", "2,5", "-1", "dois"]) expect(tetoDeAgentesDoCampo(ruim), ruim).toBeNaN();
  });

  it("a linha nossa do plano: max_agentes entra e sai por mudancasDoLado; ausente fica", () => {
    const atual = { modulos: [], preco_por_mensagem_cents: null, frase: null, destaque: false, max_agentes: 2 };
    expect(mudancasDoLado(atual, {})).toBeNull();
    expect(mudancasDoLado(atual, { max_agentes: 2 })).toBeNull();
    expect(mudancasDoLado(atual, { max_agentes: 5 })).toEqual({ max_agentes: 5 });
    expect(mudancasDoLado(atual, { max_agentes: null })).toEqual({ max_agentes: null });
    // O lado lido antes da 9174 (sem a coluna) conta como sem limite.
    expect(mudancasDoLado({ modulos: [], preco_por_mensagem_cents: null, frase: null, destaque: false }, { max_agentes: null })).toBeNull();
    expect(juntarPlano(
      { id: "p", nome: "Essencial", preco_cents: 14700, intervalo: "mes", trial_dias: 14, max_assentos: 1, max_canais: 1, teto_ia_usd_cents: null, padrao_no_cadastro: false, oferecido_ao_cliente: true, arquivado_em: null },
      { plano_id: "p", modulos: [], preco_por_mensagem_cents: null, max_agentes: 1, frase: null, destaque: false },
    ).max_agentes).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. a troca de plano (cliente) e a atribuição pelo dono
// ---------------------------------------------------------------------------

describe("⭐ trocar de plano soma os agentes à lista do que tirar", () => {
  const plano = (id: string, extra: Record<string, unknown> = {}) => ({
    id, nome: id, preco_cents: 14700, moeda: "BRL", intervalo: "mes", max_assentos: 5, max_canais: 2, arquivado_em: null, oferecido_ao_cliente: true, ...extra,
  });
  const PLANOS = [plano("essencial"), plano("pro", { preco_cents: 29700 })];
  const EM_TESTE = { plano_id: "pro", plano_agendado_id: null, estado: "trial", trial_ate: "2026-12-20T00:00:00Z", provedor: null, provedor_assinatura_id: null, proximo_vencimento: null, checkout_url: null, checkout_expira_em: null, checkout_sessao_id: null };
  let teto: Record<string, number | null>;
  let agentes: number;

  const banco = () =>
    bancoFalso((c: Cadeia) => {
      if (c.tabela === "cobranca_planos") return { data: PLANOS.find((p) => p.id === valorDoFiltro(c, "eq", "id")) ?? null };
      if (c.tabela === "user_organizations") return { count: 1 };
      if (c.tabela === "channel_sessions") return { count: 1 };
      if (c.tabela === "mia_plano_modulos") {
        const id = valorDoFiltro(c, "eq", "plano_id") as string;
        return { data: id in teto ? { max_agentes: teto[id] } : null };
      }
      if (c.tabela === "ai_agents") return { count: agentes };
      if (c.passos.some((p) => p.metodo === "update")) return { data: { organization_id: ORG } };
      return { data: { ...EM_TESTE } };
    });
  const trocar = (b: ReturnType<typeof banco>, planoId: string) =>
    trocarPlanoDaOrg(b.cliente as never, ORG, planoId, { agora: () => new Date("2026-12-01T12:00:00Z") });

  beforeEach(() => {
    teto = {};
    agentes = 3;
  });

  it("descer para um plano com teto 1 tendo 3 agentes: 409 com excedente.agentes = 2, nada gravado", async () => {
    teto = { essencial: 1 };
    const b = banco();
    const r = await trocar(b, "essencial");
    expect(r).toMatchObject({ ok: false, status: 409, code: "plan_limit_reached", details: { excedente: { agentes: 2 } } });
    expect(b.cadeias.some((c) => c.tabela === "cobranca_assinaturas" && c.passos.some((p) => p.metodo === "update"))).toBe(false);
  });

  it("cabe no teto: troca normal", async () => {
    teto = { essencial: 3 };
    expect(await trocar(banco(), "essencial")).toMatchObject({ ok: true, planoId: "essencial" });
  });

  it("⭐ inerte: plano sem teto (ou sem linha nossa) nem conta os agentes", async () => {
    teto = { essencial: null };
    const b = banco();
    expect(await trocar(b, "essencial")).toMatchObject({ ok: true });
    expect(b.cadeias.some((c) => c.tabela === "ai_agents")).toBe(false);
    const semLinha = banco();
    teto = {};
    expect(await trocar(semLinha, "essencial")).toMatchObject({ ok: true });
    expect(semLinha.cadeias.some((c) => c.tabela === "ai_agents")).toBe(false);
  });

  it("não deu para medir: 500, e a troca não acontece", async () => {
    teto = { essencial: 1 };
    const b = bancoFalso((c: Cadeia) => {
      if (c.tabela === "mia_plano_modulos") return { data: null, error: { message: "fora do ar" } };
      if (c.tabela === "cobranca_planos") return { data: PLANOS.find((p) => p.id === valorDoFiltro(c, "eq", "id")) ?? null };
      if (c.tabela === "user_organizations" || c.tabela === "channel_sessions") return { count: 1 };
      return { data: { ...EM_TESTE } };
    });
    expect(await trocar(b, "essencial")).toMatchObject({ ok: false, status: 500 });
  });

  it("as telas de troca (do cliente e do dono) listam o que arquivar", () => {
    const erro = new ApiError(409, "plan_limit_reached", { excedente: { assentos: 1, agentes: 2 } }, "req", "O uso atual não cabe no plano escolhido.");
    expect(oQueRemover(erro)).toEqual([
      { recurso: "assentos", n: 1 },
      { recurso: "agentes", n: 2 },
    ]);
    expect(FRASE_DO_EXCEDENTE.agentes.replace("{n}", "2")).toBe("Arquive 2 agente(s) de IA em Agentes de IA.");
  });
});

describe("⭐ o dono atribui plano a empresa isenta: o_que_tirar traz os agentes", () => {
  const PLANO = "00000000-0000-4000-8000-0000000000b1";
  const responder = (agentes: number, teto: number | null) => (c: CadeiaLivre) => {
    if (c.tabela === "platform_config") return { data: [{ chave: "MODULO_COBRANCA", valor: "ligado" }] };
    if (c.tabela === "organizations") return { data: { id: ORG, status: "active", suspended_kind: null } };
    if (c.tabela === "cobranca_planos") return { data: { id: PLANO, intervalo: "mes", trial_dias: 14, max_assentos: 5, max_canais: 2, arquivado_em: null } };
    if (c.tabela === "cobranca_assinaturas" && operacaoLivre(c) === "insert") return { data: null, error: null };
    if (c.tabela === "cobranca_assinaturas") return { data: null };
    if (c.tabela === "user_organizations" || c.tabela === "channel_sessions") return { count: 1 };
    if (c.tabela === "mia_plano_modulos") return { data: { max_agentes: teto } };
    if (c.tabela === "ai_agents") return { count: agentes };
    return { data: [] };
  };
  const ator = { userId: AUTOR, tokenId: "tok", requestId: "req" };

  it("3 agentes num plano de teto 1: recusa com o_que_tirar.agentes = 2 e não atribui", async () => {
    const b = bancoLivre(responder(3, 1));
    const r = await atribuirOuTrocarPlano(b.cliente as never, ORG, PLANO, ator);
    expect(r).toMatchObject({ ok: false, code: "uso_acima_do_plano", details: { o_que_tirar: { agentes: 2 } } });
    expect(b.cadeias.some((c) => c.tabela === "cobranca_assinaturas" && operacaoLivre(c) === "insert")).toBe(false);
  });

  it("cabe: atribui como antes", async () => {
    const b = bancoLivre(responder(1, 1));
    const r = await atribuirOuTrocarPlano(b.cliente as never, ORG, PLANO, ator);
    expect(r).toMatchObject({ ok: true, quando: "atribuido" });
  });
});

// ---------------------------------------------------------------------------
// 4. o MCP de plataforma: plataforma_garantir_planos e plataforma_ver_cobranca
// ---------------------------------------------------------------------------

describe("plataforma_garantir_planos aceita `agentes` (seção 9)", () => {
  const PLANO = "00000000-0000-4000-8000-0000000000c1";
  const LINHA = {
    id: PLANO, nome: "Essencial", preco_cents: 14700, moeda: "BRL", intervalo: "mes", trial_dias: 14, max_assentos: 1,
    max_canais: 1, teto_ia_usd_cents: null, padrao_no_cadastro: false, oferecido_ao_cliente: true, arquivado_em: null,
  };
  const ctx = (b: ReturnType<typeof bancoLivre>) => ({ admin: b.cliente as never, autorUserId: AUTOR, tokenId: "tok", requestId: "req" });
  // A leitura (ver_cobranca) com a cobrança ligada pergunta mais ao provedor; os planos vêm igual.
  let ligada = true;
  const comum = (c: CadeiaLivre) => {
    if (c.tabela === "platform_config") return { data: ligada ? [{ chave: "MODULO_COBRANCA", valor: "ligado" }] : [] };
    return null;
  };
  beforeEach(() => {
    ligada = true;
  });
  const chamar = (nome: string, b: ReturnType<typeof bancoLivre>, args: Record<string, unknown>) =>
    FERRAMENTA_POR_NOME.get(nome)!.handler(ctx(b), args);
  const upsertDoLado = (b: ReturnType<typeof bancoLivre>) =>
    b.cadeias.filter((c) => c.tabela === "mia_plano_modulos" && operacaoLivre(c) === "upsert").map((c) => argumentosLivres(c, "upsert")?.[0] as Record<string, unknown>);

  it("⭐ plano novo com agentes: 2 grava max_agentes na linha nossa", async () => {
    const b = bancoLivre((c) => {
      const x = comum(c);
      if (x) return x;
      if (c.tabela === "cobranca_planos" && operacaoLivre(c) === "insert") return { data: { id: PLANO } };
      if (c.tabela === "mia_plano_modulos" && c.passos.some((p) => p.metodo === "maybeSingle")) return { data: null };
      return { data: [] };
    });
    const r = (await chamar("plataforma_garantir_planos", b, { planos: [{ nome: "Essencial", preco: 147, agentes: 2 }] })) as { ok: boolean; criados: string[] };
    expect(r).toMatchObject({ ok: true, criados: ["Essencial"] });
    expect(upsertDoLado(b)[0]).toMatchObject({ plano_id: PLANO, max_agentes: 2 });
  });

  const existente = (teto: number | null, assinantes: string[] = []) =>
    bancoLivre((c) => {
      const x = comum(c);
      if (x) return x;
      if (c.tabela === "cobranca_planos") return { data: [LINHA] };
      if (c.tabela === "cobranca_assinaturas") return { data: assinantes.map((o) => ({ organization_id: o })) };
      const lado = { plano_id: PLANO, modulos: [], preco_por_mensagem_cents: null, preco_por_email_cents: null, max_agentes: teto, frase: null, destaque: false };
      if (c.tabela === "mia_plano_modulos" && c.passos.some((p) => p.metodo === "maybeSingle")) return { data: lado };
      if (c.tabela === "mia_plano_modulos") return { data: [lado] };
      return { data: [] };
    });

  it("⭐ rodar de novo com o mesmo teto não grava nada (reexecução segura); ausente mantém", async () => {
    for (const pedido of [{ nome: "Essencial", preco: 147, agentes: 2 }, { nome: "Essencial", preco: 147 }]) {
      const b = existente(2);
      const r = (await chamar("plataforma_garantir_planos", b, { planos: [pedido] })) as { ok: boolean; sem_mudanca: string[] };
      expect(r, JSON.stringify(pedido)).toMatchObject({ ok: true, sem_mudanca: ["Essencial"] });
      expect(upsertDoLado(b)).toHaveLength(0);
    }
  });

  it("⭐ o teto muda em plano ASSINADO (como pessoas e números no upstream); null tira o limite", async () => {
    const b = existente(2, [ORG]);
    const r = (await chamar("plataforma_garantir_planos", b, { planos: [{ nome: "Essencial", preco: 147, agentes: 5 }] })) as { ok: boolean; ajustados: string[] };
    expect(r).toMatchObject({ ok: true, ajustados: ["Essencial"] });
    expect(upsertDoLado(b)[0]).toMatchObject({ max_agentes: 5 });
    const tirar = existente(2);
    await chamar("plataforma_garantir_planos", tirar, { planos: [{ nome: "Essencial", preco: 147, agentes: null }] });
    expect(upsertDoLado(tirar)[0]).toMatchObject({ max_agentes: null });
  });

  it("o schema: de 1 a 1000, inteiro, ou null; a descrição e o exemplo falam de agentes", () => {
    const f = FERRAMENTA_POR_NOME.get("plataforma_garantir_planos")!;
    const aceita = (agentes: unknown) => z.object(f.inputSchema).safeParse({ planos: [{ nome: "X", preco: 10, agentes }] }).success;
    expect(aceita(1)).toBe(true);
    expect(aceita(1000)).toBe(true);
    expect(aceita(null)).toBe(true);
    expect(aceita(0)).toBe(false);
    expect(aceita(1001)).toBe(false);
    expect(aceita(2.5)).toBe(false);
    expect(f.description).toContain("`agentes`");
    expect(JSON.stringify(f.exemplo)).toContain('"agentes"');
  });

  it("plataforma_ver_cobranca mostra `agentes` de cada plano (null = sem limite)", async () => {
    ligada = false;
    const r = (await chamar("plataforma_ver_cobranca", existente(3), {})) as { planos: Array<Record<string, unknown>> };
    expect(r.planos[0]).toMatchObject({ nome: "Essencial", agentes: 3 });
    const sem = (await chamar("plataforma_ver_cobranca", existente(null), {})) as { planos: Array<Record<string, unknown>> };
    expect(sem.planos[0]!.agentes).toBeNull();
  });

  it("plataforma_atribuir_plano chama o recurso pelo nome (agentes)", () => {
    const fonte = readFileSync(path.join(RAIZ, "lib/mcp-plataforma/ferramentas/cobranca.ts"), "utf8");
    expect(fonte).toContain('recurso === "agentes" ? "agentes"');
  });
});

// ---------------------------------------------------------------------------
// 5. a vaga lida para o painel e para plataforma_ver_agentes
// ---------------------------------------------------------------------------

describe("a vaga de agentes lida pelo servidor", () => {
  const banco = (teto: number | null, emUso: number, falha = false) =>
    bancoLivre(
      () => ({ count: emUso }),
      (nome) => (nome === "fn_mia_limite_de_agentes" ? (falha ? { error: { message: "fora do ar" } } : { data: teto }) : {}),
    );

  it("⭐ painel: sem teto, nada (a linha não aparece) e nem conta; com teto, uso e teto", async () => {
    const sem = banco(null, 2);
    expect(await agentesDoPainel(sem.cliente as never, ORG)).toBeNull();
    expect(sem.cadeias).toHaveLength(0);
    expect(await agentesDoPainel(banco(3, 2).cliente as never, ORG)).toEqual({ emUso: 2, limite: 3 });
    expect(await agentesDoPainel(banco(3, 2, true).cliente as never, ORG)).toBeNull();
  });

  it("plataforma_ver_agentes: em_uso e limite_do_plano; falha diz que não leu", async () => {
    const b = banco(2, 1);
    expect(await retratoDoLimiteDeAgentes(b.cliente as never, ORG)).toEqual({ em_uso: 1, limite_do_plano: 2 });
    expect(b.rpcs).toEqual([{ nome: "fn_mia_limite_de_agentes", args: { p_org: ORG } }]);
    expect(filtroLivre(b.cadeias[0]!, "eq", "organization_id")).toBe(ORG);
    expect(await retratoDoLimiteDeAgentes(banco(null, 4).cliente as never, ORG)).toEqual({ em_uso: 4, limite_do_plano: null });
    expect(await retratoDoLimiteDeAgentes(banco(2, 1, true).cliente as never, ORG)).toHaveProperty("nao_lido");
  });

  it("excedenteDeAgentesNoPlano: o formato do excedente do upstream", async () => {
    const b = bancoLivre((c) => (c.tabela === "mia_plano_modulos" ? { data: { max_agentes: 2 } } : { count: 5 }));
    expect(await excedenteDeAgentesNoPlano(b.cliente as never, ORG, "p")).toEqual({ agentes: 3 });
    const cabe = bancoLivre((c) => (c.tabela === "mia_plano_modulos" ? { data: { max_agentes: 9 } } : { count: 5 }));
    expect(await excedenteDeAgentesNoPlano(cabe.cliente as never, ORG, "p")).toEqual({});
  });
});

describe("⭐ o painel Plano e cobrança: a linha Agentes de IA só com teto", () => {
  const PLANO = { id: "plano-a", nome: "Essencial", preco_cents: 14700, moeda: "BRL", intervalo: "mes", max_assentos: 1, max_canais: 1, teto_ia_usd_cents: null };
  const DADOS: DadosDoPainel = {
    assinatura: {
      estado: "trial", trial_ate: "2026-12-10T12:00:00Z", prazo_extra_ate: null, proximo_vencimento: null, vencida_desde: null,
      cancela_no_fim: false, modo: null, provedor: null, link_de_pagamento: null, assinaturas_vivas: 0, plano_agendado: null,
      periodo_pago_desde: null, troca_pagamento_url: null, troca_status: null, pagamento_inicial_pendente: false,
    },
    plano: PLANO,
    uso: { assentos: 1, canais: 1 },
    gastoIaUsdCents: 0,
    planosParaTroca: [],
    fuso: null,
    checkout: { provedor: null, documentoDoCadastro: null },
  };

  it("sem teto (ou sem a prop): a linha não existe", () => {
    const { container } = render(<PainelDaAssinatura dados={DADOS} idioma="pt-BR" />);
    expect(container.querySelector('[data-uso="agentes"]')).toBeNull();
    expect(container.textContent).not.toContain("Agentes de IA");
  });

  it("com teto: \"Agentes de IA · 2 de 3\"", () => {
    const { container } = render(<PainelDaAssinatura dados={DADOS} idioma="pt-BR" agentes={{ emUso: 2, limite: 3 }} />);
    expect(container.querySelector('[data-uso="agentes"]')?.textContent).toBe("2 de 3");
    expect(container.textContent).toContain("Agentes de IA");
  });
});
