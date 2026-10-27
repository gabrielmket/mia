/**
 * FORK MIA (.96) · um banco de MENTIRA, com estado, para os testes do passo
 * "Pagamento" (lib/pagamento-inicial/). Entende as poucas formas de cadeia que
 * o serviço usa: select (uma linha ou lista), insert/upsert/update com filtros
 * eq/neq/is e o `.or` da reserva. Grava toda escrita (tabela e campos) para os
 * testes conferirem o que foi gravado, inclusive que nada do cartão foi.
 */
import { bancoLivre, type CadeiaLivre, type RespostaLivre } from "./banco-livre";

type Linha = Record<string, unknown>;

export interface EstadoDoPagamento {
  assinatura: Linha | null;
  linha: Linha | null;
  fiscais: Linha | null;
  planos: Linha[];
  org: Linha;
  nota: Linha | null;
  config: Linha[];
}

const LINHA_PADRAO: Linha = {
  modo: "entrada_paga",
  plano_id: null,
  situacao: "sem_cobranca",
  forma: null,
  pagamento_ref: null,
  assinatura_ref: null,
  primeira_cobranca_em: null,
  valor_cents: null,
  vence_em: null,
  fatura_url: null,
  pix_copia_e_cola: null,
  pix_gerado_em: null,
  boleto_linha: null,
  boleto_url: null,
  boleto_gerado_em: null,
  cartao_final: null,
  cartao_bandeira: null,
  cartao_recusas: 0,
  cartao_recusado_em: null,
  cartao_recorrente: null,
  reserva_ate: null,
  gerada_em: null,
  pago_em: null,
  forma_paga: null,
  conferido_em: null,
  lembrete_enviado_em: null,
  cobrancas_refeitas: 0,
};

function passa(linha: Linha, c: CadeiaLivre, agora: () => Date): boolean {
  for (const p of c.passos) {
    if (p.metodo === "eq" && linha[p.args[0] as string] !== p.args[1]) return false;
    if (p.metodo === "neq" && linha[p.args[0] as string] === p.args[1]) return false;
    if (p.metodo === "is" && p.args[1] === null && linha[p.args[0] as string] != null) return false;
    if (p.metodo === "or") {
      const texto = String(p.args[0]);
      const m = /^(\w+)\.is\.null,(\w+)\.lt\."([^"]+)"$/.exec(texto);
      if (m) {
        const v = linha[m[1]!] as string | null | undefined;
        if (!(v == null || Date.parse(v) < Date.parse(m[3]!))) return false;
      }
    }
  }
  void agora;
  return true;
}

const operacao = (c: CadeiaLivre) => c.passos.find((p) => ["insert", "update", "upsert", "delete"].includes(p.metodo))?.metodo ?? "select";
const argumento = (c: CadeiaLivre, m: string) => c.passos.find((p) => p.metodo === m)?.args[0] as Linha | undefined;
const unico = (c: CadeiaLivre) => c.passos.some((p) => p.metodo === "maybeSingle" || p.metodo === "single");

export function bancoDoPagamento(estado: EstadoDoPagamento, agora: () => Date = () => new Date()) {
  const escritas: Array<{ tabela: string; operacao: string; campos: Linha }> = [];
  const rpcs: Array<{ nome: string; args: Linha }> = [];

  function linhaDe(tabela: string): { get: () => Linha | null; set: (l: Linha | null) => void } | null {
    if (tabela === "cobranca_assinaturas") return { get: () => estado.assinatura, set: (l) => (estado.assinatura = l) };
    // A linha do passo sai com as colunas que o banco teria (default), como a de verdade.
    if (tabela === "mia_pagamento_inicial")
      return { get: () => (estado.linha ? { ...LINHA_PADRAO, ...estado.linha } : null), set: (l) => (estado.linha = l) };
    if (tabela === "mia_dados_fiscais") return { get: () => estado.fiscais, set: (l) => (estado.fiscais = l) };
    if (tabela === "mia_nota_da_assinatura") return { get: () => estado.nota, set: (l) => (estado.nota = l) };
    return null;
  }

  function responder(c: CadeiaLivre): RespostaLivre {
    const op = operacao(c);
    if (c.tabela === "cobranca_planos") {
      const filtrados = estado.planos.filter((p) => passa(p, c, agora));
      return { data: unico(c) ? (filtrados[0] ?? null) : filtrados };
    }
    if (c.tabela === "organizations") return { data: estado.org };
    if (c.tabela === "platform_config") return { data: unico(c) ? (estado.config[0] ?? null) : estado.config };
    if (c.tabela === "modulos_instalados") return { data: [] };
    const alvo = linhaDe(c.tabela);
    if (!alvo) return { data: unico(c) ? null : [] };
    const atual = alvo.get();
    if (op === "select") return { data: atual && passa(atual, c, agora) ? atual : unico(c) ? null : [] };
    if (op === "upsert" || op === "insert") {
      const campos = argumento(c, op) ?? {};
      escritas.push({ tabela: c.tabela, operacao: op, campos });
      const opcoes = c.passos.find((p) => p.metodo === op)?.args[1] as { ignoreDuplicates?: boolean } | undefined;
      if (atual && opcoes?.ignoreDuplicates) return { data: null };
      const base = c.tabela === "mia_pagamento_inicial" ? LINHA_PADRAO : {};
      alvo.set({ ...base, ...(atual ?? {}), ...campos, updated_at: agora().toISOString() });
      return { data: alvo.get() };
    }
    if (op === "update") {
      const campos = argumento(c, "update") ?? {};
      if (!atual || !passa(atual, c, agora)) return { data: null };
      escritas.push({ tabela: c.tabela, operacao: "update", campos });
      alvo.set({ ...atual, ...campos, updated_at: agora().toISOString() });
      return { data: alvo.get() };
    }
    if (op === "delete") {
      escritas.push({ tabela: c.tabela, operacao: "delete", campos: {} });
      alvo.set(null);
      return { data: null };
    }
    return {};
  }

  function responderRpc(nome: string, args: Linha): RespostaLivre {
    rpcs.push({ nome, args });
    if (nome === "fn_reativar_organizacao") estado.org = { ...estado.org, status: "active", suspended_kind: null };
    if (nome === "fn_suspender_organizacao") estado.org = { ...estado.org, status: "suspended", suspended_kind: "cobranca" };
    if (nome === "fn_cobranca_registrar_aviso") return { data: true };
    return { data: { mudou: true } };
  }

  const banco = bancoLivre(responder, responderRpc);
  return { cliente: banco.cliente, cadeias: banco.cadeias, escritas, rpcs, estado: () => estado };
}
