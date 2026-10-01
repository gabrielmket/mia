/**
 * FORK MIA — GARANTIR o catálogo de um cliente, em lote.
 *
 * ── O caminho da tela que isto reusa ──────────────────────────────────────
 *
 * Cada item é o "Novo produto" e o "Editar produto" da tela
 * (`POST /api/v1/products` e `PATCH /api/v1/products/[id]`), feitos em lote:
 *
 *  - o MESMO contrato (`produtoCreateSchema`, `lib/schemas/produtos.ts`): o que
 *    a tela recusa, a ferramenta recusa;
 *  - a moeda vem da ORGANIZAÇÃO (`moedaDaOrganizacao`), nunca do pedido, e só
 *    entra no produto que nasce: o que já existe guarda a moeda com que nasceu;
 *  - a identidade é o CÓDIGO, e ele não diferencia maiúsculas (`chaveDoCodigo`,
 *    a regra da importação por planilha, #482): "IP15" no catálogo e "ip15" no
 *    pedido são o mesmo produto para o agente que responde o cliente, então o
 *    segundo é recusado em vez de virar uma segunda linha com outro preço.
 *
 * ── O que muda em relação à planilha ──────────────────────────────────────
 *
 * A importação por planilha grava só as colunas que a planilha carrega, e
 * deixa `descricao` de fora de propósito (para a reimportação da lista de
 * preços não apagar o que alguém escreveu na tela). Aqui a descrição entra,
 * porque é dela que o agente tira o que responde, e a regra que protege quem
 * escreveu pela tela é outra: só o campo que VEIO no item é gravado. Item sem
 * `descricao` não toca na descrição que existe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import { chaveDoCodigo } from "@/lib/catalogo/planilha";
import { COLUNAS_DO_PRODUTO, precoParaCentavos, produtoCreateSchema } from "@/lib/schemas/produtos";

import type { Desfecho, Implantacao } from "./base";

/** Quantos produtos uma chamada aceita. Listas maiores vão em mais de uma chamada. */
export const TETO_DE_PRODUTOS = 200;

/** Como o produto que entra pela implantação se identifica em `catalog_products.origem`. */
export const ORIGEM_DA_IMPLANTACAO = "implantacao";

/** O teto de linhas por resposta do PostgREST (`max_rows`). */
const PAGINA = 1000;

export interface ProdutoPedido {
  codigo?: string;
  nome: string;
  descricao?: string;
  marca?: string;
  categoria?: string;
  /** Em CENTAVOS. R$ 149,90 = 14990. */
  preco_cents?: number;
  /** Alternativa em texto, lida como a planilha lê: "R$ 1.499,90", "1499,9". */
  preco?: string;
  custo_cents?: number | null;
  controla_estoque?: boolean;
  quantidade?: number;
  ativo?: boolean;
  imagem_url?: string;
}

export interface ItemDoCatalogo {
  /** A posição do item na lista do pedido, a partir de 1. */
  posicao: number;
  codigo: string | null;
  nome: string;
  desfecho: Desfecho | "recusado";
  /** Os campos que mudaram, ou o motivo da recusa. */
  mudancas?: string[];
  motivo?: string;
}

export interface CatalogoGarantido {
  total: number;
  criados: number;
  atualizados: number;
  ja_estavam: number;
  recusados: number;
  itens: ItemDoCatalogo[];
}

/** Sem código no pedido, o nome vira a identidade, como na planilha. Cabe em 60 caracteres. */
function codigoDoItem(item: ProdutoPedido): { codigo: string } | { motivo: string } {
  const bruto = (item.codigo ?? item.nome ?? "").replace(/\s+/g, " ").trim();
  if (bruto === "") return { motivo: "o produto precisa de `nome`." };
  if (bruto.length > 60) {
    return {
      motivo:
        "o nome passa de 60 caracteres e não serve de código. Informe um `codigo` curto e estável (ex.: \"PLANO-ANUAL\"): " +
        "é por ele que uma nova chamada atualiza este produto em vez de duplicar.",
    };
  }
  return { codigo: bruto };
}

function motivoDoSchema(erro: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return erro.issues
    .map((i) => `\`${i.path.join(".") || "item"}\`: ${i.message}`)
    .join("; ");
}

async function codigosDoCatalogo(admin: SupabaseClient, orgId: string): Promise<string[]> {
  const cadastrados: string[] = [];
  // Avança pelo que VEIO, não pelo que pediu, e para na página vazia: uma
  // instalação com `max_rows` menor que a página não fica com o catálogo cortado.
  for (;;) {
    const { data, error } = await admin
      .from("catalog_products")
      .select("codigo")
      .eq("organization_id", orgId)
      .order("codigo")
      .range(cadastrados.length, cadastrados.length + PAGINA - 1);
    // Sem o catálogo atual não há como saber quem é repetido: seguir gravaria a
    // duplicata que esta conferência existe para impedir.
    if (error) throw new Error(`não consegui conferir o catálogo atual, então nada foi alterado: ${error.message}`);
    if (!data || data.length === 0) break;
    cadastrados.push(...data.map((r) => (r as { codigo: string }).codigo));
  }
  return cadastrados;
}

const ROTULO_DO_CAMPO: Record<string, string> = {
  nome: "nome",
  descricao: "descrição",
  marca: "marca",
  categoria: "categoria",
  preco_cents: "preço",
  custo_cents: "custo",
  controla_estoque: "controle de estoque",
  quantidade: "quantidade",
  ativo: "ativo",
  imagem_url: "imagem",
};

function igual(a: unknown, b: unknown): boolean {
  // `bigint` e `numeric` podem chegar como texto, conforme o transporte.
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return (a ?? null) === (b ?? null);
}

export async function garantirProdutos(c: Implantacao, pedidos: ProdutoPedido[]): Promise<CatalogoGarantido> {
  const itens: ItemDoCatalogo[] = [];
  const recusar = (posicao: number, item: ProdutoPedido, codigo: string | null, motivo: string) =>
    itens.push({ posicao, codigo, nome: item.nome ?? "", desfecho: "recusado", motivo });

  // ── 1. conferir cada item, sem tocar no banco ─────────────────────────────
  interface Conferido {
    posicao: number;
    codigo: string;
    /** Só os campos que VIERAM no item, já validados. */
    veio: Record<string, unknown>;
    /** O item inteiro com os defaults do contrato: é o que nasce. */
    inteiro: Record<string, unknown>;
    nome: string;
  }
  const conferidos: Conferido[] = [];
  const vistos = new Map<string, number>();

  pedidos.forEach((item, i) => {
    const posicao = i + 1;
    const cod = codigoDoItem(item);
    if ("motivo" in cod) return recusar(posicao, item, null, cod.motivo);

    let preco = item.preco_cents;
    if (preco === undefined && item.preco !== undefined) {
      const lido = precoParaCentavos(item.preco);
      if (lido === null) {
        return recusar(posicao, item, cod.codigo, `preço não reconhecido ("${item.preco}"). Escreva assim: "1.499,90", ou use \`preco_cents\` em centavos (149990).`);
      }
      preco = lido;
    }
    if (preco === undefined) {
      return recusar(posicao, item, cod.codigo, "falta o preço. Informe `preco_cents` em CENTAVOS (R$ 149,90 = 14990) ou `preco` em texto (\"149,90\").");
    }

    // Coluna de estoque AUSENTE significa "esta empresa não conta estoque", e é
    // diferente de estoque zero: produto que controla estoque e está zerado some
    // da busca do agente. Mesma leitura da planilha.
    const controla = item.controla_estoque ?? item.quantidade !== undefined;

    const lido = produtoCreateSchema.safeParse({
      codigo: cod.codigo,
      nome: item.nome,
      ...(item.descricao !== undefined ? { descricao: item.descricao } : {}),
      ...(item.marca !== undefined ? { marca: item.marca } : {}),
      ...(item.categoria !== undefined ? { categoria: item.categoria } : {}),
      preco_cents: preco,
      ...(item.custo_cents !== undefined ? { custo_cents: item.custo_cents } : {}),
      controla_estoque: controla,
      ...(item.quantidade !== undefined ? { quantidade: item.quantidade } : {}),
      ...(item.ativo !== undefined ? { ativo: item.ativo } : {}),
      ...(item.imagem_url !== undefined ? { imagem_url: item.imagem_url } : {}),
    });
    if (!lido.success) return recusar(posicao, item, cod.codigo, motivoDoSchema(lido.error));

    const chave = chaveDoCodigo(lido.data.codigo);
    const anterior = vistos.get(chave);
    if (anterior !== undefined) {
      return recusar(
        posicao,
        item,
        lido.data.codigo,
        `código repetido nesta chamada ("${lido.data.codigo}"): já está no item ${anterior}. Maiúsculas e minúsculas não mudam o código.`,
      );
    }
    vistos.set(chave, posicao);

    const inteiro = lido.data as Record<string, unknown>;
    const veio: Record<string, unknown> = { nome: inteiro.nome, preco_cents: inteiro.preco_cents };
    for (const campo of ["descricao", "marca", "categoria", "custo_cents", "quantidade", "ativo", "imagem_url"] as const) {
      if (item[campo] !== undefined) veio[campo] = inteiro[campo];
    }
    if (item.controla_estoque !== undefined || item.quantidade !== undefined) veio.controla_estoque = controla;

    conferidos.push({ posicao, codigo: lido.data.codigo, veio, inteiro, nome: lido.data.nome });
  });

  // ── 2. o que já existe ────────────────────────────────────────────────────
  const cadastrados = conferidos.length > 0 ? await codigosDoCatalogo(c.admin, c.orgId) : [];
  const exatos = new Set(cadastrados);
  const porChave = new Map<string, string[]>();
  for (const codigo of cadastrados) {
    const chave = chaveDoCodigo(codigo);
    porChave.set(chave, [...(porChave.get(chave) ?? []), codigo]);
  }

  const novos: Conferido[] = [];
  const existentes: Conferido[] = [];
  for (const item of conferidos) {
    if (exatos.has(item.codigo)) {
      existentes.push(item);
      continue;
    }
    const outraCaixa = porChave.get(chaveDoCodigo(item.codigo));
    if (outraCaixa) {
      itens.push({
        posicao: item.posicao,
        codigo: item.codigo,
        nome: item.nome,
        desfecho: "recusado",
        motivo:
          `"${item.codigo}": este código já está no catálogo escrito ${outraCaixa.map((x) => `"${x}"`).join(", ")}. ` +
          "Maiúsculas e minúsculas não mudam o código: escreva igual ao do catálogo para atualizar o produto.",
      });
      continue;
    }
    novos.push(item);
  }

  // ── 3. os que nascem: um insert por lote, todos com a mesma forma ─────────
  if (novos.length > 0) {
    const moeda = await moedaDaOrganizacao(c.admin, c.orgId);
    const linhas = novos.map((n) => ({
      organization_id: c.orgId,
      codigo: n.codigo,
      nome: n.inteiro.nome,
      descricao: n.inteiro.descricao ?? null,
      marca: n.inteiro.marca ?? null,
      categoria: n.inteiro.categoria ?? null,
      preco_cents: n.inteiro.preco_cents,
      custo_cents: n.inteiro.custo_cents ?? null,
      controla_estoque: n.inteiro.controla_estoque,
      quantidade: n.inteiro.quantidade,
      ativo: n.inteiro.ativo,
      imagem_url: n.inteiro.imagem_url ?? null,
      moeda,
      origem: ORIGEM_DA_IMPLANTACAO,
    }));
    const { error } = await c.admin.from("catalog_products").insert(linhas);
    if (!error) {
      for (const n of novos) itens.push({ posicao: n.posicao, codigo: n.codigo, nome: n.nome, desfecho: "criou" });
    } else {
      // O lote é tudo-ou-nada. Uma linha ruim não pode derrubar as outras, e a
      // resposta precisa nomear QUAL item: o lote que falhou é refeito um a um.
      for (let i = 0; i < novos.length; i += 1) {
        const n = novos[i]!;
        const { error: individual } = await c.admin.from("catalog_products").insert(linhas[i]!);
        if (individual) {
          itens.push({
            posicao: n.posicao,
            codigo: n.codigo,
            nome: n.nome,
            desfecho: "recusado",
            motivo:
              individual.code === "23505"
                ? "já existe um produto com esse código (outra chamada gravou ao mesmo tempo). Chame de novo: ele será atualizado."
                : individual.message,
          });
          continue;
        }
        itens.push({ posicao: n.posicao, codigo: n.codigo, nome: n.nome, desfecho: "criou" });
      }
    }
  }

  // ── 4. os que já existem: só o campo que veio e que é diferente ───────────
  if (existentes.length > 0) {
    const { data: atuais, error } = await c.admin
      .from("catalog_products")
      .select(COLUNAS_DO_PRODUTO)
      .eq("organization_id", c.orgId)
      .in("codigo", existentes.map((e) => e.codigo));
    if (error) throw new Error(`não consegui ler os produtos que já existem: ${error.message}`);
    const porCodigo = new Map(
      ((atuais ?? []) as unknown as Array<Record<string, unknown>>).map((p) => [String(p.codigo), p]),
    );

    for (const item of existentes) {
      const atual = porCodigo.get(item.codigo);
      if (!atual) {
        itens.push({ posicao: item.posicao, codigo: item.codigo, nome: item.nome, desfecho: "recusado", motivo: "o produto sumiu do catálogo entre a conferência e a gravação. Chame de novo." });
        continue;
      }
      const patch: Record<string, unknown> = {};
      for (const [campo, valor] of Object.entries(item.veio)) {
        if (!igual(atual[campo], valor)) patch[campo] = valor ?? null;
      }
      if (Object.keys(patch).length === 0) {
        itens.push({ posicao: item.posicao, codigo: item.codigo, nome: item.nome, desfecho: "ja_estava" });
        continue;
      }
      const { error: updErr } = await c.admin
        .from("catalog_products")
        .update(patch)
        .eq("organization_id", c.orgId)
        .eq("id", String(atual.id));
      if (updErr) {
        itens.push({ posicao: item.posicao, codigo: item.codigo, nome: item.nome, desfecho: "recusado", motivo: updErr.message });
        continue;
      }
      itens.push({
        posicao: item.posicao,
        codigo: item.codigo,
        nome: item.nome,
        desfecho: "atualizou",
        mudancas: Object.keys(patch).map((k) => ROTULO_DO_CAMPO[k] ?? k),
      });
    }
  }

  itens.sort((a, b) => a.posicao - b.posicao);
  const conta = (d: ItemDoCatalogo["desfecho"]) => itens.filter((i) => i.desfecho === d).length;
  const resumo: CatalogoGarantido = {
    total: pedidos.length,
    criados: conta("criou"),
    atualizados: conta("atualizou"),
    ja_estavam: conta("ja_estava"),
    recusados: conta("recusado"),
    itens,
  };

  if (resumo.criados + resumo.atualizados > 0) {
    // A mesma linha de auditoria da importação da tela, com a contagem.
    void audit({
      organizationId: c.orgId,
      actorUserId: c.autorUserId,
      action: "catalog_product.imported",
      resourceType: "catalog_products",
      resourceId: null,
      requestId: c.requestId,
      metadata: {
        actor_type: "user",
        via: "mcp_plataforma",
        total_linhas: resumo.total,
        criados: resumo.criados,
        atualizados: resumo.atualizados,
        erros: resumo.recusados,
      },
    });
  }

  return resumo;
}
