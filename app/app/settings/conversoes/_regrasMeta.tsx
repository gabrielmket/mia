"use client";

/**
 * FORK MIA — o que cada etapa do funil informa à META (migration 9017).
 *
 * A mesma régua que o Google Ads já tem logo abaixo (`_regrasGoogle.tsx`, do
 * upstream), com o que a Meta pede de diferente: aqui se escolhe o EVENTO (a
 * Meta não tem "ação de conversão" para criar), e o evento pode levar valor.
 *
 * Um funil por vez: o seletor troca o funil, e "Salvar regras" grava só as
 * etapas do funil que está na tela. Ganho é a compra (o cartão da conexão, logo
 * acima) e perda não é conversão: nenhuma das duas aparece, e a tela diz por quê.
 *
 * As regras puras (eventos, recomendado, sequência) moram em
 * `lib/conversoes-meta/eventos.ts`, que não toca em nada de servidor.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { salvarRegrasDeConversaoMeta } from "@/app/actions/settings/conversoesDaMeta";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  aplicarRecomendado,
  CANAIS_DE_ENTRADA_DA_META,
  COMPRA_NA_META,
  eventoDaMeta,
  EVENTOS_DA_META,
  MODOS_DO_VALOR,
  passosDoFunil,
  regraInicial,
  ROTULO_DO_CANAL_DA_META,
  type CanalDeEntradaDaMeta,
  type ChaveDoEventoDaMeta,
  type ModoDoValor,
  type RegraDaEtapa,
} from "@/lib/conversoes-meta/eventos";
import type { FunilDaRegua, RegraDeConversaoMeta } from "@/lib/conversoes-meta/regras";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { formatCentsBRL, parseReaisToCents } from "@/lib/money";

/** O rascunho de uma etapa: a regra, mais o valor fixo como a pessoa o digitou. */
interface Rascunho extends RegraDaEtapa {
  valorDigitado: string;
}

const ERRO_EM_PORTUGUES: Record<string, string> = {
  validation_failed: "Confira os campos: algum valor não está no formato esperado.",
  valor_fixo_invalido: "Toda etapa com valor fixo precisa de um valor maior que zero.",
  unauthenticated: "Sua sessão expirou. Entre de novo.",
  forbidden_tenant: "Você não está em nenhuma organização ativa.",
  forbidden_role: "Só um administrador da organização pode mudar estas regras.",
  mfa_required: "Confirme o segundo fator para salvar esta mudança.",
  etapa_invalida: "Uma das etapas não existe mais ou foi fechada. Atualize a página.",
  erro_ao_gravar: "Não consegui gravar agora. Tente de novo em instantes.",
};

function emReais(centavos: number | null): string {
  if (centavos === null) return "";
  return (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function rascunhosIniciais(funis: FunilDaRegua[], regras: RegraDeConversaoMeta[]): Record<string, Rascunho> {
  const porEtapa = new Map(regras.map((r) => [r.stageId, r]));
  const saida: Record<string, Rascunho> = {};
  for (const funil of funis) {
    funil.etapas.forEach((etapa, i) => {
      const salva = porEtapa.get(etapa.id);
      const regra: RegraDaEtapa = salva
        ? {
            ligada: salva.ligada,
            evento: salva.evento,
            canal: salva.canal,
            modoDoValor: salva.modoDoValor,
            valorFixoCentavos: salva.valorFixoCentavos,
          }
        : regraInicial(etapa.nome, i);
      saida[etapa.id] = { ...regra, valorDigitado: emReais(regra.valorFixoCentavos) };
    });
  }
  return saida;
}

/** Só o que é gravado: o texto digitado não entra na comparação de "mudou". */
function retrato(r: Rascunho | undefined): string {
  if (!r) return "";
  const valor = r.modoDoValor === "valor_fixo" ? parseReaisToCents(r.valorDigitado) : null;
  return [r.ligada, r.evento, r.canal, r.modoDoValor, valor].join("|");
}

export function RegrasDeConversaoMeta({
  funis,
  regras,
  conexao,
  idioma,
}: {
  funis: FunilDaRegua[];
  regras: RegraDeConversaoMeta[];
  /** O estado da conexão da Meta, para o quadro dizer a verdade sobre o que sai. */
  conexao: { conectada: boolean; habilitada: boolean; emTeste: boolean };
  idioma: Idioma;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const comEtapas = useMemo(() => funis.filter((f) => f.etapas.length > 0), [funis]);
  const iniciais = useMemo(() => rascunhosIniciais(funis, regras), [funis, regras]);
  const [rascunhos, setRascunhos] = useState(iniciais);
  const [funilId, setFunilId] = useState(comEtapas[0]?.id ?? "");
  const [salvoAgora, setSalvoAgora] = useState<string | null>(null);

  const funil = comEtapas.find((f) => f.id === funilId) ?? comEtapas[0];

  if (!funil) {
    return (
      <Card className="p-6 text-sm text-muted-foreground" data-testid="regras-meta-por-etapa">
        {t("Crie um funil com etapas para escolher o que cada etapa informa à Meta.")}
      </Card>
    );
  }

  const mudou = funil.etapas.some((e) => retrato(rascunhos[e.id]) !== retrato(iniciais[e.id]));
  const passos = passosDoFunil(funil.etapas, rascunhos);
  const ligadas = passos.length;

  function mudar(id: string, parcial: Partial<Rascunho>) {
    setSalvoAgora(null);
    setRascunhos((atual) => ({ ...atual, [id]: { ...atual[id]!, ...parcial } }));
  }

  function usarRecomendado() {
    setSalvoAgora(null);
    let quantas = 0;
    const novo = { ...rascunhos };
    funil!.etapas.forEach((etapa, i) => {
      const atual = novo[etapa.id]!;
      const sugerido = aplicarRecomendado(atual, etapa.nome, i === 0);
      if (sugerido.ligada) quantas += 1;
      novo[etapa.id] = {
        ...sugerido,
        valorDigitado: sugerido.modoDoValor === "valor_fixo" ? atual.valorDigitado : "",
      };
    });
    setRascunhos(novo);
    toast.message(`${t("Recomendado aplicado pelo nome das etapas. Etapas ligadas:")} ${quantas}. ${t("Confira e salve.")}`);
  }

  function salvar() {
    const linhas = funil!.etapas.map((etapa) => {
      const r = rascunhos[etapa.id]!;
      return {
        stage_id: etapa.id,
        ligada: r.ligada,
        evento: r.evento,
        canal: r.canal,
        modo_do_valor: r.modoDoValor,
        valor_fixo_centavos: r.modoDoValor === "valor_fixo" ? parseReaisToCents(r.valorDigitado) : null,
      };
    });
    if (linhas.some((l) => l.modo_do_valor === "valor_fixo" && !(l.valor_fixo_centavos && l.valor_fixo_centavos > 0))) {
      toast.error(t("Toda etapa com valor fixo precisa de um valor maior que zero."));
      return;
    }
    startTransition(async () => {
      const resultado = await salvarRegrasDeConversaoMeta(linhas);
      if (resultado.ok) {
        setSalvoAgora(funil!.id);
        toast.success(t("Regras salvas. Vale para os negócios que entrarem nas etapas a partir de agora."));
        router.refresh();
        return;
      }
      toast.error(t(ERRO_EM_PORTUGUES[resultado.error] ?? "Não consegui salvar agora."));
    });
  }

  function valorDoPasso(modo: ModoDoValor, centavos: number | null): string {
    if (modo === "valor_fixo") return centavos ? formatCentsBRL(centavos) : t("valor fixo");
    if (modo === "valor_do_negocio") return t("valor do negócio");
    return t("sem valor");
  }

  return (
    <Card className="flex flex-col gap-4 p-6" data-testid="regras-meta-por-etapa">
      <div className="max-w-2xl">
        <h3 className="font-medium">{t("O que cada etapa do funil informa à Meta")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "Uma linha por etapa aberta do funil. Ligada, a Meta recebe o evento escolhido quando um negócio entra naquela etapa, uma vez por negócio. É a mesma régua que o Google Ads tem logo abaixo.",
          )}
        </p>
      </div>

      {!conexao.conectada ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          {t("A Meta ainda não está conectada. Você pode montar e salvar as regras; nada é enviado até a conexão acima estar preenchida e ligada.")}
        </p>
      ) : !conexao.habilitada ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          {t("O envio está pausado no cartão da Meta: nem a compra nem as etapas vão para a Meta enquanto ele estiver desligado.")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="meta-funil">{t("Funil")}</Label>
          <select
            id="meta-funil"
            className="rounded-md border bg-background p-2 text-sm"
            value={funil.id}
            onChange={(ev) => {
              setFunilId(ev.target.value);
              setSalvoAgora(null);
            }}
          >
            {comEtapas.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" variant="outline" onClick={usarRecomendado}>
          {t("Usar o recomendado")}
        </Button>
        <span className="text-sm text-muted-foreground" data-testid="etapas-informando-a-meta">
          {ligadas} {t("de")} {funil.etapas.length} {t("etapas informando a Meta")}
        </span>
        {mudou ? (
          <span
            className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs"
            data-testid="regras-meta-nao-salvas"
          >
            {t("alterações não salvas")}
          </span>
        ) : null}
      </div>

      <ul className="flex flex-col gap-3">
        {funil.etapas.map((etapa, i) => {
          const r = rascunhos[etapa.id]!;
          const evento = eventoDaMeta(r.evento);
          return (
            <li key={etapa.id} className="rounded-md border p-4" data-testid={`regra-meta-${etapa.id}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{etapa.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {i + 1}
                    {t("ª etapa")}
                    {" · "}
                    {r.ligada ? t("informa a Meta") : t("não informa")}
                  </p>
                </div>
                <Switch
                  aria-label={`${t("Informar a Meta na etapa")} ${etapa.nome}`}
                  checked={r.ligada}
                  onCheckedChange={(v) => mudar(etapa.id, { ligada: v })}
                />
              </div>

              {r.ligada && (
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`meta-evento-${etapa.id}`}>{t("Evento")}</Label>
                    <select
                      id={`meta-evento-${etapa.id}`}
                      className="rounded-md border bg-background p-2 text-sm"
                      value={r.evento}
                      onChange={(ev) => mudar(etapa.id, { evento: ev.target.value as ChaveDoEventoDaMeta })}
                    >
                      {EVENTOS_DA_META.map((e) => (
                        <option key={e.chave} value={e.chave}>
                          {t(e.rotulo)}
                        </option>
                      ))}
                    </select>
                    <p className="font-mono text-xs text-muted-foreground">{evento.nomeTecnico}</p>
                    {!evento.naListaDaMensagem && (
                      <p className="text-xs text-muted-foreground">
                        {t(
                          "Evento fora da lista da Meta para anúncio de WhatsApp: pode ser recusado ou não servir para otimizar. Confira com o código de teste.",
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`meta-canal-${etapa.id}`}>{t("Canal de entrada")}</Label>
                    <select
                      id={`meta-canal-${etapa.id}`}
                      className="rounded-md border bg-background p-2 text-sm"
                      value={r.canal}
                      onChange={(ev) => mudar(etapa.id, { canal: ev.target.value as CanalDeEntradaDaMeta })}
                    >
                      {CANAIS_DE_ENTRADA_DA_META.map((c) => (
                        <option key={c.valor} value={c.valor}>
                          {t(c.rotulo)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`meta-valor-${etapa.id}`}>{t("Valor do evento (opcional)")}</Label>
                    <div className="flex gap-2">
                      <select
                        id={`meta-valor-${etapa.id}`}
                        className="rounded-md border bg-background p-2 text-sm"
                        value={r.modoDoValor}
                        onChange={(ev) => mudar(etapa.id, { modoDoValor: ev.target.value as ModoDoValor })}
                      >
                        {MODOS_DO_VALOR.map((m) => (
                          <option key={m.valor} value={m.valor}>
                            {t(m.rotulo)}
                          </option>
                        ))}
                      </select>
                      {r.modoDoValor === "valor_fixo" && (
                        <Input
                          aria-label={`${t("Valor fixo em reais na etapa")} ${etapa.nome}`}
                          inputMode="decimal"
                          className="w-32"
                          value={r.valorDigitado}
                          onChange={(ev) => mudar(etapa.id, { valorDigitado: ev.target.value })}
                          placeholder="150,00"
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        {t(
          "Valor do evento: sem valor, a Meta não aprende quanto vale um agendamento. Use um valor fixo (quanto vale, em média, aquele passo) ou o valor do negócio. Negócio sem valor envia o evento de etapa sem valor.",
        )}
      </p>
      <p className="text-xs text-muted-foreground" data-testid="regras-meta-ganho-e-perda">
        {t("As etapas de ganho e de perda não aparecem na lista. Ganho é a compra. Perda não é conversão.")}
        {funil.ganho.length + funil.perda.length > 0 ? ` (${[...funil.ganho, ...funil.perda].join(", ")})` : ""}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={salvar} disabled={isPending}>
          {isPending ? t("Salvando...") : t("Salvar regras")}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t("Vale para os negócios que entrarem nas etapas a partir de agora.")}
        </span>
      </div>
      {salvoAgora === funil.id && !mudou ? (
        <p
          className="rounded-md border border-sky-500/40 bg-sky-500/10 p-3 text-sm"
          data-testid="regras-meta-salvas"
        >
          {t(
            "Regras salvas. Vale para os negócios que entrarem nas etapas a partir de agora. Quem já está na etapa não é enviado.",
          )}
        </p>
      ) : null}

      <section className="flex flex-col gap-2 border-t pt-4" data-testid="como-a-meta-enxerga">
        <h4 className="text-sm font-medium">{t("Como a Meta vai enxergar este funil")}</h4>
        <ol className="flex flex-wrap items-stretch gap-2">
          {passos.map((p) => {
            const evento = eventoDaMeta(p.evento);
            return (
              <li
                key={p.stageId}
                data-repetido={p.repetido ? "sim" : "nao"}
                className={
                  p.repetido
                    ? "flex min-w-40 flex-col gap-0.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
                    : "flex min-w-40 flex-col gap-0.5 rounded-md border p-3 text-xs"
                }
              >
                <span className="text-sm font-medium">
                  {t(evento.rotulo)} <span className="font-mono text-xs font-normal">{evento.nomeTecnico}</span>
                </span>
                <span className="text-muted-foreground">
                  {t("ao entrar em")} “{p.etapa}”
                </span>
                <span className="text-muted-foreground">
                  {t(ROTULO_DO_CANAL_DA_META[p.canal])}
                  {" · "}
                  {valorDoPasso(p.modoDoValor, p.valorFixoCentavos)}
                </span>
                {p.repetido && <span>{t("repetido: não envia de novo para o mesmo negócio")}</span>}
              </li>
            );
          })}
          <li
            className="flex min-w-40 flex-col gap-0.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs"
            data-testid="passo-da-compra"
          >
            <span className="text-sm font-medium">
              {t(COMPRA_NA_META.rotulo)}{" "}
              <span className="font-mono text-xs font-normal">{COMPRA_NA_META.nomeTecnico}</span>
            </span>
            <span className="text-muted-foreground">
              {t("quando o negócio é ganho")}
              {funil.ganho.length > 0 ? ` (“${funil.ganho.join("”, “")}”)` : ""}
            </span>
            <span className="text-muted-foreground">
              {conexao.conectada && conexao.habilitada
                ? t("valor do negócio, com a moeda dele")
                : t("desligada no cartão da Meta")}
            </span>
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">
          {ligadas === 0
            ? t("Nenhuma etapa ligada: a Meta só fica sabendo da compra, como é hoje.")
            : `${ligadas} ${t(ligadas === 1 ? "etapa informa a Meta antes da compra." : "etapas informam a Meta antes da compra.")} ${t("Quanto mais cedo o sinal, mais rápido o anúncio aprende quem vira cliente.")}`}
          {conexao.emTeste ? ` ${t("Modo de teste ligado: nada disso conta para a otimização.")}` : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          {t(
            "Só há o que informar quando o negócio veio de um clique em anúncio para o WhatsApp ou, com a chave abaixo ligada, de um formulário da Meta.",
          )}
        </p>
      </section>
    </Card>
  );
}
