/**
 * FORK MIA — os leads dos formulários da Meta como MÓDULO VENDÁVEL, a uma linha
 * de distância.
 *
 * Hoje a importação é de toda empresa que ligar a chave dela (Configurações ›
 * Meta Ads › Formulários de leads). Se o Gabriel decidir vender à parte, vira
 * `LEADS_DA_META_E_MODULO_VENDAVEL = true` e mais nada:
 *
 *   · o módulo `leads_da_meta` aparece no painel da plataforma, para liberar por
 *     empresa (`lib/modulos/vendaveis.ts` lê daqui);
 *   · a aba "Formulários de leads" some de Configurações › Meta Ads de quem não
 *     tem a liberação (a página confere; o item Meta Ads fica, pela tabela de
 *     campanhas);
 *   · as rotas `/api/v1/leads-da-meta/*` recusam (a guarda de módulo por rota);
 *   · a rotina pula a empresa sem liberação.
 *
 * Mesmo desenho do interruptor do Broadcast (`QR_EXIGE_O_MODULO`). Este arquivo
 * não importa nada de propósito: `vendaveis.ts` o lê na carga do módulo, e um
 * import daqui para lá fecharia um ciclo.
 */

export const LEADS_DA_META_E_MODULO_VENDAVEL = false;

/** A chave em `organization_modules`. Identidade interna: não muda com o nome do produto. */
export const MODULO_DOS_LEADS_DA_META = "leads_da_meta" as const;

export const ROTAS_DOS_LEADS_DA_META = ["/api/v1/leads-da-meta"] as const;
