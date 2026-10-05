import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";

import { diaNoFuso, somarDias } from "@/lib/obrigacoes/datas";
import { clienteMcp, TODAS_AS_OPERACOES, TOKEN, type RespostaDaFerramenta } from "@/tests/helpers/implantacao-em-memoria";

import { pgComoSupabaseMia } from "../pg-como-supabase-mia";

/**
 * FORK MIA (migration 9018) — DOCUMENTOS E OBRIGAÇÕES PELO MCP DE PLATAFORMA E
 * PELA VARREDURA DOS AVISOS, NO POSTGRES DE VERDADE.
 *
 * `tests/invariants/obrigacoes.test.ts` prova o schema (RLS, ciclo, trava).
 * Este arquivo prova o CÓDIGO que grava nele, com as constraints, os gatilhos
 * e as funções de verdade:
 *
 *   1. o catálogo de tipos de um funil, inclusive "usar o modelo do segmento",
 *      e rodar de novo não muda nada;
 *   2. ⭐ MIGRAR A PLANILHA: itens em lote pela chave natural (tipo + a quem
 *      está ligado), com datas do passado, sem emitir evento, sem aviso
 *      retroativo e sem duplicar na segunda rodada;
 *   3. o retrato: os contadores e a ordem por urgência;
 *   4. os cinco gatilhos são aceitos por `plataforma_garantir_automacao` e
 *      aparecem em `plataforma_listar_modelos`;
 *   5. ⭐ A VARREDURA: cada regra dispara uma vez por item e ciclo; item
 *      migrado e regra ligada hoje não mandam aviso do passado; "não enviado"
 *      fica segurado enquanto há arquivo do cliente esperando confirmação;
 *   6. OS BOTÕES DA TELA, pelo mesmo código que as rotas chamam
 *      (`lib/obrigacoes/operacoes.ts` e `leitura.ts`): pedir, receber, marcar
 *      feita, recusar a proposta, corrigir, arquivar, e a leitura com herança.
 *
 * RLS não entra aqui: o `pg` conecta como `postgres`, que é como o
 * `service_role` do MCP de plataforma e da varredura enxerga o banco.
 *
 * Sem dado de ninguém: empresas fictícias, e-mail `@invariant.test`, telefone
 * +5500 (DDD que não existe).
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const estado = vi.hoisted(() => ({ cliente: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));

/** Número como número e data como TEXTO, como o PostgREST devolve. */
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
        const { rows } = await pool.query<{ id: string; email: string }>("select id, email from auth.users where id = $1", [id]);
        const u = rows[0];
        return { data: { user: u ? { id: u.id, email: u.email, user_metadata: {} } : null }, error: null };
      },
    },
  },
});

const { criarServidorDePlataforma } = await import("@/lib/mcp-plataforma/servidor");
const { varrerAvisosDeObrigacao, avisarDocumentoRecebido } = await import("@/lib/obrigacoes/avisos");
const operacoes = await import("@/lib/obrigacoes/operacoes");
const { lerObrigacoes, lerDetalhe } = await import("@/lib/obrigacoes/leitura");

const IMPLANTADOR = "90189018-1111-4000-8000-0000000000aa";
const ORG = "90189018-0000-4000-8000-0000000000c1";
const FUNIL = "90189018-5555-4000-8000-0000000000c1";
const ETAPA = "90189018-5555-4000-8000-0000000000c2";
const PADARIA = "90189018-7777-4000-8000-0000000000c1";
const TRANSPORTADORA = "90189018-7777-4000-8000-0000000000c2";
const CONTATO = "90189018-3333-4000-8000-0000000000c1";
const NEGOCIO = "90189018-6666-4000-8000-0000000000c1";

const FUSO = "America/Sao_Paulo";
const HOJE = diaNoFuso(new Date(), FUSO);
const dia = (n: number) => somarDias(HOJE, n);

let mcp: Awaited<ReturnType<typeof clienteMcp>>;

async function ok(nome: string, args: Record<string, unknown>): Promise<RespostaDaFerramenta> {
  const r = await mcp.chamar(nome, args);
  expect(r.erro, `${nome}: ${r.texto}`).toBe(false);
  return r;
}

async function linhas<T extends pg.QueryResultRow>(consulta: string, valores: unknown[] = [ORG]): Promise<T[]> {
  return (await pool.query<T>(consulta, valores)).rows;
}

async function numero(consulta: string, valores: unknown[] = [ORG]): Promise<number> {
  const r = await linhas<{ n: number }>(consulta, valores);
  return Number(r[0]?.n ?? 0);
}

/** O retrato das tabelas das obrigações: qualquer escrita aparece, inclusive a que regrava o mesmo valor. */
async function retrato(): Promise<Record<string, string>> {
  const saida: Record<string, string> = {};
  for (const tabela of ["mia_obrigacoes_tipos", "mia_obrigacoes", "mia_obrigacoes_ciclos", "mia_obrigacoes_avisos"]) {
    const r = await linhas<{ resumo: string }>(
      `select count(*)::text || ':' || md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as resumo
         from public.${tabela} x where x.organization_id = $1`,
    );
    saida[tabela] = r[0]!.resumo;
  }
  return saida;
}

const eventosDeObrigacao = () =>
  numero("select count(*)::int as n from public.event_log where organization_id = $1 and event_type like 'obrigacao.%'");

/** A planilha de vencimentos da empresa fictícia, como ela chegaria na migração. */
const PLANILHA = [
  // 1 · da empresa (por CNPJ com máscara): venceu há 3 dias, com as datas do passado.
  { tipo: "Alvará de funcionamento", empresa_cnpj: "11.222.333/0001-81", recebido_em: dia(-368), valido_ate: dia(-3) },
  // 2 · do negócio: pedido há 9 dias, nada chegou.
  { tipo: "Contrato social", negocio_id: NEGOCIO, pedido_em: dia(-9), prazo_em: dia(-2), responsavel_email: "implantador-9018@invariant.test" },
  // 3 · atividade recorrente do negócio, a 4 dias.
  { tipo: "Relatório mensal", negocio_id: NEGOCIO, proxima_em: dia(4), feita_em: dia(-26) },
  // 4 · do contato (por telefone), tipo que vem dos modelos e não do catálogo do cliente; data em DD/MM/AAAA.
  { tipo: "CNH", contato_telefone: "(00) 90189-0181", recebido_em: "10/03/2024", valido_ate: "05/03/2099" },
  // 5 · tipo que ninguém conhece, sem dizer a categoria.
  { tipo: "Carta de anuência", empresa_nome: "Padaria Trigo Dourado 9018" },
  // 6 · empresa que não está na base.
  { tipo: "Alvará de funcionamento", empresa_cnpj: "99.999.999/0001-99" },
  // 7 · sem vínculo nenhum.
  { tipo: "Alvará de funcionamento" },
];

beforeAll(async () => {
  await pool.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, 'implantador-9018@invariant.test', '{"full_name":"Pessoa Implantadora"}')
     on conflict (id) do nothing`,
    [IMPLANTADOR],
  );
  await pool.query(
    "insert into public.platform_admins (user_id, granted_by, reason) values ($1, $1, 'invariante 9018') on conflict do nothing",
    [IMPLANTADOR],
  );
  const operacoes = [...TODAS_AS_OPERACOES, "importar_base"];
  await pool.query(
    `insert into public.platform_api_tokens (id, name, prefix, token_hash, operacoes, created_by, reason)
       values ($1, 'invariante de obrigações', 'dskp_obr', '\\x01'::bytea, $2, $3, 'invariante 9018')
     on conflict (id) do nothing`,
    [TOKEN, operacoes, IMPLANTADOR],
  );
  await pool.query(
    `insert into public.organizations (id, slug, legal_name, display_name, timezone)
       values ($1, 'mia-9018-mcp', 'MIA 9018 MCP', 'MIA 9018 MCP', $2) on conflict (id) do nothing`,
    [ORG, FUSO],
  );
  await pool.query(
    "insert into public.user_organizations (user_id, organization_id, role, accepted_at) values ($1, $2, 'admin', now()) on conflict do nothing",
    [IMPLANTADOR, ORG],
  );
  await pool.query(
    "insert into public.crm_pipelines (id, organization_id, name, slug) values ($1, $2, 'Serviços', 'servicos-9018-mcp') on conflict do nothing",
    [FUNIL, ORG],
  );
  await pool.query(
    "insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values ($1, $2, $3, 'Em andamento', 'em-andamento', 1000) on conflict do nothing",
    [ETAPA, ORG, FUNIL],
  );
  await pool.query(
    `insert into public.crm_empresas (id, organization_id, nome, cnpj) values
       ($1, $3, 'Padaria Trigo Dourado 9018', '11222333000181'),
       ($2, $3, 'Transportadora Rota Sul 9018', '44555666000181')
     on conflict (id) do nothing`,
    [PADARIA, TRANSPORTADORA, ORG],
  );
  await pool.query(
    "insert into public.contacts (id, organization_id, display_name, phone_number, empresa_id) values ($1, $2, 'Contato 9018 MCP', '+5500901890181', $3) on conflict (id) do nothing",
    [CONTATO, ORG, PADARIA],
  );
  await pool.query(
    `insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id, empresa_id)
       values ($1, $2, $3, $4, 'Padaria · gestão mensal', $5, $6) on conflict (id) do nothing`,
    [NEGOCIO, ORG, FUNIL, ETAPA, CONTATO, PADARIA],
  );
  mcp = await clienteMcp(criarServidorDePlataforma as never, operacoes);
});

afterAll(async () => {
  await mcp?.fechar();
  await pool.end();
});

describe("1 · o catálogo de tipos de um funil", () => {
  const pedido = {
    organization_id: ORG,
    funil: "Serviços",
    modelo_do_segmento: "servicos_b2b",
    tipos: [{ nome: "Certidão negativa de débitos", categoria: "documento", validade_meses: 6, avisos_dias: [30, 15] }],
  };

  it("`modelo_do_segmento` instala os tipos do segmento, e `tipos` acrescenta um próprio", async () => {
    const r = await ok("plataforma_garantir_tipos_de_obrigacao", pedido);
    expect(r.dados).toMatchObject({ funil: "Serviços", criados: 9, atualizados: 0, ja_estavam: 0 });
    const tipos = await linhas<{ nome: string; segmento: string | null; validade_meses: number; avisos_dias: number[]; liga_a: string }>(
      "select nome, segmento, validade_meses, avisos_dias, liga_a from public.mia_obrigacoes_tipos where organization_id = $1 and pipeline_id = $2 order by posicao, nome",
      [ORG, FUNIL],
    );
    expect(tipos).toHaveLength(9);
    expect(tipos.filter((t) => t.segmento === "servicos_b2b")).toHaveLength(8);
    expect(tipos.find((t) => t.nome === "Alvará de funcionamento")).toMatchObject({ validade_meses: 12, avisos_dias: [30, 15, 7], liga_a: "empresa" });
    expect(tipos.find((t) => t.nome === "Certidão negativa de débitos")).toMatchObject({ segmento: null, validade_meses: 6, avisos_dias: [30, 15] });
  });

  it("⭐ rodar de novo não muda nada: `já estava` em tudo e o banco idêntico", async () => {
    const antes = await retrato();
    const r = await ok("plataforma_garantir_tipos_de_obrigacao", pedido);
    expect(r.dados).toMatchObject({ criados: 0, atualizados: 0, ja_estavam: 9 });
    expect(await retrato()).toEqual(antes);
  });

  it("ajustar um tipo atualiza só ele, e aplicar o modelo de novo não desfaz o ajuste", async () => {
    const ajuste = await ok("plataforma_garantir_tipos_de_obrigacao", {
      organization_id: ORG,
      funil: "Serviços",
      tipos: [{ nome: "Alvará de funcionamento", categoria: "documento", recorrencia: "anual", validade_meses: 24, avisos_dias: [60, 30], liga_a: "empresa" }],
    });
    expect(ajuste.dados).toMatchObject({ criados: 0, atualizados: 1 });
    await ok("plataforma_garantir_tipos_de_obrigacao", { organization_id: ORG, funil: "Serviços", modelo_do_segmento: "servicos_b2b" });
    const [alvara] = await linhas<{ validade_meses: number; avisos_dias: number[] }>(
      "select validade_meses, avisos_dias from public.mia_obrigacoes_tipos where organization_id = $1 and nome = 'Alvará de funcionamento'",
    );
    expect(alvara).toEqual({ validade_meses: 24, avisos_dias: [60, 30] });
    expect(await numero("select count(*)::int as n from public.mia_obrigacoes_tipos where organization_id = $1")).toBe(9);
  });

  it("recusa o pedido vazio e o segmento que não existe, dizendo o que fazer", async () => {
    const vazio = await mcp.chamar("plataforma_garantir_tipos_de_obrigacao", { organization_id: ORG, funil: "Serviços" });
    expect(vazio.erro).toBe(true);
    expect(vazio.texto).toContain("modelo_do_segmento");
    const funilErrado = await mcp.chamar("plataforma_garantir_tipos_de_obrigacao", { organization_id: ORG, funil: "Não existe", modelo_do_segmento: "clinica" });
    expect(funilErrado.erro).toBe(true);
    expect(funilErrado.texto).toContain("plataforma_ver_funis");
  });
});

describe("2 · ⭐ migrar a planilha de vencimentos", () => {
  it("os bons entram, os ruins voltam com a posição e o campo, e um não derruba o outro", async () => {
    const r = await ok("plataforma_garantir_obrigacoes", { organization_id: ORG, origem: "planilha", obrigacoes: PLANILHA });
    expect(r.dados).toMatchObject({ total: 7, criou: 4, atualizou: 0, ja_estava: 0, recusou: 3 });
    const itens = r.dados.itens as Array<{ posicao: number; desfecho: string; motivo?: string }>;
    expect(itens.map((i) => i.desfecho)).toEqual(["criou", "criou", "criou", "criou", "recusou", "recusou", "recusou"]);
    expect(itens[4]!.motivo).toContain("Item 5, campo `categoria`");
    expect(itens[5]!.motivo).toContain("Item 6, campo `empresa_cnpj`");
    expect(itens[5]!.motivo).toContain("plataforma_importar_empresas");
    expect(itens[6]!.motivo).toContain("Item 7, campo `(vínculo)`");
  });

  it("cada item ficou ligado a quem devia, com as regras do tipo e as datas informadas", async () => {
    const gravados = await linhas<Record<string, unknown>>(
      `select nome, categoria, lead_id, empresa_id, contact_id, recorrencia, validade_meses, avisos_dias, pedido_em, prazo_em, recebido_em, valido_ate,
              proxima_em, feita_em, ciclo, origem, responsavel_user_id, (tipo_id is not null) as do_catalogo, (chave_natural is not null) as com_chave
         from public.mia_obrigacoes where organization_id = $1 order by nome`,
    );
    expect(gravados.map((g) => g.nome)).toEqual(["Alvará de funcionamento", "CNH", "Contrato social", "Relatório mensal"]);
    const [alvara, cnh, contrato, relatorio] = gravados;
    // O alvará pegou as regras do catálogo DO CLIENTE (ajustado para 24 meses e avisos de 60 e 30).
    expect(alvara).toMatchObject({ categoria: "documento", empresa_id: PADARIA, lead_id: null, contact_id: null, recebido_em: dia(-368), valido_ate: dia(-3), validade_meses: 24, avisos_dias: [60, 30], do_catalogo: true, ciclo: 1 });
    // A CNH não está no catálogo do cliente: veio dos modelos, e a data em DD/MM/AAAA foi entendida.
    expect(cnh).toMatchObject({ categoria: "documento", contact_id: CONTATO, empresa_id: null, recebido_em: "2024-03-10", valido_ate: "2099-03-05", validade_meses: 120, do_catalogo: false });
    expect(contrato).toMatchObject({ lead_id: NEGOCIO, pedido_em: dia(-9), prazo_em: dia(-2), recebido_em: null, responsavel_user_id: IMPLANTADOR });
    expect(relatorio).toMatchObject({ categoria: "atividade", lead_id: NEGOCIO, recorrencia: "mensal", proxima_em: dia(4), feita_em: dia(-26), avisos_dias: [5, 2] });
    for (const g of gravados) expect(g).toMatchObject({ origem: "importacao:planilha", com_chave: true });
  });

  it("⭐ migrar não acorda ninguém: nenhum evento, nenhum aviso, nenhuma mensagem, e o item nasce para os avisos HOJE", async () => {
    expect(await eventosDeObrigacao()).toBe(0);
    expect(await numero("select count(*)::int as n from public.mia_obrigacoes_avisos where organization_id = $1")).toBe(0);
    expect(await numero("select count(*)::int as n from public.messages where organization_id = $1")).toBe(0);
    expect(await numero("select count(*)::int as n from public.crm_tasks where organization_id = $1")).toBe(0);
    expect(
      await numero("select count(*)::int as n from public.mia_obrigacoes where organization_id = $1 and sem_aviso_antes_de = $2", [ORG, HOJE]),
    ).toBe(4);
  });

  it("⭐ rodar o lote de novo não duplica nem regrava: `já estava` nos quatro e o banco idêntico", async () => {
    const antes = await retrato();
    const r = await ok("plataforma_garantir_obrigacoes", { organization_id: ORG, origem: "planilha", obrigacoes: PLANILHA });
    expect(r.dados).toMatchObject({ criou: 0, atualizou: 0, ja_estava: 4, recusou: 3 });
    expect(await retrato()).toEqual(antes);
  });

  it("a mesma empresa pelo nome é o MESMO item: a chave é o tipo mais a quem está ligado", async () => {
    const r = await ok("plataforma_garantir_obrigacoes", {
      organization_id: ORG,
      origem: "planilha",
      obrigacoes: [{ tipo: "ALVARÁ DE FUNCIONAMENTO", empresa_nome: "Padaria Trigo Dourado 9018", observacao: "Renovação na prefeitura." }],
    });
    expect(r.dados).toMatchObject({ criou: 0, atualizou: 1 });
    expect(await numero("select count(*)::int as n from public.mia_obrigacoes where organization_id = $1 and nome = 'Alvará de funcionamento'")).toBe(1);
    // Só o que veio mudou: as datas ficaram como estavam.
    const [alvara] = await linhas<{ observacao: string; valido_ate: string }>(
      "select observacao, valido_ate from public.mia_obrigacoes where organization_id = $1 and nome = 'Alvará de funcionamento'",
    );
    expect(alvara).toEqual({ observacao: "Renovação na prefeitura.", valido_ate: dia(-3) });
  });

  it("o mesmo tipo em OUTRA empresa é outro item", async () => {
    const r = await ok("plataforma_garantir_obrigacoes", {
      organization_id: ORG,
      origem: "planilha",
      obrigacoes: [{ tipo: "Alvará de funcionamento", empresa_cnpj: "44555666000181", recebido_em: dia(-100), valido_ate: dia(265) }],
    });
    expect(r.dados).toMatchObject({ criou: 1 });
    expect(await numero("select count(*)::int as n from public.mia_obrigacoes where organization_id = $1 and nome = 'Alvará de funcionamento'")).toBe(2);
  });
});

describe("3 · o retrato: contadores e ordem por urgência", () => {
  it("por padrão vêm os pendentes, do mais urgente para o menos, com a situação calculada", async () => {
    const r = await ok("plataforma_ver_obrigacoes", { organization_id: ORG });
    expect(r.dados.hoje).toBe(HOJE);
    expect(r.dados.contadores).toEqual({ vencidos: 1, vencendo_em_30_dias: 1, pedidos_sem_resposta: 1, em_dia: 2, total: 5 });
    const itens = r.dados.itens as Array<{ tipo: string; situacao: string; ligado_a: { empresa: { nome: string } | null; negocio: { titulo: string } | null; contato_id: string | null } }>;
    expect(itens.map((i) => [i.tipo, i.situacao])).toEqual([
      ["Alvará de funcionamento", "vencido"],
      ["Relatório mensal", "pendente"],
      ["Contrato social", "pedido"],
    ]);
    expect(itens[0]!.ligado_a.empresa?.nome).toBe("Padaria Trigo Dourado 9018");
    expect(itens[1]!.ligado_a.negocio?.titulo).toBe("Padaria · gestão mensal");
    expect((r.dados.catalogo as unknown[]).length).toBe(9);
  });

  it("o corte por situação", async () => {
    const emDia = await ok("plataforma_ver_obrigacoes", { organization_id: ORG, situacao: "em_dia" });
    expect((emDia.dados.itens as Array<{ tipo: string }>).map((i) => i.tipo).sort()).toEqual(["Alvará de funcionamento", "CNH"]);
    const vencidas = await ok("plataforma_ver_obrigacoes", { organization_id: ORG, situacao: "vencidas" });
    expect(vencidas.dados).toMatchObject({ mostrando: 1, de: 1 });
    const semResposta = await ok("plataforma_ver_obrigacoes", { organization_id: ORG, situacao: "pedidas_sem_resposta" });
    expect((semResposta.dados.itens as Array<{ tipo: string }>).map((i) => i.tipo)).toEqual(["Contrato social"]);
  });

  it("o checklist da implantação mede a área, e ela nunca entra em `falta`", async () => {
    const r = await ok("plataforma_ver_implantacao", { organization_id: ORG });
    expect((r.dados.resumo as { areas_nao_medidas: string[] }).areas_nao_medidas).toEqual([]);
    const area = (r.dados.areas as Array<{ area: string; falta: unknown[]; dados: Record<string, unknown> }>).find((a) => a.area === "obrigacoes")!;
    expect(area.falta).toEqual([]);
    expect(area.dados).toMatchObject({ opcional: true, tipos_no_catalogo: 9, contadores: { vencidos: 1, total: 5 }, regras_de_aviso: { existentes: 0, ligadas: 0 } });
    expect((area.dados.atencao as string[]).join(" ")).toContain("nenhuma regra de aviso ligada");
  });
});

describe("4 · os avisos são automações: os cinco gatilhos pelo MCP", () => {
  it("`plataforma_listar_modelos` oferece os cinco gatilhos, a configuração de cada um e os modelos por segmento", async () => {
    const r = await ok("plataforma_listar_modelos", { secoes: ["automacoes", "obrigacoes"] });
    const automacoes = r.dados.automacoes as { gatilhos: string[]; gatilhos_que_pedem_configuracao: Record<string, string> };
    for (const gatilho of [
      "obrigacao.documento_vencendo",
      "obrigacao.documento_vencido",
      "obrigacao.documento_nao_enviado",
      "obrigacao.documento_recebido",
      "obrigacao.atividade_chegando",
    ]) {
      expect(automacoes.gatilhos, gatilho).toContain(gatilho);
      expect(automacoes.gatilhos_que_pedem_configuracao[gatilho], gatilho).toBeTruthy();
    }
    const obrigacoes = r.dados.obrigacoes as { segmentos: Array<{ id: string; tipos: Array<{ nome: string }> }> };
    expect(obrigacoes.segmentos.map((s) => s.id)).toEqual(["servicos_b2b", "clinica", "imobiliaria", "automotivo", "academia", "industria_b2b"]);
    // Nenhum modelo é documento de saúde (dado sensível).
    expect(obrigacoes.segmentos.flatMap((s) => s.tipos.map((t) => t.nome)).join(" | ")).not.toMatch(/atestado|exame|laudo m[eé]dico|laudo de sa[uú]de/i);
  });

  it("`plataforma_garantir_automacao` aceita os gatilhos de obrigação, e a regra nasce DESLIGADA com a configuração", async () => {
    const regras: Array<[string, string, Record<string, unknown> | undefined]> = [
      ["Documento vencido · etiquetar", "obrigacao.documento_vencido", undefined],
      ["Alvará vencendo · 30 dias antes", "obrigacao.documento_vencendo", { dias: 30, tipo: "Alvará de funcionamento" }],
      ["Documento não enviado há 5 dias", "obrigacao.documento_nao_enviado", { dias: 5 }],
      ["Documento recebido · etiquetar", "obrigacao.documento_recebido", undefined],
      ["Atividade chegando · 4 dias antes", "obrigacao.atividade_chegando", { dias: 4 }],
    ];
    for (const [nome, gatilho, configuracao] of regras) {
      await ok("plataforma_garantir_automacao", {
        organization_id: ORG,
        nome,
        gatilho,
        acoes: [{ type: "add_tag", config: { tags: ["Documentos"] } }],
        ...(configuracao ? { configuracao_do_gatilho: configuracao } : {}),
      });
    }
    const gravadas = await linhas<{ name: string; trigger_event: string; trigger_config: Record<string, unknown>; is_active: boolean }>(
      "select name, trigger_event, trigger_config, is_active from public.automation_rules where organization_id = $1 order by trigger_event",
    );
    expect(gravadas.map((g) => [g.trigger_event, g.is_active])).toEqual([
      ["obrigacao.atividade_chegando", false],
      ["obrigacao.documento_nao_enviado", false],
      ["obrigacao.documento_recebido", false],
      ["obrigacao.documento_vencendo", false],
      ["obrigacao.documento_vencido", false],
    ]);
    expect(gravadas.find((g) => g.trigger_event === "obrigacao.documento_vencendo")!.trigger_config).toEqual({ dias: 30, tipo: "Alvará de funcionamento" });
  });

  it("o gatilho de X dias sem o X é recusado na porta, e nada é gravado", async () => {
    const r = await mcp.chamar("plataforma_garantir_automacao", {
      organization_id: ORG,
      nome: "Sem dias",
      gatilho: "obrigacao.documento_vencendo",
      acoes: [{ type: "add_tag", config: { tags: ["Documentos"] } }],
    });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("dias");
    expect(await numero("select count(*)::int as n from public.automation_rules where organization_id = $1 and name = 'Sem dias'")).toBe(0);
  });
});

describe("5 · ⭐ a varredura dos avisos", () => {
  const VENCEU_ONTEM = "90189018-8888-4000-8000-0000000000d1";
  const VENCEU_ANTEONTEM = "90189018-8888-4000-8000-0000000000d2";
  const VENCE_EM_30 = "90189018-8888-4000-8000-0000000000d3";
  const PEDIDO_HA_5 = "90189018-8888-4000-8000-0000000000d4";
  const varrer = () => varrerAvisosDeObrigacao(estado.cliente as never, new Date(), { aQualquerHora: true });
  const eventosDo = (item: string) =>
    numero("select count(*)::int as n from public.event_log where organization_id = $1 and entity_id = $2 and event_type like 'obrigacao.%'", [ORG, item]);

  it("regra desligada não varre nada", async () => {
    const r = await varrer();
    expect(r).toMatchObject({ regras: 0, emitidos: 0 });
    expect(await eventosDeObrigacao()).toBe(0);
  });

  it("as regras são ligadas, e itens que já existiam há tempo entram na base", async () => {
    for (const regra of [
      "Documento vencido · etiquetar",
      "Alvará vencendo · 30 dias antes",
      "Documento não enviado há 5 dias",
      "Atividade chegando · 4 dias antes",
      "Documento recebido · etiquetar",
    ]) {
      await ok("plataforma_ligar_automacao", { organization_id: ORG, regra, ligada: true });
    }
    // Itens que a empresa já acompanhava no sistema (não vieram da migração de hoje).
    await pool.query(
      `insert into public.mia_obrigacoes (id, organization_id, nome, categoria, recorrencia, validade_meses, empresa_id, pedido_em, recebido_em, valido_ate, sem_aviso_antes_de) values
         ($1, $5, 'Licença sanitária', 'documento', 'anual', 12, $6, null, $7::date - 366, $7::date - 1, $7::date - 400),
         ($2, $5, 'AVCB (vistoria dos bombeiros)', 'documento', 'unica', 0, $6, null, $7::date - 700, $7::date - 2, $7::date - 400),
         ($3, $5, 'Alvará de funcionamento', 'documento', 'anual', 12, $8, null, $7::date - 335, $7::date + 30, $7::date - 400),
         ($4, $5, 'Certificado digital', 'documento', 'anual', 12, $8, $7::date - 5, null, null, $7::date - 400)`,
      [VENCEU_ONTEM, VENCEU_ANTEONTEM, VENCE_EM_30, PEDIDO_HA_5, ORG, PADARIA, HOJE, TRANSPORTADORA],
    );
    // O cliente já mandou um arquivo do certificado, e o agente propôs: espera uma pessoa.
    await pool.query(
      `insert into public.mia_obrigacoes_propostas (organization_id, obrigacao_id, ciclo, contact_id, arquivo_nome, situacao)
         values ($1, $2, 1, $3, 'certificado.pdf', 'pendente')`,
      [ORG, PEDIDO_HA_5, CONTATO],
    );
  });

  it("⭐ dispara o que venceu ontem, o que vence em 30 dias e a atividade a 4 dias; segura o não enviado; e nada do passado", async () => {
    const r = await varrer();
    expect(r.regras).toBe(4);
    expect(r.organizacoes).toBe(1);
    expect(r.emitidos).toBe(3);
    expect(r.segurados).toBe(1);

    // Venceu ontem: o dia do disparo é HOJE, e a regra foi ligada hoje.
    expect(await eventosDo(VENCEU_ONTEM)).toBe(1);
    // Venceu anteontem: o disparo era de ontem, antes de a regra ser ligada. Não sai.
    expect(await eventosDo(VENCEU_ANTEONTEM)).toBe(0);
    // O alvará MIGRADO (venceu há 3 dias): entrou no sistema hoje, não manda aviso atrasado.
    const [migrado] = await linhas<{ id: string }>(
      "select id from public.mia_obrigacoes where organization_id = $1 and nome = 'Alvará de funcionamento' and empresa_id = $2",
      [ORG, PADARIA],
    );
    expect(await eventosDo(migrado!.id)).toBe(0);
    // Vence em 30 dias, e a regra é só para alvará.
    expect(await eventosDo(VENCE_EM_30)).toBe(1);
    // Não enviado há 5 dias, com arquivo esperando confirmação: segurado, sem evento.
    expect(await eventosDo(PEDIDO_HA_5)).toBe(0);
    const [segurado] = await linhas<{ segurado: boolean; event_id: string | null }>(
      "select segurado, event_id from public.mia_obrigacoes_avisos where organization_id = $1 and obrigacao_id = $2",
      [ORG, PEDIDO_HA_5],
    );
    expect(segurado).toEqual({ segurado: true, event_id: null });
    // O contrato social migrado, pedido há 9 dias: o dia do disparo ficou para trás. Não sai.
    const [contrato] = await linhas<{ id: string }>("select id from public.mia_obrigacoes where organization_id = $1 and nome = 'Contrato social'");
    expect(await eventosDo(contrato!.id)).toBe(0);
    // A atividade a 4 dias foi migrada hoje e o disparo é hoje: avisa.
    const [relatorio] = await linhas<{ id: string }>("select id from public.mia_obrigacoes where organization_id = $1 and nome = 'Relatório mensal'");
    expect(await eventosDo(relatorio!.id)).toBe(1);
  });

  it("o evento é dirigido à regra, leva o item como entidade e o que as ações precisam", async () => {
    const [evento] = await linhas<{ event_type: string; entity_kind: string; payload: Record<string, unknown>; status: string }>(
      "select event_type, entity_kind, payload, status from public.event_log where organization_id = $1 and entity_id = $2",
      [ORG, VENCE_EM_30],
    );
    const [regra] = await linhas<{ id: string }>("select id from public.automation_rules where organization_id = $1 and trigger_event = 'obrigacao.documento_vencendo'");
    expect(evento).toMatchObject({ event_type: "obrigacao.documento_vencendo", entity_kind: "mia_obrigacao", status: "pending" });
    expect(evento!.payload).toMatchObject({ rule_id: regra!.id, dias: 30, ciclo: 1, ancora: dia(30), local_date: HOJE, nome: "Alvará de funcionamento", empresa_id: TRANSPORTADORA });
  });

  it("⭐ a segunda rodada do mesmo dia não emite nada: uma vez por regra, item e ciclo", async () => {
    const antes = await eventosDeObrigacao();
    const r = await varrer();
    expect(r.emitidos).toBe(0);
    expect(r.pulados.ja_emitido).toBe(3);
    expect(await eventosDeObrigacao()).toBe(antes);
  });

  it("⭐ a pessoa diz que o arquivo não é o documento: o aviso segurado sai, uma vez", async () => {
    await pool.query("update public.mia_obrigacoes_propostas set situacao = 'recusada', decidida_em = now() where obrigacao_id = $1", [PEDIDO_HA_5]);
    const r = await varrer();
    expect(r.emitidos).toBe(1);
    expect(await eventosDo(PEDIDO_HA_5)).toBe(1);
    expect((await varrer()).emitidos).toBe(0);
    expect(await eventosDo(PEDIDO_HA_5)).toBe(1);
  });

  it("⭐ renovado pela migração (recebimento mais novo): o ciclo anterior vai ao histórico, sem evento de documento recebido", async () => {
    const antes = await eventosDeObrigacao();
    const r = await ok("plataforma_garantir_obrigacoes", {
      organization_id: ORG,
      origem: "planilha",
      obrigacoes: [{ tipo: "Licença sanitária", empresa_id: PADARIA, recebido_em: HOJE, valido_ate: dia(365) }],
    });
    // A licença já existia, criada pela tela (sem chave): a migração a ADOTA em
    // vez de criar uma gêmea, e o recebimento mais novo fecha o ciclo dela.
    expect(r.dados).toMatchObject({ criou: 0, atualizou: 1 });
    expect((r.dados.itens as Array<{ id: string; avisos?: string[] }>)[0]).toMatchObject({ id: VENCEU_ONTEM });
    expect((r.dados.itens as Array<{ avisos?: string[] }>)[0]!.avisos?.join(" ")).toContain("já existia");
    expect(
      await linhas<{ ciclo: number; com_chave: boolean }>(
        "select ciclo, (chave_natural is not null) as com_chave from public.mia_obrigacoes where organization_id = $1 and nome = 'Licença sanitária' and empresa_id = $2",
        [ORG, PADARIA],
      ),
    ).toEqual([{ ciclo: 2, com_chave: true }]);
    // E a segunda vez a encontra pela chave: nada muda.
    const deNovo = await ok("plataforma_garantir_obrigacoes", {
      organization_id: ORG,
      origem: "planilha",
      obrigacoes: [{ tipo: "Licença sanitária", empresa_id: PADARIA, recebido_em: HOJE, valido_ate: dia(365) }],
    });
    expect(deNovo.dados).toMatchObject({ criou: 0, atualizou: 0, ja_estava: 1 });
    const renovar = await ok("plataforma_garantir_obrigacoes", {
      organization_id: ORG,
      origem: "planilha",
      obrigacoes: [{ tipo: "Alvará de funcionamento", empresa_cnpj: "11222333000181", recebido_em: HOJE, valido_ate: dia(730) }],
    });
    expect(renovar.dados).toMatchObject({ atualizou: 1 });
    expect((renovar.dados.itens as Array<{ avisos?: string[] }>)[0]!.avisos?.[0]).toContain("o ciclo anterior foi para o histórico");
    const [alvara] = await linhas<{ id: string; ciclo: number; recebido_em: string; valido_ate: string; renovado_em: string }>(
      "select id, ciclo, recebido_em, valido_ate, renovado_em from public.mia_obrigacoes where organization_id = $1 and nome = 'Alvará de funcionamento' and empresa_id = $2",
      [ORG, PADARIA],
    );
    expect(alvara).toMatchObject({ ciclo: 2, recebido_em: HOJE, valido_ate: dia(730), renovado_em: HOJE });
    const historico = await linhas<{ ciclo: number; como: string; recebido_em: string; valido_ate: string }>(
      "select ciclo, como, recebido_em, valido_ate from public.mia_obrigacoes_ciclos where obrigacao_id = $1",
      [alvara!.id],
    );
    expect(historico).toEqual([{ ciclo: 1, como: "recebido", recebido_em: dia(-368), valido_ate: dia(-3) }]);
    // Há regra LIGADA de "documento recebido", e mesmo assim a migração não a acorda.
    expect(await eventosDeObrigacao()).toBe(antes);
  });

  it("empresa parada não é varrida", async () => {
    await pool.query("update public.organizations set status = 'suspended' where id = $1", [ORG]);
    try {
      const r = await varrer();
      expect(r.organizacoes).toBe(0);
      expect(r.pulados.organizacao_parada).toBe(1);
    } finally {
      await pool.query("update public.organizations set status = 'active' where id = $1", [ORG]);
    }
  });
});

describe("6 · os botões da tela, pelo mesmo código das rotas", () => {
  const ctx = () => ({ db: estado.cliente as never, org: ORG, ator: IMPLANTADOR, hoje: HOJE });
  const recusa = async (promessa: Promise<unknown>): Promise<string> =>
    promessa.then(
      () => "passou",
      (e: unknown) => (e instanceof operacoes.ErroDeObrigacao ? e.codigo : `erro inesperado: ${String(e)}`),
    );
  let documento = "";
  let atividade = "";

  it("adicionar: o documento nasce a pedir, ligado à empresa, e para os avisos nasce hoje", async () => {
    const item = await operacoes.adicionarObrigacao(ctx(), {
      nome: "Certidão negativa de débitos",
      categoria: "documento",
      empresa_id: TRANSPORTADORA,
      validade_meses: 6,
      avisos_dias: [15, 30],
    });
    documento = item.id;
    expect(item).toMatchObject({ categoria: "documento", empresa_id: TRANSPORTADORA, pedido_em: null, recebido_em: null, valido_ate: null, ciclo: 1, avisos_dias: [30, 15], origem: "tela", sem_aviso_antes_de: HOJE });
  });

  it("adicionar recusa o item sem dono e o dono de outra empresa", async () => {
    expect(await recusa(operacoes.adicionarObrigacao(ctx(), { nome: "Solto", categoria: "documento" }))).toBe("validacao");
    expect(
      await recusa(operacoes.adicionarObrigacao(ctx(), { nome: "Alheio", categoria: "documento", empresa_id: "90189018-7777-4000-8000-0000000000ff" })),
    ).toBe("nao_encontrado");
    expect(
      await recusa(operacoes.adicionarObrigacao(ctx(), { nome: "Sem N", categoria: "atividade", lead_id: NEGOCIO, recorrencia: "n_meses" })),
    ).toBe("validacao");
  });

  it("⭐ Marcar pedido põe prazo de 7 dias; Pedir de novo é cobrança e não muda a data do pedido", async () => {
    const pedido = await operacoes.pedirObrigacao(ctx(), documento);
    expect(pedido.modo).toBe("pedido");
    expect(pedido.item).toMatchObject({ pedido_em: HOJE, prazo_em: dia(7), cobrado_em: null });
    await pool.query("update public.mia_obrigacoes set pedido_em = $2, prazo_em = $3 where id = $1", [documento, dia(-3), dia(4)]);
    const deNovo = await operacoes.pedirObrigacao(ctx(), documento);
    expect(deNovo.modo).toBe("pedido_de_novo");
    expect(deNovo.item).toMatchObject({ pedido_em: dia(-3), prazo_em: dia(4), cobrado_em: HOJE });
  });

  it("⭐ receber sem 'válido até': recebido, sem validade, e o pedido se fecha; sem ciclo novo no primeiro recebimento", async () => {
    const r = await operacoes.receberObrigacao(ctx(), documento, { valido_ate: null, arquivo: null });
    expect(r.renovou).toBe(false);
    expect(r.item).toMatchObject({ recebido_em: HOJE, valido_ate: null, pedido_em: null, prazo_em: null, cobrado_em: null, ciclo: 1, renovado_em: null });
  });

  it("⭐ receber a versão nova: o ciclo anterior vai ao histórico, com o arquivo dele, e o item segue com o novo", async () => {
    const caminho = (nome: string) => `${ORG}/${documento}/${nome}.pdf`;
    await operacoes.anexarArquivo(ctx(), documento, { path: caminho("primeira"), nome: "certidao-1.pdf", mime: "application/pdf", bytes: 10 });
    const r = await operacoes.receberObrigacao(ctx(), documento, {
      valido_ate: dia(180),
      arquivo: { path: caminho("segunda"), nome: "certidao-2.pdf", mime: "application/pdf", bytes: 20 },
    });
    expect(r.renovou).toBe(true);
    expect(r.item).toMatchObject({ ciclo: 2, recebido_em: HOJE, valido_ate: dia(180), renovado_em: HOJE, arquivo_path: caminho("segunda"), arquivo_nome: "certidao-2.pdf" });
    const detalhe = await lerDetalhe(estado.cliente as never, ORG, documento);
    expect(detalhe?.ciclos).toHaveLength(1);
    expect(detalhe?.ciclos[0]).toMatchObject({ ciclo: 1, como: "recebido", recebido_em: HOJE, valido_ate: null, arquivo_nome: "certidao-1.pdf", tem_arquivo: true });
    // O arquivo que foi para o histórico continua guardado: não entrou na fila de remoção.
    expect(
      await numero("select count(*)::int as n from public.storage_redaction_queue where organization_id = $1 and object_path = $2", [ORG, caminho("primeira")]),
    ).toBe(0);
    // A tela nunca recebe o caminho do arquivo: só sabe que ele existe.
    expect(detalhe?.item).toMatchObject({ tem_arquivo: true });
    expect(detalhe?.item).not.toHaveProperty("arquivo_path");
  });

  it("⭐ documento recebido por uma PESSOA avisa a regra ligada, uma vez", async () => {
    const [item] = await linhas<Record<string, unknown>>("select * from public.mia_obrigacoes where id = $1", [documento]);
    const antes = await eventosDeObrigacao();
    expect(await avisarDocumentoRecebido(estado.cliente as never, ORG, item as never, HOJE)).toBe(1);
    expect(await avisarDocumentoRecebido(estado.cliente as never, ORG, item as never, HOJE)).toBe(0);
    expect(await eventosDeObrigacao()).toBe(antes + 1);
    const [evento] = await linhas<{ event_type: string; payload: Record<string, unknown> }>(
      "select event_type, payload from public.event_log where organization_id = $1 and entity_id = $2",
      [ORG, documento],
    );
    expect(evento).toMatchObject({ event_type: "obrigacao.documento_recebido", payload: { nome: "Certidão negativa de débitos", ciclo: 2, ancora: HOJE } });
  });

  it("corrigir a data não abre ciclo; data de atividade num documento é recusada", async () => {
    const r = await operacoes.editarObrigacao(ctx(), documento, { valido_ate: dia(200), observacao: "  Emitida no portal.  " });
    expect(r.campos.sort()).toEqual(["observacao", "valido_ate"]);
    expect(r.item).toMatchObject({ valido_ate: dia(200), observacao: "Emitida no portal.", ciclo: 2 });
    expect(await recusa(operacoes.editarObrigacao(ctx(), documento, { proxima_em: dia(10) }))).toBe("validacao");
    expect(await recusa(operacoes.editarObrigacao(ctx(), documento, { valido_ate: "2026-02-30" }))).toBe("validacao");
    expect(await recusa(operacoes.marcarFeita(ctx(), documento))).toBe("validacao");
  });

  it("⭐ marcar feita: a próxima data nasce um período depois da prevista, e a que não se repete termina", async () => {
    const mensal = await operacoes.adicionarObrigacao(ctx(), { nome: "Relatório de visitas", categoria: "atividade", lead_id: NEGOCIO, recorrencia: "mensal", proxima_em: dia(2), avisos_dias: [5] });
    atividade = mensal.id;
    expect(mensal).toMatchObject({ quem_entrega: "nos", proxima_em: dia(2), validade_meses: 0 });
    const feita = await operacoes.marcarFeita(ctx(), atividade);
    expect(feita.item).toMatchObject({ ciclo: 2, feita_em: HOJE });
    expect(feita.item.proxima_em).toBe(feita.proxima_em);
    expect(feita.proxima_em! > dia(27) && feita.proxima_em! < dia(35)).toBe(true);
    expect(await recusa(operacoes.pedirObrigacao(ctx(), atividade))).toBe("validacao");
    expect(await recusa(operacoes.receberObrigacao(ctx(), atividade, { valido_ate: null, arquivo: null }))).toBe("validacao");

    const unica = await operacoes.adicionarObrigacao(ctx(), { nome: "Visita de entrega", categoria: "atividade", lead_id: NEGOCIO, recorrencia: "unica", proxima_em: dia(1) });
    const fim = await operacoes.marcarFeita(ctx(), unica.id);
    expect(fim).toMatchObject({ proxima_em: null });
    expect(fim.item).toMatchObject({ proxima_em: null, feita_em: HOJE });
    expect(await recusa(operacoes.marcarFeita(ctx(), unica.id))).toBe("validacao");
  });

  it("⭐ 'Não é': a proposta fica recusada, o item continua como estava, e a segunda decisão é recusada", async () => {
    const pedido = await operacoes.adicionarObrigacao(ctx(), { nome: "Contrato assinado", categoria: "documento", lead_id: NEGOCIO, pedido_em: dia(-2), prazo_em: dia(5) });
    const { rows } = await pool.query<{ id: string }>(
      `insert into public.mia_obrigacoes_propostas (organization_id, obrigacao_id, ciclo, contact_id, arquivo_nome, situacao)
         values ($1, $2, 1, $3, 'contrato.pdf', 'pendente') returning id`,
      [ORG, pedido.id, CONTATO],
    );
    const proposta = rows[0]!.id;
    expect(await operacoes.recusarProposta(ctx(), proposta)).toEqual({ obrigacao_id: pedido.id });
    const [depois] = await linhas<{ recebido_em: string | null; pedido_em: string; situacao: string; decidida_por_user_id: string }>(
      `select o.recebido_em, o.pedido_em, p.situacao, p.decidida_por_user_id
         from public.mia_obrigacoes o join public.mia_obrigacoes_propostas p on p.obrigacao_id = o.id where p.id = $1`,
      [proposta],
    );
    expect(depois).toEqual({ recebido_em: null, pedido_em: dia(-2), situacao: "recusada", decidida_por_user_id: IMPLANTADOR });
    expect(await recusa(operacoes.recusarProposta(ctx(), proposta))).toBe("conflito");
  });

  it("a leitura do cartão aberto traz o que é do negócio, da empresa dele e do contato dele, com os nomes", async () => {
    const leitura = await lerObrigacoes(estado.cliente as never, ORG, { tipo: "negocio", id: NEGOCIO });
    expect(leitura?.contexto).toMatchObject({
      negocio: { id: NEGOCIO, titulo: "Padaria · gestão mensal", empresa_id: PADARIA, contact_id: CONTATO },
      empresa: { id: PADARIA, nome: "Padaria Trigo Dourado 9018" },
      contato: { id: CONTATO, nome: "Contato 9018 MCP" },
    });
    const donos = new Set(leitura!.itens.map((i) => (i.lead_id === NEGOCIO ? "negocio" : i.empresa_id === PADARIA ? "empresa" : i.contact_id === CONTATO ? "contato" : "outro")));
    expect([...donos].sort()).toEqual(["contato", "empresa", "negocio"]);
    // Nada da outra empresa entra no cartão deste negócio.
    expect(leitura!.itens.some((i) => i.empresa_id === TRANSPORTADORA)).toBe(false);
    const cnh = leitura!.itens.find((i) => i.nome === "CNH")!;
    expect(cnh.vinculos.contato).toEqual({ id: CONTATO, nome: "Contato 9018 MCP" });
    expect(cnh).not.toHaveProperty("chave_natural");
  });

  it("as fichas e a lista geral leem pelo mesmo caminho; dono que não existe devolve nada", async () => {
    const daEmpresa = await lerObrigacoes(estado.cliente as never, ORG, { tipo: "empresa", id: PADARIA });
    expect(daEmpresa?.contexto.contatos_da_empresa).toEqual([{ id: CONTATO, nome: "Contato 9018 MCP" }]);
    // Da empresa, do contato dela e dos negócios dela.
    expect(daEmpresa!.itens.some((i) => i.empresa_id === PADARIA)).toBe(true);
    expect(daEmpresa!.itens.some((i) => i.contact_id === CONTATO)).toBe(true);
    expect(daEmpresa!.itens.some((i) => i.lead_id === NEGOCIO)).toBe(true);
    const doContato = await lerObrigacoes(estado.cliente as never, ORG, { tipo: "contato", id: CONTATO });
    expect(doContato?.contexto.empresa).toMatchObject({ id: PADARIA });
    expect(doContato!.itens.some((i) => i.lead_id === NEGOCIO && !i.empresa_id && !i.contact_id)).toBe(false);
    const lista = await lerObrigacoes(estado.cliente as never, ORG, { tipo: "lista" });
    expect(lista?.cortada).toBe(false);
    expect(lista!.itens.length).toBe(await numero("select count(*)::int as n from public.mia_obrigacoes where organization_id = $1 and arquivado_em is null"));
    expect(await lerObrigacoes(estado.cliente as never, ORG, { tipo: "negocio", id: "90189018-6666-4000-8000-0000000000ff" })).toBeNull();
  });

  it("arquivar tira o item das listas e guarda o histórico; o item arquivado não aceita mais os botões", async () => {
    const antes = (await lerObrigacoes(estado.cliente as never, ORG, { tipo: "lista" }))!.itens.length;
    await operacoes.arquivarObrigacao(ctx(), atividade);
    expect((await lerObrigacoes(estado.cliente as never, ORG, { tipo: "lista" }))!.itens.length).toBe(antes - 1);
    expect(await numero("select count(*)::int as n from public.mia_obrigacoes_ciclos where obrigacao_id = $1", [atividade])).toBe(1);
    expect(await recusa(operacoes.marcarFeita(ctx(), atividade))).toBe("nao_encontrado");
  });
});
