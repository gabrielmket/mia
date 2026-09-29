"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { useTemplates } from "@/hooks/channels/useTemplates";
import {
  useDispararCampanha,
  useEditarCampanha,
  useExcluirCampanha,
  type Campanha,
} from "@/hooks/useBroadcasts";

import { SeletorDeEtapas } from "./SeletorDeEtapas";
import { SeletorDeTags } from "./SeletorDeTags";

/**
 * FORK MIA — o que se pode fazer com um disparo OFICIAL, no estado em que ele está.
 *
 * Era o `CartaoDaCampanha` da lista antiga. Na unificação da .58 a lista virou
 * a das Campanhas (uma linha por disparo, que abre o detalhe), e as ações foram
 * para o detalhe, como no upstream: é lá que se decide, com a lista de quem
 * recebe à vista.
 *
 * ── O que cada estado permite, e por quê ───────────────────────────────────
 *
 * `rascunho` é o único em que nada saiu e nada foi cobrado — só nele se edita e
 * se exclui. Depois do primeiro envio o disparo vira a explicação de mensagens
 * que chegaram em celulares e de débitos no extrato; mexer nele ali faria a
 * plataforma contradizer o próprio histórico. A rota recusa do mesmo jeito: a
 * tela esconder o botão é conveniência, não é a trava.
 */
export function AcoesDoOficial({
  campanha: c,
  aoExcluir,
}: {
  campanha: Campanha;
  aoExcluir: () => void;
}) {
  const t = useT();
  const [renomeando, setRenomeando] = useState<string | null>(null);
  /**
   * `null` = não está editando. O estado guarda a EDIÇÃO EM CURSO, e não o que
   * está gravado: sair sem salvar precisa deixar o disparo como estava.
   */
  const [edicao, setEdicao] = useState<{
    template: string;
    tags: string[];
    funil: string | null;
    etapas: string[];
  } | null>(null);
  /** `null` = não está agendando. String = o valor do `datetime-local`. */
  const [agendando, setAgendando] = useState<string | null>(null);
  const { data: templatesRes } = useTemplates();
  const aprovados = (templatesRes?.data.templates ?? []).filter((x) => x.status === "APPROVED");

  const disparar = useDispararCampanha();
  const excluir = useExcluirCampanha();
  const editar = useEditarCampanha();

  const ehRascunho = c.status === "rascunho";
  const podeDisparar = ehRascunho || c.status === "pausada";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {podeDisparar ? (
          <Button
            disabled={disparar.isPending}
            onClick={() =>
              disparar.mutate(c.id, {
                onSuccess: () =>
                  toast.success(ehRascunho ? t("Disparo iniciado.") : t("Disparo retomado.")),
                onError: (e: unknown) =>
                  toast.error(e instanceof Error ? e.message : t("Não consegui disparar.")),
              })
            }
          >
            {ehRascunho ? t("Disparar agora") : t("Retomar")}
          </Button>
        ) : null}

        {/*
          AGENDAR é DISPARAR COM HORA — mesma rota, mesmas travas. Só para
          rascunho: disparo que já começou a sair não volta a ser "para depois".
        */}
        {ehRascunho ? (
          <Button variant="outline" onClick={() => setAgendando((v) => (v === null ? "" : null))}>
            {agendando === null ? t("Agendar") : t("Cancelar agendamento")}
          </Button>
        ) : null}

        {ehRascunho ? (
          <>
            <Button variant="ghost" onClick={() => setRenomeando(c.nome)}>
              {t("Renomear")}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                setEdicao((e) =>
                  e
                    ? null
                    : {
                        template: `${c.template_name}:${c.template_language}`,
                        // O filtro NÃO é recuperado porque o disparo não o guarda:
                        // ele guarda o RESULTADO da peneira, não a pergunta que a
                        // produziu. Começar vazio é honesto — e é por isso que
                        // salvar aqui REMONTA.
                        tags: [],
                        funil: null,
                        etapas: [],
                      },
                )
              }
            >
              {edicao ? t("Fechar edição") : t("Editar")}
            </Button>
            {/*
              Sem confirmação porque não há o que perder: rascunho nunca enviou
              nem cobrou, e a lista se remonta com um clique.
            */}
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={excluir.isPending}
              onClick={() =>
                excluir.mutate(c.id, {
                  onSuccess: () => {
                    toast.success(t("Rascunho excluído."));
                    aoExcluir();
                  },
                  onError: (e: unknown) =>
                    toast.error(e instanceof Error ? e.message : t("Não consegui excluir.")),
                })
              }
            >
              {t("Excluir")}
            </Button>
          </>
        ) : null}
      </div>

      {renomeando !== null ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs" htmlFor={`nome-${c.id}`}>
              {t("Nome da campanha")}
            </Label>
            <Input
              id={`nome-${c.id}`}
              className="h-9 max-w-72"
              value={renomeando}
              autoFocus
              onChange={(e) => setRenomeando(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setRenomeando(null);
              }}
            />
          </div>
          <Button
            size="sm"
            disabled={!renomeando.trim() || editar.isPending}
            onClick={() =>
              editar.mutate(
                { id: c.id, nome: renomeando.trim() },
                {
                  onSuccess: () => {
                    setRenomeando(null);
                    toast.success(t("Nome atualizado."));
                  },
                  onError: (e2: unknown) =>
                    toast.error(e2 instanceof Error ? e2.message : t("Não consegui renomear.")),
                },
              )
            }
          >
            {t("Salvar")}
          </Button>
        </div>
      ) : null}

      {agendando !== null ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border/60 bg-muted/30 p-3">
          <div className="space-y-1">
            <Label className="text-xs" htmlFor={`quando-${c.id}`}>
              {t("Disparar em")}
            </Label>
            <Input
              id={`quando-${c.id}`}
              type="datetime-local"
              className="h-9"
              value={agendando}
              onChange={(e) => setAgendando(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={!agendando || disparar.isPending}
            onClick={() =>
              disparar.mutate(
                // `datetime-local` devolve hora LOCAL sem fuso; o `Date` do
                // navegador a interpreta no fuso de quem está olhando, que é o
                // que a pessoa quis dizer ao digitar.
                { id: c.id, quando: new Date(agendando).toISOString() },
                {
                  onSuccess: () => {
                    setAgendando(null);
                    toast.success(t("Campanha agendada."));
                  },
                  onError: (e: unknown) =>
                    toast.error(e instanceof Error ? e.message : t("Não consegui agendar.")),
                },
              )
            }
          >
            {t("Confirmar agendamento")}
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            {t(
              "O crédito e a aprovação do template são conferidos agora E de novo na hora do envio — entre uma coisa e outra, outro disparo pode ter consumido o saldo.",
            )}
          </p>
        </div>
      ) : null}

      {/*
        EDITAR = TROCAR O MODELO E REMONTAR A LISTA, com tag E etapa.

        A etapa entrou aqui na .58: a rota remonta com `tags ?? []` e
        `etapas ?? []`, então editar só as tags de um disparo montado por etapa
        remontava a lista IGNORANDO a etapa — ela crescia em silêncio.
      */}
      {edicao ? (
        <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-3">
          <div className="space-y-1">
            <Label className="text-xs" htmlFor={`tpl-${c.id}`}>
              {t("Template aprovado")}
            </Label>
            <select
              id={`tpl-${c.id}`}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
              value={edicao.template}
              onChange={(e) => setEdicao({ ...edicao, template: e.target.value })}
            >
              {aprovados.map((x) => (
                <option key={`${x.name}:${x.language}`} value={`${x.name}:${x.language}`}>
                  {x.name} ({x.language})
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <SeletorDeTags
              selecionadas={edicao.tags}
              onChange={(tags) => setEdicao({ ...edicao, tags })}
              disabled={editar.isPending}
            />
            <SeletorDeEtapas
              funil={edicao.funil}
              aoMudarFunil={(funil) => setEdicao({ ...edicao, funil })}
              etapas={edicao.etapas}
              aoMudarEtapas={(etapas) => setEdicao({ ...edicao, etapas })}
              disabled={editar.isPending}
            />
          </div>

          <p className="text-xs text-warning-fg">
            {t("Salvar REMONTA a lista de destinatários com o filtro acima — quem estava antes e não passa no filtro novo sai.")}
          </p>

          <Button
            size="sm"
            disabled={editar.isPending}
            onClick={() => {
              const [nome, idioma] = edicao.template.split(":");
              editar.mutate(
                {
                  id: c.id,
                  template_name: nome,
                  template_language: idioma,
                  tags: edicao.tags,
                  etapas: edicao.etapas,
                },
                {
                  onSuccess: (r) => {
                    setEdicao(null);
                    const p = (r as { data?: { peneira?: { enviar: number } | null } })?.data?.peneira;
                    toast.success(
                      p ? `${t("Lista remontada:")} ${p.enviar} ${t("destinatários")}` : t("Campanha atualizada."),
                    );
                  },
                  onError: (e: unknown) =>
                    toast.error(e instanceof Error ? e.message : t("Não consegui salvar.")),
                },
              );
            }}
          >
            {editar.isPending ? t("Salvando…") : t("Salvar e remontar")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
