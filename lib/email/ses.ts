/**
 * FORK MIA (.89) — O TERCEIRO TRANSPORTE DE E-MAIL: a Amazon SES, região São Paulo.
 *
 * ── Quem usa, e quem NÃO usa ─────────────────────────────────────────────────
 *
 * Só o disparo de e-mail marketing (`lib/email-marketing/`). O roteador do
 * e-mail do SISTEMA (`lib/email/roteador.ts`: convite, senha, LGPD, a ação
 * `send_email` das automações) não sabe que este arquivo existe e não muda. A
 * reputação do marketing não pode derrubar o e-mail de recuperar senha: são
 * caixas diferentes, domínios diferentes, contas diferentes.
 *
 * ── Sem SDK ──────────────────────────────────────────────────────────────────
 *
 * A API v2 da SES é HTTP + JSON assinado com a Assinatura V4 da Amazon. A
 * assinatura é HMAC-SHA256 em cadeia, e o `node:crypto` faz isso em vinte
 * linhas. Um pacote novo mudaria o lockfile de todas as frentes para chamar
 * cinco endpoints.
 *
 * ── Desligado sem as chaves ──────────────────────────────────────────────────
 *
 * Sem as variáveis de ambiente o módulo nasce DESLIGADO: `configuracaoDaAmazon`
 * diz quais faltam, a tela mostra isso, e nenhuma chamada sai. Quem coloca as
 * chaves no EasyPanel é quem opera a plataforma (docs/fork/email-marketing.md).
 *
 * As chaves NUNCA saem daqui: nem na resposta, nem no log, nem no erro.
 */
import { createHash, createHmac } from "node:crypto";

import { env } from "@/lib/env";

/** A região do produto: São Paulo, perto de quem recebe e dentro do país. */
export const REGIAO_PADRAO_DA_AMAZON = "sa-east-1";

/** As variáveis que ligam o transporte. Os nomes aparecem na tela que diz o que falta. */
export const VARIAVEIS_DA_AMAZON = [
  "AWS_SES_ACCESS_KEY_ID",
  "AWS_SES_SECRET_ACCESS_KEY",
  "AWS_SES_CONFIGURATION_SET",
  "AWS_SES_SNS_TOPIC_ARN",
] as const;

export type VariavelDaAmazon = (typeof VARIAVEIS_DA_AMAZON)[number];

export interface ConfiguracaoDaAmazon {
  configurado: boolean;
  /** As variáveis que faltam, pelo nome. Vazio = pode ligar. */
  falta: VariavelDaAmazon[];
  regiao: string;
  conjuntoDeConfiguracao: string;
  topicoDosAvisos: string;
}

interface Credenciais {
  chave: string;
  segredo: string;
  regiao: string;
}

/** As variáveis lidas do ambiente. Recebe um substituto nos testes. */
export interface AmbienteDaAmazon {
  AWS_SES_ACCESS_KEY_ID?: string;
  AWS_SES_SECRET_ACCESS_KEY?: string;
  AWS_SES_REGION?: string;
  AWS_SES_CONFIGURATION_SET?: string;
  AWS_SES_SNS_TOPIC_ARN?: string;
}

function ambientePadrao(): AmbienteDaAmazon {
  return {
    AWS_SES_ACCESS_KEY_ID: env.AWS_SES_ACCESS_KEY_ID,
    AWS_SES_SECRET_ACCESS_KEY: env.AWS_SES_SECRET_ACCESS_KEY,
    AWS_SES_REGION: env.AWS_SES_REGION,
    AWS_SES_CONFIGURATION_SET: env.AWS_SES_CONFIGURATION_SET,
    AWS_SES_SNS_TOPIC_ARN: env.AWS_SES_SNS_TOPIC_ARN,
  };
}

/**
 * O transporte está ligado? E, se não está, o que falta.
 *
 * O conjunto de configuração e o tópico dos avisos são OBRIGATÓRIOS, e não um
 * extra: sem eles a Amazon não conta à plataforma quem rejeitou e quem marcou
 * como spam, e a trava de saúde (que pausa a campanha antes de a conta ser
 * revisada) ficaria cega. Mandar sem ver o retorno é o jeito mais rápido de
 * perder a conta, que é uma só para todos os clientes.
 */
export function configuracaoDaAmazon(
  ambiente: AmbienteDaAmazon = ambientePadrao(),
): ConfiguracaoDaAmazon {
  const falta = VARIAVEIS_DA_AMAZON.filter((v) => !(ambiente[v] ?? "").trim());
  return {
    configurado: falta.length === 0,
    falta,
    regiao: (ambiente.AWS_SES_REGION ?? "").trim() || REGIAO_PADRAO_DA_AMAZON,
    conjuntoDeConfiguracao: (ambiente.AWS_SES_CONFIGURATION_SET ?? "").trim(),
    topicoDosAvisos: (ambiente.AWS_SES_SNS_TOPIC_ARN ?? "").trim(),
  };
}

function credenciais(ambiente: AmbienteDaAmazon): Credenciais | null {
  const chave = (ambiente.AWS_SES_ACCESS_KEY_ID ?? "").trim();
  const segredo = (ambiente.AWS_SES_SECRET_ACCESS_KEY ?? "").trim();
  if (!chave || !segredo) return null;
  return {
    chave,
    segredo,
    regiao: (ambiente.AWS_SES_REGION ?? "").trim() || REGIAO_PADRAO_DA_AMAZON,
  };
}

// ─── A Assinatura V4 ────────────────────────────────────────────────────────

function sha256Hex(dado: string | Buffer): string {
  return createHash("sha256").update(dado).digest("hex");
}

function hmac(chave: string | Buffer, dado: string): Buffer {
  return createHmac("sha256", chave).update(dado, "utf8").digest();
}

/** RFC 3986, como a Amazon pede: tudo menos `A-Z a-z 0-9 - _ . ~`. */
function codificar(segmento: string): string {
  return encodeURIComponent(segmento).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export interface PedidoAssinavel {
  metodo: "GET" | "POST" | "PUT" | "DELETE";
  host: string;
  /** O caminho já montado, com cada segmento ainda sem codificar. */
  caminho: string;
  consulta?: Record<string, string>;
  corpo?: string;
  cabecalhos?: Record<string, string>;
}

/**
 * Assina um pedido com a Assinatura V4 (`AWS4-HMAC-SHA256`).
 *
 * Exportada para o teste conferir contra o vetor publicado pela Amazon: uma
 * assinatura errada não dá erro aqui, dá `SignatureDoesNotMatch` lá, sem dizer
 * qual byte.
 */
export function assinarV4(
  pedido: PedidoAssinavel,
  cred: { chave: string; segredo: string; regiao: string; servico: string },
  agora: Date,
): Record<string, string> {
  const amzDate = agora.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dia = amzDate.slice(0, 8);
  const corpo = pedido.corpo ?? "";

  const cabecalhos: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(pedido.cabecalhos ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()]),
    ),
    host: pedido.host,
    "x-amz-date": amzDate,
  };
  const nomes = Object.keys(cabecalhos).sort();
  const cabecalhosCanonicos = nomes
    .map((n) => `${n}:${cabecalhos[n]!.replace(/\s+/g, " ")}\n`)
    .join("");
  const assinados = nomes.join(";");

  // Serviço que não é o S3: cada segmento codificado DUAS vezes.
  const caminho =
    pedido.caminho
      .split("/")
      .map((s) => codificar(codificar(decodeURIComponent(s))))
      .join("/") || "/";
  const consulta = Object.entries(pedido.consulta ?? {})
    .map(([k, v]) => [codificar(k), codificar(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const pedidoCanonico = [
    pedido.metodo,
    caminho,
    consulta,
    cabecalhosCanonicos,
    assinados,
    sha256Hex(corpo),
  ].join("\n");
  const escopo = `${dia}/${cred.regiao}/${cred.servico}/aws4_request`;
  const textoParaAssinar = ["AWS4-HMAC-SHA256", amzDate, escopo, sha256Hex(pedidoCanonico)].join(
    "\n",
  );

  const chaveDeAssinatura = hmac(
    hmac(hmac(hmac(`AWS4${cred.segredo}`, dia), cred.regiao), cred.servico),
    "aws4_request",
  );
  const assinatura = createHmac("sha256", chaveDeAssinatura)
    .update(textoParaAssinar, "utf8")
    .digest("hex");

  return {
    ...cabecalhos,
    authorization: `AWS4-HMAC-SHA256 Credential=${cred.chave}/${escopo}, SignedHeaders=${assinados}, Signature=${assinatura}`,
  };
}

// ─── As chamadas ────────────────────────────────────────────────────────────

/** O vocabulário de erro do transporte. Vai ao registro do destinatário e à tela. */
export type ErroDaAmazon =
  | "nao_configurado"
  | "mensagem_recusada"
  | "dominio_nao_verificado"
  | "limite_de_envio"
  | "conta_pausada"
  | "ja_existe"
  | "nao_encontrado"
  | "falha_de_rede"
  | "falha";

export type RespostaDaAmazon<T> =
  { ok: true; dados: T } | { ok: false; erro: ErroDaAmazon; detalhe: string; status?: number };

export interface DependenciasDaAmazon {
  /** O `fetch` de verdade em produção; um dublê nos testes (nada sai para a Amazon). */
  fetch?: typeof fetch;
  ambiente?: AmbienteDaAmazon;
  agora?: () => Date;
}

/** O que a Amazon devolve como `__type`/`message`, traduzido para o nosso vocabulário. */
function traduzirErro(status: number, corpo: unknown): { erro: ErroDaAmazon; detalhe: string } {
  const c = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, unknown>;
  const tipo = String(c.__type ?? c.code ?? c.Code ?? "");
  const mensagem = String(c.message ?? c.Message ?? "").slice(0, 300);
  const nome = tipo.split("#").pop() ?? tipo;
  if (nome === "AlreadyExistsException" || status === 409)
    return { erro: "ja_existe", detalhe: mensagem || nome };
  if (nome === "NotFoundException" || status === 404)
    return { erro: "nao_encontrado", detalhe: mensagem || nome };
  if (nome === "MessageRejected") {
    return {
      erro: /not verified|não verificad/i.test(mensagem)
        ? "dominio_nao_verificado"
        : "mensagem_recusada",
      detalhe: mensagem || nome,
    };
  }
  if (nome === "MailFromDomainNotVerifiedException")
    return { erro: "dominio_nao_verificado", detalhe: mensagem || nome };
  if (nome === "SendingPausedException" || nome === "AccountSuspendedException") {
    return { erro: "conta_pausada", detalhe: mensagem || nome };
  }
  if (nome === "LimitExceededException" || nome === "TooManyRequestsException" || status === 429) {
    return { erro: "limite_de_envio", detalhe: mensagem || nome };
  }
  return { erro: "falha", detalhe: (mensagem || nome || `HTTP ${status}`).slice(0, 300) };
}

async function chamar<T>(
  metodo: PedidoAssinavel["metodo"],
  caminho: string,
  corpo: unknown,
  deps: DependenciasDaAmazon,
): Promise<RespostaDaAmazon<T>> {
  const ambiente = deps.ambiente ?? ambientePadrao();
  const cred = credenciais(ambiente);
  if (!cred)
    return {
      ok: false,
      erro: "nao_configurado",
      detalhe: "Faltam as chaves da Amazon no ambiente.",
    };
  const host = `email.${cred.regiao}.amazonaws.com`;
  const texto = corpo === undefined ? "" : JSON.stringify(corpo);
  const cabecalhos = assinarV4(
    {
      metodo,
      host,
      caminho,
      corpo: texto,
      cabecalhos: texto ? { "content-type": "application/json" } : {},
    },
    { ...cred, servico: "ses" },
    (deps.agora ?? (() => new Date()))(),
  );
  const fazer = deps.fetch ?? fetch;
  let resposta: Response;
  try {
    resposta = await fazer(`https://${host}${caminho}`, {
      method: metodo,
      headers: cabecalhos,
      body: texto || undefined,
      // A Amazon responde em menos de um segundo; vinte é para não prender a rodada.
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return {
      ok: false,
      erro: "falha_de_rede",
      detalhe: err instanceof Error ? err.message.slice(0, 200) : "falha de rede",
    };
  }
  let json: unknown = null;
  try {
    const bruto = await resposta.text();
    json = bruto ? JSON.parse(bruto) : {};
  } catch {
    json = {};
  }
  if (!resposta.ok)
    return { ok: false, status: resposta.status, ...traduzirErro(resposta.status, json) };
  return { ok: true, dados: json as T };
}

function caminhoDaIdentidade(dominio: string, sufixo = ""): string {
  return `/v2/email/identities/${encodeURIComponent(dominio)}${sufixo}`;
}

export interface IdentidadeDaAmazon {
  dkimTokens: string[];
  /** `SUCCESS` quando os três CNAME do DKIM já foram achados pela Amazon. */
  dkimStatus: string | null;
  /** O subdomínio de retorno e se a Amazon já achou o MX dele. */
  mailFrom: string | null;
  mailFromStatus: string | null;
  verificadoParaEnvio: boolean;
}

interface IdentidadeCrua {
  DkimAttributes?: { Tokens?: string[]; Status?: string };
  MailFromAttributes?: { MailFromDomain?: string; MailFromDomainStatus?: string };
  VerifiedForSendingStatus?: boolean;
}

function lerIdentidadeCrua(c: IdentidadeCrua): IdentidadeDaAmazon {
  return {
    dkimTokens: Array.isArray(c.DkimAttributes?.Tokens)
      ? c.DkimAttributes!.Tokens!.map(String)
      : [],
    dkimStatus: c.DkimAttributes?.Status ?? null,
    mailFrom: c.MailFromAttributes?.MailFromDomain ?? null,
    mailFromStatus: c.MailFromAttributes?.MailFromDomainStatus ?? null,
    verificadoParaEnvio: c.VerifiedForSendingStatus === true,
  };
}

/** Lê a identidade do domínio na Amazon. */
export async function lerIdentidade(
  dominio: string,
  deps: DependenciasDaAmazon = {},
): Promise<RespostaDaAmazon<IdentidadeDaAmazon>> {
  const r = await chamar<IdentidadeCrua>("GET", caminhoDaIdentidade(dominio), undefined, deps);
  return r.ok ? { ok: true, dados: lerIdentidadeCrua(r.dados) } : r;
}

/**
 * Cria a identidade do domínio (DKIM fácil, chave da Amazon) e aponta o
 * subdomínio de retorno. Chamada de novo, não duplica: a identidade que já
 * existe é lida, e o retorno é reaplicado (a Amazon aceita o mesmo valor).
 */
export async function garantirIdentidade(
  dominio: string,
  subdominioDeRetorno: string,
  deps: DependenciasDaAmazon = {},
): Promise<RespostaDaAmazon<IdentidadeDaAmazon & { criada: boolean }>> {
  const ambiente = deps.ambiente ?? ambientePadrao();
  const conjunto = (ambiente.AWS_SES_CONFIGURATION_SET ?? "").trim();
  const criacao = await chamar<IdentidadeCrua>(
    "POST",
    "/v2/email/identities",
    { EmailIdentity: dominio, ...(conjunto ? { ConfigurationSetName: conjunto } : {}) },
    deps,
  );
  if (!criacao.ok && criacao.erro !== "ja_existe") return criacao;
  const retorno = await chamar<Record<string, never>>(
    "PUT",
    caminhoDaIdentidade(dominio, "/mail-from"),
    {
      MailFromDomain: `${subdominioDeRetorno}.${dominio}`,
      BehaviorOnMxFailure: "USE_DEFAULT_VALUE",
    },
    deps,
  );
  if (!retorno.ok) return retorno;
  const lida = await lerIdentidade(dominio, deps);
  if (!lida.ok) return lida;
  return { ok: true, dados: { ...lida.dados, criada: criacao.ok } };
}

export interface ContaDaAmazon {
  /** Quantos e-mails a conta pode mandar em 24 horas (a cota). */
  maximoEm24h: number;
  /** Quantos por segundo. */
  maximoPorSegundo: number;
  enviadosNasUltimas24h: number;
  /** `false` = a conta ainda está no sandbox: só manda para endereço verificado. */
  foraDoSandbox: boolean;
  envioLigado: boolean;
}

interface ContaCrua {
  SendQuota?: { Max24HourSend?: number; MaxSendRate?: number; SentLast24Hours?: number };
  ProductionAccessEnabled?: boolean;
  SendingEnabled?: boolean;
}

/** A cota e o estado da conta da plataforma. */
export async function lerConta(
  deps: DependenciasDaAmazon = {},
): Promise<RespostaDaAmazon<ContaDaAmazon>> {
  const r = await chamar<ContaCrua>("GET", "/v2/email/account", undefined, deps);
  if (!r.ok) return r;
  return {
    ok: true,
    dados: {
      maximoEm24h: Number(r.dados.SendQuota?.Max24HourSend ?? 0),
      maximoPorSegundo: Number(r.dados.SendQuota?.MaxSendRate ?? 1),
      enviadosNasUltimas24h: Number(r.dados.SendQuota?.SentLast24Hours ?? 0),
      foraDoSandbox: r.dados.ProductionAccessEnabled === true,
      envioLigado: r.dados.SendingEnabled !== false,
    },
  };
}

export interface EnvioPelaAmazon {
  de: string;
  para: string;
  /** A mensagem inteira, em MIME (`lib/email-marketing/mime.ts`). */
  mensagemMime: string;
  /** Etiquetas que voltam nos avisos: campanha, destinatário, empresa. */
  etiquetas?: Record<string, string>;
}

/**
 * Manda UM e-mail. Devolve o id que a Amazon deu, ou o erro traduzido.
 *
 * Mensagem crua (MIME montado aqui), e não a forma simples da API: é o jeito
 * de pôr os dois cabeçalhos do descadastro de um clique (`List-Unsubscribe` e
 * `List-Unsubscribe-Post`) que o Gmail e o Yahoo exigem de quem manda em volume.
 */
export async function enviarPelaAmazon(
  envio: EnvioPelaAmazon,
  deps: DependenciasDaAmazon = {},
): Promise<RespostaDaAmazon<{ messageId: string }>> {
  const ambiente = deps.ambiente ?? ambientePadrao();
  const conjunto = (ambiente.AWS_SES_CONFIGURATION_SET ?? "").trim();
  const etiquetas = Object.entries(envio.etiquetas ?? {})
    // A Amazon aceita só letra, número, `_`, `-` e `.` no nome e no valor.
    .map(([Name, Value]) => ({
      Name: Name.replace(/[^A-Za-z0-9_.-]/g, "_"),
      Value: Value.replace(/[^A-Za-z0-9_.-]/g, "_"),
    }))
    .filter((e) => e.Name && e.Value);
  const r = await chamar<{ MessageId?: string }>(
    "POST",
    "/v2/email/outbound-emails",
    {
      FromEmailAddress: envio.de,
      Destination: { ToAddresses: [envio.para] },
      Content: { Raw: { Data: Buffer.from(envio.mensagemMime, "utf8").toString("base64") } },
      ...(etiquetas.length ? { EmailTags: etiquetas } : {}),
      ...(conjunto ? { ConfigurationSetName: conjunto } : {}),
    },
    deps,
  );
  if (!r.ok) return r;
  const id = String(r.dados.MessageId ?? "").trim();
  if (!id)
    return { ok: false, erro: "falha", detalhe: "A Amazon aceitou sem devolver o id da mensagem." };
  return { ok: true, dados: { messageId: id } };
}
