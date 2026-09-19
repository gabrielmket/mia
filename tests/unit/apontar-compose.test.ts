/**
 * O PASSO DO DEPLOY QUE JÁ FOI ESQUECIDO — e o script que o substitui.
 *
 * ── O que aconteceu em 19/09/2026 ─────────────────────────────────────────
 *
 * As tags `.39`, `.40`, `.41` e `.42` foram cortadas e enviadas sem o commit
 * que aponta a compose. A tag do git dispara o build da imagem; ela NÃO mexe no
 * arquivo que diz à VPS qual imagem baixar. Quatro releases no registry, e a
 * produção rodando a `.38` — com o `baseline.sql` novo sendo aplicado por cima,
 * que é o arranjo "código antigo sobre banco novo" que o kit documenta como o
 * pior momento possível.
 *
 * Não é um passo óbvio esquecido: são TRÊS tags no arquivo e nada liga a
 * numeração do git à do compose. Enquanto for memória de quem implanta, volta.
 *
 * ── O que estes casos medem ───────────────────────────────────────────────
 *
 * As duas funções puras do script. A ida ao registry fica de fora: ela é I/O, e
 * o que pode estar errado nela (a imagem não existe) é justamente o que ela vai
 * descobrir na hora.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { apontarPara, versaoMaisNova, versoesNoCompose } from "@/scripts/apontar-compose";

/**
 * O namespace vem de `IMG_NS`, nunca escrito à mão.
 *
 * `tests/unit/namespace-das-imagens.test.ts` reprova quem o repete: com várias
 * cópias, a âncora deixa de ser única e um namespace errado fica verde em todo
 * lugar. Um fork que publique as próprias imagens troca uma linha, não sete.
 */
const NS = (() => {
  const comum = fs.readFileSync(
    path.resolve(__dirname, "../../hostgator-setup-kit/_common.sh"),
    "utf8",
  );
  const m = comum.match(/^IMG_NS="([^"]+)"$/m);
  if (!m?.[1]) throw new Error("não achei IMG_NS em hostgator-setup-kit/_common.sh");
  return m[1];
})();

const COMPOSE_EXEMPLO = [
  "services:",
  "  app:",
  "    image: \${APP_IMAGE:-" + NS + "/mia-crm:1.21.0-mia.38}",
  "  worker:",
  "    image: \${WORKER_IMAGE:-" + NS + "/mia-worker:1.21.0-mia.38}",
  "  waha:",
  "    image: \${WAHA_IMAGE:-devlikeapro/waha:latest-2026.7.2}",
  "  scheduler:",
  "    image: \${SCHEDULER_IMAGE:-" + NS + "/mia-scheduler:1.21.0-mia.38}",
  "",
].join("\n");

describe("qual versão o compose deve receber", () => {
  it("é a tag mais nova pela ORDEM NUMÉRICA, não alfabética", () => {
    // `.9` > `.46` em ordem de texto. Ordenar como string apontaria a produção
    // para uma release de semanas atrás, e o sintoma seria "as features sumiram".
    expect(
      versaoMaisNova(["v1.21.0-mia.9", "v1.21.0-mia.46", "v1.21.0-mia.38"]),
    ).toBe("1.21.0-mia.46");
  });

  it("ignora tag que não é desta série", () => {
    // O repositório carrega `v1.1.1-jmpo.1` e `jmpo/v1.4.0`, que existem para
    // não colidir com esta numeração.
    expect(
      versaoMaisNova(["jmpo/v1.4.0", "v1.1.1-jmpo.1", "v1.21.0-mia.44", "lixo"]),
    ).toBe("1.21.0-mia.44");
  });

  it("sem tag da série, devolve nulo em vez de chutar", () => {
    expect(versaoMaisNova(["jmpo/v1.4.0", ""])).toBeNull();
  });
});

describe("o que o compose fixa hoje", () => {
  it("enxerga as três imagens do fork", () => {
    const achadas = versoesNoCompose(COMPOSE_EXEMPLO);
    expect(achadas.get("mia-crm")).toBe("1.21.0-mia.38");
    expect(achadas.get("mia-worker")).toBe("1.21.0-mia.38");
    expect(achadas.get("mia-scheduler")).toBe("1.21.0-mia.38");
  });

  it("não confunde a imagem de terceiro que está no meio", () => {
    // `devlikeapro/waha` tem versão própria e não acompanha a nossa. Trocá-la
    // apontaria o WhatsApp do cliente para uma imagem que não existe.
    expect(versoesNoCompose(COMPOSE_EXEMPLO).size).toBe(3);
  });
});

describe("apontar para a versão nova", () => {
  it("troca as TRÊS de uma vez", () => {
    const novo = apontarPara(COMPOSE_EXEMPLO, "1.21.0-mia.46");
    const achadas = versoesNoCompose(novo);
    expect([...achadas.values()]).toEqual([
      "1.21.0-mia.46",
      "1.21.0-mia.46",
      "1.21.0-mia.46",
    ]);
  });

  it("NÃO encosta na imagem de terceiro", () => {
    // Trocar as nossas e a do WAHA junto é o erro que derruba o canal do
    // cliente sem ninguém relacionar com o deploy.
    const novo = apontarPara(COMPOSE_EXEMPLO, "1.21.0-mia.46");
    expect(novo).toContain("devlikeapro/waha:latest-2026.7.2");
  });

  it("preserva o `${VAR:-...}` em volta", () => {
    // O padrão existe para o EasyPanel poder sobrescrever a imagem pelo
    // Environment sem editar o arquivo — e a checagem dele reclama de `${VAR}`
    // sem default.
    const novo = apontarPara(COMPOSE_EXEMPLO, "1.21.0-mia.46");
    expect(novo).toContain("${APP_IMAGE:-" + NS + "/mia-crm:1.21.0-mia.46}");
  });

  it("é idempotente: apontar para a mesma versão não muda nada", () => {
    const novo = apontarPara(COMPOSE_EXEMPLO, "1.21.0-mia.38");
    expect(novo).toBe(COMPOSE_EXEMPLO);
  });
});
