/**
 * FORK MIA (.85) — a GRADE DA SEMANA que a tela do agente edita, e a ida e a
 * volta dela para o horário gravado (`trigger_config.filters.horario_da_ia`).
 *
 * Pura e sem React, para a regra da tela ter teste sem DOM. A régua do dado
 * mora em `lib/agent-engine/agent/horario-da-ia.ts`; aqui fica só o que é da
 * tela: cada dia é "ativa nos horários", "ativa o dia todo" ou "inativa o dia
 * todo", com o texto cru que a pessoa digitou em cada faixa.
 *
 * A ida para o dado é CANÔNICA quando a grade está certa (faixas unidas e
 * agrupadas, a mesma forma do MCP: reabrir e salvar não acusa mudança), e CRUA
 * quando há erro: o schema da versão recusa o cru, e é isso que trava o salvar
 * enquanto houver faixa em vermelho.
 */
import {
  analisarDia,
  gradeDasFaixas,
  horaDosMinutos,
  lerHorarioDaIa,
  MAX_FAIXAS_POR_DIA,
  minutosAtivosNaSemana,
  minutosDaHora,
  MINUTOS_NO_DIA,
  normalizarHorario,
  type FaixaDaIa,
  type HorarioDaIa,
  type HorarioDaIaGravado,
} from "@/lib/agent-engine/agent/horario-da-ia";

export type TipoDoDia = "faixas" | "dia_todo" | "inativa";

export interface FaixaNaTela {
  inicio: string;
  fim: string;
}

export interface DiaNaTela {
  tipo: TipoDoDia;
  faixas: FaixaNaTela[];
}

export interface GradeNaTela {
  /** "sempre" = sem horário (a IA responde a qualquer hora). */
  modo: "sempre" | "horario";
  fuso: string;
  /** Um por dia, 0 (domingo) a 6 (sábado). */
  dias: DiaNaTela[];
}

/** Segunda primeiro: a ordem em que a grade é lida. */
export const ORDEM_DA_SEMANA = [1, 2, 3, 4, 5, 6, 0] as const;

/** A grade com que o modo "Ativa só no horário abaixo" abre na primeira vez. */
export function gradePadrao(fuso: string): GradeNaTela {
  const comercial = (): DiaNaTela => ({ tipo: "faixas", faixas: [{ inicio: "08:00", fim: "18:00" }] });
  const inativa = (): DiaNaTela => ({ tipo: "inativa", faixas: [] });
  return { modo: "horario", fuso, dias: [inativa(), comercial(), comercial(), comercial(), comercial(), comercial(), inativa()] };
}

/** O dado gravado vira a grade da tela. Sem horário, o modo "sempre" com a grade padrão guardada. */
export function gradeDoGravado(gravado: HorarioDaIaGravado | null | undefined, fusoPadrao: string): GradeNaTela {
  if (!gravado || typeof gravado !== "object" || !Array.isArray(gravado.faixas)) {
    return { ...gradePadrao(fusoPadrao), modo: "sempre" };
  }
  const grade = gradeDasFaixas(gravado.faixas);
  return {
    modo: "horario",
    fuso: typeof gravado.fuso === "string" && gravado.fuso.trim() !== "" ? gravado.fuso : fusoPadrao,
    dias: grade.map((intervalos): DiaNaTela => {
      if (intervalos.length === 0) return { tipo: "inativa", faixas: [] };
      const [a, b] = intervalos[0]!;
      if (intervalos.length === 1 && a === 0 && b === MINUTOS_NO_DIA) return { tipo: "dia_todo", faixas: [] };
      return { tipo: "faixas", faixas: intervalos.map(([i, f]) => ({ inicio: horaDosMinutos(i), fim: horaDosMinutos(f) })) };
    }),
  };
}

/** Algum dia tem faixa em vermelho? */
export function temFaixaComErro(grade: GradeNaTela): boolean {
  if (grade.modo === "sempre") return false;
  return grade.dias.some(
    (d) => d.tipo === "faixas" && (d.faixas.length > MAX_FAIXAS_POR_DIA || analisarDia(d.faixas).problemas.length > 0),
  );
}

/** As faixas de cada dia, com o texto como está na tela. */
function faixasCruas(grade: GradeNaTela): FaixaDaIa[] {
  const faixas: FaixaDaIa[] = [];
  grade.dias.forEach((d, dia) => {
    if (d.tipo === "dia_todo") faixas.push({ dias: [dia], inicio: "00:00", fim: "24:00" });
    if (d.tipo === "faixas") for (const f of d.faixas) faixas.push({ dias: [dia], inicio: f.inicio.trim(), fim: f.fim.trim() });
  });
  return faixas;
}

/** Nenhum dia tem faixa válida: a IA nunca responderia (recusado). */
export function semNenhumaFaixa(grade: GradeNaTela): boolean {
  if (grade.modo === "sempre") return false;
  return minutosAtivosNaSemana(gradeDasFaixas(faixasCruas(grade))) === 0;
}

/** A grade vira o dado gravado: canônico quando certa, cru quando há erro (o schema recusa). */
export function gravadoDaGrade(grade: GradeNaTela): HorarioDaIaGravado | null {
  if (grade.modo === "sempre") return null;
  const cru = { fuso: grade.fuso, faixas: faixasCruas(grade) };
  return temFaixaComErro(grade) ? cru : normalizarHorario(cru);
}

/** O horário que o motor leria desta grade, para o estado de agora e o aviso da janela. */
export function horarioDaGrade(grade: GradeNaTela): HorarioDaIa | null {
  if (grade.modo === "sempre" || temFaixaComErro(grade)) return null;
  return lerHorarioDaIa({ filters: { horario_da_ia: gravadoDaGrade(grade) } });
}

/** Minutos ativos por semana (só o que está válido). */
export function minutosAtivosDaGrade(grade: GradeNaTela): number {
  if (grade.modo === "sempre") return 7 * MINUTOS_NO_DIA;
  return minutosAtivosNaSemana(gradeDasFaixas(faixasCruas(grade)));
}

/** Os intervalos válidos e unidos de um dia, para a barra de 24h. */
export function intervalosDoDia(dia: DiaNaTela): Array<readonly [number, number]> {
  if (dia.tipo === "dia_todo") return [[0, MINUTOS_NO_DIA]];
  if (dia.tipo === "inativa") return [];
  return analisarDia(dia.faixas).intervalos;
}

function copiarDia(d: DiaNaTela): DiaNaTela {
  return { tipo: d.tipo, faixas: d.faixas.map((f) => ({ ...f })) };
}

function trocarDia(grade: GradeNaTela, dia: number, novo: DiaNaTela): GradeNaTela {
  return { ...grade, dias: grade.dias.map((d, i) => (i === dia ? novo : d)) };
}

/** A próxima faixa sugerida ao clicar "+ faixa": uma hora depois da última. */
export function proximaFaixaSugerida(faixas: readonly FaixaNaTela[]): FaixaNaTela {
  const ultima = faixas[faixas.length - 1];
  const fim = ultima ? minutosDaHora(ultima.fim, "fim") : null;
  if (fim === null || fim >= 23 * 60) return { inicio: "08:00", fim: "12:00" };
  return { inicio: horaDosMinutos(fim + 60), fim: horaDosMinutos(Math.min(fim + 180, MINUTOS_NO_DIA)) };
}

/** `null` quando o dia já tem as 6 faixas. */
export function acrescentarFaixa(grade: GradeNaTela, dia: number): GradeNaTela | null {
  const atual = grade.dias[dia]!;
  if (atual.faixas.length >= MAX_FAIXAS_POR_DIA) return null;
  return trocarDia(grade, dia, { tipo: "faixas", faixas: [...atual.faixas.map((f) => ({ ...f })), proximaFaixaSugerida(atual.faixas)] });
}

export function tirarFaixa(grade: GradeNaTela, dia: number, indice: number): GradeNaTela {
  const atual = grade.dias[dia]!;
  return trocarDia(grade, dia, { tipo: atual.tipo, faixas: atual.faixas.filter((_, i) => i !== indice).map((f) => ({ ...f })) });
}

export function editarFaixa(grade: GradeNaTela, dia: number, indice: number, ponta: "inicio" | "fim", texto: string): GradeNaTela {
  const atual = grade.dias[dia]!;
  return trocarDia(grade, dia, {
    tipo: atual.tipo,
    faixas: atual.faixas.map((f, i) => (i === indice ? { ...f, [ponta]: texto } : { ...f })),
  });
}

export function trocarTipoDoDia(grade: GradeNaTela, dia: number, tipo: TipoDoDia): GradeNaTela {
  const atual = grade.dias[dia]!;
  const faixas = tipo === "faixas" && atual.faixas.length === 0 ? [{ inicio: "08:00", fim: "18:00" }] : atual.faixas.map((f) => ({ ...f }));
  return trocarDia(grade, dia, { tipo, faixas });
}

/**
 * A faixa que passa da meia-noite vira duas: até 24:00 no dia e de 00:00 no
 * dia seguinte (domingo segue o sábado). O dia seguinte inativo passa a ter só
 * essa faixa; o que já é "o dia todo" fica como está.
 */
export function dividirNaMeiaNoite(grade: GradeNaTela, dia: number, indice: number): GradeNaTela {
  const atual = grade.dias[dia]!;
  const faixa = atual.faixas[indice];
  if (!faixa) return grade;
  const seguinte = (dia + 1) % 7;
  let nova = trocarDia(grade, dia, {
    tipo: atual.tipo,
    faixas: atual.faixas.map((f, i) => (i === indice ? { inicio: f.inicio, fim: "24:00" } : { ...f })),
  });
  const dSeguinte = nova.dias[seguinte]!;
  const madrugada = { inicio: "00:00", fim: faixa.fim };
  if (dSeguinte.tipo === "inativa") nova = trocarDia(nova, seguinte, { tipo: "faixas", faixas: [madrugada] });
  else if (dSeguinte.tipo === "faixas") nova = trocarDia(nova, seguinte, { tipo: "faixas", faixas: [madrugada, ...dSeguinte.faixas.map((f) => ({ ...f }))] });
  return nova;
}

/** "Copiar a segunda para terça a sexta". */
export function copiarSegundaParaASemana(grade: GradeNaTela): GradeNaTela {
  const segunda = grade.dias[1]!;
  return { ...grade, dias: grade.dias.map((d, i) => (i >= 2 && i <= 5 ? copiarDia(segunda) : d)) };
}
