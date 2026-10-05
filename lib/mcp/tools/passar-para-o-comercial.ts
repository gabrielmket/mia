/**
 * `crm_passar_para_o_comercial` — FORK MIA. A passagem de bastão SDR → Comercial
 * numa chamada só.
 *
 * ─── O defeito que ela fecha ─────────────────────────────────────────────────
 *
 * Na Vita Odonto, passar o lead ao comercial exigia que o agente fizesse TRÊS
 * coisas antes de responder: salvar a ficha (`save_lead_note`), marcar a unidade
 * no contato (`crm_manage_tags`) e subir o funil passo a passo até `qualified`
 * (`update_lead_state` — a máquina não aceita salto). Medido no Testar em
 * 29/09/2026: gpt-5.6-luna completou 7 de 8; gpt-5.6-terra, 4 de 6. E a pior
 * falha é a MUDA: o agente diz ao cliente "vou encaminhar para a equipe, em breve
 * entrarão em contato" com ZERO ações — a equipe nunca fica sabendo.
 *
 * Três chamadas encadeadas são três chances de o modelo parar no meio. Aqui é
 * uma: se ela voltou `passado: true`, a ficha está salva, as etiquetas estão no
 * contato e o funil chegou a `qualified`.
 *
 * ─── Os MESMOS efeitos das três ferramentas separadas ────────────────────────
 *
 * Nenhum atalho: cada passo usa o código das ferramentas que ela substitui.
 *  - a ficha: `applySaveLeadNote` (o mesmo orçamento de índice do motor);
 *  - as etiquetas: o handler de `crm_manage_tags` — normalização, auditoria e o
 *    `contact.tag_added` que dispara as regras de etiqueta;
 *  - o funil: `applyLeadStateUpdate` um PASSO por vez (new → contacted →
 *    qualifying → qualified), e a cada avanço o espelho no card
 *    (`mirrorLeadStageToCrm`), que emite `lead.stage_changed` como o motor faz.
 *    A regra "etapa Qualificado → abre o card no Comercial" roda UMA vez, no
 *    passo que chega lá. Recusa do espelho vira aviso na Central, igual ao motor.
 *
 * ─── Idempotente ─────────────────────────────────────────────────────────────
 *
 * Lead já em `qualified`, `negotiating`, `won` ou `lost`: não faz nada — nem a
 * ficha, nem as etiquetas. Repetir a chamada no turno seguinte não duplica
 * aviso nem card. A resposta diz em que etapa ele já estava.
 *
 * ─── Nada pela metade ────────────────────────────────────────────────────────
 *
 * A ficha vem PRIMEIRO. Se ela não couber no índice de memória do lead, a
 * ferramenta devolve o ensino (consolidar com `supersedes`) e não mexe em mais
 * nada: passar o lead sem o resumo seria entregar ao time uma conversa crua.
 * Falha nas etiquetas não segura a passagem — a etiqueta é enfeite do card, o
 * funil é o que aciona o time —, mas a resposta diz que faltou.
 */
import { z } from "zod";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import {
  caminharAteQualificado,
  estagioAtual,
  JA_PASSOU,
  passosAteQualificado,
} from "@/lib/agent-engine/agent/caminhar-ate-qualificado";
import { applySaveLeadNote } from "@/lib/agent-engine/agent/lead-notes";
import type { CrmEdgeConfig } from "@/lib/agent-engine/edge/crm/mcp-client";
import { logger } from "@/lib/logger";

import type { McpToolDefinition } from "../types";
import { crmManageTags } from "./governance";

export const NOME_DA_FERRAMENTA = "crm_passar_para_o_comercial";

// O caminho (só passos válidos, nunca salto) e o laço com o espelho moram em
// `lib/agent-engine/agent/caminhar-ate-qualificado.ts`, compartilhados com a
// rede de segurança da passagem prometida.
export { passosAteQualificado };

/** O orçamento do índice de notas — o MESMO knob do motor (`LEAD_NOTES_INDEX_MAX_TOKENS`). */
function orcamentoDoIndiceDeNotas(): number {
  const n = Number.parseInt(process.env.LEAD_NOTES_INDEX_MAX_TOKENS ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : 500;
}

const shape = {
  contact_id: z.string().uuid().describe("O contato desta conversa."),
  ficha: z
    .object({
      headline: z
        .string()
        .min(1)
        .max(300)
        .describe("Uma linha: o que o cliente quer, onde e quando. Ex.: 'Implante · São Miguel · quinta à tarde'."),
      body: z
        .string()
        .min(1)
        .max(4000)
        .describe("O resumo da qualificação para o time: necessidade, unidade, disponibilidade, o que já foi combinado."),
      supersedes: z
        .array(z.string().min(1).max(64))
        .max(50)
        .optional()
        .describe("Ids de notas antigas deste lead que esta ficha substitui (vistos no índice de memória)."),
    })
    .describe("A ficha da qualificação — é ela que chega ao time."),
  etiquetas: z
    .array(z.string())
    .max(20)
    .optional()
    .describe("Etiquetas para marcar no contato junto com a passagem (ex.: a unidade escolhida)."),
  motivo: z
    .string()
    .min(1)
    .max(500)
    .describe("A evidência curta da qualificação, tirada da conversa (vai para o histórico do funil)."),
  qualificacao: z
    .object({
      budget: z.string().max(300).optional(),
      authority: z.string().max(300).optional(),
      need: z.string().max(300).optional(),
      timeline: z.string().max(300).optional(),
    })
    .optional()
    .describe("Qualificação, se houver: budget, authority, need, timeline."),
  proxima_acao: z
    .string()
    .max(500)
    .optional()
    .describe("A próxima ação combinada com o cliente, se houver."),
};

export const crmPassarParaOComercial: McpToolDefinition<typeof shape> = {
  name: "crm_passar_para_o_comercial",
  description:
    "Passa o cliente QUALIFICADO para o time comercial, numa chamada só: salva a ficha da " +
    "qualificação, marca as etiquetas pedidas no contato e avança o funil até 'qualificado' pelos " +
    "passos válidos — o que avisa o time e abre o atendimento comercial. " +
    "QUANDO USAR: assim que o cliente estiver qualificado e ANTES de dizer a ele que vai passar, " +
    "encaminhar ou que a equipe vai entrar em contato. Nunca diga isso ao cliente sem ter chamado " +
    "esta ferramenta e recebido `passado: true` — sem ela, a equipe não fica sabendo. " +
    "Se o cliente já estava qualificado (ou o negócio encerrado), ela não faz nada e diz em que etapa ele está. " +
    "Substitui a sequência save_lead_note + crm_manage_tags + update_lead_state na passagem.",
  inputSchema: shape,
  category: "write",
  requiresRole: "ai_operator",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data: contato, error: erroContato } = await ctx.supabase
      .from("contacts")
      .select("id, is_anonymized")
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.contact_id)
      .maybeSingle();
    if (erroContato) throw new Error(erroContato.message);
    if (!contato) return { passado: false, motivo: "contato_nao_encontrado", mensagem: "não encontrei esse contato nesta conta." };
    if ((contato as { is_anonymized?: boolean }).is_anonymized) {
      return {
        passado: false,
        motivo: "contato_anonimizado",
        mensagem: "este contato exerceu o direito de exclusão de dados; não é possível registrar a passagem.",
      };
    }

    const pool = getRequestPool();
    const ids = { tenantId: ctx.organizationId, leadId: input.contact_id };

    // ── IDEMPOTÊNCIA: já passou (ou encerrou) → nada acontece ────────────────
    const atual = await estagioAtual(pool, ids.tenantId, ids.leadId);
    if (JA_PASSOU.has(atual)) {
      return {
        passado: false,
        ja_estava: atual,
        mensagem:
          atual === "qualified" || atual === "negotiating"
            ? `o cliente já tinha sido passado ao time (etapa "${atual}"); nada foi repetido.`
            : `o negócio deste cliente já está encerrado (etapa "${atual}"); nada foi feito.`,
      };
    }
    const passos = passosAteQualificado(atual);
    if (!passos) {
      return {
        passado: false,
        motivo: "caminho_invalido",
        mensagem: `não há caminho válido de "${atual}" até "qualified"; nada foi feito.`,
      };
    }

    // ── 1. A FICHA, primeiro: sem ela, não há passagem ────────────────────────
    const ficha = await applySaveLeadNote(pool, ids, { budgetTokens: orcamentoDoIndiceDeNotas() }, {
      headline: input.ficha.headline,
      body: input.ficha.body,
      ...(input.ficha.supersedes ? { supersedes: input.ficha.supersedes } : {}),
    });
    if (!ficha.ok) {
      return { passado: false, motivo: `ficha_${ficha.error.code}`, mensagem: `${ficha.error.message} Nada mais foi feito.` };
    }

    // ── 2. As ETIQUETAS, pelo handler de crm_manage_tags (auditoria + evento) ──
    let etiquetas: { aplicadas: string[] } | { erro: string } | null = null;
    if (input.etiquetas && input.etiquetas.length > 0) {
      try {
        const r = (await crmManageTags.handler(
          { target_kind: "contact", target_id: input.contact_id, add: input.etiquetas },
          ctx,
        )) as { tags: string[] };
        etiquetas = { aplicadas: r.tags };
      } catch (err) {
        // A passagem segue: a etiqueta é enfeite do card; o funil é o que aciona o time.
        etiquetas = { erro: err instanceof Error ? err.message : String(err) };
      }
    }

    // ── 3. O FUNIL, um passo válido por vez, com o espelho no card ────────────
    const cfg: CrmEdgeConfig = { supabase: ctx.supabase };
    const caminho = await caminharAteQualificado(
      pool,
      cfg,
      { tenantId: ids.tenantId, contactId: ids.leadId, jobId: ctx.sourceJobId ?? null },
      {
        motivo: input.motivo,
        ...(input.qualificacao ? { qualificacao: input.qualificacao } : {}),
        ...(input.proxima_acao !== undefined ? { proximaAcao: input.proxima_acao } : {}),
      },
    );
    if (!caminho.ok) {
      // Não deveria acontecer (o caminho foi conferido antes da ficha), e por
      // isso é log de erro: a passagem parou no meio e o modelo precisa saber.
      logger.error("[crm_passar_para_o_comercial] a passagem parou no meio", {
        organization_id: ctx.organizationId,
        motivo: caminho.motivo,
      });
      return {
        passado: false,
        motivo: caminho.motivo,
        mensagem:
          caminho.motivo === "maquina_recusou"
            ? `a passagem parou em "${caminho.passo}": ${caminho.mensagem}`
            : `o funil não pôde andar (${caminho.motivo}).`,
        ficha_salva: true,
        etiquetas,
        ...("card" in caminho ? { card: caminho.card } : {}),
      };
    }
    const card = caminho.card;
    const passosFeitos = caminho.etapas;

    return {
      passado: true,
      de: atual,
      etapas: passosFeitos,
      ficha_salva: true,
      etiquetas,
      card,
      mensagem:
        "passagem registrada: a ficha foi salva e o funil chegou a 'qualificado' — o time foi acionado. " +
        "Agora pode dizer ao cliente que a equipe vai dar sequência.",
    };
  },
};
