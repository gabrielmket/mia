import { DashboardClient } from "./_client";
import { SaudeDoSchema } from "./_saude-do-schema";

export const metadata = { title: "Dashboard — Admin Plataforma" };

/**
 * `force-dynamic` por causa do cartão do schema: ele lê o carimbo do banco a
 * cada visita, e é exatamente depois de um deploy que alguém abre esta tela.
 * Uma resposta em cache responderia sobre a entrega anterior.
 */
export const dynamic = "force-dynamic";

export default function AdminDashboardPage() {
  return (
    <div className="space-y-4">
      {/*
        O estado do schema vem PRIMEIRO, e é deliberado: é a pergunta de quem
        acabou de implantar ("o banco veio junto?"), e ela tem resposta de dez
        segundos. O resto do painel é acompanhamento, não diagnóstico.
      */}
      <SaudeDoSchema />
      <DashboardClient />
    </div>
  );
}
