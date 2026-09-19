/**
 * Aponta `docker-compose.easypanel.yml` para uma versão — conferindo antes se
 * as imagens existem.
 *
 * ── O defeito que este script existe para não repetir ─────────────────────
 *
 * Em 19/09/2026 as tags `.39`, `.40`, `.41` e `.42` foram cortadas e enviadas
 * sem o commit que aponta a compose. A tag do git dispara o build da imagem; ela
 * NÃO mexe no arquivo que diz à VPS qual imagem baixar. Resultado: quatro
 * releases no registry e a produção rodando a `.38` — com o `baseline.sql` novo
 * sendo aplicado por cima, que é o arranjo "código antigo sobre banco novo" que
 * o próprio kit documenta como o pior momento possível.
 *
 * Não foi esquecimento de um passo óbvio: são três tags no arquivo
 * (`mia-crm`, `mia-worker`, `mia-scheduler`) e nada liga a numeração do git à
 * do compose. Enquanto for memória de quem implanta, volta a acontecer.
 *
 * ── Por que CONFERIR o registry antes de escrever ─────────────────────────
 *
 * `pull_policy: missing` não rebaixa tag móvel: apontar para uma tag que o CI
 * ainda não publicou deixa o contêiner sem subir. O sintoma chega como "o
 * deploy quebrou", e a causa — "a imagem ainda não existe" — não está em lugar
 * nenhum da mensagem.
 *
 *   pnpm implantar:conferir           # diz o que faria, não escreve
 *   pnpm implantar:apontar            # escreve o compose
 *   pnpm implantar:apontar 1.21.0-mia.46   # versão explícita
 *
 * Sem argumento, usa a tag mais nova do repositório.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "..");
const COMPOSE = path.join(RAIZ, "docker-compose.easypanel.yml");
/**
 * O namespace das imagens vem de `IMG_NS`, nunca escrito aqui.
 *
 * `tests/unit/namespace-das-imagens.test.ts` guarda essa ancora: com varias
 * copias, um namespace errado fica verde em todo lugar. Um fork que publique
 * as proprias imagens troca UMA linha — e este script continua servindo a ele.
 */
const NS = (() => {
  const comum = fs.readFileSync(
    path.join(RAIZ, "hostgator-setup-kit/_common.sh"),
    "utf8",
  );
  const m = comum.match(/^IMG_NS="([^"]+)"$/m);
  if (!m?.[1]) throw new Error("nao achei IMG_NS em hostgator-setup-kit/_common.sh");
  return m[1];
})();
const IMAGENS = ["mia-crm", "mia-worker", "mia-scheduler"] as const;

/**
 * O caminho no registry — SEM o host.
 *
 * `IMG_NS` é `ghcr.io/<dono>` (o compose precisa do host), e a API do GHCR
 * quer só `<dono>/<imagem>`. Derivar aqui mantém as duas formas saindo da
 * mesma linha.
 */
function caminho(imagem: string): string {
  return `${NS.replace(/^[^/]+\//, "")}/${imagem}`;
}

/** `IMG_NS` dentro de um regex: o `.` de `ghcr.io` casaria qualquer caractere. */
function nsEscapado(): string {
  return NS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A tag mais nova no formato desta série, pela ordem numérica do sufixo. */
export function versaoMaisNova(tags: string[]): string | null {
  const candidatas = tags
    .map((t) => t.trim())
    .filter((t) => /^v\d+\.\d+\.\d+-mia\.\d+$/.test(t))
    .map((t) => ({ tag: t, n: Number(t.split(".").pop()) }))
    .sort((a, b) => a.n - b.n);
  const ultima = candidatas[candidatas.length - 1];
  return ultima ? ultima.tag.replace(/^v/, "") : null;
}

/** As versões que o compose fixa hoje, uma por imagem. */
export function versoesNoCompose(texto: string): Map<string, string> {
  const achadas = new Map<string, string>();
  for (const img of IMAGENS) {
    const m = texto.match(
      new RegExp(`${nsEscapado()}/${img}:([0-9][^}\\s]*)`),
    );
    if (m?.[1]) achadas.set(img, m[1]);
  }
  return achadas;
}

/** Troca a versão de TODAS as três imagens. Devolve o texto novo. */
export function apontarPara(texto: string, versao: string): string {
  let saida = texto;
  for (const img of IMAGENS) {
    saida = saida.replace(
      new RegExp(`(${nsEscapado()}/${img}:)[0-9][^}\\s]*`, "g"),
      `$1${versao}`,
    );
  }
  return saida;
}

/** O manifesto existe no GHCR? Token anônimo — o pacote é público. */
async function imagemPublicada(imagem: string, versao: string): Promise<boolean> {
  const tokenRes = await fetch(
    `https://ghcr.io/token?scope=repository:${caminho(imagem)}:pull&service=ghcr.io`,
  );
  if (!tokenRes.ok) return false;
  const { token } = (await tokenRes.json()) as { token?: string };
  if (!token) return false;

  const res = await fetch(
    `https://ghcr.io/v2/${caminho(imagem)}/manifests/${versao}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: [
          "application/vnd.oci.image.index.v1+json",
          "application/vnd.docker.distribution.manifest.list.v2+json",
          "application/vnd.docker.distribution.manifest.v2+json",
        ].join(","),
      },
    },
  );
  return res.ok;
}

async function principal(): Promise<void> {
  const escrever = process.argv.includes("--escrever");
  const pedida = process.argv.find((a) => /^\d+\.\d+\.\d+-mia\.\d+$/.test(a));

  const tags = execFileSync("git", ["tag", "--list", "v*-mia.*"], {
    cwd: RAIZ,
    encoding: "utf8",
  }).split("\n");

  const versao = pedida ?? versaoMaisNova(tags);
  if (!versao) {
    console.error("não achei nenhuma tag no formato vX.Y.Z-mia.N");
    process.exit(1);
  }

  const texto = fs.readFileSync(COMPOSE, "utf8");
  const atuais = versoesNoCompose(texto);
  if (atuais.size !== IMAGENS.length) {
    console.error(
      `o compose fixa ${atuais.size} das ${IMAGENS.length} imagens esperadas — ` +
        "o arquivo mudou de forma e este script pararia de apontar alguma delas",
    );
    process.exit(1);
  }

  const jaAponta = [...atuais.values()].every((v) => v === versao);
  if (jaAponta) {
    console.log(`o compose já aponta para ${versao} — nada a fazer`);
    return;
  }

  console.log(`compose hoje: ${[...atuais.entries()].map(([i, v]) => `${i}=${v}`).join("  ")}`);
  console.log(`apontar para: ${versao}\n`);

  // ⚠️ NUNCA PARA TRÁS sem alguém pedir. Descoberto rodando o script pela
  // primeira vez: num clone com a lista de tags incompleta (clone raso, tags
  // não buscadas — foi o caso do contêiner de teste), `versaoMaisNova` devolve
  // uma release ANTIGA e o script apontaria a produção para ela, calado.
  //
  // O sintoma seria "as features sumiram depois do deploy", e a causa —
  // `git fetch --tags` que não rodou — não aparece em lugar nenhum. Voltar
  // versão é legítimo (é um rollback), mas é ato deliberado: `--voltar`.
  if (!process.argv.includes("--voltar")) {
    const nDe = (v: string) => Number(v.split(".").pop());
    const atrasadas = [...atuais.entries()].filter(([, v]) => nDe(v) > nDe(versao));
    if (atrasadas.length > 0) {
      console.error(
        `o compose já aponta para uma versão MAIS NOVA que ${versao} ` +
          `(${atrasadas.map(([i, v]) => `${i}=${v}`).join(", ")}).\n` +
          "Isso normalmente significa que a lista de tags local está incompleta — " +
          "rode `git fetch --tags` e tente de novo.\n" +
          "Se a intenção é MESMO voltar de versão (rollback), passe `--voltar`.",
      );
      process.exit(1);
    }
  }

  // ⚠️ CONFERIR ANTES DE ESCREVER: tag que o CI ainda não publicou deixa o
  // contêiner sem subir, e o erro não menciona a imagem ausente.
  let faltando = 0;
  for (const img of IMAGENS) {
    const existe = await imagemPublicada(img, versao);
    console.log(`  ${existe ? "ok " : "NÃO"}  ${img}:${versao}`);
    if (!existe) faltando += 1;
  }
  if (faltando > 0) {
    console.error(
      `\n${faltando} imagem(ns) ainda não publicada(s). O CI pode estar rodando — ` +
        "espere e rode de novo. Apontar agora deixaria o contêiner sem subir.",
    );
    process.exit(1);
  }

  if (!escrever) {
    console.log("\n(conferência apenas — use `pnpm implantar:apontar` para escrever)");
    return;
  }

  fs.writeFileSync(COMPOSE, apontarPara(texto, versao));
  console.log(`\ndocker-compose.easypanel.yml agora aponta para ${versao}`);
  console.log("falta: commitar e implantar pelo MCP do EasyPanel (clientes/deskcomm)");
}

if (require.main === module) {
  void principal();
}
