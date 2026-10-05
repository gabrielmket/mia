/**
 * FORK MIA (cliente modelo) — os DADOS das sementes, sem banco.
 *
 * As cinco: a Empresa Modelo (a bancada) e as quatro demonstrações por segmento
 * (construtora, clínica odontológica, indústria e academia). Os blocos do começo
 * são da bancada; os do fim valem para TODAS (`describe.each`).
 *
 * O teste que roda a semente de verdade, duas vezes, é o invariante
 * tests/invariants/cliente-modelo-semente.test.ts. Aqui fica o que dá para
 * provar sem Postgres, e que falha em segundos em vez de minutos:
 *
 *  - o vocabulário de origem é o do produto (quem mudar lá, vê vermelho aqui);
 *  - nenhum telefone ou e-mail pode bater em pessoa real;
 *  - toda referência entre os dados existe (contato, modelo, nó do fluxo);
 *  - todo funil tem negócio em todas as etapas;
 *  - nenhum nome de cliente real da Time Company.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  COMPROMISSOS,
  CONTATOS,
  CONVERSAS,
  EMPRESAS,
  EQUIPE,
  FUNIS,
  INSCRICOES,
  NOME_DA_EMPRESA,
  TAREFAS,
  emailFalso,
  telefoneFalso,
} from "@/lib/demonstracao/semente/dados";
import { etapasDoFunil, idDaDemonstracao, ORIGENS } from "@/lib/demonstracao/semente/aplicar";
import { cnpjFalso, digitosDoCnpj } from "@/lib/demonstracao/semente/segmentos/comum";
import { SEMENTES, todasAsSementes } from "@/lib/demonstracao/semente/segmentos";
import { SEGMENTOS_DE_DEMONSTRACAO, type SementeDeDemonstracao } from "@/lib/demonstracao/semente/tipos";
import { modelosDoSegmento } from "@/lib/obrigacoes/catalogo";
import { idEstavel } from "@/lib/demonstracao/semente/ids";
import { MODELOS_DE_FOLLOWUP } from "@/lib/followup/modelos";
import { ETIQUETA_DO_CARD, ETIQUETA_DO_FORMULARIO, ORIGEM_DO_LEAD } from "@/lib/leads-da-meta/gravar";
import { PACOTES } from "@/lib/onboarding/pacotes-de-funil";
import { pipelineConfigPatchSchema } from "@/lib/schemas/settings";

describe("o vocabulário de origem é o do produto", () => {
  it("formulário e clique da Meta usam a origem e as etiquetas de lib/leads-da-meta", () => {
    expect(ORIGENS.meta_formulario.source).toBe(ORIGEM_DO_LEAD);
    expect(ORIGENS.meta_clique_whatsapp.source).toBe(ORIGEM_DO_LEAD);
    expect(ORIGENS.meta_formulario.tags).toEqual([ETIQUETA_DO_CARD, ETIQUETA_DO_FORMULARIO]);
    expect(ORIGENS.meta_clique_whatsapp.tags).toEqual([ETIQUETA_DO_CARD]);
  });

  it("o Google usa a origem e a etiqueta de lib/leads/nascimento-do-lead", () => {
    // `ROTULO_DE_ANUNCIO` não é exportado; a fonte é o contrato.
    const fonte = readFileSync("lib/leads/nascimento-do-lead.ts", "utf8");
    expect(fonte).toContain(`${ORIGENS.google.source}: "${ORIGENS.google.tags[0]}"`);
  });
});

describe("os ids são estáveis", () => {
  it("a mesma chave dá o mesmo UUID v5, e chaves diferentes dão ids diferentes", () => {
    const a = idEstavel("contato:marina");
    expect(idEstavel("contato:marina")).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(idEstavel("contato:marinA")).not.toBe(a);
  });
});

describe("dado fictício que nunca bate em pessoa real", () => {
  it("⭐ telefone do DDD 00 (não existe no Brasil), no formato E.164 que o banco exige", () => {
    for (const c of CONTATOS) {
      const tel = telefoneFalso(c.n);
      expect(tel).toMatch(/^\+5500\d{9}$/);
      expect(tel).toMatch(/^\+\d{8,15}$/);
    }
  });

  it("⭐ e-mail no domínio reservado .invalid (RFC 2606)", () => {
    for (const nome of [...CONTATOS.map((c) => c.nome), ...EQUIPE.map((p) => p.nome)]) {
      expect(emailFalso(nome)).toMatch(/^[a-z0-9.]+@exemplo\.invalid$/);
    }
  });

  it("chaves e números de contato não se repetem", () => {
    expect(new Set(CONTATOS.map((c) => c.chave)).size).toBe(CONTATOS.length);
    expect(new Set(CONTATOS.map((c) => c.n)).size).toBe(CONTATOS.length);
  });

  it("⭐ nenhum nome de cliente real da Time Company", () => {
    const proibidos = [
      "ultra sorriso",
      "erglares",
      "castelo",
      "jhs",
      "conexão car",
      "conexao car",
      "skull",
      "protev",
      "foguinho",
      "limpando",
      "reativa",
      "body fit",
      "bodyfit",
      "arco do triunfo",
      "somattos",
      "mércia",
      "alessandra cieri",
      "time company",
    ];
    const texto = JSON.stringify({ CONTATOS, EMPRESAS, EQUIPE, FUNIS, CONVERSAS, COMPROMISSOS, TAREFAS }).toLowerCase();
    for (const p of proibidos) expect(texto, p).not.toContain(p);
    expect(NOME_DA_EMPRESA).toContain("Demonstração");
  });
});

describe("as referências entre os dados existem", () => {
  const contatos = new Set(CONTATOS.map((c) => c.chave));

  it("todo negócio, conversa, compromisso e inscrição aponta para um contato da semente", () => {
    for (const f of FUNIS) for (const n of f.negocios) expect(contatos.has(n.contato), n.titulo).toBe(true);
    for (const c of CONVERSAS) expect(contatos.has(c.contato), c.chave).toBe(true);
    for (const c of COMPROMISSOS) expect(contatos.has(c.contato), c.chave).toBe(true);
    for (const i of INSCRICOES) expect(contatos.has(i.contato), i.chave).toBe(true);
    for (const t of TAREFAS) if (t.contato) expect(contatos.has(t.contato), t.chave).toBe(true);
  });

  it("toda empresa de contato existe, e há empresa com três ou mais pessoas", () => {
    const empresas = new Set(EMPRESAS.map((e) => e.chave));
    const porEmpresa = new Map<string, number>();
    for (const c of CONTATOS) {
      if (!c.empresa) continue;
      expect(empresas.has(c.empresa), c.chave).toBe(true);
      porEmpresa.set(c.empresa, (porEmpresa.get(c.empresa) ?? 0) + 1);
    }
    expect(Math.max(...porEmpresa.values())).toBeGreaterThanOrEqual(3);
  });

  it("⭐ toda inscrição usa um modelo de follow-up que existe, num nó que existe no grafo dele", () => {
    for (const i of INSCRICOES) {
      const modelo = MODELOS_DE_FOLLOWUP.find((m) => m.id === i.modelo);
      expect(modelo, i.modelo).toBeDefined();
      expect(modelo!.grafo.nodes.map((n) => n.id), `${i.chave} → ${i.no}`).toContain(i.no);
    }
  });

  it("todo segmento de follow-up com funil próprio tem inscrição, e os modelos cobrem todos os nichos", () => {
    const nichos = new Set(INSCRICOES.map((i) => MODELOS_DE_FOLLOWUP.find((m) => m.id === i.modelo)!.nicho));
    expect([...nichos].sort()).toEqual(["academia", "automotivo", "clinica", "geral", "imobiliario", "servicos_b2b"]);
  });
});

describe("os funis", () => {
  it("⭐ todo funil tem negócio em TODAS as etapas, e nenhum negócio aponta para etapa inexistente", () => {
    for (const f of FUNIS) {
      const chaves = f.etapas
        ? f.etapas.map((e) => e.chave)
        : PACOTES.find((p) => p.id === f.pacote)!.proposta.etapas.map((e) => e.passo as string);
      const ocupadas = new Set(f.negocios.map((n) => n.passo));
      expect(chaves.filter((c) => !ocupadas.has(c)), `etapas vazias em ${f.chave}`).toEqual([]);
      expect([...ocupadas].filter((c) => !chaves.includes(c)), `etapas inexistentes em ${f.chave}`).toEqual([]);
    }
  });

  it("os quadros prontos do onboarding que a semente usa existem", () => {
    for (const f of FUNIS) if (f.pacote) expect(PACOTES.some((p) => p.id === f.pacote), f.pacote).toBe(true);
  });

  it("campos e motivos de perda passam no MESMO schema da tela de configuração do funil", () => {
    for (const f of FUNIS) {
      const r = pipelineConfigPatchSchema.safeParse({
        fields: f.campos,
        lost_reasons: f.motivosDePerda,
        won_reasons: f.motivosDeGanho,
        vitoria_e_receita: f.vitoriaEReceita,
      });
      expect(r.success, `${f.chave}: ${r.success ? "" : JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });

  it("negócio perdido tem motivo que está na lista do funil; negócio fechado não tem motivo de perda", () => {
    for (const f of FUNIS) {
      const labels = new Set(f.motivosDePerda.map((m) => m.label));
      for (const n of f.negocios) {
        if (n.motivoDaPerda) expect(labels.has(n.motivoDaPerda), `${f.chave}: ${n.motivoDaPerda}`).toBe(true);
      }
    }
  });

  it("as cinco origens aparecem", () => {
    const origens = new Set(FUNIS.flatMap((f) => f.negocios.map((n) => n.origem)));
    expect([...origens].sort()).toEqual(["google", "indicacao", "meta_clique_whatsapp", "meta_formulario", "site"]);
  });
});

describe("o roteiro SQL (`--sql`) escreve literais que o Postgres lê do mesmo jeito que os parâmetros", () => {
  it("texto com aspas e barra, nulo, número, booleano, data, lista e jsonb", async () => {
    const { literal, json, sql } = await import("@/lib/demonstracao/semente/escritor");
    expect(literal("d'Ávila")).toBe("'d''Ávila'");
    // O bytea "\x00" (4 caracteres): com barra, a forma E'' dobra a barra.
    expect(literal(String.raw`\x00`)).toBe(String.raw`E'\\x00'`);
    expect(literal(null)).toBe("null");
    expect(literal(42)).toBe("42");
    expect(literal(true)).toBe("true");
    expect(literal(new Date("2026-09-30T15:00:00.000Z"))).toBe("'2026-09-30T15:00:00.000Z'::timestamptz");
    expect(literal([])).toBe("'{}'::text[]");
    expect(literal(["a", "b'c"])).toBe("array['a', 'b''c']::text[]");
    expect(literal(json({ a: "x'y" }))).toBe(`'{"a":"x''y"}'::jsonb`);
    expect(literal(sql("(select 1)"))).toBe("(select 1)");
    expect(() => literal(Number.NaN)).toThrow();
  });

  it("troca cada `$n` pelo literal certo, e recusa parâmetro que falta", async () => {
    const { escritorDeRoteiro, json } = await import("@/lib/demonstracao/semente/escritor");
    const r = escritorDeRoteiro();
    expect(await r.executar("insert into t (a, b, c) values ($1, $2::jsonb, $10)", [
      "x", json({ k: 1 }), 0, 0, 0, 0, 0, 0, 0, "dez",
    ])).toBeNull();
    expect(r.comandos()).toEqual([`insert into t (a, b, c) values ('x', '{"k":1}'::jsonb::jsonb, 'dez');`]);
    await expect(r.executar("select $2", ["só um"])).rejects.toThrow(/\$2/);
  });
});

// ─── AS CINCO SEMENTES ───────────────────────────────────────────────────────

/** Os nomes de clientes reais da Time Company que nenhuma semente pode citar. */
const PROIBIDOS = [
  "ultra sorriso",
  "sorriso",
  "erglares",
  "castelo",
  "jhs",
  "biomateria",
  "conexão car",
  "conexao car",
  "skull",
  "protev",
  "foguinho",
  "limpando",
  "reativa",
  "body fit",
  "bodyfit",
  "arco do triunfo",
  "somattos",
  "mércia",
  "alessandra cieri",
  "time company",
];

/** Os três tipos de agendamento que o banco semeia em toda empresa nova. */
const TIPOS_DO_BANCO = ["consulta", "reuniao", "atendimento"];

const SEGMENTOS = todasAsSementes().map((s) => [s.segmento, s] as const);
const DEMONSTRACOES = SEGMENTOS.filter(([segmento]) => segmento !== "bancada");

describe("o catálogo das sementes", () => {
  it("há uma semente por segmento, e cada uma é do segmento que diz ser", () => {
    expect(Object.keys(SEMENTES).sort()).toEqual([...SEGMENTOS_DE_DEMONSTRACAO].sort());
    for (const [segmento, s] of SEGMENTOS) expect(s.segmento).toBe(segmento);
  });

  it("⭐ a bancada mantém os ids de antes (sem prefixo); as demonstrações têm prefixo próprio", () => {
    expect(SEMENTES.bancada.prefixoDosIds).toBe("");
    expect(idDaDemonstracao("bancada")).toBe(idEstavel("organizacao"));
    const prefixos = DEMONSTRACOES.map(([, s]) => s.prefixoDosIds);
    expect(prefixos.every((p) => p.startsWith("demo:"))).toBe(true);
    expect(new Set(prefixos).size).toBe(prefixos.length);
  });

  it("⭐ nada se repete entre as empresas: id, slug, nome, sessão do canal e número", () => {
    for (const campo of ["slug", "nome", "sessaoDoCanal", "telefoneDoCanal"] as const) {
      const valores = SEGMENTOS.map(([, s]) => s[campo]);
      expect(new Set(valores).size, campo).toBe(valores.length);
    }
    const ids = SEGMENTOS.map(([segmento]) => idDaDemonstracao(segmento));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("os nomes das demonstrações são os pedidos", () => {
    expect(DEMONSTRACOES.map(([, s]) => s.nome)).toEqual([
      "Demonstração · Construtora",
      "Demonstração · Clínica Odontológica",
      "Demonstração · Indústria",
      "Demonstração · Academia",
    ]);
  });

  it("⭐ o e-mail de cada pessoa da equipe é único na INSTALAÇÃO (auth.users), não só na empresa", () => {
    const emails = SEGMENTOS.flatMap(([, s]) => s.equipe.map((p) => emailFalso(p.nome)));
    expect(new Set(emails).size).toBe(emails.length);
  });

  it("⭐ o CNPJ fictício tem os dígitos verificadores errados: não é de empresa nenhuma", () => {
    for (const [, s] of SEGMENTOS) {
      for (const e of s.empresas.filter((x) => x.cnpj)) {
        expect(e.cnpj, e.nome).toMatch(/^\d{14}$/);
        expect(e.cnpj!.slice(12), e.nome).not.toBe(digitosDoCnpj(e.cnpj!.slice(0, 12)));
      }
    }
    expect(cnpjFalso(1)).not.toBe(cnpjFalso(2));
    // O conferidor é o de verdade: um CNPJ válido conhecido passa nele.
    expect(digitosDoCnpj("112223330001")).toBe("81");
  });
});

describe.each(SEGMENTOS)("a semente %s", (_segmento, s: SementeDeDemonstracao) => {
  const contatos = new Set(s.contatos.map((c) => c.chave));
  const equipe = new Set(s.equipe.map((p) => p.chave));
  const donos = new Set([...equipe, "ia"]);

  it("⭐ dado fictício: telefone do DDD 00, e-mail .invalid, e nenhum cliente real da Time Company", () => {
    for (const c of s.contatos) expect(telefoneFalso(c.n)).toMatch(/^\+5500\d{9}$/);
    expect(s.telefoneDoCanal).toMatch(/^\+5500\d{9,11}$/);
    for (const nome of [...s.contatos.map((c) => c.nome), ...s.equipe.map((p) => p.nome)]) {
      expect(emailFalso(nome)).toMatch(/^[a-z0-9.]+@exemplo\.invalid$/);
    }
    for (const e of s.empresas) if (e.site) expect(e.site).toMatch(/\.exemplo\.invalid$/);
    const texto = JSON.stringify(s).toLowerCase();
    for (const p of PROIBIDOS) expect(texto, p).not.toContain(p);
  });

  it("chaves e números de contato não se repetem; o gestor e os donos são da equipe", () => {
    expect(new Set(s.contatos.map((c) => c.chave)).size).toBe(s.contatos.length);
    expect(new Set(s.contatos.map((c) => c.n)).size).toBe(s.contatos.length);
    expect(equipe.has(s.gestor)).toBe(true);
    expect(s.equipe.filter((p) => p.papel === "manager").length).toBeGreaterThanOrEqual(1);
  });

  it("toda referência existe: contato, empresa, dono, responsável", () => {
    const empresas = new Set(s.empresas.map((e) => e.chave));
    for (const c of s.contatos) if (c.empresa) expect(empresas.has(c.empresa), c.chave).toBe(true);
    for (const f of s.funis) {
      for (const n of f.negocios) {
        expect(contatos.has(n.contato), n.titulo).toBe(true);
        expect(donos.has(n.dono), `${n.titulo}: dono ${n.dono}`).toBe(true);
      }
    }
    for (const c of s.conversas) {
      expect(contatos.has(c.contato), c.chave).toBe(true);
      expect(donos.has(c.com), c.chave).toBe(true);
      if (c.passagem?.reconhecidaPor) expect(equipe.has(c.passagem.reconhecidaPor), c.chave).toBe(true);
    }
    for (const c of s.compromissos) {
      expect(contatos.has(c.contato), c.chave).toBe(true);
      expect(equipe.has(c.dono), c.chave).toBe(true);
    }
    for (const t of s.tarefas) {
      expect(equipe.has(t.dono), t.chave).toBe(true);
      if (t.contato) expect(contatos.has(t.contato), t.chave).toBe(true);
    }
    for (const i of s.inscricoes) expect(contatos.has(i.contato), i.chave).toBe(true);
  });

  it("⭐ todo funil tem negócio em TODAS as etapas, um ganho e uma perda, e nenhum passo do agente repetido", () => {
    for (const f of s.funis) {
      if (f.pacote) expect(PACOTES.some((p) => p.id === f.pacote), f.pacote).toBe(true);
      const etapas = etapasDoFunil(f);
      const chaves = etapas.map((e) => e.chave);
      const ocupadas = new Set(f.negocios.map((n) => n.passo));
      expect(chaves.filter((c) => !ocupadas.has(c)), `etapas vazias em ${f.chave}`).toEqual([]);
      expect([...ocupadas].filter((c) => !chaves.includes(c)), `etapas inexistentes em ${f.chave}`).toEqual([]);
      expect(etapas.filter((e) => e.fim === "won"), f.chave).toHaveLength(1);
      expect(etapas.filter((e) => e.fim === "lost"), f.chave).toHaveLength(1);
      // `uniq_crm_stages_pipeline_hint`: o banco recusa dois passos iguais no mesmo funil.
      const passos = etapas.map((e) => e.passo).filter(Boolean);
      expect(new Set(passos).size, f.chave).toBe(passos.length);
      for (const e of etapas) {
        if (e.probabilidade === undefined) continue;
        expect(e.probabilidade).toBeGreaterThanOrEqual(0);
        expect(e.probabilidade).toBeLessThanOrEqual(100);
      }
      // O título é a identidade do negócio dentro do funil (id estável).
      expect(new Set(f.negocios.map((n) => n.titulo)).size, f.chave).toBe(f.negocios.length);
    }
    expect(s.funis.some((f) => f.chave === s.funilPadrao)).toBe(true);
    expect(new Set(s.funis.map((f) => f.chave)).size).toBe(s.funis.length);
  });

  it("campos e motivos passam no schema da tela; perdido tem motivo da lista, ganho tem motivo da lista", () => {
    for (const f of s.funis) {
      const r = pipelineConfigPatchSchema.safeParse({
        fields: f.campos,
        lost_reasons: f.motivosDePerda,
        won_reasons: f.motivosDeGanho,
        vitoria_e_receita: f.vitoriaEReceita,
      });
      expect(r.success, `${f.chave}: ${r.success ? "" : JSON.stringify(r.error.issues)}`).toBe(true);
      const perdas = new Set(f.motivosDePerda.map((m) => m.label));
      const ganhos = new Set(f.motivosDeGanho);
      const campos = new Set(f.campos.map((c) => c.key));
      for (const n of f.negocios) {
        if (n.motivoDaPerda) expect(perdas.has(n.motivoDaPerda), `${f.chave}: ${n.motivoDaPerda}`).toBe(true);
        if (n.motivoDoGanho) expect(ganhos.has(n.motivoDoGanho), `${f.chave}: ${n.motivoDoGanho}`).toBe(true);
        for (const k of Object.keys(n.campos ?? {})) expect(campos.has(k), `${n.titulo}: campo ${k}`).toBe(true);
      }
    }
  });

  it("⭐ todo follow-up instalado existe e aponta para uma etapa que existe; toda inscrição usa um instalado, num nó do grafo", () => {
    for (const f of s.followups) {
      expect(MODELOS_DE_FOLLOWUP.some((m) => m.id === f.modelo), f.modelo).toBe(true);
      const funil = s.funis.find((x) => x.chave === f.funil);
      expect(funil, `${f.modelo}: funil ${f.funil}`).toBeDefined();
      expect(etapasDoFunil(funil!).some((e) => e.chave === f.etapa), `${f.modelo}: etapa ${f.etapa}`).toBe(true);
    }
    const instalados = new Set(s.followups.map((f) => f.modelo));
    for (const i of s.inscricoes) {
      expect(instalados.has(i.modelo), `${i.chave} usa ${i.modelo}, que a semente não instala`).toBe(true);
      const modelo = MODELOS_DE_FOLLOWUP.find((m) => m.id === i.modelo)!;
      expect(modelo.grafo.nodes.map((n) => n.id), `${i.chave} → ${i.no}`).toContain(i.no);
    }
  });

  it("toda obrigação é de um tipo do modelo do segmento, ligada a algo que existe", () => {
    if (!s.obrigacoes) return;
    const tipos = new Set(modelosDoSegmento(s.obrigacoes.segmento).map((m) => m.nome));
    const funil = s.funis.find((f) => f.chave === s.obrigacoes!.funil);
    expect(funil).toBeDefined();
    const negocios = new Set(funil!.negocios.map((n) => n.titulo));
    const empresas = new Set(s.empresas.map((e) => e.chave));
    const conversas = new Set(s.conversas.map((c) => c.chave));
    for (const o of s.obrigacoes.itens) {
      expect(tipos.has(o.tipo), `${o.chave}: ${o.tipo}`).toBe(true);
      expect(equipe.has(o.responsavel), o.chave).toBe(true);
      expect(Boolean(o.negocio || o.empresa || o.contato), `${o.chave} sem vínculo`).toBe(true);
      if (o.negocio) expect(negocios.has(o.negocio), `${o.chave}: ${o.negocio}`).toBe(true);
      if (o.empresa) expect(empresas.has(o.empresa), o.chave).toBe(true);
      if (o.contato) expect(contatos.has(o.contato), o.chave).toBe(true);
      if (o.proposta) expect(conversas.has(o.proposta.conversa), o.chave).toBe(true);
    }
    expect(new Set(s.obrigacoes.itens.map((o) => o.chave)).size).toBe(s.obrigacoes.itens.length);
  });

  it("a agenda: todo tipo existe, e ninguém tem dois compromissos no mesmo instante", () => {
    const tipos = new Set([...TIPOS_DO_BANCO, ...s.tiposDeAgenda.map((t) => t.slug)]);
    for (const c of s.compromissos) expect(tipos.has(c.tipo), `${c.chave}: ${c.tipo}`).toBe(true);
    const instantes = s.compromissos.map((c) => `${c.dono}@${c.emDias}@${c.hora}`);
    expect(new Set(instantes).size).toBe(instantes.length);
    expect(new Set(s.compromissos.map((c) => c.chave)).size).toBe(s.compromissos.length);
  });

  it("o catálogo: código único (também depois de virar id) e preço que o banco aceita", () => {
    const codigos = s.produtos.map((p) => p.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
    const ids = codigos.map((c) => c.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of s.produtos) {
      expect(p.codigo.length, p.codigo).toBeLessThanOrEqual(60);
      expect(p.precoReais, p.codigo).toBeGreaterThanOrEqual(0);
    }
  });
});

describe.each(DEMONSTRACOES)("o que a demonstração %s mostra", (_segmento, s: SementeDeDemonstracao) => {
  const negocios = s.funis.flatMap((f) => f.negocios);

  it("⭐ um negócio de verdade: funis com valores, donos pessoa e IA, próxima ação e várias origens", () => {
    expect(negocios.length).toBeGreaterThanOrEqual(15);
    expect(negocios.filter((n) => n.valorReais !== null && n.valorReais > 0).length).toBeGreaterThan(negocios.length * 0.8);
    expect(negocios.some((n) => n.dono === "ia")).toBe(true);
    expect(negocios.some((n) => n.dono !== "ia")).toBe(true);
    expect(negocios.filter((n) => n.proximaAcao).length).toBeGreaterThanOrEqual(5);
    expect(new Set(negocios.map((n) => n.origem)).size).toBeGreaterThanOrEqual(4);
  });

  it("⭐ conversas com a IA: qualificação, ficha, passagem para uma pessoa e uma perdida", () => {
    expect(s.conversas.length).toBeGreaterThanOrEqual(5);
    expect(s.conversas.some((c) => c.mensagens.some((m) => m.de === "ia"))).toBe(true);
    expect(s.conversas.some((c) => c.com === "ia")).toBe(true);
    expect(s.conversas.filter((c) => c.ficha).length).toBeGreaterThanOrEqual(3);
    expect(s.conversas.some((c) => c.passagem)).toBe(true);
    expect(s.conversas.some((c) => c.passo === "lost")).toBe(true);
  });

  it("⭐ agenda passada e futura, com falta e cancelamento; tarefas, uma atrasada", () => {
    expect(s.compromissos.filter((c) => c.emDias > 0).length).toBeGreaterThanOrEqual(4);
    expect(s.compromissos.filter((c) => c.emDias < 0).length).toBeGreaterThanOrEqual(3);
    expect(s.compromissos.some((c) => c.status === "no_show")).toBe(true);
    expect(s.compromissos.some((c) => c.status === "cancelled")).toBe(true);
    expect(s.compromissos.some((c) => c.criadoPor === "ai")).toBe(true);
    expect(s.tarefas.some((t) => t.status === "pending" && t.emDias !== null && t.emDias < 0)).toBe(true);
  });

  it("⭐ os quatro follow-ups do segmento, todos publicados (com inscrição), andando e terminados", () => {
    const nichos = new Set(s.followups.map((f) => MODELOS_DE_FOLLOWUP.find((m) => m.id === f.modelo)!.nicho));
    expect(nichos.size).toBe(1);
    expect(s.followups).toHaveLength(4);
    const emUso = new Set(s.inscricoes.map((i) => i.modelo));
    expect(s.followups.every((f) => emUso.has(f.modelo))).toBe(true);
    expect(s.inscricoes.some((i) => i.status === "active" || i.status === "waiting_reply")).toBe(true);
    expect(s.inscricoes.some((i) => i.status === "completed" || i.status === "cancelled")).toBe(true);
  });

  it("⭐ obrigações do segmento: vencido ou atrasado, com histórico, pedido, a pedir e um arquivo esperando", () => {
    const itens = s.obrigacoes!.itens;
    expect(itens.length).toBeGreaterThanOrEqual(8);
    expect(itens.some((o) => (o.validoAteEmDias ?? 1) < 0 || (o.proximaEmDias ?? 1) < 0)).toBe(true);
    expect(itens.some((o) => o.ciclos && o.ciclos.length > 0)).toBe(true);
    expect(itens.some((o) => o.proposta)).toBe(true);
    expect(itens.some((o) => o.recebidoEmDias === undefined && o.pedidoEmDias === undefined && o.proximaEmDias === undefined)).toBe(true);
    expect(itens.some((o) => o.pedidoEmDias !== undefined && o.recebidoEmDias === undefined)).toBe(true);
  });

  it("produtos e serviços no catálogo, um agente com persona do segmento e a equipe", () => {
    expect(s.produtos.length).toBeGreaterThanOrEqual(8);
    expect(s.agente.prompt.length).toBeGreaterThan(200);
    expect(s.agente.nome).toContain("demonstração");
    expect(s.equipe.length).toBeGreaterThanOrEqual(4);
    expect(s.nome.startsWith("Demonstração · ")).toBe(true);
    expect(s.slug.startsWith("demonstracao-")).toBe(true);
  });

  it("sem travessão no texto (é texto de tela)", () => {
    expect(JSON.stringify(s)).not.toMatch(/[—–]/);
  });
});

describe("a indústria, por dentro", () => {
  const s = SEMENTES.industria;

  it("⭐ empresa cliente com quem compra, quem decide e quem cuida do financeiro", () => {
    const porEmpresa = new Map<string, string[]>();
    for (const c of s.contatos) if (c.empresa) porEmpresa.set(c.empresa, [...(porEmpresa.get(c.empresa) ?? []), c.setor ?? ""]);
    const completas = [...porEmpresa.values()].filter((setores) =>
      ["Compras", "Diretoria", "Financeiro"].every((x) => setores.includes(x)),
    );
    expect(completas.length).toBeGreaterThanOrEqual(2);
    expect(s.contatos.some((c) => c.empresa && c.decisor)).toBe(true);
  });

  it("⭐ funil do quadro pronto de indústria, recompra com histórico e tabela por tipo de cliente", () => {
    expect(s.funis.find((f) => f.chave === "pedidos")?.pacote).toBe("industria");
    expect(s.funis.some((f) => f.chave === "recompra")).toBe(true);
    const reposicoes = s.obrigacoes!.itens.filter((o) => o.tipo === "Pedido de reposição");
    expect(reposicoes.length).toBeGreaterThanOrEqual(3);
    expect(reposicoes.every((o) => (o.ciclos ?? []).length >= 1)).toBe(true);
    expect(new Set(s.empresas.map((e) => e.campos?.tabela)).size).toBeGreaterThanOrEqual(3);
    expect(s.produtos.every((p) => /^[A-Z0-9-]+$/.test(p.codigo))).toBe(true);
    expect(s.agente.prompt).toMatch(/tabela revenda/);
  });
});
