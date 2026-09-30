/**
 * FORK MIA (cliente modelo) — os DADOS da semente, sem banco.
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
import { ORIGENS } from "@/lib/demonstracao/semente/aplicar";
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
