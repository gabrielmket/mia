/**
 * 9150 · O RAIO-X DO ATENDIMENTO no Postgres de verdade (.101,
 * docs/fork/raio-x-do-atendimento.md).
 *
 * ─── O que se mede, e por quê ───────────────────────────────────────────────
 *
 * 1. SÓ O SERVIDOR, nas sete tabelas: RLS ligada e NENHUMA política;
 *    `authenticated` (o administrador da PRÓPRIA empresa ligada ao raio-X) e
 *    `anon` recebem `permission denied` (42501), não zero linhas. CONTROLE: o
 *    `service_role` grava e lê. É a prova que `rls-completude-varredura` cobra.
 * 2. O que o banco GARANTE sozinho: o código do link é só o hash, o WhatsApp é
 *    dígito, o horário fecha depois de abrir, o teto fica entre R$ 5 e R$ 500,
 *    a marca da conversa é HMAC (nunca um telefone), foto e vídeo não guardam
 *    referência de arquivo, o relatório revisado tem quem revisou.
 * 3. O NÚMERO DE ORDEM nasce numa escrita só, sequencial por raio-X, e a mesma
 *    marca devolve o mesmo número.
 * 4. APAGAR AS CONVERSAS (o prazo de 30 dias) leva as mensagens, as conversas e
 *    a referência cifrada, e o RELATÓRIO, o aceite e o gasto ficam.
 * 5. O ACESSO ao link do dono conta só em link vivo.
 *
 * Organizações próprias (namespace `e9150e90-`). Dado fictício.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

const ORG = "e9150e90-0000-4000-8000-00000000000a";
const ADMIN = "e9150e90-1111-4000-8000-00000000000a";
const RX = "e9150e90-2222-4000-8000-000000000001";
const RX_2 = "e9150e90-2222-4000-8000-000000000002";
const REL = "e9150e90-3333-4000-8000-000000000001";
const LINK = "e9150e90-4444-4000-8000-000000000001";
const LINK_REVOGADO = "e9150e90-4444-4000-8000-000000000002";

const H = (c: string) => c.repeat(64);
const TABELAS = [
  "mia_raio_x",
  "mia_raio_x_aceites",
  "mia_raio_x_conversas",
  "mia_raio_x_mensagens",
  "mia_raio_x_relatorios",
  "mia_raio_x_links",
  "mia_raio_x_gastos",
];

function tentar(papel: "postgres" | "service_role" | "authenticated" | "anon", comando: string): string {
  return lastLine(
    sql(`
      ${papel === "postgres" ? "" : `set role ${papel};`}
      ${papel === "authenticated" ? `select set_config('request.jwt.claims', '{"sub":"${ADMIN}"}', false);` : ""}
      do $$
      begin
        begin
          ${comando};
          perform set_config('inv.r9150', 'passou', false);
        exception when others then
          perform set_config('inv.r9150', sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9150');
    `),
  );
}

function raioX(id: string, extra = ""): string {
  return `insert into public.mia_raio_x (id, empresa, segmento, whatsapp, organization_id${extra ? ", " + extra.split("=")[0] : ""})
    values ('${id}', 'Garagem Modelo Veículos', 'revenda_de_veiculos', '5531900001101', '${ORG}'${extra ? ", " + extra.split("=").slice(1).join("=") : ""})`;
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${ADMIN}', 'raio-x-9150@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}', 'raio-x-9150', 'Garagem Modelo', 'Garagem Modelo') on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${ADMIN}', '${ORG}', 'admin', now()) on conflict do nothing;
    ${raioX(RX, `conexao_codigo_hash='${H("a")}'`)};
    insert into public.mia_raio_x_relatorios (id, raio_x_id, sequencia, periodo_inicio, periodo_fim, criterios_versao, dados)
      values ('${REL}', '${RX}', 1, now() - interval '90 days', now(), '2026-11-v1', '{"versao":1}'::jsonb);
    insert into public.mia_raio_x_links (id, relatorio_id, token_hash) values ('${LINK}', '${REL}', '${H("1")}');
    insert into public.mia_raio_x_links (id, relatorio_id, token_hash, revoked_at) values ('${LINK_REVOGADO}', '${REL}', '${H("2")}', now());
    insert into public.mia_raio_x_aceites (raio_x_id, nome, termo_versao, termo_texto, termo_hash)
      values ('${RX}', 'Ricardo Exemplo', 'v1', 'TERMO v1', '${H("c")}');
    insert into public.mia_raio_x_gastos (raio_x_id, proposito, modelo, custo_usd_centavos, cotacao, custo_centavos)
      values ('${RX}', 'raio_x_analise', 'gpt-6-luna', 1.5, 5.4, 8.1);
  `);
});

describe("só o servidor lê e escreve, nas sete tabelas", () => {
  it("RLS ligada e nenhuma política em cada uma", () => {
    for (const t of TABELAS) {
      expect(lastLine(sql(`select relrowsecurity::text from pg_class where oid = 'public.${t}'::regclass;`)), t).toBe("true");
      expect(lastLine(sql(`select count(*) from pg_policy where polrelid = 'public.${t}'::regclass;`)), t).toBe("0");
    }
  });

  it("⭐ o administrador da PRÓPRIA empresa ligada não lê nem escreve pela sessão (42501, não zero linhas)", () => {
    for (const t of TABELAS) {
      expect(tentar("authenticated", `perform 1 from public.${t}`), t).toBe("42501");
    }
    expect(tentar("authenticated", raioX("e9150e90-2222-4000-8000-0000000000f1"))).toBe("42501");
    expect(tentar("authenticated", `update public.mia_raio_x set situacao = 'encerrado' where id = '${RX}'`)).toBe("42501");
    expect(tentar("authenticated", `delete from public.mia_raio_x_relatorios where id = '${REL}'`)).toBe("42501");
  });

  it("anon também não", () => {
    for (const t of TABELAS) expect(tentar("anon", `perform 1 from public.${t}`), t).toBe("42501");
  });

  it("CONTROLE: o service_role grava e lê", () => {
    expect(tentar("service_role", raioX("e9150e90-2222-4000-8000-0000000000f2"))).toBe("passou");
    expect(lastLine(sql(`set role service_role; select count(*) from public.mia_raio_x_relatorios where raio_x_id = '${RX}';`))).toBe("1");
  });

  it("e só a plataforma executa as funções", () => {
    for (const f of [
      "fn_mia_raio_x_conversa(uuid, text, text, timestamptz)",
      "fn_mia_raio_x_link_acessado(uuid)",
      "fn_mia_raio_x_expurgar_conversas(uuid, timestamptz)",
    ]) {
      expect(lastLine(sql(`select has_function_privilege('anon', 'public.${f}', 'execute')::text;`)), f).toBe("false");
      expect(lastLine(sql(`select has_function_privilege('authenticated', 'public.${f}', 'execute')::text;`)), f).toBe("false");
      expect(lastLine(sql(`select has_function_privilege('service_role', 'public.${f}', 'execute')::text;`)), f).toBe("true");
    }
  });
});

describe("o que o banco garante sozinho", () => {
  it("o código do link de conexão é só o hash: um código cru é recusado (23514)", () => {
    expect(tentar("postgres", raioX("e9150e90-2222-4000-8000-0000000000f3", "conexao_codigo_hash='K7PQ2M9X'"))).toBe("23514");
  });

  it("o WhatsApp é dígito E.164, sem máscara", () => {
    expect(
      tentar(
        "postgres",
        `insert into public.mia_raio_x (empresa, segmento, whatsapp) values ('X', 'outro', '(31) 90000-1101')`,
      ),
    ).toBe("23514");
  });

  it("o horário fecha depois de abrir, e o teto fica entre R$ 5 e R$ 500", () => {
    expect(tentar("postgres", raioX("e9150e90-2222-4000-8000-0000000000f4", "fecha='07:00'"))).toBe("23514");
    expect(tentar("postgres", raioX("e9150e90-2222-4000-8000-0000000000f5", "teto_centavos=100"))).toBe("23514");
    expect(tentar("postgres", raioX("e9150e90-2222-4000-8000-0000000000f6", "teto_centavos=60000"))).toBe("23514");
  });

  it("a marca da conversa é HMAC: um telefone no lugar dela é recusado (23514)", () => {
    expect(
      tentar(
        "postgres",
        `insert into public.mia_raio_x_conversas (raio_x_id, chat_marca, numero_ordem) values ('${RX}', '5531900000002@c.us', 99)`,
      ),
    ).toBe("23514");
  });

  it("foto, vídeo e documento só contam: referência de arquivo só no áudio (23514)", () => {
    const conversa = lastLine(sql(`select id from public.fn_mia_raio_x_conversa('${RX}', '${H("e")}', null, now());`));
    expect(
      tentar(
        "postgres",
        `insert into public.mia_raio_x_mensagens (raio_x_id, conversa_id, marca, da_loja, enviada_em, tipo, midia)
           values ('${RX}', '${conversa}', '${H("f")}', false, now(), 'imagem', 'v1.x.y.z')`,
      ),
    ).toBe("23514");
  });

  it("relatório revisado tem quando foi revisado (23514)", () => {
    expect(tentar("postgres", `update public.mia_raio_x_relatorios set situacao = 'revisado' where id = '${REL}'`)).toBe("23514");
    expect(
      tentar("postgres", `update public.mia_raio_x_relatorios set situacao = 'revisado', revisado_em = now() where id = '${REL}'`),
    ).toBe("passou");
  });
});

describe("o número de ordem", () => {
  it("nasce sequencial por raio-X, e a mesma marca devolve o mesmo número", () => {
    sql(raioX(RX_2));
    const um = lastLine(sql(`select numero_ordem from public.fn_mia_raio_x_conversa('${RX_2}', '${H("1")}', null, now());`));
    const dois = lastLine(sql(`select numero_ordem from public.fn_mia_raio_x_conversa('${RX_2}', '${H("2")}', null, now());`));
    const deNovo = lastLine(sql(`select numero_ordem from public.fn_mia_raio_x_conversa('${RX_2}', '${H("1")}', 'v1.a.b.c', now());`));
    expect([um, dois, deNovo]).toEqual(["1", "2", "1"]);
    expect(
      lastLine(sql(`select referencia from public.mia_raio_x_conversas where raio_x_id = '${RX_2}' and chat_marca = '${H("1")}';`)),
    ).toBe("v1.a.b.c");
  });
});

describe("apagar as conversas (30 dias depois do relatório)", () => {
  it("leva mensagens, conversas e a referência; o relatório, o aceite e o gasto ficam", () => {
    const conversa = lastLine(sql(`select id from public.fn_mia_raio_x_conversa('${RX}', '${H("d")}', 'v1.ref.cifrada.x', now());`));
    sql(`
      insert into public.mia_raio_x_mensagens (raio_x_id, conversa_id, marca, da_loja, enviada_em, tipo, texto)
        values ('${RX}', '${conversa}', '${H("7")}', false, now() - interval '2 days', 'texto', 'Oi, ainda tem o carro?');
    `);
    const r = lastLine(sql(`select public.fn_mia_raio_x_expurgar_conversas('${RX}')::text;`));
    expect(JSON.parse(r)).toMatchObject({ mensagens: 1 });
    expect(lastLine(sql(`select count(*) from public.mia_raio_x_mensagens where raio_x_id = '${RX}';`))).toBe("0");
    expect(lastLine(sql(`select count(*) from public.mia_raio_x_conversas where raio_x_id = '${RX}';`))).toBe("0");
    expect(lastLine(sql(`select (conversas_apagadas_em is not null)::text from public.mia_raio_x where id = '${RX}';`))).toBe("true");
    expect(lastLine(sql(`select count(*) from public.mia_raio_x_relatorios where raio_x_id = '${RX}';`))).toBe("1");
    expect(lastLine(sql(`select count(*) from public.mia_raio_x_aceites where raio_x_id = '${RX}';`))).toBe("1");
    expect(lastLine(sql(`select count(*) from public.mia_raio_x_gastos where raio_x_id = '${RX}';`))).toBe("1");
  });

  it("com corte (o mensal), só as mensagens antigas saem e a conversa fica", () => {
    const conversa = lastLine(sql(`select id from public.fn_mia_raio_x_conversa('${RX_2}', '${H("9")}', null, now());`));
    sql(`
      insert into public.mia_raio_x_mensagens (raio_x_id, conversa_id, marca, da_loja, enviada_em, tipo, texto) values
        ('${RX_2}', '${conversa}', '${H("8")}', false, now() - interval '60 days', 'texto', 'antiga'),
        ('${RX_2}', '${conversa}', '${H("6")}', false, now() - interval '1 day', 'texto', 'nova');
    `);
    sql(`select public.fn_mia_raio_x_expurgar_conversas('${RX_2}', now() - interval '30 days');`);
    expect(lastLine(sql(`select string_agg(texto, ',') from public.mia_raio_x_mensagens where conversa_id = '${conversa}';`))).toBe("nova");
    expect(lastLine(sql(`select count(*) from public.mia_raio_x_conversas where id = '${conversa}';`))).toBe("1");
  });
});

describe("o acesso ao link do dono", () => {
  it("conta só em link vivo", () => {
    expect(lastLine(sql(`select public.fn_mia_raio_x_link_acessado('${LINK}')::text;`))).toBe("true");
    expect(lastLine(sql(`select public.fn_mia_raio_x_link_acessado('${LINK_REVOGADO}')::text;`))).toBe("false");
    expect(lastLine(sql(`select acessos from public.mia_raio_x_links where id = '${LINK}';`))).toBe("1");
    expect(lastLine(sql(`select acessos from public.mia_raio_x_links where id = '${LINK_REVOGADO}';`))).toBe("0");
  });
});
