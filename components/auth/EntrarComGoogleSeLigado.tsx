import type { ReactNode } from "react";

import { EntrarComGoogle } from "@/components/auth/EntrarComGoogle";
import { googleNaTelaDeEntrar } from "@/lib/auth/google-na-tela";

/**
 * FORK MIA (.64) — o botão "Entrar com Google" (e o separador "ou" que vem
 * com ele) só quando o provedor está LIGADO no GoTrue desta instalação.
 *
 * Componente de SERVIDOR: a pergunta vai ao GoTrue daqui, com cache curto
 * (`lib/auth/google-na-tela.ts`), e o navegador nunca recebe um botão que só
 * existe para dizer que não funciona. Sem resposta das settings, esconde.
 *
 * As páginas o põem dentro de `<Suspense fallback={null}>`: um GoTrue lento
 * atrasa só o botão, nunca o formulário de e-mail e senha.
 *
 * FORK MIA (.82): os avisos do cadastro com plano (upstream v1.84, migration
 * 0679) falam do Google, então seguem a mesma régua. `aviso` vem logo abaixo
 * do botão; `avisoNoLugar` substitui o botão (o cadastro exige escolher plano
 * e o Google não leva a escolha). Com o Google desligado, nenhum dos dois.
 */
export async function EntrarComGoogleSeLigado({
  next,
  convite,
  aviso,
  avisoNoLugar,
}: {
  next?: string;
  convite?: string;
  aviso?: ReactNode;
  avisoNoLugar?: ReactNode;
}) {
  if (!(await googleNaTelaDeEntrar())) return null;
  if (avisoNoLugar) return <>{avisoNoLugar}</>;
  return (
    <>
      <EntrarComGoogle next={next} convite={convite} />
      {aviso}
    </>
  );
}
