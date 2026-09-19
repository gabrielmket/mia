import type { ReactNode } from "react";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CaretLeft } from "@/lib/ui/icons";
import { TabNav } from "./_tab-nav";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

// ---------------------------------------------------------------------------
// Status badge helpers (same palette as TenantsTable)
// ---------------------------------------------------------------------------

const STATUS_VARIANTS: Record<
  string,
  "success" | "info" | "warning" | "error" | "neutral"
> = {
  active: "success",
  onboarding: "info",
  suspended: "warning",
  redacted: "error",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  onboarding: "Onboarding",
  suspended: "Suspenso",
  redacted: "Redigido",
};

// ---------------------------------------------------------------------------
// Sub-nav tabs definition
// ---------------------------------------------------------------------------

interface TabItem {
  label: string;
  href: string;
  disabled: boolean;
}

const TABS: TabItem[] = [
  { label: "Visão Geral", href: "", disabled: false },
  { label: "Saúde", href: "/health", disabled: false },
  // Dinheiro do cliente: crédito, preço acordado e extrato. Fica aqui, e não
  // no painel dele, porque recarregar e precificar são decisões de negócio.
  { label: "Carteira", href: "/carteira", disabled: false },
  // O que este cliente comprou. Vizinha da Carteira de propósito: liberar um
  // módulo e acertar o preço dele são a mesma conversa.
  { label: "Módulos", href: "/modulos", disabled: false },
  // Quem tem acesso a esta conta, com que papel, e se o convite foi aceito. É
  // o que se confere primeiro quando o cliente diz "ninguém está vendo as
  // conversas" — e ficou `disabled` tempo demais prometendo essa resposta.
  { label: "Equipe", href: "/team", disabled: false },
  // O que ESTE cliente consumiu, e quanto custa para servir — os dois lados
  // (IA e mensagem) na mesma tela. É a conversa de renovação e de reajuste.
  { label: "Uso", href: "/usage", disabled: false },
];

// ---------------------------------------------------------------------------
// Layout (Server Component — requirePlatformAdmin already handled by outer
// (protected) layout, but we call it here for the org load context)
// ---------------------------------------------------------------------------

interface TenantLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function TenantDetailLayout({
  children,
  params,
}: TenantLayoutProps) {
  // Auth check — outer (protected)/layout.tsx already guards, but we need
  // org data server-side for the header. requirePlatformAdmin is cheap (cached).
  const { user } = await requirePlatformAdmin();
  const idioma = normalizarIdioma((user.user_metadata?.locale as string | undefined) ?? null);

  const { id } = await params;
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("id, slug, display_name, status")
    .eq("id", id)
    .single();

  const basePath = `/admin/tenants/${id}`;

  return (
    <div className="space-y-6">
      {/* Back nav */}
      <Link
        href="/admin/tenants"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <CaretLeft size={14} aria-hidden />
        {traduzir("Tenants", idioma)}
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {org?.display_name ?? id}
          </h1>
          {org?.slug && (
            <code className="rounded-md bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">
              {org.slug}
            </code>
          )}
          {org?.status && (
            <Badge variant={STATUS_VARIANTS[org.status] ?? "neutral"}>
              {traduzir(STATUS_LABELS[org.status] ?? org.status, idioma)}
            </Badge>
          )}
        </div>
      </div>

      {/* Sub-nav */}
      <TabNav basePath={basePath} tabs={TABS} />

      <Separator className="hidden" />

      {children}
    </div>
  );
}
