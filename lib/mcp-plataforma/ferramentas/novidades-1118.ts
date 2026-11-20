/**
 * FORK MIA (upstream 1.118, MIA-79): as duas ferramentas que a faixa 1.117 a
 * 1.118 pediu ao MCP de plataforma.
 *
 *   plataforma_definir_modulo_da_empresa   `gerir_modulo_opcional`: liga,
 *                                          desliga ou devolve ao padrão UM
 *                                          módulo opcional do upstream para
 *                                          UMA empresa (9416, #3868)
 *   plataforma_definir_tela_inicial        `implantar_configuracao`: a tela que
 *                                          abre depois de entrar, da empresa
 *                                          ou de uma pessoa (#4864)
 *
 * As leituras moram nas ferramentas que já existiam: os módulos em
 * plataforma_ver_cliente (`modulos_opcionais`) e a tela inicial em
 * plataforma_ver_configuracao (seção `equipe`). As operações moram em
 * `lib/implantacao/modulos-da-empresa.ts` e `lib/implantacao/tela-inicial.ts`.
 *
 * Nenhuma das duas envia mensagem, então a trava da demonstração não tem o que
 * barrar: na empresa de demonstração elas valem como em qualquer outra.
 */
import { z } from "zod";

import { definirModuloDaEmpresa } from "@/lib/implantacao/modulos-da-empresa";
import { definirTelaInicial } from "@/lib/implantacao/tela-inicial";
import { MODULOS_POR_EMPRESA } from "@/lib/instalacao/modulos";
import { ESTADOS_DO_MODULO_NA_EMPRESA } from "@/lib/instalacao/modulos-por-empresa";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";

import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

export const OPERACAO_GERIR_MODULO_OPCIONAL = "gerir_modulo_opcional";

const TELAS = NAV_CATALOG.map((d) => d.href) as [string, ...string[]];

export const FERRAMENTAS_DA_FAIXA_1118: FerramentaDePlataforma[] = [
  {
    name: "plataforma_definir_modulo_da_empresa",
    description:
      "Liga, desliga ou devolve ao padrão UM módulo OPCIONAL da instalação para UMA empresa (a tela \"Por empresa\" de /admin/sistema). " +
      "Três estados: `herda` (o padrão: segue a instalação), `desligado` (tira o módulo SÓ desta empresa) e `ligado`. A instalação é o TETO: " +
      "módulo desligado na instalação não se liga para uma empresa (recusa), e com ele ligado `ligado` e `herda` dão o mesmo efeito. " +
      "DESLIGAR some com as telas e as rotas do módulo para a equipe da empresa, e o que o módulo faz sozinho para (ex.: fluxos de atendimento: a IA deixa de seguir o roteiro; " +
      "cold call: a fila de ligações some). Não apaga nada do módulo: religar traz tudo de volta. A trilha grava `organization.modulo_updated`. " +
      "Pedido igual ao estado atual responde `ja_estava` e não escreve. " +
      "ANTES DE: veja em plataforma_ver_cliente (`modulos_opcionais`) o estado de cada módulo e combine com a empresa. " +
      "O QUE NÃO FAZ: não mexe nos módulos VENDIDOS (esses são plataforma_liberar_modulo), não liga nada na instalação e não muda a lista de capacidades oferecidas ao agente, " +
      "que segue a instalação como a tela do agente.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      modulo: z.enum(MODULOS_POR_EMPRESA).describe(`O módulo opcional: ${MODULOS_POR_EMPRESA.join(", ")}.`),
      estado: z
        .enum(ESTADOS_DO_MODULO_NA_EMPRESA)
        .describe("`herda` volta ao padrão da instalação (apaga a exceção), `desligado` tira o módulo desta empresa, `ligado` confirma ligado."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, modulo: "cold_call", estado: "desligado" },
    operacao: OPERACAO_GERIR_MODULO_OPCIONAL,
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      return definirModuloDaEmpresa(c, {
        modulo: args.modulo as (typeof MODULOS_POR_EMPRESA)[number],
        estado: args.estado as (typeof ESTADOS_DO_MODULO_NA_EMPRESA)[number],
      });
    },
  },

  {
    name: "plataforma_definir_tela_inicial",
    description:
      "Escolhe a TELA INICIAL: a tela que abre logo depois de entrar no sistema. Sem `pessoa`, é a da EMPRESA (Configurações › Empresa › Menu lateral), " +
      "que vale para todo mundo; com `pessoa`, é a daquela pessoa (Equipe › Interface do membro), e a da pessoa vence a da empresa. " +
      "`tela: null` volta ao padrão (o Inbox, ou a primeira área do menu quando o Inbox está oculto). " +
      "Só aceita uma área que está no menu de quem vai entrar (a recusa lista as opções), porque a entrada nunca abre tela que a pessoa não enxerga. " +
      "Pedido igual ao atual responde `ja_estava` e não escreve. " +
      "QUANDO USAR: quem opera um nicho entra sempre pela mesma tela (a vendedora pelo quadro de negócios, a recepção pela agenda). " +
      "O QUE NÃO FAZ: não mostra nem esconde área do menu, não muda papel nem permissão, e a escolha vale a partir da próxima entrada.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      tela: z
        .enum(TELAS)
        .nullable()
        .describe('O endereço da tela, ex.: "/app/kanban" (negócios) ou "/app/agenda". As opções de cada um saem de plataforma_ver_configuracao, seção equipe. null volta ao padrão.'),
      pessoa: z
        .string()
        .trim()
        .min(1)
        .max(320)
        .optional()
        .describe("E-mail (ou user_id) de uma pessoa da equipe que já aceitou o convite. Sem isto, a tela é a da empresa."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, tela: "/app/kanban" },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      return definirTelaInicial(c, {
        tela: (args.tela as string | null | undefined) ?? null,
        ...(typeof args.pessoa === "string" ? { pessoa: args.pessoa } : {}),
      });
    },
  },
];
