/**
 * FORK MIA — a aba "Histórico de envios" de Configurações › Conversões, para a
 * Meta e o Google: tudo o que o sistema informou, tentou informar ou decidiu
 * não informar, com o motivo.
 *
 * Ao lado de `_historico.tsx` (do upstream), que a página não usa mais: o dele
 * junta todo "não enviado" numa situação, não conhece os eventos de etapa da
 * Meta e oferece o reenvio em toda linha. Aqui a situação vem separada pelo
 * motivo, o "Reenviar" só aparece onde resolve, e o nome do negócio abre o
 * cartão dele.
 *
 * Server Component, como o do upstream: os filtros são um formulário GET (a URL
 * é o estado, dá para voltar, recarregar e mandar o link).
 */
import { MOTIVO_LEGIVEL } from "@/lib/conversoes/estado-da-conexao";
import { PERIODOS, rotuloDoEvento, TAMANHO_DA_PAGINA } from "@/lib/conversoes/historico";
import type { RegraDeConversaoGoogle } from "@/lib/conversoes/regras-google";
import {
  chaveDoEventoNoLivro,
  eventoDaMeta,
  eventoNoLivro,
  EVENTOS_DA_META,
  rotuloDoEventoDaMetaNoLivro,
} from "@/lib/conversoes-meta/eventos";
import type { FiltrosDoHistoricoDeEnvios, LinhaDoHistoricoDeEnvios } from "@/lib/conversoes-meta/historico";
import {
  MOTIVO_DA_META_LEGIVEL,
  ROTULO_DA_SITUACAO,
  SITUACOES_DE_ENVIO,
  type SituacaoDeEnvio,
} from "@/lib/conversoes-meta/situacao";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { formatCents } from "@/lib/money";

import { ReenviarEnvio } from "./_reenviarEnvio";

const ROTULO_DO_PERIODO: Record<(typeof PERIODOS)[number], string> = {
  hoje: "Hoje",
  "24h": "Últimas 24h",
  "7d": "7 dias",
  "30d": "30 dias",
  tudo: "Todo o período",
};

const ESTILO_DA_SITUACAO: Record<SituacaoDeEnvio, string> = {
  enviado: "border-emerald-500/40 bg-emerald-500/10",
  aguardando: "border-sky-500/40 bg-sky-500/10",
  recusado: "border-destructive/40 bg-destructive/10",
  sem_clique: "border-border bg-muted/50",
  sem_valor: "border-amber-500/40 bg-amber-500/10",
  anterior_a_regra: "border-border bg-muted/50",
  conexao: "border-amber-500/40 bg-amber-500/10",
};

const PLATAFORMA: Record<string, string> = { meta_ads: "Meta", google_ads: "Google Ads" };

export function HistoricoDeEnviosDasPlataformas({
  linhas,
  total,
  filtros,
  regrasGoogle,
  idioma,
}: {
  linhas: LinhaDoHistoricoDeEnvios[];
  total: number;
  filtros: FiltrosDoHistoricoDeEnvios;
  /** As regras do Google dão o nome que a pessoa deu a cada evento de etapa dele. */
  regrasGoogle: RegraDeConversaoGoogle[];
  idioma: Idioma;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const paginas = Math.max(1, Math.ceil(total / TAMANHO_DA_PAGINA));
  const comFiltro =
    filtros.plataforma !== "" ||
    filtros.evento !== "" ||
    filtros.situacao !== "todas" ||
    filtros.periodo !== "30d" ||
    filtros.busca !== "";

  const link = (pagina: number) => {
    const p = new URLSearchParams({
      aba: "historico",
      periodo: filtros.periodo,
      situacao: filtros.situacao,
      ...(filtros.evento ? { evento: filtros.evento } : {}),
      ...(filtros.plataforma ? { plataforma: filtros.plataforma } : {}),
      ...(filtros.busca ? { busca: filtros.busca } : {}),
      pagina: String(pagina),
    });
    return `?${p.toString()}`;
  };

  /** O nome do evento como a pessoa o reconhece, nas duas plataformas. */
  const nomeDoEvento = (evento: string) => t(rotuloDoEventoDaMetaNoLivro(evento) ?? rotuloDoEvento(evento, regrasGoogle));

  const nomeTecnico = (evento: string): string | null => {
    if (evento === "Purchase") return "Purchase";
    const chave = chaveDoEventoNoLivro(evento);
    return chave ? eventoDaMeta(chave).nomeTecnico : null;
  };

  const data = (iso: string) =>
    new Date(iso).toLocaleString(idioma, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <section className="flex flex-col gap-4" data-testid="historico-de-envios">
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-md border p-4">
        <input type="hidden" name="aba" value="historico" />
        <label className="flex flex-col gap-1 text-xs">
          {t("Plataforma")}
          <select
            name="plataforma"
            defaultValue={filtros.plataforma}
            className="rounded-md border bg-background p-2 text-sm"
          >
            <option value="">{t("Todas")}</option>
            <option value="meta_ads">Meta</option>
            <option value="google_ads">Google Ads</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          {t("Evento")}
          <select name="evento" defaultValue={filtros.evento} className="rounded-md border bg-background p-2 text-sm">
            <option value="">{t("Todos os eventos")}</option>
            <option value="Purchase">{t("Compra")}</option>
            <optgroup label="Meta">
              {EVENTOS_DA_META.map((e) => (
                <option key={e.chave} value={eventoNoLivro(e.chave)}>
                  {t(e.rotulo)}
                </option>
              ))}
            </optgroup>
            {regrasGoogle.length > 0 && (
              <optgroup label="Google Ads">
                {regrasGoogle.map((r) => (
                  <option key={r.eventName} value={r.eventName}>
                    {r.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          {t("Situação")}
          <select
            name="situacao"
            defaultValue={filtros.situacao}
            className="rounded-md border bg-background p-2 text-sm"
          >
            <option value="todas">{t("Todas as situações")}</option>
            {SITUACOES_DE_ENVIO.map((s) => (
              <option key={s} value={s}>
                {t(ROTULO_DA_SITUACAO[s])}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          {t("Período")}
          <select name="periodo" defaultValue={filtros.periodo} className="rounded-md border bg-background p-2 text-sm">
            {PERIODOS.map((p) => (
              <option key={p} value={p}>
                {t(ROTULO_DO_PERIODO[p])}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">
          {t("Buscar por negócio")}
          <input
            name="busca"
            defaultValue={filtros.busca}
            placeholder={t("Nome do negócio")}
            className="rounded-md border bg-background p-2 text-sm"
          />
        </label>
        <button type="submit" className="rounded-md border bg-primary px-4 py-2 text-sm text-primary-foreground">
          {t("Filtrar")}
        </button>
        {comFiltro && (
          <a href="?aba=historico" className="px-2 py-2 text-sm underline underline-offset-2">
            {t("Limpar filtros")}
          </a>
        )}
      </form>

      <p className="text-sm text-muted-foreground" data-testid="historico-total">
        {total} {t(total === 1 ? "envio" : "envios")} · {t("do mais recente para o mais antigo")}
      </p>

      {linhas.length === 0 ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">{t("Nenhum envio com estes filtros.")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium">{t("Negócio")}</th>
                <th className="p-3 font-medium">{t("Evento")}</th>
                <th className="p-3 font-medium">{t("Plataforma")}</th>
                <th className="p-3 font-medium">{t("Aconteceu em")}</th>
                <th className="p-3 font-medium">{t("Enviado em")}</th>
                <th className="p-3 font-medium">{t("Situação")}</th>
                <th className="p-3 font-medium">{t("Ação")}</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const tecnico = nomeTecnico(l.evento);
                const motivo = l.motivo ? (MOTIVO_DA_META_LEGIVEL[l.motivo] ?? MOTIVO_LEGIVEL[l.motivo] ?? null) : null;
                return (
                  <tr key={l.id} className="border-t align-top" data-situacao={l.situacao} data-evento={l.evento}>
                    <td className="p-3">
                      <a className="font-medium underline underline-offset-2" href={`/app/leads/${l.leadId}`}>
                        {l.tituloDoLead ?? t("(sem título)")}
                      </a>
                    </td>
                    <td className="p-3">
                      {nomeDoEvento(l.evento)}
                      {l.valorCentavos !== null && l.valorCentavos > 0
                        ? ` · ${formatCents(l.valorCentavos, l.moeda ?? "BRL")}`
                        : ""}
                      {tecnico && <span className="block font-mono text-xs text-muted-foreground">{tecnico}</span>}
                    </td>
                    <td className="p-3 whitespace-nowrap">{PLATAFORMA[l.plataforma] ?? l.plataforma}</td>
                    <td className="p-3 whitespace-nowrap font-mono text-xs">
                      {l.ocorridoEm ? data(l.ocorridoEm) : <span className="text-muted-foreground">{t("sem data")}</span>}
                    </td>
                    <td className="p-3 whitespace-nowrap font-mono text-xs">
                      {l.situacao === "enviado" ? (
                        data(l.tentadoEm)
                      ) : l.situacao === "recusado" ? (
                        <>
                          {t("tentou em")} {data(l.tentadoEm)}
                        </>
                      ) : (
                        <span className="text-muted-foreground">{t("não saiu")}</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-xs ${ESTILO_DA_SITUACAO[l.situacao]}`}
                      >
                        {t(ROTULO_DA_SITUACAO[l.situacao])}
                      </span>
                      {motivo && l.situacao !== "enviado" && (
                        <span className="mt-1 block text-xs text-muted-foreground">{t(motivo)}</span>
                      )}
                      {l.detalhe && l.situacao !== "enviado" && (
                        <span className="mt-1 block text-xs break-words text-muted-foreground">{l.detalhe}</span>
                      )}
                      <details className="mt-1 text-xs text-muted-foreground">
                        <summary className="cursor-pointer">{t("Detalhes do envio")}</summary>
                        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                          {l.eventoId && (
                            <>
                              <dt>{t("ID do evento")}</dt>
                              <dd className="font-mono break-all">{l.eventoId}</dd>
                            </>
                          )}
                          {l.protocolo && (
                            <>
                              <dt>{t("Protocolo")}</dt>
                              <dd className="font-mono break-all">{l.protocolo}</dd>
                            </>
                          )}
                          {l.acaoGoogle && (
                            <>
                              <dt>{t("Ação de conversão")}</dt>
                              <dd className="font-mono">{l.acaoGoogle}</dd>
                            </>
                          )}
                          <dt>{t("Última tentativa")}</dt>
                          <dd>{new Date(l.tentadoEm).toLocaleString(idioma)}</dd>
                        </dl>
                      </details>
                    </td>
                    <td className="p-3">
                      {l.reenvio.pode ? (
                        <ReenviarEnvio leadId={l.leadId} evento={l.evento} idioma={idioma} />
                      ) : l.reenvio.porque === "passou_de_7_dias" ? (
                        <span className="text-xs text-muted-foreground">{t("sem reenvio: passou de 7 dias")}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {paginas > 1 && (
        <nav className="flex items-center justify-between text-sm">
          {filtros.pagina > 1 ? <a href={link(filtros.pagina - 1)}>{t("Anterior")}</a> : <span />}
          <span className="text-muted-foreground">
            {t("Página")} {filtros.pagina} {t("de")} {paginas}
          </span>
          {filtros.pagina < paginas ? <a href={link(filtros.pagina + 1)}>{t("Próxima")}</a> : <span />}
        </nav>
      )}

      <p className="max-w-3xl text-xs text-muted-foreground">
        {t(
          "Travas: envia uma vez por negócio e evento (sair e voltar à etapa não duplica); ligar uma regra não envia o passado; o reenvio usa o retrato do primeiro envio; a Meta recusa evento com mais de 7 dias.",
        )}{" "}
        {t(
          "Negócio que não veio de anúncio nem de formulário não aparece aqui: não havia o que informar. O cartão do negócio diz isso na seção Origem.",
        )}
      </p>
    </section>
  );
}
