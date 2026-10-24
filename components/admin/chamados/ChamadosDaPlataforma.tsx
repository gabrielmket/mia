"use client";

/**
 * FORK MIA (.88) — OS CHAMADOS DO ASSISTENTE, do lado da Time Company.
 *
 * A lista de todas as empresas (os da demonstração não entram: não saem para a
 * Time), o contexto que o assistente juntou (tela, hora, versão, navegador,
 * mensagem do sistema), o print por link assinado e a resposta. Ao salvar uma
 * resposta nova, ou ao resolver, quem abriu recebe no assistente, no sino e no
 * e-mail; a tela diz por onde a resposta chegou.
 */
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useChamadosDaPlataforma, useResponderChamado, type FiltroDeSituacao } from "@/hooks/useChamadosDaPlataforma";
import type { ChamadoDaPlataforma } from "@/lib/assistente/chamados-da-plataforma";
import { ROTULO_DA_SITUACAO, ROTULO_DO_TIPO_DE_CHAMADO, SITUACOES_DE_CHAMADO, type SituacaoDeChamado } from "@/lib/assistente/tipos";
import { cn } from "@/lib/utils";

const FILTROS: Array<{ id: FiltroDeSituacao; rotulo: string }> = [
  { id: "abertos", rotulo: "Abertos" },
  { id: "novo", rotulo: "Novo" },
  { id: "em_analise", rotulo: "Em análise" },
  { id: "resolvido", rotulo: "Resolvido" },
  { id: "todos", rotulo: "Todos" },
];

export function ChamadosDaPlataforma() {
  const t = useT();
  const tag = useTagDeIdioma();
  const [filtro, setFiltro] = useState<FiltroDeSituacao>("abertos");
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const { data, isLoading, error } = useChamadosDaPlataforma(filtro);
  const chamados = data ?? [];
  const atual = chamados.find((c) => c.id === escolhido) ?? chamados[0] ?? null;

  return (
    <div className="space-y-4" data-testid="chamados-da-plataforma">
      <div>
        <h1 className="text-xl font-semibold">{t("Chamados do assistente")}</h1>
        <p className="text-sm text-text-muted">
          {t("Erros, dúvidas e pedidos que as equipes dos clientes abriram pelo assistente da MIA, com o que o assistente juntou.")}
        </p>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={t("Situação")}>
        {FILTROS.map((f) => (
          <Button
            key={f.id}
            type="button"
            size="sm"
            variant={filtro === f.id ? "default" : "outline"}
            className="h-11 lg:h-8"
            aria-pressed={filtro === f.id}
            onClick={() => setFiltro(f.id)}
          >
            {t(f.rotulo)}
          </Button>
        ))}
      </div>

      {isLoading ? <p className="text-sm text-text-muted">{t("Carregando…")}</p> : null}
      {error ? <p className="text-sm text-error-fg">{t("Não consegui ler os chamados.")}</p> : null}
      {!isLoading && !error && chamados.length === 0 ? (
        <p className="text-sm text-text-muted">{t("Nenhum chamado neste filtro.")}</p>
      ) : null}

      {chamados.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs text-text-muted">
                <tr>
                  <th className="p-2">#</th>
                  <th className="p-2">{t("Empresa")}</th>
                  <th className="p-2">{t("Tipo")}</th>
                  <th className="p-2">{t("Quem abriu")}</th>
                  <th className="p-2">{t("Quando")}</th>
                  <th className="p-2">{t("Situação")}</th>
                </tr>
              </thead>
              <tbody>
                {chamados.map((c) => (
                  <tr
                    key={c.id}
                    className={cn("cursor-pointer border-t hover:bg-muted", atual?.id === c.id ? "bg-muted" : "")}
                    onClick={() => setEscolhido(c.id)}
                  >
                    <td className="p-2">
                      <button type="button" className="min-h-11 font-medium underline lg:min-h-0" onClick={() => setEscolhido(c.id)}>
                        #{c.numero}
                      </button>
                    </td>
                    <td className="p-2">{c.empresa ?? "-"}</td>
                    <td className="p-2">{t(ROTULO_DO_TIPO_DE_CHAMADO[c.tipo])}</td>
                    <td className="p-2">{c.quem_abriu ?? "-"}</td>
                    <td className="p-2 whitespace-nowrap">
                      {new Date(c.created_at).toLocaleString(tag, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="p-2">
                      <SeloDaSituacao situacao={c.situacao} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {atual ? <DetalheDoChamado key={atual.id} chamado={atual} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function SeloDaSituacao({ situacao }: { situacao: SituacaoDeChamado }) {
  const t = useT();
  return (
    <Badge variant={situacao === "resolvido" ? "success" : situacao === "novo" ? "warning" : "info"}>
      {t(ROTULO_DA_SITUACAO[situacao])}
    </Badge>
  );
}

function DetalheDoChamado({ chamado }: { chamado: ChamadoDaPlataforma }) {
  const t = useT();
  const responder = useResponderChamado();
  const [situacao, setSituacao] = useState<SituacaoDeChamado>(chamado.situacao);
  const [resposta, setResposta] = useState(chamado.resposta ?? "");
  const contexto = chamado.contexto as {
    tela?: { caminho?: string; rotulo?: string | null } | null;
    hora_local?: string;
    versao?: string;
    navegador?: string;
    mensagem_do_sistema?: string | null;
    papel?: string;
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4" data-testid="detalhe-do-chamado">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">
          {t("Chamado")} #{chamado.numero}
        </h2>
        <Badge variant="neutral">{t(ROTULO_DO_TIPO_DE_CHAMADO[chamado.tipo])}</Badge>
        <SeloDaSituacao situacao={chamado.situacao} />
      </div>
      <p className="text-sm text-text-muted">
        {chamado.empresa ?? "-"} · {chamado.quem_abriu ?? "-"}
      </p>
      <p className="text-sm whitespace-pre-wrap">{chamado.texto}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-surface-muted p-3 text-xs">
        <dt className="text-text-muted">{t("Tela")}</dt>
        <dd>{contexto.tela?.rotulo ?? contexto.tela?.caminho ?? "-"}</dd>
        <dt className="text-text-muted">{t("Hora")}</dt>
        <dd>{contexto.hora_local ?? "-"}</dd>
        <dt className="text-text-muted">{t("Versão")}</dt>
        <dd>{contexto.versao ?? "-"}</dd>
        <dt className="text-text-muted">{t("Navegador")}</dt>
        <dd>{contexto.navegador ?? "-"}</dd>
        <dt className="text-text-muted">{t("Mensagem do sistema")}</dt>
        <dd>{contexto.mensagem_do_sistema ?? "-"}</dd>
      </dl>
      {chamado.tem_print ? (
        <a
          href={`/api/v1/admin/chamados/${chamado.id}/print`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center text-sm underline lg:min-h-0"
        >
          {t("Abrir o print")}
        </a>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span>{t("Situação")}</span>
        <select
          value={situacao}
          onChange={(e) => setSituacao(e.target.value as SituacaoDeChamado)}
          className="h-11 rounded-md border bg-background px-2 lg:h-9"
        >
          {SITUACOES_DE_CHAMADO.map((s) => (
            <option key={s} value={s}>
              {t(ROTULO_DA_SITUACAO[s])}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>{t("Resposta para quem abriu")}</span>
        <textarea
          value={resposta}
          onChange={(e) => setResposta(e.target.value)}
          rows={5}
          maxLength={8000}
          className="rounded-md border bg-background p-2"
        />
      </label>
      <p className="text-xs text-text-muted">
        {t("Ao salvar uma resposta nova, ou ao resolver, quem abriu recebe no assistente, no sino e no e-mail.")}
      </p>
      <Button
        type="button"
        className="h-11 self-start lg:h-9"
        disabled={responder.isPending}
        onClick={() =>
          responder.mutate(
            { id: chamado.id, situacao, resposta: resposta.trim() || null },
            {
              onSuccess: (r) => {
                const e = r.data.entregue;
                const canais = [e.assistente ? t("assistente") : null, e.sino ? t("sino") : null, e.email ? t("e-mail") : null]
                  .filter(Boolean)
                  .join(", ");
                toast.success(canais ? `${t("Salvo. Chegou por")}: ${canais}.` : t("Salvo."));
              },
              onError: () => toast.error(t("Não consegui gravar a resposta.")),
            },
          )
        }
      >
        {t("Salvar")}
      </Button>
    </section>
  );
}
