/**
 * 9152 · O RAIO-X GRÁTIS POR CADASTRO no Postgres de verdade (FORK MIA .106,
 * docs/fork/raio-x-do-atendimento.md, seção 16).
 *
 * ─── O que se mede, e por quê ───────────────────────────────────────────────
 *
 * 1. SÓ O SERVIDOR, nas quatro tabelas novas (contas, códigos de acesso,
 *    pedidos e preços): RLS ligada e NENHUMA política; `authenticated` e `anon`
 *    recebem `permission denied` (42501). CONTROLE: o `service_role` grava e lê.
 * 2. O que o banco GARANTE sozinho: o e-mail da conta é único e minúsculo, o nome
 *    tem sobrenome, o telefone é dígito; o código de acesso é só o hash; o pedido
 *    e o preço têm o tipo, a situação e o valor fechados; o raio-X do cadastro é
 *    pela conexão, só ele tem grátis, e o `criado_via` aceita 'cadastro'.
 * 3. UMA GRÁTIS VIVA por conta e por número (a mesma grafia), e a que fechou sem
 *    histórico não conta.
 * 4. O raio-X que já existia nasce com a origem 'time' (o DEFAULT), sem grátis.
 *
 * Organizações e contas próprias (namespace `e9152e90-`). Dado fictício.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

const ADMIN = "e9152e90-1111-4000-8000-00000000000a";
const CONTA = "e9152e90-5555-4000-8000-000000000001";
const CONTA_2 = "e9152e90-5555-4000-8000-000000000002";
const RX_TIME = "e9152e90-2222-4000-8000-000000000001";
const RX_GRATIS = "e9152e90-2222-4000-8000-000000000002";

const H = (c: string) => c.repeat(64);
const TABELAS = ["mia_raio_x_contas", "mia_raio_x_codigos_de_acesso", "mia_raio_x_pedidos", "mia_raio_x_precos"];

function tentar(papel: "postgres" | "service_role" | "authenticated" | "anon", comando: string): string {
  return lastLine(
    sql(`
      ${papel === "postgres" ? "" : `set role ${papel};`}
      ${papel === "authenticated" ? `select set_config('request.jwt.claims', '{"sub":"${ADMIN}"}', false);` : ""}
      do $$
      begin
        begin
          ${comando};
          perform set_config('inv.r9152', 'passou', false);
        exception when others then
          perform set_config('inv.r9152', sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9152');
    `),
  );
}

function conta(id: string, email: string, extra: Record<string, string> = {}): string {
  // O `extra` troca a coluna padrão (nome, telefone) em vez de repeti-la.
  const linha: Record<string, string> = { id: `'${id}'`, email: `'${email}'`, nome: "'Ricardo Exemplo'", telefone: "'5531900002202'", ...extra };
  return `insert into public.mia_raio_x_contas (${Object.keys(linha).join(", ")}) values (${Object.values(linha).join(", ")})`;
}

function raioX(id: string, whatsapp: string, extra: Record<string, string> = {}): string {
  const colunas = ["id", "empresa", "segmento", "whatsapp", ...Object.keys(extra)];
  const valores = [`'${id}'`, "'Garagem Modelo Veículos'", "'revenda_de_veiculos'", `'${whatsapp}'`, ...Object.values(extra)];
  return `insert into public.mia_raio_x (${colunas.join(", ")}) values (${valores.join(", ")})`;
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${ADMIN}', 'raio-x-9152@invariant.test') on conflict (id) do nothing;
    ${conta(CONTA, "ricardo@garagemmodelo.com.br")};
    ${conta(CONTA_2, "outra@garagemmodelo.com.br")};
    ${raioX(RX_TIME, "5531900001101")};
    insert into public.mia_raio_x_codigos_de_acesso (conta_id, codigo_hash, expira_em) values ('${CONTA}', '${H("a")}', now() + interval '15 minutes');
    insert into public.mia_raio_x_pedidos (conta_id, whatsapp, tipo) values ('${CONTA}', '5531900001101', 'avulsa');
    insert into public.mia_raio_x_precos (tipo, valor_centavos) values ('avulsa', 7900) on conflict (tipo) do nothing;
  `);
});

describe("só o servidor lê e escreve, nas quatro tabelas novas", () => {
  it("RLS ligada e nenhuma política em cada uma", () => {
    for (const t of TABELAS) {
      expect(lastLine(sql(`select relrowsecurity::text from pg_class where oid = 'public.${t}'::regclass;`)), t).toBe("true");
      expect(lastLine(sql(`select count(*) from pg_policy where polrelid = 'public.${t}'::regclass;`)), t).toBe("0");
    }
  });

  it("⭐ authenticated e anon não leem nem escrevem (42501, não zero linhas)", () => {
    for (const t of TABELAS) {
      expect(tentar("authenticated", `perform 1 from public.${t}`), t).toBe("42501");
      expect(tentar("anon", `perform 1 from public.${t}`), t).toBe("42501");
    }
    expect(tentar("authenticated", conta("e9152e90-5555-4000-8000-0000000000f1", "invasor@garagemmodelo.com.br"))).toBe("42501");
    expect(tentar("anon", `update public.mia_raio_x_precos set valor_centavos = 500 where tipo = 'avulsa'`)).toBe("42501");
  });

  it("CONTROLE: o service_role grava e lê", () => {
    expect(tentar("service_role", conta("e9152e90-5555-4000-8000-0000000000f2", "controle@garagemmodelo.com.br"))).toBe("passou");
    expect(lastLine(sql(`set role service_role; select count(*) from public.mia_raio_x_pedidos where conta_id = '${CONTA}';`))).toBe("1");
  });
});

describe("o que o banco garante sozinho", () => {
  it("o e-mail da conta é único e minúsculo, com formato (23505 e 23514)", () => {
    expect(tentar("postgres", conta("e9152e90-5555-4000-8000-0000000000f3", "ricardo@garagemmodelo.com.br"))).toBe("23505");
    expect(tentar("postgres", conta("e9152e90-5555-4000-8000-0000000000f4", "Ricardo@GaragemModelo.com.br"))).toBe("23514");
    expect(tentar("postgres", conta("e9152e90-5555-4000-8000-0000000000f5", "ricardo-arroba-garagem"))).toBe("23514");
  });

  it("o nome tem sobrenome e o telefone é dígito E.164 (23514)", () => {
    expect(tentar("postgres", conta("e9152e90-5555-4000-8000-0000000000f6", "nome@garagemmodelo.com.br", { nome: "'Ricardo'" }))).toBe("23514");
    expect(
      tentar("postgres", conta("e9152e90-5555-4000-8000-0000000000f7", "telefone@garagemmodelo.com.br", { telefone: "'(31) 90000-2202'" })),
    ).toBe("23514");
  });

  it("o código de acesso é só o hash: um código de 6 números cru é recusado (23514)", () => {
    expect(
      tentar(
        "postgres",
        `insert into public.mia_raio_x_codigos_de_acesso (conta_id, codigo_hash, expira_em) values ('${CONTA}', '482913', now() + interval '15 minutes')`,
      ),
    ).toBe("23514");
  });

  it("apagar a conta leva os códigos (cascata) e solta os pedidos", () => {
    sql(`
      insert into public.mia_raio_x_codigos_de_acesso (conta_id, codigo_hash, expira_em) values ('${CONTA_2}', '${H("b")}', now() + interval '15 minutes');
      insert into public.mia_raio_x_pedidos (conta_id, whatsapp, tipo) values ('${CONTA_2}', '5531900001199', 'mensal');
      delete from public.mia_raio_x_contas where id = '${CONTA_2}';
    `);
    expect(lastLine(sql(`select count(*) from public.mia_raio_x_codigos_de_acesso where conta_id = '${CONTA_2}';`))).toBe("0");
    expect(lastLine(sql(`select count(*) from public.mia_raio_x_pedidos where whatsapp = '5531900001199' and conta_id is null;`))).toBe("1");
  });

  it("o pedido tem tipo e situação fechados, e cobrança criada tem valor (23514)", () => {
    const pedido = (extra: string) =>
      `insert into public.mia_raio_x_pedidos (conta_id, whatsapp, tipo, situacao, valor_centavos) values ('${CONTA}', '5531900001101', ${extra})`;
    expect(tentar("postgres", pedido("'semanal', 'interesse', null"))).toBe("23514");
    expect(tentar("postgres", pedido("'avulsa', 'gratis', null"))).toBe("23514");
    expect(tentar("postgres", pedido("'avulsa', 'aguardando', null"))).toBe("23514");
    expect(tentar("postgres", pedido("'avulsa', 'aguardando', 7900"))).toBe("passou");
    // Pago tem quando foi pago.
    expect(tentar("postgres", pedido("'avulsa', 'pago', 7900"))).toBe("23514");
  });

  it("o preço tem tipo fechado e fica entre R$ 5 e R$ 10 mil (23514)", () => {
    expect(tentar("postgres", `insert into public.mia_raio_x_precos (tipo, valor_centavos) values ('anual', 9900)`)).toBe("23514");
    expect(tentar("postgres", `insert into public.mia_raio_x_precos (tipo, valor_centavos) values ('mensal', 100)`)).toBe("23514");
    expect(tentar("postgres", `insert into public.mia_raio_x_precos (tipo, valor_centavos) values ('mensal', 11900)`)).toBe("passou");
  });
});

describe("o raio-X do cadastro", () => {
  it("o que já existia nasce com a origem 'time', sem grátis e sem conta (o DEFAULT)", () => {
    expect(lastLine(sql(`select origem || '/' || gratis::text || '/' || coalesce(conta_id::text, 'sem') from public.mia_raio_x where id = '${RX_TIME}';`))).toBe(
      "time/false/sem",
    );
  });

  it("a origem é fechada, só o cadastro tem grátis, e o cadastro é pela conexão (23514)", () => {
    expect(tentar("postgres", raioX("e9152e90-2222-4000-8000-0000000000f1", "5531900001111", { origem: "'site'" }))).toBe("23514");
    expect(tentar("postgres", raioX("e9152e90-2222-4000-8000-0000000000f2", "5531900001112", { gratis: "true" }))).toBe("23514");
    expect(
      tentar(
        "postgres",
        raioX("e9152e90-2222-4000-8000-0000000000f3", "5531900001113", { origem: "'cadastro'", fonte: "'conversas_da_mia'" }),
      ),
    ).toBe("23514");
  });

  it("o criado_via aceita 'cadastro' (e continua recusando o que não conhece)", () => {
    expect(tentar("postgres", raioX("e9152e90-2222-4000-8000-0000000000f4", "5531900001114", { criado_via: "'formulario'" }))).toBe("23514");
    expect(
      tentar(
        "postgres",
        raioX(RX_GRATIS, "5531900001101", { origem: "'cadastro'", gratis: "true", criado_via: "'cadastro'", conta_id: `'${CONTA}'` }),
      ),
    ).toBe("passou");
  });

  it("⭐ uma grátis viva por conta e por número; a que fechou sem histórico não conta (23505)", () => {
    // Mesma conta, outro número.
    expect(
      tentar(
        "postgres",
        raioX("e9152e90-2222-4000-8000-0000000000f5", "5531900001177", { origem: "'cadastro'", gratis: "true", conta_id: `'${CONTA}'` }),
      ),
    ).toBe("23505");
    // Mesmo número, sem conta.
    expect(tentar("postgres", raioX("e9152e90-2222-4000-8000-0000000000f6", "5531900001101", { origem: "'cadastro'", gratis: "true" }))).toBe(
      "23505",
    );
    // A grátis fechou sem histórico: a pessoa pode cadastrar o mesmo número de novo.
    sql(`update public.mia_raio_x set sem_historico_em = now(), situacao = 'encerrado' where id = '${RX_GRATIS}';`);
    expect(
      tentar(
        "postgres",
        raioX("e9152e90-2222-4000-8000-0000000000f7", "5531900001101", { origem: "'cadastro'", gratis: "true", conta_id: `'${CONTA}'` }),
      ),
    ).toBe("passou");
    // A paga do mesmo número não é grátis: não esbarra no índice.
    expect(
      tentar("postgres", raioX("e9152e90-2222-4000-8000-0000000000f8", "5531900001101", { origem: "'cadastro'", conta_id: `'${CONTA}'` })),
    ).toBe("passou");
  });

  it("apagar a conta solta o raio-X (o relatório fica)", () => {
    sql(`
      ${conta("e9152e90-5555-4000-8000-0000000000aa", "solta@garagemmodelo.com.br")};
      ${raioX("e9152e90-2222-4000-8000-0000000000aa", "5531900001155", { origem: "'cadastro'", conta_id: "'e9152e90-5555-4000-8000-0000000000aa'" })};
      delete from public.mia_raio_x_contas where id = 'e9152e90-5555-4000-8000-0000000000aa';
    `);
    expect(lastLine(sql(`select coalesce(conta_id::text, 'solto') from public.mia_raio_x where id = 'e9152e90-2222-4000-8000-0000000000aa';`))).toBe("solto");
  });
});
