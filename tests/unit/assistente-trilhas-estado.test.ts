/**
 * FORK MIA (.93) — o "Me mostra como" por dentro, sem tela: a régua de cada
 * trilha (feita, pausada, esperando outra), a recomendada, as conferências no
 * sistema (o "desde", o "já fiz", o fim), o lembrete do resumo da manhã (uma
 * vez por pausa, nunca fora do resumo) e o painel da Time (números juntados,
 * sem nome de ninguém, sem a demonstração). Contra o banco em memória.
 */
import { describe, expect, it } from "vitest";

import { bancoEmMemoria } from "@/tests/helpers/banco-em-memoria";
import { encaixar, rotaCasa, TRILHAS, trilhaPorId, type IdDaTrilha } from "@/lib/assistente/trilhas/catalogo";
import { acaoMeMostraComo } from "@/lib/assistente/trilhas/da-ajuda";
import {
  CONFIG_PADRAO_DAS_TRILHAS,
  configDasTrilhasDaLinha,
  situacaoDaTrilha,
  situacoesDasTrilhas,
  trilhaRecomendada,
  type EntradaDaSituacao,
  type ProgressoDaTrilha,
} from "@/lib/assistente/trilhas/estado";
import { lembreteDaTrilhaPausada } from "@/lib/assistente/trilhas/lembrete";
import { limparTextoDaPergunta, ondeOsClientesTravam } from "@/lib/assistente/trilhas/onde-travam";
import { comecarTrilha, conferirObjetivo, conferirPasso, pausarTrilha } from "@/lib/assistente/trilhas/progresso";
import { traduzir } from "@/lib/i18n/dicionario";

const ORG = "93939393-0000-4000-8000-00000000000a";
const DEMO = "93939393-0000-4000-8000-00000000000d";
const EU = "93939393-1111-4000-8000-0000000000a1";

const prog = (trilha: IdDaTrilha, situacao: ProgressoDaTrilha["situacao"], passo = 0): ProgressoDaTrilha => ({
  trilha,
  situacao,
  passo,
  passo_max: passo,
  comecou_em: "2026-10-20T10:00:00.000Z",
  pausou_em: situacao === "pausada" ? "2026-10-26T18:10:00.000Z" : null,
  feita_em: situacao === "feita" ? "2026-10-25T12:00:00.000Z" : null,
  vezes: 1,
});

const entrada = (e: Partial<EntradaDaSituacao> = {}): EntradaDaSituacao => ({
  papel: "admin",
  progresso: [],
  feitasNaEmpresa: new Set(),
  modulos: new Set(["disparador", "email_marketing"]),
  config: { ...CONFIG_PADRAO_DAS_TRILHAS, desligadas: [] },
  ...e,
});

describe("a régua de cada trilha", () => {
  it("a da empresa fica feita quando o sistema mostra, com quem fez, para todos", () => {
    const s = situacaoDaTrilha(trilhaPorId("numero")!, entrada({ papel: "agent", feitasNaEmpresa: new Set(["numero"]), quemFez: new Map([["numero", "Bruno Teixeira"]]) }));
    expect(s).toMatchObject({ estado: "feita", feitaNaEmpresa: true, quemFez: "Bruno Teixeira", doPapel: false });
  });

  it("a de cada pessoa só fica feita pela linha da pessoa (que o servidor grava depois de conferir)", () => {
    expect(situacaoDaTrilha(trilhaPorId("funil")!, entrada()).estado).toBe("nova");
    expect(situacaoDaTrilha(trilhaPorId("funil")!, entrada({ progresso: [prog("funil", "feita")] })).estado).toBe("feita");
  });

  it("pausada guarda o passo; o \"onde parei\" é da pessoa", () => {
    expect(situacaoDaTrilha(trilhaPorId("funil")!, entrada({ progresso: [prog("funil", "pausada", 3)] }))).toMatchObject({ estado: "pausada", passo: 3 });
  });

  it("o follow-up espera o agente; o Broadcast sem o módulo não começa", () => {
    expect(situacaoDaTrilha(trilhaPorId("followup")!, entrada())).toMatchObject({ estado: "espera", esperando: "agente" });
    expect(situacaoDaTrilha(trilhaPorId("followup")!, entrada({ feitasNaEmpresa: new Set(["agente"]) })).estado).toBe("nova");
    expect(situacaoDaTrilha(trilhaPorId("broadcast")!, entrada({ modulos: new Set() })).estado).toBe("sem_modulo");
  });

  it("decisão 9: todos os papéis veem todas as trilhas; o papel decide quem faz", () => {
    const doAtendente = situacoesDasTrilhas(entrada({ papel: "agent" }));
    expect(doAtendente).toHaveLength(TRILHAS.length);
    expect(doAtendente.filter((s) => s.doPapel).map((s) => s.id).sort()).toEqual(["devolver", "importar", "perdido", "relatorio", "respostas"]);
  });

  it("a desligada pela Time some da lista da empresa", () => {
    const config = configDasTrilhasDaLinha({ me_mostra_como: true, desligadas: ["email", "nao_existe"], recomendada: "inventada" });
    expect(config).toMatchObject({ desligadas: ["email"], recomendada: null, gravada: true });
    expect(situacoesDasTrilhas(entrada({ config })).some((s) => s.id === "email")).toBe(false);
  });
});

describe("a recomendada (o Início e a abertura do assistente)", () => {
  it("a escolhida pela Time, se ainda faz sentido para a pessoa", () => {
    const config = { ...CONFIG_PADRAO_DAS_TRILHAS, desligadas: [], recomendada: "equipe" as const };
    expect(trilhaRecomendada(situacoesDasTrilhas(entrada({ config })), config)).toBe("equipe");
  });

  it("senão a pausada; senão a primeira que falta, na ordem; guia curto não é recomendado", () => {
    const config = { ...CONFIG_PADRAO_DAS_TRILHAS, desligadas: [] };
    expect(trilhaRecomendada(situacoesDasTrilhas(entrada({ progresso: [prog("relatorio", "pausada", 2)] })), config)).toBe("relatorio");
    expect(trilhaRecomendada(situacoesDasTrilhas(entrada()), config)).toBe("numero");
    expect(trilhaRecomendada(situacoesDasTrilhas(entrada({ papel: "agent" })), config)).toBe("relatorio");
  });
});

describe("toda resposta de \"como faço\" que tem tela ganha o \"Me mostra como\"", () => {
  const manual = (id: string, voce_pode = true) => ({
    id,
    titulo: "Manual",
    passos: ["Abra a tela.", "Clique no botão."],
    observacao: null,
    tela: "Tela",
    href: "/app/kanban",
    voce_pode,
    quem_pode: "toda a equipe",
    roteiro: false,
    desta_tela: false,
    veja_tambem: [],
  });

  it("o manual com trilha começa a trilha", () => {
    expect(acaoMeMostraComo({ manuais: [manual("marcar-perdido")] }, "agent")).toEqual({ tipo: "me_mostra_como", rotulo: "Me mostra como", trilha_id: "perdido" });
  });

  it("o manual sem trilha, mas com tela, vira o guia curto do manual", () => {
    expect(acaoMeMostraComo({ manuais: [manual("tarefas")] }, "agent")).toMatchObject({ tipo: "me_mostra_como", guia: { id: "tarefas", href: "/app/kanban" } });
  });

  it("quem não abre a tela não ganha botão (o assistente diz quem pode)", () => {
    expect(acaoMeMostraComo({ manuais: [manual("conectar-numero", false)] }, "agent")).toBeNull();
    expect(acaoMeMostraComo({ manuais: [] }, "admin")).toBeNull();
  });
});

describe("os textos", () => {
  it("encaixa os nomes sem deixar chave à mostra; a rota com id casa qualquer segmento", () => {
    expect(encaixar("Conferi: {nome} no ar.", { nome: "Clara" })).toBe("Conferi: Clara no ar.");
    expect(encaixar("Conferi: {nome} no ar.", {})).toBe("Conferi: no ar.");
    expect(rotaCasa("/app/ai/agents/abc", "/app/ai/agents/[id]")).toBe(true);
    expect(rotaCasa("/app/ai/agents", "/app/ai/agents/[id]")).toBe(false);
    expect(rotaCasa("/app/connections?aba=x", "/app/connections")).toBe(true);
  });

  it("⭐ toda frase do catálogo tem espanhol (lib/i18n/dicionario-mia-trilhas.ts)", () => {
    const frases = TRILHAS.flatMap((t) => [t.titulo, t.objetivo, t.pronto, t.euFaco, t.soVoce, t.fim, ...t.passos.flatMap((p) => [p.texto, p.confere, p.conferido, p.fora])]).filter(
      (x): x is string => typeof x === "string",
    );
    const iguais = new Set(["Nada.", "Marcar.", "Publicar.", "Texto escrito.", "Nome escrito.", "E-mail escrito.", "um e-mail válido", "Administrador"]);
    expect(frases.filter((f) => !iguais.has(f) && traduzir(f, "es") === f)).toEqual([]);
  });
});

describe("as conferências no sistema (lib/assistente/trilhas/progresso.ts)", () => {
  const banco = (tabelas: Record<string, Array<Record<string, unknown>>> = {}) => bancoEmMemoria(tabelas);
  const ctx = (db: ReturnType<typeof banco>, trilha: IdDaTrilha, passo = 0) => ({ organizationId: ORG, userId: EU, trilha: trilhaPorId(trilha)!, passo, db });

  it("começar grava a linha da pessoa; pausar guarda o passo e o mais longe", async () => {
    const b = banco();
    const c = ctx(b, "respostas");
    await comecarTrilha(b.cliente as never, c);
    const pausada = await pausarTrilha(b.cliente as never, { ...c, passo: 2 });
    expect(pausada).toMatchObject({ situacao: "pausada", passo: 2, passo_max: 2 });
  });

  it("⭐ o último passo só fica feito quando o sistema mostra, e só o que veio DEPOIS de começar conta", async () => {
    const b = banco({
      mia_assistente_trilhas: [{ organization_id: ORG, user_id: EU, trilha: "respostas", situacao: "andando", passo: 4, passo_max: 4, comecou_em: "2026-10-27T10:00:00.000Z", vezes: 1 }],
      message_templates: [{ id: "t-antigo", organization_id: ORG, created_by_user_id: EU, title: "Antiga", shortcut: "antiga", created_at: "2026-10-01T10:00:00.000Z" }],
    });
    const antes = await conferirPasso(b.cliente as never, ctx(b, "respostas", 4));
    expect(antes).toMatchObject({ ok: false, feita: false });

    b.tabela("message_templates").push({ id: "t-novo", organization_id: ORG, created_by_user_id: EU, title: "Endereço", shortcut: "endereco", created_at: "2026-10-27T10:05:00.000Z" });
    const depois = await conferirPasso(b.cliente as never, ctx(b, "respostas", 4));
    expect(depois).toMatchObject({ ok: true, feita: true, vars: { nome: "endereco" } });
    expect(depois.fim).toContain("endereco");
    expect(b.tabela("mia_assistente_trilhas")[0]).toMatchObject({ situacao: "feita" });
  });

  it("\"Já fiz\" que não confere conta no passo (só o número), e a trilha não fica feita", async () => {
    const b = banco({
      mia_assistente_trilhas: [{ organization_id: ORG, user_id: EU, trilha: "relatorio", situacao: "andando", passo: 2, passo_max: 2, comecou_em: "2026-10-27T10:00:00.000Z", vezes: 1, ja_fiz_sem_conferir: {} }],
    });
    const r = await conferirObjetivo(b.cliente as never, ctx(b, "relatorio", 2));
    expect(r.feita).toBe(false);
    expect(b.tabela("mia_assistente_trilhas")[0]).toMatchObject({ situacao: "andando", ja_fiz_sem_conferir: { "2": 1 } });
  });

  it("a da empresa confere o estado de agora: se alguém fez por outro caminho, conta", async () => {
    const b = banco({
      mia_assistente_trilhas: [{ organization_id: ORG, user_id: EU, trilha: "numero", situacao: "pausada", passo: 3, passo_max: 3, comecou_em: "2026-10-27T10:00:00.000Z", vezes: 1 }],
      channel_sessions: [{ id: "c1", organization_id: ORG, status: "WORKING", archived_at: null, display_name: "Recepção", phone_number: "+00 00 0000-0000" }],
    });
    const r = await conferirObjetivo(b.cliente as never, ctx(b, "numero", 3));
    expect(r).toMatchObject({ feita: true, vars: { nome: "Recepção" } });
  });
});

describe("o lembrete da trilha pausada (decisão 11)", () => {
  const hoje = new Date("2026-10-27T11:00:00.000Z");
  const linha = (pausou_em: string, extra: Record<string, unknown> = {}) => ({
    id: "l1",
    organization_id: ORG,
    user_id: EU,
    trilha: "funil",
    situacao: "pausada",
    passo: 3,
    pausou_em,
    lembrada_em: null,
    ...extra,
  });
  const t = (s: string) => s;

  it("⭐ lembra UMA vez a pausa de ontem: depois de marcar, não lembra de novo", async () => {
    const b = bancoEmMemoria({ mia_assistente_trilhas: [linha("2026-10-26T19:10:00.000Z")] });
    const l = await lembreteDaTrilhaPausada(b.cliente as never, { organizationId: ORG, userId: EU, inicioDoDia: hoje, t });
    expect(l?.texto).toContain("Criar um funil");
    expect(l?.texto).toContain("no passo 4 de");
    expect(l?.acao).toEqual({ tipo: "me_mostra_como", rotulo: "Continuar de onde parei", trilha_id: "funil" });
    await l!.marcar();
    expect(await lembreteDaTrilhaPausada(b.cliente as never, { organizationId: ORG, userId: EU, inicioDoDia: hoje, t })).toBeNull();
  });

  it("a pausa de hoje espera o dia seguinte; a pausa antiga não é lembrada do nada", async () => {
    const deHoje = bancoEmMemoria({ mia_assistente_trilhas: [linha("2026-10-27T11:30:00.000Z")] });
    expect(await lembreteDaTrilhaPausada(deHoje.cliente as never, { organizationId: ORG, userId: EU, inicioDoDia: hoje, t })).toBeNull();
    const antiga = bancoEmMemoria({ mia_assistente_trilhas: [linha("2026-10-10T11:30:00.000Z")] });
    expect(await lembreteDaTrilhaPausada(antiga.cliente as never, { organizationId: ORG, userId: EU, inicioDoDia: hoje, t })).toBeNull();
  });

  it("com o \"Me mostra como\" desligado na empresa, nada", async () => {
    const b = bancoEmMemoria({
      mia_assistente_trilhas: [linha("2026-10-26T19:10:00.000Z")],
      mia_assistente_trilhas_config: [{ organization_id: ORG, me_mostra_como: false, desligadas: [] }],
    });
    expect(await lembreteDaTrilhaPausada(b.cliente as never, { organizationId: ORG, userId: EU, inicioDoDia: hoje, t })).toBeNull();
  });
});

describe("onde os clientes travam (o lado da Time, decisão 12)", () => {
  it("tira e-mail, telefone e documento do texto da pergunta", () => {
    expect(limparTextoDaPergunta("O cliente fulano@exemplo.invalid ligou do +55 (31) 98888-0101, CPF 123.456.789-09")).toBe(
      "O cliente [e-mail] ligou do [telefone], CPF [documento]",
    );
  });

  it("⭐ números juntados, o texto só das sem resposta, sem nome de ninguém e sem a demonstração", async () => {
    const agora = new Date("2026-10-27T12:00:00.000Z");
    const ontem = "2026-10-26T12:00:00.000Z";
    const b = bancoEmMemoria({
      organizations: [
        { id: ORG, status: "active", demonstracao: false, onboarding_state: { segmento: "clinica" } },
        { id: DEMO, status: "active", demonstracao: true, onboarding_state: { segmento: "clinica" } },
      ],
      mia_assistente_mensagens: [
        { organization_id: ORG, user_id: EU, tipo: "pergunta", texto: "como conecto o whatsapp", tela: "/app/connections", sem_resposta: false, created_at: ontem },
        { organization_id: ORG, user_id: EU, tipo: "pergunta", texto: "Dá para mandar PDF? meu e-mail é a@b.invalid", tela: null, sem_resposta: true, created_at: ontem },
        { organization_id: DEMO, user_id: EU, tipo: "pergunta", texto: "pergunta da demonstração", tela: null, sem_resposta: true, created_at: ontem },
      ],
      mia_assistente_trilhas: [
        { organization_id: ORG, user_id: EU, trilha: "numero", situacao: "feita", passo_max: 5, comecou_em: ontem, perguntas_no_passo: { "3": 2 } },
        { organization_id: ORG, user_id: "outra", trilha: "numero", situacao: "pausada", passo_max: 1, pausou_em: "2026-10-01T12:00:00.000Z", comecou_em: ontem, ja_fiz_sem_conferir: { "1": 1 } },
        { organization_id: DEMO, user_id: EU, trilha: "numero", situacao: "andando", passo_max: 0, comecou_em: ontem },
      ],
      mia_assistente_propostas: [
        { organization_id: ORG, tipo: "funil", situacao: "aplicada", created_at: ontem },
        { organization_id: ORG, tipo: "funil", situacao: "desfeita", created_at: ontem },
      ],
    });
    const r = await ondeOsClientesTravam(b.cliente as never, { periodoDias: 30, segmento: "todos", agora });
    expect(r.empresas).toEqual({ usando: 1, no_ar: 1 });
    expect(r.perguntas).toMatchObject({ total: 2, sem_resposta: 1 });
    expect(r.sem_resposta).toEqual([{ pergunta: "Dá para mandar PDF? meu e-mail é [e-mail]", vezes: 1, empresas: 1 }]);
    const numero = r.trilhas.find((x) => x.id === "numero")!;
    expect(numero).toMatchObject({ comecaram: 2, feitas: 1, chegaram_por_passo: [100, 100, 50, 50, 50, 50] });
    expect(numero.maior_queda).toEqual({ passo: 3, pontos: 50 });
    expect(numero.perguntas_por_passo[3]).toBe(2);
    expect(numero.ja_fiz_sem_conferir_por_passo[1]).toBe(1);
    expect(r.abandonadas.find((x) => x.id === "numero")).toMatchObject({ pausadas_ha_mais_de_7_dias: 1, percentual: 50 });
    expect(r.propostas).toEqual([{ tipo: "funil", criadas: 2, aplicadas: 1, rejeitadas: 0, desfeitas: 1, percentual_desfeitas: 50 }]);
    expect(r.temas.find((x) => x.manual === "conectar-numero")).toMatchObject({ perguntas: 1, empresas: 1, existe: "trilha", trilha: "numero" });
    // Nada de quem perguntou, nem da demonstração.
    const texto = JSON.stringify(r);
    expect(texto).not.toContain(EU);
    expect(texto).not.toContain("demonstração\"");
    expect(texto).not.toContain("pergunta da demonstração");
  });
});
