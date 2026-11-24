/**
 * FORK MIA (.108) · A TRAVA DE ROBÔ, a parte que DECIDE (pura, sem banco e sem LLM).
 *
 * ## O caso (fictício, no formato do real)
 *
 * Uma empresa recebe no WhatsApp as mensagens do ROBÔ de outra. A cada mensagem
 * nossa chega "Olá." e um menu longo terminado em "_Mensagem enviada pela
 * inteligência artificial da Operadora Exemplo_"; de vez em quando, "Eu entendo
 * melhor frases mais curtas...". A IA responde a cada ~30 s, o robô responde de
 * novo, e o laço durou 80 minutos e uns 150 turnos no caso real.
 *
 * `ehRespostaDeRobo` (human-handoff.ts, issue 3106 do upstream) só impede que o
 * menu abra passagem para humano; depois o turno vai ao modelo, que reconhece o
 * robô mas não tem como parar. Este arquivo é o que faltava: dizer, sem modelo,
 * que a conversa virou um laço com outro robô.
 *
 * ## A régua (docs/fork/trava-de-robo.md)
 *
 * Mensagem "de robô" é a RECEBIDA com pelo menos um sinal:
 *
 *   A · autodeclaração de automação ("mensagem enviada pela inteligência
 *       artificial", "sou a assistente virtual", "esta é uma mensagem
 *       automática", "atendimento automático"). A disciplina de
 *       `MARCAS_DE_ROBO`: só a mensagem que fala de SI. Gente reclamando do
 *       NOSSO robô ("cansei de mensagem automática de vocês", "aqui é o bot de
 *       novo?", "não sou um robô") não casa; linha com "?" não conta.
 *   B · repetição: o mesmo texto normalizado já chegou 2 vezes ou mais nas
 *       últimas 2 horas (a 3ª ocorrência conta). Texto curto ("ok", "sim") não
 *       entra: abaixo de `MINIMO_DE_CARACTERES_DA_REPETICAO` é fala de gente.
 *   C · velocidade impossível: 80 caracteres ou mais chegando depois de uma
 *       mensagem nossa a mais de 15 caracteres por segundo.
 *
 * A trava DISPARA quando, numa janela de 15 minutos, chegam 3 mensagens de robô,
 * cada uma DEPOIS de uma resposta da IA: é um GIRO do laço. Várias mensagens do
 * robô depois da mesma resposta da IA ("Olá." e o menu) contam UM giro. A
 * saudação automática única de uma empresa não dispara: é um giro só, e depois
 * dela responde gente.
 *
 * O RITMO DE MÁQUINA (sinal D, MIA-210) pega o robô que varia o texto, responde
 * curto e devagar, e por isso passa por baixo de A, B e C. Um GIRO DE RITMO é a
 * última resposta da IA (o último balão) seguida da PRIMEIRA mensagem recebida
 * depois dela, de TEXTO com corpo e sem saída da equipe no meio; a latência é a
 * diferença dos `created_at`. Dispara quando os últimos 6 giros SEGUIDOS cabem
 * nos 15 minutos da janela, cada latência fica até 60 s e a maior menos a menor
 * fica até 8 s: gente varia o tempo de resposta, o robô responde sempre com o
 * mesmo atraso. Quebram a sequência a recebida que não é texto (áudio, imagem),
 * a latência acima do máximo e a saída que não é da IA. É indício, não
 * autodeclaração: a ação é a do TETO (pausa só a conversa, não perde negócio,
 * não encerra), com o sinal `ritmo` em `sinais`.
 *
 * O TETO é a última proteção: 30 respostas (turnos) da IA na mesma conversa em
 * 60 minutos pausam a IA só ali. A ordem é laço, ritmo, teto.
 *
 * As contas começam depois do último registro da trava na conversa
 * (`desde`): quem devolve a conversa para a IA não a vê travar de novo no giro
 * seguinte por causa dos giros que já foram contados.
 */
import { ehMensagemDeRobo } from "@/lib/agent-engine/agent/human-handoff";

import type { ConfigDaTrava } from "./config";

/** Uma linha de `messages`, com o mínimo que a régua lê. */
export interface MensagemDaTrava {
  id: string;
  direction: "inbound" | "outbound" | string;
  /** `ai` é a resposta da IA; `user`, `crm`, `external_device` são a equipe; `automation`, `system`, o produto. */
  sent_via: string | null;
  type: string | null;
  body: string | null;
  /** O relógio do BANCO, o mesmo dos dois lados da conversa. */
  created_at: string;
  metadata?: unknown;
}

export type SinalDeRobo = "autodeclaracao" | "repeticao" | "velocidade" | "ritmo";

export interface SinaisDaMensagem {
  mensagem_id: string;
  sinais: SinalDeRobo[];
}

export interface AvaliacaoDaTrava {
  /** `robo` = o laço; `teto` = respostas demais ou o ritmo de máquina; `null` = segue. */
  dispara: "robo" | "teto" | null;
  /**
   * O que disparou: `robo` (o laço), `ritmo` (o sinal D, que age como o teto) ou
   * `teto` (respostas demais). Não vai ao banco como motivo: o ritmo grava
   * `motivo = 'teto'` e o sinal `ritmo` em `sinais`.
   */
  gatilho: "robo" | "ritmo" | "teto" | null;
  /** Giros do laço na janela (respostas da IA seguidas de mensagem de robô). */
  mensagens_de_robo: number;
  /** Os sinais de cada mensagem contada, sem texto (só id e o nome do sinal). */
  sinais: SinaisDaMensagem[];
  /** Respostas (turnos) da IA na janela do motivo que disparou (no ritmo, os giros da sequência; quando nada disparou, na janela do robô). */
  respostas_da_ia: number;
  /** Respostas da IA na janela do teto. */
  respostas_no_teto: number;
  /** Da primeira à última mensagem contada do robô; no ritmo, da 1ª resposta da IA da sequência à última recebida; no teto, da primeira à última resposta da IA. */
  duracao_segundos: number;
}

/** Abaixo disto a repetição é fala de gente ("ok", "sim", "obrigado"). */
export const MINIMO_DE_CARACTERES_DA_REPETICAO = 20;

/** Tipo de linha que não é fala de ninguém: não entra em nenhuma conta. */
const FORA_DA_CONTA = new Set(["reaction", "system"]);

// ── normalização ────────────────────────────────────────────────────────────

/** Minúsculas e sem acento; a formatação do WhatsApp (`*`, `_`, `~`) vira espaço. Mantém as linhas. */
export function normalizarParaAutodeclaracao(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/[*_~`]/gu, " ")
    .replace(/[ \t ]+/gu, " ");
}

/** A régua de B: sem acento, sem caixa, sem formatação e sem espaço extra (uma linha só). */
export function normalizarParaRepeticao(texto: string): string {
  return normalizarParaAutodeclaracao(texto).replace(/\s+/gu, " ").trim();
}

// ── sinal A: autodeclaração ─────────────────────────────────────────────────

/** O que vem depois de "mensagem/atendimento automático" que faz a frase falar de VOCÊS, e não de si. */
const DE_VOCES = String.raw`(?:de|da|do|desse|dessa|deste|desta)\s+(?:voces|vcs|voce|vc|vossa)\b`;

/** O nome de quem automatiza, depois de "pela/por". */
const AUTOMACAO = String.raw`(?:inteligencia\s+artificial|ia|assistente\s+(?:virtual|digital|automatic[oa])|robo|bot|chatbot|atendente\s+virtual|atendimento\s+automatico|sistema\s+automatico)`;

/**
 * As frases de AUTODECLARAÇÃO, por linha (normalizada). Lista curta e deliberada,
 * como `MARCAS_DE_ROBO`; o que estas não pegam e aquelas pegam é somado em
 * `ehAutodeclaracaoDeAutomacao`.
 */
const AUTODECLARACOES: readonly RegExp[] = [
  // A assinatura: "_Mensagem enviada pela inteligência artificial da Operadora Exemplo_".
  // No COMEÇO da linha: "a mensagem enviada pelo robô de vocês não ajudou" não é assinatura.
  new RegExp(
    String.raw`^\s*(?:esta\s+|essa\s+)?(?:mensagem|resposta)\s+(?:foi\s+)?(?:enviada|gerada|escrita|respondida)\s+(?:automaticamente\s+)?(?:pela|pelo|por)\s+(?:(?:a|o|um|uma|nossa|nosso|sua|seu)\s+)*${AUTOMACAO}(?!\s+${DE_VOCES})`,
    "u",
  ),
  // "Esta é uma mensagem automática", "esta mensagem é automática", "esta mensagem foi enviada automaticamente".
  /\b(?:esta|essa)\s+(?:e\s+uma\s+)?(?:mensagem|resposta)\s+(?:e\s+|foi\s+)?(?:automatica|(?:enviada|gerada)\s+automaticamente)\b/u,
  // O título "Mensagem automática." / "Mensagem automática da Operadora Exemplo", sozinho no começo da linha.
  new RegExp(
    String.raw`^\s*(?:mensagem|resposta)\s+automatica\b(?!\s+${DE_VOCES})\s*(?:$|[.:!,;(\-–—]|(?:da|do|de)\s+\S)`,
    "u",
  ),
  // "Sou a assistente virtual", "sou o atendente digital", "sou um assistente automático".
  /(?<!\bnao\s)\bsou\s+(?:o|a|um|uma|seu|sua)\s+(?:assistente|atendente)\s+(?:virtual|digital|automatic[oa]|inteligente)\b/u,
  // "Sou a Sofia, assistente virtual da Clínica Exemplo".
  /(?<!\bnao\s)\bsou\s+(?:o|a)\s+[a-z]+\s*,\s*(?:o\s+|a\s+|sua\s+|seu\s+)?(?:assistente|atendente)\s+(?:virtual|digital|inteligente)\b/u,
  // "Sou a inteligência artificial da Operadora Exemplo", "sou a IA da loja".
  /(?<!\bnao\s)\bsou\s+(?:a|o|uma|um|sua|seu)\s+(?:inteligencia\s+artificial|ia)\b/u,
  // "Aqui é a assistente virtual da Clínica Exemplo".
  /\baqui\s+e\s+(?:o|a)\s+(?:assistente|atendente)\s+(?:virtual|digital)\b/u,
  // "Este é um atendimento automático", "este é o nosso atendimento automático".
  /\b(?:este|esse)\s+e\s+(?:um|o\s+nosso|nosso)\s+atendimento\s+automatico\b/u,
  // "O nosso atendimento automático", dito pela própria empresa.
  /\bnosso\s+atendimento\s+automatico\b/u,
  // O título "Atendimento automático" / "Atendimento automático 24h", sozinho no começo da linha.
  new RegExp(
    String.raw`^\s*atendimento\s+automatico\b(?!\s+${DE_VOCES})\s*(?:$|[.:!,;(\-–—]|24|(?:da|do)\s+\S)`,
    "u",
  ),
  // "Você está sendo atendido pelo nosso assistente virtual".
  new RegExp(
    String.raw`\bvoce\s+esta\s+sendo\s+atendid[oa]\s+(?:por|pela|pelo)\s+(?:(?:a|o|um|uma|nossa|nosso)\s+)*${AUTOMACAO}`,
    "u",
  ),
];

/**
 * A mensagem se declara automação? (sinal A)
 *
 * Linha com "?" é pergunta, e pergunta sobre robô é de gente ("isso é um
 * robô?"): fica de fora das frases daqui. As duas marcas do upstream
 * (`ehMensagemDeRobo`) valem como estão.
 */
export function ehAutodeclaracaoDeAutomacao(texto: string | null | undefined): boolean {
  if (!texto || texto.trim() === "") return false;
  if (ehMensagemDeRobo(texto)) return true;
  const linhas = normalizarParaAutodeclaracao(texto)
    .split(/\r?\n|(?<=[.!])\s+/u)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.includes("?"));
  return linhas.some((linha) => AUTODECLARACOES.some((re) => re.test(linha)));
}

// ── a conta ─────────────────────────────────────────────────────────────────

function instante(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.NaN;
}

function ehHistoricoImportado(m: MensagemDaTrava): boolean {
  const meta = m.metadata as Record<string, unknown> | null | undefined;
  return Boolean(meta && typeof meta === "object" && String(meta.historico_importado ?? "") === "true");
}

/** Linha que entra na conta: tem relógio, não é reação nem linha de sistema, não é histórico importado. */
function entraNaConta(m: MensagemDaTrava): boolean {
  if (!Number.isFinite(instante(m.created_at))) return false;
  if (FORA_DA_CONTA.has(m.type ?? "")) return false;
  return !ehHistoricoImportado(m);
}

function ehRespostaDaIa(m: MensagemDaTrava): boolean {
  return m.direction === "outbound" && m.sent_via === "ai";
}

/** Um giro de ritmo: a última resposta da IA e a primeira recebida depois dela. */
interface GiroDeRitmo {
  /** O último balão da resposta da IA. */
  resposta: number;
  /** A primeira recebida depois dele. */
  recebida: number;
  mensagem_id: string;
  latencia_segundos: number;
}

/** O sinal D cabe? Os últimos `ritmo_giros` giros seguidos, na janela, no mesmo atraso. */
function ritmoDeMaquina(sequencia: readonly GiroDeRitmo[], config: ConfigDaTrava, inicio: number): GiroDeRitmo[] | null {
  if (!config.ritmo_ligado || sequencia.length < config.ritmo_giros) return null;
  const ultimos = sequencia.slice(-config.ritmo_giros);
  if (ultimos[0]!.resposta < inicio) return null;
  const latencias = ultimos.map((g) => g.latencia_segundos);
  if (Math.max(...latencias) - Math.min(...latencias) > config.ritmo_variacao_segundos) return null;
  return ultimos;
}

/**
 * Avalia a conversa: a trava de robô dispara, o teto dispara, ou segue?
 *
 * `mensagens` em qualquer ordem (a função ordena pelo relógio do banco).
 * `desde` é o último registro da trava NESTA conversa: o que veio antes dele já
 * foi contado e não conta de novo.
 */
export function avaliarTrava(entrada: {
  mensagens: readonly MensagemDaTrava[];
  config: ConfigDaTrava;
  agora: Date;
  desde: Date | null;
}): AvaliacaoDaTrava {
  const { config } = entrada;
  const agora = entrada.agora.getTime();
  const desde = entrada.desde ? entrada.desde.getTime() : Number.NEGATIVE_INFINITY;
  const inicioDoRobo = Math.max(agora - config.janela_minutos * 60_000, desde);
  const inicioDoTeto = Math.max(agora - config.teto_janela_minutos * 60_000, desde);
  const janelaDaRepeticao = config.repeticao_janela_minutos * 60_000;

  const ordenadas = entrada.mensagens
    .filter(entraNaConta)
    .slice()
    .sort((a, b) => instante(a.created_at) - instante(b.created_at) || a.id.localeCompare(b.id));

  const vistas: Array<{ t: number; texto: string }> = [];
  const girosDoRobo = new Set<string>();
  const sinais: SinaisDaMensagem[] = [];
  const temposDoRobo: number[] = [];
  const iniciosDasRespostas: number[] = [];

  let ultimaSaida: MensagemDaTrava | null = null;
  let anterior: MensagemDaTrava | null = null;
  // O sinal D: a resposta da IA que espera a primeira recebida, e a sequência de giros no ar.
  let giroAberto: number | null = null;
  let sequencia: GiroDeRitmo[] = [];

  for (const m of ordenadas) {
    const t = instante(m.created_at);
    if (m.direction === "outbound") {
      // Uma RESPOSTA da IA é uma sequência de balões da IA sem nada no meio.
      if (ehRespostaDaIa(m) && !(anterior && ehRespostaDaIa(anterior))) iniciosDasRespostas.push(t);
      ultimaSaida = m;
      anterior = m;
      if (ehRespostaDaIa(m)) {
        giroAberto = t;
      } else {
        // A equipe (ou a automação) falou: a sequência do ritmo acaba aqui.
        giroAberto = null;
        sequencia = [];
      }
      continue;
    }
    anterior = m;
    if (m.direction !== "inbound") continue;
    const corpo = (m.body ?? "").trim();

    // Sinal D: só a PRIMEIRA recebida depois da resposta da IA fecha o giro.
    if (giroAberto !== null) {
      const latencia = (t - giroAberto) / 1000;
      const ehTexto = (m.type ?? "text") === "text" && corpo !== "";
      if (ehTexto && latencia <= config.ritmo_latencia_maxima_segundos) {
        sequencia.push({ resposta: giroAberto, recebida: t, mensagem_id: m.id, latencia_segundos: latencia });
      } else {
        sequencia = [];
      }
      giroAberto = null;
    }
    if (corpo === "") continue;

    const achados: SinalDeRobo[] = [];
    if (ehAutodeclaracaoDeAutomacao(corpo)) achados.push("autodeclaracao");

    const texto = normalizarParaRepeticao(corpo);
    if (texto.length >= MINIMO_DE_CARACTERES_DA_REPETICAO) {
      const antes = vistas.filter((v) => v.texto === texto && t - v.t <= janelaDaRepeticao).length;
      if (antes >= config.repeticoes_anteriores) achados.push("repeticao");
    }
    vistas.push({ t, texto });

    if (ultimaSaida && corpo.length >= config.velocidade_minimo_de_caracteres) {
      const segundos = (t - instante(ultimaSaida.created_at)) / 1000;
      if (segundos >= 0 && (segundos === 0 || corpo.length / segundos > config.velocidade_caracteres_por_segundo)) {
        achados.push("velocidade");
      }
    }

    // Conta como GIRO só a mensagem de robô que veio depois de uma resposta da IA,
    // dentro da janela. A da equipe, a automação e a abertura do disparo não contam.
    if (achados.length > 0 && ultimaSaida && ehRespostaDaIa(ultimaSaida) && t >= inicioDoRobo) {
      if (!girosDoRobo.has(ultimaSaida.id)) temposDoRobo.push(t);
      girosDoRobo.add(ultimaSaida.id);
      sinais.push({ mensagem_id: m.id, sinais: achados });
    }
  }

  const respostasNoRobo = iniciosDasRespostas.filter((t) => t >= inicioDoRobo);
  const respostasNoTeto = iniciosDasRespostas.filter((t) => t >= inicioDoTeto);
  const duracao = (tempos: number[]) =>
    tempos.length < 2 ? 0 : Math.max(0, Math.round((Math.max(...tempos) - Math.min(...tempos)) / 1000));

  if (config.ligada && girosDoRobo.size >= config.mensagens_para_disparar) {
    return {
      dispara: "robo",
      gatilho: "robo",
      mensagens_de_robo: girosDoRobo.size,
      sinais,
      respostas_da_ia: respostasNoRobo.length,
      respostas_no_teto: respostasNoTeto.length,
      duracao_segundos: duracao(temposDoRobo),
    };
  }
  const ritmo = config.ligada ? ritmoDeMaquina(sequencia, config, inicioDoRobo) : null;
  if (ritmo) {
    // Cada recebida dos giros ganha o sinal `ritmo`, somado ao que ela já tinha de A, B ou C.
    const comRitmo = sinais.map((s) => ({ mensagem_id: s.mensagem_id, sinais: [...s.sinais] }));
    for (const giro of ritmo) {
      const ja = comRitmo.find((s) => s.mensagem_id === giro.mensagem_id);
      if (ja) ja.sinais.push("ritmo");
      else comRitmo.push({ mensagem_id: giro.mensagem_id, sinais: ["ritmo"] });
    }
    return {
      dispara: "teto",
      gatilho: "ritmo",
      mensagens_de_robo: ritmo.length,
      sinais: comRitmo,
      respostas_da_ia: ritmo.length,
      respostas_no_teto: respostasNoTeto.length,
      duracao_segundos: Math.max(0, Math.round((ritmo[ritmo.length - 1]!.recebida - ritmo[0]!.resposta) / 1000)),
    };
  }
  if (config.ligada && respostasNoTeto.length >= config.teto_respostas) {
    return {
      dispara: "teto",
      gatilho: "teto",
      mensagens_de_robo: girosDoRobo.size,
      sinais,
      respostas_da_ia: respostasNoTeto.length,
      respostas_no_teto: respostasNoTeto.length,
      duracao_segundos: duracao(respostasNoTeto),
    };
  }
  return {
    dispara: null,
    gatilho: null,
    mensagens_de_robo: girosDoRobo.size,
    sinais,
    respostas_da_ia: respostasNoRobo.length,
    respostas_no_teto: respostasNoTeto.length,
    duracao_segundos: duracao(temposDoRobo),
  };
}

/** "em 2 min": nunca menos de 1, arredondado para cima. */
export function minutosDaDuracao(segundos: number): number {
  return Math.max(1, Math.ceil(Math.max(0, segundos) / 60));
}
