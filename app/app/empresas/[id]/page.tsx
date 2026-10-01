/**
 * FORK MIA — o endereço de UMA empresa: `/app/empresas/<id>`.
 *
 * O cartão aberto do negócio e a ficha do contato levam à empresa pelo nome
 * dela. Enquanto a ficha da empresa é a janela da lista, este endereço abre a
 * lista com a ficha já aberta.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/app/empresas?ficha=${encodeURIComponent(id)}`);
}
