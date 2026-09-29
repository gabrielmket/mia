/**
 * FORK MIA — a FICHA no aviso do grupo, e o aviso no HISTÓRICO do negócio.
 *
 * Pela ação REAL (`notify_group`), com o destino padrão da plataforma: só o
 * envio e o banco são dublês. O que se prova:
 *
 *  - `{{nota.headline}}`/`{{nota.body}}` saem com a ficha mais recente;
 *  - o que foi mandado fica na timeline do negócio (`group_notice_sent`), com
 *    ator "Automação" e sem dado pessoal no `reason`;
 *  - quando NÃO sai, isso também fica (`group_notice_failed`) com o porquê;
 *  - nada vira conversa no inbox.
 *
 *     npx vitest run lib/avisos/registro-do-aviso.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const envio = vi.hoisted(() => ({
  enviados: [] as Array<Record<string, unknown>>,
  falhar: false,
}));
vi.mock("@/lib/channels", async (real) => ({
  ...((await real()) as Record<string, unknown>),
  getAdapter: () => ({
    send: async (envelope: Record<string, unknown>) => {
      if (envio.falhar) throw new Error("transporte respondeu 500");
      envio.enviados.push(envelope);
      return { externalId: "msg-grupo-1" };
    },
  }),
}));

import { getAction } from "@/lib/automation/actions";
import "@/lib/automation/actions/notify-group";
import type { ActionCtx } from "@/lib/automation/types";
import { PROVIDERS_QUE_ENTREGAM_EM_GRUPO } from "@/lib/channels/capabilities";
import { CHANNEL_SESSION_REF_COLUMNS } from "@/lib/channels/session-ref";

const ORG = "65073c33-7aeb-45bd-8db1-10cea3fa8968";
const CONTATO = "c0c0c0c0-0000-4000-8000-000000000001";
const NEGOCIO = "1e1e1e1e-0000-4000-8000-000000000002";
const GRUPO = "120363405136320907@g.us";

const FICHA = {
  headline: "Implante · São Miguel · avaliação esta semana",
  body: "Roberto perdeu um dente, quer implante, prefere a unidade São Miguel, pode ir quinta à tarde.",
  created_at: "2026-09-29T12:00:00Z",
};

const NUMERO_DE_AVISOS = {
  ...Object.fromEntries(CHANNEL_SESSION_REF_COLUMNS.split(",").map((c) => [c.trim(), "sessao-avisos"])),
  provider: PROVIDERS_QUE_ENTREGAM_EM_GRUPO[0],
};

type Banco = {
  sessaoDeAvisos: unknown;
  settings: Record<string, unknown>;
  ficha: unknown;
  negocios: Array<Record<string, unknown>>;
};

function montar(b: Banco) {
  const inserts: Array<{ tabela: string; linha: Record<string, unknown> }> = [];
  const admin = {
    from(tabela: string) {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "is", "order", "limit"]) q[m] = () => q;
      q.insert = (linha: Record<string, unknown>) => {
        inserts.push({ tabela, linha });
        return Promise.resolve({ data: null, error: null });
      };
      q.maybeSingle = async () => {
        if (tabela === "channel_sessions") return { data: b.sessaoDeAvisos, error: null };
        if (tabela === "organizations") return { data: { settings: b.settings }, error: null };
        if (tabela === "lead_notes") return { data: b.ficha, error: null };
        return { data: null, error: null };
      };
      q.then = (ok: (v: unknown) => unknown) =>
        Promise.resolve({ data: tabela === "crm_leads" ? b.negocios : null, error: null }).then(ok);
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  return { admin, inserts };
}

function ctx(admin: unknown, contexto: Record<string, unknown>): ActionCtx {
  return {
    admin: admin as ActionCtx["admin"],
    organizationId: ORG,
    ruleId: "regra-qualificado",
    ruleName: "Qualificado → avisa o comercial",
    event: {} as ActionCtx["event"],
    context: contexto,
    requestId: "evt-1",
  };
}

const COM_NEGOCIO = {
  lead: { id: NEGOCIO, contact_id: CONTATO, title: "Roberto" },
  contact: { id: CONTATO, display_name: "Roberto Alves", phone_number: "+5511955554444" },
};
const TEMPLATE =
  "🔔 Lead qualificado: {{contact.display_name}} ({{contact.phone_number}})\n*{{nota.headline}}*\n{{nota.body}}";

const atividades = (inserts: Array<{ tabela: string; linha: Record<string, unknown> }>) =>
  inserts.filter((i) => i.tabela === "crm_lead_activities").map((i) => i.linha);

beforeEach(() => {
  envio.enviados.length = 0;
  envio.falhar = false;
});

describe("a ficha no aviso do grupo", () => {
  it("⭐ {{nota.headline}} e {{nota.body}} saem com a ficha mais recente do contato", async () => {
    const { admin } = montar({
      sessaoDeAvisos: NUMERO_DE_AVISOS,
      settings: { grupo_de_avisos: { id: GRUPO, nome: "Ultra Sorriso · Comercial" } },
      ficha: FICHA,
      negocios: [],
    });
    const r = await getAction("notify_group")!.execute(ctx(admin, COM_NEGOCIO), { template: TEMPLATE });
    expect(r.status).toBe("success");
    expect(envio.enviados).toHaveLength(1);
    expect(envio.enviados[0]).toMatchObject({ to: GRUPO, kind: "text" });
    expect(envio.enviados[0]!.body).toBe(
      "🔔 Lead qualificado: Roberto Alves (+5511955554444)\n" +
        `*${FICHA.headline}*\n${FICHA.body}`,
    );
    expect(r.detail).toMatchObject({ ficha: "usada", historico: "registrado" });
  });

  it("sem ficha salva, o aviso sai mesmo assim — e a linha da regra diz que ela faltou", async () => {
    const { admin } = montar({
      sessaoDeAvisos: NUMERO_DE_AVISOS,
      settings: { grupo_de_avisos: { id: GRUPO, nome: "Comercial" } },
      ficha: null,
      negocios: [],
    });
    const r = await getAction("notify_group")!.execute(ctx(admin, COM_NEGOCIO), { template: TEMPLATE });
    expect(r.status).toBe("success");
    expect(envio.enviados[0]!.body).toBe("🔔 Lead qualificado: Roberto Alves (+5511955554444)\n**\n");
    expect(r.detail).toMatchObject({ ficha: "ausente" });
  });
});

describe("o aviso no histórico do negócio", () => {
  it("⭐ o que saiu fica na timeline: tipo, ator Automação, texto no payload, sem PII no reason", async () => {
    const { admin, inserts } = montar({
      sessaoDeAvisos: NUMERO_DE_AVISOS,
      settings: { grupo_de_avisos: { id: GRUPO, nome: "Ultra Sorriso · Comercial" } },
      ficha: FICHA,
      negocios: [],
    });
    await getAction("notify_group")!.execute(ctx(admin, COM_NEGOCIO), { template: TEMPLATE });
    const [linha] = atividades(inserts);
    expect(linha).toMatchObject({
      organization_id: ORG,
      lead_id: NEGOCIO,
      contact_id: CONTATO,
      type: "group_notice_sent",
      actor_kind: "rule",
      source_module: "automation",
      source_id: "regra-qualificado",
      payload: { grupo: "Ultra Sorriso · Comercial", texto: envio.enviados[0]!.body, ficha: "usada", external_id: "msg-grupo-1" },
    });
    expect(linha!.reason).toBe(
      "Aviso enviado ao grupo «Ultra Sorriso · Comercial» pela regra «Qualificado → avisa o comercial».",
    );
    // O reason é exibido e exportado no LGPD: nome e telefone ficam no payload.
    expect(String(linha!.reason)).not.toMatch(/Roberto|5511/);
    // E nada virou conversa: nenhuma escrita em mensagens nem em conversas.
    expect(inserts.filter((i) => ["messages", "conversations"].includes(i.tabela))).toEqual([]);
  });

  it("⭐ empresa sem grupo: o aviso NÃO sai, e isso fica no histórico com o porquê", async () => {
    const { admin, inserts } = montar({ sessaoDeAvisos: NUMERO_DE_AVISOS, settings: {}, ficha: FICHA, negocios: [] });
    const r = await getAction("notify_group")!.execute(ctx(admin, COM_NEGOCIO), { template: TEMPLATE });
    expect(r).toMatchObject({ status: "failed", error: "sem_grupo_no_cliente" });
    expect(envio.enviados).toEqual([]);
    const [linha] = atividades(inserts);
    expect(linha).toMatchObject({ type: "group_notice_failed", lead_id: NEGOCIO, payload: { erro: "sem_grupo_no_cliente" } });
    expect(linha!.reason).toMatch(/não tem grupo escolhido/);
  });

  it("o WhatsApp recusou: falha registrada, com o texto que teria saído", async () => {
    envio.falhar = true;
    const { admin, inserts } = montar({
      sessaoDeAvisos: NUMERO_DE_AVISOS,
      settings: { grupo_de_avisos: { id: GRUPO, nome: "Comercial" } },
      ficha: FICHA,
      negocios: [],
    });
    const r = await getAction("notify_group")!.execute(ctx(admin, COM_NEGOCIO), { template: TEMPLATE });
    expect(r.status).toBe("failed");
    const [linha] = atividades(inserts);
    expect(linha).toMatchObject({ type: "group_notice_failed", payload: { erro: "envio_falhou", grupo: "Comercial" } });
    expect(String((linha!.payload as { texto: string }).texto)).toContain(FICHA.body);
  });

  it("gatilho de CONTATO: registra no único negócio aberto dele", async () => {
    const { admin, inserts } = montar({
      sessaoDeAvisos: NUMERO_DE_AVISOS,
      settings: { grupo_de_avisos: { id: GRUPO, nome: "Comercial" } },
      ficha: FICHA,
      negocios: [
        { id: NEGOCIO, organization_id: ORG, pipeline_id: "p1", status: "open", last_activity_at: null, created_at: "2026-09-01T00:00:00Z" },
        { id: "fechado", organization_id: ORG, pipeline_id: "p1", status: "won", last_activity_at: null, created_at: "2026-08-01T00:00:00Z" },
      ],
    });
    await getAction("notify_group")!.execute(ctx(admin, { contact: COM_NEGOCIO.contact }), { template: TEMPLATE });
    expect(atividades(inserts)).toMatchObject([{ lead_id: NEGOCIO, contact_id: CONTATO }]);
  });

  it("contato sem negócio aberto: não inventa onde registrar — e a linha da regra diz", async () => {
    const { admin, inserts } = montar({
      sessaoDeAvisos: NUMERO_DE_AVISOS,
      settings: { grupo_de_avisos: { id: GRUPO, nome: "Comercial" } },
      ficha: null,
      negocios: [],
    });
    const r = await getAction("notify_group")!.execute(ctx(admin, { contact: COM_NEGOCIO.contact }), { template: TEMPLATE });
    expect(r.status).toBe("success");
    expect(atividades(inserts)).toEqual([]);
    expect(r.detail).toMatchObject({ historico: "sem_negocio:no_open_lead" });
  });
});
