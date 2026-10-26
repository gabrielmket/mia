/**
 * FORK MIA (.89) — O GUIA DE OPERAÇÃO DO UPSTREAM, DO JEITO QUE A MIA É.
 *
 * Os trechos vêm gerados de `.claude/skills/deskcomm-operacao/`
 * (`guia-de-operacao.gen.ts`). O guia descreve o DeskcommCRM; a MIA é o
 * mesmo produto com algumas portas trocadas e algumas decisões diferentes.
 * Aqui mora a diferença, e só ela:
 *
 *   - EQUIVALENCIAS_DO_FORK: a tela do upstream que no fork mora em outra
 *     porta (as Campanhas viraram o caminho "Número por QR" do Broadcast);
 *   - SUPERADOS_PELO_CODIGO: o trecho que o código da MIA desmente. Ele sai da
 *     busca, e o manual do fork que vale no lugar é dito ao lado. Quando o
 *     upstream corrigir o guia, o id some da fonte e
 *     `tests/unit/assistente-guia-de-operacao.test.ts` pede para tirar a linha.
 *
 * Nunca se edita o guia do upstream nem o arquivo gerado: a correção é daqui.
 * Módulo PURO.
 */
import { NAV_CATALOG, type NavMetadata } from "@/lib/navigation/catalogo";

import type { TrechoDoGuia } from "./guia-de-operacao/ler-o-guia";
import { TRECHOS_DO_GUIA } from "./guia-de-operacao.gen";

/** A tela do upstream → a porta em que ela mora na MIA. */
export const EQUIVALENCIAS_DO_FORK: Readonly<Record<string, string>> = {
  // .58: as Campanhas do upstream são o caminho "Número por QR" do Broadcast (docs/fork/broadcast-unificado.md).
  "/app/campaigns": "/app/broadcast",
  // .79: o cadastro de empresa é um só, o do upstream (docs/fork/empresa-unica.md).
  "/app/empresas": "/app/companies",
};

/**
 * O trecho do guia que o código da MIA desmente, com o manual do fork
 * (`manuais*.ts`) que responde no lugar.
 */
export const SUPERADOS_PELO_CODIGO: Readonly<Record<string, { motivo: string; manual: string }>> = {
  "so-api-ou-sem-tela/base-de-mcp-externo": {
    motivo: "O guia diz que o servidor MCP externo ainda não tem tela; a tela existe em /app/settings/servidor-mcp-externo.",
    manual: "servidor-mcp-externo",
  },
  // A IA do agente é da plataforma na MIA (lib/ai/trava-da-ia.ts, migration 9002): o
  // cliente não escolhe provedor, modelo nem chave.
  "ia/agente-de-ia-agentes/modelos-gemini": {
    motivo: "Na MIA o modelo do agente é escolhido pela plataforma (trava da IA, 9002).",
    manual: "ia-da-plataforma",
  },
  "ia/agente-de-ia-agentes/modelo-digitavel-sem-catalogo": {
    motivo: "Na MIA o modelo do agente é escolhido pela plataforma (trava da IA, 9002).",
    manual: "ia-da-plataforma",
  },
  "ia/agente-de-ia-agentes/agente-pela-assinatura-fecha-o-turno": {
    motivo: "Na MIA o provedor do agente é escolhido pela plataforma (trava da IA, 9002).",
    manual: "ia-da-plataforma",
  },
  "ia/agente-de-ia-provedores/chave-em-endereco-proprio": {
    motivo: "Na MIA a chave da IA é da plataforma (Credenciais é tela só da plataforma).",
    manual: "ia-da-plataforma",
  },
  "ia/agente-de-ia-provedores/modelo-padrao-com-tela": {
    motivo: "Na MIA o modelo padrão é o da plataforma (lib/ai/modelo-da-plataforma.ts).",
    manual: "ia-da-plataforma",
  },
  // A marca é travada pela plataforma na MIA (MARCA_DA_ORGANIZACAO=travada,
  // lib/branding/marca-da-organizacao-no-fork.ts).
  "organizacao/organizacao-marca/cor-da-marca-no-tema-escuro": {
    motivo: "Na MIA a marca é definida pela plataforma, igual para todas as empresas.",
    manual: "marca",
  },
  "organizacao/organizacao-marca/dica-em-portugues-de-portugal": {
    motivo: "Na MIA a marca é definida pela plataforma, igual para todas as empresas.",
    manual: "marca",
  },
  "organizacao/organizacao-marca/logo-grande-e-ajustado": {
    motivo: "Na MIA a marca é definida pela plataforma, igual para todas as empresas.",
    manual: "marca",
  },
};

export interface TrechoDaMia extends TrechoDoGuia {
  /** A porta na MIA (depois das equivalências); `null` quando o trecho não tem tela. */
  tela: string | null;
}

const SO_DA_PLATAFORMA: ReadonlySet<string> = new Set(
  (NAV_CATALOG as readonly NavMetadata[]).filter((d) => d.somentePlataforma).map((d) => d.href),
);

function telaNaMia(href: string | null): string | null {
  if (!href) return null;
  return EQUIVALENCIAS_DO_FORK[href] ?? href;
}

/**
 * Os trechos que a busca usa: sem os superados, sem os de tela que é só da
 * plataforma (a chave e o custo da IA não são assunto da equipe do cliente).
 */
export const TRECHOS_DA_MIA: readonly TrechoDaMia[] = TRECHOS_DO_GUIA.filter((t) => !SUPERADOS_PELO_CODIGO[t.id])
  .map((t) => ({ ...t, tela: telaNaMia(t.href) }))
  .filter((t) => !(t.tela && SO_DA_PLATAFORMA.has(t.tela)));
