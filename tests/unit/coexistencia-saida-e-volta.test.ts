/**
 * FORK MIA · coexistência (S4): O NÚMERO QUE SAI DO AR E VOLTA, SEM DUPLICAR
 * (lib/channels/meta/coexistencia/saida-e-volta.ts; docs/fork/coexistencia.md).
 *
 * As fixtures seguem a página da Meta de cadastro de usuários do app (lida em
 * 18/11/2026): o `account_update` traz a WABA em `entry.id`, o `time` do
 * evento e, no `PARTNER_REMOVED`, `waba_info` e `disconnection_info`. Nenhum
 * dos três traz número.
 *
 * Banco em memória: mede o que foi gravado em qual tabela. A prova contra o
 * banco de verdade (com as constraints da 9162 e a contagem de contatos,
 * conversas e cartões) é `tests/invariants/coexistencia-saida-e-volta.test.ts`.
 *
 * Dado fictício: Academia Alfa, +55 31 900000002.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { lerSaidaOuVolta, leiturasDaConta, receberSaidaEVolta, MOTIVO_DA_SESSAO_FORA_DO_AR } = await import(
  "@/lib/channels/meta/coexistencia/saida-e-volta"
);
const { bancoEmMemoria } = await import("@/tests/helpers/banco-em-memoria");

const ALFA = "0a0b0c0d-1111-4111-8111-000000009290";
const SESSAO = "0a0b0c0d-2222-4222-8222-000000009290";
const CICLO = "0a0b0c0d-3333-4333-8333-000000009290";
const CONTATO = "0a0b0c0d-4444-4444-8444-000000009290";
const CONVERSA = "0a0b0c0d-5555-4555-8555-000000009290";
const NEGOCIO = "0a0b0c0d-6666-4666-8666-000000009290";
const WABA = "102290129340398";
const T0 = 1_768_400_000;

function contaDaMeta(value: Record<string, unknown>, time: number | undefined = T0, wabaDaEntry = WABA) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: wabaDaEntry, ...(time !== undefined ? { time } : {}), changes: [{ field: "account_update", value }] }],
  };
}

const PARTNER_REMOVED = (time = T0, reason = "PRIMARY_INACTIVITY", initiated_by = "SYSTEM") =>
  contaDaMeta(
    {
      event: "PARTNER_REMOVED",
      waba_info: { waba_id: WABA, owner_business_id: "2329417887457253" },
      disconnection_info: { reason, initiated_by },
    },
    time,
  );
const ACCOUNT_OFFBOARDED = (time = T0) => contaDaMeta({ event: "ACCOUNT_OFFBOARDED" }, time);
const ACCOUNT_RECONNECTED = (time = T0) => contaDaMeta({ event: "ACCOUNT_RECONNECTED" }, time);

function banco(ciclo: Record<string, unknown> = {}, sessao: Record<string, unknown> = {}) {
  return bancoEmMemoria({
    organizations: [{ id: ALFA, display_name: "Academia Alfa", locale: "pt-BR" }],
    channel_sessions: [
      {
        id: SESSAO,
        organization_id: ALFA,
        provider: "meta_cloud",
        meta_waba_id: WABA,
        phone_number: "+5531900000002",
        status: "WORKING",
        status_reason: null,
        ...sessao,
      },
    ],
    mia_coexistencia_conexoes: [
      {
        id: CICLO,
        organization_id: ALFA,
        channel_session_id: SESSAO,
        waba_id: WABA,
        phone_number_id: "106540352242922",
        estado: "no_ar",
        fora_do_ar_motivo: null,
        fora_do_ar_iniciado_por: null,
        fora_do_ar_em: null,
        voltou_em: null,
        ultimo_evento_em: null,
        ...ciclo,
      },
    ],
    contacts: [{ id: CONTATO, organization_id: ALFA, name: "Ana Exemplo", phone_number: "+5531900000002" }],
    conversations: [{ id: CONVERSA, organization_id: ALFA, contact_id: CONTATO, channel_session_id: SESSAO }],
    deals: [{ id: NEGOCIO, organization_id: ALFA, contact_id: CONTATO }],
    agent_inbox_items: [],
  });
}

const opcoes = (b: ReturnType<typeof banco>) => ({
  requestId: "req-9290",
  sessionDoToken: { id: SESSAO, organizationId: ALFA, wabaId: WABA },
  porWaba: async () => null,
  admin: b.cliente,
});

async function receber(b: ReturnType<typeof banco>, envelope: ReturnType<typeof contaDaMeta>) {
  const o = opcoes(b);
  return receberSaidaEVolta(o.admin as never, envelope as never, o);
}

const ciclo = (b: ReturnType<typeof banco>) => b.tabela("mia_coexistencia_conexoes")[0]!;
const sessao = (b: ReturnType<typeof banco>) => b.tabela("channel_sessions")[0]!;
const avisos = (b: ReturnType<typeof banco>, status?: string) =>
  b.tabela("agent_inbox_items").filter((a) => !status || a.status === status);

describe("a leitura do account_update (pura)", () => {
  it("PARTNER_REMOVED: a WABA, o motivo, quem iniciou e o time do evento", () => {
    const [l] = leiturasDaConta(PARTNER_REMOVED() as never);
    expect(l).toEqual({
      tipo: "saida",
      wabaId: WABA,
      motivo: "PRIMARY_INACTIVITY",
      iniciadoPor: "SYSTEM",
      quando: new Date(T0 * 1000),
    });
  });

  it("os seis motivos da Meta passam; motivo fora do vocabulário vira `desconhecido`", () => {
    for (const m of [
      "ACCOUNT_DISCONNECTED",
      "BUSINESS_DOWNGRADE",
      "CHANGE_NUMBER",
      "COMPANION_INACTIVITY",
      "PRIMARY_INACTIVITY",
      "USER_RE_REGISTERED",
    ]) {
      expect(leiturasDaConta(PARTNER_REMOVED(T0, m, "USER") as never)[0]).toMatchObject({ motivo: m, iniciadoPor: "USER" });
    }
    expect(leiturasDaConta(PARTNER_REMOVED(T0, "MOTIVO_NOVO", "OUTRO") as never)[0]).toMatchObject({
      motivo: "desconhecido",
      iniciadoPor: null,
    });
  });

  it("ACCOUNT_OFFBOARDED (sem waba_info: a WABA é o entry.id) e ACCOUNT_RECONNECTED", () => {
    expect(leiturasDaConta(ACCOUNT_OFFBOARDED() as never)[0]).toMatchObject({
      tipo: "saida",
      wabaId: WABA,
      motivo: "ACCOUNT_OFFBOARDED",
      iniciadoPor: null,
    });
    expect(leiturasDaConta(ACCOUNT_RECONNECTED() as never)[0]).toEqual({ tipo: "volta", wabaId: WABA, quando: new Date(T0 * 1000) });
  });

  it("o que não é saída nem volta fica de fora (PARTNER_ADDED, outro campo, sem WABA)", () => {
    expect(lerSaidaOuVolta("account_update", { id: WABA }, { event: "PARTNER_ADDED" })).toBeNull();
    expect(lerSaidaOuVolta("messages", { id: WABA }, { event: "PARTNER_REMOVED" })).toBeNull();
    expect(lerSaidaOuVolta("account_update", {}, { event: "ACCOUNT_RECONNECTED" })).toBeNull();
  });

  it("sem `time`, a hora da chegada (e não 1970, que travaria todo evento seguinte)", () => {
    const agora = new Date("2026-11-18T12:00:00.000Z");
    expect(lerSaidaOuVolta("account_update", { id: WABA }, { event: "ACCOUNT_RECONNECTED" }, agora)).toMatchObject({ quando: agora });
  });
});

describe("a saída", () => {
  let b: ReturnType<typeof banco>;
  beforeEach(() => {
    b = banco();
  });

  it("o ciclo vai a fora_do_ar com o motivo, a sessão sai de WORKING e abre UM aviso na Central", async () => {
    expect(await receber(b, PARTNER_REMOVED())).toEqual(["conta:fora_do_ar"]);
    expect(ciclo(b)).toMatchObject({
      estado: "fora_do_ar",
      fora_do_ar_motivo: "PRIMARY_INACTIVITY",
      fora_do_ar_iniciado_por: "SYSTEM",
      fora_do_ar_em: new Date(T0 * 1000).toISOString(),
      ultimo_evento_em: new Date(T0 * 1000).toISOString(),
    });
    expect(sessao(b)).toMatchObject({ status: "STOPPED", status_reason: MOTIVO_DA_SESSAO_FORA_DO_AR });
    const abertos = avisos(b, "open");
    expect(abertos).toHaveLength(1);
    expect(abertos[0]).toMatchObject({
      organization_id: ALFA,
      kind: "other",
      severity: "critical",
      ref_kind: "channel_session",
      ref_id: SESSAO,
      title: "+5531900000002 fora do ar",
    });
    expect(String(abertos[0]!.body)).toContain("cerca de 14 dias");
    // Sem nome nem telefone de contato no aviso.
    expect(JSON.stringify(abertos)).not.toContain("Ana Exemplo");
  });

  it("o mesmo evento de novo: ainda UM aviso, e a hora da saída não anda", async () => {
    await receber(b, PARTNER_REMOVED());
    expect(await receber(b, PARTNER_REMOVED(T0 + 30))).toEqual(["conta:fora_do_ar_repetido"]);
    expect(avisos(b)).toHaveLength(1);
    expect(ciclo(b).fora_do_ar_em).toBe(new Date(T0 * 1000).toISOString());
  });

  it("ACCOUNT_OFFBOARDED também tira do ar, com o motivo próprio", async () => {
    expect(await receber(b, ACCOUNT_OFFBOARDED())).toEqual(["conta:fora_do_ar"]);
    expect(ciclo(b)).toMatchObject({ estado: "fora_do_ar", fora_do_ar_motivo: "ACCOUNT_OFFBOARDED", fora_do_ar_iniciado_por: null });
    expect(String(avisos(b, "open")[0]!.body)).toContain("saiu da coexistência");
  });

  it("a sessão que já tinha caído por outro motivo fica com o dela", async () => {
    b = banco({}, { status: "FAILED", status_reason: "token_invalido" });
    await receber(b, PARTNER_REMOVED());
    expect(sessao(b)).toMatchObject({ status: "FAILED", status_reason: "token_invalido" });
    expect(ciclo(b).estado).toBe("fora_do_ar");
  });

  it("WABA sem ciclo da coexistência: nada muda (número do canal oficial que não veio pelo app)", async () => {
    b = banco({ waba_id: "outra-waba" });
    expect(await receber(b, PARTNER_REMOVED())).toEqual(["conta:sem_ciclo"]);
    expect(sessao(b).status).toBe("WORKING");
    expect(avisos(b)).toHaveLength(0);
  });

  it("WABA de ninguém: ignorado com 200", async () => {
    const o = { requestId: "r", sessionDoToken: null, porWaba: async () => null };
    expect(await receberSaidaEVolta(b.cliente as never, PARTNER_REMOVED() as never, o)).toEqual(["conta:waba_desconhecida"]);
  });
});

describe("a volta, sem duplicar nada", () => {
  it("ACCOUNT_RECONNECTED: o MESMO ciclo e a MESMA sessão voltam, o aviso de fora do ar fecha e entra o de voltou", async () => {
    const b = banco();
    await receber(b, PARTNER_REMOVED(T0));
    const escritasAntes = b.escritas.length;
    expect(await receber(b, ACCOUNT_RECONNECTED(T0 + 3600))).toEqual(["conta:voltou"]);

    expect(ciclo(b)).toMatchObject({ id: CICLO, estado: "no_ar", voltou_em: new Date((T0 + 3600) * 1000).toISOString() });
    expect(sessao(b)).toMatchObject({ id: SESSAO, status: "WORKING", status_reason: null });
    expect(avisos(b, "resolved").map((a) => a.title)).toEqual(["+5531900000002 fora do ar"]);
    expect(avisos(b, "open").map((a) => a.title)).toEqual(["+5531900000002 voltou"]);

    // Nada nasceu: nenhuma escrita em sessão nova, ciclo novo, contato, conversa ou cartão.
    const criadas = b.escritas
      .slice(escritasAntes)
      .filter((e) => e.op === "insert" || e.op === "upsert")
      .map((e) => e.tabela);
    expect(criadas).toEqual(["agent_inbox_items"]);
    expect(b.tabela("channel_sessions")).toHaveLength(1);
    expect(b.tabela("mia_coexistencia_conexoes")).toHaveLength(1);
    expect(b.tabela("contacts")).toHaveLength(1);
    expect(b.tabela("conversations")).toHaveLength(1);
    expect(b.tabela("deals")).toHaveLength(1);
    expect(
      b.escritas.filter((e) => ["contacts", "conversations", "deals"].includes(e.tabela)),
    ).toEqual([]);
  });

  it("a volta MAIS VELHA que a saída não traz de volta (a Meta entrega fora de ordem)", async () => {
    const b = banco();
    await receber(b, ACCOUNT_OFFBOARDED(T0 + 1));
    // O exemplo da própria página: o RECONNECTED com time 1 s menor que o OFFBOARDED.
    expect(await receber(b, ACCOUNT_RECONNECTED(T0))).toEqual(["conta:evento_velho"]);
    expect(ciclo(b).estado).toBe("fora_do_ar");
    expect(sessao(b).status).toBe("STOPPED");
    expect(avisos(b, "open")).toHaveLength(1);
  });

  it("a saída MAIS VELHA que a volta não tira do ar o número que já voltou", async () => {
    const b = banco();
    await receber(b, PARTNER_REMOVED(T0));
    await receber(b, ACCOUNT_RECONNECTED(T0 + 60));
    expect(await receber(b, PARTNER_REMOVED(T0 + 30))).toEqual(["conta:evento_velho"]);
    expect(ciclo(b).estado).toBe("no_ar");
    expect(sessao(b).status).toBe("WORKING");
  });

  it("volta com o número já no ar: nada a fazer, mas o time fica guardado", async () => {
    const b = banco();
    expect(await receber(b, ACCOUNT_RECONNECTED(T0 + 60))).toEqual(["conta:ja_no_ar"]);
    expect(ciclo(b).ultimo_evento_em).toBe(new Date((T0 + 60) * 1000).toISOString());
    expect(await receber(b, PARTNER_REMOVED(T0))).toEqual(["conta:evento_velho"]);
    expect(avisos(b)).toHaveLength(0);
  });

  it("a volta não devolve WORKING à sessão que outro tirou do ar depois", async () => {
    const b = banco();
    await receber(b, PARTNER_REMOVED(T0));
    // O vigia de saúde (ou uma pessoa) mudou o estado depois da saída.
    Object.assign(sessao(b), { status: "FAILED", status_reason: "token_invalido" });
    await receber(b, ACCOUNT_RECONNECTED(T0 + 60));
    expect(ciclo(b).estado).toBe("no_ar");
    expect(sessao(b)).toMatchObject({ status: "FAILED", status_reason: "token_invalido" });
  });

  it("saiu de novo depois de voltar: o aviso de voltou fecha e o de fora do ar abre outra vez", async () => {
    const b = banco();
    await receber(b, PARTNER_REMOVED(T0));
    await receber(b, ACCOUNT_RECONNECTED(T0 + 60));
    await receber(b, PARTNER_REMOVED(T0 + 120, "COMPANION_INACTIVITY", "SYSTEM"));
    expect(avisos(b, "open").map((a) => a.title)).toEqual(["+5531900000002 fora do ar"]);
    expect(String(avisos(b, "open")[0]!.body)).toContain("30 dias");
    expect(ciclo(b)).toMatchObject({ estado: "fora_do_ar", fora_do_ar_motivo: "COMPANION_INACTIVITY" });
  });
});
