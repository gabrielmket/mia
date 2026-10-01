/**
 * FORK MIA — o negócio que chega por IMPORTAÇÃO DE BASE (migração de outro CRM).
 *
 * `createLeadHandler` é o único lugar em que um negócio nasce, e ele faz duas
 * coisas que uma migração não pode fazer:
 *
 *  1. emite `lead.created`, que é o evento que acorda a automação "Quando entrar
 *     um contato novo", o gatilho de follow-up "Lead criado" e tudo o que vier a
 *     assinar esse evento. Migrar 800 negócios não é 800 clientes chegando;
 *  2. grava sempre "agora" como data de criação e deixa o fechamento para o
 *     gatilho do banco, que também carimba "agora". Um negócio ganho em março
 *     entraria no relatório de vendas do mês da migração.
 *
 * Este tipo é o que a importação entrega ao handler para as duas coisas: a
 * presença dele CALA o evento (na origem: sem evento não há consumidor, nem os
 * de hoje nem os que o upstream criar amanhã) e as colunas dele carregam a
 * história que o negócio tinha no CRM de origem.
 *
 * Quem preenche é só `lib/mcp-plataforma/importacao/negocios.ts`. Nunca vem do
 * corpo de uma requisição.
 */
export interface ImportacaoSilenciosaDoNegocio {
  /** Quando o negócio nasceu no CRM de origem. Só vai para negócio FECHADO. */
  created_at?: string;
  /** Quando foi ganho ou perdido lá. Só para etapa de ganho ou de perda. */
  closed_at?: string;
  /** O motivo da perda, já traduzido para um que o funil aceita. */
  lost_reason?: string;
  /** A etapa ABERTA em que o negócio estava quando foi perdido. */
  lost_from_stage_id?: string;
}
