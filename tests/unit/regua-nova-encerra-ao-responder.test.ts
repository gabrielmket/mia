/**
 * O PADRÃO DA RÉGUA QUANDO O LEAD RESPONDE (item B1-a).
 *
 * ── A pergunta que estava aberta ──────────────────────────────────────────
 *
 * Um lead está numa régua de follow-up, parado num nó de espera. Ele responde.
 * O que a régua faz para quem não configurou nada?
 *
 *   1. Segue em frente — a resposta acorda a espera e o motor vai para o passo
 *      seguinte. Se o passo seguinte for a despedida, ela se despede de alguém
 *      que acabou de falar com a gente.
 *   2. Encerra — respondeu, a régua cumpriu o papel e sai de cena.
 *   3. Sai por uma porta desenhada pelo autor da régua.
 *
 * A (1) estava no ar por OMISSÃO: `trigger_config` nascia `{"kind":"manual"}`,
 * e `cancel_on_reply` ausente resolve para `false`. Ninguém defendeu esse
 * comportamento — é o valor que sobrou de o campo não existir ainda quando as
 * primeiras réguas foram escritas.
 *
 * ── O que estes casos protegem ────────────────────────────────────────────
 *
 * O risco não é o padrão novo: é ele VAZAR para as réguas que já existem. Uma
 * régua viva que mudasse de comportamento num deploy daria o sintoma dias
 * depois, num lead que deixou de receber o follow-up que recebia — e ninguém
 * ligaria uma coisa à outra.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../..");
const BASELINE = fs.readFileSync(path.join(RAIZ, "supabase/baseline.sql"), "utf8");
const MIGRATION = fs.readFileSync(
  path.join(RAIZ, "supabase/migrations/20260920070000_0270_regua_nova_encerra_ao_responder.sql"),
  "utf8",
);

describe("o padrão da régua nova", () => {
  it("nasce encerrando quando o lead responde", () => {
    expect(
      BASELINE.includes(
        `trigger_config jsonb not null default '{"kind":"manual","cancel_on_reply":true}'`,
      ),
      "o default de `followup_flows.trigger_config` voltou a nascer sem " +
        "`cancel_on_reply` — e régua nova volta a se despedir de quem acabou de responder",
    ).toBe(true);
  });

  it("o banco que já existe também recebe o default novo", () => {
    // Sem o `alter column ... set default` no apêndice, a instalação que já
    // rodou o baseline uma vez ficaria com o default antigo para sempre: a
    // tabela não é recriada num re-aplique.
    expect(
      BASELINE.includes("alter column trigger_config"),
      "o apêndice da 0270 sumiu do baseline — instalação existente não recebe o default novo",
    ).toBe(true);
  });

  it("NÃO existe update em massa: régua viva não muda de comportamento", () => {
    // A restrição É a decisão. Um `update public.followup_flows set ...` aqui
    // mudaria o que as réguas dos clientes fazem numa conversa em andamento,
    // sem ninguém ter pedido.
    expect(
      /update\s+(public\.)?followup_flows\s+set/i.test(MIGRATION),
      "a migration passou a escrever nas réguas existentes — isso muda o " +
        "comportamento de conversas em andamento, e é decisão de quem opera a régua",
    ).toBe(false);
  });

  it("a migration carimba o schema, como toda migration desde a 0268", () => {
    expect(MIGRATION.includes("insert into public.schema_baseline")).toBe(true);
  });
});

describe("a tela explica os DOIS lados da chave", () => {
  const TELA = fs.readFileSync(
    path.join(
      RAIZ,
      "app/app/ai/followups/[id]/_components/TriggerConfigControl.tsx",
    ),
    "utf8",
  );

  it("diz o que acontece com a chave DESLIGADA", () => {
    // O rótulo sozinho ("Cancelar se o lead responder") descreve o estado
    // ligado e deixa o outro invisível — e é o desligado que produz o defeito.
    expect(
      TELA.includes("avança para o passo seguinte"),
      "a tela voltou a não dizer o que acontece quando a chave está desligada",
    ).toBe(true);
  });

  it("diz o que acontece com a chave LIGADA", () => {
    expect(TELA.includes("a régua sai de cena")).toBe(true);
  });
});
