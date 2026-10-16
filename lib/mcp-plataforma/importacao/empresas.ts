/**
 * IMPORTAR EMPRESAS — os clientes que são organizações, vindos de outro CRM.
 *
 * ── Em qual tabela ────────────────────────────────────────────────────────
 *
 * Desde a .79 o cadastro de empresa é UM só (docs/fork/empresa-unica.md): o do
 * upstream (`companies`), com o que é só nosso ao lado
 * (`mia_companies_extra`). É nele que `contacts.empresa_id`,
 * `crm_leads.empresa_id` e `mia_obrigacoes.empresa_id` apontam. A importação
 * grava pela MESMA porta da tela (`fn_mia_gravar_empresa`, migration 9034), com
 * o mesmo schema (`empresaCreateSchema`) de `POST /api/v1/empresas`.
 *
 * Não há consulta à Receita aqui: pela decisão do protótipo aprovado em
 * 15/10/2026, a consulta de CNPJ é só pela tela, por uma pessoa.
 *
 * ── Como se decide que a empresa já existe ────────────────────────────────
 *
 *  1. pelo CNPJ, só com os dígitos: `12.345.678/0001-90` e `12345678000190`
 *     são a mesma empresa (é o que o índice único da tabela garante);
 *  2. pelo nome, na forma comparável de `nomeComparavel`
 *     (`lib/empresas/achar-ou-criar.ts`): sem caixa, sem acento, sem sufixo
 *     societário. É a mesma régua que o agente de IA usa quando o cliente dita
 *     o nome da empresa, e duas réguas criariam a duplicata uma da outra.
 *
 * Nome igual com CNPJ DIFERENTE não é a mesma empresa (matriz e filial, ou duas
 * empresas homônimas): entra como outra.
 */
import { z } from "zod";

import { nomeComparavel } from "@/lib/empresas/achar-ou-criar";
import {
  COLUNAS_DA_EMPRESA_UNICA,
  COLUNAS_DO_QUE_E_SO_NOSSO,
  gravarEmpresa,
  paraEmpresa,
  type DadosDaEmpresa,
  type ExtraDaEmpresa,
  type LinhaDaEmpresa,
} from "@/lib/empresas/fonte-unica";
import { pareceAMesma } from "@/lib/empresas/parecida";
import { apenasDigitos, empresaCreateSchema } from "@/lib/schemas/empresas";

import {
  Coletor,
  ehObjeto,
  explicarProblemaDoSchema,
  lerEmPaginas,
  listaDeItens,
  mesmoValor,
  modoQuandoJaExiste,
  organizacaoDaImportacao,
  origemDaImportacao,
  registrarImportacao,
  requestIdDe,
  somarEtiquetas,
  TAMANHO_DA_PAGINA,
  texto,
} from "./base";
import { redigirLote } from "./auditoria";
import { OPERACAO_IMPORTAR_BASE } from "./operacoes";
import type { ContextoDaFerramenta, FerramentaDeImportacao, QuandoJaExiste, ResultadoDoLote } from "./tipos";

export const TETO_DE_EMPRESAS = 200;

/** A empresa no formato que a importação compara (o de `crm_empresas` até a .77). */
export interface EmpresaNaBase {
  id: string;
  nome: string;
  cnpj: string | null;
  site: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  observacoes: string | null;
  tags: string[] | null;
  custom_fields: Record<string, unknown> | null;
}

export const EXEMPLO_DE_EMPRESA = {
  nome: "Padaria Modelo LTDA",
  cnpj: "12.345.678/0001-90",
  telefone: "(11) 99999-8888",
  email: "contato@padariamodelo.exemplo.invalid",
  site: "https://padariamodelo.exemplo.invalid",
  endereco: "Rua das Flores, 100, Belo Horizonte, MG",
  observacoes: "Compra toda segunda-feira.",
  etiquetas: ["atacado"],
  campos: { segmento: "alimentação" },
};

/** O nome do campo como a FERRAMENTA o chama, pela coluna que o schema acusa. */
const CAMPO_DA_EMPRESA: Record<string, string> = {
  nome: "nome",
  cnpj: "cnpj",
  site: "site",
  telefone: "telefone",
  email: "email",
  endereco: "endereco",
  observacoes: "observacoes",
  tags: "etiquetas",
  custom_fields: "campos",
};

const EXEMPLO_POR_CAMPO: Record<string, string> = {
  nome: '"Padaria Modelo LTDA"',
  cnpj: '"12.345.678/0001-90" (14 dígitos, com ou sem pontuação)',
  email: '"contato@empresa.exemplo.invalid"',
  etiquetas: '["atacado", "revenda"]',
  campos: '{ "segmento": "alimentação" }',
};

/** Do cadastro único para o formato da importação. */
export function empresaNaBaseDe(l: LinhaDaEmpresa): EmpresaNaBase {
  const e = paraEmpresa(l);
  return {
    id: e.id,
    nome: e.nome,
    cnpj: e.cnpj,
    site: e.site,
    telefone: e.telefone,
    email: e.email,
    // O endereço NOSSO (texto livre). O da Receita não entra na comparação: a
    // importação nunca o escreve.
    endereco: (Array.isArray(l.extra) ? l.extra[0]?.endereco : l.extra?.endereco) ?? null,
    observacoes: e.observacoes,
    tags: e.tags,
    custom_fields: e.custom_fields,
  };
}

/**
 * As empresas da organização, indexadas pelas duas chaves de casamento.
 *
 * A fusão APAGA a perdedora de `companies` (ela vira lápide em
 * `mia_companies_mescladas`): não há ficha aposentada para casar por engano.
 */
export class EmpresasDaBase {
  private readonly porCnpj = new Map<string, EmpresaNaBase>();
  private readonly porNome = new Map<string, EmpresaNaBase[]>();
  private readonly chaveDoNomePorId = new Map<string, string>();

  static async carregar(ctx: ContextoDaFerramenta, orgId: string): Promise<EmpresasDaBase> {
    const linhas = await lerEmPaginas<LinhaDaEmpresa>((depoisDoId) => {
      const consulta = ctx.admin.from("companies").select(COLUNAS_DA_EMPRESA_UNICA).eq("organization_id", orgId);
      return (depoisDoId ? consulta.gt("id", depoisDoId) : consulta)
        .order("id", { ascending: true })
        .limit(TAMANHO_DA_PAGINA);
    });
    // O que é só nosso (endereço, observações, etiquetas, campos) vem à parte,
    // nas mesmas páginas por chave (a chave de `mia_companies_extra` é a empresa).
    const extras = await lerEmPaginas<ExtraDaEmpresa & { id: string; company_id: string }>((depoisDoId) => {
      const consulta = ctx.admin.from("mia_companies_extra").select(COLUNAS_DO_QUE_E_SO_NOSSO).eq("organization_id", orgId);
      return (depoisDoId ? consulta.gt("company_id", depoisDoId) : consulta)
        .order("company_id", { ascending: true })
        .limit(TAMANHO_DA_PAGINA)
        .then((r) => ({
          data: ((r.data ?? []) as Array<ExtraDaEmpresa & { company_id: string }>).map((x) => ({ ...x, id: x.company_id })),
          error: r.error,
        }));
    });
    const porEmpresa = new Map(extras.map((x) => [x.company_id, x]));
    const base = new EmpresasDaBase();
    for (const linha of linhas) base.incluir(empresaNaBaseDe({ ...linha, extra: porEmpresa.get(linha.id) ?? null }));
    return base;
  }

  /** Põe (ou repõe, depois de uma atualização) uma empresa nos dois índices. */
  incluir(empresa: EmpresaNaBase): void {
    const cnpj = apenasDigitos(empresa.cnpj ?? "");
    if (cnpj) this.porCnpj.set(cnpj, empresa);

    // O nome pode ter mudado: a ficha sai da chave antiga antes de entrar na nova.
    const chaveAntiga = this.chaveDoNomePorId.get(empresa.id);
    if (chaveAntiga !== undefined) {
      const resto = (this.porNome.get(chaveAntiga) ?? []).filter((e) => e.id !== empresa.id);
      if (resto.length > 0) this.porNome.set(chaveAntiga, resto);
      else this.porNome.delete(chaveAntiga);
    }
    const chave = nomeComparavel(empresa.nome);
    this.chaveDoNomePorId.set(empresa.id, chave);
    if (!chave) return;
    this.porNome.set(chave, [...(this.porNome.get(chave) ?? []), empresa]);
  }

  /**
   * A empresa que este item É, ou `null` quando ela ainda não existe.
   *
   * `ambigua` avisa quando o nome casa com mais de uma ficha e não há CNPJ para
   * desempatar: a importação fica com a mais antiga, e quem migra precisa saber.
   */
  achar(nome: string | null, cnpj: string | null): { empresa: EmpresaNaBase | null; ambigua: boolean } {
    if (cnpj) {
      const pelaChave = this.porCnpj.get(cnpj);
      if (pelaChave) return { empresa: pelaChave, ambigua: false };
    }
    if (!nome) return { empresa: null, ambigua: false };
    const homonimas = this.porNome.get(nomeComparavel(nome)) ?? [];
    if (homonimas.length === 0) return { empresa: null, ambigua: false };
    if (cnpj) {
      // Com CNPJ na mão, só é a mesma empresa a ficha que ainda NÃO tem CNPJ
      // (a importação vai preenchê-lo). Homônima com outro CNPJ é outra empresa.
      const semCnpj = homonimas.filter((e) => !apenasDigitos(e.cnpj ?? ""));
      return { empresa: semCnpj[0] ?? null, ambigua: semCnpj.length > 1 };
    }
    return { empresa: homonimas[0]!, ambigua: homonimas.length > 1 };
  }

  /** A primeira empresa SEM CNPJ igual cujo nome parece este (o aviso do protótipo). */
  parecida(nome: string): EmpresaNaBase | null {
    for (const lista of this.porNome.values()) {
      for (const e of lista) if (pareceAMesma(nome, e.nome)) return e;
    }
    return null;
  }
}

interface EmpresaLida {
  nome: string;
  cnpj: string | null;
  site: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  observacoes: string | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
}

/** Os campos de texto que seguem a mesma regra de completar ou atualizar. */
const CAMPOS_DE_TEXTO = ["site", "telefone", "email", "endereco", "observacoes"] as const;

/**
 * O que muda numa ficha que já existe, e o que ficou de fora.
 *
 * `completar` nunca troca um valor preenchido; `atualizar` troca pelo que veio.
 * Nos dois, o que não veio fica como está, e etiqueta só soma.
 */
export function mudancasDaEmpresa(
  atual: EmpresaNaBase,
  nova: EmpresaLida,
  modo: QuandoJaExiste,
): { patch: Record<string, unknown>; naoAplicados: string[] } {
  const patch: Record<string, unknown> = {};
  const naoAplicados: string[] = [];

  if (nova.nome !== atual.nome) {
    if (modo === "atualizar") patch.nome = nova.nome;
    else naoAplicados.push("nome");
  }

  // CNPJ só PREENCHE. Trocar o CNPJ de uma ficha é trocar de empresa, e isso
  // não é decisão que uma lista toma, em modo nenhum.
  const cnpjAtual = apenasDigitos(atual.cnpj ?? "");
  if (nova.cnpj && !cnpjAtual) patch.cnpj = nova.cnpj;
  else if (nova.cnpj && cnpjAtual && nova.cnpj !== cnpjAtual) naoAplicados.push("cnpj");

  for (const campo of CAMPOS_DE_TEXTO) {
    const veio = nova[campo];
    if (!veio) continue;
    const havia = (atual[campo] ?? "").trim();
    if (veio === havia) continue;
    if (!havia || modo === "atualizar") patch[campo] = veio;
    else naoAplicados.push(CAMPO_DA_EMPRESA[campo] ?? campo);
  }

  const etiquetas = somarEtiquetas(atual.tags ?? [], nova.tags);
  if (etiquetas.length !== (atual.tags ?? []).length) patch.tags = etiquetas;

  const camposAtuais = atual.custom_fields ?? {};
  const camposNovos: Record<string, unknown> = { ...camposAtuais };
  let mudouCampo = false;
  for (const [chave, valor] of Object.entries(nova.custom_fields)) {
    if (!(chave in camposAtuais)) {
      camposNovos[chave] = valor;
      mudouCampo = true;
    } else if (!mesmoValor(camposAtuais[chave], valor)) {
      if (modo === "atualizar") {
        camposNovos[chave] = valor;
        mudouCampo = true;
      } else {
        naoAplicados.push(`campos.${chave}`);
      }
    }
  }
  if (mudouCampo) patch.custom_fields = camposNovos;

  return { patch, naoAplicados };
}

/** Lê e valida UM item com o schema da tela. Devolve a recusa pronta quando não passa. */
function lerEmpresa(
  item: unknown,
): { ok: true; empresa: EmpresaLida } | { ok: false; campo: string; esperado: string; exemplo?: string } {
  if (!ehObjeto(item)) {
    return {
      ok: false,
      campo: "(item)",
      esperado: "cada empresa é um objeto com pelo menos o `nome`.",
      exemplo: JSON.stringify({ nome: EXEMPLO_DE_EMPRESA.nome, cnpj: EXEMPLO_DE_EMPRESA.cnpj }),
    };
  }
  const nome = texto(item.nome, 400);
  if (!nome) {
    return { ok: false, campo: "nome", esperado: "toda empresa precisa de um nome.", exemplo: EXEMPLO_POR_CAMPO.nome };
  }

  const candidato: Record<string, unknown> = { nome };
  for (const campo of ["cnpj", ...CAMPOS_DE_TEXTO] as const) {
    const valor = texto(item[campo], 4000);
    if (valor) candidato[campo] = valor;
  }
  if (item.etiquetas !== undefined && item.etiquetas !== null) candidato.tags = item.etiquetas;
  if (item.campos !== undefined && item.campos !== null) candidato.custom_fields = item.campos;

  const parsed = empresaCreateSchema.safeParse(candidato);
  if (!parsed.success) {
    const problema = explicarProblemaDoSchema(parsed.error.issues[0]!, CAMPO_DA_EMPRESA);
    return { ok: false, ...problema, exemplo: EXEMPLO_POR_CAMPO[problema.campo] };
  }
  const d = parsed.data;
  return {
    ok: true,
    empresa: {
      nome: d.nome,
      cnpj: d.cnpj ? d.cnpj : null,
      site: d.site || null,
      telefone: d.telefone || null,
      email: d.email || null,
      endereco: d.endereco || null,
      observacoes: d.observacoes || null,
      tags: [...new Set(d.tags ?? [])],
      custom_fields: d.custom_fields ?? {},
    },
  };
}

export async function importarEmpresas(
  ctx: ContextoDaFerramenta,
  args: Record<string, unknown>,
): Promise<ResultadoDoLote> {
  const organizacao = await organizacaoDaImportacao(ctx.admin, args.organization_id);
  const itens = listaDeItens(args, "empresas", TETO_DE_EMPRESAS, EXEMPLO_DE_EMPRESA);
  const modo = modoQuandoJaExiste(args.quando_ja_existe);
  const origem = origemDaImportacao(args.origem, false);
  const requestId = requestIdDe(ctx);

  const base = await EmpresasDaBase.carregar(ctx, organizacao.id);
  const coletor = new Coletor();

  for (let i = 0; i < itens.length; i += 1) {
    const posicao = i + 1;
    const lida = lerEmpresa(itens[i]);
    if (!lida.ok) {
      coletor.recusar(posicao, lida.campo, lida.esperado, lida.exemplo);
      continue;
    }
    const nova = lida.empresa;

    // Nome de uma ou duas letras não identifica empresa nenhuma, e sem CNPJ
    // casaria com qualquer homônima. Mesma recusa de `acharOuCriarEmpresa`.
    if (!nova.cnpj && nomeComparavel(nova.nome).length < 3) {
      coletor.recusar(
        posicao,
        "nome",
        "o nome é curto demais para identificar uma empresa sem CNPJ. Informe o nome completo ou o CNPJ.",
        EXEMPLO_POR_CAMPO.nome,
      );
      continue;
    }

    const { empresa: existente, ambigua } = base.achar(nova.nome, nova.cnpj);
    const avisos: string[] = [];
    if (ambigua) {
      avisos.push(
        "Há mais de uma empresa com este nome na base e a lista não trouxe CNPJ: fiquei com a mais antiga. " +
          "Informe o CNPJ para escolher, ou junte as fichas pela tela (Empresas › Mesclar).",
      );
    }

    if (existente) {
      const { patch, naoAplicados } = mudancasDaEmpresa(existente, nova, modo);
      if (naoAplicados.length > 0) {
        avisos.push(
          `A base já tem outro valor em: ${naoAplicados.join(", ")}. Mantive o que estava` +
            (naoAplicados.includes("cnpj")
              ? " (o CNPJ de uma ficha nunca é trocado pela importação)."
              : '. Para substituir, repita com quando_ja_existe: "atualizar".'),
        );
      }
      if (Object.keys(patch).length === 0) {
        coletor.registrar(posicao, "ja_estava", { id: existente.id, avisos });
        continue;
      }
      const gravada = await gravarEmpresa(ctx.admin, organizacao.id, existente.id, patch as DadosDaEmpresa);
      if (!gravada.ok) {
        coletor.recusar(
          posicao,
          "(gravação)",
          gravada.motivo === "cnpj_ja_cadastrado"
            ? "o CNPJ informado já é de OUTRA empresa desta base."
            : `o banco recusou a atualização: ${gravada.detalhe ?? gravada.motivo}.`,
        );
        continue;
      }
      base.incluir({ ...existente, ...(patch as Partial<EmpresaNaBase>) });
      coletor.registrar(posicao, "atualizou", { id: existente.id, avisos });
      continue;
    }

    // Sem CNPJ e com um nome PARECIDO com outra (protótipo: "nome parecido sem
    // CNPJ só avisa"): entra como nova, e quem migra sabe que pode ser a mesma.
    const parecida = nova.cnpj ? null : base.parecida(nova.nome);
    if (parecida) {
      avisos.push(
        `O nome parece o de «${parecida.nome}», que já está na base, e a lista não trouxe CNPJ para confirmar. ` +
          "Entrou como empresa nova; se for a mesma, junte as duas pela tela (Empresas › Mesclar).",
      );
    }
    const gravada = await gravarEmpresa(ctx.admin, organizacao.id, null, {
      nome: nova.nome,
      // `null`, nunca `''`: o índice único de CNPJ ignora nulo e trata vazio
      // como valor (o mesmo cuidado de `POST /api/v1/empresas`).
      cnpj: nova.cnpj,
      site: nova.site,
      telefone: nova.telefone,
      email: nova.email,
      endereco: nova.endereco,
      observacoes: nova.observacoes,
      tags: nova.tags,
      custom_fields: nova.custom_fields,
      criado_por: ctx.autorUserId,
    });
    if (!gravada.ok) {
      coletor.recusar(
        posicao,
        "(gravação)",
        gravada.motivo === "cnpj_ja_cadastrado"
          ? "já existe uma empresa com este CNPJ, gravada enquanto esta importação rodava. Repita a chamada: ela será reconhecida."
          : `o banco recusou a criação: ${gravada.detalhe ?? gravada.motivo}.`,
      );
      continue;
    }
    const criada: EmpresaNaBase = { id: gravada.id, ...nova };
    base.incluir(criada);
    coletor.registrar(posicao, "criou", { id: criada.id, avisos });
  }

  await registrarImportacao(ctx, {
    organizacao,
    ferramenta: "plataforma_importar_empresas",
    tipo: "empresas",
    origem,
    coletor,
    requestId,
    extra: { quando_ja_existe: modo },
  });

  return coletor.resultado(organizacao);
}

export const FERRAMENTA_IMPORTAR_EMPRESAS: FerramentaDeImportacao = {
  name: "plataforma_importar_empresas",
  description:
    "Importa EMPRESAS (os clientes que são organizações) da base de outro CRM para um cliente da plataforma. " +
    "É o passo 3 de uma migração: equipe → funis → empresas → contatos → negócios → materiais. Importe as " +
    "empresas ANTES dos contatos e dos negócios, que se ligam a elas pelo CNPJ ou pelo nome.\n\n" +
    `Teto: ${TETO_DE_EMPRESAS} empresas por chamada. Lista maior: chame várias vezes; a resposta traz as contagens.\n\n` +
    "Pode ser repetida sem duplicar: a empresa é reconhecida pelo CNPJ (com ou sem pontuação é o mesmo) e, sem " +
    "CNPJ, pelo nome (sem diferenciar maiúsculas, acentos nem LTDA/ME/SA). A resposta diz, item a item (posição " +
    "começando em 1), se criou, atualizou, já estava igual ou recusou e por quê. Um item ruim não derruba os outros.\n\n" +
    "O que NÃO faz: não envia nada a ninguém, não consulta a Receita, não apaga empresa nem campo que não veio na lista, " +
    "e nunca troca o CNPJ de uma empresa que já tem um.",
  inputSchema: {
    organization_id: z.string().describe("O id do cliente que recebe a base (de plataforma_listar_clientes)."),
    empresas: z
      .array(z.unknown())
      .describe(
        `Até ${TETO_DE_EMPRESAS} empresas. Cada uma: nome (obrigatório), cnpj, telefone, email, site, endereco, ` +
          "observacoes, etiquetas (lista de textos) e campos (objeto com campos adicionais). " +
          `Exemplo: ${JSON.stringify(EXEMPLO_DE_EMPRESA)}`,
      ),
    origem: z
      .string()
      .optional()
      .describe('De qual sistema a base vem, em minúsculas e sem espaço (ex.: "rdstation"). Vai para o registro da importação.'),
    quando_ja_existe: z
      .string()
      .optional()
      .describe(
        '"completar" (padrão): só preenche o que está vazio na empresa que já existe. ' +
          '"atualizar": o que veio preenchido substitui o que havia. Nos dois, etiqueta só soma e nada é apagado.',
      ),
  },
  operacao: OPERACAO_IMPORTAR_BASE,
  exemplo: { organization_id: "00000000-0000-4000-8000-000000000001", origem: "rdstation", empresas: [EXEMPLO_DE_EMPRESA] },
  handler: importarEmpresas,
  redigirParaAuditoria: redigirLote(["organization_id", "origem", "quando_ja_existe"], ["empresas"]),
};
