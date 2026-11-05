import { RaioXDaTime } from "@/components/raio-x/RaioXDaTime";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { listarRaioX } from "@/lib/raio-x/banco";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Raio-X do atendimento" };
export const dynamic = "force-dynamic";

/**
 * FORK MIA (.101) · /admin/raio-x (protótipo "Raio-X do atendimento", telas 1 e 2;
 * docs/fork/raio-x-do-atendimento.md). A Time cria o raio-X, manda o link para o
 * dono, ele conecta o WhatsApp comercial e o sistema lê as conversas. As
 * escritas pedem a verificação em duas etapas nas rotas.
 */
export default async function RaioXPage() {
  const { user } = await requirePlatformAdmin();
  const t = (s: string) => traduzir(s, normalizarIdioma((user.user_metadata?.locale as string | undefined) ?? null));
  const admin = createAdminClient();
  const [lista, empresas] = await Promise.all([
    listarRaioX(admin),
    admin.from("organizations").select("id, display_name, legal_name").order("display_name").limit(1000),
  ]);
  if (empresas.error) throw new Error(`raio-x: empresas ilegíveis (${empresas.error.code ?? "sem_codigo"})`);
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Raio-X do atendimento")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("A Time cria o raio-X, manda o link para o dono, ele conecta o WhatsApp comercial e o sistema lê as conversas do período. O relatório sai como rascunho e só vai para o dono depois da revisão da Time.")}
        </p>
      </header>
      <RaioXDaTime
        lista={lista}
        empresas={((empresas.data ?? []) as Array<{ id: string; display_name: string | null; legal_name: string | null }>).map((org) => ({
          id: org.id,
          nome: org.display_name || org.legal_name || org.id,
        }))}
      />
    </div>
  );
}
