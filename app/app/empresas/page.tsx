/**
 * FORK MIA (.79, empresa única): a tela de Empresas passou a ser
 * `/app/companies` (o cadastro único, docs/fork/empresa-unica.md). Quem tem o
 * endereço antigo salvo cai na tela nova; `?ficha=<id>` (o link antigo da
 * ficha) cai na ficha.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ficha = (await searchParams).ficha;
  const id = Array.isArray(ficha) ? ficha[0] : ficha;
  redirect(id && /^[0-9a-f-]{36}$/i.test(id) ? `/app/companies/${id}` : "/app/companies");
}
