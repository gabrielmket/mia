/**
 * `/admin/microsoft`: o app da Microsoft (Entra) desta instalação.
 *
 * FORK MIA (9011, docs/fork/agenda-microsoft.md, seção 5). Irmã de
 * `/admin/google` do upstream. Só o dono da plataforma entra (`notFound()` para
 * o resto, como lá).
 */

import { notFound } from "next/navigation";
import { headers } from "next/headers";

import {
  configuracaoDoAmbienteMicrosoft,
  enderecoDasNotificacoesMicrosoft,
  enderecoDeRetornoMicrosoft,
  linkDeAprovacaoDoTi,
  origemCanonica,
  origemPublicaDoPedido,
} from "@/lib/agenda/microsoft/config";
import { loadAuthUser } from "@/lib/auth/server";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { createAdminClient } from "@/lib/supabase/admin";

import { FormularioDaMicrosoft } from "./_form";

export const metadata = { title: "Microsoft 365 da instalação" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();
  const cabecalhos = await headers();

  const { data } = await createAdminClient()
    .from("mia_microsoft_oauth_da_plataforma")
    .select("client_id, client_secret_encrypted, segredo_vence_em, tenant, updated_at")
    .eq("id", 1)
    .maybeSingle();
  const linha = data as
    | {
        client_id: string | null;
        client_secret_encrypted: string | null;
        segredo_vence_em: string | null;
        tenant: string | null;
        updated_at: string | null;
      }
    | null;

  const doAmbiente = configuracaoDoAmbienteMicrosoft();
  const canonica = origemCanonica();
  const daTela = origemPublicaDoPedido(cabecalhos);
  // Os endereços de retorno a registrar: o do domínio principal e, quando a
  // tela foi aberta por outro domínio da mesma instalação, o dele também.
  const enderecos = [...new Set([enderecoDeRetornoMicrosoft(canonica), enderecoDeRetornoMicrosoft(daTela)])];
  const clientId = linha?.client_id ?? doAmbiente?.clientId ?? null;

  return (
    <FormularioDaMicrosoft
      clientIdSalvo={linha?.client_id ?? null}
      temSegredoSalvo={Boolean(linha?.client_secret_encrypted)}
      segredoVenceEm={linha?.segredo_vence_em ?? null}
      tenantSalvo={linha?.tenant ?? "common"}
      atualizadoEm={
        linha?.updated_at
          ? new Date(linha.updated_at).toLocaleString(tagDeIdioma(usuario.idioma), {
              timeZone: "America/Sao_Paulo",
              dateStyle: "short",
              timeStyle: "short",
            })
          : null
      }
      temNoAmbiente={doAmbiente !== null}
      enderecosDeRetorno={enderecos}
      enderecoDasNotificacoes={enderecoDasNotificacoesMicrosoft(canonica)}
      linkDoTi={clientId ? linkDeAprovacaoDoTi(clientId, canonica) : null}
    />
  );
}
