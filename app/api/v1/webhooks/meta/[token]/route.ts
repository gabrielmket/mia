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
 *
 * ─── De onde vêm as duas credenciais (issue #850, migration 0257) ─────────────
 *
 * Do BANCO (`platform_meta_app`), não do ambiente: as duas são da INSTALAÇÃO
 * inteira, não da organização — é isto que faz o 2º número conectar sem ninguém
 * voltar na VPS para editar `.env` e reiniciar. O `.env` continua sendo o PISO
 * (rollback, e clone que ainda não aplicou a migration) e as duas fontes NÃO se
 * misturam: segredo de um lado com verify token do outro é um app que não existe,
 * e a falha é um 401 calado que ninguém liga a configuração. A precedência, o TTL
 * e esse motivo estão escritos em `lib/channels/meta/app.ts`.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { comIdDaRequisicao, fail } from "@/lib/api/wrappers";
import { appDaMeta } from "@/lib/channels/meta/app";
import { lerEnvelopeMeta } from "@/lib/channels/meta/envelope";
import { guardarChegada, lerChegada } from "@/lib/channels/meta/chegada-do-cadastro";
import {
  MOTIVO_DO_CONTRATO_VIOLADO,
  registrarRecusaDoWebhookMeta,
} from "@/lib/channels/meta/recusa-do-webhook";
import { parseMetaWebhook, verificationChallenge, verifyMetaSignature } from "@/lib/channels/meta/webhook";
import { aplicarDesfechoNaCampanha } from "@/lib/broadcast/desfecho-da-campanha";
import { statusUpdate } from "@/lib/channels/meta/status-update";
import {
  ingestMetaEcho,
  ingestMetaInbound,
  ingestMetaReaction,
} from "@/lib/channels/meta/ingest";
// FORK MIA: a coexistência (docs/fork/coexistencia.md). O histórico que a Meta
// manda no campo `history` e a contagem dos contatos da agenda do app.
import { ingerirContatoDoAppContando } from "@/lib/channels/meta/coexistencia/contatos";
import { receberHistoricoDaMeta } from "@/lib/channels/meta/coexistencia/receber";
import { donoDoEvento } from "@/lib/channels/meta/dono-do-evento";
import { metaSessionByWabaId, metaSessionByWebhookToken } from "@/lib/channels/meta/session";
import {
  MOTIVO_CONTATO_ANONIMIZADO,
  MOTIVO_TITULAR_APAGADO,
  perguntarTitularesApagadosNoLote,
  type ApagadosNoLote,
} from "@/lib/channels/meta/titular-apagado";
import { logger } from "@/lib/logger";
import {
  emitirFalhaDeEntrega,
  telefoneDoEmbed,
  type EmbedDoContato,
} from "@/lib/messaging/falha-de-entrega";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ token: string }>;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const { token } = await ctx.params;
  const session = await metaSessionByWebhookToken(token);
  if (!session) return comIdDaRequisicao(new NextResponse("not found", { status: 404 }), req);

  // Do BANCO (platform_meta_app, migration 0257), com o `.env` como piso: é a
  // credencial da INSTALAÇÃO inteira, não da organização — e um clone que ainda
  // não aplicou a migration continua verificado pelo ambiente. Não lança nunca;
  // a precedência e o porquê estão em `lib/channels/meta/app.ts`.
  const { verifyToken } = await appDaMeta();
  const challenge = verificationChallenge(req.nextUrl.searchParams, verifyToken ?? "");
  if (challenge === null) return comIdDaRequisicao(new NextResponse("forbidden", { status: 403 }), req);

  // Texto puro, sem wrapper — ver o cabeçalho.
  return comIdDaRequisicao(new NextResponse(challenge, {
    status: 200,
    headers: { "content-type": "text/plain" },
  }), req);
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
  // Do mesmo lugar que o handshake: BANCO primeiro, `.env` como piso (0257). Sem
  // segredo nenhum configurado a verificação devolve `false` e a entrega morre em
  // 401 — que é o desfecho de hoje, e não um 500.
  const { appSecret } = await appDaMeta();
  if (!verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"), appSecret ?? "")) {
    return fail("unauthorized", "invalid_signature", 401, { requestId });
  }

  // `null` aqui deixou de ser fatal: o dono de cada evento é resolvido abaixo,
  // pela WABA que a Meta carimba.
  const session = await metaSessionByWebhookToken(token);
  // O admin nasce ANTES da leitura do contrato porque a recusa também grava:
  // ela arquiva o corpo cru em `webhook_events_log` (ver
  // `lib/channels/meta/recusa-do-webhook.ts`).
  const admin = createAdminClient();

  // ─── O contrato do fio, ANTES do parser ───────────────────────────────────
  //
  // Isto era `JSON.parse(rawBody)` seguido de um `as`: cast, que não confere
  // nada em execução. `parseMetaWebhook` então faz `for (const entry of
  // envelope.entry ?? [])` — e `for...of` sobre um número LANÇA. Não há
  // try/catch em volta: a exceção subia sem ninguém tratá-la (o framework
  // responde 5xx) e a Meta reentregava em backoff um corpo que nunca melhora.
  //
  // 200 e NÃO 400 (issue #290, item 3): o 4xx faz a Meta reentregar o MESMO
  // corpo em backoff por horas — e reentrega em excesso é caminho para a WABA
  // ser suspensa. Um corpo fora do contrato não melhora com reentrega: ele é o
  // fio que mudou, e quem precisa saber disso é quem opera. Por isso o
  // desfecho é o do canal por QR (que já está na main): 200, corpo cru
  // arquivado com `status = 'error'` e o motivo, log estruturado e um aviso na
  // Central. O corpo do 200 diz que houve recusa (`accepted: false`) — não
  // finge que processou.
  //
  // O JSON quebrado continua 400 e é OUTRO caso: com HMAC válido ele só pode
  // vir de quem assinou um corpo que nunca foi o protocolo (a Meta assina o
  // que envia, e um proxy que mutile o corpo derruba a assinatura antes, em
  // 401). Não é o fio mudando de forma — é um corpo que nunca chegou a ser
  // payload.
  const leitura = lerEnvelopeMeta(rawBody);
  if (!leitura.ok) {
    if (leitura.motivo === "json_invalido") {
      return fail("invalid_request", "invalid_json", 400, { requestId });
    }
    // FORK MIA: `session` pode ser `null` aqui (token órfão, ou a conta que só
    // chega pela WABA, ver `donoDoEvento`), e o arquivo e o aviso da recusa são
    // da organização do token. Sem ela, a recusa não tem onde morar: fica no log
    // e a resposta diz `nao_arquivado`, sem fingir que existe linha.
    const recusa = session
      ? await registrarRecusaDoWebhookMeta(admin, {
          sessao: session,
          token,
          rawBody,
          headers: req.headers,
          campos: leitura.campos,
          requestId,
        })
      : ({ logId: null, arquivo: "falhou", aviso: "falhou" } as const);
    logger.error("[meta.webhook] payload fora do contrato do canal", {
      request_id: requestId,
      estagio: "conteudo",
      campos: leitura.campos,
      log_id: recusa.logId,
      arquivo: recusa.arquivo,
      aviso: recusa.aviso,
    });
    return NextResponse.json(
      {
        received: 0,
        accepted: false,
        outcomes: [`recusado:${MOTIVO_DO_CONTRATO_VIOLADO}`],
        reason: "payload_fora_do_contrato",
        // Mesma frase do dicionário: nada novo para traduzir, e o detalhe
        // operacional vai nos campos de máquina abaixo.
        detail: "payload fora do contrato do canal",
        campos: leitura.campos,
        // `error` = esta entrega acabou de ser arquivada; `ja_arquivado` = a
        // Meta reentregou a mesma entrega; `nao_arquivado` = o banco recusou a
        // escrita (e a resposta NÃO finge que existe linha). Nenhum dos três é
        // "processado".
        arquivo:
          recusa.arquivo === "novo"
            ? "error"
            : recusa.arquivo === "ja_existia"
              ? "ja_arquivado"
              : "nao_arquivado",
      },
      { status: 200, headers: { "X-Request-Id": requestId } },
    );
  }

  const eventos = parseMetaWebhook(leitura.envelope);

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
  // FORK MIA: o histórico da coexistência (campo `history`, que o
  // `parseMetaWebhook` ignora). Só guarda o lote e pede ao worker, que grava
  // como histórico importado, sem disparar nada. Não lança: falha vira desfecho.
  desfechos.push(
    ...(await receberHistoricoDaMeta(admin, leitura.envelope, {
      requestId,
      sessionDoToken: session,
      porWaba: (waba) => metaSessionByWabaId(waba),
    })),
  );
  /**
   * A pergunta do apagado a pedido é feita UMA vez por lote, não por contato
   * (`perguntarTitularesApagadosNoLote`, migration 9321). Estados:
   * `undefined` = ainda não perguntou; `null` = perguntou e FALHOU (cada evento
   * cai na pergunta individual da ingestão, que falha fechada sem parar o lote).
   */
  //
  // FORK MIA: por ORGANIZAÇÃO, e não uma variável só como veio do upstream
  // (1.107): aqui uma entrega pode trazer eventos de mais de uma conta (o dono
  // de cada evento é `donoDoEvento`), e a resposta de uma organização não vale
  // para a outra. Sem chave no mapa = ainda não perguntou.
  const apagadosPorOrganizacao = new Map<string, ApagadosNoLote | null>();
  /** Quantos contatos da agenda ficaram de fora por LGPD — vai ao log no fim. */
  let puladosPorTitularApagado = 0;
  let puladosPorContatoAnonimizado = 0;

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
      // Embrulhado, e não a referência crua: a busca pela WABA só existe quando
      // o token não serve, e só então o módulo é lido. Os testes de rota do
      // upstream (`webhook-meta-le-do-banco`, `meta-coexistencia-eco-do-app`)
      // dublam `session` só com `metaSessionByWebhookToken` — é o que a rota
      // deles chama — e ler a referência aqui, mesmo sem chamar, derrubava os
      // dois. Cenário que chegue a precisar da WABA continua falhando alto no
      // dublê incompleto, que é o que se quer.
      porWaba: (waba) => metaSessionByWabaId(waba),
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

    if (e.kind === "reaction") {
      // Reação (#2797): linha LIGADA à mensagem alvo, e sem carimbo nenhum —
      // o carimbo abriria a janela de 24h, moveria a ordenação da Inbox e
      // geraria prévia/contador por um gesto que não é mensagem. Quem grava é
      // `ingestMetaReaction`, que também trata a remoção (emoji vazio) e o
      // descarte de reação sem alvo.
      //
      // FORK MIA: `dono.organizationId`, e não `session.organizationId` como
      // veio do upstream (1.86) — o mesmo motivo do eco abaixo: `session` pode
      // ser `null`, e quem decide o tenant é `donoDoEvento`.
      const r = await ingestMetaReaction(admin, e, { organizationId: dono.organizationId });
      desfechos.push(`reacao:${r.status}`);
      if (r.status === "failed" || r.status === "no_session") {
        logger.error("[meta.ingest] reação não ingerida", {
          request_id: requestId,
          status: r.status,
          reason: r.status === "failed" ? r.reason : undefined,
          external_id: e.externalId,
        });
      }
      continue;
    }

    if (e.kind === "outbound_echo") {
      // Coexistência: resposta dada pelo app WhatsApp Business. Entra na conversa
      // como saída de humano e pausa a IA — ver `ingestMetaEcho`. Mesma política
      // de falha da recebida: 2xx sempre, falha no log e no corpo.
      //
      // `dono.organizationId`, e não `session.organizationId` como veio do
      // upstream: aqui `session` pode ser `null` (token órfão, ou evento de
      // outra WABA pela mesma URL), e quem decide o tenant é `donoDoEvento`.
      const r = await ingestMetaEcho(admin, e, { organizationId: dono.organizationId });
      desfechos.push(`eco:${r.status}`);
      if (r.status === "failed" || r.status === "no_session") {
        logger.error("[meta.ingest] eco do app não ingerido", {
          request_id: requestId,
          status: r.status,
          reason: r.status === "failed" ? r.reason : undefined,
          external_id: e.externalId,
          phone_number_id: e.phoneNumberId,
        });
      }
      continue;
    }

    if (e.kind === "app_contact_sync") {
      // Coexistência: contato criado/editado no ENDEREÇO do app. Entra no CRM com
      // o nome do celular — sem conversa, sem mensagem e sem tocar na IA, porque
      // nada foi trocado (ver `ingestMetaAppContactSync`). Mesma política de
      // falha das outras duas: 2xx sempre, falha no log e no corpo.
      // A pergunta do titular apagado a pedido é do LOTE: uma consulta para
      // todos os contatos desta entrega, feita na primeira vez que um deles
      // aparece. Se ela falhar (`null`), cada evento cai na pergunta individual
      // da ingestão — falha fechada, e o lote continua.
      //
      // FORK MIA: `dono.organizationId`, e não `session.organizationId` como veio
      // do upstream (1.72 e 1.107): `session` pode ser `null`, e quem decide o
      // tenant é `donoDoEvento`. O lote leva todos os telefones da entrega: os de
      // outra conta só não acham ninguém nesta organização.
      if (!apagadosPorOrganizacao.has(dono.organizationId)) {
        const lote = await perguntarTitularesApagadosNoLote(
          admin,
          dono.organizationId,
          eventos.filter((x) => x.kind === "app_contact_sync").map((x) => x.phone),
        );
        apagadosPorOrganizacao.set(dono.organizationId, lote.erro ? null : lote.apagados);
        if (lote.erro) {
          logger.error("[meta.ingest] a pergunta do titular apagado no lote falhou", {
            request_id: requestId,
            erro: lote.erro,
            contatos_no_lote: eventos.filter((x) => x.kind === "app_contact_sync").length,
          });
        }
      }
      // FORK MIA: o mesmo `ingestMetaAppContactSync`, embrulhado para somar o
      // contato no pedido de contatos da coexistência quando ele nasce ou muda
      // de nome (docs/fork/coexistencia.md).
      const r = await ingerirContatoDoAppContando(
        admin,
        e,
        { organizationId: dono.organizationId },
        apagadosPorOrganizacao.get(dono.organizationId) ?? undefined,
      );
      desfechos.push(`contato:${r.status}`);
      if (r.status === "ignored" && r.reason === MOTIVO_TITULAR_APAGADO) {
        puladosPorTitularApagado += 1;
      }
      if (r.status === "ignored" && r.reason === MOTIVO_CONTATO_ANONIMIZADO) {
        puladosPorContatoAnonimizado += 1;
      }
      if (r.status === "failed" || r.status === "no_session") {
        logger.error("[meta.ingest] contato do app não sincronizado", {
          request_id: requestId,
          status: r.status,
          reason: r.status === "failed" ? r.reason : undefined,
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
      continue;
    }

    // O evento inteiro vira colunas, não só `status`: quando a Meta ACEITA o
    // template e reprova a entrega depois, o motivo só existe aqui (131026,
    // 131047, 131049, 132015). Ver `lib/channels/meta/status-update.ts`.
    const patchDaMensagem = statusUpdate(e, now);

    /**
     * O que a Meta cobrou vai JUNTO com o status.
     *
     * Só quando o evento traz `pricing`: um `read` chega sem ele, e escrever
     * `null` por cima apagaria o que o `sent` já tinha registrado — o custo
     * do mês inteiro dependeria de qual status chegou por último. Fica AQUI e
     * não dentro de `statusUpdate` porque lá todo campo é escrito sempre, e
     * este é justamente o que só pode ser escrito quando existe.
     *
     * Montado ANTES de separar `failed` do resto: o ramo de falha do upstream
     * (#1614) usava `statusUpdate` puro, e a falha que viesse com `pricing`
     * perderia o que a Meta disse cobrar.
     */
    if (e.pricing) {
      patchDaMensagem.meta_billable = e.pricing.billable;
      patchDaMensagem.meta_pricing_category = e.pricing.category;
    }

    if (e.status === "failed") {
      // A recusa da plataforma chega DEPOIS do 200 (131047 fora da janela,
      // 131026 número não registrado, 132015 template pausado). O evento inteiro
      // vira colunas como no ramo de baixo — e a falha emite `message.failed`
      // para quem integra (#1614), que até aqui não tinha gatilho nenhum.
      //
      // `.neq("status", "failed")` é o "uma vez": a Meta reentrega o mesmo
      // status enquanto não recebe 2xx, e cada reentegra seria mais um aviso
      // para o sistema do integrador sobre a MESMA falha. Só a primeira
      // atualiza uma linha, e só a primeira devolve linha — `linha` é o gatilho
      // da emissão, então 0 linhas = 0 eventos.
      //
      // `dono.organizationId` nos dois lugares, e não `session.organizationId`
      // como veio do upstream: aqui `session` pode ser `null` (token órfão, ou
      // evento de outra WABA pela mesma URL) — ver `donoDoEvento`.
      const { data: linha } = await admin
        .from("messages")
        .update(patchDaMensagem)
        .eq("organization_id", dono.organizationId)
        .eq("external_id", e.externalId)
        .neq("status", "failed")
        .select(
          "id, conversation_id, contact_id, sent_via, error_code, error_message, contacts:contact_id(phone_number)",
        )
        .maybeSingle();
      if (linha) {
        const falha = linha as {
          id: string;
          conversation_id: string | null;
          contact_id: string | null;
          sent_via: string | null;
          error_code: string | null;
          error_message: string | null;
          // FK de N para 1: o PostgREST devolve OBJETO em tempo de execução,
          // embora a tipagem gerada diga lista. `telefoneDoEmbed` aceita os dois.
          contacts: EmbedDoContato;
        };
        await emitirFalhaDeEntrega(admin, {
          organizationId: dono.organizationId,
          source: "meta-status-webhook",
          requestId,
          falha: {
            message_id: falha.id,
            conversation_id: falha.conversation_id,
            contact_id: falha.contact_id,
            contact: telefoneDoEmbed(falha.contacts),
            sent_via: falha.sent_via,
            erro: { codigo: falha.error_code ?? "", titulo: falha.error_message },
          },
        });
      }
    } else {
      // O evento inteiro vira colunas, não só `status`: quando a Meta ACEITA o
      // template e reprova a entrega depois, o motivo só existe aqui. Ver
      // `lib/channels/meta/status-update.ts`.
      //
      // O `delivered_at` como está no banco é lido ANTES: a hora da entrega é
      // de uma vez só e o `read` chega depois do `delivered` — sem olhar a
      // linha, ele reescrevia o instante em que a mensagem tocou o aparelho
      // (#4316). Mesma guarda do `carimbarUmaVez` do canal não-oficial.
      //
      // FORK MIA: `dono.organizationId`, e não `session.organizationId`: `session`
      // pode ser `null` aqui (token órfão ou de outro canal) desde que quem decide
      // o tenant passou a ser `donoDoEvento`. Ler `session` direto voltaria a
      // derrubar a rota justamente na instalação com duas contas. E o que a Meta
      // cobrou (`pricing`, montado em `patchDaMensagem` acima) vai junto.
      const { data: carimbos } = await admin
        .from("messages")
        .select("delivered_at")
        .eq("organization_id", dono.organizationId)
        .eq("external_id", e.externalId)
        .maybeSingle();
      const patchComCarimbos = statusUpdate(e, now, carimbos ?? {});
      if (e.pricing) {
        patchComCarimbos.meta_billable = e.pricing.billable;
        patchComCarimbos.meta_pricing_category = e.pricing.category;
      }
      await admin
        .from("messages")
        .update(patchComCarimbos)
        .eq("organization_id", dono.organizationId)
        .eq("external_id", e.externalId);
    }

    /**
     * E a MESMA notícia chega à campanha do MIA Broadcast — INCLUSIVE a falha.
     *
     * Sem esta linha `broadcast_recipients` parava em `enviada` para sempre:
     * a tela mostrava a campanha inteira como enviada e nunca como entregue,
     * e o estorno — que só pode acontecer quando a Meta admite a falha —
     * ficava sem quem o chamasse. A mensagem que não é de campanha passa
     * reto; este caminho é um a mais, não o único.
     *
     * Fica FORA do `if/else` de propósito. O ramo de `failed` do upstream
     * (#1614) entrou como `else if` antes do nosso `else`, e do jeito que a
     * fusão juntou os dois o `failed` nunca chegava aqui: justamente o status
     * que devolve o dinheiro ao cliente deixava de estornar, sem erro nenhum.
     * A reentrega do mesmo `failed` não estorna duas vezes — `proximoDesfecho`
     * não sai de `falhou`/`estornada`.
     */
    const naCampanha = await aplicarDesfechoNaCampanha(admin, {
      organizationId: dono.organizationId,
      externalId: e.externalId,
      statusDaMeta: e.status,
    });
    if (naCampanha !== "nao_e_disparo") desfechos.push(`broadcast:${naCampanha}`);
  }

  // O que ficou de fora por LGPD NÃO pode sumir em silêncio: a rota responde 200
  // e `outcomes` só diz `contato:ignored`. O contador diz QUANTOS (nunca o
  // telefone: PII não vai para o log), e só aparece quando houve pulo.
  if (puladosPorTitularApagado > 0 || puladosPorContatoAnonimizado > 0) {
    logger.info("[meta.ingest] contatos da agenda não sincronizados por LGPD", {
      request_id: requestId,
      // FORK MIA: as organizações, e não `session.organizationId`: `session` pode
      // ser `null`, e a entrega pode ser de mais de uma conta.
      organization_ids: [...apagadosPorOrganizacao.keys()],
      pulados_por_titular_apagado: puladosPorTitularApagado,
      pulados_por_contato_anonimizado: puladosPorContatoAnonimizado,
    });
  }

  // 200 SEMPRE que a assinatura confere, inclusive para evento que não nos
  // interessa: a Meta re-entrega tudo que não recebe 2xx, e recusar o que
  // ignoramos vira re-tentativa em backoff por horas.
  // `outcomes` no corpo: quem depura vê o que aconteceu com cada evento em vez de
  // ler um contador que não distingue sucesso de falha.
  return comIdDaRequisicao(NextResponse.json(
    { received: eventos.length, outcomes: desfechos },
    { status: 200 },
  ), requestId);
}
