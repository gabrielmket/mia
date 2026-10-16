"use client";

/**
 * FORK MIA (item 9) — as chamadas do navegador às rotas do montador
 * (`/api/v1/relatorios/**`), pelo `apiClient` (que leva a empresa da aba e
 * repete o que falhou por rede). A planilha vem crua (`text/csv`), por `fetch`.
 */
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { HEADER_ORG_DA_ABA, orgDaAba } from "@/lib/auth/org-da-aba";
import type { RespostaDoMotor } from "@/lib/paineis/motor";
import type { Rotulo } from "@/lib/relatorios/apresentar";
import type { PeriodoDoMontador, Tamanho } from "@/lib/relatorios/catalogo";
import type { Aviso, ConfigDoRelatorio } from "@/lib/relatorios/config";
import type { RespostaDaLista } from "@/lib/relatorios/lista";

const LONGO = { timeoutMs: 45_000 };

export interface Calculado {
  config: ConfigDoRelatorio;
  resposta: RespostaDoMotor;
  nomes: Record<string, string>;
  calculadoEm: string;
  avisos: Aviso[];
}

export async function calcular(config: ConfigDoRelatorio, periodo?: PeriodoDoMontador | null): Promise<Calculado> {
  const r = await apiClient.post<{ data: Calculado }>("/api/v1/relatorios/calcular", { config, periodo: periodo ?? null }, LONGO);
  return r.data;
}

export interface GrupoDaLista {
  chave1: string | null;
  chave2: string | null;
  dobrados1?: string[] | null;
  dobrados2?: string[] | null;
  funil: boolean;
}

export async function lista(
  config: ConfigDoRelatorio,
  grupo: GrupoDaLista,
  opcoes: { periodo?: PeriodoDoMontador | null; deslocamento?: number } = {},
): Promise<{ lista: RespostaDaLista; nomes: Record<string, string> }> {
  const r = await apiClient.post<{ data: { lista: RespostaDaLista; nomes: Record<string, string> } }>(
    "/api/v1/relatorios/lista",
    { config, periodo: opcoes.periodo ?? null, ...grupo, deslocamento: opcoes.deslocamento ?? 0 },
    LONGO,
  );
  return r.data;
}

export interface ValorPossivel {
  chave: string;
  rotulo: Rotulo;
  n: number;
}

export async function valores(config: ConfigDoRelatorio, filtro: string): Promise<ValorPossivel[]> {
  const r = await apiClient.post<{ data: { valores: ValorPossivel[] } }>("/api/v1/relatorios/valores", { config, filtro }, LONGO);
  return r.data.valores;
}

export interface RelatorioSalvo {
  id: string;
  nome: string;
  config: ConfigDoRelatorio;
  compartilhado: boolean;
  prontoDe: string | null;
  copiadoDe: string | null;
  criadoPor: string | null;
  atualizadoEm: string;
}

export async function criar(corpo: {
  nome: string;
  config: ConfigDoRelatorio;
  compartilhado?: boolean;
  pronto_de?: string | null;
  copiado_de?: string | null;
}): Promise<RelatorioSalvo> {
  const r = await apiClient.post<{ data: { relatorio: RelatorioSalvo } }>("/api/v1/relatorios", corpo);
  return r.data.relatorio;
}

export async function alterar(id: string, corpo: { nome?: string; config?: ConfigDoRelatorio; compartilhado?: boolean }): Promise<RelatorioSalvo> {
  const r = await apiClient.patch<{ data: { relatorio: RelatorioSalvo } }>(`/api/v1/relatorios/${id}`, corpo);
  return r.data.relatorio;
}

export async function apagar(id: string): Promise<void> {
  await apiClient.delete(`/api/v1/relatorios/${id}`);
}

export interface ItemDoPainel {
  id: string;
  relatorioId: string | null;
  pronto: string | null;
  tamanho: Tamanho;
  periodoProprio: boolean;
  posicao: number;
}

export interface PainelResumo {
  id: string;
  nome: string;
  compartilhado: boolean;
  podeEditar: boolean;
  meu: boolean;
  itens: ItemDoPainel[];
}

export async function paineis(): Promise<PainelResumo[]> {
  const r = await apiClient.get<{ data: { paineis: PainelResumo[] } }>("/api/v1/relatorios/paineis");
  return r.data.paineis;
}

export async function novoPainel(corpo: { nome: string; relatorio_id?: string | null; pronto?: string | null; compartilhado?: boolean }): Promise<PainelResumo> {
  const r = await apiClient.post<{ data: { painel: PainelResumo } }>("/api/v1/relatorios/paineis", corpo);
  return r.data.painel;
}

export async function adicionarAoPainel(painelId: string, corpo: { relatorio_id?: string | null; pronto?: string | null; tamanho?: Tamanho }): Promise<void> {
  await apiClient.post(`/api/v1/relatorios/paineis/${painelId}/itens`, corpo);
}

export async function alterarPainel(painelId: string, corpo: { nome?: string; periodo?: string; compartilhado?: boolean }): Promise<void> {
  await apiClient.patch(`/api/v1/relatorios/paineis/${painelId}`, corpo);
}

export async function alterarItem(painelId: string, itemId: string, corpo: { tamanho?: Tamanho; periodo_proprio?: boolean; posicao?: number }): Promise<void> {
  await apiClient.patch(`/api/v1/relatorios/paineis/${painelId}/itens/${itemId}`, corpo);
}

export async function tirarItem(painelId: string, itemId: string): Promise<void> {
  await apiClient.delete(`/api/v1/relatorios/paineis/${painelId}/itens/${itemId}`);
}

export interface Exportacao {
  id: string;
  quem: string | null;
  tipo: "relatorio" | "lista";
  relatorioNome: string;
  grupo: string | null;
  linhas: number;
  criadoEm: string;
}

export async function exportacoes(): Promise<Exportacao[]> {
  const r = await apiClient.get<{ data: { exportacoes: Exportacao[] } }>("/api/v1/relatorios/exportacoes");
  return r.data.exportacoes;
}

/** Baixa a planilha: a rota registra a exportação antes de devolver o arquivo. */
export async function baixarPlanilha(corpo: Record<string, unknown>): Promise<{ arquivo: string; linhas: number; cortada: boolean }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const aba = orgDaAba();
  if (aba?.orgId) headers[HEADER_ORG_DA_ABA] = aba.orgId;
  const res = await fetch("/api/v1/relatorios/exportar", { method: "POST", headers, body: JSON.stringify(corpo) });
  if (!res.ok) {
    let mensagem = "";
    try {
      mensagem = ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      /* corpo sem JSON */
    }
    throw new ApiError(res.status, "export_failed", undefined, res.headers.get("X-Request-Id") ?? "", mensagem || undefined);
  }
  const blob = await res.blob();
  const arquivo = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "relatorio.csv";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = arquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { arquivo, linhas: Number(res.headers.get("X-Linhas") ?? 0), cortada: res.headers.get("X-Cortada") === "1" };
}

/** A frase de um erro de chamada, para o aviso da tela. */
export function mensagemDoErro(e: unknown, t: (s: string) => string): string {
  if (e instanceof ApiError) return e.message && e.message !== e.code ? e.message : t("Não deu certo. Tente de novo.");
  return t("Não deu certo. Tente de novo.");
}
