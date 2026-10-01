/**
 * IMPORTAR FOTOS DE PRODUTO — a foto que o agente de IA manda junto quando
 * apresenta o produto.
 *
 * ── As regras são as de `lib/catalogo/fotos.ts` ───────────────────────────
 *
 * As mesmas da tela (`POST /api/v1/products/:id/fotos`): até 5 fotos por
 * produto, até 5 MB cada, JPG ou PNG decididos pela ASSINATURA dos bytes
 * (`farejarTipo`) e nunca pelo tipo que o servidor de origem declarou, no
 * bucket `catalog-photos`, com o caminho gerado aqui e nunca aceito de fora.
 *
 * ── Reexecução ────────────────────────────────────────────────────────────
 *
 * A tela dá a cada foto um nome sorteado. Aqui o nome sai do CONTEÚDO: os 32
 * primeiros caracteres do resumo criptográfico da imagem, na forma de uuid que
 * `fotoPertenceAoProduto` exige. A mesma imagem, importada de novo no mesmo
 * produto, cai no MESMO caminho, e a segunda rodada responde "já estava" em vez
 * de empilhar cinco cópias da mesma foto.
 *
 * O produto é achado pelo código (SKU) ou pelo nome. Produto que não existe é
 * recusado: os produtos entram antes, pela ferramenta de produtos da implantação.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { audit } from "@/lib/audit";
import {
  BUCKET_DAS_FOTOS,
  extensaoDe,
  farejarTipo,
  MAXIMO_DE_FOTOS,
  TAMANHO_MAXIMO_DA_FOTO,
} from "@/lib/catalogo/fotos";

import {
  chaveDoNome,
  Coletor,
  ehObjeto,
  emFrase,
  lerEmPaginas,
  listaDeItens,
  organizacaoDaImportacao,
  RecusaDaImportacao,
  registrarImportacao,
  requestIdDe,
  TAMANHO_DA_PAGINA,
  texto,
} from "./base";
import { redigirLote } from "./auditoria";
import { baixarArquivoPublico } from "./download";
import { OPERACAO_IMPORTAR_MATERIAIS } from "./operacoes";
import type { ContextoDaFerramenta, FerramentaDeImportacao, ResultadoDoLote } from "./tipos";

/** Cada foto é um download: o teto por chamada é baixo de propósito. */
export const TETO_DE_FOTOS_POR_CHAMADA = 20;

export const EXEMPLO_DE_FOTO = {
  produto_codigo: "CAM-001",
  url: "https://exemplo.invalid/fotos/camiseta-azul.jpg",
};

interface ProdutoNaBase {
  id: string;
  codigo: string;
  nome: string;
  fotos: string[] | null;
}

/**
 * O nome do arquivo a partir do conteúdo, na forma `8-4-4-4-12` que
 * `FORMA_DO_ARQUIVO` (`lib/catalogo/fotos.ts`) aceita.
 */
export function caminhoDaFoto(orgId: string, produtoId: string, bytes: Uint8Array, extensao: "png" | "jpg"): string {
  const h = createHash("sha256").update(bytes).digest("hex");
  const nome = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  return `${orgId}/${produtoId}/${nome}.${extensao}`;
}

export async function importarFotosDeProduto(
  ctx: ContextoDaFerramenta,
  args: Record<string, unknown>,
): Promise<ResultadoDoLote> {
  const organizacao = await organizacaoDaImportacao(ctx.admin, args.organization_id);
  const itens = listaDeItens(args, "fotos", TETO_DE_FOTOS_POR_CHAMADA, EXEMPLO_DE_FOTO);
  const requestId = requestIdDe(ctx);
  const orgId = organizacao.id;

  const produtos = await lerEmPaginas<ProdutoNaBase>((depoisDoId) => {
    const consulta = ctx.admin.from("catalog_products").select("id, codigo, nome, fotos").eq("organization_id", orgId);
    return (depoisDoId ? consulta.gt("id", depoisDoId) : consulta).order("id", { ascending: true }).limit(TAMANHO_DA_PAGINA);
  });
  const porCodigo = new Map(produtos.map((p) => [p.codigo.trim().toLowerCase(), p]));
  const porNome = new Map<string, ProdutoNaBase[]>();
  for (const p of produtos) porNome.set(chaveDoNome(p.nome), [...(porNome.get(chaveDoNome(p.nome)) ?? []), p]);

  const coletor = new Coletor();

  for (let i = 0; i < itens.length; i += 1) {
    const posicao = i + 1;
    const item = itens[i];
    if (!ehObjeto(item)) {
      coletor.recusar(posicao, "(item)", "cada foto é um objeto com o produto e o endereço.", JSON.stringify(EXEMPLO_DE_FOTO));
      continue;
    }
    const codigo = texto(item.produto_codigo, 120);
    const nome = texto(item.produto_nome, 200);
    const endereco = texto(item.url, 2000);
    if (!codigo && !nome) {
      coletor.recusar(posicao, "produto_codigo", "diga de qual produto é a foto: `produto_codigo` (o SKU) ou `produto_nome`.", '"CAM-001"');
      continue;
    }
    if (!endereco) {
      coletor.recusar(posicao, "url", "falta o endereço https público da foto.", `"${EXEMPLO_DE_FOTO.url}"`);
      continue;
    }

    let produto: ProdutoNaBase | undefined;
    if (codigo) produto = porCodigo.get(codigo.toLowerCase());
    if (!produto && nome) {
      const homonimos = porNome.get(chaveDoNome(nome)) ?? [];
      if (homonimos.length > 1) {
        coletor.recusar(
          posicao,
          "produto_nome",
          `há ${homonimos.length} produtos com este nome. Use \`produto_codigo\`: ${emFrase(homonimos.map((p) => p.codigo))}.`,
        );
        continue;
      }
      produto = homonimos[0];
    }
    if (!produto) {
      coletor.recusar(
        posicao,
        codigo ? "produto_codigo" : "produto_nome",
        "não existe este produto no catálogo do cliente. Cadastre os produtos antes (a ferramenta de produtos da implantação, " +
          "ou a tela Produtos) e repita. A importação de fotos não cria produto.",
      );
      continue;
    }

    try {
      const atuais = produto.fotos ?? [];
      const baixada = await baixarArquivoPublico(endereco, TAMANHO_MAXIMO_DA_FOTO, "url");
      const bytes = new Uint8Array(baixada.bytes);
      const tipo = farejarTipo(bytes);
      if (!tipo) {
        coletor.recusar(
          posicao,
          "url",
          "o arquivo não é uma imagem JPG nem PNG (o formato é conferido pelo conteúdo, não pelo nome). Converta a foto para JPG ou PNG.",
        );
        continue;
      }
      const caminho = caminhoDaFoto(orgId, produto.id, bytes, extensaoDe(tipo));
      if (atuais.includes(caminho)) {
        coletor.registrar(posicao, "ja_estava", { id: produto.id });
        continue;
      }
      if (atuais.length >= MAXIMO_DE_FOTOS) {
        coletor.recusar(
          posicao,
          "url",
          `o produto "${produto.nome}" já tem ${MAXIMO_DE_FOTOS} fotos, que é o máximo. Tire uma pela tela Produtos antes de pôr outra.`,
        );
        continue;
      }

      const { error: erroUpload } = await ctx.admin.storage
        .from(BUCKET_DAS_FOTOS)
        .upload(caminho, bytes, { contentType: tipo, upsert: false });
      // "Já existe" não é falha: é a mesma imagem, que uma rodada anterior subiu
      // e não chegou a gravar na linha do produto.
      if (erroUpload && !/exist|duplicate/i.test(erroUpload.message)) {
        coletor.recusar(posicao, "(gravação)", `não consegui guardar a foto: ${erroUpload.message}.`);
        continue;
      }

      const fotos = [...atuais, caminho];
      const { data: gravado, error: erroUpdate } = await ctx.admin
        .from("catalog_products")
        .update({ fotos })
        .eq("organization_id", orgId)
        .eq("id", produto.id)
        .select("id")
        .maybeSingle();
      if (erroUpdate || !gravado) {
        // A linha não aceitou: o arquivo não fica órfão no bucket.
        await ctx.admin.storage.from(BUCKET_DAS_FOTOS).remove([caminho]);
        coletor.recusar(posicao, "(gravação)", `não consegui salvar a foto no produto: ${erroUpdate?.message ?? "o produto não está mais na base"}.`);
        continue;
      }
      produto.fotos = fotos;

      await audit({
        organizationId: orgId,
        actorUserId: ctx.autorUserId,
        action: "catalog_product.photo_added",
        resourceType: "catalog_products",
        resourceId: produto.id,
        requestId,
        metadata: { via: "importacao" },
      });
      coletor.registrar(posicao, "criou", { id: produto.id });
    } catch (err) {
      if (err instanceof RecusaDaImportacao) coletor.recusar(posicao, "url", err.message);
      else coletor.recusar(posicao, "(gravação)", err instanceof Error ? `${err.message}.` : "falha inesperada.");
    }
  }

  await registrarImportacao(ctx, {
    organizacao,
    ferramenta: "plataforma_importar_fotos_de_produto",
    tipo: "fotos_de_produto",
    origem: null,
    coletor,
    requestId,
  });

  return coletor.resultado(organizacao);
}

export const FERRAMENTA_IMPORTAR_FOTOS_DE_PRODUTO: FerramentaDeImportacao = {
  name: "plataforma_importar_fotos_de_produto",
  description:
    "Importa FOTOS para produtos do catálogo de um cliente, a partir de endereços. É a foto que o agente de IA manda junto " +
    "quando apresenta o produto. Faz parte do passo 6 de uma migração (materiais); os produtos precisam existir antes " +
    "(ferramenta de produtos da implantação).\n\n" +
    `Teto: ${TETO_DE_FOTOS_POR_CHAMADA} fotos por chamada (cada uma é um download). Cada produto aceita até ${MAXIMO_DE_FOTOS} fotos, ` +
    "de até 5 MB, em JPG ou PNG (conferido pelo conteúdo). O endereço precisa ser https e PÚBLICO.\n\n" +
    "Pode ser repetida sem duplicar: a mesma imagem no mesmo produto responde que já estava. A resposta diz, item a item " +
    "(posição começando em 1), se a foto entrou (`criou`), já estava ou foi recusada e por quê. O `id` devolvido é o do produto.\n\n" +
    "O que NÃO faz: não envia nada a ninguém, não cria produto, não tira nem reordena fotos que já estão no produto.",
  inputSchema: {
    organization_id: z.string().describe("O id do cliente (de plataforma_listar_clientes)."),
    fotos: z
      .array(z.unknown())
      .describe(
        `Até ${TETO_DE_FOTOS_POR_CHAMADA} fotos. Cada uma: produto_codigo (o SKU) ou produto_nome, e url (endereço https público da imagem). ` +
          `Exemplo: ${JSON.stringify(EXEMPLO_DE_FOTO)}`,
      ),
  },
  operacao: OPERACAO_IMPORTAR_MATERIAIS,
  exemplo: { organization_id: "00000000-0000-4000-8000-000000000001", fotos: [EXEMPLO_DE_FOTO] },
  handler: importarFotosDeProduto,
  redigirParaAuditoria: redigirLote(["organization_id"], ["fotos"]),
};
