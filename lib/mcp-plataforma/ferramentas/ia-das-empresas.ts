/**
 * FORK MIA (MIA-218) · A IA DE CADA EMPRESA, no MCP de plataforma
 * (docs/fork/ia-da-plataforma.md). Uma, e só de leitura:
 *
 *   plataforma_ver_ia_das_empresas   por empresa: segue a plataforma ou tem escolha própria, o par em vigor e de onde sai a chave
 *
 * A régua é a de `iaDasEmpresas` (`lib/ai/ia-da-empresa.ts`, MIA-217), a mesma
 * do cartão do admin, da `/health` e do relatório interno: a contagem que esta
 * ferramenta devolve é a que eles mostram (`contarEmpresas`, só as operantes).
 *
 * SEM ferramenta de troca, de propósito: trocar o modelo de uma empresa ou da
 * plataforma é ato de pessoa, com MFA, no painel (Admin › Modelo de IA, ou a
 * tela Provedores de IA da empresa em modo suporte). Daqui sai só o que ver.
 *
 * Nunca devolve chave: `chave` diz só DE ONDE ela sairia (`propria`,
 * `instalacao`) ou que não há nenhuma (`null`).
 *
 * FORK MIA (MIA-309): por empresa, os agentes publicados e quantos respondem
 * FORA do par em vigor, com a regra da carga da versão
 * (`lib/ai/agente-segue-a-plataforma.ts`). Para quem segue tem de dar zero: é a
 * prova de que a troca em Admin › Modelo de IA chegou aos agentes.
 */
import { z } from "zod";

import { contarEmpresas, iaDasEmpresas, nomeDoProvedor } from "@/lib/ai/ia-da-empresa";
// FORK MIA (MIA-309): os agentes publicados fora do par em vigor.
import { agentesForaDoPar, agentesPublicados } from "@/lib/ai/agente-segue-a-plataforma";

import { recusar } from "../recusa";
import type { FerramentaDePlataforma } from "../tipos";

export const FERRAMENTAS_DA_IA_DAS_EMPRESAS: FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_ia_das_empresas",
    description:
      "A IA de cada empresa da instalação: se ela SEGUE a IA da plataforma (`origem: \"plataforma\"`, o par de Admin › Modelo de IA) ou tem ESCOLHA PRÓPRIA (`origem: \"propria\"`), " +
      "o par em vigor (`provedor`, `provedor_nome` e `modelo`; `modelo: null` = o modelo padrão do provedor) e de onde sai a chave desse provedor: " +
      "`chave: \"propria\"` (a empresa cadastrou e validou uma), `\"instalacao\"` (a chave da plataforma) ou `null` = NENHUMA chave utilizável, e a empresa não responde com IA. " +
      "`contagem` traz quantas empresas OPERANTES seguem, quantas têm escolha própria e quantas estão sem chave: os mesmos números do cartão do admin, da `/health` e do relatório interno " +
      "(empresa suspensa ou anonimizada aparece na lista com `operante: false`, mas não conta). " +
      "`jev_sem_chave: true` = o Jev está ligado e a empresa não tem chave validada da origem dele (TypeSafe ou OpenRouter): a IA de sempre cobre, mas o Jev não decide. " +
      "`agentes_publicados` e `agentes_fora_do_par` (MIA-309): quantos agentes publicados a empresa tem e quantos respondem num par diferente do em vigor, já com a regra do turno " +
      "(quem segue a plataforma responde no par dela, mesmo com a versão gravada noutro modelo): para quem segue TEM DE DAR ZERO; na escolha própria, é o agente num modelo diferente do padrão da empresa " +
      "(pode ser de propósito). `agentes` soma as operantes, com `fora_do_par_de_quem_segue` (zero = a troca de modelo chegou a todos). `null` = a leitura dos agentes falhou. " +
      "`so_sem_chave: true` lista só as sem chave; `organization_id` lista só uma. As sem chave vêm primeiro. " +
      "Nunca devolve a chave em si. Não troca nada: trocar o modelo é no painel, por uma pessoa, com MFA. Só lê.",
    inputSchema: {
      so_sem_chave: z
        .boolean()
        .optional()
        .describe("true = só as empresas sem chave utilizável para o padrão delas (as que não respondem com IA)."),
      organization_id: z
        .string()
        .uuid()
        .optional()
        .describe("Só esta empresa (o id vem de plataforma_listar_clientes). Ausente: todas."),
    },
    exemplo: { so_sem_chave: true },
    operacao: null,
    handler: async ({ admin }, args) => {
      const soSemChave = args.so_sem_chave === true;
      const uma = typeof args.organization_id === "string" ? args.organization_id : null;

      // `iaDasEmpresas` já traz o nome e se a empresa opera: uma leitura só.
      const [empresas, agentes] = await Promise.all([iaDasEmpresas(admin), agentesPublicados(admin)]);
      if (empresas === null) throw new Error("não consegui ler a IA das empresas (organizations ou ai_provider_credentials).");

      if (uma !== null && !empresas.some((e) => e.organizationId === uma)) {
        recusar(
          `Não existe organização com o id ${uma}. Confira o id em plataforma_listar_clientes, ou chame sem organization_id para ver todas.`,
        );
      }

      // FORK MIA (MIA-309): `null` = não sei (a leitura dos agentes falhou), nunca zero.
      const foraDoPar = agentes === null ? null : agentesForaDoPar(empresas, agentes);

      const linhas = empresas
        .filter((e) => (uma === null || e.organizationId === uma) && (!soSemChave || e.chave === null))
        .map((e) => ({
          organization_id: e.organizationId,
          empresa: e.nome,
          status: e.status,
          operante: e.operante,
          origem: e.origem,
          provedor: e.provider,
          provedor_nome: nomeDoProvedor(e.provider),
          modelo: e.modelId,
          chave: e.chave,
          // FORK MIA (MIA-262): o Jev ligado sem chave validada da origem dele.
          jev_sem_chave: e.jevSemChave,
          // FORK MIA (MIA-309): os agentes publicados e os que respondem fora do par em vigor.
          agentes_publicados: foraDoPar?.get(e.organizationId)?.publicados ?? (foraDoPar ? 0 : null),
          agentes_fora_do_par: foraDoPar?.get(e.organizationId)?.foraDoPar ?? (foraDoPar ? 0 : null),
        }))
        .sort(
          (a, b) =>
            Number(b.chave === null) - Number(a.chave === null) ||
            (a.empresa ?? "").localeCompare(b.empresa ?? "", "pt-BR") ||
            a.organization_id.localeCompare(b.organization_id),
        );

      const operantes = empresas.filter((e) => e.operante);
      const somar = (lista: ReadonlyArray<{ organizationId: string }>, campo: "publicados" | "foraDoPar") =>
        lista.reduce((n, e) => n + (foraDoPar?.get(e.organizationId)?.[campo] ?? 0), 0);

      return {
        contagem: contarEmpresas(empresas),
        agentes:
          foraDoPar === null
            ? null
            : {
                publicados: somar(operantes, "publicados"),
                fora_do_par: somar(operantes, "foraDoPar"),
                fora_do_par_de_quem_segue: somar(
                  operantes.filter((e) => e.origem === "plataforma"),
                  "foraDoPar",
                ),
              },
        total: linhas.length,
        empresas: linhas,
      };
    },
  },
];
