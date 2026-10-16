import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { pgComoSupabase } from "../pg-como-supabase";

/**
 * A MIGRAÇÃO DE UMA BASE INTEIRA — repetível e EM SILÊNCIO.
 *
 * As ferramentas de importação do MCP de plataforma (`lib/mcp-plataforma/importacao/`)
 * prometem duas coisas que só um banco de verdade prova:
 *
 *  (a) REEXECUÇÃO SEGURA: rodar a mesma importação de novo não muda NADA. Nem
 *      linha a mais, nem coluna tocada, nem `updated_at` renovado;
 *  (b) NADA É ENVIADO: importar contatos, empresas e negócios (inclusive os já
 *      ganhos e perdidos) não deixa evento para ninguém consumir, e portanto
 *      nenhuma mensagem, nenhuma inscrição em follow-up, nenhuma execução de
 *      automação, nenhuma tarefa e nenhuma conversão para as plataformas de
 *      anúncio.
 *
 * ── Por que a prova de (b) é a fila de eventos VAZIA ──────────────────────
 *
 * Todo efeito colateral deste produto nasce de uma linha em `event_log`: o
 * dreno a lê e chama os consumidores (automação, follow-up, aviso, conversão).
 * Sem a linha não há a quem chamar. Por isso a asserção é sobre a ORIGEM, e é
 * mais forte do que rodar cada consumidor e ver que ele não fez nada: ela cobre
 * também o consumidor que ainda não existe.
 *
 * E o instrumento é medido antes de medir: o CONTROLE POSITIVO no fim cria um
 * negócio pelo caminho normal, no mesmo banco e com o mesmo cliente, e confere
 * que AÍ o evento aparece. Sem ele, "nenhum evento" poderia ser só o cliente de
 * teste não conseguindo gravar evento nenhum.
 *
 * As armadilhas ficam ARMADAS durante a importação: quatro automações ativas
 * que mandariam mensagem a cada negócio criado, a cada entrada em etapa e a
 * cada etiqueta. Nenhuma pode rodar.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 4,
});

/**
 * O cliente das ferramentas: Postgres de verdade, com o `auth.admin` que a
 * leitura da equipe usa (`getUserById`) respondido pela própria `auth.users`.
 */
const database = Object.assign(pgComoSupabase(pool), {
  auth: {
    admin: {
      getUserById: async (id: string) => {
        const { rows } = await pool.query<{ id: string; email: string | null }>(
          "select id, email from auth.users where id = $1",
          [id],
        );
        return { data: { user: rows[0] ?? null }, error: null };
      },
    },
  },
});

// O `createAdminClient()` de dentro dos handlers (evento, auditoria, dono) fala
// com o MESMO banco: é isso que faz um evento emitido aparecer aqui.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => database }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => {
    throw new Error("sem sessão de usuário num teste de banco");
  },
}));

const ORG = "9017a000-0000-4000-8000-000000000001";
const OUTRA_ORG = "9017a000-0000-4000-8000-000000000002";
const AUTOR = "9017a000-0000-4000-8000-0000000000a1";
const VENDEDORA = "9017a000-0000-4000-8000-0000000000a2";
const TOKEN = "9017a000-0000-4000-8000-0000000000f1";
const ORIGEM = "crm-antigo";

function ctx() {
  return { admin: database, autorUserId: AUTOR, tokenId: TOKEN, requestId: "req-invariante" };
}

// ── a base fictícia ───────────────────────────────────────────────────────
//
// Nenhum dado é de pessoa real: os e-mails são `@exemplo.invalid` (domínio
// reservado) e os telefones usam o DDD 10, que não existe no Brasil mas tem a
// forma de um DDD, e por isso exercita a regra do nono dígito.

const EMPRESAS = [
  { nome: "Padaria Modelo LTDA", cnpj: "12.345.678/0001-90", telefone: "(10) 3000-0001", etiquetas: ["atacado"] },
  { nome: "Oficina Exemplo ME", email: "contato@oficina.exemplo.invalid", campos: { segmento: "serviços" } },
  { nome: "Clínica Fictícia S.A.", cnpj: "98765432000110" },
];

const CONTATOS = [
  // 1 · celular com máscara e sem +55, ligado à empresa pelo CNPJ SEM pontuação
  {
    nome: "Ana Souza",
    telefone: "(10) 99111-0001",
    email: "Ana.Souza@Exemplo.invalid",
    etiquetas: ["Cliente Antigo", "atacado"],
    canal: "indicação",
    campos: { cidade: "Cidade Exemplo" },
    observacao: "Prefere contato à tarde.",
    empresa: { cnpj: "12345678000190", cargo: "Compradora", papel: "decisor", principal: true },
    consentimento_marketing: "concedido",
    consentimento_em: "14/03/2026",
    id_de_origem: "c-1",
  },
  // 2 · o MESMO número da 1, sem o nono dígito e com +55: é a mesma pessoa
  { nome: "Ana S.", telefone: "+55 10 9111-0001", etiquetas: ["retorno"] },
  // 3 · só e-mail
  { nome: "Bruno Lima", email: "bruno.lima@exemplo.invalid" },
  // 4 · veio como opt-out: entra bloqueado
  { nome: "Carla Dias", telefone: "10992220002", opt_out: true },
  // 5 · recusou marketing
  { nome: "Davi Rocha", telefone: "5510993330003", consentimento_marketing: "recusado" },
  // 6 · sem telefone válido e sem e-mail: recusado
  { nome: "Sem Identificador", telefone: "123" },
  // 7 · empresa pelo NOME, com grafia diferente da cadastrada
  { nome: "Elisa Prado", telefone: "(10) 99444-0004", empresa: { nome: "oficina exemplo", cargo: "Sócia" } },
  // 8 · o MESMO e-mail da 1, em outra caixa: é a mesma pessoa
  { email: "ANA.SOUZA@EXEMPLO.INVALID", etiquetas: ["vip"] },
];

const NEGOCIOS = [
  // 1 · aberto, com dono pelo e-mail, contato pelo telefone SEM o nono dígito
  {
    id_de_origem: "n-1",
    titulo: "Pedido da padaria",
    funil: "Pedidos",
    etapa: "aguardando pagamento",
    valor: 1250.5,
    dono_email: "Vendedora@Exemplo.invalid",
    contato_telefone: "(10) 9111-0001",
    empresa_cnpj: "12.345.678/0001-90",
    etiquetas: ["quente"],
    criado_em: "2026-03-14",
    nota: "No sistema antigo: pediu três versões do orçamento.",
  },
  // 2 · ganho em março, com as datas de origem
  {
    id_de_origem: "n-2",
    titulo: "Plano anual",
    funil: "Pedidos",
    situacao: "ganho",
    valor: "4.800,00",
    contato_email: "bruno.lima@exemplo.invalid",
    criado_em: "2026-02-01",
    fechado_em: "2026-03-10",
  },
  // 3 · perdido, com a etapa em que morreu e um motivo que o funil não conhece
  {
    id_de_origem: "n-3",
    titulo: "Reforma da oficina",
    funil: "Pedidos",
    etapa: "Carrinho abandonado",
    situacao: "perdido",
    motivo_de_perda: "Fechou com o concorrente da esquina",
    empresa_nome: "Oficina Exemplo",
    criado_em: "2026-01-05",
    fechado_em: "2026-01-20",
  },
  // 4 · perdido com motivo canônico, pelo rótulo
  { id_de_origem: "n-4", titulo: "Consulta de preço", funil: "Pedidos", situacao: "perdido", motivo_de_perda: "Preço" },
  // 5 · funil que não existe: recusado, ensinando quais existem
  { id_de_origem: "n-5", titulo: "Negócio sem funil", funil: "Comercial B2B", etapa: "Novo" },
  // 6 · etapa que não existe: recusado, ensinando quais existem
  { id_de_origem: "n-6", titulo: "Negócio sem etapa", funil: "Pedidos", etapa: "Em negociação" },
  // 7 · ganho numa etapa aberta: recusado (a situação contradiz a etapa)
  { id_de_origem: "n-7", titulo: "Etapa contraditória", funil: "Pedidos", etapa: "Pago" },
];

// ── o retrato do banco ────────────────────────────────────────────────────

/** O conteúdo INTEIRO das tabelas da base, linha a linha, com todas as colunas. */
async function retratoDaBase(): Promise<Record<string, string>> {
  const retrato: Record<string, string> = {};
  // FORK MIA (.79, empresa única): a empresa é do cadastro único (`companies`, com
  // o que é só nosso ao lado) e a pessoa na empresa é o vínculo (`people`,
  // `company_people`). Repetir a importação não pode mexer em nenhuma delas.
  for (const tabela of [
    "contacts",
    "companies",
    "mia_companies_extra",
    "people",
    "company_people",
    "crm_leads",
    "lead_notes",
    "crm_lead_activities",
  ]) {
    const { rows } = await pool.query<{ total: string; resumo: string }>(
      // Ordem pela linha inteira: `mia_companies_extra` não tem `id` (a chave é a empresa).
      `select count(*)::text as total, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as resumo
         from public."${tabela}" t where t.organization_id = $1`,
      [ORG],
    );
    retrato[tabela] = `${rows[0]!.total} linhas, ${rows[0]!.resumo}`;
  }
  return retrato;
}

/** Tudo o que seria rastro de um efeito: evento, mensagem, inscrição, execução, tarefa, conversão. */
const TABELAS_DE_EFEITO = [
  "event_log",
  "messages",
  "conversations",
  "followup_enrollments",
  "automation_rule_runs",
  "ad_conversion_dispatches",
  "crm_tasks",
  "job_queue",
] as const;

async function efeitos(): Promise<Record<string, number>> {
  const contagem: Record<string, number> = {};
  for (const tabela of TABELAS_DE_EFEITO) {
    const { rows } = await pool.query<{ total: string }>(
      `select count(*)::text as total from public."${tabela}" where organization_id = $1`,
      [ORG],
    );
    contagem[tabela] = Number(rows[0]!.total);
  }
  return contagem;
}

const NENHUM_EFEITO = Object.fromEntries(TABELAS_DE_EFEITO.map((t) => [t, 0]));

async function importarTudo() {
  const { importarEmpresas } = await import("@/lib/mcp-plataforma/importacao/empresas");
  const { importarContatos } = await import("@/lib/mcp-plataforma/importacao/contatos");
  const { importarNegocios } = await import("@/lib/mcp-plataforma/importacao/negocios");
  const empresas = await importarEmpresas(ctx(), { organization_id: ORG, origem: ORIGEM, empresas: EMPRESAS });
  const contatos = await importarContatos(ctx(), { organization_id: ORG, origem: ORIGEM, contatos: CONTATOS });
  const negocios = await importarNegocios(ctx(), { organization_id: ORG, origem: ORIGEM, negocios: NEGOCIOS });
  return { empresas, contatos, negocios };
}

beforeAll(async () => {
  await pool.query(
    `insert into auth.users (id, email) values ($1, 'autor.do.token@exemplo.invalid'), ($2, 'vendedora@exemplo.invalid')
     on conflict (id) do nothing`,
    [AUTOR, VENDEDORA],
  );
  // O funil padrão ("Pedidos", com etapa de ganho "Pago" e de perda "Cancelado")
  // nasce do gatilho `fn_seed_default_pipeline_for_org`.
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name) values
       ($1, 'org-migracao', 'Migração LTDA', 'Cliente em Migração'),
       ($2, 'org-vizinha', 'Vizinha LTDA', 'Cliente Vizinho')
     on conflict (id) do nothing`,
    [ORG, OUTRA_ORG],
  );
  await pool.query(
    `insert into user_organizations (user_id, organization_id, role) values ($1, $3, 'admin'), ($2, $3, 'agent')
     on conflict do nothing`,
    [AUTOR, VENDEDORA, ORG],
  );
  // AS ARMADILHAS: regras ATIVAS que mandariam mensagem se o evento existisse.
  for (const gatilho of ["lead.created", "lead.stage_changed", "lead.tag_added", "contact.tag_added"]) {
    await pool.query(
      `insert into automation_rules (organization_id, name, trigger_event, conditions, actions, is_active)
       values ($1, $2, $3, '[]'::jsonb, $4::jsonb, true)`,
      [ORG, `armadilha ${gatilho}`, gatilho, JSON.stringify([{ type: "add_tag", config: { tags: ["disparou"] } }])],
    );
  }
});

afterAll(async () => {
  await pool.query("delete from organizations where id = any($1)", [[ORG, OUTRA_ORG]]);
  await pool.end();
});

describe("migração de uma base inteira pelo MCP de plataforma", () => {
  it("a primeira rodada grava a base, casando telefone, e-mail e CNPJ nas grafias em que vieram", async () => {
    const { empresas, contatos, negocios } = await importarTudo();

    expect(empresas, JSON.stringify(empresas.itens)).toMatchObject({ total: 3, criou: 3, recusou: 0 });

    // 8 linhas, 5 pessoas: a 2 e a 8 são a Ana, e a 6 não tem como ser reconhecida.
    expect(contatos.itens.map((i) => i.desfecho), JSON.stringify(contatos.itens)).toEqual([
      "criou",
      "atualizou",
      "criou",
      "criou",
      "criou",
      "recusou",
      "criou",
      "atualizou",
    ]);
    expect(contatos.itens[5]!.motivo).toContain("Item 6");
    expect(contatos.itens[5]!.motivo).toContain("telefone");

    expect(negocios.itens.map((i) => i.desfecho), JSON.stringify(negocios.itens)).toEqual([
      "criou",
      "criou",
      "criou",
      "criou",
      "recusou",
      "recusou",
      "recusou",
    ]);
    // A recusa ENSINA: diz o que existe, em vez de criar o que foi pedido.
    expect(negocios.itens[4]!.motivo).toContain('"Pedidos"');
    expect(negocios.itens[5]!.motivo).toContain('"Aguardando pagamento"');
    expect(negocios.itens[6]!.motivo).toContain('situacao: "ganho"');

    const { rows: ana } = await pool.query(
      `select c.phone_number, c.email, c.tags, c.cargo, c.papel_na_empresa, c.principal_na_empresa, c.source,
              c.consent -> 'marketing' ->> 'granted_at' as consentiu_em, coalesce(e.trade_name, e.legal_name) as empresa
         from contacts c left join companies e on e.id = c.empresa_id
        where c.organization_id = $1 and c.email_normalized = 'ana.souza@exemplo.invalid'`,
      [ORG],
    );
    expect(ana, "a Ana é UM contato, não três").toHaveLength(1);
    expect(ana[0]).toMatchObject({
      // Celular brasileiro é guardado COM o nono dígito.
      phone_number: "+5510991110001",
      tags: ["cliente antigo", "atacado", "retorno", "vip"],
      cargo: "Compradora",
      papel_na_empresa: "decisor",
      principal_na_empresa: true,
      source: "importacao:crm-antigo",
      empresa: "Padaria Modelo LTDA",
    });
    expect(String(ana[0].consentiu_em)).toContain("2026-03-14");

    const { rows: bloqueada } = await pool.query(
      "select is_blocked, blocked_reason from contacts where organization_id = $1 and name = 'Carla Dias'",
      [ORG],
    );
    expect(bloqueada[0]).toMatchObject({ is_blocked: true, blocked_reason: "opt_out_importado" });

    const { rows: recusou } = await pool.query(
      "select consent -> 'marketing' ->> 'declined_at' as recusou_em from contacts where organization_id = $1 and name = 'Davi Rocha'",
      [ORG],
    );
    expect(recusou[0]!.recusou_em, "a recusa de marketing é um fato gravado").toBeTruthy();

    const { rows: leads } = await pool.query(
      `select l.external_id, l.source, l.status, l.value_cents::int as valor, l.lost_reason, s.name as etapa,
              morreu.name as morreu_em, l.owner_user_id, l.created_at::date::text as criado, l.closed_at::date::text as fechado,
              c.name as contato, coalesce(e.trade_name, e.legal_name) as empresa
         from crm_leads l
         join crm_stages s on s.id = l.stage_id
         left join crm_stages morreu on morreu.id = l.lost_from_stage_id
         left join contacts c on c.id = l.contact_id
         left join companies e on e.id = l.empresa_id
        where l.organization_id = $1 order by l.external_id`,
      [ORG],
    );
    expect(leads).toHaveLength(4);
    expect(leads[0]).toMatchObject({
      external_id: "n-1",
      source: "importacao:crm-antigo",
      status: "open",
      valor: 125050,
      etapa: "Aguardando pagamento",
      owner_user_id: VENDEDORA,
      contato: "Ana Souza",
      empresa: "Padaria Modelo LTDA",
      fechado: null,
    });
    // Negócio ABERTO nasce hoje: a data de origem fica guardada, fora da coluna
    // que a regra de "N dias sem mensagem" lê.
    expect(leads[0]!.criado).not.toBe("2026-03-14");
    // Negócio FECHADO leva as datas do CRM de origem.
    expect(leads[1]).toMatchObject({
      external_id: "n-2",
      status: "won",
      valor: 480000,
      etapa: "Pago",
      contato: "Bruno Lima",
      criado: "2026-02-01",
      fechado: "2026-03-10",
    });
    expect(leads[2]).toMatchObject({
      external_id: "n-3",
      status: "lost",
      etapa: "Cancelado",
      morreu_em: "Carrinho abandonado",
      lost_reason: "other",
      empresa: "Oficina Exemplo ME",
      criado: "2026-01-05",
      fechado: "2026-01-20",
    });
    expect(leads[3]).toMatchObject({ external_id: "n-4", status: "lost", lost_reason: "price" });
  });

  it("(b) NADA foi enviado nem enfileirado: nenhum evento, mensagem, inscrição, execução, tarefa ou conversão", async () => {
    expect(await efeitos()).toEqual(NENHUM_EFEITO);
  });

  it("(a) rodar de novo não muda NADA: mesmas linhas, mesmas colunas, mesmos carimbos", async () => {
    const antes = await retratoDaBase();
    const { empresas, contatos, negocios } = await importarTudo();
    const depois = await retratoDaBase();

    expect(depois).toEqual(antes);
    expect({ criou: empresas.criou, atualizou: empresas.atualizou }, JSON.stringify(empresas.itens)).toEqual({ criou: 0, atualizou: 0 });
    expect({ criou: contatos.criou, atualizou: contatos.atualizou }, JSON.stringify(contatos.itens)).toEqual({ criou: 0, atualizou: 0 });
    expect({ criou: negocios.criou, atualizou: negocios.atualizou }, JSON.stringify(negocios.itens)).toEqual({ criou: 0, atualizou: 0 });
    // O que foi recusado continua recusado, pelo mesmo motivo: não entra na segunda vez por insistência.
    expect(contatos.recusou).toBe(1);
    expect(negocios.recusou).toBe(3);
    // E a segunda rodada também não acorda ninguém.
    expect(await efeitos()).toEqual(NENHUM_EFEITO);
  });

  it("quem está bloqueado continua bloqueado, mesmo que a lista diga o contrário", async () => {
    const { importarContatos } = await import("@/lib/mcp-plataforma/importacao/contatos");
    const r = await importarContatos(ctx(), {
      organization_id: ORG,
      origem: ORIGEM,
      quando_ja_existe: "atualizar",
      contatos: [{ nome: "Carla Dias", telefone: "(10) 99222-0002", opt_out: false, consentimento_marketing: "concedido" }],
    });
    expect(r.itens[0]!.avisos?.join(" ")).toContain("continua bloqueado");
    const { rows } = await pool.query(
      "select is_blocked from contacts where organization_id = $1 and name = 'Carla Dias'",
      [ORG],
    );
    expect(rows[0]!.is_blocked).toBe(true);
    expect(await efeitos()).toEqual(NENHUM_EFEITO);
  });

  it("a importação fica na organização pedida: a vizinha não ganha linha nenhuma", async () => {
    for (const tabela of ["contacts", "companies", "company_people", "crm_leads"]) {
      const { rows } = await pool.query<{ total: string }>(
        `select count(*)::text as total from public."${tabela}" where organization_id = $1`,
        [OUTRA_ORG],
      );
      expect(Number(rows[0]!.total), tabela).toBe(0);
    }
  });

  it("a auditoria guarda contagens e ids, e nenhum nome, telefone ou e-mail", async () => {
    const { rows } = await pool.query<{ metadata: Record<string, unknown>; resource_type: string }>(
      "select metadata, resource_type from api_audit_log where organization_id = $1 and action = 'plataforma.importacao'",
      [ORG],
    );
    expect(rows.length, "uma linha por chamada de importação").toBeGreaterThanOrEqual(6);
    const tudo = JSON.stringify(rows);
    for (const dado of ["Ana", "Souza", "Bruno", "Carla", "99111", "9111-0001", "exemplo.invalid", "Padaria"]) {
      expect(tudo, `a auditoria da importação carrega "${dado}"`).not.toContain(dado);
    }
    const contatos = rows.find((r) => r.resource_type === "contatos" && r.metadata.criou === 5);
    expect(contatos?.metadata).toMatchObject({ via: "mcp_plataforma", origem: ORIGEM, total: 8, criou: 5, atualizou: 2, recusou: 1 });
  });

  it("CONTROLE POSITIVO: o mesmo banco REGISTRA o evento quando o negócio nasce pelo caminho normal", async () => {
    // Sem este caso, "nenhum evento" acima poderia ser o cliente de teste
    // incapaz de gravar evento. Aqui o negócio nasce como nasce pela tela, e a
    // fila ganha exatamente a linha que a importação não deixou.
    const { createLeadHandler } = await import("@/app/api/v1/leads/_handler");
    const { rows: etapa } = await pool.query<{ id: string; pipeline_id: string }>(
      "select id, pipeline_id from crm_stages where organization_id = $1 and name = 'Aguardando pagamento'",
      [ORG],
    );
    await createLeadHandler(
      database,
      { organization_id: ORG, actor: { type: "user", id: AUTOR, role: "admin" }, requestId: "controle-positivo" },
      { pipeline_id: etapa[0]!.pipeline_id, stage_id: etapa[0]!.id, title: "Negócio criado pela tela", tags: [], source: "manual" },
    );
    const { rows } = await pool.query<{ event_type: string }>(
      "select event_type from event_log where organization_id = $1",
      [ORG],
    );
    expect(rows.map((r) => r.event_type)).toEqual(["lead.created"]);
  });
});

describe("o vendedor responsável (o dono do contato) chega ao banco pela função da 9022", () => {
  beforeAll(async () => {
    // O ator da 9022: o token de plataforma vivo, com `importar_base`, criado por um admin de plataforma.
    await pool.query(
      "insert into public.platform_admins (user_id, granted_by, reason, scope) values ($1, $1, 'invariante da migração', 'full') on conflict (user_id) do nothing",
      [AUTOR],
    );
    await pool.query(
      `insert into public.platform_api_tokens (id, name, prefix, token_hash, operacoes, created_by, reason)
         values ($1, 'invariante da migração', 'dskp_mig', '\x09'::bytea, '{importar_base}', $2, 'invariante da migração')
       on conflict (id) do nothing`,
      [TOKEN, AUTOR],
    );
    // A vendedora aceitou o convite: só assim ela conta como dona.
    await pool.query("update user_organizations set accepted_at = now() where organization_id = $1 and user_id = $2", [ORG, VENDEDORA]);
  });

  afterAll(async () => {
    await pool.query("delete from public.platform_api_tokens where id = $1", [TOKEN]);
    await pool.query("delete from public.platform_admins where user_id = $1", [AUTOR]);
  });

  it("⭐ grava o trio do dono com a origem `importacao`, sem emitir evento; repetir não chama de novo", async () => {
    const { importarContatos } = await import("@/lib/mcp-plataforma/importacao/contatos");
    const eventosAntes = (await pool.query("select count(*)::int as n from event_log where organization_id = $1", [ORG])).rows[0].n as number;
    const pedido = {
      organization_id: ORG,
      origem: ORIGEM,
      contatos: [{ nome: "Fábio Teles", telefone: "(10) 99555-0005", vendedor_responsavel: "Vendedora@Exemplo.invalid" }],
    };
    const r = await importarContatos(ctx(), pedido);
    expect(r, JSON.stringify(r.itens)).toMatchObject({ criou: 1, recusou: 0 });
    expect(r.itens[0]!.avisos ?? []).toEqual([]);
    const { rows } = await pool.query<{ carteira_user_id: string | null; carteira_origem: string | null; definida: boolean }>(
      `select carteira_user_id, carteira_origem, carteira_definida_em is not null as definida
         from contacts where organization_id = $1 and phone_number = '+5510995550005'`,
      [ORG],
    );
    expect(rows).toEqual([{ carteira_user_id: VENDEDORA, carteira_origem: "importacao", definida: true }]);
    const eventosDepois = (await pool.query("select count(*)::int as n from event_log where organization_id = $1", [ORG])).rows[0].n as number;
    expect(eventosDepois, "gravar o dono emitiu evento").toBe(eventosAntes);

    const de_novo = await importarContatos(ctx(), pedido);
    expect(de_novo.itens[0]).toMatchObject({ desfecho: "ja_estava" });
  });

  it("CONTROLE: com um token que não carrega `importar_base`, o banco recusa o ator e o contato entra sem dono", async () => {
    const { importarContatos } = await import("@/lib/mcp-plataforma/importacao/contatos");
    await pool.query("update public.platform_api_tokens set operacoes = '{implantar_configuracao}' where id = $1", [TOKEN]);
    try {
      const r = await importarContatos(ctx(), {
        organization_id: ORG,
        origem: ORIGEM,
        contatos: [{ nome: "Gil Moura", telefone: "(10) 99666-0006", vendedor_responsavel: "vendedora@exemplo.invalid" }],
      });
      expect(r).toMatchObject({ criou: 1 });
      expect((r.itens[0]!.avisos as string[]).join(" ")).toContain("o banco recusou o token desta chamada como ator");
      const { rows } = await pool.query("select carteira_user_id from contacts where organization_id = $1 and phone_number = '+5510996660006'", [ORG]);
      expect(rows).toEqual([{ carteira_user_id: null }]);
    } finally {
      await pool.query("update public.platform_api_tokens set operacoes = '{importar_base}' where id = $1", [TOKEN]);
    }
  });
});
