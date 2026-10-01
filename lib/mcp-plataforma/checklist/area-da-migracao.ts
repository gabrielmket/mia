/**
 * A ÁREA "BASE IMPORTADA" DO CHECKLIST DA IMPLANTAÇÃO.
 *
 * Junta, numa área só, o que as ferramentas de importação sabem dizer sobre a
 * base do cliente (`lib/mcp-plataforma/importacao/`, `AREAS_DE_IMPORTACAO`):
 * empresas, contatos, negócios, materiais de conhecimento, fotos de produto e
 * modelos de proposta.
 *
 * ── Por que ela nunca entra em "falta" ────────────────────────────────────
 *
 * Migrar uma base é OPCIONAL: um cliente novo começa com a base vazia e isso
 * não é pendência. Se "nenhum contato na base" contasse como falta, toda
 * implantação terminaria com três pendências que ninguém vai resolver, e o
 * checklist deixaria de dizer a verdade sobre o que falta para atender.
 *
 * O que as áreas da importação apontam como atenção (duplicata suspeita,
 * material que não indexou, contato sem telefone) vai em `dados.atencao`, com o
 * texto delas, e o detalhe inteiro fica em `plataforma_ver_importacao`. Base de
 * conhecimento e catálogo já têm as áreas próprias, que contam para o "pode
 * atender".
 */
import { AREAS_DE_IMPORTACAO } from "../importacao";

import type { AreaDoChecklist } from "./tipos";

export const migracao: AreaDoChecklist = {
  chave: "migracao",
  titulo: "Base importada (migração de outro CRM, opcional)",
  avaliar: async (ctx, org) => {
    const pronto: string[] = [];
    const atencao: string[] = [];
    const numeros: Record<string, unknown> = {};
    const naoMedidas: string[] = [];

    for (const area of AREAS_DE_IMPORTACAO) {
      try {
        const situacao = await area.situacao(ctx, org.id);
        pronto.push(...situacao.pronto);
        atencao.push(...situacao.falta, ...situacao.so_pela_tela);
        numeros[area.chave] = situacao.numeros;
      } catch {
        // Uma área que não mede não derruba as outras: fica dito.
        naoMedidas.push(area.rotulo);
      }
    }

    return {
      pronto,
      falta: [],
      so_pela_tela: [],
      dados: {
        opcional: true,
        como_importar:
          "plataforma_importar_empresas, plataforma_importar_contatos e plataforma_importar_negocios, nessa ordem; " +
          "os materiais entram por plataforma_importar_conhecimento, plataforma_importar_fotos_de_produto e " +
          "plataforma_importar_modelo_de_proposta. O retrato completo está em plataforma_ver_importacao.",
        atencao,
        numeros,
        ...(naoMedidas.length > 0 ? { nao_medidas: naoMedidas } : {}),
      },
    };
  },
};
