/**
 * FORK MIA (.79, empresa única): a ficha da empresa mora em
 * `/app/companies/<id>`. O endereço antigo leva para lá (inclusive o de uma
 * empresa juntada a outra: a ficha nova leva à que ficou).
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/app/companies/${id}`);
}
