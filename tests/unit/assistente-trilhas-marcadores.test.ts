/**
 * FORK MIA (.93) — A CERCA DAS TRILHAS: trilha quebrada não sobe.
 *
 * O "Me mostra como" destaca, na tela de verdade, o elemento de cada passo pelo
 * marcador `data-testid` (o que o sistema-base usa nos testes; onde faltava,
 * um nosso, marcado FORK MIA). Se uma fusão do upstream renomear o botão ou
 * tirar o marcador, a trilha passa a apontar para o nada: o destaque some, a
 * guia espera para sempre, e ninguém percebe. Esta cerca REPROVA a versão:
 *
 *   - todo marcador de todo passo (o destaque e as conferências) existe num
 *     `data-testid` de `app/` ou `components/`;
 *   - toda tela de passo e todo "Me leva até lá" é uma rota do app que existe;
 *   - todo manual citado existe, e toda leitura do sistema tem quem a leia;
 *   - o último passo de toda trilha confere no SISTEMA (feita vem do sistema);
 *   - a sabotagem: um marcador inventado é acusado (a cerca tem dente).
 *
 *     npx vitest run tests/unit/assistente-trilhas-marcadores.test.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { MANUAIS } from "@/lib/assistente/manuais";
import {
  irDoPasso,
  LEITURAS_DO_SISTEMA,
  leiturasDaConferencia,
  marcadoresDoPasso,
  TRILHAS,
  type Trilha,
} from "@/lib/assistente/trilhas/catalogo";

const RAIZ = join(__dirname, "..", "..");

function arquivosTsx(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) arquivosTsx(p, acc);
    else if (e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx")) acc.push(p);
  }
  return acc;
}

/** As linhas de tela que declaram um `data-testid` (fora da própria guia, que não é alvo). */
const LINHAS_COM_MARCADOR: string[] = ["app", "components"].flatMap((area) =>
  arquivosTsx(join(RAIZ, area))
    .filter((f) => !relative(RAIZ, f).split(sep).join("/").startsWith("components/assistente/trilhas/"))
    .flatMap((f) => readFileSync(f, "utf8").split("\n"))
    .filter((l) => l.includes("data-testid")),
);

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** O marcador existe no código? `etapas-{funil}` casa `` `etapas-${...}` ``; `x*` casa um literal que começa com `x`. */
function marcadorExiste(alvo: string, linhas: readonly string[] = LINHAS_COM_MARCADOR): boolean {
  const molde = alvo.indexOf("{");
  if (molde >= 0) {
    const prefixo = alvo.slice(0, molde);
    const re = new RegExp("`" + escapar(prefixo) + "\\$\\{");
    return linhas.some((l) => re.test(l));
  }
  if (alvo.endsWith("*")) {
    const re = new RegExp("[\"'`]" + escapar(alvo.slice(0, -1)));
    return linhas.some((l) => re.test(l));
  }
  const re = new RegExp("[\"'`]" + escapar(alvo) + "[\"'`]");
  return linhas.some((l) => re.test(l));
}

function rotasDoApp(dir = join(RAIZ, "app", "app"), base = "/app"): string[] {
  const rotas: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const semSegmento = e.name.startsWith("(") || e.name.startsWith("_");
      rotas.push(...rotasDoApp(join(dir, e.name), semSegmento ? base : `${base}/${e.name}`));
    } else if (e.name === "page.tsx") {
      rotas.push(base);
    }
  }
  return rotas;
}

/** `/app/ai/agents/[id]` e `/app/ai/agents/[agentId]` são a mesma forma. */
const forma = (rota: string) => rota.replace(/\[[^\]]+\]/g, "[*]");
const ROTAS = new Set(rotasDoApp().map(forma));

function problemasDa(t: Trilha, existe: (alvo: string) => boolean = marcadorExiste): string[] {
  const problemas: string[] = [];
  t.passos.forEach((p, i) => {
    for (const alvo of marcadoresDoPasso(p)) {
      if (!existe(alvo)) problemas.push(`${t.id}, passo ${i + 1}: o marcador "${alvo}" sumiu do código`);
    }
    if (p.tela && !ROTAS.has(forma(p.tela))) problemas.push(`${t.id}, passo ${i + 1}: a tela ${p.tela} não existe`);
    const ir = irDoPasso(p);
    if (ir && !ROTAS.has(forma(ir))) problemas.push(`${t.id}, passo ${i + 1}: o "Me leva até lá" ${ir} não existe`);
  });
  return problemas;
}

describe("as trilhas apontam para o que existe", () => {
  it("o instrumento enxerga os marcadores (controle: o do sistema-base e um nosso)", () => {
    expect(LINHAS_COM_MARCADOR.length).toBeGreaterThan(500);
    expect(marcadorExiste("novo-funil")).toBe(true);
    expect(marcadorExiste("conectar-novo-whatsapp")).toBe(true);
    expect(marcadorExiste("etapas-{funil}")).toBe(true);
    expect(ROTAS.has("/app/connections")).toBe(true);
  });

  it.each(TRILHAS.map((t) => [t.id, t] as const))("%s: todo passo aponta para um marcador e uma tela que existem", (_id, t) => {
    expect(problemasDa(t), "trilha quebrada não sobe: conserte o catálogo ou devolva o marcador à tela").toEqual([]);
  });

  it("⭐ SABOTAGEM: um marcador inventado é acusado", () => {
    const sabotada: Trilha = {
      ...TRILHAS[0]!,
      passos: [{ ...TRILHAS[0]!.passos[1]!, alvo: "marcador-que-nao-existe-em-tela-nenhuma" }],
    };
    expect(problemasDa(sabotada)).toEqual([
      `${sabotada.id}, passo 1: o marcador "marcador-que-nao-existe-em-tela-nenhuma" sumiu do código`,
    ]);
    // E o marcador que um dia existiu, quando a linha dele some.
    expect(marcadorExiste("novo-funil", LINHAS_COM_MARCADOR.filter((l) => !l.includes("novo-funil")))).toBe(false);
  });

  it("⭐ SABOTAGEM: uma tela que não existe é acusada", () => {
    const sabotada: Trilha = { ...TRILHAS[0]!, passos: [{ ...TRILHAS[0]!.passos[0]!, tela: "/app/tela-que-nao-existe", ir: undefined }] };
    expect(problemasDa(sabotada).some((p) => p.includes("/app/tela-que-nao-existe"))).toBe(true);
  });
});

describe("as regras do catálogo", () => {
  it("ids únicos, e cada trilha tem passos e um objetivo conferido no sistema", () => {
    expect(new Set(TRILHAS.map((t) => t.id)).size).toBe(TRILHAS.length);
    for (const t of TRILHAS) {
      expect(t.passos.length, t.id).toBeGreaterThan(0);
      expect(LEITURAS_DO_SISTEMA, t.id).toContain(t.feita);
    }
  });

  it("⭐ o último passo de toda trilha confere no SISTEMA: feita nunca vem de um clique", () => {
    for (const t of TRILHAS) {
      const ultimo = t.passos[t.passos.length - 1]!;
      expect(ultimo.conferencia.ve, t.id).not.toBe("seguir");
      expect(leiturasDaConferencia(ultimo.conferencia).length, `${t.id}: o último passo não lê o sistema`).toBeGreaterThan(0);
    }
  });

  it("toda leitura do sistema tem quem a leia (lib/assistente/trilhas/leituras.ts)", () => {
    const fonte = readFileSync(join(RAIZ, "lib/assistente/trilhas/leituras.ts"), "utf8");
    for (const l of LEITURAS_DO_SISTEMA) expect(fonte, l).toMatch(new RegExp(`async ${l}\\(`));
  });

  it("todo manual citado existe", () => {
    const ids = new Set(MANUAIS.map((m) => m.id));
    for (const t of TRILHAS) for (const m of t.manuais) expect(ids.has(m), `${t.id} cita o manual ${m}`).toBe(true);
  });

  it("decisão 8: o dia a dia tem as duas que não estavam na lista pedida", () => {
    const doDia = TRILHAS.filter((t) => t.grupo === "dia").map((t) => t.titulo);
    expect(doDia).toEqual(["Criar uma resposta rápida", "Assumir e devolver uma conversa para a IA"]);
  });

  it("o retomar aponta para um passo anterior (o que abre o que se perdeu)", () => {
    for (const t of TRILHAS) {
      t.passos.forEach((p, i) => {
        if (p.retomaEm !== undefined) expect(p.retomaEm, `${t.id}, passo ${i + 1}`).toBeLessThan(i);
      });
    }
  });

  it("texto de tela sem travessão", () => {
    const textos = TRILHAS.flatMap((t) => [t.titulo, t.objetivo, t.pronto, t.euFaco, t.soVoce, t.fim, ...t.passos.flatMap((p) => [p.texto, p.confere, p.conferido ?? "", p.fora ?? ""])]);
    expect(textos.filter((x) => /[—–]/.test(x))).toEqual([]);
  });
});

describe("as peças do \"Me mostra como\" leem com a sessão e nunca clicam", () => {
  const sessao = [
    "lib/assistente/trilhas/catalogo.ts",
    "lib/assistente/trilhas/estado.ts",
    "lib/assistente/trilhas/leituras.ts",
    "lib/assistente/trilhas/progresso.ts",
    "lib/assistente/trilhas/da-ajuda.ts",
    "app/api/v1/assistente/trilhas/route.ts",
  ];
  it.each(sessao)("%s não importa o cliente de serviço nem o pool", (arquivo) => {
    const fonte = readFileSync(join(RAIZ, arquivo), "utf8");
    const imports = [...fonte.matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports.filter((i) => /supabase\/admin|request-pool|agent-engine\/db|^pg$/.test(i ?? ""))).toEqual([]);
    expect(fonte).not.toMatch(/createAdminClient\s*\(/);
  });

  const guia = readdirSync(join(RAIZ, "components/assistente/trilhas")).map((f) => `components/assistente/trilhas/${f}`);
  it.each([...guia, "hooks/assistente/useTrilhas.ts"])("⭐ %s nunca clica nem dispara evento na tela da pessoa", (arquivo) => {
    const fonte = readFileSync(join(RAIZ, arquivo), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");
    expect(fonte).not.toMatch(/\.click\s*\(/);
    expect(fonte).not.toMatch(/dispatchEvent\s*\(/);
    expect(fonte).not.toMatch(/new\s+(Mouse|Pointer|Keyboard|Input)Event\s*\(/);
    expect(fonte).not.toMatch(/\.requestSubmit\s*\(|\.submit\s*\(/);
  });
});
