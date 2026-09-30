import { describe, expect, it } from "vitest";

import { avaliarBackup, leituraDoRpc } from "./estado-do-backup";

/**
 * FORK MIA (.62) — O BACKUP ESTÁ EM DIA?
 *
 * A régua é a do healthcheck do contêiner de backup: cópia COMPLETA de menos de
 * 26 h. O envio ao Drive é resposta à parte. E o que não se sabe é
 * `desconhecido`, nunca "em dia": um monitor que lê `em_dia: true` num banco sem
 * backup desligaria a pergunta em vez de deixá-la aberta.
 *
 *     npx vitest run lib/backup/estado-do-backup.test.ts
 */

const AGORA = new Date("2026-09-30T12:00:00Z");

describe("o backup em dia, atrasado ou desconhecido", () => {
  it("⭐ cópia de hoje, enviada: em dia", () => {
    const e = avaliarBackup(
      { situacao: "ok", ultima_copia_em: "2026-09-30T06:01:00+00:00", enviada_em: "2026-09-30T06:12:00+00:00" },
      AGORA,
    );
    expect(e).toEqual({
      estado: "em_dia",
      em_dia: true,
      ultima_copia_em: "2026-09-30T06:01:00.000Z",
      envio_ao_drive: "ok",
    });
  });

  it("⭐ cópia de mais de 26 h: atrasado", () => {
    const e = avaliarBackup(
      { situacao: "ok", ultima_copia_em: "2026-09-29T06:01:00Z", enviada_em: "2026-09-29T06:12:00Z" },
      AGORA,
    );
    expect(e.em_dia, "30 h sem cópia e a saúde disse 'em dia'").toBe(false);
    expect(e.estado).toBe("atrasado");
  });

  it("a fronteira: 25h59 ainda é em dia; 26h00 já é atraso", () => {
    const pronta = (horas: number) =>
      new Date(AGORA.getTime() - horas * 60 * 60 * 1000).toISOString();
    expect(avaliarBackup({ situacao: "ok", ultima_copia_em: pronta(25.99), enviada_em: pronta(25) }, AGORA).em_dia).toBe(true);
    expect(avaliarBackup({ situacao: "ok", ultima_copia_em: pronta(26), enviada_em: pronta(25) }, AGORA).em_dia).toBe(false);
  });

  it("a tabela existe e nunca houve cópia completa: é atraso, não desconhecido", () => {
    const e = avaliarBackup({ situacao: "sem_copia", ultima_copia_em: null, enviada_em: null }, AGORA);
    expect(e).toEqual({
      estado: "atrasado",
      em_dia: false,
      ultima_copia_em: null,
      envio_ao_drive: null,
      motivo: "sem_copia",
    });
  });

  it.each(["sem_tabela", "sem_permissao"] as const)(
    "⭐ %s (ambiente de teste, ou o dono da função sem leitura): desconhecido, NUNCA em dia",
    (situacao) => {
      const e = avaliarBackup({ situacao, ultima_copia_em: null, enviada_em: null }, AGORA);
      expect(e).toEqual({ estado: "desconhecido", em_dia: null, motivo: situacao });
    },
  );

  it("falha de leitura e função ausente também são desconhecido, com o motivo", () => {
    expect(avaliarBackup({ falha: "sem_funcao" }, AGORA)).toEqual({
      estado: "desconhecido",
      em_dia: null,
      motivo: "sem_funcao",
    });
    expect(avaliarBackup({ situacao: "ok", ultima_copia_em: "lixo", enviada_em: null }, AGORA)).toMatchObject({
      estado: "desconhecido",
      motivo: "falha_de_leitura",
    });
  });
});

describe("o envio ao Drive", () => {
  it("sem envio logo depois de pronta é PENDENTE (o envio roda a cada 10 min)", () => {
    const e = avaliarBackup({ situacao: "ok", ultima_copia_em: "2026-09-30T11:00:00Z", enviada_em: null }, AGORA);
    expect(e).toMatchObject({ em_dia: true, envio_ao_drive: "pendente" });
  });

  it("⭐ sem envio depois de 2 h é FALHOU — e a cópia continua em dia", () => {
    const e = avaliarBackup({ situacao: "ok", ultima_copia_em: "2026-09-30T06:01:00Z", enviada_em: null }, AGORA);
    expect(e).toMatchObject({ em_dia: true, envio_ao_drive: "falhou" });
  });
});

describe("a resposta do PostgREST", () => {
  it("função ausente no cache (PGRST202) é sem_funcao, não falha de leitura", () => {
    expect(leituraDoRpc({ data: null, error: { code: "PGRST202", message: "not found" } })).toEqual({
      falha: "sem_funcao",
    });
    expect(leituraDoRpc({ data: null, error: { code: "57014", message: "timeout" } })).toEqual({
      falha: "falha_de_leitura",
    });
  });

  it("a linha da função passa inteira", () => {
    expect(
      leituraDoRpc({
        data: [{ situacao: "ok", ultima_copia_em: "2026-09-30T06:01:00+00:00", enviada_em: null }],
        error: null,
      }),
    ).toEqual({ situacao: "ok", ultima_copia_em: "2026-09-30T06:01:00+00:00", enviada_em: null });
  });
});
