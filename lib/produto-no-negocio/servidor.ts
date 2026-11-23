/**
 * FORK MIA (.109) · o produto no negócio, do lado do servidor
 * (docs/fork/produto-no-negocio.md).
 *
 *   lerItensDosNegocios       os itens de vários negócios de uma vez (o quadro, o
 *                             relatório): os do bloco do negócio e os da proposta
 *                             enviada, na ordem do bloco.
 *   lerNegocioComItens        um negócio, com o estado do valor (a tela).
 *   gravarItensDoNegocio      a lista inteira e o modo do valor, numa escrita.
 *   recalcularValorDoNegocio  depois que a proposta é enviada.
 *   recusaDoProdutoNoGanho    "Pedir o produto ao marcar como ganho" no servidor.
 *
 * ── Quem escreve ────────────────────────────────────────────────────────────
 *
 * Só o servidor (a 9160 não dá escrita à sessão): a rota confere o papel e a
 * empresa, e aqui toda consulta filtra `organization_id`. O produto novo vem do
 * catálogo DESTA empresa, ativo e na moeda do negócio, e o preço sai DELE, nunca
 * do pedido: é o mesmo princípio de `resolverItensDaProposta`.
 *
 * ── Os itens da proposta ────────────────────────────────────────────────────
 *
 * A proposta enviada troca o valor do negócio (`proposals/[id]/send`, upstream).
 * Os itens dela aparecem no bloco: os da proposta mais recente que saiu
 * (enviada, aceita, recusada ou vencida; rascunho não saiu, cancelada e
 * substituída deixaram de valer). Eles entram na soma e só mudam pela proposta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { buscaEmLotesSemTeto } from "@/lib/leitura/em-lotes-sem-teto";
import { buscaEmLotes } from "@/lib/supabase/em-lotes";

import { linhasDaComanda, type LinhaDaComanda } from "./comanda";
import { formasDaPalavra, funilDoProduto, type FunilDoProduto } from "./funil";

export type { FunilDoProduto } from "./funil";
import {
  QUANTIDADE_MAXIMA,
  estadoDoValor,
  somaEsperada,
  type EstadoDoValor,
  type ItemDoNegocio,
  type ModoDoValor,
} from "./regras";

type Db = SupabaseClient;

/** As propostas cujos itens aparecem no bloco: as que SAÍRAM e seguem valendo. */
export const SITUACOES_DA_PROPOSTA_NO_BLOCO = ["enviada", "aceita", "recusada", "vencida"] as const;

const COLUNAS_DO_ITEM =
  "id, lead_id, product_id, nome, codigo, preco_unitario_cents, moeda, quantidade, desconto_cents, position";

interface LinhaDoItem {
  id: string;
  lead_id: string;
  product_id: string | null;
  nome: string;
  codigo: string | null;
  preco_unitario_cents: number | string;
  moeda: string;
  quantidade: number;
  desconto_cents: number | string;
  position: number | string;
}

interface LinhaDaProposta {
  id: string;
  lead_id: string;
  numero: number | null;
  ano: number | null;
  sent_at: string | null;
  moeda: string | null;
}

interface LinhaDoItemDaProposta {
  id: string;
  proposal_id: string;
  product_id: string | null;
  descricao: string;
  quantidade: number | string;
  preco_unitario_cents: number | string;
  desconto_cents: number | string;
  position: number | string;
}

const num = (v: number | string | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));

function erro(status: number, codigo: string, mensagem: string): never {
  throw new ApiError(status, codigo, undefined, "", mensagem);
}

/**
 * Os itens de cada negócio pedido: os do bloco primeiro (na ordem do bloco),
 * depois os da proposta enviada. Negócio sem item nenhum não entra no mapa.
 */
export async function lerItensDosNegocios(
  db: Db,
  org: string,
  leadIds: readonly string[],
  opcoes: { nomeNoCatalogo?: boolean } = {},
): Promise<Map<string, ItemDoNegocio[]>> {
  const ids = [...new Set(leadIds)];
  const mapa = new Map<string, ItemDoNegocio[]>();
  if (ids.length === 0) return mapa;

  const [proprios, propostas] = await Promise.all([
    buscaEmLotesSemTeto<LinhaDoItem>(ids, (lote, contagem) =>
      db
        .from("mia_itens_do_negocio")
        .select(COLUNAS_DO_ITEM, contagem)
        .eq("organization_id", org)
        .in("lead_id", lote)
        .order("position", { ascending: true }),
    ),
    buscaEmLotesSemTeto<LinhaDaProposta>(ids, (lote, contagem) =>
      db
        .from("crm_proposals")
        .select("id, lead_id, numero, ano, sent_at, moeda", contagem)
        .eq("organization_id", org)
        .in("lead_id", lote)
        .in("status", [...SITUACOES_DA_PROPOSTA_NO_BLOCO])
        .not("sent_at", "is", null)
        .order("sent_at", { ascending: false }),
    ),
  ]);
  if (proprios.error) throw new Error(`itens do negócio: ${proprios.error.message}`);
  if (propostas.error) throw new Error(`propostas do negócio: ${propostas.error.message}`);

  // A proposta mais recente que saiu, por negócio (a leitura já vem por `sent_at` decrescente).
  const propostaDoNegocio = new Map<string, LinhaDaProposta>();
  for (const p of propostas.data) {
    const atual = propostaDoNegocio.get(p.lead_id);
    if (!atual || (p.sent_at ?? "") > (atual.sent_at ?? "")) propostaDoNegocio.set(p.lead_id, p);
  }
  const propostaIds = [...propostaDoNegocio.values()].map((p) => p.id);
  const itensDaProposta = await buscaEmLotesSemTeto<LinhaDoItemDaProposta>(propostaIds, (lote, contagem) =>
    db
      .from("crm_proposal_items")
      .select("id, proposal_id, product_id, descricao, quantidade, preco_unitario_cents, desconto_cents, position", contagem)
      .eq("organization_id", org)
      .in("proposal_id", lote)
      .order("position", { ascending: true }),
  );
  if (itensDaProposta.error) throw new Error(`itens da proposta: ${itensDaProposta.error.message}`);

  let nomes = new Map<string, string>();
  if (opcoes.nomeNoCatalogo) {
    const produtoIds = [
      ...new Set(
        [...proprios.data.map((i) => i.product_id), ...itensDaProposta.data.map((i) => i.product_id)].filter(
          (p): p is string => !!p,
        ),
      ),
    ];
    const lidos = await buscaEmLotes<{ id: string; nome: string }>(produtoIds, (lote) =>
      db.from("catalog_products").select("id, nome").eq("organization_id", org).in("id", lote),
    );
    if (lidos.error) throw new Error(`catálogo: ${lidos.error.message}`);
    nomes = new Map(lidos.data.map((p) => [p.id, p.nome]));
  }
  const nomeNoCatalogo = (productId: string | null) =>
    opcoes.nomeNoCatalogo && productId ? (nomes.get(productId) ?? null) : undefined;

  const ordenar = (a: { position: number | string }, b: { position: number | string }) => num(a.position) - num(b.position);
  for (const it of [...proprios.data].sort(ordenar)) {
    const lista = mapa.get(it.lead_id) ?? [];
    lista.push({
      id: it.id,
      origem: "negocio",
      productId: it.product_id,
      nome: it.nome,
      codigo: it.codigo,
      precoUnitarioCents: num(it.preco_unitario_cents),
      quantidade: Number(it.quantidade),
      descontoCents: num(it.desconto_cents),
      moeda: it.moeda,
      proposta: null,
      ...(opcoes.nomeNoCatalogo ? { nomeNoCatalogo: nomeNoCatalogo(it.product_id) ?? null } : {}),
    });
    mapa.set(it.lead_id, lista);
  }
  const propostaPorId = new Map([...propostaDoNegocio.values()].map((p) => [p.id, p]));
  for (const it of [...itensDaProposta.data].sort(ordenar)) {
    const p = propostaPorId.get(it.proposal_id);
    if (!p) continue;
    const lista = mapa.get(p.lead_id) ?? [];
    lista.push({
      id: it.id,
      origem: "proposta",
      productId: it.product_id,
      nome: it.descricao,
      codigo: null,
      precoUnitarioCents: num(it.preco_unitario_cents),
      quantidade: Number(it.quantidade),
      descontoCents: num(it.desconto_cents),
      moeda: p.moeda ?? "BRL",
      proposta: { id: p.id, numero: p.numero, ano: p.ano },
      ...(opcoes.nomeNoCatalogo ? { nomeNoCatalogo: nomeNoCatalogo(it.product_id) ?? null } : {}),
    });
    mapa.set(p.lead_id, lista);
  }
  return mapa;
}

export async function lerFunilDoProduto(db: Db, org: string, pipelineId: string): Promise<FunilDoProduto | null> {
  const { data, error } = await db
    .from("crm_pipelines")
    .select("id, vocabulary, settings")
    .eq("organization_id", org)
    .eq("id", pipelineId)
    .maybeSingle();
  if (error) throw new Error(`funil: ${error.message}`);
  return data ? funilDoProduto(data as { id: string; vocabulary: unknown; settings: unknown }) : null;
}

interface LinhaDoNegocio {
  id: string;
  pipeline_id: string;
  value_cents: number | string | null;
  currency: string | null;
  valor_a_mao: boolean | null;
  updated_at: string;
}

const COLUNAS_DO_NEGOCIO = "id, pipeline_id, value_cents, currency, valor_a_mao, updated_at";

export interface NegocioComItens {
  lead_id: string;
  pipeline_id: string;
  updated_at: string;
  moeda: string;
  itens: ItemDoNegocio[];
  valor: EstadoDoValor;
}

function montar(lead: LinhaDoNegocio, itens: ItemDoNegocio[]): NegocioComItens {
  const valor = lead.value_cents === null ? null : Number(lead.value_cents);
  return {
    lead_id: lead.id,
    pipeline_id: lead.pipeline_id,
    updated_at: lead.updated_at,
    moeda: lead.currency ?? "BRL",
    itens,
    valor: estadoDoValor({ itens, valorCents: valor, valorAMao: lead.valor_a_mao }),
  };
}

async function lerNegocio(db: Db, org: string, leadId: string): Promise<LinhaDoNegocio | null> {
  const { data, error } = await db
    .from("crm_leads")
    .select(COLUNAS_DO_NEGOCIO)
    .eq("organization_id", org)
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(`negócio: ${error.message}`);
  return (data as LinhaDoNegocio | null) ?? null;
}

/** Um negócio com os itens e o estado do valor; `null` quando não existe nesta empresa. */
export async function lerNegocioComItens(db: Db, org: string, leadId: string): Promise<NegocioComItens | null> {
  const lead = await lerNegocio(db, org, leadId);
  if (!lead) return null;
  const itens = (await lerItensDosNegocios(db, org, [leadId])).get(leadId) ?? [];
  return montar(lead, itens);
}

// ── a gravação ────────────────────────────────────────────────────────────────

export interface ItemPedido {
  /** O item do bloco que já existe (o de produto apagado só se acha por ele). */
  id?: string;
  /** O produto do catálogo (item novo, ou o que já está no negócio). */
  product_id?: string;
  quantidade: number;
  desconto_cents: number;
}

export interface PedidoDeItens {
  /** A lista INTEIRA do bloco do negócio (sem os da proposta): o que não vier, sai. */
  itens: ItemPedido[];
  valor: { modo: "soma" } | { modo: "a_mao"; value_cents: number | null };
}

export interface ResultadoDaGravacao extends NegocioComItens {
  mudou: boolean;
  antes: { itens: number; value_cents: number | null; modo: ModoDoValor };
}

/**
 * Grava a lista do bloco e o valor, e devolve o negócio como ficou.
 *
 * Recusa (ApiError) quando o negócio não existe nesta empresa, quando o mesmo
 * produto vem duas vezes, quando o produto não está no catálogo desta empresa,
 * está inativo ou em outra moeda, e quando quantidade ou desconto saem da régua.
 *
 * A ordem das escritas (inserir, atualizar, apagar) deixa a repetição convergir:
 * se uma falhar no meio, a próxima gravação com a mesma lista termina o serviço.
 */
export async function gravarItensDoNegocio(
  admin: Db,
  args: { organizationId: string; leadId: string; userId: string | null; pedido: PedidoDeItens; idioma: Idioma },
): Promise<ResultadoDaGravacao> {
  const { organizationId: org, leadId, pedido } = args;
  const t = (texto: string) => traduzir(texto, args.idioma);

  const lead = await lerNegocio(admin, org, leadId);
  if (!lead) erro(404, "not_found", t("Negócio não encontrado."));
  const moedaDoNegocio = lead.currency ?? "BRL";

  const todosAntes = (await lerItensDosNegocios(admin, org, [leadId])).get(leadId) ?? [];
  const existentes = todosAntes.filter((i) => i.origem === "negocio");
  const daProposta = todosAntes.filter((i) => i.origem === "proposta");
  const antes = montar(lead, todosAntes);

  // Cada item do pedido acha o seu: pelo id, ou pelo produto que já está no negócio.
  const porId = new Map(existentes.map((i) => [i.id!, i]));
  const porProduto = new Map(existentes.filter((i) => i.productId).map((i) => [i.productId!, i]));
  const vistos = new Set<string>();
  const novosProdutos: string[] = [];
  const resolvidos: Array<{ pedido: ItemPedido; existente: ItemDoNegocio | null }> = [];
  for (const p of pedido.itens) {
    if (!Number.isInteger(p.quantidade) || p.quantidade < 1 || p.quantidade > QUANTIDADE_MAXIMA) {
      erro(422, "validation_failed", t("Quantidade de 1 a 99."));
    }
    if (!Number.isInteger(p.desconto_cents) || p.desconto_cents < 0) {
      erro(422, "validation_failed", t("Desconto inválido. Use só números, como 150 ou 150,00."));
    }
    const existente = (p.id ? porId.get(p.id) : undefined) ?? (p.product_id ? porProduto.get(p.product_id) : undefined) ?? null;
    if (!existente && !p.product_id) {
      erro(409, "item_nao_encontrado", t("Um item deste negócio mudou enquanto a tela estava aberta. Abra o negócio de novo."));
    }
    const chave = existente?.id ?? `novo:${p.product_id}`;
    const chaveDoProduto = existente?.productId ?? p.product_id ?? null;
    if (vistos.has(chave) || (chaveDoProduto && vistos.has(`produto:${chaveDoProduto}`))) {
      erro(422, "item_repetido", t("O mesmo produto veio duas vezes. Some na quantidade em vez de repetir a linha."));
    }
    vistos.add(chave);
    if (chaveDoProduto) vistos.add(`produto:${chaveDoProduto}`);
    if (!existente) novosProdutos.push(p.product_id!);
    resolvidos.push({ pedido: p, existente });
  }

  // O catálogo dos produtos NOVOS: preço, nome e código congelados agora.
  const catalogo = new Map<string, { id: string; codigo: string | null; nome: string; preco_cents: number; moeda: string; ativo: boolean }>();
  if (novosProdutos.length > 0) {
    const lidos = await buscaEmLotes<{ id: string; codigo: string | null; nome: string; preco_cents: number | string; moeda: string; ativo: boolean }>(
      novosProdutos,
      (lote) =>
        admin
          .from("catalog_products")
          .select("id, codigo, nome, preco_cents, moeda, ativo")
          .eq("organization_id", org)
          .in("id", lote),
    );
    if (lidos.error) throw new Error(`catálogo: ${lidos.error.message}`);
    for (const p of lidos.data) catalogo.set(p.id, { ...p, preco_cents: num(p.preco_cents) });
  }

  const finais: ItemDoNegocio[] = [];
  const inserir: Record<string, unknown>[] = [];
  const atualizar: Array<{ id: string; patch: Record<string, unknown> }> = [];
  resolvidos.forEach(({ pedido: p, existente }, i) => {
    const position = (i + 1) * 1000;
    if (existente) {
      if (p.desconto_cents > existente.precoUnitarioCents * p.quantidade) {
        erro(422, "validation_failed", t("O desconto não pode passar do valor do item."));
      }
      const patch: Record<string, unknown> = {};
      if (existente.quantidade !== p.quantidade) patch.quantidade = p.quantidade;
      if (existente.descontoCents !== p.desconto_cents) patch.desconto_cents = p.desconto_cents;
      const posicaoAntes = existentes.indexOf(existente);
      if (posicaoAntes !== i) patch.position = position;
      if (Object.keys(patch).length > 0) atualizar.push({ id: existente.id!, patch });
      finais.push({ ...existente, quantidade: p.quantidade, descontoCents: p.desconto_cents });
      return;
    }
    const produto = catalogo.get(p.product_id!);
    if (!produto) erro(422, "produto_fora_do_catalogo", t("Esse produto não está no catálogo desta empresa."));
    if (!produto.ativo) erro(422, "produto_inativo", t("Esse produto está desativado no catálogo."));
    if (produto.moeda !== moedaDoNegocio) {
      erro(
        422,
        "moeda_divergente",
        t("Esse produto está em {moeda_do_produto} e este negócio em {moeda_do_negocio}.")
          .replace("{moeda_do_produto}", produto.moeda)
          .replace("{moeda_do_negocio}", moedaDoNegocio),
      );
    }
    if (p.desconto_cents > produto.preco_cents * p.quantidade) {
      erro(422, "validation_failed", t("O desconto não pode passar do valor do item."));
    }
    inserir.push({
      organization_id: org,
      lead_id: leadId,
      product_id: produto.id,
      nome: produto.nome,
      codigo: produto.codigo,
      preco_unitario_cents: produto.preco_cents,
      moeda: produto.moeda,
      quantidade: p.quantidade,
      desconto_cents: p.desconto_cents,
      position,
      created_by_user_id: args.userId,
    });
    finais.push({
      id: null,
      origem: "negocio",
      productId: produto.id,
      nome: produto.nome,
      codigo: produto.codigo,
      precoUnitarioCents: produto.preco_cents,
      quantidade: p.quantidade,
      descontoCents: p.desconto_cents,
      moeda: produto.moeda,
      proposta: null,
    });
  });
  const manter = new Set(resolvidos.map((r) => r.existente?.id).filter((id): id is string => !!id));
  const apagar = existentes.filter((e) => !manter.has(e.id!)).map((e) => e.id!);

  if (inserir.length > 0) {
    const { error } = await admin.from("mia_itens_do_negocio").insert(inserir);
    if (error) throw new Error(`itens do negócio (inserir): ${error.message}`);
  }
  for (const a of atualizar) {
    const { error } = await admin
      .from("mia_itens_do_negocio")
      .update(a.patch)
      .eq("organization_id", org)
      .eq("lead_id", leadId)
      .eq("id", a.id);
    if (error) throw new Error(`itens do negócio (atualizar): ${error.message}`);
  }
  if (apagar.length > 0) {
    const { error } = await admin
      .from("mia_itens_do_negocio")
      .delete()
      .eq("organization_id", org)
      .eq("lead_id", leadId)
      .in("id", apagar);
    if (error) throw new Error(`itens do negócio (apagar): ${error.message}`);
  }

  // O valor: a soma (dos itens do bloco E da proposta) ou o digitado.
  const todos = [...finais, ...daProposta];
  const modo = pedido.valor.modo;
  const novoValor = modo === "soma" ? somaEsperada(todos) : pedido.valor.value_cents;
  const novaMarca = modo === "a_mao";
  const valorAntes = lead.value_cents === null ? null : Number(lead.value_cents);
  const patchDoNegocio: Record<string, unknown> = {};
  if (novoValor !== valorAntes) patchDoNegocio.value_cents = novoValor;
  if (lead.valor_a_mao !== novaMarca) patchDoNegocio.valor_a_mao = novaMarca;
  let leadDepois = lead;
  if (Object.keys(patchDoNegocio).length > 0) {
    const { data, error } = await admin
      .from("crm_leads")
      .update({ ...patchDoNegocio, updated_at: new Date().toISOString() })
      .eq("organization_id", org)
      .eq("id", leadId)
      .select(COLUNAS_DO_NEGOCIO)
      .single();
    if (error) throw new Error(`negócio (valor): ${error.message}`);
    leadDepois = data as LinhaDoNegocio;
  }

  // FORK MIA (fusão v1.124): sem item do bloco, o valor volta a ser do upstream.
  // Se o negócio tem venda registrada (9449), o gatilho dele (9450) soma as
  // vendas de novo, por cima do que acabou de ser gravado aqui. Com item, quem
  // manda é o bloco, e a 9167 mantém a marca das vendas desligada.
  // Roda também quando o último item sai sem mudar o valor nem a marca (Valor à
  // mão igual ao de antes): o patch fica vazio, mas o negócio deixou de ter item
  // e as vendas têm de voltar a mandar (revisão do #129).
  if (finais.length === 0 && (apagar.length > 0 || Object.keys(patchDoNegocio).length > 0)) {
    const { error } = await admin.rpc("fn_mia_valor_do_negocio_volta_as_vendas", { p_org: org, p_lead: leadId });
    if (error) throw new Error(`negócio (valor pelas vendas): ${error.message}`);
    const releitura = await lerNegocio(admin, org, leadId);
    if (releitura) leadDepois = releitura;
  }

  const mudou = inserir.length + atualizar.length + apagar.length + Object.keys(patchDoNegocio).length > 0;
  const depois = mudou ? ((await lerItensDosNegocios(admin, org, [leadId])).get(leadId) ?? []) : todosAntes;
  return {
    ...montar(leadDepois, depois),
    mudou,
    antes: { itens: existentes.length, value_cents: valorAntes, modo: antes.valor.modo },
  };
}

/**
 * Depois que a proposta é enviada (`proposals/[id]/send`, que já trocou o valor
 * do negócio pelo total da proposta): o valor volta a ser a SOMA, agora com os
 * itens da proposta nova e os do bloco. A proposta enviada troca o valor, como
 * sempre trocou; o que muda é que o bloco entra na conta.
 *
 * Negócio que nunca foi gravado pelo bloco (`valor_a_mao` nulo) não é tocado:
 * sem item do bloco, a soma é o total da proposta, que o upstream acabou de gravar.
 * Nunca lança: o envio da proposta já aconteceu.
 */
export async function recalcularValorDoNegocio(
  admin: Db,
  org: string,
  leadId: string,
): Promise<{ ok: true; mudou: boolean } | { ok: false; erro: string }> {
  try {
    const lead = await lerNegocio(admin, org, leadId);
    if (!lead || lead.valor_a_mao == null) return { ok: true, mudou: false };
    const itens = (await lerItensDosNegocios(admin, org, [leadId])).get(leadId) ?? [];
    const soma = somaEsperada(itens);
    // Logo depois do envio há pelo menos os itens da proposta: soma nula aqui é
    // leitura que não viu a proposta, e apagar o valor que ela gravou seria pior.
    if (soma === null) return { ok: true, mudou: false };
    const valor = lead.value_cents === null ? null : Number(lead.value_cents);
    const patch: Record<string, unknown> = {};
    if (soma !== valor) patch.value_cents = soma;
    if (lead.valor_a_mao === true) patch.valor_a_mao = false;
    if (Object.keys(patch).length === 0) return { ok: true, mudou: false };
    const { error } = await admin
      .from("crm_leads")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("organization_id", org)
      .eq("id", leadId);
    if (error) return { ok: false, erro: error.message };
    return { ok: true, mudou: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * "Pedir o produto ao marcar como ganho", do lado do servidor: o botão Ganhar e
 * o arrasto até a etapa de ganho. Com a opção ligada e o negócio sem item nenhum
 * (nem do bloco, nem da proposta), a recusa; senão, `null`.
 */
export async function recusaDoProdutoNoGanho(
  db: Db,
  args: { organizationId: string; leadId: string; pipelineId?: string | null; idioma: Idioma },
): Promise<{ codigo: "produto_exigido_no_ganho"; mensagem: string } | null> {
  let pipelineId = args.pipelineId ?? null;
  if (!pipelineId) {
    const lead = await lerNegocio(db, args.organizationId, args.leadId);
    if (!lead) return null;
    pipelineId = lead.pipeline_id;
  }
  const funil = await lerFunilDoProduto(db, args.organizationId, pipelineId);
  if (!funil || !funil.pedir_no_ganho) return null;
  const itens = (await lerItensDosNegocios(db, args.organizationId, [args.leadId])).get(args.leadId) ?? [];
  if (itens.length > 0) return null;
  const palavra = formasDaPalavra(funil.palavra, {
    singular: traduzir("produto ou serviço", args.idioma),
    plural: traduzir("produtos e serviços", args.idioma),
  });
  return {
    codigo: "produto_exigido_no_ganho",
    mensagem: traduzir("Escolha pelo menos um {produto} para marcar como ganho.", args.idioma).replace("{produto}", palavra.s),
  };
}

/**
 * As linhas da comanda do ganho para um negócio (`lib/financeiro/comanda-do-ganho.handler.ts`):
 * uma por item, com o ajuste do valor digitado à mão. `null` quando o negócio não
 * tem item ou a leitura falhou: a comanda abre com a linha única de sempre, e o
 * ganho nunca para por causa disto.
 */
export async function linhasDaComandaDoNegocio(
  admin: Db,
  org: string,
  leadId: string,
  valorCents: number | string | null,
): Promise<LinhaDaComanda[] | null> {
  try {
    const itens = (await lerItensDosNegocios(admin, org, [leadId])).get(leadId) ?? [];
    const valor = valorCents === null ? 0 : Number(valorCents);
    // A descrição da linha de ajuste é texto da comanda (dado), em português como
    // a "Negócio · <funil>" da linha única do upstream.
    return linhasDaComanda(itens, Number.isFinite(valor) ? valor : 0, "Ajuste do valor digitado à mão");
  } catch {
    return null;
  }
}
