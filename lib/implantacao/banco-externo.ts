/**
 * FORK MIA — o CLIENTE NAS CONVERSAS de uma conexão de BANCO EXTERNO (upstream
 * 1.74, 0558): qual coluna das tabelas do banco do cliente guarda o telefone ou
 * o e-mail de quem está conversando. Com ela escolhida, durante a conversa de
 * atendimento o agente só lê as linhas daquela pessoa.
 *
 * ── O que esta operação NUNCA toca ────────────────────────────────────────
 *
 * A conexão em si (endereço, porta, banco, usuário, senha, TLS) é credencial do
 * cliente e é criada e testada por uma pessoa na tela (Dados externos). Aqui só
 * se ajustam `customer_key_column` e `customer_key_kind` numa conexão que JÁ
 * existe. A leitura é pela visão segura (`external_db_connections_safe`), e nem
 * ela devolve endereço, usuário ou senha: a resposta traz o rótulo da conexão.
 *
 * ── O caminho da tela que isto espelha ────────────────────────────────────
 *
 * `PATCH /api/v1/external-db/connections/[id]`: o módulo da instalação ligado
 * (`banco_externo`; desligado, as rotas respondem 404), `atualizarConexaoSchema`
 * (coluna e tipo andam juntos, ou nenhum dos dois) e a auditoria
 * `external_db_connection.updated`. Trocar só a chave do cliente não troca a
 * conexão, então o pool aberto não precisa ser fechado (a rota só fecha quando
 * muda endereço, porta, usuário, banco, TLS ou senha).
 *
 * ── As fontes liberadas (.81, upstream 0618) ──────────────────────────────
 *
 * `PUT /api/v1/external-db/connections/[id]/sources`: o MODO (`all` lê
 * qualquer tabela que o usuário do banco enxerga; `list` só as da lista) e a
 * LISTA inteira de uma vez (`atualizarFontesSchema`), com a auditoria
 * `external_db_sources.updated`. A lista diz NOMES de tabela e de coluna; nunca
 * credencial. Conexão criada pela tela depois da 0618 nasce em `list` e vazia:
 * o agente não lê nada até alguém liberar.
 *
 * ── O motor do banco (.84, upstream 1.86, 0691) ───────────────────────────
 *
 * A conexão guarda o motor (`db_type`: `postgres` ou `mysql`) e o aviso do
 * último teste (`last_test_aviso`, por exemplo "este usuário pode escrever").
 * O motor é escolhido na CRIAÇÃO e não muda depois (trocar = apagar e criar),
 * e criar é da pessoa, na tela: aqui ele só é LIDO, como o aviso. As fontes e a
 * coluna do cliente valem igual para os dois motores.
 */
import { randomUUID } from "node:crypto";

import { audit } from "@/lib/audit";
import { lerFontesDoBanco, MAX_FONTES, type Fonte } from "@/lib/external-db/fontes";
import {
  atualizarConexaoSchema,
  atualizarFontesSchema,
  TIPOS_DE_IDENTIFICADOR,
  type TipoDeIdentificador,
} from "@/lib/external-db/schemas";
import {
  atualizarReceitasSchema,
  ErroDeFixosInvalidos,
  lerReceitasDoBanco,
  validarFixosDaReceita,
} from "@/lib/external-db/receitas/instancias";
import { IDS_DAS_RECEITAS, receitaDe } from "@/lib/external-db/receitas/registro";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

import { acharPorNomeOuId, chaveDoNome, type Desfecho, type Implantacao } from "./base";

/** Só o que é seguro mostrar: nenhum pedaço da credencial nem do endereço. */
const COLUNAS_SEGURAS =
  "id, label, enabled, customer_key_column, customer_key_kind, last_test_ok, last_tested_at, source_mode, sources_count, db_type, last_test_aviso, receitas_count";

/**
 * A volta das ESCRITAS, que é da tabela base: `sources_count` só existe na visão
 * segura (a mesma separação de `COLUNAS_DA_TABELA` na rota do upstream).
 */
const COLUNAS_DA_TABELA =
  "id, label, enabled, customer_key_column, customer_key_kind, last_test_ok, last_tested_at, source_mode, db_type, last_test_aviso";

export interface ConexaoDeBancoExterno {
  id: string;
  label: string;
  enabled: boolean;
  customer_key_column: string | null;
  customer_key_kind: TipoDeIdentificador | null;
  last_test_ok: boolean | null;
  last_tested_at: string | null;
  /** .81 (0618): `all` lê qualquer tabela; `list` só as liberadas. */
  source_mode?: string | null;
  sources_count?: number | null;
  /**
   * .84 — upstream 1.86 (0691): o motor do banco (`postgres` ou `mysql`),
   * escolhido na criação e imutável depois, e o aviso (não erro) do último teste,
   * por exemplo o usuário do MySQL que pode escrever.
   */
  db_type?: string | null;
  last_test_aviso?: string | null;
  /** .86 — upstream 1.87 (0706): quantas receitas prontas a conexão tem (a view segura só expõe a contagem). */
  receitas_count?: number | null;
}

/** .86 — uma RECEITA PRONTA do banco externo, como o MCP a recebe. */
export interface ReceitaPedida {
  /** O id da receita (`woocommerce-produtos`, `wordpress-conteudo`). */
  receita: string;
  /** O nome que o agente e a equipe veem (1 a 80). Com a receita, é a chave: repetir não duplica. */
  rotulo: string;
  /** O que o agente lê para decidir usar (até 300). Ausente: o texto da receita. */
  descricao?: string;
  /** Os parâmetros fixos da receita (ex.: `{ "prefixo": "wp_" }`), conferidos pela régua dela. */
  fixos?: unknown;
  /** Ausente: ligada. */
  ativa?: boolean;
}

export interface PedidoDeBancoExterno {
  /** Rótulo (ou id) de uma conexão que já existe. */
  conexao: string;
  /** `null` tira o filtro: o agente volta a ler sem o recorte do cliente. Ausente: fica como está. */
  cliente_nas_conversas?: { coluna: string; tipo: TipoDeIdentificador } | null;
  /**
   * .81 — as FONTES LIBERADAS (upstream 0618): o modo e a lista inteira, como a
   * tela grava. `modo: "all"` libera tudo que o usuário do banco enxerga (a
   * lista é ignorada pela leitura); `"list"` só o que está em `fontes`.
   */
  fontes_liberadas?: { modo: "all" | "list"; fontes?: Fonte[] };
  /**
   * .86 — as RECEITAS PRONTAS da conexão (upstream 1.87 e 1.88, 0706: produtos
   * do WooCommerce e conteúdo do WordPress, no MySQL): a lista INTEIRA, pelo
   * caminho de `PUT .../connections/[id]/recipes`. `[]` tira todas.
   */
  receitas?: ReceitaPedida[];
}

const MENSAGEM_DO_MODULO =
  "O módulo de banco externo está DESLIGADO nesta instalação: a conexão com banco de outro sistema não existe aqui (as telas e as rotas respondem 404). " +
  "Ligar o módulo é decisão de quem opera a plataforma, na configuração da instalação; não é configuração do cliente.";

export async function lerConexoesDeBancoExterno(c: Pick<Implantacao, "admin" | "orgId">): Promise<ConexaoDeBancoExterno[] | null> {
  if (!(await moduloLigado(c.admin, "banco_externo"))) return null;
  const { data, error } = await c.admin
    .from("external_db_connections_safe")
    .select(COLUNAS_SEGURAS)
    .eq("organization_id", c.orgId)
    .order("label", { ascending: true });
  if (error) throw new Error(`não consegui ler as conexões de banco externo: ${error.message}`);
  return (data ?? []) as unknown as ConexaoDeBancoExterno[];
}

export function retratoDaConexao(x: ConexaoDeBancoExterno): Record<string, unknown> {
  return {
    id: x.id,
    nome: x.label,
    ligada: x.enabled,
    cliente_nas_conversas: x.customer_key_column && x.customer_key_kind ? { coluna: x.customer_key_column, tipo: x.customer_key_kind } : null,
    ultimo_teste_ok: x.last_test_ok ?? null,
    ultimo_teste_em: x.last_tested_at ?? null,
    // .81 (0618): o que o agente pode ler.
    fontes_liberadas: { modo: x.source_mode ?? "all", quantas: x.sources_count ?? 0 },
    // .84 (upstream 0691): o motor e o aviso do último teste que passou.
    tipo_do_banco: x.db_type ?? "postgres",
    aviso_do_ultimo_teste: x.last_test_aviso ?? null,
    // .86 (upstream 0706): quantas receitas prontas a conexão tem.
    receitas: x.receitas_count ?? 0,
  };
}

/**
 * As receitas prontas, pelo caminho de `PUT .../connections/[id]/recipes`: a
 * lista inteira, conferida por `atualizarReceitasSchema`, cada `fixos` pela
 * régua da própria receita (`validarFixosDaReceita`) e cada receita contra o
 * motor da conexão. A instância que já existe (mesma receita e mesmo rótulo)
 * guarda o id. Devolve quantas ficaram, ou `null` quando nada mudou.
 */
async function gravarReceitas(
  c: Implantacao,
  conexao: ConexaoDeBancoExterno,
  pedidas: ReceitaPedida[],
  avisos: string[],
): Promise<number | null> {
  const { data: atual, error: erroLeitura } = await c.admin
    .from("external_db_connections")
    .select("db_type, receitas")
    .eq("organization_id", c.orgId)
    .eq("id", conexao.id)
    .maybeSingle();
  if (erroLeitura) throw new Error(`não consegui ler as receitas: ${erroLeitura.message}`);
  if (!atual) throw new Recusa(`A conexão «${conexao.label}» não existe mais nesta organização.`);
  const lidas = lerReceitasDoBanco((atual as { receitas: unknown }).receitas);
  const gravadas = lidas.ok ? lidas.instancias : [];

  const instancias = pedidas.map((p) => {
    const definicao = receitaDe(p.receita);
    const existente = gravadas.find((g) => g.receita === p.receita && chaveDoNome(g.rotulo) === chaveDoNome(p.rotulo));
    return {
      id: existente?.id ?? randomUUID(),
      receita: p.receita,
      rotulo: p.rotulo.trim(),
      descricao: (p.descricao ?? definicao?.descricao ?? "").trim().slice(0, 300),
      fixos: p.fixos ?? {},
      ativa: p.ativa ?? true,
    };
  });
  const conferido = atualizarReceitasSchema.safeParse({ receitas: instancias });
  if (!conferido.success) {
    const linhas = conferido.error.issues.slice(0, 8).map((i) => {
      const caminho = i.path.map(String);
      return `\`${caminho[0] === "receitas" && caminho[1] !== undefined ? `receitas[${caminho[1]}]${caminho[2] ? `.${caminho[2]}` : ""}` : "receitas"}\`: ${i.message}`;
    });
    throw new Recusa(
      `As receitas não passaram na conferência:\n- ${[...new Set(linhas)].join("\n- ")}\n` +
        `As receitas que existem: ${IDS_DAS_RECEITAS.map((id) => `"${id}"`).join(", ")}. Até 20 por conexão; \`rotulo\` de 1 a 80 caracteres, \`descricao\` até 300.`,
    );
  }
  for (const [i, inst] of conferido.data.receitas.entries()) {
    try {
      validarFixosDaReceita(inst.receita, inst.fixos);
    } catch (err) {
      const detalhe =
        err instanceof ErroDeFixosInvalidos
          ? Object.entries(err.fieldErrors)
              .map(([campo, mensagens]) => `${campo}: ${mensagens.join("; ")}`)
              .join(" | ")
          : err instanceof Error
            ? err.message
            : String(err);
      throw new Recusa(`\`receitas[${i}].fixos\` (receita "${inst.receita}") não passou na régua da receita: ${detalhe}`);
    }
    const definicao = receitaDe(inst.receita);
    const motor = ((atual as { db_type: string | null }).db_type ?? "postgres") as "mysql" | "postgres";
    if (definicao && !definicao.motores.includes(motor)) {
      throw new Recusa(
        `\`receitas[${i}]\`: a receita "${inst.receita}" roda em ${definicao.motores.join(" ou ")}, e a conexão «${conexao.label}» é ${motor}.`,
      );
    }
  }
  if (JSON.stringify(gravadas) === JSON.stringify(conferido.data.receitas)) return null;

  const { error } = await c.admin
    .from("external_db_connections")
    .update({ receitas: conferido.data.receitas })
    .eq("organization_id", c.orgId)
    .eq("id", conexao.id);
  if (error) throw new Error(`não consegui gravar as receitas: ${error.message}`);
  const ativas = conferido.data.receitas.filter((r) => r.ativa).length;
  void audit({
    action: "external_db_recipes.updated",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "external_db_connection",
    resourceId: conexao.id,
    requestId: c.requestId,
    metadata: { receitas: conferido.data.receitas.length, ativas, via: "mcp_plataforma" },
  });
  if (ativas > 0) {
    avisos.push(
      `${ativas} receita(s) pronta(s) LIGADA(S): o agente passa a consultar o banco do cliente por elas na conversa (produtos, preço, estoque, conteúdo do site), ` +
        "sem ninguém escrever SQL. A busca do cliente vira filtro, e o que a receita não mapeou não é lido.",
    );
  }
  return conferido.data.receitas.length;
}

export async function configurarBancoExterno(
  c: Implantacao,
  pedido: PedidoDeBancoExterno,
): Promise<{ conexao: Record<string, unknown>; desfecho: Desfecho; avisos: string[] }> {
  const avisos: string[] = [];
  const conexoes = await lerConexoesDeBancoExterno(c);
  if (conexoes === null) throw new Recusa(MENSAGEM_DO_MODULO);
  const conexao = acharPorNomeOuId(conexoes, pedido.conexao, (x) => x.label, {
    singular: "a conexão de banco externo",
    comoListar:
      "A conexão (endereço, usuário e senha do banco do cliente) é criada e testada por uma pessoa na tela Dados externos (/app/integracao-dados): é credencial e não entra por ferramenta.",
  });

  // .81 — as fontes liberadas vêm antes: são independentes da coluna do cliente.
  let fontesMudaram = false;
  let retrato: ConexaoDeBancoExterno = conexao;
  if (pedido.fontes_liberadas !== undefined) {
    const fontes = await gravarFontesLiberadas(c, conexao, pedido.fontes_liberadas, avisos);
    if (fontes) {
      fontesMudaram = true;
      retrato = { ...retrato, source_mode: fontes.modo, sources_count: fontes.quantas };
    }
  }
  // .86 — as receitas prontas, também independentes da coluna do cliente.
  if (pedido.receitas !== undefined) {
    const quantas = await gravarReceitas(c, conexao, pedido.receitas, avisos);
    if (quantas !== null) {
      fontesMudaram = true;
      retrato = { ...retrato, receitas_count: quantas };
    }
  }
  if (pedido.cliente_nas_conversas === undefined) {
    return { conexao: retratoDaConexao(retrato), desfecho: fontesMudaram ? "atualizou" : "ja_estava", avisos };
  }

  const desejado = {
    customer_key_column: pedido.cliente_nas_conversas?.coluna.trim() ?? null,
    customer_key_kind: pedido.cliente_nas_conversas?.tipo ?? null,
  };
  const conferido = atualizarConexaoSchema.safeParse(desejado);
  if (!conferido.success) {
    throw new Recusa(
      `\`cliente_nas_conversas\` não passou na conferência: a coluna tem de 1 a 128 caracteres, e o tipo é ${TIPOS_DE_IDENTIFICADOR.map((t) => `"${t}"`).join(" ou ")}. ` +
        'Ex.: { "coluna": "telefone_cliente", "tipo": "phone" }. null tira o recorte.',
    );
  }
  if (
    (conexao.customer_key_column ?? null) === desejado.customer_key_column &&
    (conexao.customer_key_kind ?? null) === desejado.customer_key_kind
  ) {
    return { conexao: retratoDaConexao(retrato), desfecho: fontesMudaram ? "atualizou" : "ja_estava", avisos };
  }

  const { data, error } = await c.admin
    .from("external_db_connections")
    .update({ customer_key_column: conferido.data.customer_key_column, customer_key_kind: conferido.data.customer_key_kind })
    .eq("organization_id", c.orgId)
    .eq("id", conexao.id)
    .select(COLUNAS_DA_TABELA)
    .maybeSingle();
  if (error) throw new Error(`não consegui gravar a coluna do cliente: ${error.message}`);
  if (!data) throw new Recusa(`A conexão «${conexao.label}» não existe mais nesta organização.`);
  void audit({
    action: "external_db_connection.updated",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "external_db_connection",
    resourceId: conexao.id,
    requestId: c.requestId,
    metadata: { campos: ["customer_key_column", "customer_key_kind"], senha_trocada: false, via: "mcp_plataforma" },
  });
  if (desejado.customer_key_column) {
    avisos.push(
      `Durante as conversas de atendimento, o agente passa a ler só as linhas em que «${desejado.customer_key_column}» é igual ao ${desejado.customer_key_kind === "phone" ? "telefone" : "e-mail"} de quem está falando. ` +
        "A coluna não é conferida no banco do cliente por aqui: se ela não existir nas tabelas que o agente consulta, a leitura dele volta vazia. Confira na tela Dados externos.",
    );
  } else {
    avisos.push("Sem a coluna do cliente, o agente volta a ler as tabelas sem o recorte de quem está conversando.");
  }
  return {
    conexao: retratoDaConexao({ ...retrato, ...(data as unknown as Partial<ConexaoDeBancoExterno>), sources_count: retrato.sources_count }),
    desfecho: "atualizou",
    avisos,
  };
}

/**
 * As fontes liberadas, pelo caminho de `PUT .../connections/[id]/sources`: o
 * modo e a lista inteira, conferidos por `atualizarFontesSchema`, num UPDATE só.
 * Devolve se mudou. Pedido igual ao gravado não escreve.
 */
async function gravarFontesLiberadas(
  c: Implantacao,
  conexao: ConexaoDeBancoExterno,
  pedido: NonNullable<PedidoDeBancoExterno["fontes_liberadas"]>,
  avisos: string[],
): Promise<{ modo: string; quantas: number } | null> {
  const conferido = atualizarFontesSchema.safeParse({ source_mode: pedido.modo, sources: pedido.fontes ?? [] });
  if (!conferido.success) {
    throw new Recusa(
      "`fontes_liberadas` não passou na conferência: `modo` é \"all\" ou \"list\", e cada fonte é " +
        "{ \"schema\": \"public\", \"tabela\": \"pedidos\", \"colunas\": [\"numero\", \"status\"], \"descricao\": \"Pedidos do cliente\" } " +
        `(até ${MAX_FONTES} fontes, sem repetir a mesma tabela; \`colunas: null\` libera todas as colunas; \`descricao\` pode ser "", até 300 caracteres).`,
    );
  }
  const { data: atual, error: erroLeitura } = await c.admin
    .from("external_db_connections")
    .select("source_mode, sources")
    .eq("organization_id", c.orgId)
    .eq("id", conexao.id)
    .maybeSingle();
  if (erroLeitura) throw new Error(`não consegui ler as fontes liberadas: ${erroLeitura.message}`);
  if (!atual) throw new Recusa(`A conexão «${conexao.label}» não existe mais nesta organização.`);
  const gravadas = lerFontesDoBanco((atual as { sources: unknown }).sources);
  if (
    (atual as { source_mode: string }).source_mode === conferido.data.source_mode &&
    gravadas.ok &&
    JSON.stringify(gravadas.fontes) === JSON.stringify(conferido.data.sources)
  ) {
    return null;
  }
  const { error } = await c.admin
    .from("external_db_connections")
    .update({ source_mode: conferido.data.source_mode, sources: conferido.data.sources })
    .eq("organization_id", c.orgId)
    .eq("id", conexao.id);
  if (error) throw new Error(`não consegui gravar as fontes liberadas: ${error.message}`);
  void audit({
    action: "external_db_sources.updated",
    actorUserId: c.autorUserId,
    organizationId: c.orgId,
    resourceType: "external_db_connection",
    resourceId: conexao.id,
    requestId: c.requestId,
    metadata: { source_mode: conferido.data.source_mode, fontes: conferido.data.sources.length, via: "mcp_plataforma" },
  });
  avisos.push(
    conferido.data.source_mode === "all"
      ? "Modo \"all\": o agente, o MCP externo e a grade leem QUALQUER tabela que o usuário do banco enxerga. Prefira \"list\" com só o que o atendimento precisa."
      : `Modo "list": o agente lê só as ${conferido.data.sources.length} fonte(s) liberadas; o resto do banco some para ele.`,
  );
  return { modo: conferido.data.source_mode, quantas: conferido.data.sources.length };
}
