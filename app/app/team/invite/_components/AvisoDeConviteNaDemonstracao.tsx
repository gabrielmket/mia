/**
 * FORK MIA (9020) — o aviso da tela Convidar membros na empresa de demonstração.
 *
 * O selo do topo (`components/app/SeloDeDemonstracao.tsx`) diz, em toda tela,
 * que nenhuma mensagem, e-mail ou aviso sai desta empresa. Nesta tela isso
 * deixaria quem convida em dúvida: o convite é um e-mail. A partir da 9020 ele
 * funciona aqui como em qualquer empresa, e o aviso diz as duas coisas que
 * importam: o convite dá acesso à demonstração, e é só ele que sai.
 *
 * É componente de SERVIDOR, e por isso mora ao lado do formulário e não dentro
 * dele: quem lê a marca é o cliente de serviço, que não pode chegar a um
 * componente `"use client"`.
 *
 * É só informação, como o selo: quem decide o que sai é o banco (a trava das
 * migrations 9010 e 9016) e o roteador de e-mail. Se a leitura da marca falhar,
 * o aviso some e nada mais muda.
 */
import { empresaEDemonstracao } from "@/lib/demonstracao/selo";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { createAdminClient } from "@/lib/supabase/admin";

/** A empresa é de demonstração? Nunca lança: sem resposta, sem aviso. */
async function lerAMarca(organizationId: string): Promise<boolean> {
  try {
    return await empresaEDemonstracao(createAdminClient(), organizationId);
  } catch {
    return false;
  }
}

export async function AvisoDeConviteNaDemonstracao({
  organizationId,
  idioma,
}: {
  organizationId: string;
  idioma: Idioma;
}) {
  if (!(await lerAMarca(organizationId))) return null;
  const t = (texto: string) => traduzir(texto, idioma);
  return (
    <p
      role="note"
      data-aviso-de-convite-na-demonstracao=""
      className="max-w-prose rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-50"
    >
      {t("Esta é a empresa de demonstração. O convite dá acesso a ela, e nada mais sai daqui.")}
    </p>
  );
}
