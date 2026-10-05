/**
 * GET/POST /api/v1/cron/broadcast-worker — o motor do MIA Broadcast.
 *
 * Pega as campanhas que estão para enviar e manda o que der na rodada. O
 * estado mora todo no banco (uma linha por destinatário), então a próxima
 * rodada continua exatamente de onde esta parou — e um processo que morre no
 * meio não perde nem duplica nada.
 *
 * ── Uma campanha por rodada, e não todas em paralelo ────────────────────────
 *
 * Duas campanhas do mesmo cliente disputando o mesmo saldo passariam as duas
 * pela trava e estourariam juntas. Serializar por rodada resolve sem travar
 * linha no banco — o custo é a segunda campanha esperar a próxima volta do
 * cron, o que para um disparo é irrelevante.
 *
 * Auth: mesmo contrato dos demais crons (Bearer `INTERNAL_CRON_SECRET` |
 * `INTERNAL_SECRET`, fail-closed).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { rodarCampanha, type CampanhaEmCurso } from "@/lib/broadcast/motor";
import { credenciaisDaOrg } from "@/lib/channels/meta/credenciais-da-org";
import { qualidadeDoNumero } from "@/lib/channels/meta/qualidade-do-numero";
import { renderTemplateBody } from "@/lib/channels/meta/render-template";
import { registrarNaConversa } from "@/lib/broadcast/registro-na-conversa";
import { sendTemplateForSession } from "@/lib/channels/meta/send-template-for-session";
import { logger } from "@/lib/logger";
import { ehOperante, STATUS_OPERANTE, statusDaOrgEmbutida } from "@/lib/organizacao/operante";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Quantas mensagens por rodada. O cron volta em um minuto. */
const POR_RODADA = 50;

async function handler(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("unauthorized", "cron secret ausente ou inválido", 401, { requestId });
  }

  const admin = createAdminClient();
  const agora = new Date().toISOString();

  // `enviando` primeiro, depois `agendada` cuja hora chegou: quem já começou
  // termina antes de outra começar e disputar o mesmo saldo.
  //
  // Organização parada (suspensa, redigida, arquivada — upstream 1.70, #1987)
  // não dispara: a régua é a do upstream (`lib/organizacao/operante.ts`), pelo
  // status embutido, que corta ANTES do `limit`, e `ehOperante` linha a linha
  // como cinto. A campanha fica onde estava e segue no ritmo de sempre quando a
  // empresa for reativada — sem rajada: o teto por rodada é o mesmo.
  const { data: campanhas } = await admin
    .from("broadcasts")
    .select(
      "id, organization_id, template_name, template_language, valores_padrao, preco_cents, status, agendado_para, organizations:organization_id!inner(status)",
    )
    .in("status", ["enviando", "agendada"])
    .eq("organizations.status", STATUS_OPERANTE)
    .or(`agendado_para.is.null,agendado_para.lte.${agora}`)
    .order("status", { ascending: true })
    .limit(5);

  const alvo = ((campanhas ?? []) as Array<CampanhaEmCurso & { status: string; organizations?: unknown }>).find(
    (c) => ehOperante(statusDaOrgEmbutida(c.organizations as Parameters<typeof statusDaOrgEmbutida>[0])),
  );
  if (!alvo) return ok({ rodou: false, motivo: "nada_na_fila" }, { requestId });

  const creds = await credenciaisDaOrg(alvo.organization_id);
  if (!creds) {
    // Sem canal a campanha não anda, e deixá-la em `enviando` faria o cron
    // tentar para sempre. Pausar com o motivo é o que põe isso na tela.
    await admin
      .from("broadcasts")
      .update({ status: "pausada", motivo_da_parada: "sem_canal", updated_at: agora })
      .eq("id", alvo.id);
    return ok({ rodou: false, motivo: "sem_canal" }, { requestId });
  }

  /**
   * O que é preciso para o disparo VIRAR MENSAGEM na conversa.
   *
   * Carregado UMA vez por rodada, não por destinatário: os componentes do
   * template e o canal são os mesmos para a campanha inteira, e buscá-los a
   * cada envio seria uma ida ao banco por mensagem numa lista de milhares.
   *
   * Os dois são opcionais: se faltar qualquer um, o disparo continua saindo e
   * só deixa de ser registrado (com linha no log). Derrubar uma campanha paga
   * por causa do espelho local seria trocar um problema de visibilidade por um
   * de dinheiro.
   */
  const [{ data: espelho }, { data: canal }] = await Promise.all([
    admin
      .from("meta_templates")
      .select("components, parameter_format")
      .eq("organization_id", alvo.organization_id)
      .eq("name", alvo.template_name)
      .eq("language", alvo.template_language)
      .maybeSingle(),
    admin
      .from("channel_sessions")
      .select("id")
      .eq("organization_id", alvo.organization_id)
      .eq("meta_phone_number_id", creds.phoneNumberId)
      .maybeSingle(),
  ]);

  if (alvo.status === "agendada") {
    await admin
      .from("broadcasts")
      .update({ status: "enviando", iniciado_em: agora, updated_at: agora })
      .eq("id", alvo.id);
  }

  const resultado = await rodarCampanha(
    admin,
    alvo,
    {
      enviar: (input) =>
        sendTemplateForSession(admin, { ...input, phoneNumberId: creds.phoneNumberId }),
      registrar:
        espelho && canal
          ? async ({ contactId, values, externalId }) => {
              await registrarNaConversa(admin, {
                organizationId: alvo.organization_id,
                contactId,
                channelSessionId: canal.id as string,
                // O texto COM as variáveis aplicadas: é o que a pessoa leu, e é
                // o que explica a resposta dela para quem ler o histórico
                // depois — inclusive o agente.
                texto: renderTemplateBody(espelho.components, values, {
                  name: alvo.template_name,
                  language: alvo.template_language,
                  ...(espelho.parameter_format
                    ? { parameterFormat: espelho.parameter_format as string }
                    : {}),
                }),
                externalId,
                templateName: alvo.template_name,
                broadcastId: alvo.id,
              });
            }
          : undefined,
      qualidade: () => qualidadeDoNumero(creds),
      espacar: (ms) => new Promise((r) => setTimeout(r, ms)),
    },
    POR_RODADA,
  );

  // O estado final da campanha sai do que a rodada apurou — nunca de um
  // contador próprio, que divergiria da soma das linhas.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (resultado.parou) {
    patch.status = "pausada";
    patch.motivo_da_parada = resultado.parou;
  } else if (resultado.restam === 0) {
    patch.status = "concluida";
    patch.concluido_em = new Date().toISOString();
    patch.motivo_da_parada = null;
  }
  await admin.from("broadcasts").update(patch).eq("id", alvo.id);

  logger.info("[broadcast-worker] rodada", {
    broadcast_id: alvo.id,
    ...resultado,
    request_id: requestId,
  });

  return ok({ rodou: true, broadcast_id: alvo.id, ...resultado }, { requestId });
}

export const GET = handler;
export const POST = handler;
