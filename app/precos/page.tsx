import Link from "next/link";

import { marcaDaSaida } from "@/lib/branding/saida";
import { emailDeSuporte } from "@/lib/branding/saida";
import { provedorDaInstalacao } from "@/lib/cobranca/configuracao";
import { traduzir } from "@/lib/i18n/dicionario";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { tituloDaTelaPublica } from "@/lib/i18n/titulo-da-tela-publica";
import { logger } from "@/lib/logger";
import { MODULOS_DO_PLANO, ROTULO_DO_MODULO_DO_PLANO } from "@/lib/planos-mia/catalogo";
import { lerPlanosPublicos, type PlanoPublico } from "@/lib/planos-mia/publico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const generateMetadata = () => tituloDaTelaPublica((t) => t("Preços"));

/**
 * FORK MIA (.90) — A PÁGINA DE PREÇOS (protótipo de 25/10/2026, tela 1).
 *
 * O repositório não tem site: a raiz `iamia.com.br` é outro lugar. Esta página
 * mora no próprio sistema (`app.iamia.com.br/precos`), e é para ela que o site
 * aponta. Os cartões vêm da MESMA leitura da rota pública
 * (`lib/planos-mia/publico.ts`): só os planos oferecidos, nunca o dólar do teto
 * de IA, e "Começar teste grátis" leva ao cadastro com o plano marcado
 * (`/signup?plano=`). Mudou o plano no painel ou pelo MCP, a página muda junto:
 * nada de preço no código.
 */
const EM_TODOS_OS_PLANOS = [
  "Agente de IA no WhatsApp, 24 horas por dia",
  "CRM com funis, contatos e tarefas",
  "Agenda: o agente marca, remarca e confirma",
  "Follow-up com modelos por segmento",
  "Passagem para a equipe com a ficha do cliente",
  "Leads dos formulários da Meta e conversões",
  "Relatórios, painéis e o assistente",
] as const;

export default async function PrecosPage() {
  const idioma = await idiomaDoVisitante(null);
  const t = (s: string) => traduzir(s, idioma);
  const marca = await marcaDaSaida(null);
  const admin = createAdminClient();
  let leitura: Awaited<ReturnType<typeof lerPlanosPublicos>> | null = null;
  try {
    leitura = await lerPlanosPublicos(admin);
  } catch (erro) {
    logger.warn("[precos] leitura dos planos falhou", {
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
  }
  const [suporte, provedor] = await Promise.all([
    emailDeSuporte(),
    provedorDaInstalacao().catch(() => null),
  ]);
  const planos = leitura?.planos ?? [];
  const brl = new Intl.NumberFormat(idioma, {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
  const brlCentavos = new Intl.NumberFormat(idioma, { style: "currency", currency: "BRL" });
  const numero = new Intl.NumberFormat(idioma);
  const destaque = planos.find((p) => p.destaque) ?? planos.find((p) => p.padrao) ?? null;
  const diasDeTeste = (destaque ?? planos[0])?.trial_dias ?? 0;

  const linhas = (p: PlanoPublico): string[] => [
    p.numeros === null
      ? t("Números de WhatsApp sem limite")
      : p.numeros === 1
        ? t("1 número de WhatsApp")
        : t("Até {n} números de WhatsApp").replace("{n}", String(p.numeros)),
    p.pessoas === null
      ? t("Pessoas sem limite")
      : t("Até {n} pessoas na equipe").replace("{n}", String(p.pessoas)),
    p.conversas_estimadas === null
      ? t("Conversas com IA sem limite")
      : t("Cerca de {n} conversas atendidas pela IA por mês").replace(
          "{n}",
          numero.format(p.conversas_estimadas),
        ),
    t("Tudo do atendimento: agente, CRM, agenda, follow-up e relatórios"),
  ];

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            {marca.nome}
          </Link>
          <Link
            href="/login"
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            {t("Entrar")}
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl space-y-10 px-6 py-12">
        <section className="space-y-3 text-center">
          {diasDeTeste > 0 && (
            <p className="text-sm font-medium text-muted-foreground">
              {t("{n} dias grátis, sem cartão").replace("{n}", String(diasDeTeste))}
            </p>
          )}
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("Sua pré-vendedora digital no WhatsApp")}
          </h1>
          <p className="mx-auto max-w-2xl text-muted-foreground">
            {t(
              "Atende na hora, qualifica, marca na agenda e passa para a sua equipe quem está pronto para comprar. Você monta sozinho em 15 minutos.",
            )}
          </p>
        </section>

        {planos.length === 0 ? (
          <section
            className="mx-auto max-w-xl rounded-md border bg-background p-6 text-center"
            data-precos="vazio"
          >
            <p className="font-medium">
              {leitura === null
                ? t("Não conseguimos carregar os planos agora.")
                : t("Os planos estão sendo preparados.")}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {leitura === null
                ? t("Atualize a página em instantes.")
                : t("Fale com a nossa equipe para conhecer o sistema.")}
            </p>
            {suporte && (
              <p className="mt-3 text-sm">
                <a className="underline underline-offset-2" href={`mailto:${suporte}`}>
                  {suporte}
                </a>
              </p>
            )}
          </section>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-3" data-precos="planos">
              {planos.map((p) => (
                <article
                  key={p.id}
                  data-plano={p.slug}
                  className={`flex flex-col gap-4 rounded-md border bg-background p-6 ${p.destaque ? "border-primary" : ""}`}
                >
                  <div className="space-y-1">
                    {p.destaque && (
                      <p className="text-xs font-semibold text-primary uppercase">
                        {t("Mais escolhido")}
                      </p>
                    )}
                    <h2 className="text-lg font-semibold">{p.nome}</h2>
                    {p.frase && <p className="text-sm text-muted-foreground">{p.frase}</p>}
                  </div>
                  <p>
                    <span className="text-3xl font-semibold">
                      {brl.format(p.preco_cents / 100)}
                    </span>{" "}
                    <span className="text-sm text-muted-foreground">
                      {p.intervalo === "ano" ? t("por ano") : t("por mês")}
                    </span>
                  </p>
                  <ul className="space-y-1.5 text-sm">
                    {linhas(p).map((l) => (
                      <li key={l}>✓ {l}</li>
                    ))}
                    {p.modulos.map((m) => (
                      <li key={m.chave} className="font-medium">
                        ✓ {t(ROTULO_DO_MODULO_DO_PLANO[m.chave].rotulo)}
                        {m.chave === "disparador" && p.preco_por_mensagem_cents !== null
                          ? `, ${t("com mensagem a {preco}").replace("{preco}", brlCentavos.format(p.preco_por_mensagem_cents / 100))}`
                          : ""}
                      </li>
                    ))}
                    {p.modulos.length === 0 && (
                      <li className="text-muted-foreground">
                        – {t("Sem Broadcast e sem e-mail marketing")}
                      </li>
                    )}
                  </ul>
                  <div className="mt-auto space-y-2">
                    <Link
                      href={p.cadastro}
                      className={`block rounded-md px-4 py-2 text-center text-sm font-medium ${
                        p.destaque ? "bg-primary text-primary-foreground" : "border hover:bg-muted"
                      }`}
                    >
                      {p.trial_dias > 0 ? t("Começar teste grátis") : t("Assinar")}
                    </Link>
                    <p className="text-center text-xs text-muted-foreground">
                      {p.trial_dias > 0
                        ? t("{n} dias grátis, sem cartão.").replace("{n}", String(p.trial_dias))
                        : t("Entrada paga: começa quando o primeiro pagamento confirmar.")}
                    </p>
                  </div>
                </article>
              ))}
            </section>

            <details className="rounded-md border bg-background p-4" data-precos="comparacao">
              <summary className="cursor-pointer text-sm font-medium">
                {t("Comparar os planos")}
              </summary>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 pr-4 font-medium">{t("O que vem")}</th>
                      {planos.map((p) => (
                        <th key={p.id} className="py-2 pr-4 font-medium">
                          {p.nome}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="py-2 pr-4">{t("Números de WhatsApp")}</td>
                      {planos.map((p) => (
                        <td key={p.id} className="py-2 pr-4">
                          {p.numeros === null ? t("sem limite") : p.numeros}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 pr-4">{t("Pessoas na equipe")}</td>
                      {planos.map((p) => (
                        <td key={p.id} className="py-2 pr-4">
                          {p.pessoas === null ? t("sem limite") : p.pessoas}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 pr-4">{t("Conversas com IA por mês (cerca de)")}</td>
                      {planos.map((p) => (
                        <td key={p.id} className="py-2 pr-4">
                          {p.conversas_estimadas === null
                            ? t("sem limite")
                            : numero.format(p.conversas_estimadas)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 pr-4">{t("Teste grátis")}</td>
                      {planos.map((p) => (
                        <td key={p.id} className="py-2 pr-4">
                          {p.trial_dias > 0
                            ? t("{n} dias").replace("{n}", String(p.trial_dias))
                            : t("entrada paga")}
                        </td>
                      ))}
                    </tr>
                    {EM_TODOS_OS_PLANOS.map((_, i) => (
                      <tr key={EM_TODOS_OS_PLANOS[i]} className="border-b">
                        <td className="py-2 pr-4">{t(EM_TODOS_OS_PLANOS[i])}</td>
                        {planos.map((p) => (
                          <td key={p.id} className="py-2 pr-4">
                            ✓
                          </td>
                        ))}
                      </tr>
                    ))}
                    {MODULOS_DO_PLANO.map((m) => (
                      <tr key={m} className="border-b">
                        <td className="py-2 pr-4">
                          {t(ROTULO_DO_MODULO_DO_PLANO[m].rotulo)}
                          <span className="block text-xs text-muted-foreground">
                            {t(ROTULO_DO_MODULO_DO_PLANO[m].descricao)}
                          </span>
                        </td>
                        {planos.map((p) => (
                          <td key={p.id} className="py-2 pr-4">
                            {p.modulos.some((x) => x.chave === m) ? "✓" : t("não")}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <td className="py-2 pr-4">
                        {t("Mensagem do Broadcast")}
                        <span className="block text-xs text-muted-foreground">
                          {t("pré-paga, pelos créditos")}
                        </span>
                      </td>
                      {planos.map((p) => (
                        <td key={p.id} className="py-2 pr-4">
                          {p.preco_por_mensagem_cents === null
                            ? t("não")
                            : brlCentavos.format(p.preco_por_mensagem_cents / 100)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}

        <section className="flex flex-wrap items-center justify-between gap-4 rounded-md border bg-background p-6">
          <div>
            <p className="font-medium">{t("Prefere que a gente monte?")}</p>
            <p className="text-sm text-muted-foreground">
              {t(
                "A nossa equipe monta o agente, o funil e as integrações, com plano negociado e implantação à parte.",
              )}
            </p>
          </div>
          {suporte && (
            <a
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
              href={`mailto:${suporte}`}
            >
              {t("Falar com a equipe")}
            </a>
          )}
        </section>

        <section className="space-y-2" data-precos="perguntas">
          <details className="rounded-md border bg-background p-4">
            <summary className="cursor-pointer text-sm font-medium">{t("Como eu pago?")}</summary>
            <p className="mt-2 text-sm text-muted-foreground">
              {provedor === "stripe"
                ? t("No cartão, cobrado sozinho todo mês.")
                : t(
                    "Pix, boleto ou cartão, a cada fatura. A nota fiscal de serviço sai pelo Asaas, no CPF ou CNPJ de quem paga.",
                  )}
            </p>
          </details>
          <details className="rounded-md border bg-background p-4">
            <summary className="cursor-pointer text-sm font-medium">
              {t("O que acontece no fim do teste?")}
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              {t(
                "Três dias antes avisamos por e-mail. Se você não assinar, a conta é suspensa dois dias depois do fim do teste: a IA para de responder e nada do que você montou se perde. Assinou, volta na hora.",
              )}
            </p>
          </details>
          <details className="rounded-md border bg-background p-4">
            <summary className="cursor-pointer text-sm font-medium">
              {t("O que conta como conversa?")}
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              {t(
                "Uma pessoa atendida pela IA. O número do plano é uma estimativa: o plano tem um limite de uso da IA por mês, e avisamos quando chegar em 80%.",
              )}
            </p>
          </details>
          <details className="rounded-md border bg-background p-4">
            <summary className="cursor-pointer text-sm font-medium">
              {t("Posso trocar de plano?")}
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              {t(
                "Quando quiser. No teste, a troca vale na hora. Depois dele, para cima vale ao pagar a diferença dos dias que faltam; para baixo vale na próxima renovação.",
              )}
            </p>
          </details>
          <details className="rounded-md border bg-background p-4">
            <summary className="cursor-pointer text-sm font-medium">
              {t("Preciso de número oficial da Meta?")}
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">
              {t(
                "Não. Dá para começar pelo celular, lendo um QR Code. O número oficial também entra: você conecta com o Facebook e a nossa equipe liga o número à sua empresa em até 1 dia útil.",
              )}
            </p>
          </details>
        </section>
      </main>

      <footer className="border-t bg-background">
        <nav className="mx-auto flex w-full max-w-5xl flex-wrap gap-x-6 gap-y-2 px-6 py-4 text-sm">
          <Link href="/legal/privacy" className="underline underline-offset-2">
            {t("Política de Privacidade")}
          </Link>
          <Link href="/legal/terms" className="underline underline-offset-2">
            {t("Termos de Uso")}
          </Link>
        </nav>
      </footer>
    </div>
  );
}
