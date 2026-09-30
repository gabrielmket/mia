/**
 * Configurações → Meta Ads. Onde o token de LEITURA da conta de anúncios é
 * conectado.
 *
 * ─── FORK MIA (.61): duas abas, tudo da Meta num lugar só ──────────────────
 *
 *   · "Contas de anúncio" (padrão): o token e a conta padrão, como sempre foi;
 *   · "Formulários de leads" (`?aba=formularios`): a importação dos leads dos
 *     formulários de cadastro instantâneo, que até a .60 era a tela própria
 *     Configurações › Formulários da Meta. O endereço antigo redireciona para cá.
 *
 * As duas usam o MESMO token (a importação lê as Páginas com ele), e ter dois
 * itens no menu fazia a empresa procurar o token num e os formulários no outro.
 * Abas pela URL, no molde de Configurações › Conversões: dá para mandar o link
 * direto da aba, e a aba que não está aberta não paga a leitura dela.
 *
 * ─── Por que uma tela separada de Configurações › Conversões ────────────────
 *
 * As duas conectam "a Meta", e juntá-las é tentador. São credenciais
 * diferentes, com escopos diferentes na plataforma (uma escreve conversões, a
 * outra lê `ads_read`), guardadas em tabelas diferentes pelas razões no
 * cabeçalho da migration 0214 — e com consequências diferentes quando falham:
 * um token de leitura vencido deixa uma tela vazia; o de conversões vencido faz
 * a empresa parar de reportar vendas sem ninguém perceber.
 *
 * Uma tela só, com dois campos de token que se parecem, é como alguém cola o
 * token errado no campo errado e passa uma semana achando que a integração
 * quebrou.
 *
 * ─── Por que ADMIN CLIENT para ler ──────────────────────────────────────────
 *
 * `ad_insights_connections` tem RLS ligada com ZERO policies e grants revogados
 * de anon/authenticated (0214). Pelo client de sessão esta página mostraria
 * "não conectado" para todo mundo — o gate de papel abaixo é o que autoriza, e a
 * leitura privilegiada acontece no servidor.
 *
 * O token NÃO é lido aqui, nem decifrado: `existeConexaoDeLeitura` responde
 * apenas se a linha existe. A tela nunca mostra o token de volta.
 */
import { redirect } from "next/navigation";

import { leadsDaMetaLiberados } from "@/lib/leads-da-meta/liberacao";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { existeConexaoDeLeitura } from "@/lib/plataformas-de-anuncio/credenciais-de-leitura";
import { createAdminClient } from "@/lib/supabase/admin";

import { FormularioDeMetaAds } from "./_form";
import { LeadsDaMetaClient } from "./_formularios";

/** As abas. "contas" é a padrão (sem `?aba=`). */
type AbaDeMetaAds = "contas" | "formularios";

export const metadata = { title: "Meta Ads" };
export const dynamic = "force-dynamic";

export default async function MetaAdsSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const parametros = (await searchParams) ?? {};
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  // Mesmo gate de `settings/conversoes`: o objeto é uma credencial da conta de
  // anúncios da empresa, ao lado de billing e API tokens na mesma prancheta.
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }

  const admin = createAdminClient();
  // A aba dos formulários só existe para quem pode usar a importação (vira
  // módulo vendável por `lib/leads-da-meta/modulo.ts`).
  const comFormularios = await leadsDaMetaLiberados(admin, activeOrg.orgId);
  const aba: AbaDeMetaAds =
    parametros.aba === "formularios" && comFormularios ? "formularios" : "contas";

  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  const barra = comFormularios ? (
    <nav className="flex gap-1 border-b" aria-label={t("Seções de Meta Ads")}>
      {(
        [
          ["contas", t("Contas de anúncio")],
          ["formularios", t("Formulários de leads")],
        ] as const
      ).map(([chave, rotulo]) => (
        <a
          key={chave}
          href={chave === "contas" ? "?" : `?aba=${chave}`}
          aria-current={aba === chave ? "page" : undefined}
          className={
            aba === chave
              ? "-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium"
              : "px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          }
        >
          {rotulo}
        </a>
      ))}
    </nav>
  ) : null;

  if (aba === "formularios") {
    return (
      <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Meta Ads")}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t(
              "Os leads dos anúncios de cadastro instantâneo (o formulário que abre dentro do Facebook e do Instagram) entram sozinhos no funil, em segundos pelo aviso da Meta ou em até 5 minutos pela leitura, com a origem do anúncio e as respostas do formulário. As automações de lead criado disparam como em qualquer captação.",
            )}
          </p>
        </header>
        {barra}
        <LeadsDaMetaClient />
      </div>
    );
  }

  const conexao = await existeConexaoDeLeitura(admin, activeOrg.orgId, "meta_ads");

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Meta Ads")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t(
            "Conecte um token de acesso para o sistema ler o desempenho das suas campanhas e mostrá-lo em Análise › Meta Ads. É uma conexão só de leitura: nada é criado, pausado ou alterado na sua conta de anúncios.",
          )}
        </p>
      </header>

      {barra}

      <div className="rounded-md border border-sky-500/40 bg-sky-500/10 p-4 text-sm">
        {/*
          A permissão exata está escrita aqui porque é o erro nº 1 desta
          integração: um token gerado sem `ads_read` conecta, salva, e só falha
          na hora de abrir a tabela — longe daqui, com uma mensagem que parece
          problema de outra coisa.
        */}
        {t(
          "O token precisa da permissão ads_read. Gere-o no Meta for Developers, na sua conta de aplicativo, e cole abaixo — ele fica guardado criptografado e nunca é mostrado de volta.",
        )}
      </div>

      <FormularioDeMetaAds
        conectada={conexao.conectada}
        contaPadrao={conexao.contaPadrao}
        idioma={idioma}
      />

      {conexao.conectada && (
        <p className="text-sm text-muted-foreground">
          {t(
            "Para trocar apenas a conta padrão, deixe o campo do token em branco — o token guardado é mantido.",
          )}
        </p>
      )}
    </div>
  );
}
