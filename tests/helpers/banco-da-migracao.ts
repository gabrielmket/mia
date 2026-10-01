/**
 * Um cliente Supabase de mentira para os testes das ferramentas de IMPORTAÇÃO
 * (`lib/mcp-plataforma/importacao/`).
 *
 * ── Por que não o `bancoEmMemoria` que já existe ──────────────────────────
 *
 * O que as ferramentas de importação medem depende de três coisas que um
 * dublê genérico não tem:
 *
 *  1. os ÍNDICES ÚNICOS: a deduplicação existe por causa deles (telefone e
 *     e-mail do contato, CNPJ da empresa, `source` + `external_id` do negócio),
 *     e o `23505` é parte do contrato;
 *  2. o GATILHO que decide a situação do negócio pela etapa
 *     (`fn_crm_lead_close_on_stage`): a importação insere o negócio na etapa
 *     final e é o banco que o declara ganho ou perdido;
 *  3. a CONTAGEM (`{ count: "exact", head: true }`), o `like` e o Storage.
 *
 * Tudo aqui imita o Postgres só no que essas três coisas pedem. A prova de que
 * o comportamento vale num banco de verdade é o invariante
 * `tests/invariants/mcp-de-migracao-importa-em-silencio.test.ts`.
 *
 * Método que não está implementado ESTOURA: um dublê que devolvesse vazio
 * deixaria o teste verde medindo nada.
 */
import { randomUUID } from "node:crypto";

export type Linha = Record<string, unknown>;

interface Erro {
  message: string;
  code?: string;
}

type Filtro = (linha: Linha) => boolean;

/** Os índices únicos PARCIAIS que a importação respeita. */
const UNICOS: Record<string, Array<{ nome: string; chave: (l: Linha) => string | null }>> = {
  contacts: [
    {
      nome: "uniq_contacts_org_phone",
      chave: (l) => (l.phone_number && !l.is_merged_into ? `${l.organization_id}|${l.phone_number}` : null),
    },
    {
      nome: "uniq_contacts_org_email",
      chave: (l) => (l.email_normalized && !l.is_merged_into ? `${l.organization_id}|${l.email_normalized}` : null),
    },
  ],
  crm_empresas: [
    { nome: "uq_crm_empresas_org_cnpj", chave: (l) => (l.cnpj ? `${l.organization_id}|${l.cnpj}` : null) },
  ],
  crm_leads: [
    {
      nome: "uniq_crm_leads_org_source_external",
      chave: (l) => (l.external_id ? `${l.organization_id}|${l.source}|${l.external_id}` : null),
    },
  ],
  ai_knowledge_sources: [
    {
      nome: "ai_knowledge_sources_nome_unico_por_org",
      chave: (l) => (l.is_active ? `${l.organization_id}|${String(l.name).trim().toLowerCase()}` : null),
    },
  ],
  proposal_templates: [
    {
      nome: "proposal_templates_ativo_por_slug_org_uidx",
      chave: (l) => (l.is_active ? `${l.organization_id}|${l.slug}` : null),
    },
  ],
};

/** Os valores que o banco preenche sozinho. */
const PADROES: Record<string, () => Linha> = {
  contacts: () => ({
    kind: "person",
    is_blocked: false,
    is_anonymized: false,
    is_merged_into: null,
    tags: [],
    custom_fields: {},
    consent: {
      marketing: { granted_at: null, source: null, version: null },
      transactional: { granted_at: null, source: null, version: null },
      profiling: { granted_at: null, source: null, version: null },
    },
    principal_na_empresa: false,
    empresa_id: null,
  }),
  crm_empresas: () => ({ tags: [], custom_fields: {}, mesclada_em: null }),
  crm_leads: () => ({ tags: [], custom_fields: {}, status: "open", closed_at: null, lost_reason: null }),
  catalog_products: () => ({ fotos: [], ativo: true }),
};

function comoPadraoLike(padrao: string): RegExp {
  const escapado = padrao.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escapado}$`);
}

export interface ArquivoGuardado {
  bucket: string;
  caminho: string;
  bytes: Uint8Array;
  contentType?: string;
}

export function bancoDaMigracao(inicial: Record<string, Linha[]> = {}) {
  const tabelas: Record<string, Linha[]> = {};
  for (const [nome, linhas] of Object.entries(inicial)) tabelas[nome] = linhas.map((l) => ({ ...l }));
  const tabela = (nome: string): Linha[] => (tabelas[nome] ??= []);

  const escritas: Array<{ tabela: string; op: "insert" | "update"; linha: Linha }> = [];
  const chamadasRpc: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const arquivos: ArquivoGuardado[] = [];
  /** Erro a devolver na PRÓXIMA escrita de uma tabela, para medir o caminho de falha. */
  const falhas: Record<string, Erro | undefined> = {};

  function derivar(nome: string, linha: Linha): void {
    if (nome === "contacts") {
      linha.email_normalized = typeof linha.email === "string" ? linha.email.trim().toLowerCase() : null;
    }
    if (nome === "crm_leads") {
      // `fn_crm_lead_close_on_stage`: quem decide a situação é a etapa.
      const etapa = tabela("crm_stages").find((e) => e.id === linha.stage_id);
      if (etapa?.is_won) {
        linha.status = "won";
        linha.closed_at ??= new Date().toISOString();
      } else if (etapa?.is_lost) {
        linha.status = "lost";
        linha.closed_at ??= new Date().toISOString();
      }
    }
  }

  function violacao(nome: string, linha: Linha): Erro | null {
    if (nome === "crm_leads" && linha.status === "lost" && !linha.lost_reason) {
      return { message: "lost_reason_required", code: "22023" };
    }
    for (const indice of UNICOS[nome] ?? []) {
      const chave = indice.chave(linha);
      if (chave === null) continue;
      if (tabela(nome).some((outra) => outra !== linha && outra.id !== linha.id && indice.chave(outra) === chave)) {
        return { message: `duplicate key value violates unique constraint "${indice.nome}"`, code: "23505" };
      }
    }
    return null;
  }

  function consulta(nome: string) {
    const filtros: Filtro[] = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Linha = {};
    let ordem: { coluna: string; asc: boolean } | null = null;
    let limite = Number.POSITIVE_INFINITY;
    let contar = false;
    let soCabecalho = false;

    function executar(): { data: Linha[] | null; count?: number; error: Erro | null } {
      const falha = op === "select" ? undefined : falhas[nome];
      if (falha) {
        falhas[nome] = undefined;
        return { data: null, error: falha };
      }
      if (op === "insert") {
        const agora = new Date().toISOString();
        const nova: Linha = { id: randomUUID(), created_at: agora, updated_at: agora, ...(PADROES[nome]?.() ?? {}), ...payload };
        derivar(nome, nova);
        const erro = violacao(nome, nova);
        if (erro) return { data: null, error: erro };
        tabela(nome).push(nova);
        escritas.push({ tabela: nome, op: "insert", linha: nova });
        return { data: [nova], error: null };
      }
      const alvo = tabela(nome).filter((l) => filtros.every((f) => f(l)));
      if (op === "update") {
        for (const linha of alvo) {
          const candidata = { ...linha, ...payload };
          derivar(nome, candidata);
          const erro = violacao(nome, candidata);
          if (erro) return { data: null, error: erro };
          Object.assign(linha, candidata);
          escritas.push({ tabela: nome, op: "update", linha });
        }
        return { data: alvo, error: null };
      }
      const resultado = [...alvo];
      if (ordem) {
        const { coluna, asc } = ordem;
        resultado.sort((a, b) => {
          const va = a[coluna] as string | number;
          const vb = b[coluna] as string | number;
          return (va < vb ? -1 : va > vb ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      if (contar) return { data: soCabecalho ? null : resultado.slice(0, limite), count: resultado.length, error: null };
      return { data: resultado.slice(0, limite), error: null };
    }

    const comparar = (c: string, teste: (valor: string | number, alvo: string | number) => boolean, v: unknown) =>
      filtros.push((l) => l[c] !== null && l[c] !== undefined && teste(l[c] as string | number, v as string | number));

    const q = {
      select(_colunas?: string, opcoes?: { count?: string; head?: boolean }) {
        if (opcoes?.count) contar = true;
        if (opcoes?.head) soCabecalho = true;
        return q;
      },
      eq(c: string, v: unknown) {
        // `fotos = '{}'` é como o PostgREST compara com a lista vazia.
        filtros.push((l) => (v === "{}" && Array.isArray(l[c]) ? (l[c] as unknown[]).length === 0 : l[c] === v));
        return q;
      },
      is(c: string, v: unknown) {
        filtros.push((l) => (l[c] ?? null) === v);
        return q;
      },
      in(c: string, valores: readonly unknown[]) {
        filtros.push((l) => valores.includes(l[c]));
        return q;
      },
      not(c: string, operador: string, v: unknown) {
        if (operador !== "is") throw new Error(`[banco-da-migracao] not(${operador}) não implementado`);
        filtros.push((l) => (l[c] ?? null) !== v);
        return q;
      },
      gt(c: string, v: unknown) {
        comparar(c, (a, b) => a > b, v);
        return q;
      },
      lt(c: string, v: unknown) {
        comparar(c, (a, b) => a < b, v);
        return q;
      },
      like(c: string, padrao: string) {
        const rx = comoPadraoLike(padrao);
        filtros.push((l) => typeof l[c] === "string" && rx.test(l[c] as string));
        return q;
      },
      order(coluna: string, opcoes?: { ascending?: boolean }) {
        ordem = { coluna, asc: opcoes?.ascending !== false };
        return q;
      },
      limit(n: number) {
        limite = n;
        return q;
      },
      insert(linha: Linha | Linha[]) {
        if (Array.isArray(linha)) throw new Error("[banco-da-migracao] insert em lote não implementado");
        op = "insert";
        payload = linha;
        return q;
      },
      update(patch: Linha) {
        op = "update";
        payload = patch;
        return q;
      },
      async maybeSingle() {
        const r = executar();
        if (r.error) return { data: null, error: r.error };
        if ((r.data ?? []).length > 1) {
          return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
        }
        return { data: r.data?.[0] ?? null, error: null };
      },
      async single() {
        const r = executar();
        if (r.error) return { data: null, error: r.error };
        if ((r.data ?? []).length !== 1) {
          return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
        }
        return { data: r.data![0]!, error: null };
      },
      then<R1, R2 = never>(
        ok?: ((v: { data: Linha[] | null; count?: number; error: Erro | null }) => R1 | PromiseLike<R1>) | null,
        falha?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
      ): PromiseLike<R1 | R2> {
        return Promise.resolve()
          .then(() => executar())
          .then(ok, falha);
      },
    };
    return q;
  }

  const cliente = {
    from: (nome: string) => consulta(nome),
    rpc: async (nome: string, args: Record<string, unknown> = {}) => {
      chamadasRpc.push({ nome, args });
      return { data: null, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (caminho: string, bytes: Uint8Array, opcoes?: { contentType?: string }) => {
          if (arquivos.some((a) => a.bucket === bucket && a.caminho === caminho)) {
            return { data: null, error: { message: "The resource already exists" } };
          }
          arquivos.push({ bucket, caminho, bytes, contentType: opcoes?.contentType });
          return { data: { path: caminho }, error: null };
        },
        remove: async (caminhos: string[]) => {
          for (const caminho of caminhos) {
            const i = arquivos.findIndex((a) => a.bucket === bucket && a.caminho === caminho);
            if (i >= 0) arquivos.splice(i, 1);
          }
          return { data: null, error: null };
        },
      }),
    },
    auth: {
      admin: {
        getUserById: async (id: string) => {
          const usuario = tabela("auth.users").find((u) => u.id === id);
          return { data: { user: usuario ?? null }, error: null };
        },
      },
    },
  };

  return {
    cliente,
    tabela,
    escritas,
    chamadasRpc,
    arquivos,
    /** Faz a PRÓXIMA escrita em `nome` falhar com este erro. */
    falharNaProximaEscrita: (nome: string, erro: Erro) => {
      falhas[nome] = erro;
    },
  };
}

export type BancoDaMigracao = ReturnType<typeof bancoDaMigracao>;

// ── a organização de teste ────────────────────────────────────────────────

export const ORG = "00000000-0000-4000-8000-0000000000a1";
export const OUTRA_ORG = "00000000-0000-4000-8000-0000000000a2";
export const AUTOR = "00000000-0000-4000-8000-0000000000b1";
export const VENDEDORA = "00000000-0000-4000-8000-0000000000b2";
export const LEITOR = "00000000-0000-4000-8000-0000000000b3";
export const TOKEN = "00000000-0000-4000-8000-0000000000c1";
export const FUNIL = "00000000-0000-4000-8000-0000000000d1";
export const ETAPA_NOVO = "00000000-0000-4000-8000-0000000000e1";
export const ETAPA_PROPOSTA = "00000000-0000-4000-8000-0000000000e2";
export const ETAPA_GANHO = "00000000-0000-4000-8000-0000000000e3";
export const ETAPA_PERDIDO = "00000000-0000-4000-8000-0000000000e4";

/**
 * Uma organização com um funil ("Comercial": Novo, Proposta enviada, Ganho,
 * Perdido), três pessoas na equipe e nada mais. Todo dado é fictício.
 */
export function organizacaoDeTeste(extra: Record<string, Linha[]> = {}): BancoDaMigracao {
  return bancoDaMigracao({
    organizations: [
      { id: ORG, display_name: "Cliente em Migração", demonstracao: false, currency: "BRL", settings: {} },
      { id: OUTRA_ORG, display_name: "Cliente Vizinho", demonstracao: false, currency: "BRL", settings: {} },
    ],
    "auth.users": [
      { id: AUTOR, email: "autor.do.token@exemplo.invalid" },
      { id: VENDEDORA, email: "vendedora@exemplo.invalid" },
      { id: LEITOR, email: "leitor@exemplo.invalid" },
    ],
    user_organizations: [
      { user_id: AUTOR, organization_id: ORG, role: "admin", revoked_at: null },
      { user_id: VENDEDORA, organization_id: ORG, role: "agent", revoked_at: null },
      { user_id: LEITOR, organization_id: ORG, role: "viewer", revoked_at: null },
    ],
    crm_pipelines: [
      {
        id: FUNIL,
        organization_id: ORG,
        name: "Comercial",
        is_archived: false,
        position: 1000,
        settings: {
          fields: [{ key: "prazo", label: "Prazo de entrega", type: "text" }],
          lost_reasons: ["Sem orçamento", { label: "Foi para o concorrente", categoria: "Concorrência" }],
        },
      },
    ],
    crm_stages: [
      { id: ETAPA_NOVO, organization_id: ORG, pipeline_id: FUNIL, name: "Novo", position: 1000, is_won: false, is_lost: false, is_archived: false },
      { id: ETAPA_PROPOSTA, organization_id: ORG, pipeline_id: FUNIL, name: "Proposta enviada", position: 2000, is_won: false, is_lost: false, is_archived: false },
      { id: ETAPA_GANHO, organization_id: ORG, pipeline_id: FUNIL, name: "Ganho", position: 3000, is_won: true, is_lost: false, is_archived: false },
      { id: ETAPA_PERDIDO, organization_id: ORG, pipeline_id: FUNIL, name: "Perdido", position: 4000, is_won: false, is_lost: true, is_archived: false },
    ],
    ...extra,
  });
}
