"use client";

/**
 * FORK MIA (.88) — uma mensagem do assistente da MIA: o texto, o "de onde veio"
 * e os botões (Me leva lá, Pedir à pessoa, Mandar ao suporte, o rascunho do
 * chamado). O botão só navega para tela do app (`hrefDoApp`): o histórico é
 * gravado pela sessão da própria pessoa, e a tela confere de novo.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAbrirChamado, usePedirAPessoa } from "@/hooks/assistente/useAssistente";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { hrefDoApp, ROTULO_DA_FONTE, type AcaoDoAssistente, type MensagemDoAssistente as Mensagem } from "@/lib/assistente/tipos";
import { cn } from "@/lib/utils";

import { CartaoDoChamado } from "./CartaoDoChamado";
// FORK MIA (.91): o cartão da proposta do assistente.
import { CartaoDaProposta } from "./CartaoDaProposta";
import { TextoDoAssistente } from "./TextoDoAssistente";

export function MensagemDoAssistente({
  mensagem,
  caminho,
  conversaId,
  aoNavegar,
}: {
  mensagem: Mensagem;
  caminho: string;
  conversaId: string | null;
  aoNavegar?: () => void;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const daPessoa = mensagem.tipo === "pergunta";
  const quando = new Date(mensagem.created_at).toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });

  if (daPessoa) {
    return (
      <div className="flex justify-end" data-testid="mensagem-da-pessoa">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
          {mensagem.texto}
          <span className="sr-only"> · {quando}</span>
        </div>
      </div>
    );
  }

  const acoes = Array.isArray(mensagem.acoes) ? mensagem.acoes : [];
  return (
    <div className="flex justify-start" data-testid="mensagem-do-assistente" data-tipo={mensagem.tipo}>
      <div
        className={cn(
          "flex max-w-[92%] flex-col gap-2 rounded-2xl rounded-bl-sm border bg-surface-muted px-3 py-2 text-sm",
          mensagem.erro ? "border-warning-fg/40" : "",
        )}
      >
        {mensagem.tipo === "resposta_do_chamado" ? (
          <Badge variant="info" className="self-start">
            {t("Resposta da Time Company")}
          </Badge>
        ) : null}
        {mensagem.tipo === "resumo_da_manha" ? (
          <Badge variant="default" className="self-start">
            {t("Resumo da manhã")}
          </Badge>
        ) : null}
        <TextoDoAssistente texto={mensagem.texto} />

        {acoes.length > 0 ? (
          <div className="flex flex-col gap-2">
            {acoes.map((acao, i) => (
              <Acao key={`${acao.tipo}-${i}`} acao={acao} caminho={caminho} conversaId={conversaId} aoNavegar={aoNavegar} />
            ))}
          </div>
        ) : null}

        {mensagem.fontes.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1 text-xs text-text-muted" data-testid="de-onde-veio">
            <span>{t("De onde veio")}:</span>
            {mensagem.fontes.map((fonte) => (
              <Badge key={fonte} variant="neutral">
                {ROTULO_DA_FONTE[fonte] ? t(ROTULO_DA_FONTE[fonte]) : fonte}
              </Badge>
            ))}
          </div>
        ) : null}
        <span className="text-[11px] text-text-muted">{quando}</span>
      </div>
    </div>
  );
}

function Acao({
  acao,
  caminho,
  conversaId,
  aoNavegar,
}: {
  acao: AcaoDoAssistente;
  caminho: string;
  conversaId: string | null;
  aoNavegar?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const pedir = usePedirAPessoa();
  const abrir = useAbrirChamado();
  const [feito, setFeito] = useState(false);

  if (acao.tipo === "chamado") {
    return <CartaoDoChamado rascunho={acao.rascunho} caminho={caminho} conversaId={conversaId} />;
  }

  // FORK MIA (.91): a proposta de uma peça, com "Aprovar e aplicar" e "Recusar".
  if (acao.tipo === "proposta") {
    return <CartaoDaProposta propostaId={acao.proposta_id} titulo={acao.titulo} mudancas={acao.mudancas} />;
  }

  if (acao.tipo === "ir") {
    const href = hrefDoApp(acao.href);
    if (!href) return null;
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-11 self-start lg:h-8"
        onClick={() => {
          aoNavegar?.();
          router.push(href);
        }}
      >
        {t(acao.rotulo)}
      </Button>
    );
  }

  if (acao.tipo === "pedir") {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-11 self-start lg:h-8"
        disabled={feito || pedir.isPending}
        onClick={() =>
          pedir.mutate(
            { paraUserId: acao.para_user_id, pedido: acao.pedido, caminho },
            {
              onSuccess: () => {
                setFeito(true);
                toast.success(`${t("Pedido enviado pela Central de avisos para")} ${acao.para_nome}.`);
              },
              onError: () => toast.error(t("Não deu para mandar o pedido agora.")),
            },
          )
        }
      >
        {feito ? t("Pedido enviado") : acao.rotulo.replace(/^Pedir a/, t("Pedir a"))}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      className="h-11 self-start lg:h-8"
      disabled={feito || abrir.isPending}
      onClick={() =>
        abrir.mutate(
          { tipo: "duvida", texto: acao.pergunta, mensagemDoSistema: null, caminho, conversaId, print: null },
          {
            onSuccess: (r) => {
              setFeito(true);
              if (r.demonstracao && r.aviso) toast.info(r.aviso);
              else toast.success(`${t("Pergunta enviada ao suporte da Time. Chamado")} #${r.chamado.numero}.`);
            },
            onError: (e) => toast.error(t(e instanceof Error ? e.message : "Não deu para abrir o chamado agora.")),
          },
        )
      }
    >
      {feito ? t("Enviada ao suporte") : t(acao.rotulo)}
    </Button>
  );
}
