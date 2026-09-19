"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useTemplates } from "@/hooks/channels/useTemplates";
import { SeletorDeTags } from "./SeletorDeTags";
import {
  useDestinatarios,
  useDispararCampanha,
  useEditarCampanha,
  useExcluirCampanha,
  type Campanha,
} from "@/hooks/useBroadcasts";

/**
 * UMA CAMPANHA NA LISTA — e tudo que se pode fazer com ela.
 *
 * Saiu de dentro de `MiaBroadcast` quando ganhou ações: o cartão passou de
 * quatro linhas de texto para disparar, conferir quem recebe, renomear e
 * excluir, e manter isso embutido faria a tela inteira reordenar a cada
 * expansão de lista de outra campanha.
 *
 * ── O que cada estado permite, e por quê ───────────────────────────────────
 *
 * `rascunho` é o único em que nada saiu e nada foi cobrado — só nele se edita e
 * se exclui. Depois do primeiro envio a campanha vira a explicação de mensagens
 * que chegaram em celulares e de débitos no extrato; mexer nela ali faria a
 * plataforma contradizer o próprio histórico. A rota recusa do mesmo jeito: a
 * tela esconder o botão é conveniência, não é a trava.
 */
export function CartaoDaCampanha({
  campanha: c,
  rotuloDoStatus,
  motivo,
}: {
  campanha: Campanha;
  rotuloDoStatus: Record<Campanha["status"], string>;
  motivo: Record<string, string>;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const [aberta, setAberta] = useState(false);
  const [renomeando, setRenomeando] = useState<string | null>(null);
  /**
   * `null` = não está editando. O estado guarda a EDIÇÃO EM CURSO, e não o que
   * está gravado: sair sem salvar precisa deixar a campanha como estava, e um
   * estado que espelhasse a campanha não saberia distinguir as duas coisas.
   */
  const [edicao, setEdicao] = useState<{ template: string; tags: string[] } | null>(null);
  /** `null` = não está agendando. String = o valor do `datetime-local`. */
  const [agendando, setAgendando] = useState<string | null>(null);
  const { data: templatesRes } = useTemplates();
  const aprovados = (templatesRes?.data.templates ?? []).filter((x) => x.status === "APPROVED");

  const disparar = useDispararCampanha();
  const excluir = useExcluirCampanha();
  const editar = useEditarCampanha();
  const lista = useDestinatarios(c.id, aberta);

  const ehRascunho = c.status === "rascunho";
  const podeDisparar = ehRascunho || c.status === "pausada";

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {renomeando === null ? (
          <span className="font-medium">{c.nome}</span>
        ) : (
          <Input
            className="h-7 max-w-56"
            value={renomeando}
            autoFocus
            onChange={(e) => setRenomeando(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setRenomeando(null);
              if (e.key === "Enter" && renomeando.trim()) {
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
                );
              }
            }}
          />
        )}
        <span className="rounded-sm border px-1.5 py-0.5 text-xs">
          {t(rotuloDoStatus[c.status])}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{c.template_name}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {new Date(c.created_at).toLocaleDateString(tag)}
        </span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
        {c.andamento.total} {t("na lista")} · {c.andamento.enviada ?? 0} {t("enviadas")} ·{" "}
        {c.andamento.entregue ?? 0} {t("entregues")}
        {c.andamento.lida ? ` · ${c.andamento.lida} ${t("lidas")}` : null} ·{" "}
        {c.andamento.falhou ?? 0} {t("falhas")}
        {c.andamento.estornada ? ` · ${c.andamento.estornada} ${t("devolvidas")}` : null} ·{" "}
        {c.andamento.pendente ?? 0} {t("na fila")}
      </p>

      {c.status === "agendada" && c.agendado_para ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("Sai em")} {new Date(c.agendado_para).toLocaleString(tag)}
        </p>
      ) : null}

      {c.motivo_da_parada ? (
        <p className="mt-1 text-xs text-warning-fg">
          {t(motivo[c.motivo_da_parada] ?? c.motivo_da_parada)}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setAberta((v) => !v)}>
          {aberta ? t("Ocultar destinatários") : t("Ver destinatários")}
        </Button>
        {/*
          A TELA CHEIA. A prévia inline continua servindo para conferir três
          linhas de olho; com três mil ela empurra o resto da página para fora
          e obriga a rolar até o fim para saber se sobrou alguém sem receber.
        */}
        <Button variant="secondary" asChild>
          <Link href={`/app/broadcast/${c.id}`}>{t("Abrir a campanha")}</Link>
        </Button>

        {podeDisparar ? (
          <Button
            size="sm"
            variant="secondary"
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
          AGENDAR é DISPARAR COM HORA — mesma rota, mesmas travas.

          A coluna, o status e o índice parcial existiam desde a 0247, e o worker
          já tratava `agendada`: faltava só quem criasse uma. Era peça pronta e
          nunca ligada, a terceira encontrada neste módulo.

          Só para rascunho: campanha que já começou a sair não volta a ser
          "para depois".
        */}
        {ehRascunho ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAgendando((v) => (v === null ? "" : null))}
          >
            {agendando === null ? t("Agendar") : t("Cancelar agendamento")}
          </Button>
        ) : null}

        {ehRascunho ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setRenomeando(c.nome)}>
              {t("Renomear")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setEdicao((e) =>
                  e
                    ? null
                    : {
                        template: `${c.template_name}:${c.template_language}`,
                        // As tags NÃO são recuperadas da campanha porque a
                        // campanha não as guarda: ela guarda o RESULTADO da
                        // peneira, não a pergunta que a produziu. Começar vazio
                        // é honesto — e é por isso que salvar aqui REMONTA.
                        tags: [],
                      },
                )
              }
            >
              {edicao ? t("Fechar edição") : t("Editar")}
            </Button>
            {/*
              Sem confirmação porque não há o que perder: rascunho nunca enviou
              nem cobrou, e a lista se remonta com um clique. Pedir confirmação
              aqui treinaria o operador a clicar "sim" sem ler — e aí ele
              clicaria "sim" no dia em que a pergunta importasse.
            */}
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={excluir.isPending}
              onClick={() =>
                excluir.mutate(c.id, {
                  onSuccess: () => toast.success(t("Rascunho excluído.")),
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

      {agendando !== null ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-border/60 bg-muted/30 p-3">
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
                // que a pessoa quis dizer ao digitar. O ISO com deslocamento é
                // o que a rota valida.
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
        EDITAR = TROCAR O TEMPLATE E REMONTAR A LISTA.

        Só rascunho chega aqui: depois do primeiro envio a campanha vira a
        explicação de mensagens que chegaram e de débitos no extrato, e mudar o
        template ali faria o extrato apontar para um texto que ninguém recebeu.

        Remontar e não "ajustar": a lista é materializada na peneira, com
        telefone e valores de cada contato no momento em que se montou. Mudar o
        filtro é fazer outra pergunta ao banco, que devolve outro conjunto —
        fingir que é edição esconderia que quem entrou e quem saiu mudou. Por
        isso o aviso abaixo é explícito, e a resposta devolve a peneira nova.
      */}
      {edicao ? (
        <div className="mt-3 space-y-3 rounded-md border border-border/60 bg-muted/30 p-3">
          <div className="space-y-1">
            {/*
              `Label` e não `<label>` cru: no Tailwind 4 o `space-*` põe a margem
              no filho ANTERIOR, e um `<label>` sem display declarado quebra o
              espaçamento do container. `tests/unit/tailwind-tokens` cobra isso
              — e foi ele que pegou esta linha.
            */}
            <Label className="text-xs" htmlFor={`tpl-${c.id}`}>
              {t("Template aprovado")}
            </Label>
            <select
              id={`tpl-${c.id}`}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
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

          <SeletorDeTags
            selecionadas={edicao.tags}
            onChange={(tags) => setEdicao({ ...edicao, tags })}
            disabled={editar.isPending}
          />

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
                },
                {
                  onSuccess: (r) => {
                    setEdicao(null);
                    const p = (r as { data?: { peneira?: { enviar: number } | null } })?.data
                      ?.peneira;
                    toast.success(
                      p
                        ? `${t("Lista remontada:")} ${p.enviar} ${t("destinatários")}`
                        : t("Campanha atualizada."),
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

      {aberta ? (
        <div className="mt-3 rounded-md border border-border/60">
          {lista.isPending ? (
            <p className="p-3 text-xs text-muted-foreground">{t("Carregando…")}</p>
          ) : (lista.data?.destinatarios ?? []).length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">{t("Nenhum destinatário na lista.")}</p>
          ) : (
            <>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/60">
                    <tr className="text-left">
                      <th className="px-2 py-1.5 font-medium">{t("Nome")}</th>
                      <th className="px-2 py-1.5 font-medium">{t("Telefone")}</th>
                      <th className="px-2 py-1.5 font-medium">{t("Situação")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(lista.data?.destinatarios ?? []).map((d) => (
                      <tr key={d.id} className="border-t border-border/60 align-top">
                        {/*
                          Contato apagado depois de montada a lista deixa a linha
                          sem nome — e ela continua sendo um envio real, então
                          aparece nomeada como o que é, não escondida.
                        */}
                        <td className="px-2 py-1.5">
                          {d.nome ?? (
                            <span className="text-muted-foreground">{t("(sem cadastro)")}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 font-mono">{d.telefone}</td>
                        <td className="px-2 py-1.5">
                          {t(d.status)}
                          {/*
                            O ERRO fica ao lado da linha que falhou. Era a
                            pergunta sem resposta: a campanha dizia "3 falhas" e
                            não dizia por quê, e o motivo só existia no banco.
                          */}
                          {d.erro ? (
                            <span className="block text-error-fg">{d.erro}</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(lista.data?.total ?? 0) > (lista.data?.destinatarios ?? []).length ? (
                <p className="border-t border-border/60 px-2 py-1.5 text-xs text-muted-foreground">
                  {t("Mostrando os primeiros")} {(lista.data?.destinatarios ?? []).length}{" "}
                  {t("de")} {lista.data?.total}.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
