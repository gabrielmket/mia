"use client";

/**
 * FORK MIA — as linhas novas do cartão fechado do funil.
 *
 * O cartão passa a responder CINCO perguntas sem abrir: quanto vale, vai
 * fechar, o que fazer agora, quem está tocando — e com quem está a bola. Cada
 * linha aqui tem ALTURA FIXA e existe sempre (com texto apagado quando falta o
 * dado): é o contrato de altura do cartão do upstream (docs/handoffs/
 * BRIEFING-crm-vivo.md §5) — o cartão não cresce com dados, ele troca de estado.
 *
 * Os dados vêm de `lead.cartao` (lib/cartoes/sinais-do-quadro.ts). Toda régua
 * de texto mora em `lib/cartoes/`, pura e testada: aqui é só desenho.
 */
import type { ReactNode } from "react";

import { useT } from "@/hooks/i18n/useT";
import { ArrowsClockwise, CalendarBlank, Flag, Warning } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types/leads";
import { quemFalouRotulo, type Bola } from "@/lib/cartoes/bola";
import { textoDoProximoCompromisso } from "@/lib/cartoes/compromisso";
import { valorCurto } from "@/lib/cartoes/dinheiro";
import { fechamentoPrevisto } from "@/lib/cartoes/fechamento";
import { ehPapel, ROTULO_DO_PAPEL } from "@/lib/cartoes/papel";
import { duracaoCurta } from "@/lib/cartoes/tempo";
import { ROTULO_DO_CANAL, SELO_DO_CANAL, type SinaisDoCartao } from "@/lib/cartoes/tipos";
import { textoDoAviso, type AvisoDoCartao } from "@/lib/obrigacoes/situacao";
import { useAgoraDoCartao, useContextoDoCartao } from "./ContextoDoCartao";

/** "recorrente" ao lado do título: a pessoa (ou a empresa) já comprou antes. */
export function SeloRecorrente({ compras }: { compras: SinaisDoCartao["compras"] }) {
  const t = useT();
  if (!compras) return null;
  const titulo = `${t("Já comprou")} ${compras.quantidade}x · ${valorCurto(compras.totalCents, compras.moeda)}`;
  return (
    <span
      title={titulo}
      aria-label={titulo}
      role="img"
      className="mt-0.5 inline-flex h-4 shrink-0 items-center gap-0.5 rounded-full bg-success-bg px-1.5 text-[10px] font-medium leading-4 text-success-fg"
    >
      <ArrowsClockwise size={10} weight="bold" aria-hidden />
      {t("recorrente")}
    </span>
  );
}

/** "Carla, sócia · decisora · +2 contatos" — a pessoa por trás da empresa. */
function textoDaPessoa(p: NonNullable<SinaisDoCartao["pessoa"]>, t: (x: string) => string): string {
  const primeiro = p.nome.split(/\s+/)[0] ?? p.nome;
  const partes = [p.cargo ? `${primeiro}, ${p.cargo.toLowerCase()}` : primeiro];
  if (ehPapel(p.papel)) partes.push(t(ROTULO_DO_PAPEL[p.papel]).toLowerCase());
  if (p.outros > 0) partes.push(p.outros === 1 ? `+1 ${t("contato")}` : `+${p.outros} ${t("contatos")}`);
  return partes.join(" · ");
}

/**
 * A linha de contexto: a SIGLA do canal (sempre) e, ao lado, a pessoa principal
 * quando o negócio é de uma empresa, ou a campanha quando é de uma pessoa.
 */
export function LinhaDeOrigem({ lead }: { lead: Pick<Lead, "cartao"> }) {
  const t = useT();
  const c = lead.cartao;
  if (!c) return null;
  const canal = t(ROTULO_DO_CANAL[c.canal.sigla]);
  const complemento = c.pessoa ? textoDaPessoa(c.pessoa, t) : (c.canal.campanha ?? canal);
  return (
    <p
      className="mt-0.5 flex h-4 min-w-0 items-center gap-1.5 text-[11px] leading-4 text-text-muted"
      title={`${canal}${c.canal.campanha ? ` · ${c.canal.campanha}` : ""}${c.pessoa ? ` · ${complemento}` : ""}`}
      data-canal={c.canal.sigla}
    >
      <span className="shrink-0 rounded-sm border border-border px-1 text-[9px] font-semibold uppercase leading-[14px] tracking-wide text-text">
        {t(SELO_DO_CANAL[c.canal.sigla])}
      </span>
      <span className="min-w-0 truncate">{complemento}</span>
    </p>
  );
}

function Linha({
  icone,
  titulo,
  className,
  children,
}: {
  icone: ReactNode;
  titulo: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      title={titulo}
      className={cn("flex h-5 min-w-0 items-center gap-1 text-[11px] leading-5", className)}
    >
      <span className="shrink-0" aria-hidden>
        {icone}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </p>
  );
}

/**
 * O próximo compromisso, EXPLÍCITO: "Visita ao decorado · Jardim das Flores ·
 * sáb 03/10 10h". Cortado com reticências; inteiro ao passar o mouse.
 */
export function LinhaDoCompromisso({ compromisso }: { compromisso: SinaisDoCartao["compromisso"] }) {
  const t = useT();
  const agora = useAgoraDoCartao();
  if (!compromisso) {
    return (
      <Linha
        icone={<CalendarBlank size={12} />}
        titulo={t("Nenhum compromisso marcado para este negócio")}
        className="text-text-muted"
      >
        {t("sem compromisso marcado")}
      </Linha>
    );
  }
  const texto = textoDoProximoCompromisso(compromisso, agora, t);
  return (
    <Linha
      icone={<CalendarBlank size={12} />}
      titulo={`${t("Próximo compromisso")}: ${texto.texto}`}
      className={texto.hoje ? "font-medium text-accent" : "text-text"}
    >
      {texto.texto}
    </Linha>
  );
}

/** "Fechamento previsto 31/10 · 78%" — separado do compromisso, de propósito. */
export function LinhaDoFechamento({
  lead,
}: {
  lead: Pick<Lead, "expected_close_date" | "score" | "status" | "cartao">;
}) {
  const t = useT();
  const agora = useAgoraDoCartao();
  const f = fechamentoPrevisto({
    dataPrevista: lead.expected_close_date,
    probabilidadeIa: lead.score?.probability ?? null,
    probabilidadeEtapa: lead.cartao?.chanceDaEtapa ?? null,
    aberto: lead.status === "open",
    agora,
  });
  const fonte =
    f.fonte === "ia"
      ? t("chance calculada pela IA")
      : f.fonte === "etapa"
        ? t("chance da etapa")
        : t("sem chance calculada");
  return (
    <Linha
      icone={<Flag size={12} />}
      titulo={`${t("Data prevista para fechar e chance de fechamento")} · ${fonte}`}
      className={f.atrasado ? "text-warning-fg" : "text-text-muted"}
    >
      {t("Fechamento previsto")}{" "}
      <b className="font-medium text-text">{f.data ?? t("sem data")}</b> ·{" "}
      <b className="font-medium text-text">{f.pct === null ? "—" : `${f.pct}%`}</b>
    </Linha>
  );
}

/** "· objeção: parcela" — ao lado do medidor, a objeção aberta mais recente. */
export function ObjecaoNaFaixa({ objecao }: { objecao: string | null | undefined }) {
  const t = useT();
  if (!objecao) return null;
  return (
    <span className="min-w-0 truncate text-text-muted" title={`${t("Objeção aberta")}: ${objecao}`}>
      · {t("objeção")}: {objecao}
    </span>
  );
}

/** "· 1 tarefa atrasada" no rodapé, junto do dono. Nada quando não há. */
export function TarefasAtrasadas({ n }: { n: number | undefined }) {
  const t = useT();
  if (!n) return null;
  return (
    <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-error-fg">
      · {n === 1 ? t("1 tarefa atrasada") : `${n} ${t("tarefas atrasadas")}`}
    </span>
  );
}

/**
 * O aviso de documentos e obrigações no rodapé: UM, o mais urgente ("Alvará
 * venceu há 3 dias", "Contrato social: pedido há 6 dias, sem resposta"). Nada
 * quando está tudo em dia. Mora DENTRO da linha do rodapé, cortado com
 * reticências e inteiro ao passar o mouse: o cartão não ganha altura.
 */
export function AvisoDeObrigacao({ aviso }: { aviso: AvisoDoCartao | null | undefined }) {
  const t = useT();
  if (!aviso) return null;
  const texto = textoDoAviso(aviso, t);
  return (
    <span
      title={texto}
      data-aviso-de-obrigacao={aviso.tipo}
      className={cn(
        "flex min-w-0 items-center gap-0.5 text-[11px] font-medium",
        aviso.tipo === "vencido" ? "text-error-fg" : aviso.tipo === "vencendo" ? "text-warning-fg" : "text-accent",
      )}
    >
      <Warning size={11} aria-hidden className="shrink-0" />
      <span className="min-w-0 truncate">{texto}</span>
    </span>
  );
}

/**
 * "Lead há 12 min:" antes da última mensagem. Em cor de alerta quando o lead
 * falou por último e ninguém respondeu — a bola é nossa.
 */
export function PrefixoDaBola({ bola }: { bola: Bola }) {
  const t = useT();
  const ctx = useContextoDoCartao();
  const agora = useAgoraDoCartao();
  const quem = quemFalouRotulo(bola, { ...ctx, t });
  const tempo = duracaoCurta(agora.getTime() - new Date(bola.desde).getTime(), t);
  const quando = tempo === t("agora") ? tempo : t("há {tempo}").replace("{tempo}", tempo);
  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap",
        bola.com === "nos" ? "font-medium text-warning-fg" : "text-text-muted",
      )}
    >
      {quem} {quando}:
    </span>
  );
}

/** "bola: nós" / "bola: cliente" no fim da linha da conversa. */
export function SeloDaBola({ bola }: { bola: Bola }) {
  const t = useT();
  const nos = bola.com === "nos";
  return (
    <span
      title={
        nos
          ? t("O lead falou por último e ninguém respondeu")
          : t("Falamos por último; aguardando o cliente")
      }
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full px-1.5 text-[10px] font-medium",
        nos ? "bg-warning-bg text-warning-fg" : "bg-surface-muted text-text-muted",
      )}
    >
      {t("bola")}: {nos ? t("nós") : t("cliente")}
    </span>
  );
}
