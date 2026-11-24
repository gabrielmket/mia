// @vitest-environment node
/**
 * FORK MIA (MIA-168) — O CADASTRO DO /SIGNUP VIRA LEAD NO CRM DA TIME E ANDA NO
 * FUNIL "MIA - SDR" (docs/fork/jornada-de-assinatura.md, "O lead do cadastro").
 *
 * O caminho inteiro contra um banco de mentira com estado: o envio (a linha e o
 * lead em Novo contato), o nascimento (Cadastro concluído e Em teste), o
 * pagamento (Assinante com o valor em BRL), a repetição de cada momento (não
 * move nem duplica), a falta da variável ou da fonte (o erro na linha, nunca
 * uma exceção) e a leitura do MCP.
 *
 * Nenhum dado daqui é de cliente real (Ana Exemplo, Empresa Alfa).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  asaas: {
    lerCobranca: async (_ref: string) => ({ ref: "", situacao: "aberta", valorCents: 0 }) as { ref: string; situacao: string; valorCents: number },
    listarCobrancasDaAssinatura: async (_ref: string) => [] as Array<{ ref: string; situacao: string; valorCents: number; pagaEm: string | null; vencimento: string }>,
  },
  notas: [] as Array<{ reason: string }>,
}));
vi.mock("@/lib/asaas-mia/cobrancas", () => ({ asaasDaMia: () => h.asaas }));
vi.mock("@/lib/leads/activity-emitter", () => ({
  emitLeadActivity: async (_c: unknown, a: { reason: string }) => {
    h.notas.push(a);
  },
}));

import { FERRAMENTAS_DE_COBRANCA } from "@/lib/mcp-plataforma/ferramentas/cobranca";
import {
  aoNascerAEmpresa,
  consentimentoDoCookie,
  corpoDoCadastro,
  ETAPAS_DO_CADASTRO,
  idExternoDoCadastro,
  informarPagamentoATime,
  nasceuNoTeste,
  paginaSemQuery,
  registrarCadastroNaTime,
  rodadaDoCadastroNaTime,
  telefoneDoCadastro,
  type DependenciasDoLeadDoCadastro,
} from "@/lib/planos-mia/lead-do-cadastro";
import { leadDoCadastroHandler } from "@/lib/planos-mia/lead-do-cadastro.handler";
import { origemDoCadastroSchema, origemDoLink } from "@/lib/planos-mia/origem-do-cadastro";
import { signupSchema } from "@/lib/auth/schemas";
import { bancoLivre, filtroLivre, operacaoLivre, type CadeiaLivre } from "@/tests/helpers/banco-livre";

const USUARIO = "00000000-0000-4000-8000-00000000a001";
const EMPRESA = "00000000-0000-4000-8000-00000000a002";
const TIME = "00000000-0000-4000-8000-00000000a003";
const FONTE = "00000000-0000-4000-8000-00000000a004";
const LEAD = "00000000-0000-4000-8000-00000000a005";
const FUNIL = "00000000-0000-4000-8000-00000000a006";
const NOVO = "00000000-0000-4000-8000-00000000b001";
const CONCLUIDO = "00000000-0000-4000-8000-00000000b002";
const EM_TESTE = "00000000-0000-4000-8000-00000000b003";
const ASSINANTE = "00000000-0000-4000-8000-00000000b004";

type Linha = Record<string, unknown>;

interface Estado {
  linhas: Linha[];
  etapas: Array<{ id: string; name: string }>;
  etapaDoLead: string;
  origem: "cadastro" | "implantacao";
  demonstracao: boolean;
  assinatura: Record<string, unknown> | null;
  pagamentoRef: string | null;
  fonteAtiva: boolean;
}
let e: Estado;

function aplicarFiltros(c: CadeiaLivre, linhas: Linha[]): Linha[] {
  return linhas.filter((l) =>
    c.passos.every((p) => {
      const [col, v, w] = p.args as [string, unknown, unknown];
      if (p.metodo === "eq") return l[col] === v;
      if (p.metodo === "is") return (l[col] ?? null) === v;
      if (p.metodo === "not") return v === "is" ? (l[col] ?? null) !== w : true;
      if (p.metodo === "in") return (v as unknown[]).includes(l[col]);
      return true;
    }),
  );
}

function tabelaDoCadastro(c: CadeiaLivre) {
  const op = operacaoLivre(c);
  if (op === "upsert") {
    const nova = (c.passos.find((p) => p.metodo === "upsert")!.args[0] ?? {}) as Linha;
    if (!e.linhas.some((l) => l.user_id === nova.user_id)) {
      e.linhas.push({
        id: `linha-${e.linhas.length + 1}`,
        organization_id: null,
        lead_id: null,
        empresa_cliente_id: null,
        fbp: null,
        fbc: null,
        consentimento: null,
        origem: {},
        crm_erro: null,
        cadastro_concluido_em: null,
        teste_comecou_em: null,
        pagamento_confirmado_em: null,
        valor_cents: null,
        pedido_id: null,
        capturado_em: "2026-11-20T12:00:00.000Z",
        guardar_ate: "2027-02-18T12:00:00.000Z",
        ...nova,
      });
    }
    return { data: null };
  }
  if (op === "update") {
    const valores = c.passos.find((p) => p.metodo === "update")!.args[0] as Linha;
    for (const l of aplicarFiltros(c, e.linhas)) Object.assign(l, valores);
    return { data: null };
  }
  const achadas = aplicarFiltros(c, e.linhas);
  return c.passos.some((p) => p.metodo === "maybeSingle") ? { data: achadas[0] ?? null } : { data: achadas };
}

function responder(c: CadeiaLivre) {
  switch (c.tabela) {
    case "mia_cadastro_na_time":
      return tabelaDoCadastro(c);
    case "webhook_sources":
      return { data: { id: FONTE, organization_id: TIME, path_token: "tok-fonte", secret_encrypted: null, is_active: e.fonteAtiva } };
    case "organizations":
      return { data: { id: EMPRESA, display_name: "Empresa Alfa", created_by: USUARIO, demonstracao: e.demonstracao, status: "active" } };
    case "mia_origem_da_empresa":
      return c.passos.some((p) => p.metodo === "maybeSingle") ? { data: { origem: e.origem } } : { data: [{ organization_id: EMPRESA }] };
    case "cobranca_assinaturas":
      return { data: e.assinatura };
    case "crm_leads":
      return { data: { id: LEAD, pipeline_id: FUNIL, stage_id: e.etapaDoLead } };
    case "crm_stages":
      return { data: e.etapas };
    case "mia_pagamento_inicial":
      return { data: e.pagamentoRef ? { pagamento_ref: e.pagamentoRef } : null };
    case "cobranca_planos":
      return { data: { nome: "Profissional" } };
    default:
      return { data: null };
  }
}

function banco() {
  const b = bancoLivre(responder, (nome) => (nome === "fn_mia_cadastro_na_time_limpar" ? { data: 2 } : {}));
  (b.cliente.auth.admin as { getUserById: unknown }).getUserById = async () => ({ data: { user: { email: "ana@exemplo.test" } }, error: null });
  return b;
}

const processar = vi.fn(async (_token: string, _corpo: string, _h: Record<string, string>) =>
  new Response(JSON.stringify({ data: { lead_id: LEAD } }), { status: 200, headers: { "content-type": "application/json" } }),
);
const mover = vi.fn(async (_org: string, _fonte: string, _lead: string, etapa: string) => {
  e.etapaDoLead = etapa;
});
const valor = vi.fn(async (_org: string, _fonte: string, _lead: string, _cents: number) => undefined);
const AGORA = new Date("2026-11-21T12:00:00.000Z");
const deps = (extra: Partial<DependenciasDoLeadDoCadastro> = {}): DependenciasDoLeadDoCadastro => ({
  fonteId: FONTE,
  processar,
  portas: { mover, valor },
  agora: () => AGORA,
  ...extra,
});

const ENVIO = {
  userId: USUARIO,
  email: "ana@exemplo.test",
  empresa: "Empresa Alfa",
  plano: "Profissional",
  origem: { utm_source: "google", utm_campaign: "lancamento", gclid: "gclid-de-teste", fbclid: "fbclid-de-teste" },
  fbp: "fb.1.1700000000000.123",
  fbc: "fb.1.1700000000000.abc",
  consentimento: "medicao" as const,
  ip: "203.0.113.7",
  navegador: "Mozilla/5.0 (teste)",
  pagina: "https://app.exemplo.test/signup?utm_source=google&gclid=gclid-de-teste",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.notas = [];
  h.asaas.lerCobranca = async () => ({ ref: "", situacao: "aberta", valorCents: 0 });
  h.asaas.listarCobrancasDaAssinatura = async () => [];
  e = {
    linhas: [],
    etapas: [
      { id: NOVO, name: "Novo contato" },
      { id: CONCLUIDO, name: "Cadastro concluído" },
      { id: EM_TESTE, name: "Em teste" },
      { id: ASSINANTE, name: "Assinante" },
    ],
    etapaDoLead: NOVO,
    origem: "cadastro",
    demonstracao: false,
    assinatura: { estado: "trial", trial_ate: "2026-12-05T12:00:00.000Z", pagamento_inicial_pendente: false, provedor: "asaas", provedor_assinatura_id: "sub_teste", plano_id: null },
    pagamentoRef: null,
    fonteAtiva: true,
  };
});

describe("o corpo e as réguas puras", () => {
  it("external_id por conta, origem cadastro-mia, os ids de clique e fbp/fbc só com medicao", () => {
    const corpo = corpoDoCadastro({ ...ENVIO, nome: "Ana Exemplo", telefone: "(11) 91234-5678", cupom: "BEMVINDO" });
    expect(corpo).toMatchObject({
      external_id: idExternoDoCadastro(USUARIO),
      email: "ana@exemplo.test",
      empresa: "Empresa Alfa",
      nome: "Ana Exemplo",
      telefone: "+5511912345678",
      plano: "Profissional",
      cupom: "BEMVINDO",
      utm_source: "google",
      gclid: "gclid-de-teste",
      fbclid: "fbclid-de-teste",
      fbp: ENVIO.fbp,
      fbc: ENVIO.fbc,
      consentimento_cookies: "medicao",
      origem: "cadastro-mia",
    });
    expect(idExternoDoCadastro(USUARIO)).toBe(`mia-cadastro-${USUARIO}`);
    const semMedicao = corpoDoCadastro({ ...ENVIO, consentimento: "necessario" });
    expect(semMedicao.fbp).toBeUndefined();
    expect(semMedicao.fbc).toBeUndefined();
    expect(semMedicao.consentimento_cookies).toBe("necessario");
    // Sem a entrada paga, nome e telefone não vão.
    expect(corpoDoCadastro(ENVIO).nome).toBeUndefined();
    expect(corpoDoCadastro(ENVIO).telefone).toBeUndefined();
  });

  it("cookie, telefone, página e teste", () => {
    expect(consentimentoDoCookie("medicao")).toBe("medicao");
    expect(consentimentoDoCookie(" NECESSARIO ")).toBe("necessario");
    expect(consentimentoDoCookie("tudo")).toBeNull();
    expect(telefoneDoCadastro("1133334444")).toBe("+551133334444");
    expect(telefoneDoCadastro("12")).toBeNull();
    expect(paginaSemQuery("https://app.exemplo.test/signup?gclid=x#topo")).toBe("https://app.exemplo.test/signup");
    expect(paginaSemQuery("javascript:alert(1)")).toBeNull();
    expect(nasceuNoTeste(e.assinatura as never, AGORA)).toBe(true);
    expect(nasceuNoTeste({ ...(e.assinatura as object), pagamento_inicial_pendente: true } as never, AGORA)).toBe(false);
  });

  it("a origem do link: só as chaves conhecidas, com teto, no signupSchema", () => {
    expect(origemDoLink({ utm_source: "meta", gclid: ["g1", "g2"], invite: "x", plano: "Pro" })).toEqual({ utm_source: "meta", gclid: "g1" });
    expect(origemDoCadastroSchema.safeParse({ utm_source: "x" }).success).toBe(true);
    expect(origemDoCadastroSchema.safeParse({ outra: "x" }).success).toBe(false);
    expect(origemDoCadastroSchema.safeParse({ gclid: "g".repeat(501) }).success).toBe(false);
    const base = { org_name: "Empresa Alfa", email: "ana@exemplo.test", password: "senha-de-teste-1", password_confirm: "senha-de-teste-1" };
    expect(signupSchema.safeParse({ ...base, mia_origem: { utm_source: "google" } }).success).toBe(true);
    expect(signupSchema.safeParse({ ...base, mia_origem: { campo_estranho: "x" } }).success).toBe(false);
  });
});

describe("1. o envio do /signup", () => {
  it("⭐ grava a linha (IP, navegador, cliques, página sem query) e o lead em Novo contato pela fonte", async () => {
    const b = banco();
    const r = await registrarCadastroNaTime(b.cliente as never, ENVIO, deps());
    expect(r).toEqual({ ok: true, leadId: LEAD });
    expect(processar).toHaveBeenCalledTimes(1);
    const [token, corpo] = processar.mock.calls[0]!;
    expect(token).toBe("tok-fonte");
    expect(JSON.parse(corpo)).toMatchObject({ external_id: `mia-cadastro-${USUARIO}`, gclid: "gclid-de-teste", fbclid: "fbclid-de-teste" });
    expect(e.linhas).toHaveLength(1);
    expect(e.linhas[0]).toMatchObject({
      user_id: USUARIO,
      organization_id: TIME,
      lead_id: LEAD,
      ip: "203.0.113.7",
      navegador: "Mozilla/5.0 (teste)",
      gclid: "gclid-de-teste",
      fbp: ENVIO.fbp,
      consentimento: "medicao",
      pagina: "https://app.exemplo.test/signup",
      crm_erro: null,
    });
    expect((e.linhas[0]!.origem as Record<string, string>).fbclid).toBe("fbclid-de-teste");
    // O cadastro não move card: Novo contato é a etapa da fonte.
    expect(mover).not.toHaveBeenCalled();
  });

  it("sem medicao, fbp e fbc nem são gravados", async () => {
    await registrarCadastroNaTime(banco().cliente as never, { ...ENVIO, consentimento: "necessario" }, deps());
    expect(e.linhas[0]).toMatchObject({ fbp: null, fbc: null, consentimento: "necessario" });
  });

  it("repetir o envio não duplica a linha nem manda de novo", async () => {
    const b = banco();
    await registrarCadastroNaTime(b.cliente as never, ENVIO, deps());
    const r = await registrarCadastroNaTime(b.cliente as never, ENVIO, deps());
    expect(r).toEqual({ ok: true, leadId: LEAD });
    expect(e.linhas).toHaveLength(1);
    expect(processar).toHaveBeenCalledTimes(1);
  });

  it("⭐ sem a variável: não lança, a linha fica com sem_fonte e o lead nasce depois", async () => {
    const r = await registrarCadastroNaTime(banco().cliente as never, ENVIO, deps({ fonteId: null }));
    expect(r).toEqual({ ok: false, motivo: "sem_fonte" });
    expect(e.linhas[0]).toMatchObject({ crm_erro: "sem_fonte", lead_id: null });
    expect(processar).not.toHaveBeenCalled();
  });

  it("fonte desligada: fonte_inexistente; rota recusou: recusado; rota lançou: falhou", async () => {
    e.fonteAtiva = false;
    expect(await registrarCadastroNaTime(banco().cliente as never, ENVIO, deps())).toEqual({ ok: false, motivo: "fonte_inexistente" });
    e = { ...e, linhas: [], fonteAtiva: true };
    const recusa = vi.fn(async () => new Response(JSON.stringify({ error: "x" }), { status: 422 }));
    expect(await registrarCadastroNaTime(banco().cliente as never, ENVIO, deps({ processar: recusa }))).toEqual({ ok: false, motivo: "recusado" });
    e = { ...e, linhas: [] };
    const quebra = vi.fn(async () => {
      throw new Error("boom");
    });
    expect(await registrarCadastroNaTime(banco().cliente as never, ENVIO, deps({ processar: quebra }))).toEqual({ ok: false, motivo: "falhou" });
    expect(e.linhas[0]!.crm_erro).toBe("falhou");
  });
});

describe("2 e 3. a empresa nasceu", () => {
  it("⭐ Cadastro concluído e Em teste, com nota; repetir não move nada", async () => {
    const b = banco();
    await registrarCadastroNaTime(b.cliente as never, ENVIO, deps());
    const r = await aoNascerAEmpresa(b.cliente as never, EMPRESA, deps());
    expect(r).toEqual({ status: "ok", momentos: ["cadastro_concluido", "teste_comecou"] });
    expect(mover.mock.calls.map((c) => c[3])).toEqual([CONCLUIDO, EM_TESTE]);
    expect(mover.mock.calls[0]!.slice(0, 3)).toEqual([TIME, FONTE, LEAD]);
    expect(e.linhas[0]).toMatchObject({ empresa_cliente_id: EMPRESA, cadastro_concluido_em: AGORA.toISOString(), teste_comecou_em: AGORA.toISOString() });
    expect(h.notas).toHaveLength(2);

    mover.mockClear();
    const de_novo = await aoNascerAEmpresa(b.cliente as never, EMPRESA, deps());
    expect(de_novo).toEqual({ status: "ok", momentos: [] });
    expect(mover).not.toHaveBeenCalled();
  });

  it("entrada paga (nasce parada, sem teste): só Cadastro concluído", async () => {
    e.assinatura = { ...e.assinatura!, pagamento_inicial_pendente: true };
    const b = banco();
    await registrarCadastroNaTime(b.cliente as never, ENVIO, deps());
    expect(await aoNascerAEmpresa(b.cliente as never, EMPRESA, deps())).toEqual({ status: "ok", momentos: ["cadastro_concluido"] });
    expect(e.linhas[0]!.teste_comecou_em).toBeNull();
  });

  it("etapa faltando: não marca o momento, grava sem_etapa:<nome> e não lança", async () => {
    e.etapas = e.etapas.filter((s) => s.name !== ETAPAS_DO_CADASTRO.cadastroConcluido);
    const b = banco();
    await registrarCadastroNaTime(b.cliente as never, ENVIO, deps());
    const r = await aoNascerAEmpresa(b.cliente as never, EMPRESA, deps());
    expect(r).toEqual({ status: "pendente", motivo: "sem_etapa:Cadastro concluído" });
    expect(e.linhas[0]).toMatchObject({ cadastro_concluido_em: null, crm_erro: "sem_etapa:Cadastro concluído" });
  });

  it("⭐ a fonte faltou no envio: o lead nasce agora, com o que a linha guardou", async () => {
    const b = banco();
    await registrarCadastroNaTime(b.cliente as never, ENVIO, deps({ fonteId: null }));
    const r = await aoNascerAEmpresa(b.cliente as never, EMPRESA, deps());
    expect(r.status).toBe("ok");
    const corpo = JSON.parse(processar.mock.calls[0]![1]);
    expect(corpo).toMatchObject({ external_id: `mia-cadastro-${USUARIO}`, email: "ana@exemplo.test", empresa: "Empresa Alfa", utm_source: "google", gclid: "gclid-de-teste", fbp: ENVIO.fbp });
    expect(e.linhas[0]).toMatchObject({ lead_id: LEAD, crm_erro: null });
  });

  it("cadastro pelo Google (sem linha): a linha nasce no nascimento, sem IP nem cookies", async () => {
    const b = banco();
    const r = await aoNascerAEmpresa(b.cliente as never, EMPRESA, deps());
    expect(r.status).toBe("ok");
    expect(e.linhas[0]).toMatchObject({ user_id: USUARIO, lead_id: LEAD, empresa_cliente_id: EMPRESA });
    expect(e.linhas[0]!.ip).toBeUndefined();
  });

  it("implantação, demonstração e isenta ficam fora, sem tocar o CRM", async () => {
    e.origem = "implantacao";
    expect(await aoNascerAEmpresa(banco().cliente as never, EMPRESA, deps())).toEqual({ status: "fora", motivo: "implantacao" });
    e.origem = "cadastro";
    e.demonstracao = true;
    expect(await aoNascerAEmpresa(banco().cliente as never, EMPRESA, deps())).toEqual({ status: "fora", motivo: "demonstracao" });
    e.demonstracao = false;
    e.assinatura = null;
    expect(await aoNascerAEmpresa(banco().cliente as never, EMPRESA, deps())).toEqual({ status: "fora", motivo: "isenta" });
    expect(processar).not.toHaveBeenCalled();
    expect(mover).not.toHaveBeenCalled();
  });

  it("o consumidor: roda na org parada e escuta só o nascimento", async () => {
    expect(leadDoCadastroHandler.naOrgParada).toBe("roda");
    expect(leadDoCadastroHandler.events).toEqual(["cadastro.empresa_nasceu"]);
  });
});

describe("4. o primeiro pagamento", () => {
  async function nascida() {
    const b = banco();
    await registrarCadastroNaTime(b.cliente as never, ENVIO, deps());
    await aoNascerAEmpresa(b.cliente as never, EMPRESA, deps());
    mover.mockClear();
    return b;
  }

  it("⭐ Assinante com o valor em BRL (o valor ANTES do movimento); repetir não move nem duplica", async () => {
    const b = await nascida();
    e.assinatura = { ...e.assinatura!, estado: "ativa" };
    h.asaas.listarCobrancasDaAssinatura = async () => [
      { ref: "pay_2", situacao: "paga", valorCents: 19_900, pagaEm: "2026-12-05", vencimento: "2026-12-05" },
      { ref: "pay_1", situacao: "paga", valorCents: 9_900, pagaEm: "2026-11-21", vencimento: "2026-11-21" },
    ];
    const ordem: string[] = [];
    valor.mockImplementationOnce(async () => {
      ordem.push("valor");
    });
    mover.mockImplementationOnce(async (_o, _f, _l, etapa) => {
      ordem.push("mover");
      e.etapaDoLead = etapa;
    });
    const r = await informarPagamentoATime(b.cliente as never, EMPRESA, deps());
    expect(r).toEqual({ status: "ok", valorCents: 9_900 });
    expect(ordem).toEqual(["valor", "mover"]);
    expect(valor).toHaveBeenCalledWith(TIME, FONTE, LEAD, 9_900);
    expect(mover.mock.calls[0]![3]).toBe(ASSINANTE);
    expect(e.linhas[0]).toMatchObject({ pagamento_confirmado_em: AGORA.toISOString(), valor_cents: 9_900, pedido_id: "pay_1" });

    expect(await informarPagamentoATime(b.cliente as never, EMPRESA, deps())).toEqual({ status: "ja_informado" });
    expect(mover).toHaveBeenCalledTimes(1);
    expect(valor).toHaveBeenCalledTimes(1);
  });

  it("entrada paga: o valor é o da cobrança de mia_pagamento_inicial", async () => {
    const b = await nascida();
    e.assinatura = { ...e.assinatura!, estado: "ativa", pagamento_inicial_pendente: false };
    e.pagamentoRef = "pay_inicial";
    h.asaas.lerCobranca = async (ref) => ({ ref, situacao: "paga", valorCents: 29_700 });
    expect(await informarPagamentoATime(b.cliente as never, EMPRESA, deps())).toEqual({ status: "ok", valorCents: 29_700 });
    expect(e.linhas[0]).toMatchObject({ pedido_id: "pay_inicial", valor_cents: 29_700 });
  });

  it("⭐ sem valor legível: não marca e nunca vai a Assinante", async () => {
    const b = await nascida();
    e.assinatura = { ...e.assinatura!, estado: "ativa" };
    expect(await informarPagamentoATime(b.cliente as never, EMPRESA, deps())).toEqual({ status: "pendente", motivo: "sem_valor" });
    h.asaas.listarCobrancasDaAssinatura = async () => {
      throw new Error("asaas fora");
    };
    expect(await informarPagamentoATime(b.cliente as never, EMPRESA, deps())).toEqual({ status: "pendente", motivo: "valor_ilegivel" });
    expect(mover).not.toHaveBeenCalled();
    expect(e.linhas[0]!.pagamento_confirmado_em).toBeNull();
  });

  it("empresa que não veio do cadastro: fora, sem ler o Asaas", async () => {
    const lerCobranca = vi.spyOn(h.asaas, "lerCobranca");
    expect(await informarPagamentoATime(banco().cliente as never, EMPRESA, deps())).toEqual({ status: "fora", motivo: "sem_cadastro" });
    expect(lerCobranca).not.toHaveBeenCalled();
  });

  it("o pagamento chegou antes do nascimento: os momentos anteriores primeiro", async () => {
    const b = banco();
    await registrarCadastroNaTime(b.cliente as never, ENVIO, deps());
    e.linhas[0]!.empresa_cliente_id = EMPRESA;
    e.assinatura = { ...e.assinatura!, estado: "ativa" };
    h.asaas.listarCobrancasDaAssinatura = async () => [{ ref: "pay_1", situacao: "paga", valorCents: 9_900, pagaEm: "2026-11-21", vencimento: "2026-11-21" }];
    expect(await informarPagamentoATime(b.cliente as never, EMPRESA, deps())).toEqual({ status: "ok", valorCents: 9_900 });
    expect(mover.mock.calls.map((c) => c[3])).toEqual([CONCLUIDO, ASSINANTE]);
  });
});

describe("a rodada e o MCP", () => {
  it("a limpeza sempre roda; sem a variável, nada mais", async () => {
    const b = banco();
    const r = await rodadaDoCadastroNaTime(b.cliente as never, AGORA, deps({ fonteId: null }));
    expect(r).toEqual({ nascimentosCurados: 0, pagamentosInformados: 0, limpas: 2 });
    expect(b.rpcs.map((x) => x.nome)).toEqual(["fn_mia_cadastro_na_time_limpar"]);
  });

  it("cura o nascimento cujo evento se perdeu", async () => {
    const b = banco();
    await registrarCadastroNaTime(b.cliente as never, ENVIO, deps());
    const r = await rodadaDoCadastroNaTime(b.cliente as never, AGORA, deps());
    expect(r.nascimentosCurados).toBe(1);
    expect(e.linhas[0]!.cadastro_concluido_em).toBe(AGORA.toISOString());
  });

  it("plataforma_ver_assinatura e plataforma_listar_pedidos_de_cadastro mostram o lead na Time e o erro", async () => {
    e.linhas.push({
      id: "linha-1", user_id: USUARIO, organization_id: null, lead_id: null, empresa_cliente_id: EMPRESA, crm_erro: "sem_fonte",
      cadastro_concluido_em: null, teste_comecou_em: null, pagamento_confirmado_em: null, valor_cents: null, capturado_em: "2026-11-20T12:00:00.000Z",
    });
    const ver = FERRAMENTAS_DE_COBRANCA.find((f) => f.name === "plataforma_ver_assinatura")!;
    expect(ver.description).toMatch(/LEAD NA TIME/);
    const listar = FERRAMENTAS_DE_COBRANCA.find((f) => f.name === "plataforma_listar_pedidos_de_cadastro")!;
    expect(listar.description).toMatch(/cadastros_na_time/);

    const { lerCadastrosComErro, lerLeadNaTimeDaEmpresa } = await import("@/lib/planos-mia/lead-do-cadastro");
    const b = banco();
    expect(await lerLeadNaTimeDaEmpresa(b.cliente as never, EMPRESA)).toMatchObject({ erro: "sem_fonte", lead_id: null, valor: null });
    const comErro = await lerCadastrosComErro(b.cliente as never);
    expect(comErro.cadastros).toHaveLength(1);
    expect(comErro.cadastros[0]).toMatchObject({ erro: "sem_fonte", empresa_cliente_id: EMPRESA });
    // Só ids, datas e o erro: nada de e-mail, IP ou navegador na leitura do MCP.
    expect(JSON.stringify(comErro)).not.toMatch(/exemplo\.test|203\.0\.113|Mozilla/);
    expect(filtroLivre(b.cadeias.find((c) => c.tabela === "mia_cadastro_na_time")!, "eq", "empresa_cliente_id")).toBe(EMPRESA);
  });
});
