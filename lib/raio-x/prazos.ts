/**
 * FORK MIA (.101) · OS PRAZOS DO RAIO-X. PUROS (o relógio entra por parâmetro).
 *
 *   link de conexão          48 h depois de gerado (gera-se outro na lista)
 *   conexão (diagnóstico)    cai sozinha 7 dias depois do relatório
 *   conexão (mensal)         fica; cai só quando a Time encerra
 *   conversas lidas          apagadas 30 dias depois do relatório
 *   relatório                fica guardado, sem telefone de cliente
 *   relatório do mensal      no dia 1 de cada mês, sobre o mês anterior
 */
import { inicioDoMesLocal, mesAnterior, momentoLocal } from "./horario";
import {
  DIAS_ATE_APAGAR_AS_CONVERSAS,
  DIAS_ATE_DESCONECTAR,
  HORAS_DO_LINK_DE_CONEXAO,
  type TipoDoRaioX,
} from "./regras";

const DIA_MS = 24 * 3_600_000;

export function validadeDoLinkDeConexao(geradoEm: Date): Date {
  return new Date(geradoEm.getTime() + HORAS_DO_LINK_DE_CONEXAO * 3_600_000);
}

export function linkDeConexaoVivo(expiraEm: string | Date | null, agora: Date): boolean {
  if (!expiraEm) return false;
  const t = expiraEm instanceof Date ? expiraEm.getTime() : Date.parse(expiraEm);
  return Number.isFinite(t) && t > agora.getTime();
}

/** Os prazos que nascem com o relatório. */
export function prazosDoRelatorio(
  tipo: TipoDoRaioX,
  relatorioEm: Date,
): { desconectarEm: Date | null; apagarConversasEm: Date } {
  return {
    desconectarEm: tipo === "unico" ? new Date(relatorioEm.getTime() + DIAS_ATE_DESCONECTAR * DIA_MS) : null,
    apagarConversasEm: new Date(relatorioEm.getTime() + DIAS_ATE_APAGAR_AS_CONVERSAS * DIA_MS),
  };
}

/** Os prazos de quando a Time encerra antes da hora: cai agora, apaga em 30 dias. */
export function prazosDoEncerramento(agora: Date): { apagarConversasEm: Date } {
  return { apagarConversasEm: new Date(agora.getTime() + DIAS_ATE_APAGAR_AS_CONVERSAS * DIA_MS) };
}

export function venceu(quando: string | Date | null | undefined, agora: Date): boolean {
  if (!quando) return false;
  const t = quando instanceof Date ? quando.getTime() : Date.parse(quando);
  return Number.isFinite(t) && t <= agora.getTime();
}

/**
 * O relatório mensal deste mês já é devido? Devido a partir da 00:00 do dia 1
 * (no fuso), quando o último relatório é de ANTES do início do mês.
 * Devolve o período (o mês anterior inteiro) ou `null`.
 */
export function relatorioMensalDevido(
  ultimoRelatorioEm: Date | null,
  agora: Date,
): { inicio: Date; fim: Date; competencia: string } | null {
  const inicioDoMes = inicioDoMesLocal(agora);
  if (ultimoRelatorioEm && ultimoRelatorioEm.getTime() >= inicioDoMes.getTime()) return null;
  // O primeiro relatório do mensal nasce como o diagnóstico (últimos N dias): o
  // mensal começa no mês SEGUINTE ao dele.
  if (!ultimoRelatorioEm) return null;
  return mesAnterior(agora);
}

/** "dd/mm" no fuso, para a mensagem pronta. */
export function diaEMes(instante: Date): string {
  const [, mes, dia] = momentoLocal(instante).data.split("-");
  return `${dia}/${mes}`;
}
