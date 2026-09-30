import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PushPayload } from "@/lib/notifications/push_payload";

import { CHAVE_DO_AVISO, TIPO_DO_INCIDENTE, textoDoAviso, vigiarBackup } from "./aviso-do-backup";
import { avaliarBackup, type EstadoDoBackup } from "./estado-do-backup";

/**
 * FORK MIA (.62) — O SISTEMA CHAMA QUEM OPERA QUANDO O BACKUP PARA.
 *
 * Um incidente de plataforma (o registro, em /admin/incidents) e um push para
 * os administradores (a campainha). O vigia roda a cada 10 minutos; o aviso sai
 * NO MÁXIMO uma vez por dia por problema, enquanto ele durar. Um alarme que toca
 * a cada 10 minutos é desligado no segundo dia — e aí o próximo backup parado
 * passa calado.
 *
 *     npx vitest run lib/backup/aviso-do-backup.test.ts
 */

type Linha = Record<string, unknown>;

/** Um Supabase de mentira com as duas tabelas que o vigia usa, em memória. */
function bancoDeMentira(opcoes: { travaFalha?: boolean } = {}) {
  const travas = new Map<string, Linha>();
  const incidentes: Linha[] = [];

  const admin = {
    from(tabela: string) {
      const filtros: Array<[string, string, unknown]> = [];
      let operacao: { tipo: "update"; valores: Linha } | null = null;
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (c: string, v: unknown) => (filtros.push(["eq", c, v]), q);
      q.neq = (c: string, v: unknown) => (filtros.push(["neq", c, v]), q);
      q.is = (c: string, v: unknown) => (filtros.push(["is", c, v]), q);
      const casa = (l: Linha) =>
        filtros.every(([op, c, v]) => (op === "neq" ? l[c] !== v : l[c] === v));

      q.maybeSingle = async () => {
        if (tabela === "platform_avisos_enviados") {
          const chave = filtros.find(([, c]) => c === "chave")?.[2] as string;
          return { data: travas.get(chave) ?? null, error: null };
        }
        return { data: null, error: null };
      };
      q.upsert = async (linha: Linha) => {
        if (opcoes.travaFalha) return { error: { message: "banco recusou" } };
        travas.set(linha.chave as string, linha);
        return { error: null };
      };
      q.insert = (linha: Linha) => {
        const nova = { id: `inc-${incidentes.length + 1}`, status: "open", ...linha };
        incidentes.push(nova);
        return { select: () => ({ maybeSingle: async () => ({ data: { id: nova.id }, error: null }) }) };
      };
      q.update = (valores: Linha) => ((operacao = { tipo: "update", valores }), q);
      q.then = (ok: (v: unknown) => unknown) => {
        if (tabela === "incidents" && operacao) {
          const alvos = incidentes.filter(casa);
          for (const alvo of alvos) Object.assign(alvo, operacao.valores);
          return Promise.resolve({ data: alvos.map((a) => ({ id: a.id })), error: null }).then(ok);
        }
        return Promise.resolve({ data: null, error: null }).then(ok);
      };
      return q;
    },
  };
  return { admin: admin as never, travas, incidentes };
}

const push = vi.fn(async (_admin: unknown, _payload: PushPayload) => ({ sent: 1 }));

const AGORA = new Date("2026-09-30T12:00:00Z");
const HORA = 60 * 60 * 1000;

function atrasado(): EstadoDoBackup {
  return avaliarBackup(
    { situacao: "ok", ultima_copia_em: "2026-09-28T06:01:00Z", enviada_em: "2026-09-28T06:12:00Z" },
    new Date(),
  );
}
function emDia(): EstadoDoBackup {
  return avaliarBackup(
    { situacao: "ok", ultima_copia_em: new Date(Date.now() - 5 * HORA).toISOString(), enviada_em: new Date().toISOString() },
    new Date(),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  push.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("o aviso do backup atrasado", () => {
  it("⭐ atrasado: abre o incidente de plataforma e toca o push dos administradores", async () => {
    const b = bancoDeMentira();
    const r = await vigiarBackup(b.admin, atrasado(), { enviarPush: push });

    expect(r.avisados).toEqual(["atrasado"]);
    expect(b.incidentes).toHaveLength(1);
    expect(b.incidentes[0]).toMatchObject({
      organization_id: null,
      type: TIPO_DO_INCIDENTE.atrasado,
      severity: "critical",
      payload: { ultima_copia_em: "2026-09-28T06:01:00.000Z" },
    });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]![1]).toMatchObject({
      title: "Backup do banco atrasado",
      href: "/admin/incidents/inc-1",
    });
  });

  it("⭐ UMA VEZ POR DIA: a rodada seguinte (10 min depois) não repete; 24 h depois, sim", async () => {
    const b = bancoDeMentira();
    await vigiarBackup(b.admin, atrasado(), { enviarPush: push });

    vi.setSystemTime(new Date(AGORA.getTime() + 10 * 60 * 1000));
    const dezMinutos = await vigiarBackup(b.admin, atrasado(), { enviarPush: push });
    expect(dezMinutos.avisados, "o alarme tocou de novo 10 min depois: vira ruído e é desligado").toEqual([]);

    vi.setSystemTime(new Date(AGORA.getTime() + 23 * HORA));
    await vigiarBackup(b.admin, atrasado(), { enviarPush: push });
    expect(push, "tocou mais de uma vez no mesmo dia").toHaveBeenCalledTimes(1);
    expect(b.incidentes).toHaveLength(1);

    vi.setSystemTime(new Date(AGORA.getTime() + 24 * HORA + 60 * 1000));
    const outroDia = await vigiarBackup(b.admin, atrasado(), { enviarPush: push });
    expect(outroDia.avisados, "o backup continua parado e o segundo dia ficou calado").toEqual(["atrasado"]);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("a trava que não grava NÃO avisa — melhor um dia calado que um alarme a cada 10 min", async () => {
    const b = bancoDeMentira({ travaFalha: true });
    const r = await vigiarBackup(b.admin, atrasado(), { enviarPush: push });
    expect(r.avisados).toEqual([]);
    expect(push).not.toHaveBeenCalled();
    expect(b.incidentes).toEqual([]);
  });

  it("⭐ voltou ao normal: fecha o incidente aberto, com o porquê", async () => {
    const b = bancoDeMentira();
    await vigiarBackup(b.admin, atrasado(), { enviarPush: push });

    vi.setSystemTime(new Date(AGORA.getTime() + 2 * HORA));
    const r = await vigiarBackup(b.admin, emDia(), { enviarPush: push });
    expect(r.resolvidos).toEqual(["atrasado"]);
    expect(b.incidentes[0]).toMatchObject({ status: "resolved" });
    expect(String(b.incidentes[0]!.resolution_note)).toMatch(/voltou a ficar em dia/);
  });

  it("⭐ desconhecido (ambiente de teste, sem a tabela): não avisa nem fecha nada", async () => {
    const b = bancoDeMentira();
    const r = await vigiarBackup(b.admin, avaliarBackup({ falha: "sem_tabela" }, new Date()), { enviarPush: push });
    expect(r).toEqual({ avisados: [], resolvidos: [] });
    expect(push).not.toHaveBeenCalled();
    expect(b.travas.size).toBe(0);
  });

  it("cópia em dia que não chegou ao Drive: o aviso é o do ENVIO, com trava própria", async () => {
    const b = bancoDeMentira();
    const estado = avaliarBackup(
      { situacao: "ok", ultima_copia_em: "2026-09-30T06:01:00Z", enviada_em: null },
      new Date(),
    );
    const r = await vigiarBackup(b.admin, estado, { enviarPush: push });
    expect(r.avisados).toEqual(["sem_envio"]);
    expect([...b.travas.keys()]).toEqual([CHAVE_DO_AVISO.sem_envio]);
    expect(push.mock.calls[0]![1]).toMatchObject({ title: "Backup não chegou ao Drive" });
  });
});

describe("o texto do push", () => {
  it("diz a data da última cópia em UTC, sem depender do idioma do servidor", () => {
    expect(textoDoAviso("atrasado", atrasado()).body).toBe(
      "A última cópia completa do banco é de 28/09/2026 06:01 UTC. O backup diário parou.",
    );
  });
});
