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

const NOMES = ["plataforma_criar_raio_x", "plataforma_ver_raio_x", "plataforma_publicar_raio_x", "plataforma_encerrar_raio_x"];

describe("as quatro do raio-X", () => {
  it("estão na lista, e a lista tem 110", () => {
    for (const n of NOMES) expect(FERRAMENTA_POR_NOME.has(n), n).toBe(true);
    expect(FERRAMENTAS).toHaveLength(110);
  });

  it("ver é leitura; as outras três exigem gerir_raio_x", () => {
    expect(FERRAMENTA_POR_NOME.get("plataforma_ver_raio_x")!.operacao).toBeNull();
    for (const n of ["plataforma_criar_raio_x", "plataforma_publicar_raio_x", "plataforma_encerrar_raio_x"]) {
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
