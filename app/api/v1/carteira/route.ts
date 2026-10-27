/**
 * A CARTEIRA DO CLIENTE — o que ele comprou, o que gastou, e quanto sobrou.
 *
 * Esta é a tela do TENANT, e a distinção com `/api/v1/admin/carteira` é a mesma
 * que separa cobrança de custo em todo o resto do sistema: aqui aparece o preço
 * que ELE paga e o extrato DELE; o que a operação paga ao provedor não passa
 * por aqui e não tem policy que o exponha (ver `lib/ai/custo-e-da-plataforma.ts`).
 *
 * Só leitura. Crédito entra por decisão comercial (painel administrativo) e
 * débito entra pelo motor de envio — nenhum dos dois é coisa que o cliente
 * escreva, e o `grant` da migration 0244 já recusa a escrita no banco.
 *
 * Auth: manager+. O extrato mostra quanto a empresa gastou, que não é
 * informação de atendente.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { moduloLiberado } from "@/lib/modulos/liberacao";
import { lerSaldoDaCarteira } from "@/lib/carteira/ler-saldo";
import { creditoAcabando, podeDisparar } from "@/lib/carteira/saldo";
// FORK MIA (.90): o preço por mensagem do plano (docs/fork/jornada-de-assinatura.md).
import { precoPorMensagemDaEmpresa } from "@/lib/planos-mia/preco-por-mensagem";
// FORK MIA (.95): o preço por e-mail segue o plano pelo mesmo caminho.
import { precoPorEmailDaEmpresa } from "@/lib/planos-mia/preco-por-email";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * O extrato mostrado. O saldo NÃO sai daqui: uma página de 200 linhas somaria
 * só as 200 e mostraria um saldo errado para quem já teve mais lançamentos —
 * por isso a soma é feita sobre o extrato inteiro, e esta lista é só o que a
 * tela exibe.
 *
 * "O extrato inteiro" é `lerSaldoDaCarteira`, que pagina: o `.limit(100_000)`
 * que estava aqui trazia no máximo 1000 linhas (o teto do PostgREST) e somava
 * um recorte.
 */
const LINHAS_NA_TELA = 200;

export async function GET(_req: NextRequest) {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "carteira" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const db = await createClient();

  // A guarda de VERDADE do módulo. O menu esconde a tela, e esconder não é
  // recusar: link antigo, favorito e chamada direta continuam chegando aqui.
  // Crédito só existe para gastar no disparador — mostrar saldo a quem não
  // contratou seria vender por acidente.
  // FORK MIA (.89): a carteira é a MESMA do disparo de e-mail marketing, e
  // abre também para quem só contratou ele (lib/modulos/vendaveis.ts, TELAS_TAMBEM_DE).
  const [doBroadcast, doEmail] = await Promise.all([
    moduloLiberado(db, org.orgId, "disparador"),
    moduloLiberado(db, org.orgId, "email_marketing"),
  ]);
  if (!doBroadcast && !doEmail) {
    return fail("forbidden", "Módulo não contratado.", 403, { requestId });
  }

  const [extratoRes, saldo, precoRes] = await Promise.all([
    db
      .from("tenant_wallet_ledger")
      .select("id, tipo, amount_cents, currency, occurred_at, ref_kind, ref_id, note")
      .eq("organization_id", org.orgId)
      .order("occurred_at", { ascending: false })
      .limit(LINHAS_NA_TELA),
    // A soma vai sobre TODAS as linhas, não sobre a página acima.
    lerSaldoDaCarteira(db, org.orgId),
    db
      .from("tenant_broadcast_pricing")
      .select("preco_por_mensagem_cents, alerta_saldo_cents, preco_por_email_cents")
      .eq("organization_id", org.orgId)
      .maybeSingle(),
  ]);

  if (extratoRes.error) return fail("query_failed", extratoRes.error.message, 500, { requestId });
  if (saldo.erro) return fail("query_failed", saldo.erro, 500, { requestId });

  // FORK MIA (.90): sem preço combinado, vale o do plano (lib/planos-mia/preco-por-mensagem.ts).
  const preco = (
    await precoPorMensagemDaEmpresa(
      createAdminClient(),
      org.orgId,
      precoRes.data?.preco_por_mensagem_cents === null || precoRes.data?.preco_por_mensagem_cents === undefined
        ? null
        : Number(precoRes.data.preco_por_mensagem_cents),
    )
  ).cents;
  // FORK MIA (.95): o preço por e-mail é o definido à mão, senão o do plano,
  // senão o padrão (lib/planos-mia/preco-por-email.ts). A leitura do plano que
  // falha não vira o padrão calado: a tela recebe o erro.
  const emailAMao = (precoRes.data as { preco_por_email_cents?: number | null } | null)
    ?.preco_por_email_cents;
  let precoPorEmail: number;
  try {
    precoPorEmail = (
      await precoPorEmailDaEmpresa(
        createAdminClient(),
        org.orgId,
        emailAMao === null || emailAMao === undefined ? null : Number(emailAMao),
      )
    ).cents;
  } catch (erro) {
    return fail("query_failed", erro instanceof Error ? erro.message : "preço por e-mail", 500, {
      requestId,
    });
  }
  const alerta =
    precoRes.data?.alerta_saldo_cents === null || precoRes.data?.alerta_saldo_cents === undefined
      ? null
      : Number(precoRes.data.alerta_saldo_cents);

  /**
   * Quantas mensagens o saldo cobre — a frase que a tela precisa dizer antes de
   * alguém montar uma lista de 4.000 contatos. Com `destinatarios: 0` a trava
   * não julga lista nenhuma; ela só devolve a capacidade.
   */
  const capacidade = podeDisparar({
    saldoCents: saldo.saldo_cents,
    precoPorMensagemCents: preco,
    destinatarios: 0,
  });

  return ok(
    {
      saldo_cents: saldo.saldo_cents,
      creditado_cents: saldo.creditado_cents,
      debitado_cents: saldo.debitado_cents,
      estornado_cents: saldo.estornado_cents,
      preco_por_mensagem_cents: preco,
      // NULL aqui não é "ilimitado": é "ninguém combinou preço ainda", e a tela
      // tem de dizer isso, porque é o motivo pelo qual o disparo vai recusar.
      mensagens_que_cabem: capacidade.mensagens_que_cabem,
      // FORK MIA (.89): o preço por e-mail de marketing. Desde a .95, o definido à
      // mão, senão o do plano, senão o padrão de R$ 0,02.
      preco_por_email_cents: precoPorEmail,
      email_marketing: doEmail,
      disparador: doBroadcast,
      credito_acabando: creditoAcabando(saldo.saldo_cents, alerta),
      alerta_saldo_cents: alerta,
      extrato: (extratoRes.data ?? []).map((l) => ({
        id: l.id as string,
        tipo: l.tipo as string,
        amount_cents: Number(l.amount_cents),
        currency: (l.currency as string) ?? "BRL",
        occurred_at: l.occurred_at as string,
        ref_kind: (l.ref_kind as string | null) ?? null,
        ref_id: (l.ref_id as string | null) ?? null,
        note: (l.note as string | null) ?? null,
      })),
      extrato_truncado: (extratoRes.data ?? []).length >= LINHAS_NA_TELA,
      // O extrato passou do teto de leitura e a soma é parcial: a tela avisa.
      saldo_truncado: saldo.truncado,
    },
    { requestId },
  );
}
