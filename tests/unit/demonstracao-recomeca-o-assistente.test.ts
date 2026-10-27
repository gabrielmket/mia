/**
 * FORK MIA (.94) · "RECOMEÇAR" A DEMONSTRAÇÃO LIMPA O ASSISTENTE INTEIRO
 * (decisão 10), sem banco. O invariante
 * tests/invariants/demonstracao-recomeca-o-assistente.test.ts roda o mesmo SQL
 * contra o Postgres; aqui fica o que falha em segundos:
 *
 *   - toda peça que uma proposta cria tem o seu desfazer no bloco (as nove do
 *     dia a dia e as três da .91): peça nova sem desfazer fica vermelha aqui;
 *   - a trava é a marca da demonstração (9010), e vem antes de tudo;
 *   - a organização entra validada (nada de texto solto no SQL);
 *   - a semente roda o bloco logo depois da empresa, antes das gravações dela,
 *     e o roteiro gerado continua sem parâmetro solto.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { TIPOS_DE_PROPOSTA } from "@/lib/assistente/propostas/tipos";
import { gerarSqlDaSemente, idDaDemonstracao } from "@/lib/demonstracao/semente/aplicar";
import { sqlDeRecomecarOAssistente } from "@/lib/demonstracao/semente/recomecar-o-assistente";

const ORG = "94109410-0000-4000-8000-00000000000d";

describe("o bloco de recomeçar o assistente", () => {
  const texto = sqlDeRecomecarOAssistente(ORG);

  it("desfaz cada uma das doze peças (as nove do dia a dia e as três da .91)", () => {
    expect(TIPOS_DE_PROPOSTA).toHaveLength(12);
    for (const tipo of TIPOS_DE_PROPOSTA) {
      expect(texto, tipo).toMatch(new RegExp(`when [^\\n]*'${tipo}'`));
    }
  });

  it("⭐ só age na empresa de demonstração: a marca da 9010 vem antes de qualquer escrita", () => {
    const trava = texto.indexOf("o.demonstracao from public.organizations o where o.id = v_org");
    expect(trava).toBeGreaterThan(0);
    for (const escrita of ["delete from", "update public."]) {
      expect(texto.indexOf(escrita), escrita).toBeGreaterThan(trava);
    }
    expect(texto.slice(trava, trava + 200)).toContain("return;");
  });

  it("depois das peças, saem as propostas e o progresso das trilhas da empresa", () => {
    expect(texto).toContain("delete from public.mia_assistente_propostas where organization_id = v_org");
    expect(texto).toContain("delete from public.mia_assistente_trilhas where organization_id = v_org");
    expect(texto.indexOf("delete from public.mia_assistente_propostas where")).toBeGreaterThan(texto.indexOf("end loop"));
  });

  it("uma peça que falha não derruba a semente (cada uma no seu bloco)", () => {
    expect(texto).toMatch(/exception when others then\s+raise notice/);
  });

  it("recusa organização que não é uuid", () => {
    expect(() => sqlDeRecomecarOAssistente("x'; drop table public.organizations; --")).toThrow(/organização inválida/);
    expect(() => sqlDeRecomecarOAssistente("")).toThrow(/organização inválida/);
  });

  it("sem parâmetro posicional e sem travessão", () => {
    expect(texto).not.toMatch(/\$\d+\b/);
    expect(readFileSync("lib/demonstracao/semente/recomecar-o-assistente.ts", "utf8")).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("a semente roda o bloco", () => {
  it("⭐ no roteiro gerado: logo depois da empresa, antes do funil e das tarefas da semente", async () => {
    const roteiro = await gerarSqlDaSemente({ agora: new Date("2026-10-27T12:00:00Z") });
    const bloco = roteiro.indexOf(sqlDeRecomecarOAssistente(idDaDemonstracao("bancada")));
    expect(bloco).toBeGreaterThan(roteiro.indexOf("insert into public.organizations"));
    expect(bloco).toBeLessThan(roteiro.indexOf("insert into public.crm_pipelines"));
    expect(bloco).toBeLessThan(roteiro.indexOf("insert into public.crm_tasks"));
    expect(roteiro).not.toMatch(/\$\d+\b/);
  });
});
