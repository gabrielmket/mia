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

import { paraEmpresa, type EmpresaUnica, type LinhaDaEmpresa } from "@/lib/empresas/fonte-unica";

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
  // FORK MIA (.79, empresa única): o cadastro é `companies`, e o CNPJ é único
  // por organização no `normalized_cnpj` (0448 do upstream).
  companies: [
    {
      nome: "companies_org_normalized_cnpj_uidx",
      chave: (l) => (l.normalized_cnpj ? `${l.organization_id}|${l.normalized_cnpj}` : null),
    },
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
  companies: () => ({ trade_name: null, legal_name: null, cnpj: null, normalized_cnpj: null, phone: null, email: null }),
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

  /** `fn_mia_gravar_empresa` (9034): cria ou edita, CNPJ repetido é recusado. */
  function gravarEmpresa(args: Record<string, unknown>): { data: unknown; error: Erro | null } {
    const falha = falhas.companies;
    if (falha) {
      falhas.companies = undefined;
      return { data: null, error: falha };
    }
    const org = args.p_organization_id as string;
    const id = (args.p_empresa_id as string | null) ?? null;
    const d = (args.p_dados ?? {}) as Record<string, unknown>;
    const temCnpj = "cnpj" in d;
    const digitos = typeof d.cnpj === "string" ? d.cnpj.replace(/\D/g, "") : "";
    if (temCnpj && digitos && digitos.length !== 14) return { data: null, error: { message: "cnpj_invalido" } };
    const cnpj = digitos.length === 14 ? digitos : null;
    if (cnpj) {
      const dono = tabela("companies").find((c) => c.organization_id === org && c.normalized_cnpj === cnpj && c.id !== id);
      if (dono) return { data: null, error: { message: "cnpj_ja_cadastrado", code: "23505", details: dono.id as string } as Erro };
    }
    let linha = id ? tabela("companies").find((c) => c.id === id && c.organization_id === org) : undefined;
    if (id && !linha) return { data: null, error: { message: "empresa_nao_encontrada" } };
    const criada = !linha;
    if (!linha) {
      const agora = new Date().toISOString();
      linha = {
        id: randomUUID(),
        organization_id: org,
        created_at: agora,
        updated_at: agora,
        ...PADROES.companies!(),
        created_by: typeof d.criado_por === "string" ? d.criado_por : null,
      };
      tabela("companies").push(linha);
    }
    const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    if ("nome" in d && texto(d.nome)) linha.trade_name = texto(d.nome);
    if ("razao_social" in d) linha.legal_name = texto(d.razao_social);
    if (temCnpj) {
      linha.normalized_cnpj = cnpj;
      linha.cnpj = cnpj ? `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}` : null;
    }
    if ("telefone" in d) linha.phone = texto(d.telefone);
    if ("email" in d) linha.email = texto(d.email);
    // O que é só nosso mora ao lado, em `mia_companies_extra` (1:1 pela chave).
    const atual = tabela("mia_companies_extra").find((x) => x.company_id === linha!.id);
    const extra: Linha = atual ?? {
      company_id: linha.id,
      organization_id: org,
      site: null,
      endereco: null,
      observacoes: null,
      tags: [],
      custom_fields: {},
    };
    let mudouExtra = false;
    for (const chave of ["site", "endereco", "observacoes"] as const) {
      if (chave in d) {
        extra[chave] = texto(d[chave]);
        mudouExtra = true;
      }
    }
    if ("tags" in d) {
      extra.tags = Array.isArray(d.tags) ? [...new Set(d.tags as string[])] : [];
      mudouExtra = true;
    }
    if ("custom_fields" in d) {
      extra.custom_fields = (d.custom_fields as Record<string, unknown>) ?? {};
      mudouExtra = true;
    }
    if (mudouExtra && !atual) tabela("mia_companies_extra").push(extra);
    escritas.push({ tabela: "companies", op: criada ? "insert" : "update", linha });
    return { data: { id: linha.id, criada }, error: null };
  }

  // ── O vínculo pessoa × empresa (9034), no que a importação depende dele ──
  const vivosDaPessoa = (pessoa: unknown) =>
    tabela("contacts").filter((c) => c.person_id === pessoa && !c.is_merged_into && !c.is_anonymized);

  /** `fn_mia_nova_pessoa_do_contato`: a pessoa nasce do número. */
  function pessoaDo(contato: Linha): string {
    if (typeof contato.person_id === "string") return contato.person_id;
    const id = randomUUID();
    tabela("people").push({ id, organization_id: contato.organization_id });
    contato.person_id = id;
    return id;
  }

  /** `fn_mia_espelhar_empresa_da_pessoa`: o contato mostra a empresa do cartão. */
  function espelhar(pessoa: string): void {
    const vinculos = tabela("company_people").filter((v) => v.person_id === pessoa);
    const vivos = vivosDaPessoa(pessoa);
    const cartao =
      vivos.map((c) => c.empresa_id).find((e) => vinculos.some((v) => v.company_id === e)) ??
      vinculos[0]?.company_id ??
      null;
    const v = vinculos.find((x) => x.company_id === cartao);
    for (const c of vivos) {
      c.empresa_id = cartao;
      c.cargo = v?.job_title ?? null;
      c.setor = v?.department ?? null;
      c.papel_na_empresa = v?.papel ?? null;
      c.principal_na_empresa = Boolean(v?.is_primary);
    }
  }

  /** `fn_mia_vincular_pessoa` (9034). */
  function vincularPessoa(args: Record<string, unknown>): { data: unknown; error: Erro | null } {
    const org = args.p_organization_id;
    const d = (args.p_dados ?? {}) as Record<string, unknown>;
    const contato = tabela("contacts").find((c) => c.id === args.p_contato_id && c.organization_id === org);
    if (!contato) return { data: null, error: { message: "contato_nao_encontrado", code: "P0002" } };
    if (contato.is_anonymized) return { data: null, error: { message: "contato_anonimizado", code: "22023" } };
    if (!tabela("companies").some((e) => e.id === args.p_empresa_id && e.organization_id === org)) {
      return { data: null, error: { message: "empresa_nao_encontrada", code: "P0002" } };
    }
    const papeis = ["decisor", "financeiro", "usuario", "influenciador", "outro"];
    if ("papel" in d && d.papel !== null && !papeis.includes(String(d.papel))) {
      return { data: null, error: { message: "papel_invalido", code: "22023" } };
    }
    const pessoa = pessoaDo(contato);
    let v = tabela("company_people").find((x) => x.company_id === args.p_empresa_id && x.person_id === pessoa);
    const criado = !v;
    if (!v) {
      v = {
        id: randomUUID(),
        organization_id: org,
        company_id: args.p_empresa_id,
        person_id: pessoa,
        job_title: null,
        department: null,
        papel: null,
        is_primary: false,
      };
      tabela("company_people").push(v);
      escritas.push({ tabela: "company_people", op: "insert", linha: v });
    }
    if ("cargo" in d) v.job_title = d.cargo ?? null;
    if ("setor" in d) v.department = d.setor ?? null;
    if ("papel" in d) v.papel = d.papel ?? null;
    if ("principal" in d) v.is_primary = Boolean(d.principal);
    if (v.is_primary) {
      // Um principal por empresa: quem vira principal tira o de antes.
      for (const outro of tabela("company_people")) {
        if (outro !== v && outro.company_id === v.company_id) outro.is_primary = false;
      }
    }
    const temCartao = vivosDaPessoa(pessoa).some((c) =>
      tabela("company_people").some((x) => x.person_id === pessoa && x.company_id === c.empresa_id),
    );
    if (d.no_cartao === true || !temCartao) for (const c of vivosDaPessoa(pessoa)) c.empresa_id = args.p_empresa_id;
    espelhar(pessoa);
    return { data: { vinculo_id: v.id, pessoa_id: pessoa, criado }, error: null };
  }

  /** `fn_mia_juntar_numeros` (9034): dois números, uma pessoa; os vínculos se somam. */
  function juntarNumeros(args: Record<string, unknown>): { data: unknown; error: Erro | null } {
    const org = args.p_organization_id;
    const a = tabela("contacts").find((c) => c.id === args.p_contato_id && c.organization_id === org);
    const b = tabela("contacts").find((c) => c.id === args.p_outro_contato_id && c.organization_id === org);
    if (!a || !b) return { data: null, error: { message: "contato_nao_encontrado", code: "P0002" } };
    if (a.id === b.id) return { data: null, error: { message: "mesmo_contato", code: "22023" } };
    const fica = pessoaDo(a);
    const sai = b.person_id;
    if (typeof sai === "string" && sai !== fica) {
      for (const v of tabela("company_people").filter((x) => x.person_id === sai)) {
        const ja = tabela("company_people").find((x) => x.person_id === fica && x.company_id === v.company_id);
        if (ja) tabela("company_people").splice(tabela("company_people").indexOf(v), 1);
        else v.person_id = fica;
      }
      for (const c of tabela("contacts").filter((x) => x.person_id === sai)) c.person_id = fica;
    }
    b.person_id = fica;
    espelhar(fica);
    return { data: { pessoa_id: fica }, error: null };
  }

  const cliente = {
    from: (nome: string) => consulta(nome),
    rpc: async (nome: string, args: Record<string, unknown> = {}) => {
      chamadasRpc.push({ nome, args });
      // FORK MIA (.79, empresa única): as portas da 9034 que a importação usa,
      // imitadas no que o contrato delas promete (a prova no banco de verdade é
      // tests/invariants/empresa-unica.test.ts).
      if (nome === "fn_mia_gravar_empresa") return gravarEmpresa(args);
      if (nome === "fn_mia_vincular_pessoa") return vincularPessoa(args);
      if (nome === "fn_mia_juntar_numeros") return juntarNumeros(args);
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

/**
 * FORK MIA (.79, empresa única): as empresas gravadas em `companies` (com o
 * que é só nosso, de `mia_companies_extra`, juntado pela chave), no formato que as telas e a importação
 * leem (`lib/empresas/fonte-unica.ts`). É o que os testes conferem.
 */
export function empresasGravadas(banco: BancoDaMigracao): Array<EmpresaUnica & { organization_id: string }> {
  return banco.tabela("companies").map((l) => {
    const extra = banco.tabela("mia_companies_extra").find((x) => x.company_id === l.id) ?? null;
    return { ...paraEmpresa({ ...l, extra } as unknown as LinhaDaEmpresa), organization_id: l.organization_id as string };
  });
}
