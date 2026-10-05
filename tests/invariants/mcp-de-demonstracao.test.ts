import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";

import { clienteMcp, TOKEN } from "@/tests/helpers/implantacao-em-memoria";

import { pgComoSupabaseMia } from "../pg-como-supabase-mia";

/**
 * FORK MIA — AS EMPRESAS DE DEMONSTRAÇÃO PELO MCP DE PLATAFORMA, NO POSTGRES DE VERDADE.
 *
 * As três ferramentas (`lib/mcp-plataforma/ferramentas/demonstracao.ts`) pelo
 * caminho inteiro: o cliente MCP em memória, a guarda da operação ANTES do
 * handler, a conferência dos argumentos e a semente gravando pelo Postgres do
 * app (`SUPABASE_DB_URL`, aqui o banco descartável), com a trava da 9010 de pé.
 *
 * O que se mede:
 *   1. criar exige `criar_cliente`, reaplicar exige `implantar_configuracao`, e
 *      sem a operação nada é gravado;
 *   2. criar de novo não grava nada e devolve a que existe; reaplicar renova as
 *      datas sem duplicar;
 *   3. a recusa ensina: reaplicar o que não existe manda criar; o slug de outra
 *      empresa e a demonstração desmarcada são recusados sem tocar nelas;
 *   4. a empresa criada nasce travada e não enfileira nada.
 *
 * Sem dado de ninguém: e-mails `@invariant.test`, dados fictícios da semente.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const estado = vi.hoisted(() => {
  // Antes de qualquer import: o app alcança o Postgres por aqui (o pool do motor).
  process.env.SUPABASE_DB_URL = `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres`;
  return { cliente: null as unknown };
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres`,
  max: 4,
});

estado.cliente = await pgComoSupabaseMia(pool);

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { idDaDemonstracao } = await import("@/lib/demonstracao/semente/aplicar");

const IMPLANTADOR = "90209020-1111-4000-8000-00000000000a";
const QUEM_APRESENTA = "90209020-1111-4000-8000-00000000000b";
const INTRUSA = "90209020-0000-4000-8000-0000000000aa";
const INDUSTRIA = idDaDemonstracao("industria");

async function valor<T = string>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await pool.query(sql, params);
  return Object.values(rows[0] ?? {})[0] as T;
}

beforeAll(async () => {
  await pool.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
       ($1, 'implantador-9020@invariant.test', '{"full_name":"Pessoa Implantadora"}'),
       ($2, 'quem-apresenta-9020@invariant.test', '{}')
     on conflict (id) do nothing`,
    [IMPLANTADOR, QUEM_APRESENTA],
  );
  await pool.query(
    `insert into public.platform_api_tokens (id, name, prefix, token_hash, operacoes, created_by, reason)
       values ($1, 'invariante das demonstrações', 'dskp_inv', '\\x00'::bytea, $2, $3, 'invariante das demonstrações')
     on conflict (id) do nothing`,
    [TOKEN, ["criar_cliente", "implantar_configuracao"], IMPLANTADOR],
  );
});

afterAll(async () => {
  await pool.end();
});

describe("a guarda da operação, antes de gravar", () => {
  it("⭐ sem a operação, criar e reaplicar são recusados e NENHUMA organização nasce", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const criar = await mcp.chamar("plataforma_criar_demonstracao", { segmento: "industria" });
    expect(criar.erro).toBe(true);
    expect(criar.texto).toContain('Este token não tem a operação "criar_cliente"');
    const reaplicar = await mcp.chamar("plataforma_reaplicar_demonstracao", { segmento: "industria" });
    expect(reaplicar.erro).toBe(true);
    expect(reaplicar.texto).toContain('Este token não tem a operação "implantar_configuracao"');
    await mcp.fechar();
    expect(await valor(`select count(*)::text from public.organizations where id = $1`, [INDUSTRIA])).toBe("0");
  });

  it("⭐ reaplicar o que ainda não existe é recusado, e a recusa manda criar (com a operação certa)", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, ["implantar_configuracao"]);
    const r = await mcp.chamar("plataforma_reaplicar_demonstracao", { segmento: "industria" });
    await mcp.fechar();
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("ainda não existe");
    expect(r.texto).toContain("plataforma_criar_demonstracao");
    expect(r.texto).toContain("criar_cliente");
    expect(await valor(`select count(*)::text from public.organizations where id = $1`, [INDUSTRIA])).toBe("0");
  });

  it("a listagem é leitura livre: as cinco sementes, nenhuma criada ainda", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const r = await mcp.chamar("plataforma_listar_demonstracoes", {});
    await mcp.fechar();
    expect(r.erro, r.texto).toBe(false);
    const lista = r.dados.demonstracoes as Array<{ segmento: string; existe: boolean }>;
    expect(lista.map((d) => d.segmento)).toEqual(["bancada", "construtora", "clinica-odonto", "industria", "academia"]);
    expect(lista.every((d) => !d.existe)).toBe(true);
  });
});

describe("criar, criar de novo e reaplicar", () => {
  let criada: Record<string, unknown>;

  beforeAll(async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, ["criar_cliente"]);
    const r = await mcp.chamar("plataforma_criar_demonstracao", {
      segmento: "industria",
      emails_de_acesso: ["quem-apresenta-9020@invariant.test", "ninguem-9020@invariant.test"],
    });
    await mcp.fechar();
    expect(r.erro, r.texto).toBe(false);
    criada = r.dados;
  }, 300_000);

  it("⭐ cria a empresa inteira, travada, e diz o que gravou", async () => {
    expect(criada).toMatchObject({ desfecho: "criou", segmento: "industria", organization_id: INDUSTRIA, nome: "Demonstração · Indústria" });
    const contagens = criada.contagens as Record<string, number>;
    expect(contagens.crm_leads).toBeGreaterThan(10);
    expect(contagens.catalog_products).toBeGreaterThan(10);
    expect(criada.avisos as string[]).toEqual([expect.stringContaining("ninguem-9020@invariant.test")]);
    // Cabe folgado numa chamada HTTP (a rota tem maxDuration de 300 s).
    expect(criada.duracao_ms as number).toBeLessThan(120_000);
    expect(await valor(`select demonstracao::text from public.organizations where id = $1`, [INDUSTRIA])).toBe("true");
  });

  it("⭐ quem criou o token e quem vai apresentar entram como admin; o e-mail sem login não ganha nada", async () => {
    const { rows } = await pool.query<{ user_id: string; role: string }>(
      `select user_id::text, role from public.user_organizations where organization_id = $1 and user_id = any($2::uuid[]) order by user_id`,
      [INDUSTRIA, [IMPLANTADOR, QUEM_APRESENTA]],
    );
    expect(rows).toEqual([
      { user_id: QUEM_APRESENTA, role: "admin" },
      { user_id: IMPLANTADOR, role: "admin" },
    ].sort((a, b) => a.user_id.localeCompare(b.user_id)));
  });

  it("⭐ nada sai nem fica na fila", async () => {
    expect(await valor(`select count(*)::text from public.event_log where organization_id = $1 and status in ('pending', 'processing')`, [INDUSTRIA])).toBe("0");
    expect(
      await valor(`select count(*)::text from public.messages where organization_id = $1 and direction = 'outbound' and status in ('queued', 'sending')`, [INDUSTRIA]),
    ).toBe("0");
    expect(await valor(`select count(*)::text from public.channel_sessions where organization_id = $1 and archived_at is null`, [INDUSTRIA])).toBe("0");
  });

  it("⭐ criar de novo não grava nada: devolve a que existe e diz como renovar", async () => {
    const antes = await valor(`select settings -> 'semente_de_demonstracao' ->> 'aplicada_em' from public.organizations where id = $1`, [INDUSTRIA]);
    const mcp = await clienteMcp(criarServidorDePlataforma as never, ["criar_cliente"]);
    const r = await mcp.chamar("plataforma_criar_demonstracao", { segmento: "industria" });
    await mcp.fechar();
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados).toMatchObject({ desfecho: "ja_estava", organization_id: INDUSTRIA });
    expect(r.dados.recado).toContain("plataforma_reaplicar_demonstracao");
    expect(await valor(`select settings -> 'semente_de_demonstracao' ->> 'aplicada_em' from public.organizations where id = $1`, [INDUSTRIA])).toBe(antes);
  });

  it("⭐ reaplicar renova as datas e não duplica nada", async () => {
    const antes = await valor(`select settings -> 'semente_de_demonstracao' ->> 'aplicada_em' from public.organizations where id = $1`, [INDUSTRIA]);
    const mcp = await clienteMcp(criarServidorDePlataforma as never, ["implantar_configuracao"]);
    const r = await mcp.chamar("plataforma_reaplicar_demonstracao", { segmento: "industria" });
    await mcp.fechar();
    expect(r.erro, r.texto).toBe(false);
    expect(r.dados).toMatchObject({ desfecho: "renovou", organization_id: INDUSTRIA, aplicada_antes_em: antes });
    expect(r.dados.contagens).toEqual(criada.contagens);
    const depois = await valor(`select settings -> 'semente_de_demonstracao' ->> 'aplicada_em' from public.organizations where id = $1`, [INDUSTRIA]);
    expect(Date.parse(depois)).toBeGreaterThan(Date.parse(antes));
  }, 300_000);

  it("a listagem mostra a criada, com as contagens e a data da última aplicação", async () => {
    const mcp = await clienteMcp(criarServidorDePlataforma as never, []);
    const r = await mcp.chamar("plataforma_listar_demonstracoes", {});
    await mcp.fechar();
    const lista = r.dados.demonstracoes as Array<{ segmento: string; existe: boolean; aplicada_em: string | null; contagens: Record<string, number> | null }>;
    const industria = lista.find((d) => d.segmento === "industria")!;
    expect(industria.existe).toBe(true);
    expect(industria.aplicada_em).toBeTruthy();
    expect(industria.contagens).toMatchObject({
      negocios: (criada.contagens as Record<string, number>).crm_leads,
      produtos: (criada.contagens as Record<string, number>).catalog_products,
      obrigacoes: (criada.contagens as Record<string, number>).mia_obrigacoes,
    });
    expect(lista.filter((d) => d.existe).map((d) => d.segmento)).toEqual(["industria"]);
  });
});

describe("as recusas que protegem empresa que não é da semente", () => {
  it("⭐ o slug de uma demonstração já usado por OUTRA empresa: recusa e não toca nela", async () => {
    await pool.query(
      `insert into public.organizations (id, slug, legal_name, display_name) values ($1, 'demonstracao-academia', 'Intrusa', 'Intrusa')`,
      [INTRUSA],
    );
    const mcp = await clienteMcp(criarServidorDePlataforma as never, ["criar_cliente"]);
    const r = await mcp.chamar("plataforma_criar_demonstracao", { segmento: "academia" });
    await mcp.fechar();
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("já é de outra organização");
    expect(await valor(`select demonstracao::text || ',' || display_name from public.organizations where id = $1`, [INTRUSA])).toBe("false,Intrusa");
    expect(await valor(`select count(*)::text from public.organizations where id = $1`, [idDaDemonstracao("academia")])).toBe("0");
  });

  it("⭐ a demonstração DESMARCADA não é regravada: tirar a trava é decisão de alguém", async () => {
    await pool.query(`update public.organizations set demonstracao = false where id = $1`, [INDUSTRIA]);
    try {
      const mcp = await clienteMcp(criarServidorDePlataforma as never, ["implantar_configuracao"]);
      const r = await mcp.chamar("plataforma_reaplicar_demonstracao", { segmento: "industria" });
      await mcp.fechar();
      expect(r.erro).toBe(true);
      expect(r.texto).toContain("DESMARCADA");
      expect(await valor(`select demonstracao::text from public.organizations where id = $1`, [INDUSTRIA])).toBe("false");
    } finally {
      await pool.query(`update public.organizations set demonstracao = true where id = $1`, [INDUSTRIA]);
    }
  });
});
