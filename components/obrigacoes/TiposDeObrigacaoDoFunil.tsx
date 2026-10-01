"use client";

/**
 * FORK MIA — o catálogo de TIPOS de obrigação de um funil, na tela onde o
 * funil é configurado (Configurações › Etapas do funil), ao lado dos campos.
 *
 * O tipo é o ponto de partida de um item: traz validade padrão, recorrência,
 * avisos, quem entrega e a quem se liga, e tudo pode ser mudado no item. "Usar
 * o modelo do segmento" instala de uma vez os tipos que o produto traz para
 * clínica, imobiliária, automotivo, academia e serviços B2B; os que o funil já
 * tem pelo nome ficam como estão.
 *
 * Tirar um tipo do catálogo não mexe nos itens que nasceram dele: cada item
 * guarda as próprias regras.
 */
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { useCatalogoDeObrigacoes, useTiposDeObrigacao } from "@/hooks/obrigacoes/useObrigacoes";
import {
  ROTULO_DO_SEGMENTO_DE_OBRIGACAO,
  SEGMENTOS_DE_OBRIGACAO,
  ehTipoSensivel,
  type SegmentoDeObrigacao,
} from "@/lib/obrigacoes/catalogo";
import { textoDaRecorrencia, textoDosAvisos } from "@/lib/obrigacoes/situacao";
import {
  LIGA_A,
  RECORRENCIAS,
  ROTULO_CURTO_DE_QUEM_ENTREGA,
  ROTULO_DA_CATEGORIA,
  ROTULO_DA_RECORRENCIA,
  ROTULO_DE_LIGA_A,
  ROTULO_DE_QUEM_ENTREGA,
  normalizarAvisos,
  type Categoria,
  type LigaA,
  type QuemEntrega,
  type Recorrencia,
  type TipoDeObrigacao,
} from "@/lib/obrigacoes/tipos";

interface Rascunho {
  nome: string;
  categoria: Categoria;
  quem: QuemEntrega;
  recorrencia: Recorrencia;
  meses: string;
  validade: string;
  avisos: [string, string, string];
  liga: LigaA;
}

const VAZIO: Rascunho = {
  nome: "",
  categoria: "documento",
  quem: "cliente",
  recorrencia: "unica",
  meses: "6",
  validade: "0",
  avisos: ["30", "15", "7"],
  liga: "negocio",
};

function rascunhoDoTipo(tipo: TipoDeObrigacao): Rascunho {
  return {
    nome: tipo.nome,
    categoria: tipo.categoria,
    quem: tipo.quem_entrega,
    recorrencia: tipo.recorrencia,
    meses: String(tipo.recorrencia_meses ?? 6),
    validade: String(tipo.validade_meses),
    avisos: [0, 1, 2].map((i) => (tipo.avisos_dias[i] ? String(tipo.avisos_dias[i]) : "")) as [string, string, string],
    liga: tipo.liga_a,
  };
}

const SELETOR = "h-8 w-full rounded-md border border-border bg-background px-2 text-xs";

export function TiposDeObrigacaoDoFunil({ pipelineId }: { pipelineId: string }) {
  const t = useT();
  const catalogo = useTiposDeObrigacao();
  const { garantir, arquivar } = useCatalogoDeObrigacoes();
  const [segmento, setSegmento] = useState<SegmentoDeObrigacao>("servicos_b2b");
  const [r, setR] = useState<Rascunho>(VAZIO);
  const [editando, setEditando] = useState(false);

  const tipos = (catalogo.data?.tipos ?? []).filter((x) => x.pipeline_id === pipelineId);
  const ocupado = garantir.isPending || arquivar.isPending;

  function salvar() {
    const nome = r.nome.trim();
    if (!nome) {
      toast.error(t("Dê um nome ao tipo."));
      return;
    }
    garantir.mutate(
      {
        pipelineId,
        tipos: [
          {
            nome,
            categoria: r.categoria,
            quem_entrega: r.quem,
            recorrencia: r.recorrencia,
            ...(r.recorrencia === "n_meses" ? { recorrencia_meses: Number(r.meses) || 1 } : {}),
            validade_meses: r.categoria === "atividade" ? 0 : Number(r.validade) || 0,
            avisos_dias: normalizarAvisos(r.avisos.map(Number)),
            liga_a: r.liga,
          },
        ],
      },
      {
        onSuccess: () => {
          toast.success(editando ? t("Tipo atualizado.") : t("Tipo adicionado ao funil."));
          setR(VAZIO);
          setEditando(false);
        },
      },
    );
  }

  return (
    <div className="space-y-4" data-testid="tipos-de-obrigacao-do-funil">

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`modelo-${pipelineId}`} className="text-xs">
            {t("Usar o modelo do segmento")}
          </Label>
          <select
            id={`modelo-${pipelineId}`}
            value={segmento}
            onChange={(e) => setSegmento(e.target.value as SegmentoDeObrigacao)}
            className={SELETOR}
          >
            {SEGMENTOS_DE_OBRIGACAO.map((s) => (
              <option key={s} value={s}>
                {t(ROTULO_DO_SEGMENTO_DE_OBRIGACAO[s])}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={ocupado}
          onClick={() =>
            garantir.mutate(
              { pipelineId, modeloDoSegmento: segmento },
              {
                onSuccess: (resposta) => {
                  const novos = resposta.resultado.filter((x) => x.desfecho === "criou").length;
                  toast.success(
                    novos > 0
                      ? `${novos} ${novos === 1 ? t("tipo adicionado ao funil.") : t("tipos adicionados ao funil.")}`
                      : t("O funil já tinha todos os tipos deste modelo."),
                  );
                },
              },
            )
          }
        >
          {t("Aplicar modelo")}
        </Button>
      </div>

      {catalogo.isLoading ? <p className="text-xs text-muted-foreground">{t("Carregando…")}</p> : null}
      {!catalogo.isLoading && tipos.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("Este funil ainda não tem tipos próprios. A equipe continua podendo usar os modelos e o nome livre ao adicionar um item.")}
        </p>
      ) : null}
      {tipos.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {tipos.map((tipo) => (
            <li key={tipo.id} className="flex flex-col gap-1 p-2 text-xs sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="break-words font-medium text-text">{tipo.nome}</p>
                <p className="text-[11px] text-muted-foreground">
                  {[
                    t(ROTULO_DA_CATEGORIA[tipo.categoria]),
                    tipo.categoria === "documento"
                      ? tipo.validade_meses > 0
                        ? `${t("validade de")} ${tipo.validade_meses} ${tipo.validade_meses === 1 ? t("mês") : t("meses")}`
                        : t("sem validade")
                      : null,
                    textoDaRecorrencia(tipo, t),
                    textoDosAvisos(tipo.avisos_dias, t),
                    t(ROTULO_CURTO_DE_QUEM_ENTREGA[tipo.quem_entrega]),
                    t(ROTULO_DE_LIGA_A[tipo.liga_a]),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => {
                    setR(rascunhoDoTipo(tipo));
                    setEditando(true);
                  }}
                >
                  {t("Editar")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={ocupado}
                  onClick={() => arquivar.mutate(tipo.id, { onSuccess: () => toast.success(t("Tipo tirado do catálogo. Os itens já criados continuam como estão.")) })}
                >
                  {t("Tirar")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-2 rounded-md border border-border p-3">
        <p className="text-xs font-medium text-text">{editando ? t("Editar tipo") : t("Adicionar tipo")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`tipo-nome-${pipelineId}`} className="text-xs">
              {t("Nome")}
            </Label>
            <Input
              id={`tipo-nome-${pipelineId}`}
              value={r.nome}
              maxLength={120}
              // O nome é a chave do tipo no funil: editar muda os outros campos, não o nome.
              disabled={editando}
              onChange={(e) => setR({ ...r, nome: e.target.value })}
              placeholder={t("Ex.: Alvará de funcionamento")}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`tipo-categoria-${pipelineId}`} className="text-xs">
              {t("É um")}
            </Label>
            <select
              id={`tipo-categoria-${pipelineId}`}
              value={r.categoria}
              onChange={(e) => {
                const categoria = e.target.value as Categoria;
                setR({ ...r, categoria, quem: categoria === "atividade" ? "nos" : "cliente" });
              }}
              className={SELETOR}
            >
              <option value="documento">{t(ROTULO_DA_CATEGORIA.documento)}</option>
              <option value="atividade">{t(ROTULO_DA_CATEGORIA.atividade)}</option>
            </select>
          </div>
          {r.categoria === "documento" ? (
            <div className="space-y-1">
              <Label htmlFor={`tipo-validade-${pipelineId}`} className="text-xs">
                {t("Validade padrão, em meses (0 = sem validade)")}
              </Label>
              <Input
                id={`tipo-validade-${pipelineId}`}
                type="number"
                min={0}
                max={600}
                value={r.validade}
                onChange={(e) => setR({ ...r, validade: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor={`tipo-recorrencia-${pipelineId}`} className="text-xs">
              {t("Recorrência")}
            </Label>
            <select
              id={`tipo-recorrencia-${pipelineId}`}
              value={r.recorrencia}
              onChange={(e) => setR({ ...r, recorrencia: e.target.value as Recorrencia })}
              className={SELETOR}
            >
              {RECORRENCIAS.map((rec) => (
                <option key={rec} value={rec}>
                  {t(ROTULO_DA_RECORRENCIA[rec])}
                </option>
              ))}
            </select>
          </div>
          {r.recorrencia === "n_meses" ? (
            <div className="space-y-1">
              <Label htmlFor={`tipo-meses-${pipelineId}`} className="text-xs">
                {t("N (meses)")}
              </Label>
              <Input
                id={`tipo-meses-${pipelineId}`}
                type="number"
                min={1}
                max={240}
                value={r.meses}
                onChange={(e) => setR({ ...r, meses: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor={`tipo-quem-${pipelineId}`} className="text-xs">
              {t("Quem entrega")}
            </Label>
            <select
              id={`tipo-quem-${pipelineId}`}
              value={r.quem}
              onChange={(e) => setR({ ...r, quem: e.target.value as QuemEntrega })}
              className={SELETOR}
            >
              <option value="cliente">{t(ROTULO_DE_QUEM_ENTREGA.cliente)}</option>
              <option value="nos">{t(ROTULO_DE_QUEM_ENTREGA.nos)}</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`tipo-liga-${pipelineId}`} className="text-xs">
              {t("Costuma ser de")}
            </Label>
            <select
              id={`tipo-liga-${pipelineId}`}
              value={r.liga}
              onChange={(e) => setR({ ...r, liga: e.target.value as LigaA })}
              className={SELETOR}
            >
              {LIGA_A.map((l) => (
                <option key={l} value={l}>
                  {t(ROTULO_DE_LIGA_A[l])}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span>{t("Avisar")}</span>
          {[0, 1, 2].map((i) => (
            <Input
              key={i}
              type="number"
              min={1}
              max={3650}
              value={r.avisos[i]}
              aria-label={`${i + 1}º ${t("aviso, dias antes")}`}
              onChange={(e) => {
                const avisos = [...r.avisos] as [string, string, string];
                avisos[i] = e.target.value;
                setR({ ...r, avisos });
              }}
              className="h-7 w-16 text-xs"
            />
          ))}
          <span>{t("dias antes")}</span>
        </div>
        {r.nome.trim() && ehTipoSensivel(r.nome) ? (
          <p className="rounded-md bg-warning-bg px-2 py-1.5 text-[11px] text-warning-fg">
            {t("Documento de saúde é dado sensível. Guarde só o necessário: o arquivo fica em área privada e é apagado junto com o contato num pedido de esquecimento.")}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={ocupado} onClick={salvar}>
            {editando ? t("Salvar tipo") : t("Adicionar tipo")}
          </Button>
          {editando ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setR(VAZIO);
                setEditando(false);
              }}
            >
              {t("Cancelar")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * O cartão "Documentos e obrigações" da tela de funis: escolhe o funil e mostra
 * o catálogo dele. Mora num cartão próprio, abaixo dos funis, para a tela do
 * upstream receber uma linha só.
 */
export function CatalogoDeObrigacoesDosFunis({ funis }: { funis: Array<{ id: string; name: string }> }) {
  const t = useT();
  const [funilId, setFunilId] = useState(funis[0]?.id ?? "");
  if (funis.length === 0) return null;
  return (
    <Card className="space-y-4 p-6" data-testid="catalogo-de-obrigacoes">
      <header className="space-y-1">
        <h2 className="text-base font-semibold">{t("Documentos e obrigações")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("Os tipos de documento e de atividade recorrente que a equipe escolhe ao adicionar um item num negócio de cada funil. Cada tipo traz validade, recorrência e avisos; no item, tudo pode ser mudado.")}
        </p>
      </header>
      {funis.length > 1 ? (
        <div className="max-w-xs space-y-1">
          <Label htmlFor="funil-do-catalogo" className="text-xs">
            {t("Funil")}
          </Label>
          <select id="funil-do-catalogo" value={funilId} onChange={(e) => setFunilId(e.target.value)} className={SELETOR}>
            {funis.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {/* A chave remonta o formulário ao trocar de funil: o rascunho de um não vaza para o outro. */}
      {funilId ? <TiposDeObrigacaoDoFunil key={funilId} pipelineId={funilId} /> : null}
    </Card>
  );
}
