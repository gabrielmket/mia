/**
 * FORK MIA (.90) — A SITUAÇÃO DE CADA EMPRESA E O PRÓXIMO PASSO DA RÉGUA, para a
 * tela da Time (Admin › Empresas do cadastro), o MCP e os recados no zap.
 *
 * PURO e só de LEITURA: quem decide avisar, suspender e reativar é a régua do
 * upstream (`lib/cobranca/regua.ts`, `decidirRegua`). Aqui as mesmas regras são
 * usadas para PREVER a data do próximo passo — o aviso de 3 dias antes do fim do
 * teste, o aviso final (na tolerância menos 2 dias, ou na hora para o teste
 * vencido sem cobrança em jogo) e a suspensão (no limite, e pelo menos 48 h
 * depois do aviso final). Se a régua do upstream mudar, a previsão pode errar
 * a data, nunca a ação: a ação continua sendo dela.
 */
import { PISO_DA_TOLERANCIA_DIAS } from "@/lib/cobranca/regua";
import type { AvisoDaRegua, EstadoDaAssinatura } from "@/lib/cobranca/vocabulario";

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

export const SITUACOES = ["teste", "emdia", "atraso", "prazo", "suspensa", "cancelada", "isenta"] as const;
export type SituacaoDaEmpresa = (typeof SITUACOES)[number];

export interface AssinaturaLida {
  plano_id: string;
  plano_agendado_id: string | null;
  estado: EstadoDaAssinatura;
  trial_ate: string | null;
  vencida_desde: string | null;
  proximo_vencimento: string | null;
  prazo_extra_ate: string | null;
  cancela_no_fim: boolean;
  assinaturas_vivas: number;
  ultimo_aviso: AvisoDaRegua | null;
  ultimo_aviso_em: string | null;
  provedor: string | null;
  pagamento_inicial_pendente: boolean;
  link_de_pagamento: string | null;
}

export interface OrgLida {
  status: string;
  suspended_kind: string | null;
}

const em = (v: string | null) => (v === null ? null : Date.parse(v));

export function situacaoDaEmpresa(a: AssinaturaLida | null, org: OrgLida, agora: Date): SituacaoDaEmpresa {
  if (!a) return "isenta";
  if (org.status === "suspended") return "suspensa";
  const t = agora.getTime();
  if (a.estado === "em_atraso") {
    const prazo = em(a.prazo_extra_ate);
    return prazo !== null && prazo > t ? "prazo" : "atraso";
  }
  if (a.estado === "trial") {
    const fim = em(a.trial_ate);
    // Teste vencido sem provedor: a régua o transforma em dívida na próxima rodada.
    if (a.provedor === null && (fim === null || fim <= t)) return "atraso";
    return "teste";
  }
  if (a.estado === "cancelada" || a.cancela_no_fim) return "cancelada";
  return "emdia";
}

export type TipoDoProximoPasso =
  | "sem_cobranca"
  | "aviso_3_dias"
  | "fim_do_teste"
  | "primeira_fatura"
  | "aviso_final"
  | "suspensao"
  | "fim_do_prazo"
  | "lembrete_semanal"
  | "fim_do_acesso"
  | "proxima_cobranca";

export interface ProximoPasso {
  tipo: TipoDoProximoPasso;
  em: string | null;
  /** Quando há dívida: a data prevista da suspensão. */
  suspensao_em: string | null;
}

const iso = (ms: number | null) => (ms === null || !Number.isFinite(ms) ? null : new Date(ms).toISOString());

/** A previsão da suspensão de quem está em dívida (as regras de `decidirRegua`). */
export function previsaoDaSuspensao(a: AssinaturaLida, agora: Date, toleranciaDias: number): { avisoFinalEm: number | null; suspensaoEm: number } {
  const t = agora.getTime();
  const debito = em(a.vencida_desde) ?? em(a.trial_ate) ?? t;
  const fimDoTeste = em(a.trial_ate);
  const dividaDoTeste =
    !a.pagamento_inicial_pendente &&
    (a.provedor === null || (a.assinaturas_vivas === 0 && fimDoTeste !== null && debito === fimDoTeste));
  const tolerancia = Math.max(PISO_DA_TOLERANCIA_DIAS, Math.trunc(toleranciaDias)) * DIA_MS;
  const limite = Math.max(debito + (dividaDoTeste ? 0 : tolerancia), em(a.prazo_extra_ate) ?? 0);
  const avisoEm = em(a.ultimo_aviso_em);
  const avisoFinalDado =
    (a.ultimo_aviso === "suspende_em_breve" || a.ultimo_aviso === "suspensa") && avisoEm !== null && avisoEm >= debito;
  if (avisoFinalDado) return { avisoFinalEm: avisoEm, suspensaoEm: Math.max(limite, avisoEm + 48 * HORA_MS) };
  const avisoFinalEm = Math.max(limite - 2 * DIA_MS, t);
  return { avisoFinalEm, suspensaoEm: Math.max(limite, avisoFinalEm + 48 * HORA_MS) };
}

export function proximoDaRegua(a: AssinaturaLida | null, org: OrgLida, agora: Date, toleranciaDias: number): ProximoPasso {
  const s = situacaoDaEmpresa(a, org, agora);
  const nada = (tipo: TipoDoProximoPasso, quando: number | null): ProximoPasso => ({ tipo, em: iso(quando), suspensao_em: null });
  if (!a || s === "isenta") return nada("sem_cobranca", null);
  const t = agora.getTime();
  switch (s) {
    case "teste": {
      const fim = em(a.trial_ate);
      const aviso = fim === null ? null : fim - 3 * DIA_MS;
      if (aviso !== null && aviso > t && a.assinaturas_vivas === 0 && a.ultimo_aviso === null) return nada("aviso_3_dias", aviso);
      return nada(a.assinaturas_vivas > 0 ? "primeira_fatura" : "fim_do_teste", fim);
    }
    case "atraso":
    case "prazo": {
      const p = previsaoDaSuspensao(a, agora, toleranciaDias);
      if (s === "prazo") return { tipo: "fim_do_prazo", em: a.prazo_extra_ate, suspensao_em: iso(p.suspensaoEm) };
      const avisoFinalDado = a.ultimo_aviso === "suspende_em_breve" || a.ultimo_aviso === "suspensa";
      return avisoFinalDado
        ? { tipo: "suspensao", em: iso(p.suspensaoEm), suspensao_em: iso(p.suspensaoEm) }
        : { tipo: "aviso_final", em: iso(p.avisoFinalEm), suspensao_em: iso(p.suspensaoEm) };
    }
    case "suspensa": {
      const ultimo = em(a.ultimo_aviso_em);
      let lembrete = (ultimo ?? t) + 7 * DIA_MS;
      while (lembrete < t) lembrete += 7 * DIA_MS;
      return nada("lembrete_semanal", lembrete);
    }
    case "cancelada":
      return nada("fim_do_acesso", em(a.proximo_vencimento));
    default:
      return nada("proxima_cobranca", em(a.proximo_vencimento));
  }
}

/** A frase de cada passo (chave de `t()`, com `{data}` e `{suspensao}`). */
export const FRASE_DO_PROXIMO_PASSO: Record<TipoDoProximoPasso, string> = {
  sem_cobranca: "Sem cobrança: não paga e não tem limites",
  aviso_3_dias: "Aviso de 3 dias antes em {data}",
  fim_do_teste: "Fim do teste em {data}: aviso final",
  primeira_fatura: "Fim do teste em {data}: 1ª fatura vence",
  aviso_final: "Aviso final em {data} · suspensão em {suspensao}",
  suspensao: "Suspensão em {data}",
  fim_do_prazo: "Prazo até {data}; depois a régua volta",
  lembrete_semanal: "Lembrete semanal em {data}",
  fim_do_acesso: "Acesso até {data}, depois suspende",
  proxima_cobranca: "Próxima cobrança em {data}",
};

/** A frase de cada situação (chave de `t()`). */
export const ROTULO_DA_SITUACAO: Record<SituacaoDaEmpresa, string> = {
  teste: "Em teste",
  emdia: "Em dia",
  atraso: "Em atraso",
  prazo: "Com prazo",
  suspensa: "Suspensa",
  cancelada: "Cancelada",
  isenta: "Isenta",
};

export interface PontoDaRegua {
  em: string;
  titulo: string;
  estado: "feito" | "agora" | "depois";
}

/** A régua da empresa, ponto a ponto (o detalhe da tela da Time). Títulos são chaves de `t()`. */
export function reguaDaEmpresa(
  a: AssinaturaLida | null,
  org: OrgLida,
  agora: Date,
  toleranciaDias: number,
  entrou: string | null,
): PontoDaRegua[] {
  const s = situacaoDaEmpresa(a, org, agora);
  if (!a || s === "isenta") return [];
  const t = agora.getTime();
  const pontos: Array<{ em: number | null; titulo: string }> = [];
  const fim = em(a.trial_ate);
  const naoAssinou = a.assinaturas_vivas === 0 && a.provedor === null;
  if (s === "teste" || (naoAssinou && (s === "atraso" || s === "suspensa" || s === "prazo"))) {
    pontos.push({ em: em(entrou), titulo: "Entrou; o teste começou" });
    if (fim !== null) pontos.push({ em: fim - 3 * DIA_MS, titulo: "Aviso: o teste termina em 3 dias" });
    pontos.push({ em: fim, titulo: a.assinaturas_vivas > 0 ? "1ª fatura vence" : "Fim do teste sem assinatura: aviso final" });
    if (a.assinaturas_vivas === 0) {
      const p = previsaoDaSuspensao({ ...a, vencida_desde: a.vencida_desde ?? a.trial_ate }, agora, toleranciaDias);
      pontos.push({ em: p.suspensaoEm, titulo: "Suspensão, 48 horas depois do aviso final" });
    }
  } else if (s === "emdia" || s === "cancelada") {
    pontos.push({ em: em(a.proximo_vencimento), titulo: s === "cancelada" ? "Fim do período pago" : "Próxima cobrança" });
  } else {
    const p = previsaoDaSuspensao(a, agora, toleranciaDias);
    pontos.push({ em: em(a.vencida_desde), titulo: "Pagamento não identificado" });
    pontos.push({ em: p.avisoFinalEm, titulo: "Aviso final" });
    pontos.push({ em: p.suspensaoEm, titulo: "Suspensão" });
  }
  const dia = (ms: number) => Math.floor(ms / DIA_MS);
  return pontos
    .filter((x): x is { em: number; titulo: string } => x.em !== null && Number.isFinite(x.em))
    .map((x) => ({
      em: new Date(x.em).toISOString(),
      titulo: x.titulo,
      estado: dia(x.em) < dia(t) ? "feito" : dia(x.em) === dia(t) ? "agora" : "depois",
    }));
}
