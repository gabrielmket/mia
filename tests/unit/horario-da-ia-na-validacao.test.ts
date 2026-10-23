// @vitest-environment node
/**
 * FORK MIA (.85) — o horário da IA PASSA pela validação da versão.
 *
 * O schema de `filters` é um `z.object` que DESCARTA chave que não conhece: sem
 * a declaração, a tela salvaria o horário, o servidor jogaria fora em silêncio
 * e o agente seguiria respondendo a qualquer hora. Aqui se prova que o campo
 * atravessa o `versionCreateSchema` e o `versionPatchSchema` (os dois caminhos
 * da tela e do MCP), e que a régua de gravação é a do módulo do horário.
 */
import { describe, expect, it } from "vitest";

import { MENSAGEM_SEM_FAIXA } from "@/lib/agent-engine/agent/horario-da-ia";
import { versionCreateSchema, versionPatchSchema } from "@/lib/ai/agents/validation";

const BASE = {
  system_prompt: "Você é a assistente da Vita Odonto, em teste.",
  provider: "openai" as const,
  model: "gpt-test",
  credential_id: null,
  channel_session_id: null,
};

const HORARIO = {
  fuso: "America/Sao_Paulo",
  faixas: [
    { dias: [1, 2, 3, 4, 5], inicio: "00:00", fim: "10:00" },
    { dias: [1, 2, 3, 4, 5], inicio: "17:30", fim: "24:00" },
  ],
};

const gatilho = (horario: unknown) => ({
  events: ["message"],
  concurrency: "one_per_conversation",
  filters: { ignore_groups: true, ignore_self: true, keyword_regex: null, business_hours: null, horario_da_ia: horario },
});

function mensagens(resultado: { success: boolean; error?: { issues: Array<{ message: string }> } }): string[] {
  return resultado.success ? [] : (resultado.error?.issues ?? []).map((i) => i.message);
}

describe("o horário da IA na validação da versão", () => {
  it("o campo atravessa o schema de criação e o de edição do rascunho", () => {
    const criada = versionCreateSchema.parse({ ...BASE, trigger_config: gatilho(HORARIO) });
    expect(criada.trigger_config?.filters.horario_da_ia).toEqual(HORARIO);
    const editada = versionPatchSchema.parse({ trigger_config: gatilho(HORARIO) });
    expect(editada.trigger_config?.filters.horario_da_ia).toEqual(HORARIO);
  });

  it("versão sem horário continua sem a chave (o motor lê 'responde a qualquer hora')", () => {
    const sem = versionCreateSchema.parse({ ...BASE, trigger_config: { events: ["message"] } });
    expect(sem.trigger_config?.filters).not.toHaveProperty("horario_da_ia");
    const nulo = versionCreateSchema.parse({ ...BASE, trigger_config: gatilho(null) });
    expect(nulo.trigger_config?.filters.horario_da_ia).toBeNull();
  });

  it("zero faixas é recusado com a frase da tela e do MCP", () => {
    const r = versionCreateSchema.safeParse({ ...BASE, trigger_config: gatilho({ fuso: "America/Sao_Paulo", faixas: [] }) });
    expect(r.success).toBe(false);
    expect(mensagens(r)).toContain(MENSAGEM_SEM_FAIXA);
  });

  it("a faixa que passa da meia-noite, o início 24:00 e o fuso inexistente são recusados", () => {
    const vira = versionCreateSchema.safeParse({
      ...BASE,
      trigger_config: gatilho({ fuso: "America/Sao_Paulo", faixas: [{ dias: [5], inicio: "22:00", fim: "02:00" }] }),
    });
    expect(mensagens(vira).join(" ")).toContain("passa da meia-noite");
    const inicio24 = versionCreateSchema.safeParse({
      ...BASE,
      trigger_config: gatilho({ fuso: "America/Sao_Paulo", faixas: [{ dias: [5], inicio: "24:00", fim: "24:00" }] }),
    });
    expect(inicio24.success).toBe(false);
    const fuso = versionCreateSchema.safeParse({ ...BASE, trigger_config: gatilho({ ...HORARIO, fuso: "Brasil/Recepção" }) });
    expect(mensagens(fuso).join(" ")).toContain("fuso");
  });

  it("chave a mais dentro do horário é recusada (o dado não carrega o que o motor não lê)", () => {
    const r = versionCreateSchema.safeParse({ ...BASE, trigger_config: gatilho({ ...HORARIO, aviso: "volto já" }) });
    expect(r.success).toBe(false);
  });

  it("o horário do upstream (business_hours) segue aceito como antes", () => {
    const antigo = versionCreateSchema.parse({
      ...BASE,
      trigger_config: {
        events: ["message"],
        filters: { business_hours: { timezone: "America/Sao_Paulo", start: "08:00", end: "18:00", weekdays: [1, 2, 3, 4, 5] } },
      },
    });
    expect(antigo.trigger_config?.filters.business_hours?.start).toBe("08:00");
  });
});
