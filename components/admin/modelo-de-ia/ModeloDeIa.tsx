"use client";

/**
 * O CÉREBRO PADRÃO DA INSTALAÇÃO.
 *
 * Quem escolhe é quem opera a plataforma. O cliente não vê e não troca — ele
 * comprou atendimento, não a tarefa de comparar `gpt-4.1` com `claude-sonnet`.
 *
 * A tela mostra o PREÇO ao lado de cada modelo porque essa é a decisão de
 * verdade sendo tomada aqui: o custo por conversa é nosso, e trocar de modelo é
 * mexer na margem de todos os clientes de uma vez.
 *
 * ── Por que a operadora é FILTRO, e não um primeiro passo obrigatório ──────
 *
 * O pedido foi "escolher a operadora e depois o modelo". Uma cascata literal
 * (escolhe a operadora, o campo do modelo zera, escolhe o modelo) inventa um
 * estado que não existe no contrato de gravação: `platform_ia` aceita os dois
 * campos preenchidos ou os dois nulos — nunca "operadora sim, modelo não". Esse
 * meio-caminho teria de virar ou um Salvar travado sem explicação, ou um
 * pré-preenchimento do `is_default_for_provider` que ninguém leu, gravando uma
 * margem por conta própria.
 *
 * Como FILTRO, a operadora entrega a mesma interação — escolher a operadora e
 * então ver só os modelos dela — sem criar o estado meio-escolhido, e ainda
 * permite "Todas", que é onde se compara preço ENTRE fabricantes. A decisão
 * aqui é de margem, não de marca.
 *
 * ── Por que a busca fica FORA do `<Select>` ───────────────────────────────
 *
 * Radix Select captura o teclado para o typeahead dele e gerencia o foco: um
 * `<input>` dentro de `<SelectContent>` briga com os dois. Não há Command nem
 * combobox neste repositório, e inventar um aqui seria trocar um seletor
 * acessível de verdade por um caseiro.
 *
 * E a busca não é enfeite: `lib/ai/agents/escolher-modelo.ts` registra a
 * medição de um ambiente real com 400 modelos da OpenRouter sincronizados, 333
 * deles chamando ferramenta. Nessa instalação, a lista sem busca é inutilizável.
 *
 * ── O QUE ESTA TELA PRECISA GRITAR, e não gritava ─────────────────────────
 *
 * Duas escolhas feitas aqui não dão erro AQUI e param a publicação de todo
 * cliente novo dias depois, na implantação seguinte
 * (`lib/ai/agents/first-publication.ts`):
 *
 *   modelo fora do catálogo   `model_not_found` — publicação recusada
 *   operadora sem chave       `sem_chave` — publicação recusada
 *
 * Nos dois casos o cliente termina o wizard com "Atendente criado, mas ainda
 * não está no ar", longe desta tela e de quem mexeu nela. Por isso os avisos
 * abaixo dizem o EFEITO ("nenhum cliente novo publica") e não o rótulo
 * ("modelo obsoleto").
 */
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { useModeloDeIa, useSalvarModeloDeIa } from "@/hooks/useModeloDeIa";
import {
  AUTOMATICO,
  itensDoSeletor,
  TODAS,
  type ModeloParaSeletor,
} from "@/lib/ai/seletor-de-modelo";

function precoPorMilhao(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "USD" });
}

function rotuloDoModelo(m: ModeloParaSeletor): string {
  const preco = precoPorMilhao(m.input_price_per_million_cents);
  return `${m.provider} · ${m.display_name ?? m.model_id}${preco ? ` · ${preco}/M` : ""}`;
}

export function ModeloDeIa() {
  const t = useT();
  const { data, isLoading, error } = useModeloDeIa();
  const salvar = useSalvarModeloDeIa();

  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [operadora, setOperadora] = useState<string>(TODAS);
  const [busca, setBusca] = useState("");

  const modelos = useMemo(() => data?.modelos ?? [], [data]);
  const operadoras = useMemo(
    () => [...new Set(modelos.map((m) => m.provider))].sort(),
    [modelos],
  );

  if (isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  if (error || !data) {
    return (
      <p className="text-sm text-error-fg">
        {t("Não consegui carregar o catálogo de modelos agora.")}
      </p>
    );
  }

  const atual = data.escolha?.model_id
    ? `${data.escolha.provider}::${data.escolha.model_id}`
    : AUTOMATICO;
  const valor = escolhido ?? atual;

  /**
   * A REGRA mora em `lib/ai/seletor-de-modelo.ts`, e não aqui.
   *
   * O que ela garante — Automático imune aos filtros, valor CORRENTE sempre
   * presente (não só o salvo), e os dois motivos de injeção separados — é
   * invisível num teste de renderização: o Radix só monta `SelectContent`
   * quando o menu está aberto. Como função pura, cada garantia tem caso próprio.
   */
  const lista = itensDoSeletor({ modelos, operadora, busca, valor });

  const operadoraDoValor = valor === AUTOMATICO ? null : (valor.split("::")[0] ?? null);
  const semChave =
    operadoraDoValor !== null && data.chave_da_instalacao[operadoraDoValor] === false;

  const catalogoVazio = modelos.length === 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("Modelo de IA da plataforma")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-text-muted">
            {t(
              "Vale para todo cliente novo. Quem contrata não escolhe o modelo — assim como não escolhe a chave de IA: é engrenagem nossa, e a conta também.",
            )}
          </p>

          {catalogoVazio ? (
            /* Catálogo vazio numa tela de plataforma é DEFEITO, não estado
               calmo: significa que o automático escolhe de uma lista vazia. */
            <p
              data-testid="catalogo-vazio"
              className="rounded-md border border-amber-500/40 bg-amber-50/60 p-3 text-sm dark:bg-amber-900/10"
            >
              {t(
                "O catálogo não tem nenhum modelo que saiba usar ferramentas. Enquanto estiver assim, não dá para fixar modelo — e o automático escolhe da mesma lista vazia.",
              )}
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="operadora-de-ia">{t("Operadora de IA")}</Label>
                  <Select value={operadora} onValueChange={setOperadora}>
                    <SelectTrigger id="operadora-de-ia">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODAS}>{t("Todas as operadoras")}</SelectItem>
                      {operadoras.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                          {data.chave_da_instalacao[p] === false
                            ? ` · ${t("sem chave nesta instalação")}`
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-text-muted">
                    {t("Filtra a lista abaixo. Não é a escolha — quem decide é o modelo.")}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="busca-de-modelo">{t("Buscar modelo")}</Label>
                  <Input
                    id="busca-de-modelo"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder={t("nome ou identificador (ex: sonnet, gpt-4.1)")}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="text-xs text-text-muted" data-testid="contador-de-modelos">
                    {lista.filtrados === lista.total
                      ? `${lista.total} ${t("modelos no catálogo")}`
                      : `${lista.filtrados} ${t("de")} ${lista.total} ${t("modelos")}`}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="modelo-de-ia">{t("Modelo")}</Label>
                <Select value={valor} onValueChange={setEscolhido}>
                  <SelectTrigger id="modelo-de-ia" className="sm:w-[36rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {lista.itens.map((item) => {
                      if (item.valor === AUTOMATICO) {
                        return (
                          <SelectItem key={AUTOMATICO} value={AUTOMATICO}>
                            {t("Automático (o sistema escolhe pelo catálogo)")}
                          </SelectItem>
                        );
                      }
                      const sufixo =
                        item.injetado === "fora_do_catalogo"
                          ? ` · ${t("fora do catálogo")}`
                          : item.injetado === "fora_do_filtro"
                            ? ` · ${t("fora do filtro")}`
                            : "";
                      return (
                        <SelectItem key={item.valor} value={item.valor}>
                          {item.modelo
                            ? `${rotuloDoModelo(item.modelo)}${sufixo}`
                            : `${item.valor.replace("::", " · ")}${sufixo}`}
                        </SelectItem>
                      );
                    })}

                    {lista.filtroNaoCasa && (
                      /* Texto puro, NUNCA um SelectItem: item exige `value` e
                         viraria coisa selecionável e salvável. */
                      <div className="px-2 py-3 text-xs text-text-muted">
                        {t(
                          "Nenhum modelo passa por esse filtro. Continuam na lista o Automático e o que está valendo agora.",
                        )}
                      </div>
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-text-muted">
                  {/* O requisito não é preferência: o agente opera por ferramentas,
                      e modelo sem tool calling responde texto plausível sem criar
                      lead nenhum — falha que ninguém percebe por semanas. */}
                  {t(
                    "A lista traz só os modelos que sabem usar ferramentas — é o que o agente precisa para mexer no funil.",
                  )}
                </p>
              </div>

              {lista.filtroNaoCasa && (
                <button
                  type="button"
                  className="text-xs underline underline-offset-2"
                  onClick={() => {
                    setBusca("");
                    setOperadora(TODAS);
                  }}
                >
                  {t("Limpar filtros")}
                </button>
              )}
            </>
          )}

          {/*
            O AVISO GRAVE. Modelo fora do catálogo não é cosmético: com ele
            fixado, `first-publication.ts` devolve `model_not_found` e NENHUM
            cliente novo publica agente. Dizer "continua valendo" seria
            descrever o registro no banco em vez do efeito no produto.
          */}
          {lista.foraDoCatalogo && (
            <p
              data-testid="aviso-fora-do-catalogo"
              className="rounded-md border border-red-500/40 bg-red-50/60 p-3 text-sm dark:bg-red-900/10"
            >
              {t(
                "O modelo fixado saiu do catálogo (obsoleto, ou deixou de usar ferramentas). Enquanto ele estiver aqui, NENHUM cliente novo consegue publicar agente. Escolha outro e salve.",
              )}
            </p>
          )}

          {semChave && !lista.foraDoCatalogo && (
            <p
              data-testid="aviso-sem-chave"
              className="rounded-md border border-amber-500/40 bg-amber-50/60 p-3 text-sm dark:bg-amber-900/10"
            >
              {t(
                "Esta instalação não tem chave desta operadora. Cliente novo não tem credencial própria, então ele não vai conseguir publicar agente com este modelo — cadastre a chave antes de salvar.",
              )}
            </p>
          )}

          <Button
            disabled={salvar.isPending || valor === atual || catalogoVazio}
            onClick={() => {
              const [provider, modelId] =
                valor === AUTOMATICO ? [null, null] : valor.split("::");
              salvar.mutate(
                { provider: provider ?? null, model_id: modelId ?? null },
                { onSuccess: () => setEscolhido(null) },
              );
            }}
          >
            {salvar.isPending ? t("Salvando…") : t("Salvar")}
          </Button>

          {data.escolha?.model_id && (
            <p className="text-sm text-text-muted">
              {t(
                "Agentes já publicados continuam com o modelo que tinham — a troca vale para os próximos.",
              )}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
