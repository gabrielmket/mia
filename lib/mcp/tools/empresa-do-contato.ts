/**
 * `crm_registrar_empresa_do_contato` — a empresa que o cliente disse ser dele.
 *
 * ─── Por que esta ferramenta existe ────────────────────────────────────────
 *
 * A entidade empresa nasceu (migration 0255) e o agente não tinha como
 * preenchê-la: o campo existia na tela e nascia vazio em toda conversa. Pedir
 * ao operador que abrisse a ficha depois de cada atendimento para digitar o
 * nome da empresa é o tipo de trabalho que não acontece — e um campo que nunca
 * se preenche é pior que campo nenhum, porque a tela promete um agrupamento
 * que os dados não têm.
 *
 * ─── Por que ela GRAVA, ao contrário de `crm_propose_contact_field` ───────
 *
 * Aquela propõe porque corrige dado de identidade: trocar o nome ou o telefone
 * de um contato por algo mal ouvido estraga o cadastro e pode mandar mensagem
 * para a pessoa errada. Aqui é outra coisa — é um fato NOVO sobre um contato
 * que não tinha empresa, e o pior caso é um vínculo errado que qualquer pessoa
 * desfaz na ficha, com o histórico inteiro preservado.
 *
 * O que protege da bagunça é o casamento por nome comparável
 * (`lib/empresas/achar-ou-criar.ts`): "Padaria do Zé", "padaria do ze" e
 * "PADARIA DO ZÉ LTDA" caem na MESMA empresa. Sem isso, a quinta conversa
 * criaria a quinta ficha e a pergunta que justifica a entidade — quanto já
 * vendemos para eles — passaria a responder errado para sempre.
 *
 * ─── O que ela NUNCA faz ──────────────────────────────────────────────────
 *
 * Não troca a empresa de um contato que já tem uma. Um cliente que menciona a
 * empresa do sócio, do cliente dele ou do concorrente não pode mudar o próprio
 * vínculo por causa de uma frase — e desfazer isso depois exige saber que
 * aconteceu. Quando já há empresa, a ferramenta responde dizendo qual é, e o
 * modelo decide se vale a pena perguntar.
 */
import { z } from "zod";

import { acharOuCriarEmpresa } from "@/lib/empresas/achar-ou-criar";

import type { McpToolDefinition } from "../types";

const shape = {
  contact_id: z.string().uuid(),
  empresa: z
    .string()
    .min(2)
    .max(200)
    .describe("O nome da empresa exatamente como a pessoa disse."),
  cargo: z
    .string()
    .max(120)
    .optional()
    .describe("O cargo dela na empresa, se tiver dito. Não pergunte só para preencher."),
};

export const crmRegistrarEmpresaDoContato: McpToolDefinition<typeof shape> = {
  name: "crm_registrar_empresa_do_contato",
  description:
    "Registra de qual EMPRESA o cliente faz parte, quando ele mesmo disser. Grava direto: se já " +
    "existir uma empresa com esse nome (ignorando maiúsculas, acentos e Ltda/ME), o contato é " +
    "vinculado a ela; se não, ela é criada. NÃO troca a empresa de um contato que já tem uma — " +
    "nesse caso a resposta diz qual é e nada muda. Use só para a empresa DO PRÓPRIO cliente, " +
    "nunca para a de um terceiro que ele citou.",
  inputSchema: shape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data: contato } = await ctx.supabase
      .from("contacts")
      .select("id, empresa_id, is_anonymized")
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.contact_id)
      .maybeSingle();

    if (!contato) {
      return { gravado: false, motivo: "não encontrei esse contato nesta conta." };
    }
    const linha = contato as { empresa_id: string | null; is_anonymized: boolean };
    if (linha.is_anonymized) {
      return {
        gravado: false,
        motivo:
          "esse contato exerceu o direito de exclusão de dados; não é possível registrar informações dele.",
      };
    }

    if (linha.empresa_id) {
      const { data: atual } = await ctx.supabase
        .from("crm_empresas")
        .select("nome")
        .eq("organization_id", ctx.organizationId)
        .eq("id", linha.empresa_id)
        .maybeSingle();
      return {
        gravado: false,
        ja_tem_empresa: (atual as { nome?: string } | null)?.nome ?? null,
        motivo:
          "este contato já está vinculado a uma empresa; trocar exige uma pessoa fazer isso na ficha.",
      };
    }

    const r = await acharOuCriarEmpresa(ctx.supabase, ctx.organizationId, input.empresa);
    if (!r.ok) {
      const explicacao: Record<string, string> = {
        nome_curto: "esse nome é curto demais para identificar uma empresa — confirme com a pessoa.",
        erro: "não consegui registrar a empresa agora.",
      };
      return { gravado: false, motivo: explicacao[r.motivo] ?? explicacao.erro };
    }

    const patch: Record<string, unknown> = { empresa_id: r.empresaId };
    // O cargo só entra junto: ele é da pessoa DENTRO daquela empresa, e gravá-lo
    // sem vínculo deixaria "Diretor" pendurado em ninguém.
    if (input.cargo?.trim()) patch.cargo = input.cargo.trim();

    const { error } = await ctx.supabase
      .from("contacts")
      .update(patch)
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.contact_id);
    if (error) return { gravado: false, motivo: "não consegui vincular o contato à empresa agora." };

    return {
      gravado: true,
      empresa: r.nome,
      // `criada` diz ao modelo se ele acabou de inventar uma ficha nova ou se
      // encontrou uma que já existia — e é a diferença entre "anotei" e
      // "reconheci você como cliente daquela empresa".
      criada: r.criada,
    };
  },
};
