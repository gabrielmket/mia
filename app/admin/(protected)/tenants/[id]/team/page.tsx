import { EquipeDoTenant } from "@/components/admin/tenants/EquipeDoTenant";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TenantTeamPage({ params }: Props) {
  const { id } = await params;
  return <EquipeDoTenant organizationId={id} />;
}
