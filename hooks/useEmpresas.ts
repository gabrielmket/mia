"use client";

/**
 * FORK MIA — os dados e as ações da tela de EMPRESAS.
 *
 * Desde a .79 (empresa única, docs/fork/empresa-unica.md) o cadastro é o do
 * upstream (`companies`) e a tela é `/app/companies`; as rotas continuam em
 * `/api/v1/empresas`, que leem e gravam no cadastro único. As recusas do
 * protótipo chegam como `ApiError` com `code` e `details`:
 *
 *  - `cnpj_ja_cadastrado` (409): `details.existente = { id, nome, cnpj }`;
 *  - `nome_parecido` (409): `details.existente`, e a tela oferece usar a
 *    existente ou criar mesmo assim;
 *  - `empresa_com_negocio_aberto` (409): `details.negocios_abertos`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
import type { Papel } from "@/lib/cartoes/papel";
import type { DadosDaReceita } from "@/lib/empresas/fonte-unica";
import type { FiltroDaLista } from "@/lib/empresas/lista";

export interface Empresa {
  id: string;
  nome: string;
  razao_social: string | null;
  /** Só dígitos. */
  cnpj: string | null;
  site: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  observacoes: string | null;
  tags: string[];
  /** Campos adicionais. As definições vêm dos funis — ver a tela. */
  custom_fields: Record<string, unknown>;
  receita: DadosDaReceita | null;
  created_at: string;
  updated_at: string;
}

/** Uma linha da lista, com os números que a tela mostra. */
export interface EmpresaNaLista extends Empresa {
  pessoas: { total: number; nomes: string[] };
  negocios_abertos: number;
  obrigacoes: { total: number; atencao: number };
  parece_com: { id: string; nome: string } | null;
}

export type EmpresaEntrada = Partial<
  Omit<Empresa, "id" | "created_at" | "updated_at" | "receita">
> & {
  nome?: string;
  /** Os campos que a consulta à Receita trouxe na tela. */
  receita?: Record<string, unknown>;
  receita_bruta?: Record<string, unknown> | null;
  /** O nome parece o de outra, e a pessoa escolheu criar mesmo assim. */
  criar_mesmo_assim?: boolean;
};

/** O que a consulta do CNPJ devolve para a tela preencher. */
export interface ConsultaDoCnpj {
  cnpj: string;
  normalized_cnpj: string;
  campos: Record<string, unknown>;
  bruta: Record<string, unknown> | null;
}

const CHAVE = ["empresas"];

export function useEmpresas(busca: string, filtro: FiltroDaLista = "todas") {
  return useQuery({
    queryKey: [...CHAVE, "lista", busca, filtro],
    queryFn: async () =>
      apiClient.get<{ data: EmpresaNaLista[]; meta: { total: number; total_da_organizacao: number; truncado: boolean } }>(
        `/api/v1/empresas?limit=200&filtro=${filtro}${busca ? `&q=${encodeURIComponent(busca)}` : ""}`,
      ),
    staleTime: 10_000,
  });
}

/** As empresas sem os números de cada linha: os seletores de empresa (com busca opcional). */
export function useEmpresasDoSeletor(busca = "") {
  return useQuery({
    queryKey: [...CHAVE, "seletor", busca],
    queryFn: async () =>
      apiClient.get<{ data: Empresa[]; meta: { total: number } }>(
        `/api/v1/empresas?simples=1&limit=500${busca ? `&q=${encodeURIComponent(busca)}` : ""}`,
      ),
    staleTime: 30_000,
  });
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: CHAVE });
  void qc.invalidateQueries({ queryKey: ["ficha-do-contato"] });
  void qc.invalidateQueries({ queryKey: ["contact"] });
  void qc.invalidateQueries({ queryKey: ["board"] });
}

/** Cria (sem `id`) ou edita. As recusas do protótipo sobem para a tela tratar. */
export function useSalvarEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id?: string | null; dados: EmpresaEntrada }) =>
      v.id
        ? apiClient.patch<{ data: Empresa }>(`/api/v1/empresas/${v.id}`, v.dados)
        : apiClient.post<{ data: { id: string; nome: string } }>("/api/v1/empresas", v.dados),
    onSuccess: () => invalidar(qc),
  });
}

export function useExcluirEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      apiClient.delete<{ data: { id: string; pessoas_sem_empresa: number; negocios_no_historico: number; obrigacoes_que_sairam: number } }>(
        `/api/v1/empresas/${id}`,
      ),
    onSuccess: () => invalidar(qc),
  });
}

/**
 * Juntar duas fichas da MESMA empresa.
 *
 * A VENCEDORA é a que fica, e os dados dela nunca são sobrescritos — ela só
 * herda o que não tinha. A perdedora sai da lista; quem tiver o endereço dela
 * salvo cai na que ficou.
 */
export function useMesclarEmpresas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { vencedora: string; perdedora: string }) => apiClient.post("/api/v1/empresas/mesclar", v),
    onSuccess: () => {
      toast.success("Empresas juntadas.");
      invalidar(qc);
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao juntar as empresas.");
    },
  });
}

/** A consulta do CNPJ antes de cadastrar. Não grava nada. */
export function useConsultarCnpj() {
  return useMutation({
    mutationFn: async (cnpj: string) =>
      (await apiClient.get<{ data: ConsultaDoCnpj }>(`/api/v1/empresas/consultar-cnpj?cnpj=${encodeURIComponent(cnpj)}`))
        .data,
  });
}

/** "Atualizar pela Receita" na ficha. */
export function useAtualizarPelaReceita() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => apiClient.post(`/api/v1/empresas/${id}/receita`, {}),
    onSuccess: () => {
      toast.success("Dados conferidos na Receita.");
      invalidar(qc);
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Não consegui consultar a Receita agora.");
    },
  });
}

export interface VinculoDaPessoa {
  empresaId: string;
  contatoId: string;
  papel?: Papel | null;
  cargo?: string | null;
  setor?: string | null;
  principal?: boolean;
  /** Esta passa a ser a empresa que aparece no cartão. */
  noCartao?: boolean;
}

/** Liga um contato a uma empresa, ou muda o vínculo (só o que vier muda). */
export function useVincularPessoa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: VinculoDaPessoa) =>
      apiClient.post(`/api/v1/empresas/${v.empresaId}/pessoas`, {
        contato_id: v.contatoId,
        ...(v.papel !== undefined ? { papel: v.papel } : {}),
        ...(v.cargo !== undefined ? { cargo: v.cargo } : {}),
        ...(v.setor !== undefined ? { setor: v.setor } : {}),
        ...(v.principal !== undefined ? { principal: v.principal } : {}),
        ...(v.noCartao !== undefined ? { no_cartao: v.noCartao } : {}),
      }),
    onSuccess: () => invalidar(qc),
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Não consegui gravar o vínculo.");
    },
  });
}

export function useDesvincularPessoa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { empresaId: string; contatoId: string }) =>
      apiClient.delete(`/api/v1/empresas/${v.empresaId}/pessoas?contato_id=${encodeURIComponent(v.contatoId)}`),
    onSuccess: () => invalidar(qc),
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Não consegui tirar a pessoa da empresa.");
    },
  });
}

/** Este número e outro são a mesma pessoa. */
export function useJuntarNumeros() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { contatoId: string; outroContatoId: string }) =>
      apiClient.post(`/api/v1/contacts/${v.contatoId}/mesma-pessoa`, { outro_contato_id: v.outroContatoId }),
    onSuccess: () => invalidar(qc),
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Não consegui juntar os números.");
    },
  });
}

/** O desfazer: este número deixa de ser da pessoa (leva uma cópia das empresas). */
export function useSepararNumero() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contatoId: string) => apiClient.delete(`/api/v1/contacts/${contatoId}/mesma-pessoa`),
    onSuccess: () => invalidar(qc),
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Não consegui separar o número.");
    },
  });
}
