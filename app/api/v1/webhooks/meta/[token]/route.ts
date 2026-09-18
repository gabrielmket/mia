/**
 * GET|POST /api/v1/webhooks/meta/[token] — webhook da WhatsApp Cloud API.
 *
 * `GET` é o handshake de verificação: a Meta só começa a entregar eventos depois
 * que o endpoint devolve `hub.challenge` **em texto puro**. Envelopar em
 * `{data:...}` (o wrapper padrão da nossa API) faz a verificação falhar com uma
 * mensagem inútil no dashboard — por isso esta é a única rota do repo que
 * responde texto cru, e está aqui escrito o motivo.
 *
 * `POST` verifica HMAC **SHA-256** com o App Secret, e só então age. O outro canal
 * do repo usa SHA-512 com segredo por sessão — não reaproveite a verificação dele;
 * o detalhe está em `lib/channels/meta/webhook.ts`.
 *
 * Por que ainda existe token no path se o App Secret é global: o segredo é do APP,
 * e um app serve N WABAs de N organizações. O token é a primeira resposta para
 * "de quem é isto" — mas não a única, e nem sempre a certa: a URL de callback é
 * uma só e carrega o token de UM canal, então eventos das outras contas chegam
 * com ele, e arquivar aquele canal deixaria o token órfão. Quem decide de fato é
 * `donoDoEvento`, pela WABA que a Meta carimba.
 *
 * Isso não é deixar o payload escolher tenant: a WABA só é lida DEPOIS do HMAC
 * provar que quem falou foi a Meta, e a tradução WABA → organização vem da nossa
 * tabela, nunca do corpo.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { lerEnvelopeMeta } from "@/lib/channels/meta/envelope";
import { guardarChegada, lerChegada } from "@/lib/channels/meta/chegada-do-cadastro";
import { parseMetaWebhook, verificationChallenge, verifyMetaSignature } from "@/lib/channels/meta/webhook";
import { aplicarDesfechoNaCampanha } from "@/lib/broadcast/desfecho-da-campanha";
import { ingestMetaInbound } from "@/lib/channels/meta/ingest";
import { donoDoEvento } from "@/lib/channels/meta/dono-do-evento";
import { metaSessionByWabaId, metaSessionByWebhookToken } from "@/lib/channels/meta/session";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ token: string }>;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const { token } = await ctx.params;
  const session = await metaSessionByWebhookToken(token);
  if (!session) return new NextResponse("not found", { status: 404 });

  const challenge = verificationChallenge(
    req.nextUrl.searchParams,
    process.env.META_WEBHOOK_VERIFY_TOKEN ?? "",
  );
  if (challenge === null) return new NextResponse("forbidden", { status: 403 });

  // Texto puro, sem wrapper — ver o cabeçalho.
  return new NextResponse(challenge, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const requestId = randomUUID();
  const { token } = await ctx.params;

  /**
   * A ASSINATURA VEM ANTES DO TOKEN, e a ordem não é estilo.
   *
   * O token do caminho era conferido primeiro, e token que não resolve devolvia
   * 404 na hora. Numa instalação com duas contas isso é uma armadilha armada: a
   * URL de callback do app carrega o token de UM canal, e no dia em que esse
   * canal for arquivado — o que é natural ao trocar o número de teste pelo
   * definitivo — a rota passa a recusar TUDO, de todas as contas, antes mesmo
   * de olhar o corpo.
   *
   * Quem autentica de verdade é o HMAC com o App Secret: ele prova que quem
   * falou foi a Meta. O token continua valendo como primeira resposta de "de
   * quem é", e deixou de ser a única.
   */
  const rawBody = await req.text();
  const appSecret = process.env.META_APP_SECRET ?? "";
  if (!verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"), appSecret)) {
    return fail("unauthorized", "invalid_signature", 401, { requestId });
  }

  // `null` aqui deixou de ser fatal: o dono de cada evento é resolvido abaixo,
  // pela WABA que a Meta carimba.
  const session = await metaSessionByWebhookToken(token);

  // ─── O contrato do fio, ANTES do parser ───────────────────────────────────
  //
  // Isto era `JSON.parse(rawBody)` seguido de um `as`: cast, que não confere
  // nada em execução. `parseMetaWebhook` então faz `for (const entry of
  // envelope.entry ?? [])` — e `for...of` sobre um número LANÇA. Não há
  // try/catch em volta: a exceção subia sem ninguém tratá-la (o framework
  // responde 5xx) e a Meta reentregava em backoff um corpo que nunca melhora.
  //
  // 400 e não 200: o 200 generoso desta rota existe para EVENTO QUE NÃO NOS
  // INTERESSA (a Meta reentrega o que não recebe 2xx), e um payload fora do
  // contrato não é isso — é o fio ter mudado, que ninguém pode descobrir tarde.
  // O schema é loose e todo campo é opcional, então chegar aqui exige um campo
  // que a gente LÊ vir com o tipo errado. Ver lib/channels/meta/envelope.ts.
  const leitura = lerEnvelopeMeta(rawBody);
  if (!leitura.ok) {
    if (leitura.motivo === "json_invalido") {
      return fail("invalid_request", "invalid_json", 400, { requestId });
    }
    logger.error("[meta.webhook] payload fora do contrato do canal", {
      request_id: requestId,
      campos: leitura.campos,
    });
    return fail("validation_failed", "payload fora do contrato do canal", 400, {
      requestId,
      details: { campos: leitura.campos },
    });
  }

  const eventos = parseMetaWebhook(leitura.envelope);
  const admin = createAdminClient();

  /**
   * A CONTA QUE CHEGOU PELO CADASTRO INCORPORADO.
   *
   * Vem pelo MESMO endereço das mensagens — é o desenho do cadastro embutido:
   * cada cliente liga a WABA dele ao nosso app e todas apontam para esta URL.
   * `parseMetaWebhook` ignora estes campos de propósito (ele trata mensagem,
   * status e template), então a leitura acontece aqui, sobre o envelope cru.
   *
   * Só GUARDA. O aviso não diz de qual cliente NOSSO ele é — o link é da
   * instalação, não do tenant —, e amarrar sozinho erraria no dia em que dois
   * clientes entrassem na mesma tarde: a conversa de um sairia pelo número do
   * outro. A amarração é ato humano, no painel.
   *
   * Sem `await` que possa derrubar a rota: falha aqui vira log, nunca erro
   * HTTP. A Meta re-entrega tudo que não recebe 2xx, em backoff, por horas — e
   * pelo mesmo endpoint chegam as MENSAGENS dos clientes.
   */
  for (const entry of leitura.envelope.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const chegada = lerChegada(
        String(change.field ?? ""),
        String(entry.id ?? ""),
        (change.value ?? {}) as Record<string, unknown>,
      );
      if (!chegada) continue;
      const guardou = await guardarChegada(admin, chegada);
      logger.info("[meta.webhook] cadastro incorporado", {
        request_id: requestId,
        waba_id: chegada.wabaId,
        guardou,
      });
    }
  }
  const now = new Date().toISOString();
  /**
   * Desfecho de cada ingestão. Existe porque a versão anterior fazia
   * `await ingestMetaInbound(...)` e DESCARTAVA o retorno: um insert que falhava
   * virava `{"received": 1}` com nada gravado, e "chegou e falhou" ficava
   * indistinguível de "não chegou". Custou uma hora de diagnóstico no lugar errado.
   */
  const desfechos: string[] = [];

  for (const e of eventos) {
    /**
     * De QUEM é este evento.
     *
     * O token do caminho dá a primeira resposta, e ela basta enquanto houver
     * uma conta WhatsApp só. Com duas, os eventos da segunda chegam com o token
     * da primeira — e a versão anterior deste trecho os DESCARTAVA em silêncio.
     *
     * Não era caso de borda: é o desenho do cadastro embutido, em que cada
     * cliente liga a WABA dele ao nosso app e todas apontam para a mesma URL.
     * Do jeito antigo, só o primeiro cliente receberia mensagem.
     *
     * A WABA do corpo só é usada DEPOIS da assinatura HMAC conferir — ou seja,
     * depois de provar que quem falou foi a Meta, que só entrega eventos de uma
     * WABA para os apps inscritos nela. E quem traduz WABA → organização é a
     * nossa tabela, nunca o corpo: nenhum campo do payload escolhe tenant.
     */
    const dono = await donoDoEvento({
      sessionDoToken: session,
      wabaDoEvento: e.wabaId,
      porWaba: metaSessionByWabaId,
    });
    if (!dono) {
      // Nem o token nem a WABA acharam dono: ignorar continua certo (é evento
      // que não é nosso), e 200 continua sendo a resposta — a Meta reentrega em
      // backoff tudo que não recebe 2xx.
      desfechos.push("waba_desconhecida");
      continue;
    }

    if (e.kind === "inbound_message") {
      // A metade que faltava: mensagem do contato vira linha no inbox, move lead,
      // acorda o agente — e carimba `last_inbound_at`, que é o que ABRE a janela
      // de 24h que o gate da Fase 4 calcula.
      // A organização vem do TOKEN DO PATH, nunca do corpo: é a mesma fonte que
      // decide onde os dois updates abaixo escrevem. Sem ela a ingestão
      // resolvia a sessão só pelo `phone_number_id` do payload — e duas
      // organizações com o mesmo número faziam a mensagem ser descartada para
      // as duas, com 200 na resposta (issue #236).
      const r = await ingestMetaInbound(admin, e, { organizationId: dono.organizationId });
      desfechos.push(r.status);
      if (r.status === "failed" || r.status === "no_session") {
        // 2xx continua (a Meta re-entregaria em loop), mas a falha NÃO fica muda:
        // vai ao log estruturado e ao corpo da resposta.
        console.error("[meta.ingest] inbound não ingerido", {
          status: r.status,
          reason: r.status === "failed" ? r.reason : undefined,
          external_id: e.externalId,
          phone_number_id: e.phoneNumberId,
        });
      }
      continue;
    }

    if (e.kind === "template_status") {
      await admin
        .from("meta_templates")
        .update({ status: e.event, rejected_reason: e.reason, updated_at: now })
        .eq("organization_id", dono.organizationId)
        .eq("waba_id", e.wabaId)
        .eq("name", e.templateName)
        .eq("language", e.templateLanguage);
    } else {
      /**
       * O que a Meta cobrou vai JUNTO com o status.
       *
       * Só quando o evento traz `pricing`: um `read` chega sem ele, e escrever
       * `null` por cima apagaria o que o `sent` já tinha registrado — o custo
       * do mês inteiro dependeria de qual status chegou por último.
       */
      const patchDaMensagem: Record<string, unknown> = {
        status: e.status === "failed" ? "failed" : "sent",
        updated_at: now,
      };
      if (e.pricing) {
        patchDaMensagem.meta_billable = e.pricing.billable;
        patchDaMensagem.meta_pricing_category = e.pricing.category;
      }

      await admin
        .from("messages")
        .update(patchDaMensagem)
        .eq("organization_id", dono.organizationId)
        .eq("external_id", e.externalId);

      /**
       * E a MESMA notícia chega à campanha do MIA Broadcast.
       *
       * Sem esta linha `broadcast_recipients` parava em `enviada` para sempre:
       * a tela mostrava a campanha inteira como enviada e nunca como entregue,
       * e o estorno — que só pode acontecer quando a Meta admite a falha —
       * ficava sem quem o chamasse. A mensagem que não é de campanha passa
       * reto; este caminho é um a mais, não o único.
       */
      const naCampanha = await aplicarDesfechoNaCampanha(admin, {
        organizationId: dono.organizationId,
        externalId: e.externalId,
        statusDaMeta: e.status,
      });
      if (naCampanha !== "nao_e_disparo") desfechos.push(`broadcast:${naCampanha}`);
    }
  }

  // 200 SEMPRE que a assinatura confere, inclusive para evento que não nos
  // interessa: a Meta re-entrega tudo que não recebe 2xx, e recusar o que
  // ignoramos vira re-tentativa em backoff por horas.
  // `outcomes` no corpo: quem depura vê o que aconteceu com cada evento em vez de
  // ler um contador que não distingue sucesso de falha.
  return NextResponse.json(
    { received: eventos.length, outcomes: desfechos },
    { status: 200 },
  );
}
