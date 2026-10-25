/**
 * FORK MIA (.89) — as IMAGENS dos blocos de campanha: o bucket, os formatos e o
 * endereço público por onde o e-mail as mostra.
 *
 * O bucket é PRIVADO (9065). O e-mail aponta para a rota pública
 * `GET /api/v1/webhooks/email-marketing/imagem/<empresa>/<uuid>.<ext>`, que lê
 * daqui com o service_role e devolve a imagem com cache longo.
 */
export const BUCKET_DAS_IMAGENS = "email-marketing-imagens";

/** Os formatos aceitos, pela extensão do caminho. */
export const TIPO_DA_EXTENSAO = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
} as const;

/** O endereço público da imagem, a partir do caminho no bucket (`<empresa>/<uuid>.<ext>`). */
export function urlDaImagem(origem: string, caminho: string): string {
  return `${origem.replace(/\/+$/, "")}/api/v1/webhooks/email-marketing/imagem/${caminho}`;
}
