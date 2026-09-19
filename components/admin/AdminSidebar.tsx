"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Gauge,
  ChatsCircle,
  Brain,
  Buildings,
  ClipboardText,
  Scales,
  Warning,
  ChartBar,
  Users,
  ShieldCheck,
  CalendarBlank,
  Megaphone,
  Palette,
  Receipt,
  PlugsConnected,
  ArrowRight,
} from "@/lib/ui/icons";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { SimboloDoProduto } from "@/components/branding/MarcaDoProduto";
import { marcaEhADoProduto } from "@/lib/branding";
import { useMarcaDaInstalacao } from "@/lib/branding/contexto";
import { useT } from "@/hooks/i18n/useT";

interface NavItem {
  href: string;
  label: string;
  icon: PhosphorIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/admin/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/admin/inbox", label: "Inbox", icon: ChatsCircle },
  { href: "/admin/tenants", label: "Tenants", icon: Buildings },
  { href: "/admin/audit", label: "Audit", icon: ClipboardText },
  { href: "/admin/lgpd", label: "LGPD", icon: Scales },
  { href: "/admin/incidents", label: "Incidents", icon: Warning },
  { href: "/admin/usage", label: "Usage", icon: ChartBar },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/platform-admins", label: "Platform Admins", icon: ShieldCheck },
  // Onde se emite a credencial que administra a instalacao inteira pelo MCP
  // (item E6). Fica ao lado de Platform Admins de proposito: sao as duas
  // portas por onde alguem passa a poder mexer em TODOS os clientes, e quem
  // audita acesso de plataforma precisa achar as duas no mesmo lugar.
  { href: "/admin/tokens-de-plataforma", label: "Tokens de plataforma", icon: ShieldCheck },
  // A porta da tela de marca. Ela NÃO entra em `lib/navigation/registry.ts`:
  // aquele registro descreve a navegação do tenant (`app/app/**`) e o teste de
  // completude que o vigia varre só aquela raiz. O admin de plataforma tem
  // navegação própria, e é esta lista.
  { href: "/admin/marca", label: "Marca", icon: Palette },
  // A porta da tela do app OAuth do Google — mesma razão da de cima: é
  // configuração da INSTALAÇÃO, e /admin tem navegação própria.
  { href: "/admin/google", label: "Google Agenda", icon: CalendarBlank },
  // O número da plataforma que avisa os grupos dos clientes. Mesma razão das
  // duas de cima: é configuração da INSTALAÇÃO, não de um tenant — o número é
  // um só para todos, e quem o conecta é quem opera.
  { href: "/admin/numero-de-avisos", label: "Avisos no grupo", icon: Megaphone },
  // O cérebro padrão da instalação. Configuração NOSSA, como a chave de IA:
  // o cliente não escolhe modelo, nem deveria precisar saber que existe um.
  { href: "/admin/modelo-de-ia", label: "Modelo de IA", icon: Brain },
  // A porta em que o cliente entra com o Facebook dele. Configuração da
  // INSTALAÇÃO: o link é um só, e as contas que chegam ainda não são de
  // ninguém até alguém amarrar.
  { href: "/admin/cadastro-incorporado", label: "Cadastro incorporado", icon: PlugsConnected },
  // Cada linha desta tela é um lead que escreveu e não foi respondido. Fica no
  // painel da plataforma porque a causa é quase sempre uma só para vários
  // clientes — rate limit, chave expirada, número caído.
  { href: "/admin/fila-morta", label: "Trabalho parado", icon: Warning },
  // O preço de CUSTO do que o cliente comprou — fica aqui pelo mesmo motivo
  // do custo de IA: mostrar ao cliente seria mostrar a margem.
  { href: "/admin/custo-da-meta", label: "Custo das mensagens", icon: Receipt },
];

interface AdminSidebarProps {
  userEmail: string;
  /** "mobile" = conteúdo desta MESMA navegação dentro do drawer que `AdminShell`
   * abre abaixo de `lg` — mesmo padrão de `components/shell/Sidebar.tsx`. */
  variant?: "desktop" | "mobile";
}

export function AdminSidebar({ userEmail, variant = "desktop" }: AdminSidebarProps) {
  const t = useT();
  const isMobile = variant === "mobile";
  const pathname = usePathname();
  // Por PROP do servidor, e nunca `branding()`: aquela função lê fontes
  // diferentes nos dois lados da fronteira (`window.__PUBLIC_ENV__` no
  // navegador, `process.env` no servidor), e desde que o layout raiz passou a
  // injetar a marca do BANCO as duas divergem — o nome renderizado no SSR não
  // batia com o hidratado, que é hydration mismatch. Ver `lib/branding/contexto.tsx`.
  const marca = useMarcaDaInstalacao();

  return (
    <aside
      className={cn(
        "flex flex-col border-r bg-card",
        isMobile ? "h-full w-full" : "hidden w-60 shrink-0 lg:flex",
      )}
    >
      <div className="flex h-14 items-center gap-3 border-b px-4">
        {/* O nome já está escrito ao lado — o símbolo é reforço, não legenda. */}
        {marcaEhADoProduto(marca) && (
          <SimboloDoProduto nome={marca.name} decorativo className="h-8 w-8" />
        )}
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {marca.name}
          </span>
          <span className="text-sm font-semibold tracking-tight">{t("Admin Plataforma")}</span>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-2" aria-label={t("Navegação plataforma")}>
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <Icon size={18} weight={isActive ? "fill" : "regular"} aria-hidden />
              <span className="truncate">{t(item.label)}</span>
            </Link>
          );
        })}
      </nav>
      <div className="space-y-2 border-t p-3">
        <Link
          href="/app"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <ArrowRight size={14} aria-hidden />
          <span>{t("Voltar pra app")}</span>
        </Link>
        <p className="truncate px-2 text-xs text-muted-foreground" title={userEmail}>
          {userEmail}
        </p>
      </div>
    </aside>
  );
}
