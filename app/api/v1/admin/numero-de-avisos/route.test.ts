/**
 * A TELA DO NÚMERO DE AVISOS — o contrato que ela lê, e a escolha pelo nome.
 *
 * Em produção (29/09/2026) o número estava marcado e NENHUMA empresa tinha grupo
 * escolhido — "a tela não deixa configurar". O seletor de grupo de cada empresa
 * só abre quando o GET consegue listar os grupos do número; quando a leitura
 * falha ele fica travado, e antes deste arquivo a tela não dizia por quê.
 *
 * O formato que cada motor do transporte devolve é provado do lado de dentro da
 * fronteira de canal (o teste "client-grupos-motores", ao lado do cliente do
 * transporte), com o HTTP como único dublê. Aqui o dublê é o adapter, e o que se prova é o que a ROTA
 * faz com a resposta — nome, motivo da falha, e o grupo escolhido indo para a
 * empresa certa.
 *
 *     npx vitest run app/api/v1/admin/numero-de-avisos/route.test.ts
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChannelGroup } from "@/lib/channels/types";

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: vi.fn(async () => ({ user: { id: "u-plataforma" }, platformAdmin: {} })),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const estado = vi.hoisted(() => ({
  tabelas: {} as Record<string, unknown>,
  atualizacoes: [] as Array<{ tabela: string; valores: Record<string, unknown> }>,
  listGroups: (async () => []) as (input: { sessionRef: string }) => Promise<unknown[]>,
  sessionRefs: [] as string[],
}));

/** Só o adapter é dublê; a capability, a lista de providers e o resto são os reais. */
vi.mock("@/lib/channels", async (real) => ({
  ...((await real()) as Record<string, unknown>),
  getAdapter: () => ({
    listGroups: async (input: { sessionRef: string }) => {
      estado.sessionRefs.push(input.sessionRef);
      return estado.listGroups(input);
    },
  }),
}));

/**
 * Um Supabase de mentira que devolve a linha de cada tabela e grava o que foi
 * atualizado. A cadeia (`select().in().is().order()`) não importa aqui.
 */
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(tabela: string) {
      const dados = estado.tabelas[tabela] ?? null;
      const q: Record<string, unknown> = {};
      for (const m of ["select", "in", "is", "order", "eq"]) q[m] = () => q;
      q.update = (valores: Record<string, unknown>) => {
        estado.atualizacoes.push({ tabela, valores });
        return q;
      };
      q.maybeSingle = async () => ({ data: Array.isArray(dados) ? (dados[0] ?? null) : dados, error: null });
      q.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) =>
        Promise.resolve({ data: dados, error: null }).then(ok, erro);
      return q;
    },
  }),
}));

import { PROVIDERS_QUE_ENTREGAM_EM_GRUPO } from "@/lib/channels/capabilities";
import { CHANNEL_SESSION_REF_COLUMNS } from "@/lib/channels/session-ref";

import { GET } from "./route";
import { PUT as PUT_GRUPO } from "./grupo/route";

const ULTRA = "65073c33-7aeb-45bd-8db1-10cea3fa8968";
const TIME = "aaaaaaaa-0000-4000-8000-00000000000a";
const SESSAO = "bbbbbbbb-0000-4000-8000-00000000000b";
const G1 = "120363405136320907@g.us";
const G2 = "120363405136320908@g.us";

/**
 * O canal marcado. O provider é o que a MATRIZ diz que entrega em grupo, nunca
 * um literal; e toda coluna de referência de sessão recebe o mesmo nome, para
 * que `resolveSessionRef` escolha a dele sem este teste perguntar qual é.
 */
const REF_DA_SESSAO = "sessao-de-avisos";
const MARCADA = {
  id: SESSAO,
  organization_id: ULTRA,
  phone_number: "5511912345678",
  display_name: "Número de avisos",
  status: "WORKING",
  e_numero_de_avisos: true,
  ...Object.fromEntries(
    CHANNEL_SESSION_REF_COLUMNS.split(",").map((c) => [c.trim(), REF_DA_SESSAO]),
  ),
  provider: PROVIDERS_QUE_ENTREGAM_EM_GRUPO[0],
};

type Corpo = {
  data: {
    grupos: Array<{ id: string; nome: string }>;
    grupos_indisponiveis: boolean;
    grupos_motivo: string | null;
  };
};

beforeEach(() => {
  estado.atualizacoes.length = 0;
  estado.sessionRefs.length = 0;
  estado.tabelas = {
    channel_sessions: [MARCADA],
    platform_avisos: null,
    organizations: [
      { id: ULTRA, display_name: "Ultra Sorriso", settings: { routing: { modo: "rodizio" } } },
      { id: TIME, display_name: "Time Company", settings: {} },
    ],
  };
});

describe("número de avisos: a lista de grupos que a tela recebe", () => {
  it("⭐ os grupos chegam PELO NOME, lidos da sessão marcada", async () => {
    estado.listGroups = async (): Promise<ChannelGroup[]> => [
      { chatId: G1, subject: "Ultra Sorriso · Comercial" },
      { chatId: G2, subject: "Time Company · Interno" },
    ];
    const res = await GET();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as Corpo;
    expect(data.grupos_indisponiveis).toBe(false);
    expect(data.grupos_motivo).toBeNull();
    expect(data.grupos).toEqual([
      { id: G1, nome: "Ultra Sorriso · Comercial" },
      { id: G2, nome: "Time Company · Interno" },
    ]);
    expect(estado.sessionRefs).toEqual([REF_DA_SESSAO]);
  });

  it("⭐ falha de leitura trava o seletor E diz o porquê", async () => {
    estado.listGroups = async () => {
      throw new Error("ECONNREFUSED 10.0.0.9:3000");
    };
    const { data } = (await (await GET()).json()) as Corpo;
    expect(data.grupos_indisponiveis).toBe(true);
    expect(data.grupos).toEqual([]);
    expect(data.grupos_motivo).toBe("desconhecido");
    // O erro cru (com endereço interno) nunca chega à tela.
    expect(JSON.stringify(data)).not.toContain("10.0.0.9");
  });

  it("o controle: número em grupo nenhum é lista vazia, e NÃO trava o seletor", async () => {
    estado.listGroups = async () => [];
    const { data } = (await (await GET()).json()) as Corpo;
    expect(data.grupos_indisponiveis).toBe(false);
    expect(data.grupos_motivo).toBeNull();
    expect(data.grupos).toEqual([]);
  });

  it("sem número marcado não há o que perguntar — e isso não é falha de leitura", async () => {
    estado.tabelas.channel_sessions = [{ ...MARCADA, e_numero_de_avisos: false }];
    const { data } = (await (await GET()).json()) as Corpo;
    expect(data.grupos_indisponiveis).toBe(false);
    expect(data.grupos_motivo).toBeNull();
    expect(estado.sessionRefs).toEqual([]);
  });
});

describe("número de avisos: escolher o grupo da empresa pelo nome", () => {
  it("o grupo escolhido na lista vai para as configurações DA EMPRESA, sem apagar o resto", async () => {
    estado.listGroups = async () => [{ chatId: G1, subject: "Ultra Sorriso · Comercial" }];
    const { data } = (await (await GET()).json()) as Corpo;
    const escolhido = data.grupos.find((g) => g.nome === "Ultra Sorriso · Comercial");

    const res = await PUT_GRUPO(
      new NextRequest("http://x/api/v1/admin/numero-de-avisos/grupo", {
        method: "PUT",
        body: JSON.stringify({ organization_id: ULTRA, grupo: escolhido }),
      }),
    );
    expect(res.status).toBe(200);
    const gravado = estado.atualizacoes.find((a) => a.tabela === "organizations");
    expect(gravado?.valores).toEqual({
      settings: {
        routing: { modo: "rodizio" },
        grupo_de_avisos: { id: G1, nome: "Ultra Sorriso · Comercial" },
      },
    });
  });
});
