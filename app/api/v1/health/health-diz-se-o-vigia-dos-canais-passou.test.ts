import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * FORK MIA (MIA-154) — GET /api/v1/health diz se o VIGIA DOS NÚMEROS passou.
 *
 * O cron `channel-health` regrava a linha dele em `mia_batimentos_de_cron` no
 * fim de cada rodada (migration 9168). A saúde lê essa linha e responde
 * `vigia_dos_canais: { ultima_rodada_em, em_dia }`, que o monitor de fora (n8n)
 * e a ronda leem.
 *
 * As promessas, todas aqui:
 *  - em dia com menos de 15 min (três batidas), atrasado com mais;
 *  - sem linha: nunca bateu, `em_dia: false`;
 *  - sem a tabela ou com a leitura falhando: `em_dia: null` (desconhecido);
 *  - nada disso muda o `status` nem o HTTP da saúde: o passo 1 do trem lê só
 *    `status` e `schema`;
 *  - só uma data e um booleano saem; o `resumo` da linha fica no banco.
 *
 *     npx vitest run app/api/v1/health/health-diz-se-o-vigia-dos-canais-passou.test.ts
 */

const URL_DO_PROJETO = "https://projeto-do-cliente.supabase.co";

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://projeto-do-cliente.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "chave-anon-de-teste",
    SUPABASE_SERVICE_ROLE_KEY: "chave-de-teste",
    UPSTASH_REDIS_REST_URL: "https://redis-de-teste.exemplo",
    UPSTASH_REDIS_REST_TOKEN: "token-de-teste",
    INTERNAL_CRON_SECRET: "segredo-interno-de-teste-com-tamanho-suficiente",
    INTERNAL_SECRET: "",
  },
}));

const MINUTO = 60 * 1000;
const haMinutos = (m: number) => new Date(Date.now() - m * MINUTO).toISOString();

type RespostaDoBatimento = Response | (() => never);

/** Responde a leitura do batimento com `resposta`; o resto da saúde, com 200 e vazio. */
function stubDoBanco(resposta: RespostaDoBatimento) {
  const chamadas: Array<{ alvo: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", (entrada: string | URL | Request, init?: RequestInit) => {
    const alvo = typeof entrada === "string" ? entrada : String(entrada);
    chamadas.push({ alvo, init });
    if (alvo.includes("/rest/v1/mia_batimentos_de_cron")) {
      if (typeof resposta === "function") return Promise.reject(new Error("fetch failed"));
      return Promise.resolve(resposta);
    }
    return Promise.resolve(new Response("[]", { status: 200 }));
  });
  return chamadas;
}

const linhas = (l: Array<Record<string, unknown>>) => new Response(JSON.stringify(l), { status: 200 });

async function saude() {
  const { GET } = await import("./route");
  const res = await GET(new NextRequest("https://crm.exemplo.com.br/api/v1/health"));
  return { http: res.status, corpo: (await res.json()) as { data: Record<string, unknown> } };
}

/**
 * O `status` da saúde com o vigia EM DIA, nas mesmas condições. É a referência
 * de "não mudou": o ambiente do teste não configura o transporte do canal, então ele não é `healthy`.
 */
async function statusComOVigiaEmDia(): Promise<unknown> {
  vi.resetModules();
  stubDoBanco(linhas([{ ultima_rodada_em: haMinutos(1) }]));
  const { corpo } = await saude();
  vi.resetModules();
  return corpo.data.status;
}

describe("GET /api/v1/health — o bloco vigia_dos_canais", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("⭐ bateu há 4 min: em_dia true, e a leitura foi ao banco do servidor, só na linha do vigia", async () => {
    const quando = haMinutos(4);
    const chamadas = stubDoBanco(linhas([{ ultima_rodada_em: quando }]));
    const { corpo } = await saude();

    expect(corpo.data.vigia_dos_canais).toEqual({ ultima_rodada_em: quando, em_dia: true });

    const ida = chamadas.find((c) => c.alvo.includes("/rest/v1/mia_batimentos_de_cron"));
    expect(ida?.alvo.startsWith(URL_DO_PROJETO), "a leitura do batimento não foi ao banco do servidor").toBe(true);
    expect(ida?.alvo).toContain("rota=eq.channel-health");
    expect(ida?.alvo).toContain("select=ultima_rodada_em");
    expect(new Headers(ida?.init?.headers).get("Accept-Profile")).toBe("public");
  });

  it("⭐ bateu há 20 min: em_dia false (atrasado), e a saúde não muda", async () => {
    const referencia = await statusComOVigiaEmDia();
    const quando = haMinutos(20);
    stubDoBanco(linhas([{ ultima_rodada_em: quando }]));
    const { http, corpo } = await saude();

    expect(corpo.data.vigia_dos_canais).toEqual({ ultima_rodada_em: quando, em_dia: false });
    expect(http, "o vigia atrasado derrubou a saúde").toBe(200);
    expect(corpo.data.status, "o vigia mudou o status da saúde").toBe(referencia);
  });

  it("⭐ sem linha (o vigia nunca bateu): em_dia false, sem data", async () => {
    const referencia = await statusComOVigiaEmDia();
    stubDoBanco(linhas([]));
    const { http, corpo } = await saude();

    expect(corpo.data.vigia_dos_canais).toEqual({ ultima_rodada_em: null, em_dia: false });
    expect(http).toBe(200);
    expect(corpo.data.status, "o vigia mudou o status da saúde").toBe(referencia);
  });

  it("sem a tabela (a 9168 não passou) e com a leitura falhando: desconhecido, com o motivo", async () => {
    const referencia = await statusComOVigiaEmDia();
    stubDoBanco(new Response(JSON.stringify({ code: "PGRST205" }), { status: 404 }));
    expect((await saude()).corpo.data.vigia_dos_canais).toEqual({
      ultima_rodada_em: null,
      em_dia: null,
      motivo: "sem_tabela",
    });

    vi.resetModules();
    stubDoBanco(() => {
      throw new Error("fetch failed");
    });
    const { http, corpo } = await saude();
    expect(corpo.data.vigia_dos_canais).toEqual({
      ultima_rodada_em: null,
      em_dia: null,
      motivo: "falha_de_leitura",
    });
    expect(http).toBe(200);
    expect(corpo.data.status, "o vigia mudou o status da saúde").toBe(referencia);
  });

  it("só a data e o booleano saem — o resumo da linha fica no banco", async () => {
    stubDoBanco(
      linhas([
        {
          ultima_rodada_em: haMinutos(2),
          // Se a leitura um dia pedir mais do que deve, a rota não repassa.
          resumo: { sessoes: 7, organizacao: "org-que-nao-pode-sair" },
        },
      ]),
    );
    const { corpo } = await saude();
    expect(Object.keys(corpo.data.vigia_dos_canais as object).sort()).toEqual(["em_dia", "ultima_rodada_em"]);
    expect(JSON.stringify(corpo)).not.toContain("org-que-nao-pode-sair");
  });
});
