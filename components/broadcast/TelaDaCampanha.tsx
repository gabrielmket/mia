"use client";

/**
 * A TELA DE UMA CAMPANHA — porque inline não aguenta três mil.
 *
 * A lista de destinatários vivia dentro do cartão da campanha. Funciona com
 * três; com três mil, ela empurra o resto da página para fora da tela e obriga
 * a rolar até o fim para descobrir se sobrou alguém sem receber.
 *
 * ─── O que esta tela responde primeiro ────────────────────────────────────
 *
 * "Quantos falharam?" — e responde ANTES de qualquer lista, porque é a única
 * pergunta que alguém tem ao abrir uma campanha já disparada. Ninguém abre para
 * ver quem recebeu; abre para ver quem NÃO recebeu, e por quê.
 *
 * Por isso o resumo por estado é clicável: ele não é enfeite, é o filtro. Um
 * número que diz "120 falharam" e não leva às 120 é uma promessa pela metade.
 */
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { usePaginaDaCampanha } from "@/hooks/useDestinatarios";

const ESTADOS = ["pendente", "enviada", "entregue", "lida", "falhou", "estornada"] as const;

function tom(estado: string): "default" | "secondary" | "destructive" | "outline" {
  if (estado === "falhou" || estado === "estornada") return "destructive";
  if (estado === "entregue" || estado === "lida") return "default";
  return "secondary";
}

export function TelaDaCampanha({ id }: { id: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const [filtro, setFiltro] = useState<string | null>(null);
  const [inicio, setInicio] = useState(0);
  const { data, isLoading, error } = usePaginaDaCampanha(id, filtro, inicio);

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;
  if (error || !data) {
    return <p className="text-sm text-error-fg">{t("Não consegui carregar a campanha agora.")}</p>;
  }

  const fim = Math.min(inicio + (data.limite ?? 200), data.total);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {ESTADOS.map((e) => {
          const n = data.resumo?.[e] ?? 0;
          // Estado sem ninguém não vira botão: um "0 lida" clicável leva a uma
          // lista vazia, e a tela gasta a atenção de quem procura o que falhou.
          if (n === 0) return null;
          const ativo = filtro === e;
          return (
            <Button
              key={e}
              variant={ativo ? "default" : "secondary"}
              onClick={() => {
                setFiltro(ativo ? null : e);
                // Voltar ao início: manter a página 8 depois de filtrar mostraria
                // uma lista vazia com cara de "não há nenhum".
                setInicio(0);
              }}
            >
              {n} {t(e)}
            </Button>
          );
        })}
        {filtro && (
          <Button variant="outline" onClick={() => { setFiltro(null); setInicio(0); }}>
            {t("Ver todos")}
          </Button>
        )}
      </div>

      <Card className="divide-y divide-border">
        {data.destinatarios.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {t("Nenhum destinatário neste estado.")}
          </p>
        ) : (
          data.destinatarios.map((d) => (
            <div key={d.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:gap-3">
              <span className="min-w-0 flex-1 font-medium">
                {d.nome ?? t("(sem cadastro)")}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{d.telefone}</span>
              <Badge variant={tom(d.status)}>{t(d.status)}</Badge>
              {d.enviado_em && (
                <span className="text-xs text-muted-foreground">
                  {new Date(d.enviado_em).toLocaleString(tag)}
                </span>
              )}
              {d.erro && (
                // O erro DA LINHA, inteiro. É a única coisa que explica por que
                // aquela pessoa não recebeu — e resumir aqui obrigaria a abrir
                // outra tela para saber o que já está gravado.
                <span className="text-xs text-error-fg">{d.erro}</span>
              )}
            </div>
          ))
        )}
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {inicio + 1}–{fim} {t("de")} {data.total}
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={inicio === 0}
            onClick={() => setInicio(Math.max(0, inicio - (data.limite ?? 200)))}
          >
            {t("Anterior")}
          </Button>
          <Button
            variant="secondary"
            disabled={fim >= data.total}
            onClick={() => setInicio(inicio + (data.limite ?? 200))}
          >
            {t("Próxima")}
          </Button>
        </div>
      </div>
    </div>
  );
}
