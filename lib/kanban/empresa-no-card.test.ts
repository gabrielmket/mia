import { describe, expect, it } from "vitest";

import { buildCardInput } from "./card-state";

/**
 * A EMPRESA NO CARD NÃO PODE CUSTAR NADA A QUEM NÃO A USA.
 *
 * O card do funil tem uma regra escrita desde o começo: dado sem propósito não
 * ocupa linha (§5). A maioria das instalações vende para PESSOA — clínica,
 * academia, estética —, e nelas `empresa` é nulo em todo negócio.
 *
 * Então a prova que importa não é "o nome aparece". É: com tenant B2C, o card
 * continua EXATAMENTE o que era. Se um dia alguém reservar altura para este
 * campo "para não pular o layout", é este caso que fica vermelho.
 *
 *     npx vitest run lib/kanban/empresa-no-card.test.ts
 */

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Orçamento 300 pães",
  value_cents: 50_000,
  currency: "BRL",
  tags: [],
  owner_kind: "user",
  owner_user_id: null,
  owner_agent_id: null,
  owner_agent: null,
  score: null,
  next_action: null,
  last_activity_at: null,
  created_at: "2026-09-01T10:00:00Z",
} as unknown as Parameters<typeof buildCardInput>[0];

// O segundo argumento de `buildCardInput`. `ownerNames` e chave obrigatoria
// (aceita `undefined`, mas nao aceita ausencia), e estes casos nao falam de
// dono — falam da empresa. Uma constante evita repetir o ruido cinco vezes.
//
// ⚠️ `now` FIXO, e nao por gosto: `hoursInStage` sai de `now ?? new Date()` e e
// um float em horas. O caso "nao mexe em mais nada do card" constroi DOIS cards
// e compara o resto — com o relogio solto, os dois nascem em instantes
// diferentes e o campo diverge na casa dos milissegundos. Passava isolado e
// reprovava na suite cheia, onde a maquina esta disputada: o pior tipo de
// teste, o que falha por carga e nao por defeito.
const ETAPA = {
  stageName: "Proposta",
  ownerNames: undefined,
  now: new Date("2026-09-19T12:00:00Z"),
};

describe("a empresa no card", () => {
  it("chega ao card quando o negócio tem uma", () => {
    const card = buildCardInput(
      { ...base, empresa_nome: "Padaria do Zé" } as typeof base,
      ETAPA,
    );
    expect(
      card.empresa,
      "em venda B2B a empresa identifica mais que o título: 'Orçamento 300 pães' não diz de quem é",
    ).toBe("Padaria do Zé");
  });

  it("é NULO quando não há — e nulo é o caso comum", () => {
    const card = buildCardInput(base, ETAPA);
    expect(
      card.empresa,
      "undefined e null se comportam igual aqui, mas só null diz 'perguntei e não tem'",
    ).toBeNull();
  });

  it("empresa apagada depois do vínculo vira nulo, não texto vazio", () => {
    // A rota devolve `null` quando o id não resolve (empresa excluída). Um "" aqui
    // renderizaria um parágrafo vazio no card — exatamente a linha morta que o §5
    // proíbe, e a mais difícil de notar porque não tem o que ler.
    const card = buildCardInput({ ...base, empresa_nome: null } as typeof base, ETAPA);
    expect(card.empresa).toBeNull();
  });

  it("não mexe em mais nada do card", () => {
    const semEmpresa = buildCardInput(base, ETAPA);
    const comEmpresa = buildCardInput({ ...base, empresa_nome: "ACME" } as typeof base, ETAPA);
    const { empresa: _a, ...restoSem } = semEmpresa;
    const { empresa: _b, ...restoCom } = comEmpresa;
    expect(
      restoCom,
      "acrescentar a empresa mudou outro campo do card — o B2C pagaria por uma feature que não usa",
    ).toEqual(restoSem);
  });
});
