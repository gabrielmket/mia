/**
 * GET /api/v1/agenda/microsoft/connect: começa a conexão da agenda do Outlook.
 *
 * FORK MIA (docs/fork/agenda-microsoft.md). O mesmo desenho da ida do Google do
 * upstream (`/api/v1/agenda/google/connect`): conexão por PESSOA, piso `agent`,
 * `state` assinado carregando quem conecta, cookie de vínculo `SameSite=Lax` só
 * no caminho da volta. Duas diferenças:
 *
 *  - **PKCE**: o desafio sai do mesmo nonce (ver `lib/agenda/microsoft/oauth.ts`);
 *  - **o domínio da volta é o da tela**: a instalação responde por mais de um
 *    domínio, e o cookie de vínculo fica no domínio em que a pessoa está.
 */

import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { emitirEstado } from "@/lib/agenda/google/estado";
import { assinarVinculo, NOME_DO_VINCULO, VALIDADE_DO_VINCULO_S } from "@/lib/agenda/google/vinculo";
import {
  CAMINHO_DO_CALLBACK_MICROSOFT,
  configuracaoDaMicrosoft,
  enderecoDeRetornoMicrosoft,
  origemPublicaDoPedido,
} from "@/lib/agenda/microsoft/config";
import { montarUrlDeConsentimentoMicrosoft, verificadorPkce } from "@/lib/agenda/microsoft/oauth";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { travaDaDemonstracao } from "@/lib/demonstracao/trava";
import { env } from "@/lib/env";
import { authenticatedSessionId, requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookieSecure } from "@/lib/supabase/cookie-secure";

export const dynamic = "force-dynamic";

function voltarComErro(origem: string, codigo: string): NextResponse {
  return NextResponse.redirect(new URL(`/app/agenda?ms_erro=${codigo}`, origem));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = req.headers.get("x-request-id") ?? undefined;

  const autorizado = await requireRole("agent", { requestId, resource: "calendar_connections" });
  if (!autorizado.ok) return autorizado.response;
  const { user, org } = autorizado;
  const origem = origemPublicaDoPedido(req.headers);

  // FORK MIA (9016): a empresa de demonstração não conecta agenda de fora. Quem
  // TRAVA é o banco, na volta (a conexão viva não nasce); aqui é só a cortesia de
  // não mandar a pessoa até a Microsoft para recusar depois. Por isso só o "é
  // demonstração" confirmado barra: falha de leitura segue, e o banco decide.
  const trava = await travaDaDemonstracao(createAdminClient(), org.orgId);
  if (trava.travado && trava.motivo === "demonstracao") {
    return voltarComErro(origem, "empresa_de_demonstracao");
  }

  const app = await configuracaoDaMicrosoft();
  if (!app) return voltarComErro(origem, "nao_configurado");

  const nonce = randomBytes(16).toString("base64url");
  let state: string;
  try {
    state = emitirEstado(
      { organizationId: org.orgId, userId: user.id, authSessionId: await authenticatedSessionId() },
      { segredo: env.INTERNAL_SECRET, agora: new Date(), nonce },
    );
  } catch {
    await audit({
      action: "agenda.microsoft.conexao_falhou",
      organizationId: org.orgId,
      metadata: { reason: "segredo_de_state_indisponivel" },
    });
    return voltarComErro(origem, "segredo_indisponivel");
  }

  const url = montarUrlDeConsentimentoMicrosoft(
    { clientId: app.clientId, tenant: app.tenant, redirectUri: enderecoDeRetornoMicrosoft(origem) },
    { state, verificador: verificadorPkce(nonce, env.INTERNAL_SECRET), contaSugerida: user.email },
  );

  await audit({
    action: "agenda.microsoft.conexao_iniciada",
    organizationId: org.orgId,
    metadata: { user_id: user.id },
  });

  const resposta = NextResponse.redirect(url);
  // `Lax` é o ponto deste cookie: é o que viaja na volta top-level GET vinda de
  // outro site. `secure` sai de `cookieSecure()` (self-host em http existe).
  resposta.cookies.set(NOME_DO_VINCULO, assinarVinculo(nonce, env.INTERNAL_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: CAMINHO_DO_CALLBACK_MICROSOFT,
    maxAge: VALIDADE_DO_VINCULO_S,
  });
  return resposta;
}
