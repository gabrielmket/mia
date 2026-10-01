import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * FORK MIA (migrations 9010 e 9016) — A EMPRESA DE DEMONSTRAÇÃO NÃO MANDA NADA PARA FORA.
 *
 * O cliente modelo mora em produção, com dados fictícios. A marca
 * `organizations.demonstracao` fecha, NO BANCO, cada porta por onde um envio
 * passa antes de sair. A prova é com `postgres`, o papel sem RLS — é assim que o
 * service_role das rotas e dos workers escreve. Se a trava não segura aqui, não
 * segura em lugar nenhum.
 *
 * Cada porta tem CONTROLE: a mesma escrita, numa empresa de verdade, passa.
 * Sem o controle, um "42501" poderia vir de qualquer outra regra do schema e o
 * teste afirmaria a trava sem medi-la.
 *
 * Sem PII: nomes sintéticos, e-mails @invariant.test, telefones +5500 (DDD que
 * não existe).
 */

const DEMO = "90109010-0000-4000-8000-00000000000d";
const REAL = "90109010-0000-4000-8000-00000000000e";
const OUTRA = "90109010-0000-4000-8000-00000000000f";
const GESTOR = "90109010-1111-4000-8000-00000000000a";
const DONO_DA_PLATAFORMA = "90109010-1111-4000-8000-00000000000b";

const SESSAO_DEMO = "90109010-2222-4000-8000-00000000000d";
const SESSAO_REAL = "90109010-2222-4000-8000-00000000000e";
const CONTATO_DEMO = "90109010-3333-4000-8000-00000000000d";
const CONTATO_REAL = "90109010-3333-4000-8000-00000000000e";
const CONVERSA_DEMO = "90109010-4444-4000-8000-00000000000d";
const CONVERSA_REAL = "90109010-4444-4000-8000-00000000000e";

function linhaMarcada(saida: string, marca: string): string {
  const linha = saida.split("\n").find((l) => l.startsWith(marca));
  if (!linha) throw new Error(`saída inesperada do psql: ${saida}`);
  return linha.slice(marca.length).trim();
}

/**
 * Roda `dml` numa transação desfeita e devolve `SQLSTATE|mensagem` do erro, ou
 * `"passou"`. `antes` roda como `postgres` antes do `dml` (ex.: trocar o papel).
 */
function tentarComMensagem(dml: string, antes = ""): string {
  const saida = sql(`
    begin;
    ${antes}
    do $$
    begin
      begin
        ${dml};
        perform set_config('inv.r', 'passou', true);
      exception when others then
        perform set_config('inv.r', sqlstate || '|' || sqlerrm, true);
      end;
    end $$;
    reset role;
    select 'R:' || current_setting('inv.r');
    rollback;
  `);
  return linhaMarcada(saida, "R:");
}

const tentar = (dml: string, antes = "") => tentarComMensagem(dml, antes).split("|")[0];

/** Roda o script numa transação desfeita; a consulta final devolve `'M:' || valor`. */
function medir(script: string): string {
  return linhaMarcada(sql(`begin;\n${script}\nrollback;`), "M:");
}

const comoCliente = (user: string) => `
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true);
`;

function empresa(org: string, tag: string, demonstracao: boolean): string {
  return `
    insert into public.organizations (id, slug, legal_name, display_name, demonstracao)
      values ('${org}', 'mia-9010-${tag}', 'MIA 9010 ${tag}', 'MIA 9010 ${tag}', ${demonstracao})
      on conflict (id) do nothing;
  `;
}

function sessao(id: string, org: string, arquivada: boolean): string {
  return `
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted, status, archived_at)
      values ('${id}', '${org}', 'mia-9010-${id.slice(-4)}', '\\x00'::bytea, 'STOPPED', ${arquivada ? "now()" : "null"})
      on conflict (id) do nothing;
  `;
}

/** Uma conta Microsoft (agenda do Outlook, 9011) no estado pedido. */
const contaMicrosoft = (org: string, status: string) =>
  `insert into public.mia_agenda_microsoft_conexoes (organization_id, user_id, conta_email, microsoft_user_id, status)
     values ('${org}', '${GESTOR}', 'outlook-9016@invariant.test', 'ms-9016-${org.slice(-1)}', '${status}')`;

const mensagem = (org: string, conversa: string, sessao: string, contato: string, status: string, direcao = "outbound") =>
  `insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, body, sent_via)
     values ('${org}', '${conversa}', '${sessao}', '${contato}', 'text', '${direcao}', '${status}', 'teste', 'user')`;

beforeAll(() => {
  // A sessão da demonstração nasce ARQUIVADA: é a única que a trava deixa existir.
  sql(
    empresa(DEMO, "demo", true) +
      empresa(REAL, "real", false) +
      empresa(OUTRA, "outra", false) +
      sessao(SESSAO_DEMO, DEMO, true) +
      sessao(SESSAO_REAL, REAL, false) +
      `
      insert into auth.users (id, email) values
        ('${GESTOR}', 'mia-9010-gestor@invariant.test'),
        ('${DONO_DA_PLATAFORMA}', 'mia-9010-plataforma@invariant.test')
        on conflict (id) do nothing;
      insert into public.platform_admins (user_id, granted_by, reason)
        values ('${DONO_DA_PLATAFORMA}', '${DONO_DA_PLATAFORMA}', 'invariante 9010')
        on conflict do nothing;
      insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
        ('${GESTOR}', '${DEMO}', 'admin', now()),
        ('${GESTOR}', '${REAL}', 'admin', now())
        on conflict do nothing;
      insert into public.contacts (id, organization_id, name, phone_number) values
        ('${CONTATO_DEMO}', '${DEMO}', 'Contato Demo', '+5500900000901'),
        ('${CONTATO_REAL}', '${REAL}', 'Contato Real', '+5500900000902')
        on conflict (id) do nothing;
      insert into public.conversations (id, organization_id, contact_id, channel_session_id) values
        ('${CONVERSA_DEMO}', '${DEMO}', '${CONTATO_DEMO}', '${SESSAO_DEMO}'),
        ('${CONVERSA_REAL}', '${REAL}', '${CONTATO_REAL}', '${SESSAO_REAL}')
        on conflict (id) do nothing;
    `,
  );
});

describe("a fila de mensagens: nenhuma mensagem de saída nasce na demonstração", () => {
  it("⭐ mensagem de saída em fila (a porta de UI, agente, follow-up, campanha…) é recusada", () => {
    const r = tentarComMensagem(mensagem(DEMO, CONVERSA_DEMO, SESSAO_DEMO, CONTATO_DEMO, "queued"));
    expect(r.split("|")[0]).toBe("42501");
    expect(r).toContain("organizacao_de_demonstracao");
  });

  it("⭐ nem direto como `sending`", () => {
    expect(tentar(mensagem(DEMO, CONVERSA_DEMO, SESSAO_DEMO, CONTATO_DEMO, "sending"))).toBe("42501");
  });

  it("controle: a mesma mensagem na empresa de verdade passa", () => {
    expect(tentar(mensagem(REAL, CONVERSA_REAL, SESSAO_REAL, CONTATO_REAL, "queued"))).toBe("passou");
  });

  it("o HISTÓRICO fictício entra: saída já entregue e entrada do cliente (é o que a semente grava)", () => {
    expect(tentar(mensagem(DEMO, CONVERSA_DEMO, SESSAO_DEMO, CONTATO_DEMO, "read"))).toBe("passou");
    expect(
      tentar(mensagem(DEMO, CONVERSA_DEMO, SESSAO_DEMO, CONTATO_DEMO, "received", "inbound")),
    ).toBe("passou");
  });

  it("⭐ promover uma mensagem de volta para a fila vira `failed`, sem abortar o lote", () => {
    const r = medir(`
      ${mensagem(DEMO, CONVERSA_DEMO, SESSAO_DEMO, CONTATO_DEMO, "failed")};
      ${mensagem(REAL, CONVERSA_REAL, SESSAO_REAL, CONTATO_REAL, "failed")};
      update public.messages set status = 'queued'
       where organization_id in ('${DEMO}', '${REAL}') and status = 'failed';
      select 'M:' || string_agg(
        case organization_id when '${DEMO}' then 'demo' else 'real' end
          || '=' || status || '/' || coalesce(error_code, '-'), ',' order by organization_id)
        from public.messages
       where organization_id in ('${DEMO}', '${REAL}') and direction = 'outbound' and body = 'teste';
    `);
    expect(r).toBe("demo=failed/organizacao_de_demonstracao,real=queued/-");
  });
});

describe("o número: a demonstração não tem WhatsApp vivo", () => {
  it("⭐ conectar um número é recusado", () => {
    expect(tentar(sessao("90109010-2222-4000-8000-0000000000aa", DEMO, false).replace(/;\s*$/, ""))).toBe(
      "42501",
    );
  });

  it("⭐ desarquivar a sessão fictícia é recusado", () => {
    expect(
      tentar(`update public.channel_sessions set archived_at = null where id = '${SESSAO_DEMO}'`),
    ).toBe("42501");
  });

  it("controle: a empresa de verdade conecta", () => {
    expect(tentar(sessao("90109010-2222-4000-8000-0000000000bb", REAL, false).replace(/;\s*$/, ""))).toBe(
      "passou",
    );
  });
});

describe("o que dispara sozinho não sai do rascunho", () => {
  const campanha = (org: string, sessaoId: string, status: string) =>
    `insert into public.campaigns (organization_id, name, status, channel_session_id, base_legal)
       values ('${org}', 'Campanha 9010', '${status}', '${sessaoId}', 'consent')`;

  it("⭐ campanha agendada ou enviando é recusada; rascunho entra", () => {
    expect(tentar(campanha(DEMO, SESSAO_DEMO, "draft"))).toBe("passou");
    expect(tentar(campanha(DEMO, SESSAO_DEMO, "scheduled"))).toBe("42501");
    expect(tentar(campanha(DEMO, SESSAO_DEMO, "running"))).toBe("42501");
    expect(
      tentar(`${campanha(DEMO, SESSAO_DEMO, "draft")};
              update public.campaigns set status = 'running' where organization_id = '${DEMO}'`),
    ).toBe("42501");
  });

  it("controle: a empresa de verdade agenda", () => {
    expect(tentar(campanha(REAL, SESSAO_REAL, "scheduled"))).toBe("passou");
  });

  const broadcast = (org: string, status: string) =>
    `insert into public.broadcasts (organization_id, nome, template_name, template_language, status)
       values ('${org}', 'Broadcast 9010', 'modelo_9010', 'pt_BR', '${status}')`;

  it("⭐ broadcast agendado ou enviando é recusado; rascunho entra", () => {
    expect(tentar(broadcast(DEMO, "rascunho"))).toBe("passou");
    expect(tentar(broadcast(DEMO, "agendada"))).toBe("42501");
    expect(tentar(broadcast(DEMO, "enviando"))).toBe("42501");
  });

  it("controle: a empresa de verdade dispara", () => {
    expect(tentar(broadcast(REAL, "enviando"))).toBe("passou");
  });

  const regra = (org: string, ativa: boolean, tipo: string) =>
    `insert into public.automation_rules (organization_id, name, trigger_event, actions, is_active)
       values ('${org}', 'Regra 9010 ${tipo}', 'lead.created',
               '[{"type":"${tipo}","config":{}}]'::jsonb, ${ativa})`;

  it("⭐ regra ativa com webhook ou aviso no grupo é recusada", () => {
    expect(tentar(regra(DEMO, true, "call_webhook"))).toBe("42501");
    expect(tentar(regra(DEMO, true, "notify_group"))).toBe("42501");
  });

  it("a regra interna fica ativa, e a de webhook pode existir desligada", () => {
    expect(tentar(regra(DEMO, true, "create_task"))).toBe("passou");
    expect(tentar(regra(DEMO, false, "call_webhook"))).toBe("passou");
    expect(
      tentar(`${regra(DEMO, false, "call_webhook")};
              update public.automation_rules set is_active = true where organization_id = '${DEMO}'`),
    ).toBe("42501");
  });

  it("controle: a empresa de verdade liga o webhook", () => {
    expect(tentar(regra(REAL, true, "call_webhook"))).toBe("passou");
  });
});

describe("os destinos de fora não existem na demonstração", () => {
  const casos: { nome: string; dml: (org: string) => string }[] = [
    {
      // Com canal: sem ele, o `trg_aviso_de_caso_coerente` do upstream já
      // desliga o aviso sozinho, e a trava não seria medida.
      nome: "aviso de caso ligado",
      dml: (org) =>
        `insert into public.config_aviso_de_caso (organization_id, channel_session_id, telefone_destino, ligado)
           values ('${org}', '${org === DEMO ? SESSAO_DEMO : SESSAO_REAL}', '+5500900000903', true)`,
    },
    {
      nome: "conversões para a Meta",
      dml: (org) =>
        `insert into public.ad_platform_connections (organization_id, platform, enabled)
           values ('${org}', 'meta_ads', true)`,
    },
    {
      nome: "agenda externa",
      dml: (org) =>
        `insert into public.calendar_connections (organization_id, user_id, account_email)
           values ('${org}', '${GESTOR}', 'agenda-9010@invariant.test')`,
    },
    {
      // 9016: a agenda do Outlook tem tabela própria de conexões, que a 9010 não
      // conhecia. Conta viva = evento publicado com o e-mail do contato como
      // participante (convite da Microsoft) e reunião do Teams.
      nome: "agenda do Outlook (convite da Microsoft e reunião do Teams)",
      dml: (org) => contaMicrosoft(org, "healthy"),
    },
    {
      nome: "notificação push",
      dml: (org) =>
        `insert into public.push_subscriptions (organization_id, user_id, endpoint, p256dh, auth)
           values ('${org}', '${GESTOR}', 'https://push.invalid/9010-${org.slice(-1)}', 'p', 'a')`,
    },
    {
      nome: "ligação pelo WhatsApp",
      dml: (org) => `insert into public.org_voice_calls (organization_id, enabled) values ('${org}', true)`,
    },
    {
      nome: "tronco SIP",
      dml: (org) =>
        `insert into public.voip_trunk_settings
           (organization_id, host, username, password_encrypted, password_iv, password_tag, password_last4, endpoint_name, is_active)
         values ('${org}', 'sip.invalid', 'u', '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, '0000', 'e9010${org.slice(-1)}', true)`,
    },
    {
      nome: "convite de equipe (é e-mail)",
      dml: (org) =>
        `insert into public.team_invites (organization_id, email, role, expires_at)
           values ('${org}', 'convite-9010@invariant.test', 'agent', now() + interval '7 days')`,
    },
  ];

  for (const caso of casos) {
    it(`⭐ ${caso.nome}: recusado na demonstração, aceito na empresa de verdade`, () => {
      const r = tentarComMensagem(caso.dml(DEMO));
      expect(r.split("|")[0], r).toBe("42501");
      expect(r).toContain("organizacao_de_demonstracao");
      expect(tentar(caso.dml(REAL))).toBe("passou");
    });
  }

  it("desligado, o destino pode existir (a conexão de conversões sem envio, o aviso de caso sem ligar)", () => {
    expect(
      tentar(`insert into public.ad_platform_connections (organization_id, platform, enabled)
                values ('${DEMO}', 'google_ads', false)`),
    ).toBe("passou");
    expect(
      tentar(`insert into public.config_aviso_de_caso (organization_id, telefone_destino, ligado)
                values ('${DEMO}', '+5500900000904', false)`),
    ).toBe("passou");
  });

  it("⭐ a conta Microsoft desconectada (sem token) pode existir na demonstração, e não revive", () => {
    // O mesmo desenho do número arquivado: o estado morto existe, o vivo não.
    expect(tentar(contaMicrosoft(DEMO, "disconnected"))).toBe("passou");
    for (const vivo of ["connecting", "healthy", "token_expired", "error"]) {
      const r = tentarComMensagem(
        `update public.mia_agenda_microsoft_conexoes set status = '${vivo}' where organization_id = '${DEMO}'`,
        `${contaMicrosoft(DEMO, "disconnected")};`,
      );
      expect(r.split("|")[0], `${vivo}: ${r}`).toBe("42501");
      expect(r).toContain("organizacao_de_demonstracao: agenda do Outlook conectada");
    }
    // Controle: na empresa de verdade a conta desconectada reconecta.
    expect(
      tentar(
        `update public.mia_agenda_microsoft_conexoes set status = 'healthy' where organization_id = '${REAL}'`,
        `${contaMicrosoft(REAL, "disconnected")};`,
      ),
    ).toBe("passou");
  });

  it("⭐ grupo de avisos no WhatsApp: recusado na demonstração, aceito na empresa de verdade", () => {
    const grupo = `jsonb_build_object('grupo_de_avisos', jsonb_build_object('id', '120363000000009010@g.us', 'nome', 'Avisos'))`;
    expect(tentar(`update public.organizations set settings = settings || ${grupo} where id = '${DEMO}'`)).toBe(
      "42501",
    );
    expect(tentar(`update public.organizations set settings = settings || ${grupo} where id = '${REAL}'`)).toBe(
      "passou",
    );
  });
});

describe("a marca: só a plataforma muda, e ela não convive com destino vivo", () => {
  /**
   * O cliente logado não escreve em `organizations` pela REST (a RLS só deixa o
   * admin da plataforma). O caminho que sobra é uma função `security definer`
   * chamada pela sessão dele — que roda como `postgres` e passaria pela RLS. É
   * esse caminho que a regra da marca fecha, e é ele que se mede aqui.
   */
  const pelaRpc = (org: string, valor: boolean) =>
    medir(`
      create function public.inv_9010_mudar_marca(p uuid, v boolean) returns void
        language sql security definer set search_path = public as
        $f$ update public.organizations set demonstracao = v where id = p $f$;
      grant execute on function public.inv_9010_mudar_marca(uuid, boolean) to authenticated;
      ${comoCliente(GESTOR)}
      do $$
      begin
        begin
          perform public.inv_9010_mudar_marca('${org}', ${valor});
          perform set_config('inv.r', 'passou', true);
        exception when others then
          perform set_config('inv.r', sqlstate, true);
        end;
      end $$;
      reset role;
      select 'M:' || current_setting('inv.r');
    `);

  it("⭐ o cliente, por uma função definer, não desmarca a demonstração nem marca a empresa dele", () => {
    expect(pelaRpc(DEMO, false)).toBe("42501");
    expect(pelaRpc(REAL, true)).toBe("42501");
  });

  it("o admin da plataforma logado desmarca pela REST (controle da regra acima)", () => {
    expect(
      medir(`
        ${comoCliente(DONO_DA_PLATAFORMA)}
        update public.organizations set demonstracao = false where id = '${DEMO}';
        reset role;
        select 'M:' || demonstracao::text from public.organizations where id = '${DEMO}';
      `),
    ).toBe("false");
  });

  it("⭐ marcar uma empresa com número vivo é recusado, e a recusa diz o que desligar", () => {
    const r = tentarComMensagem(`update public.organizations set demonstracao = true where id = '${REAL}'`);
    expect(r.split("|")[0]).toBe("42501");
    expect(r).toContain("numero de WhatsApp conectado");
  });

  it("⭐ marcar uma empresa com conta Microsoft viva é recusado; desconectada, a marcação passa (9016)", () => {
    // OUTRA não tem número nem outro destino vivo: a recusa só pode vir da 9016.
    const marcar = `update public.organizations set demonstracao = true where id = '${OUTRA}'`;
    const r = tentarComMensagem(marcar, `${contaMicrosoft(OUTRA, "healthy")};`);
    expect(r.split("|")[0], r).toBe("42501");
    expect(r).toContain("organizacao_de_demonstracao: a empresa ainda tem destino vivo (agenda do Outlook conectada)");
    expect(tentar(marcar, `${contaMicrosoft(OUTRA, "disconnected")};`)).toBe("passou");
    expect(tentar(marcar)).toBe("passou");
  });

  it("⭐ ao marcar, a fila de saída vira `failed`, o push some e o convite pendente é revogado", () => {
    const sessaoOutra = "90109010-2222-4000-8000-00000000000f";
    const contatoOutra = "90109010-3333-4000-8000-00000000000f";
    const conversaOutra = "90109010-4444-4000-8000-00000000000f";
    const r = medir(`
      ${sessao(sessaoOutra, OUTRA, false)}
      insert into public.contacts (id, organization_id, name) values ('${contatoOutra}', '${OUTRA}', 'Contato Outra');
      insert into public.conversations (id, organization_id, contact_id, channel_session_id)
        values ('${conversaOutra}', '${OUTRA}', '${contatoOutra}', '${sessaoOutra}');
      ${mensagem(OUTRA, conversaOutra, sessaoOutra, contatoOutra, "queued")};
      insert into public.push_subscriptions (organization_id, user_id, endpoint, p256dh, auth)
        values ('${OUTRA}', '${GESTOR}', 'https://push.invalid/9010-outra', 'p', 'a');
      insert into public.team_invites (organization_id, email, role, expires_at)
        values ('${OUTRA}', 'convite-outra-9010@invariant.test', 'agent', now() + interval '7 days');
      -- o número precisa sair antes: sem isso a marcação é recusada (caso acima)
      update public.channel_sessions set archived_at = now() where id = '${sessaoOutra}';
      update public.organizations set demonstracao = true where id = '${OUTRA}';
      select 'M:' ||
        (select status || '/' || error_code from public.messages where conversation_id = '${conversaOutra}') || ',' ||
        (select count(*)::text from public.push_subscriptions where organization_id = '${OUTRA}') || ',' ||
        (select (revoked_at is not null)::text from public.team_invites where organization_id = '${OUTRA}');
    `);
    expect(r).toBe("failed/organizacao_de_demonstracao,0,true");
  });

  it("a pergunta `fn_mia_e_demonstracao` responde, e só o service_role a executa", () => {
    expect(
      medir(`select 'M:' || public.fn_mia_e_demonstracao('${DEMO}')::text || ',' || public.fn_mia_e_demonstracao('${REAL}')::text;`),
    ).toBe("true,false");
    expect(
      medir(`select 'M:' ||
        has_function_privilege('anon', 'public.fn_mia_e_demonstracao(uuid)', 'EXECUTE')::text || ',' ||
        has_function_privilege('authenticated', 'public.fn_mia_e_demonstracao(uuid)', 'EXECUTE')::text || ',' ||
        has_function_privilege('service_role', 'public.fn_mia_e_demonstracao(uuid)', 'EXECUTE')::text;`),
    ).toBe("false,false,true");
  });
});
