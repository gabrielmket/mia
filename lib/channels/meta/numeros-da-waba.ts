/**
 * Os números de uma conta do WhatsApp, perguntados à Meta.
 *
 * ── Por que isto precisa existir ─────────────────────────────────────────────
 *
 * O aviso `partner_added` — o que a Meta manda quando um cliente termina o
 * cadastro incorporado — NÃO traz número nenhum. Ele diz apenas "a empresa X
 * adicionou o seu app à conta Y". Medido na primeira chegada real, 21/09/2026:
 *
 *   { "event": "PARTNER_ADDED",
 *     "waba_info": { "waba_id": "…", "owner_business_id": "…" } }
 *
 * E a amarração PRECISA de um `phone_number_id`: é ele que vira o canal. Sem
 * buscar, a conta chega, aparece na fila do operador e não tem como ser
 * amarrada a nada — o cliente fez a parte dele e o sistema não tem o que fazer
 * com isso. Era esse o estado quando esta função foi escrita.
 *
 * ── Qual token ───────────────────────────────────────────────────────────────
 *
 * `META_SYSTEM_USER_TOKEN`, o token de sistema DA PLATAFORMA. É o mesmo que
 * `resolveMetaCreds` já usa como último degrau para canais sem token próprio, e
 * é o que o modelo de Provedor de Tecnologia pressupõe: o cliente adicionou
 * nosso app como parceiro justamente para não ter de digitar credencial.
 *
 * Ausência do token NÃO é falha de rede nem conta sem número: é configuração
 * faltando na instalação, e o motivo diz isso com o nome da variável. Os três
 * desfechos são distintos de propósito — confundi-los faria o operador procurar
 * o problema na Meta quando ele está no nosso ambiente.
 */

const GRAPH_PADRAO = "v22.0";

export interface NumeroDaWaba {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  codeVerificationStatus: string | null;
  /** CLOUD_API | ON_PREMISE | NOT_APPLICABLE — decide se o número SERVE. */
  platformType: string | null;
  /** Falso quando o número ainda vive no aplicativo WhatsApp Business. */
  servePraCloudApi: boolean;
}

export type NumerosDaWaba =
  | { ok: true; numeros: NumeroDaWaba[] }
  | { ok: false; motivo: string; faltaNoAmbiente?: string };

function texto(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * `platform_type` é o campo decisivo e o menos conhecido da Cloud API.
 *
 * Um número que ainda está no APLICATIVO WhatsApp Business aparece na conta e
 * volta como `NOT_APPLICABLE`. Ele nunca conecta enquanto não sair de lá — e
 * sem esta leitura o operador amarraria um canal que nasce morto, descobrindo
 * na primeira mensagem que não sai.
 */
function serve(platformType: string | null): boolean {
  return (platformType ?? "").toUpperCase() === "CLOUD_API";
}

export async function numerosDaWaba(input: {
  wabaId: string;
  /** Sobrescreve o token da plataforma. Existe para o teste, não para a rota. */
  token?: string;
  graphVersion?: string;
}): Promise<NumerosDaWaba> {
  const token = (input.token ?? process.env.META_SYSTEM_USER_TOKEN ?? "").trim();
  if (!token) {
    return {
      ok: false,
      motivo:
        "Esta instalação não tem o token de sistema da Meta configurado — sem ele não dá para perguntar quais números a conta do cliente tem.",
      faltaNoAmbiente: "META_SYSTEM_USER_TOKEN",
    };
  }

  const versao = input.graphVersion ?? process.env.META_GRAPH_VERSION ?? GRAPH_PADRAO;
  const campos =
    "id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type";

  let res: Response;
  try {
    res = await fetch(
      `https://graph.facebook.com/${versao}/${input.wabaId}/phone_numbers?fields=${campos}&limit=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch (err) {
    // Rede caída não é credencial ruim nem conta vazia. Se isto virasse "sem
    // números", o operador iria mexer na configuração que já estava certa.
    return {
      ok: false,
      motivo: `Não consegui falar com a Meta: ${err instanceof Error ? err.message : "erro de rede"}`,
    };
  }

  const corpo = (await res.json().catch(() => ({}))) as {
    data?: Record<string, unknown>[];
    error?: { message?: string; error_user_msg?: string; error_data?: { details?: string } };
  };

  if (!res.ok || corpo.error) {
    const e = corpo.error;
    // O `details` é o que separa "token sem permissão nesta conta" de "conta que
    // não existe". Sem ele o operador só sabe que não deu.
    return {
      ok: false,
      motivo:
        e?.error_data?.details ?? e?.error_user_msg ?? e?.message ?? `A Meta recusou (http ${res.status}).`,
    };
  }

  const numeros: NumeroDaWaba[] = (corpo.data ?? []).map((n) => {
    const platformType = texto(n.platform_type);
    return {
      id: String(n.id ?? ""),
      displayPhoneNumber: texto(n.display_phone_number),
      verifiedName: texto(n.verified_name),
      qualityRating: texto(n.quality_rating),
      codeVerificationStatus: texto(n.code_verification_status),
      platformType,
      servePraCloudApi: serve(platformType),
    };
  });

  return { ok: true, numeros: numeros.filter((n) => n.id.length > 0) };
}
