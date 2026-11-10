/**
 * FORK MIA (.102) · O CICLO DO RAIO-X DO CLIENTE ATIVO DE PONTA A PONTA, com as
 * tabelas da CONTA e do raio-X num banco em memória, o modelo e o transcritor
 * dublados, e SEM LEITOR (`leitor: null`: a fonte nova não usa o contêiner).
 * Dado fictício: a Garagem Modelo Veículos e a faixa (31) 90000-xxxx.
 *
 * O caminho medido: a Time cria com a fonte "conversas da MIA" (a empresa é
 * ativa, os números são da conta, o período é fixado e limitado à primeira
 * conversa) → o dono autoriza com nome completo e e-mail (termo "cliente
 * ativo" v1) e a leitura começa → a rodada lê `conversations` da conta e deixa
 * de fora grupo, contato pessoal, número interno e quem pediu exclusão → a
 * análise reaproveita a transcrição que a MIA já tinha, transcreve a que
 * faltava, classifica e gera o relatório com quem respondeu, a passagem e o
 * funil → nada é escrito nas tabelas da conta e nenhuma mensagem é enviada.
 * E as recusas: número de outra empresa e empresa que não é cliente ativo.
 */
import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  process.env.AI_CRED_AES_KEY = "iBc1Z2gYaAH4rEHs1dHQ2dvNQ6t4OfrdE1/Y6OSvtZY=";
  process.env.INTERNAL_SECRET = "segredo-do-teste-do-raio-x-102";
  return {};
});
void env;

import { acaoCriar } from "@/lib/raio-x/acoes";
import type { ChamarOModelo } from "@/lib/raio-x/analise";
import { MODELO_PREFERIDO } from "@/lib/raio-x/analise";
import { lerRaioX, registrarAceite } from "@/lib/raio-x/banco";
import { rodarOCiclo } from "@/lib/raio-x/ciclo";
import { MODELO_DA_ESTIMATIVA } from "@/lib/raio-x/custo";
import type { DadosDoRelatorio } from "@/lib/raio-x/relatorio";
import { bancoEmMemoria, type Linha, type RpcDeMentira } from "@/tests/helpers/banco-em-memoria";

const ORG = "e9151e91-0000-4000-8000-00000000000a";
const OUTRA_ORG = "e9151e91-0000-4000-8000-00000000000b";
const ORG_CANCELADA = "e9151e91-0000-4000-8000-00000000000c";
const VENDAS = "e9151e91-5555-4000-8000-000000000101";
const POS_VENDA = "e9151e91-5555-4000-8000-000000000202";
const CANAL_DE_OUTRA = "e9151e91-5555-4000-8000-000000000303";
const T0 = Date.parse("2026-11-05T12:00:00Z");
const iso = (s: string) => new Date(s).toISOString();
const sp = (s: string) => new Date(`${s}-03:00`).toISOString();

// Os contatos: dois clientes, e os quatro que ficam de fora.
const C = {
  ricardo: "e9151e91-cccc-4000-8000-000000000001",
  ana: "e9151e91-cccc-4000-8000-000000000002",
  pessoal: "e9151e91-cccc-4000-8000-000000000003",
  pediuExclusao: "e9151e91-cccc-4000-8000-000000000004",
  grupo: "e9151e91-cccc-4000-8000-000000000005",
  interno: "e9151e91-cccc-4000-8000-000000000006",
  outraOrg: "e9151e91-cccc-4000-8000-000000000007",
};
const V = {
  ricardo: "e9151e91-aaaa-4000-8000-000000000001",
  ana: "e9151e91-aaaa-4000-8000-000000000002",
  pessoal: "e9151e91-aaaa-4000-8000-000000000003",
  pediuExclusao: "e9151e91-aaaa-4000-8000-000000000004",
  grupo: "e9151e91-aaaa-4000-8000-000000000005",
  interno: "e9151e91-aaaa-4000-8000-000000000006",
  outraOrg: "e9151e91-aaaa-4000-8000-000000000007",
};

function contato(id: string, extra: Partial<Linha> = {}): Linha {
  return { id, organization_id: ORG, kind: "person", is_personal: false, is_anonymized: false, phone_number: null, source_metadata: {}, display_name: null, name: null, ...extra };
}

function conversa(id: string, contactId: string, canal: string, extra: Partial<Linha> = {}): Linha {
  return {
    id,
    organization_id: ORG,
    contact_id: contactId,
    channel_session_id: canal,
    is_group: false,
    created_at: iso("2026-10-20T15:00:00Z"),
    last_message_at: iso("2026-11-02T12:00:00Z"),
    last_handoff_at: null,
    ...extra,
  };
}

let seq = 0;
function msg(conversa: string, contactId: string, canal: string, quando: string, direcao: "inbound" | "outbound", sentVia: string, body: string | null, extra: Partial<Linha> = {}): Linha {
  seq += 1;
  return {
    id: `e9151e91-mmmm-4000-8000-${String(seq).padStart(12, "0")}`,
    organization_id: ORG,
    conversation_id: conversa,
    contact_id: contactId,
    channel_session_id: canal,
    direction: direcao,
    sent_via: sentVia,
    type: "text",
    body,
    sent_at: sp(quando),
    media_derived_text: null,
    media_derived_status: null,
    media_storage_path: null,
    media_mime: null,
    revoked_at: null,
    ...extra,
  };
}

function semente() {
  seq = 0;
  const mensagens: Linha[] = [
    // Ricardo, número de Vendas: sábado à noite (loja fechada). A IA responde em 9 s e passa para a equipe;
    // o celular do número só responde 13 h 05 min depois, e o cliente já tinha fechado em outra loja.
    msg(V.ricardo, C.ricardo, VENDAS, "2026-10-31T21:00:00", "inbound", "external_device", "Boa noite, aqui é o Ricardo. Tem como ver o carro amanhã cedo? Quero levar o meu na troca."),
    msg(V.ricardo, C.ricardo, VENDAS, "2026-10-31T21:00:09", "outbound", "ai", "Tem sim! Já passei para um consultor confirmar o horário da visita e a avaliação do seu carro."),
    msg(V.ricardo, C.ricardo, VENDAS, "2026-10-31T21:01:00", "inbound", "external_device", null, {
      type: "audio",
      media_storage_path: `${ORG}/audio-ficticio.ogg`,
      media_mime: "audio/ogg; codecs=opus",
    }),
    msg(V.ricardo, C.ricardo, VENDAS, "2026-11-01T10:05:00", "outbound", "external_device", "Bom dia, conseguimos às 11h?"),
    msg(V.ricardo, C.ricardo, VENDAS, "2026-11-01T10:10:00", "inbound", "external_device", "Deixa, já fechei em outra loja."),
    // Ana, número de Pós-venda (API oficial): terça às 10 h; a equipe responde pela MIA em 14 min.
    msg(V.ana, C.ana, POS_VENDA, "2026-11-03T10:00:00", "inbound", "external_device", "A revisão do meu carro já está pronta?"),
    msg(V.ana, C.ana, POS_VENDA, "2026-11-03T10:01:00", "inbound", "external_device", null, {
      type: "audio",
      media_storage_path: `${ORG}/audio-ja-transcrito.ogg`,
      media_derived_status: "ready",
      media_derived_text: "posso buscar hoje à tarde",
    }),
    msg(V.ana, C.ana, POS_VENDA, "2026-11-03T10:14:00", "outbound", "user", "Está pronta, Ana! Pode buscar até as 18h."),
    // A mensagem APAGADA para todos, com telefone: não entra em nada.
    msg(V.ana, C.ana, POS_VENDA, "2026-11-03T10:15:00", "inbound", "external_device", "meu outro número é (31) 90000-0002", { revoked_at: sp("2026-11-03T10:16:00") }),
    msg(V.ana, C.ana, POS_VENDA, "2026-11-03T10:16:00", "inbound", "external_device", "👍", { type: "reaction" }),
    // Os de fora: pessoal, pediu exclusão, grupo, número interno e outra organização.
    msg(V.pessoal, C.pessoal, VENDAS, "2026-11-02T09:00:00", "inbound", "external_device", "Oi, é a família"),
    msg(V.pediuExclusao, C.pediuExclusao, VENDAS, "2026-11-02T09:00:00", "inbound", "external_device", "Quero saber do financiamento"),
    msg(V.grupo, C.grupo, VENDAS, "2026-11-02T09:00:00", "inbound", "external_device", "Bom dia, grupo"),
    msg(V.interno, C.interno, VENDAS, "2026-11-02T09:00:00", "inbound", "external_device", "RESPONDER 1"),
    { ...msg(V.outraOrg, C.outraOrg, CANAL_DE_OUTRA, "2026-11-02T09:00:00", "inbound", "external_device", "Outra empresa"), organization_id: OUTRA_ORG },
  ];
  return bancoEmMemoria(
    {
      organizations: [
        { id: ORG, display_name: "Garagem Modelo Veículos", legal_name: "Garagem Modelo", created_at: iso("2026-08-18T12:00:00Z"), status: "active", suspended_kind: null, demonstracao: false, onboarding_state: {} },
        { id: OUTRA_ORG, display_name: "Outra Modelo", legal_name: "Outra Modelo", created_at: iso("2026-08-01T12:00:00Z"), status: "active", suspended_kind: null, demonstracao: false, onboarding_state: {} },
        { id: ORG_CANCELADA, display_name: "Cancelada Modelo", legal_name: "Cancelada Modelo", created_at: iso("2026-08-01T12:00:00Z"), status: "active", suspended_kind: null, demonstracao: false, onboarding_state: {} },
      ],
      cobranca_assinaturas: [
        { organization_id: ORG_CANCELADA, estado: "cancelada", trial_ate: null, provedor: "asaas", prazo_extra_ate: null, cancela_no_fim: false },
      ],
      channel_sessions: [
        { id: VENDAS, organization_id: ORG, display_name: "Vendas", phone_number: "+5531900000101", provider: "waha", archived_at: null, created_at: iso("2026-08-18T12:00:00Z") },
        { id: POS_VENDA, organization_id: ORG, display_name: "Pós-venda", phone_number: "+5531900000202", provider: "meta_cloud", archived_at: null, created_at: iso("2026-08-19T12:00:00Z") },
        { id: CANAL_DE_OUTRA, organization_id: OUTRA_ORG, display_name: "Outra", phone_number: "+5531900000303", provider: "waha", archived_at: null, created_at: iso("2026-08-01T12:00:00Z") },
      ],
      contacts: [
        contato(C.ricardo, { display_name: "Ricardo Exemplo", phone_number: "+5531900000002", source_metadata: { ad_source_id: "clique-ficticio" } }),
        contato(C.ana, { display_name: "Ana Exemplo", phone_number: "+5531900000003" }),
        contato(C.pessoal, { is_personal: true, phone_number: "+5531900000004" }),
        contato(C.pediuExclusao, { phone_number: "+5531900000005" }),
        contato(C.grupo, { kind: "whatsapp_group" }),
        contato(C.interno, { phone_number: "+5531900009999" }),
        { ...contato(C.outraOrg, { phone_number: "+5531900000007" }), organization_id: OUTRA_ORG },
      ],
      conversations: [
        conversa(V.ricardo, C.ricardo, VENDAS, { last_message_at: iso("2026-11-01T13:10:00Z") }),
        conversa(V.ana, C.ana, POS_VENDA, { last_message_at: iso("2026-11-03T13:16:00Z"), created_at: iso("2026-10-25T12:00:00Z") }),
        conversa(V.pessoal, C.pessoal, VENDAS),
        conversa(V.pediuExclusao, C.pediuExclusao, VENDAS),
        conversa(V.grupo, C.grupo, VENDAS, { is_group: true }),
        conversa(V.interno, C.interno, VENDAS),
        { ...conversa(V.outraOrg, C.outraOrg, CANAL_DE_OUTRA), organization_id: OUTRA_ORG },
      ],
      messages: mensagens,
      passagens_de_atendimento: [{ organization_id: ORG, conversation_id: V.ricardo, criado_em: sp("2026-10-31T21:00:09"), reconhecido_em: null }],
      crm_leads: [
        { organization_id: ORG, contact_id: C.ricardo, status: "open", created_at: sp("2026-10-31T21:00:10"), closed_at: null },
        { organization_id: ORG, contact_id: C.ana, status: "won", created_at: sp("2026-10-26T10:00:00"), closed_at: sp("2026-11-03T11:00:00") },
      ],
      calendar_appointments: [{ organization_id: ORG, contact_id: C.ana, created_at: sp("2026-11-03T10:20:00") }],
      lgpd_requests: [{ organization_id: ORG, contact_id: C.pediuExclusao, request_type: "redact", status: "received" }],
      config_aviso_de_caso: [{ organization_id: ORG, telefone_destino: "+5531900009999" }],
    },
    { fn_mia_raio_x_conversa: rpcConversa },
  );
}

const rpcConversa: RpcDeMentira = (args, db) => {
  const t = (db.mia_raio_x_conversas ??= []);
  const achada = t.find((c) => c.raio_x_id === args.p_raio_x && c.chat_marca === args.p_marca);
  if (achada) return { data: [{ id: achada.id, numero_ordem: achada.numero_ordem }], error: null };
  const numero = Math.max(0, ...t.filter((c) => c.raio_x_id === args.p_raio_x).map((c) => Number(c.numero_ordem))) + 1;
  const nova: Linha = {
    id: `conversa-${numero}`,
    raio_x_id: args.p_raio_x,
    chat_marca: args.p_marca,
    referencia: args.p_referencia,
    numero_ordem: numero,
    anuncio: false,
    ultima_em: args.p_ultima_em,
    analise_ciclo: null,
    analise: null,
    fora_do_teto: false,
  };
  t.push(nova);
  return { data: [{ id: nova.id, numero_ordem: numero }], error: null };
};

function modeloDuble() {
  const pedidos: string[] = [];
  const chamar: ChamarOModelo = async ({ texto }) => {
    pedidos.push(texto);
    const ids = [...texto.matchAll(/### Conversa (C\d{4})/g)].map((m) => m[1]!);
    const conversas = ids.map((id) => ({
      id,
      origem: "anuncio_meta",
      assuntos: ["visita"],
      pediu_valor: false,
      recebeu_valor: false,
      desfecho: "agendou",
      notas: { responde_o_perguntado: 8, proximo_passo: 7, volta_a_chamar: null, educacao: 9 },
      comentario: "Resposta rápida e chamou para o próximo passo.",
    }));
    return { texto: JSON.stringify({ conversas }), tokensEntrada: 1800, tokensSaida: 500, cacheLido: 0 };
  };
  return { chamar, pedidos };
}

const TRANSCRITOR = {
  provider: { transcribe: async () => "quero ver o carro amanhã cedo" },
  modelo: "whisper-1",
} as never;

async function criarEAutorizar(banco: ReturnType<typeof semente>) {
  const criado = await acaoCriar(
    banco.cliente as never,
    { fonte: "conversas_da_mia", empresa: "Garagem Modelo Veículos", segmento: "revenda_de_veiculos", organization_id: ORG, numeros: [VENDAS, POS_VENDA], periodo_dias: 30 },
    "e9151e91-1111-4000-8000-000000000001",
    "tela",
    new Date(T0),
  );
  if (!criado.ok) throw new Error(`não criou: ${criado.motivo}`);
  // O banco em memória não aplica os DEFAULT da tabela: os que o ciclo lê vão à mão.
  const linha = banco.db.mia_raio_x!.find((r) => r.id === criado.id)!;
  Object.assign(linha, { situacao: "aguardando", ciclo: 1, leitura: {}, analise: {}, trava_ate: null, updated_at: iso("2026-11-05T12:00:00Z"), created_at: iso("2026-11-05T12:00:00Z") });
  const r = await lerRaioX(banco.cliente as never, criado.id);
  await registrarAceite(banco.cliente as never, r!, { nome: "Dono Modelo da Silva", email: "dono@garagemmodelo.com.br" });
  return { criado, linha };
}

async function rodada(banco: ReturnType<typeof semente>, agora: number, chamar: ChamarOModelo) {
  return rodarOCiclo({
    admin: banco.cliente as never,
    leitor: null,
    prazo: agora + 10 * 60_000,
    agora: () => agora,
    modelo: { provedor: "openai", modelo: MODELO_PREFERIDO, chave: "chave-de-teste" },
    chamar,
    transcritor: TRANSCRITOR,
    baixarDaConta: async () => ({ bytes: Buffer.from("audio-ficticio"), mime: "audio/ogg" }),
  });
}

describe("o raio-X do cliente ativo, de ponta a ponta", () => {
  it("cria, autoriza, lê a conta sem leitor, analisa e gera o relatório com quem respondeu, a passagem e o funil", async () => {
    const banco = semente();
    const { criado, linha } = await criarEAutorizar(banco);
    expect(criado.fonte).toBe("conversas_da_mia");
    // O período: os 30 dias inteiros antes de hoje, limitado à primeira conversa (20/10).
    expect([linha.periodo_inicio, linha.periodo_fim]).toEqual(["2026-10-20T03:00:00.000Z", "2026-11-05T03:00:00.000Z"]);
    // O WhatsApp do raio-X é o telefone COMERCIAL do primeiro número (a chave de "mesma empresa").
    expect(linha.whatsapp).toBe("5531900000101");
    expect(banco.db.mia_raio_x_numeros!.map((n) => [n.rotulo, n.telefone, n.oficial])).toEqual([
      ["Vendas", "5531900000101", false],
      ["Pós-venda", "5531900000202", true],
    ]);

    // O aceite: nome completo, e-mail e o termo "cliente ativo" v1 inteiro; a leitura começou.
    const aceite = banco.db.mia_raio_x_aceites![0]!;
    expect(aceite).toMatchObject({ nome: "Dono Modelo da Silva", email: "dono@garagemmodelo.com.br", termo_versao: "cliente_ativo_v1" });
    expect(String(aceite.termo_texto)).toContain("dos números Vendas e Pós-venda já registradas na MIA, de 20/10 a 04/11, só para medir");
    expect(linha.situacao).toBe("lendo");
    expect(linha.sessao ?? null).toBeNull();

    // 1. A leitura da conta: só as duas conversas de cliente; os de fora ficam de fora.
    const { chamar, pedidos } = modeloDuble();
    const um = await rodada(banco, T0 + 60_000, chamar);
    expect(um.efeitos).toContainEqual(expect.objectContaining({ acao: "raio_x.leitura_concluida", conversas: 2 }));
    expect(linha.situacao).toBe("analisando");
    expect(banco.db.mia_raio_x_conversas).toHaveLength(2);
    expect((linha.leitura as { fora: number }).fora).toBe(4);
    // A conversa do raio-X não guarda texto nem o id cru da conversa da conta.
    const guardado = JSON.stringify(banco.db.mia_raio_x_conversas);
    expect(guardado).not.toContain(V.ricardo);
    expect(guardado).not.toMatch(/Ricardo|carro/);
    // O clique no anúncio que a conta estampou no contato marcou a conversa.
    expect(banco.db.mia_raio_x_conversas!.find((c) => c.numero_ordem === 1)?.anuncio).toBe(true);

    // 2. A análise: o áudio que a MIA já tinha transcrito é reaproveitado; o outro é transcrito
    //    ANTES da classificação (o pedido ao modelo leva a transcrição), e o relatório sai.
    //    FORK MIA (.106): na mesma rodada; a transcrição que acaba os pendentes segue direto
    //    para a classificação, sem esperar o minuto seguinte.
    const dois = await rodada(banco, T0 + 2 * 60_000, chamar);
    expect(dois.efeitos.map((e) => e.acao)).toContain("raio_x.relatorio_gerado");
    const audios = banco.db.mia_raio_x_mensagens ?? [];
    expect(audios).toHaveLength(1);
    expect(audios[0]).toMatchObject({ tipo: "audio", transcricao: "feita", texto: "quero ver o carro amanhã cedo" });
    expect(banco.db.mia_raio_x_gastos!.map((g) => g.proposito).sort()).toEqual(["raio_x_analise", "raio_x_transcricao"]);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toContain("posso buscar hoje à tarde");
    expect(pedidos[0]).toContain("(áudio) quero ver o carro amanhã cedo");
    // A apagada e a reação não entram; o telefone nunca vai ao modelo.
    expect(pedidos[0]).not.toMatch(/outro número|90000|👍/);

    expect(linha.situacao).toBe("pronto");
    // O cliente ativo não tem conexão para cair; as transcrições apagam em 30 dias.
    expect(linha.desconectar_em ?? null).toBeNull();
    expect(Date.parse(String(linha.apagar_conversas_em)) - (T0 + 2 * 60_000)).toBe(30 * 86_400_000);

    const dados = banco.db.mia_raio_x_relatorios![0]!.dados as DadosDoRelatorio;
    expect(dados.fonte).toBe("conversas_da_mia");
    expect(dados.numeros.conversas).toBe(2);
    const bloco = dados.clienteAtivo!;
    expect(bloco.numeros).toEqual([
      { rotulo: "Vendas", oficial: false },
      { rotulo: "Pós-venda", oficial: true },
    ]);
    expect(bloco.quemRespondeu.linhas).toEqual([
      { quem: "ia", conversas: 1, medianaSeg: 9, foraDoHorario: 1 },
      { quem: "equipe", conversas: 1, medianaSeg: 14 * 60, foraDoHorario: 0 },
    ]);
    // A passagem de sábado à noite: o celular só assumiu 13 h 05 min depois (mais de 2 h).
    expect(bloco.passagem.conversas).toBe(1);
    expect(bloco.passagem.faixas.mais_de_2_h).toBe(1);
    expect(bloco.passagem.medianaComALojaFechadaMin).toBeCloseTo(13 * 60 + 5, 0);
    expect(bloco.funil).toMatchObject({ passadas: 1, negocio: 1, visita: 0, venda: 0, lentas: 1, lentasComVisita: 0 });
    expect(bloco.funil.todas).toEqual({ conversas: 2, negocio: 2, visita: 1, venda: 1 });
    expect(bloco.ondeGanhar.map((o) => o.codigo)).toContain("passagem_lenta");
    expect(bloco.trechoDaPassagem?.esperaMin).toBe(13 * 60 + 5);
    expect(dados.indicadores.medianaEsperaDaPassagemMin).toBeCloseTo(13 * 60 + 5, 0);
    // Anonimizado: nem o nome do cliente nem telefone no relatório guardado.
    expect(JSON.stringify(dados)).not.toMatch(/Ricardo|Ana Exemplo|90000/);

    // Nada escrito nas tabelas da CONTA, e nenhuma mensagem nova.
    const tabelasEscritas = [...new Set(banco.escritas.map((e) => e.tabela))];
    expect(tabelasEscritas.every((t) => t.startsWith("mia_raio_x"))).toBe(true);
    expect(banco.db.messages!.filter((m) => m.direction === "outbound")).toHaveLength(3);
  });

  it("recusa número de outra empresa e empresa que não é cliente ativo", async () => {
    const banco = semente();
    const deOutra = await acaoCriar(
      banco.cliente as never,
      { fonte: "conversas_da_mia", empresa: "Garagem Modelo Veículos", segmento: "outro", organization_id: ORG, numeros: [CANAL_DE_OUTRA] },
      null,
      "mcp_plataforma",
      new Date(T0),
    );
    expect(deOutra).toMatchObject({ ok: false, motivo: "numero_de_outra_empresa" });
    const cancelada = await acaoCriar(
      banco.cliente as never,
      { fonte: "conversas_da_mia", empresa: "Cancelada Modelo", segmento: "outro", organization_id: ORG_CANCELADA, numeros: [VENDAS] },
      null,
      "tela",
      new Date(T0),
    );
    expect(cancelada).toMatchObject({ ok: false, motivo: "empresa_nao_ativa" });
    expect(banco.db.mia_raio_x ?? []).toHaveLength(0);
  });

  it("a estimativa usa o mesmo modelo da análise", () => {
    expect(MODELO_DA_ESTIMATIVA).toBe(MODELO_PREFERIDO);
  });
});
