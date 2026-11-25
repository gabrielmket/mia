"use client";
/**
 * FORK MIA · coexistência (S3): "Contatos e histórico do app", a tela 3 do
 * protótipo v3 aprovado pelo Gabriel em 17/11/2026.
 *
 * Só contagens: nenhum nome nem trecho de conversa. O estado geral segue o
 * pedido do HISTÓRICO (o que a empresa mais espera); o de contatos aparece no
 * número de contatos e na nota "este pedido deu certo".
 */
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { NumeroPeloAppNaTela } from "@/hooks/channels/useCoexistencia";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";

import { estadoGeralDaSincronizacao, type EstadoGeral } from "./estado-geral";

export { estadoGeralDaSincronizacao, type EstadoGeral };

export function SeloDaSincronizacao({ estado }: { estado: EstadoGeral }) {
  const t = useT();
  const rotulo: Record<EstadoGeral, string> = {
    pedida: t("Pedida"),
    andamento: t("Em andamento"),
    concluida: t("Concluída"),
    falhou: t("Falhou"),
    recusou: t("Dono não compartilhou o histórico"),
    incerto: t("Sem resposta da Meta"),
    prazo: t("Prazo vencido"),
  };
  const variante: Record<EstadoGeral, "default" | "success" | "error" | "warning"> = {
    pedida: "default",
    andamento: "default",
    concluida: "success",
    falhou: "error",
    recusou: "warning",
    incerto: "warning",
    prazo: "warning",
  };
  return (
    <Badge variant={variante[estado]} data-testid="coexistencia-selo-da-sincronizacao" data-estado={estado}>
      {rotulo[estado]}
    </Badge>
  );
}

function Numero({ rotulo, valor, nota }: { rotulo: string; valor: number; nota?: string }) {
  const tag = useTagDeIdioma();
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-text-muted">{rotulo}</div>
      <div className="text-xl font-semibold">{valor.toLocaleString(tag)}</div>
      {nota ? <div className="text-xs text-text-muted">{nota}</div> : null}
    </div>
  );
}

function Passos({ estado }: { estado: EstadoGeral }) {
  const t = useT();
  const indice = estado === "pedida" ? 0 : estado === "andamento" ? 1 : estado === "concluida" ? 2 : -1;
  const passos = [t("Pedida"), t("Em andamento"), t("Concluída")];
  return (
    <ol className="my-3 flex flex-wrap gap-4 text-sm">
      {passos.map((rotulo, i) => {
        const feito =
          (indice >= 0 && (i < indice || (i === indice && estado === "concluida"))) || (estado === "recusou" && i === 0);
        const atual = indice === i && estado !== "concluida";
        const falhou = (estado === "falhou" || estado === "incerto" || estado === "prazo") && i === 0;
        return (
          <li key={rotulo} className={`flex items-center gap-2 ${atual ? "font-medium" : feito ? "" : "text-text-muted"}`}>
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${
                falhou ? "border-error-fg text-error-fg" : feito ? "border-success-fg text-success-fg" : "border-border"
              }`}
            >
              {falhou ? "!" : feito ? "✓" : i + 1}
            </span>
            {rotulo}
          </li>
        );
      })}
    </ol>
  );
}

function trechoDaFase(fase: number | null, t: (s: string) => string): string {
  if (fase === 2) return t("de 90 a 180 dias atrás");
  if (fase === 1) return t("de 1 a 90 dias atrás");
  return t("de 0 a 1 dia atrás");
}

export function CartaoDaSincronizacao({ numero, empresa }: { numero: NumeroPeloAppNaTela; empresa: string | null }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const quando = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(tag, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
  const estado = estadoGeralDaSincronizacao(numero.pedidos);
  const contatos = numero.pedidos.find((p) => p.tipo === "contatos");
  const historico = numero.pedidos.find((p) => p.tipo === "historico");
  const nContatos = contatos?.contatosRecebidos ?? 0;
  const nConversas = historico?.conversasRecebidas ?? 0;
  const nMensagens = historico?.mensagensRecebidas ?? 0;
  const textoDoPedido = t(
    "A MIA pediu à Meta os contatos ({contatos}) e o histórico ({historico}). Agora é a Meta que manda, em partes. Deixe o app aberto no celular para ajudar.",
  )
    .replace("{contatos}", quando(contatos?.pedidaEm ?? null))
    .replace("{historico}", quando(historico?.pedidaEm ?? null));
  const textoDaConclusao = t(
    "Sincronização concluída em {quando}. Chegaram os contatos e as conversas individuais dos últimos 180 dias. Grupos não vêm.",
  ).replace("{quando}", quando(historico?.concluidaEm ?? null));
  const textoDasMidias = t("Mídias guardadas: {n} (a Meta só manda mídia das últimas 2 semanas).").replace(
    "{n}",
    (historico?.midiasGuardadas ?? 0).toLocaleString(tag),
  );

  return (
    <Card className="p-4" id="sincronizacao" data-testid="coexistencia-sincronizacao">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">{t("Contatos e histórico do app")}</h2>
        <SeloDaSincronizacao estado={estado} />
      </div>
      <p className="mt-1 text-xs text-text-muted">
        {[empresa, numero.phoneNumber].filter(Boolean).join(" · ")} · {t("conectado em")} {quando(numero.conectadaEm)} ·{" "}
        {t("prazo da Meta até")} {quando(numero.prazoDaSincronizacao)}
      </p>
      <p className="mt-2 text-sm text-text-muted">
        {t(
          "Logo depois de conectar, a MIA pede à Meta os contatos e o histórico do app. A Meta só aceita esse pedido uma vez e até 24 horas depois da conexão.",
        )}
      </p>
      <Passos estado={estado} />

      {estado === "pedida" ? (
        <p className="rounded-md border border-border bg-surface-elevated p-3 text-sm">
          {textoDoPedido}
        </p>
      ) : null}

      {estado === "andamento" ? (
        <>
          <p className="text-sm">
            {t("Progresso informado pela Meta:")} <strong>{historico?.progresso ?? 0}%</strong> · {t("trecho atual:")}{" "}
            <strong>{trechoDaFase(historico?.fase ?? null, t)}</strong>
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-elevated">
            <div className="h-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, historico?.progresso ?? 0))}%` }} />
          </div>
        </>
      ) : null}

      {estado === "concluida" ? (
        <p className="rounded-md bg-success-bg p-3 text-sm text-success-fg">
          {textoDaConclusao}
        </p>
      ) : null}

      {estado === "falhou" ? (
        <div className="rounded-md bg-error-bg p-3 text-sm text-error-fg">
          <strong>{t("A Meta recusou o pedido do histórico")}</strong> ({quando(historico?.respondidaEm ?? historico?.pedidaEm ?? null)}).{" "}
          {t("Motivo informado:")} &quot;{historico?.erroCodigo ? `${t("código")} ${historico.erroCodigo}` : ""}
          {historico?.erroTitulo ? `, ${historico.erroTitulo}` : ""}&quot;.
          <br />
          <strong>{t("Não há segunda tentativa automática:")}</strong>{" "}
          {t(
            "a Meta só aceita este pedido uma vez. Para tentar de novo, o número precisa ser desconectado no app e conectado outra vez por aqui. O suporte da MIA foi avisado.",
          )}
        </div>
      ) : null}

      {estado === "recusou" ? (
        <p className="rounded-md bg-warning-bg p-3 text-sm text-warning-fg">
          {t(
            "O dono escolheu não compartilhar o histórico no app (a Meta avisou com o código 2593109). Os contatos chegam; as conversas antigas ficam só no celular. As novas chegam normalmente.",
          )}
        </p>
      ) : null}

      {estado === "incerto" ? (
        <p className="rounded-md bg-warning-bg p-3 text-sm text-warning-fg">
          <strong>{t("A MIA pediu, mas não recebeu a resposta da Meta")}</strong>{" "}
          {t(
            "(a conexão caiu no meio). Não dá para saber se a Meta aceitou. A MIA não pede de novo sozinha, porque um segundo pedido pode ser recusado e queimar a chance. Se o histórico começar a chegar, a tela passa para \"em andamento\" sozinha. O suporte da MIA foi avisado e decide.",
          )}
        </p>
      ) : null}

      {estado === "prazo" ? (
        <p className="rounded-md bg-warning-bg p-3 text-sm text-warning-fg">
          {t(
            "Passaram as 24 horas que a Meta dá para pedir a sincronização depois da conexão, e o pedido não saiu. A MIA não pede de novo sozinha. O suporte da MIA foi avisado.",
          )}
        </p>
      ) : null}

      {estado !== "incerto" ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Numero
            rotulo={t("Contatos")}
            valor={nContatos}
            nota={estado === "falhou" && contatos && contatos.estado !== "falhou" ? t("este pedido deu certo") : undefined}
          />
          <Numero rotulo={t("Conversas")} valor={nConversas} />
          <Numero rotulo={t("Mensagens")} valor={nMensagens} />
        </div>
      ) : null}

      {estado === "andamento" ? (
        <p className="mt-3 rounded-md border border-border bg-surface-elevated p-3 text-sm">
          {t(
            "O que chega entra como histórico: a IA não responde, nada de follow-up, automação, conversão da Meta, atividade de vendedor, data de etapa nem \"última mensagem\". As conversas antigas nascem encerradas.",
          )}
        </p>
      ) : null}
      {estado === "concluida" ? (
        <p className="mt-2 text-xs text-text-muted">
          {textoDasMidias}
        </p>
      ) : null}
      {estado === "falhou" ? (
        <p className="mt-2 text-xs text-text-muted">{t("As mensagens novas, a partir de agora, chegam normalmente. Só o passado não veio.")}</p>
      ) : null}
      <p className="mt-3 text-xs text-text-muted">{t("A tela mostra só contagens: nenhum nome nem trecho de conversa.")}</p>
    </Card>
  );
}
