/**
 * FORK MIA — OBRIGAÇÕES · a LEITURA para cartão, ficha e lista.
 *
 * Uma leitura só, por ESCOPO: de onde a tela está olhando.
 *
 *   negócio   os itens do negócio, os da empresa dele e os do contato dele
 *             (a herança, `heranca.ts`)
 *   empresa   os itens da empresa, os dos contatos dela e os dos negócios dela
 *   contato   os itens da pessoa e os da empresa dela
 *   lista     todos os itens da organização (a agenda de renovações)
 *
 * O cliente do banco é o de QUEM PEDE: a RLS decide o que aparece (o item de um
 * negócio que a pessoa não enxerga não vem). O MCP e a varredura passam o
 * cliente de serviço, e por isso TODA consulta daqui carrega o filtro de
 * organização na mão.
 *
 * A situação NÃO é calculada aqui: a tela recebe as datas e chama
 * `situacao.ts` com o "hoje" do fuso da empresa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { buscaEmLotesSemTeto } from "@/lib/leitura/em-lotes-sem-teto";
import { lerTodasAsPaginas, TAMANHO_DA_PAGINA } from "@/lib/leitura/todas-as-paginas";
import { buscaEmLotes } from "@/lib/supabase/em-lotes";

import {
  COLUNAS_DA_OBRIGACAO,
  type AvisoDisparado,
  type CicloEncerrado,
  type DetalheDaObrigacao,
  type EscopoDaLeitura,
  type Obrigacao,
  type ObrigacaoNaTela,
  type PropostaDecidida,
  type PropostaPendente,
} from "./tipos";

type Db = SupabaseClient;

/** Quantos itens a lista geral traz. Acima disso, a tela avisa e pede filtro. */
export const TETO_DA_LISTA = 3000;
/** Quantos negócios e contatos de uma empresa entram na leitura da ficha. */
const TETO_DA_EMPRESA = 500;

const COLUNAS_DO_CONTATO = "id, name, display_name, phone_number, empresa_id, is_anonymized";

interface LinhaDoContato {
  id: string;
  name: string | null;
  display_name: string | null;
  phone_number: string | null;
  empresa_id: string | null;
  is_anonymized: boolean | null;
}

/** O contexto do escopo: quem é o dono da tela, para o formulário de adicionar. */
export interface ContextoDoEscopo {
  negocio: { id: string; titulo: string; pipeline_id: string | null; empresa_id: string | null; contact_id: string | null; dono_user_id: string | null } | null;
  empresa: { id: string; nome: string } | null;
  contato: { id: string; nome: string; empresa_id: string | null } | null;
  /** Só no escopo de empresa: as pessoas dela, para ligar um item a uma delas. */
  contatos_da_empresa: Array<{ id: string; nome: string }>;
}

export interface LeituraDeObrigacoes {
  itens: ObrigacaoNaTela[];
  contexto: ContextoDoEscopo;
  /** A lista geral chegou ao teto: há mais itens do que os devolvidos. */
  cortada: boolean;
}

function nomeNaTela(c: LinhaDoContato | null | undefined): string {
  if (!c || c.is_anonymized) return "Contato";
  return nomeDoContato(c) ?? "Contato";
}

function falhar(oQue: string, erro: { message: string } | null): void {
  if (erro) throw new Error(`não consegui ler ${oQue}: ${erro.message}`);
}

async function itensPor(
  db: Db,
  org: string,
  coluna: "lead_id" | "empresa_id" | "contact_id",
  ids: readonly string[],
): Promise<Obrigacao[]> {
  // VÁRIAS obrigações por dono: 100 negócios com 15 documentos cada são 1.500
  // linhas num lote só, e o PostgREST cortaria em 1000 sem avisar.
  const r = await buscaEmLotesSemTeto<Obrigacao>(ids, (lote, contagem) =>
    db
      .from("mia_obrigacoes")
      .select(COLUNAS_DA_OBRIGACAO, contagem)
      .eq("organization_id", org)
      .is("arquivado_em", null)
      .in(coluna, lote),
  );
  falhar("as obrigações", r.error);
  return r.data;
}

/**
 * Do mais antigo para o mais novo, com `id` no empate.
 *
 * A leitura já pede essa ordem ao banco (`created_at`, depois `id`, que é o que
 * deixa o `range` correto entre as páginas). Repetir aqui garante a MESMA ordem
 * em cliente que só guarda a última ordenação pedida, como o adaptador de
 * Postgres dos invariantes: lá o desempate por `id` apagaria o `created_at`.
 */
function doMaisAntigoParaOMaisNovo<T extends { id: string; created_at: string }>(itens: T[]): T[] {
  return [...itens].sort((a, b) => {
    const quando = Date.parse(a.created_at) - Date.parse(b.created_at);
    if (quando !== 0 && !Number.isNaN(quando)) return quando;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Junta por id: o mesmo item pode vir por duas chaves (do negócio E da empresa dele). */
function semRepetir(grupos: Obrigacao[][]): Obrigacao[] {
  const porId = new Map<string, Obrigacao>();
  for (const grupo of grupos) for (const item of grupo) porId.set(item.id, item);
  return [...porId.values()];
}

/**
 * Lê as obrigações de um escopo, ou `null` quando o dono do escopo não existe
 * (ou não é visível para quem pede).
 */
export async function lerObrigacoes(db: Db, org: string, escopo: EscopoDaLeitura): Promise<LeituraDeObrigacoes | null> {
  const contexto: ContextoDoEscopo = { negocio: null, empresa: null, contato: null, contatos_da_empresa: [] };
  let itens: Obrigacao[] = [];
  let cortada = false;

  if (escopo.tipo === "negocio") {
    const { data, error } = await db
      .from("crm_leads")
      .select("id, title, pipeline_id, empresa_id, contact_id, owner_user_id")
      .eq("organization_id", org)
      .eq("id", escopo.id)
      .maybeSingle();
    falhar("o negócio", error);
    if (!data) return null;
    const lead = data as { id: string; title: string; pipeline_id: string | null; empresa_id: string | null; contact_id: string | null; owner_user_id: string | null };
    contexto.negocio = {
      id: lead.id,
      titulo: lead.title,
      pipeline_id: lead.pipeline_id,
      empresa_id: lead.empresa_id,
      contact_id: lead.contact_id,
      dono_user_id: lead.owner_user_id,
    };
    itens = semRepetir(
      await Promise.all([
        itensPor(db, org, "lead_id", [lead.id]),
        lead.empresa_id ? itensPor(db, org, "empresa_id", [lead.empresa_id]) : Promise.resolve([]),
        lead.contact_id ? itensPor(db, org, "contact_id", [lead.contact_id]) : Promise.resolve([]),
      ]),
    );
  } else if (escopo.tipo === "empresa") {
    const { data, error } = await db
      .from("crm_empresas")
      .select("id, nome")
      .eq("organization_id", org)
      .eq("id", escopo.id)
      .maybeSingle();
    falhar("a empresa", error);
    if (!data) return null;
    const empresa = data as { id: string; nome: string };
    contexto.empresa = empresa;
    const [contatos, negocios] = await Promise.all([
      db.from("contacts").select(COLUNAS_DO_CONTATO).eq("organization_id", org).eq("empresa_id", empresa.id).limit(TETO_DA_EMPRESA),
      db.from("crm_leads").select("id").eq("organization_id", org).eq("empresa_id", empresa.id).limit(TETO_DA_EMPRESA),
    ]);
    falhar("os contatos da empresa", contatos.error);
    falhar("os negócios da empresa", negocios.error);
    const pessoas = (contatos.data ?? []) as unknown as LinhaDoContato[];
    contexto.contatos_da_empresa = pessoas.map((p) => ({ id: p.id, nome: nomeNaTela(p) }));
    itens = semRepetir(
      await Promise.all([
        itensPor(db, org, "empresa_id", [empresa.id]),
        itensPor(db, org, "contact_id", pessoas.map((p) => p.id)),
        itensPor(db, org, "lead_id", ((negocios.data ?? []) as Array<{ id: string }>).map((n) => n.id)),
      ]),
    );
  } else if (escopo.tipo === "contato") {
    const { data, error } = await db
      .from("contacts")
      .select(COLUNAS_DO_CONTATO)
      .eq("organization_id", org)
      .eq("id", escopo.id)
      .maybeSingle();
    falhar("o contato", error);
    if (!data) return null;
    const contato = data as unknown as LinhaDoContato;
    contexto.contato = { id: contato.id, nome: nomeNaTela(contato), empresa_id: contato.empresa_id };
    itens = semRepetir(
      await Promise.all([
        itensPor(db, org, "contact_id", [contato.id]),
        contato.empresa_id ? itensPor(db, org, "empresa_id", [contato.empresa_id]) : Promise.resolve([]),
      ]),
    );
  } else {
    // PAGINADO. O `.limit(TETO_DA_LISTA + 1)` que estava aqui nunca trouxe 3001
    // linhas: o PostgREST corta toda resposta em 1000 sem avisar, a lista parava
    // nas 1000 mais antigas, os contadores saíam delas e o `cortada` (que
    // comparava com 3000) nunca ligava. O laço é o de
    // `lib/leitura/todas-as-paginas.ts`; `id` desempata a ordem.
    const lido = await lerTodasAsPaginas<Obrigacao>(
      (de, ate, pedirContagem) =>
        db
          .from("mia_obrigacoes")
          .select(COLUNAS_DA_OBRIGACAO, pedirContagem ? { count: "exact" } : undefined)
          .eq("organization_id", org)
          .is("arquivado_em", null)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(de, ate),
      { paginasMaximas: TETO_DA_LISTA / TAMANHO_DA_PAGINA },
    );
    falhar("as obrigações", lido.erro === null ? null : { message: lido.erro });
    cortada = lido.truncado;
    itens = doMaisAntigoParaOMaisNovo(lido.linhas).slice(0, TETO_DA_LISTA);
  }

  const naTela = await paraATela(db, org, itens);

  // O nome da empresa e do contato do negócio, para os títulos dos grupos.
  if (escopo.tipo === "negocio" && contexto.negocio) {
    const [empresa, contato] = await Promise.all([
      contexto.negocio.empresa_id
        ? db.from("crm_empresas").select("id, nome").eq("organization_id", org).eq("id", contexto.negocio.empresa_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      contexto.negocio.contact_id
        ? db.from("contacts").select(COLUNAS_DO_CONTATO).eq("organization_id", org).eq("id", contexto.negocio.contact_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (empresa.data) contexto.empresa = empresa.data as { id: string; nome: string };
    if (contato.data) {
      const c = contato.data as unknown as LinhaDoContato;
      contexto.contato = { id: c.id, nome: nomeNaTela(c), empresa_id: c.empresa_id };
    }
  }
  if (escopo.tipo === "contato" && contexto.contato?.empresa_id) {
    const { data } = await db
      .from("crm_empresas")
      .select("id, nome")
      .eq("organization_id", org)
      .eq("id", contexto.contato.empresa_id)
      .maybeSingle();
    if (data) contexto.empresa = data as { id: string; nome: string };
  }

  return { itens: naTela, contexto, cortada };
}

/** Acrescenta a cada item os nomes de quem ele é e a proposta pendente; tira o caminho do arquivo. */
export async function paraATela(db: Db, org: string, itens: readonly Obrigacao[]): Promise<ObrigacaoNaTela[]> {
  if (itens.length === 0) return [];
  const leadIds = [...new Set(itens.map((i) => i.lead_id).filter((v): v is string => !!v))];
  const empresaIds = [...new Set(itens.map((i) => i.empresa_id).filter((v): v is string => !!v))];
  const contatoIdsDosItens = itens.map((i) => i.contact_id).filter((v): v is string => !!v);

  const propostas = await buscaEmLotes<{
    id: string;
    obrigacao_id: string;
    arquivo_nome: string | null;
    conversation_id: string | null;
    contact_id: string | null;
    created_at: string;
  }>(
    itens.map((i) => i.id),
    (lote) =>
      db
        .from("mia_obrigacoes_propostas")
        .select("id, obrigacao_id, arquivo_nome, conversation_id, contact_id, created_at")
        .eq("organization_id", org)
        .eq("situacao", "pendente")
        .in("obrigacao_id", lote),
  );
  falhar("as propostas do agente", propostas.error);

  const contatoIds = [
    ...new Set([...contatoIdsDosItens, ...propostas.data.map((p) => p.contact_id).filter((v): v is string => !!v)]),
  ];
  const [negocios, empresas, contatos] = await Promise.all([
    buscaEmLotes<{ id: string; title: string }>(leadIds, (lote) =>
      db.from("crm_leads").select("id, title").eq("organization_id", org).in("id", lote),
    ),
    buscaEmLotes<{ id: string; nome: string }>(empresaIds, (lote) =>
      db.from("crm_empresas").select("id, nome").eq("organization_id", org).in("id", lote),
    ),
    buscaEmLotes<LinhaDoContato>(contatoIds, (lote) =>
      db.from("contacts").select(COLUNAS_DO_CONTATO).eq("organization_id", org).in("id", lote) as unknown as PromiseLike<{
        data: LinhaDoContato[] | null;
        error: { message: string } | null;
      }>,
    ),
  ]);
  falhar("os negócios", negocios.error);
  falhar("as empresas", empresas.error);
  falhar("os contatos", contatos.error);

  const tituloDoNegocio = new Map(negocios.data.map((n) => [n.id, n.title]));
  const nomeDaEmpresa = new Map(empresas.data.map((e) => [e.id, e.nome]));
  const contatoPorId = new Map(contatos.data.map((c) => [c.id, c]));
  const propostaDoItem = new Map<string, PropostaPendente>();
  for (const p of propostas.data) {
    propostaDoItem.set(p.obrigacao_id, {
      id: p.id,
      obrigacao_id: p.obrigacao_id,
      arquivo_nome: p.arquivo_nome,
      conversation_id: p.conversation_id,
      de: p.contact_id ? nomeNaTela(contatoPorId.get(p.contact_id)) : null,
      criada_em: p.created_at,
    });
  }

  return itens.map((item) => {
    const { arquivo_path: caminho, chave_natural: _chave, ...resto } = item;
    return {
      ...resto,
      tem_arquivo: Boolean(caminho),
      vinculos: {
        negocio: item.lead_id ? { id: item.lead_id, titulo: tituloDoNegocio.get(item.lead_id) ?? "Negócio" } : null,
        empresa: item.empresa_id ? { id: item.empresa_id, nome: nomeDaEmpresa.get(item.empresa_id) ?? "Empresa" } : null,
        contato: item.contact_id ? { id: item.contact_id, nome: nomeNaTela(contatoPorId.get(item.contact_id)) } : null,
      },
      proposta: propostaDoItem.get(item.id) ?? null,
    };
  });
}

/** Um item pelo id, como o banco o guarda (com o caminho do arquivo). `null` = não existe ou não é visível. */
export async function lerObrigacao(db: Db, org: string, id: string): Promise<Obrigacao | null> {
  const { data, error } = await db
    .from("mia_obrigacoes")
    .select(COLUNAS_DA_OBRIGACAO)
    .eq("organization_id", org)
    .eq("id", id)
    .maybeSingle();
  falhar("a obrigação", error);
  return (data as unknown as Obrigacao | null) ?? null;
}

/** O detalhe de um item: ele, os ciclos anteriores, os avisos disparados e as propostas decididas. */
export async function lerDetalhe(db: Db, org: string, id: string): Promise<DetalheDaObrigacao | null> {
  const item = await lerObrigacao(db, org, id);
  if (!item) return null;
  const [naTela, ciclos, avisos, propostas] = await Promise.all([
    paraATela(db, org, [item]),
    db
      .from("mia_obrigacoes_ciclos")
      .select("id, ciclo, como, pedido_em, recebido_em, valido_ate, proxima_em, feita_em, arquivo_nome, arquivo_path, encerrado_em")
      .eq("organization_id", org)
      .eq("obrigacao_id", id)
      .order("ciclo", { ascending: false }),
    db
      .from("mia_obrigacoes_avisos")
      .select("id, gatilho, regra_id, ciclo, ancora, segurado, disparado_em")
      .eq("organization_id", org)
      .eq("obrigacao_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("mia_obrigacoes_propostas")
      .select("id, arquivo_nome, situacao, decidida_em, created_at")
      .eq("organization_id", org)
      .eq("obrigacao_id", id)
      .neq("situacao", "pendente")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  falhar("o histórico do item", ciclos.error);
  falhar("os avisos do item", avisos.error);
  falhar("as propostas do item", propostas.error);

  const linhasDeAviso = (avisos.data ?? []) as Array<{
    id: string;
    gatilho: string;
    regra_id: string;
    ciclo: number;
    ancora: string;
    segurado: boolean;
    disparado_em: string | null;
  }>;
  // O nome da regra é de leitura de gerente em algumas instalações: sem ele, o
  // histórico diz só o gatilho.
  const regras = await buscaEmLotes<{ id: string; name: string }>(
    [...new Set(linhasDeAviso.map((a) => a.regra_id))],
    (lote) => db.from("automation_rules").select("id, name").eq("organization_id", org).in("id", lote),
  );
  const nomeDaRegra = new Map(regras.data.map((r) => [r.id, r.name]));

  return {
    item: naTela[0]!,
    ciclos: ((ciclos.data ?? []) as Array<Omit<CicloEncerrado, "tem_arquivo"> & { arquivo_path: string | null }>).map(
      ({ arquivo_path: caminho, ...c }) => ({ ...c, tem_arquivo: Boolean(caminho) }),
    ),
    avisos: linhasDeAviso.map(
      (a): AvisoDisparado => ({
        id: a.id,
        gatilho: a.gatilho,
        regra: nomeDaRegra.get(a.regra_id) ?? null,
        ciclo: a.ciclo,
        ancora: a.ancora,
        segurado: a.segurado,
        disparado_em: a.disparado_em,
      }),
    ),
    propostas: ((propostas.data ?? []) as Array<{ id: string; arquivo_nome: string | null; situacao: PropostaDecidida["situacao"]; decidida_em: string | null; created_at: string }>).map(
      (p) => ({ id: p.id, arquivo_nome: p.arquivo_nome, situacao: p.situacao, decidida_em: p.decidida_em, criada_em: p.created_at }),
    ),
  };
}
