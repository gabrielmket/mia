/**
 * FORK MIA (.89) — OS AVISOS DA AMAZON: a assinatura conferida e o evento lido.
 *
 * A SES conta o que aconteceu com cada e-mail (entregue, rejeitado, marcado como
 * spam) publicando num tópico do SNS, e o tópico chama a rota pública
 * `/api/v1/webhooks/email-marketing/amazon`. Quem chama uma rota pública pode ser
 * qualquer um, então nada é aceito sem três provas:
 *
 *   1. a ASSINATURA do SNS confere, com o certificado baixado de um endereço
 *      `https://sns.<região>.amazonaws.com/…pem` (nunca de outro host);
 *   2. o TÓPICO é o da plataforma (`AWS_SES_SNS_TOPIC_ARN`): um tópico de outra
 *      conta da Amazon, inscrito na nossa rota, assina certo e não é nosso — e
 *      um aviso falso de reclamação tiraria gente da lista;
 *   3. o aviso não é velho demais (a Amazon reentrega por até um dia).
 *
 * Sem o tópico configurado a rota não aceita nada: aceitar "qualquer tópico" é
 * o buraco do item 2.
 */
import { createPublicKey, createVerify, X509Certificate, type KeyObject } from "node:crypto";

export interface MensagemDoSns {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: "1" | "2";
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
}

/** O host de onde o certificado pode vir. Fora dele, recusa. */
const HOST_DO_CERTIFICADO = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

export function enderecoDoCertificadoValido(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" && HOST_DO_CERTIFICADO.test(u.hostname) && u.pathname.endsWith(".pem")
    );
  } catch {
    return false;
  }
}

/** O endereço de confirmação da inscrição só pode ser do SNS. */
export function enderecoDeConfirmacaoValido(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && HOST_DO_CERTIFICADO.test(u.hostname);
  } catch {
    return false;
  }
}

export function lerMensagemDoSns(corpo: unknown): MensagemDoSns | null {
  if (!corpo || typeof corpo !== "object") return null;
  const c = corpo as Record<string, unknown>;
  const tipo = c.Type;
  if (
    tipo !== "Notification" &&
    tipo !== "SubscriptionConfirmation" &&
    tipo !== "UnsubscribeConfirmation"
  )
    return null;
  const campos = [
    "MessageId",
    "TopicArn",
    "Message",
    "Timestamp",
    "Signature",
    "SigningCertURL",
  ] as const;
  for (const k of campos) if (typeof c[k] !== "string" || !(c[k] as string)) return null;
  const versao = String(c.SignatureVersion ?? "");
  if (versao !== "1" && versao !== "2") return null;
  return {
    Type: tipo,
    MessageId: String(c.MessageId),
    TopicArn: String(c.TopicArn),
    Message: String(c.Message),
    Timestamp: String(c.Timestamp),
    SignatureVersion: versao,
    Signature: String(c.Signature),
    SigningCertURL: String(c.SigningCertURL),
    ...(typeof c.Subject === "string" ? { Subject: c.Subject } : {}),
    ...(typeof c.Token === "string" ? { Token: c.Token } : {}),
    ...(typeof c.SubscribeURL === "string" ? { SubscribeURL: c.SubscribeURL } : {}),
  };
}

/** O texto que o SNS assinou, na ordem e com os campos que a Amazon documenta. */
export function textoAssinadoPeloSns(m: MensagemDoSns): string {
  const pares: Array<[string, string | undefined]> =
    m.Type === "Notification"
      ? [
          ["Message", m.Message],
          ["MessageId", m.MessageId],
          ["Subject", m.Subject],
          ["Timestamp", m.Timestamp],
          ["TopicArn", m.TopicArn],
          ["Type", m.Type],
        ]
      : [
          ["Message", m.Message],
          ["MessageId", m.MessageId],
          ["SubscribeURL", m.SubscribeURL],
          ["Timestamp", m.Timestamp],
          ["Token", m.Token],
          ["TopicArn", m.TopicArn],
          ["Type", m.Type],
        ];
  return pares
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}\n${v}\n`)
    .join("");
}

function chaveDoPem(pem: string): KeyObject {
  return pem.includes("BEGIN CERTIFICATE")
    ? new X509Certificate(pem).publicKey
    : createPublicKey(pem);
}

const certificados = new Map<string, string>();

export type BaixarCertificado = (url: string) => Promise<string>;

async function baixarDeVerdade(url: string): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!r.ok) throw new Error(`certificado do SNS respondeu ${r.status}`);
  return r.text();
}

export type RecusaDoAviso =
  | "sem_topico_configurado"
  | "formato"
  | "topico_estranho"
  | "certificado_fora_da_amazon"
  | "assinatura_invalida"
  | "aviso_velho";

/** Confere as três provas. `null` = aceito. */
export async function conferirAviso(
  m: MensagemDoSns,
  opcoes: { topicoEsperado: string; agora?: Date; baixar?: BaixarCertificado },
): Promise<RecusaDoAviso | null> {
  if (!opcoes.topicoEsperado.trim()) return "sem_topico_configurado";
  if (m.TopicArn !== opcoes.topicoEsperado.trim()) return "topico_estranho";
  if (!enderecoDoCertificadoValido(m.SigningCertURL)) return "certificado_fora_da_amazon";
  const quando = Date.parse(m.Timestamp);
  const agora = (opcoes.agora ?? new Date()).getTime();
  if (!Number.isFinite(quando) || agora - quando > 26 * 3600_000 || quando - agora > 15 * 60_000)
    return "aviso_velho";
  let pem = certificados.get(m.SigningCertURL);
  try {
    if (!pem) {
      pem = await (opcoes.baixar ?? baixarDeVerdade)(m.SigningCertURL);
      certificados.set(m.SigningCertURL, pem);
    }
    const verificador = createVerify(m.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1");
    verificador.update(textoAssinadoPeloSns(m), "utf8");
    return verificador.verify(chaveDoPem(pem), m.Signature, "base64")
      ? null
      : "assinatura_invalida";
  } catch {
    return "assinatura_invalida";
  }
}

/** Esquece os certificados guardados (para os testes). */
export function esquecerCertificados(): void {
  certificados.clear();
}

export type TipoDoEvento = "entrega" | "rejeicao" | "reclamacao";

export interface EventoDaSes {
  tipo: TipoDoEvento;
  /** O id da mensagem que a Amazon deu no envio (`mail.messageId`). */
  messageId: string;
  ocorridoEm: string;
  /** Rejeição: permanente ou temporária. */
  rejeicao?: "permanente" | "temporaria";
  /** A classificação, sem o endereço nem o texto de diagnóstico. */
  detalhe: Record<string, string>;
  /** Os endereços que o evento cita (para achar o destinatário; nunca gravados). */
  enderecos: string[];
}

function lista(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    : [];
}

/**
 * Lê o evento que vem dentro da mensagem do SNS. Aceita os dois formatos da SES:
 * o do conjunto de configuração (`eventType`) e o das notificações da
 * identidade (`notificationType`). Evento que não interessa (envio, abertura e
 * clique da própria Amazon, atraso) devolve `null` e é ignorado.
 */
export function lerEventoDaSes(mensagem: string): EventoDaSes | null {
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(mensagem) as Record<string, unknown>;
  } catch {
    return null;
  }
  const tipoBruto = String(c.eventType ?? c.notificationType ?? "");
  const mail = (c.mail ?? {}) as Record<string, unknown>;
  const messageId = String(mail.messageId ?? "");
  if (!messageId) return null;
  if (tipoBruto === "Delivery") {
    const d = (c.delivery ?? {}) as Record<string, unknown>;
    return {
      tipo: "entrega",
      messageId,
      ocorridoEm: String(d.timestamp ?? mail.timestamp ?? new Date().toISOString()),
      detalhe: {},
      enderecos: (Array.isArray(d.recipients) ? d.recipients : []).map(String),
    };
  }
  if (tipoBruto === "Bounce") {
    const b = (c.bounce ?? {}) as Record<string, unknown>;
    const tipo = String(b.bounceType ?? "");
    return {
      tipo: "rejeicao",
      messageId,
      ocorridoEm: String(b.timestamp ?? new Date().toISOString()),
      // "Permanent" é o endereço que não existe; "Transient" e "Undetermined"
      // são caixa cheia, servidor fora: temporária.
      rejeicao: tipo === "Permanent" ? "permanente" : "temporaria",
      detalhe: {
        bounceType: tipo.slice(0, 40),
        bounceSubType: String(b.bounceSubType ?? "").slice(0, 60),
      },
      enderecos: lista(b.bouncedRecipients)
        .map((r) => String(r.emailAddress ?? ""))
        .filter(Boolean),
    };
  }
  if (tipoBruto === "Complaint") {
    const q = (c.complaint ?? {}) as Record<string, unknown>;
    return {
      tipo: "reclamacao",
      messageId,
      ocorridoEm: String(q.timestamp ?? new Date().toISOString()),
      detalhe: { complaintFeedbackType: String(q.complaintFeedbackType ?? "").slice(0, 40) },
      enderecos: lista(q.complainedRecipients)
        .map((r) => String(r.emailAddress ?? ""))
        .filter(Boolean),
    };
  }
  return null;
}
