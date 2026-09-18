/**
 * SUBIR O ARQUIVO QUE O CLIENTE VAI RECEBER.
 *
 * ⚠️ NÃO confundir com `subir-midia-do-template.ts`. São duas APIs diferentes,
 * para duas coisas diferentes, e trocá-las é o erro que custa uma tarde:
 *
 *   `subir-midia-do-template` → `POST /{app-id}/uploads`, em duas etapas,
 *      devolve um HANDLE. É o EXEMPLO que a Meta usa para revisar o modelo.
 *      Não é o que ninguém recebe.
 *
 *   este arquivo → `POST /{phone-number-id}/media`, uma etapa, multipart,
 *      devolve um MEDIA ID. É o arquivo que sai no envio, para o cliente.
 *
 * O handle não serve para enviar e o media id não serve para criar template. A
 * Meta responde erros genéricos nos dois casos trocados.
 *
 * ─── Por que isso existe ───────────────────────────────────────────────────
 *
 * Sem isto, mandar uma imagem numa campanha exigia publicá-la numa URL pública
 * que os servidores da Meta conseguissem baixar. Quem não tem site vira refém
 * de um hospedeiro qualquer; quem tem, descobre que o link do Drive devolve
 * HTML em vez da imagem — e o erro chega como `131053` depois do disparo.
 */

export interface SubirParaEnvioInput {
  phoneNumberId: string;
  token: string;
  graphVersion: string;
  bytes: ArrayBuffer;
  /** `image/jpeg`, `image/png`, `video/mp4`, `application/pdf`. */
  mimeType: string;
  /** O nome só importa para documento — ver `midia-por-id.ts`. */
  filename: string;
}

export type SubirParaEnvioResultado =
  | { ok: true; mediaId: string }
  | { ok: false; erro: string };

/**
 * Nunca lança: devolve o erro como valor.
 *
 * Quem chama é uma rota de upload com o operador esperando na tela, e um throw
 * viraria 500 sem frase. O texto da Meta, quando vem, é a única coisa que
 * explica um arquivo recusado ("file type not supported", "file too large") — e
 * é ele que precisa chegar à tela.
 */
export async function subirMidiaParaEnvio(
  input: SubirParaEnvioInput,
): Promise<SubirParaEnvioResultado> {
  try {
    const form = new FormData();
    // `messaging_product` é obrigatório e a Meta recusa sem dizer o nome do
    // campo que falta — responde um 400 sobre o arquivo.
    form.append("messaging_product", "whatsapp");
    form.append("type", input.mimeType);
    form.append("file", new Blob([input.bytes], { type: input.mimeType }), input.filename);

    const res = await fetch(
      `https://graph.facebook.com/${input.graphVersion}/${encodeURIComponent(input.phoneNumberId)}/media`,
      {
        method: "POST",
        // `Bearer` AQUI, ao contrário da segunda etapa do upload de template,
        // que exige `OAuth`. As duas APIs não combinam nem no cabeçalho.
        headers: { Authorization: `Bearer ${input.token}` },
        body: form,
      },
    );

    const corpo = (await res.json().catch(() => null)) as
      | { id?: string; error?: { message?: string } }
      | null;

    if (!res.ok || !corpo?.id) {
      return {
        ok: false,
        erro: corpo?.error?.message ?? `A Meta recusou o arquivo (HTTP ${res.status}).`,
      };
    }
    return { ok: true, mediaId: corpo.id };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : "Falha ao enviar o arquivo." };
  }
}
