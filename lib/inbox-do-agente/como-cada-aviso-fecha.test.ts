import { describe, expect, it } from "vitest";

import {
  COMO_FECHA,
  avisosDeDecisao,
  avisosQueVencem,
  tetosDeSeguranca,
} from "./como-cada-aviso-fecha";

/**
 * NENHUM AVISO NOVO PODE NASCER ÓRFÃO.
 *
 * A Central chegou a 26 tipos de aviso com quatro sabendo se fechar. Os outros
 * ficavam abertos depois de resolvidos — a conexão voltou, o lead respondeu, a
 * mensagem saiu — e o alerta crítico seguia vermelho. O efeito não é barulho: a
 * tela MENTE, o operador aprende a não olhar, e o aviso que importa chega no
 * meio de trinta que já não valem.
 *
 * Consertar os 22 de hoje deixaria o 23º nascer órfão amanhã — foi assim que se
 * chegou a 22. O `satisfies Record<InboxKind, …>` do registro faz o compilador
 * cobrar a resposta; estas provas cobram que a resposta seja USÁVEL: prazo que
 * é número, "decisão" com motivo escrito, e a garantia de que nada fica aberto
 * para sempre por acidente.
 *
 *     npx vitest run lib/inbox-do-agente/como-cada-aviso-fecha.test.ts
 */

describe("o registro de fechamento", () => {
  it("responde por TODO tipo de aviso", () => {
    // O compilador já cobra isto; a prova existe para o dia em que alguém
    // trocar o `satisfies` por um `Record` solto — que aceita qualquer chave e
    // não exige nenhuma. Já aconteceu neste repositório, no arquivo vizinho.
    expect(Object.keys(COMO_FECHA).length).toBeGreaterThanOrEqual(26);
  });

  it("todo prazo é um número de dias positivo", () => {
    for (const { kind, dias } of avisosQueVencem()) {
      expect(Number.isFinite(dias) && dias > 0, `prazo inválido em ${kind}`).toBe(true);
    }
    for (const { kind, dias } of tetosDeSeguranca()) {
      expect(Number.isFinite(dias) && dias > 0, `teto inválido em ${kind}`).toBe(true);
    }
  });

  it("todo aviso de DECISÃO diz por que só uma pessoa o fecha", () => {
    for (const kind of avisosDeDecisao()) {
      const regra = COMO_FECHA[kind] as { porque?: string };
      expect(
        (regra.porque ?? "").length > 40,
        `${kind} está declarado como decisão sem explicar por quê — e "decisão" sem motivo é dívida disfarçada de escolha`,
      ).toBe(true);
    }
  });

  it("todo aviso de CONDIÇÃO diz qual pergunta o vigia refaz", () => {
    for (const [kind, regra] of Object.entries(COMO_FECHA)) {
      if (regra.modo !== "condicao") continue;
      expect(
        regra.quando.length > 10,
        `${kind} fecha por condição e não diz qual — quem for escrever o SQL vai adivinhar`,
      ).toBe(true);
    }
  });

  it("os três modos existem — nenhum é letra morta", () => {
    const modos = new Set(Object.values(COMO_FECHA).map((r) => r.modo));
    expect(modos).toEqual(new Set(["condicao", "idade", "decisao"]));
  });

  it("o que fecha por idade NÃO é o que pede decisão", () => {
    const vencem = new Set(avisosQueVencem().map((v) => v.kind));
    for (const kind of avisosDeDecisao()) {
      expect(
        vencem.has(kind),
        `${kind} apareceu nos dois: um aviso que é pergunta não pode vencer sozinho, ou a pergunta some sem ninguém ver`,
      ).toBe(false);
    }
  });
});
