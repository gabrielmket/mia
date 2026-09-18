/**
 * GET /api/v1/admin/numero-de-avisos/qr — o QR do número de avisos.
 *
 * A rota irmã do tenant (`/api/v1/channel-sessions/[id]/qr`) resolve a sessão
 * pela organização ATIVA de quem pede. Aqui não serve: o número de avisos pode
 * morar numa organização que não é a ativa do admin — é justamente por ser da
 * plataforma que ele tem tela própria.
 *
 * Então a sessão é resolvida pelo PAPEL (`e_numero_de_avisos`), e não por
 * tenant. É a mesma leitura que a tela já faz; o que muda é que esta devolve a
 * imagem para um `<img src>` poder mostrá-la sem expor a chave do transporte.
 */
import { NextResponse } from "next/server";

import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await requirePlatformAdmin();
  } catch {
    return new NextResponse(null, { status: 403 });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("channel_sessions")
    .select("waha_session_name, status, archived_at")
    .eq("e_numero_de_avisos", true)
    .maybeSingle();

  const sessao = data as {
    waha_session_name: string | null;
    status: string | null;
    archived_at: string | null;
  } | null;

  if (!sessao) return new NextResponse(null, { status: 404 });
  // Corpo vazio e o motivo no cabeçalho: quem consome isto é um `<img>`, que não
  // lê JSON. O cabeçalho é para quem depura — e para a tela poder distinguir
  // "ainda não ficou pronto" de "não há o que parear".
  if (sessao.archived_at) {
    return new NextResponse(null, { status: 409, headers: { "x-channel-state": "archived" } });
  }
  if (!sessao.waha_session_name) {
    return new NextResponse(null, { status: 409, headers: { "x-channel-state": "no-session" } });
  }
  // Já pareado: o QR do WAHA some quando a sessão conecta, e insistir nele
  // faria a tela piscar um erro em cima de um número que está funcionando.
  if (sessao.status === "WORKING") {
    return new NextResponse(null, { status: 409, headers: { "x-channel-state": "working" } });
  }

  const baseUrl = process.env.WAHA_API_BASE_URL;
  const apiKey = process.env.WAHA_API_KEY;
  if (!baseUrl || !apiKey || apiKey === "dev_plaintext_change_me") {
    return new NextResponse(null, { status: 503 });
  }

  const upstream = await fetch(
    `${baseUrl}/api/${encodeURIComponent(sessao.waha_session_name)}/auth/qr?format=image`,
    { headers: { "X-Api-Key": apiKey }, cache: "no-store" },
  );
  if (!upstream.ok) {
    return new NextResponse(null, {
      status: upstream.status,
      headers: { "x-waha-status": String(upstream.status) },
    });
  }

  const corpo = await upstream.arrayBuffer();
  return new NextResponse(corpo, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/png",
      // Nunca em cache: o QR expira em segundos e um cache de proxy faria a tela
      // mostrar um código morto, que o celular recusa sem dizer por quê.
      "cache-control": "no-store",
    },
  });
}
