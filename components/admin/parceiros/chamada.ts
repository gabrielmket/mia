import { MENSAGEM_DA_RECUSA_DE_ESCRITA } from "@/lib/auth/recusa-de-escrita-de-admin";

interface Corpo {
  data?: unknown;
  error?: { code?: string; message?: string };
}

/**
 * FORK MIA (.98) · Uma escrita das telas de cupons e parceiros. A recusa da
 * verificação em duas etapas vem traduzida; o resto, a mensagem da rota.
 */
export async function gravar<T = unknown>(
  url: string,
  metodo: "POST" | "PUT" | "PATCH",
  corpo: unknown,
  t: (s: string) => string,
): Promise<{ ok: true; data: T } | { ok: false; mensagem: string; campos?: Record<string, string> }> {
  try {
    const r = await fetch(url, {
      method: metodo,
      credentials: "same-origin",
      ...(corpo instanceof FormData ? { body: corpo } : { headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }),
    });
    const lido = ((await r.json().catch(() => ({}))) ?? {}) as Corpo;
    if (r.ok) return { ok: true, data: lido.data as T };
    const codigo = lido.error?.code ?? "";
    const mensagem =
      codigo in MENSAGEM_DA_RECUSA_DE_ESCRITA
        ? t(MENSAGEM_DA_RECUSA_DE_ESCRITA[codigo as keyof typeof MENSAGEM_DA_RECUSA_DE_ESCRITA])
        : (lido.error?.message ?? t("Não foi possível salvar. Tente de novo."));
    const detalhes = (lido.error as { details?: { campos?: Record<string, string> } } | undefined)?.details;
    return { ok: false, mensagem, ...(detalhes?.campos ? { campos: detalhes.campos } : {}) };
  } catch {
    return { ok: false, mensagem: t("Não deu para falar com o servidor. Confira a conexão e tente de novo.") };
  }
}

/** "1234,5" ou "1234.5" em número; vazio ou inválido = `null`. */
export function numeroDigitado(v: string): number | null {
  const n = Number(v.trim().replace(/\./g, (m, i, s: string) => (s.includes(",") ? "" : m)).replace(",", "."));
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
}
