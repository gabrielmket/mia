/**
 * FORK MIA (MIA-244) — O PERÍODO DAS LEITURAS QUE CONTAM POR DATA (leads que
 * chegaram, tarefas concluídas), virado em janela no fuso da empresa.
 *
 * É a MESMA régua de `fn_mia_relatorio_janela` e `fn_mia_relatorio_janela_anterior`
 * (migration 9030), escrita em TypeScript porque estas leituras contam direto na
 * tabela, sem o motor: "hoje" é o dia de hoje; "7", "30" e "90" são os últimos N
 * dias contando hoje; "mes" é do dia 1 até hoje; "mesp" é o mês passado inteiro;
 * "pers" vai de `de` a `ate`, os dois incluídos. A janela é semiaberta
 * `[inicio, fim)`. O anterior tem o mesmo tamanho, logo antes ("mes" compara com
 * o mesmo trecho do mês passado).
 *
 * Módulo puro: sem banco.
 */
import { instanteDe, partesNoFuso } from "@/lib/agenda/fuso";
import { fusoUtilizavel } from "@/lib/tempo/fusos";

import type { PeriodoDaPerformance } from "./performance";

export interface JanelaDoPeriodo {
  periodo: PeriodoDaPerformance;
  /** O primeiro dia, AAAA-MM-DD, no fuso da empresa. */
  de: string;
  /** O último dia, incluído. */
  ate: string;
  inicio: Date;
  fim: Date;
  fuso: string;
  dias: number;
}

interface Dia {
  ano: number;
  mes: number;
  dia: number;
}

function diaDeTexto(texto: string): Dia {
  const [ano, mes, dia] = texto.split("-").map(Number);
  return { ano: ano!, mes: mes!, dia: dia! };
}

function somarDias(d: Dia, n: number): Dia {
  const x = new Date(Date.UTC(d.ano, d.mes - 1, d.dia + n));
  return { ano: x.getUTCFullYear(), mes: x.getUTCMonth() + 1, dia: x.getUTCDate() };
}

function texto(d: Dia): string {
  return `${d.ano}-${String(d.mes).padStart(2, "0")}-${String(d.dia).padStart(2, "0")}`;
}

function diasEntre(de: Dia, ate: Dia): number {
  return Math.round((Date.UTC(ate.ano, ate.mes - 1, ate.dia) - Date.UTC(de.ano, de.mes - 1, de.dia)) / 86_400_000);
}

function primeiroDoMes(d: Dia, deslocamento = 0): Dia {
  const x = new Date(Date.UTC(d.ano, d.mes - 1 + deslocamento, 1));
  return { ano: x.getUTCFullYear(), mes: x.getUTCMonth() + 1, dia: 1 };
}

function janela(periodo: PeriodoDaPerformance, de: Dia, ate: Dia, fuso: string): JanelaDoPeriodo {
  return {
    periodo,
    de: texto(de),
    ate: texto(ate),
    inicio: instanteDe({ ano: de.ano, mes: de.mes, dia: de.dia }, fuso),
    fim: instanteDe(somarDias(ate, 1), fuso),
    fuso,
    dias: diasEntre(de, ate) + 1,
  };
}

/** A janela do período pedido (já normalizado por `periodoPedido`). */
export function janelaDoPeriodo(
  pedido: { periodo: PeriodoDaPerformance; de?: string | null; ate?: string | null },
  agora: Date,
  fusoPedido: string | null | undefined,
): JanelaDoPeriodo {
  const fuso = fusoUtilizavel(fusoPedido);
  const p = partesNoFuso(agora, fuso);
  const hoje: Dia = { ano: p.ano, mes: p.mes, dia: p.dia };
  switch (pedido.periodo) {
    case "hoje":
      return janela("hoje", hoje, hoje, fuso);
    case "7":
      return janela("7", somarDias(hoje, -6), hoje, fuso);
    case "30":
      return janela("30", somarDias(hoje, -29), hoje, fuso);
    case "90":
      return janela("90", somarDias(hoje, -89), hoje, fuso);
    case "mes":
      return janela("mes", primeiroDoMes(hoje), hoje, fuso);
    case "mesp":
      return janela("mesp", primeiroDoMes(hoje, -1), somarDias(primeiroDoMes(hoje), -1), fuso);
    case "pers": {
      const a = diaDeTexto(pedido.de ?? pedido.ate ?? texto(hoje));
      const b = diaDeTexto(pedido.ate ?? pedido.de ?? texto(hoje));
      const [de, ate] = diasEntre(a, b) >= 0 ? [a, b] : [b, a];
      return janela("pers", de, ate, fuso);
    }
  }
}

/** O período anterior, de mesmo tamanho, como `fn_mia_relatorio_janela_anterior`. */
export function janelaAnterior(j: JanelaDoPeriodo): JanelaDoPeriodo {
  const de = diaDeTexto(j.de);
  const ate = diaDeTexto(j.ate);
  if (j.periodo === "mes") {
    const inicio = primeiroDoMes(de, -1);
    const fimDoTrecho = somarDias(inicio, diasEntre(de, ate));
    const ultimoDoMesPassado = somarDias(de, -1);
    return janela("pers", inicio, diasEntre(fimDoTrecho, ultimoDoMesPassado) >= 0 ? fimDoTrecho : ultimoDoMesPassado, j.fuso);
  }
  if (j.periodo === "mesp") return janela("pers", primeiroDoMes(de, -1), somarDias(de, -1), j.fuso);
  const fim = somarDias(de, -1);
  return janela("pers", somarDias(fim, -diasEntre(de, ate)), fim, j.fuso);
}
