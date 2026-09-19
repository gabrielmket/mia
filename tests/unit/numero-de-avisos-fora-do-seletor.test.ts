/**
 * O NÚMERO DE AVISOS NÃO APARECE NO SELETOR DE ATENDIMENTO (item G4).
 *
 * ── O que ele é, e por que continua em Conexões ───────────────────────────
 *
 * O número de avisos é da INSTALAÇÃO, não de um cliente: é ele que fala nos
 * grupos de todos os clientes quando a IA passa o bastão. Fica conectado sob a
 * organização de quem opera, e continua listado em Conexões dela — é por ali
 * que se lê o QR e se reconecta. Tirá-lo de lá o deixaria sem tela.
 *
 * ── O que nada impedia ────────────────────────────────────────────────────
 *
 * `listSelectableChannels` é a FONTE ÚNICA dos seletores de "Número conectado".
 * O número de avisos saía nela como qualquer outro, e amarrar um agente nele
 * era um clique — com o efeito de a IA de um cliente atender pelo número que
 * avisa TODOS os grupos.
 *
 * ── A primeira versão deste filtro estava errada, e o teste conta ─────────
 *
 * Ela fazia uma SEGUNDA consulta para descobrir quais ids eram o número de
 * avisos. Quebrou `canais-selecionaveis.test.ts` e
 * `onboarding-agente-nao-publicado.test.ts`: o duplo de Supabase deles devolve
 * a mesma resposta para qualquer consulta, então a segunda recebia as LINHAS
 * DE CANAL como se fossem as do número de avisos — e filtrava tudo. Seletor
 * vazio, que é o defeito que o próprio módulo declara ser o pior.
 *
 * Hoje a coluna vem no MESMO `select`, e a tolerância é a mesma que
 * `archived_at` já tinha: banco sem a coluna repete sem ela.
 */
import { describe, expect, it } from "vitest";

import { listSelectableChannels } from "@/lib/channels/selectable";

type Resposta = { data: unknown; error: { code: string; message: string } | null };

/**
 * Um Supabase de mentira que registra QUAIS COLUNAS foram pedidas.
 *
 * É o que permite provar a tolerância: a segunda tentativa tem de vir sem a
 * coluna do número de avisos, e sem isso o teste não distinguiria "repetiu sem
 * a coluna" de "repetiu igual e deu certo por acaso".
 */
function bancoFalso(respostas: Resposta[]) {
  const selects: string[] = [];
  let i = 0;

  const build = () => {
    const b: Record<string, unknown> = {
      select: (colunas: string) => {
        selects.push(colunas);
        return b;
      },
      eq: () => b,
      in: () => b,
      is: () => b,
      order: () => b,
      then: (resolve: (v: unknown) => void) => {
        const r = respostas[Math.min(i, respostas.length - 1)]!;
        i += 1;
        return Promise.resolve(r).then(resolve);
      },
    };
    return b;
  };

  return { db: { from: () => build() } as never, selects };
}

const CANAL = (id: string, avisos: boolean) => ({
  id,
  display_name: `Canal ${id}`,
  status: "WORKING",
  phone_number: `+5531${id}`,
  waha_session_name: `org_${id}`,
  e_numero_de_avisos: avisos,
});

const SEM_A_COLUNA = {
  code: "42703",
  message: 'column channel_sessions.e_numero_de_avisos does not exist',
};

describe("o seletor de número conectado", () => {
  it("NÃO oferece o número de avisos da plataforma", async () => {
    const { db } = bancoFalso([
      { data: [CANAL("1", false), CANAL("2", true)], error: null },
    ]);

    const lista = await listSelectableChannels(db, "org-1");

    expect(lista.map((c) => c.id)).toEqual(["1"]);
  });

  it("oferece todos os outros — o filtro não pode esvaziar a lista", async () => {
    // O modo de falha que assusta mais, e o que a primeira versão causou: um
    // filtro errado devolve lista vazia, e "esta organização não tem número"
    // convida alguém a parear de novo um número que já está no ar.
    const { db } = bancoFalso([
      { data: [CANAL("1", false), CANAL("2", false), CANAL("3", true)], error: null },
    ]);

    const lista = await listSelectableChannels(db, "org-1");

    expect(lista.map((c) => c.id)).toEqual(["1", "2"]);
  });

  it("a coluna vai no MESMO select — não há segunda consulta", async () => {
    // A regressão que este arquivo existe para não repetir. Dois
    // `from("channel_sessions")` na mesma função quebram todo duplo de
    // Supabase que responde igual a qualquer consulta.
    const { db, selects } = bancoFalso([{ data: [CANAL("1", false)], error: null }]);

    await listSelectableChannels(db, "org-1");

    expect(selects).toHaveLength(1);
    expect(selects[0]).toContain("e_numero_de_avisos");
  });

  it("banco SEM a coluna: repete sem ela, e a tela continua abrindo", async () => {
    // O caso que decide o desenho. Sem a tolerância, um `select` nomeando
    // coluna inexistente derruba a consulta inteira — e esta função alimenta o
    // editor de agente.
    // ⚠️ A repetição devolve linhas SEM o campo, porque o `select` da segunda
    // tentativa não o pede. Um duplo que o devolvesse mesmo assim estaria
    // mentindo sobre o banco — e foi assim que a primeira versão deste caso
    // reprovou por um motivo que não existe em produção.
    const semCampo = (id: string) => {
      const { e_numero_de_avisos: _fora, ...resto } = CANAL(id, false);
      return resto;
    };
    const { db, selects } = bancoFalso([
      { data: null, error: SEM_A_COLUNA },
      { data: [semCampo("1"), semCampo("2")], error: null },
    ]);

    const lista = await listSelectableChannels(db, "org-1");

    expect(selects[0]).toContain("e_numero_de_avisos");
    expect(selects[1], "a repetição tem de vir SEM a coluna").not.toContain(
      "e_numero_de_avisos",
    );
    // Com a coluna ausente ninguém sabe qual é o número de avisos, e a lista
    // tem de ser a de antes do filtro — defeito velho, nunca tela quebrada.
    expect(lista.map((c) => c.id)).toEqual(["1", "2"]);
  });

  it("campo ausente na linha significa 'mostra', não 'esconde'", async () => {
    // `=== true` e não truthy: num banco sem a coluna o campo vem `undefined`,
    // e tratar isso como "é o número de avisos" esvaziaria o seletor.
    const semCampo = {
      id: "9",
      display_name: "Sem a coluna",
      status: "WORKING",
      phone_number: "+5531999",
      waha_session_name: "org_9",
    };
    const { db } = bancoFalso([{ data: [semCampo], error: null }]);

    const lista = await listSelectableChannels(db, "org-1");

    expect(lista.map((c) => c.id)).toEqual(["9"]);
  });

  it("erro de verdade continua SUBINDO", async () => {
    // A tolerância é estreita de propósito: ela responde a "a coluna não
    // existe", não a "o banco caiu". Um erro engolido aqui vira seletor vazio.
    const { db } = bancoFalso([
      { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } },
    ]);

    await expect(listSelectableChannels(db, "org-1")).rejects.toThrow(
      /channel_sessions_list_failed/,
    );
  });
});
