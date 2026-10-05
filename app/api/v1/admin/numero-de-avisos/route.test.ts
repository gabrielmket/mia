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

import type * as RequirePlatformAdmin from "@/lib/auth/requirePlatformAdmin";
import type { ChannelGroup } from "@/lib/channels/types";

vi.mock("@/lib/auth/requirePlatformAdmin", async (importOriginal) => {
  const real = await importOriginal<typeof RequirePlatformAdmin>();
  const entrar = async () => ({ user: { id: "u-plataforma" }, platformAdmin: {} });
  return {
    ...real,
    requirePlatformAdmin: vi.fn(entrar),
    // A escrita passa pelo helper da 1.70 (scope `full` + MFA). Aqui só importa
    // quem é da plataforma; scope e MFA: lib/auth/requirePlatformAdmin.test.ts.
    requirePlatformAdminEscrita: vi.fn(entrar),
  };
});
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

import { CHANNEL_PROVIDER_META, PROVIDERS_QUE_ENTREGAM_EM_GRUPO } from "@/lib/channels/capabilities";
import { CHANNEL_SESSION_REF_COLUMNS } from "@/lib/channels/session-ref";

import { GET } from "./route";
import { PUT as PUT_GRUPO } from "./grupo/route";
import { PUT as PUT_ORIGEM } from "./origem/route";

const ULTRA = "65073c33-7aeb-45bd-8db1-10cea3fa8968";
const TIME = "aaaaaaaa-0000-4000-8000-00000000000a";
const SESSAO = "bbbbbbbb-0000-4000-8000-00000000000b";
const G1 = "120363000000000001@g.us";
const G2 = "120363000000000002@g.us";

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
      { id: ULTRA, display_name: "Vita Odonto", settings: { routing: { modo: "rodizio" } } },
      { id: TIME, display_name: "Time Company", settings: {} },
    ],
  };
});

describe("número de avisos: a lista de grupos que a tela recebe", () => {
  it("⭐ os grupos chegam PELO NOME, lidos da sessão marcada", async () => {
    estado.listGroups = async (): Promise<ChannelGroup[]> => [
      { chatId: G1, subject: "Vita Odonto · Comercial" },
      { chatId: G2, subject: "Time Company · Interno" },
    ];
    const res = await GET();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as Corpo;
    expect(data.grupos_indisponiveis).toBe(false);
    expect(data.grupos_motivo).toBeNull();
    expect(data.grupos).toEqual([
      { id: G1, nome: "Vita Odonto · Comercial" },
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
    estado.listGroups = async () => [{ chatId: G1, subject: "Vita Odonto · Comercial" }];
    const { data } = (await (await GET()).json()) as Corpo;
    const escolhido = data.grupos.find((g) => g.nome === "Vita Odonto · Comercial");

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
        grupo_de_avisos: { id: G1, nome: "Vita Odonto · Comercial" },
      },
    });
  });
});

/**
 * FORK MIA (.62) — O NÚMERO DA PRÓPRIA EMPRESA, na tela.
 *
 * A tela é onde "não troca calado" termina: o envio registra o desvio no
 * histórico de cada negócio, mas quem opera olha aqui. Então a situação de cada
 * empresa tem de sair da MESMA decisão do envio, e dizer o número caído, a
 * reserva, e os grupos do número EM USO (que, no modo empresa, não são os da
 * plataforma).
 */
const NUMERO_DA_ULTRA = "eeeeeeee-0000-4000-8000-00000000000e";
const REF_DA_ULTRA = "numero-da-ultra";
const DA_ULTRA = (status: string) => ({
  ...MARCADA,
  ...Object.fromEntries(CHANNEL_SESSION_REF_COLUMNS.split(",").map((c) => [c.trim(), REF_DA_ULTRA])),
  provider: PROVIDERS_QUE_ENTREGAM_EM_GRUPO[0],
  id: NUMERO_DA_ULTRA,
  organization_id: ULTRA,
  display_name: "Comercial Vita",
  status,
  e_numero_de_avisos: false,
});

type EmpresaNaTela = {
  id: string;
  origem: { modo: string; channel_session_id?: string | null; reserva_da_plataforma?: boolean };
  numeros: Array<{ id: string }>;
  numero_escolhido: { id: string; status: string } | null;
  situacao: { via: string | null; motivo: string | null; reserva: string | null };
  grupos_do_numero: {
    grupos: Array<{ id: string; nome: string }>;
    indisponiveis: boolean;
    motivo: string | null;
  } | null;
  reserva_no_grupo: boolean | null;
};

function ultraCom(origem: unknown) {
  return {
    id: ULTRA,
    display_name: "Vita Odonto",
    settings: { grupo_de_avisos: { id: G1, nome: "Vita · Comercial" }, numero_de_avisos: origem },
  };
}

async function empresaUltra(): Promise<EmpresaNaTela> {
  const { data } = (await (await GET()).json()) as { data: { empresas: EmpresaNaTela[] } };
  return data.empresas.find((e) => e.id === ULTRA)!;
}

describe("número de avisos: a empresa com o PRÓPRIO número", () => {
  it("⭐ número de pé: a situação diz 'empresa' e os grupos são os DO NÚMERO DELA", async () => {
    estado.tabelas.channel_sessions = [MARCADA, DA_ULTRA("WORKING")];
    estado.tabelas.organizations = [
      ultraCom({ modo: "empresa", channel_session_id: NUMERO_DA_ULTRA, reserva_da_plataforma: false }),
    ];
    estado.listGroups = async (input) =>
      input.sessionRef === REF_DA_ULTRA
        ? [{ chatId: G1, subject: "Vita · Comercial" }]
        : [{ chatId: G2, subject: "Grupo só da plataforma" }];

    const e = await empresaUltra();
    expect(e.situacao).toEqual({ via: "empresa", motivo: null, reserva: null });
    expect(e.numeros.map((n) => n.id), "o número conectado da empresa não aparece para escolher").toEqual([
      NUMERO_DA_ULTRA,
    ]);
    expect(
      e.grupos_do_numero?.grupos,
      "a tela ofereceu os grupos da PLATAFORMA para uma empresa que manda pelo próprio número",
    ).toEqual([{ id: G1, nome: "Vita · Comercial" }]);
    expect(estado.sessionRefs).toContain(REF_DA_ULTRA);
  });

  it("⭐ número CAÍDO sem reserva: a tela diz que os avisos NÃO estão saindo, e por quê", async () => {
    estado.tabelas.channel_sessions = [MARCADA, DA_ULTRA("FAILED")];
    estado.tabelas.organizations = [
      ultraCom({ modo: "empresa", channel_session_id: NUMERO_DA_ULTRA, reserva_da_plataforma: false }),
    ];
    estado.listGroups = async () => [];

    const e = await empresaUltra();
    expect(e.situacao).toEqual({ via: null, motivo: "numero_da_empresa_fora_do_ar", reserva: "desligada" });
    expect(e.numero_escolhido, "o número caído sumiu da tela, e o seletor diria 'plataforma'").toMatchObject({
      id: NUMERO_DA_ULTRA,
      status: "FAILED",
    });
    expect(e.numeros, "número caído oferecido como escolha nova").toEqual([]);
    expect(e.grupos_do_numero).toMatchObject({ indisponiveis: true, motivo: "desconectado" });
    expect(estado.sessionRefs, "a tela perguntou os grupos a um número que já se sabe caído").not.toContain(
      REF_DA_ULTRA,
    );
  });

  it("⭐ número CAÍDO com reserva: a tela diz que saem pela plataforma, e se ela está no grupo", async () => {
    estado.tabelas.channel_sessions = [MARCADA, DA_ULTRA("SCAN_QR_CODE")];
    estado.tabelas.organizations = [
      ultraCom({ modo: "empresa", channel_session_id: NUMERO_DA_ULTRA, reserva_da_plataforma: true }),
    ];
    // A plataforma NÃO está no G1: a reserva mandaria para um grupo de que ela não participa.
    estado.listGroups = async () => [{ chatId: G2, subject: "Outro grupo" }];

    const e = await empresaUltra();
    expect(e.situacao).toEqual({ via: "reserva", motivo: "numero_da_empresa_fora_do_ar", reserva: null });
    expect(e.reserva_no_grupo, "a tela prometeu uma reserva que não chega ao grupo").toBe(false);
  });

  it("sem escolha nenhuma, a linha é a de sempre: plataforma, sem grupos próprios", async () => {
    estado.tabelas.organizations = [{ id: TIME, display_name: "Time Company", settings: {} }];
    estado.listGroups = async () => [];
    const { data } = (await (await GET()).json()) as { data: { empresas: EmpresaNaTela[] } };
    expect(data.empresas[0]).toMatchObject({
      origem: { modo: "plataforma" },
      situacao: { via: "plataforma" },
      grupos_do_numero: null,
      reserva_no_grupo: null,
    });
  });
});

describe("número de avisos: gravar a escolha do número da empresa", () => {
  const pedir = (corpo: unknown) =>
    PUT_ORIGEM(
      new NextRequest("http://x/api/v1/admin/numero-de-avisos/origem", {
        method: "PUT",
        body: JSON.stringify(corpo),
      }),
    );
  const gravado = () => estado.atualizacoes.find((a) => a.tabela === "organizations")?.valores;

  it("⭐ grava o número da empresa com a reserva, sem apagar o resto do settings", async () => {
    estado.tabelas.channel_sessions = [DA_ULTRA("WORKING")];
    const origem = { modo: "empresa", channel_session_id: NUMERO_DA_ULTRA, reserva_da_plataforma: true };
    const res = await pedir({ organization_id: ULTRA, origem });
    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ settings: { routing: { modo: "rodizio" }, numero_de_avisos: origem } });
  });

  it("voltar para a plataforma APAGA a escolha (ausência é o padrão)", async () => {
    estado.tabelas.organizations = [
      ultraCom({ modo: "empresa", channel_session_id: NUMERO_DA_ULTRA, reserva_da_plataforma: false }),
    ];
    const res = await pedir({ organization_id: ULTRA, origem: { modo: "plataforma" } });
    expect(res.status).toBe(200);
    expect(gravado()).toEqual({ settings: { grupo_de_avisos: { id: G1, nome: "Vita · Comercial" } } });
  });

  it("RECUSA número de OUTRA empresa", async () => {
    estado.tabelas.channel_sessions = [{ ...DA_ULTRA("WORKING"), organization_id: TIME }];
    const res = await pedir({
      organization_id: ULTRA,
      origem: { modo: "empresa", channel_session_id: NUMERO_DA_ULTRA, reserva_da_plataforma: false },
    });
    expect(res.status, "o aviso da Ultra sairia pelo telefone de outro cliente").toBe(422);
    expect(gravado()).toBeUndefined();
  });

  it("RECUSA número que não entrega em grupo (a API oficial)", async () => {
    estado.tabelas.channel_sessions = [
      { ...DA_ULTRA("WORKING"), provider: CHANNEL_PROVIDER_META, meta_phone_number_id: "123" },
    ];
    const res = await pedir({
      organization_id: ULTRA,
      origem: { modo: "empresa", channel_session_id: NUMERO_DA_ULTRA, reserva_da_plataforma: false },
    });
    expect(res.status, "a escolha ficaria salva e o aviso morreria num 4xx").toBe(422);
  });

  it("RECUSA trocar para um número desconectado, mas deixa mexer na reserva do que já está escolhido", async () => {
    estado.tabelas.channel_sessions = [DA_ULTRA("FAILED")];
    const novo = await pedir({
      organization_id: ULTRA,
      origem: { modo: "empresa", channel_session_id: NUMERO_DA_ULTRA, reserva_da_plataforma: false },
    });
    expect(novo.status).toBe(422);

    estado.tabelas.organizations = [
      ultraCom({ modo: "empresa", channel_session_id: NUMERO_DA_ULTRA, reserva_da_plataforma: false }),
    ];
    const reserva = await pedir({
      organization_id: ULTRA,
      origem: { modo: "empresa", channel_session_id: NUMERO_DA_ULTRA, reserva_da_plataforma: true },
    });
    expect(reserva.status, "com o número caído, não deu para ligar a reserva, justo quando ela importa").toBe(200);
  });
});
