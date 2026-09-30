/**
 * FORK MIA (.61) — a etiqueta `Formulario_Meta` é CONTRATO, e é só do formulário.
 *
 * Contrato porque uma régua de follow-up da empresa (a que faz a IA puxar
 * conversa com quem preencheu o formulário) filtra o card por este texto exato.
 * Renomear a constante "para ficar bonito" desligaria a régua em silêncio: o nó
 * de condição simplesmente pararia de casar, sem erro em lugar nenhum.
 *
 * Só do formulário porque a outra porta da Meta, o clique para o WhatsApp
 * (`lib/leads/nascimento-do-lead.ts`), leva só `Meta_ads`. Ali a pessoa já
 * chegou falando; abordá-la como "quem preencheu o formulário" seria errado.
 * A gravação em si (as duas etiquetas no card novo, nenhuma no card aberto) é
 * provada em `leads-da-meta-rodada.test.ts`.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ETIQUETA_DO_CARD, ETIQUETA_DO_FORMULARIO } from "@/lib/leads-da-meta/gravar";

const RAIZ = path.resolve(__dirname, "../..");

describe("a etiqueta do formulário da Meta", () => {
  it("tem o texto exato que a régua de follow-up filtra, e não substitui Meta_ads", () => {
    expect(ETIQUETA_DO_FORMULARIO).toBe("Formulario_Meta");
    expect(ETIQUETA_DO_CARD).toBe("Meta_ads");
  });

  it("não vaza para o lead que nasce do clique para o WhatsApp", () => {
    const nascimento = fs.readFileSync(path.join(RAIZ, "lib/leads/nascimento-do-lead.ts"), "utf8");
    expect(nascimento).toContain('meta_ads: "Meta_ads"');
    expect(nascimento).not.toContain("Formulario_Meta");
    expect(nascimento).not.toContain("ETIQUETA_DO_FORMULARIO");
  });
});
