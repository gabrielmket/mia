/**
 * SUBIR A IMAGEM DE EXEMPLO DO CABEÇALHO — o passo que faltava para o template
 * com imagem existir.
 *
 * Um template com `HEADER format: IMAGE` não guarda a imagem: ele guarda um
 * EXEMPLO, que a Meta usa para revisar o modelo. Esse exemplo não vai como URL
 * nem como arquivo no corpo do `message_templates` — vai como um `handle`,
 * devolvido por uma API de upload própria e em DUAS etapas:
 *
 *   1. `POST /{app-id}/uploads?file_length=&file_type=` → devolve uma SESSÃO
 *      (`upload:ABC...`), que não é o handle e não serve para nada sozinha.
 *   2. `POST /{sessão}` com o binário e `Authorization: OAuth <token>` →
 *      devolve `{ h: "..." }`, e esse `h` é o handle.
 *
 * ⚠️ Três detalhes que a documentação menciona de passagem e que fazem o passo
 * falhar de formas que não se explicam sozinhas:
 *
 *  • A segunda chamada usa `Authorization: OAuth <token>` — NÃO `Bearer`. Com
 *    `Bearer` a Meta responde 400 genérico.
 *  • O endereço da sessão já vem completo na resposta da primeira: concatenar
 *    `graph.facebook.com/<versão>/` de novo produz 404.
 *  • `file_length` precisa ser o tamanho REAL em bytes. Errado, o upload é
 *    aceito e o handle sai inválido — o erro só aparece ao criar o template,
 *    apontando para o campo errado.
 *
 * O handle NÃO é a imagem que o cliente recebe. Ele é só a amostra da análise:
 * a imagem de cada envio vai no parâmetro do cabeçalho, na hora de disparar.
 * Confundir os dois é o que faz alguém esperar que trocar a foto do exemplo
 * mude o que o cliente vê.
 */
import { graphBaseUrl, graphHost } from "@/lib/channels/meta/graph-base";

export type MidiaDoCabecalho = "IMAGE" | "VIDEO" | "DOCUMENT";

export interface SubirMidiaInput {
  appId: string;
  token: string;
  graphVersion: string;
  /** Os bytes do arquivo. */
  bytes: ArrayBuffer;
  /** `image/jpeg`, `image/png`, `video/mp4`, `application/pdf`. */
  tipo: string;
}

export type SubirMidiaResult =
  | { subiu: true; handle: string }
  | { subiu: false; motivo: "sessao" | "upload" | "sem_handle"; detalhe: string };

/** O que a Meta aceita como cabeçalho, por formato. Fora disso ela recusa. */
export const TIPOS_ACEITOS: Record<MidiaDoCabecalho, readonly string[]> = {
  IMAGE: ["image/jpeg", "image/png"],
  VIDEO: ["video/mp4"],
  DOCUMENT: ["application/pdf"],
};

/** O formato do cabeçalho que corresponde a este tipo de arquivo, ou `null`. */
export function formatoDoTipo(tipo: string): MidiaDoCabecalho | null {
  for (const [formato, aceitos] of Object.entries(TIPOS_ACEITOS)) {
    if (aceitos.includes(tipo)) return formato as MidiaDoCabecalho;
  }
  return null;
}

export async function subirMidiaDoTemplate(
  input: SubirMidiaInput,
): Promise<SubirMidiaResult> {
  // ── 1. abrir a sessão ─────────────────────────────────────────────────────
  const qs = new URLSearchParams({
    file_length: String(input.bytes.byteLength),
    file_type: input.tipo,
  });
  const urlSessao = `${graphBaseUrl(input.graphVersion)}/${input.appId}/uploads?${qs}`;

  let sessaoRes: Response;
  try {
    sessaoRes = await fetch(urlSessao, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.token}` },
    });
  } catch (err) {
    return {
      subiu: false,
      motivo: "sessao",
      detalhe: err instanceof Error ? err.message : String(err),
    };
  }

  const sessaoCorpo = (await sessaoRes.json().catch(() => null)) as { id?: string } | null;
  if (!sessaoRes.ok || !sessaoCorpo?.id) {
    return {
      subiu: false,
      motivo: "sessao",
      detalhe: `a Meta não abriu a sessão de upload (${sessaoRes.status})`,
    };
  }

  // ── 2. mandar os bytes ────────────────────────────────────────────────────
  //
  // `sessaoCorpo.id` já é o caminho completo (`upload:ABC...`); o host vem daqui
  // e a versão NÃO se repete — ver o cabeçalho.
  let uploadRes: Response;
  try {
    uploadRes = await fetch(`${graphHost()}/${sessaoCorpo.id}`, {
      method: "POST",
      headers: {
        // OAuth, e não Bearer. Ver o cabeçalho: com Bearer a resposta é um 400
        // genérico que manda procurar defeito no arquivo.
        Authorization: `OAuth ${input.token}`,
        file_offset: "0",
        "Content-Type": "application/octet-stream",
      },
      body: input.bytes,
    });
  } catch (err) {
    return {
      subiu: false,
      motivo: "upload",
      detalhe: err instanceof Error ? err.message : String(err),
    };
  }

  const corpo = (await uploadRes.json().catch(() => null)) as { h?: string } | null;
  if (!uploadRes.ok) {
    return {
      subiu: false,
      motivo: "upload",
      detalhe: `a Meta recusou o arquivo (${uploadRes.status})`,
    };
  }
  if (!corpo?.h) {
    return {
      subiu: false,
      motivo: "sem_handle",
      detalhe: "o upload respondeu sem `h` — o handle é o que o template precisa",
    };
  }

  return { subiu: true, handle: corpo.h };
}
