/**
 * FORK MIA (.101) · O CICLO DO RAIO-X DE PONTA A PONTA, com o LEITOR e o MODELO
 * dublados e as tabelas num banco em memória (lib/raio-x/ciclo.ts, leitura.ts,
 * analise.ts). Nenhum contêiner, nenhuma IA de verdade, dado fictício.
 *
 * O caminho medido: o dono pareou → a sincronia estabiliza → a leitura passa as
 * conversas 1:1 (o grupo fica de fora) e confere → a análise classifica em lote
 * e grava o gasto → o relatório nasce em rascunho, com os prazos de 7 e 30 dias
 * → a conexão cai no prazo → as conversas apagam no prazo, e o relatório fica.
 * E os dois freios: o número conectado que não é o cadastrado não é lido, e o
 * teto de custo para a análise e marca o relatório como parcial.
 */
import { describe, expect, it } from "vitest";

const env = vi.hoisted(() => {
  process.env.AI_CRED_AES_KEY = "iBc1Z2gYaAH4rEHs1dHQ2dvNQ6t4OfrdE1/Y6OSvtZY=";
  process.env.INTERNAL_SECRET = "segredo-do-teste-do-raio-x";
  return {};
});
void env;

import { vi } from "vitest";

import type { ConversaListada, EstadoDaSessao, LeitorDoRaioX, MensagemLida } from "@/lib/channels/raio-x/leitor";
import type { ChamarOModelo } from "@/lib/raio-x/analise";
import { rodarOCiclo } from "@/lib/raio-x/ciclo";
import { bancoEmMemoria, type Linha, type RpcDeMentira } from "@/tests/helpers/banco-em-memoria";

const RX = "e9150e90-2222-4000-8000-0000000000c1";
const T0 = Date.parse("2026-11-04T15:00:00Z");
const MIN = 60_000;
const DIA = 86_400_000;

const CHAT_A = "5531900000002@c.us";
const CHAT_B = "5531900000003@c.us";
const GRUPO = "120363000000000000@g.us";

function msg(id: string, daLoja: boolean, iso: string, texto: string | null, extra: Partial<MensagemLida> = {}): MensagemLida {
  return { id, daLoja, em: Date.parse(iso), tipo: "texto", texto, segundos: null, anuncio: null, nome: daLoja ? null : "Ricardo Exemplo", ...extra };
}

const MENSAGENS: Record<string, MensagemLida[]> = {
  [CHAT_A]: [
    msg("false_A_1", false, "2026-11-01T00:14:00Z", "Boa noite, aqui é o Ricardo. Ainda tem o Polo? Meu número é (31) 90000-1101", {
      anuncio: { titulo: "Polo 2024", origem: "instagram" },
    }),
    msg("true_A_2", true, "2026-11-01T13:02:00Z", "Bom dia! Tem sim. Qual o km do seu carro?"),
    msg("false_A_3", false, "2026-11-01T13:05:00Z", null, { tipo: "audio", segundos: 12 }),
  ],
  [CHAT_B]: [msg("false_B_1", false, "2026-10-30T12:00:00Z", "Vocês financiam sem entrada?")],
};

function leitorDuble(numero: string) {
  const chamadas: string[] = [];
  const lista: ConversaListada[] = [
    { chatId: CHAT_A, ultimaEm: Date.parse("2026-11-01T13:05:00Z"), posicao: 0 },
    { chatId: GRUPO, ultimaEm: T0, posicao: 1 },
    { chatId: CHAT_B, ultimaEm: Date.parse("2026-10-30T12:00:00Z"), posicao: 2 },
  ];
  const leitor: LeitorDoRaioX = {
    async estado(): Promise<EstadoDaSessao> {
      chamadas.push("estado");
      return { estado: "conectado", numero };
    },
    async preparar() {
      return { estado: "conectado", numero };
    },
    async pedirCodigo() {
      return "K7PQ-2M9X";
    },
    async qr() {
      return null;
    },
    async paginaDeConversas(_s, { limit, offset }) {
      chamadas.push(`conversas:${offset}`);
      const bruto = lista.slice(offset, offset + limit);
      return { conversas: bruto.filter((c) => !c.chatId.endsWith("@g.us")), lidas: bruto.length };
    },
    async paginaDeMensagens(_s, chatId, { limit, offset, desde }) {
      chamadas.push(`mensagens:${chatId}:${offset}`);
      const todas = (MENSAGENS[chatId] ?? []).filter((m) => m.em >= desde);
      const pagina = todas.slice(offset, offset + limit);
      return { mensagens: pagina, lidas: pagina.length };
    },
    async baixarAudio() {
      chamadas.push("audio");
      return { bytes: Buffer.from("audio-ficticio"), mime: "audio/ogg" };
    },
    async desconectar() {
      chamadas.push("desconectar");
    },
  };
  return { leitor, chamadas };
}

const rpcConversa: RpcDeMentira = (args, db) => {
  const t = (db.mia_raio_x_conversas ??= []);
  const achada = t.find((c) => c.raio_x_id === args.p_raio_x && c.chat_marca === args.p_marca);
  if (achada) {
    if (args.p_referencia) achada.referencia = args.p_referencia;
    return { data: [{ id: achada.id, numero_ordem: achada.numero_ordem }], error: null };
  }
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

const rpcApagar: RpcDeMentira = (args, db) => {
  const m = (db.mia_raio_x_mensagens ?? []).filter((x) => x.raio_x_id === args.p_raio_x).length;
  const c = (db.mia_raio_x_conversas ?? []).filter((x) => x.raio_x_id === args.p_raio_x).length;
  db.mia_raio_x_mensagens = (db.mia_raio_x_mensagens ?? []).filter((x) => x.raio_x_id !== args.p_raio_x);
  db.mia_raio_x_conversas = (db.mia_raio_x_conversas ?? []).filter((x) => x.raio_x_id !== args.p_raio_x);
  const r = (db.mia_raio_x ?? []).find((x) => x.id === args.p_raio_x);
  if (r) r.conversas_apagadas_em = new Date().toISOString();
  return { data: { mensagens: m, conversas: c }, error: null };
};

function raioX(extra: Partial<Linha> = {}): Linha {
  return {
    id: RX,
    empresa: "Garagem Modelo Veículos",
    segmento: "revenda_de_veiculos",
    whatsapp: "5531900001101",
    responsavel_nome: "Ricardo Exemplo",
    responsavel_contato: null,
    quem_atende: "humano",
    periodo_dias: 90,
    tipo: "unico",
    abre: "08:00:00",
    fecha: "18:00:00",
    sabado_ate: "13:00:00",
    organization_id: null,
    teto_centavos: 4000,
    situacao: "conectando",
    conexao_versao: 1,
    conexao_expira_em: new Date(T0 + DIA).toISOString(),
    sessao: "raiox_e9150e9022224000800000",
    conectado_em: null,
    numero_conectado: null,
    ciclo: 1,
    periodo_inicio: null,
    periodo_fim: null,
    competencia: null,
    leitura: {},
    leitura_concluida_em: null,
    analise: {},
    trava_ate: null,
    ultimo_relatorio_em: null,
    desconectar_em: null,
    desconectado_em: null,
    apagar_conversas_em: null,
    conversas_apagadas_em: null,
    encerrado_em: null,
    criado_por: null,
    criado_via: "tela",
    created_at: new Date(T0 - DIA).toISOString(),
    updated_at: new Date(T0 - DIA).toISOString(),
    ...extra,
  };
}

/** O modelo dublado: responde as conversas do lote pelo id, como o de verdade. */
function modeloDuble() {
  const pedidos: string[] = [];
  const chamar: ChamarOModelo = async ({ texto }) => {
    pedidos.push(texto);
    const ids = [...texto.matchAll(/### Conversa (C\d{4})/g)].map((m) => m[1]!);
    const conversas = ids.map((id) => ({
      id,
      origem: "anuncio_meta",
      assuntos: ["preco"],
      pediu_valor: true,
      recebeu_valor: false,
      desfecho: "pediu_proposta_sem_retorno",
      notas: { responde_o_perguntado: 6, proximo_passo: 3, volta_a_chamar: null, educacao: 8 },
      comentario: "O cliente perguntou e a loja não mandou o valor.",
    }));
    return { texto: JSON.stringify({ conversas }), tokensEntrada: 2000, tokensSaida: 600, cacheLido: 0 };
  };
  return { chamar, pedidos };
}

const MODELO = { provedor: "openai" as const, modelo: "gpt-6-luna", chave: "chave-de-teste" };

async function rodada(banco: ReturnType<typeof bancoEmMemoria>, leitor: LeitorDoRaioX, agora: number, chamar: ChamarOModelo) {
  return rodarOCiclo({
    admin: banco.cliente as never,
    leitor,
    prazo: agora + 10 * MIN,
    agora: () => agora,
    modelo: MODELO,
    chamar,
    transcritor: null,
  });
}

describe("o ciclo do raio-X, de ponta a ponta", () => {
  it("conecta, estabiliza, lê, analisa, gera o relatório e cumpre os prazos", async () => {
    const banco = bancoEmMemoria({ mia_raio_x: [raioX()] }, { fn_mia_raio_x_conversa: rpcConversa, fn_mia_raio_x_expurgar_conversas: rpcApagar });
    const { leitor, chamadas } = leitorDuble("5531900001101");
    const { chamar, pedidos } = modeloDuble();
    const r = () => banco.db.mia_raio_x![0]!;

    // 1. pareou: começa a leitura, esperando a sincronia.
    const um = await rodada(banco, leitor, T0, chamar);
    expect(um.efeitos.map((e) => e.acao)).toEqual(["raio_x.conectado"]);
    expect(r().situacao).toBe("lendo");
    expect((r().leitura as { fase: string }).fase).toBe("sincronizando");

    // 2. um minuto depois: conta as conversas; ainda não estabilizou.
    await rodada(banco, leitor, T0 + MIN, chamar);
    expect((r().leitura as { fase: string; total: number }).fase).toBe("sincronizando");
    expect((r().leitura as { total: number }).total).toBe(2);

    // 3. a conta parou por 5 minutos: lê, confere e conclui.
    const tres = await rodada(banco, leitor, T0 + 7 * MIN, chamar);
    expect(tres.efeitos.map((e) => e.acao)).toContain("raio_x.leitura_concluida");
    expect(r().situacao).toBe("analisando");
    // O grupo nunca é lido.
    expect(chamadas.some((c) => c.includes("@g.us"))).toBe(false);
    expect(banco.db.mia_raio_x_conversas).toHaveLength(2);
    expect(banco.db.mia_raio_x_mensagens).toHaveLength(4);

    // Nada de telefone cru nas tabelas do raio-X.
    const guardado = JSON.stringify([banco.db.mia_raio_x_conversas, banco.db.mia_raio_x_mensagens]);
    expect(guardado).not.toMatch(/90000-?1101|5531900000002|5531900000003/);
    expect(banco.db.mia_raio_x_conversas!.every((c) => /^[0-9a-f]{64}$/.test(String(c.chat_marca)))).toBe(true);
    // O clique no anúncio marcou a conversa.
    expect(banco.db.mia_raio_x_conversas!.find((c) => c.numero_ordem === 1)?.anuncio).toBe(true);

    // 4. analisa: o áudio sem serviço de transcrição é só contado; o modelo classifica; o relatório nasce.
    const quatro = await rodada(banco, leitor, T0 + 8 * MIN, chamar);
    expect(quatro.efeitos.map((e) => e.acao)).toContain("raio_x.relatorio_gerado");
    expect(pedidos).toHaveLength(1);
    // O texto que vai ao modelo não leva o telefone.
    expect(pedidos[0]).not.toMatch(/90000-?1101/);
    expect(banco.db.mia_raio_x_mensagens!.find((m) => m.tipo === "audio")?.transcricao).toBe("sem_servico");
    expect(banco.db.mia_raio_x_gastos).toHaveLength(1);
    expect(banco.db.mia_raio_x_gastos![0]).toMatchObject({ proposito: "raio_x_analise", modelo: "gpt-6-luna", estimado: false });

    expect(r().situacao).toBe("pronto");
    const rel = banco.db.mia_raio_x_relatorios![0]!;
    const dados = rel.dados as { numeros: { conversas: number }; tempo: { semResposta: number }; origem: Array<{ chave: string }> };
    expect(dados.numeros.conversas).toBe(2);
    expect(dados.tempo.semResposta).toBe(1);
    expect(dados.origem[0]?.chave).toBe("anuncio_meta");
    expect(JSON.stringify(rel.dados)).not.toMatch(/90000-?1101|Ricardo/);
    expect(Number(rel.custo_centavos)).toBeGreaterThan(0);
    // Os prazos do diagnóstico único: 7 dias para cair, 30 para apagar.
    expect(Date.parse(String(r().desconectar_em)) - (T0 + 8 * MIN)).toBe(7 * DIA);
    expect(Date.parse(String(r().apagar_conversas_em)) - (T0 + 8 * MIN)).toBe(30 * DIA);

    // 5. sete dias depois: a conexão cai sozinha.
    const cinco = await rodada(banco, leitor, T0 + 8 * MIN + 7 * DIA, chamar);
    expect(cinco.efeitos).toContainEqual({ acao: "raio_x.desconectado", raioXId: RX, motivo: "prazo" });
    expect(chamadas).toContain("desconectar");
    expect(r().desconectado_em).not.toBeNull();

    // 6. trinta dias depois: as conversas apagam; o relatório fica.
    const seis = await rodada(banco, leitor, T0 + 8 * MIN + 30 * DIA, chamar);
    expect(seis.efeitos.map((e) => e.acao)).toContain("raio_x.conversas_apagadas");
    expect(banco.db.mia_raio_x_mensagens).toHaveLength(0);
    expect(banco.db.mia_raio_x_conversas).toHaveLength(0);
    expect(banco.db.mia_raio_x_relatorios).toHaveLength(1);
  });

  it("o número conectado que não é o cadastrado não é lido: a conexão cai e a página avisa", async () => {
    const banco = bancoEmMemoria({ mia_raio_x: [raioX()] }, { fn_mia_raio_x_conversa: rpcConversa });
    const { leitor, chamadas } = leitorDuble("5531900009999");
    const r = await rodada(banco, leitor, T0, modeloDuble().chamar);
    expect(r.efeitos.map((e) => e.acao)).toEqual(["raio_x.numero_diferente"]);
    expect(chamadas).toContain("desconectar");
    expect(chamadas.some((c) => c.startsWith("mensagens"))).toBe(false);
    expect(banco.db.mia_raio_x![0]!.situacao).toBe("conectando");
    expect((banco.db.mia_raio_x![0]!.leitura as { erro: string }).erro).toBe("numero_diferente");
  });

  it("o teto de custo para a análise: nada é chamado, e o relatório sai parcial", async () => {
    const lido = raioX({
      situacao: "analisando",
      teto_centavos: 500,
      conectado_em: new Date(T0).toISOString(),
      periodo_inicio: new Date(T0 - 90 * DIA).toISOString(),
      periodo_fim: new Date(T0).toISOString(),
    });
    const banco = bancoEmMemoria(
      {
        mia_raio_x: [lido],
        // Já gastou R$ 4,9999 deste ciclo: a próxima chamada não cabe no teto de R$ 5.
        mia_raio_x_gastos: [{ raio_x_id: RX, ciclo: 1, proposito: "raio_x_analise", modelo: "gpt-6-luna", custo_usd_centavos: 83, cotacao: 6, custo_centavos: 499.99 }],
      },
      { fn_mia_raio_x_conversa: rpcConversa },
    );
    // Uma conversa lida, com mensagem do cliente no período.
    rpcConversa({ p_raio_x: RX, p_marca: "a".repeat(64), p_referencia: null, p_ultima_em: new Date(T0 - DIA).toISOString() }, banco.db);
    banco.db.mia_raio_x_mensagens = [
      { id: 1, raio_x_id: RX, conversa_id: "conversa-1", marca: "b".repeat(64), da_loja: false, enviada_em: new Date(T0 - DIA).toISOString(), tipo: "texto", texto: "Qual o valor?", transcricao: "nao_se_aplica" },
    ];
    const { leitor } = leitorDuble("5531900001101");
    const { chamar, pedidos } = modeloDuble();
    const r = await rodada(banco, leitor, T0 + MIN, chamar);
    expect(pedidos).toHaveLength(0);
    expect(r.efeitos.map((e) => e.acao)).toContain("raio_x.relatorio_gerado");
    expect(banco.db.mia_raio_x_conversas![0]!.fora_do_teto).toBe(true);
    const rel = banco.db.mia_raio_x_relatorios![0]!;
    expect(rel.parcial).toBe(true);
    expect((rel.dados as { analise: { foraDoTeto: number } }).analise.foraDoTeto).toBe(1);
  });
});
