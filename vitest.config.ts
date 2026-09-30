import { defineConfig } from "vitest/config";
import path from "node:path";

import { selecionarCercas } from "./vitest.cercas";

// As guardas estruturais — o arquivo de teste que só lê o repositório (baseline
// × cadeia, MANIFEST, varredura de anon, docs, workflows, i18n, fragmentos) e
// não toca DOM; código do produto, só módulo puro. Quem entra é decidido pelo
// import, em vitest.cercas.ts.
const CERCAS = selecionarCercas(__dirname);

export default defineConfig({
  // JSX automático já é o default do transform esbuild no Vite 7+ (vitest 4);
  // a opção `esbuild.jsx` saiu do tipo — provado pelos testes de componente.
  test: {
    environment: "jsdom",
    // O padrão do vitest é 5s por teste. Numa suíte jsdom + Testing Library
    // isso é apertado: em máquina carregada (CI concorrido, dev rodando outras
    // coisas) testes SAUDÁVEIS estouram e a suíte fica vermelha por lentidão.
    // Aconteceu três vezes aqui, em testes diferentes a cada vez — inclusive
    // derrubando a main num PR que só mexia em documentação. Um gate que
    // reprova sem defeito ensina o time a ignorar o gate.
    //
    // ── 15s → 30s, e o `hookTimeout` que NUNCA existiu (19/09/2026) ────────
    //
    // Duas coisas, e a segunda é a que estava errada de verdade.
    //
    // 1. `hookTimeout` nunca foi declarado, então ficou no padrão de 10s do
    //    vitest — MENOR que o teto dos testes. A linha acima raciocinou sobre
    //    "testes saudáveis" sem saber que hook tem orçamento próprio, e é no
    //    `beforeEach` que mora o `await import()` que custa caro. O sintoma foi
    //    `Hook timed out in 10000ms` num arquivo que já declarava 45s para os
    //    testes: o teto declarado não alcançava a parte lenta.
    //
    // 2. A suíte passou de 842 arquivos, e sob disputa de máquina ela vai de
    //    ~390s para 774-813s — o DOBRO. Um teste de 5s isolado chega perto de
    //    15s carregado, sem margem nenhuma. Medido: SETE arquivos diferentes
    //    reprovaram por tempo em seis rodadas, todos passando isolados
    //    (`theme`, `channel-health-aviso`, `agenda-meet`, `agenda-meet-routes`,
    //    `drain-loop`, `telas-sem-dado-de-mentira`,
    //    `editor-de-agente-salva-o-cadastro`). Não são casos excepcionais que
    //    "declaram o seu": é a suíte inteira sem folga.
    //
    // 30s continua NÃO mascarando travamento — quem trava reprova igual, quinze
    // segundos depois. O que ele para de fazer é cronometrar a lentidão da
    // máquina como se fosse asserção. Caso que precisa de mais (abrir processo
    // filho) continua declarando o seu.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["./tests/setup/vitest.setup.ts"],
    globals: true,
    coverage: { provider: "v8", reporter: ["text", "html"] },
    // tests/journeys/** roda no Playwright (jornada de baseline dos canais), igual
    // a tests/e2e/**: sem excluir, o include default do vitest o pegaria e o
    // import de @playwright/test derrubaria a suíte unitária.
    exclude: [
      "**/node_modules/**",
      ".next",
      "dist",
      ".claude/**",
      "tests/e2e/**",
      "tests/invariants/**",
      "tests/journeys/**",
      // Bancada opcional: usa node:test, PostgreSQL próprio e Playwright com
      // configuração dedicada. Não depende do ambiente da suíte do produto.
      "experiments/extensoes/**",
    ],
    // Dois projetos, a mesma suíte: `pnpm test:unit` continua rodando TUDO,
    // uma vez só. A divisão existe por duas razões medidas em 18/09/2026:
    //
    // 1. TEMPO. As cercas não tocam DOM, e o jsdom é o custo dominante: as
    //    mesmas 103 cercas levaram 358 s com jsdom e 35 s em `node`, na mesma
    //    máquina, no mesmo minuto. Na suíte longa elas pagavam jsdom à toa.
    // 2. ORDEM. `pnpm cercas` (`--project cercas`) roda só elas, e o `verify`
    //    as põe ANTES do typecheck: o vermelho estrutural — o que mais reprova
    //    PR — chegava no fim da suíte, aos 7–12 min (runs 35341823692 e
    //    35331913136), e passa a chegar no primeiro minuto.
    projects: [
      {
        extends: true,
        test: { name: "cercas", environment: "node", include: CERCAS },
      },
      {
        extends: true,
        test: { name: "produto", exclude: CERCAS },
      },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` não é dependência do projeto: o Next o resolve para o próprio módulo vazio
      // quando o código roda no servidor. Os testes rodam como servidor, então usam o mesmo vazio.
      "server-only": path.resolve(__dirname, "node_modules/next/dist/compiled/server-only/empty.js"),
    },
  },
});
