/**
 * FORK MIA (.85) — O HORÁRIO DE ATENDIMENTO DA IA.
 *
 * ## A regra, numa frase
 *
 * Dentro do horário a IA está ATIVA e responde. Fora dele está INATIVA: não
 * responde a mensagem que chegou, nem depois, e a conversa fica com a equipe.
 * Não existe troca de turno: ativa ou inativa, só isso.
 *
 * ## Por que não é o `business_hours` do upstream
 *
 * O "Só atender em horário de funcionamento" (`janela-de-atendimento.ts`) é uma
 * faixa só, e ADIA o turno: quem escreve às 11h é respondido na abertura. Para
 * a clínica cuja recepção atende de dia e a IA cobre o resto, isso faria a IA
 * responder às 17h30 quem a recepção já atendeu às 11h. Aqui é o oposto: fora
 * do horário a mensagem é da equipe, e a IA não volta a ela.
 *
 * O arquivo do upstream fica como está (estender, nunca redefinir): quem tem o
 * nosso campo tem o `business_hours` ignorado pelo motor
 * (`temHorarioDaIaDeclarado`, lido em `agent-config.ts`); quem não tem segue o
 * caminho dele.
 *
 * ## O dado
 *
 * Mora em `ai_agent_versions.trigger_config.filters.horario_da_ia` e vale ao
 * PUBLICAR a versão, como o resto do rascunho:
 *
 *     { fuso: "America/Sao_Paulo",
 *       faixas: [ { dias: [1,2,3,4,5], inicio: "00:00", fim: "10:00" },
 *                 { dias: [1,2,3,4,5], inicio: "17:30", fim: "24:00" } ] }
 *
 *   - `dias`: 0 (domingo) a 6 (sábado);
 *   - `inicio` "HH:MM"; nunca "24:00";
 *   - `fim` "HH:MM" ou "24:00" (o fim do dia), sempre depois do início;
 *   - até 6 faixas por dia; faixas que se cruzam no mesmo dia são unidas;
 *   - a faixa que passa da meia-noite NÃO existe no dado: são duas, uma até
 *     24:00 no dia e outra de 00:00 no dia seguinte (a tela oferece "Dividir");
 *   - nenhuma faixa em dia nenhum é recusado na gravação: a IA nunca
 *     responderia. Para parar o agente existe Pausar.
 *
 * ## Falha ABERTA, sempre (a mesma doutrina de `janela-de-atendimento.ts`)
 *
 * `trigger_config` é jsonb livre. Fuso que o `Intl` recusa, hora torta, dia
 * fora de 0 a 6, lista vazia: `lerHorarioDaIa` devolve `null`, e sem horário a
 * IA responde a qualquer hora, como antes. Uma configuração quebrada não pode
 * virar mordaça.
 *
 * ## O relógio
 *
 * A conta é em minutos de relógio de parede no fuso do horário, como a do
 * upstream: uma virada de horário de verão no meio desloca a próxima troca em
 * até 1h, e quem acorda reconfere. O Brasil não tem horário de verão hoje.
 */

/** Até quantas faixas um dia aceita. */
export const MAX_FAIXAS_POR_DIA = 6;
export const MINUTOS_NO_DIA = 1440;
export const MINUTOS_NA_SEMANA = 7 * MINUTOS_NO_DIA;

/** A recusa do horário sem nenhuma faixa: na tela, na rota e no MCP, a mesma frase. */
export const MENSAGEM_SEM_FAIXA =
  "Sem nenhuma faixa a IA nunca responde. Para parar o agente, use Pausar.";

/** O nome do dia na frase, 0 (domingo) a 6 (sábado). */
const NOME_DO_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;

/** Uma faixa como ela é gravada (e como o MCP a recebe). */
export interface FaixaDaIa {
  dias: number[];
  inicio: string;
  fim: string;
}

/** O que mora em `trigger_config.filters.horario_da_ia`. */
export interface HorarioDaIaGravado {
  fuso: string;
  faixas: FaixaDaIa[];
}

/** `[início, fim)` em minutos desde a meia-noite; o fim vai até 1440. */
export type Intervalo = readonly [number, number];

/** Os intervalos de cada dia, 0 (domingo) a 6 (sábado), unidos e em ordem. */
export type GradeDaSemana = ReadonlyArray<ReadonlyArray<Intervalo>>;

/** O horário pronto para o motor: o fuso e a grade da semana. */
export interface HorarioDaIa {
  fuso: string;
  grade: GradeDaSemana;
}

// ---------------------------------------------------------------------------
// horas
// ---------------------------------------------------------------------------

const HORA_RX = /^(\d{2}):(\d{2})$/;

/**
 * "HH:MM" em minutos. `"24:00"` só vale como FIM (1440); como início, e em
 * qualquer outra forma torta, `null`.
 */
export function minutosDaHora(hhmm: unknown, papel: "inicio" | "fim"): number | null {
  if (typeof hhmm !== "string") return null;
  const m = HORA_RX.exec(hhmm.trim());
  if (m === null) return null;
  const horas = Number(m[1]);
  const minutos = Number(m[2]);
  if (minutos > 59) return null;
  if (horas === 24 && minutos === 0) return papel === "fim" ? MINUTOS_NO_DIA : null;
  if (horas > 23) return null;
  return horas * 60 + minutos;
}

/** Minutos em "HH:MM"; 1440 vira "24:00". */
export function horaDosMinutos(minutos: number): string {
  if (minutos >= MINUTOS_NO_DIA) return "24:00";
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// um dia (a régua da tela, faixa por faixa)
// ---------------------------------------------------------------------------

/** O problema de UMA faixa de um dia, com o índice dela na lista do dia. */
export type ProblemaDaFaixa =
  /** Hora fora do formato "HH:MM" (ou "24:00" no início). */
  | { tipo: "formato"; faixa: number }
  /** Começa e termina no mesmo horário. */
  | { tipo: "igual"; faixa: number }
  /** O fim vem antes do início: a faixa passa da meia-noite e precisa ser dividida. */
  | { tipo: "vira_a_meia_noite"; faixa: number; inicio: number; fim: number };

export interface DiaAnalisado {
  /** Os intervalos válidos, unidos e em ordem. */
  intervalos: Intervalo[];
  problemas: ProblemaDaFaixa[];
  /** Duas faixas se cruzavam e viraram uma (a tela avisa). */
  uniu: boolean;
}

/** Une intervalos que se cruzam ou se encostam, em ordem de início. */
export function unirIntervalos(intervalos: readonly Intervalo[]): { intervalos: Intervalo[]; uniu: boolean } {
  const ordenados = [...intervalos].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const juntos: Array<[number, number]> = [];
  let uniu = false;
  for (const [a, b] of ordenados) {
    const ultimo = juntos[juntos.length - 1];
    if (ultimo !== undefined && a <= ultimo[1]) {
      // Encostar (fim == início) é continuidade, não cruzamento: não avisa.
      if (a < ultimo[1]) uniu = true;
      ultimo[1] = Math.max(ultimo[1], b);
    } else {
      juntos.push([a, b]);
    }
  }
  return { intervalos: juntos, uniu };
}

/** As faixas de UM dia, como a tela as tem: texto cru de início e fim. */
export function analisarDia(faixas: ReadonlyArray<{ inicio: string; fim: string }>): DiaAnalisado {
  const validos: Intervalo[] = [];
  const problemas: ProblemaDaFaixa[] = [];
  faixas.forEach((f, i) => {
    const a = minutosDaHora(f.inicio, "inicio");
    const b = minutosDaHora(f.fim, "fim");
    if (a === null || b === null) {
      problemas.push({ tipo: "formato", faixa: i });
      return;
    }
    if (a === b) {
      problemas.push({ tipo: "igual", faixa: i });
      return;
    }
    if (b < a) {
      problemas.push({ tipo: "vira_a_meia_noite", faixa: i, inicio: a, fim: b });
      return;
    }
    validos.push([a, b]);
  });
  const { intervalos, uniu } = unirIntervalos(validos);
  return { intervalos, problemas, uniu };
}

// ---------------------------------------------------------------------------
// o horário inteiro (a régua da gravação: rota, MCP e motor)
// ---------------------------------------------------------------------------

export type ProblemaDoHorario =
  /** Não é `{ fuso, faixas }`. */
  | { tipo: "forma" }
  /** Fuso que o `Intl` recusa. */
  | { tipo: "fuso" }
  /** Uma faixa sem dias, ou com dia fora de 0 a 6. */
  | { tipo: "dias"; faixa: number }
  /** Hora torta, início 24:00, início igual ao fim, ou faixa que passa da meia-noite. */
  | { tipo: "hora"; faixa: number; detalhe: ProblemaDaFaixa["tipo"] }
  /** Mais de 6 faixas num dia. */
  | { tipo: "mais_de_seis"; dia: number }
  /** Nenhuma faixa em dia nenhum. */
  | { tipo: "sem_faixa" };

function fusoUsavel(fuso: unknown): fuso is string {
  if (typeof fuso !== "string" || fuso.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function diasValidos(dias: unknown): number[] | null {
  if (!Array.isArray(dias) || dias.length === 0) return null;
  const lista: number[] = [];
  for (const d of dias) {
    if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 6) return null;
    if (!lista.includes(d)) lista.push(d);
  }
  return lista;
}

/**
 * Tudo o que impede gravar este horário. Lista vazia = pode gravar.
 *
 * É a régua da rota de versões (pelo `refine` do schema), do MCP e do motor
 * (que, achando qualquer problema, lê "sem horário").
 */
export function problemasDoHorario(valor: unknown): ProblemaDoHorario[] {
  if (typeof valor !== "object" || valor === null) return [{ tipo: "forma" }];
  const { fuso, faixas } = valor as { fuso?: unknown; faixas?: unknown };
  if (!Array.isArray(faixas)) return [{ tipo: "forma" }];
  const problemas: ProblemaDoHorario[] = [];
  if (!fusoUsavel(fuso)) problemas.push({ tipo: "fuso" });
  const porDia: number[] = [0, 0, 0, 0, 0, 0, 0];
  faixas.forEach((f: unknown, i) => {
    if (typeof f !== "object" || f === null) {
      problemas.push({ tipo: "forma" });
      return;
    }
    const faixa = f as { dias?: unknown; inicio?: unknown; fim?: unknown };
    const dias = diasValidos(faixa.dias);
    if (dias === null) problemas.push({ tipo: "dias", faixa: i });
    else for (const d of dias) porDia[d] = (porDia[d] ?? 0) + 1;
    const lida = analisarDia([{ inicio: String(faixa.inicio ?? ""), fim: String(faixa.fim ?? "") }]);
    const problema = lida.problemas[0];
    if (problema !== undefined) problemas.push({ tipo: "hora", faixa: i, detalhe: problema.tipo });
  });
  porDia.forEach((n, dia) => {
    if (n > MAX_FAIXAS_POR_DIA) problemas.push({ tipo: "mais_de_seis", dia });
  });
  if (faixas.length === 0) problemas.push({ tipo: "sem_faixa" });
  return problemas;
}

/**
 * A frase de um problema, para quem grava fora da tela (a rota e o MCP). A tela
 * tem as dela, traduzidas, ao lado de cada faixa.
 */
export function fraseDoProblema(p: ProblemaDoHorario): string {
  switch (p.tipo) {
    case "forma":
      return 'O horário da IA é { "fuso": "America/Sao_Paulo", "faixas": [{ "dias": [1,2,3,4,5], "inicio": "08:00", "fim": "18:00" }] }.';
    case "fuso":
      return 'O fuso não existe. Use um fuso como "America/Sao_Paulo".';
    case "dias":
      return `A faixa ${p.faixa + 1} precisa de ao menos um dia, de 0 (domingo) a 6 (sábado).`;
    case "hora":
      if (p.detalhe === "vira_a_meia_noite") {
        return `A faixa ${p.faixa + 1} passa da meia-noite. Divida em duas: uma até "24:00" no dia e outra de "00:00" no dia seguinte.`;
      }
      if (p.detalhe === "igual") return `A faixa ${p.faixa + 1} começa e termina no mesmo horário.`;
      return `A faixa ${p.faixa + 1} usa "HH:MM" de 24 horas; o início vai de "00:00" a "23:59" e o fim pode ser "24:00", o fim do dia.`;
    case "mais_de_seis":
      return `Até ${MAX_FAIXAS_POR_DIA} faixas por dia (${NOME_DO_DIA[p.dia]} tem mais).`;
    case "sem_faixa":
      return MENSAGEM_SEM_FAIXA;
  }
}

/**
 * A grade da semana a partir das faixas gravadas. Faixa torta é PULADA (quem
 * quer a régua inteira chama `problemasDoHorario` antes).
 */
export function gradeDasFaixas(faixas: readonly FaixaDaIa[]): GradeDaSemana {
  const brutos: Intervalo[][] = [[], [], [], [], [], [], []];
  for (const f of faixas) {
    const dias = diasValidos(f.dias);
    const a = minutosDaHora(f.inicio, "inicio");
    const b = minutosDaHora(f.fim, "fim");
    if (dias === null || a === null || b === null || b <= a) continue;
    for (const d of dias) brutos[d]!.push([a, b]);
  }
  return brutos.map((dia) => unirIntervalos(dia).intervalos);
}

/** Segunda primeiro, domingo por último: a ordem em que a semana é lida. */
function ordemDoDia(d: number): number {
  return d === 0 ? 7 : d;
}

/**
 * A grade de volta em faixas, AGRUPADAS: dias com o mesmo intervalo dividem uma
 * faixa. É a forma canônica gravada (tela e MCP gravam igual, e "nada mudou"
 * se compara sem ruído) e a que o MCP devolve.
 */
export function faixasDaGrade(grade: GradeDaSemana): FaixaDaIa[] {
  const grupos = new Map<string, number[]>();
  for (let d = 0; d < 7; d += 1) {
    for (const [a, b] of grade[d] ?? []) {
      const chave = `${horaDosMinutos(a)}|${horaDosMinutos(b)}`;
      const dias = grupos.get(chave) ?? [];
      dias.push(d);
      grupos.set(chave, dias);
    }
  }
  return [...grupos.entries()]
    .map(([chave, dias]) => {
      const [inicio, fim] = chave.split("|") as [string, string];
      return { dias: dias.sort((x, y) => ordemDoDia(x) - ordemDoDia(y)), inicio, fim };
    })
    .sort((x, y) => ordemDoDia(x.dias[0]!) - ordemDoDia(y.dias[0]!) || x.inicio.localeCompare(y.inicio));
}

/** O horário na forma canônica de gravação. Supõe um horário sem problemas. */
export function normalizarHorario(h: HorarioDaIaGravado): HorarioDaIaGravado {
  return { fuso: h.fuso.trim(), faixas: faixasDaGrade(gradeDasFaixas(h.faixas)) };
}

/** Quantos minutos por semana a IA fica ativa. */
export function minutosAtivosNaSemana(grade: GradeDaSemana): number {
  let total = 0;
  for (const dia of grade) for (const [a, b] of dia) total += b - a;
  return total;
}

// ---------------------------------------------------------------------------
// a leitura do motor
// ---------------------------------------------------------------------------

function horarioBruto(triggerConfig: unknown): unknown {
  if (typeof triggerConfig !== "object" || triggerConfig === null) return undefined;
  const filters = (triggerConfig as { filters?: unknown }).filters;
  if (typeof filters !== "object" || filters === null) return undefined;
  return (filters as { horario_da_ia?: unknown }).horario_da_ia;
}

/**
 * A versão DECLARA o horário da IA? Quando sim, o `business_hours` do upstream
 * é ignorado pelo motor, mesmo que o nosso esteja torto (aí a IA responde a
 * qualquer hora: falha aberta, nunca o horário antigo voltando por baixo).
 */
export function temHorarioDaIaDeclarado(triggerConfig: unknown): boolean {
  const bruto = horarioBruto(triggerConfig);
  return typeof bruto === "object" && bruto !== null;
}

/**
 * O horário que o motor obedece, ou `null` (sem horário: a IA responde a
 * qualquer hora). Qualquer problema na régua de gravação também é `null`.
 */
export function lerHorarioDaIa(triggerConfig: unknown): HorarioDaIa | null {
  const bruto = horarioBruto(triggerConfig);
  if (typeof bruto !== "object" || bruto === null) return null;
  if (problemasDoHorario(bruto).length > 0) return null;
  const gravado = bruto as HorarioDaIaGravado;
  const grade = gradeDasFaixas(gravado.faixas);
  if (minutosAtivosNaSemana(grade) === 0) return null;
  return { fuso: gravado.fuso.trim(), grade };
}

/** O horário gravado e válido de um `trigger_config`, na forma canônica; senão `null`. */
export function horarioGravadoDe(triggerConfig: unknown): HorarioDaIaGravado | null {
  const lido = lerHorarioDaIa(triggerConfig);
  return lido === null ? null : { fuso: lido.fuso, faixas: faixasDaGrade(lido.grade) };
}

// ---------------------------------------------------------------------------
// o relógio
// ---------------------------------------------------------------------------

const DIAS_DO_INTL: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Dia da semana e minuto do dia NO FUSO. Lança com fuso inválido. */
export function relogioNoFuso(fuso: string, instante: Date): { dia: number; minutos: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instante);
  const valor = (tipo: Intl.DateTimeFormatPartTypes): string => partes.find((p) => p.type === tipo)?.value ?? "";
  const dia = DIAS_DO_INTL[valor("weekday")] ?? 0;
  // Algumas ICUs escrevem a meia-noite como 24 com hour12:false.
  const hora = Number(valor("hour")) % 24;
  return { dia, minutos: hora * 60 + Number(valor("minute")) };
}

function ativaNoMinutoDaSemana(grade: GradeDaSemana, minutoDaSemana: number): boolean {
  const m = ((minutoDaSemana % MINUTOS_NA_SEMANA) + MINUTOS_NA_SEMANA) % MINUTOS_NA_SEMANA;
  const dia = Math.floor(m / MINUTOS_NO_DIA);
  const minuto = m % MINUTOS_NO_DIA;
  return (grade[dia] ?? []).some(([a, b]) => minuto >= a && minuto < b);
}

/**
 * Quantos minutos depois de `minutoDaSemana` o estado muda, ou `null` quando
 * nunca muda (ativa a semana inteira). Só as bordas das faixas podem mudar o
 * estado; a primeira borda à frente em que o estado é outro é a troca. É o que
 * faz a faixa que termina 24:00 de segunda e a que começa 00:00 de terça
 * contarem como um período só.
 */
function minutosAteATroca(grade: GradeDaSemana, minutoDaSemana: number): number | null {
  const atual = ativaNoMinutoDaSemana(grade, minutoDaSemana);
  const bordas = new Set<number>();
  grade.forEach((dia, d) => {
    for (const [a, b] of dia) {
      bordas.add((d * MINUTOS_NO_DIA + a) % MINUTOS_NA_SEMANA);
      bordas.add((d * MINUTOS_NO_DIA + b) % MINUTOS_NA_SEMANA);
    }
  });
  const distancias = [...bordas]
    .map((borda) => {
      const k = (((borda - minutoDaSemana) % MINUTOS_NA_SEMANA) + MINUTOS_NA_SEMANA) % MINUTOS_NA_SEMANA;
      return k === 0 ? MINUTOS_NA_SEMANA : k;
    })
    .sort((a, b) => a - b);
  for (const k of distancias) {
    if (ativaNoMinutoDaSemana(grade, minutoDaSemana + k) !== atual) return k;
  }
  return null;
}

/** A IA está ativa neste instante? Fuso que o `Intl` recusa = ativa (falha aberta). */
export function ativaEm(horario: HorarioDaIa, instante: Date): boolean {
  try {
    const { dia, minutos } = relogioNoFuso(horario.fuso, instante);
    return ativaNoMinutoDaSemana(horario.grade, dia * MINUTOS_NO_DIA + minutos);
  } catch {
    return true;
  }
}

/** A próxima troca de estado, no fuso do horário. */
export interface TrocaDeEstado {
  /** O instante da troca (início do minuto). */
  em: Date;
  /** O estado DEPOIS da troca: `true` = a IA fica ativa. */
  ativaDepois: boolean;
  /** 0 = hoje, 1 = amanhã… no fuso do horário. */
  diasAdiante: number;
  /** O dia da semana da troca, 0 (domingo) a 6. */
  dia: number;
  /** "HH:MM" da troca. */
  hora: string;
}

/**
 * Quando a IA troca de estado depois de `instante`. `null` = nunca troca
 * (ativa a semana inteira), ou fuso que o `Intl` recusa.
 */
export function proximaTroca(horario: HorarioDaIa, instante: Date): TrocaDeEstado | null {
  let local: { dia: number; minutos: number };
  try {
    local = relogioNoFuso(horario.fuso, instante);
  } catch {
    return null;
  }
  const agora = local.dia * MINUTOS_NO_DIA + local.minutos;
  const k = minutosAteATroca(horario.grade, agora);
  if (k === null) return null;
  // Base no MINUTO cheio, como `inicioDoPeriodoFechado` do upstream: o relógio
  // local conta minutos inteiros.
  const noMinuto = Math.floor(instante.getTime() / 60_000) * 60_000;
  const alvo = (agora + k) % MINUTOS_NA_SEMANA;
  return {
    em: new Date(noMinuto + k * 60_000),
    ativaDepois: !ativaNoMinutoDaSemana(horario.grade, agora),
    diasAdiante: Math.floor((local.minutos + k) / MINUTOS_NO_DIA),
    dia: Math.floor(alvo / MINUTOS_NO_DIA),
    hora: horaDosMinutos(alvo % MINUTOS_NO_DIA),
  };
}

/**
 * `null` = a IA está ativa agora. Senão, o instante em que ela volta. Fuso que
 * o `Intl` recusa também é `null` (falha aberta: quem pergunta, segue).
 */
export function proximaAbertura(horario: HorarioDaIa, instante: Date): Date | null {
  if (ativaEm(horario, instante)) return null;
  return proximaTroca(horario, instante)?.em ?? null;
}

/** "hoje às 17:30", "amanhã às 10:00", "na segunda às 10:00", "no sábado às 08:00". */
export function textoDaTroca(troca: Pick<TrocaDeEstado, "diasAdiante" | "dia" | "hora">): string {
  if (troca.diasAdiante === 0) return `hoje às ${troca.hora}`;
  if (troca.diasAdiante === 1) return `amanhã às ${troca.hora}`;
  const artigo = troca.dia === 0 || troca.dia === 6 ? "no" : "na";
  return `${artigo} ${NOME_DO_DIA[troca.dia]} às ${troca.hora}`;
}

// ---------------------------------------------------------------------------
// a janela de resposta do número (anti-bloqueio, `channel_knobs`)
// ---------------------------------------------------------------------------

/** A janela em que o NÚMERO envia respostas: horas cheias, e se manda no domingo. */
export interface JanelaDeRespostaDoNumero {
  inicioHora: number;
  fimHora: number;
  domingo: boolean;
  /** O fuso em que o número avalia a janela. */
  fuso: string;
}

/**
 * Quantos minutos o relógio do fuso `a` está à frente do de `b` agora. Fuso
 * inválido em qualquer ponta = 0 (sem correção).
 */
function deslocamento(a: string, b: string, instante: Date): number {
  if (a === b) return 0;
  try {
    const la = relogioNoFuso(a, instante);
    const lb = relogioNoFuso(b, instante);
    let d = la.dia * MINUTOS_NO_DIA + la.minutos - (lb.dia * MINUTOS_NO_DIA + lb.minutos);
    if (d > MINUTOS_NA_SEMANA / 2) d -= MINUTOS_NA_SEMANA;
    if (d < -MINUTOS_NA_SEMANA / 2) d += MINUTOS_NA_SEMANA;
    return d;
  } catch {
    return 0;
  }
}

/**
 * A IA fica ativa em algum minuto em que o NÚMERO não envia resposta? É o aviso
 * da tela e do MCP: com a IA ativa de madrugada e o número fechado das 22h às
 * 7h, o que ela escreve às 3h só sai às 7h.
 */
export function horarioForaDaJanelaDeResposta(
  horario: HorarioDaIa,
  janela: JanelaDeRespostaDoNumero,
  instante: Date = new Date(),
): boolean {
  const desloc = deslocamento(horario.fuso, janela.fuso, instante);
  const inicio = janela.inicioHora * 60;
  const fim = janela.fimHora * 60;
  for (let d = 0; d < 7; d += 1) {
    for (const [a, b] of horario.grade[d] ?? []) {
      // Minuto a minuto só nas bordas não basta quando há deslocamento entre
      // fusos; a faixa é curta (no máximo um dia), então conferir cada minuto
      // é barato e não erra.
      for (let m = a; m < b; m += 1) {
        const doNumero = (((d * MINUTOS_NO_DIA + m - desloc) % MINUTOS_NA_SEMANA) + MINUTOS_NA_SEMANA) % MINUTOS_NA_SEMANA;
        const diaDoNumero = Math.floor(doNumero / MINUTOS_NO_DIA);
        const minutoDoNumero = doNumero % MINUTOS_NO_DIA;
        if (!janela.domingo && diaDoNumero === 0) return true;
        if (minutoDoNumero < inicio || minutoDoNumero >= fim) return true;
      }
    }
  }
  return false;
}
