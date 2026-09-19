import { Card } from "@/components/ui/card";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { loadAuthUser } from "@/lib/auth/server";
import { CARIMBO_DO_SCHEMA, TABELA_DO_CARIMBO } from "@/lib/schema/carimbo";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * "O BANCO VEIO JUNTO?" — a resposta, para quem opera, sem segredo nenhum.
 *
 * ── Por que esta tela existe, e não só o `/api/v1/health` ─────────────────
 *
 * A rota de saúde já responde `schema.em_dia`, e é o que um monitor externo
 * consome. Mas o DIAGNÓSTICO — qual migration o banco tem, e a mensagem do erro
 * quando houve um — só sai com `?verbose=1` mais o segredo interno dos crons.
 * Isso é certo para uma rota pública: mensagem de erro de Postgres carrega nome
 * de tabela, de coluna e às vezes o valor que violou a constraint.
 *
 * O efeito colateral é que a informação ficava fora do alcance de quem
 * implanta: ver o que deu errado exigia ter o segredo à mão e montar um curl.
 * Aqui o gate já é o do admin de plataforma (o layout de `(protected)` roda
 * `requirePlatformAdmin`), e a mesma informação aparece sem ninguém digitar
 * segredo em lugar nenhum.
 *
 * ── Por que ela não "some quando está tudo bem" ───────────────────────────
 *
 * Um cartão que só aparece no erro ensina a não procurá-lo, e some junto com a
 * capacidade de responder "e quando foi o último deploy que pegou?". O estado
 * bom é uma linha discreta; o ruim ocupa espaço.
 */
export async function SaudeDoSchema() {
  const usuario = await loadAuthUser();
  const idioma = normalizarIdioma(usuario?.locale ?? null);
  const t = (texto: string) => traduzir(texto, idioma);

  const { data, error } = await createAdminClient()
    .from(TABELA_DO_CARIMBO)
    .select("migration_mais_nova, aplicado_em, erros_inesperados, erros_amostra")
    .eq("id", 1)
    .maybeSingle();

  // Falha de leitura NÃO vira "está tudo bem": é exatamente o caso em que o
  // baseline pode não ter passado. E não vira erro vermelho também — não
  // sabemos, e dizer que sabemos é o defeito que este cartão veio consertar.
  if (error || !data) {
    return (
      <Card className="space-y-1 p-4">
        <h2 className="text-sm font-semibold">{t("Estado do schema")}</h2>
        <p className="text-xs text-text-muted">
          {t(
            "Não consegui ler o carimbo do schema. Num banco que ainda não recebeu a migration 0268 isso é esperado; em qualquer outro caso, é sinal de que o baseline não chegou ao fim.",
          )}
        </p>
      </Card>
    );
  }

  const linha = data as {
    migration_mais_nova: string | null;
    aplicado_em: string | null;
    erros_inesperados: number | null;
    erros_amostra: string | null;
  };

  const erros = linha.erros_inesperados ?? 0;
  const carimboBate = linha.migration_mais_nova === CARIMBO_DO_SCHEMA;
  const emDia = carimboBate && erros === 0;

  // Fuso fixo pelo mesmo motivo do alarme da marca: a coluna é da INSTALAÇÃO,
  // e nesta tela não há organização resolvida de onde tirar um.
  const quando = linha.aplicado_em
    ? new Date(linha.aplicado_em).toLocaleString(idioma === "es" ? "es" : "pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      })
    : null;

  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("Estado do schema")}</h2>
        <span
          className={
            emDia
              ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400"
              : "rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-300"
          }
        >
          {emDia ? t("em dia") : t("precisa de atenção")}
        </span>
      </div>

      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-text-muted">{t("O banco recebeu")}</dt>
          <dd className="font-mono">{linha.migration_mais_nova ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-text-muted">{t("Esta versão espera")}</dt>
          <dd className="font-mono">{CARIMBO_DO_SCHEMA}</dd>
        </div>
        {quando ? (
          <div>
            <dt className="text-text-muted">{t("Carimbado em")}</dt>
            <dd>{quando}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-text-muted">{t("Erros ao aplicar")}</dt>
          <dd>{erros}</dd>
        </div>
      </dl>

      {!carimboBate ? (
        <p className="text-xs text-text-muted">
          {t(
            "O banco está numa entrega diferente da desta versão do sistema. Ou o baseline não passou no último deploy, ou a imagem no ar é outra — as duas linhas acima dizem qual das duas.",
          )}
        </p>
      ) : null}

      {erros > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-text-muted">
            {t(
              "O baseline chegou ao fim, mas o Postgres recusou pelo menos um comando pelo caminho. Num banco que já existe isso não derruba o sistema — e é por isso que passava despercebido. As primeiras linhas:",
            )}
          </p>
          {/*
            `whitespace-pre-wrap` e fonte mono: é saída de máquina, e reformatá-la
            esconde qual linha do baseline falhou. `break-all` porque mensagem de
            Postgres traz nomes longos sem espaço.
          */}
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-surface-2 p-2 font-mono text-[11px]">
            {linha.erros_amostra ?? t("(sem amostra gravada)")}
          </pre>
        </div>
      ) : null}
    </Card>
  );
}
