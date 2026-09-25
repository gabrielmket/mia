-- ⚠️ 25/09/2026 — ABSORVIDA pela 0385 do upstream, que faz o mesmo CHECK. NAO e aplicada por baseline-mia.sql: repeti-la redefiniria a constraint dele.
-- A regra do fork: estender, nunca redefinir (scripts/separar-baseline-mia.mjs).
-- A versao original desta migration continua no historico do git.

-- 0252 — `crm_save_org_memory` passa a funcionar: a origem 'agent' existe
--
-- A ferramenta MCP `crm_save_org_memory` (`lib/mcp/tools/evolucao.ts`) grava
-- `source: "agent"`. O CHECK da 0067 aceita `('manual', 'flywheel')`. A
-- ferramenta NUNCA funcionou: toda chamada morre em `23514` e volta ao agente
-- como `gravar_memoria_falhou`.
--
-- ── Qual lado alinhar, e por que ESTE ───────────────────────────────────────
--
-- Havia dois consertos possíveis, e o barato é o errado.
--
-- O barato seria trocar o handler para `source: 'manual'`. Uma linha, sem
-- migration, e destrói a única coisa que a coluna existe para responder. A
-- própria descrição da ferramenta — que o modelo lê — promete: "Nasce com origem
-- 'agent' para o humano distinguir o que a IA anotou do que ele mesmo escreveu".
-- Gravar 'manual' faria a anotação da IA chegar à tela de Memória da IA
-- indistinguível de política que um gestor digitou, e política da empresa é
-- exatamente o tipo de texto em que essa diferença decide se alguém confere
-- antes de obedecer. Seria trocar um erro RUIDOSO (a ferramenta falha e o agente
-- sabe) por um erro SILENCIOSO (a ferramenta grava e mente sobre a autoria).
--
-- Alargar o CHECK é o conserto que preserva o desenho. `source` já é a coluna de
-- PROCEDÊNCIA — 'flywheel' está lá justamente para separar o que a destilação
-- propôs do que uma pessoa escreveu. 'agent' é o terceiro caso legítimo da mesma
-- pergunta, e o único que faltava.
--
-- ⚠️ Alargar um CHECK é seguro na direção em que estamos indo: nenhuma linha
-- existente viola o conjunto MAIOR, então o `update.sh` de qualquer clone passa.
-- O caminho contrário (estreitar) é o que quebra, e é por isso que este arquivo
-- solta e recria a constraint em vez de tentar um `add constraint` que falharia
-- na segunda aplicação.
--
-- O par em TypeScript nasce no mesmo commit (`lib/ai/org-memory-source.ts` →
-- `ORIGENS_DA_MEMORIA`), registrado no invariante de vocabulário: é a lição da
-- lista de pares, em que todos os que divergiram divergiram por terem nascido
-- sozinhos.

alter table public.org_memory_entries
  drop constraint if exists org_memory_entries_source_check;
alter table public.org_memory_entries
  add constraint org_memory_entries_source_check
  check (source in ('manual', 'flywheel', 'agent'));

comment on column public.org_memory_entries.source is
  'PROCEDENCIA da anotacao: manual (uma pessoa escreveu), flywheel (a destilacao propos e alguem aprovou) ou agent (a IA anotou sozinha, pela ferramenta MCP crm_save_org_memory). A distincao nao e enfeite: isto e politica da empresa que todo agente obedece, e quem le precisa saber se um humano assinou. Ate a 0252 o CHECK nao tinha agent e a ferramenta MCP falhava em 23514 a cada chamada. Par em lib/ai/org-memory-source.ts (ORIGENS_DA_MEMORIA).';
