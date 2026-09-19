/**
 * PATCH|DELETE /api/v1/broadcasts/[id] — mexer numa campanha que ainda não saiu.
 *
 * ── Por que as duas SÓ valem para rascunho ──────────────────────────────────
 *
 * A partir do primeiro envio a campanha deixa de ser um plano e passa a ser a
 * explicação de coisas que já aconteceram: mensagens que chegaram em celulares
 * e débitos lançados na carteira. Editar o template depois faria o extrato
 * apontar para um texto que ninguém recebeu; apagar a campanha deixaria débito
 * sem linha que o explique — e "por que saiu esse dinheiro" é exatamente a
 * pergunta que o cliente faz olhando o extrato.
 *
 * `pausada` também não entra: pausada é campanha que JÁ enviou parte.
 *
 * Rascunho é o único estado em que nada saiu e nada foi cobrado. Aí mexer é
 * livre, porque não há passado para contradizer.
 *
 * ── Por que editar a lista é REMONTAR, e não corrigir ───────────────────────
 *
 * A lista de destinatários é materializada quando se monta: cada linha guarda o
 * telefone e os valores daquele contato no momento da peneira. Mudar o filtro
 * depois não é "ajustar a lista" — é fazer outra pergunta ao banco, que devolve
 * outro conjunto. Fingir que é edição esconderia que quem entrou e quem saiu
 * mudou. Então, quando as tags mudam, a lista velha é DESCARTADA e remontada, e
 * a resposta devolve a peneira nova para quem está olhando conferir de novo.
 */
import { randomUUID } from "node:crypto";
import { quemEntraNaLista } from "@/lib/broadcast/quem-entra-na-lista";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { peneirar, type ContatoParaDisparo } from "@/lib/broadcast/plano";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLiberado } from "@/lib/modulos/liberacao";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const edicaoSchema = z
  .object({
    nome: z.string().min(1).max(120).optional(),
    template_name: z.string().min(1).max(512).optional(),
    template_language: z.string().min(2).max(10).optional(),
    /** Presente = remontar a lista com este filtro. Lista vazia = todos. */
    tags: z.array(z.string().min(1).max(60)).max(20).optional(),
    /**
     * As etapas do funil. Presente = remontar com este filtro.
     *
     * Precisa existir aqui, e não só na criação: sem isto, editar uma campanha
     * segmentada por etapa remontaria a lista IGNORANDO a etapa, em silêncio —
     * e a mensagem sairia para quem não deveria recebê-la.
     */
    etapas: z.array(z.string().uuid()).max(20).optional(),
    variavel_do_nome: z.string().min(1).max(10).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nada para mudar." })
  .refine((v) => !(v.template_name && !v.template_language), {
    message: "Trocar de template exige nome E idioma: o par é o que identifica o template na Meta.",
  });

/** A campanha desta organização, ou `null`. O recorte por org vai à mão de propósito. */
async function campanhaDaOrg(
  db: Awaited<ReturnType<typeof createClient>>,
  id: string,
  orgId: string,
) {
  const { data } = await db
    .from("broadcasts")
    .select("id, status, nome, template_name, template_language, valores_padrao")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  return data;
}

/**
 * O portão dos dois verbos. Devolve a resposta de recusa, ou `null` para seguir.
 *
 * Existe como função porque PATCH e DELETE recusam pelos MESMOS motivos e na
 * mesma ordem — duplicar isso seria garantir que um dia só um dos dois aprenda
 * um motivo novo.
 */
function recusaPorEstado(status: string, requestId: string) {
  if (status === "rascunho") return null;
  return fail(
    "state_conflict",
    status === "pausada"
      ? "A campanha está pausada, e pausada é campanha que já enviou parte — o que saiu não volta atrás."
      : `A campanha está ${status}: já saiu mensagem e já houve cobrança, então ela virou a explicação do extrato.`,
    409,
    { requestId },
  );
}

/**
 * GET — QUEM vai receber.
 *
 * A tela mostrava "3 destinatários · Custo estimado R$ 0,36 · Disparar agora" e
 * mais nada. Contagem não é conferência: quem confere quer ver NOMES, porque o
 * erro que importa não é o total estar errado — é um cliente que não deveria
 * estar ali, ou o número do sócio no meio da lista de prospecção. Descobrir isso
 * depois do disparo custa dinheiro e, em marketing, custa qualidade do número.
 *
 * Devolve também `status` e `erro` de cada linha, que é o que transforma esta
 * mesma tela na conferência DEPOIS do disparo: quem recebeu, quem falhou e por
 * quê, sem precisar de outra tela.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "broadcasts" });
  if (!authz.ok) return authz.response;

  const db = await createClient();
  if (!(await moduloLiberado(db, authz.org.orgId, "disparador"))) {
    return fail("forbidden", "Módulo não contratado.", 403, { requestId });
  }

  const { id } = await ctx.params;
  const campanha = await campanhaDaOrg(db, id, authz.org.orgId);
  if (!campanha) return fail("not_found", "Campanha não encontrada.", 404, { requestId });

  // Página grande o suficiente para conferir de olho, pequena o suficiente para
  // não despejar 50 mil linhas no navegador de quem só queria ver quem está ali.
  const url = new URL(req.url);
  const limite = Math.min(Number(url.searchParams.get("limite") ?? 200) || 200, 500);
  const inicio = Math.max(Number(url.searchParams.get("inicio") ?? 0) || 0, 0);

  /**
   * O FILTRO por estado é o que torna a tela usável em lista grande.
   *
   * Com 3.000 destinatários, "quem falhou?" sem filtro é paginar 15 vezes
   * procurando linhas vermelhas no meio de verdes. E é sempre essa a pergunta:
   * ninguém abre a lista de uma campanha para ver quem recebeu.
   */
  const estado = url.searchParams.get("status");

  let consulta = db
    .from("broadcast_recipients")
    .select("id, contact_id, phone_e164, status, erro, enviado_em", { count: "exact" })
    .eq("organization_id", authz.org.orgId)
    .eq("broadcast_id", id);
  if (estado) consulta = consulta.eq("status", estado);

  const { data: linhas, count } = await consulta
    .order("created_at", { ascending: true })
    .range(inicio, inicio + limite - 1);

  /**
   * O RESUMO por estado, com `head: true` — conta no banco, não traz linha.
   *
   * Sem ele, a tela só saberia dizer quantos há na PÁGINA atual, e a pergunta
   * que importa ("quantos falharam?") exigiria baixar a lista inteira para
   * contar no navegador — que é justamente o que esta tela existe para evitar.
   */
  const ESTADOS = ["pendente", "enviada", "entregue", "lida", "falhou", "estornada"] as const;
  const contagens = await Promise.all(
    ESTADOS.map(async (e) => {
      const { count: n } = await db
        .from("broadcast_recipients")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", authz.org.orgId)
        .eq("broadcast_id", id)
        .eq("status", e);
      return [e, n ?? 0] as const;
    }),
  );
  const resumo = Object.fromEntries(contagens) as Record<string, number>;

  /**
   * O NOME vem numa segunda consulta, e não por join.
   *
   * `contact_id` é `on delete set null`: contato apagado depois de montada a
   * lista deixa a linha sem dono, e o join a esconderia. O telefone continua
   * gravado na própria linha — ele é a verdade do que será enviado — então a
   * ausência de nome vira "(sem cadastro)" em vez de vira destinatário invisível.
   */
  const ids = [...new Set((linhas ?? []).map((l) => l.contact_id).filter(Boolean))] as string[];
  const nomes = new Map<string, string>();
  if (ids.length > 0) {
    const { data: contatos } = await db
      .from("contacts")
      .select("id, display_name")
      .eq("organization_id", authz.org.orgId)
      .in("id", ids);
    for (const c of contatos ?? []) nomes.set(c.id as string, (c.display_name as string) ?? "");
  }

  return ok(
    {
      total: count ?? 0,
      inicio,
      limite,
      filtro: estado,
      resumo,
      destinatarios: (linhas ?? []).map((l) => ({
        id: l.id,
        nome: (l.contact_id ? nomes.get(l.contact_id as string) : "") || null,
        telefone: l.phone_e164,
        status: l.status,
        erro: l.erro,
        enviado_em: l.enviado_em,
      })),
    },
    { requestId },
  );
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "broadcasts" });
  if (!authz.ok) return authz.response;

  const db = await createClient();
  if (!(await moduloLiberado(db, authz.org.orgId, "disparador"))) {
    return fail("forbidden", "Módulo não contratado.", 403, { requestId });
  }

  const cru = await req.json().catch(() => null);
  const parsed = edicaoSchema.safeParse(cru);
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Edição inválida.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const dados = parsed.data;

  const { id } = await ctx.params;
  const campanha = await campanhaDaOrg(db, id, authz.org.orgId);
  if (!campanha) return fail("not_found", "Campanha não encontrada.", 404, { requestId });

  const recusa = recusaPorEstado(campanha.status as string, requestId);
  if (recusa) return recusa;

  /**
   * Template novo tem de estar APROVADO — conferido AQUI, e não só na tela.
   *
   * A tela já só oferece aprovados, mas ela lê a lista uma vez: entre abrir a
   * página e salvar, a Meta pode ter reprovado o template (ela reprova depois de
   * aprovar, quando o uso destoa). Disparar template reprovado não falha só a
   * mensagem — queima qualidade do número.
   */
  if (dados.template_name && dados.template_language) {
    const { data: template } = await db
      .from("meta_templates")
      .select("status")
      .eq("organization_id", authz.org.orgId)
      .eq("name", dados.template_name)
      .eq("language", dados.template_language)
      .maybeSingle();
    if (template?.status !== "APPROVED") {
      return fail(
        "validation_failed",
        template
          ? `O template está ${template.status}, e só aprovado pode ser disparado.`
          : "Template não encontrado no espelho — sincronize com a Meta antes.",
        422,
        { requestId },
      );
    }
  }

  const admin = createAdminClient();
  const patch: Record<string, unknown> = {};
  if (dados.nome !== undefined) patch.nome = dados.nome;
  if (dados.template_name !== undefined) patch.template_name = dados.template_name;
  if (dados.template_language !== undefined) patch.template_language = dados.template_language;

  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from("broadcasts").update(patch).eq("id", id);
    if (error) return fail("db_error", "Falha ao salvar a campanha.", 500, { requestId });
  }

  // ---- a lista, quando as tags mudam --------------------------------------
  let peneiraNova: {
    enviar: number;
    semTelefone: number;
    repetidos: number;
    semConsentimento: number;
  } | null = null;

  // Qualquer um dos dois filtros remonta a lista — e os dois vão juntos para o
  // mesmo lugar que a criação usa, para não existir uma segunda regra sobre
  // quem entra na campanha.
  if (dados.tags !== undefined || dados.etapas !== undefined) {
    const lista = await quemEntraNaLista(db, authz.org.orgId, {
      tags: dados.tags ?? [],
      etapas: dados.etapas ?? [],
    });
    if (!lista.ok) return fail("query_failed", lista.erro, 500, { requestId });
    const contatos = lista.contatos;

    const variavel =
      dados.variavel_do_nome === undefined
        ? ((campanha.valores_padrao as { variavel_do_nome?: string } | null)?.variavel_do_nome ??
          null)
        : dados.variavel_do_nome;

    const peneira = peneirar((contatos ?? []) as ContatoParaDisparo[], (c) =>
      variavel ? { [variavel]: (c.display_name ?? "").trim() || "tudo bem" } : {},
    );

    /**
     * A lista velha SAI antes de a nova entrar.
     *
     * Sem isto o remonte viraria acréscimo: quem estava na lista antiga e não
     * passa no filtro novo continuaria lá, e o operador receberia a mensagem
     * "3 destinatários" enquanto a campanha guarda 7. Rascunho é o único estado
     * em que apagar destinatário é seguro — nenhum deles recebeu nada.
     */
    await admin.from("broadcast_recipients").delete().eq("broadcast_id", id);

    if (peneira.enviar.length > 0) {
      // Em blocos: uma lista de 50 mil numa tacada estoura o limite do PostgREST.
      for (let i = 0; i < peneira.enviar.length; i += 500) {
        const bloco = peneira.enviar.slice(i, i + 500).map((d) => ({
          organization_id: authz.org.orgId,
          broadcast_id: id,
          contact_id: d.contactId,
          phone_e164: d.phoneE164,
          valores: d.valores,
        }));
        await admin.from("broadcast_recipients").insert(bloco);
      }
    }

    // Os três descartes já vêm contados da peneira; só `enviar` é lista, porque
    // é a única que vira linha no banco.
    peneiraNova = {
      enviar: peneira.enviar.length,
      semTelefone: peneira.semTelefone,
      repetidos: peneira.repetidos,
      semConsentimento: peneira.semConsentimento,
    };
  }

  void audit({
    action: "broadcast.editado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    metadata: { broadcast_id: id, campos: Object.keys(dados), remontou: peneiraNova !== null },
  });

  return ok({ id, peneira: peneiraNova }, { requestId });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "broadcasts" });
  if (!authz.ok) return authz.response;

  const db = await createClient();
  if (!(await moduloLiberado(db, authz.org.orgId, "disparador"))) {
    return fail("forbidden", "Módulo não contratado.", 403, { requestId });
  }

  const { id } = await ctx.params;
  const campanha = await campanhaDaOrg(db, id, authz.org.orgId);
  if (!campanha) return fail("not_found", "Campanha não encontrada.", 404, { requestId });

  const recusa = recusaPorEstado(campanha.status as string, requestId);
  if (recusa) return recusa;

  // Destinatários primeiro: apagar a campanha antes deixaria as linhas órfãs se
  // a FK não estiver em cascade, e depender do cascade para a ordem certa é
  // depender de um detalhe do banco que esta rota não controla.
  const admin = createAdminClient();
  await admin.from("broadcast_recipients").delete().eq("broadcast_id", id);
  const { error } = await admin.from("broadcasts").delete().eq("id", id);
  if (error) return fail("db_error", "Falha ao excluir a campanha.", 500, { requestId });

  void audit({
    action: "broadcast.excluido",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    metadata: { broadcast_id: id, nome: campanha.nome },
  });

  return ok({ id, excluida: true }, { requestId });
}
