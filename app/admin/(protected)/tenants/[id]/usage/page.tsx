import { UsoDoTenant } from "@/components/admin/tenants/UsoDoTenant";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TenantUsagePage({ params }: Props) {
  const { id } = await params;
  return <UsoDoTenant organizationId={id} />;
}
