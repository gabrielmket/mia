"use client";

/**
 * O QUE ESTE CLIENTE CONSUMIU — e quanto ele custa para servir.
 *
 * A aba existia marcada `disabled`. A diferença entre esta tela e o
 * `/admin/usage` geral não é o dado, é a PERGUNTA: lá se compara clientes
 * ("quem gasta mais"); aqui se responde sobre um ("está crescendo? o custo
 * acompanha?") — a conversa de renovação e de reajuste.
 *
 * Os dois lados do custo juntos, e é o ponto: separados, cada número parece
 * pequeno.
 *
 * FORK MIA (MIA-44): "Este mês" e "Mês passado" (calendário de Brasília) ao lado
 * das janelas de dias, o custo de IA também em R$, e duas tabelas: por agente,
 * com a linha "Sistema" (as chamadas sem agente), e por finalidade. Os números
 * são os de `plataforma_ver_consumo_de_ia`, da mesma leitura
 * (`lib/ai/usage/consumo-do-periodo.ts`). Documento: `docs/fork/consumo-de-ia.md`.
 */
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useUsoDoTenant, type UsoDoTenant as DadosDoUso } from "@/hooks/useUsoDoTenant";
import {
  ATALHOS_DE_PERIODO,
  pedidoDoAtalho,
  type AtalhoDePeriodo,
} from "@/lib/ai/usage/atalhos-de-periodo";
import type { LinhaDeConsumo } from "@/lib/ai/usage/consumo-do-periodo";

function emDolar(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "USD" });
}
function emReais(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
/** `custo_brl` da leitura já vem em REAIS, não em centavos. */
function reais(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** O rótulo do botão: "7 dias" nas janelas, "Este mês" e "Mês passado" nos meses. */
function rotuloDoAtalho(atalho: AtalhoDePeriodo, t: (s: string) => string): string {
  if (atalho === "este_mes") return t("Este mês");
  if (atalho === "mes_passado") return t("Mês passado");
  const pedido = pedidoDoAtalho(atalho);
  return `${pedido.tipo === "dias" ? pedido.dias : ""} ${t("dias")}`;
}

export function UsoDoTenant({ organizationId }: { organizationId: string }) {
  const t = useT();
  const [atalho, setAtalho] = useState<AtalhoDePeriodo>("30d");
  const { data, isLoading, error } = useUsoDoTenant(organizationId, pedidoDoAtalho(atalho));

  if (isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  if (error || !data) {
    return <p className="text-sm text-error-fg">{t("Não consegui carregar o uso agora.")}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {ATALHOS_DE_PERIODO.map((a) => (
          <Button
            key={a.valor}
            variant={a.valor === atalho ? "default" : "secondary"}
            onClick={() => setAtalho(a.valor)}
          >
            {rotuloDoAtalho(a.valor, t)}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Movimento")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              {t("Conversas")}: <strong>{data.conversas}</strong>
            </p>
            <p>
              {t("Mensagens")}: <strong>{data.mensagens}</strong>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Custo de IA")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <strong>{emDolar(data.ia.custo_usd_cents)}</strong>
              {/* FORK MIA (MIA-44): o mesmo custo em real, cada dia pela cotação dele. */}
              <span className="text-text-muted"> · {reais(data.consumo.total.custo_brl)}</span>
            </p>
            {data.consumo.reais.dias_sem_cotacao.length > 0 && (
              <p className="text-error-fg">
                {t("O valor em R$ é parcial: dias sem cotação")}:{" "}
                {data.consumo.reais.dias_sem_cotacao.length}
              </p>
            )}
            <p className="text-text-muted">
              {data.ia.chamadas} {t("chamadas")} · {data.ia.tokens.toLocaleString()} {t("tokens")}
            </p>
            {data.ia.truncado && (
              <p className="text-error-fg">
                {/* Sem este aviso o número se lê como total e a conta fecha
                    menor que a realidade. */}
                {t("A leitura foi cortada — o custo real é maior.")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <ConsumoPorAgente consumo={data.consumo} />
      <ConsumoPorFinalidade consumo={data.consumo} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Custo das mensagens (Meta)")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            <strong>{emReais(data.mensagens_cobradas.totalCentavos)}</strong>{" "}
            <span className="text-text-muted">
              · {data.mensagens_cobradas.total} {t("cobradas")}
            </span>
          </p>
          {data.mensagens_cobradas.truncado && (
            <p className="text-error-fg">
              {/* O mesmo aviso do custo de IA, acima: sem ele o número se lê
                  como total. */}
              {t("A leitura foi cortada — o custo real é maior.")}
            </p>
          )}
          <ul className="space-y-0.5 text-text-muted">
            {data.mensagens_cobradas.linhas.map((l) => (
              <li key={l.categoria}>
                {l.categoria}: {l.cobradas}
                {l.totalCentavos === null
                  ? ` · ${t("sem preço cadastrado")}`
                  : ` · ${emReais(l.totalCentavos)}`}
              </li>
            ))}
          </ul>
          {data.mensagens_cobradas.semPreco.length > 0 && (
            <p className="text-error-fg">
              {t("O total está incompleto: falta cadastrar o preço de")}{" "}
              {data.mensagens_cobradas.semPreco.join(", ")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FORK MIA (MIA-44): as quebras do custo de IA, no estilo da `UsageTable`.
// ---------------------------------------------------------------------------

type Consumo = DadosDoUso["consumo"];

/** As colunas de número comuns às duas tabelas: chamadas, tokens, cache, US$ e R$. */
function CelulasDoConsumo({ linha, forte = false }: { linha: LinhaDeConsumo; forte?: boolean }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const peso = forte ? " font-medium" : "";
  return (
    <>
      <TableCell className={`text-right text-sm tabular-nums${peso}`}>
        {linha.chamadas.toLocaleString(tag)}
      </TableCell>
      <TableCell className={`text-right text-sm tabular-nums${peso}`}>
        {(linha.tokens_entrada + linha.tokens_saida).toLocaleString(tag)}
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums text-text-muted">
        {linha.tokens_do_cache.toLocaleString(tag)}
      </TableCell>
      <TableCell className={`text-right text-sm tabular-nums${peso}`}>
        {emDolar(linha.custo_usd_cents)}
        {linha.sem_preco > 0 && (
          <span className="block text-xs font-normal text-text-muted">
            {linha.sem_preco} {t("chamadas sem preço")}
          </span>
        )}
      </TableCell>
      <TableCell className={`text-right text-sm tabular-nums${peso}`}>{reais(linha.custo_brl)}</TableCell>
    </>
  );
}

function CabecalhoDoConsumo({ primeira }: { primeira: string }) {
  const t = useT();
  return (
    <TableHeader>
      <TableRow>
        <TableHead>{primeira}</TableHead>
        <TableHead className="text-right">{t("Chamadas")}</TableHead>
        <TableHead className="text-right">Tokens</TableHead>
        <TableHead className="text-right">{t("Do cache")}</TableHead>
        <TableHead className="text-right">US$</TableHead>
        <TableHead className="text-right">R$</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function ConsumoPorAgente({ consumo }: { consumo: Consumo }) {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("Custo de IA por agente")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="rounded-md border">
          <Table>
            <CabecalhoDoConsumo primeira={t("Agente")} />
            <TableBody>
              {consumo.por_agente.map((a) => (
                <TableRow key={a.agent_id}>
                  <TableCell className="text-sm">
                    {/* O agente apagado deixa as chamadas: a linha fica, sem nome. */}
                    {a.nome ?? <span className="text-text-muted">{t("Agente removido")}</span>}
                    {a.arquivado && (
                      <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px]">
                        {t("arquivado")}
                      </Badge>
                    )}
                  </TableCell>
                  <CelulasDoConsumo linha={a} />
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="text-sm">{t("Sistema")}</TableCell>
                <CelulasDoConsumo linha={consumo.sistema} />
              </TableRow>
              <TableRow>
                <TableCell className="text-sm font-medium">{t("Total")}</TableCell>
                <CelulasDoConsumo linha={consumo.total} forte />
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-text-muted">
          {t(
            "Sistema são as chamadas sem agente: o resumo depois da conversa, os classificadores e a transcrição. \"Do cache\" é parte dos tokens de entrada.",
          )}
        </p>
      </CardContent>
    </Card>
  );
}

function ConsumoPorFinalidade({ consumo }: { consumo: Consumo }) {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("Custo de IA por finalidade")}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {consumo.por_finalidade.length === 0 ? (
          <p className="text-text-muted">{t("Nenhuma chamada de IA no período.")}</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <CabecalhoDoConsumo primeira={t("Finalidade")} />
              <TableBody>
                {consumo.por_finalidade.map((f) => (
                  <TableRow key={f.finalidade}>
                    {/* O código de `llm_calls.purpose`, como o banco grava. */}
                    <TableCell className="font-mono text-xs">{f.finalidade}</TableCell>
                    <CelulasDoConsumo linha={f} />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
