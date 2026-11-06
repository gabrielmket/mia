/**
 * FORK MIA (.101) · O RAIO-X DO ATENDIMENTO NO MCP DE PLATAFORMA
 * (lib/mcp-plataforma/ferramentas/raio-x.ts; docs/fork/raio-x-do-atendimento.md).
 *
 * Quatro ferramentas: ver é leitura; criar, publicar e encerrar exigem a operação
 * `gerir_raio_x`, que tem o raio escrito para quem marca a caixinha. O cadastro
 * inválido é recusado ANTES de tocar no banco, e o contato de quem autoriza não
 * vai para a trilha de auditoria.
 */
import { describe, expect, it } from "vitest";

import { FERRAMENTA_POR_NOME, FERRAMENTAS } from "@/lib/mcp-plataforma/ferramentas";
import { operacaoPorChave } from "@/lib/mcp-plataforma/operacoes";

const NOMES = ["plataforma_criar_raio_x", "plataforma_ver_raio_x", "plataforma_publicar_raio_x", "plataforma_encerrar_raio_x", "plataforma_reler_raio_x"];

describe("as cinco do raio-X", () => {
  it("estão na lista, e a lista tem 111 (a quinta, reler, é da .105)", () => {
    for (const n of NOMES) expect(FERRAMENTA_POR_NOME.has(n), n).toBe(true);
    expect(FERRAMENTAS).toHaveLength(111);
  });

  it("ver é leitura; as outras quatro exigem gerir_raio_x", () => {
    expect(FERRAMENTA_POR_NOME.get("plataforma_ver_raio_x")!.operacao).toBeNull();
    for (const n of ["plataforma_criar_raio_x", "plataforma_publicar_raio_x", "plataforma_encerrar_raio_x", "plataforma_reler_raio_x"]) {
      expect(FERRAMENTA_POR_NOME.get(n)!.operacao, n).toBe("gerir_raio_x");
    }
    const op = operacaoPorChave("gerir_raio_x");
    expect(op?.raio).toMatch(/QUALQUER empresa/);
  });

  it("publicar diz, antes, que alguém da Time precisa ter lido o relatório", () => {
    expect(FERRAMENTA_POR_NOME.get("plataforma_publicar_raio_x")!.description).toMatch(/ANTES DE publicar/);
  });

  it("o cadastro inválido é recusado antes do banco, com os campos", async () => {
    const semBanco = new Proxy({}, { get: () => { throw new Error("tocou no banco"); } });
    const criar = FERRAMENTA_POR_NOME.get("plataforma_criar_raio_x")!;
    await expect(
      criar.handler({ admin: semBanco as never, autorUserId: "a", tokenId: "t", requestId: "r" }, { empresa: "Garagem Modelo Veículos", segmento: "revenda_de_veiculos", whatsapp: "abc" }),
    ).rejects.toThrow(/whatsapp/);
  });

  it("o contato de quem autoriza não vai para a trilha", () => {
    const red = FERRAMENTA_POR_NOME.get("plataforma_criar_raio_x")!.redigirParaAuditoria!({
      empresa: "Garagem Modelo Veículos",
      responsavel_nome: "Ricardo Exemplo",
      responsavel_contato: "(31) 90000-1101",
    });
    expect(JSON.stringify(red)).not.toMatch(/Ricardo|90000/);
  });
});

// ── FORK MIA (.102) · o raio-X do cliente ativo no MCP ───────────────────────
describe("o cliente ativo nas mesmas quatro ferramentas", () => {
  it("o cliente ativo não trouxe ferramenta nova (a quinta, reler, é da .105)", () => {
    expect(FERRAMENTAS.filter((f) => f.name.endsWith("_raio_x")).map((f) => f.name).sort()).toEqual([...NOMES].sort());
  });

  it("criar aceita a fonte, a empresa da MIA e os números; o WhatsApp vira opcional", () => {
    const criar = FERRAMENTA_POR_NOME.get("plataforma_criar_raio_x")!;
    expect(Object.keys(criar.inputSchema)).toEqual(expect.arrayContaining(["fonte", "organization_id", "numeros", "whatsapp"]));
    expect(criar.description).toMatch(/conversas_da_mia/);
    expect(criar.description).toMatch(/AUTORIZAÇÃO/);
  });

  it("a fonte da MIA sem a conta e sem os números é recusada antes do banco, com os campos", async () => {
    const semBanco = new Proxy({}, { get: () => { throw new Error("tocou no banco"); } });
    const criar = FERRAMENTA_POR_NOME.get("plataforma_criar_raio_x")!;
    await expect(
      criar.handler(
        { admin: semBanco as never, autorUserId: "a", tokenId: "t", requestId: "r" },
        { fonte: "conversas_da_mia", empresa: "Garagem Modelo Veículos", segmento: "revenda_de_veiculos" },
      ),
    ).rejects.toThrow(/organization_id, numeros/);
  });

  it("ver mostra a fonte e o aceite, e lê a conta pelo organization_id", () => {
    const ver = FERRAMENTA_POR_NOME.get("plataforma_ver_raio_x")!;
    expect(Object.keys(ver.inputSchema)).toEqual(expect.arrayContaining(["raio_x_id", "organization_id", "periodo_dias"]));
    expect(ver.description).toMatch(/FONTE/);
    expect(ver.description).toMatch(/ACEITE \(nome completo, e-mail mascarado/);
    expect(ver.operacao).toBeNull();
  });
});
