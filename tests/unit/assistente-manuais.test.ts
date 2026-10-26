/**
 * FORK MIA (.88) — as peças puras do assistente da MIA: os manuais apontam para
 * telas que existem, o "Me leva lá" só vai para tela que a pessoa abre, o
 * chamado confere o campo faltando, a ordem do dia é determinística e a última
 * recusa do servidor é a "mensagem do sistema".
 */
import { describe, expect, it } from "vitest";

import { pareceValidacaoDeCampo, navegadorLegivel, semDadoPessoal } from "@/lib/assistente/chamado";
import { destinoPermitido } from "@/lib/assistente/ferramentas";
import { buscarAjuda } from "@/lib/assistente/leituras/ajuda";
import { MANUAIS } from "@/lib/assistente/manuais";
import { prioridadesDoDia, textoDoResumoDaManha } from "@/lib/assistente/prioridades";
import { buscarTelas, rotuloDaTela, telasParaOPapel } from "@/lib/assistente/telas";
import { hrefDoApp } from "@/lib/assistente/tipos";
import { anotarRecusaDoServidor, esquecerRecusas, ultimaRecusaDoServidor } from "@/lib/assistente/ultima-recusa";
import type { RotinaDoDia } from "@/lib/assistente/leituras/rotina";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";

import { rotasDoApp } from "./helpers/telas-do-app";

describe("os manuais do sistema", () => {
  it("todo manual aponta para uma tela que existe: porta do catálogo ou página do app", () => {
    const hrefs = new Set((NAV_CATALOG as ReadonlyArray<{ href: string }>).map((d) => d.href));
    const rotas = new Set(rotasDoApp());
    const quebrados = MANUAIS.filter((m) => !hrefs.has(m.href) && !rotas.has(m.href)).map((m) => `${m.id} → ${m.href}`);
    expect(quebrados).toEqual([]);
  });

  it("ids únicos, cada manual tem passos, e veja também aponta para manual que existe", () => {
    const ids = new Set(MANUAIS.map((m) => m.id));
    expect(ids.size).toBe(MANUAIS.length);
    for (const m of MANUAIS) {
      expect(m.passos.length, m.id).toBeGreaterThan(0);
      for (const outro of m.vejaTambem ?? []) expect(ids.has(outro), `${m.id} → ${outro}`).toBe(true);
    }
  });

  it("o texto do manual é para o cliente: sem travessão", () => {
    const comTravessao = MANUAIS.filter((m) =>
      /[—–]/.test([m.titulo, ...m.passos, m.observacao ?? ""].join(" ")),
    ).map((m) => m.id);
    expect(comTravessao).toEqual([]);
  });

  it("a pergunta do horário da IA acha o manual, e diz que só o administrador muda", () => {
    const telas = telasParaOPapel({ papel: "agent" });
    const achados = buscarAjuda({ pergunta: "Como configuro o horário da IA?", papel: "agent", telas, base: [] });
    expect(achados.manuais[0]?.titulo).toBe("Horário de atendimento da IA");
    expect(achados.manuais[0]?.voce_pode).toBe(false);
    expect(achados.manuais[0]?.quem_pode).toBe("Administrador");
  });

  it("a base própria da empresa entra na busca", () => {
    const achados = buscarAjuda({
      pergunta: "Quem aprova proposta grande?",
      papel: "agent",
      telas: [],
      base: [{ titulo: "Aprovação de proposta", texto: "Acima de R$ 10 mil passa pela gestora." }],
    });
    expect(achados.base_da_empresa).toHaveLength(1);
    expect(achados.fontes).toContain("Como trabalhamos aqui");
  });
});

describe("as telas e o Me leva lá", () => {
  it("o nome da tela sai do catálogo, pelo prefixo mais longo", () => {
    expect(rotuloDaTela("/app/kanban/abc")).toBe("Funis");
    expect(rotuloDaTela("/app/tasks/planos")).toBe("Planos de tarefa");
    expect(rotuloDaTela("/app/assistente")).toBe("Assistente");
  });

  it("o atendente não recebe botão para tela de administrador; o administrador recebe", () => {
    expect(destinoPermitido(telasParaOPapel({ papel: "agent" }), "/app/connections")).toBeNull();
    expect(destinoPermitido(telasParaOPapel({ papel: "admin" }), "/app/connections")?.rotulo).toBe("Conexões");
    expect(destinoPermitido(telasParaOPapel({ papel: "agent" }), "/app/inbox?id=0a000000-0000-4000-8000-000000000001")?.rotulo).toBe(
      "Inbox",
    );
  });

  it("nunca um endereço de fora", () => {
    expect(hrefDoApp("https://exemplo.invalid")).toBeNull();
    expect(hrefDoApp("javascript:alert(1)")).toBeNull();
    expect(hrefDoApp("/app/../admin")).toBeNull();
    expect(hrefDoApp("//exemplo.invalid/app")).toBeNull();
    expect(hrefDoApp("/app/tasks")).toBe("/app/tasks");
  });

  it("buscar telas acha a conexão pelo assunto", () => {
    const telas = telasParaOPapel({ papel: "admin" });
    expect(buscarTelas(telas, "conectar número de WhatsApp").map((t) => t.href)).toContain("/app/connections");
  });
});

describe("o chamado", () => {
  it("antes de um Erro, a mensagem de campo faltando é reconhecida", () => {
    expect(pareceValidacaoDeCampo({ mensagem: "Informe o valor do negócio" })).toBe(true);
    expect(pareceValidacaoDeCampo({ mensagem: "O campo e-mail é obrigatório" })).toBe(true);
    expect(pareceValidacaoDeCampo({ codigo: "validation_failed" })).toBe(true);
    expect(pareceValidacaoDeCampo({ status: 422 })).toBe(true);
    expect(pareceValidacaoDeCampo({ mensagem: "Não deu para salvar agora", status: 500 })).toBe(false);
  });

  it("o navegador vai em português de gente, nunca a string inteira", () => {
    expect(navegadorLegivel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36")).toBe(
      "Chrome no Windows",
    );
    expect(navegadorLegivel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari/604.1")).toBe("Safari no iPhone");
  });

  it("a mensagem do sistema perde telefone, e-mail e documento", () => {
    expect(semDadoPessoal("Telefone +55 11 99999-0000 já existe para fulano@exemplo.invalid, CPF 123.456.789-09")).toBe(
      "Telefone [telefone] já existe para [e-mail], CPF [documento]",
    );
  });
});

describe("a ordem do dia (determinística, a do resumo da manhã)", () => {
  const rotina: RotinaDoDia = {
    dia: "2026-10-26",
    escopo: "proprio",
    tarefas: { de_hoje: 2, atrasadas: 1, itens: [], atrasadas_por_pessoa: null },
    agenda: {
      compromissos: 1,
      itens: [{ id: "a", inicio: "", quando: "seg 26/10 às 10:00", titulo: "Reunião da proposta", contato: null, contact_id: null, responsavel: null }],
    },
    conversas: {
      com_voce: 3,
      esperando_resposta: 1,
      esperando_mais_de_1h: 1,
      na_fila: null,
      sem_dono: null,
      mais_antigas: [
        { conversation_id: "c1", contact_id: "x", contato: "Helena", esperando_desde: "", horas: 3, dias: 0, responsavel: null },
      ],
    },
    numeros_desconectados: [{ id: "n1", nome: "Suporte", desde: null }],
    contatos: [],
    fontes: [],
  };

  it("algo parado na empresa, cliente esperando, compromisso do dia, atraso", () => {
    const lista = prioridadesDoDia({ rotina, leads: null, performance: null, idioma: "pt-BR" });
    expect(lista.map((p) => p.href)).toEqual(["/app/connections", "/app/inbox?id=c1", "/app/agenda", "/app/tasks"]);
    expect(lista[1]?.texto).toBe("Responder Helena: espera há 3 h.");
  });

  it("o texto do resumo é o mesmo a cada rodada, sem IA", () => {
    const prioridades = prioridadesDoDia({ rotina, leads: null, performance: null, idioma: "pt-BR" });
    const a = textoDoResumoDaManha({ primeiroNome: "Juliana", rotina, prioridades });
    const b = textoDoResumoDaManha({ primeiroNome: "Juliana", rotina, prioridades });
    expect(a).toBe(b);
    expect(a.split("\n")[0]).toBe("Bom dia, Juliana. Seu plano para hoje:");
  });
});

describe("a última recusa do servidor", () => {
  it("guarda a mensagem da tela e ignora a do próprio assistente", () => {
    esquecerRecusas();
    anotarRecusaDoServidor({ mensagem: "Informe o valor do negócio", codigo: "validation_failed", status: 422, rota: "/api/v1/leads/1?x=1" });
    anotarRecusaDoServidor({ mensagem: "limite", codigo: "rate_limited", status: 429, rota: "/api/v1/assistente/chat" });
    expect(ultimaRecusaDoServidor()).toMatchObject({ mensagem: "Informe o valor do negócio", rota: "/api/v1/leads/1" });
  });

  it("a de muito tempo atrás não conta", () => {
    esquecerRecusas();
    anotarRecusaDoServidor({ mensagem: "x", status: 500 });
    expect(ultimaRecusaDoServidor(Date.now() + 11 * 60_000)).toBeNull();
  });
});
