/**
 * FORK MIA (.96) · O PASSO "PAGAMENTO" DO INÍCIO, O QUE A TELA RECEBE.
 *
 * Puro (sem servidor): a página, as rotas e o MCP falam esta língua. Do cartão
 * só existe o final de 4 números e a bandeira devolvidos pelo Asaas.
 */
export type FormaDoPagamento = "pix" | "cartao" | "boleto";
export const FORMAS_DO_PAGAMENTO: readonly FormaDoPagamento[] = ["pix", "cartao", "boleto"] as const;

/**
 * A situação gravada em `mia_pagamento_inicial.situacao` (migration 9121).
 * `escolhida`: no modo teste, a forma de depois do teste já foi escolhida (e,
 * com o cartão, ele ficou cadastrado na assinatura).
 */
export type SituacaoDoPagamento = "sem_cobranca" | "aguardando" | "em_analise" | "recusado" | "pago" | "escolhida";

/**
 * `entrada_paga`: plano sem teste, paga antes de usar (a empresa fica parada).
 * `teste`: plano com teste grátis (decisão 12 revista em 27/10/2026): nada é
 * cobrado hoje, a pessoa escolhe como paga depois do teste e segue.
 */
export type ModoDoPasso = "entrada_paga" | "teste";

export interface PlanoDoPasso {
  id: string;
  nome: string;
  preco_cents: number;
  intervalo: string;
  trial_dias: number;
  pessoas: number | null;
  numeros: number | null;
}

export interface FiscaisDoPasso {
  tipo: "pj" | "pf";
  /** Formatado (00.000.000/0000-00). */
  documento: string;
  razao_social: string;
  endereco: string;
  /** Os campos crus, para o "Corrigir" abrir preenchido. */
  campos: {
    tipo: "pj" | "pf";
    documento: string;
    razao_social: string;
    cep: string;
    logradouro: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    uf: string;
    inscricao_municipal: string;
    inscricao_estadual: string;
    telefone: string;
  };
}

export interface PassoDoPagamento {
  /** Em que modo o passo aparece; `null` = não aparece para esta empresa. */
  modo: ModoDoPasso | null;
  /** A empresa espera o primeiro pagamento da entrada paga (está parada). */
  espera: boolean;
  /** Pagou (agora ou antes): a tela mostra "Pagamento confirmado". */
  pago: boolean;
  /** O passo está resolvido: pago (entrada paga) ou forma escolhida (teste). */
  cumprido: boolean;
  /** Modo teste: até quando vai o teste grátis (ISO). */
  teste_ate: string | null;
  /** Modo teste: o dia da primeira cobrança (AAAA-MM-DD); com o cartão, o dia do débito. */
  primeira_cobranca_em: string | null;
  /**
   * A empresa foi bloqueada no fim do teste sem a primeira mensalidade paga: o
   * passo é o da entrada paga ("falta só o pagamento"), mas sem boleto.
   */
  fim_do_teste: boolean;
  /** As formas que este passo oferece, na ordem da tela. */
  formas: FormaDoPagamento[];
  situacao: SituacaoDoPagamento;
  forma: FormaDoPagamento | null;
  plano: PlanoDoPasso | null;
  /** Os planos visíveis às empresas, para o "Trocar de plano" (decisão 7). */
  planosParaTrocar: PlanoDoPasso[];
  fiscais: FiscaisDoPasso | null;
  valor_cents: number | null;
  /** AAAA-MM-DD. */
  vence_em: string | null;
  /** O Pix: o copia e cola e o QR dele (imagem PNG em data URL, desenhada no servidor). */
  pix: { copia_e_cola: string; qr: string | null; gerado_em: string | null } | null;
  boleto: { linha: string; url: string | null; gerado_em: string | null } | null;
  cartao: { final: string | null; bandeira: string | null; recusas: number; recusado_em: string | null } | null;
  /** A fatura do Asaas (caminho de reserva: a mesma cobrança na página dele). */
  fatura_url: string | null;
  pago_em: string | null;
  forma_paga: FormaDoPagamento | "outra" | null;
  proxima_cobranca: string | null;
  /** Só quem administra paga, troca o plano e corrige os dados. */
  pode_pagar: boolean;
}

/** As recusas que a tela traduz. Nunca carregam valor digitado. */
export const FRASE_DA_RECUSA: Record<string, string> = {
  sem_entrada_paga: "Esta empresa não está esperando o primeiro pagamento.",
  sem_passo: "Esta empresa não tem o passo do pagamento.",
  cartao_ja_cadastrado: "O cartão já está cadastrado. Siga para o próximo passo.",
  ja_pago: "O pagamento já foi confirmado. Siga para o próximo passo.",
  dados_fiscais_faltando: "Preencha os dados da empresa para a cobrança e a nota fiscal antes de pagar.",
  em_andamento: "Já estamos cuidando deste pagamento. Aguarde alguns segundos.",
  plano_indisponivel: "Esse plano não está disponível. Escolha outro.",
  mesmo_plano: "A empresa já está neste plano.",
  provedor_nao_conectado: "O pagamento ainda não está disponível. Fale com a Time.",
  provedor_recusou: "O Asaas não respondeu agora. Tente de novo em alguns minutos.",
  cartao_recusado: "O banco recusou o cartão. Confira os dados, tente outro cartão ou pague por Pix, que libera na hora.",
  cartao_sem_resposta: "Não tivemos a resposta do Asaas. Confira em alguns segundos se o pagamento entrou antes de tentar de novo.",
  documento_recusado: "O Asaas não aceitou este CPF ou CNPJ. Confira o número.",
  empresa_sem_email: "A empresa ainda não tem administrador com e-mail.",
  somente_admin: "Só quem administra a empresa faz o pagamento.",
};
