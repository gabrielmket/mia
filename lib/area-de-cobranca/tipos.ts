/**
 * FORK MIA (.96) · A ÁREA DE COBRANÇA, O QUE A TELA RECEBE (Configurações ›
 * Plano e cobrança; docs/fork/area-de-cobranca.md).
 *
 * Puro. Do cartão só existe o final de 4 números e a bandeira. Os links são os
 * do Asaas (só https), que a leitura já filtrou.
 */
import type { FormaDaCobranca, NotaLida } from "@/lib/asaas-mia/cobrancas";
import type { FiscaisDoPasso } from "@/lib/pagamento-inicial/tipos";

import type { MotivoDaNotaErrada, SituacaoNaArea } from "./regras";

export interface CobrancaDaArea {
  ref: string;
  /** AAAA-MM-DD. */
  vencimento: string;
  valor_cents: number;
  forma: FormaDaCobranca;
  cartao_final: string | null;
  situacao: SituacaoNaArea;
  /** AAAA-MM-DD. */
  paga_em: string | null;
  /** É mensalidade da assinatura (ou cobrança avulsa, como a compra de créditos). */
  mensalidade: boolean;
  descricao: string | null;
  /** A fatura do Asaas: "Pagar agora" (aberta ou vencida). */
  pagar_url: string | null;
  /** A segunda via: o PDF do boleto, ou a fatura quando não há boleto. */
  segunda_via_url: string | null;
  /** O comprovante do pagamento: "Recibo" (paga). */
  recibo_url: string | null;
  nota: {
    numero: string | null;
    situacao: NotaLida["situacao"];
    pdf_url: string | null;
    xml_url: string | null;
  } | null;
  /** "A nota saiu errada": o chamado mais novo desta cobrança. */
  correcao: { chamado: number; situacao: "novo" | "em_analise" | "resolvido"; motivo: MotivoDaNotaErrada | null } | null;
}

export interface FormaDasMensalidades {
  /** A assinatura do Asaas cobra no cartão. */
  no_cartao: boolean;
  cartao_final: string | null;
  cartao_bandeira: string | null;
  /** AAAA-MM-DD da próxima mensalidade, quando o Asaas diz. */
  proxima_em: string | null;
  /** Há assinatura no Asaas para receber o cartão. */
  pode_trocar: boolean;
}

export interface FiscaisDaArea extends FiscaisDoPasso {
  inscricao_municipal: string | null;
  inscricao_estadual: string | null;
  /** O cliente do Asaas já tem esta versão (as próximas notas saem com ela). */
  no_asaas: boolean;
}

export interface AreaDeCobranca {
  /**
   * `ok`: as cobranças vieram do Asaas. `sem_asaas`: a empresa ainda não tem
   * cliente no Asaas (nenhuma cobrança). `falhou`: o Asaas não respondeu agora.
   */
  leitura: "ok" | "sem_asaas" | "falhou";
  cobrancas: CobrancaDaArea[];
  forma: FormaDasMensalidades | null;
  fiscais: FiscaisDaArea | null;
}

/** As recusas que a tela traduz. Nunca carregam valor digitado. */
export const FRASE_DA_AREA: Record<string, string> = {
  sem_assinatura: "A empresa ainda não tem assinatura no Asaas para receber o cartão.",
  dados_fiscais_faltando: "Preencha os dados fiscais antes de trocar o cartão.",
  telefone_faltando: "Preencha o WhatsApp em Dados fiscais antes de trocar o cartão: o Asaas pede um telefone do titular.",
  cartao_recusado: "O banco recusou o cartão. Confira os dados ou tente outro cartão.",
  cartao_sem_resposta: "Não tivemos a resposta do Asaas. Tente de novo em alguns segundos.",
  documento_nao_muda: "O CNPJ ou CPF não muda por aqui. Para trocar o titular, fale com a Time.",
  cobranca_nao_encontrada: "Não achamos esta cobrança entre as da sua empresa.",
  cobranca_nao_paga: "Só a cobrança paga tem nota fiscal para corrigir.",
  correcao_ja_pedida: "A correção desta nota já foi pedida. A Time responde pelo chamado.",
  provedor_indisponivel: "O Asaas não respondeu agora. Tente de novo em alguns minutos.",
};
