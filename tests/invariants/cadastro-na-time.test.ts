import { beforeAll, describe, expect, it } from "vitest";

import { criarOrg, criarUsuarios } from "./cobranca-helpers";
import { lastLine, sql } from "./gov-helpers";

/**
 * FORK MIA (9169, MIA-168) · O CADASTRO NO CRM DA TIME, NO BANCO
 * (docs/fork/jornada-de-assinatura.md, "O lead do cadastro").
 *
 * Contra o Postgres de verdade:
 *   - `mia_cadastro_na_time` é só do servidor: RLS ligada com ZERO políticas, o
 *     administrador da própria empresa e anon recebem permission denied (42501),
 *     o service_role grava e lê (controle positivo);
 *   - as travas: `fbp`/`fbc` só com `consentimento = medicao`, o consentimento
 *     só nos dois valores, uma linha por conta, lead sem org recusado;
 *   - o gatilho depois do insert em `mia_origem_da_empresa`: a empresa do
 *     cadastro emite `mia.cadastro.empresa_nasceu` (uma vez), a de implantação não;
 *   - a limpeza da LGPD zera IP, navegador, fbp, fbc e os ids de clique passado o
 *     `guardar_ate` ou 7 dias depois do pagamento, e não toca a linha nova; só o
 *     servidor executa.
 */

const DONO = "91699169-1111-4000-8000-0000000000a1";
const CONTA_VENCIDA = "91699169-1111-4000-8000-0000000000a2";
const CONTA_PAGA = "91699169-1111-4000-8000-0000000000a3";
const CONTA_NOVA = "91699169-1111-4000-8000-0000000000a4";
const ORG_CADASTRO = "91699169-0000-4000-8000-00000000000a";
const ORG_IMPLANTACAO = "91699169-0000-4000-8000-00000000000b";

/** Um comando como `usuario` (`anon`, `servidor` ou o uuid de alguém): a última linha, ou o SQLSTATE. */
function como(usuario: string, comando: string): string {
  const papel = usuario === "anon" ? "anon" : usuario === "servidor" ? "service_role" : "authenticated";
  const claims = papel === "authenticated" ? `select set_config('request.jwt.claims', '{"sub":"${usuario}","role":"authenticated"}', false);` : "";
  return lastLine(
    sql(`
      set role ${papel};
      ${claims}
      do $$
      declare r text;
      begin
        begin
          execute $q$ ${comando} $q$ into r;
          perform set_config('inv.r9169', coalesce(r, '<null>'), false);
        exception when others then
          perform set_config('inv.r9169', 'erro:' || sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9169');
    `),
  );
}

const eventos = (org: string) =>
  lastLine(sql(`select count(*) from public.event_log where organization_id = '${org}' and event_type = 'mia.cadastro.empresa_nasceu';`));

beforeAll(() => {
  // Sem PII real: e-mails sintéticos (LGPD); IP da faixa de documentação (RFC 5737).
  criarUsuarios([
    [DONO, "cadastro-na-time-dono@invariant.test"],
    [CONTA_VENCIDA, "cadastro-na-time-vencida@invariant.test"],
    [CONTA_PAGA, "cadastro-na-time-paga@invariant.test"],
    [CONTA_NOVA, "cadastro-na-time-nova@invariant.test"],
  ]);
  // Com dono que não é da plataforma, a origem é `cadastro` (9071); sem dono, `implantacao`.
  criarOrg(ORG_CADASTRO, "cadastro-na-time-cliente", DONO);
  criarOrg(ORG_IMPLANTACAO, "cadastro-na-time-implantada", null);
  sql(`insert into public.user_organizations (user_id, organization_id, role, accepted_at)
         values ('${DONO}', '${ORG_CADASTRO}', 'admin', now()) on conflict do nothing;`);
  sql(`
    set role service_role;
    insert into public.mia_cadastro_na_time (user_id, ip, navegador, fbp, fbc, gclid, consentimento, pagina, origem, guardar_ate)
      values ('${CONTA_VENCIDA}', '203.0.113.7', 'Mozilla/5.0 (inv)', 'fb.1.1.1', 'fb.1.1.abc', 'gclid-inv', 'medicao',
              'https://app.exemplo.test/signup', '{"utm_source":"google","fbclid":"fbclid-inv"}', now() - interval '1 day')
      on conflict (user_id) do nothing;
    insert into public.mia_cadastro_na_time (user_id, ip, navegador, gclid, consentimento, pagamento_confirmado_em, valor_cents)
      values ('${CONTA_PAGA}', '203.0.113.8', 'Mozilla/5.0 (inv)', 'gclid-inv-2', 'necessario', now() - interval '8 days', 9900)
      on conflict (user_id) do nothing;
    insert into public.mia_cadastro_na_time (user_id, ip, navegador, gclid, consentimento)
      values ('${CONTA_NOVA}', '203.0.113.9', 'Mozilla/5.0 (inv)', 'gclid-inv-3', 'medicao')
      on conflict (user_id) do nothing;
  `);
});

describe("9169: só o servidor", () => {
  it("⭐ o administrador da própria empresa e anon recebem permission denied; o servidor lê", () => {
    expect(como(DONO, `select count(*)::text from public.mia_cadastro_na_time`)).toBe("erro:42501");
    expect(como("anon", `select count(*)::text from public.mia_cadastro_na_time`)).toBe("erro:42501");
    expect(como(DONO, `insert into public.mia_cadastro_na_time (user_id) values ('${DONO}') returning 'ok'`)).toBe("erro:42501");
    expect(como("servidor", `select host(ip) from public.mia_cadastro_na_time where user_id = '${CONTA_NOVA}'`)).toBe("203.0.113.9");
    expect(lastLine(sql(`select count(*) from pg_policies where schemaname = 'public' and tablename = 'mia_cadastro_na_time';`))).toBe("0");
    expect(lastLine(sql(`select relrowsecurity::text from pg_class where oid = 'public.mia_cadastro_na_time'::regclass;`))).toBe("true");
  });
});

describe("9169: as travas", () => {
  it("⭐ fbp e fbc só com consentimento = medicao", () => {
    expect(
      como("servidor", `update public.mia_cadastro_na_time set fbp = 'fb.1.1.1' where user_id = '${CONTA_PAGA}' returning 'ok'`),
    ).toBe("erro:23514");
    expect(
      como("servidor", `update public.mia_cadastro_na_time set consentimento = 'tudo' where user_id = '${CONTA_NOVA}' returning 'ok'`),
    ).toBe("erro:23514");
  });

  it("uma linha por conta; lead sem a org da Time é recusado", () => {
    expect(como("servidor", `insert into public.mia_cadastro_na_time (user_id) values ('${CONTA_NOVA}') returning 'ok'`)).toBe("erro:23505");
    expect(
      como("servidor", `update public.mia_cadastro_na_time set lead_id = gen_random_uuid() where user_id = '${CONTA_NOVA}' returning 'ok'`),
    ).toMatch(/^erro:(23514|23503)$/);
  });
});

describe("9169: o gatilho do nascimento", () => {
  it("⭐ a empresa do cadastro emite mia.cadastro.empresa_nasceu uma vez; a de implantação, nenhuma", () => {
    expect(lastLine(sql(`select origem from public.mia_origem_da_empresa where organization_id = '${ORG_CADASTRO}';`))).toBe("cadastro");
    expect(eventos(ORG_CADASTRO)).toBe("1");
    expect(eventos(ORG_IMPLANTACAO)).toBe("0");
    expect(
      lastLine(sql(`select payload->>'organization_id' from public.event_log where organization_id = '${ORG_CADASTRO}' and event_type = 'mia.cadastro.empresa_nasceu';`)),
    ).toBe(ORG_CADASTRO);
  });

  it("a função do gatilho não é da sessão", () => {
    expect(lastLine(sql(`select has_function_privilege('authenticated', 'public.fn_mia_cadastro_empresa_nasceu()', 'execute')::text;`))).toBe("false");
    expect(lastLine(sql(`select has_function_privilege('anon', 'public.fn_mia_cadastro_empresa_nasceu()', 'execute')::text;`))).toBe("false");
  });
});

describe("9169: a limpeza da LGPD", () => {
  it("⭐ só o servidor executa", () => {
    expect(como(DONO, `select public.fn_mia_cadastro_na_time_limpar()::text`)).toBe("erro:42501");
    expect(como("anon", `select public.fn_mia_cadastro_na_time_limpar()::text`)).toBe("erro:42501");
  });

  it("⭐ zera o que identifica passado o prazo ou 7 dias depois do pagamento; a linha nova fica; repetir não limpa de novo", () => {
    expect(como("servidor", `select public.fn_mia_cadastro_na_time_limpar()::text`)).toBe("2");
    const vencida = lastLine(
      sql(`select concat_ws('|', coalesce(host(ip), '-'), coalesce(navegador, '-'), coalesce(fbp, '-'), coalesce(fbc, '-'), coalesce(gclid, '-'),
                  coalesce(origem->>'fbclid', '-'), origem->>'utm_source', (limpo_em is not null)::text)
             from public.mia_cadastro_na_time where user_id = '${CONTA_VENCIDA}';`),
    );
    expect(vencida).toBe("-|-|-|-|-|-|google|true");
    const paga = lastLine(
      sql(`select concat_ws('|', coalesce(host(ip), '-'), coalesce(gclid, '-'), valor_cents::text, (pagamento_confirmado_em is not null)::text)
             from public.mia_cadastro_na_time where user_id = '${CONTA_PAGA}';`),
    );
    expect(paga).toBe("-|-|9900|true");
    expect(lastLine(sql(`select concat_ws('|', host(ip), gclid, (limpo_em is null)::text) from public.mia_cadastro_na_time where user_id = '${CONTA_NOVA}';`))).toBe(
      "203.0.113.9|gclid-inv-3|true",
    );
    expect(como("servidor", `select public.fn_mia_cadastro_na_time_limpar()::text`)).toBe("0");
  });
});
