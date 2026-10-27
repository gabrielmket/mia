"use client";

/**
 * FORK MIA (.88) — a página do assistente da MIA.
 *
 *   Conversas         o histórico da pessoa (90 dias) e a conversa aberta
 *   Resumo da manhã   o interruptor de cada pessoa e como ele funciona
 *   Chamados          os chamados dela para a Time, com a situação e a resposta
 *   (administrador)   como trabalhamos aqui, quem usa, perguntas sem resposta
 *   Propostas (.94)   pedidos esperando você, seus pedidos e o que o assistente
 *                     fez, com o "Desfazer" (`?aba=propostas`, o botão do aviso)
 *
 * `?conversa=<id>` abre uma conversa (o botão do aviso do resumo da manhã) e
 * `?aba=chamados` abre os chamados (o botão do aviso da resposta).
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { PainelDoAssistente } from "@/components/assistente/PainelDoAssistente";
// FORK MIA (.94): a aba das propostas (o assistente faz com aprovação).
import { PropostasDoAssistente } from "@/components/assistente/PropostasDoAssistente";
import { TrilhasDoAssistente } from "@/components/assistente/trilhas/TrilhasDoAssistente";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/auth/AuthProvider";
import {
  useAssistente,
  useEmpresaDoAssistente,
  useGuardarConhecimento,
  usePapeisDoAssistente,
  useResumoDaManha,
  useTirarConhecimento,
} from "@/hooks/assistente/useAssistente";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { PAPEIS_DO_ASSISTENTE, ROTULO_DA_SITUACAO, ROTULO_DO_TIPO_DE_CHAMADO } from "@/lib/assistente/tipos";
import { ROTULO_DO_PAPEL, roleAtLeast } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

// FORK MIA (.93): "trilhas", o "Me mostra como" (components/assistente/trilhas/).
// FORK MIA (.94): "propostas", o assistente faz com aprovação.
type Aba = "conversas" | "trilhas" | "resumo" | "chamados" | "empresa" | "propostas";

export function AssistenteClient() {
  const t = useT();
  const tag = useTagDeIdioma();
  const router = useRouter();
  const pathname = usePathname() ?? "/app/assistente";
  const params = useSearchParams();
  const { activeOrg } = useAuth();
  const ehAdmin = roleAtLeast(activeOrg?.role ?? null, "admin");
  // FORK MIA (.94): quem propõe (atendente em diante) vê a aba das propostas.
  const propoe = roleAtLeast(activeOrg?.role ?? null, "agent");

  const abaInicial = (params?.get("aba") as Aba | null) ?? "conversas";
  const [aba, setAba] = useState<Aba>(
    (abaInicial === "empresa" && !ehAdmin) || (abaInicial === "propostas" && !propoe) ? "conversas" : abaInicial,
  );
  const [conversaId, setConversaId] = useState<string | null>(params?.get("conversa") ?? null);
  const estado = useAssistente(conversaId);
  const resumo = useResumoDaManha();
  // FORK MIA (.93): o "Ver as trilhas" da guia abre a aba mesmo com a página já aberta.
  const abaPedida = params?.get("aba") ?? null;
  const [abaPedidaVista, setAbaPedidaVista] = useState(abaPedida);
  if (abaPedida !== abaPedidaVista) {
    setAbaPedidaVista(abaPedida);
    if (abaPedida === "trilhas") setAba("trilhas");
  }

  const abas: Array<{ id: Aba; rotulo: string }> = [
    { id: "conversas", rotulo: "Conversas" },
    { id: "trilhas", rotulo: "Trilhas" },
    { id: "resumo", rotulo: "Resumo da manhã" },
    { id: "chamados", rotulo: "Chamados" },
    ...(propoe ? [{ id: "propostas" as const, rotulo: "Propostas" }] : []),
    ...(ehAdmin ? [{ id: "empresa" as const, rotulo: "Na empresa" }] : []),
  ];

  function abrirConversa(id: string | null) {
    setConversaId(id);
    setAba("conversas");
    router.replace(id ? `${pathname}?conversa=${id}` : pathname);
  }

  const dataCurta = (iso: string) =>
    new Date(iso).toLocaleString(tag, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6" data-testid="pagina-do-assistente">
      <header className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Assistente")}</h1>
        <p className="text-sm text-text-muted">
          {t("Pergunte do seu jeito: a sua rotina, os seus números e como usar o sistema. O assistente vê só o que você já pode ver.")}
        </p>
      </header>

      <div className="flex gap-1 overflow-x-auto border-b" role="tablist" aria-label={t("Seções do assistente")}>
        {abas.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            onClick={() => setAba(a.id)}
            className={cn(
              "h-11 shrink-0 border-b-2 px-3 text-sm lg:h-9",
              aba === a.id ? "border-primary font-medium" : "border-transparent text-text-muted hover:text-foreground",
            )}
          >
            {t(a.rotulo)}
          </button>
        ))}
      </div>

      {aba === "conversas" ? (
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[260px_1fr]">
          <aside className="flex min-h-0 flex-col gap-2" data-testid="historico-do-assistente">
            <Button type="button" variant="outline" className="h-11 lg:h-9" onClick={() => abrirConversa(null)}>
              {t("Nova conversa")}
            </Button>
            <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
              {(estado.data?.conversas ?? []).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => abrirConversa(c.id)}
                    className={cn(
                      "flex min-h-11 w-full flex-col rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                      c.id === conversaId ? "bg-muted" : "",
                    )}
                  >
                    <span className="line-clamp-2">{c.titulo}</span>
                    <span className="text-xs text-text-muted">{dataCurta(c.ultima_em)}</span>
                  </button>
                </li>
              ))}
              {estado.data && estado.data.conversas.length === 0 ? (
                <li className="px-2 text-sm text-text-muted">{t("Nenhuma conversa ainda.")}</li>
              ) : null}
            </ul>
            <p className="text-xs text-text-muted">{t("O histórico fica guardado por 90 dias. Só você vê as suas conversas.")}</p>
          </aside>
          <section className="flex min-h-[420px] flex-col rounded-lg border p-3">
            <PainelDoAssistente caminho={pathname} conversaId={conversaId} aoMudarConversa={abrirConversa} />
          </section>
        </div>
      ) : null}

      {aba === "trilhas" ? <TrilhasDoAssistente /> : null}

      {aba === "resumo" ? (
        <section className="flex max-w-2xl flex-col gap-3" data-testid="resumo-da-manha">
          <label className="flex min-h-11 items-start gap-3">
            <Switch
              checked={estado.data?.resumo_da_manha ?? false}
              disabled={!estado.data || resumo.isPending}
              onCheckedChange={(ligado) =>
                resumo.mutate(ligado, {
                  onSuccess: () => toast.success(ligado ? t("Resumo da manhã ligado.") : t("Resumo da manhã desligado.")),
                  onError: () => toast.error(t("Não deu para guardar a escolha agora.")),
                })
              }
              aria-label={t("Resumo da manhã")}
            />
            <span className="flex flex-col">
              <span className="font-medium">{t("Resumo da manhã")}</span>
              <span className="text-sm text-text-muted">
                {t("Em dia útil, às 8h no fuso da empresa, o plano do dia fica pronto aqui no assistente e aparece um aviso no sino.")}
              </span>
            </span>
          </label>
          <p className="text-sm text-text-muted">
            {t("O resumo é montado pelo próprio sistema, sem gastar IA: os compromissos, as tarefas, as conversas esperando e a ordem do que mais rende hoje.")}
          </p>
        </section>
      ) : null}

      {aba === "chamados" ? (
        <section className="flex flex-col gap-2" data-testid="meus-chamados">
          <p className="text-sm text-text-muted">
            {t("Erros, dúvidas e pedidos que você mandou para a Time Company pelo assistente. A resposta chega aqui e no seu e-mail.")}
          </p>
          {(estado.data?.chamados ?? []).length === 0 ? (
            <p className="text-sm text-text-muted">{t("Nenhum chamado ainda.")}</p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {(estado.data?.chamados ?? []).map((c) => (
              <li key={c.id} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">#{c.numero}</span>
                  <Badge variant={c.tipo === "erro" ? "error" : c.tipo === "pedido" ? "info" : "neutral"}>
                    {t(ROTULO_DO_TIPO_DE_CHAMADO[c.tipo])}
                  </Badge>
                  <Badge variant={c.situacao === "resolvido" ? "success" : c.situacao === "novo" ? "warning" : "info"}>
                    {t(ROTULO_DA_SITUACAO[c.situacao])}
                  </Badge>
                  {c.demonstracao ? <Badge variant="neutral">{t("Demonstração: não enviado")}</Badge> : null}
                  <span className="text-xs text-text-muted">{dataCurta(c.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap">{c.texto}</p>
                {c.resposta ? (
                  <p className="rounded-md bg-surface-muted p-2 whitespace-pre-wrap">
                    <span className="font-medium">{t("Resposta da Time Company")}:</span> {c.resposta}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {aba === "empresa" && ehAdmin ? <NaEmpresa /> : null}

      {aba === "propostas" && propoe ? <PropostasDoAssistente papel={activeOrg?.role ?? null} /> : null}
    </div>
  );
}

function NaEmpresa() {
  const t = useT();
  const tag = useTagDeIdioma();
  const empresa = useEmpresaDoAssistente(true);
  const papeis = usePapeisDoAssistente();
  const guardar = useGuardarConhecimento();
  const tirar = useTirarConhecimento();
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");

  const dados = empresa.data;
  if (empresa.isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  if (!dados) return <p className="text-sm text-warning-fg">{t("Não deu para ler a configuração do assistente agora.")}</p>;

  function alternarPapel(papel: string, ligado: boolean) {
    const atual = new Set(dados!.config.papeis);
    if (ligado) atual.add(papel);
    else atual.delete(papel);
    papeis.mutate([...atual], {
      onSuccess: () => toast.success(t("Quem usa o assistente foi atualizado.")),
      onError: () => toast.error(t("Não deu para guardar a configuração agora.")),
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="flex flex-col gap-3" data-testid="como-trabalhamos-aqui">
        <h2 className="text-lg font-semibold">{t("Como trabalhamos aqui")}</h2>
        <p className="text-sm text-text-muted">
          {t("O que você escrever aqui o assistente usa nas respostas a toda a equipe. Ex.: proposta acima de R$ 10 mil passa pela gestora.")}
        </p>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            guardar.mutate(
              { titulo, texto },
              {
                onSuccess: () => {
                  setTitulo("");
                  setTexto("");
                  toast.success(t("Guardado."));
                },
                onError: (erro) => toast.error(t(erro instanceof Error ? erro.message : "Não deu para guardar agora.")),
              },
            );
          }}
        >
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            maxLength={120}
            placeholder={t("Título")}
            aria-label={t("Título")}
            className="h-11 rounded-md border bg-background px-3 text-sm lg:h-9"
          />
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder={t("Como a empresa faz isso")}
            aria-label={t("Texto")}
            className="rounded-md border bg-background p-3 text-sm"
          />
          <Button type="submit" className="h-11 self-start lg:h-9" disabled={guardar.isPending || !titulo.trim() || !texto.trim()}>
            {t("Guardar")}
          </Button>
        </form>
        <ul className="flex flex-col gap-2">
          {dados.base.map((item) => (
            <li key={item.id} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{item.titulo}</span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-11 lg:h-8"
                    onClick={() => {
                      setTitulo(item.titulo);
                      setTexto(item.texto);
                    }}
                  >
                    {t("Editar")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-11 lg:h-8"
                    disabled={tirar.isPending}
                    onClick={() => tirar.mutate(item.titulo)}
                  >
                    {t("Tirar")}
                  </Button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-text-muted">{item.texto}</p>
            </li>
          ))}
          {dados.base.length === 0 ? <li className="text-sm text-text-muted">{t("Nada escrito ainda.")}</li> : null}
        </ul>
      </section>

      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-2" data-testid="quem-usa-o-assistente">
          <h2 className="text-lg font-semibold">{t("Quem usa")}</h2>
          {!dados.config.ligado ? (
            <p className="rounded-md bg-warning-bg p-2 text-sm text-warning-fg">
              {t("O assistente está desligado nesta empresa pela Time Company.")}
            </p>
          ) : null}
          {PAPEIS_DO_ASSISTENTE.map((papel) => (
            <label key={papel} className="flex min-h-11 items-center gap-3 text-sm">
              <Switch
                checked={dados.config.papeis.includes(papel)}
                disabled={papeis.isPending}
                onCheckedChange={(ligado) => alternarPapel(papel, ligado)}
                aria-label={t(ROTULO_DO_PAPEL[papel])}
              />
              {t(ROTULO_DO_PAPEL[papel])}
            </label>
          ))}
          <p className="text-xs text-text-muted">
            {t("Limite de perguntas por pessoa por dia")}: {dados.config.perguntas_por_pessoa_por_dia}.{" "}
            {t("A IA é da plataforma; para mudar o limite, fale com a Time Company.")}
          </p>
        </section>

        <section className="flex flex-col gap-2" data-testid="perguntas-sem-resposta">
          <h2 className="text-lg font-semibold">{t("Perguntas que ficaram sem resposta")}</h2>
          <p className="text-sm text-text-muted">
            {t("Para melhorar a ajuda: o que o assistente não soube responder nos últimos 30 dias, sem o resto da conversa de ninguém.")}
          </p>
          <ul className="flex flex-col gap-1">
            {dados.sem_resposta.map((p) => (
              <li key={p.texto} className="rounded-md border p-2 text-sm">
                &ldquo;{p.texto}&rdquo;{" "}
                <span className="text-xs text-text-muted">
                  ({p.vezes} {p.vezes === 1 ? t("vez") : t("vezes")} · {new Date(p.ultima_em).toLocaleDateString(tag)})
                </span>
              </li>
            ))}
            {dados.sem_resposta.length === 0 ? <li className="text-sm text-text-muted">{t("Nenhuma por enquanto.")}</li> : null}
          </ul>
        </section>
      </div>
    </div>
  );
}
