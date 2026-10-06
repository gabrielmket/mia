/**
 * FORK MIA — de onde saem as compras: negócios ganhos e pedidos do contato.
 *
 * Servidor. As regras de resumo (selo, ticket médio, intervalo, estimativa,
 * hábito) moram em `compras.ts`, puro; aqui é só a leitura, com o cliente de
 * SESSÃO (a RLS do usuário vale) e `organization_id` filtrado à mão em toda
 * consulta, como manda o CLAUDE.md para quem cruza tabelas tenant-aware.
 *
 * ─── O que é compra da EMPRESA ─────────────────────────────────────────────
 *
 * A soma de todos os contatos dela: negócio ganho ligado à empresa
 * (`crm_leads.empresa_id`) OU ganho de uma pessoa da empresa
 * (`contacts.empresa_id`), sem contar duas vezes o mesmo negócio; e os pedidos
 * de todas as pessoas da empresa. É o que responde "quanto esta conta já nos
 * rendeu, e quem comprou".
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  habitoDosCampos,
  itensDoPedido,
  PEDIDO_E_COMPRA,
  type Compra,
} from "@/lib/cartoes/compras";
import { pedidoNaReguaDoNegocio } from "@/lib/cartoes/dinheiro";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { buscaEmLotesSemTeto } from "@/lib/leitura/em-lotes-sem-teto";
import { buscaEmLotes } from "@/lib/supabase/em-lotes";

type Db = SupabaseClient;

interface LinhaDoGanho {
  id: string;
  title: string;
  value_cents: number | null;
  currency: string | null;
  closed_at: string | null;
  updated_at: string;
  contact_id: string | null;
  empresa_id: string | null;
  custom_fields: Record<string, unknown> | null;
}

interface LinhaDoPedido {
  id: string;
  external_id: string;
  total_cents: number;
  currency: string;
  payment_method: string | null;
  ordered_at: string;
  payload: unknown;
  contact_id: string | null;
  is_anonymized: boolean;
}

const COLUNAS_DO_GANHO =
  "id, title, value_cents, currency, closed_at, updated_at, contact_id, empresa_id, custom_fields";
const COLUNAS_DO_PEDIDO =
  "id, external_id, total_cents, currency, payment_method, ordered_at, payload, contact_id, is_anonymized";

function compraDoGanho(g: LinhaDoGanho, nomes: Map<string, string | null>): Compra {
  const habito = habitoDosCampos(g.custom_fields);
  return {
    id: `lead:${g.id}`,
    // `closed_at` é carimbado pelo gatilho que fecha o negócio; dado legado sem
    // ele cai no `updated_at`, a data mais próxima do fechamento que existe.
    data: g.closed_at ?? g.updated_at,
    item: g.title,
    valorCents: Number(g.value_cents ?? 0),
    moeda: g.currency ?? "BRL",
    origem: "negocio_ganho",
    referencia: g.title,
    contatoId: g.contact_id,
    contatoNome: g.contact_id ? (nomes.get(g.contact_id) ?? null) : null,
    empresaId: g.empresa_id,
    negocioId: g.id,
    pagamento: habito.pagamento,
    finalidade: habito.finalidade,
  };
}

function compraDoPedido(p: LinhaDoPedido, nomes: Map<string, string | null>, empresaId: string | null): Compra {
  return {
    id: `order:${p.id}`,
    data: p.ordered_at,
    // Pedido anonimizado (LGPD) continua contando no histórico, mas o conteúdo
    // não volta: o item vira só o número.
    item: (!p.is_anonymized && itensDoPedido(p.payload)) || `#${p.external_id}`,
    // Régua do negócio (× 100), para somar com os negócios ganhos.
    valorCents: pedidoNaReguaDoNegocio(Number(p.total_cents ?? 0), (p.currency ?? "BRL").trim()),
    moeda: (p.currency ?? "BRL").trim(),
    origem: "pedido",
    referencia: p.external_id,
    contatoId: p.contact_id,
    contatoNome: p.contact_id ? (nomes.get(p.contact_id) ?? null) : null,
    empresaId,
    negocioId: null,
    pagamento: p.is_anonymized ? null : p.payment_method,
    finalidade: null,
  };
}

async function nomesDosContatos(db: Db, org: string, ids: string[]): Promise<Map<string, string | null>> {
  const { data } = await buscaEmLotes(ids, (lote) =>
    db.from("contacts").select("id, name, display_name").eq("organization_id", org).in("id", lote),
  );
  return new Map(
    (data as Array<{ id: string; name: string | null; display_name: string | null }>).map((c) => [
      c.id,
      nomeDoContato(c),
    ]),
  );
}

/** As compras de UM contato: os negócios que ele ganhou e os pedidos dele. */
export async function listarComprasDoContato(db: Db, org: string, contactId: string): Promise<Compra[]> {
  const [ganhos, pedidos, nomes] = await Promise.all([
    db
      .from("crm_leads")
      .select(COLUNAS_DO_GANHO)
      .eq("organization_id", org)
      .eq("contact_id", contactId)
      .eq("status", "won")
      .limit(500),
    db
      .from("orders")
      .select(COLUNAS_DO_PEDIDO)
      .eq("organization_id", org)
      .eq("contact_id", contactId)
      .in("status", [...PEDIDO_E_COMPRA])
      .limit(500),
    nomesDosContatos(db, org, [contactId]),
  ]);
  if (ganhos.error) throw new Error(ganhos.error.message);
  if (pedidos.error) throw new Error(pedidos.error.message);
  return [
    ...((ganhos.data ?? []) as LinhaDoGanho[]).map((g) => compraDoGanho(g, nomes)),
    ...((pedidos.data ?? []) as LinhaDoPedido[]).map((p) => compraDoPedido(p, nomes, null)),
  ];
}

/** As compras de uma EMPRESA — a soma de todas as pessoas dela (ver o cabeçalho). */
export async function listarComprasDaEmpresa(db: Db, org: string, empresaId: string): Promise<Compra[]> {
  const { data: pessoas, error: pessoasErr } = await db
    .from("contacts")
    .select("id")
    .eq("organization_id", org)
    .eq("empresa_id", empresaId)
    .limit(500);
  if (pessoasErr) throw new Error(pessoasErr.message);
  const idsDasPessoas = ((pessoas ?? []) as Array<{ id: string }>).map((p) => p.id);

  const [daEmpresa, dasPessoas, pedidos] = await Promise.all([
    db
      .from("crm_leads")
      .select(COLUNAS_DO_GANHO)
      .eq("organization_id", org)
      .eq("empresa_id", empresaId)
      .eq("status", "won")
      .limit(500),
    // VÁRIAS compras por pessoa: ver `lib/leitura/em-lotes-sem-teto.ts`.
    buscaEmLotesSemTeto(idsDasPessoas, (lote, contagem) =>
      db
        .from("crm_leads")
        .select(COLUNAS_DO_GANHO, contagem)
        .eq("organization_id", org)
        .eq("status", "won")
        .in("contact_id", lote),
    ),
    buscaEmLotesSemTeto(idsDasPessoas, (lote, contagem) =>
      db
        .from("orders")
        .select(COLUNAS_DO_PEDIDO, contagem)
        .eq("organization_id", org)
        .in("status", [...PEDIDO_E_COMPRA])
        .in("contact_id", lote),
    ),
  ]);
  if (daEmpresa.error) throw new Error(daEmpresa.error.message);
  if (dasPessoas.error) throw new Error(dasPessoas.error.message);
  if (pedidos.error) throw new Error(pedidos.error.message);

  // O mesmo negócio pode chegar pelos dois lados (ligado à empresa E a uma
  // pessoa dela): conta uma vez.
  const ganhos = new Map<string, LinhaDoGanho>();
  for (const g of [...((daEmpresa.data ?? []) as LinhaDoGanho[]), ...(dasPessoas.data as LinhaDoGanho[])]) {
    ganhos.set(g.id, g);
  }
  const contatos = new Set<string>(idsDasPessoas);
  for (const g of ganhos.values()) if (g.contact_id) contatos.add(g.contact_id);
  const nomes = await nomesDosContatos(db, org, [...contatos]);

  return [
    ...[...ganhos.values()].map((g) => compraDoGanho(g, nomes)),
    ...(pedidos.data as LinhaDoPedido[]).map((p) => compraDoPedido(p, nomes, empresaId)),
  ];
}

export interface ContagemDeCompras {
  quantidade: number;
  totalCents: number;
  moeda: string;
}

function somar(mapa: Map<string, Map<string, { n: number; c: number }>>, chave: string, moeda: string, cents: number) {
  const porMoeda = mapa.get(chave) ?? new Map<string, { n: number; c: number }>();
  const atual = porMoeda.get(moeda) ?? { n: 0, c: 0 };
  porMoeda.set(moeda, { n: atual.n + 1, c: atual.c + cents });
  mapa.set(chave, porMoeda);
}

function consolidar(mapa: Map<string, Map<string, { n: number; c: number }>>): Map<string, ContagemDeCompras> {
  const saida = new Map<string, ContagemDeCompras>();
  for (const [chave, porMoeda] of mapa) {
    let quantidade = 0;
    let principal: [string, { n: number; c: number }] | null = null;
    for (const par of porMoeda) {
      quantidade += par[1].n;
      if (!principal || par[1].n > principal[1].n) principal = par;
    }
    if (principal) saida.set(chave, { quantidade, totalCents: principal[1].c, moeda: principal[0] });
  }
  return saida;
}

/**
 * Para o QUADRO: quantas compras cada contato e cada empresa já têm, numa
 * leitura por quadro (e não uma por cartão). Só conta e soma — a lista inteira
 * é do cartão aberto e das fichas.
 */
export async function contarComprasParaOQuadro(
  db: Db,
  org: string,
  alvo: { contatoIds: string[]; empresaIds: string[] },
): Promise<{ porContato: Map<string, ContagemDeCompras>; porEmpresa: Map<string, ContagemDeCompras> }> {
  // VÁRIAS linhas por id nas quatro leituras abaixo (pessoas de uma empresa,
  // ganhos e pedidos de uma pessoa): um lote de 100 ids pode passar de 1000
  // linhas, e o PostgREST cortaria ali sem avisar. Quem compra sempre aparecia
  // com menos compras do que fez. Ver `lib/leitura/em-lotes-sem-teto.ts`.
  const { data: pessoas } = await buscaEmLotesSemTeto(alvo.empresaIds, (lote, contagem) =>
    db.from("contacts").select("id, empresa_id", contagem).eq("organization_id", org).in("empresa_id", lote),
  );
  const empresaDaPessoa = new Map(
    (pessoas as Array<{ id: string; empresa_id: string }>).map((p) => [p.id, p.empresa_id]),
  );
  const contatos = [...new Set([...alvo.contatoIds, ...empresaDaPessoa.keys()])];

  const [porContatoGanhos, porEmpresaGanhos, pedidos] = await Promise.all([
    buscaEmLotesSemTeto(contatos, (lote, contagem) =>
      db
        .from("crm_leads")
        .select("id, contact_id, empresa_id, value_cents, currency", contagem)
        .eq("organization_id", org)
        .eq("status", "won")
        .in("contact_id", lote),
    ),
    buscaEmLotesSemTeto(alvo.empresaIds, (lote, contagem) =>
      db
        .from("crm_leads")
        .select("id, contact_id, empresa_id, value_cents, currency", contagem)
        .eq("organization_id", org)
        .eq("status", "won")
        .in("empresa_id", lote),
    ),
    buscaEmLotesSemTeto(contatos, (lote, contagem) =>
      db
        .from("orders")
        .select("id, contact_id, total_cents, currency", contagem)
        .eq("organization_id", org)
        .in("status", [...PEDIDO_E_COMPRA])
        .in("contact_id", lote),
    ),
  ]);
  for (const r of [porContatoGanhos, porEmpresaGanhos, pedidos]) {
    if (r.error) throw new Error(r.error.message);
  }

  const contato = new Map<string, Map<string, { n: number; c: number }>>();
  const empresa = new Map<string, Map<string, { n: number; c: number }>>();
  const contadoNaEmpresa = new Set<string>();

  type Ganho = { id: string; contact_id: string | null; empresa_id: string | null; value_cents: number | null; currency: string | null };
  const ganhos = new Map<string, Ganho>();
  for (const g of [...(porContatoGanhos.data as Ganho[]), ...(porEmpresaGanhos.data as Ganho[])]) ganhos.set(g.id, g);
  for (const g of ganhos.values()) {
    const moeda = g.currency ?? "BRL";
    const cents = Number(g.value_cents ?? 0);
    if (g.contact_id && alvo.contatoIds.includes(g.contact_id)) somar(contato, g.contact_id, moeda, cents);
    const daEmpresa = g.empresa_id ?? (g.contact_id ? empresaDaPessoa.get(g.contact_id) : undefined);
    if (daEmpresa && alvo.empresaIds.includes(daEmpresa) && !contadoNaEmpresa.has(g.id)) {
      contadoNaEmpresa.add(g.id);
      somar(empresa, daEmpresa, moeda, cents);
    }
  }
  for (const p of pedidos.data as Array<{ contact_id: string; total_cents: number; currency: string }>) {
    const moeda = (p.currency ?? "BRL").trim();
    const cents = pedidoNaReguaDoNegocio(Number(p.total_cents ?? 0), moeda);
    if (alvo.contatoIds.includes(p.contact_id)) somar(contato, p.contact_id, moeda, cents);
    const daEmpresa = empresaDaPessoa.get(p.contact_id);
    if (daEmpresa) somar(empresa, daEmpresa, moeda, cents);
  }
  return { porContato: consolidar(contato), porEmpresa: consolidar(empresa) };
}
