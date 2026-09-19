/**
 * /api/v1/broadcasts — as campanhas do MIA Broadcast.
 *
 * GET  → lista, com o andamento de cada uma somado das LINHAS (nunca de um
 *        contador próprio, que divergiria da soma no primeiro erro).
 * POST → cria a campanha já com a lista montada, peneirada e conferida contra
 *        o saldo. Nasce em `rascunho`: criar não dispara, e essa separação é o
 *        que permite ver quantos ficaram de fora antes de gastar.
 *
 * Atrás do módulo MIA Broadcast: crédito só existe para gastar aqui, e a rota
 * recusa para quem não contratou — o menu esconde, mas esconder não é recusar.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { peneirar, podeComecar, type ContatoParaDisparo } from "@/lib/broadcast/plano";
import { derivarSaldo, type LancamentoDaCarteira } from "@/lib/carteira/saldo";
import { quemEntraNaLista } from "@/lib/broadcast/quem-entra-na-lista";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLiberado } from "@/lib/modulos/liberacao";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const criarSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  template_name: z.string().min(1).max(512),
  template_language: z.string().min(2).max(10),
  /** Valores iguais para todo mundo, por posição: {"2": "Rafa"}. */
  valores_padrao: z.record(z.string(), z.string().max(500)).default({}),
  /** Quem recebe: por tag do contato. Vazio = todos os contatos com telefone. */
  tags: z.array(z.string().min(1).max(60)).max(10).default([]),
  /**
   * As ETAPAS do funil cujos negócios abertos entram na lista.
   *
   * Tag do contato responde "quem é essa pessoa"; etapa responde "onde essa
   * negociação está" — e é a segunda que se quer segmentar numa campanha
   * ("todo mundo que pediu orçamento e não fechou"). A primeira exige que
   * alguém tenha marcado a tag à mão, o que quase nunca acontece.
   *
   * Vazio = não filtra por etapa. Combinado com `tags`, os dois se somam como
   * E: contato COM a tag E COM negócio aberto naquela etapa. É o que a tela
   * mostra, e o que responde "os que pediram orçamento E são VIP".
   */
  etapas: z.array(z.string().uuid()).max(20).default([]),
  /**
   * A variável que recebe o nome do contato. `null` = nenhuma.
   * É a única personalização por pessoa da primeira versão — e é a que importa.
   */
  variavel_do_nome: z.string().regex(/^\d+$/).nullable().default("1"),
});

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "broadcasts" });
  if (!authz.ok) return authz.response;
  const db = await createClient();

  if (!(await moduloLiberado(db, authz.org.orgId, "disparador"))) {
    return fail("forbidden", "Módulo não contratado.", 403, { requestId });
  }

  const { data: campanhas, error } = await db
    .from("broadcasts")
    .select(
      "id, nome, template_name, template_language, status, preco_cents, agendado_para, iniciado_em, concluido_em, motivo_da_parada, created_at",
    )
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return fail("query_failed", error.message, 500, { requestId });

  // O andamento sai da soma das LINHAS. Um contador na campanha divergiria da
  // realidade no primeiro envio que falhasse fora do caminho feliz.
  const ids = (campanhas ?? []).map((c) => c.id as string);
  const porCampanha = new Map<string, Record<string, number>>();
  if (ids.length > 0) {
    const { data: linhas } = await db
      .from("broadcast_recipients")
      .select("broadcast_id, status")
      .in("broadcast_id", ids)
      .limit(200_000);
    for (const l of linhas ?? []) {
      const id = l.broadcast_id as string;
      const atual = porCampanha.get(id) ?? {};
      const s = l.status as string;
      atual[s] = (atual[s] ?? 0) + 1;
      atual.total = (atual.total ?? 0) + 1;
      porCampanha.set(id, atual);
    }
  }

  return ok(
    {
      campanhas: (campanhas ?? []).map((c) => ({
        ...c,
        andamento: porCampanha.get(c.id as string) ?? { total: 0 },
      })),
    },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  // `manager`: cada mensagem custa dinheiro do cliente, e quem atende não
  // decide gastar.
  const authz = await requireRole("manager", { requestId, resource: "broadcasts" });
  if (!authz.ok) return authz.response;

  const db = await createClient();
  if (!(await moduloLiberado(db, authz.org.orgId, "disparador"))) {
    return fail("forbidden", "Módulo não contratado.", 403, { requestId });
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return fail("validation_failed", "Corpo inválido.", 422, { requestId });
  }
  const parsed = criarSchema.safeParse(corpo);
  if (!parsed.success) {
    return fail("validation_failed", "Campanha inválida.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const dados = parsed.data;

  // ---- o template precisa estar APROVADO -----------------------------------
  const { data: template } = await db
    .from("meta_templates")
    .select("status")
    .eq("organization_id", authz.org.orgId)
    .eq("name", dados.template_name)
    .eq("language", dados.template_language)
    .maybeSingle();

  // ---- a lista -------------------------------------------------------------
  const lista = await quemEntraNaLista(db, authz.org.orgId, {
    tags: dados.tags,
    etapas: dados.etapas,
  });
  if (!lista.ok) return fail("query_failed", lista.erro, 500, { requestId });
  const contatos = lista.contatos;

  const peneira = peneirar((contatos ?? []) as ContatoParaDisparo[], (c) =>
    dados.variavel_do_nome
      ? { [dados.variavel_do_nome]: (c.display_name ?? "").trim() || "tudo bem" }
      : {},
  );

  // ---- cabe no saldo? ------------------------------------------------------
  const [{ data: extrato }, { data: preco }] = await Promise.all([
    db
      .from("tenant_wallet_ledger")
      .select("tipo, amount_cents, occurred_at")
      .eq("organization_id", authz.org.orgId)
      .limit(100_000),
    db
      .from("tenant_broadcast_pricing")
      .select("preco_por_mensagem_cents")
      .eq("organization_id", authz.org.orgId)
      .maybeSingle(),
  ]);
  const saldo = derivarSaldo((extrato ?? []) as LancamentoDaCarteira[]).saldo_cents;
  const precoCents =
    preco?.preco_por_mensagem_cents === null || preco?.preco_por_mensagem_cents === undefined
      ? null
      : Number(preco.preco_por_mensagem_cents);

  const veredicto = podeComecar({
    destinatarios: peneira.enviar.length,
    saldoCents: saldo,
    precoPorMensagemCents: precoCents,
    templateAprovado: template?.status === "APPROVED",
    temCanal: true, // o motor confere de novo na hora; aqui é só o aviso cedo
    qualidade: "UNKNOWN",
  });

  // ---- grava ---------------------------------------------------------------
  const admin = createAdminClient();
  const { data: campanha, error: erroCampanha } = await admin
    .from("broadcasts")
    .insert({
      organization_id: authz.org.orgId,
      nome: dados.nome,
      template_name: dados.template_name,
      template_language: dados.template_language,
      valores_padrao: dados.valores_padrao,
      status: "rascunho",
      preco_cents: precoCents,
      created_by: authz.user.id,
    })
    .select("id")
    .single();
  if (erroCampanha || !campanha) {
    return fail("db_error", "Falha ao criar a campanha.", 500, { requestId });
  }

  if (peneira.enviar.length > 0) {
    // Em blocos: uma lista de 50 mil numa tacada estoura o limite do PostgREST.
    for (let i = 0; i < peneira.enviar.length; i += 500) {
      const bloco = peneira.enviar.slice(i, i + 500).map((d) => ({
        organization_id: authz.org.orgId,
        broadcast_id: campanha.id,
        contact_id: d.contactId,
        phone_e164: d.phoneE164,
        valores: d.valores,
      }));
      await admin.from("broadcast_recipients").insert(bloco);
    }
  }

  void audit({
    action: "broadcast.criado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    metadata: {
      broadcast_id: campanha.id,
      destinatarios: peneira.enviar.length,
      template: dados.template_name,
    },
  });

  return ok(
    {
      id: campanha.id,
      destinatarios: peneira.enviar.length,
      // A peneira vai INTEIRA para a tela: lista que encolhe sem explicação
      // parece defeito do sistema, e cada número aqui é informação sobre a base.
      fora: {
        sem_telefone: peneira.semTelefone,
        repetidos: peneira.repetidos,
        pediram_para_sair: peneira.semConsentimento,
      },
      pode_disparar: veredicto.pode,
      motivo: veredicto.motivo,
      falta_cents: veredicto.trava?.falta_cents ?? null,
      custo_estimado_cents: precoCents === null ? null : precoCents * peneira.enviar.length,
    },
    { requestId },
  );
}
