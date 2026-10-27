"use client";

/**
 * FORK MIA (.91, .94) · O CARTÃO DA PROPOSTA do assistente (fase 2 do desenho
 * do upstream, #2860; protótipo "ensina e faz", telas 3 e 5): uma peça, o que
 * muda, e a decisão.
 *
 *   Aprovar e aplicar   quem pode fazer o mesmo na tela (o servidor diz)
 *   Pedir a <nome>      quem não aprova: o cartão vai pronto a quem aprova,
 *                       no assistente e no sino, e o resultado volta aqui
 *   Ajustar             antes de aprovar: o que o cartão mostra é o que vai
 *                       ser gravado
 *   Recusar             quem aprova, ou quem pediu
 *   Desfazer            depois de aplicada, enquanto nada depende da peça; se
 *                       algo depende, o cartão diz o porquê e leva até a tela
 *
 * A situação, quem pode o quê e a trava do desfazer vêm do SERVIDOR
 * (`lib/assistente/propostas/leitura.ts`): o cartão relê depois de cada clique e
 * não decide permissão.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDecidirProposta, usePropostas } from "@/hooks/assistente/usePrimeirosPassos";
import { useAjustarProposta, useDesfazerProposta, usePedirProposta } from "@/hooks/assistente/usePropostasDoAssistente";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { CATALOGO_DAS_PECAS } from "@/lib/assistente/propostas/catalogo";
import type { CampoDeAjuste, PropostaNoCartao } from "@/lib/assistente/propostas/tipos";

export interface CartaoDaPropostaProps {
  propostaId: string;
  titulo: string;
  mudancas: ReadonlyArray<{ rotulo: string; valor: string }>;
}

/** O cartão que vem no meio da conversa: lê a proposta pelo id. */
export function CartaoDaProposta({ propostaId, titulo, mudancas }: CartaoDaPropostaProps) {
  const estado = usePropostas([propostaId]);
  const proposta = estado.data?.propostas.find((p) => p.id === propostaId) ?? null;
  return <CartaoDaPropostaLida proposta={proposta} tituloDeReserva={titulo} mudancasDeReserva={mudancas} carregando={estado.isLoading} />;
}

const campo = "w-full rounded-md border bg-background px-2 py-1.5 text-sm";

function Ajuste({
  campos,
  enviando,
  aoEnviar,
}: {
  campos: readonly CampoDeAjuste[];
  enviando: boolean;
  aoEnviar: (valores: Record<string, string>) => void;
}) {
  const t = useT();
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(campos.map((c) => [c.campo, c.valor])));
  const mudar = (k: string, v: string) => setValores((x) => ({ ...x, [k]: v }));
  return (
    <form
      className="flex flex-col gap-2 rounded-md border bg-surface-elevated p-2"
      onSubmit={(e) => {
        e.preventDefault();
        const mudou = Object.fromEntries(Object.entries(valores).filter(([k, v]) => campos.find((c) => c.campo === k)?.valor !== v));
        aoEnviar(mudou);
      }}
    >
      {campos.map((c) => (
        <label key={c.campo} className="flex flex-col gap-1 text-xs">
          <span className="text-text-muted">{t(c.rotulo)}</span>
          {c.tipo === "area" ? (
            <textarea className={`${campo} min-h-20`} value={valores[c.campo] ?? ""} onChange={(e) => mudar(c.campo, e.target.value)} />
          ) : c.tipo === "escolha" ? (
            <select className={`${campo} h-11 lg:h-9`} value={valores[c.campo] ?? ""} onChange={(e) => mudar(c.campo, e.target.value)}>
              {(c.opcoes ?? []).map((o) => (
                <option key={o.valor} value={o.valor}>
                  {t(o.rotulo)}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={`${campo} h-11 lg:h-9`}
              type={c.tipo === "data_hora" ? "datetime-local" : c.tipo === "numero" ? "number" : "text"}
              inputMode={c.tipo === "numero" ? "decimal" : undefined}
              value={valores[c.campo] ?? ""}
              onChange={(e) => mudar(c.campo, e.target.value)}
            />
          )}
        </label>
      ))}
      <div>
        <Button type="submit" size="sm" className="h-11 lg:h-8" disabled={enviando}>
          {enviando ? t("Atualizando...") : t("Pronto, atualiza o cartão")}
        </Button>
      </div>
    </form>
  );
}

/** O cartão desenhado a partir da proposta já lida (a conversa e as listas da página). */
export function CartaoDaPropostaLida({
  proposta,
  tituloDeReserva,
  mudancasDeReserva,
  carregando = false,
}: {
  proposta: PropostaNoCartao | null;
  tituloDeReserva?: string;
  mudancasDeReserva?: ReadonlyArray<{ rotulo: string; valor: string }>;
  carregando?: boolean;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const router = useRouter();
  const decidir = useDecidirProposta();
  const desfazer = useDesfazerProposta();
  const pedir = usePedirProposta();
  const ajustar = useAjustarProposta();
  const [ajustando, setAjustando] = useState(false);

  const situacao = proposta?.situacao ?? "pendente";
  const aberta = situacao === "pendente" || situacao === "aprovada";
  const peca = proposta ? CATALOGO_DAS_PECAS[proposta.tipo] : null;
  const titulo = proposta?.titulo ?? tituloDeReserva ?? "";
  const mudancas = proposta?.mudancas ?? mudancasDeReserva ?? [];
  const quando = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(tag, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  const primeiroNome = (nome: string | null | undefined) => (nome ?? "").trim().split(/\s+/)[0] ?? "";
  const ocupado = decidir.isPending || desfazer.isPending || pedir.isPending || ajustar.isPending;

  const falhou = (e: unknown) => toast.error(t(e instanceof Error && e.message ? e.message : "Não deu para fazer isso agora."));

  function decidirA(decisao: "aplicar" | "rejeitar") {
    if (!proposta) return;
    decidir.mutate(
      { id: proposta.id, decisao },
      {
        onSuccess: (r) => {
          toast.success(r.desfecho === "rejeitada" ? t("Proposta recusada. Nada mudou.") : t("Aplicado. A tela já mostra o que mudou."));
          router.refresh();
        },
        onError: falhou,
      },
    );
  }

  if (!proposta && carregando) {
    return (
      <div className="rounded-lg border bg-background p-3 text-sm text-text-muted" data-testid="cartao-da-proposta" data-situacao="carregando">
        {titulo}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-sm"
      data-testid="cartao-da-proposta"
      data-situacao={situacao}
      data-tipo={proposta?.tipo ?? ""}
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong className="min-w-0">{titulo}</strong>
        {proposta?.risco === "seguro" ? <Badge variant="success">{t("seguro")}</Badge> : <Badge variant="warning">{t("atenção")}</Badge>}
        <Badge variant="neutral">{t("1 proposta = 1 peça")}</Badge>
      </div>
      {peca ? (
        <p className="text-xs text-text-muted">
          {t("Onde:")} {t(peca.onde)}
        </p>
      ) : null}

      {aberta ? (
        <>
          <dl className="grid gap-1">
            {mudancas.map((m) => (
              <div key={`${m.rotulo}-${m.valor}`} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
                <dt className="text-xs text-text-muted">{t(m.rotulo)}</dt>
                <dd className="whitespace-pre-line break-words text-xs">{m.valor}</dd>
              </div>
            ))}
          </dl>
          {proposta?.aviso ? <p className="rounded-md bg-info-bg p-2 text-xs text-info-fg">{t(proposta.aviso)}</p> : null}
          {proposta?.erro ? (
            <p role="alert" className="rounded-md bg-warning-bg p-2 text-xs text-warning-fg">
              {t("Não deu para aplicar:")} {proposta.erro}
            </p>
          ) : null}
          {ajustando && proposta && proposta.ajustes.length > 0 ? (
            <Ajuste
              campos={proposta.ajustes}
              enviando={ajustar.isPending}
              aoEnviar={(campos) => {
                if (Object.keys(campos).length === 0) {
                  setAjustando(false);
                  return;
                }
                ajustar.mutate(
                  { id: proposta.id, campos },
                  {
                    onSuccess: () => {
                      setAjustando(false);
                      toast.success(t("Cartão atualizado: é isso que vai ser gravado."));
                    },
                    onError: falhou,
                  },
                );
              }}
            />
          ) : null}
          {proposta ? (
            <p className="text-xs text-text-muted">
              <b>{t("Quem aprova:")}</b> {t(proposta.quem_aprova)}. {peca ? <><b>{t("Desfazer:")}</b> {t(peca.desfazer)}.</> : null}
              {proposta.pedida_em && proposta.pedida_a_nome ? (
                <>
                  {" "}
                  {t("Pedido por")} {proposta.quem_pediu ?? ""} {t("a")} {proposta.pedida_a_nome} {t("em")} {quando(proposta.pedida_em)}.{" "}
                  {primeiroNome(proposta.pedida_a_nome)} {t("vê no assistente e no sino.")}
                </>
              ) : null}
            </p>
          ) : null}
          {proposta ? (
            <div className="flex flex-wrap items-center gap-2">
              {proposta.pode_aprovar ? (
                <Button type="button" size="sm" className="h-11 lg:h-8" disabled={ocupado} onClick={() => decidirA("aplicar")}>
                  {decidir.isPending ? t("Aplicando...") : t("Aprovar e aplicar")}
                </Button>
              ) : proposta.pode_pedir && proposta.pedir_a[0] ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-11 lg:h-8"
                  disabled={ocupado}
                  onClick={() =>
                    pedir.mutate(
                      { id: proposta.id, para_user_id: proposta.pedir_a[0]!.user_id },
                      {
                        onSuccess: (r) => toast.success(`${t("Pedido enviado a")} ${primeiroNome(r.para.nome)}, ${t("com o cartão pronto.")}`),
                        onError: falhou,
                      },
                    )
                  }
                >
                  {t("Pedir a")} {primeiroNome(proposta.pedir_a[0].nome)}
                </Button>
              ) : null}
              {proposta.pode_ajustar && proposta.ajustes.length > 0 ? (
                <Button type="button" size="sm" variant="outline" className="h-11 lg:h-8" disabled={ocupado} onClick={() => setAjustando((x) => !x)}>
                  {ajustando ? t("Fechar o ajuste") : t("Ajustar")}
                </Button>
              ) : null}
              {proposta.pode_recusar ? (
                <Button type="button" size="sm" variant="ghost" className="h-11 lg:h-8" disabled={ocupado} onClick={() => decidirA("rejeitar")}>
                  {t("Recusar")}
                </Button>
              ) : null}
              {!proposta.pode_aprovar && proposta.pedida_em && proposta.pedida_a_nome ? (
                <span className="text-xs text-text-muted">
                  {t("Esperando")} {primeiroNome(proposta.pedida_a_nome)}.
                </span>
              ) : null}
              {!proposta.pode_aprovar && !proposta.pode_pedir && !proposta.pedida_em ? (
                <span className="text-xs text-text-muted">{t("Quem aprova decide no assistente dele.")}</span>
              ) : null}
            </div>
          ) : null}
        </>
      ) : situacao === "aplicada" && proposta ? (
        <>
          <p className="flex items-start gap-1 text-xs">
            <Badge variant="success">{t("aplicada")}</Badge>
            <span>
              {t("Aplicada por")} {proposta.aprovada_por_nome ?? ""} {t("em")} {quando(proposta.aplicada_em)}.{" "}
              {t("Entrou no registro como \"via assistente\".")}
            </span>
          </p>
          {proposta.trava_do_desfazer ? (
            <p className="rounded-md bg-warning-bg p-2 text-xs text-warning-fg">
              {t("Não dá mais para desfazer:")} {proposta.trava_do_desfazer.motivo}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" className="h-11 lg:h-8" onClick={() => router.push(proposta.href)}>
              {proposta.trava_do_desfazer ? t("Me leva até a tela") : t("Ver na tela")}
            </Button>
            {proposta.pode_desfazer ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-11 lg:h-8"
                disabled={ocupado}
                onClick={() =>
                  desfazer.mutate(proposta.id, {
                    onSuccess: (r) => {
                      toast.success(r.desfecho === "ja_estava" ? t("Já estava desfeita.") : t("Desfeito. A tela voltou a ser como era."));
                      router.refresh();
                    },
                    onError: falhou,
                  })
                }
              >
                {desfazer.isPending ? t("Desfazendo...") : t("Desfazer")}
              </Button>
            ) : null}
          </div>
        </>
      ) : proposta ? (
        <p className="text-xs text-text-muted" data-testid="fim-da-proposta">
          {situacao === "desfeita"
            ? `${t("Desfeita por")} ${proposta.desfeita_por_nome ?? ""} ${t("em")} ${quando(proposta.desfeita_em)}. ${t("A tela voltou a ser como era.")}`
            : situacao === "rejeitada"
              ? `${t("Recusada por")} ${proposta.rejeitada_por_nome ?? ""}. ${t("Nada mudou.")}`
              : t("Venceu sem decisão. Nada mudou.")}
        </p>
      ) : null}
    </div>
  );
}
