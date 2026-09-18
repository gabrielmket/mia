/**
 * POST /api/v1/broadcasts/midia — o arquivo que vai NO DISPARO.
 *
 * ⚠️ Irmã de `/api/v1/channels/templates/midia`, e as duas NÃO se substituem:
 * aquela sobe o EXEMPLO que a Meta usa para revisar o modelo (devolve um
 * `handle`); esta sobe o arquivo que o cliente REALMENTE recebe (devolve um
 * `media_id`). Trocar uma pela outra produz erro genérico da Meta nos dois
 * sentidos — ver o cabeçalho de `lib/channels/meta/subir-midia-para-envio.ts`.
 *
 * Existe para tirar a hospedagem do caminho: antes, mandar uma imagem numa
 * campanha exigia publicá-la numa URL que os servidores da Meta conseguissem
 * baixar. Quem não tem site vira refém de um hospedeiro qualquer; quem tem,
 * descobre que o link do Drive devolve HTML — e o erro chega como `131053`
 * depois do disparo, com o crédito já gasto.
 *
 * Devolve o valor JÁ no formato que o slot espera (`meta-media:<id>`), com o
 * nome do arquivo grudado quando for documento. Quem chama não precisa conhecer
 * a convenção — só colar no campo.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { credenciaisDaOrg } from "@/lib/channels/meta/credenciais-da-org";
import { comNomeDeArquivo, comoMidia } from "@/lib/channels/meta/midia-por-id";
import { subirMidiaParaEnvio } from "@/lib/channels/meta/subir-midia-para-envio";
import { requireSupportWrite } from "@/lib/impersonate/support";

export const dynamic = "force-dynamic";

/**
 * 16 MB — o teto de documento e vídeo da própria Meta (imagem para em 5 MB do
 * lado dela). Recusar aqui, com o número na frase, evita o upload inteiro subir
 * para morrer do outro lado com um erro que não diz o limite.
 */
const TAMANHO_MAXIMO = 16 * 1024 * 1024;

/** O que a Meta entrega em mensagem de template. Áudio não entra: template não o usa. */
const TIPOS_ACEITOS = [
  "image/jpeg",
  "image/png",
  "video/mp4",
  "video/3gpp",
  "application/pdf",
];

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  // Mesmo piso de quem dispara campanha: o arquivo sai em nome da marca, para
  // uma lista inteira, e cada linha custa dinheiro.
  const authz = await requireRole("admin", { requestId, resource: "broadcasts" });
  if (!authz.ok) return authz.response;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return fail("validation_failed", "Envio inválido.", 422, { requestId });
  }

  const arquivo = formData.get("file");
  if (!(arquivo instanceof File)) {
    return fail("validation_failed", "Escolha um arquivo.", 422, { requestId });
  }
  if (arquivo.size > TAMANHO_MAXIMO) {
    return fail("validation_failed", "O arquivo precisa ter até 16 MB.", 422, { requestId });
  }
  if (!TIPOS_ACEITOS.includes(arquivo.type)) {
    // A lista vai na frase: "formato não suportado" sem ela manda o operador
    // tentar por eliminação, um upload de cada vez.
    return fail(
      "validation_failed",
      `A Meta aceita ${TIPOS_ACEITOS.join(", ")} — este arquivo é ${arquivo.type || "de tipo desconhecido"}.`,
      422,
      { requestId },
    );
  }

  const creds = await credenciaisDaOrg(authz.org.orgId);
  if (!creds) {
    return fail("invalid_request", "Nenhum canal oficial conectado.", 400, { requestId });
  }

  const r = await subirMidiaParaEnvio({
    phoneNumberId: creds.phoneNumberId,
    token: creds.token,
    graphVersion: creds.graphVersion,
    bytes: await arquivo.arrayBuffer(),
    mimeType: arquivo.type,
    filename: arquivo.name || "arquivo",
  });

  if (!r.ok) {
    // 502: quem recusou foi a Meta. A distinção diz ao operador se ele tenta de
    // novo ou conserta a própria configuração.
    return fail("upstream_error", r.erro, 502, { requestId });
  }

  /**
   * O nome só vai em DOCUMENTO. Em imagem e vídeo a Meta ignora o campo, e
   * mandá-lo mesmo assim faria o valor do slot carregar um `|foto.jpg` que não
   * serve a nada e ainda aparece na tela de quem revisa a campanha.
   */
  const valor =
    arquivo.type === "application/pdf"
      ? comNomeDeArquivo(comoMidia(r.mediaId), arquivo.name || "documento.pdf")
      : comoMidia(r.mediaId);

  return ok({ valor, media_id: r.mediaId, tipo: arquivo.type }, { requestId });
}
