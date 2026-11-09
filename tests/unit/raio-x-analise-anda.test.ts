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
 * Tudo dublado: o banco em memória (com o relógio andando a cada consulta), o
 * leitor, o transcritor e o modelo. Dado fictício.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  process.env.AI_CRED_AES_KEY = "iBc1Z2gYaAH4rEHs1dHQ2dvNQ6t4OfrdE1/Y6OSvtZY=";
  process.env.INTERNAL_SECRET = "segredo-do-teste-do-raio-x";
  return {};
});
void env;

import { PRAZO_DA_CHAMADA_MS } from "@/lib/channels/historico/prazo";
import type { EstadoDaSessao, LeitorDoRaioX } from "@/lib/channels/raio-x/leitor";
import type { ChamarOModelo } from "@/lib/raio-x/analise";
import { rodarOCiclo } from "@/lib/raio-x/ciclo";
import { cifrarReferencia, cifrarTexto } from "@/lib/raio-x/cifra";
import {
  cabeAChamada,
  FOLGA_DEPOIS_DO_PRAZO_MS,
  TETO_DA_CLASSIFICACAO_MS,
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
    whatsapp: "5531900001101",
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

/** N conversas fictícias de um raio-X, cada uma com o cliente perguntando e a loja respondendo; `audios` por conversa, pendentes. */
function conversasDe(rx: string, n: number, audios = 0): Semente {
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
    mensagens.push(
      { id: proximaMensagem++, raio_x_id: rx, conversa_id: id, marca: `m${proximaMensagem}`.padStart(64, "0"), da_loja: false, enviada_em: new Date(em).toISOString(), tipo: "texto", texto: "Ainda tem o carro do anúncio?", segundos: null, midia: null, transcricao: "nao_se_aplica" },
      { id: proximaMensagem++, raio_x_id: rx, conversa_id: id, marca: `m${proximaMensagem}`.padStart(64, "0"), da_loja: true, enviada_em: new Date(em + 4 * MIN).toISOString(), tipo: "texto", texto: "Tem sim! Quer agendar uma visita?", segundos: null, midia: null, transcricao: "nao_se_aplica" },
    );
    for (let a = 0; a < audios; a += 1) {
      mensagens.push({
        id: proximaMensagem++,
        raio_x_id: rx,
        conversa_id: id,
        marca: `a${proximaMensagem}`.padStart(64, "0"),
        da_loja: false,
        enviada_em: new Date(em + (5 + a) * MIN).toISOString(),
        tipo: "audio",
        texto: null,
        segundos: 15,
        midia: cifrarTexto(`false_audio_${rx.slice(-2)}_${i}_${a}`),
        transcricao: "pendente",
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

/** O banco que gasta 30 ms por consulta, como o de verdade (o bastante para fechar o portão da .101). */
function comRelogio(b: ReturnType<typeof banco>, rel: ReturnType<typeof relogio>) {
  return {
    ...b.cliente,
    from: (nome: string) => {
      rel.andar(30);
      return b.cliente.from(nome);
    },
  };
}

function leitorDuble(rel: ReturnType<typeof relogio>, baixar?: LeitorDoRaioX["baixarAudio"]) {
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
    baixarAudio:
      baixar ??
      (async (_s, _c, mensagemId) => {
        pedidos.push(mensagemId);
        rel.andar(500);
        return { bytes: Buffer.from("audio-ficticio"), mime: "audio/ogg" };
      }),
    async desconectar() {},
  };
  return { leitor, pedidos };
}

/** O modelo dublado: 6 s por lote, responde cada conversa pelo id, como o de verdade. */
function modeloDuble(rel: ReturnType<typeof relogio>, ms = 6_000) {
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

function transcritorDuble(rel: ReturnType<typeof relogio>, ms = 2_000) {
  const chamadas: number[] = [];
  return {
    chamadas,
    transcritor: {
      modelo: "whisper-1",
      provider: {
        async transcribe() {
          chamadas.push(rel.agora());
          rel.andar(ms);
          return "quero ver o carro amanhã cedo";
        },
      },
    },
  };
}

const MODELO = { provedor: "openai" as const, modelo: "gpt-6-luna", chave: "chave-de-teste" };

/** Um minuto do cron: a chamada começa em `inicio`, com os 45 s de verdade. */
async function minuto(
  b: ReturnType<typeof banco>,
  rel: ReturnType<typeof relogio>,
  inicio: number,
  dep: { leitor: LeitorDoRaioX; chamar: ChamarOModelo | null; transcritor: ReturnType<typeof transcritorDuble>["transcritor"] | null },
) {
  rel.r.t = inicio;
  return rodarOCiclo({
    admin: comRelogio(b, rel) as never,
    leitor: dep.leitor,
    prazo: inicio + PRAZO_DA_CHAMADA_MS,
    agora: rel.agora,
    modelo: dep.chamar ? MODELO : null,
    chamar: dep.chamar,
    transcritor: dep.transcritor,
  });
}

const situacao = (b: ReturnType<typeof banco>, id: string) => b.db.mia_raio_x!.find((x) => x.id === id)!.situacao;

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
    for (let k = 0; k < 10 && situacao(b, RX_B) !== "pronto"; k += 1) {
      await minuto(b, rel, T0 + k * MIN, { leitor, chamar, transcritor: null });
    }
    expect(pedidos.length).toBeGreaterThan(0);
    expect(situacao(b, RX_B)).toBe("pronto");
    expect(b.db.mia_raio_x_relatorios).toHaveLength(1);
    expect(b.db.mia_raio_x_conversas!.every((c) => c.analise_ciclo === 1 && c.analise !== null)).toBe(true);
  });
});
