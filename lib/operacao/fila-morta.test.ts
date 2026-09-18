import { describe, expect, it } from "vitest";

import { agruparFilaMorta, assinaturaDoErro } from "./fila-morta";

/**
 * 49 LINHAS IDÊNTICAS NÃO SÃO INFORMAÇÃO.
 *
 * Jobs não morrem de um em um: morrem em rajada, todos pelo mesmo motivo. Caso
 * real desta instalação (31/08/2026): 49 mortos em poucos segundos, todos por
 * TPM da OpenAI, e 49 alertas críticos idênticos na Central — a mesma
 * informação 49 vezes, que o operador precisa ler 49 vezes para descobrir que é
 * uma coisa só.
 *
 * O agrupamento só funciona se a assinatura ignorar o que MUDA a cada tentativa
 * (id de requisição, contagem de tokens, horário) e preservar o que identifica
 * a CAUSA. Errar para o lado frouxo é pior que não agrupar: juntaria causas
 * diferentes, e o operador reprocessaria 40 jobs tendo consertado o problema de 12.
 *
 *     npx vitest run lib/operacao/fila-morta.test.ts
 */

const base = { organization_id: "org-1", kind: "inbound_turn", attempts: 5 };

describe("a assinatura da falha", () => {
  it("junta a MESMA causa com ids e números diferentes", () => {
    const a = assinaturaDoErro("Rate limit reached for gpt-4.1 in org org-abc: 30000 TPM (req_aa11bb22cc33)");
    const b = assinaturaDoErro("Rate limit reached for gpt-4.1 in org org-abc: 12 TPM (req_zz99yy88xx77)");
    expect(a, "dois jobs mortos pelo mesmo rate limit caíram em grupos diferentes").toBe(b);
  });

  it("SEPARA causas diferentes", () => {
    expect(assinaturaDoErro("Rate limit reached")).not.toBe(assinaturaDoErro("Invalid API key"));
  });

  it("dá nome à ausência, em vez de juntar tudo que não tem motivo com o resto", () => {
    expect(assinaturaDoErro(null)).toBe("sem_motivo_registrado");
    expect(assinaturaDoErro("")).toBe("sem_motivo_registrado");
  });
});

describe("o agrupamento", () => {
  const jobs = [
    { ...base, id: "11111111-1111-4111-8111-111111111111", last_error: "Rate limit: 1 TPM", created_at: "2026-09-01T10:00:00Z" },
    { ...base, id: "22222222-2222-4222-8222-222222222222", last_error: "Rate limit: 2 TPM", created_at: "2026-09-01T09:00:00Z" },
    { ...base, id: "33333333-3333-4333-8333-333333333333", last_error: "Rate limit: 3 TPM", created_at: "2026-09-01T11:00:00Z" },
    { ...base, id: "44444444-4444-4444-8444-444444444444", last_error: "Invalid API key", created_at: "2026-09-01T12:00:00Z" },
  ];

  it("junta a rajada num grupo só, com todos os ids", () => {
    const grupos = agruparFilaMorta(jobs);
    expect(grupos).toHaveLength(2);
    expect(grupos[0]!.quantidade).toBe(3);
    expect(grupos[0]!.ids, "sem todos os ids, o botão devolve parte da rajada e o resto fica parado").toHaveLength(3);
  });

  it("ordena pelo TAMANHO do estrago, não pela data", () => {
    const grupos = agruparFilaMorta(jobs);
    expect(
      grupos[0]!.quantidade,
      "o grupo de 3 ficou embaixo do de 1: a rajada vem antes de alguém notar, e ordenar por data a esconde",
    ).toBe(3);
  });

  it("guarda o instante mais ANTIGO — é ele que diz há quanto tempo o lead espera", () => {
    const grupos = agruparFilaMorta(jobs);
    expect(grupos[0]!.maisAntigo).toBe("2026-09-01T09:00:00Z");
  });

  it("mostra o erro mais completo do grupo como exemplo", () => {
    const grupos = agruparFilaMorta([
      // MESMA assinatura (só o número muda), comprimentos diferentes — que é
      // o caso real: o provedor trunca a mensagem em algumas respostas.
      { ...base, id: "55555555-5555-4555-8555-555555555555", last_error: "Timeout after 5000ms", created_at: "2026-09-01T10:00:00Z" },
      { ...base, id: "66666666-6666-4666-8666-666666666666", last_error: "Timeout after 5000000ms", created_at: "2026-09-01T10:00:00Z" },
    ]);
    expect(
      grupos[0]!.exemplo,
      "o truncado veio primeiro e virou o exemplo: a tela mostraria a versão que não diz o que fazer",
    ).toBe("Timeout after 5000000ms");
  });
});
