"use client";

/**
 * FORK MIA (.88) — os ganchos de dados do assistente da MIA (`/api/v1/assistente/*`).
 *
 * Sem canal de tempo real: o histórico é da própria pessoa e muda quando ela
 * pergunta (a mutação invalida) ou quando a Time responde um chamado (o aviso
 * chega pelo sino, e a lista se relê ao abrir o assistente e a cada minuto com
 * ele aberto).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { ConversaDoAssistente, MensagemDoAssistente, TipoDeChamado } from "@/lib/assistente/tipos";
import { ultimaRecusaDoServidor } from "@/lib/assistente/ultima-recusa";
import { randomId } from "@/lib/random-id";

export interface ChamadoDaPessoa {
  id: string;
  numero: number;
  tipo: TipoDeChamado;
  texto: string;
  situacao: "novo" | "em_analise" | "resolvido";
  resposta: string | null;
  respondido_em: string | null;
  demonstracao: boolean;
  created_at: string;
  tem_print?: boolean;
}

export interface EstadoDoAssistente {
  disponivel: boolean;
  papel: string;
  conversas: ConversaDoAssistente[];
  conversa_id: string | null;
  mensagens: MensagemDoAssistente[];
  uso: { feitas: number; limite: number; restantes: number };
  resumo_da_manha: boolean;
  chamados: ChamadoDaPessoa[];
}

const CHAVE = ["assistente"] as const;

export function useAssistente(conversaId: string | null, opcoes: { ativo?: boolean } = {}) {
  return useQuery({
    enabled: opcoes.ativo ?? true,
    queryKey: [...CHAVE, "estado", conversaId],
    refetchInterval: 60_000,
    queryFn: () =>
      apiClient
        .get<{ data: EstadoDoAssistente }>(
          `/api/v1/assistente/chat${conversaId ? `?conversa=${encodeURIComponent(conversaId)}` : ""}`,
        )
        .then((r) => r.data),
  });
}

export interface RespostaDaPergunta {
  conversa_id: string;
  turno: MensagemDoAssistente[];
  replay: boolean;
  uso: { feitas: number; limite: number; restantes: number };
}

export function usePerguntar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pedido: { pergunta: string; conversaId: string | null; caminho: string }) => {
      const recusa = ultimaRecusaDoServidor();
      return apiClient
        .post<{ data: RespostaDaPergunta }>(
          "/api/v1/assistente/chat",
          {
            turn_id: randomId(),
            pergunta: pedido.pergunta,
            conversa_id: pedido.conversaId,
            tela: { caminho: pedido.caminho },
            ultima_recusa: recusa ? { mensagem: recusa.mensagem, codigo: recusa.codigo, status: recusa.status } : null,
          },
          // A resposta passa por ferramentas e pelo modelo: 10 s não basta.
          { timeoutMs: 90_000 },
        )
        .then((r) => r.data);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useAbrirChamado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pedido: {
      tipo: TipoDeChamado;
      texto: string;
      mensagemDoSistema: string | null;
      caminho: string;
      conversaId: string | null;
      print: File | null;
    }) => {
      const corpo = new FormData();
      corpo.set("tipo", pedido.tipo);
      corpo.set("texto", pedido.texto);
      if (pedido.mensagemDoSistema) corpo.set("mensagem_do_sistema", pedido.mensagemDoSistema);
      corpo.set("tela", pedido.caminho);
      if (pedido.conversaId) corpo.set("conversa_id", pedido.conversaId);
      if (pedido.print) corpo.set("print", pedido.print);
      const resposta = await fetch("/api/v1/assistente/chamados", { method: "POST", body: corpo });
      const json = (await resposta.json().catch(() => null)) as
        | { data?: { chamado: ChamadoDaPessoa; demonstracao: boolean; aviso: string | null }; error?: { message?: string } }
        | null;
      if (!resposta.ok || !json?.data) throw new Error(json?.error?.message ?? "Não deu para abrir o chamado agora.");
      return json.data;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function usePedirAPessoa() {
  return useMutation({
    mutationFn: (pedido: { paraUserId: string; pedido: string; caminho: string }) =>
      apiClient.post("/api/v1/assistente/pedir", {
        para_user_id: pedido.paraUserId,
        pedido: pedido.pedido,
        tela: pedido.caminho,
      }),
  });
}

export function useResumoDaManha() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ligado: boolean) => apiClient.put("/api/v1/assistente/preferencias", { resumo_da_manha: ligado }),
    onSettled: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

export interface EmpresaDoAssistente {
  config: { ligado: boolean; papeis: string[]; perguntas_por_pessoa_por_dia: number; resumo_da_manha_padrao: boolean };
  base: Array<{ id: string; titulo: string; texto: string; ativo: boolean; updated_at: string }>;
  sem_resposta: Array<{ texto: string; vezes: number; ultima_em: string }>;
}

export function useEmpresaDoAssistente(ativo: boolean) {
  return useQuery({
    enabled: ativo,
    queryKey: [...CHAVE, "empresa"],
    queryFn: () => apiClient.get<{ data: EmpresaDoAssistente }>("/api/v1/assistente/empresa").then((r) => r.data),
  });
}

export function usePapeisDoAssistente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (papeis: string[]) => apiClient.put("/api/v1/assistente/empresa", { papeis }),
    onSettled: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useGuardarConhecimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: { titulo: string; texto: string; ativo?: boolean }) => apiClient.post("/api/v1/assistente/empresa", item),
    onSettled: () => qc.invalidateQueries({ queryKey: [...CHAVE, "empresa"] }),
  });
}

export function useTirarConhecimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (titulo: string) => apiClient.delete(`/api/v1/assistente/empresa?titulo=${encodeURIComponent(titulo)}`),
    onSettled: () => qc.invalidateQueries({ queryKey: [...CHAVE, "empresa"] }),
  });
}
