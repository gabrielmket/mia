// @vitest-environment jsdom
/**
 * FORK MIA — "a janela de envio alterada pela tela não salva"? (29/09/2026)
 *
 * A suspeita: o GET `/api/v1/ai/pacing` seguiu 7h–22h com `overrides: null`
 * depois de alguém mudar a janela pela tela, e pelo PUT da API gravou.
 *
 * Esta prova passa o caminho INTEIRO da tela que edita a janela do número
 * (Conexões › "Proteção de envio", `AntiBanSheet`): o corpo que a tela REALMENTE
 * monta ao clicar em Salvar vai para o handler REAL do PUT, e o GET real lê o
 * que ficou gravado. Só o banco e a sessão são dublês.
 *
 * Resultado: salva. Qualquer PUT bem-sucedido desta tela grava a linha de
 * `channel_knobs` (a tela manda a ficha inteira), então `overrides: null`
 * depois de um "salvo" é impossível por este caminho. O que produz o sintoma é
 * salvar em OUTRA tela com a palavra "ritmo" — a da campanha ("Ritmo desta
 * campanha" / "Salvar ritmo"), que grava `campaigns.janela_*` e só restringe
 * aquela campanha, nunca o número —, ou ler o item de OUTRA conexão no GET.
 *
 *     npx vitest run tests/unit/janela-do-numero-salva-pela-tela.test.tsx
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PacingKnobs } from "@/lib/agent-engine/pacing/defaults";
import type { PacingKnobsItem } from "@/hooks/channels/usePacingKnobs";

const ORG = "65073c33-7aeb-45bd-8db1-10cea3fa8968";
const CANAL = "cccccccc-0000-4000-8000-00000000000c";

const tela = vi.hoisted(() => ({ corpos: [] as Array<Record<string, unknown>> }));
vi.mock("@/hooks/channels/usePacingKnobs", () => ({
  usePacingKnobs: () => ({ data: { items: [] } }),
  useUpdatePacingKnobs: () => ({
    isPending: false,
    mutateAsync: async (corpo: Record<string, unknown>) => {
      tela.corpos.push(corpo);
      return { data: { turnos_reprogramados: 0 } };
    },
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** O banco: a conexão, e a linha de `channel_knobs` que o upsert grava. */
const banco = vi.hoisted(() => ({ knobs: null as null | Record<string, unknown> }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(tabela: string) {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in", "order"]) q[m] = () => q;
      q.upsert = async (linha: Record<string, unknown>) => {
        banco.knobs = { ...(banco.knobs ?? {}), ...linha };
        return { error: null };
      };
      q.update = () => q;
      q.maybeSingle = async () => {
        if (tabela === "channel_sessions") return { data: { id: CANAL }, error: null };
        if (tabela === "channel_knobs") return { data: banco.knobs, error: null };
        if (tabela === "organizations") return { data: { timezone: "America/Sao_Paulo" }, error: null };
        return { data: null, error: null };
      };
      q.then = (ok: (v: unknown) => unknown) => {
        const data =
          tabela === "channel_sessions"
            ? [{ id: CANAL, display_name: "Ultra · São Miguel", phone_number: "5511912345678", status: "WORKING", daily_message_limit: 250 }]
            : tabela === "channel_knobs"
              ? banco.knobs
                ? [{ channel_session_id: CANAL, ...banco.knobs }]
                : []
              : null;
        return Promise.resolve({ data, error: null }).then(ok);
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, user: { id: "u1", idioma: "pt-BR" }, org: { orgId: ORG, role: "admin" } }),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/pacing/reprogramar-adiados", () => ({
  mexeuNaJanela: () => true,
  reprogramarTurnosAdiadosPelaJanela: async () => 0,
}));

import { AntiBanSheet } from "@/components/connections/AntiBanSheet";
import { GET, PUT } from "@/app/api/v1/ai/pacing/route";
import { pacingKnobsUpdateSchema } from "@/lib/ai/pacing-knobs";

const PADRAO: PacingKnobs = {
  throttleMs: 1_200,
  jitterMaxMs: 800,
  windowStartHour: 7,
  windowEndHour: 22,
  allowSunday: true,
  timezone: "America/Sao_Paulo",
  warmupDailyCaps: [{ minAgeDays: 0, cap: null }],
};

/** O item como o GET o devolve para um número que NUNCA foi configurado. */
const ITEM: PacingKnobsItem = {
  channel_session: {
    id: CANAL,
    waha_session_name: "org_ultra_sm",
    display_name: "Ultra · São Miguel",
    phone_number: "5511912345678",
    status: "WORKING",
    daily_message_limit: 250,
  },
  effective: PADRAO,
  warmup: { number_activated_at: null, age_days: 90, skipped: false, cap_today: null },
  overrides: null,
  defaults: PADRAO,
  bounds: { intervalMaxMs: 600_000, hourLastStart: 23, hourEnd: 24, daily_limit: { min: 1, max: 2_000 } },
};

afterEach(() => {
  cleanup();
  tela.corpos.length = 0;
  banco.knobs = null;
});

describe("a janela de envio do número, pela tela", () => {
  it("⭐ o corpo que a tela manda é aceito pelo PUT, grava, e o GET passa a devolver a janela nova", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AntiBanSheet item={ITEM} canWrite onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Hora de início da janela"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Hora de fim da janela"), { target: { value: "24" } });
    fireEvent.click(screen.getByTestId("anti-ban-save"));
    await waitFor(() => expect(tela.corpos).toHaveLength(1));

    const corpo = tela.corpos[0]!;
    expect(corpo).toMatchObject({ channel_session_id: CANAL, window_start_hour: 0, window_end_hour: 24 });
    // O MESMO schema do PUT aceita o corpo da tela, campo a campo.
    expect(pacingKnobsUpdateSchema.safeParse(corpo).success).toBe(true);

    const res = await PUT(new NextRequest("http://x/api/v1/ai/pacing", { method: "PUT", body: JSON.stringify(corpo) }));
    expect(res.status).toBe(200);
    expect(banco.knobs).toMatchObject({ organization_id: ORG, channel_session_id: CANAL, window_start_hour: 0, window_end_hour: 24 });

    const lido = (await (await GET()).json()) as {
      data: { items: Array<{ channel_session: { id: string }; overrides: unknown; effective: PacingKnobs }> };
    };
    const item = lido.data.items.find((i) => i.channel_session.id === CANAL)!;
    expect(item.overrides).not.toBeNull();
    expect(item.effective).toMatchObject({ windowStartHour: 0, windowEndHour: 24 });
  });

  it("o controle: sem nenhum PUT, o GET é exatamente o sintoma medido — 7h–22h e overrides nulo", async () => {
    const lido = (await (await GET()).json()) as {
      data: { items: Array<{ overrides: unknown; effective: PacingKnobs }> };
    };
    expect(lido.data.items[0]).toMatchObject({ overrides: null, effective: { windowStartHour: 7, windowEndHour: 22 } });
  });
});
