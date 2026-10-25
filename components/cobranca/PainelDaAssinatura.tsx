import { Card } from "@/components/ui/card";
import type { DadosDoPainel } from "@/lib/cobranca/painel";
import { formatadorDeData } from "@/lib/cobranca/fuso";
import { ROTULO_DO_ESTADO } from "@/lib/cobranca/rotulos";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
// FORK MIA (.90): o uso de IA em % do incluído, nunca dólar (lib/ai/custo-e-da-plataforma.ts).
import { AVISO_DA_IA_EM_PERCENTUAL, conversasEstimadas, percentualDaIa } from "@/lib/planos-mia/catalogo";

/**
 * O resumo de assinatura da empresa (spec da cobrança §9).
 * Sem hooks: é desenhado pelo servidor, no idioma de quem abriu.
 */
export function PainelDaAssinatura({ dados, idioma }: { dados: DadosDoPainel; idioma: Idioma }) {
  const t = (texto: string) => traduzir(texto, idioma);
  const data = formatadorDeData(idioma, dados.fuso, { dateStyle: "short" });
  const brl = new Intl.NumberFormat(idioma, { style: "currency", currency: "BRL" });
  // "2 de 3"; sem teto, "2 · sem limite" (e não "2 de sem limite").
  const deLimite = (usados: string, limite: string | null) =>
    limite === null
      ? `${usados} · ${t("sem limite")}`
      : t("{usados} de {limite}").replace("{usados}", usados).replace("{limite}", limite);
  const limite = (n: number | null) => (n === null ? null : String(n));

  if (!dados.assinatura || !dados.plano) {
    return (
      <Card className="max-w-xl p-6">
        <h2 className="text-sm font-semibold">{t("Seu plano")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("Sua empresa não tem plano de cobrança: não paga e não tem limites.")}
        </p>
      </Card>
    );
  }

  const { assinatura: a, plano: p, uso } = dados;
  const dia = (v: string | null) => (v ? data.format(new Date(v)) : "");
  const situacao = situacaoDaAssinatura(a, t, dia);
  const pctIa = percentualDaIa(dados.gastoIaUsdCents, p.teto_ia_usd_cents);

  return (
    <Card className="max-w-xl space-y-4 p-6">
      <div className="space-y-0.5">
        <h2 className="text-sm font-semibold">
          {t("Seu plano")}: {p.nome}
        </h2>
        <p className="text-sm text-muted-foreground">
          {brl.format(p.preco_cents / 100)} {p.intervalo === "mes" ? t("por mês") : t("por ano")}
        </p>
      </div>
      <p className="text-sm font-medium">{situacao}</p>
      {a.plano_agendado && (
        <p className="text-sm">
          {t("Novo plano a partir de")} {dia(a.proximo_vencimento)}: {a.plano_agendado.nome}
        </p>
      )}
      {a.modo === "teste" && <p className="text-xs text-warning-fg">{t("Modo de teste: nenhum pagamento aqui é real.")}</p>}
      {a.prazo_extra_ate && (
        <p className="text-sm">
          {t("Prazo extra até")} {data.format(new Date(a.prazo_extra_ate))}
        </p>
      )}
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        <dt>{t("Pessoas")}</dt>
        <dd data-uso="assentos">{deLimite(String(uso.assentos), limite(p.max_assentos))}</dd>
        <dt>{t("Números conectados")}</dt>
        <dd data-uso="canais">{deLimite(String(uso.canais), limite(p.max_canais))}</dd>
        <dt>{t("Uso de IA no mês")}</dt>
        {/* FORK MIA (.90): porcentagem do que o plano inclui; o dólar é da plataforma. */}
        <dd data-uso="ia">
          {pctIa === null ? t("sem limite") : t("{pct}% do incluído").replace("{pct}", String(pctIa))}
        </dd>
      </dl>
      {/* FORK MIA (.90): o aviso em 80% e a parada em 100% (a rodada e o motor do upstream). */}
      {pctIa !== null && (
        <p className="text-xs text-muted-foreground" data-uso-ia="conversas">
          {t("Cerca de {n} conversas por mês. Aviso em 80%.").replace("{n}", new Intl.NumberFormat(idioma).format(conversasEstimadas(p.teto_ia_usd_cents) ?? 0))}
        </p>
      )}
      {pctIa !== null && pctIa >= 100 ? (
        <p className="rounded-md border bg-error-bg p-3 text-sm text-error-fg" role="alert" data-uso-ia="parou">
          {t("A IA parou: o plano chegou ao limite do mês. As conversas novas estão na fila da equipe; nada se perdeu. Volta na virada do mês ou ao subir de plano.")}
        </p>
      ) : pctIa !== null && pctIa >= AVISO_DA_IA_EM_PERCENTUAL ? (
        <p className="rounded-md border bg-warning-bg p-3 text-sm text-warning-fg" role="status" data-uso-ia="aviso">
          {t("Você usou {pct}% da IA incluída no mês. Em 100%, a IA para até o mês virar e as conversas novas vão para a equipe. Subir de plano vale na hora.").replace("{pct}", String(pctIa))}
        </p>
      ) : null}
    </Card>
  );
}

/** A situação em linguagem simples (spec §9). Uma função, para a tela e o hub dizerem a mesma coisa. */
function situacaoDaAssinatura(
  a: NonNullable<DadosDoPainel["assinatura"]>,
  t: (texto: string) => string,
  dia: (v: string | null) => string,
): string {
  if (a.pagamento_inicial_pendente) return t("Aguardando o primeiro pagamento. O acesso será liberado após a confirmação.");
  switch (a.estado) {
    case "trial":
      if (!a.trial_ate) return t(ROTULO_DO_ESTADO.trial);
      return `${t("Teste grátis até")} ${dia(a.trial_ate)}${a.assinaturas_vivas > 0 ? ` · ${t("1ª cobrança agendada")}` : ""}`;
    case "ativa":
      return a.cancela_no_fim && a.proximo_vencimento ? `${t("Cancelada, acesso até")} ${dia(a.proximo_vencimento)}` : t(ROTULO_DO_ESTADO.ativa);
    case "em_atraso":
      return a.vencida_desde ? `${t("Em atraso desde")} ${dia(a.vencida_desde)}` : t(ROTULO_DO_ESTADO.em_atraso);
    case "cancelada":
      return a.proximo_vencimento && Date.parse(a.proximo_vencimento) > Date.now()
        ? `${t("Cancelada, acesso até")} ${dia(a.proximo_vencimento)}`
        : t(ROTULO_DO_ESTADO.cancelada);
  }
}
