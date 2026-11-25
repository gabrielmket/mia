/**
 * FORK MIA (upstream 1.119, MIA-96) — como o MCP de plataforma LÊ duas opções da
 * empresa que chegaram na 1.119. Quem grava é `configurarAtendimento`
 * (`./empresa.ts`), pela régua da tela de cada uma:
 *
 *   o primeiro nome do cliente   `settings.crm.aviso_transferencia_com_nome`,
 *   no aviso de transferência    a ação `definirNomeNaTransferencia`
 *   à equipe                     (IA › Casos › Avisos)
 *   a Operação do dia            `settings.operacao_do_dia`, a rota
 *                                `PATCH /api/v1/operacao/configuracao`
 *
 * Moram aqui, e não em `./empresa.ts`, para a leitura
 * (`plataforma_ver_configuracao`, seção `atendimento`) e a resposta da escrita
 * usarem a MESMA leitura, a do envio e a da tela.
 */
import { lerConfiguracao, type ConfiguracaoDaOperacao } from "@/lib/operacao/regras";
import { avisoDeTransferenciaComNomeLigado, avisoDeTransferenciaLigado } from "@/lib/schemas/settings";

/**
 * O aviso de transferência como o envio lê. `com_o_primeiro_nome_do_cliente` só
 * tem efeito com `avisar_nas_transferencias` ligado (a tela esconde a opção
 * quando não está) e com o aviso de casos configurado na empresa.
 */
export function retratoDoAvisoDeTransferencia(settings: Record<string, unknown>): {
  avisar_nas_transferencias: boolean;
  com_o_primeiro_nome_do_cliente: boolean;
} {
  return {
    avisar_nas_transferencias: avisoDeTransferenciaLigado(settings),
    com_o_primeiro_nome_do_cliente: avisoDeTransferenciaComNomeLigado(settings),
  };
}

/** A Operação do dia como a tela e o relatório leem (`lerConfiguracao`), com `tags` pelo nome do MCP. */
export function retratoDaOperacaoDoDia(settings: Record<string, unknown>): {
  etiquetas: ConfiguracaoDaOperacao["tags"];
  etapas_de_proposta: string[];
  relatorio: ConfiguracaoDaOperacao["relatorio"];
} {
  const lida = lerConfiguracao(settings);
  return { etiquetas: lida.tags, etapas_de_proposta: lida.etapas_de_proposta, relatorio: lida.relatorio };
}
