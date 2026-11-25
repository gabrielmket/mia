/**
 * GET /api/v1/admin/tenants/[id]/usage — o que ESTE cliente consumiu.
 *
 * A aba existia marcada `disabled`, como a de Equipe. A diferença entre esta e
 * o `/admin/usage` geral não é o dado, é a PERGUNTA: lá se compara clientes
 * ("quem gasta mais"); aqui se responde sobre um ("este está crescendo? o custo
 * dele acompanha?") — que é a conversa de renovação e de reajuste.
 *
 * Os dois lados do custo juntos, e é o ponto: IA (`llm_calls`) e MENSAGEM da
 * Meta (`messages` cobradas) vêm da mesma tela. Separados, cada número parece
 * pequeno; somados, dizem quanto este cliente custa para servir — que é o
 * número que decide preço.
 *
 * ⚠️ Dinheiro só aparece aqui, no painel da PLATAFORMA: é o preço de custo do
 * que o cliente comprou, e mostrá-lo a ele seria mostrar a margem
 * (`lib/ai/custo-e-da-plataforma.ts`).
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
// FORK MIA (MIA-99): o custo de mensagem pelo preço vigente no instante de cada uma.
import { falhouOCustoDeMensagem, lerCustoDeMensagemDoPeriodo } from "@/lib/channels/meta/custo-do-periodo";
// FORK MIA (MIA-44): o consumo de IA por mês e por agente (docs/fork/consumo-de-ia.md).
import { falhouOConsumo, lerConsumoDoPeriodo, periodoDoPedido } from "@/lib/ai/usage/consumo-do-periodo";
// FORK MIA (MIA-78): as mensagens dos pessoais ficam fora, como na tela geral.
import { lerContatosPessoais, listaDosPessoais } from "@/lib/ai/usage/contatos-pessoais";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/*
 * Os tetos de leitura moram com as leituras: o das chamadas de IA em
 * `lib/ai/usage/consumo-do-periodo.ts`, o das mensagens cobradas em
 * `lib/channels/meta/custo-do-periodo.ts` (MIA-99). As duas são paginadas: o
 * `.limit(50_000)` que estava aqui nunca trouxe mais de 1000 linhas, porque o
 * PostgREST corta toda resposta em 1000 sem avisar.
 */

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch (err) {
    // v1.88 (#3207): `mfa_required` chega como ele é; o resto segue no 403 `forbidden`.
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  const { id } = await ctx.params;

  /**
   * Janela em dias, 30 por padrão.
   *
   * Dias e não "mês corrente" de propósito: a pergunta aqui é de TENDÊNCIA
   * ("está crescendo?"), e no dia 2 do mês a janela do mês corrente responde
   * quase nada. A fatura fechada por mês tem tela própria (`/admin/custo-da-meta`).
   *
   * FORK MIA (MIA-44): ou `mes=AAAA-MM`, o mês do calendário em Brasília
   * ("quanto gastou no mês passado?"). `mes` vence `dias`, e TODOS os números
   * desta resposta passam a ser daquele mês. `mes` fora do formato é 400.
   *
   * FORK MIA (MIA-78): `dias=N` são os N dias do calendário em Brasília
   * terminados hoje, a mesma janela de `/admin/usage` e do MCP
   * (`periodoDoPedido`). Não eram: aqui eram N×24 h corridas até agora.
   */
  const periodo = periodoDoPedido({
    mes: req.nextUrl.searchParams.get("mes"),
    dias: req.nextUrl.searchParams.get("dias"),
  });
  if (!periodo) {
    return fail("validation_error", "mes deve vir como AAAA-MM", 400, { requestId });
  }
  const { dias } = periodo;
  const desde = periodo.inicio;
  const antesDe = periodo.fim;

  const admin = createAdminClient();

  // FORK MIA (MIA-78): pessoal não soma (spec 21, caminho 10). A tela geral já
  // tirava as mensagens dos contatos pessoais e esta aba não: o mesmo cliente
  // no mesmo mês dava N numa e N + as dos pessoais na outra.
  const pessoais = await lerContatosPessoais(admin, [id]);
  if (pessoais.erro) return fail("db_error", pessoais.erro, 500, { requestId });
  let contagemDeMensagens = admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", id)
    .gte("created_at", desde)
    .lt("created_at", antesDe);
  const foraOsPessoais = listaDosPessoais(pessoais.ids);
  if (foraOsPessoais) contagemDeMensagens = contagemDeMensagens.not("contact_id", "in", foraOsPessoais);

  const [conversas, mensagens, consumo, custoDeMensagem] = await Promise.all([
    admin
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", id)
      .gte("created_at", desde)
      .lt("created_at", antesDe),
    contagemDeMensagens,
    // FORK MIA (MIA-44): a mesma leitura de `plataforma_ver_consumo_de_ia`,
    // paginada, com a régua do teto (coalesce de cost_cents). O bloco `ia`
    // abaixo sai dela, e não de uma segunda leitura de `llm_calls`.
    lerConsumoDoPeriodo(admin, id, periodo),
    // FORK MIA (MIA-99): as mensagens cobradas e o histórico de preços, cada
    // mensagem ao preço que valia no instante dela. Até aqui era o preço de
    // HOJE, e um reajuste mudava o custo de um mês já fechado.
    lerCustoDeMensagemDoPeriodo(admin, id, periodo),
  ]);

  // Leitura que falha no meio não vira "custo zero": responde erro.
  // FORK MIA (MIA-78): as contagens e os preços também. Sem conferir, uma
  // contagem que falhava saía 0 e um preço que não vinha saía custo R$ 0,00.
  // (MIA-99: a leitura dos preços está dentro de `lerCustoDeMensagemDoPeriodo`.)
  if (conversas.error) return fail("db_error", conversas.error.message, 500, { requestId });
  if (mensagens.error) return fail("db_error", mensagens.error.message, 500, { requestId });
  if (falhouOConsumo(consumo)) return fail("db_error", consumo.erro, 500, { requestId });
  if (falhouOCustoDeMensagem(custoDeMensagem)) {
    return fail("db_error", custoDeMensagem.erro, 500, { requestId });
  }

  // Centavos de DÓLAR, como o resto do custo de IA neste repositório.
  // `tokens` é entrada + saída: `llm_calls` não tem `total_tokens` (é coluna de
  // `ai_invocations`), e pedi-la fazia o PostgREST recusar a leitura inteira.
  const { total } = consumo;
  const tokens = total.tokens_entrada + total.tokens_saida;

  return ok(
    {
      dias,
      // FORK MIA (MIA-44): o período de todos os números abaixo.
      mes: periodo.mes,
      periodo: { tipo: periodo.tipo, inicio: periodo.inicio, fim: periodo.fim, fuso: periodo.fuso },
      conversas: conversas.count ?? 0,
      // Sem as mensagens dos contatos pessoais (MIA-78).
      mensagens: mensagens.count ?? 0,
      // FORK MIA (MIA-78): a lista dos pessoais passou do teto, e as mensagens
      // dos que ficaram de fora dela estão em `mensagens`.
      pessoais_truncado: pessoais.truncado,
      ia: {
        chamadas: total.chamadas,
        tokens,
        custo_usd_cents: total.custo_usd_cents,
        // A leitura foi cortada? A tela precisa dizer, senão o número se lê
        // como total e a conta fecha menor que a realidade.
        truncado: consumo.truncado,
      },
      // FORK MIA (MIA-44): por agente, a linha "Sistema", por finalidade e em R$.
      consumo: {
        total: consumo.total,
        por_agente: consumo.por_agente,
        sistema: consumo.sistema,
        por_finalidade: consumo.por_finalidade,
        reais: consumo.reais,
        truncado: consumo.truncado,
        chamadas_no_banco: consumo.chamadas_no_banco,
      },
      // `total`, `linhas` (cada uma com a quebra por preço em `precos`, MIA-99),
      // `totalCentavos`, `semPreco` e `truncado` (a leitura foi cortada no teto).
      mensagens_cobradas: custoDeMensagem,
    },
    { requestId },
  );
}
