import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ingerirContatoDoAppContando } from "@/lib/channels/meta/coexistencia/contatos";
import { gravarLoteDoHistorico } from "@/lib/channels/meta/coexistencia/gravar-lote";
import { EVENTO_DO_LOTE, receberHistoricoDaMeta } from "@/lib/channels/meta/coexistencia/receber";
import type { MetaWebhookEnvelope } from "@/lib/channels/meta/envelope";

import { pgComoSupabaseMia } from "../pg-como-supabase-mia";

/**
 * FORK MIA · coexistência (S2): O HISTÓRICO QUE A META MANDA NÃO DISPARA NADA.
 *
 * Quando o cliente conecta pelo app o número que já usa, a Meta manda até 180
 * dias de conversa no campo `history`. Se isso entrasse como mensagem nova, a
 * IA responderia quem falou há meses, o follow-up e as automações acordariam,
 * a conversa reabriria com SLA e a janela de 24 h abriria com mensagem velha.
 *
 * Aqui o CÓDIGO roda de verdade contra o banco (`pgComoSupabaseMia`): a rota
 * guarda o lote (`receberHistoricoDaMeta`), o worker grava
 * (`gravarLoteDoHistorico`), e o teste mede o que ficou:
 *
 *   - nenhum evento além do pedido ao worker (sem `message.*`, sem
 *     `conversation.routing_requested`, sem `ai_agent.dispatch_requested`):
 *     IA, push, follow-up, automação e campanha são todos consumidores de
 *     evento, e nenhum evento quer dizer que nenhum acorda;
 *   - nenhuma atividade do vendedor e nenhum envio de conversão;
 *   - a conversa que já existia e o negócio dela iguais, coluna por coluna
 *     (`last_message_*`, `last_inbound_at`, não lidas, estado, dono, a pausa
 *     da IA, a etapa e a data dela);
 *   - a conversa nova nasce encerrada e sem dono;
 *   - o mesmo lote duas vezes não duplica mensagem, lote, evento nem contador.
 *
 * O CONTROLE (a mesma mensagem SEM a chave emite `message.received`) fica no
 * fim, para o "nenhum evento" não ficar verde à toa.
 *
 * Dado fictício: Academia Alfa, número +55 31 900000001, clientes Ana Exemplo
 * (+55 31 900000002) e Bruno Teste (+55 31 900000003).
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres`,
  max: 3,
});
const db = await pgComoSupabaseMia(pool);

const ORG = "c0e59162-0000-4000-8000-00000000000a";
const SESSAO = "c0e59162-4444-4000-8000-00000000000a";
const SESSAO_RECUSADA = "c0e59162-4444-4000-8000-00000000000b";
const ANA = "c0e59162-3333-4000-8000-00000000000a";
const CONVERSA_DA_ANA = "c0e59162-5555-4000-8000-00000000000a";
const FUNIL = "c0e59162-6666-4000-8000-00000000000a";
const ETAPA = "c0e59162-7777-4000-8000-00000000000a";
const NEGOCIO = "c0e59162-8888-4000-8000-00000000000a";
const CICLO = "c0e59162-9999-4000-8000-00000000000a";
const PEDIDO_DE_CONTATOS = "c0e59162-aaaa-4000-8000-00000000000a";
const WABA = "waba-academia-alfa-9162";
const NUMERO = "pn-academia-alfa-9162";
const NUMERO_RECUSADO = "pn-academia-alfa-9162-b";

const EMPRESA_TEL = "5531900000001";
const ANA_TEL = "5531900000002";
const BRUNO_TEL = "5531900000003";

const AGORA = Math.floor(Date.now() / 1000);
const DIA = 86_400;

const SESSAO_DO_TOKEN = { id: SESSAO, organizationId: ORG, wabaId: WABA };
const opcoes = { requestId: "inv-9162", sessionDoToken: SESSAO_DO_TOKEN, porWaba: async () => null };

function envelope(value: Record<string, unknown>, numero = NUMERO): MetaWebhookEnvelope {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: WABA,
        changes: [
          {
            field: "history",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: `+${EMPRESA_TEL}`, phone_number_id: numero },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

function texto(id: string, de: string, quando: number, corpo: string, cliente = true) {
  return {
    id,
    from: de,
    ...(cliente ? { from_user_id: `BR.${de}` } : {}),
    timestamp: String(quando),
    type: "text",
    text: { body: corpo },
    history_context: { status: cliente ? "READ" : "DELIVERED" },
  };
}

const LOTE_RECENTE = envelope({
  history: [
    {
      metadata: { phase: 0, chunk_order: 1, progress: 40 },
      threads: [
        {
          id: ANA_TEL,
          context: { wa_id: ANA_TEL, user_id: `BR.${ANA_TEL}` },
          messages: [
            texto("wamid.coex9162.ana.1", ANA_TEL, AGORA - DIA, "Oi, ainda tem horário amanhã?"),
            texto("wamid.coex9162.ana.2", EMPRESA_TEL, AGORA - DIA + 60, "Tem sim, às 9h.", false),
          ],
        },
        {
          id: BRUNO_TEL,
          context: { wa_id: BRUNO_TEL, user_id: `BR.${BRUNO_TEL}` },
          messages: [
            texto("wamid.coex9162.bruno.1", BRUNO_TEL, AGORA - 2 * DIA, "Bom dia, quanto é o plano?"),
            {
              id: "wamid.coex9162.bruno.foto",
              from: BRUNO_TEL,
              from_user_id: `BR.${BRUNO_TEL}`,
              timestamp: String(AGORA - 2 * DIA + 30),
              type: "media_placeholder",
            },
            // Não é conversa: não vira linha.
            { id: "wamid.coex9162.bruno.reacao", from: BRUNO_TEL, timestamp: String(AGORA - 2 * DIA + 40), type: "reaction" },
          ],
        },
      ],
    },
  ],
});

const LOTE_ANTIGO = envelope({
  history: [
    {
      metadata: { phase: 2, chunk_order: 1, progress: 100 },
      threads: [
        {
          id: ANA_TEL,
          context: { wa_id: ANA_TEL },
          messages: [
            texto("wamid.coex9162.ana.antiga", ANA_TEL, AGORA - 100 * DIA, "Vocês abrem no sábado?"),
            // A mesma que já entrou pelo caminho ao vivo: existente, não duplica.
            texto("wamid.coex9162.ana.ao-vivo", ANA_TEL, AGORA - 3 * DIA, "Mensagem que chegou ao vivo"),
          ],
        },
      ],
    },
  ],
});

const MIDIA_DO_BRUNO = envelope({
  messages: [
    {
      id: "wamid.coex9162.bruno.foto",
      from: BRUNO_TEL,
      from_user_id: `BR.${BRUNO_TEL}`,
      timestamp: String(AGORA - DIA),
      type: "image",
      image: { id: "midia-coex9162-1", mime_type: "image/jpeg", caption: "A ficha" },
    },
  ],
});

async function linha<T = Record<string, unknown>>(texto: string, valores: unknown[] = []): Promise<T> {
  const { rows } = await pool.query(texto, valores);
  return rows[0] as T;
}

/** O marco: o que a semente e os contatos da agenda emitiram não é do histórico. */
let marco = "";

async function eventos(): Promise<string[]> {
  const { rows } = await pool.query(
    "select event_type from public.event_log where organization_id = $1 and created_at >= $2::timestamptz order by created_at, event_type",
    [ORG, marco],
  );
  return rows.map((r) => r.event_type as string);
}

async function pedidosAoWorker(): Promise<string[]> {
  const { rows } = await pool.query(
    `select payload->>'lote_id' as lote from public.event_log
      where organization_id = $1 and event_type = $2 and status = 'pending'
      order by created_at`,
    [ORG, EVENTO_DO_LOTE],
  );
  return rows.map((r) => r.lote as string);
}

/** O worker, em ordem INVERSA (os lotes chegam fora de ordem). */
async function drenar(): Promise<string[]> {
  const desfechos: string[] = [];
  for (const lote of (await pedidosAoWorker()).reverse()) {
    const r = await gravarLoteDoHistorico(db, lote);
    desfechos.push(r.status);
    await pool.query(
      `update public.event_log set status = 'done' where organization_id = $1 and payload->>'lote_id' = $2`,
      [ORG, lote],
    );
  }
  return desfechos;
}

const retrato = (tabela: string, id: string) =>
  linha<{ r: string }>(`select to_jsonb(t)::text as r from public.${tabela} t where id = $1`, [id]).then((x) => x.r);

async function pedidoDoHistorico() {
  return linha<{
    id: string;
    estado: string;
    progresso: number;
    fase: number;
    mensagens_recebidas: number;
    mensagens_existentes: number;
    conversas_recebidas: number;
    midias_guardadas: number;
  }>(
    `select id, estado, progresso, fase, mensagens_recebidas, mensagens_existentes, conversas_recebidas, midias_guardadas
       from public.mia_coexistencia_sincronizacoes where conexao_id = $1 and tipo = 'historico'`,
    [CICLO],
  );
}

let conversaAntes = "";
let negocioAntes = "";
let atividadesAntes = 0;
let conversoesAntes = 0;

beforeAll(async () => {
  await pool.query(
    `insert into public.organizations (id, slug, legal_name, display_name)
       values ($1, 'academia-alfa-9162', 'Academia Alfa 9162', 'Academia Alfa') on conflict (id) do nothing`,
    [ORG],
  );
  for (const [id, nome, numero] of [
    [SESSAO, "coexistencia-9162", NUMERO],
    [SESSAO_RECUSADA, "coexistencia-9162-b", NUMERO_RECUSADO],
  ] as const) {
    await pool.query(
      `insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted, meta_phone_number_id, meta_waba_id)
         values ($1, $2, $3, '\\x00'::bytea, $4, $5) on conflict (id) do nothing`,
      [id, ORG, nome, numero, WABA],
    );
  }
  await pool.query(
    `insert into public.contacts (id, organization_id, display_name, phone_number)
       values ($1, $2, 'Ana Exemplo', '+5531900000002') on conflict (id) do nothing`,
    [ANA, ORG],
  );
  await pool.query(
    `insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, last_message_at)
       values ($1, $2, $3, $4, 'open', '2026-11-10T10:00:00Z') on conflict (id) do nothing`,
    [CONVERSA_DA_ANA, ORG, ANA, SESSAO],
  );
  // A mensagem que entrou ao vivo (com o evento dela, que é o de sempre).
  await pool.query(
    `insert into public.messages
       (organization_id, conversation_id, channel_session_id, contact_id, external_id, type, direction, status, sent_via, body, sent_at)
     values ($1, $2, $3, $4, 'wamid.coex9162.ana.ao-vivo', 'text', 'inbound', 'delivered', 'crm', 'Mensagem que chegou ao vivo', now() - interval '3 days')`,
    [ORG, CONVERSA_DA_ANA, SESSAO, ANA],
  );
  await pool.query(
    `insert into public.crm_pipelines (id, organization_id, name, slug) values ($1, $2, 'Matrículas', 'matriculas-9162') on conflict (id) do nothing`,
    [FUNIL, ORG],
  );
  await pool.query(
    `insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
       values ($1, $2, $3, 'Avaliação', 'avaliacao-9162', 1000) on conflict (id) do nothing`,
    [ETAPA, ORG, FUNIL],
  );
  await pool.query(
    `insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id)
       values ($1, $2, $3, $4, 'Ana Exemplo · plano anual', $5) on conflict (id) do nothing`,
    [NEGOCIO, ORG, FUNIL, ETAPA, ANA],
  );
  // O ciclo que a conexão pelo app abriu (S3), com o pedido de contatos já feito.
  await pool.query(
    `insert into public.mia_coexistencia_conexoes (id, organization_id, channel_session_id, waba_id, phone_number_id)
       values ($1, $2, $3, $4, $5) on conflict (id) do nothing`,
    [CICLO, ORG, SESSAO, WABA, NUMERO],
  );
  await pool.query(
    `insert into public.mia_coexistencia_sincronizacoes (id, organization_id, conexao_id, tipo, estado, pedida_em)
       values ($1, $2, $3, 'contatos', 'pedida', now()) on conflict (id) do nothing`,
    [PEDIDO_DE_CONTATOS, ORG, CICLO],
  );
  conversaAntes = await retrato("conversations", CONVERSA_DA_ANA);
  negocioAntes = await retrato("crm_leads", NEGOCIO);
  atividadesAntes = (await linha<{ n: number }>("select count(*)::int as n from public.crm_lead_activities where organization_id = $1", [ORG])).n;
  conversoesAntes = (await linha<{ n: number }>("select count(*)::int as n from public.ad_conversion_dispatches where organization_id = $1", [ORG])).n;
});

afterAll(async () => pool.end());

describe("os contatos da agenda do app somam no pedido de contatos", () => {
  const evento = (nome: string) => ({
    kind: "app_contact_sync" as const,
    wabaId: WABA,
    phoneNumberId: NUMERO,
    phone: "5531900000005",
    name: nome,
    action: "add",
  });

  it("o contato que nasce conta 1, e o pedido passa a em_andamento", async () => {
    const r = await ingerirContatoDoAppContando(db, evento("Recepção Academia Alfa"), { organizationId: ORG });
    expect(r.status).toBe("synced");
    expect(
      await linha("select contatos_recebidos, estado from public.mia_coexistencia_sincronizacoes where id = $1", [PEDIDO_DE_CONTATOS]),
    ).toEqual({ contatos_recebidos: 1, estado: "em_andamento" });
  });

  it("a Meta reentrega o mesmo contato com o mesmo nome: não conta de novo", async () => {
    await ingerirContatoDoAppContando(db, evento("Recepção Academia Alfa"), { organizationId: ORG });
    expect(
      (await linha<{ n: number }>("select contatos_recebidos as n from public.mia_coexistencia_sincronizacoes where id = $1", [PEDIDO_DE_CONTATOS])).n,
    ).toBe(1);
  });

  it("o contato renomeado no app conta", async () => {
    await ingerirContatoDoAppContando(db, evento("Recepção Academia Beta"), { organizationId: ORG });
    expect(
      (await linha<{ n: number }>("select contatos_recebidos as n from public.mia_coexistencia_sincronizacoes where id = $1", [PEDIDO_DE_CONTATOS])).n,
    ).toBe(2);
  });
});

describe("o histórico entra como passado", () => {
  it("a rota guarda os dois lotes e pede ao worker, sem gravar mensagem", async () => {
    marco = (await linha<{ t: string }>("select clock_timestamp()::text as t")).t;
    await pool.query("update public.event_log set status = 'done' where organization_id = $1", [ORG]);
    expect(await receberHistoricoDaMeta(db, LOTE_RECENTE, opcoes)).toEqual(["historico:lote_recebido"]);
    expect(await receberHistoricoDaMeta(db, LOTE_ANTIGO, opcoes)).toEqual(["historico:lote_recebido"]);
    expect(await pedidosAoWorker()).toHaveLength(2);
    // O ciclo vivo é o da conexão pelo app: o histórico não abriu outro.
    expect(
      (await linha<{ n: number }>("select count(*)::int as n from public.mia_coexistencia_conexoes where organization_id = $1 and channel_session_id = $2", [ORG, SESSAO])).n,
    ).toBe(1);
    expect(
      (await linha<{ n: number }>("select count(*)::int as n from public.messages where organization_id = $1 and metadata->>'historico_origem' = 'coexistencia'", [ORG])).n,
    ).toBe(0);
  });

  it("o worker grava os lotes fora de ordem como histórico importado", async () => {
    expect(await drenar()).toEqual(["gravado", "gravado"]);
    const { rows } = await pool.query(
      `select external_id, direction, type, metadata->>'historico_importado' as chave
         from public.messages where organization_id = $1 and metadata->>'historico_origem' = 'coexistencia'
        order by external_id`,
      [ORG],
    );
    expect(rows).toEqual([
      { external_id: "wamid.coex9162.ana.1", direction: "inbound", type: "text", chave: "true" },
      { external_id: "wamid.coex9162.ana.2", direction: "outbound", type: "text", chave: "true" },
      { external_id: "wamid.coex9162.ana.antiga", direction: "inbound", type: "text", chave: "true" },
      { external_id: "wamid.coex9162.bruno.1", direction: "inbound", type: "text", chave: "true" },
      { external_id: "wamid.coex9162.bruno.foto", direction: "inbound", type: "text", chave: "true" },
    ]);
  });

  it("⭐ nenhum evento além do pedido ao worker: IA, push, follow-up, automação e campanha não acordam", async () => {
    expect(new Set(await eventos())).toEqual(new Set([EVENTO_DO_LOTE]));
  });

  it("⭐ nenhuma atividade do vendedor e nenhum envio de conversão para a Meta", async () => {
    expect((await linha<{ n: number }>("select count(*)::int as n from public.crm_lead_activities where organization_id = $1", [ORG])).n).toBe(atividadesAntes);
    expect((await linha<{ n: number }>("select count(*)::int as n from public.ad_conversion_dispatches where organization_id = $1", [ORG])).n).toBe(conversoesAntes);
  });

  it("⭐ a conversa que já existia e o negócio dela ficam iguais, coluna por coluna", async () => {
    expect(await retrato("conversations", CONVERSA_DA_ANA)).toBe(conversaAntes);
    expect(await retrato("crm_leads", NEGOCIO)).toBe(negocioAntes);
    expect(
      (await linha<{ n: number }>("select count(*)::int as n from public.crm_leads where organization_id = $1", [ORG])).n,
    ).toBe(1);
  });

  it("a conversa nova nasce encerrada, sem dono e na data da última mensagem do lote", async () => {
    const nova = await linha<{ status: string; dono: string | null; ultima: string; n: number }>(
      `select c.status, c.assigned_to_user_id as dono, c.last_message_at::text as ultima,
              (select count(*)::int from public.conversations x where x.organization_id = $1) as n
         from public.conversations c
         join public.contacts k on k.id = c.contact_id
        where c.organization_id = $1 and k.phone_number = '+5531900000003'`,
      [ORG],
    );
    expect(nova.status).toBe("closed");
    expect(nova.dono).toBeNull();
    expect(new Date(nova.ultima).getTime()).toBe((AGORA - 2 * DIA + 30) * 1000);
    expect(nova.n).toBe(2);
  });

  it("os contadores dizem o que chegou, e o pedido fecha com o lote de progresso 100", async () => {
    expect(await pedidoDoHistorico()).toMatchObject({
      estado: "concluida",
      progresso: 100,
      fase: 2,
      mensagens_recebidas: 5,
      mensagens_existentes: 1,
      conversas_recebidas: 1,
    });
    // O pedido de contatos em andamento fecha junto (a Meta não avisa o fim dele).
    expect(
      (await linha<{ estado: string }>("select estado from public.mia_coexistencia_sincronizacoes where id = $1", [PEDIDO_DE_CONTATOS])).estado,
    ).toBe("concluida");
    // O lote gravado não guarda a conversa.
    expect(
      (await linha<{ n: number }>("select count(*)::int as n from public.mia_coexistencia_lotes where organization_id = $1 and payload is not null", [ORG])).n,
    ).toBe(0);
  });
});

describe("o mesmo lote duas vezes não duplica nada", () => {
  it("⭐ a reentrega não vira lote, evento, mensagem nem contador novo", async () => {
    const antes = { eventos: (await eventos()).length, pedido: await pedidoDoHistorico() };
    expect(await receberHistoricoDaMeta(db, LOTE_RECENTE, opcoes)).toEqual(["historico:lote_repetido"]);
    expect(await receberHistoricoDaMeta(db, LOTE_ANTIGO, opcoes)).toEqual(["historico:lote_repetido"]);
    expect((await eventos()).length).toBe(antes.eventos);
    expect(await pedidoDoHistorico()).toEqual(antes.pedido);
    expect(
      (await linha<{ n: number }>("select count(*)::int as n from public.mia_coexistencia_lotes where organization_id = $1", [ORG])).n,
    ).toBe(2);
  });

  it("⭐ o worker que recebe o mesmo pedido de novo não grava de novo", async () => {
    const { rows } = await pool.query("select id from public.mia_coexistencia_lotes where organization_id = $1", [ORG]);
    for (const { id } of rows) expect((await gravarLoteDoHistorico(db, id as string)).status).toBe("ja_gravado");
    expect(
      (await linha<{ n: number }>("select count(*)::int as n from public.messages where organization_id = $1 and metadata->>'historico_origem' = 'coexistencia'", [ORG])).n,
    ).toBe(5);
  });

  it("o lote refeito depois de falhar no meio conta o que ele mesmo já gravou, sem duplicar", async () => {
    // Simula a falha depois do insert: o lote volta a `recebido` com o cru.
    const refeito = envelope({
      history: [
        {
          metadata: { phase: 1, chunk_order: 7, progress: 100 },
          threads: [{ id: BRUNO_TEL, messages: [texto("wamid.coex9162.bruno.refeito", BRUNO_TEL, AGORA - 20 * DIA, "Obrigado!")] }],
        },
      ],
    });
    expect(await receberHistoricoDaMeta(db, refeito, opcoes)).toEqual(["historico:lote_recebido"]);
    const [lote] = await pedidosAoWorker();
    expect((await gravarLoteDoHistorico(db, lote!)).status).toBe("gravado");
    const cru = (refeito.entry![0]!.changes![0]!.value as { history: unknown[] }).history[0];
    await pool.query(
      "update public.mia_coexistencia_lotes set estado = 'recebido', payload = $2::jsonb, mensagens = 0 where id = $1",
      [lote, JSON.stringify({ numero_da_empresa: EMPRESA_TEL, item: cru })],
    );
    const r = await gravarLoteDoHistorico(db, lote!);
    expect(r).toMatchObject({ status: "gravado", contagem: { mensagens: 1, existentes: 0 } });
    expect(
      (await linha<{ n: number }>("select count(*)::int as n from public.messages where organization_id = $1 and external_id = 'wamid.coex9162.bruno.refeito'", [ORG])).n,
    ).toBe(1);
    expect((await pedidoDoHistorico()).mensagens_recebidas).toBe(6);
    await pool.query("update public.event_log set status = 'done' where organization_id = $1", [ORG]);
  });
});

describe("a mídia que chega à parte", () => {
  it("liga o arquivo à mensagem do histórico e pede a guarda, uma vez só", async () => {
    expect(await receberHistoricoDaMeta(db, MIDIA_DO_BRUNO, opcoes)).toEqual(["historico:midia_recebida"]);
    const [lote] = await pedidosAoWorker();
    expect((await gravarLoteDoHistorico(db, lote!)).status).toBe("gravado");
    const foto = await linha<{ id: string; type: string; media_url: string; chave: string; marcador: string | null }>(
      `select id, type, media_url, metadata->>'historico_importado' as chave, metadata->>'meta_media_placeholder' as marcador
         from public.messages where organization_id = $1 and external_id = 'wamid.coex9162.bruno.foto'`,
      [ORG],
    );
    expect(foto).toMatchObject({ type: "image", media_url: "meta-media:midia-coex9162-1", chave: "true", marcador: null });
    const { rows } = await pool.query(
      "select event_type from public.event_log where organization_id = $1 and entity_id = $2",
      [ORG, foto.id],
    );
    expect(rows.map((r) => r.event_type)).toEqual(["media.persist_requested"]);
    expect(await receberHistoricoDaMeta(db, MIDIA_DO_BRUNO, opcoes)).toEqual(["historico:lote_repetido"]);
    expect((await pedidoDoHistorico()).midias_guardadas).toBe(1);
    await pool.query("update public.event_log set status = 'done' where organization_id = $1", [ORG]);
  });

  it("a mídia que chega antes da mensagem espera por ela", async () => {
    const adiantada = envelope({
      messages: [{ id: "wamid.coex9162.ainda-nao", from: BRUNO_TEL, timestamp: String(AGORA), type: "image", image: { id: "m2" } }],
    });
    await receberHistoricoDaMeta(db, adiantada, opcoes);
    const [lote] = await pedidosAoWorker();
    expect((await gravarLoteDoHistorico(db, lote!)).status).toBe("esperar");
    await pool.query("update public.event_log set status = 'done' where organization_id = $1", [ORG]);
  });
});

describe("o dono que não compartilha o histórico", () => {
  it("o erro 2593109 fecha o pedido em recusada_pelo_dono, com o código da Meta", async () => {
    const recusa = envelope(
      {
        history: [
          {
            errors: [
              {
                code: 2593109,
                title: "History sync is turned off by the business from the WhatsApp Business App",
              },
            ],
          },
        ],
      },
      NUMERO_RECUSADO,
    );
    expect(await receberHistoricoDaMeta(db, recusa, opcoes)).toEqual(["historico:recusado_pelo_dono"]);
    expect(
      await linha(
        `select s.estado, s.erro_codigo, c.aberta_por
           from public.mia_coexistencia_sincronizacoes s
           join public.mia_coexistencia_conexoes c on c.id = s.conexao_id
          where c.channel_session_id = $1 and s.tipo = 'historico'`,
        [SESSAO_RECUSADA],
      ),
    ).toEqual({ estado: "recusada_pelo_dono", erro_codigo: "2593109", aberta_por: "historico_sem_pedido" });
  });
});

describe("CONTROLE: sem a chave, a mesma mensagem dispara", () => {
  it("a linha SEM historico_importado emite message.received (o 'nenhum evento' acima não é verde à toa)", async () => {
    const { rows } = await pool.query(
      `insert into public.messages
         (organization_id, conversation_id, channel_session_id, contact_id, external_id, type, direction, status, sent_via, body, sent_at, metadata)
       values ($1, $2, $3, $4, 'wamid.coex9162.controle', 'text', 'inbound', 'delivered', 'external_device', 'Controle', now(),
               '{"historico_origem":"coexistencia"}'::jsonb)
       returning id`,
      [ORG, CONVERSA_DA_ANA, SESSAO, ANA],
    );
    const { rows: ev } = await pool.query(
      "select event_type from public.event_log where organization_id = $1 and entity_id = $2",
      [ORG, rows[0].id],
    );
    expect(ev.map((r) => r.event_type)).toContain("message.received");
  });
});
