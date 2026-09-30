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
 */
export async function EntrarComGoogleSeLigado({
  next,
  convite,
}: {
  next?: string;
  convite?: string;
}) {
  if (!(await googleNaTelaDeEntrar())) return null;
  return <EntrarComGoogle next={next} convite={convite} />;
}
