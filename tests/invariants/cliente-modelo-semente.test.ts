import { execFileSync } from "node:child_process";
import path from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  aplicarSemente,
  CONSUMIDOR_DA_SEMENTE,
  contarDaSemente,
  gerarSqlDaSemente,
  ID_DA_EMPRESA,
  type ResumoDaSemente,
} from "@/lib/demonstracao/semente/aplicar";
import { FUNIS, OBRIGACOES } from "@/lib/demonstracao/semente/dados";
import { diaNoFuso } from "@/lib/obrigacoes/datas";
import { contarObrigacoes, situacao } from "@/lib/obrigacoes/situacao";
import type { ItemParaSituacao } from "@/lib/obrigacoes/tipos";

/**
 * FORK MIA (cliente modelo, 9010) — A SEMENTE RODA DUAS VEZES E NÃO DUPLICA.
 *
 * Roda a semente de verdade (`aplicarSemente`, a mesma que o
 * `scripts/cliente-modelo.ts` chama) contra o Postgres descartável, com o
 * baseline + baseline-mia aplicados — portanto COM a trava da 9010 de pé e
 * todos os gatilhos do produto disparando.
 *
 * O que se mede:
 *   1. a segunda rodada termina com as MESMAS contagens da primeira;
 *   2. a empresa nasce marcada, com o número arquivado e nada em fila;
 *   3. o que o pedido do Gabriel lista está lá: funis com todas as etapas
 *      ocupadas, motivos de perda e campos, contatos com e sem empresa, empresa
 *      com várias pessoas, as cinco origens, conversa com qualificação e
 *      passagem, follow-up andando, agenda passada e futura, tarefas;
 *   4. os eventos que a carga emitiu não viram trabalho para os workers;
 *   5. telefone e e-mail são os falsos.
 */

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 2,
});

const AGORA = new Date("2026-09-30T15:00:00.000Z");
let primeira: ResumoDaSemente;
let segunda: ResumoDaSemente;

async function valor<T = string>(sql: string, params: unknown[] = [ID_DA_EMPRESA]): Promise<T> {
  const { rows } = await pool.query(sql, params);
  return Object.values(rows[0] ?? {})[0] as T;
}

beforeAll(async () => {
  // Um usuário que JÁ existe na instalação, para o acesso por e-mail.
  await pool.query(
    `insert into auth.users (id, email) values ('90109010-5555-4000-8000-000000000001', 'quem-mostra@invariant.test')
       on conflict (id) do nothing`,
  );
  const c1 = await pool.connect();
  try {
    primeira = await aplicarSemente(c1, {
      agora: AGORA,
      emailsDeAcesso: ["quem-mostra@invariant.test", "nao-existe@invariant.test"],
    });
  } finally {
    c1.release();
  }
  const c2 = await pool.connect();
  try {
    segunda = await aplicarSemente(c2, { agora: new Date(AGORA.getTime() + 2 * 86_400_000) });
  } finally {
    c2.release();
  }
}, 120_000);

afterAll(async () => {
  await pool.end();
});

/**
 * O MODO `--sql`: o SQL gerado, sem conexão, aplicado por psql num banco NOVO
 * (cópia do molde com o baseline) — é o caminho do `/pg/query` do postgres-meta
 * em produção, que recebe um texto e executa.
 */
describe("o SQL gerado (`--sql`)", () => {
  const container = process.env.TEST_DB_CONTAINER!;
  const molde = process.env.TEST_DB_TEMPLATE!;

  function psql(banco: string, script: string): string {
    return execFileSync(
      "docker",
      ["exec", "-i", container, "psql", "-U", "postgres", "-d", banco, "-v", "ON_ERROR_STOP=1", "-qtA", "-f", "-"],
      { input: script, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
  }

  async function gerar(): Promise<string> {
    return gerarSqlDaSemente({
      agora: AGORA,
      emailsDeAcesso: ["quem-mostra@invariant.test", "nao-existe@invariant.test"],
    });
  }

  it("⭐ aplicado DUAS vezes, dá as MESMAS contagens do modo conectado", async () => {
    psql("template1", `drop database if exists semente_sql with (force); create database semente_sql template ${molde};`);
    psql(
      "semente_sql",
      `insert into auth.users (id, email) values ('90109010-5555-4000-8000-000000000001', 'quem-mostra@invariant.test');`,
    );
    const texto = await gerar();
    psql("semente_sql", texto);
    const outra = new pg.Pool({
      connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/semente_sql`,
      max: 1,
    });
    try {
      const depoisDaPrimeira = await contarDaSemente(outra);
      psql("semente_sql", await gerar());
      const depoisDaSegunda = await contarDaSemente(outra);
      expect(depoisDaPrimeira).toEqual(primeira.contagens);
      expect(depoisDaSegunda).toEqual(primeira.contagens);

      const { rows } = await outra.query<{ marca: boolean; pendentes: string; acesso: string | null }>(
        `select o.demonstracao as marca,
                (select count(*)::text from public.event_log e where e.organization_id = o.id and e.status in ('pending', 'processing')) as pendentes,
                (select m.role from public.user_organizations m
                  where m.organization_id = o.id and m.user_id = '90109010-5555-4000-8000-000000000001') as acesso
           from public.organizations o where o.id = $1`,
        [ID_DA_EMPRESA],
      );
      expect(rows[0]).toEqual({ marca: true, pendentes: "0", acesso: "admin" });
    } finally {
      await outra.end();
      psql("template1", "drop database if exists semente_sql with (force);");
    }
  }, 180_000);

  it("é UMA transação, sem segredo: começa em `begin;`, termina em `commit;`, não leva senha nem chave", async () => {
    const texto = await gerar();
    const comandos = texto.split("\n\n").filter((l) => !l.startsWith("--"));
    expect(comandos[0]).toBe("begin;");
    expect(comandos.filter((c) => c.trim() === "commit;")).toHaveLength(1);
    expect(texto.trimEnd().endsWith("commit;")).toBe(true);
    expect(texto).not.toMatch(/postgres(ql)?:\/\/|service_role|eyJhbGci|password=/i);
    expect(texto, "sobrou parâmetro sem valor").not.toMatch(/\$\d+\b/);
  });

  it("⭐ sem a migration 9010 o script ABORTA antes de gravar qualquer coisa", async () => {
    psql("template1", "drop database if exists semente_sem_9010 with (force); create database semente_sem_9010;");
    try {
      let erro = "";
      try {
        psql("semente_sem_9010", await gerar());
      } catch (e) {
        erro = String((e as { stderr?: string }).stderr ?? e);
      }
      expect(erro).toContain("nao tem a migration 9010");
      expect(psql("semente_sem_9010", "select count(*) from information_schema.tables where table_schema = 'public';").trim()).toBe("0");
    } finally {
      psql("template1", "drop database if exists semente_sem_9010 with (force);");
    }
  });
});

describe("idempotência", () => {
  it("⭐ a segunda rodada termina com as mesmas contagens da primeira", () => {
    expect(segunda.contagens).toEqual(primeira.contagens);
  });

  it("e as contagens não são zero (a comparação acima não é entre dois vazios)", () => {
    for (const tabela of ["contacts", "crm_leads", "messages", "followup_enrollments", "calendar_appointments"]) {
      expect(primeira.contagens[tabela], tabela).toBeGreaterThan(0);
    }
  });

  it("uma empresa só com o slug da semente", async () => {
    expect(await valor<string>(`select count(*)::text from public.organizations where slug = 'empresa-modelo-demonstracao'`, [])).toBe("1");
  });

  it("a segunda rodada renovou as datas: o compromisso de amanhã continua no futuro", async () => {
    expect(
      await valor<boolean>(
        `select bool_and(starts_at > $2) from public.calendar_appointments
          where organization_id = $1 and status in ('confirmed', 'pending')`,
        [ID_DA_EMPRESA, new Date(AGORA.getTime() + 2 * 86_400_000)],
      ),
    ).toBe(true);
  });
});

describe("o script de linha de comando", () => {
  it("⭐ `scripts/cliente-modelo.ts --aplicar` grava pelo banco da variável de ambiente, e a terceira rodada não duplica", () => {
    const saida = execFileSync(
      process.execPath,
      [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/cliente-modelo.ts", "--aplicar"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CLIENTE_MODELO_DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
        },
      },
    );
    expect(saida).toContain(ID_DA_EMPRESA);
    for (const [tabela, n] of Object.entries(primeira.contagens)) {
      expect(saida, tabela).toMatch(new RegExp(String.raw`${tabela}\s+${n}\b`));
    }
  }, 120_000);

  it("sem --aplicar não grava nada: só diz qual é o alvo", () => {
    const saida = execFileSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/cliente-modelo.ts"], {
      encoding: "utf8",
      env: { ...process.env, CLIENTE_MODELO_DATABASE_URL: "postgresql://ninguem:x@127.0.0.1:1/nada" },
    });
    expect(saida).toContain("Nada foi gravado");
  });
});

describe("a empresa nasce travada", () => {
  it("⭐ marcada como demonstração, ativa e com onboarding feito", async () => {
    expect(
      await valor(`select demonstracao::text || ',' || status || ',' || (onboarded_at is not null)::text
                     from public.organizations where id = $1`),
    ).toBe("true,active,true");
  });

  it("⭐ o único número é arquivado, e nenhuma mensagem de saída está em fila", async () => {
    expect(await valor(`select count(*)::text from public.channel_sessions where organization_id = $1 and archived_at is null`)).toBe("0");
    expect(
      await valor(`select count(*)::text from public.messages
                    where organization_id = $1 and direction = 'outbound' and status in ('queued', 'sending')`),
    ).toBe("0");
  });

  it("⭐ e continua travada depois da semente: enfileirar saída é recusado", async () => {
    const conversa = await valor(`select id::text from public.conversations where organization_id = $1 limit 1`);
    const erro = await pool
      .query(
        `insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, body)
         select organization_id, id, channel_session_id, contact_id, 'text', 'outbound', 'queued', 'oi'
           from public.conversations where id = $1`,
        [conversa],
      )
      .then(() => null, (e: { code?: string; message?: string }) => e);
    expect(erro?.code).toBe("42501");
    expect(erro?.message).toMatch(/^organizacao_de_demonstracao:/);
  });

  it("⭐ os eventos que a carga emitiu não viram trabalho para os workers", async () => {
    expect(
      await valor(`select count(*)::text from public.event_log where organization_id = $1 and status in ('pending', 'processing')`),
    ).toBe("0");
    expect(
      await valor<number>(
        `select count(*)::int from public.event_log where organization_id = $1 and $2 = any(consumed_by)`,
        [ID_DA_EMPRESA, CONSUMIDOR_DA_SEMENTE],
      ),
    ).toBeGreaterThan(0);
  });

  it("nenhum trabalho de fila nem disparo agendado nasceu para a empresa de demonstração", async () => {
    expect(
      await valor(`select count(*)::text from public.job_queue where organization_id = $1 and status in ('pending', 'running')`),
    ).toBe("0");
    expect(await valor(`select count(*)::text from public.cron_jobs where organization_id = $1 and enabled`)).toBe("0");
  });

  it("o acesso: quem existe entra como admin; o e-mail que não existe vira aviso", async () => {
    expect(
      await valor(`select role from public.user_organizations
                    where organization_id = $1 and user_id = '90109010-5555-4000-8000-000000000001'`),
    ).toBe("admin");
    expect(primeira.avisos.join(" ")).toContain("nao-existe@invariant.test");
  });
});

describe("o que a demonstração precisa mostrar", () => {
  it("⭐ cada funil de segmento tem ao menos um negócio em CADA etapa", async () => {
    const { rows } = await pool.query<{ funil: string; vazias: number }>(
      `select p.slug as funil, count(*) filter (where l.id is null)::int as vazias
         from public.crm_pipelines p
         join public.crm_stages s on s.pipeline_id = p.id and not s.is_archived
         left join lateral (select id from public.crm_leads where stage_id = s.id limit 1) l on true
        where p.organization_id = $1 and not p.is_archived
        group by p.slug`,
      [ID_DA_EMPRESA],
    );
    expect(rows.length).toBe(FUNIS.length);
    for (const r of rows) expect(r.vazias, `etapa vazia no funil ${r.funil}`).toBe(0);
  });

  it("o funil padrão é o geral, e o \"Pedidos\" do banco saiu de cena", async () => {
    expect(await valor(`select slug from public.crm_pipelines where organization_id = $1 and is_default`)).toBe("demo-generico");
    expect(await valor(`select is_archived::text from public.crm_pipelines where organization_id = $1 and slug = 'pedidos'`)).toBe("true");
  });

  it("motivos de perda e campos personalizados em todo funil; perdido tem motivo, ganho tem data", async () => {
    expect(
      await valor(`select count(*)::text from public.crm_pipelines
                    where organization_id = $1 and not is_archived
                      and (jsonb_array_length(settings -> 'lost_reasons') = 0 or jsonb_array_length(settings -> 'fields') = 0)`),
    ).toBe("0");
    expect(
      await valor(`select count(*)::text from public.crm_leads
                    where organization_id = $1 and status = 'lost' and coalesce(lost_reason, '') = ''`),
    ).toBe("0");
    expect(await valor<number>(`select count(*)::int from public.crm_leads where organization_id = $1 and status = 'won'`)).toBeGreaterThan(5);
  });

  it("negócio com valor, dono (pessoa e IA), próxima ação e histórico", async () => {
    expect(await valor<number>(`select count(*)::int from public.crm_leads where organization_id = $1 and owner_kind = 'ai'`)).toBeGreaterThan(0);
    expect(await valor<number>(`select count(*)::int from public.crm_leads where organization_id = $1 and owner_kind = 'user'`)).toBeGreaterThan(0);
    expect(
      await valor<number>(`select count(distinct lead_id)::int from public.crm_tasks where organization_id = $1 and lead_id is not null and status = 'pending'`),
    ).toBeGreaterThan(10);
    expect(
      await valor(`select count(*)::text from public.crm_leads l where l.organization_id = $1
                    and not exists (select 1 from public.crm_lead_activities a where a.lead_id = l.id and a.type = 'lead_created')`),
    ).toBe("0");
  });

  it("⭐ as cinco origens: formulário e clique da Meta, Google, site e indicação", async () => {
    const { rows } = await pool.query<{ o: string }>(
      `select distinct coalesce(source_metadata ->> 'canal', source) as o from public.crm_leads where organization_id = $1`,
      [ID_DA_EMPRESA],
    );
    expect(rows.map((r) => r.o).sort()).toEqual(
      ["clique_para_whatsapp", "formulario_da_meta", "google_ads", "indicacao", "site"].sort(),
    );
  });

  it("contatos com e sem empresa; empresa com várias pessoas nas duas entidades", async () => {
    expect(await valor<number>(`select count(*)::int from public.contacts where organization_id = $1 and empresa_id is not null`)).toBeGreaterThan(5);
    expect(await valor<number>(`select count(*)::int from public.contacts where organization_id = $1 and empresa_id is null`)).toBeGreaterThan(20);
    expect(
      await valor<number>(`select max(n)::int from (select count(*) as n from public.contacts where organization_id = $1 and empresa_id is not null group by empresa_id) x`),
    ).toBeGreaterThanOrEqual(3);
    expect(
      await valor<number>(`select max(n)::int from (select count(*) as n from public.company_people where organization_id = $1 group by company_id) x`),
    ).toBeGreaterThanOrEqual(3);
  });

  it("⭐ conversa com a IA: qualificação, ficha, passagem para o comercial", async () => {
    expect(await valor<number>(`select count(*)::int from public.messages where organization_id = $1 and sent_via = 'ai'`)).toBeGreaterThan(10);
    expect(await valor<number>(`select count(*)::int from public.lead_state where organization_id = $1 and stage = 'qualified' and qualification ? 'budget'`)).toBeGreaterThan(1);
    expect(await valor<number>(`select count(*)::int from public.lead_notes where organization_id = $1`)).toBeGreaterThan(3);
    expect(await valor<number>(`select count(*)::int from public.passagens_de_atendimento where organization_id = $1`)).toBeGreaterThan(1);
    expect(
      await valor<number>(`select count(*)::int from public.crm_leads l join public.crm_pipelines p on p.id = l.pipeline_id
                            where l.organization_id = $1 and p.slug = 'demo-comercial'`),
    ).toBeGreaterThan(3);
  });

  it("⭐ follow-ups por segmento, publicados, com inscrição andando e terminada", async () => {
    expect(
      await valor<number>(`select count(*)::int from public.followup_enrollments where organization_id = $1 and status in ('active', 'waiting_reply') and next_eval_at > $2`, [ID_DA_EMPRESA, AGORA]),
    ).toBeGreaterThan(3);
    expect(await valor<number>(`select count(*)::int from public.followup_enrollments where organization_id = $1 and status in ('completed', 'cancelled')`)).toBeGreaterThan(1);
    expect(
      await valor(`select count(*)::text from public.followup_flow_pointers where organization_id = $1 and status = 'active' and active_version_id is null`),
    ).toBe("0");
    expect(await valor<number>(`select count(*)::int from public.followup_enrollment_events where organization_id = $1`)).toBeGreaterThan(10);
  });

  it("agenda com compromissos passados e futuros", async () => {
    expect(await valor<number>(`select count(*)::int from public.calendar_appointments where organization_id = $1 and starts_at < now() - interval '2 days'`)).toBeGreaterThan(2);
    expect(await valor<number>(`select count(*)::int from public.calendar_appointments where organization_id = $1 and starts_at > now()`)).toBeGreaterThan(5);
  });
});

describe("documentos e obrigações na demonstração (9018)", () => {
  // A segunda rodada da semente foi dois dias depois da primeira: é o "hoje" dela.
  const HOJE = diaNoFuso(new Date(AGORA.getTime() + 2 * 86_400_000), "America/Sao_Paulo");

  async function itens(): Promise<Array<ItemParaSituacao & { nome: string }>> {
    const { rows } = await pool.query(
      `select nome, categoria, recorrencia, recorrencia_meses, validade_meses, avisos_dias, dias_sem_resposta,
              pedido_em::text, prazo_em::text, cobrado_em::text, recebido_em::text, valido_ate::text, renovado_em::text,
              proxima_em::text, feita_em::text
         from public.mia_obrigacoes where organization_id = $1`,
      [ID_DA_EMPRESA],
    );
    return rows as Array<ItemParaSituacao & { nome: string }>;
  }

  it("⭐ um conjunto pequeno e coerente: cada situação tem quem a ilustre, e renovar a semente devolve cada item ao lugar", async () => {
    const todos = await itens();
    expect(todos).toHaveLength(OBRIGACOES.length);
    const porSituacao: Record<string, number> = {};
    for (const item of todos) porSituacao[situacao(item, HOJE)] = (porSituacao[situacao(item, HOJE)] ?? 0) + 1;
    expect(porSituacao).toEqual({ vencido: 1, vencendo: 3, valido: 2, pedido: 1, a_pedir: 1, pendente: 2, feita: 1 });
    expect(contarObrigacoes(todos, HOJE)).toEqual({ vencidos: 1, vencendo_em_30_dias: 4, pedidos_sem_resposta: 3, em_dia: 3, total: 11 });
  });

  it("o catálogo do funil de serviços é o modelo do segmento, e todo item aponta para um tipo dele", async () => {
    expect(
      await valor(`select count(*)::text || ',' || count(distinct t.pipeline_id)::text from public.mia_obrigacoes_tipos t
                     where t.organization_id = $1 and t.segmento = 'servicos_b2b' and t.arquivado_em is null`),
    ).toBe("8,1");
    expect(
      await valor(`select count(*)::text from public.mia_obrigacoes o
                     where o.organization_id = $1
                       and not exists (select 1 from public.mia_obrigacoes_tipos t where t.id = o.tipo_id and t.organization_id = o.organization_id)`),
    ).toBe("0");
  });

  it("ligados a empresa, a contato e a negócio; com histórico de ciclos e uma proposta do agente esperando", async () => {
    expect(
      await valor(`select count(*) filter (where empresa_id is not null)::text || ',' || count(*) filter (where contact_id is not null)::text
                          || ',' || count(*) filter (where lead_id is not null)::text
                     from public.mia_obrigacoes where organization_id = $1`),
    ).toBe("6,1,4");
    expect(await valor<number>(`select count(*)::int from public.mia_obrigacoes_ciclos where organization_id = $1`)).toBeGreaterThanOrEqual(5);
    expect(
      await valor(`select count(*)::text || ',' || count(*) filter (where p.situacao = 'pendente')::text
                     from public.mia_obrigacoes_propostas p where p.organization_id = $1`),
    ).toBe("1,1");
    // A proposta não marcou nada: o documento continua com a renovação pedida, sem recebimento novo.
    expect(
      await valor(`select (o.pedido_em > o.recebido_em)::text from public.mia_obrigacoes o
                     join public.mia_obrigacoes_propostas p on p.obrigacao_id = o.id where o.organization_id = $1`),
    ).toBe("true");
  });

  it("⭐ a demonstração não envia: nenhum aviso disparado, nenhum evento de obrigação, nenhum arquivo e nada na fila de saída", async () => {
    expect(await valor(`select count(*)::text from public.mia_obrigacoes_avisos where organization_id = $1`)).toBe("0");
    expect(await valor(`select count(*)::text from public.event_log where organization_id = $1 and event_type like 'obrigacao.%'`)).toBe("0");
    expect(await valor(`select count(*)::text from public.mia_obrigacoes where organization_id = $1 and arquivo_path is not null`)).toBe("0");
    expect(
      await valor(`select count(*)::text from public.automation_rules
                     where organization_id = $1 and is_active and trigger_event like 'obrigacao.%'`),
    ).toBe("0");
    expect(
      await valor(`select count(*)::text from public.messages
                     where organization_id = $1 and direction = 'outbound' and status in ('queued', 'sending')`),
    ).toBe("0");
  });

  it("⭐ e se alguém ligar uma regra de aviso lá: o gatilho vira evento, e a mensagem é recusada na porta", async () => {
    const cliente = await pool.connect();
    try {
      await cliente.query("begin");
      const regra = await cliente.query<{ id: string }>(
        `insert into public.automation_rules (organization_id, name, trigger_event, trigger_config, actions, is_active)
           values ($1, 'Alvará vencendo', 'obrigacao.documento_vencendo', '{"dias":12}'::jsonb, '[{"type":"add_tag","config":{"tags":["renovar"]}}]'::jsonb, true)
         returning id`,
        [ID_DA_EMPRESA],
      );
      const item = await cliente.query<{ id: string; valido_ate: string }>(
        `select o.id, o.valido_ate::text from public.mia_obrigacoes o join public.mia_obrigacoes_propostas p on p.obrigacao_id = o.id
          where o.organization_id = $1`,
        [ID_DA_EMPRESA],
      );
      const evento = await cliente.query<{ e: string | null }>(
        `select public.fn_mia_obrigacao_disparar($1, $2, $3, 'obrigacao.documento_vencendo', 1, $4::date) as e`,
        [ID_DA_EMPRESA, item.rows[0]!.id, regra.rows[0]!.id, item.rows[0]!.valido_ate],
      );
      expect(evento.rows[0]!.e).toBeTruthy();
      await cliente.query("savepoint antes_da_mensagem");
      const erro = await cliente
        .query(
          `insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, body)
           select organization_id, id, channel_session_id, contact_id, 'text', 'outbound', 'queued', 'Seu alvará vence em 12 dias.'
             from public.conversations where organization_id = $1 limit 1`,
          [ID_DA_EMPRESA],
        )
        .then(() => null, (e: { code?: string; message?: string }) => e);
      expect(erro?.code).toBe("42501");
      expect(erro?.message).toMatch(/^organizacao_de_demonstracao:/);
      await cliente.query("rollback to savepoint antes_da_mensagem");
      // E a regra que avisaria o grupo do time nem liga.
      const grupo = await cliente
        .query(
          `insert into public.automation_rules (organization_id, name, trigger_event, actions, is_active)
             values ($1, 'Avisar o grupo', 'obrigacao.documento_vencido', '[{"type":"notify_group","config":{}}]'::jsonb, true)`,
          [ID_DA_EMPRESA],
        )
        .then(() => null, (e: { code?: string }) => e);
      expect(grupo?.code).toBe("42501");
    } finally {
      await cliente.query("rollback");
      cliente.release();
    }
  });
});

describe("dado fictício que nunca bate em pessoa real", () => {
  it("⭐ todo telefone é do DDD 00 (que não existe) e todo e-mail é .invalid", async () => {
    expect(
      await valor(`select count(*)::text from public.contacts where organization_id = $1 and phone_number !~ '^\\+5500'`),
    ).toBe("0");
    expect(
      await valor(`select count(*)::text from public.contacts where organization_id = $1 and email is not null and email !~ '@exemplo\\.invalid$'`),
    ).toBe("0");
    expect(
      await valor(`select count(*)::text from auth.users u join public.user_organizations m on m.user_id = u.id
                    where m.organization_id = $1 and u.email like '%@exemplo.invalid' and u.email !~ '@exemplo\\.invalid$'`),
    ).toBe("0");
  });
});
