/**
 * FORK MIA (.107) · O DOMINGO NO HORÁRIO e as "DUAS PERGUNTAS" da página de
 * conexão (ajuste do dono em 06/11/2026).
 *
 *  1. o DOMINGO, com a regra do sábado: abre no horário da semana e vai até
 *     `domingoAte`; nulo (ou ausente, o raio-X de antes) = fechado. Vale em
 *     `lojaAberta` e em `proximaAbertura`, e o cadastro da Time recusa o domingo
 *     que fecha antes de abrir;
 *  2. o horário da CONTA do cliente ativo: o agente que atende no domingo (0 na
 *     janela dele) abre o domingo do raio-X;
 *  3. `POST /api/v1/publico/raio-x/<código>/horario`: aceita ANTES do relatório
 *     (e grava no raio-X), recusa DEPOIS (409 com a frase), recusa o raio-X da
 *     Time, valida o horário como o cadastro e confere a origem.
 *
 * Dados fictícios.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.INTERNAL_SECRET = "segredo-do-teste-do-raio-x";
  return { banco: undefined as unknown as { cliente: unknown; db: Record<string, Array<Record<string, unknown>>> } };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.banco.cliente }));
vi.mock("@/lib/auth/rate-limit", () => ({ authRateLimited: async () => false }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined), isServiceRoleConfigured: () => true }));

const { env } = await import("@/lib/env");
const { lojaAberta, momentoLocal, proximaAbertura } = await import("@/lib/raio-x/horario");
const { horarioDoRaioX, validarNovoRaioX } = await import("@/lib/raio-x/regras");
const { horarioDaConta, HORARIO_PADRAO } = await import("@/lib/raio-x/conta");
const { codigoDaConexao, hashDoCodigo } = await import("@/lib/raio-x/tokens");
const { bancoEmMemoria } = await import("@/tests/helpers/banco-em-memoria");
const rota = await import("@/app/api/v1/publico/raio-x/[codigo]/horario/route");

const APP = new URL(env.NEXT_PUBLIC_APP_URL).origin;
// Domingo, 08/11/2026, e segunda, 09/11/2026, no fuso de São Paulo (UTC-3).
const DOMINGO_10H = Date.parse("2026-11-08T13:00:00Z");
const DOMINGO_14H = Date.parse("2026-11-08T17:00:00Z");
const DOMINGO_7H = Date.parse("2026-11-08T10:00:00Z");
const SEGUNDA_8H = Date.parse("2026-11-09T11:00:00Z");

describe("o domingo no horário comercial", () => {
  const semana = { abre: 8 * 60, fecha: 18 * 60, sabadoAte: 13 * 60 };

  it("⭐ fechado (nulo ou ausente, o raio-X de antes): o domingo inteiro é loja fechada", () => {
    expect(lojaAberta(momentoLocal(DOMINGO_10H), semana)).toBe(false);
    expect(lojaAberta(momentoLocal(DOMINGO_10H), { ...semana, domingoAte: null })).toBe(false);
  });

  it("⭐ aberto até as 12h: abre no horário da semana e fecha no domingoAte", () => {
    const comDomingo = { ...semana, domingoAte: 12 * 60 };
    expect(lojaAberta(momentoLocal(DOMINGO_10H), comDomingo)).toBe(true);
    expect(lojaAberta(momentoLocal(DOMINGO_7H), comDomingo)).toBe(false);
    expect(lojaAberta(momentoLocal(DOMINGO_14H), comDomingo)).toBe(false);
  });

  it("a próxima abertura: fechado, pula o domingo até segunda; aberto, abre no domingo", () => {
    const sabadoDepois = Date.parse("2026-11-07T20:00:00Z"); // sábado 17h, depois das 13h
    expect(proximaAbertura(sabadoDepois, semana)).toBe(SEGUNDA_8H);
    expect(proximaAbertura(sabadoDepois, { ...semana, domingoAte: 12 * 60 })).toBe(Date.parse("2026-11-08T11:00:00Z"));
  });

  it("o raio-X gravado: a coluna nula ou ausente é fechado; preenchida, o domingo", () => {
    expect(horarioDoRaioX({ abre: "08:00:00", fecha: "18:00:00", sabado_ate: "13:00:00" }).domingoAte).toBeNull();
    expect(horarioDoRaioX({ abre: "08:00:00", fecha: "18:00:00", sabado_ate: null, domingo_ate: "12:00:00" }).domingoAte).toBe(12 * 60);
  });

  it("o cadastro da Time: domingo opcional (padrão fechado) e recusado quando fecha antes de abrir", () => {
    const base = { empresa: "Garagem Modelo Veículos", segmento: "revenda_de_veiculos", whatsapp: "(31) 90000-1101" };
    const padrao = validarNovoRaioX(base);
    expect(padrao.ok && padrao.valor.domingo_ate).toBeNull();
    const aberto = validarNovoRaioX({ ...base, domingo_ate: "12:00" });
    expect(aberto.ok && aberto.valor.domingo_ate).toBe("12:00");
    expect(validarNovoRaioX({ ...base, domingo_ate: "07:00" })).toEqual({ ok: false, campos: ["domingo_ate"] });
  });

  it("o horário da conta do cliente ativo: o agente que atende no domingo (0) abre o domingo", async () => {
    const versao = (weekdays: number[]) => ({ trigger_config: { filters: { business_hours: { timezone: "America/Sao_Paulo", start: "09:00", end: "17:00", weekdays } } } });
    const banco = (weekdays: number[]) =>
      bancoEmMemoria({
        ai_agents: [{ organization_id: "org-modelo", published_version_id: "v1" }],
        ai_agent_versions: [{ id: "v1", ...versao(weekdays) }],
      });
    const comDomingo = await horarioDaConta(banco([0, 1, 2, 3, 4, 5, 6]).cliente as never, "org-modelo");
    expect(comDomingo).toMatchObject({ abre: "09:00", fecha: "17:00", sabadoAte: "17:00", domingoAte: "17:00", daConta: true });
    const semDomingo = await horarioDaConta(banco([1, 2, 3, 4, 5]).cliente as never, "org-modelo");
    expect(semDomingo).toMatchObject({ sabadoAte: null, domingoAte: null });
    expect(HORARIO_PADRAO.domingoAte).toBeNull();
  });
});

// ─── as duas perguntas ──────────────────────────────────────────────────────

const RX = "e9152e90-2222-4000-8000-0000000107a1";
const CODIGO = codigoDaConexao(RX, 1);

function raioX(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RX,
    fonte: "conexao",
    origem: "cadastro",
    gratis: true,
    empresa: "Garagem Modelo Veículos",
    segmento: "revenda_de_veiculos",
    whatsapp: "5531900001101",
    quem_atende: "humano",
    periodo_dias: 30,
    tipo: "unico",
    abre: "08:00:00",
    fecha: "18:00:00",
    sabado_ate: "13:00:00",
    domingo_ate: null,
    situacao: "lendo",
    conexao_versao: 1,
    conexao_codigo_hash: hashDoCodigo(CODIGO),
    conexao_expira_em: new Date().toISOString(),
    ultimo_relatorio_em: null,
    leitura: { fase: "sincronizando" },
    ...extra,
  };
}

const salvar = (corpo: unknown, origem = APP) =>
  rota.POST(
    new NextRequest(`${APP}/api/v1/publico/raio-x/${CODIGO}/horario`, { method: "POST", body: JSON.stringify(corpo), headers: { "content-type": "application/json", origin: origem } }),
    { params: Promise.resolve({ codigo: CODIGO }) },
  );

const RESPOSTA = { quem_atende: "misto", abre: "09:00", fecha: "19:00", sabado_ate: "", domingo_ate: "13:00" };

describe("as duas perguntas da página de conexão", () => {
  beforeEach(() => {
    h.banco = bancoEmMemoria({ mia_raio_x: [raioX()] }) as never;
  });

  it("⭐ antes do relatório: aceita e grava no raio-X (sábado vazio = fechado, o domingo aberto)", async () => {
    const r = await salvar(RESPOSTA);
    expect(r.status).toBe(200);
    expect(h.banco.db.mia_raio_x![0]).toMatchObject({ quem_atende: "misto", abre: "09:00", fecha: "19:00", sabado_ate: null, domingo_ate: "13:00" });
  });

  it("vale também enquanto analisa (a análise lê o horário do banco na hora)", async () => {
    h.banco = bancoEmMemoria({ mia_raio_x: [raioX({ situacao: "analisando" })] }) as never;
    expect((await salvar(RESPOSTA)).status).toBe(200);
  });

  it("⭐ depois do relatório: 409 com a frase, e nada muda", async () => {
    h.banco = bancoEmMemoria({ mia_raio_x: [raioX({ situacao: "pronto", ultimo_relatorio_em: new Date().toISOString() })] }) as never;
    const r = await salvar(RESPOSTA);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: { message: string } }).error.message).toMatch(/O relatório já saiu/);
    expect(h.banco.db.mia_raio_x![0]).toMatchObject({ quem_atende: "humano", abre: "08:00:00" });
  });

  it("o raio-X da Time não muda por aqui (o horário foi combinado com ela)", async () => {
    h.banco = bancoEmMemoria({ mia_raio_x: [raioX({ origem: "time", gratis: false })] }) as never;
    const r = await salvar(RESPOSTA);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: { message: string } }).error.message).toMatch(/combinado com a Time/);
  });

  it("⭐ valida como o cadastro: fecha antes de abrir, domingo antes de abrir, quem atende inventado", async () => {
    const r = await salvar({ quem_atende: "polvo", abre: "09:00", fecha: "08:00", sabado_ate: "", domingo_ate: "07:00" });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { details: { campos: string[] } } }).error.details.campos).toEqual(["quem_atende", "fecha", "domingo_ate"]);
    expect(h.banco.db.mia_raio_x![0]).toMatchObject({ quem_atende: "humano" });
  });

  it("de fora da página, 403; código que não existe, 404", async () => {
    expect((await salvar(RESPOSTA, "https://golpe.invalid")).status).toBe(403);
    h.banco = bancoEmMemoria({ mia_raio_x: [] }) as never;
    expect((await salvar(RESPOSTA)).status).toBe(404);
  });
});
