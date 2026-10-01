/**
 * O ARQUIVO de um material: baixado de um endereço público, ou enviado em base64.
 *
 * ── A proteção contra SSRF é a que o produto já tem ───────────────────────
 *
 * Quem baixa o arquivo é o SERVIDOR, de dentro da rede dele. Um endereço que
 * aponte para `169.254.169.254` ou para um serviço interno do compose faria a
 * ferramenta buscar o endereço privado e guardar a resposta na base de
 * conhecimento do cliente, de onde o agente de IA a leria em voz alta.
 *
 * As duas guardas são as dos webhooks de saída e do envio de mídia por
 * endereço, sem nenhuma regra nova:
 *
 *  - `assertSafeOutboundUrl` (`lib/automation/outbound-url.ts`): esquema,
 *    literal de IPv6 e nome de host privado, sem custo de rede;
 *  - `assertDestinoResolvidoSeguro` (`lib/automation/outbound-ip.ts`): resolve
 *    o nome e recusa se QUALQUER endereço cair em faixa privada.
 *
 * E o redirecionamento nunca é seguido às cegas: `redirect: "manual"`, como o
 * `call_webhook` faz, e cada salto passa pelas duas guardas de novo. Um endereço
 * público que responde 302 para um interno é a forma mais barata de furar uma
 * guarda que só confere o primeiro endereço.
 *
 * Só `https`: o material vai ser lido por um agente e mostrado a consumidores,
 * e um arquivo trocado no meio do caminho seria conteúdo falso com a assinatura
 * do cliente.
 */
import { assertDestinoResolvidoSeguro } from "@/lib/automation/outbound-ip";
import { assertSafeOutboundUrl } from "@/lib/automation/outbound-url";

import { RecusaDaImportacao, texto } from "./base";

/**
 * O teto do conteúdo enviado em base64, já decodificado.
 *
 * Pequeno de propósito: o base64 viaja DENTRO da chamada, que é texto e passa
 * pelo contexto do agente que migra. Arquivo maior vai por endereço.
 */
export const TETO_DO_BASE64 = 1024 * 1024;

const SALTOS_MAXIMOS = 3;
const TEMPO_MAXIMO_MS = 30_000;

export interface ArquivoObtido {
  bytes: Buffer;
  /** O nome do arquivo, para a extensão e para a tela. */
  nome: string;
  /** O tipo declarado por quem serviu o arquivo. Nunca é a única prova do formato. */
  tipo: string | null;
  veio: "endereco" | "base64";
}

function megas(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

const EXPLICACAO_DO_ENDERECO: Record<string, string> = {
  invalid: "não é um endereço válido.",
  scheme: "precisa começar com https://.",
  https_required: "precisa começar com https://.",
  ipv6_literal: "não pode ser um endereço IPv6 literal: use o nome do site.",
  private_host: "aponta para um endereço interno ou local, que o servidor não busca.",
  private_ip: "resolve para um endereço interno ou privado, que o servidor não busca.",
  dns_failed: "não foi encontrado: o nome do site não resolve.",
  dns_empty: "não foi encontrado: o nome do site não resolve.",
};

/** Passa o endereço pelas DUAS guardas do produto. Lança a recusa que ensina. */
export async function conferirEnderecoPublico(endereco: string, campo: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(endereco);
  } catch {
    throw new RecusaDaImportacao(
      `\`${campo}\` não é um endereço válido. Esperado um endereço https público, como "https://exemplo.invalid/catalogo.pdf".`,
    );
  }
  if (url.protocol !== "https:") {
    throw new RecusaDaImportacao(
      `\`${campo}\` precisa começar com https://. Esperado um endereço https público, como "https://exemplo.invalid/catalogo.pdf".`,
    );
  }
  try {
    assertSafeOutboundUrl(url.toString());
    await assertDestinoResolvidoSeguro(url.hostname);
  } catch (err) {
    const codigo = err instanceof Error ? err.message.replace(/^unsafe_url:/, "") : "invalid";
    throw new RecusaDaImportacao(
      `\`${campo}\` ${EXPLICACAO_DO_ENDERECO[codigo] ?? "não pôde ser conferido."} ` +
        "O arquivo precisa estar num endereço https PÚBLICO, que qualquer pessoa abre sem senha.",
    );
  }
  return url;
}

function nomeDoArquivoDaResposta(resposta: Response, url: URL): string {
  const disposicao = resposta.headers.get("content-disposition") ?? "";
  const estendido = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposicao)?.[1];
  const simples = /filename="?([^";]+)"?/i.exec(disposicao)?.[1];
  const doCabecalho = estendido ? decodeURIComponent(estendido.trim()) : simples?.trim();
  if (doCabecalho) return doCabecalho;
  const ultimo = url.pathname.split("/").filter(Boolean).pop() ?? "";
  try {
    return decodeURIComponent(ultimo);
  } catch {
    return ultimo;
  }
}

async function lerComTeto(resposta: Response, teto: number, campo: string): Promise<Buffer> {
  const declarado = Number(resposta.headers.get("content-length") ?? 0);
  if (declarado > teto) {
    throw new RecusaDaImportacao(`O arquivo de \`${campo}\` tem ${megas(declarado)} e o teto é ${megas(teto)}.`);
  }
  // O `content-length` é declaração de quem serve: o corpo é contado de verdade,
  // e a leitura para no teto em vez de carregar um arquivo sem fim na memória.
  const leitor = resposta.body?.getReader();
  if (!leitor) return Buffer.from(await resposta.arrayBuffer());
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > teto) {
      await leitor.cancel().catch(() => undefined);
      throw new RecusaDaImportacao(`O arquivo de \`${campo}\` passa de ${megas(teto)}, que é o teto.`);
    }
    pedacos.push(value);
  }
  return Buffer.concat(pedacos);
}

/** Baixa um arquivo de um endereço https público, com teto de tamanho. */
export async function baixarArquivoPublico(endereco: string, teto: number, campo: string): Promise<ArquivoObtido> {
  let url = await conferirEnderecoPublico(endereco, campo);
  for (let salto = 0; salto <= SALTOS_MAXIMOS; salto += 1) {
    let resposta: Response;
    try {
      resposta = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TEMPO_MAXIMO_MS) });
    } catch {
      throw new RecusaDaImportacao(
        `Não consegui baixar o arquivo de \`${campo}\`: o endereço não respondeu em ${TEMPO_MAXIMO_MS / 1000} segundos. ` +
          "Confira se ele abre num navegador sem login.",
      );
    }
    if (resposta.status >= 300 && resposta.status < 400) {
      const destino = resposta.headers.get("location");
      if (!destino) break;
      // Cada salto é um endereço novo, e passa pelas mesmas guardas.
      url = await conferirEnderecoPublico(new URL(destino, url).toString(), campo);
      continue;
    }
    if (!resposta.ok) {
      throw new RecusaDaImportacao(
        `O endereço de \`${campo}\` respondeu ${resposta.status}. O arquivo precisa abrir sem login: ` +
          "endereço que pede senha, que expirou ou que é de uma pasta privada não serve.",
      );
    }
    const bytes = await lerComTeto(resposta, teto, campo);
    if (bytes.byteLength === 0) throw new RecusaDaImportacao(`O arquivo de \`${campo}\` veio vazio.`);
    return {
      bytes,
      nome: nomeDoArquivoDaResposta(resposta, url),
      tipo: resposta.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || null,
      veio: "endereco",
    };
  }
  throw new RecusaDaImportacao(
    `O endereço de \`${campo}\` redireciona vezes demais. Use o endereço final do arquivo, o que abre o arquivo direto.`,
  );
}

/**
 * O arquivo de uma chamada: pelo endereço OU pelo base64, nunca os dois.
 *
 * `tetoDoEndereco` é o da tela para aquele tipo de material (20 MB no
 * conhecimento, 5 MB na foto e no modelo de proposta). O base64 tem teto
 * próprio, menor.
 */
export async function obterArquivo(
  args: Record<string, unknown>,
  tetoDoEndereco: number,
): Promise<ArquivoObtido> {
  const endereco = texto(args.arquivo_url, 2000);
  const base64 = typeof args.arquivo_base64 === "string" ? args.arquivo_base64.trim() : "";
  const nomeInformado = texto(args.nome_do_arquivo, 200);

  if (endereco && base64) {
    throw new RecusaDaImportacao("Mande `arquivo_url` OU `arquivo_base64`, não os dois. Nada foi gravado.");
  }
  if (!endereco && !base64) {
    throw new RecusaDaImportacao(
      "Falta o arquivo. Mande `arquivo_url` (um endereço https público de onde baixar) ou `arquivo_base64` " +
        `(o conteúdo em base64, até ${megas(TETO_DO_BASE64)}) com \`nome_do_arquivo\`. Nada foi gravado.`,
    );
  }

  if (endereco) {
    const baixado = await baixarArquivoPublico(endereco, tetoDoEndereco, "arquivo_url");
    return nomeInformado ? { ...baixado, nome: nomeInformado } : baixado;
  }

  if (!nomeInformado) {
    throw new RecusaDaImportacao(
      'Com `arquivo_base64`, `nome_do_arquivo` é obrigatório: é a extensão dele que diz o tipo (ex.: "politica-de-troca.pdf"). Nada foi gravado.',
    );
  }
  const limpo = base64.replace(/^data:[^;,]*;base64,/i, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(limpo) || limpo.length === 0) {
    throw new RecusaDaImportacao("`arquivo_base64` não é base64 válido. Nada foi gravado.");
  }
  const bytes = Buffer.from(limpo, "base64");
  const teto = Math.min(TETO_DO_BASE64, tetoDoEndereco);
  if (bytes.byteLength > teto) {
    throw new RecusaDaImportacao(
      `O conteúdo em base64 tem ${megas(bytes.byteLength)} e o teto é ${megas(teto)}. ` +
        "Arquivo maior vai por `arquivo_url`: ponha-o num endereço https público. Nada foi gravado.",
    );
  }
  if (bytes.byteLength === 0) throw new RecusaDaImportacao("`arquivo_base64` veio vazio. Nada foi gravado.");
  return { bytes, nome: nomeInformado, tipo: null, veio: "base64" };
}
