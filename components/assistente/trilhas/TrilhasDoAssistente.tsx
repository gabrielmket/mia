"use client";

/**
 * FORK MIA (.93) — ASSISTENTE › TRILHAS: as trilhas por objetivo e o progresso
 * de cada pessoa (protótipo aprovado em 26/10/2026, tela 2).
 *
 * Cada pessoa vê as que pode fazer, com o progresso de cada uma; as dos outros
 * papéis aparecem para ler os passos e pedir a quem pode (decisão 9: todas as
 * empresas e todos os papéis). A trilha é feita quando o objetivo aparece no
 * sistema, não quando alguém clica em "concluir" (esse botão não existe).
 */
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePedirAPessoa } from "@/hooks/assistente/useAssistente";
import { useTrilhas, type EstadoDasTrilhas, type SituacaoDaTrilhaNaTela } from "@/hooks/assistente/useTrilhas";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import {
  GRUPOS_DAS_TRILHAS,
  GUIAS_CURTOS,
  rotuloDoPapelDaTrilha,
  TITULO_DO_GRUPO,
  trilhaPorId,
  type Trilha,
} from "@/lib/assistente/trilhas/catalogo";
import { cn } from "@/lib/utils";

import { BotaoMeMostraComo } from "./BotaoMeMostraComo";

type Filtro = "minhas" | "todas";

const FILTROS: ReadonlyArray<{ id: Filtro; rotulo: string }> = [
  { id: "minhas", rotulo: "As do meu papel" },
  { id: "todas", rotulo: "Todas" },
];

export function TrilhasDoAssistente() {
  const t = useT();
  const params = useSearchParams();
  const dados = useTrilhas();
  const [filtro, setFiltro] = useState<Filtro>(params?.get("trilha") ? "todas" : "minhas");
  const [aberta, setAberta] = useState<string | null>(params?.get("trilha") ?? null);

  if (dados.isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  const d = dados.data;
  if (!d) return <p className="text-sm text-warning-fg">{t("Não deu para ler as trilhas agora.")}</p>;
  if (!d.disponivel) return <p className="text-sm text-text-muted">{t("O assistente está desligado para o seu papel nesta empresa.")}</p>;

  const situacoes = d.trilhas.filter((s) => !trilhaPorId(s.id)?.curto);
  const doPapel = situacoes.filter((s) => s.do_papel);
  const feitas = doPapel.filter((s) => s.estado === "feita").length;
  const pausadas = doPapel.filter((s) => s.estado === "pausada" || s.estado === "andando").length;
  const recomendada = d.recomendada ? trilhaPorId(d.recomendada) : null;
  const visiveis = situacoes.filter((s) => filtro === "todas" || s.do_papel);

  return (
    <div className="flex flex-col gap-4" data-testid="trilhas-do-assistente">
      <p className="max-w-3xl text-sm text-text-muted">
        {t("As trilhas por objetivo. O assistente destaca na tela onde fica cada passo, espera você fazer e confere no sistema, com o seu login. Ele nunca clica por você, e dá para pausar e retomar depois.")}
      </p>
      {!d.me_mostra_como ? (
        <p className="rounded-md bg-warning-bg p-2 text-sm text-warning-fg">
          {t("O \"Me mostra como\" está desligado nesta empresa. Os passos continuam aqui para ler.")}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Numero rotulo={t("Trilhas do seu papel")} valor={String(doPapel.length)} nota={`${t("de")} ${situacoes.length} ${t("no total")}`} />
        <Numero rotulo={t("Feitas")} valor={String(feitas)} nota={t("pelo que aparece no sistema")} />
        <Numero rotulo={t("Pausadas")} valor={String(pausadas)} nota={t("retome de onde parou")} />
        <Numero rotulo={t("Recomendada agora")} valor={recomendada ? t(recomendada.titulo) : t("Nenhuma")} nota={t("a primeira que falta, na ordem")} pequeno />
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("Mostrar")}>
        <span className="text-sm text-text-muted">{t("Mostrar")}:</span>
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filtro === f.id}
            onClick={() => setFiltro(f.id)}
            className={cn("h-11 rounded-full border px-3 text-sm lg:h-8", filtro === f.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {t(f.rotulo)}
          </button>
        ))}
        <span className="text-xs text-text-muted">{t("As de outro papel aparecem só para ler os passos e pedir a quem pode.")}</span>
      </div>

      {GRUPOS_DAS_TRILHAS.map(({ grupo }) => {
        const doGrupo = visiveis.filter((s) => trilhaPorId(s.id)?.grupo === grupo);
        if (doGrupo.length === 0) return null;
        return (
          <section key={grupo} className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">{t(TITULO_DO_GRUPO[grupo])}</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {doGrupo.map((s) => (
                <CartaoDaTrilha
                  key={s.id}
                  s={s}
                  dados={d}
                  recomendada={s.id === d.recomendada}
                  aberta={aberta === s.id}
                  aoAbrir={() => setAberta((a) => (a === s.id ? null : s.id))}
                />
              ))}
            </div>
          </section>
        );
      })}

      <section className="flex flex-col gap-2 rounded-lg border p-4" data-testid="guias-curtos">
        <h2 className="text-base font-semibold">{t("\"Como faço\" em qualquer tela: os guias curtos")}</h2>
        <p className="text-sm text-text-muted">
          {t("Trilha é um objetivo de vários passos. O guia curto é o manual de uma tela, com o mesmo destaque. Pergunte \"como faço\" ao assistente em qualquer tela: quando o manual tem tela, a resposta traz o \"Me mostra como\".")}
        </p>
        <ul className="flex flex-col gap-2">
          {GUIAS_CURTOS.map((g) => {
            const s = d.trilhas.find((x) => x.id === g.id);
            return (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <span>{t(g.titulo)}</span>
                {s ? <BotaoMeMostraComo trilha={g.id} /> : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-1 rounded-lg border p-4 text-sm" data-testid="quando-conta-como-feita">
        <h2 className="text-base font-semibold">{t("Quando uma trilha conta como feita")}</h2>
        <p>
          <strong>{t("As de pôr de pé são da empresa.")}</strong>{" "}
          {t("Ligar o número, montar o agente, o horário da IA e o convite ficam feitos para todos quando aparecem no sistema, com quem fez.")}
        </p>
        <p>
          <strong>{t("As de aprender são de cada pessoa.")}</strong>{" "}
          {t("Funil, follow-up, relatório, campanha, importação e as do dia a dia ficam feitas para quem fez.")}
        </p>
        <p>
          <strong>{t("O \"onde parei\" é sempre da pessoa.")}</strong> {t("Pausar a sua não muda a trilha de ninguém.")}
        </p>
        <p>
          <strong>{t("Nada conta pelo clique em \"concluir\".")}</strong> {t("Não existe esse botão: o assistente lê o sistema.")}
        </p>
        <p className="text-text-muted">
          {t("Trilha pausada é lembrada uma vez, no resumo da manhã do dia seguinte, para quem tem o resumo ligado. Nunca no WhatsApp.")}
        </p>
      </section>
    </div>
  );
}

function Numero({ rotulo, valor, nota, pequeno }: { rotulo: string; valor: string; nota: string; pequeno?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-text-muted">{rotulo}</p>
      <p className={cn("font-semibold", pequeno ? "text-sm" : "text-2xl")}>{valor}</p>
      <p className="text-xs text-text-muted">{nota}</p>
    </div>
  );
}

function CartaoDaTrilha({
  s,
  dados,
  recomendada,
  aberta,
  aoAbrir,
}: {
  s: SituacaoDaTrilhaNaTela;
  dados: EstadoDasTrilhas;
  recomendada: boolean;
  aberta: boolean;
  aoAbrir: () => void;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const pedir = usePedirAPessoa();
  const [pediu, setPediu] = useState(false);
  const trilha = trilhaPorId(s.id) as Trilha;
  const data = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(tag, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  const quemPode = trilha.papel === "admin" ? dados.quem_pode?.admin : (dados.quem_pode?.manager ?? dados.quem_pode?.admin);
  const dependeDe = s.esperando ? trilhaPorId(s.esperando) : null;

  const estado =
    s.estado === "feita"
      ? s.feita_na_empresa
        ? `${t("Feita na empresa")}${s.quem_fez ? ` · ${s.quem_fez}` : ""}`
        : `${t("Feita por você em")} ${data(s.quando)}`
      : s.estado === "pausada"
        ? `${t("Pausada no passo")} ${(s.passo ?? 0) + 1} ${t("de")} ${s.de} · ${data(s.quando)}`
        : s.estado === "andando"
          ? `${t("Em andamento")} · ${t("passo")} ${(s.passo ?? 0) + 1} ${t("de")} ${s.de}`
          : s.estado === "espera"
            ? `${t("Depois de")}: ${dependeDe ? t(dependeDe.titulo) : ""}`
            : s.estado === "sem_modulo"
              ? t("Precisa do módulo contratado. Fale com a Time Company.")
              : t("Não começada");

  return (
    <article
      className={cn("flex flex-col gap-2 rounded-lg border p-4", recomendada ? "border-primary" : "", s.do_papel ? "" : "opacity-90")}
      data-testid={`trilha-${s.id}`}
    >
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">{t(trilha.titulo)}</h3>
        <p className="text-sm text-text-muted">{t(trilha.objetivo)}</p>
      </div>
      <div className="flex flex-wrap gap-1">
        {recomendada ? <Badge variant="info">{t("Recomendada agora")}</Badge> : null}
        <Badge variant="neutral">{trilha.tempo}</Badge>
        <Badge variant="neutral">{t(rotuloDoPapelDaTrilha(trilha.papel))}</Badge>
        {s.do_papel ? null : <Badge variant="warning">{t("não é do seu papel")}</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge
          variant={
            s.estado === "feita" ? "success" : s.estado === "pausada" ? "warning" : s.estado === "andando" ? "info" : "neutral"
          }
        >
          {s.estado === "feita"
            ? t("Feita")
            : s.estado === "pausada"
              ? t("Pausada")
              : s.estado === "andando"
                ? t("Em andamento")
                : s.estado === "espera"
                  ? t("Esperando outra")
                  : s.estado === "sem_modulo"
                    ? t("Sem o módulo")
                    : t("Não começada")}
        </Badge>
        <span className="text-xs text-text-muted">{estado}</span>
      </div>
      {s.estado === "pausada" || s.estado === "andando" ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden>
          <div className="h-full bg-primary" style={{ width: `${Math.round((((s.passo ?? 0) + 0.5) / s.de) * 100)}%` }} />
        </div>
      ) : null}

      {aberta ? (
        <div className="flex flex-col gap-2 rounded-md bg-surface-muted p-3 text-sm">
          <ol className="list-decimal space-y-1 pl-5">
            {trilha.passos.map((p, i) => (
              <li key={i}>
                {t(p.texto)}{" "}
                <span className="text-xs text-text-muted">
                  ({t("Eu confiro")}: {t(p.confere)}
                  {p.soVoce ? ` · ${t("clique só seu")}` : ""}
                  {p.fora ? ` · ${t("acontece fora do sistema")}` : ""})
                </span>
              </li>
            ))}
          </ol>
          <p>
            <strong>{t("Pronto quando")}</strong> {t(trilha.pronto)}
          </p>
          <p>
            <strong>{t("Eu faço por você, com aprovação")}:</strong> {t(trilha.euFaco)}
          </p>
          <p>
            <strong>{t("Só você faz")}:</strong> {t(trilha.soVoce)}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {s.do_papel && s.estado === "espera" && dependeDe ? (
          <BotaoMeMostraComo trilha={dependeDe.id} rotulo={`${t("Começar")}: ${t(dependeDe.titulo)}`} />
        ) : (
          <BotaoMeMostraComo trilha={s.id} variante={recomendada ? "default" : "outline"} />
        )}
        <Button type="button" size="sm" variant="ghost" className="h-11 lg:h-8" onClick={aoAbrir} aria-expanded={aberta}>
          {aberta ? t("Fechar os passos") : s.estado === "feita" ? t("Rever os passos") : t("Ver os passos")}
        </Button>
        {!s.do_papel && quemPode ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-11 lg:h-8"
            disabled={pediu || pedir.isPending}
            onClick={() =>
              pedir.mutate(
                {
                  paraUserId: quemPode.user_id,
                  pedido: `${t("Me ajuda com a trilha")} "${t(trilha.titulo)}"`,
                  caminho: "/app/assistente",
                },
                {
                  onSuccess: () => {
                    setPediu(true);
                    toast.success(`${t("Pedido enviado pela Central de avisos para")} ${quemPode.nome}.`);
                  },
                  onError: () => toast.error(t("Não deu para mandar o pedido agora.")),
                },
              )
            }
          >
            {pediu ? t("Pedido enviado") : `${t("Pedir a")} ${quemPode.nome.split(/\s+/)[0]}`}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
