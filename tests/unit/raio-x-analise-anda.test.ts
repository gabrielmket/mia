/**
 * FORK MIA (.106) · A ANÁLISE DO RAIO-X QUE NÃO ANDA (docs/fork/raio-x-do-atendimento.md, seção 16).
 *
 * Produção, 06/11 a 09/11/2026: dois raio-X pela conexão ficaram três dias em
 * "analisando", com o custo parado depois da transcrição dos áudios. A causa
 * está provada aqui com o RELÓGIO DE VERDADE do cron: a chamada tem 45 s
 * (`PRAZO_DA_CHAMADA_MS`), e a .101 só chamava o modelo com 45 s pela frente.
 * Qualquer milissegundo gasto antes (as leituras do banco, a cotação) bastava
 * para a classificação devolver "parou" antes de chamar o modelo, toda rodada,
 * sem erro e sem custo. Os testes antigos davam 10 minutos de prazo com o
 * relógio parado, e o portão nunca fechava.
 *
 * Também aqui: a exceção que se repete no mesmo item não prende mais (na
 * terceira seguida o item sai do caminho, e o último erro fica gravado), os
 * áudios vão de 4 em 4 com teto de custo do lote, teto de download, teto de
 * transcrição, desistência com 10 downloads falhando seguidos e teto de 30
 * minutos para a fase de áudios, e o rodízio dos que andam.
 *
 * Tudo dublado: o banco em memória (com o relógio andando a cada consulta), o
 * leitor, o transcritor e o modelo. Dado fictício.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  process.env.AI_CRED_AES_KEY = "iBc1Z2gYaAH4rEHs1dHQ2dvNQ6t4OfrdE1/Y6OSvtZY=";
  process.env.INTERNAL_SECRET = "segredo-do-teste-do-raio-x";
  return {};
});
void env;

import { PRAZO_DA_CHAMADA_MS } from "@/lib/channels/historico/prazo";
import type { EstadoDaSessao, LeitorDoRaioX } from "@/lib/channels/raio-x/leitor";
import { mensagemCurtaDoErro, type ChamarOModelo, type UltimoErroDaAnalise } from "@/lib/raio-x/analise";
import { emRodizio, rodarOCiclo } from "@/lib/raio-x/ciclo";
import { cifrarReferencia, cifrarTexto } from "@/lib/raio-x/cifra";
import {
  AUDIOS_EM_PARALELO,
  cabeAChamada,
  FALHAS_DE_DOWNLOAD_PARA_DESISTIR,
  FOLGA_DEPOIS_DO_PRAZO_MS,
  TETO_DA_CLASSIFICACAO_MS,
  TETO_DA_FASE_DE_AUDIOS_MS,
  TETO_DA_TRANSCRICAO_MS,
  TETO_DO_DOWNLOAD_DO_RAIO_X_MS,
} from "@/lib/raio-x/relogio-da-analise";
import { bancoEmMemoria, type Linha } from "@/tests/helpers/banco-em-memoria";

const T0 = Date.parse("2026-11-09T12:00:00Z");
const MIN = 60_000;
const DIA = 86_400_000;
const INICIO = new Date(T0 - 30 * DIA).toISOString();
const FIM = new Date(T0 - 3 * DIA).toISOString();

const RX_A = "e9150e90-1060-4000-8000-0000000000a1";
const RX_B = "e9150e90-1060-4000-8000-0000000000b2";

type Relogio = ReturnType<typeof relogio>;

/** O relógio da chamada: anda 30 ms a cada consulta ao banco e o que os dublês disserem. */
function relogio(inicio = T0) {
  const r = { t: inicio };
  return { r, agora: () => r.t, andar: (ms: number) => (r.t += ms) };
}

function raioX(id: string, extra: Partial<Linha> = {}): Linha {
  return {
    id,
    fonte: "conexao",
    primeira_conversa_em: null,
    empresa: "Loja Fictícia Exemplo",
    segmento: "revenda_de_veiculos",
    whatsapp: id === RX_A ? "5531900001101" : "5531900001102",
    responsavel_nome: "Pessoa Exemplo",
    responsavel_contato: null,
    quem_atende: "humano",
    periodo_dias: 30,
    tipo: "unico",
    abre: "08:00:00",
    fecha: "18:00:00",
    sabado_ate: "13:00:00",
    organization_id: null,
    teto_centavos: 4000,
    situacao: "analisando",
    conexao_versao: 1,
    conexao_expira_em: new Date(T0 - 3 * DIA).toISOString(),
    sessao: `raiox_${id.replace(/-/g, "").slice(0, 24)}`,
    conectado_em: new Date(T0 - 3 * DIA - MIN).toISOString(),
    numero_conectado: "553190001101",
    ciclo: 1,
    periodo_inicio: INICIO,
    periodo_fim: FIM,
    competencia: null,
    leitura: { fase: "concluida", conversas_lidas: 0, mensagens_lidas: 0 },
    leitura_concluida_em: FIM,
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
    created_at: new Date(T0 - 4 * DIA).toISOString(),
    updated_at: new Date(T0 - 3 * DIA).toISOString(),
    ...extra,
  };
}

interface Semente {
  conversas: Linha[];
  mensagens: Linha[];
}

let proximaMensagem = 1;

/**
 * N conversas fictícias de um raio-X, cada uma com o cliente perguntando e a
 * loja respondendo, e `audios` áudios do cliente por conversa (pendentes, ou
 * já transcritos com `transcritos`, como os dois de produção ficaram).
 */
function conversasDe(rx: string, n: number, audios = 0, transcritos = false): Semente {
  const conversas: Linha[] = [];
  const mensagens: Linha[] = [];
  for (let i = 1; i <= n; i += 1) {
    const id = `${rx.slice(-2)}-conversa-${i}`;
    const em = T0 - 10 * DIA + i * MIN;
    conversas.push({
      id,
      raio_x_id: rx,
      chat_marca: `${i}`.padStart(64, "c"),
      referencia: cifrarReferencia({ chatId: `55319000${String(i).padStart(5, "0")}@c.us`, nome: null }),
      numero_ordem: i,
      anuncio: false,
      ultima_em: new Date(em + 5 * MIN).toISOString(),
      analise_ciclo: null,
      analise: null,
      fora_do_teto: false,
    });
    const texto = (daLoja: boolean, quando: number, t: string): Linha => ({
      id: proximaMensagem,
      raio_x_id: rx,
      conversa_id: id,
      marca: `m${proximaMensagem++}`.padStart(64, "0"),
      da_loja: daLoja,
      enviada_em: new Date(quando).toISOString(),
      tipo: "texto",
      texto: t,
      segundos: null,
      midia: null,
      transcricao: "nao_se_aplica",
    });
    mensagens.push(texto(false, em, "Ainda tem o carro do anúncio?"), texto(true, em + 4 * MIN, "Tem sim! Quer agendar uma visita?"));
    for (let a = 0; a < audios; a += 1) {
      mensagens.push({
        id: proximaMensagem,
        raio_x_id: rx,
        conversa_id: id,
        marca: `a${proximaMensagem++}`.padStart(64, "0"),
        da_loja: false,
        enviada_em: new Date(em + (5 + a) * MIN).toISOString(),
        tipo: "audio",
        texto: transcritos ? "posso passar aí amanhã" : null,
        segundos: 15,
        midia: transcritos ? null : cifrarTexto(`false_audio_${rx.slice(-2)}_${i}_${a}`),
        transcricao: transcritos ? "feita" : "pendente",
      });
    }
  }
  return { conversas, mensagens };
}

function banco(raios: Linha[], sementes: Semente[], gastos: Linha[] = []) {
  return bancoEmMemoria({
    mia_raio_x: raios,
    mia_raio_x_conversas: sementes.flatMap((s) => s.conversas),
    mia_raio_x_mensagens: sementes.flatMap((s) => s.mensagens),
    mia_raio_x_gastos: gastos,
    mia_raio_x_relatorios: [],
    platform_fx_rates: [{ dia: "2026-11-09", usd_brl: 5.5 }],
  });
}

type Chamada = [string, unknown[]];
/** Devolve o código do erro que o banco simulado responde, ou null para seguir normal. */
type RegraDeFalha = (tabela: string, chamadas: Chamada[]) => string | null;

/**
 * O cliente que o ciclo recebe: gasta 30 ms por consulta (o bastante para
 * fechar o portão da .101) e, com `regra`, responde erro do banco onde ela
 * mandar, como uma constraint que recusa sempre a mesma linha.
 */
function cliente(b: ReturnType<typeof banco>, rel: Relogio, regra?: RegraDeFalha) {
  const erroSimulado = (codigo: string) => ({ data: null, error: { code: codigo, message: "falha simulada" }, count: null });
  return {
    ...b.cliente,
    from: (tabela: string) => {
      rel.andar(30);
      const real = b.cliente.from(tabela) as Record<string, unknown>;
      if (!regra) return real;
      const chamadas: Chamada[] = [];
      const proxy: Record<string, unknown> = new Proxy(real, {
        get(alvo, prop: string) {
          const v = alvo[prop];
          if (typeof v !== "function") return v;
          const fn = v as (...a: unknown[]) => unknown;
          if (prop === "then") {
            return (ok: (x: unknown) => unknown, falha?: (e: unknown) => unknown) => {
              const codigo = regra(tabela, chamadas);
              return codigo ? Promise.resolve(erroSimulado(codigo)).then(ok, falha) : fn.call(alvo, ok, falha);
            };
          }
          if (prop === "maybeSingle" || prop === "single") {
            return async () => {
              const codigo = regra(tabela, chamadas);
              return codigo ? erroSimulado(codigo) : fn.call(alvo);
            };
          }
          return (...args: unknown[]) => {
            chamadas.push([prop, args]);
            const saida = fn.apply(alvo, args);
            return saida === alvo ? proxy : saida;
          };
        },
      });
      return proxy;
    },
  };
}

function leitorDuble(rel: Relogio, baixar?: LeitorDoRaioX["baixarAudio"]) {
  const pedidos: string[] = [];
  const leitor: LeitorDoRaioX = {
    async estado(): Promise<EstadoDaSessao> {
      return { estado: "conectado", numero: "553190001101" };
    },
    async preparar() {
      return { estado: "conectado", numero: "553190001101" };
    },
    async pedirCodigo() {
      return "K7PQ-2M9X";
    },
    async qr() {
      return null;
    },
    async paginaDeConversas() {
      return { conversas: [], lidas: 0 };
    },
    async paginaDeMensagens() {
      return { mensagens: [], lidas: 0 };
    },
    async baixarAudio(sessao, chatId, mensagemId, tetoMs) {
      pedidos.push(mensagemId);
      if (baixar) return baixar(sessao, chatId, mensagemId, tetoMs);
      rel.andar(500);
      return { bytes: Buffer.from(`audio:${mensagemId}`), mime: "audio/ogg" };
    },
    async desconectar() {},
  };
  return { leitor, pedidos };
}

/** O modelo dublado: `ms` por lote, responde cada conversa pelo id, como o de verdade. */
function modeloDuble(rel: Relogio, ms = 6_000) {
  const pedidos: string[] = [];
  const chamar: ChamarOModelo = async ({ texto }) => {
    pedidos.push(texto);
    rel.andar(ms);
    const ids = [...texto.matchAll(/### Conversa (C\d{4})/g)].map((m) => m[1]!);
    const conversas = ids.map((id) => ({
      id,
      origem: "anuncio_meta",
      assuntos: ["preco"],
      pediu_valor: true,
      recebeu_valor: false,
      desfecho: "pediu_proposta_sem_retorno",
      notas: { responde_o_perguntado: 6, proximo_passo: 3, volta_a_chamar: null, educacao: 8 },
      comentario: "O cliente perguntou e a loja chamou para a visita.",
    }));
    return { texto: JSON.stringify({ conversas }), tokensEntrada: 2000, tokensSaida: 600, cacheLido: 0 };
  };
  return { chamar, pedidos };
}

type Transcritor = { modelo: string; provider: { transcribe: (audio: Buffer, mime: string) => Promise<string> } };

function transcritorDuble(rel: Relogio, responder: (bytes: string) => Promise<string> = async () => "quero ver o carro amanhã cedo", ms = 500) {
  const chamadas: string[] = [];
  const transcritor: Transcritor = {
    modelo: "whisper-1",
    provider: {
      async transcribe(audio) {
        const bytes = audio.toString();
        chamadas.push(bytes);
        rel.andar(ms);
        return responder(bytes);
      },
    },
  };
  return { chamadas, transcritor };
}

const MODELO = { provedor: "openai" as const, modelo: "gpt-6-luna", chave: "chave-de-teste" };

interface Dublês {
  leitor: LeitorDoRaioX;
  chamar: ChamarOModelo | null;
  transcritor: Transcritor | null;
  regra?: RegraDeFalha;
}

/** Um minuto do cron: a chamada começa em `inicio`, com os 45 s de verdade. */
async function minuto(b: ReturnType<typeof banco>, rel: Relogio, inicio: number, dep: Dublês) {
  rel.r.t = inicio;
  return rodarOCiclo({
    admin: cliente(b, rel, dep.regra) as never,
    leitor: dep.leitor,
    prazo: inicio + PRAZO_DA_CHAMADA_MS,
    agora: rel.agora,
    modelo: dep.chamar ? MODELO : null,
    chamar: dep.chamar,
    transcritor: dep.transcritor as never,
  });
}

/** Os minutos do cron até o raio-X ficar pronto (ou acabar `max`). Devolve quantos rodaram. */
async function ateFicarPronto(b: ReturnType<typeof banco>, rel: Relogio, dep: Dublês, ids: string[], max = 20, desde = T0) {
  let k = 0;
  while (k < max && ids.some((id) => situacao(b, id) !== "pronto")) {
    await minuto(b, rel, desde + k * MIN, dep);
    k += 1;
  }
  return k;
}

const linhaDe = (b: ReturnType<typeof banco>, id: string) => b.db.mia_raio_x!.find((x) => x.id === id)!;
const situacao = (b: ReturnType<typeof banco>, id: string) => linhaDe(b, id).situacao;
const analiseDe = (b: ReturnType<typeof banco>, id: string) => linhaDe(b, id).analise as Record<string, unknown>;
const audiosDe = (b: ReturnType<typeof banco>, rx: string) => b.db.mia_raio_x_mensagens!.filter((m) => m.raio_x_id === rx && m.tipo === "audio");
const contar = (lista: Linha[], transcricao: string) => lista.filter((m) => m.transcricao === transcricao).length;

afterEach(() => {
  vi.useRealTimers();
});

describe(".106 · a causa: o portão de 45 s numa chamada de 45 s", () => {
  it("a chamada do modelo cabe com o relógio andando, e termina antes do -m do agendador", () => {
    const crontab = readFileSync(join(process.cwd(), "docker/scheduler/entrypoint.sh"), "utf8");
    const job = /^\* \* \* \* \*\|(\d+)\|api\/v1\/cron\/raio-x$/m.exec(crontab);
    expect(job).not.toBeNull();
    // A chamada mais longa termina no prazo + a folga, e sobram 5 s para gravar antes do corte do curl.
    expect(Number(job![1]) * 1000).toBeGreaterThanOrEqual(PRAZO_DA_CHAMADA_MS + FOLGA_DEPOIS_DO_PRAZO_MS + 5_000);
    const inicio = T0;
    const prazo = inicio + PRAZO_DA_CHAMADA_MS;
    // O portão da .101 (45 s pela frente) fechava com 1 ms gasto; o de agora abre até 15 s gastos.
    expect(prazo - (inicio + 1) >= 45_000).toBe(false);
    expect(cabeAChamada(prazo, inicio + 1, TETO_DA_CLASSIFICACAO_MS)).toBe(true);
    expect(cabeAChamada(prazo, inicio + 15_000, TETO_DA_CLASSIFICACAO_MS)).toBe(true);
    expect(cabeAChamada(prazo, inicio + 15_001, TETO_DA_CLASSIFICACAO_MS)).toBe(false);
    expect(cabeAChamada(prazo, inicio + 15_000, TETO_DO_DOWNLOAD_DO_RAIO_X_MS + TETO_DA_TRANSCRICAO_MS)).toBe(true);
  });

  it("com o relógio de verdade do cron, o modelo é chamado e o relatório sai (na .101, nunca)", async () => {
    const rel = relogio();
    const b = banco([raioX(RX_B)], [conversasDe(RX_B, 9)]);
    const { leitor } = leitorDuble(rel);
    const { chamar, pedidos } = modeloDuble(rel);
    await ateFicarPronto(b, rel, { leitor, chamar, transcritor: null }, [RX_B], 10);
    expect(pedidos.length).toBeGreaterThan(0);
    expect(situacao(b, RX_B)).toBe("pronto");
    expect(b.db.mia_raio_x_relatorios).toHaveLength(1);
    expect(b.db.mia_raio_x_conversas!.every((c) => c.analise_ciclo === 1 && c.analise !== null)).toBe(true);
  });

  it("os dois de produção (295 e 9 conversas, áudios já transcritos e analise vazia) destravam sozinhos", async () => {
    const rel = relogio();
    const gastos: Linha[] = [
      { raio_x_id: RX_A, ciclo: 1, proposito: "raio_x_transcricao", custo_usd_centavos: 41.91, custo_centavos: 230.5, cotacao: 5.5 },
      { raio_x_id: RX_B, ciclo: 1, proposito: "raio_x_transcricao", custo_usd_centavos: 1.05, custo_centavos: 5.78, cotacao: 5.5 },
    ];
    const b = banco(
      [raioX(RX_A, { updated_at: new Date(T0 - 3 * DIA - 1).toISOString() }), raioX(RX_B)],
      [conversasDe(RX_A, 295, 1, true), conversasDe(RX_B, 9, 1, true)],
      gastos,
    );
    const { leitor, pedidos: downloads } = leitorDuble(rel);
    const { chamar } = modeloDuble(rel);
    // Nada a apertar, nada a reconectar: só os minutos do cron.
    let prontoB = 0;
    for (let k = 0; k < 60 && situacao(b, RX_A) !== "pronto"; k += 1) {
      await minuto(b, rel, T0 + k * MIN, { leitor, chamar, transcritor: null });
      if (!prontoB && situacao(b, RX_B) === "pronto") prontoB = k + 1;
    }
    expect(prontoB).toBeGreaterThan(0);
    expect(prontoB).toBeLessThanOrEqual(3);
    expect(situacao(b, RX_A)).toBe("pronto");
    expect(downloads).toHaveLength(0);
    expect(b.db.mia_raio_x_relatorios).toHaveLength(2);
    expect(b.db.mia_raio_x_conversas!.every((c) => c.analise_ciclo === 1 && c.analise !== null)).toBe(true);
  });
});

describe(".106 · a exceção que se repete não prende", () => {
  it("a transcrição que o banco recusa sempre: na 3ª rodada o áudio vira 'falhou' e a análise termina; o último erro fica gravado", async () => {
    const rel = relogio();
    const semente = conversasDe(RX_B, 3);
    semente.mensagens.push({
      id: 9001,
      raio_x_id: RX_B,
      conversa_id: semente.conversas[1]!.id,
      marca: "f".repeat(64),
      da_loja: false,
      enviada_em: new Date(T0 - 9 * DIA).toISOString(),
      tipo: "audio",
      texto: null,
      segundos: 20,
      midia: cifrarTexto("false_audio_que_o_banco_recusa"),
      transcricao: "pendente",
    });
    const b = banco([raioX(RX_B)], [semente]);
    const { leitor } = leitorDuble(rel);
    const { chamar } = modeloDuble(rel);
    const { transcritor, chamadas } = transcritorDuble(rel, async () => "texto que o banco recusa, do cliente Pessoa Exemplo");
    // A constraint de mentira: a linha com esse texto nunca grava.
    const regra: RegraDeFalha = (tabela, ch) =>
      tabela === "mia_raio_x_mensagens" && ch.some(([m, a]) => m === "update" && String((a[0] as Linha).texto ?? "").includes("recusa")) ? "23514" : null;
    const dep = { leitor, chamar, transcritor, regra };

    const um = await minuto(b, rel, T0, dep);
    expect(um.falhas).toBe(1);
    const erro1 = analiseDe(b, RX_B).ultimo_erro as UltimoErroDaAnalise;
    expect(erro1).toMatchObject({ etapa: "transcricao", mensagem: "raio-x: transcrição não gravou (23514)", itens: 1 });
    expect(Date.parse(erro1.quando)).toBeGreaterThanOrEqual(T0);
    expect(JSON.stringify(analiseDe(b, RX_B))).not.toMatch(/Pessoa|cliente|recusa/);
    expect(analiseDe(b, RX_B).falhas_seguidas).toBe(1);
    expect(linhaDe(b, RX_B).trava_ate).toBeNull();

    await minuto(b, rel, T0 + MIN, dep);
    expect(analiseDe(b, RX_B).falhas_seguidas).toBe(2);
    expect(audiosDe(b, RX_B)[0]!.transcricao).toBe("pendente");

    await minuto(b, rel, T0 + 2 * MIN, dep);
    // A terceira seguida no mesmo áudio: ele sai do caminho.
    expect(audiosDe(b, RX_B)[0]).toMatchObject({ transcricao: "falhou", texto: null, midia: null });
    expect(analiseDe(b, RX_B).ultimo_erro).toMatchObject({ etapa: "transcricao", pulou: true });
    expect(analiseDe(b, RX_B).falhas_seguidas).toBe(0);
    expect(chamadas).toHaveLength(3);

    await ateFicarPronto(b, rel, dep, [RX_B], 5, T0 + 3 * MIN);
    expect(situacao(b, RX_B)).toBe("pronto");
    expect(b.db.mia_raio_x_relatorios).toHaveLength(1);
  });

  it("a análise que não grava numa conversa: na 3ª rodada ela vai sem análise e o relatório sai", async () => {
    const rel = relogio();
    const b = banco([raioX(RX_B)], [conversasDe(RX_B, 9)]);
    const { leitor } = leitorDuble(rel);
    const { chamar, pedidos } = modeloDuble(rel);
    const QUARTA = `${RX_B.slice(-2)}-conversa-4`;
    const regra: RegraDeFalha = (tabela, ch) =>
      tabela === "mia_raio_x_conversas" &&
      ch.some(([m, a]) => m === "update" && (a[0] as Linha).analise) &&
      ch.some(([m, a]) => m === "eq" && a[0] === "id" && a[1] === QUARTA)
        ? "22P05"
        : null;
    const dep = { leitor, chamar, transcritor: null, regra };
    const minutos = await ateFicarPronto(b, rel, dep, [RX_B], 10);
    expect(situacao(b, RX_B)).toBe("pronto");
    expect(minutos).toBeLessThanOrEqual(5);
    const quarta = b.db.mia_raio_x_conversas!.find((c) => c.id === QUARTA)!;
    expect(quarta).toMatchObject({ analise: null, analise_ciclo: 1 });
    expect(b.db.mia_raio_x_conversas!.filter((c) => c.id !== QUARTA).every((c) => c.analise !== null)).toBe(true);
    // Três tentativas no lote da quarta e uma no que sobrou depois dela.
    expect(pedidos.length).toBe(4);
  });

  it("o modelo que nunca responde: cada lote tenta três vezes e segue sem análise; o relatório sai", async () => {
    const rel = relogio();
    const b = banco([raioX(RX_B)], [conversasDe(RX_B, 9)]);
    const { leitor } = leitorDuble(rel);
    let tentativas = 0;
    const chamar: ChamarOModelo = async () => {
      tentativas += 1;
      rel.andar(2_000);
      throw Object.assign(new Error("Incorrect API key provided: sk-proj-segredo do cliente Pessoa Exemplo"), { name: "AI_APICallError", statusCode: 401 });
    };
    const dep = { leitor, chamar, transcritor: null };
    await minuto(b, rel, T0, dep);
    expect(analiseDe(b, RX_B).ultimo_erro).toMatchObject({ etapa: "classificacao", mensagem: "AI_APICallError 401", itens: 6 });
    expect(analiseDe(b, RX_B).falhas_seguidas).toBe(1);
    await ateFicarPronto(b, rel, dep, [RX_B], 10, T0 + MIN);
    expect(situacao(b, RX_B)).toBe("pronto");
    expect(tentativas).toBe(6);
    expect(b.db.mia_raio_x_conversas!.every((c) => c.analise === null && c.analise_ciclo === 1)).toBe(true);
    expect(b.db.mia_raio_x_relatorios).toHaveLength(1);
  });

  it("o modelo que falha uma vez e volta: a conta zera e ninguém fica sem análise", async () => {
    const rel = relogio();
    // 30 conversas: o minuto da volta classifica três lotes e ainda não fecha o relatório.
    const b = banco([raioX(RX_B)], [conversasDe(RX_B, 30)]);
    const { leitor } = leitorDuble(rel);
    const bom = modeloDuble(rel);
    let primeira = true;
    const chamar: ChamarOModelo = async (p) => {
      if (primeira) {
        primeira = false;
        throw new Error("sem_resposta");
      }
      return bom.chamar(p);
    };
    const dep = { leitor, chamar, transcritor: null };
    await minuto(b, rel, T0, dep);
    expect(analiseDe(b, RX_B).falhas_seguidas).toBe(1);
    await minuto(b, rel, T0 + MIN, dep);
    expect(analiseDe(b, RX_B).falhas_seguidas).toBe(0);
    await ateFicarPronto(b, rel, dep, [RX_B], 5, T0 + 2 * MIN);
    expect(b.db.mia_raio_x_conversas!.every((c) => c.analise !== null)).toBe(true);
  });

  it("o relatório que falha na comparação: na 3ª rodada sai sem ela", async () => {
    const rel = relogio();
    const b = banco([raioX(RX_B)], [conversasDe(RX_B, 3)]);
    const { leitor } = leitorDuble(rel);
    const { chamar } = modeloDuble(rel);
    const regra: RegraDeFalha = (tabela, ch) =>
      tabela === "mia_raio_x_relatorios" && ch.some(([m, a]) => m === "eq" && a[0] === "situacao" && a[1] === "revisado") ? "57014" : null;
    const dep = { leitor, chamar, transcritor: null, regra };
    await minuto(b, rel, T0, dep);
    expect(analiseDe(b, RX_B).ultimo_erro).toMatchObject({ etapa: "relatorio", mensagem: "raio-x: relatório anterior (57014)" });
    await minuto(b, rel, T0 + MIN, dep);
    await minuto(b, rel, T0 + 2 * MIN, dep);
    expect(analiseDe(b, RX_B).relatorio_sem_comparacao).toBe(true);
    await minuto(b, rel, T0 + 3 * MIN, dep);
    expect(situacao(b, RX_B)).toBe("pronto");
    expect(b.db.mia_raio_x_relatorios![0]).toMatchObject({ comparacao: null, anterior_id: null });
    // O relatório zera o andamento da análise, o último erro junto.
    expect(analiseDe(b, RX_B)).toEqual({});
  });

  it("a mensagem do erro de fora não leva o pedido nem a chave: só o nome e o status", () => {
    expect(mensagemCurtaDoErro(new Error("raio-x: análise não gravou (22P05)"))).toBe("raio-x: análise não gravou (22P05)");
    expect(mensagemCurtaDoErro(new Error("sem_resposta"))).toBe("sem_resposta");
    expect(mensagemCurtaDoErro(new Error("transcription_429"))).toBe("transcription_429");
    const deFora = Object.assign(new Error("Bad request: 'Ainda tem o carro?' de 5531900001101"), { name: "AI_APICallError", statusCode: 400 });
    expect(mensagemCurtaDoErro(deFora)).toBe("AI_APICallError 400");
    expect(mensagemCurtaDoErro(new TypeError("Cannot read properties of null (reading 'texto do cliente')"))).toBe("TypeError");
    expect(mensagemCurtaDoErro("texto solto")).toBe("erro");
  });
});

describe(".106 · os áudios", () => {
  it(`vão ${AUDIOS_EM_PARALELO} em paralelo, e todos andam no mesmo minuto`, async () => {
    const rel = relogio();
    const b = banco([raioX(RX_B)], [conversasDe(RX_B, 9, 1)]);
    const { leitor } = leitorDuble(rel);
    let emCurso = 0;
    let maximo = 0;
    const { transcritor, chamadas } = transcritorDuble(rel, async () => {
      emCurso += 1;
      maximo = Math.max(maximo, emCurso);
      await new Promise((r) => setTimeout(r, 5));
      emCurso -= 1;
      return "quero ver o carro amanhã cedo";
    });
    const { chamar } = modeloDuble(rel);
    await minuto(b, rel, T0, { leitor, chamar, transcritor });
    expect(maximo).toBe(AUDIOS_EM_PARALELO);
    expect(chamadas).toHaveLength(9);
    expect(contar(audiosDe(b, RX_B), "feita")).toBe(9);
    expect(b.db.mia_raio_x_gastos!.filter((g) => g.proposito === "raio_x_transcricao")).toHaveLength(9);
    // O começo da fase de áudios fica gravado (a conta dos 30 minutos), antes do primeiro lote.
    const gravou = b.escritas.find((e) => e.tabela === "mia_raio_x" && e.op === "update" && (e.payload as { analise?: Linha }).analise?.audios_desde);
    const desde = Date.parse(String((gravou!.payload as { analise: Linha }).analise.audios_desde));
    expect(desde).toBeGreaterThanOrEqual(T0);
    expect(desde).toBeLessThan(T0 + PRAZO_DA_CHAMADA_MS);
  });

  it(`com ${FALHAS_DE_DOWNLOAD_PARA_DESISTIR} downloads falhando seguidos, o resto do período vira 'falhou' e a análise segue`, async () => {
    const rel = relogio();
    const b = banco([raioX(RX_B)], [conversasDe(RX_B, 15, 2)]);
    // O áudio antigo que o WhatsApp não entrega mais: 3 s cada, e nada.
    const { leitor, pedidos } = leitorDuble(rel, async () => {
      rel.andar(3_000);
      return null;
    });
    const { transcritor, chamadas } = transcritorDuble(rel);
    const { chamar } = modeloDuble(rel);
    const dep = { leitor, chamar, transcritor };
    await minuto(b, rel, T0, dep);
    // Dois lotes no minuto (8 seguidas), guardadas para a rodada seguinte.
    expect(pedidos).toHaveLength(8);
    expect(analiseDe(b, RX_B).falhas_de_download_seguidas).toBe(8);
    expect(contar(audiosDe(b, RX_B), "pendente")).toBe(22);
    await minuto(b, rel, T0 + MIN, dep);
    expect(pedidos.length).toBeLessThan(FALHAS_DE_DOWNLOAD_PARA_DESISTIR + AUDIOS_EM_PARALELO);
    expect(contar(audiosDe(b, RX_B), "falhou")).toBe(30);
    expect(chamadas).toHaveLength(0);
    await ateFicarPronto(b, rel, dep, [RX_B], 5, T0 + 2 * MIN);
    expect(situacao(b, RX_B)).toBe("pronto");
  });

  it("um download que chega no meio zera a conta: nada é deixado de lado à toa", async () => {
    const rel = relogio();
    const b = banco([raioX(RX_B)], [conversasDe(RX_B, 15, 2)]);
    let n = 0;
    const { leitor } = leitorDuble(rel, async (_s, _c, mensagemId) => {
      n += 1;
      rel.andar(300);
      return n % 5 === 0 ? { bytes: Buffer.from(`audio:${mensagemId}`), mime: "audio/ogg" } : null;
    });
    const { transcritor, chamadas } = transcritorDuble(rel);
    const { chamar } = modeloDuble(rel);
    await ateFicarPronto(b, rel, { leitor, chamar, transcritor }, [RX_B], 10);
    expect(n).toBe(30);
    expect(chamadas).toHaveLength(6);
    expect(contar(audiosDe(b, RX_B), "feita")).toBe(6);
    expect(contar(audiosDe(b, RX_B), "falhou")).toBe(24);
  });

  it("a fase de áudios tem teto de 30 minutos, contado de audios_desde", async () => {
    const rel = relogio();
    const b = banco(
      [raioX(RX_B, { analise: { audios_desde: new Date(T0 - TETO_DA_FASE_DE_AUDIOS_MS).toISOString() } })],
      [conversasDe(RX_B, 5, 1)],
    );
    const { leitor, pedidos } = leitorDuble(rel);
    const { transcritor, chamadas } = transcritorDuble(rel);
    const { chamar } = modeloDuble(rel);
    await minuto(b, rel, T0, { leitor, chamar, transcritor });
    expect(pedidos).toHaveLength(0);
    expect(chamadas).toHaveLength(0);
    expect(contar(audiosDe(b, RX_B), "falhou")).toBe(5);
    expect(situacao(b, RX_B)).toBe("pronto");
  });

  it("o teto de custo vale para o LOTE: entra só o que cabe, o resto fica fora do teto", async () => {
    const rel = relogio();
    // R$ 5 de teto, R$ 4,95 já gastos: cabe um áudio (R$ 0,033 pela estimativa de 1 minuto), não dois.
    const b = banco(
      [raioX(RX_B, { teto_centavos: 500 })],
      [conversasDe(RX_B, 6, 1)],
      [{ raio_x_id: RX_B, ciclo: 1, proposito: "raio_x_transcricao", custo_usd_centavos: 90, custo_centavos: 495, cotacao: 5.5 }],
    );
    const { leitor, pedidos } = leitorDuble(rel);
    const { transcritor, chamadas } = transcritorDuble(rel);
    await minuto(b, rel, T0, { leitor, chamar: null, transcritor });
    expect(pedidos).toHaveLength(1);
    expect(chamadas).toHaveLength(1);
    expect(contar(audiosDe(b, RX_B), "feita")).toBe(1);
    expect(contar(audiosDe(b, RX_B), "fora_do_teto")).toBe(5);
    const gasto = b.db.mia_raio_x_gastos!.reduce((s, g) => s + Number(g.custo_centavos), 0);
    expect(gasto).toBeLessThanOrEqual(500);
  });

  it("a transcrição que não responde corta em 30 s: aquele áudio vira 'falhou', sem custo, e os outros seguem", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const rel = relogio();
    const b = banco([raioX(RX_B)], [conversasDe(RX_B, 4, 1)]);
    const { leitor } = leitorDuble(rel);
    const travado = "false_audio_b2_2_0";
    const { transcritor } = transcritorDuble(rel, (bytes) => (bytes.endsWith(travado) ? new Promise<string>(() => undefined) : Promise.resolve("ok, obrigado")));
    const rodada = minuto(b, rel, T0, { leitor, chamar: null, transcritor });
    await vi.advanceTimersByTimeAsync(TETO_DA_TRANSCRICAO_MS);
    await rodada;
    const audios = audiosDe(b, RX_B);
    expect(audios.find((m) => m.conversa_id === `${RX_B.slice(-2)}-conversa-2`)!.transcricao).toBe("falhou");
    expect(contar(audios, "feita")).toBe(3);
    expect(b.db.mia_raio_x_gastos!.filter((g) => g.proposito === "raio_x_transcricao")).toHaveLength(3);
    expect(situacao(b, RX_B)).toBe("pronto");
  });

  it("o download que não responde corta em 10 s e conta como download que falhou", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const rel = relogio();
    const b = banco([raioX(RX_B)], [conversasDe(RX_B, 1, 1)]);
    const { leitor } = leitorDuble(rel, () => new Promise<{ bytes: Buffer; mime: string } | null>(() => undefined));
    const { transcritor, chamadas } = transcritorDuble(rel);
    const rodada = minuto(b, rel, T0, { leitor, chamar: null, transcritor });
    await vi.advanceTimersByTimeAsync(TETO_DO_DOWNLOAD_DO_RAIO_X_MS);
    await rodada;
    expect(audiosDe(b, RX_B)[0]!.transcricao).toBe("falhou");
    expect(chamadas).toHaveLength(0);
    expect(situacao(b, RX_B)).toBe("pronto");
  });
});

describe(".106 · o rodízio dos que andam", () => {
  it("o ponto de partida gira a cada minuto", () => {
    expect(emRodizio(["a", "b", "c"], 0)).toEqual(["a", "b", "c"]);
    expect(emRodizio(["a", "b", "c"], MIN)).toEqual(["b", "c", "a"]);
    expect(emRodizio(["a", "b", "c"], 2 * MIN + 59_999)).toEqual(["c", "a", "b"]);
    expect(emRodizio(["a", "b", "c"], 3 * MIN)).toEqual(["a", "b", "c"]);
    expect(emRodizio(["a"], 7 * MIN)).toEqual(["a"]);
  });

  it("com o modelo lento, o primeiro da fila não toma todos os minutos: o outro também termina", async () => {
    const rel = relogio();
    // A é o mais velho por updated_at: sem rodízio, ele seria sempre o primeiro.
    const b = banco(
      [raioX(RX_A, { updated_at: new Date(T0 - 5 * DIA).toISOString() }), raioX(RX_B)],
      [conversasDe(RX_A, 60), conversasDe(RX_B, 9)],
    );
    const { leitor } = leitorDuble(rel);
    // 20 s por lote: cada minuto só cabe UMA chamada, a do primeiro da fila.
    const { chamar } = modeloDuble(rel, 20_000);
    const analisadas = (rx: string) => b.db.mia_raio_x_conversas!.filter((c) => c.raio_x_id === rx && c.analise_ciclo === 1).length;
    for (let k = 0; k < 6; k += 1) await minuto(b, rel, T0 + k * MIN, { leitor, chamar, transcritor: null });
    expect(situacao(b, RX_B)).toBe("pronto");
    expect(analisadas(RX_A)).toBeGreaterThan(0);
    expect(situacao(b, RX_A)).toBe("analisando");
  });
});
