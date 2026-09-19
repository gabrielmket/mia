/**
 * As ferramentas do MCP de PLATAFORMA (item E6).
 *
 * ── O desenho em uma frase ────────────────────────────────────────────────
 *
 * LER é livre; ESCREVER é nomeado. Toda ferramenta de escrita declara a chave
 * da operação que o token precisa carregar (`lib/mcp-plataforma/operacoes.ts`),
 * e o servidor recusa antes de tocar no banco.
 *
 * ── Por que cada escrita reusa o caminho que a TELA já usa ────────────────
 *
 * `plataforma_criar_cliente` chama `fn_create_tenant_with_owner`, a mesma RPC de
 * `POST /api/v1/admin/tenants`. `plataforma_lancar_credito` escreve em
 * `tenant_wallet_ledger` com o mesmo `ref_kind` da tela.
 *
 * A alternativa — reimplementar aqui — criaria um segundo jeito de criar
 * cliente, e no primeiro conserto os dois divergiriam. O sintoma seria um
 * cliente criado pelo MCP nascendo diferente de um criado pela tela, e a
 * diferença aparecendo semanas depois, numa feature que supõe o que só a tela
 * faz.
 *
 * ── O ATOR, que é a parte que merece atenção ──────────────────────────────
 *
 * As colunas de autoria (`created_by`) são FK para `auth.users`: um token não é
 * usuário e não cabe ali. O ator gravado é QUEM CRIOU O TOKEN — a pessoa que
 * respondeu por ele existir. A auditoria carrega o token junto, então "quem
 * fez" tem as duas metades: a pessoa responsável e a chave usada.
 */
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { MODULOS } from "@/lib/modulos/catalogo";
import { STATUS_SAUDAVEL } from "@/lib/channels/health";
import { saldoDaPlataforma } from "@/lib/ai/custo/saldo-da-plataforma";
import { CARIMBO_DO_SCHEMA, TABELA_DO_CARIMBO } from "@/lib/schema/carimbo";

export interface ContextoDaFerramenta {
  admin: SupabaseClient;
  /** O usuário que criou o token — o ator gravado nas colunas de autoria. */
  autorUserId: string;
  tokenId: string;
}

export interface FerramentaDePlataforma {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  /** `null` = leitura livre. Caso contrário, a chave que o token precisa ter. */
  operacao: string | null;
  handler: (ctx: ContextoDaFerramenta, args: Record<string, unknown>) => Promise<unknown>;
}

/** Quantos clientes uma listagem devolve de uma vez. */
const TETO_DA_LISTA = 200;

export const FERRAMENTAS: readonly FerramentaDePlataforma[] = [
  // ── LEITURA ─────────────────────────────────────────────────────────────
  {
    name: "plataforma_listar_clientes",
    description:
      "Lista as organizações desta instalação, com situação e data de entrada. " +
      "Use para achar o id de um cliente antes de qualquer outra operação.",
    inputSchema: {
      busca: z
        .string()
        .trim()
        .max(120)
        .optional()
        .describe("Filtra por parte do nome. Sem isto, devolve todas."),
    },
    operacao: null,
    handler: async ({ admin }, args) => {
      let q = admin
        .from("organizations")
        .select("id, display_name, legal_name, slug, status, onboarded_at, created_at")
        .order("created_at", { ascending: false })
        .limit(TETO_DA_LISTA);
      const busca = typeof args.busca === "string" ? args.busca.trim() : "";
      if (busca) q = q.ilike("display_name", `%${busca}%`);
      const { data, error } = await q;
      if (error) throw new Error(`não consegui listar os clientes: ${error.message}`);
      return { clientes: data ?? [] };
    },
  },
  {
    name: "plataforma_ver_cliente",
    description:
      "O retrato de um cliente: dados de cadastro, módulos liberados, saldo da " +
      "carteira e números de WhatsApp conectados.",
    inputSchema: {
      organization_id: z.string().uuid().describe("O id do cliente."),
    },
    operacao: null,
    handler: async ({ admin }, args) => {
      const id = String(args.organization_id);

      const [org, modulos, canais, saldo] = await Promise.all([
        admin
          .from("organizations")
          .select("id, display_name, legal_name, cnpj, slug, status, onboarded_at, settings")
          .eq("id", id)
          .maybeSingle(),
        // `revoked_at is null` é obrigatório: a linha revogada FICA na tabela
        // (é o histórico), e contá-la aqui diria que o cliente tem um módulo
        // que ele cancelou — bem no retrato que alguém usa para decidir.
        admin
          .from("organization_modules")
          .select("modulo, granted_at")
          .eq("organization_id", id)
          .is("revoked_at", null),
        admin
          .from("channel_sessions")
          .select("id, display_name, phone_number, provider, status")
          .eq("organization_id", id)
          .is("archived_at", null),
        admin
          .from("tenant_wallet_ledger")
          .select("tipo, amount_cents")
          .eq("organization_id", id)
          .limit(5_000),
      ]);

      if (!org.data) throw new Error("cliente não encontrado");

      // O saldo é somado AQUI e não lido de uma coluna: o livro-caixa é a
      // verdade, e um total guardado em campo é a primeira coisa a divergir.
      const linhas = (saldo.data ?? []) as Array<{ tipo: string; amount_cents: number }>;
      const saldoCents = linhas.reduce(
        (soma, l) => soma + (l.tipo === "debito" ? -l.amount_cents : l.amount_cents),
        0,
      );

      return {
        cliente: org.data,
        modulos: (modulos.data ?? []).map((m) => (m as { modulo: string }).modulo),
        canais: canais.data ?? [],
        saldo_cents: saldoCents,
      };
    },
  },
  {
    name: "plataforma_listar_modulos",
    description:
      "Os módulos que se vendem separado, com o que cada um destrava. Use para " +
      "saber a chave antes de liberar.",
    inputSchema: {},
    operacao: null,
    handler: async () => ({
      modulos: MODULOS.map((m) => ({
        chave: m.chave,
        rotulo: m.rotulo,
        descricao: m.descricao,
        telas: m.telas,
      })),
    }),
  },

  {
    name: "plataforma_ver_saude",
    description:
      "O estado da INSTALAÇÃO numa resposta: o schema veio junto com o código " +
      "no último deploy, quais números estão fora do ar e quanto resta de " +
      "crédito de IA. É a primeira pergunta depois de implantar.",
    inputSchema: {},
    operacao: null,
    handler: async ({ admin }) => {
      const [carimbo, caidos, saldo] = await Promise.all([
        admin
          .from(TABELA_DO_CARIMBO)
          .select("migration_mais_nova, aplicado_em, erros_inesperados, erros_amostra")
          .eq("id", 1)
          .maybeSingle(),
        admin
          .from("channel_sessions")
          .select("id, organization_id, display_name, phone_number, status, e_numero_de_avisos")
          .is("archived_at", null)
          .neq("status", STATUS_SAUDAVEL)
          .limit(50),
        saldoDaPlataforma(admin),
      ]);

      const linha = carimbo.data as {
        migration_mais_nova: string | null;
        aplicado_em: string | null;
        erros_inesperados: number | null;
        erros_amostra: string | null;
      } | null;

      return {
        schema: {
          no_banco: linha?.migration_mais_nova ?? null,
          esperado: CARIMBO_DO_SCHEMA,
          aplicado_em: linha?.aplicado_em ?? null,
          erros: linha?.erros_inesperados ?? 0,
          // ⚠️ A AMOSTRA SAI AQUI, e não sai em `/api/v1/health` sem segredo.
          // A diferença é quem pergunta: a saúde é pública (um monitor externo
          // bate nela), e mensagem de erro de Postgres carrega nome de tabela,
          // de coluna e às vezes o valor que violou a constraint. Quem chega
          // por aqui já apresentou um token de plataforma.
          amostra_do_erro: linha?.erros_amostra ?? null,
          em_dia: linha?.migration_mais_nova === CARIMBO_DO_SCHEMA
            && (linha?.erros_inesperados ?? 0) === 0,
        },
        // O número de AVISOS caído é outro tamanho de problema: enquanto ele
        // estiver fora, NENHUM cliente recebe aviso de bastão. Marcá-lo aqui
        // evita que ele se esconda numa lista de canais caídos.
        canais_fora_do_ar: (caidos.data ?? []).map((c) => {
          const s = c as {
            id: string;
            organization_id: string;
            display_name: string | null;
            phone_number: string | null;
            status: string | null;
            e_numero_de_avisos: boolean | null;
          };
          return {
            id: s.id,
            organization_id: s.organization_id,
            nome: s.display_name ?? s.phone_number ?? s.id,
            status: s.status,
            e_o_numero_de_avisos: s.e_numero_de_avisos === true,
          };
        }),
        credito_de_ia: {
          saldo_usd: saldo.saldoUsd,
          dias_restantes: saldo.diasRestantes,
        },
      };
    },
  },

  // ── ESCRITA ─────────────────────────────────────────────────────────────
  {
    name: "plataforma_criar_cliente",
    description:
      "Cria uma organização nova e o acesso do dono dela. Idempotente pela " +
      "chave informada: repetir a chamada com a mesma chave não cria duas.",
    inputSchema: {
      display_name: z.string().trim().min(1).max(120).describe("Nome do cliente."),
      slug: z
        .string()
        .trim()
        .regex(/^[a-z0-9-]+$/, "só minúsculas, números e hífen")
        .min(2)
        .max(60)
        .describe("Identificador na URL. Não muda depois."),
      owner_email: z.string().email().describe("E-mail de quem vai administrar o cliente."),
      chave: z
        .string()
        .uuid()
        .describe(
          "Chave de idempotência (uuid). Invente uma por cliente e repita-a se " +
            "precisar tentar de novo.",
        ),
    },
    operacao: "criar_cliente",
    handler: async ({ admin, autorUserId }, args) => {
      const pedido = {
        display_name: String(args.display_name).trim(),
        slug: String(args.slug).trim(),
        owner_email: String(args.owner_email).trim().toLowerCase(),
      };
      // O `p_hash` é o que faz a idempotência RECUSAR em vez de devolver o
      // resultado antigo quando a mesma chave chega com dados diferentes —
      // sem ele, um erro de digitação na segunda tentativa passaria calado.
      const { createHash } = await import("node:crypto");
      const { data, error } = await admin.rpc("fn_create_tenant_with_owner", {
        p_actor: autorUserId,
        p_key: String(args.chave),
        p_request: pedido,
        p_hash: createHash("sha256").update(JSON.stringify(pedido)).digest("hex"),
      });
      if (error) {
        if (error.code === "23505" || error.code === "22023") {
          throw new Error(
            "esse identificador já existe, ou a mesma chave foi usada com outros dados",
          );
        }
        throw new Error(`não consegui criar o cliente: ${error.message}`);
      }
      return data;
    },
  },
  {
    name: "plataforma_liberar_modulo",
    description:
      "Libera um módulo vendido para um cliente. Passe `liberar: false` para tirar.",
    inputSchema: {
      organization_id: z.string().uuid(),
      modulo: z.string().trim().min(1).max(60).describe("A chave do módulo."),
      liberar: z.boolean().describe("true libera, false tira."),
      motivo: z.string().trim().max(200).optional().describe("Por quê. Vai para a auditoria."),
    },
    operacao: "liberar_modulo",
    handler: async ({ admin, autorUserId }, args) => {
      const chave = String(args.modulo);
      if (!MODULOS.some((m) => m.chave === chave)) {
        // Recusar o desconhecido, e não gravá-lo: um módulo escrito errado
        // ficaria na tabela sem destravar nada, e o sintoma seria "liberei e
        // o cliente não vê" — com a linha lá, dizendo que está liberado.
        throw new Error(
          `módulo desconhecido: ${chave}. Use plataforma_listar_modulos para ver as chaves.`,
        );
      }
      const orgId = String(args.organization_id);

      if (args.liberar === false) {
        // ⚠️ REVOGA, não apaga — e é a tabela que manda: apagar a linha
        // responderia "nunca teve" a quem for perguntar por que a tela sumiu,
        // que é outra história, e a errada. Só alcança a liberação VIVA (o
        // índice único é parcial; revogadas podem se repetir).
        const { error } = await admin
          .from("organization_modules")
          .update({ revoked_at: new Date().toISOString(), revoked_by: autorUserId })
          .eq("organization_id", orgId)
          .eq("modulo", chave)
          .is("revoked_at", null);
        if (error) throw new Error(`não consegui tirar o módulo: ${error.message}`);
        return { modulo: chave, liberado: false };
      }

      // INSERT e não upsert: o índice único parcial já recusa uma segunda
      // liberação viva, e a recusa é a resposta certa — "já está liberado" não
      // é erro de quem pediu, mas também não é uma liberação nova para contar.
      const { error } = await admin.from("organization_modules").insert({
        organization_id: orgId,
        modulo: chave,
        granted_by: autorUserId,
        note: typeof args.motivo === "string" ? args.motivo : null,
      });
      if (error) {
        if (error.code === "23505") return { modulo: chave, liberado: true, ja_estava: true };
        throw new Error(`não consegui liberar o módulo: ${error.message}`);
      }
      return { modulo: chave, liberado: true };
    },
  },
  {
    name: "plataforma_lancar_credito",
    description:
      "Lança crédito (ou estorno) na carteira de disparo de um cliente. O valor " +
      "é em CENTAVOS e sempre positivo — o sinal vem do tipo.",
    inputSchema: {
      organization_id: z.string().uuid(),
      tipo: z
        .enum(["credito", "estorno"])
        .describe(
          "Débito não entra aqui: débito é consequência de um envio, e quem o " +
            "escreve é o motor, com a mensagem que o justifica.",
        ),
      amount_cents: z.number().int().positive().max(1_000_000_00),
      note: z.string().trim().max(200).optional(),
    },
    operacao: "lancar_credito",
    handler: async ({ admin, autorUserId }, args) => {
      const { data, error } = await admin
        .from("tenant_wallet_ledger")
        .insert({
          organization_id: String(args.organization_id),
          tipo: String(args.tipo),
          amount_cents: Number(args.amount_cents),
          occurred_at: new Date().toISOString(),
          // O MESMO `ref_kind` da tela: dois nomes para o mesmo fato fariam o
          // extrato do cliente contar duas categorias que são uma só.
          ref_kind: "recarga_manual",
          note: typeof args.note === "string" ? args.note : null,
          created_by: autorUserId,
        })
        .select("id, tipo, amount_cents, occurred_at, note")
        .single();
      if (error || !data) throw new Error(`não consegui lançar: ${error?.message ?? "sem linha"}`);
      return data;
    },
  },
  {
    name: "plataforma_definir_preco",
    description:
      "Define quanto cada mensagem de disparo custa ao cliente, em CENTAVOS. " +
      "Passe `null` para devolver o cliente ao estado 'sem preço acordado', em " +
      "que o disparador recusa.",
    inputSchema: {
      organization_id: z.string().uuid(),
      preco_por_mensagem_cents: z
        .number()
        .int()
        .min(0)
        .max(100_000)
        .nullable()
        .describe("Centavos por mensagem. `null` = sem preço acordado."),
      alerta_saldo_cents: z
        .number()
        .int()
        .min(0)
        .nullable()
        .optional()
        .describe("A partir de quanto avisar que o saldo está acabando."),
    },
    operacao: "definir_preco",
    handler: async ({ admin, autorUserId }, args) => {
      const preco = args.preco_por_mensagem_cents;
      const { error } = await admin.from("tenant_broadcast_pricing").upsert(
        {
          organization_id: String(args.organization_id),
          preco_por_mensagem_cents: preco === null ? null : Number(preco),
          alerta_saldo_cents:
            typeof args.alerta_saldo_cents === "number" ? args.alerta_saldo_cents : null,
          updated_at: new Date().toISOString(),
          updated_by: autorUserId,
        },
        { onConflict: "organization_id" },
      );
      if (error) throw new Error(`não consegui gravar o preço: ${error.message}`);
      // O valor volta na resposta de propósito: preço é dinheiro, e quem
      // acabou de gravá-lo por conversa precisa ver o número que ficou — não
      // um "ok" que esconde um zero digitado a mais.
      return {
        organization_id: String(args.organization_id),
        preco_por_mensagem_cents: preco === null ? null : Number(preco),
      };
    },
  },
] as const;

export const FERRAMENTA_POR_NOME = new Map(FERRAMENTAS.map((f) => [f.name, f]));
