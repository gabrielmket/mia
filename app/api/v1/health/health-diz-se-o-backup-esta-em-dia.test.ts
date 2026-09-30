import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * FORK MIA (.62) — GET /api/v1/health diz se o BACKUP do banco está em dia.
 *
 * O backup diário grava em `operacao.backup`, e ninguém era avisado se ele
 * parasse. Agora a saúde tem um bloco `backup` — datas e códigos, nenhum texto
 * de erro — que o monitor de fora (n8n) lê em `backup.em_dia`.
 *
 * Três promessas, e as três estão aqui:
 *  - em dia e atrasado seguem a régua das 26 h;
 *  - sem a função, sem a tabela ou com a leitura falhando, o bloco diz
 *    `desconhecido` — e a saúde NÃO cai por causa disso;
 *  - nada do backup sai além de datas e códigos.
 *
 *     npx vitest run app/api/v1/health/health-diz-se-o-backup-esta-em-dia.test.ts
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

const HORA = 60 * 60 * 1000;
const haHoras = (h: number) => new Date(Date.now() - h * HORA).toISOString();

type RespostaDoBackup = Response | (() => never);

/** Responde a função do backup com `resposta`; o resto da saúde, com 200. */
function stubDoBanco(resposta: RespostaDoBackup) {
  const chamadas: Array<{ alvo: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", (entrada: string | URL | Request, init?: RequestInit) => {
    const alvo = typeof entrada === "string" ? entrada : String(entrada);
    chamadas.push({ alvo, init });
    if (alvo.includes("/rest/v1/rpc/fn_mia_estado_do_backup")) {
      if (typeof resposta === "function") return Promise.reject(new Error("fetch failed"));
      return Promise.resolve(resposta);
    }
    return Promise.resolve(new Response("[]", { status: 200 }));
  });
  return chamadas;
}

const linha = (l: Record<string, unknown>) => new Response(JSON.stringify([l]), { status: 200 });

async function saude() {
  const { GET } = await import("./route");
  const res = await GET(new NextRequest("https://crm.exemplo.com.br/api/v1/health"));
  return { http: res.status, corpo: (await res.json()) as { data: Record<string, unknown> } };
}

describe("GET /api/v1/health — o bloco backup", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("⭐ cópia de 5 h atrás, enviada: em_dia true", async () => {
    const chamadas = stubDoBanco(
      linha({ situacao: "ok", ultima_copia_em: haHoras(5), enviada_em: haHoras(4.8) }),
    );
    const { corpo } = await saude();

    expect(corpo.data.backup).toMatchObject({ estado: "em_dia", em_dia: true, envio_ao_drive: "ok" });
    const ida = chamadas.find((c) => c.alvo.includes("/rpc/fn_mia_estado_do_backup"));
    expect(ida?.alvo.startsWith(URL_DO_PROJETO), "a leitura do backup não foi ao banco do servidor").toBe(true);
    expect(new Headers(ida?.init?.headers).get("Accept-Profile")).toBe("public");
  });

  it("⭐ cópia de 30 h atrás: em_dia false (atrasado)", async () => {
    stubDoBanco(linha({ situacao: "ok", ultima_copia_em: haHoras(30), enviada_em: haHoras(29.8) }));
    const { corpo } = await saude();
    expect(corpo.data.backup).toMatchObject({ estado: "atrasado", em_dia: false });
  });

  it("⭐ sem a tabela (ambiente de teste): desconhecido, e a saúde não cai", async () => {
    stubDoBanco(linha({ situacao: "sem_tabela", ultima_copia_em: null, enviada_em: null }));
    const { http, corpo } = await saude();
    expect(corpo.data.backup).toEqual({ estado: "desconhecido", em_dia: null, motivo: "sem_tabela" });
    expect(http, "o backup desconhecido derrubou a saúde").toBe(200);
  });

  it("sem a função (o baseline não passou) e com a leitura falhando: desconhecido, com o motivo", async () => {
    stubDoBanco(new Response(JSON.stringify({ code: "PGRST202" }), { status: 404 }));
    expect((await saude()).corpo.data.backup).toEqual({
      estado: "desconhecido",
      em_dia: null,
      motivo: "sem_funcao",
    });

    vi.resetModules();
    stubDoBanco(() => {
      throw new Error("fetch failed");
    });
    const { http, corpo } = await saude();
    expect(corpo.data.backup).toEqual({ estado: "desconhecido", em_dia: null, motivo: "falha_de_leitura" });
    expect(http).toBe(200);
  });

  it("o bloco só tem datas e códigos — nada de texto de erro do backup", async () => {
    stubDoBanco(
      linha({
        situacao: "ok",
        ultima_copia_em: haHoras(5),
        enviada_em: null,
        // Se a função um dia devolver mais do que deve, a rota não repassa.
        detalhe: "pg_dump: erro na tabela contacts com o valor 5511999998888",
      }),
    );
    const { corpo } = await saude();
    expect(Object.keys(corpo.data.backup as object).sort()).toEqual([
      "em_dia",
      "envio_ao_drive",
      "estado",
      "ultima_copia_em",
    ]);
    expect(JSON.stringify(corpo)).not.toContain("5511999998888");
  });
});
