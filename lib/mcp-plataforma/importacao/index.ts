/**
 * O MCP DE MIGRAÇÃO — as ferramentas de IMPORTAÇÃO do MCP de plataforma.
 *
 * Servem para um agente migrar um cliente de outro CRM para o nosso sem
 * ninguém clicar na tela: contatos, empresas, negócios e materiais. O roteiro,
 * os formatos e os cuidados estão em `docs/fork/mcp-de-migracao.md`.
 *
 * ── Os três pontos de encaixe ─────────────────────────────────────────────
 *
 * Tudo o que é da importação mora nesta pasta. Para fora saem três listas:
 *
 *  - `FERRAMENTAS_DE_IMPORTACAO` entra em `FERRAMENTAS` (`../ferramentas.ts`);
 *  - `OPERACOES_DE_IMPORTACAO` entra em `OPERACOES` (`../operacoes.ts`), que é
 *    de onde a tela dos tokens tira as caixinhas;
 *  - `AREAS_DE_IMPORTACAO` é para o checklist da implantação: cada área devolve
 *    o que está pronto, o que falta e o que é só pela tela.
 *
 * E uma função: `argumentosParaAuditoria`, que o servidor chama antes de gravar
 * os argumentos de uma escrita na trilha (`./auditoria.ts`).
 */
import { FERRAMENTA_IMPORTAR_CONHECIMENTO } from "./conhecimento";
import { FERRAMENTA_IMPORTAR_CONTATOS } from "./contatos";
import { FERRAMENTA_IMPORTAR_EMPRESAS } from "./empresas";
import { FERRAMENTA_IMPORTAR_FOTOS_DE_PRODUTO } from "./fotos-de-produto";
import { FERRAMENTA_VER_IMPORTACAO } from "./leitura";
import { FERRAMENTA_IMPORTAR_MODELO_DE_PROPOSTA } from "./modelos-de-proposta";
import { FERRAMENTA_IMPORTAR_NEGOCIOS } from "./negocios";
import type { FerramentaComExemplo } from "./tipos";

/** Na ordem em que uma migração as usa: ver, base (empresas → contatos → negócios), materiais. */
export const FERRAMENTAS_DE_IMPORTACAO: readonly FerramentaComExemplo[] = [
  FERRAMENTA_VER_IMPORTACAO,
  FERRAMENTA_IMPORTAR_EMPRESAS,
  FERRAMENTA_IMPORTAR_CONTATOS,
  FERRAMENTA_IMPORTAR_NEGOCIOS,
  FERRAMENTA_IMPORTAR_CONHECIMENTO,
  FERRAMENTA_IMPORTAR_FOTOS_DE_PRODUTO,
  FERRAMENTA_IMPORTAR_MODELO_DE_PROPOSTA,
];

export { OPERACOES_DE_IMPORTACAO } from "./operacoes";
export { AREAS_DE_IMPORTACAO } from "./leitura";
export { argumentosParaAuditoria } from "./auditoria";
export type { AreaDeImportacao, SituacaoDaArea } from "./tipos";
