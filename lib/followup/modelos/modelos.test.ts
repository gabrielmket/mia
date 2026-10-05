/**
 * O modelo que o validador recusa é o pior defeito possível deste catálogo: a
 * coluna `draft_graph` é `jsonb`, então o grafo inválido ENTRA no banco sem
 * erro e só quebra quando o dono da clínica abre o construtor — ou, pior, na
 * hora de publicar, com o paciente já esperando resposta.
 *
 * Por isso cada caso abaixo roda o validador DE VERDADE (`flowGraphSchema`,
 * `validateFlowForPublish`, `triggerConfigSchema`), nunca uma imitação.
 */
import { describe, expect, it } from "vitest";

import { triggerConfigSchema } from "@/lib/followup/api-schemas";
import { DICIONARIO } from "@/lib/i18n/dicionario";
import { flowGraphSchema } from "@/lib/followup/graph-schema";
import { validateFlowForPublish } from "@/lib/followup/validate-publish";

import { MODELOS_DE_FOLLOWUP, modeloPorId, modelosDoNicho } from "./index";
import { NICHOS_DE_MODELO, horizonteDoModeloMs, toquesDoModelo } from "./tipos";
import { montarEscada, rotuloDaEspera } from "./escada";
// FORK MIA
import { ROTULO_DO_SEGMENTO, SEGMENTO_PADRAO } from "./segmentos";

const ETAPA = "44444444-4444-4444-8444-444444444444";
const DIA_MS = 86_400_000;

describe("catálogo de modelos de follow-up", () => {
  it("tem as quatro jornadas de clínica, com id e nome únicos", () => {
    const clinica = modelosDoNicho("clinica");
    expect(clinica.map((m) => m.jornada)).toEqual(["Consulta", "Exame", "Cirurgia", "Falta"]);
    expect(new Set(MODELOS_DE_FOLLOWUP.map((m) => m.id)).size).toBe(MODELOS_DE_FOLLOWUP.length);
    // `followup_flow_pointers` tem `unique (organization_id, name)`: dois
    // modelos com o mesmo nome fariam o segundo bater 23505 na mesma org.
    expect(new Set(MODELOS_DE_FOLLOWUP.map((m) => m.nome)).size).toBe(MODELOS_DE_FOLLOWUP.length);
  });

  it("acha modelo por id e não inventa o que não existe", () => {
    expect(modeloPorId("clinica-exame-marcar")?.jornada).toBe("Exame");
    expect(modeloPorId("nao-existe")).toBeUndefined();
  });

  describe.each(MODELOS_DE_FOLLOWUP.map((m) => [m.id, m] as const))("%s", (_id, modelo) => {
    it("o grafo passa no schema que o banco e o construtor usam", () => {
      const parsed = flowGraphSchema.safeParse(modelo.grafo);
      expect(parsed.success ? null : parsed.error.issues).toBeNull();
    });

    it("o grafo é PUBLICÁVEL — nenhuma saída solta, nenhum nó sem fim", () => {
      const r = validateFlowForPublish(modelo.grafo);
      expect(r.ok ? [] : r.errors).toEqual([]);
    });

    it("o gatilho que ele monta é um `trigger_config` válido e cancela na resposta", () => {
      const cfg = modelo.gatilho({ stageId: ETAPA });
      const parsed = triggerConfigSchema.safeParse(cfg);
      expect(parsed.success ? null : parsed.error.issues).toBeNull();
      // A regra do arquivo de clínica: respondeu, o atendimento assume.
      expect(parsed.success && parsed.data.cancel_on_reply).toBe(true);
    });

    it("`pedeEtapa` é exatamente quem usa gatilho de etapa — senão a tela não pergunta e o publish recusa", () => {
      const cfg = modelo.gatilho({ stageId: ETAPA });
      expect(cfg.kind === "stage_change").toBe(modelo.pedeEtapa);
    });

    it("o gatilho tem motor vivo — publicar um kind sem motor deixa fluxo morto com cara de vivo", () => {
      // Mesma lista que `app/api/v1/ai/followup-flows/[id]/publish/route.ts`
      // aplica como allowlist. Um modelo fora dela instala e nunca dispara.
      expect(["manual", "webhook", "silence", "stage_change", "case_opened", "appointment_no_show", "lead_created"]).toContain(
        modelo.gatilho({ stageId: ETAPA }).kind,
      );
    });

    it("nenhum texto interpola campo da ficha — é o que impede dado de saúde de vazar na mensagem", () => {
      for (const no of modelo.grafo.nodes) {
        if (no.type !== "action") continue;
        expect(no.config.mode).toBe("text");
        const corpo = no.config.mode === "text" ? no.config.body : "";
        expect(corpo).not.toMatch(/\{\{/);
        expect(corpo.trim().length).toBeGreaterThan(20);
      }
    });

    it("é acíclico — o cálculo do horizonte percorre o grafo e dependeria disso para terminar", () => {
      const saidas = new Map<string, string[]>();
      for (const e of modelo.grafo.edges) {
        saidas.set(e.source, [...(saidas.get(e.source) ?? []), e.target]);
      }
      const visitando = new Set<string>();
      const pronto = new Set<string>();
      const temCiclo = (id: string): boolean => {
        if (visitando.has(id)) return true;
        if (pronto.has(id)) return false;
        visitando.add(id);
        const achou = (saidas.get(id) ?? []).some(temCiclo);
        visitando.delete(id);
        pronto.add(id);
        return achou;
      };
      expect(modelo.grafo.nodes.some((n) => temCiclo(n.id))).toBe(false);
    });

    it("conta os toques e o horizonte a partir do grafo", () => {
      expect(toquesDoModelo(modelo.grafo)).toBeGreaterThanOrEqual(3);
      expect(horizonteDoModeloMs(modelo.grafo)).toBeGreaterThan(0);
    });
  });

  it("o que a galeria mostra tem espanhol — a chave é dinâmica e nenhum varredor a alcança", () => {
    // `t(modelo.resumo)` é chave DINÂMICA: o varredor de AST de
    // `i18n-espanhol-cobre-a-tela` só enxerga literal, então um modelo novo
    // entraria na tela em português para quem escolheu espanhol, sem nada
    // reprovar. O nome do modelo fica de fora de propósito — ele vira o `name`
    // do ponteiro no banco, e nome de registro não se traduz.
    const semEspanhol = MODELOS_DE_FOLLOWUP.flatMap((m) =>
      [m.jornada, m.resumo, m.oQueDispara].filter((texto) => !DICIONARIO[texto]?.es),
    );
    expect(semEspanhol).toEqual([]);
  });

  it("a cirurgia acompanha por semanas e a falta por dias — o prazo É o modelo", () => {
    const cirurgia = modeloPorId("clinica-cirurgia-decisao")!;
    const falta = modeloPorId("clinica-falta-remarcar")!;
    expect(horizonteDoModeloMs(cirurgia.grafo)).toBeGreaterThan(60 * DIA_MS);
    expect(horizonteDoModeloMs(falta.grafo)).toBeLessThan(15 * DIA_MS);
  });
});

/**
 * FORK MIA · OS SEGMENTOS.
 *
 * O `describe.each` de cima já roda schema, publish, gatilho e ciclo em TODO
 * modelo do catálogo. O que este bloco acrescenta é o que a galeria por
 * segmento promete: todo modelo aparece em algum segmento da tela, todo
 * segmento tem as mesmas quatro jornadas, e o texto dos segmentos da MIA segue
 * as regras de escrita (sem emoji, sem travessão, sem jargão de saúde fora de
 * saúde).
 */
describe("FORK MIA · modelos por segmento", () => {
  /** Os segmentos escritos na MIA. "clinica" é do upstream e segue o estilo dele. */
  const SEGMENTOS_DA_MIA = NICHOS_DE_MODELO.filter((n) => n !== "clinica");
  const modelosDaMia = MODELOS_DE_FOLLOWUP.filter((m) => m.nicho !== "clinica");

  it("carro, academia e a cotação da indústria decidem em cerca de um mês e meio; os outros segmentos seguem o ritmo longo", () => {
    const DIA = 86_400_000;
    const horizonte = (id: string) => horizonteDoModeloMs(modeloPorId(id)!.grafo) / DIA;
    for (const id of ["automotivo-negociacao", "academia-matricula", "industria-b2b-cotacao"]) {
      expect(horizonte(id), id).toBeGreaterThanOrEqual(30);
      expect(horizonte(id), id).toBeLessThanOrEqual(45);
    }
    for (const id of ["geral-proposta", "imobiliario-proposta", "servicos-b2b-proposta"]) {
      expect(horizonte(id), id).toBeGreaterThan(60);
    }
  });

  /** Tudo o que a pessoa lê: na galeria e no canvas do construtor. */
  function textosDoModelo(m: (typeof MODELOS_DE_FOLLOWUP)[number]): string[] {
    const dosNos = m.grafo.nodes.flatMap((n) => [
      n.label,
      ...(n.type === "action" && n.config.mode === "text" ? [n.config.body] : []),
    ]);
    return [m.nome, m.jornada, m.resumo, m.oQueDispara, ...dosNos];
  }

  it("o geral é o padrão e vem primeiro, na tela e no catálogo", () => {
    expect(SEGMENTO_PADRAO).toBe("geral");
    expect(NICHOS_DE_MODELO[0]).toBe("geral");
    expect(MODELOS_DE_FOLLOWUP[0]?.nicho).toBe("geral");
  });

  it("todo modelo aparece em algum segmento da tela, nenhum fica fora da galeria", () => {
    const naTela = NICHOS_DE_MODELO.flatMap((n) => modelosDoNicho(n)).map((m) => m.id);
    expect([...naTela].sort()).toEqual(MODELOS_DE_FOLLOWUP.map((m) => m.id).sort());
  });

  it.each(NICHOS_DE_MODELO.map((n) => [n] as const))(
    "o segmento %s tem as quatro jornadas: silêncio, etapa, etapa longa e falta",
    (nicho) => {
      const modelos = modelosDoNicho(nicho);
      expect(modelos.map((m) => m.gatilho({ stageId: ETAPA }).kind)).toEqual([
        "silence",
        "stage_change",
        "stage_change",
        "appointment_no_show",
      ]);
      // A "decisão" acompanha por semanas; a "falta", por dias.
      // Carro e academia usam o ritmo curto (~um mês e meio); os demais, o longo.
      expect(horizonteDoModeloMs(modelos[2]!.grafo)).toBeGreaterThan(30 * DIA_MS);
      expect(horizonteDoModeloMs(modelos[3]!.grafo)).toBeLessThan(15 * DIA_MS);
    },
  );

  it.each(NICHOS_DE_MODELO.map((n) => [n] as const))(
    "todo modelo do segmento %s passa no schema e no publish",
    (nicho) => {
      for (const modelo of modelosDoNicho(nicho)) {
        const parsed = flowGraphSchema.safeParse(modelo.grafo);
        expect([modelo.id, parsed.success ? null : parsed.error.issues]).toEqual([modelo.id, null]);
        const publicavel = validateFlowForPublish(modelo.grafo);
        expect([modelo.id, publicavel.ok ? [] : publicavel.errors]).toEqual([modelo.id, []]);
      }
    },
  );

  it("o nome cabe no limite da rota (80), porque é ele que vira o nome do fluxo", () => {
    const longos = MODELOS_DE_FOLLOWUP.filter((m) => m.nome.length > 80).map((m) => m.nome);
    expect(longos).toEqual([]);
  });

  it("todo segmento tem rótulo com espanhol, porque o rótulo chega à tela por chave dinâmica", () => {
    const semEspanhol = NICHOS_DE_MODELO.map((n) => ROTULO_DO_SEGMENTO[n]).filter(
      (rotulo) => !DICIONARIO[rotulo]?.es,
    );
    expect(semEspanhol).toEqual([]);
  });

  it("texto da MIA sem emoji e sem travessão", () => {
    const ofensores = modelosDaMia.flatMap((m) =>
      textosDoModelo(m)
        .filter((texto) => /\p{Extended_Pictographic}|[—–]| - /u.test(texto))
        .map((texto) => `${m.id}: ${texto}`),
    );
    expect(ofensores).toEqual([]);
  });

  it("fora de saúde, nenhum texto fala de paciente, consulta, exame ou clínica", () => {
    const JARGAO_DE_SAUDE =
      /\b(paciente|pacientes|consulta|consultas|exame|exames|cirurgia|clínica|médico|médica|tratamento|procedimento|dentista)\b/iu;
    const ofensores = modelosDaMia.flatMap((m) =>
      textosDoModelo(m)
        .filter((texto) => JARGAO_DE_SAUDE.test(texto))
        .map((texto) => `${m.id}: ${texto}`),
    );
    expect(ofensores).toEqual([]);
  });

  it("todo segmento da MIA tem os seus próprios modelos, não uma cópia do geral", () => {
    const corposDoGeral = new Set(
      modelosDoNicho("geral").flatMap((m) =>
        m.grafo.nodes.flatMap((n) => (n.type === "action" && n.config.mode === "text" ? [n.config.body] : [])),
      ),
    );
    for (const nicho of SEGMENTOS_DA_MIA.filter((n) => n !== "geral")) {
      const primeiraMensagem = modelosDoNicho(nicho).map((m) => {
        const no = m.grafo.nodes.find((n) => n.id === "msg-1");
        return no?.type === "action" && no.config.mode === "text" ? no.config.body : "";
      });
      expect([nicho, primeiraMensagem.filter((c) => corposDoGeral.has(c))]).toEqual([nicho, []]);
    }
  });
});

describe("escada de toques", () => {
  it("liga as três saídas de todo nó de resposta — é o que o publish cobra", () => {
    const grafo = montarEscada({
      prazoDeRespostaMs: 2 * DIA_MS,
      sim: { rotulo: "Topou", padrao: "quero" },
      notaDeResposta: "nota",
      toques: [
        { rotulo: "um", texto: "primeiro toque do fluxo, com texto de verdade" },
        { esperaAntesMs: DIA_MS, rotulo: "dois", texto: "segundo toque do fluxo, com texto de verdade" },
      ],
    });
    const saidasDaPrimeira = grafo.edges.filter((e) => e.source === "resposta-1");
    expect(saidasDaPrimeira.map((e) => e.condition).sort((a, b) => a.type.localeCompare(b.type))).toEqual([
      { type: "always" },
      { type: "branch", branch_id: "topou" },
      { type: "branch", branch_id: "no_reply" },
    ]);
    // "sem resposta" do toque 1 tem de cair no degrau seguinte, não num fim:
    // a escada que não anda manda uma mensagem só e se chama de sequência.
    expect(saidasDaPrimeira.find((e) => e.condition.type === "branch" && e.condition.branch_id === "no_reply")?.target)
      .toBe("espera-2");
    expect(validateFlowForPublish(grafo).ok).toBe(true);
  });

  it("escreve a espera em dias e horas, nunca em milissegundos", () => {
    expect(rotuloDaEspera(DIA_MS)).toBe("Espera 1 dia");
    expect(rotuloDaEspera(21 * DIA_MS)).toBe("Espera 21 dias");
    expect(rotuloDaEspera(2 * 3_600_000)).toBe("Espera 2 horas");
  });
});
