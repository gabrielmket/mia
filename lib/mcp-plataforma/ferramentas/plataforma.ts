/**
 * As ferramentas que administram a INSTALAÇÃO: clientes, módulos, preço,
 * crédito e saúde (item E6). São as oito com que o MCP de plataforma nasceu;
 * vieram de `lib/mcp-plataforma/ferramentas.ts` sem mudar uma linha de
 * comportamento, quando aquele arquivo virou a lista que junta as áreas.
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
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { MODULOS } from "@/lib/modulos/vendaveis";
import { nomeDoCanal } from "@/lib/channels/estado";
import { STATUS_SAUDAVEL } from "@/lib/channels/health";
import { saldoDaPlataforma } from "@/lib/ai/custo/saldo-da-plataforma";
import { lerSaldoDaCarteira } from "@/lib/carteira/ler-saldo";
import { CARIMBO_DO_SCHEMA, TABELA_DO_CARIMBO } from "@/lib/schema/carimbo";
import { lerCamadaClinica } from "@/lib/implantacao/agente";
import { iaDecideLigadaNa } from "@/lib/implantacao/empresa";
import { lePlanosDoSettings } from "@/lib/tarefas/plano";

import type { FerramentaDePlataforma } from "../tipos";
// FORK MIA (.90): a jornada de assinatura (docs/fork/jornada-de-assinatura.md).
import { moduloLigado } from "@/lib/instalacao/modulos";
import { MODULO_QUE_EXIGE_A_INSTALACAO } from "@/lib/planos-mia/catalogo";
import { lerDetalheDaEmpresa } from "@/lib/planos-mia/empresas-do-cadastro";
import { lerPlanosComModulos } from "@/lib/planos-mia/leitura";
import { modulosPeloPlano } from "@/lib/planos-mia/modulos";
import { seguirOPlano } from "@/lib/planos-mia/seguir-o-plano";
import { recusar } from "../recusa";
// FORK MIA (.96): o passo "Pagamento" do início (docs/fork/pagamento-no-inicio.md).
import { empresasEsperandoOPrimeiroPagamento, passoDoPagamentoParaATime } from "@/lib/pagamento-inicial/para-a-time";
// FORK MIA (.98): o cupom e o parceiro do cliente (docs/fork/cupons-e-parceiros.md).
import { lerCupomEParceiroDaEmpresa } from "@/lib/cupons/na-ficha";
// FORK MIA (.96, segunda frente): as cobranças com a nota fiscal (docs/fork/area-de-cobranca.md).
import { cobrancasParaATime } from "@/lib/area-de-cobranca/para-a-time";

/**
 * A chave do CPF está semeada? Só sim ou não, e o VALOR nunca sai.
 *
 * A pergunta é feita pelo caminho que a gravação usa: o banco cifra um CPF
 * fictício com `encrypt_cpf` (upstream 0597), que lê a chave de
 * `private.app_secrets` (linha `cpf_key`) ou da GUC `app.cpf_key` e recusa com
 * "CPF_ENCRYPTION_KEY ausente" quando não há chave utilizável (menos de 32
 * caracteres). A cifra devolvida é descartada aqui mesmo: não é gravada nem
 * devolvida. O `private` não é exposto ao PostgREST, e é por isso que não se lê
 * a tabela direto.
 */
async function chaveDoCpfSemeada(admin: SupabaseClient): Promise<{ semeada: boolean | null; detalhe?: string }> {
  try {
    const { error } = await admin.rpc("encrypt_cpf", { p_plaintext: "00000000000" });
    if (!error) return { semeada: true };
    if ((error.message ?? "").includes("CPF_ENCRYPTION_KEY")) {
      return {
        semeada: false,
        detalhe:
          "Sem a chave, contato com CPF é salvo SEM o CPF. Quem opera a instalação semeia rodando o bootstrap ou o update.sh (que leva a chave do .env ao banco, ou gera uma).",
      };
    }
    return { semeada: null, detalhe: "Não consegui conferir: o banco recusou a pergunta por outro motivo." };
  } catch {
    return { semeada: null, detalhe: "Não consegui conferir: o banco não respondeu." };
  }
}

/** Quantos clientes uma listagem devolve de uma vez. */
const TETO_DA_LISTA = 200;

export const FERRAMENTAS_DA_PLATAFORMA: readonly FerramentaDePlataforma[] = [
  // ── LEITURA ─────────────────────────────────────────────────────────────
  {
    name: "plataforma_listar_clientes",
    description:
      "Lista as organizações desta instalação, com situação e data de entrada. " +
      "Use para achar o id de um cliente antes de qualquer outra operação. " +
      "`demonstracao: true` é a empresa de demonstração (dados fictícios, nada sai dela): não é cliente. " +
      // FORK MIA (.96): o filtro do primeiro pagamento.
      "Desde a .96, `situacao_do_pagamento: \"aguardando_primeiro_pagamento\"` devolve só quem espera o primeiro pagamento " +
      "(a entrada paga, ou o teste que acabou sem pagamento), cada um com `pagamento_inicial`: a forma escolhida, a situação " +
      "(Pix gerado, boleto, cartão recusado...), o modo e desde quando.",
    inputSchema: {
      busca: z
        .string()
        .trim()
        .max(120)
        .optional()
        .describe("Filtra por parte do nome. Sem isto, devolve todas."),
      situacao_do_pagamento: z
        .enum(["aguardando_primeiro_pagamento"])
        .optional()
        .describe("Só as empresas que esperam o primeiro pagamento (entrada paga, ou o fim do teste sem pagamento)."),
    },
    operacao: null,
    handler: async ({ admin }, args) => {
      let q = admin
        .from("organizations")
        .select("id, display_name, legal_name, slug, status, onboarded_at, created_at, demonstracao")
        .order("created_at", { ascending: false })
        .limit(TETO_DA_LISTA);
      const busca = typeof args.busca === "string" ? args.busca.trim() : "";
      if (busca) q = q.ilike("display_name", `%${busca}%`);
      // FORK MIA (.96): só quem espera o primeiro pagamento, com o passo dele.
      const esperando = args.situacao_do_pagamento === "aguardando_primeiro_pagamento" ? await empresasEsperandoOPrimeiroPagamento(admin) : null;
      if (esperando) {
        if (esperando.size === 0) return { clientes: [] };
        q = q.in("id", [...esperando.keys()]);
      }
      const { data, error } = await q;
      if (error) throw new Error(`não consegui listar os clientes: ${error.message}`);
      if (esperando) {
        return {
          clientes: (data ?? []).map((c) => {
            const { organization_id: _id, ...pagamento } = esperando.get((c as { id: string }).id) ?? ({} as Record<string, unknown>);
            return { ...(c as Record<string, unknown>), pagamento_inicial: pagamento };
          }),
        };
      }
      return { clientes: data ?? [] };
    },
  },
  {
    name: "plataforma_ver_cliente",
    description:
      "O retrato de um cliente: dados de cadastro, módulos liberados, saldo da " +
      "carteira, números de WhatsApp conectados e, em `configuracao`, os interruptores " +
      "da empresa: a limpeza automática de mídia antiga (e em quantos dias), o freio do " +
      "passo \"a IA decide\" das automações, o bloqueio de afirmação clínica dos agentes " +
      "e quantos planos de tarefa existem. " +
      // FORK MIA (.90): a cobrança e a origem.
      "Desde a .90, em `cobranca`: o plano, a situação da cobrança (em teste, em dia, em atraso, suspensa, isenta...), o próximo passo da régua e a " +
      "ORIGEM da empresa (cadastro próprio ou implantação); e em `modulos_com_origem` cada módulo ligado com a origem (pelo plano ou pela Time). " +
      "`modulos` continua sendo só o que a Time liberou à mão. " +
      // FORK MIA (.96): o passo do pagamento.
      "Desde a .96, em `pagamento_inicial`: o passo \"Pagamento\" do início (modo entrada paga ou teste; Pix gerado, boleto, cartão recusado ou pago, " +
      "com a data; a cobrança no Asaas; o final do cartão; o fim do teste) e os dados fiscais resumidos, com o documento mascarado. " +
      "`null` = a empresa não tem o passo. " +
      // FORK MIA (.96, segunda frente): as cobranças com a nota.
      "Em `cobrancas`: as cobranças da empresa no Asaas (as mais novas), com a situação, o número da nota fiscal e o link do PDF da nota, " +
      "para mandar a nota a quem pedir, e o chamado \"A nota saiu errada\" de cada uma (responda com `plataforma_responder_chamado`). " +
      "`null` = a empresa não tem cobrança pelo Asaas; \"nao_lido\" = o Asaas não respondeu. " +
      // FORK MIA (.98): o cupom e o parceiro.
      "Desde a .98, em `cupom_e_parceiro`: o cupom da empresa (o que dá, desde quando, se o desconto já acabou), o parceiro ligado a ela e a comissão fixada, " +
      "o setup de implantação vendido e o total das comissões lançadas. Sem documento nem Pix do parceiro.",
    inputSchema: {
      organization_id: z.string().uuid().describe("O id do cliente."),
    },
    operacao: null,
    handler: async ({ admin }, args) => {
      const id = String(args.organization_id);

      const [org, modulos, canais, saldo] = await Promise.all([
        admin
          .from("organizations")
          .select("id, display_name, legal_name, cnpj, slug, status, onboarded_at, settings, media_retention_days, media_retention_enforced")
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
        // O MESMO saldo da tela e da trava do disparo, pelo extrato inteiro. O
        // `.limit(5_000)` que estava aqui trazia no máximo 1000 linhas.
        lerSaldoDaCarteira(admin, id),
      ]);

      if (!org.data) throw new Error("cliente não encontrado");

      // O saldo é SOMADO do livro-caixa e não lido de uma coluna: um total
      // guardado em campo é a primeira coisa a divergir. Erro de leitura não
      // vira "saldo zero" no retrato que alguém usa para decidir.
      if (saldo.erro) throw new Error(`não consegui ler a carteira: ${saldo.erro}`);

      const linha = org.data as Record<string, unknown>;
      const settings = (linha.settings as Record<string, unknown> | null) ?? {};
      // Leitura que falha não derruba o retrato: diz que não leu.
      const camada = await lerCamadaClinica(admin, id).catch(() => null);

      // FORK MIA (.90): a cobrança, a origem e a origem de cada módulo. Leitura que
      // falha não derruba o retrato: diz que não leu.
      const jornada = await lerDetalheDaEmpresa(admin, id).catch(() => null);
      // FORK MIA (.96): o passo do pagamento. Leitura que falha diz "nao_lido".
      const pagamentoInicial = await passoDoPagamentoParaATime(admin, id);
      // FORK MIA (.96, segunda frente): as cobranças e a nota. Leitura que falha diz "nao_lido".
      const cobrancas = await cobrancasParaATime(admin, id);

      return {
        cliente: org.data,
        cobranca: jornada
          ? {
              ligada: await moduloLigado(admin, "cobranca"),
              plano: jornada.plano?.nome ?? null,
              plano_agendado: jornada.plano_agendado,
              situacao: jornada.situacao,
              teste_ate: jornada.teste_ate,
              proximo_aviso: { tipo: jornada.proximo.tipo, em: jornada.proximo.em },
              origem: jornada.origem,
            }
          : "nao_lido",
        modulos_com_origem: jornada ? jornada.modulos : "nao_lido",
        pagamento_inicial: pagamentoInicial,
        // FORK MIA (.98): leitura que falha diz "nao_lido".
        cupom_e_parceiro: await lerCupomEParceiroDaEmpresa(admin, id).catch(() => "nao_lido" as const),
        cobrancas,
        // Os interruptores da empresa que chegaram do upstream 1.74 a 1.80.
        configuracao: {
          limpeza_automatica_de_midia: {
            ligada: linha.media_retention_enforced !== false,
            dias: typeof linha.media_retention_days === "number" ? linha.media_retention_days : 365,
          },
          ia_decide_nas_automacoes: iaDecideLigadaNa(settings),
          bloqueio_de_afirmacao_clinica: camada === null ? "nao_lido" : camada.ligado,
          planos_de_tarefa: lePlanosDoSettings(settings).length,
        },
        modulos: (modulos.data ?? []).map((m) => (m as { modulo: string }).modulo),
        canais: canais.data ?? [],
        saldo_cents: saldo.saldo_cents,
        // O extrato passou do teto de leitura e a soma é parcial.
        saldo_truncado: saldo.truncado,
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
      "no último deploy, quais números estão fora do ar, quanto resta de " +
      "crédito de IA e se a chave que cifra o CPF dos contatos está semeada no banco " +
      "(só sim ou não: o valor nunca sai). É a primeira pergunta depois de implantar.",
    inputSchema: {},
    operacao: null,
    handler: async ({ admin }) => {
      const [carimbo, caidos, saldo, chaveDoCpf] = await Promise.all([
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
        chaveDoCpfSemeada(admin),
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
            // O rótulo central de canal; o `id` já vai no campo ao lado.
            nome: nomeDoCanal(s),
            status: s.status,
            e_o_numero_de_avisos: s.e_numero_de_avisos === true,
          };
        }),
        // Sem a chave, todo contato com CPF é salvo SEM o CPF (upstream 1.78, 0597):
        // a atualização a semeia do .env, e o bootstrap do fork também (.76).
        chave_do_cpf: chaveDoCpf,
        credito_de_ia: {
          saldo_usd: saldo.saldoUsd,
          dias_restantes: saldo.diasRestantes,
          // O consumo desde a última leitura veio parcial (volume acima do teto
          // de leitura, ou falha): `saldo_usd` é um TETO, e o saldo de verdade é
          // menor. Quem lê a saúde por aqui não pode tomá-lo por certo.
          ...(saldo.consumoParcial
            ? {
                saldo_e_teto: true,
                aviso:
                  "A soma do consumo desde a última leitura veio incompleta: o saldo de verdade é MENOR que saldo_usd. " +
                  "Confira na conta do provedor e registre uma leitura em /admin/usage.",
              }
            : {}),
          // Só os 30 dias da média não couberam: o saldo está certo, mas o
          // crédito acaba ANTES do que `dias_restantes` diz.
          ...(saldo.ritmoParcial && !saldo.consumoParcial ? { dias_restantes_e_otimista: true } : {}),
        },
      };
    },
  },

  // ── ESCRITA ─────────────────────────────────────────────────────────────
  {
    name: "plataforma_criar_cliente",
    description:
      "Cria uma organização nova e o acesso do dono dela. Idempotente pela " +
      "chave informada: repetir a chamada com a mesma chave não cria duas. " +
      // FORK MIA (.90): o plano negociado e a origem.
      "A empresa nasce com a origem `implantacao` (a Time implantou). Sem `plano`, nasce ISENTA, como sempre; com `plano` (o nome ou o id, inclusive " +
      "o plano escondido, negociado), nasce na cobrança, em teste com os dias do plano, e os módulos do plano ligam. `isenta: true` diz isso por extenso. " +
      "Plano só com a cobrança ligada.",
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
      // FORK MIA (.90): o plano negociado (escondido) ou a isenção por extenso.
      plano: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe("O plano em que a empresa nasce (nome ou id, inclusive o escondido). Ausente: isenta, como sempre."),
      isenta: z.boolean().optional().describe("true: nasce isenta (não paga e não tem limites). É o padrão sem `plano`."),
    },
    operacao: "criar_cliente",
    handler: async ({ admin, autorUserId }, args) => {
      // FORK MIA (.90): o plano, pelo nome ou id, inclusive o escondido.
      if (typeof args.plano === "string" && args.isenta === true) {
        recusar("escolha: `plano` (a empresa paga) ou `isenta: true` (não paga). Os dois juntos se contradizem.");
      }
      let planoId: string | null = null;
      if (typeof args.plano === "string") {
        if (!(await moduloLigado(admin, "cobranca"))) {
          recusar(
            "a cobrança está desligada nesta instalação: a empresa só pode nascer isenta. Tire `plano`, ou peça a uma pessoa para ligar a cobrança em Admin › Recursos opcionais.",
          );
        }
        const alvo = String(args.plano).trim().toLocaleLowerCase("pt-BR");
        const achado = (await lerPlanosComModulos(admin)).find(
          (p) => p.arquivado_em === null && (p.id === String(args.plano).trim() || p.nome.toLocaleLowerCase("pt-BR") === alvo),
        );
        if (!achado) recusar(`plano não encontrado: "${String(args.plano)}". Veja os planos em plataforma_ver_cobranca.`);
        planoId = achado.id;
      }
      const pedido = {
        display_name: String(args.display_name).trim(),
        slug: String(args.slug).trim(),
        owner_email: String(args.owner_email).trim().toLowerCase(),
        ...(planoId ? { plano_id: planoId } : {}),
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
      // FORK MIA (.90): a origem por extenso (o gatilho da 9071 já grava "implantacao"
      // quando quem cria é admin de plataforma) e os módulos do plano, se houver.
      const novoId = (data as { id?: string } | null)?.id;
      if (novoId) {
        await admin.from("mia_origem_da_empresa").upsert({ organization_id: novoId, origem: "implantacao" }, { onConflict: "organization_id" });
        if (planoId) await seguirOPlano(admin, novoId, "atribuicao");
      }
      return data;
    },
  },
  {
    name: "plataforma_liberar_modulo",
    description:
      "Libera um módulo vendido para um cliente. Passe `liberar: false` para tirar. " +
      // FORK MIA (.89): o e-mail marketing é módulo vendido.
      "`email_marketing` libera o disparo de e-mail marketing (a tela de configuração, o caminho E-mail no Broadcast e a cobrança por e-mail). " +
      // FORK MIA (.90): a origem "pela Time" e o módulo que o plano também liga.
      "A liberação daqui é a origem \"pela Time\": fica mesmo quando a empresa troca de plano. Se o plano da empresa já liga o mesmo módulo, a resposta " +
      "avisa. `crm_b2b` (Vendas B2B) também se libera aqui: vale para a empresa que está num plano sem ele (com a cobrança ligada); para a isenta, quem " +
      "decide é o módulo da instalação.",
    inputSchema: {
      organization_id: z.string().uuid(),
      modulo: z.string().trim().min(1).max(60).describe("A chave do módulo."),
      liberar: z.boolean().describe("true libera, false tira."),
      motivo: z.string().trim().max(200).optional().describe("Por quê. Vai para a auditoria."),
    },
    operacao: "liberar_modulo",
    handler: async ({ admin, autorUserId }, args) => {
      const chave = String(args.modulo);
      // FORK MIA (.90): Vendas B2B também se libera à mão (a origem "pela Time" sobre o plano).
      if (!MODULOS.some((m) => m.chave === chave) && chave !== MODULO_QUE_EXIGE_A_INSTALACAO) {
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
        // FORK MIA (.90): o plano pode continuar ligando o mesmo módulo.
        const doPlano = (await modulosPeloPlano(admin, orgId)).some((m) => m === chave);
        return {
          modulo: chave,
          liberado: false,
          origem: "pela Time",
          ...(doPlano ? { aviso: "A liberação pela Time saiu, mas o plano da empresa liga este módulo: ele continua ligado pelo plano." } : {}),
        };
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
      // FORK MIA (.90): a origem e o aviso de quando o plano já liga o mesmo módulo.
      const doPlano = (await modulosPeloPlano(admin, orgId)).some((m) => m === chave);
      const avisos = [
        ...(doPlano ? ["O plano da empresa já liga este módulo. A liberação pela Time fica junto e não sai com troca de plano."] : []),
        ...(chave === MODULO_QUE_EXIGE_A_INSTALACAO
          ? ["Vendas B2B à mão só faz diferença para empresa num plano sem ele, com a cobrança ligada; e só vale com o módulo da instalação ligado."]
          : []),
      ];
      const extra = { origem: "pela Time", ...(avisos.length > 0 ? { avisos } : {}) };
      if (error) {
        if (error.code === "23505") return { modulo: chave, liberado: true, ja_estava: true, ...extra };
        throw new Error(`não consegui liberar o módulo: ${error.message}`);
      }
      return { modulo: chave, liberado: true, ...extra };
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
      "que o disparador recusa. " +
      // FORK MIA (.89): o preço por e-mail do disparo de e-mail marketing.
      "Também define o preço por E-MAIL aceito pela Amazon (`preco_por_email_cents`). " +
      // FORK MIA (.95): o preço desta ferramenta é o DEFINIDO À MÃO e vence o do plano.
      "Os dois são o preço definido à mão para esta empresa e vencem o do plano dela (plataforma_garantir_planos); " +
      "`null` tira o definido à mão: vale o do plano e, sem plano, a mensagem fica sem preço e o e-mail volta ao padrão de R$ 0,02. " +
      "Campo ausente fica como está.",
    inputSchema: {
      organization_id: z.string().uuid(),
      preco_por_mensagem_cents: z
        .number()
        .int()
        .min(0)
        .max(100_000)
        .nullable()
        // FORK MIA (.89): opcional, para dar preço só ao e-mail sem mexer no da mensagem.
        .optional()
        .describe("Centavos por mensagem. `null` = sem preço acordado. Ausente: fica como está."),
      // FORK MIA (.89): o preço por e-mail (coluna `preco_por_email_cents`, migration 9060).
      preco_por_email_cents: z
        .number()
        .int()
        .min(0)
        .max(10_000)
        .nullable()
        .optional()
        .describe("Centavos por e-mail de marketing aceito pela Amazon. `null` = sem preço à mão (vale o do plano, senão o padrão de 2 centavos). Ausente: fica como está."),
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
      // FORK MIA (.89): os dois preços são opcionais, e o ausente fica como está.
      const temMensagem = preco !== undefined;
      const temEmail = args.preco_por_email_cents !== undefined;
      if (!temMensagem && !temEmail) {
        throw new Error("diga `preco_por_mensagem_cents`, `preco_por_email_cents` ou os dois.");
      }
      const linha: Record<string, unknown> = {
        organization_id: String(args.organization_id),
        updated_at: new Date().toISOString(),
        updated_by: autorUserId,
      };
      if (temMensagem) {
        linha.preco_por_mensagem_cents = preco === null ? null : Number(preco);
        // Como sempre foi: com o preço da mensagem, o alerta ausente volta a nulo.
        linha.alerta_saldo_cents = typeof args.alerta_saldo_cents === "number" ? args.alerta_saldo_cents : null;
      } else if (args.alerta_saldo_cents !== undefined) {
        linha.alerta_saldo_cents = typeof args.alerta_saldo_cents === "number" ? args.alerta_saldo_cents : null;
      }
      if (temEmail) linha.preco_por_email_cents = args.preco_por_email_cents === null ? null : Number(args.preco_por_email_cents);
      const { error } = await admin.from("tenant_broadcast_pricing").upsert(linha, { onConflict: "organization_id" });
      if (error) throw new Error(`não consegui gravar o preço: ${error.message}`);
      // O valor volta na resposta de propósito: preço é dinheiro, e quem
      // acabou de gravá-lo por conversa precisa ver o número que ficou — não
      // um "ok" que esconde um zero digitado a mais.
      return {
        organization_id: String(args.organization_id),
        ...(temMensagem ? { preco_por_mensagem_cents: preco === null ? null : Number(preco) } : {}),
        ...(temEmail ? { preco_por_email_cents: args.preco_por_email_cents === null ? null : Number(args.preco_por_email_cents) } : {}),
      };
    },
  },
] as const;

