import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";

import { clienteMcp, TODAS_AS_OPERACOES, TOKEN, type RespostaDaFerramenta } from "@/tests/helpers/implantacao-em-memoria";

import { pgComoSupabaseMia } from "../pg-como-supabase-mia";

/**
 * FORK MIA — O MCP DE IMPLANTAÇÃO, DE PONTA A PONTA, NO POSTGRES DE VERDADE.
 *
 * ═══ O QUE ESTE ARQUIVO PROVA QUE O TESTE DE UNIDADE NÃO PROVA ═══
 *
 * `tests/unit/mcp-de-implantacao-operacoes.test.ts` roda as mesmas ferramentas
 * contra tabelas em memória, onde as funções do banco são escritas em JS para
 * o teste. Aqui elas são as de verdade: `fn_create_tenant_with_owner` (e o
 * gatilho que semeia o funil de e-commerce), `fn_aplicar_quadro_do_onboarding`,
 * `fn_publish_ai_agent_version`, `fn_publish_followup_flow_version`, as
 * constraints, os gatilhos de `updated_at` e a trava da empresa de
 * demonstração. Uma coluna que não existe, um CHECK que recusa o valor ou um
 * gatilho que a ferramenta não conhecia aparecem aqui e em nenhum outro lugar.
 *
 * ═══ AS TRÊS AFIRMAÇÕES ═══
 *
 * 1. O ROTEIRO FECHA. Um cliente fictício é implantado inteiro pelas
 *    ferramentas, na ordem do roteiro de `docs/fork/mcp-de-implantacao.md`, com
 *    a única parada que o produto exige de uma pessoa (conectar o número), e o
 *    checklist passa de "falta" para "pode atender".
 *
 * 2. ⭐ RODAR DE NOVO NÃO MUDA NADA. O roteiro inteiro é chamado uma segunda
 *    vez e o RETRATO do banco (cada linha de cada tabela da organização,
 *    inclusive `updated_at`) é idêntico. É mais forte que "a resposta diz
 *    `ja_estava`": uma ferramenta que respondesse isso e regravasse a linha
 *    com os mesmos valores passaria na resposta e reprova no retrato.
 *
 * 3. O QUE A FERRAMENTA GRAVA É O QUE A TELA GRAVA, na única área em que a
 *    ferramenta não chama a função da tela: as etiquetas. A função da tela
 *    exige uma pessoa logada; a ferramenta grava a mesma chave. Os dois
 *    caminhos são rodados sobre o mesmo ponto de partida e o resultado é
 *    comparado.
 *
 * ═══ O QUE NÃO É REPRODUZIDO (declarado) ═══
 *
 *  - O e-mail do convite e o arquivo no Storage: dublês. Nada sai da máquina.
 *  - RLS: `pg` conecta como `postgres`, que é como o `service_role` do MCP de
 *    plataforma enxerga o banco.
 *
 * Sem dado de ninguém: empresa fictícia, e-mails `@exemplo.invalid` e
 * `@invariant.test`, telefone +5500 (DDD que não existe).
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const estado = vi.hoisted(() => {
  // Antes de qualquer import: a instalação de teste TEM a chave de IA da
  // plataforma (fictícia), que é o que deixa um agente ser publicado.
  process.env.OPENAI_API_KEY = "chave-ficticia-de-teste";
  return { cliente: null as unknown, convites: [] as string[] };
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
// `emitirConvite` chama duas vezes (9020): com `dispatch: false` só confere e assina,
// e a segunda, depois de a linha existir no banco, é a que manda o e-mail. Só
// essa conta como convite enviado.
vi.mock("@/lib/auth/issue-invite", () => ({
  issueInvite: vi.fn(async (input: { email: string; inviteId: string; dispatch?: boolean }) => {
    const envia = input.dispatch !== false;
    if (envia) estado.convites.push(input.email);
    return {
      email: input.email,
      invite_id: input.inviteId,
      expires_at: "2099-01-01T00:00:00.000Z",
      email_dispatched: envia,
      accept_url: "https://exemplo.invalid/team/accept-invite/ficticio",
    };
  }),
}));

/**
 * O que o PostgREST devolve e o `pg` devolveria diferente: número como número
 * e data como TEXTO, com os microssegundos. A data importa: a gravação em
 * `organizations.settings` é comparar-e-trocar em `updated_at`, e um `Date` do
 * JavaScript perde os microssegundos, o que faria toda troca parecer conflito.
 */
const comoOPostgrest = {
  getTypeParser(oid: number, formato?: string) {
    if (oid === 1700) return (v: string) => Number.parseFloat(v); // numeric
    if (oid === 20) return (v: string) => Number(v); // bigint
    if (oid === 1184) return (v: string) => v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"); // timestamptz
    if (oid === 1114) return (v: string) => v.replace(" ", "T"); // timestamp
    if (oid === 1082) return (v: string) => v; // date
    return pg.types.getTypeParser(oid, formato as "text");
  },
};

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres`,
  max: 4,
  types: comoOPostgrest as never,
});

estado.cliente = Object.assign(await pgComoSupabaseMia(pool), {
  auth: {
    admin: {
      getUserById: async (id: string) => {
        const { rows } = await pool.query<{ id: string; email: string; raw_user_meta_data: Record<string, unknown> }>(
          "select id, email, raw_user_meta_data from auth.users where id = $1",
          [id],
        );
        const u = rows[0];
        return { data: { user: u ? { id: u.id, email: u.email, user_metadata: u.raw_user_meta_data } : null }, error: null };
      },
    },
  },
  storage: { from: () => ({ upload: async () => ({ data: { path: "guardado" }, error: null }) }) },
});

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");

const IMPLANTADOR = "90179017-1111-4000-8000-00000000000a";
const GESTORA_DA_GEMEA = "90179017-1111-4000-8000-00000000000b";
const GEMEA = "90179017-0000-4000-8000-00000000000b";
const DEMO = "90179017-0000-4000-8000-00000000000d";
const CHAVE_DO_CLIENTE = "90179017-9999-4000-8000-000000000001";

const PROMPT = "Você é a Bia, atendente da Clínica Exemplo. Entenda o que a pessoa procura antes de oferecer um horário.";
const FLUXO = "Retomada · voltar a quem parou de responder";

const ETAPAS = [
  { nome: "Novo contato", passo: "new" },
  { nome: "Já respondi", passo: "contacted" },
  { nome: "Entendendo o caso", passo: "qualifying", probabilidade: 20 },
  { nome: "Quer agendar", passo: "qualified", probabilidade: 50 },
  { nome: "Escolhendo horário", passo: "negotiating", probabilidade: 80, prazo_esperado_horas: 48, cor: "#12a594" },
  { nome: "Consulta marcada", passo: "won" },
  { nome: "Não vai marcar", passo: "lost" },
];

let mcp: Awaited<ReturnType<typeof clienteMcp>>;
/** A organização que `plataforma_criar_cliente` devolveu. */
let ORG = "";

/** Chama a ferramenta e exige que ela NÃO tenha recusado. */
async function ok(nome: string, args: Record<string, unknown>): Promise<RespostaDaFerramenta> {
  const r = await mcp.chamar(nome, args);
  expect(r.erro, `${nome}: ${r.texto}`).toBe(false);
  return r;
}

async function uma<T extends pg.QueryResultRow>(consulta: string, valores: unknown[] = []): Promise<T> {
  const { rows } = await pool.query<T>(consulta, valores);
  expect(rows, consulta).toHaveLength(1);
  return rows[0]!;
}

/** As tabelas que a implantação escreve. Todas têm `organization_id`. */
const TABELAS_DA_IMPLANTACAO = [
  "crm_pipelines",
  "crm_stages",
  "catalog_products",
  "org_memory_versions",
  "org_memory_pointers",
  "org_memory_entries",
  "ai_knowledge_sources",
  "ai_faq_items",
  "followup_flow_pointers",
  "followup_flow_versions",
  "ai_agents",
  "ai_agent_versions",
  "automation_rules",
  "calendar_event_types",
  "attendant_availability",
  "team_invites",
  "message_templates",
  "event_log",
] as const;

/**
 * O RETRATO: quantas linhas e o resumo de TODAS as colunas de todas as linhas
 * da organização, tabela por tabela. Qualquer escrita aparece, inclusive a que
 * regrava o mesmo valor (o gatilho de `updated_at` a denuncia).
 */
async function retrato(org: string): Promise<Record<string, { linhas: number; resumo: string }>> {
  const saida: Record<string, { linhas: number; resumo: string }> = {};
  for (const tabela of TABELAS_DA_IMPLANTACAO) {
    const r = await uma<{ linhas: number; resumo: string }>(
      `select count(*)::int as linhas, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as resumo
         from public."${tabela}" x where x.organization_id = $1`,
      [org],
    );
    saida[tabela] = r;
  }
  saida.organizations = await uma(
    "select count(*)::int as linhas, md5(coalesce(string_agg(x::text, '|'), '')) as resumo from public.organizations x where x.id = $1",
    [org],
  );
  return saida;
}

/** O roteiro de montagem: tudo que o agente implantador grava sem depender de uma pessoa. */
function roteiroDeMontagem(org: string): Array<[string, Record<string, unknown>]> {
  return [
    ["plataforma_configurar_empresa", { organization_id: org, modo_de_venda: "b2c", fuso: "America/Sao_Paulo", cnpj: "00.000.000/0001-00" }],
    ["plataforma_configurar_atendimento", { organization_id: org, modo: "round_robin", visibilidade: "all" }],
    ["plataforma_garantir_funil", {
      organization_id: org,
      nome: "Agendamentos",
      adotar_funil_padrao: true,
      etapas: ETAPAS,
      campos: [{ key: "procedimento", label: "Procedimento", type: "select", options: [{ value: "limpeza", label: "Limpeza" }], obrigatorio_em: { etapas: ["Quer agendar"] } }],
      motivos_de_perda: ["Achou caro", { label: "Sem interesse", categoria: "Cliente" }],
    }],
    ["plataforma_garantir_produtos", {
      organization_id: org,
      produtos: [
        { codigo: "AVAL", nome: "Avaliação inicial", descricao: "Primeira consulta.", preco_cents: 8000, categoria: "Consultas" },
        { codigo: "LIMPEZA", nome: "Limpeza", descricao: "Profilaxia completa.", preco: "R$ 189,90" },
        { nome: "Kit de higiene", descricao: "Escova, fio e pasta.", preco_cents: 4500, quantidade: 12 },
      ],
    }],
    ["plataforma_garantir_etiquetas", { organization_id: org, etiquetas: [{ nome: "Indicação", cor: "#0091ff" }, { nome: "Plano anual", cor: "#12a594" }] }],
    ["plataforma_gravar_memoria", {
      organization_id: org,
      documento: "Nunca prometa desconto acima de 10%. Cancelamento com 24 horas de antecedência.",
      anotacoes: [{ titulo: "Estacionamento", corpo: "Convênio ao lado, uma hora grátis." }],
    }],
    ["plataforma_garantir_conhecimento", {
      organization_id: org,
      nome: "Perguntas frequentes",
      tipo: "faq",
      perguntas: [
        { pergunta: "Atendem aos sábados?", resposta: "Sim, das 8h às 13h." },
        { pergunta: "Aceitam convênio?", resposta: "Não, só particular." },
      ],
    }],
    ["plataforma_garantir_conhecimento", { organization_id: org, nome: "Política de cancelamento", tipo: "documento", texto: "Cancelamentos com 24 horas de antecedência não têm custo." }],
    ["plataforma_garantir_followup", { organization_id: org, modelo: "geral-retomada" }],
    ["plataforma_garantir_agente", {
      organization_id: org,
      nome: "Bia",
      descricao: "Atende quem chama no WhatsApp e agenda a avaliação.",
      prompt: PROMPT,
      pacotes: ["vender"],
      funis: ["Agendamentos"],
      materiais: ["Perguntas frequentes", "Política de cancelamento"],
      followups: { fluxos: [FLUXO] },
      palavras_de_passagem: ["falar com atendente"],
      horario_de_atendimento: { inicio: "08:00", fim: "20:00", dias: [1, 2, 3, 4, 5, 6] },
    }],
    ["plataforma_garantir_automacao", {
      organization_id: org,
      nome: "Etiquetar quem veio de anúncio",
      gatilho: "lead.created",
      condicoes: [{ field: "lead.source", op: "eq", value: "meta_ads" }],
      acoes: [{ type: "add_tag", config: { tags: ["Anúncio"] } }],
    }],
    ["plataforma_garantir_tipos_de_agendamento", { organization_id: org, tipos: [{ nome: "Avaliação inicial", categoria: "consulta", duracao_minutos: 40, local: "in_person" }] }],
    ["plataforma_definir_jornada", {
      organization_id: org,
      pessoa: "implantador-9017@invariant.test",
      janelas: [{ dia: 1, inicio: "08:00", fim: "12:00" }, { dia: 1, inicio: "13:00", fim: "18:00" }],
      disponivel: true,
    }],
    ["plataforma_garantir_respostas_prontas", { organization_id: org, respostas: [{ titulo: "Endereço", texto: "Rua das Flores, 100.", atalho: "endereco" }] }],
    ["plataforma_convidar_pessoas", { organization_id: org, pessoas: [{ email: "dona@exemplo.invalid", papel: "admin" }, { email: "recepcao@exemplo.invalid", papel: "agent" }] }],
  ];
}

/** O que só vale depois de montado: pôr no ar. */
function roteiroDePorNoAr(org: string): Array<[string, Record<string, unknown>]> {
  return [
    ["plataforma_publicar_followup", { organization_id: org, fluxo: FLUXO }],
    ["plataforma_publicar_agente", { organization_id: org, agente: "Bia" }],
    ["plataforma_ligar_automacao", { organization_id: org, regra: "Etiquetar quem veio de anúncio", ligada: true }],
    ["plataforma_ligar_lembrete", { organization_id: org, tipo: "Avaliação inicial", ligado: true, minutos_antes: 1440 }],
  ];
}

beforeAll(async () => {
  await pool.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
       ($1, 'implantador-9017@invariant.test', '{"full_name":"Pessoa Implantadora"}'),
       ($2, 'gestora-9017@invariant.test', '{}')
     on conflict (id) do nothing`,
    [IMPLANTADOR, GESTORA_DA_GEMEA],
  );
  await pool.query(
    "insert into public.platform_admins (user_id, granted_by, reason) values ($1, $1, 'invariante 9017') on conflict do nothing",
    [IMPLANTADOR],
  );
  await pool.query(
    `insert into public.platform_api_tokens (id, name, prefix, token_hash, operacoes, created_by, reason)
       values ($1, 'invariante de implantação', 'dskp_inv', '\\x00'::bytea, $2, $3, 'invariante 9017')
     on conflict (id) do nothing`,
    [TOKEN, TODAS_AS_OPERACOES, IMPLANTADOR],
  );
  // A plataforma já decidiu a IA dos agentes (Admin › IA): o par de um provedor
  // com chave nesta instalação e o modelo padrão dele no catálogo.
  await pool.query(
    `insert into public.platform_ia (id, provider, model_id)
       select 1, m.provider, m.model_id from public.ai_models m where m.provider = 'openai' and m.is_default_for_provider
     on conflict (id) do update set provider = excluded.provider, model_id = excluded.model_id`,
  );
  mcp = await clienteMcp(criarServidorDePlataforma as never, TODAS_AS_OPERACOES);
});

afterAll(async () => {
  await mcp?.fechar();
  await pool.end();
});

describe("1 · criar o cliente", () => {
  it("`plataforma_criar_cliente` cria a organização, e repetir com a mesma chave devolve a MESMA", async () => {
    const pedido = { display_name: "Clínica Exemplo", slug: "clinica-exemplo-9017", owner_email: "dona@exemplo.invalid", chave: CHAVE_DO_CLIENTE };
    const r = await ok("plataforma_criar_cliente", pedido);
    expect(r.dados.created).toBe(true);
    ORG = String(r.dados.id);

    const de_novo = await ok("plataforma_criar_cliente", pedido);
    expect(de_novo.dados).toMatchObject({ id: ORG, created: false });
    expect((await uma<{ n: number }>("select count(*)::int as n from organizations where slug = 'clinica-exemplo-9017'")).n).toBe(1);
  });

  it("a organização nasce com o funil de e-commerce e com quem criou o token como admin", async () => {
    const funil = await uma<{ name: string; is_default: boolean }>("select name, is_default from crm_pipelines where organization_id = $1", [ORG]);
    expect(funil).toEqual({ name: "Pedidos", is_default: true });
    const membro = await uma<{ user_id: string; role: string }>("select user_id, role from user_organizations where organization_id = $1", [ORG]);
    expect(membro).toEqual({ user_id: IMPLANTADOR, role: "admin" });
  });

  it("o checklist ANTES: nada montado, e conectar o número é com uma pessoa", async () => {
    const r = await ok("plataforma_ver_implantacao", { organization_id: ORG });
    expect(r.dados.resumo).toMatchObject({ pode_atender: false, agentes_no_ar: 0, numeros_conectados: 0, areas_nao_medidas: [] });
    const areas = Object.fromEntries((r.dados.areas as Array<{ area: string; situacao: string }>).map((a) => [a.area, a.situacao]));
    expect(areas).toMatchObject({ funis: "falta", produtos: "falta", agentes: "falta", canais: "com_o_humano" });
  });
});

describe("2 · a montagem, pelo roteiro", () => {
  it("cada ferramenta do roteiro grava sem recusa", async () => {
    for (const [nome, args] of roteiroDeMontagem(ORG)) await ok(nome, args);
  });

  it("o funil: o MESMO funil padrão, com o nome, as etapas e o passo do agente em cada uma", async () => {
    const funil = await uma<{ name: string; slug: string; is_default: boolean; settings: { fields: Array<{ key: string; obrigatorio_em?: { etapas?: string[] } }>; lost_reasons: unknown[] } }>(
      "select name, slug, is_default, settings from crm_pipelines where organization_id = $1",
      [ORG],
    );
    expect(funil).toMatchObject({ name: "Agendamentos", slug: "agendamentos", is_default: true });
    const { rows: etapas } = await pool.query<{ id: string; name: string; agent_stage_hint: string | null; is_won: boolean; is_lost: boolean; win_probability: number | null; expected_duration_hours: number | null; color: string | null }>(
      "select id, name, agent_stage_hint, is_won, is_lost, win_probability, expected_duration_hours, color from crm_stages where organization_id = $1 and not is_archived order by position",
      [ORG],
    );
    expect(etapas.map((e) => e.name)).toEqual(ETAPAS.map((e) => e.nome));
    expect(etapas.map((e) => e.agent_stage_hint)).toEqual(["new", "contacted", "qualifying", "qualified", "negotiating", "won", "lost"]);
    expect(etapas.filter((e) => e.is_won).map((e) => e.name)).toEqual(["Consulta marcada"]);
    expect(etapas.filter((e) => e.is_lost).map((e) => e.name)).toEqual(["Não vai marcar"]);
    expect(etapas.find((e) => e.name === "Escolhendo horário")).toMatchObject({ win_probability: 80, expected_duration_hours: 48, color: "#12a594" });
    // O campo obrigatório aponta para o ID da etapa, não para o nome.
    const campo = funil.settings.fields.find((f) => f.key === "procedimento");
    expect(campo?.obrigatorio_em?.etapas).toEqual([etapas.find((e) => e.name === "Quer agendar")!.id]);
    expect(funil.settings.lost_reasons).toEqual(["Achou caro", { label: "Sem interesse", categoria: "Cliente" }]);
  });

  it("o catálogo: em centavos, na moeda da empresa, com a origem da implantação", async () => {
    const { rows } = await pool.query<{ codigo: string; preco_cents: number; moeda: string; origem: string; controla_estoque: boolean; quantidade: number }>(
      "select codigo, preco_cents, moeda, origem, controla_estoque, quantidade from catalog_products where organization_id = $1 order by codigo",
      [ORG],
    );
    expect(rows).toEqual([
      { codigo: "AVAL", preco_cents: 8000, moeda: "BRL", origem: "implantacao", controla_estoque: false, quantidade: 0 },
      { codigo: "Kit de higiene", preco_cents: 4500, moeda: "BRL", origem: "implantacao", controla_estoque: true, quantidade: 12 },
      { codigo: "LIMPEZA", preco_cents: 18990, moeda: "BRL", origem: "implantacao", controla_estoque: false, quantidade: 0 },
    ]);
  });

  it("a memória, o conhecimento e o follow-up: gravados onde a tela os lê", async () => {
    const memoria = await uma<{ content: string; created_by: string }>(
      "select v.content, v.created_by from org_memory_pointers p join org_memory_versions v on v.id = p.version_id where p.organization_id = $1",
      [ORG],
    );
    expect(memoria).toMatchObject({ created_by: IMPLANTADOR });
    expect(memoria.content).toContain("Nunca prometa desconto");

    const { rows: materiais } = await pool.query<{ name: string; source_type: string; itens: number }>(
      `select s.name, s.source_type, (select count(*)::int from ai_faq_items i where i.knowledge_source_id = s.id) as itens
         from ai_knowledge_sources s where s.organization_id = $1 order by s.name`,
      [ORG],
    );
    expect(materiais.map((m) => [m.name, m.itens])).toEqual([["Perguntas frequentes", 2], ["Política de cancelamento", 0]]);

    const fluxo = await uma<{ name: string; status: string; active_version_id: string | null }>(
      "select name, status, active_version_id from followup_flow_pointers where organization_id = $1",
      [ORG],
    );
    // Instalado e NÃO publicado: nada sai até `plataforma_publicar_followup`.
    expect(fluxo).toMatchObject({ name: FLUXO, active_version_id: null });
    expect(fluxo.status).not.toBe("active");
  });

  it("o agente: RASCUNHO, com a IA da plataforma e SEM credencial de cliente", async () => {
    const agente = await uma<{ id: string; name: string; published_version_id: string | null; created_by: string }>(
      "select id, name, published_version_id, created_by from ai_agents where organization_id = $1",
      [ORG],
    );
    expect(agente).toMatchObject({ name: "Bia", published_version_id: null, created_by: IMPLANTADOR });
    const versao = await uma<{ status: string; version_number: number; system_prompt: string; provider: string | null; model: string | null; credential_id: string | null; channel_session_id: string | null; pipeline_ids: string[]; tool_ids: string[] }>(
      "select status, version_number, system_prompt, provider, model, credential_id, channel_session_id, pipeline_ids, tool_ids from ai_agent_versions where agent_id = $1",
      [agente.id],
    );
    expect(versao).toMatchObject({ status: "draft", version_number: 1, system_prompt: PROMPT, credential_id: null, channel_session_id: null });
    // O par é o que a PLATAFORMA definiu; o pedido não trouxe (nem pode trazer) provedor, modelo ou chave.
    const daPlataforma = await uma<{ provider: string; model_id: string }>("select provider, model_id from platform_ia where id = 1");
    expect({ provider: versao.provider, model_id: versao.model }).toEqual(daPlataforma);
    expect(versao.tool_ids.length).toBeGreaterThan(0);
    const funil = await uma<{ id: string }>("select id from crm_pipelines where organization_id = $1", [ORG]);
    expect(versao.pipeline_ids).toEqual([funil.id]);
  });

  it("a regra de automação nasce DESLIGADA, e o convite sai uma vez por pessoa", async () => {
    const regra = await uma<{ is_active: boolean; created_by_user_id: string }>(
      "select is_active, created_by_user_id from automation_rules where organization_id = $1",
      [ORG],
    );
    expect(regra).toEqual({ is_active: false, created_by_user_id: IMPLANTADOR });
    expect(estado.convites).toEqual(["dona@exemplo.invalid", "recepcao@exemplo.invalid"]);
    const { rows } = await pool.query<{ email: string; role: string }>("select email, role from team_invites where organization_id = $1 order by email", [ORG]);
    expect(rows).toEqual([{ email: "dona@exemplo.invalid", role: "admin" }, { email: "recepcao@exemplo.invalid", role: "agent" }]);
  });
});

describe("3 · pôr no ar: a parada que é de uma pessoa", () => {
  it("SEM número conectado, publicar o agente é recusado dizendo que agora é com uma pessoa", async () => {
    const r = await mcp.chamar("plataforma_publicar_agente", { organization_id: ORG, agente: "Bia" });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("Quem resolve: humano na tela");
    expect(r.texto).toContain("/app/connections");
    expect((await uma<{ p: string | null }>("select published_version_id as p from ai_agents where organization_id = $1", [ORG])).p).toBeNull();
  });

  it("a pessoa conecta o número (aqui, direto no banco), e o roteiro de pôr no ar passa inteiro", async () => {
    await pool.query(
      `insert into public.channel_sessions (organization_id, waha_session_name, webhook_secret_encrypted, status, display_name, phone_number)
         values ($1, 'mia-9017-recepcao', '\\x00'::bytea, 'WORKING', 'Recepção', '+5500900009017')`,
      [ORG],
    );
    for (const [nome, args] of roteiroDePorNoAr(ORG)) await ok(nome, args);

    const agente = await uma<{ published_version_id: string | null }>("select published_version_id from ai_agents where organization_id = $1", [ORG]);
    const versao = await uma<{ id: string; status: string; channel_session_id: string | null }>(
      "select id, status, channel_session_id from ai_agent_versions where organization_id = $1",
      [ORG],
    );
    expect(versao.status).toBe("published");
    expect(agente.published_version_id).toBe(versao.id);
    const numero = await uma<{ id: string }>("select id from channel_sessions where organization_id = $1", [ORG]);
    expect(versao.channel_session_id).toBe(numero.id);

    expect((await uma<{ status: string }>("select status from followup_flow_pointers where organization_id = $1", [ORG])).status).toBe("active");
    expect((await uma<{ is_active: boolean }>("select is_active from automation_rules where organization_id = $1", [ORG])).is_active).toBe(true);
    expect(
      await uma<{ reminder_enabled: boolean; reminder_minutes_before: number }>(
        "select reminder_enabled, reminder_minutes_before from calendar_event_types where organization_id = $1 and slug = 'avaliacao-inicial'",
        [ORG],
      ),
    ).toEqual({ reminder_enabled: true, reminder_minutes_before: 1440 });
  });

  it("o checklist DEPOIS: pode atender, e as áreas montadas estão prontas", async () => {
    const r = await ok("plataforma_ver_implantacao", { organization_id: ORG });
    expect(r.dados.resumo).toMatchObject({ pode_atender: true, agentes_no_ar: 1, numeros_conectados: 1, areas_nao_medidas: [] });
    const areas = Object.fromEntries((r.dados.areas as Array<{ area: string; situacao: string; falta: unknown }>).map((a) => [a.area, a]));
    for (const montada of ["empresa", "canais", "funis", "produtos", "etiquetas", "memoria", "conhecimento", "agentes", "followups", "automacoes", "agenda", "equipe", "mensagens"]) {
      expect(areas[montada]!.situacao, `${montada}: ${JSON.stringify(areas[montada]!.falta)}`).toBe("pronto");
    }
  });
});

describe("4 · ⭐ rodar o roteiro inteiro de novo não muda nada", () => {
  it("CONTROLE: o retrato enxerga uma escrita que regrava o MESMO valor", async () => {
    const antes = await retrato(ORG);
    // Toda tabela do retrato tem linha: instrumento que mede tabela vazia dá igual sempre.
    for (const [tabela, r] of Object.entries(antes)) expect(r.linhas, `${tabela} está vazia: o retrato não mediria nada nela`).toBeGreaterThan(0);

    await pool.query("update catalog_products set nome = nome where organization_id = $1 and codigo = 'AVAL'", [ORG]);
    const depois = await retrato(ORG);
    expect(depois.catalog_products!.resumo, "o retrato não viu uma regravação: ele não serve de prova").not.toBe(antes.catalog_products!.resumo);
    expect(depois.crm_stages).toEqual(antes.crm_stages);
  });

  it("a segunda passada responde `já estava` em tudo, não manda convite e deixa o banco IDÊNTICO", async () => {
    const antes = await retrato(ORG);
    const convitesAntes = estado.convites.length;

    const respostas: Array<[string, RespostaDaFerramenta]> = [];
    for (const [nome, args] of [...roteiroDeMontagem(ORG), ...roteiroDePorNoAr(ORG)]) respostas.push([nome, await ok(nome, args)]);

    // Nenhuma resposta fala de criação ou de mudança.
    for (const [nome, r] of respostas) {
      expect(r.texto, `${nome} respondeu que criou ou atualizou na segunda passada`).not.toMatch(/"desfecho": "(criou|atualizou|publicou|convidou|reenviou|submeteu)"/);
    }
    expect(estado.convites.length, "a segunda passada mandou e-mail de convite").toBe(convitesAntes);

    const depois = await retrato(ORG);
    for (const tabela of Object.keys(antes)) {
      expect(depois[tabela], `a segunda passada escreveu em ${tabela}`).toEqual(antes[tabela]);
    }
  });
});

describe("5 · etiquetas: a ferramenta grava o que a função da tela grava", () => {
  it("⭐ o mesmo ponto de partida, pelos dois caminhos, dá o mesmo vocabulário", async () => {
    const partida = JSON.stringify({ tags: ["vip"], visibility_mode: "all" });
    // A gêmea é mexida pela FUNÇÃO DA TELA, com uma gestora logada.
    await pool.query(
      "insert into organizations (id, slug, legal_name, display_name, settings) values ($1, 'mia-9017-gemea', 'MIA 9017 gêmea', 'MIA 9017 gêmea', $2::jsonb) on conflict (id) do nothing",
      [GEMEA, partida],
    );
    await pool.query(
      "insert into user_organizations (user_id, organization_id, role, accepted_at) values ($1, $2, 'manager', now()) on conflict do nothing",
      [GESTORA_DA_GEMEA, GEMEA],
    );
    const sessao = await pool.connect();
    try {
      await sessao.query("begin");
      await sessao.query("set local role authenticated");
      await sessao.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: GESTORA_DA_GEMEA, role: "authenticated" })]);
      await sessao.query("select public.fn_vocabulario_de_tags_operar($1, 'definir_cor', 'Plano anual', null, '#12a594')", [GEMEA]);
      await sessao.query("select public.fn_vocabulario_de_tags_operar($1, 'definir_cor', 'VIP', null, '#0091ff')", [GEMEA]);
      await sessao.query("commit");
    } catch (e) {
      await sessao.query("rollback");
      throw e;
    } finally {
      sessao.release();
    }

    // A outra é mexida pela FERRAMENTA, sem ninguém logado.
    const pelaFerramenta = "90179017-0000-4000-8000-00000000000c";
    await pool.query(
      "insert into organizations (id, slug, legal_name, display_name, settings) values ($1, 'mia-9017-ferramenta', 'MIA 9017 ferramenta', 'MIA 9017 ferramenta', $2::jsonb) on conflict (id) do nothing",
      [pelaFerramenta, partida],
    );
    await ok("plataforma_garantir_etiquetas", {
      organization_id: pelaFerramenta,
      etiquetas: [{ nome: "Plano anual", cor: "#12A594" }, { nome: "VIP", cor: "#0091ff" }],
    });

    const tags = async (org: string) => (await uma<{ tags: unknown }>("select settings -> 'tags' as tags from organizations where id = $1", [org])).tags;
    const daTela = await tags(GEMEA);
    expect(daTela, "a função da tela não gravou nada: o teste compararia vazio com vazio").toEqual([
      { tag: "vip", cor: "#0091ff" },
      { tag: "Plano anual", cor: "#12a594" },
    ]);
    expect(await tags(pelaFerramenta)).toEqual(daTela);
    // E a chave vizinha, que a RLS lê, não foi tocada por nenhum dos dois.
    expect((await uma<{ v: string }>("select settings ->> 'visibility_mode' as v from organizations where id = $1", [pelaFerramenta])).v).toBe("all");
  });
});

describe("6 · a empresa de demonstração monta tudo, convida a equipe e não manda nada para os contatos nem para fora", () => {
  beforeAll(async () => {
    await pool.query(
      "insert into organizations (id, slug, legal_name, display_name, demonstracao) values ($1, 'mia-9017-demo', 'MIA 9017 demo', 'MIA 9017 demo', true) on conflict (id) do nothing",
      [DEMO],
    );
    await pool.query(
      "insert into user_organizations (user_id, organization_id, role, accepted_at) values ($1, $2, 'admin', now()) on conflict do nothing",
      [IMPLANTADOR, DEMO],
    );
  });

  it("CONTROLE: a montagem funciona na demonstração (funil, catálogo e regra desligada)", async () => {
    await ok("plataforma_garantir_funil", { organization_id: DEMO, nome: "Agendamentos", adotar_funil_padrao: true, etapas: ETAPAS });
    await ok("plataforma_garantir_produtos", { organization_id: DEMO, produtos: [{ codigo: "AVAL", nome: "Avaliação", preco_cents: 8000 }] });
    await ok("plataforma_garantir_automacao", {
      organization_id: DEMO,
      nome: "Etiquetar quem veio de anúncio",
      gatilho: "lead.created",
      acoes: [{ type: "add_tag", config: { tags: ["Anúncio"] } }],
    });
    await ok("plataforma_garantir_automacao", {
      organization_id: DEMO,
      nome: "Avisar o sistema de fora",
      gatilho: "lead.created",
      acoes: [{ type: "call_webhook", config: { url: "https://exemplo.invalid/gancho" } }],
    });
    // A regra que não fala com ninguém de fora LIGA na demonstração: é o controle
    // de que a recusa do caso abaixo vem da trava, e não de a ferramenta estar quebrada.
    await ok("plataforma_ligar_automacao", { organization_id: DEMO, regra: "Etiquetar quem veio de anúncio", ligada: true });
    expect((await uma<{ n: number }>("select count(*)::int as n from catalog_products where organization_id = $1", [DEMO])).n).toBe(1);
  });

  it("⭐ convite de equipe FUNCIONA na demonstração (9020): a linha nasce no banco e o e-mail sai uma vez", async () => {
    // Até a 9020 este caso provava a recusa. O convite deixou de ser uma saída
    // travada: ele fala com uma pessoa de verdade que quem administra escolheu,
    // e não com um contato fictício. O gatilho que recusava a linha é do BANCO,
    // então é aqui (e não no teste de unidade) que a retirada dele é medida.
    const pedido = { organization_id: DEMO, pessoas: [{ email: "alguem@exemplo.invalid", papel: "agent" }] };
    const antes = estado.convites.length;
    const r = await mcp.chamar("plataforma_convidar_pessoas", pedido);
    expect(r.erro, r.texto).toBe(false);
    expect((r.dados.convites as Array<Record<string, unknown>>)[0]).toMatchObject({
      email: "alguem@exemplo.invalid",
      papel: "agent",
      desfecho: "convidou",
      email_enviado: true,
    });
    expect(estado.convites.slice(antes)).toEqual(["alguem@exemplo.invalid"]);
    const { rows } = await pool.query<{ email: string; role: string; pendente: boolean; email_dispatched: boolean; invited_by: string }>(
      `select email, role, (accepted_at is null and revoked_at is null) as pendente, email_dispatched, invited_by::text
         from team_invites where organization_id = $1`,
      [DEMO],
    );
    expect(rows).toEqual([
      { email: "alguem@exemplo.invalid", role: "agent", pendente: true, email_dispatched: true, invited_by: IMPLANTADOR },
    ]);

    // Reexecução: o convite pendente não é reenviado, como em qualquer empresa.
    const denovo = await mcp.chamar("plataforma_convidar_pessoas", pedido);
    expect((denovo.dados.convites as Array<Record<string, unknown>>)[0]).toMatchObject({ desfecho: "ja_convidado" });
    expect(estado.convites.length).toBe(antes + 1);
    expect((await uma<{ n: number }>("select count(*)::int as n from team_invites where organization_id = $1", [DEMO])).n).toBe(1);
  });

  it("⭐ ligar a automação que chama um webhook é recusado pela trava do BANCO, e a regra segue desligada", async () => {
    const r = await mcp.chamar("plataforma_ligar_automacao", { organization_id: DEMO, regra: "Avisar o sistema de fora", ligada: true });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("Esta é a empresa de demonstração");
    const { rows } = await pool.query<{ name: string; is_active: boolean }>(
      "select name, is_active from automation_rules where organization_id = $1 order by name",
      [DEMO],
    );
    expect(rows).toEqual([
      { name: "Avisar o sistema de fora", is_active: false },
      { name: "Etiquetar quem veio de anúncio", is_active: true },
    ]);
  });

  it("⭐ modelo oficial do WhatsApp não é submetido", async () => {
    const r = await mcp.chamar("plataforma_submeter_modelo_whatsapp", {
      organization_id: DEMO,
      nome: "lembrete_de_avaliacao",
      categoria: "UTILITY",
      texto: "Olá! Sua avaliação é amanhã.",
    });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("Esta é a empresa de demonstração");
  });
});

describe("7 · a trilha: toda escrita fica auditada, com a ferramenta e o token", () => {
  it("as escritas do roteiro estão na auditoria; as leituras não", async () => {
    // `audit()` é disparado sem esperar: dá um instante para as últimas linhas chegarem.
    let ferramentas: string[] = [];
    for (let tentativa = 0; tentativa < 40; tentativa += 1) {
      const { rows } = await pool.query<{ ferramenta: string }>(
        `select distinct metadata ->> 'ferramenta' as ferramenta from api_audit_log
          where action = 'plataforma.mcp_executado' and metadata ->> 'token_id' = $1`,
        [TOKEN],
      );
      ferramentas = rows.map((x) => x.ferramenta);
      if (ferramentas.includes("plataforma_ligar_lembrete")) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    for (const [nome] of [...roteiroDeMontagem(ORG), ...roteiroDePorNoAr(ORG)]) {
      expect(ferramentas, `${nome} escreveu e não está na auditoria`).toContain(nome);
    }
    expect(ferramentas).toContain("plataforma_criar_cliente");
    expect(ferramentas, "leitura não é auditada").not.toContain("plataforma_ver_implantacao");

    const linha = await uma<{ actor_user_id: string; metadata: { operacao: string; argumentos: { organization_id: string } } }>(
      `select actor_user_id, metadata from api_audit_log
        where action = 'plataforma.mcp_executado' and metadata ->> 'ferramenta' = 'plataforma_garantir_etiquetas'
          and metadata -> 'argumentos' ->> 'organization_id' = $1
        order by created_at limit 1`,
      [ORG],
    );
    expect(linha.actor_user_id).toBe(IMPLANTADOR);
    expect(linha.metadata.operacao).toBe("implantar_configuracao");
  });
});
