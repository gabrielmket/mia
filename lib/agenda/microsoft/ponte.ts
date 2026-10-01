/**
 * A volta do consentimento para a Agenda, por PÁGINA-PONTE e não por redirect.
 *
 * O motivo está medido no callback do Google do upstream: o cookie de sessão é
 * `SameSite=Strict`, e um 307 daqui para `/app/agenda` ainda pertence à cadeia de
 * navegação que começou em `login.microsoftonline.com`. O cookie não viaja e a
 * pessoa cai no login. A ponte muda quem inicia a navegação (um documento nosso,
 * com 200), e o cookie viaja.
 *
 * Também é aqui que o cookie de vínculo morre, em TODA saída (sucesso e erro).
 *
 * O parâmetro vai como `ms_ok`/`ms_erro` (e não `ok`/`erro`) para a faixa do
 * Google não traduzir um código nosso como falha do Google.
 */

import { NextResponse } from "next/server";

import { NOME_DO_VINCULO } from "@/lib/agenda/google/vinculo";
import { cookieSecure } from "@/lib/supabase/cookie-secure";

import { CAMINHO_DO_CALLBACK_MICROSOFT } from "./config";

function escapar(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function voltarParaAAgenda(origem: string, parametro: string): NextResponse {
  const destino = new URL(`/app/agenda?${parametro}`, origem).toString();
  const seguro = escapar(destino);
  const resposta = new NextResponse(
    `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">` +
      `<meta name="robots" content="noindex">` +
      `<noscript><meta http-equiv="refresh" content="0;url=${seguro}"></noscript>` +
      `<title>Voltando…</title></head><body>` +
      `<p>Voltando para a sua agenda…</p>` +
      `<script>location.replace(${JSON.stringify(destino)})</script>` +
      `<noscript><p><a href="${seguro}">Continuar</a></p></noscript>` +
      `</body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
  resposta.cookies.set(NOME_DO_VINCULO, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: CAMINHO_DO_CALLBACK_MICROSOFT,
    maxAge: 0,
  });
  return resposta;
}
